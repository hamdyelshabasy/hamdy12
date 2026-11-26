import express from 'express';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  academicTracks,
  choices,
  courseLessons,
  courseStudentBlocks,
  enrollments,
  entitlements,
  examAttempts,
  examQuestions,
  exams,
  grades,
  groupMembers,
  homeworkAssignments,
  homeworkModelAnswers,
  homeworkQuestions,
  homeworkSubmissions,
  homeworkTargets,
  lessons,
  questionAttachments,
  questionBankFiles,
  questionRevisions,
  questions,
  roles,
  units,
  users,
  videos,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isAccountActive,
  isStaffRole,
} from '../../lib/permissions.ts';
import {
  type AuthRequest,
  optionalAuth,
  requireAuth,
  requirePermission,
  requireStaff,
  resolveEffectiveRolePermissions,
} from '../../middleware/auth.ts';
import { logAudit } from '../audit.ts';
import { evaluateModelAnswerRelease, evaluateStudentHomeworkEligibility } from '../domain/homework.ts';
import {
  ALLOWED_DIFFICULTIES,
  ALLOWED_QUESTION_TYPES,
  QUESTION_BANK_MAX_BULK_BATCH,
  QUESTION_BANK_MAX_MODEL_ANSWER_FILES,
  QUESTION_BANK_MAX_QUESTION_IMAGES,
  buildSignedQuestionBankFileUrl,
  canStaffEditBankQuestion,
  computePagination,
  evaluateStatusTransition,
  formatBankCode,
  generateQuestionBankStorageKey,
  normalizeTags,
  validateBankQuestionPayload,
  validateBulkBatchInput,
  validateQuestionBankFileUpload,
  verifyQuestionBankFileToken,
} from '../domain/questionBank.ts';
import type { QuestionApprovalStatus } from '../../types/questionBank.ts';

export const questionBankFilesRouter = express.Router();
export const adminQuestionBankRouter = express.Router();

const uploadJsonParser = express.json({ limit: '12mb' });

const VIEW_PERMS = [
  PERMISSIONS.QUESTION_BANK_VIEW,
  PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
  PERMISSIONS.QUESTION_BANK_REVIEW,
  PERMISSIONS.QUESTION_BANK_MANAGE,
  PERMISSIONS.EXAMS_MANAGE,
  PERMISSIONS.HOMEWORK_MANAGE,
] as const;

const CONTRIBUTE_PERMS = [
  PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
  PERMISSIONS.QUESTION_BANK_REVIEW,
  PERMISSIONS.QUESTION_BANK_MANAGE,
] as const;

const REVIEW_PERMS = [
  PERMISSIONS.QUESTION_BANK_REVIEW,
  PERMISSIONS.QUESTION_BANK_MANAGE,
] as const;

// =========================================================================
// HELPER: Validate Track / Grade / Unit / Lesson Academic Compatibility
// =========================================================================
async function resolveAndValidateAcademicPath(input: {
  trackId?: number | null;
  gradeId: number;
  unitId?: number | null;
  lessonId?: number | null;
}): Promise<
  | { ok: true; trackId: number; gradeId: number; unitId: number | null; lessonId: number | null }
  | { ok: false; errorAr: string }
> {
  const [grade] = await db.select().from(grades).where(eq(grades.id, input.gradeId)).limit(1);
  if (!grade) {
    return { ok: false, errorAr: 'الصف الدراسي المحدد غير موجود.' };
  }
  if (input.trackId && grade.trackId !== input.trackId) {
    return { ok: false, errorAr: 'الصف الدراسي المختار لا يتبع المسار التعليمي المحدد.' };
  }

  let resolvedUnitId = input.unitId ?? null;
  let resolvedLessonId = input.lessonId ?? null;

  if (resolvedLessonId) {
    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, resolvedLessonId))
      .limit(1);
    if (!lesson) {
      return { ok: false, errorAr: 'الدرس المحدد غير موجود.' };
    }
    if (resolvedUnitId && lesson.unitId !== resolvedUnitId) {
      return { ok: false, errorAr: 'الدرس المختار لا ينتمي إلى الوحدة الدراسية المحددة.' };
    }
    resolvedUnitId = lesson.unitId;
  }

  if (resolvedUnitId) {
    const [unit] = await db.select().from(units).where(eq(units.id, resolvedUnitId)).limit(1);
    if (!unit) {
      return { ok: false, errorAr: 'الوحدة الدراسية المحددة غير موجودة.' };
    }
    if (unit.gradeId !== grade.id) {
      return { ok: false, errorAr: 'الوحدة الدراسية لا تنتمي إلى الصف الدراسي المحدد.' };
    }
  }

  return {
    ok: true,
    trackId: grade.trackId,
    gradeId: grade.id,
    unitId: resolvedUnitId,
    lessonId: resolvedLessonId,
  };
}

// =========================================================================
// HELPER: Build Usage Counts Map for a list of central bank question IDs
// =========================================================================
async function loadUsageCounts(bankQuestionIds: number[]): Promise<{
  examUsageByBankId: Map<number, number>;
  homeworkUsageByBankId: Map<number, number>;
}> {
  const examUsageByBankId = new Map<number, number>();
  const homeworkUsageByBankId = new Map<number, number>();
  if (!bankQuestionIds.length) {
    return { examUsageByBankId, homeworkUsageByBankId };
  }

  // 1. Exams usage: direct exam_questions OR cloned exam questions with sourceBankQuestionId
  const clonedRows = await db
    .select({ id: questions.id, sourceBankQuestionId: questions.sourceBankQuestionId })
    .from(questions)
    .where(inArray(questions.sourceBankQuestionId, bankQuestionIds));

  const cloneToBank = new Map<number, number>();
  for (const c of clonedRows) {
    if (c.sourceBankQuestionId) cloneToBank.set(c.id, c.sourceBankQuestionId);
  }

  const allRelevantQIds = Array.from(new Set([...bankQuestionIds, ...clonedRows.map((c) => c.id)]));
  const eqLinks = allRelevantQIds.length
    ? await db
        .select({ examId: examQuestions.examId, questionId: examQuestions.questionId })
        .from(examQuestions)
        .where(inArray(examQuestions.questionId, allRelevantQIds))
    : [];

  const examSetByBankId = new Map<number, Set<number>>();
  for (const link of eqLinks) {
    const bankId = cloneToBank.get(link.questionId) ?? link.questionId;
    if (!bankQuestionIds.includes(bankId)) continue;
    const set = examSetByBankId.get(bankId) || new Set<number>();
    set.add(link.examId);
    examSetByBankId.set(bankId, set);
  }
  for (const [bid, set] of examSetByBankId.entries()) {
    examUsageByBankId.set(bid, set.size);
  }

  // 2. Homework usage: distinct homeworkAssignments referencing bankQuestionId
  const hwLinks = await db
    .select({
      assignmentId: homeworkQuestions.assignmentId,
      bankQuestionId: homeworkQuestions.bankQuestionId,
    })
    .from(homeworkQuestions)
    .where(inArray(homeworkQuestions.bankQuestionId, bankQuestionIds));

  const hwSetByBankId = new Map<number, Set<number>>();
  for (const link of hwLinks) {
    if (!link.bankQuestionId) continue;
    const set = hwSetByBankId.get(link.bankQuestionId) || new Set<number>();
    set.add(link.assignmentId);
    hwSetByBankId.set(link.bankQuestionId, set);
  }
  for (const [bid, set] of hwSetByBankId.entries()) {
    homeworkUsageByBankId.set(bid, set.size);
  }

  return { examUsageByBankId, homeworkUsageByBankId };
}

// =========================================================================
// 1. PRIVATE PROTECTED FILE STREAMING (/api/question-bank/files/:storageKey)
// =========================================================================
questionBankFilesRouter.get('/files/:storageKey', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const storageKey = String(req.params.storageKey || '').trim();
    if (!storageKey || !storageKey.startsWith('qbf_')) {
      return res.status(400).json({ error: 'مرجع الملف غير صالح' });
    }

    let requesterUserId: number | null = req.authUser?.id ?? null;
    let requesterRoleSlug: string | null = req.authUser?.roleSlug ?? null;
    let tokenContext: 'bank' | 'exam' | 'homework' = 'bank';
    let tokenResourceId: number | null = null;
    let tokenFileRole: 'question' | 'model_answer' = 'question';

    const rawToken = typeof req.query.token === 'string' ? req.query.token : '';
    if (rawToken) {
      const verified = verifyQuestionBankFileToken(rawToken);
      if (!verified || verified.storageKey !== storageKey) {
        return res.status(403).json({ error: 'رابط الملف غير صالح أو منتهي الصلاحية' });
      }
      requesterUserId = verified.userId;
      requesterRoleSlug = verified.roleSlug;
      tokenContext = verified.context;
      tokenResourceId = verified.resourceId;
      tokenFileRole = verified.fileRole;
    } else if (!requesterUserId) {
      return res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض هذا الملف' });
    }

    // Always verify live user + role + effective permissions from DB (prevents stale token role or unauthorized staff access)
    const [dbUserRole] = await db
      .select({
        id: users.id,
        status: users.status,
        roleSlug: roles.slug,
        permissionsJson: roles.permissionsJson,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, requesterUserId!))
      .limit(1);
    if (!dbUserRole || !isAccountActive(dbUserRole.status)) {
      return res.status(403).json({ error: 'الحساب غير نشط أو تم إيقافه' });
    }

    requesterRoleSlug = dbUserRole.roleSlug;
    const effectivePermissions = resolveEffectiveRolePermissions(
      dbUserRole.roleSlug,
      dbUserRole.permissionsJson,
    );

    const [fileRow] = await db
      .select()
      .from(questionBankFiles)
      .where(eq(questionBankFiles.storageKey, storageKey))
      .limit(1);
    if (!fileRow) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    const isStaff = isStaffRole(requesterRoleSlug);

    if (isStaff) {
      const canAccessBankFiles = hasAnyPermission(
        {
          roleSlug: requesterRoleSlug,
          status: dbUserRole.status,
          permissions: effectivePermissions,
        },
        [...VIEW_PERMS, PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_GRADE, PERMISSIONS.HOMEWORK_VIEW, PERMISSIONS.HOMEWORK_GRADE],
      );
      if (!canAccessBankFiles) {
        return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى ملفات بنك الأسئلة.' });
      }
    }

    if (!isStaff) {
      // STRICT STUDENT ACCESS CONTROL:
      // 1. Students can NEVER access raw central bank files directly
      if (tokenContext === 'bank' || !tokenResourceId) {
        return res.status(403).json({ error: 'غير مصرح للطلاب بالوصول المباشر لملفات بنك الأسئلة' });
      }

      const isModelAnswerFile =
        tokenFileRole === 'model_answer' || fileRow.purpose === 'MODEL_ANSWER_FILE';

      if (tokenContext === 'exam') {
        const [examRow] = await db
          .select()
          .from(exams)
          .where(eq(exams.id, tokenResourceId))
          .limit(1);
        if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

        // Verify this file is actually attached to a question inside this exam
        const examQRows = await db
          .select({ questionId: examQuestions.questionId })
          .from(examQuestions)
          .where(eq(examQuestions.examId, examRow.id));
        const examQIds = examQRows.map((r) => r.questionId);
        if (!examQIds.length) return res.status(403).json({ error: 'غير مصرح بالوصول' });

        const matchedAtt = await db
          .select()
          .from(questionAttachments)
          .where(
            and(
              inArray(questionAttachments.questionId, examQIds),
              eq(questionAttachments.storageKey, storageKey),
            ),
          )
          .limit(1);
        if (!matchedAtt.length) {
          return res.status(403).json({ error: 'هذا الملف غير مرتبط بهذا الامتحان' });
        }

        const studentAttempts = await db
          .select()
          .from(examAttempts)
          .where(and(eq(examAttempts.examId, examRow.id), eq(examAttempts.userId, requesterUserId!)));
        if (!studentAttempts.length) {
          return res.status(403).json({ error: 'غير مصرح بعرض صور امتحان لم تبدأه بعد' });
        }

        // Strict model answer protection for exams
        if (isModelAnswerFile || matchedAtt[0].attachmentRole !== 'QUESTION_IMAGE') {
          const canReveal =
            examRow.allowStudentReview &&
            examRow.showCorrectAnswers &&
            studentAttempts.some((a) => a.status !== 'IN_PROGRESS' && a.resultPublished);
          if (!canReveal) {
            return res.status(403).json({ error: 'نموذج الإجابة غير متاح للعرض حاليًا' });
          }
        }
      } else if (tokenContext === 'homework') {
        const [assignment] = await db
          .select()
          .from(homeworkAssignments)
          .where(eq(homeworkAssignments.id, tokenResourceId))
          .limit(1);
        if (!assignment) return res.status(404).json({ error: 'الواجب غير موجود' });

        // Verify student eligibility for this homework assignment
        const [enrs, grps, ents, targets, blocks] = await Promise.all([
          db
            .select()
            .from(enrollments)
            .where(and(eq(enrollments.userId, requesterUserId!), eq(enrollments.status, 'ACTIVE'))),
          db.select().from(groupMembers).where(eq(groupMembers.userId, requesterUserId!)),
          db
            .select()
            .from(entitlements)
            .where(and(eq(entitlements.userId, requesterUserId!), eq(entitlements.isRevoked, false))),
          db.select().from(homeworkTargets).where(eq(homeworkTargets.assignmentId, assignment.id)),
          db
            .select()
            .from(courseStudentBlocks)
            .where(
              and(
                eq(courseStudentBlocks.userId, requesterUserId!),
                eq(courseStudentBlocks.isActive, true),
              ),
            ),
        ]);

        const now = new Date();
        const blockedCourseIds = new Set(blocks.map((b) => b.courseId));
        if (assignment.courseId && blockedCourseIds.has(assignment.courseId)) {
          return res.status(403).json({ error: 'تم إيقاف وصولك إلى هذا الكورس حاليًا' });
        }

        const activeEnts = ents.filter(
          (e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now.getTime(),
        );
        const approvedGradeIds = enrs.map((e) => e.gradeId);
        const studentGroupIds = grps.map((g) => g.groupId);
        const activeCourseIds = activeEnts
          .filter((e) => e.targetType === 'COURSE' && !blockedCourseIds.has(e.targetId))
          .map((e) => e.targetId);
        const hasGradeAll = activeEnts.some(
          (e) => e.targetType === 'GRADE_ALL' && e.targetId === assignment.gradeId,
        );

        let hasVideoAccess = true;
        if (assignment.videoId) {
          const [vid] = await db
            .select()
            .from(videos)
            .where(eq(videos.id, assignment.videoId))
            .limit(1);
          if (vid && vid.videoType !== 'FREE') {
            const directCourseMatch = Boolean(vid.courseId && activeCourseIds.includes(vid.courseId));
            let lessonCourseMatch = false;
            if (!directCourseMatch && activeCourseIds.length > 0) {
              const linkedCourses = await db
                .select({ courseId: courseLessons.courseId })
                .from(courseLessons)
                .where(eq(courseLessons.lessonId, vid.lessonId));
              lessonCourseMatch = linkedCourses.some((lc) => activeCourseIds.includes(lc.courseId));
            }
            const blockedByDirectCourse = Boolean(vid.courseId && blockedCourseIds.has(vid.courseId));
            hasVideoAccess =
              !blockedByDirectCourse &&
              (hasGradeAll ||
                directCourseMatch ||
                lessonCourseMatch ||
                activeEnts.some((e) => e.targetType === 'VIDEO' && e.targetId === vid.id));
          }
        }

        const eligibility = evaluateStudentHomeworkEligibility({
          assignment,
          studentId: requesterUserId!,
          isStaff: false,
          approvedGradeIds,
          studentGroupIds,
          activeCourseIds,
          hasGradeAllEntitlement: hasGradeAll,
          targetStudentIds: targets.map((t) => t.studentId).filter((x): x is number => Boolean(x)),
          targetGroupIds: targets.map((t) => t.groupId).filter((x): x is number => Boolean(x)),
          hasVideoAccess,
          now,
        });
        if (!eligibility.eligible) {
          return res.status(403).json({ error: eligibility.reasonAr || 'غير مصرح بالوصول لهذا الواجب' });
        }

        // Verify the file is referenced in this assignment's homework_questions snapshot
        const hwQs = await db
          .select()
          .from(homeworkQuestions)
          .where(eq(homeworkQuestions.assignmentId, assignment.id));

        const inQuestionImages = hwQs.some((q) =>
          (q.questionImagesJson || []).some((img) => img.storageKey === storageKey),
        );
        const inModelAnswerFiles = hwQs.some((q) =>
          (q.modelAnswerFilesJson || []).some((f) => f.storageKey === storageKey),
        );

        if (!inQuestionImages && !inModelAnswerFiles) {
          return res.status(403).json({ error: 'هذا الملف غير مرتبط بهذا الواجب' });
        }

        // If model answer file -> strictly enforce homework model answer release policy!
        if (isModelAnswerFile || (!inQuestionImages && inModelAnswerFiles)) {
          const [ma] = await db
            .select()
            .from(homeworkModelAnswers)
            .where(eq(homeworkModelAnswers.assignmentId, assignment.id))
            .limit(1);

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
            policy: ma?.visibilityPolicy || 'HIDDEN',
            releaseAt: ma?.releaseAt || null,
            manuallyReleased: Boolean(ma?.manuallyReleased),
            assignmentDeadline: assignment.deadline,
            hasStudentSubmitted: hasSubmitted,
            isStudentGradedAndPublished: isGraded,
            isStaff: false,
            now,
          });
          if (!release.isReleased) {
            return res.status(403).json({ error: release.reasonAr });
          }
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
    console.error('Private question bank file stream error:', err);
    return res.status(500).json({ error: 'تعذر تحميل الملف المطلوب' });
  }
});

// =========================================================================
// 2. ADMIN & TA QUESTION BANK ROUTES (/api/admin/question-bank/*)
// =========================================================================
adminQuestionBankRouter.use(requireAuth, requireStaff());

// 2A. Secure File Upload (Question Image or Model Answer Image/PDF)
const uploadPayloadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().optional(),
  dataBase64: z.string().min(10),
  purpose: z.enum(['QUESTION_IMAGE', 'MODEL_ANSWER_FILE']).default('QUESTION_IMAGE'),
});

adminQuestionBankRouter.post(
  '/files/upload',
  requirePermission(CONTRIBUTE_PERMS),
  uploadJsonParser,
  async (req: AuthRequest, res) => {
    try {
      const parsed = uploadPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'بيانات الملف المرفوع غير مكتملة' });
      }

      const validated = validateQuestionBankFileUpload({
        fileName: parsed.data.fileName,
        declaredMimeType: parsed.data.mimeType,
        dataBase64: parsed.data.dataBase64,
        purpose: parsed.data.purpose,
      });

      if (!validated.ok) {
        return res.status(400).json({ error: validated.errorAr });
      }

      // Check for duplicate SHA-256 hash WITHOUT auto-deleting
      const existingDupFiles = await db
        .select({ storageKey: questionBankFiles.storageKey })
        .from(questionBankFiles)
        .where(eq(questionBankFiles.sha256Hash, validated.sha256Hash))
        .limit(10);

      let duplicateWarning: {
        isDuplicate: boolean;
        matchCount: number;
        sampleQuestionIds: number[];
        messageAr: string;
      } | null = null;

      if (existingDupFiles.length > 0) {
        const dupKeys = existingDupFiles.map((f) => f.storageKey);
        const dupAtts = await db
          .select({ questionId: questionAttachments.questionId })
          .from(questionAttachments)
          .where(inArray(questionAttachments.storageKey, dupKeys))
          .limit(10);
        const sampleIds = Array.from(new Set(dupAtts.map((a) => a.questionId))).slice(0, 3);
        duplicateWarning = {
          isDuplicate: true,
          matchCount: existingDupFiles.length,
          sampleQuestionIds: sampleIds,
          messageAr:
            sampleIds.length > 0
              ? `تنبيه: تم رفع صورة مطابقة سابقًا (مرتبطة بالأسئلة رقم: ${sampleIds.map((id) => formatBankCode(id)).join('، ')}). يمكنك المتابعة إذا كان ذلك مقصودًا.`
              : 'تنبيه: تم رفع ملف مطابق لهذا الملف سابقًا في بنك الأسئلة. يمكنك المتابعة إذا كان ذلك مقصودًا.',
        };
      }

      const storageKey = generateQuestionBankStorageKey();
      await db.insert(questionBankFiles).values({
        storageKey,
        uploadedById: req.authUser!.id,
        purpose: parsed.data.purpose,
        originalName: validated.sanitizedFileName,
        mimeType: validated.detectedMimeType,
        sizeBytes: validated.sizeBytes,
        sha256Hash: validated.sha256Hash,
        dataBase64: validated.cleanBase64,
      });

      const previewUrl = buildSignedQuestionBankFileUrl({
        storageKey,
        userId: req.authUser!.id,
        roleSlug: req.authUser!.roleSlug,
        context: 'bank',
        fileRole: parsed.data.purpose === 'MODEL_ANSWER_FILE' ? 'model_answer' : 'question',
      });

      return res.status(201).json({
        storageKey,
        fileName: validated.sanitizedFileName,
        mimeType: validated.detectedMimeType,
        sizeBytes: validated.sizeBytes,
        sha256Hash: validated.sha256Hash,
        previewUrl,
        duplicateWarning,
      });
    } catch (err) {
      console.error('Question bank file upload error:', err);
      return res.status(500).json({ error: 'تعذر رفع الملف وحفظه بأمان' });
    }
  },
);

// 2B. Question Bank Statistics Summary
adminQuestionBankRouter.get('/stats', requirePermission(VIEW_PERMS), async (req: AuthRequest, res) => {
  try {
    const bankRows = await db
      .select({
        id: questions.id,
        approvalStatus: questions.approvalStatus,
        isArchived: questions.isArchived,
        imageUrl: questions.imageUrl,
        modelAnswerAr: questions.modelAnswerAr,
        createdById: questions.createdById,
      })
      .from(questions)
      .where(eq(questions.isBankItem, true));

    const bankIds = bankRows.map((r) => r.id);
    const attRows = bankIds.length
      ? await db
          .select({
            questionId: questionAttachments.questionId,
            attachmentRole: questionAttachments.attachmentRole,
          })
          .from(questionAttachments)
          .where(inArray(questionAttachments.questionId, bankIds))
      : [];

    const hasQImgSet = new Set<number>();
    const hasMaFileSet = new Set<number>();
    for (const a of attRows) {
      if (a.attachmentRole === 'QUESTION_IMAGE') hasQImgSet.add(a.questionId);
      else hasMaFileSet.add(a.questionId);
    }

    let draft = 0;
    let pendingReview = 0;
    let approved = 0;
    let returned = 0;
    let archived = 0;
    let withImages = 0;
    let withModelAnswer = 0;
    let myContributions = 0;

    for (const r of bankRows) {
      if (r.isArchived || r.approvalStatus === 'ARCHIVED') archived++;
      else if (r.approvalStatus === 'DRAFT') draft++;
      else if (r.approvalStatus === 'PENDING_REVIEW') pendingReview++;
      else if (r.approvalStatus === 'RETURNED') returned++;
      else approved++;

      if (hasQImgSet.has(r.id) || (r.imageUrl && r.imageUrl.trim())) withImages++;
      if (hasMaFileSet.has(r.id) || (r.modelAnswerAr && r.modelAnswerAr.trim())) withModelAnswer++;
      if (r.createdById === req.authUser!.id) myContributions++;
    }

    return res.json({
      total: bankRows.length,
      draft,
      pendingReview,
      approved,
      returned,
      archived,
      withImages,
      withModelAnswer,
      myContributions,
    });
  } catch (err) {
    console.error('Question bank stats error:', err);
    return res.status(500).json({ error: 'تعذر تحميل إحصائيات بنك الأسئلة' });
  }
});

// 2C. Paginated Question Bank Listing + Filtering
adminQuestionBankRouter.get('/', requirePermission(VIEW_PERMS), async (req: AuthRequest, res) => {
  try {
    const { page, pageSize, offset } = computePagination(req.query.page, req.query.pageSize);
    const search = String(req.query.search || '').trim().toLowerCase();
    const trackId = Number(req.query.trackId || 0);
    const gradeId = Number(req.query.gradeId || 0);
    const unitId = Number(req.query.unitId || 0);
    const lessonId = Number(req.query.lessonId || 0);
    const questionType = String(req.query.questionType || 'ALL').toUpperCase();
    const difficulty = String(req.query.difficulty || 'ALL').toUpperCase();
    const approvalStatus = String(req.query.approvalStatus || 'ALL').toUpperCase();
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const approvedOnly = req.query.approvedOnly === '1' || req.query.approvedOnly === 'true';
    const hasImagesFilter = req.query.hasImages === '1';
    const hasModelAnswerFilter = req.query.hasModelAnswer === '1';
    const createdByMe = req.query.createdByMe === '1';
    const includeArchived = req.query.includeArchived === '1' || approvalStatus === 'ARCHIVED';

    const [allBankQuestions, allTracks, allGrades, allUnits, allLessons, allUsers] =
      await Promise.all([
        db
          .select()
          .from(questions)
          .where(eq(questions.isBankItem, true))
          .orderBy(desc(questions.updatedAt), desc(questions.id)),
        db.select().from(academicTracks),
        db.select().from(grades),
        db.select().from(units),
        db.select().from(lessons),
        db.select({ id: users.id, fullName: users.fullName }).from(users),
      ]);

    const trackById = new Map(allTracks.map((t) => [t.id, t]));
    const gradeById = new Map(allGrades.map((g) => [g.id, g]));
    const unitById = new Map(allUnits.map((u) => [u.id, u]));
    const lessonById = new Map(allLessons.map((l) => [l.id, l]));
    const userById = new Map(allUsers.map((u) => [u.id, u.fullName]));

    const allIds = allBankQuestions.map((q) => q.id);
    const allAtts = allIds.length
      ? await db
          .select()
          .from(questionAttachments)
          .where(inArray(questionAttachments.questionId, allIds))
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id))
      : [];

    const attByQId = new Map<number, (typeof allAtts)[number][]>();
    for (const att of allAtts) {
      const list = attByQId.get(att.questionId) || [];
      list.push(att);
      attByQId.set(att.questionId, list);
    }

    const filtered = allBankQuestions.filter((q) => {
      const grade = gradeById.get(q.gradeId);
      const effectiveTrackId = q.trackId ?? grade?.trackId ?? null;
      const effectiveArchived = q.isArchived || q.approvalStatus === 'ARCHIVED';

      if (approvedOnly) {
        if (effectiveArchived || q.approvalStatus !== 'APPROVED') return false;
      } else {
        if (!includeArchived && effectiveArchived) return false;
        if (approvalStatus !== 'ALL') {
          if (approvalStatus === 'ARCHIVED') {
            if (!effectiveArchived) return false;
          } else if (effectiveArchived || q.approvalStatus !== approvalStatus) {
            return false;
          }
        }
      }

      if (trackId && effectiveTrackId !== trackId) return false;
      if (gradeId && q.gradeId !== gradeId) return false;
      if (unitId && q.unitId !== unitId) return false;
      if (lessonId && q.lessonId !== lessonId) return false;
      if (questionType !== 'ALL' && q.questionType !== questionType) return false;
      if (difficulty !== 'ALL' && q.difficulty !== difficulty) return false;
      if (createdByMe && q.createdById !== req.authUser!.id) return false;

      const qAtts = attByQId.get(q.id) || [];
      const qImages = qAtts.filter((a) => a.attachmentRole === 'QUESTION_IMAGE');
      const maFiles = qAtts.filter((a) => a.attachmentRole !== 'QUESTION_IMAGE');
      const hasImg = qImages.length > 0 || Boolean(q.imageUrl && q.imageUrl.trim());
      const hasMa = maFiles.length > 0 || Boolean(q.modelAnswerAr && q.modelAnswerAr.trim());

      if (hasImagesFilter && !hasImg) return false;
      if (hasModelAnswerFilter && !hasMa) return false;

      const tags = Array.isArray(q.tagsJson) ? q.tagsJson : [];
      if (tag && !tags.some((t) => t.toLowerCase().includes(tag))) return false;

      if (search) {
        const code = (q.bankCode || formatBankCode(q.id)).toLowerCase();
        const hay = [
          String(q.id),
          code,
          q.promptAr || '',
          q.topicAr || '',
          q.sourceAr || '',
          tags.join(' '),
          unitById.get(q.unitId || 0)?.titleAr || '',
          lessonById.get(q.lessonId || 0)?.titleAr || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }

      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const paged = filtered.slice(offset, offset + pageSize);
    const pagedIds = paged.map((q) => q.id);

    const { examUsageByBankId, homeworkUsageByBankId } = await loadUsageCounts(pagedIds);

    const actor = req.authUser!;
    const hasManage = hasPermission(actor, PERMISSIONS.QUESTION_BANK_MANAGE);
    const hasReview = hasPermission(actor, PERMISSIONS.QUESTION_BANK_REVIEW);
    const hasContribute = hasPermission(actor, PERMISSIONS.QUESTION_BANK_CONTRIBUTE);

    const items = paged.map((q) => {
      const grade = gradeById.get(q.gradeId);
      const effectiveTrackId = q.trackId ?? grade?.trackId ?? null;
      const qAtts = attByQId.get(q.id) || [];
      const qImages = qAtts
        .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
        .map((a) => ({
          id: a.id,
          attachmentRole: a.attachmentRole as 'QUESTION_IMAGE',
          storageKey: a.storageKey,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          captionAr: a.captionAr,
          displayOrder: a.displayOrder,
          previewUrl: buildSignedQuestionBankFileUrl({
            storageKey: a.storageKey,
            userId: actor.id,
            roleSlug: actor.roleSlug,
            context: 'bank',
            fileRole: 'question',
          }),
        }));
      const maFilesCount = qAtts.filter((a) => a.attachmentRole !== 'QUESTION_IMAGE').length;
      const hasModelAnswerText = Boolean(q.modelAnswerAr && q.modelAnswerAr.trim());

      const editCheck = canStaffEditBankQuestion({
        actorId: actor.id,
        hasManage,
        hasReview,
        hasContribute,
        question: {
          createdById: q.createdById,
          approvalStatus: q.approvalStatus,
          isArchived: q.isArchived,
        },
      });

      return {
        id: q.id,
        bankCode: q.bankCode || formatBankCode(q.id),
        trackId: effectiveTrackId,
        trackNameAr: effectiveTrackId ? trackById.get(effectiveTrackId)?.nameAr || '' : '',
        gradeId: q.gradeId,
        gradeNameAr: grade?.nameAr || '',
        unitId: q.unitId,
        unitTitleAr: q.unitId ? unitById.get(q.unitId)?.titleAr || null : null,
        lessonId: q.lessonId,
        lessonTitleAr: q.lessonId ? lessonById.get(q.lessonId)?.titleAr || null : null,
        topicAr: q.topicAr || '',
        questionType: q.questionType,
        difficulty: q.difficulty,
        promptAr: q.promptAr,
        latexFormula: q.latexFormula,
        imageUrl: q.imageUrl,
        points: q.points,
        sourceAr: q.sourceAr || '',
        tags: Array.isArray(q.tagsJson) ? q.tagsJson : [],
        approvalStatus: (q.isArchived ? 'ARCHIVED' : q.approvalStatus) as QuestionApprovalStatus,
        reviewFeedbackAr: q.reviewFeedbackAr || '',
        isArchived: q.isArchived,
        version: q.version,
        createdById: q.createdById,
        createdByName: q.createdById ? userById.get(q.createdById) || 'غير محدد' : 'النظام / الأستاذ',
        reviewedById: q.reviewedById,
        reviewedByName: q.reviewedById ? userById.get(q.reviewedById) || null : null,
        reviewedAt: q.reviewedAt ? q.reviewedAt.toISOString() : null,
        questionImages: qImages,
        modelAnswerFilesCount: maFilesCount,
        hasModelAnswerText,
        hasModelAnswer: maFilesCount > 0 || hasModelAnswerText,
        examsUsageCount: examUsageByBankId.get(q.id) || 0,
        homeworkUsageCount: homeworkUsageByBankId.get(q.id) || 0,
        canEdit: editCheck.allowed,
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
      };
    });

    return res.json({
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (err) {
    console.error('Question bank list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل بنك الأسئلة' });
  }
});

// 2D. Get Single Question Full Detail (including Model Answer files, Choices & Revision History)
adminQuestionBankRouter.get('/:id', requirePermission(VIEW_PERMS), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف السؤال غير صالح' });
    }

    const [q] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.id, id), eq(questions.isBankItem, true)))
      .limit(1);
    if (!q) return res.status(404).json({ error: 'السؤال غير موجود في بنك الأسئلة' });

    const [grade] = await db.select().from(grades).where(eq(grades.id, q.gradeId)).limit(1);
    const effectiveTrackId = q.trackId ?? grade?.trackId ?? null;

    const [[track], [unit], [lesson], qChoices, qAtts, revisions, usage, allUsers] =
      await Promise.all([
        effectiveTrackId
          ? db.select().from(academicTracks).where(eq(academicTracks.id, effectiveTrackId)).limit(1)
          : Promise.resolve([null]),
        q.unitId ? db.select().from(units).where(eq(units.id, q.unitId)).limit(1) : Promise.resolve([null]),
        q.lessonId ? db.select().from(lessons).where(eq(lessons.id, q.lessonId)).limit(1) : Promise.resolve([null]),
        db
          .select()
          .from(choices)
          .where(eq(choices.questionId, q.id))
          .orderBy(asc(choices.sortOrder), asc(choices.id)),
        db
          .select()
          .from(questionAttachments)
          .where(eq(questionAttachments.questionId, q.id))
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id)),
        db
          .select()
          .from(questionRevisions)
          .where(eq(questionRevisions.questionId, q.id))
          .orderBy(desc(questionRevisions.createdAt), desc(questionRevisions.id))
          .limit(30),
        loadUsageCounts([q.id]),
        db.select({ id: users.id, fullName: users.fullName }).from(users),
      ]);

    const userById = new Map(allUsers.map((u) => [u.id, u.fullName]));
    const actor = req.authUser!;
    const hasManage = hasPermission(actor, PERMISSIONS.QUESTION_BANK_MANAGE);
    const hasReview = hasPermission(actor, PERMISSIONS.QUESTION_BANK_REVIEW);
    const hasContribute = hasPermission(actor, PERMISSIONS.QUESTION_BANK_CONTRIBUTE);

    const editCheck = canStaffEditBankQuestion({
      actorId: actor.id,
      hasManage,
      hasReview,
      hasContribute,
      question: {
        createdById: q.createdById,
        approvalStatus: q.approvalStatus,
        isArchived: q.isArchived,
      },
    });

    const questionImages = qAtts
      .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
      .map((a) => ({
        id: a.id,
        attachmentRole: a.attachmentRole,
        storageKey: a.storageKey,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        captionAr: a.captionAr,
        displayOrder: a.displayOrder,
        previewUrl: buildSignedQuestionBankFileUrl({
          storageKey: a.storageKey,
          userId: actor.id,
          roleSlug: actor.roleSlug,
          context: 'bank',
          fileRole: 'question',
        }),
      }));

    const modelAnswerFiles = qAtts
      .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
      .map((a) => ({
        id: a.id,
        attachmentRole: a.attachmentRole,
        storageKey: a.storageKey,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        captionAr: a.captionAr,
        displayOrder: a.displayOrder,
        previewUrl: buildSignedQuestionBankFileUrl({
          storageKey: a.storageKey,
          userId: actor.id,
          roleSlug: actor.roleSlug,
          context: 'bank',
          fileRole: 'model_answer',
        }),
      }));

    const hasModelAnswerText = Boolean(q.modelAnswerAr && q.modelAnswerAr.trim());

    return res.json({
      id: q.id,
      bankCode: q.bankCode || formatBankCode(q.id),
      trackId: effectiveTrackId,
      trackNameAr: track?.nameAr || '',
      gradeId: q.gradeId,
      gradeNameAr: grade?.nameAr || '',
      unitId: q.unitId,
      unitTitleAr: unit?.titleAr || null,
      lessonId: q.lessonId,
      lessonTitleAr: lesson?.titleAr || null,
      topicAr: q.topicAr || '',
      questionType: q.questionType,
      difficulty: q.difficulty,
      promptAr: q.promptAr,
      latexFormula: q.latexFormula,
      imageUrl: q.imageUrl,
      points: q.points,
      negativePoints: Number(q.negativePoints || 0),
      numericAnswer: q.numericAnswer !== null ? String(q.numericAnswer) : '',
      numericTolerance: q.numericTolerance !== null ? String(q.numericTolerance) : '0.05',
      numericUnit: q.numericUnit || '',
      shortAnswerRules: Array.isArray(q.shortAnswerRulesJson) ? q.shortAnswerRulesJson : [],
      modelAnswerAr: q.modelAnswerAr || '',
      explanationAr: q.explanationAr || '',
      sourceAr: q.sourceAr || '',
      teacherNotesAr: q.teacherNotesAr || '',
      tags: Array.isArray(q.tagsJson) ? q.tagsJson : [],
      approvalStatus: (q.isArchived ? 'ARCHIVED' : q.approvalStatus) as QuestionApprovalStatus,
      reviewFeedbackAr: q.reviewFeedbackAr || '',
      isArchived: q.isArchived,
      version: q.version,
      createdById: q.createdById,
      createdByName: q.createdById ? userById.get(q.createdById) || 'غير محدد' : 'النظام / الأستاذ',
      reviewedById: q.reviewedById,
      reviewedByName: q.reviewedById ? userById.get(q.reviewedById) || null : null,
      reviewedAt: q.reviewedAt ? q.reviewedAt.toISOString() : null,
      questionImages,
      modelAnswerFiles,
      modelAnswerFilesCount: modelAnswerFiles.length,
      hasModelAnswerText,
      hasModelAnswer: modelAnswerFiles.length > 0 || hasModelAnswerText,
      choices: qChoices.map((c) => ({
        id: c.id,
        labelAr: c.labelAr,
        latexFormula: c.latexFormula,
        isCorrect: c.isCorrect,
        sortOrder: c.sortOrder,
      })),
      examsUsageCount: usage.examUsageByBankId.get(q.id) || 0,
      homeworkUsageCount: usage.homeworkUsageByBankId.get(q.id) || 0,
      canEdit: editCheck.allowed,
      revisions: revisions.map((rev) => ({
        id: rev.id,
        version: rev.version,
        changedById: rev.changedById,
        changedByName: rev.changedByName,
        action: rev.action,
        noteAr: rev.noteAr,
        createdAt: rev.createdAt.toISOString(),
      })),
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error('Question bank detail error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل السؤال' });
  }
});

// Shared schema for creating/updating a single central bank question
const attachmentInputSchema = z.object({
  storageKey: z.string().trim().min(5),
  captionAr: z.string().trim().max(300).optional().default(''),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

const choiceInputSchema = z.object({
  labelAr: z.string().trim().min(1).max(600),
  latexFormula: z.string().trim().max(500).nullable().optional(),
  isCorrect: z.boolean().default(false),
});

const bankQuestionPayloadSchema = z.object({
  trackId: z.coerce.number().int().positive().nullable().optional(),
  gradeId: z.coerce.number().int().positive(),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  topicAr: z.string().trim().max(200).optional().default(''),
  questionType: z.string().trim().default('PHYSICS_PROBLEM'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  promptAr: z.string().max(15000).optional().default(''),
  latexFormula: z.string().max(1000).nullable().optional(),
  points: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(200)).default(2),
  negativePoints: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0).max(50)).optional().default(0),
  numericAnswer: z.union([z.string(), z.number()]).nullable().optional(),
  numericTolerance: z.union([z.string(), z.number()]).nullable().optional(),
  numericUnit: z.string().trim().max(50).optional().default(''),
  shortAnswerRules: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  modelAnswerAr: z.string().max(15000).optional().default(''),
  explanationAr: z.string().max(15000).optional().default(''),
  sourceAr: z.string().trim().max(250).optional().default(''),
  teacherNotesAr: z.string().max(5000).optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  choices: z.array(choiceInputSchema).max(8).optional().default([]),
  questionImages: z.array(attachmentInputSchema).max(QUESTION_BANK_MAX_QUESTION_IMAGES).optional().default([]),
  modelAnswerFiles: z.array(attachmentInputSchema).max(QUESTION_BANK_MAX_MODEL_ANSWER_FILES).optional().default([]),
  initialStatus: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED']).optional(),
  submitForReview: z.boolean().optional(),
  revisionNoteAr: z.string().trim().max(400).optional().default(''),
});

async function verifyUploadedKeysExist(keys: string[]) {
  if (!keys.length) return new Map<string, typeof questionBankFiles.$inferSelect>();
  const uniqueKeys = Array.from(new Set(keys));
  const rows = await db
    .select()
    .from(questionBankFiles)
    .where(inArray(questionBankFiles.storageKey, uniqueKeys));
  return new Map(rows.map((r) => [r.storageKey, r]));
}

// 2E. Create Single Bank Question
adminQuestionBankRouter.post(
  '/',
  requirePermission(CONTRIBUTE_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const parsed = bankQuestionPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'بيانات السؤال غير مكتملة أو غير صالحة',
        });
      }
      const d = parsed.data;

      const academic = await resolveAndValidateAcademicPath({
        trackId: d.trackId,
        gradeId: d.gradeId,
        unitId: d.unitId,
        lessonId: d.lessonId,
      });
      if (!academic.ok) return res.status(400).json({ error: academic.errorAr });

      const validation = validateBankQuestionPayload({
        questionType: d.questionType,
        difficulty: d.difficulty,
        promptAr: d.promptAr,
        points: d.points,
        questionImageCount: d.questionImages.length,
        choices: d.choices,
        numericAnswer: d.numericAnswer,
      });
      if (!validation.valid) return res.status(400).json({ error: validation.errorAr });

      const allKeys = [
        ...d.questionImages.map((a) => a.storageKey),
        ...d.modelAnswerFiles.map((a) => a.storageKey),
      ];
      const fileMap = await verifyUploadedKeysExist(allKeys);
      for (const img of d.questionImages) {
        const f = fileMap.get(img.storageKey);
        if (!f || f.purpose !== 'QUESTION_IMAGE') {
          return res.status(400).json({ error: 'إحدى صور السؤال غير موجودة أو غير صالحة في التخزين الآمن.' });
        }
      }
      for (const maf of d.modelAnswerFiles) {
        const f = fileMap.get(maf.storageKey);
        if (!f) {
          return res.status(400).json({ error: 'أحد ملفات الإجابة النموذجية غير موجود في التخزين الآمن.' });
        }
      }

      const actor = req.authUser!;
      const canReview = hasAnyPermission(actor, REVIEW_PERMS);
      let status: QuestionApprovalStatus = 'DRAFT';
      if (d.initialStatus === 'APPROVED' && canReview) {
        status = 'APPROVED';
      } else if (d.initialStatus === 'PENDING_REVIEW' || d.submitForReview) {
        status = 'PENDING_REVIEW';
      } else if (!d.initialStatus && canReview) {
        status = 'APPROVED';
      }

      const cleanTags = normalizeTags(d.tags);
      const numericAns =
        d.numericAnswer !== undefined && d.numericAnswer !== null && String(d.numericAnswer).trim() !== ''
          ? String(Number(d.numericAnswer))
          : null;
      const numericTol =
        d.numericTolerance !== undefined && d.numericTolerance !== null && String(d.numericTolerance).trim() !== ''
          ? String(Math.max(0, Number(d.numericTolerance)))
          : '0.05';

      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(questions)
          .values({
            trackId: academic.trackId,
            gradeId: academic.gradeId,
            unitId: academic.unitId,
            lessonId: academic.lessonId,
            topicAr: d.topicAr,
            questionType: d.questionType,
            difficulty: d.difficulty,
            promptAr: d.promptAr.trim(),
            latexFormula: d.latexFormula?.trim() || null,
            points: d.points,
            negativePoints: String(d.negativePoints || 0),
            numericAnswer: numericAns,
            numericTolerance: numericTol,
            numericUnit: d.numericUnit,
            shortAnswerRulesJson: d.shortAnswerRules,
            modelAnswerAr: d.modelAnswerAr.trim(),
            explanationAr: d.explanationAr.trim(),
            sourceAr: d.sourceAr,
            teacherNotesAr: d.teacherNotesAr.trim(),
            tagsJson: cleanTags,
            isBankItem: true,
            approvalStatus: status,
            createdById: actor.id,
            reviewedById: status === 'APPROVED' ? actor.id : null,
            reviewedAt: status === 'APPROVED' ? new Date() : null,
            version: 1,
            isArchived: false,
            updatedAt: new Date(),
          })
          .returning();

        const bankCode = formatBankCode(inserted.id);
        await tx.update(questions).set({ bankCode }).where(eq(questions.id, inserted.id));

        if (d.choices.length > 0 && (d.questionType === 'MCQ' || d.questionType === 'TRUE_FALSE')) {
          await tx.insert(choices).values(
            d.choices.map((c, idx) => ({
              questionId: inserted.id,
              labelAr: c.labelAr.trim(),
              latexFormula: c.latexFormula?.trim() || null,
              isCorrect: Boolean(c.isCorrect),
              sortOrder: idx,
            })),
          );
        }

        const attInserts: Array<typeof questionAttachments.$inferInsert> = [];
        d.questionImages.forEach((img, idx) => {
          const f = fileMap.get(img.storageKey)!;
          attInserts.push({
            questionId: inserted.id,
            attachmentRole: 'QUESTION_IMAGE',
            storageKey: f.storageKey,
            fileName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            captionAr: img.captionAr || '',
            displayOrder: img.displayOrder ?? idx,
          });
        });
        d.modelAnswerFiles.forEach((maf, idx) => {
          const f = fileMap.get(maf.storageKey)!;
          attInserts.push({
            questionId: inserted.id,
            attachmentRole: f.mimeType === 'application/pdf' ? 'MODEL_ANSWER_PDF' : 'MODEL_ANSWER_IMAGE',
            storageKey: f.storageKey,
            fileName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            captionAr: maf.captionAr || '',
            displayOrder: maf.displayOrder ?? idx,
          });
        });
        if (attInserts.length > 0) {
          await tx.insert(questionAttachments).values(attInserts);
        }

        await tx.insert(questionRevisions).values({
          questionId: inserted.id,
          version: 1,
          changedById: actor.id,
          changedByName: actor.fullName,
          action: status === 'APPROVED' ? 'APPROVED' : status === 'PENDING_REVIEW' ? 'SUBMITTED' : 'CREATED',
          noteAr: d.revisionNoteAr || 'إنشاء السؤال في بنك الأسئلة',
          snapshotJson: {
            bankCode,
            questionType: d.questionType,
            difficulty: d.difficulty,
            points: d.points,
            approvalStatus: status,
            questionImagesCount: d.questionImages.length,
            modelAnswerFilesCount: d.modelAnswerFiles.length,
          },
        });

        return { id: inserted.id, bankCode, approvalStatus: status };
      });

      await logAudit({
        actorId: actor.id,
        actorName: actor.fullName,
        action: 'QUESTION_BANK_CREATED',
        entityType: 'question',
        entityId: created.id,
        details: { bankCode: created.bankCode, approvalStatus: created.approvalStatus },
      });

      return res.status(201).json({
        ...created,
        message:
          created.approvalStatus === 'APPROVED'
            ? 'تم حفظ واعتماد السؤال في بنك الأسئلة بنجاح'
            : created.approvalStatus === 'PENDING_REVIEW'
              ? 'تم حفظ السؤال وإرساله لمراجعة الأستاذ بنجاح'
              : 'تم حفظ السؤال كمسودة في بنك الأسئلة',
      });
    } catch (err) {
      console.error('Create bank question error:', err);
      return res.status(500).json({ error: 'تعذر حفظ السؤال في بنك الأسئلة' });
    }
  },
);

// 2F. Bulk Upload Drafts Creation (TA Practical Batch Workflow)
const bulkCreateSchema = z.object({
  defaults: z.object({
    trackId: z.coerce.number().int().positive().nullable().optional(),
    gradeId: z.coerce.number().int().positive(),
    unitId: z.coerce.number().int().positive().nullable().optional(),
    lessonId: z.coerce.number().int().positive().nullable().optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    questionType: z.string().trim().default('IMAGE_DIAGRAM'),
    points: z.coerce.number().int().min(1).max(200).default(2),
    sourceAr: z.string().trim().max(250).optional().default(''),
    tags: z.array(z.string()).optional().default([]),
  }),
  submitForReview: z.boolean().optional().default(false),
  items: z
    .array(
      z.object({
        clientKey: z.string().trim().max(120).optional(),
        questionType: z.string().trim().optional(),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
        promptAr: z.string().max(15000).optional().default(''),
        points: z.coerce.number().int().min(1).max(200).optional(),
        topicAr: z.string().trim().max(200).optional().default(''),
        sourceAr: z.string().trim().max(250).optional(),
        teacherNotesAr: z.string().max(5000).optional().default(''),
        tags: z.array(z.string()).optional(),
        questionImageKeys: z.array(z.string().trim().min(5)).max(QUESTION_BANK_MAX_QUESTION_IMAGES).default([]),
        modelAnswerAr: z.string().max(15000).optional().default(''),
        explanationAr: z.string().max(15000).optional().default(''),
        modelAnswerFileKeys: z.array(z.string().trim().min(5)).max(QUESTION_BANK_MAX_MODEL_ANSWER_FILES).default([]),
        pairingConfirmed: z.boolean().optional().default(true),
      }),
    )
    .min(1)
    .max(QUESTION_BANK_MAX_BULK_BATCH),
});

adminQuestionBankRouter.post(
  '/bulk',
  requirePermission(CONTRIBUTE_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const parsed = bulkCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'بيانات الدفعة غير مكتملة أو غير صالحة',
        });
      }
      const { defaults, submitForReview, items } = parsed.data;

      const batchCheck = validateBulkBatchInput(items);
      if (!batchCheck.valid) {
        return res.status(400).json({ error: batchCheck.errorAr });
      }

      const academic = await resolveAndValidateAcademicPath({
        trackId: defaults.trackId,
        gradeId: defaults.gradeId,
        unitId: defaults.unitId,
        lessonId: defaults.lessonId,
      });
      if (!academic.ok) return res.status(400).json({ error: academic.errorAr });

      const allKeys = items.flatMap((it) => [...it.questionImageKeys, ...it.modelAnswerFileKeys]);
      const fileMap = await verifyUploadedKeysExist(allKeys);

      const actor = req.authUser!;
      const canReview = hasAnyPermission(actor, REVIEW_PERMS);
      const targetStatus: QuestionApprovalStatus = submitForReview
        ? canReview
          ? 'APPROVED'
          : 'PENDING_REVIEW'
        : 'DRAFT';

      const results: Array<{
        index: number;
        clientKey?: string;
        ok: boolean;
        id?: number;
        bankCode?: string;
        errorAr?: string;
      }> = [];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        try {
          const qType = ALLOWED_QUESTION_TYPES.has(it.questionType || defaults.questionType)
            ? (it.questionType || defaults.questionType)
            : 'IMAGE_DIAGRAM';
          const diff = ALLOWED_DIFFICULTIES.has((it.difficulty || defaults.difficulty) as 'EASY' | 'MEDIUM' | 'HARD')
            ? (it.difficulty || defaults.difficulty)
            : 'MEDIUM';
          const pts = it.points ?? defaults.points ?? 2;

          for (const k of it.questionImageKeys) {
            const f = fileMap.get(k);
            if (!f || f.purpose !== 'QUESTION_IMAGE') {
              throw new Error('إحدى صور السؤال غير موجودة في التخزين الآمن.');
            }
          }
          for (const k of it.modelAnswerFileKeys) {
            const f = fileMap.get(k);
            if (!f) {
              throw new Error('أحد ملفات الإجابة النموذجية غير موجود في التخزين الآمن.');
            }
          }

          const mergedTags = normalizeTags([...(defaults.tags || []), ...(it.tags || [])]);

          const saved = await db.transaction(async (tx) => {
            const [inserted] = await tx
              .insert(questions)
              .values({
                trackId: academic.trackId,
                gradeId: academic.gradeId,
                unitId: academic.unitId,
                lessonId: academic.lessonId,
                topicAr: it.topicAr || '',
                questionType: qType,
                difficulty: diff,
                promptAr: (it.promptAr || '').trim(),
                points: pts,
                modelAnswerAr: (it.modelAnswerAr || '').trim(),
                explanationAr: (it.explanationAr || '').trim(),
                sourceAr: it.sourceAr !== undefined ? it.sourceAr : defaults.sourceAr || '',
                teacherNotesAr: (it.teacherNotesAr || '').trim(),
                tagsJson: mergedTags,
                isBankItem: true,
                approvalStatus: targetStatus,
                createdById: actor.id,
                reviewedById: targetStatus === 'APPROVED' ? actor.id : null,
                reviewedAt: targetStatus === 'APPROVED' ? new Date() : null,
                version: 1,
                isArchived: false,
                updatedAt: new Date(),
              })
              .returning();

            const bankCode = formatBankCode(inserted.id);
            await tx.update(questions).set({ bankCode }).where(eq(questions.id, inserted.id));

            const attInserts: Array<typeof questionAttachments.$inferInsert> = [];
            it.questionImageKeys.forEach((k, idx) => {
              const f = fileMap.get(k)!;
              attInserts.push({
                questionId: inserted.id,
                attachmentRole: 'QUESTION_IMAGE',
                storageKey: f.storageKey,
                fileName: f.originalName,
                mimeType: f.mimeType,
                sizeBytes: f.sizeBytes,
                captionAr: '',
                displayOrder: idx,
              });
            });
            it.modelAnswerFileKeys.forEach((k, idx) => {
              const f = fileMap.get(k)!;
              attInserts.push({
                questionId: inserted.id,
                attachmentRole: f.mimeType === 'application/pdf' ? 'MODEL_ANSWER_PDF' : 'MODEL_ANSWER_IMAGE',
                storageKey: f.storageKey,
                fileName: f.originalName,
                mimeType: f.mimeType,
                sizeBytes: f.sizeBytes,
                captionAr: '',
                displayOrder: idx,
              });
            });
            if (attInserts.length > 0) {
              await tx.insert(questionAttachments).values(attInserts);
            }

            await tx.insert(questionRevisions).values({
              questionId: inserted.id,
              version: 1,
              changedById: actor.id,
              changedByName: actor.fullName,
              action: targetStatus === 'PENDING_REVIEW' ? 'SUBMITTED' : targetStatus === 'APPROVED' ? 'APPROVED' : 'CREATED',
              noteAr: 'إضافة عبر الرفع الجماعي لصور الأسئلة',
              snapshotJson: {
                bankCode,
                approvalStatus: targetStatus,
                questionImagesCount: it.questionImageKeys.length,
                modelAnswerFilesCount: it.modelAnswerFileKeys.length,
              },
            });

            return { id: inserted.id, bankCode };
          });

          results.push({ index: i, clientKey: it.clientKey, ok: true, id: saved.id, bankCode: saved.bankCode });
        } catch (itemErr) {
          results.push({
            index: i,
            clientKey: it.clientKey,
            ok: false,
            errorAr: (itemErr as Error).message || 'تعذر حفظ هذا العنصر',
          });
        }
      }

      const succeededCount = results.filter((r) => r.ok).length;
      const failedCount = results.length - succeededCount;

      await logAudit({
        actorId: actor.id,
        actorName: actor.fullName,
        action: 'QUESTION_BANK_BULK_CREATED',
        entityType: 'question',
        details: { succeededCount, failedCount, targetStatus },
      });

      return res.status(succeededCount > 0 ? 201 : 400).json({
        succeededCount,
        failedCount,
        targetStatus,
        results,
        message:
          failedCount === 0
            ? `تم حفظ ${succeededCount} سؤالًا بنجاح في بنك الأسئلة.`
            : `تم حفظ ${succeededCount} سؤالًا، وفشل ${failedCount} (يمكنك إعادة محاولة العناصر الفاشلة فقط دون تكرار).`,
      });
    } catch (err) {
      console.error('Bulk question bank create error:', err);
      return res.status(500).json({ error: 'تعذر تنفيذ الرفع الجماعي للأسئلة' });
    }
  },
);

// 2G. Bulk Metadata Update & Batch Submit for Review
adminQuestionBankRouter.post(
  '/bulk-meta',
  requirePermission(CONTRIBUTE_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        questionIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
        trackId: z.coerce.number().int().positive().nullable().optional(),
        gradeId: z.coerce.number().int().positive().optional(),
        unitId: z.coerce.number().int().positive().nullable().optional(),
        lessonId: z.coerce.number().int().positive().nullable().optional(),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
        tagsToAdd: z.array(z.string()).optional(),
        submitForReview: z.boolean().optional().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'بيانات التحديث الجماعي غير صالحة' });
      }
      const d = parsed.data;

      let academic: { trackId: number; gradeId: number; unitId: number | null; lessonId: number | null } | null = null;
      if (d.gradeId) {
        const check = await resolveAndValidateAcademicPath({
          trackId: d.trackId,
          gradeId: d.gradeId,
          unitId: d.unitId,
          lessonId: d.lessonId,
        });
        if (!check.ok) return res.status(400).json({ error: check.errorAr });
        academic = check;
      }

      const actor = req.authUser!;
      const hasManage = hasPermission(actor, PERMISSIONS.QUESTION_BANK_MANAGE);
      const hasReview = hasPermission(actor, PERMISSIONS.QUESTION_BANK_REVIEW);
      const hasContribute = hasPermission(actor, PERMISSIONS.QUESTION_BANK_CONTRIBUTE);

      const rows = await db
        .select()
        .from(questions)
        .where(and(inArray(questions.id, d.questionIds), eq(questions.isBankItem, true)));

      let updatedCount = 0;
      const skipped: Array<{ id: number; reasonAr: string }> = [];

      for (const q of rows) {
        const editCheck = canStaffEditBankQuestion({
          actorId: actor.id,
          hasManage,
          hasReview,
          hasContribute,
          question: {
            createdById: q.createdById,
            approvalStatus: q.approvalStatus,
            isArchived: q.isArchived,
          },
        });
        if (!editCheck.allowed) {
          skipped.push({ id: q.id, reasonAr: editCheck.errorAr || 'غير مصرح بالتعديل' });
          continue;
        }

        const nextTags = d.tagsToAdd?.length
          ? normalizeTags([...(Array.isArray(q.tagsJson) ? q.tagsJson : []), ...d.tagsToAdd])
          : q.tagsJson;

        let nextStatus = q.approvalStatus;
        if (d.submitForReview && (q.approvalStatus === 'DRAFT' || q.approvalStatus === 'RETURNED')) {
          nextStatus = 'PENDING_REVIEW';
        }

        await db
          .update(questions)
          .set({
            ...(academic
              ? {
                  trackId: academic.trackId,
                  gradeId: academic.gradeId,
                  unitId: academic.unitId,
                  lessonId: academic.lessonId,
                }
              : {}),
            ...(d.difficulty ? { difficulty: d.difficulty } : {}),
            tagsJson: nextTags,
            approvalStatus: nextStatus,
            version: q.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(questions.id, q.id));

        updatedCount++;
      }

      return res.json({
        updatedCount,
        skipped,
        message: `تم تحديث ${updatedCount} سؤالًا بنجاح.`,
      });
    } catch (err) {
      console.error('Bulk meta update error:', err);
      return res.status(500).json({ error: 'تعذر تطبيق التعديل الجماعي' });
    }
  },
);

// 2H. Update Existing Bank Question (Strict Ownership/Status Enforcement + Revision History)
adminQuestionBankRouter.patch(
  '/:id',
  requirePermission(CONTRIBUTE_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'معرّف السؤال غير صالح' });
      }

      const [existing] = await db
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.isBankItem, true)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'السؤال غير موجود في بنك الأسئلة' });

      const actor = req.authUser!;
      const hasManage = hasPermission(actor, PERMISSIONS.QUESTION_BANK_MANAGE);
      const hasReview = hasPermission(actor, PERMISSIONS.QUESTION_BANK_REVIEW);
      const hasContribute = hasPermission(actor, PERMISSIONS.QUESTION_BANK_CONTRIBUTE);

      const editCheck = canStaffEditBankQuestion({
        actorId: actor.id,
        hasManage,
        hasReview,
        hasContribute,
        question: {
          createdById: existing.createdById,
          approvalStatus: existing.approvalStatus,
          isArchived: existing.isArchived,
        },
      });
      if (!editCheck.allowed) {
        return res.status(403).json({ error: editCheck.errorAr });
      }

      const parsed = bankQuestionPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'بيانات تحديث السؤال غير صالحة',
        });
      }
      const d = parsed.data;

      const academic = await resolveAndValidateAcademicPath({
        trackId: d.trackId,
        gradeId: d.gradeId,
        unitId: d.unitId,
        lessonId: d.lessonId,
      });
      if (!academic.ok) return res.status(400).json({ error: academic.errorAr });

      const validation = validateBankQuestionPayload({
        questionType: d.questionType,
        difficulty: d.difficulty,
        promptAr: d.promptAr,
        points: d.points,
        questionImageCount: d.questionImages.length,
        legacyImageUrl: existing.imageUrl,
        choices: d.choices,
        numericAnswer: d.numericAnswer,
      });
      if (!validation.valid) return res.status(400).json({ error: validation.errorAr });

      const allKeys = [
        ...d.questionImages.map((a) => a.storageKey),
        ...d.modelAnswerFiles.map((a) => a.storageKey),
      ];
      const fileMap = await verifyUploadedKeysExist(allKeys);
      for (const img of d.questionImages) {
        const f = fileMap.get(img.storageKey);
        if (!f || f.purpose !== 'QUESTION_IMAGE') {
          return res.status(400).json({ error: 'إحدى صور السؤال غير موجودة في التخزين الآمن.' });
        }
      }
      for (const maf of d.modelAnswerFiles) {
        const f = fileMap.get(maf.storageKey);
        if (!f) {
          return res.status(400).json({ error: 'أحد ملفات الإجابة النموذجية غير موجود في التخزين الآمن.' });
        }
      }

      const nextVersion = existing.version + 1;
      let nextStatus = existing.approvalStatus;
      if (d.submitForReview && (existing.approvalStatus === 'DRAFT' || existing.approvalStatus === 'RETURNED')) {
        nextStatus = 'PENDING_REVIEW';
      } else if (d.initialStatus === 'APPROVED' && (hasReview || hasManage)) {
        nextStatus = 'APPROVED';
      }

      const cleanTags = normalizeTags(d.tags);
      const numericAns =
        d.numericAnswer !== undefined && d.numericAnswer !== null && String(d.numericAnswer).trim() !== ''
          ? String(Number(d.numericAnswer))
          : null;
      const numericTol =
        d.numericTolerance !== undefined && d.numericTolerance !== null && String(d.numericTolerance).trim() !== ''
          ? String(Math.max(0, Number(d.numericTolerance)))
          : '0.05';

      await db.transaction(async (tx) => {
        await tx
          .update(questions)
          .set({
            trackId: academic.trackId,
            gradeId: academic.gradeId,
            unitId: academic.unitId,
            lessonId: academic.lessonId,
            topicAr: d.topicAr,
            questionType: d.questionType,
            difficulty: d.difficulty,
            promptAr: d.promptAr.trim(),
            latexFormula: d.latexFormula?.trim() || null,
            points: d.points,
            negativePoints: String(d.negativePoints || 0),
            numericAnswer: numericAns,
            numericTolerance: numericTol,
            numericUnit: d.numericUnit,
            shortAnswerRulesJson: d.shortAnswerRules,
            modelAnswerAr: d.modelAnswerAr.trim(),
            explanationAr: d.explanationAr.trim(),
            sourceAr: d.sourceAr,
            teacherNotesAr: d.teacherNotesAr.trim(),
            tagsJson: cleanTags,
            approvalStatus: nextStatus,
            version: nextVersion,
            updatedAt: new Date(),
          })
          .where(eq(questions.id, id));

        // Update choices for this central bank question (existing exams use immutable clones!)
        await tx.delete(choices).where(eq(choices.questionId, id));
        if (d.choices.length > 0 && (d.questionType === 'MCQ' || d.questionType === 'TRUE_FALSE')) {
          await tx.insert(choices).values(
            d.choices.map((c, idx) => ({
              questionId: id,
              labelAr: c.labelAr.trim(),
              latexFormula: c.latexFormula?.trim() || null,
              isCorrect: Boolean(c.isCorrect),
              sortOrder: idx,
            })),
          );
        }

        // Replace attachment links cleanly (underlying question_bank_files rows remain immutable!)
        await tx.delete(questionAttachments).where(eq(questionAttachments.questionId, id));
        const attInserts: Array<typeof questionAttachments.$inferInsert> = [];
        d.questionImages.forEach((img, idx) => {
          const f = fileMap.get(img.storageKey)!;
          attInserts.push({
            questionId: id,
            attachmentRole: 'QUESTION_IMAGE',
            storageKey: f.storageKey,
            fileName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            captionAr: img.captionAr || '',
            displayOrder: img.displayOrder ?? idx,
          });
        });
        d.modelAnswerFiles.forEach((maf, idx) => {
          const f = fileMap.get(maf.storageKey)!;
          attInserts.push({
            questionId: id,
            attachmentRole: f.mimeType === 'application/pdf' ? 'MODEL_ANSWER_PDF' : 'MODEL_ANSWER_IMAGE',
            storageKey: f.storageKey,
            fileName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            captionAr: maf.captionAr || '',
            displayOrder: maf.displayOrder ?? idx,
          });
        });
        if (attInserts.length > 0) {
          await tx.insert(questionAttachments).values(attInserts);
        }

        await tx.insert(questionRevisions).values({
          questionId: id,
          version: nextVersion,
          changedById: actor.id,
          changedByName: actor.fullName,
          action: d.submitForReview ? 'SUBMITTED' : 'UPDATED',
          noteAr: d.revisionNoteAr || 'تحديث بيانات السؤال في بنك الأسئلة',
          snapshotJson: {
            questionType: d.questionType,
            difficulty: d.difficulty,
            points: d.points,
            approvalStatus: nextStatus,
            questionImagesCount: d.questionImages.length,
            modelAnswerFilesCount: d.modelAnswerFiles.length,
          },
        });
      });

      await logAudit({
        actorId: actor.id,
        actorName: actor.fullName,
        action: 'QUESTION_BANK_UPDATED',
        entityType: 'question',
        entityId: id,
        details: { version: nextVersion, approvalStatus: nextStatus },
      });

      return res.json({
        id,
        version: nextVersion,
        approvalStatus: nextStatus,
        message: 'تم تحديث السؤال في بنك الأسئلة بنجاح (دون تعديل أي امتحان أو واجب سابق).',
      });
    } catch (err) {
      console.error('Update bank question error:', err);
      return res.status(500).json({ error: 'تعذر تحديث السؤال' });
    }
  },
);

// 2I. Review / Submit / Approve / Return / Archive / Restore Workflow
adminQuestionBankRouter.post(
  '/:id/review',
  requirePermission(CONTRIBUTE_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'معرّف السؤال غير صالح' });
      }

      const schema = z.object({
        action: z.enum(['SUBMIT', 'APPROVE', 'RETURN', 'ARCHIVE', 'RESTORE']),
        feedbackAr: z.string().trim().max(2000).optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'إجراء المراجعة غير صالح' });
      }

      const [existing] = await db
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.isBankItem, true)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'السؤال غير موجود' });

      const actor = req.authUser!;
      const canReview = hasAnyPermission(actor, REVIEW_PERMS);
      const isOwnerContributor = existing.createdById === actor.id;

      const decision = evaluateStatusTransition({
        currentStatus: existing.approvalStatus,
        isArchived: existing.isArchived,
        action: parsed.data.action,
        feedbackAr: parsed.data.feedbackAr,
        canReview,
        isOwnerContributor,
      });

      if (!decision.allowed || !decision.nextStatus) {
        return res.status(403).json({ error: decision.errorAr || 'غير مصرح بتنفيذ هذا الإجراء' });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(questions)
          .set({
            approvalStatus: decision.nextStatus!,
            isArchived: Boolean(decision.nextArchived),
            reviewFeedbackAr:
              parsed.data.action === 'RETURN'
                ? parsed.data.feedbackAr
                : parsed.data.action === 'APPROVE'
                  ? ''
                  : existing.reviewFeedbackAr,
            reviewedById: parsed.data.action === 'SUBMIT' ? existing.reviewedById : actor.id,
            reviewedAt: parsed.data.action === 'SUBMIT' ? existing.reviewedAt : now,
            updatedAt: now,
          })
          .where(eq(questions.id, id));

        const revActionMap = {
          SUBMIT: 'SUBMITTED',
          APPROVE: 'APPROVED',
          RETURN: 'RETURNED',
          ARCHIVE: 'ARCHIVED',
          RESTORE: 'RESTORED',
        } as const;

        await tx.insert(questionRevisions).values({
          questionId: id,
          version: existing.version,
          changedById: actor.id,
          changedByName: actor.fullName,
          action: revActionMap[parsed.data.action],
          noteAr:
            parsed.data.feedbackAr ||
            (parsed.data.action === 'APPROVE'
              ? 'تم اعتماد السؤال وجاهز للاستخدام في الامتحانات والواجبات'
              : parsed.data.action === 'SUBMIT'
                ? 'تم إرسال السؤال لمراجعة الأستاذ'
                : parsed.data.action === 'ARCHIVE'
                  ? 'تم أرشفة السؤال'
                  : 'تم استعادة السؤال من الأرشيف'),
          snapshotJson: { previousStatus: existing.approvalStatus, nextStatus: decision.nextStatus },
        });
      });

      await logAudit({
        actorId: actor.id,
        actorName: actor.fullName,
        action: `QUESTION_BANK_${parsed.data.action}`,
        entityType: 'question',
        entityId: id,
        details: { nextStatus: decision.nextStatus, feedbackAr: parsed.data.feedbackAr },
      });

      return res.json({
        id,
        approvalStatus: decision.nextStatus,
        isArchived: Boolean(decision.nextArchived),
        message:
          parsed.data.action === 'APPROVE'
            ? 'تم اعتماد السؤال بنجاح وأصبح متاحًا للاستخدام في الامتحانات والواجبات.'
            : parsed.data.action === 'RETURN'
              ? 'تمت إعادة السؤال لمساعد المدرس مع الملاحظات.'
              : parsed.data.action === 'SUBMIT'
                ? 'تم إرسال السؤال لمراجعة الأستاذ.'
                : parsed.data.action === 'ARCHIVE'
                  ? 'تمت أرشفة السؤال بأمان مع الحفاظ على جميع الامتحانات والواجبات السابقة.'
                  : 'تمت استعادة السؤال إلى المسودات.',
      });
    } catch (err) {
      console.error('Review bank question error:', err);
      return res.status(500).json({ error: 'تعذر تحديث حالة السؤال' });
    }
  },
);

// 2J. Bulk Review (Teacher Fast Approve / Archive)
adminQuestionBankRouter.post(
  '/bulk-review',
  requirePermission(REVIEW_PERMS),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        questionIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
        action: z.enum(['APPROVE', 'ARCHIVE']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'يرجى اختيار سؤال واحد على الأقل لتنفيذ الإجراء.' });
      }

      const actor = req.authUser!;
      const now = new Date();
      const targetRows = await db
        .select({ id: questions.id, version: questions.version })
        .from(questions)
        .where(and(inArray(questions.id, parsed.data.questionIds), eq(questions.isBankItem, true)));

      if (!targetRows.length) {
        return res.status(404).json({ error: 'لم يتم العثور على الأسئلة المحددة.' });
      }

      const isArchive = parsed.data.action === 'ARCHIVE';
      await db.transaction(async (tx) => {
        await tx
          .update(questions)
          .set({
            approvalStatus: isArchive ? 'ARCHIVED' : 'APPROVED',
            isArchived: isArchive,
            ...(isArchive ? {} : { reviewFeedbackAr: '' }),
            reviewedById: actor.id,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(inArray(questions.id, targetRows.map((r) => r.id)));

        await tx.insert(questionRevisions).values(
          targetRows.map((r) => ({
            questionId: r.id,
            version: r.version,
            changedById: actor.id,
            changedByName: actor.fullName,
            action: isArchive ? 'ARCHIVED' : 'APPROVED',
            noteAr: isArchive ? 'أرشفة جماعية بواسطة الأستاذ' : 'اعتماد جماعي بواسطة الأستاذ',
            snapshotJson: { bulk: true },
          })),
        );
      });

      await logAudit({
        actorId: actor.id,
        actorName: actor.fullName,
        action: isArchive ? 'QUESTION_BANK_BULK_ARCHIVE' : 'QUESTION_BANK_BULK_APPROVE',
        entityType: 'question',
        details: { count: targetRows.length, questionIds: targetRows.map((r) => r.id) },
      });

      return res.json({
        updatedCount: targetRows.length,
        message: isArchive
          ? `تمت أرشفة ${targetRows.length} سؤالًا بنجاح.`
          : `تم اعتماد ${targetRows.length} سؤالًا بنجاح وأصبحت جاهزة للاستخدام.`,
      });
    } catch (err) {
      console.error('Bulk review error:', err);
      return res.status(500).json({ error: 'تعذر تنفيذ الإجراء الجماعي' });
    }
  },
);

// 2K. Safe Delete Bank Question (Blocked when referenced by ANY exam or homework!)
adminQuestionBankRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'معرّف السؤال غير صالح' });
      }

      const [existing] = await db
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.isBankItem, true)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'السؤال غير موجود' });

      const { examUsageByBankId, homeworkUsageByBankId } = await loadUsageCounts([id]);
      const examCount = examUsageByBankId.get(id) || 0;
      const hwCount = homeworkUsageByBankId.get(id) || 0;

      if (examCount > 0 || hwCount > 0) {
        return res.status(409).json({
          error: `لا يمكن حذف هذا السؤال نهائيًا لأنه مستخدم في (${examCount}) امتحان و (${hwCount}) واجب. يمكنك أرشفته بدلًا من الحذف للحفاظ على سجل الطلاب التاريخي.`,
          examsUsageCount: examCount,
          homeworkUsageCount: hwCount,
        });
      }

      // Also check direct legacy exam_questions reference just in case
      const directLinks = await db
        .select({ id: examQuestions.id })
        .from(examQuestions)
        .where(eq(examQuestions.questionId, id))
        .limit(1);
      if (directLinks.length > 0) {
        return res.status(409).json({
          error: 'لا يمكن حذف هذا السؤال لأنه مرتبط بامتحان قائم. يرجى أرشفته بدلًا من ذلك.',
        });
      }

      await db.delete(questions).where(eq(questions.id, id));

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'QUESTION_BANK_DELETED',
        entityType: 'question',
        entityId: id,
        details: { bankCode: existing.bankCode || formatBankCode(id) },
      });

      return res.json({ message: 'تم حذف السؤال من بنك الأسئلة بنجاح.' });
    } catch (err) {
      console.error('Delete bank question error:', err);
      return res.status(500).json({ error: 'تعذر حذف السؤال' });
    }
  },
);
