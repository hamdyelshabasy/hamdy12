import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  academicTracks,
  auditLogs,
  choices,
  courses,
  examAssignments,
  examQuestions,
  exams,
  grades,
  lessons,
  questionAttachments,
  questions,
  units,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  requireAuth,
  requirePermission,
  requireStaff,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification, logAudit } from '../audit.ts';
import { buildSignedQuestionBankFileUrl } from '../domain/questionBank.ts';
import {
  canActorAccessWizardDraft,
  isStaleDraftWrite,
  resolveEffectivePublishStatus,
  validateExamWizardDraft,
} from '../domain/examWizard.ts';
import type {
  AdminExamListItem,
  AdminExamQuestion,
  ExamAssignmentScope,
  ExamPublicationStatus,
  ExamType,
} from '../../types/exams.ts';
import type {
  ExamWizardDraftResponse,
  ExamWizardDraftSummary,
} from '../../types/examWizard.ts';

export const examWizardRouter = Router();

// Every Exam Creation Wizard route requires authenticated staff with EXAMS_MANAGE permission.
examWizardRouter.use(requireAuth, requireStaff(), requirePermission(PERMISSIONS.EXAMS_MANAGE));

const EXAM_TYPES = [
  'LESSON_QUIZ',
  'UNIT_EXAM',
  'MONTHLY',
  'COMPREHENSIVE',
  'FINAL_SIMULATION',
  'HOMEWORK',
] as const;

const wizardDraftPayloadSchema = z.object({
  clientDraftKey: z.string().trim().min(4).max(120).optional(),
  expectedUpdatedAt: z.string().nullable().optional(),
  titleAr: z.string().trim().min(3, 'عنوان الامتحان يجب أن يكون 3 أحرف على الأقل').max(200),
  descriptionAr: z.string().max(2000).optional().default(''),
  instructionsAr: z.string().max(4000).optional().default(''),
  trackId: z.coerce.number().int().positive().nullable().optional(),
  gradeId: z.coerce.number().int().positive('يرجى اختيار الصف الدراسي المستهدف'),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  courseId: z.coerce.number().int().positive().nullable().optional(),
  requiredVideoId: z.coerce.number().int().positive().nullable().optional(),
  examType: z.enum(EXAM_TYPES).default('LESSON_QUIZ'),
  totalMarks: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0).max(5000)).default(0),
  durationMin: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(360)).default(30),
  passScorePercent: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(100)).default(60),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  maxAttempts: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(50)).default(2),
  shuffleQuestions: z.boolean().default(false),
  shuffleChoices: z.boolean().default(false),
  allowNavigation: z.boolean().default(true),
  allowReviewBeforeSubmit: z.boolean().default(true),
  allowStudentReview: z.boolean().default(true),
  showResultImmediately: z.boolean().default(true),
  showCorrectAnswers: z.boolean().default(true),
  showExplanations: z.boolean().default(true),
  allowNegativeMarking: z.boolean().default(false),
  assignmentScope: z.enum(['GRADE', 'GROUP', 'STUDENTS']).default('GRADE'),
  assignedGroupIds: z.array(z.coerce.number().int().positive()).max(200).optional().default([]),
  assignedStudentIds: z.array(z.coerce.number().int().positive()).max(500).optional().default([]),
});

const DRAFT_CREATION_AUDIT_ACTIONS = [
  'WIZARD_EXAM_DRAFT_CREATED',
  'PHASE2_EXAM_CREATED',
  'SMART_EXAM_GENERATED',
  'PHASE2_EXAM_DUPLICATED',
];

// Bounded in-memory idempotency cache mapping `${actorId}:${clientDraftKey}` -> examId
const clientDraftKeyMap = new Map<string, { examId: number; createdAtMs: number }>();
const MAX_IDEMPOTENCY_ENTRIES = 500;

function rememberDraftKey(actorId: number, key: string, examId: number) {
  if (clientDraftKeyMap.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const oldestKey = clientDraftKeyMap.keys().next().value;
    if (oldestKey) clientDraftKeyMap.delete(oldestKey);
  }
  clientDraftKeyMap.set(`${actorId}:${key}`, { examId, createdAtMs: Date.now() });
}

function parseOptionalDate(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolveExamCreatorActorId(examId: number): Promise<number | null> {
  const [row] = await db
    .select({ actorId: auditLogs.actorId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'exam'),
        eq(auditLogs.entityId, String(examId)),
        inArray(auditLogs.action, DRAFT_CREATION_AUDIT_ACTIONS),
      ),
    )
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
    .limit(1);
  return row?.actorId ?? null;
}

async function resolveExamCreatorsMap(examIds: number[]): Promise<Map<number, number | null>> {
  const map = new Map<number, number | null>();
  if (examIds.length === 0) return map;
  const rows = await db
    .select({
      entityId: auditLogs.entityId,
      actorId: auditLogs.actorId,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'exam'),
        inArray(auditLogs.entityId, examIds.map(String)),
        inArray(auditLogs.action, DRAFT_CREATION_AUDIT_ACTIONS),
      ),
    )
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

  for (const r of rows) {
    const numId = Number(r.entityId);
    if (!Number.isInteger(numId) || map.has(numId)) continue;
    map.set(numId, r.actorId ?? null);
  }
  return map;
}

async function loadWizardDraftResponse(
  examId: number,
  viewer: { id: number; roleSlug: string },
): Promise<ExamWizardDraftResponse | null> {
  const [ex] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
  if (!ex) return null;

  const [
    [trackRow],
    [gradeRow],
    [unitRow],
    [lessonRow],
    [courseRow],
    assignRows,
    linkRows,
  ] = await Promise.all([
    ex.trackId
      ? db.select().from(academicTracks).where(eq(academicTracks.id, ex.trackId)).limit(1)
      : Promise.resolve([undefined]),
    db.select().from(grades).where(eq(grades.id, ex.gradeId)).limit(1),
    ex.unitId
      ? db.select().from(units).where(eq(units.id, ex.unitId)).limit(1)
      : Promise.resolve([undefined]),
    ex.lessonId
      ? db.select().from(lessons).where(eq(lessons.id, ex.lessonId)).limit(1)
      : Promise.resolve([undefined]),
    ex.courseId
      ? db.select().from(courses).where(eq(courses.id, ex.courseId)).limit(1)
      : Promise.resolve([undefined]),
    db.select().from(examAssignments).where(eq(examAssignments.examId, examId)),
    db
      .select({
        link: examQuestions,
        q: questions,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .where(eq(examQuestions.examId, examId))
      .orderBy(asc(examQuestions.sortOrder), asc(examQuestions.id)),
  ]);

  const qIds = linkRows.map((r) => r.q.id);
  const [choiceRows, attRows] = qIds.length
    ? await Promise.all([
        db
          .select()
          .from(choices)
          .where(inArray(choices.questionId, qIds))
          .orderBy(asc(choices.sortOrder), asc(choices.id)),
        db
          .select()
          .from(questionAttachments)
          .where(inArray(questionAttachments.questionId, qIds))
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id)),
      ])
    : [[], []];

  const calculatedMarks = linkRows.reduce((s, r) => s + (r.link.pointsOverride ?? r.q.points), 0);
  const distribution: Record<string, number> = {};
  for (const r of linkRows) {
    distribution[r.q.questionType] = (distribution[r.q.questionType] || 0) + 1;
  }

  const mappedQuestions: AdminExamQuestion[] = linkRows.map((r) => {
    const qAtts = attRows.filter((a) => a.questionId === r.q.id);
    const questionImages = qAtts
      .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
      .map((a) => ({
        storageKey: a.storageKey,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        displayOrder: a.displayOrder,
        previewUrl: buildSignedQuestionBankFileUrl({
          storageKey: a.storageKey,
          userId: viewer.id,
          roleSlug: viewer.roleSlug,
          context: 'exam',
          resourceId: examId,
          fileRole: 'question',
        }),
      }));
    const modelAnswerFiles = qAtts
      .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
      .map((a) => ({
        storageKey: a.storageKey,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        displayOrder: a.displayOrder,
        previewUrl: buildSignedQuestionBankFileUrl({
          storageKey: a.storageKey,
          userId: viewer.id,
          roleSlug: viewer.roleSlug,
          context: 'exam',
          resourceId: examId,
          fileRole: 'model_answer',
        }),
      }));

    return {
      linkId: r.link.id,
      id: r.q.id,
      sourceBankQuestionId: r.q.sourceBankQuestionId ?? null,
      sortOrder: r.link.sortOrder,
      questionType: r.q.questionType as AdminExamQuestion['questionType'],
      difficulty: (r.q.difficulty as AdminExamQuestion['difficulty']) || 'MEDIUM',
      promptAr: r.q.promptAr,
      latexFormula: r.q.latexFormula,
      imageUrl: r.q.imageUrl,
      questionImages,
      modelAnswerFiles,
      points: r.link.pointsOverride ?? r.q.points,
      negativePoints: Number(r.q.negativePoints || 0),
      numericAnswer: r.q.numericAnswer !== null ? String(r.q.numericAnswer) : '',
      numericTolerance: r.q.numericTolerance !== null ? String(r.q.numericTolerance) : '0.05',
      numericUnit: r.q.numericUnit || '',
      shortAnswerRules: Array.isArray(r.q.shortAnswerRulesJson)
        ? (r.q.shortAnswerRulesJson as string[])
        : [],
      modelAnswerAr: r.q.modelAnswerAr || '',
      explanationAr: r.q.explanationAr || '',
      unitId: r.q.unitId,
      lessonId: r.q.lessonId,
      choices: choiceRows
        .filter((c) => c.questionId === r.q.id)
        .map((c) => ({
          id: c.id,
          labelAr: c.labelAr,
          latexFormula: c.latexFormula,
          isCorrect: c.isCorrect,
          sortOrder: c.sortOrder,
        })),
    };
  });

  const updatedAtIso = ex.updatedAt.toISOString();
  const examItem: AdminExamListItem & { updatedAt?: string } = {
    id: ex.id,
    titleAr: ex.titleAr,
    descriptionAr: ex.descriptionAr || '',
    instructionsAr: ex.instructionsAr || '',
    examType: (ex.examType as ExamType) || 'LESSON_QUIZ',
    publicationStatus: (ex.publicationStatus as ExamPublicationStatus) || 'DRAFT',
    assignmentScope: (ex.assignmentScope as ExamAssignmentScope) || 'GRADE',
    trackId: ex.trackId,
    trackNameAr: trackRow?.nameAr || '—',
    gradeId: ex.gradeId,
    gradeNameAr: gradeRow?.nameAr || '—',
    unitId: ex.unitId,
    unitTitleAr: unitRow?.titleAr || null,
    lessonId: ex.lessonId,
    lessonTitleAr: lessonRow?.titleAr || null,
    courseId: ex.courseId,
    courseTitleAr: courseRow?.titleAr || null,
    requiredVideoId: ex.requiredVideoId,
    durationMin: ex.durationMin,
    totalMarks: Number(ex.totalMarks || 0),
    calculatedMarks,
    questionCount: mappedQuestions.length,
    passScorePercent: ex.passScorePercent,
    maxAttempts: ex.maxAttempts,
    startsAt: ex.startsAt ? ex.startsAt.toISOString() : null,
    endsAt: ex.endsAt ? ex.endsAt.toISOString() : null,
    shuffleQuestions: ex.shuffleQuestions,
    shuffleChoices: ex.shuffleChoices,
    allowNavigation: ex.allowNavigation,
    allowReviewBeforeSubmit: ex.allowReviewBeforeSubmit,
    allowStudentReview: ex.allowStudentReview,
    showResultImmediately: ex.showResultImmediately,
    showCorrectAnswers: ex.showCorrectAnswers,
    showExplanations: ex.showExplanations,
    allowNegativeMarking: ex.allowNegativeMarking,
    assignedGroupIds: assignRows.filter((a) => a.groupId !== null).map((a) => a.groupId!),
    assignedStudentIds: assignRows.filter((a) => a.studentId !== null).map((a) => a.studentId!),
    attemptsCount: 0,
    submittedCount: 0,
    pendingManualCount: 0,
    createdAt: ex.createdAt.toISOString(),
    updatedAt: updatedAtIso,
  };

  return {
    exam: examItem,
    versionToken: updatedAtIso,
    savedAtIso: updatedAtIso,
    calculatedMarks,
    questionCount: mappedQuestions.length,
    distribution,
    questions: mappedQuestions,
  };
}

// 1. List resumable server-backed DRAFT exams visible to the authenticated staff member
examWizardRouter.get('/drafts', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const draftRows = await db
      .select()
      .from(exams)
      .where(eq(exams.publicationStatus, 'DRAFT'))
      .orderBy(desc(exams.updatedAt), desc(exams.id))
      .limit(30);

    if (draftRows.length === 0) {
      return res.json({ drafts: [] as ExamWizardDraftSummary[] });
    }

    const draftIds = draftRows.map((d) => d.id);
    const [creatorMap, allTracks, allGrades, eqRows] = await Promise.all([
      resolveExamCreatorsMap(draftIds),
      db.select().from(academicTracks),
      db.select().from(grades),
      db
        .select({
          examId: examQuestions.examId,
          pointsOverride: examQuestions.pointsOverride,
          points: questions.points,
        })
        .from(examQuestions)
        .innerJoin(questions, eq(examQuestions.questionId, questions.id))
        .where(inArray(examQuestions.examId, draftIds)),
    ]);

    const trackMap = new Map(allTracks.map((t) => [t.id, t.nameAr]));
    const gradeMap = new Map(allGrades.map((g) => [g.id, g.nameAr]));

    const visibleDrafts = draftRows.filter((ex) =>
      canActorAccessWizardDraft({
        actorRoleSlug: actor.roleSlug,
        actorId: actor.id,
        creatorActorId: creatorMap.get(ex.id) ?? null,
      }),
    );

    const drafts: ExamWizardDraftSummary[] = visibleDrafts.map((ex) => {
      const links = eqRows.filter((l) => l.examId === ex.id);
      const calculatedMarks = links.reduce((sum, l) => sum + (l.pointsOverride ?? l.points), 0);
      return {
        id: ex.id,
        titleAr: ex.titleAr,
        trackId: ex.trackId,
        trackNameAr: (ex.trackId ? trackMap.get(ex.trackId) : null) || '—',
        gradeId: ex.gradeId,
        gradeNameAr: gradeMap.get(ex.gradeId) || '—',
        examType: (ex.examType as ExamType) || 'LESSON_QUIZ',
        questionCount: links.length,
        calculatedMarks,
        totalMarks: Number(ex.totalMarks || 0),
        durationMin: ex.durationMin,
        updatedAt: ex.updatedAt.toISOString(),
        createdAt: ex.createdAt.toISOString(),
      };
    });

    return res.json({ drafts });
  } catch (error) {
    console.error('List wizard drafts error:', error);
    return res.status(500).json({ error: 'تعذر تحميل مسودات الامتحانات المحفوظة.' });
  }
});

// 2. Load a specific resumable DRAFT exam with full questions & versionToken
examWizardRouter.get('/draft/:id', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      return res.status(400).json({ error: 'معرّف مسودة الامتحان غير صالح.' });
    }

    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });
    }

    const creatorActorId = await resolveExamCreatorActorId(examId);
    if (
      !canActorAccessWizardDraft({
        actorRoleSlug: actor.roleSlug,
        actorId: actor.id,
        creatorActorId,
      })
    ) {
      return res.status(403).json({
        error: 'ليس لديك صلاحية للوصول إلى مسودة امتحان أنشأها مستخدم آخر.',
      });
    }

    if (existing.publicationStatus !== 'DRAFT') {
      return res.status(409).json({
        error: 'هذا الامتحان لم يعد مسودة؛ يمكنك تعديله من محرر الامتحانات الرئيسي.',
        code: 'NOT_A_DRAFT',
      });
    }

    const payload = await loadWizardDraftResponse(examId, actor);
    if (!payload) {
      return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });
    }
    return res.json(payload);
  } catch (error) {
    console.error('Get wizard draft error:', error);
    return res.status(500).json({ error: 'تعذر تحميل مسودة الامتحان.' });
  }
});

// 3. Idempotent DRAFT creation (never auto-publishes; deduplicates retries via clientDraftKey)
examWizardRouter.post('/draft', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const parsed = wizardDraftPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات مسودة الامتحان غير مكتملة.',
      });
    }
    const d = parsed.data;

    // Idempotency guard: if the same user retries creation with the same clientDraftKey, reuse existing draft
    if (d.clientDraftKey) {
      const cached = clientDraftKeyMap.get(`${actor.id}:${d.clientDraftKey}`);
      if (cached) {
        const [existingDraft] = await db
          .select()
          .from(exams)
          .where(eq(exams.id, cached.examId))
          .limit(1);
        if (existingDraft && existingDraft.publicationStatus === 'DRAFT') {
          const payload = await loadWizardDraftResponse(existingDraft.id, actor);
          if (payload) {
            return res.status(200).json({ ...payload, idempotentReused: true });
          }
        }
      }
    }

    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) {
      return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود.' });
    }

    const startsAt = parseOptionalDate(d.startsAt);
    const endsAt = parseOptionalDate(d.endsAt);
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return res.status(400).json({ error: 'يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء.' });
    }

    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(exams)
        .values({
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr,
          instructionsAr: d.instructionsAr,
          trackId: d.trackId ?? gradeRow.trackId,
          gradeId: d.gradeId,
          unitId: d.unitId ?? null,
          lessonId: d.lessonId ?? null,
          courseId: d.courseId ?? null,
          requiredVideoId: d.requiredVideoId ?? null,
          examType: d.examType,
          totalMarks: d.totalMarks.toFixed(2),
          durationMin: d.durationMin,
          passScorePercent: d.passScorePercent,
          startsAt,
          endsAt,
          maxAttempts: d.maxAttempts,
          shuffleQuestions: d.shuffleQuestions,
          shuffleChoices: d.shuffleChoices,
          allowNavigation: d.allowNavigation,
          allowReviewBeforeSubmit: d.allowReviewBeforeSubmit,
          allowStudentReview: d.allowStudentReview,
          showResultImmediately: d.showResultImmediately,
          showCorrectAnswers: d.showCorrectAnswers,
          showExplanations: d.showExplanations,
          allowNegativeMarking: d.allowNegativeMarking,
          publicationStatus: 'DRAFT',
          isPublished: false,
          assignmentScope: d.assignmentScope,
        })
        .returning();

      if (d.assignmentScope === 'GROUP' && d.assignedGroupIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedGroupIds.map((groupId) => ({ examId: inserted.id, groupId })),
        );
      } else if (d.assignmentScope === 'STUDENTS' && d.assignedStudentIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedStudentIds.map((studentId) => ({ examId: inserted.id, studentId })),
        );
      }

      return inserted;
    });

    await logAudit({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'WIZARD_EXAM_DRAFT_CREATED',
      entityType: 'exam',
      entityId: created.id,
      details: {
        titleAr: created.titleAr,
        examType: created.examType,
        gradeId: created.gradeId,
      },
    });

    if (d.clientDraftKey) {
      rememberDraftKey(actor.id, d.clientDraftKey, created.id);
    }

    const payload = await loadWizardDraftResponse(created.id, actor);
    return res.status(201).json(payload);
  } catch (error) {
    console.error('Create wizard draft error:', error);
    return res.status(500).json({ error: 'تعذر إنشاء مسودة الامتحان.' });
  }
});

// 4. Server-backed Autosave / Draft Update (optimistic concurrency + strict DRAFT-only guard)
examWizardRouter.put('/draft/:id', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      return res.status(400).json({ error: 'معرّف مسودة الامتحان غير صالح.' });
    }

    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });
    }

    const creatorActorId = await resolveExamCreatorActorId(examId);
    if (
      !canActorAccessWizardDraft({
        actorRoleSlug: actor.roleSlug,
        actorId: actor.id,
        creatorActorId,
      })
    ) {
      return res.status(403).json({
        error: 'ليس لديك صلاحية لتعديل مسودة امتحان أنشأها مستخدم آخر.',
      });
    }

    if (existing.publicationStatus !== 'DRAFT') {
      return res.status(409).json({
        error: 'لا يمكن الحفظ التلقائي على امتحان منشور أو مجدول أو مؤرشف؛ الحفظ التلقائي مخصص للمسودات فقط.',
        code: 'NOT_A_DRAFT',
      });
    }

    const parsed = wizardDraftPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'بيانات حفظ المسودة غير صالحة.',
      });
    }
    const d = parsed.data;

    if (isStaleDraftWrite(existing.updatedAt, d.expectedUpdatedAt)) {
      return res.status(409).json({
        error: 'تم تحديث هذه المسودة من نافذة أو جلسة أخرى. يرجى إعادة تحميل أحدث نسخة حتى لا تضيع تعديلاتك.',
        code: 'STALE_DRAFT_CONFLICT',
        latestUpdatedAt: existing.updatedAt.toISOString(),
      });
    }

    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) {
      return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود.' });
    }

    const startsAt = parseOptionalDate(d.startsAt);
    const endsAt = parseOptionalDate(d.endsAt);
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return res.status(400).json({ error: 'يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء.' });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(exams)
        .set({
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr,
          instructionsAr: d.instructionsAr,
          trackId: d.trackId ?? gradeRow.trackId,
          gradeId: d.gradeId,
          unitId: d.unitId ?? null,
          lessonId: d.lessonId ?? null,
          courseId: d.courseId ?? null,
          requiredVideoId: d.requiredVideoId ?? null,
          examType: d.examType,
          totalMarks: d.totalMarks.toFixed(2),
          durationMin: d.durationMin,
          passScorePercent: d.passScorePercent,
          startsAt,
          endsAt,
          maxAttempts: d.maxAttempts,
          shuffleQuestions: d.shuffleQuestions,
          shuffleChoices: d.shuffleChoices,
          allowNavigation: d.allowNavigation,
          allowReviewBeforeSubmit: d.allowReviewBeforeSubmit,
          allowStudentReview: d.allowStudentReview,
          showResultImmediately: d.showResultImmediately,
          showCorrectAnswers: d.showCorrectAnswers,
          showExplanations: d.showExplanations,
          allowNegativeMarking: d.allowNegativeMarking,
          // Autosave NEVER publishes!
          publicationStatus: 'DRAFT',
          isPublished: false,
          assignmentScope: d.assignmentScope,
          updatedAt: new Date(),
        })
        .where(eq(exams.id, examId));

      await tx.delete(examAssignments).where(eq(examAssignments.examId, examId));
      if (d.assignmentScope === 'GROUP' && d.assignedGroupIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedGroupIds.map((groupId) => ({ examId, groupId })),
        );
      } else if (d.assignmentScope === 'STUDENTS' && d.assignedStudentIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedStudentIds.map((studentId) => ({ examId, studentId })),
        );
      }
    });

    const payload = await loadWizardDraftResponse(examId, actor);
    return res.json(payload);
  } catch (error) {
    console.error('Autosave wizard draft error:', error);
    return res.status(500).json({ error: 'تعذر حفظ التغييرات على المسودة.' });
  }
});

// 5. Update exam-specific marks for a single question inside a DRAFT exam (NEVER mutates master bank question)
examWizardRouter.patch('/draft/:id/questions/:questionId/points', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const examId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(examId) || examId <= 0 || !Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ error: 'معرّف الامتحان أو السؤال غير صالح.' });
    }

    const bodySchema = z.object({
      points: z.coerce.number().int().min(1, 'درجة السؤال يجب أن تكون 1 على الأقل').max(200),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'قيمة درجة السؤال غير صالحة.',
      });
    }

    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });

    const creatorActorId = await resolveExamCreatorActorId(examId);
    if (
      !canActorAccessWizardDraft({
        actorRoleSlug: actor.roleSlug,
        actorId: actor.id,
        creatorActorId,
      })
    ) {
      return res.status(403).json({
        error: 'ليس لديك صلاحية لتعديل أسئلة مسودة أنشأها مستخدم آخر.',
      });
    }

    if (existing.publicationStatus !== 'DRAFT') {
      return res.status(409).json({
        error: 'هذا الامتحان لم يعد مسودة.',
        code: 'NOT_A_DRAFT',
      });
    }

    const [link] = await db
      .select({
        linkId: examQuestions.id,
        isBankItem: questions.isBankItem,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)))
      .limit(1);

    if (!link) {
      return res.status(404).json({ error: 'السؤال غير مرتبط بهذه المسودة.' });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(examQuestions)
        .set({ pointsOverride: parsed.data.points })
        .where(eq(examQuestions.id, link.linkId));

      // Only update the exam-scoped snapshot/manual question row (never a master bank row)
      if (!link.isBankItem) {
        await tx
          .update(questions)
          .set({ points: parsed.data.points })
          .where(and(eq(questions.id, questionId), eq(questions.isBankItem, false)));
      }

      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, examId));
    });

    const payload = await loadWizardDraftResponse(examId, actor);
    return res.json(payload);
  } catch (error) {
    console.error('Update wizard question points error:', error);
    return res.status(500).json({ error: 'تعذر تحديث درجة السؤال.' });
  }
});

// 6. Explicit Authorized Publication (requires confirmPublish: true + full server-side readiness validation)
examWizardRouter.post('/draft/:id/publish', async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId) || examId <= 0) {
      return res.status(400).json({ error: 'معرّف الامتحان غير صالح.' });
    }

    const bodySchema = z.object({
      confirmPublish: z.boolean(),
      expectedUpdatedAt: z.string().nullable().optional(),
      syncTotalMarksToCalculated: z.boolean().optional().default(false),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.confirmPublish) {
      return res.status(400).json({
        error: 'يتطلب نشر الامتحان تأكيدًا صريحًا قبل إتاحته للطلاب.',
      });
    }

    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });

    const creatorActorId = await resolveExamCreatorActorId(examId);
    if (
      !canActorAccessWizardDraft({
        actorRoleSlug: actor.roleSlug,
        actorId: actor.id,
        creatorActorId,
      })
    ) {
      return res.status(403).json({
        error: 'ليس لديك صلاحية لنشر مسودة امتحان أنشأها مستخدم آخر.',
      });
    }

    if (existing.publicationStatus !== 'DRAFT') {
      return res.status(409).json({
        error: 'تم نشر هذا الامتحان مسبقًا أو تغيّرت حالته.',
        code: 'NOT_A_DRAFT',
      });
    }

    if (isStaleDraftWrite(existing.updatedAt, parsed.data.expectedUpdatedAt)) {
      return res.status(409).json({
        error: 'تم تعديل المسودة في جلسة أخرى قبل النشر. يرجى إعادة التحميل والمراجعة أولًا.',
        code: 'STALE_DRAFT_CONFLICT',
        latestUpdatedAt: existing.updatedAt.toISOString(),
      });
    }

    const draftSnapshot = await loadWizardDraftResponse(examId, actor);
    if (!draftSnapshot) {
      return res.status(404).json({ error: 'مسودة الامتحان غير موجودة.' });
    }

    const validation = validateExamWizardDraft(
      {
        titleAr: draftSnapshot.exam.titleAr,
        gradeId: draftSnapshot.exam.gradeId,
        durationMin: draftSnapshot.exam.durationMin,
        totalMarks: draftSnapshot.exam.totalMarks,
        passScorePercent: draftSnapshot.exam.passScorePercent,
        maxAttempts: draftSnapshot.exam.maxAttempts,
        startsAt: draftSnapshot.exam.startsAt,
        endsAt: draftSnapshot.exam.endsAt,
        assignmentScope: draftSnapshot.exam.assignmentScope,
        assignedGroupIds: draftSnapshot.exam.assignedGroupIds,
        assignedStudentIds: draftSnapshot.exam.assignedStudentIds,
      },
      draftSnapshot.questions,
    );

    if (!validation.isReadyToPublish) {
      return res.status(400).json({
        error: validation.errors[0]?.messageAr || 'الامتحان غير مكتمل للنشر بعد.',
        validation,
      });
    }

    const effectiveStatus = resolveEffectivePublishStatus(existing.startsAt);
    const shouldSyncMarks =
      parsed.data.syncTotalMarksToCalculated || Number(existing.totalMarks || 0) <= 0;
    const finalTotalMarks = shouldSyncMarks
      ? validation.calculatedMarks.toFixed(2)
      : existing.totalMarks;

    const [updated] = await db
      .update(exams)
      .set({
        publicationStatus: effectiveStatus,
        isPublished: true,
        totalMarks: finalTotalMarks,
        updatedAt: new Date(),
      })
      .where(eq(exams.id, examId))
      .returning();

    if (existing.assignmentScope === 'GRADE') {
      await createNotification({
        gradeId: existing.gradeId,
        titleAr: `امتحان فيزياء جديد: ${existing.titleAr}`,
        bodyAr: `مدة الامتحان ${existing.durationMin} دقيقة · ${draftSnapshot.questionCount} سؤال · الدرجة الكلية ${Number(finalTotalMarks)}.`,
        type: 'NEW_EXAM',
        targetType: 'EXAM',
        targetId: existing.id,
      });
    }

    await logAudit({
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'PHASE2_EXAM_PUBLISHED_VIA_WIZARD',
      entityType: 'exam',
      entityId: examId,
      details: {
        titleAr: existing.titleAr,
        publishedStatus: effectiveStatus,
        questionCount: draftSnapshot.questionCount,
        calculatedMarks: validation.calculatedMarks,
      },
    });

    return res.json({
      exam: updated,
      publishedStatus: effectiveStatus,
      message:
        effectiveStatus === 'SCHEDULED'
          ? 'تمت جدولة الامتحان بنجاح وسيُتاح للطلاب تلقائيًا في موعد البدء المحدد.'
          : 'تم نشر الامتحان بنجاح وأصبح متاحًا للطلاب المستهدفين.',
    });
  } catch (error) {
    console.error('Publish wizard draft error:', error);
    return res.status(500).json({ error: 'تعذر نشر الامتحان حاليًا.' });
  }
});
