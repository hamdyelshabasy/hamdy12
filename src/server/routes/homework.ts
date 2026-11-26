import express, { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  choices,
  courseLessons,
  courses,
  courseStudentBlocks,
  enrollments,
  entitlements,
  grades,
  groupMembers,
  groups,
  homeworkAssignments,
  homeworkAttachments,
  homeworkModelAnswers,
  homeworkQuestions,
  homeworkStoredFiles,
  homeworkSubmissionFiles,
  homeworkSubmissionQuestionGrades,
  homeworkSubmissions,
  homeworkTargets,
  lessons,
  questionAttachments,
  questions,
  roles,
  units,
  users,
  videos,
} from '../../db/schema.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  isAccountActive,
  isStaffRole,
  optionalAuth,
  requireActiveAccount,
  requireAuth,
  requirePermission,
  requireStaff,
  resolveEffectiveRolePermissions,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { getInactiveStaffErrorMessage } from '../../lib/permissions.ts';
import { createNotification, logAudit } from '../audit.ts';
import { isEntitlementActive, resolveVideoAccess } from '../domain/entitlements.ts';
import {
  buildGoogleDrivePreviewUrl,
  buildGoogleDriveViewUrl,
  extractGoogleDriveFileId,
} from '../../lib/googleDrive.ts';
import {
  computeHomeworkStatistics,
  deriveStudentHomeworkStatus,
  evaluateModelAnswerRelease,
  evaluateStudentHomeworkEligibility,
  evaluateSubmissionPermission,
  generateHomeworkStorageKey,
  MAX_ASSIGNMENT_ATTACHMENTS,
  MAX_MODEL_ANSWER_FILES,
  MAX_SUBMISSION_FILES,
  signHomeworkFileToken,
  validateAcademicCompatibility,
  validateGradingSubmission,
  validateHomeworkFileUpload,
  validateHomeworkQuestions,
  validateQuestionByQuestionGrading,
  validateQuestionStructureUpdate,
  validateRubricDefinition,
  verifyHomeworkFileToken,
  type HomeworkGradingMode,
  type ModelAnswerVisibilityPolicy,
  type RubricCriterion,
} from '../domain/homework.ts';
import {
  buildHomeworkQuestionSnapshot,
  sanitizeHomeworkChoicesForStudent,
  validateHomeworkStructuredAnswers,
  buildSignedQuestionBankFileUrl,
} from '../domain/questionBank.ts';

import { homeworkSharedCatalogCache } from '../cache.ts';

export const homeworkFilesRouter = Router();
export const adminHomeworkRouter = Router();
export const studentHomeworkRouter = Router();

const uploadJsonParser = express.json({ limit: '10mb' });

const PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'SCHEDULED', 'HIDDEN', 'ARCHIVED'] as const;
const HOMEWORK_SCOPES = ['GRADE', 'GROUP', 'STUDENTS', 'COURSE'] as const;
const MODEL_ANSWER_POLICIES = [
  'HIDDEN',
  'AFTER_DEADLINE',
  'AFTER_SUBMISSION',
  'AFTER_GRADING',
  'MANUAL_RELEASE',
  'SCHEDULED_RELEASE',
] as const;

const rubricCriterionSchema = z.object({
  id: z.string().trim().min(1).max(60),
  labelAr: z.string().trim().min(1).max(160),
  maxPoints: z.preprocess(preprocessLocalizedNumber, z.coerce.number().positive().max(1000)),
});

const questionDefinitionSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  bankQuestionId: z.coerce.number().int().positive().nullable().optional(),
  questionNumber: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1)).optional(),
  labelAr: z.string().trim().min(1, 'يرجى إدخال عنوان واضح لكل سؤال').max(200),
  descriptionAr: z.string().max(1000).optional().default(''),
  maxGrade: z.preprocess(
    preprocessLocalizedNumber,
    z.coerce.number().positive('الدرجة العظمى للسؤال يجب أن تكون أكبر من صفر').max(1000),
  ),
  displayOrder: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(0)).optional(),
});

const attachmentInputSchema = z.object({
  attachmentType: z.enum(['FILE', 'GOOGLE_DRIVE_PDF']),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().optional().default('application/pdf'),
  sizeBytes: z.coerce.number().int().min(0).optional().default(0),
  storageKey: z.string().trim().nullable().optional(),
  driveUrl: z.string().trim().nullable().optional(),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
});

const modelAnswerInputSchema = z.object({
  titleAr: z.string().trim().min(1).max(200).optional().default('نموذج الإجابة'),
  notesAr: z.string().max(4000).optional().default(''),
  driveUrl: z.string().trim().nullable().optional(),
  files: z
    .array(
      z.object({
        storageKey: z.string().trim().min(1),
        fileName: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().min(1).max(100),
        sizeBytes: z.coerce.number().int().min(0),
        displayOrder: z.coerce.number().int().min(0).default(0),
      }),
    )
    .max(MAX_MODEL_ANSWER_FILES)
    .optional()
    .default([]),
  visibilityPolicy: z.enum(MODEL_ANSWER_POLICIES).default('HIDDEN'),
  releaseAt: z.string().nullable().optional(),
  manuallyReleased: z.boolean().optional().default(false),
});

const homeworkPayloadSchema = z.object({
  titleAr: z.string().trim().min(3, 'عنوان الواجب يجب أن يكون 3 أحرف على الأقل').max(220),
  descriptionAr: z.string().max(4000).optional().default(''),
  instructionsAr: z.string().max(10000).optional().default(''),
  trackId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  videoId: z.coerce.number().int().positive().nullable().optional(),
  courseId: z.coerce.number().int().positive().nullable().optional(),
  maximumGrade: z.preprocess(preprocessLocalizedNumber, z.coerce.number().positive().max(1000)).default(10),
  rubric: z.array(rubricCriterionSchema).max(20).optional().default([]),
  questions: z.array(questionDefinitionSchema).max(50).optional().default([]),
  assignmentScope: z.enum(HOMEWORK_SCOPES).default('GRADE'),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('DRAFT'),
  publishedAt: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  allowLateSubmission: z.boolean().default(false),
  allowResubmission: z.boolean().default(false),
  maximumSubmissions: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(20)).default(1),
  allowReopenAfterGrading: z.boolean().default(false),
  targetStudentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  targetGroupIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  attachments: z.array(attachmentInputSchema).max(MAX_ASSIGNMENT_ATTACHMENTS).optional().default([]),
  modelAnswer: modelAnswerInputSchema.nullable().optional(),
});

const uploadFilePayloadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().optional(),
  dataBase64: z.string().min(8),
  purpose: z.enum(['ASSIGNMENT_ATTACHMENT', 'MODEL_ANSWER', 'SUBMISSION_FILE']).optional(),
});

function parseOptionalDate(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildSignedFileUrl(storageKey: string, userId: number, roleSlug: string): string {
  const token = signHomeworkFileToken({ storageKey, userId, roleSlug, ttlSec: 21600 });
  return `/api/homework/files/${encodeURIComponent(storageKey)}?token=${encodeURIComponent(token)}`;
}

async function getStudentContext(userId: number, roleSlug: string, userStatus: string) {
  const isStaff = isStaffRole(roleSlug);
  const [allGrades, memberGroups, userEntitlements, activeBlocks] = await Promise.all([
    isStaff
      ? db.select({ id: grades.id }).from(grades).then((rows) => rows.map((g) => g.id))
      : db
          .select({ gradeId: enrollments.gradeId })
          .from(enrollments)
          .where(and(eq(enrollments.userId, userId), eq(enrollments.status, 'ACTIVE')))
          .then((rows) => rows.map((e) => e.gradeId)),
    db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)),
    db.select().from(entitlements).where(eq(entitlements.userId, userId)),
    isStaff
      ? Promise.resolve([])
      : db
          .select({ courseId: courseStudentBlocks.courseId })
          .from(courseStudentBlocks)
          .where(and(eq(courseStudentBlocks.userId, userId), eq(courseStudentBlocks.isActive, true))),
  ]);

  const studentGroupIds = memberGroups.map((m) => m.groupId);
  const blockedCourseIds = new Set(activeBlocks.map((b) => b.courseId));

  const now = new Date();
  const effectiveEntitlements = userEntitlements.filter(
    (e) => !(e.targetType === 'COURSE' && blockedCourseIds.has(e.targetId)),
  );
  const activeEntitlements = effectiveEntitlements.filter((e) => isEntitlementActive(e, now));
  const activeCourseIds = activeEntitlements
    .filter((e) => e.targetType === 'COURSE')
    .map((e) => e.targetId);
  const gradeAllIds = new Set(
    activeEntitlements.filter((e) => e.targetType === 'GRADE_ALL').map((e) => e.targetId),
  );

  return {
    userId,
    roleSlug,
    userStatus,
    isStaff,
    approvedGradeIds: allGrades,
    studentGroupIds,
    userEntitlements: effectiveEntitlements,
    blockedCourseIds,
    activeCourseIds,
    gradeAllIds,
  };
}

async function checkStudentVideoAccess(
  studentCtx: Awaited<ReturnType<typeof getStudentContext>>,
  videoId: number | null,
): Promise<boolean> {
  if (!videoId) return true;
  if (studentCtx.isStaff) return true;

  const [v] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!v) return false;

  if (v.courseId && studentCtx.blockedCourseIds.has(v.courseId)) {
    return false;
  }

  const clRows = await db
    .select()
    .from(courseLessons)
    .where(eq(courseLessons.lessonId, v.lessonId));

  const unblockedCourseLinks = clRows.filter((cl) => !studentCtx.blockedCourseIds.has(cl.courseId));

  const decision = resolveVideoAccess({
    userRoleSlug: studentCtx.roleSlug,
    userStatus: studentCtx.userStatus,
    approvedGradeIds: studentCtx.approvedGradeIds,
    videoId: v.id,
    videoGradeId: v.gradeId,
    videoType: v.videoType,
    videoPublished: v.isPublished,
    publicationStatus: v.publicationStatus,
    videoCourseId: v.courseId,
    courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
    isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
    entitlements: studentCtx.userEntitlements,
  });

  return decision.allowed;
}

async function getTargetedStudentsForAssignment(assignment: {
  id: number;
  gradeId: number;
  courseId: number | null;
  assignmentScope: string;
}): Promise<
  Array<{
    id: number;
    fullName: string;
    phone: string | null;
    gradeId: number;
  }>
> {
  const allRoles = await db.select().from(roles);
  const studentRoleId = allRoles.find((r) => r.slug === 'STUDENT')?.id;
  if (!studentRoleId) return [];

  const activeStudents = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
    })
    .from(users)
    .where(and(eq(users.roleId, studentRoleId), eq(users.status, 'ACTIVE')));

  const studentById = new Map(activeStudents.map((s) => [s.id, s]));

  if (assignment.assignmentScope === 'STUDENTS') {
    const targets = await db
      .select()
      .from(homeworkTargets)
      .where(eq(homeworkTargets.assignmentId, assignment.id));
    const ids = new Set(targets.map((t) => t.studentId).filter((id): id is number => Boolean(id)));
    return Array.from(ids)
      .map((id) => studentById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ ...s, gradeId: assignment.gradeId }));
  }

  if (assignment.assignmentScope === 'GROUP') {
    const targets = await db
      .select()
      .from(homeworkTargets)
      .where(eq(homeworkTargets.assignmentId, assignment.id));
    const gIds = targets.map((t) => t.groupId).filter((id): id is number => Boolean(id));
    if (!gIds.length) return [];
    const members = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, gIds));
    const ids = new Set(members.map((m) => m.userId));
    return Array.from(ids)
      .map((id) => studentById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ ...s, gradeId: assignment.gradeId }));
  }

  if (assignment.assignmentScope === 'COURSE' && assignment.courseId) {
    const now = new Date();
    const ents = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.isRevoked, false));
    const eligibleIds = new Set<number>();
    for (const ent of ents) {
      if (!isEntitlementActive(ent, now)) continue;
      if (
        (ent.targetType === 'COURSE' && ent.targetId === assignment.courseId) ||
        (ent.targetType === 'GRADE_ALL' && ent.targetId === assignment.gradeId)
      ) {
        eligibleIds.add(ent.userId);
      }
    }
    return Array.from(eligibleIds)
      .map((id) => studentById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ ...s, gradeId: assignment.gradeId }));
  }

  // GRADE scope
  const gradeEnrs = await db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(and(eq(enrollments.gradeId, assignment.gradeId), eq(enrollments.status, 'ACTIVE')));
  const ids = new Set(gradeEnrs.map((e) => e.userId));
  return Array.from(ids)
    .map((id) => studentById.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ ...s, gradeId: assignment.gradeId }));
}

function getAdminSubmissionStatusLabelAr(status: string, isGradePublished: boolean): string {
  switch (status) {
    case 'NOT_SUBMITTED':
      return 'لم يسلّم بعد';
    case 'DRAFT':
      return 'مسودة لدى الطالب';
    case 'SUBMITTED':
      return 'تم التسليم (بانتظار التصحيح)';
    case 'SUBMITTED_LATE':
      return 'تسليم متأخر (بانتظار التصحيح)';
    case 'UNDER_REVIEW':
      return 'قيد المراجعة والتصحيح';
    case 'RETURNED_FOR_REVISION':
      return 'أُعيد للطالب للتعديل';
    case 'GRADED':
      return isGradePublished ? 'تم التصحيح ونشر الدرجة' : 'درجة محفوظة كمسودة';
    default:
      return status;
  }
}

async function resolveBankQuestionSnapshotsForHomework(
  questionsInput: Array<z.infer<typeof questionDefinitionSchema>>,
): Promise<
  | {
      ok: true;
      snapshotByBankId: Map<
        number,
        ReturnType<typeof buildHomeworkQuestionSnapshot>
      >;
    }
  | { ok: false; errorAr: string }
> {
  const bankIds = Array.from(
    new Set(
      questionsInput
        .map((q) => q.bankQuestionId)
        .filter((id): id is number => Boolean(id && Number.isInteger(id) && id > 0)),
    ),
  );
  const snapshotByBankId = new Map<number, ReturnType<typeof buildHomeworkQuestionSnapshot>>();
  if (!bankIds.length) {
    return { ok: true, snapshotByBankId };
  }

  const bankRows = await db
    .select()
    .from(questions)
    .where(and(inArray(questions.id, bankIds), eq(questions.isBankItem, true)));
  const bankById = new Map(bankRows.map((b) => [b.id, b]));

  for (const bid of bankIds) {
    const bq = bankById.get(bid);
    if (!bq) {
      return { ok: false, errorAr: `السؤال رقم ${bid} غير موجود في بنك الأسئلة.` };
    }
    if (bq.isArchived || bq.approvalStatus !== 'APPROVED') {
      return {
        ok: false,
        errorAr: `لا يمكن ربط السؤال (${bq.bankCode || bq.id}) بالواجب لأنه غير معتمد أو مؤرشف.`,
      };
    }
  }

  const [attRows, choiceRows] = await Promise.all([
    db
      .select()
      .from(questionAttachments)
      .where(inArray(questionAttachments.questionId, bankIds))
      .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id)),
    db
      .select()
      .from(choices)
      .where(inArray(choices.questionId, bankIds))
      .orderBy(asc(choices.sortOrder), asc(choices.id)),
  ]);

  for (const bq of bankRows) {
    const qAtts = attRows.filter((a) => a.questionId === bq.id);
    const qChoices = choiceRows.filter((c) => c.questionId === bq.id);
    const snap = buildHomeworkQuestionSnapshot({
      bankQuestion: bq,
      questionImages: qAtts
        .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
        .map((a) => ({
          storageKey: a.storageKey,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          displayOrder: a.displayOrder,
        })),
      modelAnswerFiles: qAtts
        .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
        .map((a) => ({
          storageKey: a.storageKey,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          displayOrder: a.displayOrder,
        })),
      choices: qChoices.map((c) => ({
        id: c.id,
        labelAr: c.labelAr,
        isCorrect: c.isCorrect,
        sortOrder: c.sortOrder,
      })),
      questionNumber: 1,
    });
    snapshotByBankId.set(bq.id, snap);
  }

  return { ok: true, snapshotByBankId };
}

async function loadAssignmentQuestions(
  assignmentId: number,
  viewer?: { id: number; roleSlug: string },
  opts?: { includeModelAnswers?: boolean },
) {
  const rows = await db
    .select()
    .from(homeworkQuestions)
    .where(eq(homeworkQuestions.assignmentId, assignmentId))
    .orderBy(
      asc(homeworkQuestions.displayOrder),
      asc(homeworkQuestions.questionNumber),
      asc(homeworkQuestions.id),
    );

  const qIds = rows.map((r) => r.id);
  const gradedMaxMap = new Map<number, number>();
  if (qIds.length > 0) {
    const gradeRows = await db
      .select({
        questionId: homeworkSubmissionQuestionGrades.questionId,
        awardedGrade: homeworkSubmissionQuestionGrades.awardedGrade,
      })
      .from(homeworkSubmissionQuestionGrades)
      .where(inArray(homeworkSubmissionQuestionGrades.questionId, qIds));
    for (const g of gradeRows) {
      const val = Number(g.awardedGrade);
      const prev = gradedMaxMap.get(g.questionId);
      if (prev === undefined || val > prev) {
        gradedMaxMap.set(g.questionId, val);
      }
    }
  }

  const includeMa = Boolean(opts?.includeModelAnswers);

  return {
    questions: rows.map((q) => ({
      id: q.id,
      bankQuestionId: q.bankQuestionId ?? null,
      bankQuestionVersion: q.bankQuestionVersion ?? null,
      questionType: q.questionType ?? null,
      questionNumber: q.questionNumber,
      labelAr: q.labelAr,
      descriptionAr: q.descriptionAr,
      promptSnapshotAr: q.promptSnapshotAr || '',
      questionImages: (q.questionImagesJson || []).map((img) => ({
        ...img,
        previewUrl: viewer
          ? buildSignedQuestionBankFileUrl({
              storageKey: img.storageKey,
              userId: viewer.id,
              roleSlug: viewer.roleSlug,
              context: 'homework',
              resourceId: assignmentId,
              fileRole: 'question',
            })
          : undefined,
      })),
      choices: sanitizeHomeworkChoicesForStudent(q.choicesSnapshotJson, includeMa),
      ...(includeMa
        ? {
            modelAnswerTextSnapshot: q.modelAnswerTextSnapshot || '',
            modelAnswerFiles: (q.modelAnswerFilesJson || []).map((f) => ({
              ...f,
              previewUrl: viewer
                ? buildSignedQuestionBankFileUrl({
                    storageKey: f.storageKey,
                    userId: viewer.id,
                    roleSlug: viewer.roleSlug,
                    context: 'homework',
                    resourceId: assignmentId,
                    fileRole: 'model_answer',
                  })
                : undefined,
            })),
          }
        : {}),
      maxGrade: Number(q.maxGrade),
      displayOrder: q.displayOrder,
      hasGradingRecords: gradedMaxMap.has(q.id),
    })),
    rawRows: rows,
    gradedMaxMap,
  };
}

async function loadQuestionGradesBySubmission(
  submissionIds: number[],
  assignmentQuestions: Array<{
    id: number;
    questionNumber: number;
    labelAr: string;
    descriptionAr: string;
    maxGrade: number;
  }>,
) {
  const map = new Map<
    number,
    Array<{
      questionId: number;
      questionNumber: number;
      labelAr: string;
      descriptionAr: string;
      maxGrade: number;
      awardedGrade: number;
      teacherComment: string;
    }>
  >();
  if (!submissionIds.length || !assignmentQuestions.length) return map;

  const rows = await db
    .select()
    .from(homeworkSubmissionQuestionGrades)
    .where(inArray(homeworkSubmissionQuestionGrades.submissionId, submissionIds));

  const bySubAndQ = new Map<string, (typeof rows)[number]>();
  const subsWithAnyGrades = new Set<number>();
  for (const r of rows) {
    bySubAndQ.set(`${r.submissionId}:${r.questionId}`, r);
    subsWithAnyGrades.add(r.submissionId);
  }

  for (const subId of submissionIds) {
    if (!subsWithAnyGrades.has(subId)) {
      map.set(subId, []);
      continue;
    }
    const ordered = assignmentQuestions
      .map((q) => {
        const rec = bySubAndQ.get(`${subId}:${q.id}`);
        if (!rec) return null;
        return {
          questionId: q.id,
          questionNumber: q.questionNumber,
          labelAr: q.labelAr,
          descriptionAr: q.descriptionAr,
          maxGrade: q.maxGrade,
          awardedGrade: Number(rec.awardedGrade),
          teacherComment: rec.teacherComment || '',
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    map.set(subId, ordered);
  }

  return map;
}

function normalizeGradingMode(mode: string | null | undefined): HomeworkGradingMode {
  if (mode === 'RUBRIC' || mode === 'QUESTION_BY_QUESTION') return mode;
  return 'DIRECT';
}

// =========================================================================
// 1. PRIVATE FILE ACCESS ENDPOINT (Strict Ownership + Model Answer Gating)
// =========================================================================
homeworkFilesRouter.get('/files/:storageKey', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const storageKey = String(req.params.storageKey || '').trim();
    if (!/^hwf_[a-f0-9]{16,64}$/i.test(storageKey)) {
      return res.status(400).json({ error: 'معرّف الملف غير صالح' });
    }

    let requesterUserId: number | null = null;
    let requesterRoleSlug: string | null = null;
    let requesterStatus = 'ACTIVE';
    let requesterPermissions: string[] = [];

    if (req.authUser) {
      requesterUserId = req.authUser.id;
      requesterRoleSlug = req.authUser.roleSlug;
      requesterStatus = req.authUser.status;
      requesterPermissions = req.authUser.permissions;
    } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
      const verified = verifyHomeworkFileToken(req.query.token.trim());
      if (!verified || verified.storageKey !== storageKey) {
        return res.status(403).json({ error: 'رابط الوصول للملف غير صالح أو منتهي الصلاحية' });
      }
      const [uRow] = await db
        .select({ user: users, role: roles })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, verified.userId))
        .limit(1);
      if (!uRow) {
        return res.status(401).json({ error: 'المستخدم غير موجود' });
      }
      requesterUserId = uRow.user.id;
      requesterRoleSlug = uRow.role.slug;
      requesterStatus = uRow.user.status;
      requesterPermissions = resolveEffectiveRolePermissions(
        uRow.role.slug,
        uRow.role.permissionsJson,
      );
    } else {
      return res.status(401).json({ error: 'يجب تسجيل الدخول للوصول إلى هذا الملف الخاص' });
    }

    const [fileRow] = await db
      .select()
      .from(homeworkStoredFiles)
      .where(eq(homeworkStoredFiles.storageKey, storageKey))
      .limit(1);

    if (!fileRow) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    const staff = isStaffRole(requesterRoleSlug || '');

    if (staff) {
      if (!isAccountActive(requesterStatus)) {
        return res.status(403).json({ error: getInactiveStaffErrorMessage(requesterStatus) });
      }
      const canAccessHomeworkFiles = hasAnyPermission(
        {
          roleSlug: requesterRoleSlug || '',
          status: requesterStatus,
          permissions: requesterPermissions,
        },
        [PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE],
      );
      if (!canAccessHomeworkFiles) {
        return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى ملفات الواجبات.' });
      }
    }

    if (!staff) {
      if (requesterStatus !== 'ACTIVE') {
        return res.status(403).json({ error: 'حسابك غير مفعّل للوصول إلى هذا الملف' });
      }

      if (fileRow.purpose === 'SUBMISSION_FILE') {
        if (fileRow.ownerUserId !== requesterUserId) {
          return res.status(403).json({ error: 'لا تملك صلاحية الاطلاع على ملفات طالب آخر' });
        }
      } else if (fileRow.purpose === 'ASSIGNMENT_ATTACHMENT') {
        const [att] = await db
          .select()
          .from(homeworkAttachments)
          .where(eq(homeworkAttachments.storageKey, storageKey))
          .limit(1);
        if (!att) return res.status(403).json({ error: 'الملف غير مرتبط بواجب متاح' });

        const [assignment] = await db
          .select()
          .from(homeworkAssignments)
          .where(eq(homeworkAssignments.id, att.assignmentId))
          .limit(1);
        if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });

        const sCtx = await getStudentContext(requesterUserId!, requesterRoleSlug!, requesterStatus);
        const targets = await db
          .select()
          .from(homeworkTargets)
          .where(eq(homeworkTargets.assignmentId, assignment.id));
        const hasVideoAccess = await checkStudentVideoAccess(sCtx, assignment.videoId);

        const eligibility = evaluateStudentHomeworkEligibility({
          assignment,
          studentId: requesterUserId!,
          isStaff: false,
          approvedGradeIds: sCtx.approvedGradeIds,
          studentGroupIds: sCtx.studentGroupIds,
          activeCourseIds: sCtx.activeCourseIds,
          hasGradeAllEntitlement: sCtx.gradeAllIds.has(assignment.gradeId),
          targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
          targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
          hasVideoAccess,
        });
        if (!eligibility.eligible) {
          return res.status(403).json({ error: eligibility.reasonAr || 'غير مصرح بالوصول لهذا المرفق' });
        }
      } else if (fileRow.purpose === 'MODEL_ANSWER') {
        const allModelAnswers = await db.select().from(homeworkModelAnswers);
        const matched = allModelAnswers.find((ma) =>
          (ma.filesJson || []).some((f) => f.storageKey === storageKey),
        );
        if (!matched) {
          return res.status(403).json({ error: 'نموذج الإجابة غير متاح حاليًا' });
        }

        const [assignment] = await db
          .select()
          .from(homeworkAssignments)
          .where(eq(homeworkAssignments.id, matched.assignmentId))
          .limit(1);
        if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });

        const sCtx = await getStudentContext(requesterUserId!, requesterRoleSlug!, requesterStatus);
        const targets = await db
          .select()
          .from(homeworkTargets)
          .where(eq(homeworkTargets.assignmentId, assignment.id));
        const hasVideoAccess = await checkStudentVideoAccess(sCtx, assignment.videoId);

        const eligibility = evaluateStudentHomeworkEligibility({
          assignment,
          studentId: requesterUserId!,
          isStaff: false,
          approvedGradeIds: sCtx.approvedGradeIds,
          studentGroupIds: sCtx.studentGroupIds,
          activeCourseIds: sCtx.activeCourseIds,
          hasGradeAllEntitlement: sCtx.gradeAllIds.has(assignment.gradeId),
          targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
          targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
          hasVideoAccess,
        });
        if (!eligibility.eligible) {
          return res.status(403).json({ error: 'غير مصرح بالوصول إلى نموذج إجابة هذا الواجب' });
        }

        const studentSubs = await db
          .select()
          .from(homeworkSubmissions)
          .where(
            and(
              eq(homeworkSubmissions.assignmentId, assignment.id),
              eq(homeworkSubmissions.studentId, requesterUserId!),
            ),
          );
        const hasSubmitted = studentSubs.some((s) => s.status !== 'DRAFT');
        const isGraded = studentSubs.some((s) => s.status === 'GRADED' && s.isGradePublished);

        const release = evaluateModelAnswerRelease({
          policy: matched.visibilityPolicy,
          releaseAt: matched.releaseAt,
          manuallyReleased: matched.manuallyReleased,
          assignmentDeadline: assignment.deadline,
          hasStudentSubmitted: hasSubmitted,
          isStudentGradedAndPublished: isGraded,
          isStaff: false,
        });

        if (!release.isReleased) {
          return res.status(403).json({ error: release.reasonAr });
        }
      } else {
        return res.status(403).json({ error: 'غير مصرح بالوصول' });
      }
    }

    const buf = Buffer.from(fileRow.dataBase64, 'base64');
    const safeAsciiName = fileRow.originalName.replace(/[^\x20-\x7E]/g, '_') || 'file';
    res.setHeader('Content-Type', fileRow.mimeType);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeAsciiName.replace(/"/g, '')}"`,
    );
    return res.send(buf);
  } catch (err) {
    console.error('Private homework file fetch error:', err);
    return res.status(500).json({ error: 'تعذر تحميل الملف المطلوب' });
  }
});

// =========================================================================
// 2. ADMIN HOMEWORK ROUTES (/api/admin/homework/*)
// =========================================================================
adminHomeworkRouter.use(requireAuth, requireStaff());

// Metadata for targeting (active students + groups)
adminHomeworkRouter.get(
  '/meta',
  requirePermission([PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE]),
  async (_req, res) => {
  try {
    const allRoles = await db.select().from(roles);
    const studentRoleId = allRoles.find((r) => r.slug === 'STUDENT')?.id;
    const studentRows = studentRoleId
      ? await db
          .select({
            id: users.id,
            fullName: users.fullName,
            phone: users.phone,
            status: users.status,
          })
          .from(users)
          .where(and(eq(users.roleId, studentRoleId), eq(users.status, 'ACTIVE')))
          .orderBy(asc(users.fullName))
      : [];

    const enrs = await db
      .select({ userId: enrollments.userId, gradeId: enrollments.gradeId, trackId: enrollments.trackId })
      .from(enrollments)
      .where(eq(enrollments.status, 'ACTIVE'));

    const gradeIdsByUser = new Map<number, number[]>();
    for (const e of enrs) {
      const arr = gradeIdsByUser.get(e.userId) || [];
      arr.push(e.gradeId);
      gradeIdsByUser.set(e.userId, arr);
    }

    const groupRows = await db.select().from(groups).orderBy(asc(groups.nameAr));

    return res.json({
      students: studentRows.map((s) => ({
        ...s,
        gradeIds: gradeIdsByUser.get(s.id) || [],
      })),
      groups: groupRows,
    });
  } catch (err) {
    console.error('Admin homework meta error:', err);
    return res.status(500).json({ error: 'تعذر تحميل بيانات الطلاب والمجموعات' });
  }
});

// Secure file upload for admin (homework attachments or model answer files)
adminHomeworkRouter.post('/upload-file', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), uploadJsonParser, async (req: AuthRequest, res) => {
  try {
    const parsed = uploadFilePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات الملف غير مكتملة' });
    }
    const purpose =
      parsed.data.purpose === 'MODEL_ANSWER' ? 'MODEL_ANSWER' : 'ASSIGNMENT_ATTACHMENT';

    const validated = validateHomeworkFileUpload({
      fileName: parsed.data.fileName,
      declaredMimeType: parsed.data.mimeType,
      dataBase64: parsed.data.dataBase64,
    });

    if (!validated.ok) {
      return res.status(400).json({ error: validated.errorAr });
    }

    const storageKey = generateHomeworkStorageKey();
    await db.insert(homeworkStoredFiles).values({
      storageKey,
      ownerUserId: req.authUser!.id,
      purpose,
      originalName: validated.sanitizedFileName,
      mimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      dataBase64: validated.cleanBase64,
    });

    return res.status(201).json({
      storageKey,
      fileName: validated.sanitizedFileName,
      mimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      previewUrl: buildSignedFileUrl(storageKey, req.authUser!.id, req.authUser!.roleSlug),
    });
  } catch (err) {
    console.error('Admin homework file upload error:', err);
    return res.status(500).json({ error: 'تعذر رفع الملف وحفظه بأمان' });
  }
});

// List all homework assignments with filters & live statistics
adminHomeworkRouter.get(
  '/',
  requirePermission([PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE]),
  async (req: AuthRequest, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const trackFilter = Number(req.query.trackId || 0);
    const gradeFilter = Number(req.query.gradeId || 0);
    const videoFilter = Number(req.query.videoId || 0);
    const courseFilter = Number(req.query.courseId || 0);
    const statusFilter = String(req.query.status || 'ALL').toUpperCase();

    const [
      assignments,
      allTracks,
      allGrades,
      allUnits,
      allLessons,
      allVideos,
      allCourses,
      allAttachments,
      allModelAnswers,
      allSubmissions,
      activeStudentRows,
      allTargets,
      allGroupMembers,
      allActiveEnrollments,
      allActiveEntitlements,
    ] = await Promise.all([
      db.select().from(homeworkAssignments).orderBy(desc(homeworkAssignments.createdAt)),
      db.select().from(academicTracks),
      db.select().from(grades),
      db.select().from(units),
      db.select().from(lessons),
      db.select().from(videos),
      db.select().from(courses),
      db.select().from(homeworkAttachments),
      db.select().from(homeworkModelAnswers),
      db.select().from(homeworkSubmissions),
      db
        .select({ id: users.id })
        .from(users)
        .innerJoin(roles, and(eq(users.roleId, roles.id), eq(roles.slug, 'STUDENT')))
        .where(eq(users.status, 'ACTIVE')),
      db.select().from(homeworkTargets),
      db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers),
      db
        .select({ userId: enrollments.userId, gradeId: enrollments.gradeId })
        .from(enrollments)
        .where(eq(enrollments.status, 'ACTIVE')),
      db.select().from(entitlements).where(eq(entitlements.isRevoked, false)),
    ]);

    const activeStudentIds = new Set(activeStudentRows.map((u) => u.id));

    const trackById = new Map(allTracks.map((t) => [t.id, t]));
    const gradeById = new Map(allGrades.map((g) => [g.id, g]));
    const unitById = new Map(allUnits.map((u) => [u.id, u]));
    const lessonById = new Map(allLessons.map((l) => [l.id, l]));
    const videoById = new Map(allVideos.map((v) => [v.id, v]));
    const courseById = new Map(allCourses.map((c) => [c.id, c]));
    const maByAssignment = new Map(allModelAnswers.map((m) => [m.assignmentId, m]));

    // Pre-index targeting & submissions maps in O(N) to eliminate N+1 DB queries
    const subsByAssignment = new Map<number, typeof allSubmissions>();
    for (const s of allSubmissions) {
      const list = subsByAssignment.get(s.assignmentId) || [];
      list.push(s);
      subsByAssignment.set(s.assignmentId, list);
    }
    const attCountByAssignment = new Map<number, number>();
    for (const att of allAttachments) {
      attCountByAssignment.set(att.assignmentId, (attCountByAssignment.get(att.assignmentId) || 0) + 1);
    }
    const targetsByAssignment = new Map<number, typeof allTargets>();
    for (const t of allTargets) {
      const list = targetsByAssignment.get(t.assignmentId) || [];
      list.push(t);
      targetsByAssignment.set(t.assignmentId, list);
    }
    const membersByGroup = new Map<number, number[]>();
    for (const gm of allGroupMembers) {
      if (!activeStudentIds.has(gm.userId)) continue;
      const list = membersByGroup.get(gm.groupId) || [];
      list.push(gm.userId);
      membersByGroup.set(gm.groupId, list);
    }
    const studentsByGrade = new Map<number, Set<number>>();
    for (const en of allActiveEnrollments) {
      if (!activeStudentIds.has(en.userId)) continue;
      const set = studentsByGrade.get(en.gradeId) || new Set<number>();
      set.add(en.userId);
      studentsByGrade.set(en.gradeId, set);
    }
    const now = new Date();
    const studentsByCourse = new Map<number, Set<number>>();
    const studentsByGradeAll = new Map<number, Set<number>>();
    for (const ent of allActiveEntitlements) {
      if (!activeStudentIds.has(ent.userId) || !isEntitlementActive(ent, now)) continue;
      if (ent.targetType === 'COURSE') {
        const set = studentsByCourse.get(ent.targetId) || new Set<number>();
        set.add(ent.userId);
        studentsByCourse.set(ent.targetId, set);
      } else if (ent.targetType === 'GRADE_ALL') {
        const set = studentsByGradeAll.get(ent.targetId) || new Set<number>();
        set.add(ent.userId);
        studentsByGradeAll.set(ent.targetId, set);
      }
    }

    const filtered = assignments.filter((a) => {
      if (trackFilter && a.trackId !== trackFilter) return false;
      if (gradeFilter && a.gradeId !== gradeFilter) return false;
      if (videoFilter && a.videoId !== videoFilter) return false;
      if (courseFilter && a.courseId !== courseFilter) return false;
      if (statusFilter !== 'ALL' && a.publicationStatus !== statusFilter) return false;
      if (
        search &&
        !a.titleAr.toLowerCase().includes(search) &&
        !(a.descriptionAr || '').toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });

    const items = filtered.map((a) => {
      let totalAssignedStudents = 0;
      if (a.assignmentScope === 'STUDENTS') {
        const aTargets = targetsByAssignment.get(a.id) || [];
        const unique = new Set(
          aTargets
            .map((t) => t.studentId)
            .filter((id): id is number => typeof id === 'number' && id > 0 && activeStudentIds.has(id)),
        );
        totalAssignedStudents = unique.size;
      } else if (a.assignmentScope === 'GROUP') {
        const aTargets = targetsByAssignment.get(a.id) || [];
        const unique = new Set<number>();
        for (const t of aTargets) {
          if (!t.groupId) continue;
          for (const uid of membersByGroup.get(t.groupId) || []) unique.add(uid);
        }
        totalAssignedStudents = unique.size;
      } else if (a.assignmentScope === 'COURSE' && a.courseId) {
        const unique = new Set<number>([
          ...(studentsByCourse.get(a.courseId) || []),
          ...(studentsByGradeAll.get(a.gradeId) || []),
        ]);
        totalAssignedStudents = unique.size;
      } else {
        totalAssignedStudents = (studentsByGrade.get(a.gradeId) || new Set()).size;
      }

      const aSubs = subsByAssignment.get(a.id) || [];

      // Latest submission per student
      const latestByStudent = new Map<number, (typeof aSubs)[number]>();
      for (const s of aSubs) {
        const prev = latestByStudent.get(s.studentId);
        if (!prev || s.version > prev.version) {
          latestByStudent.set(s.studentId, s);
        }
      }

      const stats = computeHomeworkStatistics({
        totalAssignedStudents,
        latestSubmissionsByStudent: Array.from(latestByStudent.values()).map((s) => ({
          status: s.status,
          isLate: s.isLate,
          isGradePublished: s.isGradePublished,
          awardedGrade: s.awardedGrade !== null ? Number(s.awardedGrade) : null,
        })),
      });

      const ma = maByAssignment.get(a.id);
      const attCount = attCountByAssignment.get(a.id) || 0;

      return {
        id: a.id,
        titleAr: a.titleAr,
        descriptionAr: a.descriptionAr,
        instructionsAr: a.instructionsAr,
        trackId: a.trackId,
        trackNameAr: trackById.get(a.trackId)?.nameAr || '',
        gradeId: a.gradeId,
        gradeNameAr: gradeById.get(a.gradeId)?.nameAr || '',
        unitId: a.unitId,
        unitTitleAr: a.unitId ? unitById.get(a.unitId)?.titleAr || null : null,
        lessonId: a.lessonId,
        lessonTitleAr: a.lessonId ? lessonById.get(a.lessonId)?.titleAr || null : null,
        videoId: a.videoId,
        videoTitleAr: a.videoId ? videoById.get(a.videoId)?.titleAr || null : null,
        courseId: a.courseId,
        courseTitleAr: a.courseId ? courseById.get(a.courseId)?.titleAr || null : null,
        maximumGrade: Number(a.maximumGrade),
        assignmentScope: a.assignmentScope,
        publicationStatus: a.publicationStatus,
        publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
        deadline: a.deadline ? a.deadline.toISOString() : null,
        allowLateSubmission: a.allowLateSubmission,
        allowResubmission: a.allowResubmission,
        maximumSubmissions: a.maximumSubmissions,
        allowReopenAfterGrading: a.allowReopenAfterGrading,
        attachmentsCount: attCount,
        hasModelAnswer: Boolean(ma),
        modelAnswerPolicy: (ma?.visibilityPolicy as ModelAnswerVisibilityPolicy) || null,
        modelAnswerManuallyReleased: Boolean(ma?.manuallyReleased),
        stats,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error('Admin homework list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الواجبات' });
  }
});

// Helper to validate academic compatibility & save attachments/targets/model answer
async function validateHomeworkForeignKeys(data: z.infer<typeof homeworkPayloadSchema>) {
  const [grade] = await db.select().from(grades).where(eq(grades.id, data.gradeId)).limit(1);
  const [unit] = data.unitId
    ? await db.select().from(units).where(eq(units.id, data.unitId)).limit(1)
    : [null];
  const [lesson] = data.lessonId
    ? await db.select().from(lessons).where(eq(lessons.id, data.lessonId)).limit(1)
    : [null];
  const [video] = data.videoId
    ? await db.select().from(videos).where(eq(videos.id, data.videoId)).limit(1)
    : [null];
  const [course] = data.courseId
    ? await db.select().from(courses).where(eq(courses.id, data.courseId)).limit(1)
    : [null];

  const compat = validateAcademicCompatibility({
    trackId: data.trackId,
    grade: grade || null,
    unit: unit || null,
    lesson: lesson || null,
    video: video || null,
    course: course || null,
  });
  if (!compat.valid) return { ok: false as const, errorAr: compat.errorAr! };

  const rubricCheck = validateRubricDefinition(data.maximumGrade, data.rubric as RubricCriterion[]);
  if (!rubricCheck.valid) return { ok: false as const, errorAr: rubricCheck.errorAr! };

  const questionsCheck = validateHomeworkQuestions(data.maximumGrade, data.questions || []);
  if (!questionsCheck.valid) return { ok: false as const, errorAr: questionsCheck.errorAr! };

  if (data.assignmentScope === 'COURSE' && !data.courseId) {
    return {
      ok: false as const,
      errorAr: 'يرجى اختيار الكورس المرتبط عند تعيين نطاق الواجب لطلاب كورس محدد.',
    };
  }
  if (data.assignmentScope === 'STUDENTS' && data.targetStudentIds.length === 0) {
    return {
      ok: false as const,
      errorAr: 'يرجى اختيار طالب واحد على الأقل عند تعيين الواجب لطلاب محددين.',
    };
  }
  if (data.assignmentScope === 'GROUP' && data.targetGroupIds.length === 0) {
    return {
      ok: false as const,
      errorAr: 'يرجى اختيار مجموعة واحدة على الأقل عند تعيين الواجب لمجموعة طلابية.',
    };
  }

  // Validate Google Drive URLs in attachments
  const normalizedAttachments: Array<{
    attachmentType: 'FILE' | 'GOOGLE_DRIVE_PDF';
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string | null;
    driveUrl: string | null;
    driveFileId: string | null;
    displayOrder: number;
  }> = [];

  for (let i = 0; i < data.attachments.length; i++) {
    const att = data.attachments[i];
    if (att.attachmentType === 'GOOGLE_DRIVE_PDF') {
      const parsedDrive = extractGoogleDriveFileId(att.driveUrl || '');
      if (!parsedDrive.valid || !parsedDrive.fileId) {
        return {
          ok: false as const,
          errorAr: parsedDrive.errorAr || 'رابط Google Drive في مرفقات الواجب غير صالح.',
        };
      }
      normalizedAttachments.push({
        attachmentType: 'GOOGLE_DRIVE_PDF',
        fileName: att.fileName,
        mimeType: 'application/pdf',
        sizeBytes: 0,
        storageKey: null,
        driveUrl: att.driveUrl!.trim(),
        driveFileId: parsedDrive.fileId,
        displayOrder: att.displayOrder ?? i,
      });
    } else {
      if (!att.storageKey) {
        return { ok: false as const, errorAr: 'مرجع الملف المرفق غير مكتمل.' };
      }
      const [stored] = await db
        .select({ storageKey: homeworkStoredFiles.storageKey, mimeType: homeworkStoredFiles.mimeType, sizeBytes: homeworkStoredFiles.sizeBytes })
        .from(homeworkStoredFiles)
        .where(eq(homeworkStoredFiles.storageKey, att.storageKey))
        .limit(1);
      if (!stored) {
        return { ok: false as const, errorAr: `الملف المرفق (${att.fileName}) غير موجود على الخادم.` };
      }
      normalizedAttachments.push({
        attachmentType: 'FILE',
        fileName: att.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        driveUrl: null,
        driveFileId: null,
        displayOrder: att.displayOrder ?? i,
      });
    }
  }

  // Validate optional modelAnswer
  let normalizedModelAnswer: {
    titleAr: string;
    notesAr: string;
    sourceType: 'UPLOADED_FILES' | 'GOOGLE_DRIVE_PDF' | 'MIXED';
    driveUrl: string | null;
    driveFileId: string | null;
    filesJson: Array<{
      storageKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      displayOrder: number;
    }>;
    visibilityPolicy: ModelAnswerVisibilityPolicy;
    releaseAt: Date | null;
    manuallyReleased: boolean;
  } | null = null;

  if (data.modelAnswer) {
    const ma = data.modelAnswer;
    let driveFileId: string | null = null;
    const trimmedDrive = (ma.driveUrl || '').trim();
    if (trimmedDrive) {
      const parsedDrive = extractGoogleDriveFileId(trimmedDrive);
      if (!parsedDrive.valid || !parsedDrive.fileId) {
        return {
          ok: false as const,
          errorAr: parsedDrive.errorAr || 'رابط Google Drive في نموذج الإجابة غير صالح.',
        };
      }
      driveFileId = parsedDrive.fileId;
    }

    const maFiles = ma.files || [];
    if (maFiles.length > 0) {
      const keys = maFiles.map((f) => f.storageKey);
      const found = await db
        .select({ storageKey: homeworkStoredFiles.storageKey })
        .from(homeworkStoredFiles)
        .where(inArray(homeworkStoredFiles.storageKey, keys));
      if (found.length !== keys.length) {
        return { ok: false as const, errorAr: 'أحد ملفات نموذج الإجابة غير موجود في التخزين الآمن.' };
      }
    }

    if (ma.visibilityPolicy === 'SCHEDULED_RELEASE' && !parseOptionalDate(ma.releaseAt)) {
      return {
        ok: false as const,
        errorAr: 'يرجى تحديد تاريخ ووقت إتاحة نموذج الإجابة عند اختيار النشر المجدول.',
      };
    }

    const hasFiles = maFiles.length > 0;
    const hasDrive = Boolean(driveFileId);
    if (hasFiles || hasDrive || ma.notesAr.trim()) {
      normalizedModelAnswer = {
        titleAr: ma.titleAr || 'نموذج الإجابة',
        notesAr: ma.notesAr || '',
        sourceType: hasFiles && hasDrive ? 'MIXED' : hasDrive ? 'GOOGLE_DRIVE_PDF' : 'UPLOADED_FILES',
        driveUrl: hasDrive ? trimmedDrive : null,
        driveFileId,
        filesJson: maFiles.map((f, idx) => ({ ...f, displayOrder: f.displayOrder ?? idx })),
        visibilityPolicy: ma.visibilityPolicy,
        releaseAt: parseOptionalDate(ma.releaseAt),
        manuallyReleased: Boolean(ma.manuallyReleased),
      };
    }
  }

  return {
    ok: true as const,
    normalizedAttachments,
    normalizedModelAnswer,
    inferredLessonId: data.lessonId ?? video?.lessonId ?? null,
    inferredUnitId: data.unitId ?? lesson?.unitId ?? video?.unitId ?? null,
  };
}

// Create new homework assignment
adminHomeworkRouter.post('/', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = homeworkPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات الواجب غير صالحة',
      });
    }
    const d = parsed.data;

    if (d.publicationStatus === 'SCHEDULED' && !parseOptionalDate(d.publishedAt)) {
      return res.status(400).json({ error: 'يرجى تحديد تاريخ ووقت النشر عند اختيار النشر المجدول.' });
    }

    const validation = await validateHomeworkForeignKeys(d);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errorAr });
    }

    const publishedAt =
      d.publicationStatus === 'PUBLISHED'
        ? parseOptionalDate(d.publishedAt) || new Date()
        : parseOptionalDate(d.publishedAt);
    const deadline = parseOptionalDate(d.deadline);

    const bankSnapRes = await resolveBankQuestionSnapshotsForHomework(d.questions || []);
    if (!bankSnapRes.ok) {
      return res.status(400).json({ error: bankSnapRes.errorAr });
    }

    const created = await db.transaction(async (tx) => {
      const [hw] = await tx
        .insert(homeworkAssignments)
        .values({
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr,
          instructionsAr: d.instructionsAr,
          trackId: d.trackId,
          gradeId: d.gradeId,
          unitId: validation.inferredUnitId,
          lessonId: validation.inferredLessonId,
          videoId: d.videoId ?? null,
          courseId: d.courseId ?? null,
          maximumGrade: String(d.maximumGrade),
          rubricJson: d.rubric,
          assignmentScope: d.assignmentScope,
          publicationStatus: d.publicationStatus,
          publishedAt,
          deadline,
          allowLateSubmission: d.allowLateSubmission,
          allowResubmission: d.allowResubmission,
          maximumSubmissions: d.allowResubmission ? Math.max(1, d.maximumSubmissions) : 1,
          allowReopenAfterGrading: d.allowReopenAfterGrading,
          createdById: req.authUser!.id,
        })
        .returning();

      if (d.assignmentScope === 'STUDENTS' && d.targetStudentIds.length > 0) {
        await tx.insert(homeworkTargets).values(
          Array.from(new Set(d.targetStudentIds)).map((studentId) => ({
            assignmentId: hw.id,
            studentId,
          })),
        );
      } else if (d.assignmentScope === 'GROUP' && d.targetGroupIds.length > 0) {
        await tx.insert(homeworkTargets).values(
          Array.from(new Set(d.targetGroupIds)).map((groupId) => ({
            assignmentId: hw.id,
            groupId,
          })),
        );
      }

      if (validation.normalizedAttachments.length > 0) {
        await tx.insert(homeworkAttachments).values(
          validation.normalizedAttachments.map((att) => ({
            assignmentId: hw.id,
            ...att,
          })),
        );
      }

      if (validation.normalizedModelAnswer) {
        await tx.insert(homeworkModelAnswers).values({
          assignmentId: hw.id,
          ...validation.normalizedModelAnswer,
          manuallyReleasedAt: validation.normalizedModelAnswer.manuallyReleased ? new Date() : null,
        });
      }

      if (d.questions && d.questions.length > 0) {
        await tx.insert(homeworkQuestions).values(
          d.questions.map((q, idx) => {
            const snap = q.bankQuestionId
              ? bankSnapRes.snapshotByBankId.get(q.bankQuestionId)
              : undefined;
            return {
              assignmentId: hw.id,
              bankQuestionId: snap?.bankQuestionId ?? null,
              bankQuestionVersion: snap?.bankQuestionVersion ?? null,
              questionType: snap?.questionType ?? null,
              questionNumber: idx + 1,
              labelAr: q.labelAr.trim(),
              descriptionAr: (q.descriptionAr || '').trim(),
              promptSnapshotAr: snap?.promptSnapshotAr ?? '',
              questionImagesJson: snap?.questionImagesJson ?? [],
              choicesSnapshotJson: snap?.choicesSnapshotJson ?? [],
              modelAnswerTextSnapshot: snap?.modelAnswerTextSnapshot ?? '',
              modelAnswerFilesJson: snap?.modelAnswerFilesJson ?? [],
              maxGrade: String(Number(q.maxGrade.toFixed(2))),
              displayOrder: idx,
            };
          }),
        );
      }

      return hw;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_CREATED',
      entityType: 'homework_assignment',
      entityId: created.id,
      details: {
        titleAr: created.titleAr,
        scope: created.assignmentScope,
        status: created.publicationStatus,
        videoId: created.videoId,
      },
    });

    if (created.publicationStatus === 'PUBLISHED') {
      await createNotification({
        gradeId: created.gradeId,
        titleAr: `واجب جديد: ${created.titleAr}`,
        bodyAr: deadline
          ? `تم نشر واجب جديد في الفيزياء. يرجى تسليم الحل قبل ${deadline.toLocaleDateString('ar-EG')}.`
          : 'تم نشر واجب جديد في الفيزياء. يمكنك فتحه وتسليم الحل من قسم «واجباتي».',
        type: 'GENERAL',
        targetType: 'HOMEWORK',
        targetId: created.id,
      });
    }

    return res.status(201).json({
      id: created.id,
      message: 'تم إنشاء الواجب بنجاح',
    });
  } catch (err) {
    console.error('Admin homework create error:', err);
    return res.status(500).json({ error: 'تعذر إنشاء الواجب' });
  }
});

// Get full single homework detail for admin (edit / preview / model answer / stats)
adminHomeworkRouter.get(
  '/:id',
  requirePermission([PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE]),
  async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الواجب غير صالح' });
    }

    const [a] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!a) return res.status(404).json({ error: 'الواجب غير موجود' });

    const [
      [track],
      [grade],
      [unit],
      [lesson],
      [video],
      [course],
      targets,
      attachments,
      [modelAnswer],
      subs,
      targetedStudents,
      questionMeta,
    ] = await Promise.all([
      db.select().from(academicTracks).where(eq(academicTracks.id, a.trackId)).limit(1),
      db.select().from(grades).where(eq(grades.id, a.gradeId)).limit(1),
      a.unitId ? db.select().from(units).where(eq(units.id, a.unitId)).limit(1) : Promise.resolve([null]),
      a.lessonId ? db.select().from(lessons).where(eq(lessons.id, a.lessonId)).limit(1) : Promise.resolve([null]),
      a.videoId ? db.select().from(videos).where(eq(videos.id, a.videoId)).limit(1) : Promise.resolve([null]),
      a.courseId ? db.select().from(courses).where(eq(courses.id, a.courseId)).limit(1) : Promise.resolve([null]),
      db.select().from(homeworkTargets).where(eq(homeworkTargets.assignmentId, id)),
      db
        .select()
        .from(homeworkAttachments)
        .where(eq(homeworkAttachments.assignmentId, id))
        .orderBy(asc(homeworkAttachments.displayOrder), asc(homeworkAttachments.id)),
      db.select().from(homeworkModelAnswers).where(eq(homeworkModelAnswers.assignmentId, id)).limit(1),
      db.select().from(homeworkSubmissions).where(eq(homeworkSubmissions.assignmentId, id)),
      getTargetedStudentsForAssignment(a),
      loadAssignmentQuestions(id, req.authUser, { includeModelAnswers: true }),
    ]);

    const latestByStudent = new Map<number, (typeof subs)[number]>();
    for (const s of subs) {
      const prev = latestByStudent.get(s.studentId);
      if (!prev || s.version > prev.version) latestByStudent.set(s.studentId, s);
    }

    const stats = computeHomeworkStatistics({
      totalAssignedStudents: targetedStudents.length,
      latestSubmissionsByStudent: Array.from(latestByStudent.values()).map((s) => ({
        status: s.status,
        isLate: s.isLate,
        isGradePublished: s.isGradePublished,
        awardedGrade: s.awardedGrade !== null ? Number(s.awardedGrade) : null,
      })),
    });

    const uid = req.authUser!.id;
    const roleSlug = req.authUser!.roleSlug;

    return res.json({
      id: a.id,
      titleAr: a.titleAr,
      descriptionAr: a.descriptionAr,
      instructionsAr: a.instructionsAr,
      trackId: a.trackId,
      trackNameAr: track?.nameAr || '',
      gradeId: a.gradeId,
      gradeNameAr: grade?.nameAr || '',
      unitId: a.unitId,
      unitTitleAr: unit?.titleAr || null,
      lessonId: a.lessonId,
      lessonTitleAr: lesson?.titleAr || null,
      videoId: a.videoId,
      videoTitleAr: video?.titleAr || null,
      courseId: a.courseId,
      courseTitleAr: course?.titleAr || null,
      maximumGrade: Number(a.maximumGrade),
      rubric: a.rubricJson || [],
      questions: questionMeta.questions,
      assignmentScope: a.assignmentScope,
      publicationStatus: a.publicationStatus,
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
      deadline: a.deadline ? a.deadline.toISOString() : null,
      allowLateSubmission: a.allowLateSubmission,
      allowResubmission: a.allowResubmission,
      maximumSubmissions: a.maximumSubmissions,
      allowReopenAfterGrading: a.allowReopenAfterGrading,
      targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
      targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
      attachmentsCount: attachments.length,
      attachments: attachments.map((att) => ({
        id: att.id,
        attachmentType: att.attachmentType,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        storageKey: att.storageKey,
        driveUrl: att.driveUrl,
        driveFileId: att.driveFileId,
        previewUrl:
          att.attachmentType === 'GOOGLE_DRIVE_PDF' && att.driveFileId
            ? buildGoogleDrivePreviewUrl(att.driveFileId)
            : att.storageKey
              ? buildSignedFileUrl(att.storageKey, uid, roleSlug)
              : null,
        viewUrl:
          att.attachmentType === 'GOOGLE_DRIVE_PDF' && att.driveFileId
            ? buildGoogleDriveViewUrl(att.driveFileId)
            : att.storageKey
              ? buildSignedFileUrl(att.storageKey, uid, roleSlug)
              : null,
        displayOrder: att.displayOrder,
      })),
      hasModelAnswer: Boolean(modelAnswer),
      modelAnswerPolicy: (modelAnswer?.visibilityPolicy as ModelAnswerVisibilityPolicy) || null,
      modelAnswerManuallyReleased: Boolean(modelAnswer?.manuallyReleased),
      modelAnswer: modelAnswer
        ? {
            id: modelAnswer.id,
            titleAr: modelAnswer.titleAr,
            notesAr: modelAnswer.notesAr,
            sourceType: modelAnswer.sourceType,
            driveUrl: modelAnswer.driveUrl,
            driveFileId: modelAnswer.driveFileId,
            drivePreviewUrl: modelAnswer.driveFileId
              ? buildGoogleDrivePreviewUrl(modelAnswer.driveFileId)
              : null,
            driveViewUrl: modelAnswer.driveFileId
              ? buildGoogleDriveViewUrl(modelAnswer.driveFileId)
              : null,
            files: (modelAnswer.filesJson || []).map((f) => ({
              ...f,
              previewUrl: buildSignedFileUrl(f.storageKey, uid, roleSlug),
            })),
            visibilityPolicy: modelAnswer.visibilityPolicy,
            releaseAt: modelAnswer.releaseAt ? modelAnswer.releaseAt.toISOString() : null,
            manuallyReleased: modelAnswer.manuallyReleased,
            manuallyReleasedAt: modelAnswer.manuallyReleasedAt
              ? modelAnswer.manuallyReleasedAt.toISOString()
              : null,
          }
        : null,
      stats,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error('Admin homework get error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الواجب' });
  }
});

// Update existing homework assignment
adminHomeworkRouter.put('/:id', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الواجب غير صالح' });
    }

    const [existing] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'الواجب غير موجود' });

    const parsed = homeworkPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات الواجب غير صالحة',
      });
    }
    const d = parsed.data;

    if (d.publicationStatus === 'SCHEDULED' && !parseOptionalDate(d.publishedAt)) {
      return res.status(400).json({ error: 'يرجى تحديد تاريخ ووقت النشر عند اختيار النشر المجدول.' });
    }

    const validation = await validateHomeworkForeignKeys(d);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errorAr });
    }

    // Protect existing student question grades when editing question structure
    const hasQuestionsField = req.body && Object.prototype.hasOwnProperty.call(req.body, 'questions');
    const existingQuestionMeta = await loadAssignmentQuestions(id);
    if (hasQuestionsField) {
      const structCheck = validateQuestionStructureUpdate({
        existingQuestions: existingQuestionMeta.questions,
        incomingQuestions: d.questions || [],
        gradedQuestionMaxAwardedMap: existingQuestionMeta.gradedMaxMap,
      });
      if (!structCheck.valid) {
        return res.status(409).json({ error: structCheck.errorAr });
      }
    }

    const bankSnapRes = hasQuestionsField
      ? await resolveBankQuestionSnapshotsForHomework(
          (d.questions || []).filter((q) => !q.id && Boolean(q.bankQuestionId)),
        )
      : { ok: true as const, snapshotByBankId: new Map() };
    if (!bankSnapRes.ok) {
      return res.status(400).json({ error: bankSnapRes.errorAr });
    }

    const publishedAt =
      d.publicationStatus === 'PUBLISHED'
        ? parseOptionalDate(d.publishedAt) || existing.publishedAt || new Date()
        : parseOptionalDate(d.publishedAt);

    await db.transaction(async (tx) => {
      await tx
        .update(homeworkAssignments)
        .set({
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr,
          instructionsAr: d.instructionsAr,
          trackId: d.trackId,
          gradeId: d.gradeId,
          unitId: validation.inferredUnitId,
          lessonId: validation.inferredLessonId,
          videoId: d.videoId ?? null,
          courseId: d.courseId ?? null,
          maximumGrade: String(d.maximumGrade),
          rubricJson: d.rubric,
          assignmentScope: d.assignmentScope,
          publicationStatus: d.publicationStatus,
          publishedAt,
          deadline: parseOptionalDate(d.deadline),
          allowLateSubmission: d.allowLateSubmission,
          allowResubmission: d.allowResubmission,
          maximumSubmissions: d.allowResubmission ? Math.max(1, d.maximumSubmissions) : 1,
          allowReopenAfterGrading: d.allowReopenAfterGrading,
          updatedAt: new Date(),
        })
        .where(eq(homeworkAssignments.id, id));

      await tx.delete(homeworkTargets).where(eq(homeworkTargets.assignmentId, id));
      if (d.assignmentScope === 'STUDENTS' && d.targetStudentIds.length > 0) {
        await tx.insert(homeworkTargets).values(
          Array.from(new Set(d.targetStudentIds)).map((studentId) => ({
            assignmentId: id,
            studentId,
          })),
        );
      } else if (d.assignmentScope === 'GROUP' && d.targetGroupIds.length > 0) {
        await tx.insert(homeworkTargets).values(
          Array.from(new Set(d.targetGroupIds)).map((groupId) => ({
            assignmentId: id,
            groupId,
          })),
        );
      }

      await tx.delete(homeworkAttachments).where(eq(homeworkAttachments.assignmentId, id));
      if (validation.normalizedAttachments.length > 0) {
        await tx.insert(homeworkAttachments).values(
          validation.normalizedAttachments.map((att) => ({
            assignmentId: id,
            ...att,
          })),
        );
      }

      if (hasQuestionsField) {
        const existingIdSet = new Set(existingQuestionMeta.questions.map((q) => q.id));
        const incomingKeptIds = new Set(
          (d.questions || [])
            .map((q) => q.id)
            .filter((qid): qid is number => Boolean(qid && existingIdSet.has(qid))),
        );
        const idsToDelete = existingQuestionMeta.questions
          .map((q) => q.id)
          .filter((qid) => !incomingKeptIds.has(qid));

        if (idsToDelete.length > 0) {
          await tx
            .delete(homeworkQuestions)
            .where(inArray(homeworkQuestions.id, idsToDelete));
        }

        for (let idx = 0; idx < (d.questions || []).length; idx++) {
          const q = d.questions[idx];
          if (q.id && existingIdSet.has(q.id)) {
            await tx
              .update(homeworkQuestions)
              .set({
                questionNumber: idx + 1,
                labelAr: q.labelAr.trim(),
                descriptionAr: (q.descriptionAr || '').trim(),
                maxGrade: String(Number(q.maxGrade.toFixed(2))),
                displayOrder: idx,
                updatedAt: new Date(),
              })
              .where(eq(homeworkQuestions.id, q.id));
          } else {
            const snap = q.bankQuestionId
              ? bankSnapRes.snapshotByBankId.get(q.bankQuestionId)
              : undefined;
            await tx.insert(homeworkQuestions).values({
              assignmentId: id,
              bankQuestionId: snap?.bankQuestionId ?? null,
              bankQuestionVersion: snap?.bankQuestionVersion ?? null,
              questionType: snap?.questionType ?? null,
              questionNumber: idx + 1,
              labelAr: q.labelAr.trim(),
              descriptionAr: (q.descriptionAr || '').trim(),
              promptSnapshotAr: snap?.promptSnapshotAr ?? '',
              questionImagesJson: snap?.questionImagesJson ?? [],
              choicesSnapshotJson: snap?.choicesSnapshotJson ?? [],
              modelAnswerTextSnapshot: snap?.modelAnswerTextSnapshot ?? '',
              modelAnswerFilesJson: snap?.modelAnswerFilesJson ?? [],
              maxGrade: String(Number(q.maxGrade.toFixed(2))),
              displayOrder: idx,
            });
          }
        }
      }

      if (d.modelAnswer !== undefined) {
        if (validation.normalizedModelAnswer) {
          const [existingMa] = await tx
            .select()
            .from(homeworkModelAnswers)
            .where(eq(homeworkModelAnswers.assignmentId, id))
            .limit(1);
          if (existingMa) {
            await tx
              .update(homeworkModelAnswers)
              .set({
                ...validation.normalizedModelAnswer,
                manuallyReleasedAt: validation.normalizedModelAnswer.manuallyReleased
                  ? existingMa.manuallyReleasedAt || new Date()
                  : null,
                updatedAt: new Date(),
              })
              .where(eq(homeworkModelAnswers.id, existingMa.id));
          } else {
            await tx.insert(homeworkModelAnswers).values({
              assignmentId: id,
              ...validation.normalizedModelAnswer,
              manuallyReleasedAt: validation.normalizedModelAnswer.manuallyReleased ? new Date() : null,
            });
          }
        } else if (d.modelAnswer === null) {
          await tx.delete(homeworkModelAnswers).where(eq(homeworkModelAnswers.assignmentId, id));
        }
      }
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_UPDATED',
      entityType: 'homework_assignment',
      entityId: id,
      details: { titleAr: d.titleAr, status: d.publicationStatus },
    });

    return res.json({ message: 'تم تحديث بيانات الواجب بنجاح' });
  } catch (err) {
    console.error('Admin homework update error:', err);
    return res.status(500).json({ error: 'تعذر تحديث الواجب' });
  }
});

// Configure or update assignment-level question breakdown directly from grading screen
adminHomeworkRouter.put('/:id/questions', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الواجب غير صالح' });
    }

    const [existing] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'الواجب غير موجود' });

    const schema = z.object({
      questions: z.array(questionDefinitionSchema).max(50),
      maximumGrade: z.coerce.number().positive().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات توزيع الأسئلة غير صالحة',
      });
    }

    const currentMax = Number(existing.maximumGrade);
    let targetMax = currentMax;

    if (
      parsed.data.maximumGrade !== undefined &&
      Math.abs(parsed.data.maximumGrade - currentMax) > 0.001
    ) {
      const gradedSubs = await db
        .select({ id: homeworkSubmissions.id, awardedGrade: homeworkSubmissions.awardedGrade })
        .from(homeworkSubmissions)
        .where(eq(homeworkSubmissions.assignmentId, id));
      if (gradedSubs.some((s) => s.awardedGrade !== null)) {
        return res.status(409).json({
          error: `لا يمكن تغيير الدرجة النهائية للواجب (${currentMax}) بعد وجود درجات محفوظة للطلاب؛ يرجى ضبط مجموع درجات الأسئلة ليتطابق مع ${currentMax}.`,
        });
      }
      targetMax = Number(parsed.data.maximumGrade.toFixed(2));
    }

    const qCheck = validateHomeworkQuestions(targetMax, parsed.data.questions);
    if (!qCheck.valid) {
      return res.status(400).json({ error: qCheck.errorAr });
    }

    const existingQuestionMeta = await loadAssignmentQuestions(id);
    const structCheck = validateQuestionStructureUpdate({
      existingQuestions: existingQuestionMeta.questions,
      incomingQuestions: parsed.data.questions,
      gradedQuestionMaxAwardedMap: existingQuestionMeta.gradedMaxMap,
    });
    if (!structCheck.valid) {
      return res.status(409).json({ error: structCheck.errorAr });
    }

    const bankSnapRes = await resolveBankQuestionSnapshotsForHomework(
      parsed.data.questions.filter((q) => !q.id && Boolean(q.bankQuestionId)),
    );
    if (!bankSnapRes.ok) {
      return res.status(400).json({ error: bankSnapRes.errorAr });
    }

    await db.transaction(async (tx) => {
      if (Math.abs(targetMax - currentMax) > 0.001) {
        await tx
          .update(homeworkAssignments)
          .set({ maximumGrade: String(targetMax), updatedAt: new Date() })
          .where(eq(homeworkAssignments.id, id));
      }

      const existingIdSet = new Set(existingQuestionMeta.questions.map((q) => q.id));
      const incomingKeptIds = new Set(
        parsed.data.questions
          .map((q) => q.id)
          .filter((qid): qid is number => Boolean(qid && existingIdSet.has(qid))),
      );
      const idsToDelete = existingQuestionMeta.questions
        .map((q) => q.id)
        .filter((qid) => !incomingKeptIds.has(qid));

      if (idsToDelete.length > 0) {
        await tx
          .delete(homeworkQuestions)
          .where(inArray(homeworkQuestions.id, idsToDelete));
      }

      for (let idx = 0; idx < parsed.data.questions.length; idx++) {
        const q = parsed.data.questions[idx];
        if (q.id && existingIdSet.has(q.id)) {
          await tx
            .update(homeworkQuestions)
            .set({
              questionNumber: idx + 1,
              labelAr: q.labelAr.trim(),
              descriptionAr: (q.descriptionAr || '').trim(),
              maxGrade: String(Number(q.maxGrade.toFixed(2))),
              displayOrder: idx,
              updatedAt: new Date(),
            })
            .where(eq(homeworkQuestions.id, q.id));
        } else {
          const snap = q.bankQuestionId
            ? bankSnapRes.snapshotByBankId.get(q.bankQuestionId)
            : undefined;
          await tx.insert(homeworkQuestions).values({
            assignmentId: id,
            bankQuestionId: snap?.bankQuestionId ?? null,
            bankQuestionVersion: snap?.bankQuestionVersion ?? null,
            questionType: snap?.questionType ?? null,
            questionNumber: idx + 1,
            labelAr: q.labelAr.trim(),
            descriptionAr: (q.descriptionAr || '').trim(),
            promptSnapshotAr: snap?.promptSnapshotAr ?? '',
            questionImagesJson: snap?.questionImagesJson ?? [],
            choicesSnapshotJson: snap?.choicesSnapshotJson ?? [],
            modelAnswerTextSnapshot: snap?.modelAnswerTextSnapshot ?? '',
            modelAnswerFilesJson: snap?.modelAnswerFilesJson ?? [],
            maxGrade: String(Number(q.maxGrade.toFixed(2))),
            displayOrder: idx,
          });
        }
      }
    });

    const refreshed = await loadAssignmentQuestions(id, req.authUser, { includeModelAnswers: true });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_QUESTIONS_UPDATED',
      entityType: 'homework_assignment',
      entityId: id,
      details: { questionsCount: refreshed.questions.length, maximumGrade: targetMax },
    });

    return res.json({
      maximumGrade: targetMax,
      questions: refreshed.questions,
      message: 'تم حفظ توزيع درجات الأسئلة للواجب بنجاح',
    });
  } catch (err) {
    console.error('Admin homework questions update error:', err);
    return res.status(500).json({ error: 'تعذر حفظ توزيع درجات الأسئلة' });
  }
});

// Duplicate homework assignment safely as DRAFT
adminHomeworkRouter.post('/:id/duplicate', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [orig] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!orig) return res.status(404).json({ error: 'الواجب الأصلي غير موجود' });

    const [origTargets, origAttachments, [origMa], origQuestions] = await Promise.all([
      db.select().from(homeworkTargets).where(eq(homeworkTargets.assignmentId, id)),
      db.select().from(homeworkAttachments).where(eq(homeworkAttachments.assignmentId, id)),
      db.select().from(homeworkModelAnswers).where(eq(homeworkModelAnswers.assignmentId, id)).limit(1),
      db
        .select()
        .from(homeworkQuestions)
        .where(eq(homeworkQuestions.assignmentId, id))
        .orderBy(asc(homeworkQuestions.displayOrder), asc(homeworkQuestions.questionNumber)),
    ]);

    const duplicated = await db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(homeworkAssignments)
        .values({
          titleAr: `${orig.titleAr} (نسخة)`,
          descriptionAr: orig.descriptionAr,
          instructionsAr: orig.instructionsAr,
          trackId: orig.trackId,
          gradeId: orig.gradeId,
          unitId: orig.unitId,
          lessonId: orig.lessonId,
          videoId: orig.videoId,
          courseId: orig.courseId,
          maximumGrade: orig.maximumGrade,
          rubricJson: orig.rubricJson,
          assignmentScope: orig.assignmentScope,
          publicationStatus: 'DRAFT',
          publishedAt: null,
          deadline: orig.deadline,
          allowLateSubmission: orig.allowLateSubmission,
          allowResubmission: orig.allowResubmission,
          maximumSubmissions: orig.maximumSubmissions,
          allowReopenAfterGrading: orig.allowReopenAfterGrading,
          createdById: req.authUser!.id,
        })
        .returning();

      if (origTargets.length > 0) {
        await tx.insert(homeworkTargets).values(
          origTargets.map((t) => ({
            assignmentId: copy.id,
            studentId: t.studentId,
            groupId: t.groupId,
          })),
        );
      }

      if (origAttachments.length > 0) {
        await tx.insert(homeworkAttachments).values(
          origAttachments.map((att) => ({
            assignmentId: copy.id,
            attachmentType: att.attachmentType,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            storageKey: att.storageKey,
            driveUrl: att.driveUrl,
            driveFileId: att.driveFileId,
            displayOrder: att.displayOrder,
          })),
        );
      }

      if (origQuestions.length > 0) {
        await tx.insert(homeworkQuestions).values(
          origQuestions.map((q) => ({
            assignmentId: copy.id,
            bankQuestionId: q.bankQuestionId,
            bankQuestionVersion: q.bankQuestionVersion,
            questionType: q.questionType,
            questionNumber: q.questionNumber,
            labelAr: q.labelAr,
            descriptionAr: q.descriptionAr,
            promptSnapshotAr: q.promptSnapshotAr,
            questionImagesJson: q.questionImagesJson,
            choicesSnapshotJson: q.choicesSnapshotJson,
            modelAnswerTextSnapshot: q.modelAnswerTextSnapshot,
            modelAnswerFilesJson: q.modelAnswerFilesJson,
            maxGrade: q.maxGrade,
            displayOrder: q.displayOrder,
          })),
        );
      }

      if (origMa) {
        await tx.insert(homeworkModelAnswers).values({
          assignmentId: copy.id,
          titleAr: origMa.titleAr,
          notesAr: origMa.notesAr,
          sourceType: origMa.sourceType,
          driveUrl: origMa.driveUrl,
          driveFileId: origMa.driveFileId,
          filesJson: origMa.filesJson,
          visibilityPolicy: 'HIDDEN',
          releaseAt: null,
          manuallyReleased: false,
        });
      }

      return copy;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_DUPLICATED',
      entityType: 'homework_assignment',
      entityId: duplicated.id,
      details: { sourceId: id },
    });

    return res.status(201).json({
      id: duplicated.id,
      message: 'تم نسخ الواجب كمسودة بنجاح',
    });
  } catch (err) {
    console.error('Admin homework duplicate error:', err);
    return res.status(500).json({ error: 'تعذر نسخ الواجب' });
  }
});

// Quick status update (Publish / Schedule / Hide / Archive / Draft)
adminHomeworkRouter.patch('/:id/status', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      publicationStatus: z.enum(PUBLICATION_STATUSES),
      publishedAt: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'حالة النشر غير صالحة' });

    const [existing] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'الواجب غير موجود' });

    if (parsed.data.publicationStatus === 'SCHEDULED' && !parseOptionalDate(parsed.data.publishedAt)) {
      return res.status(400).json({ error: 'يرجى تحديد تاريخ ووقت النشر المجدول' });
    }

    const nextPublishedAt =
      parsed.data.publicationStatus === 'PUBLISHED'
        ? parseOptionalDate(parsed.data.publishedAt) || existing.publishedAt || new Date()
        : parseOptionalDate(parsed.data.publishedAt) ?? existing.publishedAt;

    await db
      .update(homeworkAssignments)
      .set({
        publicationStatus: parsed.data.publicationStatus,
        publishedAt: nextPublishedAt,
        updatedAt: new Date(),
      })
      .where(eq(homeworkAssignments.id, id));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_STATUS_CHANGED',
      entityType: 'homework_assignment',
      entityId: id,
      details: { from: existing.publicationStatus, to: parsed.data.publicationStatus },
    });

    return res.json({ message: 'تم تحديث حالة الواجب بنجاح' });
  } catch (err) {
    console.error('Admin homework status error:', err);
    return res.status(500).json({ error: 'تعذر تحديث حالة الواجب' });
  }
});

// Safe Delete (Blocked if submissions exist — must archive instead)
adminHomeworkRouter.delete('/:id', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'الواجب غير موجود' });

    const subs = await db
      .select({ id: homeworkSubmissions.id })
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.assignmentId, id))
      .limit(1);

    if (subs.length > 0) {
      return res.status(409).json({
        error:
          'لا يمكن حذف هذا الواجب نهائيًا لوجود تسليمات أو سجل درجات مرتبط به. استخدم خيار «أرشفة الواجب» للحفاظ على تاريخ الطلاب.',
      });
    }

    await db.delete(homeworkAssignments).where(eq(homeworkAssignments.id, id));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_DELETED',
      entityType: 'homework_assignment',
      entityId: id,
      details: { titleAr: existing.titleAr },
    });

    return res.json({ message: 'تم حذف الواجب غير المستخدم نهائيًا بنجاح' });
  } catch (err) {
    console.error('Admin homework delete error:', err);
    return res.status(500).json({ error: 'تعذر حذف الواجب' });
  }
});

// Configure / Replace Model Answer
adminHomeworkRouter.put('/:id/model-answer', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'الواجب غير موجود' });

    const parsed = modelAnswerInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات نموذج الإجابة غير صالحة' });
    }
    const ma = parsed.data;

    let driveFileId: string | null = null;
    const trimmedDrive = (ma.driveUrl || '').trim();
    if (trimmedDrive) {
      const parsedDrive = extractGoogleDriveFileId(trimmedDrive);
      if (!parsedDrive.valid || !parsedDrive.fileId) {
        return res.status(400).json({ error: parsedDrive.errorAr || 'رابط Google Drive غير صالح' });
      }
      driveFileId = parsedDrive.fileId;
    }

    if (ma.files.length > 0) {
      const keys = ma.files.map((f) => f.storageKey);
      const found = await db
        .select({ storageKey: homeworkStoredFiles.storageKey })
        .from(homeworkStoredFiles)
        .where(inArray(homeworkStoredFiles.storageKey, keys));
      if (found.length !== keys.length) {
        return res.status(400).json({ error: 'بعض ملفات نموذج الإجابة غير موجودة على الخادم' });
      }
    }

    if (ma.files.length === 0 && !driveFileId && !ma.notesAr.trim()) {
      return res.status(400).json({
        error: 'يرجى رفع ملف PDF أو صور أو إدخال رابط Google Drive أو ملاحظات لنموذج الإجابة.',
      });
    }

    const releaseAt = parseOptionalDate(ma.releaseAt);
    if (ma.visibilityPolicy === 'SCHEDULED_RELEASE' && !releaseAt) {
      return res.status(400).json({
        error: 'يرجى تحديد تاريخ ووقت إتاحة نموذج الإجابة عند اختيار الإتاحة المجدولة.',
      });
    }

    const sourceType =
      ma.files.length > 0 && driveFileId
        ? 'MIXED'
        : driveFileId
          ? 'GOOGLE_DRIVE_PDF'
          : 'UPLOADED_FILES';

    const [currentMa] = await db
      .select()
      .from(homeworkModelAnswers)
      .where(eq(homeworkModelAnswers.assignmentId, id))
      .limit(1);

    if (currentMa) {
      await db
        .update(homeworkModelAnswers)
        .set({
          titleAr: ma.titleAr,
          notesAr: ma.notesAr,
          sourceType,
          driveUrl: driveFileId ? trimmedDrive : null,
          driveFileId,
          filesJson: ma.files,
          visibilityPolicy: ma.visibilityPolicy,
          releaseAt,
          manuallyReleased: ma.manuallyReleased,
          manuallyReleasedAt: ma.manuallyReleased ? currentMa.manuallyReleasedAt || new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(homeworkModelAnswers.id, currentMa.id));
    } else {
      await db.insert(homeworkModelAnswers).values({
        assignmentId: id,
        titleAr: ma.titleAr,
        notesAr: ma.notesAr,
        sourceType,
        driveUrl: driveFileId ? trimmedDrive : null,
        driveFileId,
        filesJson: ma.files,
        visibilityPolicy: ma.visibilityPolicy,
        releaseAt,
        manuallyReleased: ma.manuallyReleased,
        manuallyReleasedAt: ma.manuallyReleased ? new Date() : null,
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_MODEL_ANSWER_SAVED',
      entityType: 'homework_assignment',
      entityId: id,
      details: { visibilityPolicy: ma.visibilityPolicy, manuallyReleased: ma.manuallyReleased },
    });

    return res.json({ message: 'تم حفظ إعدادات نموذج الإجابة بنجاح' });
  } catch (err) {
    console.error('Admin save model answer error:', err);
    return res.status(500).json({ error: 'تعذر حفظ نموذج الإجابة' });
  }
});

// Toggle Manual Model Answer Release
adminHomeworkRouter.patch('/:id/model-answer/release', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const manuallyReleased = Boolean(req.body?.manuallyReleased);

    const [ma] = await db
      .select()
      .from(homeworkModelAnswers)
      .where(eq(homeworkModelAnswers.assignmentId, id))
      .limit(1);
    if (!ma) return res.status(404).json({ error: 'لا يوجد نموذج إجابة محفوظ لهذا الواجب' });

    await db
      .update(homeworkModelAnswers)
      .set({
        manuallyReleased,
        manuallyReleasedAt: manuallyReleased ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(homeworkModelAnswers.id, ma.id));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: manuallyReleased ? 'MODEL_ANSWER_RELEASED' : 'MODEL_ANSWER_HIDDEN',
      entityType: 'homework_assignment',
      entityId: id,
    });

    return res.json({
      manuallyReleased,
      message: manuallyReleased ? 'تمت إتاحة نموذج الإجابة للطلاب' : 'تم إيقاف الإتاحة اليدوية لنموذج الإجابة',
    });
  } catch (err) {
    console.error('Toggle model answer release error:', err);
    return res.status(500).json({ error: 'تعذر تحديث حالة إتاحة نموذج الإجابة' });
  }
});

// Remove Model Answer
adminHomeworkRouter.delete('/:id/model-answer', requirePermission(PERMISSIONS.HOMEWORK_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(homeworkModelAnswers).where(eq(homeworkModelAnswers.assignmentId, id));
    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'HOMEWORK_MODEL_ANSWER_REMOVED',
      entityType: 'homework_assignment',
      entityId: id,
    });
    return res.json({ message: 'تم إزالة نموذج الإجابة من الواجب' });
  } catch (err) {
    console.error('Delete model answer error:', err);
    return res.status(500).json({ error: 'تعذر حذف نموذج الإجابة' });
  }
});

// List Submissions + Non-Submitters + Assignment Statistics
adminHomeworkRouter.get(
  '/:id/submissions',
  requirePermission([PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE]),
  async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filter = String(req.query.filter || 'ALL').toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const [assignment] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });

    const [[track], [grade], targetedStudents, allSubs, allFiles, questionMeta] = await Promise.all([
      db.select().from(academicTracks).where(eq(academicTracks.id, assignment.trackId)).limit(1),
      db.select().from(grades).where(eq(grades.id, assignment.gradeId)).limit(1),
      getTargetedStudentsForAssignment(assignment),
      db
        .select()
        .from(homeworkSubmissions)
        .where(eq(homeworkSubmissions.assignmentId, id))
        .orderBy(desc(homeworkSubmissions.version)),
      db.select().from(homeworkSubmissionFiles),
      loadAssignmentQuestions(id, req.authUser, { includeModelAnswers: true }),
    ]);

    const fileCountBySub = new Map<number, number>();
    for (const f of allFiles) {
      fileCountBySub.set(f.submissionId, (fileCountBySub.get(f.submissionId) || 0) + 1);
    }

    // Group submissions by student
    const subsByStudent = new Map<number, typeof allSubs>();
    for (const s of allSubs) {
      const list = subsByStudent.get(s.studentId) || [];
      list.push(s);
      subsByStudent.set(s.studentId, list);
    }

    // Ensure every student who submitted is included even if later removed from group/scope
    const studentMap = new Map(targetedStudents.map((s) => [s.id, s]));
    const extraStudentIds = Array.from(subsByStudent.keys()).filter((sid) => !studentMap.has(sid));
    if (extraStudentIds.length > 0) {
      const extras = await db
        .select({ id: users.id, fullName: users.fullName, phone: users.phone })
        .from(users)
        .where(inArray(users.id, extraStudentIds));
      for (const e of extras) {
        studentMap.set(e.id, { ...e, gradeId: assignment.gradeId });
      }
    }

    const rows = Array.from(studentMap.values()).map((student) => {
      const sList = (subsByStudent.get(student.id) || []).sort((a, b) => b.version - a.version);
      const realSubs = sList.filter((s) => s.status !== 'DRAFT');
      const latest = realSubs[0] || sList[0] || null;
      const hasSubmitted = realSubs.length > 0;
      const rowStatus = latest ? latest.status : 'NOT_SUBMITTED';

      return {
        studentId: student.id,
        studentName: student.fullName,
        studentPhone: student.phone,
        trackNameAr: track?.nameAr || '',
        gradeNameAr: grade?.nameAr || '',
        hasSubmitted,
        latestSubmissionId: latest?.id ?? null,
        latestVersion: latest?.version ?? 0,
        versionsCount: realSubs.length,
        attachmentsCount: latest ? fileCountBySub.get(latest.id) || 0 : 0,
        submittedAt: latest?.submittedAt ? latest.submittedAt.toISOString() : null,
        isLate: Boolean(latest?.isLate),
        status: rowStatus,
        statusLabelAr: getAdminSubmissionStatusLabelAr(rowStatus, Boolean(latest?.isGradePublished)),
        awardedGrade: latest?.awardedGrade !== null && latest?.awardedGrade !== undefined ? Number(latest.awardedGrade) : null,
        isGradePublished: Boolean(latest?.isGradePublished),
        teacherFeedback: latest?.teacherFeedback || '',
      };
    });

    const stats = computeHomeworkStatistics({
      totalAssignedStudents: targetedStudents.length,
      latestSubmissionsByStudent: rows
        .filter((r) => r.hasSubmitted)
        .map((r) => ({
          status: r.status,
          isLate: r.isLate,
          isGradePublished: r.isGradePublished,
          awardedGrade: r.awardedGrade,
        })),
    });

    const filteredRows = rows.filter((r) => {
      if (search && !r.studentName.toLowerCase().includes(search) && !(r.studentPhone || '').includes(search)) {
        return false;
      }
      switch (filter) {
        case 'NOT_SUBMITTED':
          return !r.hasSubmitted;
        case 'SUBMITTED':
          return r.hasSubmitted;
        case 'LATE':
          return r.hasSubmitted && r.isLate;
        case 'AWAITING_REVIEW':
          return (
            r.status === 'SUBMITTED' ||
            r.status === 'SUBMITTED_LATE' ||
            r.status === 'UNDER_REVIEW' ||
            (r.status === 'GRADED' && !r.isGradePublished)
          );
        case 'GRADED':
          return r.status === 'GRADED' && r.isGradePublished;
        case 'RETURNED':
          return r.status === 'RETURNED_FOR_REVISION';
        default:
          return true;
      }
    });

    return res.json({
      assignment: {
        id: assignment.id,
        titleAr: assignment.titleAr,
        maximumGrade: Number(assignment.maximumGrade),
        rubric: assignment.rubricJson || [],
        questions: questionMeta.questions,
        deadline: assignment.deadline ? assignment.deadline.toISOString() : null,
      },
      stats,
      rows: filteredRows,
    });
  } catch (err) {
    console.error('Admin homework submissions list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تسليمات الواجب' });
  }
});

// Get all submission versions for a student on a specific assignment (for teacher grading & comparison)
adminHomeworkRouter.get(
  '/:id/submissions/:studentId',
  requirePermission([PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_MANAGE, PERMISSIONS.HOMEWORK_GRADE]),
  async (req: AuthRequest, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const studentId = Number(req.params.studentId);

    const [[assignment], [student]] = await Promise.all([
      db.select().from(homeworkAssignments).where(eq(homeworkAssignments.id, assignmentId)).limit(1),
      db
        .select({ id: users.id, fullName: users.fullName, phone: users.phone, email: users.email })
        .from(users)
        .where(eq(users.id, studentId))
        .limit(1),
    ]);

    if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });
    if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });

    const [subs, questionMeta] = await Promise.all([
      db
        .select()
        .from(homeworkSubmissions)
        .where(
          and(
            eq(homeworkSubmissions.assignmentId, assignmentId),
            eq(homeworkSubmissions.studentId, studentId),
          ),
        )
        .orderBy(desc(homeworkSubmissions.version)),
      loadAssignmentQuestions(assignmentId),
    ]);

    const subIds = subs.map((s) => s.id);
    const [files, qGradesMap] = await Promise.all([
      subIds.length
        ? db
            .select()
            .from(homeworkSubmissionFiles)
            .where(inArray(homeworkSubmissionFiles.submissionId, subIds))
            .orderBy(asc(homeworkSubmissionFiles.displayOrder), asc(homeworkSubmissionFiles.id))
        : Promise.resolve([]),
      loadQuestionGradesBySubmission(subIds, questionMeta.questions),
    ]);

    const uid = req.authUser!.id;
    const roleSlug = req.authUser!.roleSlug;

    return res.json({
      assignment: {
        id: assignment.id,
        titleAr: assignment.titleAr,
        maximumGrade: Number(assignment.maximumGrade),
        rubric: assignment.rubricJson || [],
        questions: questionMeta.questions,
        deadline: assignment.deadline ? assignment.deadline.toISOString() : null,
      },
      student,
      versions: subs.map((s) => ({
        id: s.id,
        version: s.version,
        writtenAnswer: s.writtenAnswer,
        submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
        isLate: s.isLate,
        status: s.status,
        gradingMode: normalizeGradingMode(s.gradingMode),
        awardedGrade: s.awardedGrade !== null ? Number(s.awardedGrade) : null,
        questionTotalGrade: s.questionTotalGrade !== null ? Number(s.questionTotalGrade) : null,
        isManualOverride: Boolean(s.isManualOverride),
        overrideReason: s.overrideReason || '',
        rubricScores: s.rubricScoresJson || [],
        questionGrades: qGradesMap.get(s.id) || [],
        teacherFeedback: s.teacherFeedback,
        revisionInstructions: s.revisionInstructions,
        isGradePublished: s.isGradePublished,
        gradedAt: s.gradedAt ? s.gradedAt.toISOString() : null,
        structuredAnswers: s.structuredAnswersJson || [],
        files: files
          .filter((f) => f.submissionId === s.id)
          .map((f) => ({
            id: f.id,
            fileName: f.fileName,
            storageKey: f.storageKey,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            displayOrder: f.displayOrder,
            previewUrl: buildSignedFileUrl(f.storageKey, uid, roleSlug),
          })),
      })),
    });
  } catch (err) {
    console.error('Admin get student submission versions error:', err);
    return res.status(500).json({ error: 'تعذر تحميل نسخ تسليم الطالب' });
  }
});

// Grade Submission (SAVE_DRAFT | PUBLISH_GRADE | RETURN_FOR_REVISION)
// Supports DIRECT, RUBRIC, and QUESTION_BY_QUESTION (with optional manual overall override)
adminHomeworkRouter.post('/submissions/:submissionId/grade', requirePermission(PERMISSIONS.HOMEWORK_GRADE), async (req: AuthRequest, res) => {
  try {
    const submissionId = Number(req.params.submissionId);
    const schema = z.object({
      action: z.enum(['SAVE_DRAFT', 'PUBLISH_GRADE', 'RETURN_FOR_REVISION']),
      gradingMode: z.enum(['DIRECT', 'RUBRIC', 'QUESTION_BY_QUESTION']).optional(),
      awardedGrade: z.coerce.number().nullable().optional(),
      rubricScores: z
        .array(
          z.object({
            id: z.string().min(1),
            awardedPoints: z.coerce.number().min(0),
          }),
        )
        .optional()
        .default([]),
      questionGrades: z
        .array(
          z.object({
            questionId: z.coerce.number().int().positive(),
            awardedGrade: z.coerce.number(),
            teacherComment: z.string().max(2000).optional().default(''),
          }),
        )
        .optional()
        .default([]),
      manualFinalGrade: z.coerce.number().nullable().optional(),
      overrideReason: z.string().max(1000).optional().default(''),
      teacherFeedback: z.string().max(5000).optional().default(''),
      revisionInstructions: z.string().max(3000).optional().default(''),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات التصحيح غير صالحة',
      });
    }
    const body = parsed.data;

    const [sub] = await db
      .select()
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.id, submissionId))
      .limit(1);
    if (!sub) return res.status(404).json({ error: 'التسليم غير موجود' });

    const [assignment] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, sub.assignmentId))
      .limit(1);
    if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });

    const maxGrade = Number(assignment.maximumGrade);
    const rubricDef = (assignment.rubricJson || []) as RubricCriterion[];

    if (body.action === 'RETURN_FOR_REVISION') {
      await db
        .update(homeworkSubmissions)
        .set({
          status: 'RETURNED_FOR_REVISION',
          isGradePublished: false,
          teacherFeedback: body.teacherFeedback,
          revisionInstructions:
            body.revisionInstructions.trim() ||
            body.teacherFeedback.trim() ||
            'يرجى مراجعة خطوات الحل وإعادة تسليم نسخة مصححة.',
          gradedById: req.authUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(homeworkSubmissions.id, submissionId));

      await createNotification({
        userId: sub.studentId,
        titleAr: `مطلوب إعادة تسليم الواجب: ${assignment.titleAr}`,
        bodyAr:
          body.revisionInstructions.trim() ||
          'أعاد المدرس الواجب للمراجعة والتعديل. يرجى الاطلاع على الملاحظات وإعادة التسليم.',
        type: 'GENERAL',
        targetType: 'HOMEWORK',
        targetId: assignment.id,
      });

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'HOMEWORK_RETURNED_FOR_REVISION',
        entityType: 'homework_submission',
        entityId: submissionId,
        details: { assignmentId: assignment.id, studentId: sub.studentId, version: sub.version },
      });

      return res.json({ message: 'تمت إعادة الواجب للطالب للتعديل وإعادة التسليم' });
    }

    const isPublish = body.action === 'PUBLISH_GRADE';
    const effectiveMode: HomeworkGradingMode =
      body.gradingMode ||
      (body.questionGrades.length > 0
        ? 'QUESTION_BY_QUESTION'
        : body.rubricScores.length > 0 && rubricDef.length > 0
          ? 'RUBRIC'
          : 'DIRECT');

    // MODE 3: QUESTION-BY-QUESTION GRADING
    if (effectiveMode === 'QUESTION_BY_QUESTION') {
      const qMeta = await loadAssignmentQuestions(assignment.id);
      const qValidation = validateQuestionByQuestionGrading({
        maximumGrade: maxGrade,
        questions: qMeta.questions,
        questionGrades: body.questionGrades,
        manualFinalGrade: body.manualFinalGrade ?? null,
        overrideReason: body.overrideReason,
      });

      if (!qValidation.valid) {
        return res.status(400).json({ error: qValidation.errorAr });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        for (const item of qValidation.normalizedQuestionGrades) {
          await tx
            .insert(homeworkSubmissionQuestionGrades)
            .values({
              submissionId,
              questionId: item.questionId,
              awardedGrade: String(item.awardedGrade),
              teacherComment: item.teacherComment,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                homeworkSubmissionQuestionGrades.submissionId,
                homeworkSubmissionQuestionGrades.questionId,
              ],
              set: {
                awardedGrade: String(item.awardedGrade),
                teacherComment: item.teacherComment,
                updatedAt: now,
              },
            });
        }

        await tx
          .update(homeworkSubmissions)
          .set({
            status: isPublish ? 'GRADED' : 'UNDER_REVIEW',
            gradingMode: 'QUESTION_BY_QUESTION',
            awardedGrade: String(qValidation.finalGrade),
            questionTotalGrade: String(qValidation.questionTotalGrade),
            isManualOverride: qValidation.isManualOverride,
            overrideReason: qValidation.overrideReason,
            teacherFeedback: body.teacherFeedback,
            revisionInstructions: body.revisionInstructions,
            isGradePublished: isPublish,
            gradedById: req.authUser!.id,
            gradedAt: isPublish ? now : sub.gradedAt,
            updatedAt: now,
          })
          .where(eq(homeworkSubmissions.id, submissionId));
      });

      if (isPublish) {
        await createNotification({
          userId: sub.studentId,
          titleAr: `تم تصحيح الواجب: ${assignment.titleAr}`,
          bodyAr: `حصلت على ${qValidation.finalGrade} من ${maxGrade}. يمكنك مراجعة تفاصيل تصحيح كل سؤال وملاحظات المدرس من قسم «واجباتي».`,
          type: 'GENERAL',
          targetType: 'HOMEWORK',
          targetId: assignment.id,
        });
      }

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: isPublish ? 'HOMEWORK_GRADE_PUBLISHED' : 'HOMEWORK_GRADE_DRAFT_SAVED',
        entityType: 'homework_submission',
        entityId: submissionId,
        details: {
          assignmentId: assignment.id,
          studentId: sub.studentId,
          version: sub.version,
          gradingMode: 'QUESTION_BY_QUESTION',
          questionTotalGrade: qValidation.questionTotalGrade,
          awardedGrade: qValidation.finalGrade,
          isManualOverride: qValidation.isManualOverride,
          maxGrade,
        },
      });

      return res.json({
        gradingMode: 'QUESTION_BY_QUESTION',
        questionTotalGrade: qValidation.questionTotalGrade,
        awardedGrade: qValidation.finalGrade,
        isManualOverride: qValidation.isManualOverride,
        overrideReason: qValidation.overrideReason,
        isGradePublished: isPublish,
        message: isPublish
          ? 'تم اعتماد ونشر تصحيح الأسئلة والدرجة النهائية للطالب بنجاح'
          : 'تم حفظ تصحيح الأسئلة كمسودة بنجاح (لم تُنشر للطالب بعد)',
      });
    }

    // MODE 1 & 2: DIRECT OR RUBRIC GRADING (Preserved intact; never deletes saved question grades)
    if (
      effectiveMode === 'RUBRIC' &&
      rubricDef.length === 0
    ) {
      return res.status(400).json({
        error: 'لم يتم تعريف معايير التقييم (Rubric) لهذا الواجب. يمكنك اختيار الدرجة الإجمالية أو تصحيح كل سؤال.',
      });
    }

    if (
      body.action === 'PUBLISH_GRADE' &&
      effectiveMode === 'DIRECT' &&
      (body.awardedGrade === null || body.awardedGrade === undefined)
    ) {
      return res.status(400).json({ error: 'يرجى إدخال الدرجة قبل نشر نتيجة التصحيح' });
    }

    const gradeValidation = validateGradingSubmission({
      maximumGrade: maxGrade,
      awardedGrade: effectiveMode === 'DIRECT' ? (body.awardedGrade ?? null) : null,
      rubricDefinition: effectiveMode === 'RUBRIC' ? rubricDef : [],
      rubricScores: effectiveMode === 'RUBRIC' ? body.rubricScores : [],
    });

    if (!gradeValidation.valid) {
      return res.status(400).json({ error: gradeValidation.errorAr });
    }

    await db
      .update(homeworkSubmissions)
      .set({
        status: isPublish ? 'GRADED' : 'UNDER_REVIEW',
        gradingMode: effectiveMode,
        awardedGrade:
          gradeValidation.computedGrade !== null ? String(gradeValidation.computedGrade) : null,
        isManualOverride: false,
        overrideReason: '',
        rubricScoresJson:
          effectiveMode === 'RUBRIC' ? gradeValidation.normalizedRubric : sub.rubricScoresJson,
        teacherFeedback: body.teacherFeedback,
        revisionInstructions: body.revisionInstructions,
        isGradePublished: isPublish,
        gradedById: req.authUser!.id,
        gradedAt: isPublish ? new Date() : sub.gradedAt,
        updatedAt: new Date(),
      })
      .where(eq(homeworkSubmissions.id, submissionId));

    if (isPublish) {
      await createNotification({
        userId: sub.studentId,
        titleAr: `تم تصحيح الواجب: ${assignment.titleAr}`,
        bodyAr: `حصلت على ${gradeValidation.computedGrade} من ${maxGrade}. يمكنك مراجعة ملاحظات المدرس من قسم «واجباتي».`,
        type: 'GENERAL',
        targetType: 'HOMEWORK',
        targetId: assignment.id,
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: isPublish ? 'HOMEWORK_GRADE_PUBLISHED' : 'HOMEWORK_GRADE_DRAFT_SAVED',
      entityType: 'homework_submission',
      entityId: submissionId,
      details: {
        assignmentId: assignment.id,
        studentId: sub.studentId,
        version: sub.version,
        gradingMode: effectiveMode,
        awardedGrade: gradeValidation.computedGrade,
        maxGrade,
      },
    });

    return res.json({
      gradingMode: effectiveMode,
      awardedGrade: gradeValidation.computedGrade,
      isGradePublished: isPublish,
      message: isPublish
        ? 'تم اعتماد ونشر درجة الواجب بنجاح'
        : 'تم حفظ التصحيح كمسودة بنجاح (لم تُنشر للطالب بعد)',
    });
  } catch (err) {
    console.error('Admin grade submission error:', err);
    return res.status(500).json({ error: 'تعذر حفظ نتيجة التصحيح' });
  }
});

// Compact homework summary for StudentFullProfileDrawer integration
adminHomeworkRouter.get(
  '/student-summary/:studentId',
  requirePermission([
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_MANAGE,
    PERMISSIONS.HOMEWORK_GRADE,
    PERMISSIONS.STUDENTS_VIEW,
  ]),
  async (req: AuthRequest, res) => {
  try {
    const studentId = Number(req.params.studentId);
    const subs = await db
      .select({
        submission: homeworkSubmissions,
        assignment: homeworkAssignments,
      })
      .from(homeworkSubmissions)
      .innerJoin(homeworkAssignments, eq(homeworkSubmissions.assignmentId, homeworkAssignments.id))
      .where(eq(homeworkSubmissions.studentId, studentId))
      .orderBy(desc(homeworkSubmissions.updatedAt));

    // Latest version per assignment
    const latestMap = new Map<number, (typeof subs)[number]>();
    for (const row of subs) {
      const prev = latestMap.get(row.assignment.id);
      if (!prev || row.submission.version > prev.submission.version) {
        latestMap.set(row.assignment.id, row);
      }
    }

    const items = Array.from(latestMap.values()).map(({ submission, assignment }) => ({
      assignmentId: assignment.id,
      titleAr: assignment.titleAr,
      version: submission.version,
      status: submission.status,
      statusLabelAr: getAdminSubmissionStatusLabelAr(submission.status, submission.isGradePublished),
      isLate: submission.isLate,
      awardedGrade: submission.awardedGrade !== null ? Number(submission.awardedGrade) : null,
      maximumGrade: Number(assignment.maximumGrade),
      isGradePublished: submission.isGradePublished,
      submittedAt: submission.submittedAt ? submission.submittedAt.toISOString() : null,
      gradedAt: submission.gradedAt ? submission.gradedAt.toISOString() : null,
    }));

    return res.json({ items });
  } catch (err) {
    console.error('Admin student homework summary error:', err);
    return res.status(500).json({ error: 'تعذر تحميل ملخص واجبات الطالب' });
  }
});

// =========================================================================
// 3. STUDENT HOMEWORK ROUTES (/api/student/homework/*)
// =========================================================================
studentHomeworkRouter.use(requireAuth, requireActiveAccount);

async function buildStudentHomeworkCardList(
  u: NonNullable<AuthRequest['authUser']>,
  filters: {
    videoId?: number;
    trackId?: number;
    gradeId?: number;
    unitId?: number;
    lessonId?: number;
    courseId?: number;
    search?: string;
  } = {},
) {
  const now = new Date();

  const loadSharedHomeworkCatalog = () =>
    homeworkSharedCatalogCache.getOrLoad('shared', async () => {
      const [
        assignments,
        allTargets,
        allTracks,
        allGrades,
        allUnits,
        allLessons,
        allVideos,
        allCourses,
        allCourseLessons,
        allModelAnswers,
      ] = await Promise.all([
        db
          .select({
            id: homeworkAssignments.id,
            titleAr: homeworkAssignments.titleAr,
            descriptionAr: homeworkAssignments.descriptionAr,
            trackId: homeworkAssignments.trackId,
            gradeId: homeworkAssignments.gradeId,
            unitId: homeworkAssignments.unitId,
            lessonId: homeworkAssignments.lessonId,
            videoId: homeworkAssignments.videoId,
            courseId: homeworkAssignments.courseId,
            maximumGrade: homeworkAssignments.maximumGrade,
            assignmentScope: homeworkAssignments.assignmentScope,
            publicationStatus: homeworkAssignments.publicationStatus,
            publishedAt: homeworkAssignments.publishedAt,
            deadline: homeworkAssignments.deadline,
            allowLateSubmission: homeworkAssignments.allowLateSubmission,
            allowResubmission: homeworkAssignments.allowResubmission,
            maximumSubmissions: homeworkAssignments.maximumSubmissions,
            allowReopenAfterGrading: homeworkAssignments.allowReopenAfterGrading,
            createdAt: homeworkAssignments.createdAt,
          })
          .from(homeworkAssignments)
          .orderBy(asc(homeworkAssignments.deadline), desc(homeworkAssignments.createdAt)),
        db
          .select({
            assignmentId: homeworkTargets.assignmentId,
            studentId: homeworkTargets.studentId,
            groupId: homeworkTargets.groupId,
          })
          .from(homeworkTargets),
        db.select({ id: academicTracks.id, nameAr: academicTracks.nameAr }).from(academicTracks),
        db.select({ id: grades.id, nameAr: grades.nameAr }).from(grades),
        db.select({ id: units.id, titleAr: units.titleAr }).from(units),
        db.select({ id: lessons.id, titleAr: lessons.titleAr }).from(lessons),
        db
          .select({
            id: videos.id,
            lessonId: videos.lessonId,
            gradeId: videos.gradeId,
            courseId: videos.courseId,
            titleAr: videos.titleAr,
            videoType: videos.videoType,
            isPublished: videos.isPublished,
            publicationStatus: videos.publicationStatus,
          })
          .from(videos),
        db.select({ id: courses.id, titleAr: courses.titleAr }).from(courses),
        db
          .select({
            courseId: courseLessons.courseId,
            lessonId: courseLessons.lessonId,
            isFreePreview: courseLessons.isFreePreview,
          })
          .from(courseLessons),
        db
          .select({
            assignmentId: homeworkModelAnswers.assignmentId,
            visibilityPolicy: homeworkModelAnswers.visibilityPolicy,
            releaseAt: homeworkModelAnswers.releaseAt,
            manuallyReleased: homeworkModelAnswers.manuallyReleased,
          })
          .from(homeworkModelAnswers),
      ]);

      const trackById = new Map(allTracks.map((t) => [t.id, t]));
      const gradeById = new Map(allGrades.map((g) => [g.id, g]));
      const unitById = new Map(allUnits.map((un) => [un.id, un]));
      const lessonById = new Map(allLessons.map((l) => [l.id, l]));
      const videoById = new Map(allVideos.map((v) => [v.id, v]));
      const courseById = new Map(allCourses.map((c) => [c.id, c]));
      const maByAssignment = new Map(allModelAnswers.map((m) => [m.assignmentId, m]));

      const clByLesson = new Map<number, typeof allCourseLessons>();
      for (const cl of allCourseLessons) {
        const list = clByLesson.get(cl.lessonId) || [];
        list.push(cl);
        clByLesson.set(cl.lessonId, list);
      }
      const targetsByAssignment = new Map<number, typeof allTargets>();
      for (const t of allTargets) {
        const list = targetsByAssignment.get(t.assignmentId) || [];
        list.push(t);
        targetsByAssignment.set(t.assignmentId, list);
      }

      return {
        assignments,
        trackById,
        gradeById,
        unitById,
        lessonById,
        videoById,
        courseById,
        maByAssignment,
        clByLesson,
        targetsByAssignment,
      };
    }) as Promise<{
      assignments: Array<{
        id: number;
        titleAr: string;
        descriptionAr: string;
        trackId: number;
        gradeId: number;
        unitId: number | null;
        lessonId: number | null;
        videoId: number | null;
        courseId: number | null;
        maximumGrade: string;
        assignmentScope: string;
        publicationStatus: string;
        publishedAt: Date | null;
        deadline: Date | null;
        allowLateSubmission: boolean;
        allowResubmission: boolean;
        maximumSubmissions: number;
        allowReopenAfterGrading: boolean;
        createdAt: Date;
      }>;
      trackById: Map<number, { id: number; nameAr: string }>;
      gradeById: Map<number, { id: number; nameAr: string }>;
      unitById: Map<number, { id: number; titleAr: string }>;
      lessonById: Map<number, { id: number; titleAr: string }>;
      videoById: Map<
        number,
        {
          id: number;
          lessonId: number;
          gradeId: number;
          courseId: number | null;
          titleAr: string;
          videoType: string;
          isPublished: boolean;
          publicationStatus: string;
        }
      >;
      courseById: Map<number, { id: number; titleAr: string }>;
      maByAssignment: Map<
        number,
        {
          assignmentId: number;
          visibilityPolicy: string;
          releaseAt: Date | null;
          manuallyReleased: boolean;
        }
      >;
      clByLesson: Map<number, Array<{ courseId: number; lessonId: number; isFreePreview: boolean }>>;
      targetsByAssignment: Map<
        number,
        Array<{ assignmentId: number; studentId: number | null; groupId: number | null }>
      >;
    }>;

  const [sCtx, catalog, studentSubs] = await Promise.all([
    getStudentContext(u.id, u.roleSlug, u.status),
    loadSharedHomeworkCatalog(),
    db
      .select({
        id: homeworkSubmissions.id,
        assignmentId: homeworkSubmissions.assignmentId,
        version: homeworkSubmissions.version,
        status: homeworkSubmissions.status,
        isLate: homeworkSubmissions.isLate,
        isGradePublished: homeworkSubmissions.isGradePublished,
        awardedGrade: homeworkSubmissions.awardedGrade,
        submittedAt: homeworkSubmissions.submittedAt,
      })
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.studentId, u.id))
      .orderBy(desc(homeworkSubmissions.version)),
  ]);

  const {
    assignments,
    trackById,
    gradeById,
    unitById,
    lessonById,
    videoById,
    courseById,
    maByAssignment,
    clByLesson,
    targetsByAssignment,
  } = catalog;

  const subsByAssignment = new Map<number, typeof studentSubs>();
  for (const s of studentSubs) {
    const list = subsByAssignment.get(s.assignmentId) || [];
    list.push(s);
    subsByAssignment.set(s.assignmentId, list);
  }

  // Pre-cache video access results in O(1) memory (zero N+1 DB calls)
  const videoAccessCache = new Map<number, boolean>();
  const resolveVideoAccessInMemory = (videoId: number): boolean => {
    if (sCtx.isStaff) return true;
    const cached = videoAccessCache.get(videoId);
    if (cached !== undefined) return cached;
    const v = videoById.get(videoId);
    if (!v) {
      videoAccessCache.set(videoId, false);
      return false;
    }
    if (v.courseId && sCtx.blockedCourseIds.has(v.courseId)) {
      videoAccessCache.set(videoId, false);
      return false;
    }
    const clRows = clByLesson.get(v.lessonId) || [];
    const unblockedCourseLinks = clRows.filter((cl) => !sCtx.blockedCourseIds.has(cl.courseId));
    const decision = resolveVideoAccess({
      userRoleSlug: sCtx.roleSlug,
      userStatus: sCtx.userStatus,
      approvedGradeIds: sCtx.approvedGradeIds,
      videoId: v.id,
      videoGradeId: v.gradeId,
      videoType: v.videoType,
      videoPublished: v.isPublished,
      publicationStatus: v.publicationStatus,
      videoCourseId: v.courseId,
      courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
      isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
      entitlements: sCtx.userEntitlements,
    });
    videoAccessCache.set(videoId, decision.allowed);
    return decision.allowed;
  };

  const eligibleCards = [];
  for (const a of assignments) {
    if (filters.videoId && a.videoId !== filters.videoId) continue;
    if (filters.trackId && a.trackId !== filters.trackId) continue;
    if (filters.gradeId && a.gradeId !== filters.gradeId) continue;
    if (filters.unitId && a.unitId !== filters.unitId) continue;
    if (filters.lessonId && a.lessonId !== filters.lessonId) continue;
    if (filters.courseId && a.courseId !== filters.courseId) continue;
    if (
      filters.search &&
      !a.titleAr.toLowerCase().includes(filters.search) &&
      !(a.descriptionAr || '').toLowerCase().includes(filters.search)
    ) {
      continue;
    }

    const hasVideoAccess = a.videoId ? resolveVideoAccessInMemory(a.videoId) : true;

    const targets = targetsByAssignment.get(a.id) || [];
    const eligibility = evaluateStudentHomeworkEligibility({
      assignment: a,
      studentId: u.id,
      isStaff: sCtx.isStaff,
      approvedGradeIds: sCtx.approvedGradeIds,
      studentGroupIds: sCtx.studentGroupIds,
      activeCourseIds: sCtx.activeCourseIds,
      hasGradeAllEntitlement: sCtx.gradeAllIds.has(a.gradeId),
      targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
      targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
      hasVideoAccess,
      now,
    });

    if (!eligibility.eligible) continue;

    const mySubs = [...(subsByAssignment.get(a.id) || [])].sort((x, y) => y.version - x.version);
    const submittedSubs = mySubs.filter((s) => s.status !== 'DRAFT');
    const latestSub = submittedSubs[0] || mySubs[0] || null;

    const displayStatus = deriveStudentHomeworkStatus({
      deadline: a.deadline,
      allowLateSubmission: a.allowLateSubmission,
      latestSubmission: latestSub
        ? {
            status: latestSub.status,
            isLate: latestSub.isLate,
            isGradePublished: latestSub.isGradePublished,
          }
        : null,
      now,
    });

    const permission = evaluateSubmissionPermission({
      assignment: a,
      existingSubmittedVersions: submittedSubs.map((s) => ({
        version: s.version,
        status: s.status,
        isGradePublished: s.isGradePublished,
      })),
      now,
    });

    const latestSubmitted = submittedSubs[0] || null;
    const latestPublishedGraded =
      latestSubmitted && latestSubmitted.status === 'GRADED' && latestSubmitted.isGradePublished
        ? latestSubmitted
        : null;
    const anyPublishedGraded = submittedSubs.some(
      (s) => s.status === 'GRADED' && s.isGradePublished,
    );
    const maxGrade = Number(a.maximumGrade);
    const awardedGrade =
      latestPublishedGraded && latestPublishedGraded.awardedGrade !== null
        ? Number(latestPublishedGraded.awardedGrade)
        : null;
    const percentage =
      awardedGrade !== null && maxGrade > 0 ? Math.round((awardedGrade / maxGrade) * 100) : null;

    const ma = maByAssignment.get(a.id);
    const maRelease = ma
      ? evaluateModelAnswerRelease({
          policy: ma.visibilityPolicy,
          releaseAt: ma.releaseAt,
          manuallyReleased: ma.manuallyReleased,
          assignmentDeadline: a.deadline,
          hasStudentSubmitted: submittedSubs.length > 0,
          isStudentGradedAndPublished: anyPublishedGraded,
          isStaff: sCtx.isStaff,
          now,
        })
      : null;

    eligibleCards.push({
      id: a.id,
      titleAr: a.titleAr,
      descriptionAr: a.descriptionAr,
      trackId: a.trackId,
      trackNameAr: trackById.get(a.trackId)?.nameAr || '',
      gradeId: a.gradeId,
      gradeNameAr: gradeById.get(a.gradeId)?.nameAr || '',
      unitId: a.unitId,
      unitTitleAr: a.unitId ? unitById.get(a.unitId)?.titleAr || null : null,
      lessonId: a.lessonId,
      lessonTitleAr: a.lessonId ? lessonById.get(a.lessonId)?.titleAr || null : null,
      videoId: a.videoId,
      videoTitleAr: a.videoId ? videoById.get(a.videoId)?.titleAr || null : null,
      courseId: a.courseId,
      courseTitleAr: a.courseId ? courseById.get(a.courseId)?.titleAr || null : null,
      maximumGrade: maxGrade,
      deadline: a.deadline ? a.deadline.toISOString() : null,
      allowLateSubmission: a.allowLateSubmission,
      allowResubmission: a.allowResubmission,
      maximumSubmissions: a.maximumSubmissions,
      statusCode: displayStatus.code,
      statusLabelAr: displayStatus.labelAr,
      canSubmit: permission.canSubmit,
      canSubmitReasonAr: permission.reasonAr || null,
      submittedVersionsCount: submittedSubs.length,
      latestSubmittedAt: submittedSubs[0]?.submittedAt
        ? submittedSubs[0].submittedAt.toISOString()
        : null,
      awardedGrade,
      percentage,
      hasModelAnswer: Boolean(ma),
      isModelAnswerReleased: Boolean(maRelease?.isReleased),
    });
  }

  return { serverNow: now.toISOString(), items: eligibleCards };
}

// List all eligible homework for "واجباتي"
studentHomeworkRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const statusFilter = String(req.query.status || 'ALL').toUpperCase();
    const result = await buildStudentHomeworkCardList(u, {
      trackId: Number(req.query.trackId || 0) || undefined,
      gradeId: Number(req.query.gradeId || 0) || undefined,
      unitId: Number(req.query.unitId || 0) || undefined,
      lessonId: Number(req.query.lessonId || 0) || undefined,
      courseId: Number(req.query.courseId || 0) || undefined,
      videoId: Number(req.query.videoId || 0) || undefined,
      search: String(req.query.search || '').trim().toLowerCase() || undefined,
    });

    const all = result.items;
    const counts = {
      ALL: all.length,
      AVAILABLE: all.filter((i) => i.canSubmit).length,
      NOT_SUBMITTED: all.filter((i) =>
        ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED_FOR_REVISION', 'DEADLINE_PASSED'].includes(i.statusCode) ||
        (i.statusCode === 'LATE' && i.submittedVersionsCount === 0),
      ).length,
      SUBMITTED: all.filter((i) => i.submittedVersionsCount > 0).length,
      UNDER_REVIEW: all.filter((i) => ['SUBMITTED', 'UNDER_REVIEW'].includes(i.statusCode) || (i.statusCode === 'LATE' && i.submittedVersionsCount > 0)).length,
      GRADED: all.filter((i) => i.statusCode === 'GRADED').length,
      LATE: all.filter((i) => i.statusCode === 'LATE' || i.statusCode === 'DEADLINE_PASSED').length,
    };

    const items = all.filter((i) => {
      switch (statusFilter) {
        case 'AVAILABLE':
          return i.canSubmit;
        case 'NOT_SUBMITTED':
          return (
            ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED_FOR_REVISION', 'DEADLINE_PASSED'].includes(i.statusCode) ||
            (i.statusCode === 'LATE' && i.submittedVersionsCount === 0)
          );
        case 'SUBMITTED':
          return i.submittedVersionsCount > 0;
        case 'UNDER_REVIEW':
          return (
            ['SUBMITTED', 'UNDER_REVIEW'].includes(i.statusCode) ||
            (i.statusCode === 'LATE' && i.submittedVersionsCount > 0)
          );
        case 'GRADED':
          return i.statusCode === 'GRADED';
        case 'LATE':
          return i.statusCode === 'LATE' || i.statusCode === 'DEADLINE_PASSED';
        default:
          return true;
      }
    });

    return res.json({
      serverNow: result.serverNow,
      counts,
      items,
    });
  } catch (err) {
    console.error('Student homework list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الواجبات' });
  }
});

// Get eligible homework directly for a specific video (Displayed below Video + PDF)
studentHomeworkRouter.get('/video/:videoId', async (req: AuthRequest, res) => {
  try {
    const videoId = Number(req.params.videoId);
    if (!Number.isInteger(videoId) || videoId <= 0) {
      return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
    }
    const u = req.authUser!;
    const sCtx = await getStudentContext(u.id, u.roleSlug, u.status);
    const hasVideoAccess = await checkStudentVideoAccess(sCtx, videoId);
    if (!hasVideoAccess) {
      return res.status(403).json({ error: 'غير مصرح بالوصول إلى واجبات هذا الفيديو' });
    }

    const result = await buildStudentHomeworkCardList(u, { videoId });
    return res.json(result);
  } catch (err) {
    console.error('Student video homework error:', err);
    return res.status(500).json({ error: 'تعذر تحميل واجبات الدرس' });
  }
});

// Student private file upload (solution images or PDF)
studentHomeworkRouter.post('/upload-file', uploadJsonParser, async (req: AuthRequest, res) => {
  try {
    const parsed = uploadFilePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات الملف المرفوع غير صالحة' });
    }

    const validated = validateHomeworkFileUpload({
      fileName: parsed.data.fileName,
      declaredMimeType: parsed.data.mimeType,
      dataBase64: parsed.data.dataBase64,
    });

    if (!validated.ok) {
      return res.status(400).json({ error: validated.errorAr });
    }

    const storageKey = generateHomeworkStorageKey();
    await db.insert(homeworkStoredFiles).values({
      storageKey,
      ownerUserId: req.authUser!.id,
      purpose: 'SUBMISSION_FILE',
      originalName: validated.sanitizedFileName,
      mimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      dataBase64: validated.cleanBase64,
    });

    return res.status(201).json({
      storageKey,
      fileName: validated.sanitizedFileName,
      mimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      previewUrl: buildSignedFileUrl(storageKey, req.authUser!.id, req.authUser!.roleSlug),
    });
  } catch (err) {
    console.error('Student homework upload error:', err);
    return res.status(500).json({ error: 'تعذر رفع ملف الحل، يرجى المحاولة مرة أخرى' });
  }
});

// Get full single homework detail for student (strict backend model-answer gating)
studentHomeworkRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الواجب غير صالح' });
    }
    const u = req.authUser!;
    const now = new Date();

    const [a] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!a) return res.status(404).json({ error: 'الواجب غير موجود' });

    const sCtx = await getStudentContext(u.id, u.roleSlug, u.status);
    const targets = await db
      .select()
      .from(homeworkTargets)
      .where(eq(homeworkTargets.assignmentId, id));
    const hasVideoAccess = await checkStudentVideoAccess(sCtx, a.videoId);

    const eligibility = evaluateStudentHomeworkEligibility({
      assignment: a,
      studentId: u.id,
      isStaff: sCtx.isStaff,
      approvedGradeIds: sCtx.approvedGradeIds,
      studentGroupIds: sCtx.studentGroupIds,
      activeCourseIds: sCtx.activeCourseIds,
      hasGradeAllEntitlement: sCtx.gradeAllIds.has(a.gradeId),
      targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
      targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
      hasVideoAccess,
      now,
    });

    if (!eligibility.eligible) {
      return res.status(403).json({ error: eligibility.reasonAr || 'غير مصرح لك بالوصول إلى هذا الواجب' });
    }

    const [
      [track],
      [grade],
      [unit],
      [lesson],
      [video],
      [course],
      attachments,
      [modelAnswer],
      mySubs,
      questionMeta,
    ] = await Promise.all([
      db.select().from(academicTracks).where(eq(academicTracks.id, a.trackId)).limit(1),
      db.select().from(grades).where(eq(grades.id, a.gradeId)).limit(1),
      a.unitId ? db.select().from(units).where(eq(units.id, a.unitId)).limit(1) : Promise.resolve([null]),
      a.lessonId ? db.select().from(lessons).where(eq(lessons.id, a.lessonId)).limit(1) : Promise.resolve([null]),
      a.videoId ? db.select().from(videos).where(eq(videos.id, a.videoId)).limit(1) : Promise.resolve([null]),
      a.courseId ? db.select().from(courses).where(eq(courses.id, a.courseId)).limit(1) : Promise.resolve([null]),
      db
        .select()
        .from(homeworkAttachments)
        .where(eq(homeworkAttachments.assignmentId, id))
        .orderBy(asc(homeworkAttachments.displayOrder), asc(homeworkAttachments.id)),
      db.select().from(homeworkModelAnswers).where(eq(homeworkModelAnswers.assignmentId, id)).limit(1),
      db
        .select()
        .from(homeworkSubmissions)
        .where(and(eq(homeworkSubmissions.assignmentId, id), eq(homeworkSubmissions.studentId, u.id)))
        .orderBy(desc(homeworkSubmissions.version)),
      loadAssignmentQuestions(id, u, { includeModelAnswers: false }),
    ]);

    const subIds = mySubs.map((s) => s.id);
    const [subFiles, qGradesMap] = await Promise.all([
      subIds.length
        ? db
            .select()
            .from(homeworkSubmissionFiles)
            .where(inArray(homeworkSubmissionFiles.submissionId, subIds))
            .orderBy(asc(homeworkSubmissionFiles.displayOrder), asc(homeworkSubmissionFiles.id))
        : Promise.resolve([]),
      loadQuestionGradesBySubmission(subIds, questionMeta.questions),
    ]);

    const submittedSubs = mySubs.filter((s) => s.status !== 'DRAFT');
    const latestSubmitted = submittedSubs[0] || null;
    const latestSub = latestSubmitted || mySubs[0] || null;
    const latestPublishedGraded =
      latestSubmitted && latestSubmitted.status === 'GRADED' && latestSubmitted.isGradePublished
        ? latestSubmitted
        : null;
    const anyPublishedGraded = submittedSubs.some(
      (s) => s.status === 'GRADED' && s.isGradePublished,
    );

    const displayStatus = deriveStudentHomeworkStatus({
      deadline: a.deadline,
      allowLateSubmission: a.allowLateSubmission,
      latestSubmission: latestSub
        ? {
            status: latestSub.status,
            isLate: latestSub.isLate,
            isGradePublished: latestSub.isGradePublished,
          }
        : null,
      now,
    });

    const submissionPermission = evaluateSubmissionPermission({
      assignment: a,
      existingSubmittedVersions: submittedSubs.map((s) => ({
        version: s.version,
        status: s.status,
        isGradePublished: s.isGradePublished,
      })),
      now,
    });

    // Strict Model Answer gating — NEVER leak URLs, file IDs, or storage keys when unreleased!
    let studentModelAnswer;
    if (!modelAnswer) {
      studentModelAnswer = {
        exists: false,
        isReleased: false,
        policyLabelAr: '',
        messageAr: 'لا يوجد نموذج إجابة مرفق لهذا الواجب.',
      };
    } else {
      const release = evaluateModelAnswerRelease({
        policy: modelAnswer.visibilityPolicy,
        releaseAt: modelAnswer.releaseAt,
        manuallyReleased: modelAnswer.manuallyReleased,
        assignmentDeadline: a.deadline,
        hasStudentSubmitted: submittedSubs.length > 0,
        isStudentGradedAndPublished: anyPublishedGraded,
        isStaff: sCtx.isStaff,
        now,
      });

      if (!release.isReleased) {
        studentModelAnswer = {
          exists: true,
          isReleased: false,
          policyLabelAr: release.policyLabelAr,
          messageAr: release.reasonAr,
          releaseAt:
            modelAnswer.visibilityPolicy === 'SCHEDULED_RELEASE' && modelAnswer.releaseAt
              ? modelAnswer.releaseAt.toISOString()
              : null,
        };
      } else {
        studentModelAnswer = {
          exists: true,
          isReleased: true,
          policyLabelAr: release.policyLabelAr,
          messageAr: release.reasonAr,
          titleAr: modelAnswer.titleAr,
          notesAr: modelAnswer.notesAr,
          drivePreviewUrl: modelAnswer.driveFileId
            ? buildGoogleDrivePreviewUrl(modelAnswer.driveFileId)
            : null,
          driveViewUrl: modelAnswer.driveFileId
            ? buildGoogleDriveViewUrl(modelAnswer.driveFileId)
            : null,
          files: (modelAnswer.filesJson || []).map((f) => ({
            ...f,
            previewUrl: buildSignedFileUrl(f.storageKey, u.id, u.roleSlug),
          })),
        };
      }
    }

    const maxGrade = Number(a.maximumGrade);
    const awardedGrade =
      latestPublishedGraded && latestPublishedGraded.awardedGrade !== null
        ? Number(latestPublishedGraded.awardedGrade)
        : null;

    return res.json({
      serverNow: now.toISOString(),
      assignment: {
        id: a.id,
        titleAr: a.titleAr,
        descriptionAr: a.descriptionAr,
        instructionsAr: a.instructionsAr,
        trackId: a.trackId,
        trackNameAr: track?.nameAr || '',
        gradeId: a.gradeId,
        gradeNameAr: grade?.nameAr || '',
        unitId: a.unitId,
        unitTitleAr: unit?.titleAr || null,
        lessonId: a.lessonId,
        lessonTitleAr: lesson?.titleAr || null,
        videoId: a.videoId,
        videoTitleAr: video?.titleAr || null,
        courseId: a.courseId,
        courseTitleAr: course?.titleAr || null,
        maximumGrade: maxGrade,
        rubric: a.rubricJson || [],
        questions: questionMeta.questions.map((q) => {
          const rawQ = questionMeta.rawRows.find((r) => r.id === q.id);
          return {
            id: q.id,
            bankQuestionId: q.bankQuestionId,
            questionType: q.questionType,
            questionNumber: q.questionNumber,
            labelAr: q.labelAr,
            descriptionAr: q.descriptionAr,
            promptSnapshotAr: q.promptSnapshotAr,
            questionImages: q.questionImages,
            choices: sanitizeHomeworkChoicesForStudent(
              rawQ?.choicesSnapshotJson,
              studentModelAnswer.isReleased,
            ),
            // CRITICAL: NEVER expose per-question model answers unless release policy allows!
            ...(studentModelAnswer.isReleased && rawQ
              ? {
                  modelAnswerTextSnapshot: rawQ.modelAnswerTextSnapshot || '',
                  modelAnswerFiles: (rawQ.modelAnswerFilesJson || []).map((f) => ({
                    ...f,
                    previewUrl: buildSignedQuestionBankFileUrl({
                      storageKey: f.storageKey,
                      userId: u.id,
                      roleSlug: u.roleSlug,
                      context: 'homework',
                      resourceId: id,
                      fileRole: 'model_answer',
                    }),
                  })),
                }
              : {}),
            maxGrade: q.maxGrade,
            displayOrder: q.displayOrder,
          };
        }),
        deadline: a.deadline ? a.deadline.toISOString() : null,
        allowLateSubmission: a.allowLateSubmission,
        allowResubmission: a.allowResubmission,
        maximumSubmissions: a.maximumSubmissions,
        allowReopenAfterGrading: a.allowReopenAfterGrading,
        statusCode: displayStatus.code,
        statusLabelAr: displayStatus.labelAr,
        canSubmit: submissionPermission.canSubmit,
        canSubmitReasonAr: submissionPermission.reasonAr || null,
        submittedVersionsCount: submittedSubs.length,
        latestSubmittedAt: submittedSubs[0]?.submittedAt
          ? submittedSubs[0].submittedAt.toISOString()
          : null,
        awardedGrade,
        percentage:
          awardedGrade !== null && maxGrade > 0 ? Math.round((awardedGrade / maxGrade) * 100) : null,
        hasModelAnswer: Boolean(modelAnswer),
        isModelAnswerReleased: studentModelAnswer.isReleased,
        attachments: attachments.map((att) => ({
          id: att.id,
          attachmentType: att.attachmentType,
          fileName: att.fileName,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          previewUrl:
            att.attachmentType === 'GOOGLE_DRIVE_PDF' && att.driveFileId
              ? buildGoogleDrivePreviewUrl(att.driveFileId)
              : att.storageKey
                ? buildSignedFileUrl(att.storageKey, u.id, u.roleSlug)
                : null,
          viewUrl:
            att.attachmentType === 'GOOGLE_DRIVE_PDF' && att.driveFileId
              ? buildGoogleDriveViewUrl(att.driveFileId)
              : att.storageKey
                ? buildSignedFileUrl(att.storageKey, u.id, u.roleSlug)
                : null,
          displayOrder: att.displayOrder,
        })),
      },
      submissionPermission,
      submissions: mySubs.map((s) => {
        const mode = normalizeGradingMode(s.gradingMode);
        const published = Boolean(s.isGradePublished);
        return {
          id: s.id,
          version: s.version,
          writtenAnswer: s.writtenAnswer,
          submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
          isLate: s.isLate,
          status: s.status === 'GRADED' && !published ? 'UNDER_REVIEW' : s.status,
          gradingMode: published ? mode : 'DIRECT',
          awardedGrade: published && s.awardedGrade !== null ? Number(s.awardedGrade) : null,
          questionTotalGrade:
            published && mode === 'QUESTION_BY_QUESTION' && s.questionTotalGrade !== null
              ? Number(s.questionTotalGrade)
              : null,
          isManualOverride: published && mode === 'QUESTION_BY_QUESTION' ? Boolean(s.isManualOverride) : false,
          overrideReason:
            published && mode === 'QUESTION_BY_QUESTION' && s.isManualOverride
              ? s.overrideReason || ''
              : '',
          rubricScores:
            published && mode !== 'QUESTION_BY_QUESTION' ? s.rubricScoresJson || [] : [],
          questionGrades:
            published && mode === 'QUESTION_BY_QUESTION' ? qGradesMap.get(s.id) || [] : [],
          teacherFeedback:
            published || s.status === 'RETURNED_FOR_REVISION' ? s.teacherFeedback : '',
          revisionInstructions: s.status === 'RETURNED_FOR_REVISION' ? s.revisionInstructions : '',
          isGradePublished: published,
          gradedAt: published && s.gradedAt ? s.gradedAt.toISOString() : null,
          structuredAnswers: s.structuredAnswersJson || [],
          files: subFiles
            .filter((f) => f.submissionId === s.id)
            .map((f) => ({
              id: f.id,
              fileName: f.fileName,
              storageKey: f.storageKey,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              displayOrder: f.displayOrder,
              previewUrl: buildSignedFileUrl(f.storageKey, u.id, u.roleSlug),
            })),
        };
      }),
      modelAnswer: studentModelAnswer,
    });
  } catch (err) {
    console.error('Student homework detail error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الواجب' });
  }
});

// Submit Homework Solution (Versioned + Idempotent + Server-Time Enforced)
studentHomeworkRouter.post('/:id/submit', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الواجب غير صالح' });
    }

    const schema = z.object({
      writtenAnswer: z.string().max(15000).optional().default(''),
      structuredAnswers: z
        .array(
          z.object({
            questionId: z.coerce.number().int().positive(),
            selectedChoiceId: z.string().max(80).nullable().optional(),
            textAnswer: z.string().max(5000).optional().default(''),
          }),
        )
        .max(100)
        .optional()
        .default([]),
      isDraft: z.boolean().optional().default(false),
      clientSubmissionKey: z.string().trim().min(6).max(120).optional(),
      files: z
        .array(
          z.object({
            storageKey: z.string().trim().min(1),
            fileName: z.string().trim().min(1).max(200),
            displayOrder: z.coerce.number().int().min(0).default(0),
          }),
        )
        .max(MAX_SUBMISSION_FILES, `الحد الأقصى لعدد الملفات في التسليم الواحد هو ${MAX_SUBMISSION_FILES} ملفات.`)
        .optional()
        .default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات التسليم غير صالحة',
      });
    }
    const body = parsed.data;
    const u = req.authUser!;
    const now = new Date();

    const [a] = await db
      .select()
      .from(homeworkAssignments)
      .where(eq(homeworkAssignments.id, id))
      .limit(1);
    if (!a) return res.status(404).json({ error: 'الواجب غير موجود' });

    const sCtx = await getStudentContext(u.id, u.roleSlug, u.status);
    const targets = await db
      .select()
      .from(homeworkTargets)
      .where(eq(homeworkTargets.assignmentId, id));
    const hasVideoAccess = await checkStudentVideoAccess(sCtx, a.videoId);

    const eligibility = evaluateStudentHomeworkEligibility({
      assignment: a,
      studentId: u.id,
      isStaff: sCtx.isStaff,
      approvedGradeIds: sCtx.approvedGradeIds,
      studentGroupIds: sCtx.studentGroupIds,
      activeCourseIds: sCtx.activeCourseIds,
      hasGradeAllEntitlement: sCtx.gradeAllIds.has(a.gradeId),
      targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
      targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
      hasVideoAccess,
      now,
    });
    if (!eligibility.eligible) {
      return res.status(403).json({ error: eligibility.reasonAr || 'غير مصرح لك بتسليم هذا الواجب' });
    }

    const assignmentQuestions = await db
      .select({
        id: homeworkQuestions.id,
        questionType: homeworkQuestions.questionType,
        choicesSnapshotJson: homeworkQuestions.choicesSnapshotJson,
      })
      .from(homeworkQuestions)
      .where(eq(homeworkQuestions.assignmentId, id));

    const structuredCheck = validateHomeworkStructuredAnswers(
      assignmentQuestions,
      body.structuredAnswers,
    );
    if (!structuredCheck.valid) {
      return res.status(400).json({ error: structuredCheck.errorAr || 'إجابات الأسئلة غير صالحة' });
    }

    if (
      !body.isDraft &&
      body.files.length === 0 &&
      !body.writtenAnswer.trim() &&
      structuredCheck.answeredCount === 0
    ) {
      return res.status(400).json({
        error: 'يرجى اختيار إجابات الأسئلة أو رفع صورة/ملف PDF للحل أو كتابة إجابة نصية قبل تسليم الواجب.',
      });
    }

    // Verify all referenced files exist and belong exclusively to this student
    const validatedFiles: Array<{
      storageKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      displayOrder: number;
    }> = [];

    if (body.files.length > 0) {
      const keys = body.files.map((f) => f.storageKey);
      const storedRows = await db
        .select({
          storageKey: homeworkStoredFiles.storageKey,
          ownerUserId: homeworkStoredFiles.ownerUserId,
          purpose: homeworkStoredFiles.purpose,
          mimeType: homeworkStoredFiles.mimeType,
          sizeBytes: homeworkStoredFiles.sizeBytes,
          originalName: homeworkStoredFiles.originalName,
        })
        .from(homeworkStoredFiles)
        .where(inArray(homeworkStoredFiles.storageKey, keys));

      const byKey = new Map(storedRows.map((r) => [r.storageKey, r]));
      for (let i = 0; i < body.files.length; i++) {
        const f = body.files[i];
        const stored = byKey.get(f.storageKey);
        if (!stored || stored.purpose !== 'SUBMISSION_FILE' || stored.ownerUserId !== u.id) {
          return res.status(403).json({
            error: `تعذر التحقق من ملكية الملف المرفوع (${f.fileName}). يرجى إعادة رفع الملف.`,
          });
        }
        validatedFiles.push({
          storageKey: stored.storageKey,
          fileName: f.fileName || stored.originalName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          displayOrder: f.displayOrder ?? i,
        });
      }
    }

    // Idempotency check (prevents duplicate submissions on double-click / network retry)
    if (body.clientSubmissionKey) {
      const [existingKeySub] = await db
        .select()
        .from(homeworkSubmissions)
        .where(
          and(
            eq(homeworkSubmissions.assignmentId, id),
            eq(homeworkSubmissions.studentId, u.id),
            eq(homeworkSubmissions.clientSubmissionKey, body.clientSubmissionKey),
          ),
        )
        .limit(1);
      if (existingKeySub) {
        return res.json({
          submissionId: existingKeySub.id,
          version: existingKeySub.version,
          status: existingKeySub.status,
          isLate: existingKeySub.isLate,
          deduplicated: true,
          message: 'تم استلام تسليمك بنجاح مسبقًا (منع التكرار).',
        });
      }
    }

    const existingSubs = await db
      .select()
      .from(homeworkSubmissions)
      .where(and(eq(homeworkSubmissions.assignmentId, id), eq(homeworkSubmissions.studentId, u.id)))
      .orderBy(desc(homeworkSubmissions.version));

    const submittedVersions = existingSubs.filter((s) => s.status !== 'DRAFT');
    const perm = evaluateSubmissionPermission({
      assignment: a,
      existingSubmittedVersions: submittedVersions.map((s) => ({
        version: s.version,
        status: s.status,
        isGradePublished: s.isGradePublished,
      })),
      now,
    });

    if (!perm.canSubmit) {
      return res.status(403).json({ error: perm.reasonAr || 'التسليم غير متاح لهذا الواجب حاليًا' });
    }

    // Draft handling: reuse an existing DRAFT row if present without touching any submitted version
    const existingDraft = existingSubs.find((s) => s.status === 'DRAFT') || null;
    const maxVersion = existingSubs.reduce((mx, s) => Math.max(mx, s.version), 0);

    const saved = await db.transaction(async (tx) => {
      if (body.isDraft && existingDraft) {
        await tx
          .update(homeworkSubmissions)
          .set({
            writtenAnswer: body.writtenAnswer,
            structuredAnswersJson: structuredCheck.normalized,
            updatedAt: now,
          })
          .where(eq(homeworkSubmissions.id, existingDraft.id));
        await tx
          .delete(homeworkSubmissionFiles)
          .where(eq(homeworkSubmissionFiles.submissionId, existingDraft.id));
        if (validatedFiles.length > 0) {
          await tx.insert(homeworkSubmissionFiles).values(
            validatedFiles.map((f) => ({
              submissionId: existingDraft.id,
              ...f,
            })),
          );
        }
        return existingDraft;
      }

      if (!body.isDraft && existingDraft) {
        // Promote existing draft into final submitted version
        const finalStatus = perm.isLate ? 'SUBMITTED_LATE' : 'SUBMITTED';
        const [promoted] = await tx
          .update(homeworkSubmissions)
          .set({
            writtenAnswer: body.writtenAnswer,
            structuredAnswersJson: structuredCheck.normalized,
            clientSubmissionKey: body.clientSubmissionKey || null,
            submittedAt: now,
            isLate: perm.isLate,
            status: finalStatus,
            updatedAt: now,
          })
          .where(eq(homeworkSubmissions.id, existingDraft.id))
          .returning();
        await tx
          .delete(homeworkSubmissionFiles)
          .where(eq(homeworkSubmissionFiles.submissionId, promoted.id));
        if (validatedFiles.length > 0) {
          await tx.insert(homeworkSubmissionFiles).values(
            validatedFiles.map((f) => ({
              submissionId: promoted.id,
              ...f,
            })),
          );
        }
        return promoted;
      }

      // Insert brand-new version row (NEVER overwrites previous submitted versions!)
      const nextVer = maxVersion + 1;
      const finalStatus = body.isDraft
        ? 'DRAFT'
        : perm.isLate
          ? 'SUBMITTED_LATE'
          : 'SUBMITTED';

      const [inserted] = await tx
        .insert(homeworkSubmissions)
        .values({
          assignmentId: id,
          studentId: u.id,
          version: nextVer,
          clientSubmissionKey: body.isDraft ? null : body.clientSubmissionKey || null,
          writtenAnswer: body.writtenAnswer,
          structuredAnswersJson: structuredCheck.normalized,
          submittedAt: body.isDraft ? null : now,
          isLate: body.isDraft ? false : perm.isLate,
          status: finalStatus,
        })
        .returning();

      if (validatedFiles.length > 0) {
        await tx.insert(homeworkSubmissionFiles).values(
          validatedFiles.map((f) => ({
            submissionId: inserted.id,
            ...f,
          })),
        );
      }

      return inserted;
    });

    return res.status(201).json({
      submissionId: saved.id,
      version: saved.version,
      status: saved.status,
      isLate: saved.isLate,
      message: body.isDraft
        ? 'تم حفظ المسودة بنجاح، يمكنك استكمالها قبل التسليم النهائي.'
        : saved.isLate
          ? `تم تسليم النسخة رقم ${saved.version} بنجاح (تسليم متأخر).`
          : `تم تسليم الواجب بنجاح (النسخة رقم ${saved.version}).`,
    });
  } catch (err) {
    console.error('Student homework submit error:', err);
    return res.status(500).json({ error: 'تعذر تسليم الواجب، يرجى المحاولة مرة أخرى' });
  }
});
