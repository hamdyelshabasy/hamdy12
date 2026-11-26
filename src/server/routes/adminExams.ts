import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  academicTracks,
  choices,
  courses,
  enrollments,
  examAssignments,
  examAttempts,
  examQuestions,
  exams,
  grades,
  groupMembers,
  groups,
  lessons,
  questionAttachments,
  questions,
  roles,
  studentAnswers,
  units,
  users,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  requireAuth,
  requirePermission,
  requireStaff,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification, logAudit } from '../audit.ts';
import { computeExamAnalytics, validateQuestionImageInput } from '../domain/exams.ts';
import { buildSignedQuestionBankFileUrl } from '../domain/questionBank.ts';
import { smartExamGeneratorRouter } from './smartExamGenerator.ts';
import { examWizardRouter } from './examWizard.ts';

export const adminExamsRouter = Router();

adminExamsRouter.use(requireAuth, requireStaff());
adminExamsRouter.use('/smart-generator', smartExamGeneratorRouter);
adminExamsRouter.use('/wizard', examWizardRouter);

const EXAM_TYPES = [
  'LESSON_QUIZ',
  'UNIT_EXAM',
  'MONTHLY',
  'COMPREHENSIVE',
  'FINAL_SIMULATION',
  'HOMEWORK',
] as const;

const PUBLICATION_STATUSES = [
  'PUBLISHED',
  'DRAFT',
  'SCHEDULED',
  'HIDDEN',
  'ARCHIVED',
] as const;

const QUESTION_TYPES = [
  'MCQ',
  'TRUE_FALSE',
  'NUMERIC',
  'SHORT_ANSWER',
  'ESSAY',
  'IMAGE_DIAGRAM',
  'PHYSICS_PROBLEM',
  'FILE_UPLOAD',
] as const;

const examPayloadSchema = z.object({
  titleAr: z.string().trim().min(3, 'عنوان الامتحان يجب أن يكون 3 أحرف على الأقل'),
  descriptionAr: z.string().optional().default(''),
  instructionsAr: z.string().optional().default(''),
  trackId: z.coerce.number().int().positive().nullable().optional(),
  gradeId: z.coerce.number().int().positive(),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  courseId: z.coerce.number().int().positive().nullable().optional(),
  requiredVideoId: z.coerce.number().int().positive().nullable().optional(),
  examType: z.enum(EXAM_TYPES).default('LESSON_QUIZ'),
  totalMarks: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)).default(0),
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
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('DRAFT'),
  assignmentScope: z.enum(['GRADE', 'GROUP', 'STUDENTS']).default('GRADE'),
  assignedGroupIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  assignedStudentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

const questionPayloadSchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  promptAr: z.string().trim().min(3, 'نص السؤال مطلوب'),
  latexFormula: z.string().trim().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  points: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(100)).default(2),
  negativePoints: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0).max(50)).default(0),
  numericAnswer: z.string().nullable().optional(),
  numericTolerance: z.string().optional().default('0.05'),
  numericUnit: z.string().optional().default(''),
  shortAnswerRules: z.array(z.string()).optional().default([]),
  modelAnswerAr: z.string().optional().default(''),
  explanationAr: z.string().optional().default(''),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  choices: z
    .array(
      z.object({
        labelAr: z.string().trim().min(1),
        latexFormula: z.string().trim().nullable().optional(),
        isCorrect: z.boolean().default(false),
      }),
    )
    .optional()
    .default([]),
});

function parseOptionalDate(val: string | null | undefined): Date | null {
  if (!val || !val.trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function computeExamQuestionsSummary(
  examId: number,
  viewer?: { id: number; roleSlug: string },
) {
  const rows = await db
    .select({
      link: examQuestions,
      q: questions,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(examQuestions.questionId, questions.id))
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.sortOrder), asc(examQuestions.id));

  const qIds = rows.map((r) => r.q.id);
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

  const calculatedMarks = rows.reduce((s, r) => s + (r.link.pointsOverride ?? r.q.points), 0);
  const distribution: Record<string, number> = {};
  for (const r of rows) {
    distribution[r.q.questionType] = (distribution[r.q.questionType] || 0) + 1;
  }

  return {
    calculatedMarks,
    questionCount: rows.length,
    distribution,
    questions: rows.map((r) => {
      const qAtts = attRows.filter((a) => a.questionId === r.q.id);
      const questionImages = qAtts
        .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
        .map((a) => ({
          storageKey: a.storageKey,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          displayOrder: a.displayOrder,
          previewUrl: viewer
            ? buildSignedQuestionBankFileUrl({
                storageKey: a.storageKey,
                userId: viewer.id,
                roleSlug: viewer.roleSlug,
                context: 'exam',
                resourceId: examId,
                fileRole: 'question',
              })
            : '',
        }));
      const modelAnswerFiles = qAtts
        .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
        .map((a) => ({
          storageKey: a.storageKey,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          displayOrder: a.displayOrder,
          previewUrl: viewer
            ? buildSignedQuestionBankFileUrl({
                storageKey: a.storageKey,
                userId: viewer.id,
                roleSlug: viewer.roleSlug,
                context: 'exam',
                resourceId: examId,
                fileRole: 'model_answer',
              })
            : '',
        }));

      return {
        linkId: r.link.id,
        id: r.q.id,
        sourceBankQuestionId: r.q.sourceBankQuestionId ?? null,
        sortOrder: r.link.sortOrder,
        questionType: r.q.questionType,
        difficulty: r.q.difficulty,
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
        shortAnswerRules: Array.isArray(r.q.shortAnswerRulesJson) ? r.q.shortAnswerRulesJson : [],
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
    }),
  };
}

// 1. List all exams with filters, stats, and lookup data (groups & approved students)
adminExamsRouter.get(
  '/',
  requirePermission([PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE]),
  async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const trackIdFilter = Number(req.query.trackId || 0);
    const gradeIdFilter = Number(req.query.gradeId || 0);
    const unitIdFilter = Number(req.query.unitId || 0);
    const lessonIdFilter = Number(req.query.lessonId || 0);
    const examTypeFilter = String(req.query.examType || 'ALL');
    const statusFilter = String(req.query.publicationStatus || 'ALL');

    const [
      allExams,
      allTracks,
      allGrades,
      allUnits,
      allLessons,
      allCourses,
      allGroups,
      allGroupMembers,
      allExamQuestions,
      allQuestions,
      allAssignments,
      allAttempts,
      pendingManualAnswers,
      approvedStudentsRaw,
    ] = await Promise.all([
      db.select().from(exams).orderBy(desc(exams.createdAt)),
      db.select().from(academicTracks).orderBy(asc(academicTracks.sortOrder)),
      db.select().from(grades).orderBy(asc(grades.sortOrder)),
      db.select().from(units).orderBy(asc(units.sortOrder)),
      db.select().from(lessons).orderBy(asc(lessons.sortOrder)),
      db.select().from(courses).orderBy(asc(courses.sortOrder)),
      db.select().from(groups).orderBy(asc(groups.id)),
      db.select().from(groupMembers),
      db.select().from(examQuestions),
      db.select({ id: questions.id, points: questions.points, questionType: questions.questionType }).from(questions),
      db.select().from(examAssignments),
      db.select().from(examAttempts),
      db
        .select({ attemptId: studentAnswers.attemptId })
        .from(studentAnswers)
        .where(eq(studentAnswers.needsManualGrading, true)),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
          gradeId: enrollments.gradeId,
        })
        .from(users)
        .innerJoin(roles, and(eq(users.roleId, roles.id), eq(roles.slug, 'STUDENT')))
        .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.status, 'ACTIVE')))
        .where(eq(users.status, 'ACTIVE'))
        .orderBy(asc(users.fullName)),
    ]);

    const gradeMap = new Map(allGrades.map((g) => [g.id, g]));
    const trackMap = new Map(allTracks.map((t) => [t.id, t]));
    const unitMap = new Map(allUnits.map((u) => [u.id, u]));
    const lessonMap = new Map(allLessons.map((l) => [l.id, l]));
    const courseMap = new Map(allCourses.map((c) => [c.id, c]));
    const qMap = new Map(allQuestions.map((q) => [q.id, q]));
    const pendingAttemptIds = new Set(pendingManualAnswers.map((a) => a.attemptId));

    const enriched = allExams
      .map((ex) => {
        const grade = gradeMap.get(ex.gradeId);
        const resolvedTrackId = ex.trackId || grade?.trackId || null;
        const track = resolvedTrackId ? trackMap.get(resolvedTrackId) : undefined;
        const unit = ex.unitId ? unitMap.get(ex.unitId) : undefined;
        const lesson = ex.lessonId ? lessonMap.get(ex.lessonId) : undefined;
        const course = ex.courseId ? courseMap.get(ex.courseId) : undefined;

        const eqLinks = allExamQuestions.filter((l) => l.examId === ex.id);
        const calculatedMarks = eqLinks.reduce(
          (sum, l) => sum + (l.pointsOverride ?? qMap.get(l.questionId)?.points ?? 0),
          0,
        );
        const exAssignments = allAssignments.filter((a) => a.examId === ex.id);
        const assignedGroupIds = [
          ...new Set([
            ...exAssignments.filter((a) => a.groupId !== null).map((a) => a.groupId!),
            ...(ex.groupId ? [ex.groupId] : []),
          ]),
        ];
        const assignedStudentIds = [
          ...new Set([
            ...exAssignments.filter((a) => a.studentId !== null).map((a) => a.studentId!),
            ...(ex.assignedUserId ? [ex.assignedUserId] : []),
          ]),
        ];

        const exAttempts = allAttempts.filter((a) => a.examId === ex.id);
        const submittedAttempts = exAttempts.filter((a) => a.status !== 'IN_PROGRESS');
        const pendingManualCount = exAttempts.filter(
          (a) =>
            pendingAttemptIds.has(a.id) ||
            a.status === 'AWAITING_MANUAL_GRADING' ||
            a.status === 'SUBMITTED',
        ).length;

        const effectiveStatus = ex.publicationStatus || (ex.isPublished ? 'PUBLISHED' : 'DRAFT');

        return {
          ...ex,
          trackId: resolvedTrackId,
          trackNameAr: track?.nameAr || '',
          gradeNameAr: grade?.nameAr || '',
          unitTitleAr: unit?.titleAr || null,
          lessonTitleAr: lesson?.titleAr || null,
          courseTitleAr: course?.titleAr || null,
          totalMarks: Number(ex.totalMarks || 0),
          calculatedMarks,
          questionCount: eqLinks.length,
          publicationStatus: effectiveStatus,
          assignmentScope: ex.assignmentScope || (assignedStudentIds.length ? 'STUDENTS' : assignedGroupIds.length ? 'GROUP' : 'GRADE'),
          assignedGroupIds,
          assignedStudentIds,
          attemptsCount: exAttempts.length,
          submittedCount: submittedAttempts.length,
          pendingManualCount,
        };
      })
      .filter((ex) => {
        if (search && !ex.titleAr.toLowerCase().includes(search) && !(ex.descriptionAr || '').toLowerCase().includes(search)) {
          return false;
        }
        if (trackIdFilter && ex.trackId !== trackIdFilter) return false;
        if (gradeIdFilter && ex.gradeId !== gradeIdFilter) return false;
        if (unitIdFilter && ex.unitId !== unitIdFilter) return false;
        if (lessonIdFilter && ex.lessonId !== lessonIdFilter) return false;
        if (examTypeFilter !== 'ALL' && ex.examType !== examTypeFilter) return false;
        if (statusFilter !== 'ALL' && ex.publicationStatus !== statusFilter) return false;
        return true;
      });

    return res.json({
      exams: enriched,
      groups: allGroups.map((g) => ({
        ...g,
        memberCount: allGroupMembers.filter((m) => m.groupId === g.id).length,
      })),
      approvedStudents: approvedStudentsRaw,
    });
  } catch (error) {
    console.error('Admin phase2 exams list error:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الامتحانات' });
  }
});

// 2. Get full exam detail with embedded questions, choices, assignments, and stats
adminExamsRouter.get(
  '/:id',
  requirePermission([PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE]),
  async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isFinite(examId) || examId <= 0) {
      return res.status(400).json({ error: 'معرف الامتحان غير صالح' });
    }

    const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, examRow.gradeId)).limit(1);
    const [assignmentsRows, qSummary] = await Promise.all([
      db.select().from(examAssignments).where(eq(examAssignments.examId, examId)),
      computeExamQuestionsSummary(examId, req.authUser),
    ]);

    const assignedGroupIds = [
      ...new Set([
        ...assignmentsRows.filter((a) => a.groupId !== null).map((a) => a.groupId!),
        ...(examRow.groupId ? [examRow.groupId] : []),
      ]),
    ];
    const assignedStudentIds = [
      ...new Set([
        ...assignmentsRows.filter((a) => a.studentId !== null).map((a) => a.studentId!),
        ...(examRow.assignedUserId ? [examRow.assignedUserId] : []),
      ]),
    ];

    return res.json({
      exam: {
        ...examRow,
        trackId: examRow.trackId || gradeRow?.trackId || null,
        totalMarks: Number(examRow.totalMarks || 0),
        publicationStatus: examRow.publicationStatus || (examRow.isPublished ? 'PUBLISHED' : 'DRAFT'),
        assignedGroupIds,
        assignedStudentIds,
      },
      ...qSummary,
    });
  } catch (error) {
    console.error('Admin exam detail error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الامتحان' });
  }
});

// 3. Create Exam
adminExamsRouter.post('/', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = examPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الامتحان غير صالحة' });
    }
    const d = parsed.data;
    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود' });

    const startsAt = parseOptionalDate(d.startsAt);
    const endsAt = parseOptionalDate(d.endsAt);
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return res.status(400).json({ error: 'يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء' });
    }

    const effectivePubStatus =
      d.publicationStatus === 'PUBLISHED' && startsAt && startsAt.getTime() > Date.now()
        ? 'SCHEDULED'
        : d.publicationStatus;
    const isPublishedBool = effectivePubStatus === 'PUBLISHED' || effectivePubStatus === 'SCHEDULED';

    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(exams)
        .values({
          trackId: d.trackId || gradeRow.trackId,
          gradeId: d.gradeId,
          unitId: d.unitId ?? null,
          lessonId: d.lessonId ?? null,
          courseId: d.courseId ?? null,
          requiredVideoId: d.requiredVideoId ?? null,
          groupId: d.assignmentScope === 'GROUP' && d.assignedGroupIds.length === 1 ? d.assignedGroupIds[0] : null,
          assignedUserId: d.assignmentScope === 'STUDENTS' && d.assignedStudentIds.length === 1 ? d.assignedStudentIds[0] : null,
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr,
          instructionsAr: d.instructionsAr,
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
          assignmentScope: d.assignmentScope,
          publicationStatus: effectivePubStatus,
          isPublished: isPublishedBool,
          updatedAt: new Date(),
        })
        .returning();

      if (d.assignmentScope === 'GROUP' && d.assignedGroupIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedGroupIds.map((gid) => ({ examId: inserted.id, groupId: gid, studentId: null })),
        );
      } else if (d.assignmentScope === 'STUDENTS' && d.assignedStudentIds.length > 0) {
        await tx.insert(examAssignments).values(
          d.assignedStudentIds.map((sid) => ({ examId: inserted.id, studentId: sid, groupId: null })),
        );
      }

      return inserted;
    });

    if (isPublishedBool && d.assignmentScope === 'GRADE') {
      await createNotification({
        gradeId: d.gradeId,
        titleAr: effectivePubStatus === 'SCHEDULED' ? 'تمت جدولة امتحان جديد' : 'تم نشر امتحان جديد',
        bodyAr: `${d.titleAr} — المدة ${d.durationMin} دقيقة.`,
        type: 'NEW_EXAM',
        targetType: 'EXAM',
        targetId: created.id,
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PHASE2_EXAM_CREATED',
      entityType: 'exam',
      entityId: created.id,
      details: { titleAr: created.titleAr, examType: created.examType, publicationStatus: created.publicationStatus },
    });

    return res.status(201).json({ exam: created });
  } catch (error) {
    console.error('Create phase2 exam error:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الامتحان' });
  }
});

// 4. Update Exam settings, publication status, schedule, and assignments
adminExamsRouter.patch('/:id', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const partialSchema = examPayloadSchema.partial();
    const parsed = partialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التعديل غير صالحة' });
    }
    const d = parsed.data;

    const startsAt = d.startsAt !== undefined ? parseOptionalDate(d.startsAt) : existing.startsAt;
    const endsAt = d.endsAt !== undefined ? parseOptionalDate(d.endsAt) : existing.endsAt;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      return res.status(400).json({ error: 'يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء' });
    }

    const nextGradeId = d.gradeId ?? existing.gradeId;
    let nextTrackId = d.trackId !== undefined ? d.trackId : existing.trackId;
    if (d.gradeId && !d.trackId) {
      const [gRow] = await db.select().from(grades).where(eq(grades.id, nextGradeId)).limit(1);
      if (gRow) nextTrackId = gRow.trackId;
    }

    const nextPubStatus = d.publicationStatus ?? existing.publicationStatus ?? (existing.isPublished ? 'PUBLISHED' : 'DRAFT');
    const nextIsPublished = nextPubStatus === 'PUBLISHED' || nextPubStatus === 'SCHEDULED';
    const nextScope = d.assignmentScope ?? existing.assignmentScope ?? 'GRADE';

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(exams)
        .set({
          trackId: nextTrackId,
          gradeId: nextGradeId,
          unitId: d.unitId !== undefined ? d.unitId : existing.unitId,
          lessonId: d.lessonId !== undefined ? d.lessonId : existing.lessonId,
          courseId: d.courseId !== undefined ? d.courseId : existing.courseId,
          requiredVideoId: d.requiredVideoId !== undefined ? d.requiredVideoId : existing.requiredVideoId,
          titleAr: d.titleAr ?? existing.titleAr,
          descriptionAr: d.descriptionAr ?? existing.descriptionAr,
          instructionsAr: d.instructionsAr ?? existing.instructionsAr,
          examType: d.examType ?? existing.examType,
          totalMarks: d.totalMarks !== undefined ? d.totalMarks.toFixed(2) : existing.totalMarks,
          durationMin: d.durationMin ?? existing.durationMin,
          passScorePercent: d.passScorePercent ?? existing.passScorePercent,
          startsAt,
          endsAt,
          maxAttempts: d.maxAttempts ?? existing.maxAttempts,
          shuffleQuestions: d.shuffleQuestions ?? existing.shuffleQuestions,
          shuffleChoices: d.shuffleChoices ?? existing.shuffleChoices,
          allowNavigation: d.allowNavigation ?? existing.allowNavigation,
          allowReviewBeforeSubmit: d.allowReviewBeforeSubmit ?? existing.allowReviewBeforeSubmit,
          allowStudentReview: d.allowStudentReview ?? existing.allowStudentReview,
          showResultImmediately: d.showResultImmediately ?? existing.showResultImmediately,
          showCorrectAnswers: d.showCorrectAnswers ?? existing.showCorrectAnswers,
          showExplanations: d.showExplanations ?? existing.showExplanations,
          allowNegativeMarking: d.allowNegativeMarking ?? existing.allowNegativeMarking,
          assignmentScope: nextScope,
          groupId:
            d.assignedGroupIds !== undefined
              ? nextScope === 'GROUP' && d.assignedGroupIds.length === 1
                ? d.assignedGroupIds[0]
                : null
              : nextScope === 'GROUP'
                ? existing.groupId
                : null,
          assignedUserId:
            d.assignedStudentIds !== undefined
              ? nextScope === 'STUDENTS' && d.assignedStudentIds.length === 1
                ? d.assignedStudentIds[0]
                : null
              : nextScope === 'STUDENTS'
                ? existing.assignedUserId
                : null,
          publicationStatus: nextPubStatus,
          isPublished: nextIsPublished,
          updatedAt: new Date(),
        })
        .where(eq(exams.id, examId))
        .returning();

      if (d.assignmentScope !== undefined || d.assignedGroupIds !== undefined || d.assignedStudentIds !== undefined) {
        await tx.delete(examAssignments).where(eq(examAssignments.examId, examId));
        if (nextScope === 'GROUP' && d.assignedGroupIds && d.assignedGroupIds.length > 0) {
          await tx.insert(examAssignments).values(
            d.assignedGroupIds.map((gid) => ({ examId, groupId: gid, studentId: null })),
          );
        } else if (nextScope === 'STUDENTS' && d.assignedStudentIds && d.assignedStudentIds.length > 0) {
          await tx.insert(examAssignments).values(
            d.assignedStudentIds.map((sid) => ({ examId, studentId: sid, groupId: null })),
          );
        }
      }

      return row;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PHASE2_EXAM_UPDATED',
      entityType: 'exam',
      entityId: examId,
      details: { publicationStatus: updated.publicationStatus },
    });

    return res.json({ exam: updated });
  } catch (error) {
    console.error('Update phase2 exam error:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الامتحان' });
  }
});

// 5. Duplicate Exam (deep-clones exam, questions, choices, and assignments as DRAFT)
adminExamsRouter.post('/:id/duplicate', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const [source] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!source) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    const sourceAssignments = await db.select().from(examAssignments).where(eq(examAssignments.examId, examId));

    const duplicated = await db.transaction(async (tx) => {
      const [copyExam] = await tx
        .insert(exams)
        .values({
          trackId: source.trackId,
          gradeId: source.gradeId,
          unitId: source.unitId,
          lessonId: source.lessonId,
          courseId: source.courseId,
          groupId: source.groupId,
          assignedUserId: source.assignedUserId,
          requiredVideoId: source.requiredVideoId,
          titleAr: `${source.titleAr} (نسخة)`,
          descriptionAr: source.descriptionAr,
          instructionsAr: source.instructionsAr,
          examType: source.examType,
          totalMarks: source.totalMarks,
          durationMin: source.durationMin,
          passScorePercent: source.passScorePercent,
          startsAt: null,
          endsAt: null,
          maxAttempts: source.maxAttempts,
          shuffleQuestions: source.shuffleQuestions,
          shuffleChoices: source.shuffleChoices,
          allowNavigation: source.allowNavigation,
          allowReviewBeforeSubmit: source.allowReviewBeforeSubmit,
          allowStudentReview: source.allowStudentReview,
          showResultImmediately: source.showResultImmediately,
          showCorrectAnswers: source.showCorrectAnswers,
          showExplanations: source.showExplanations,
          allowNegativeMarking: source.allowNegativeMarking,
          assignmentScope: source.assignmentScope,
          publicationStatus: 'DRAFT',
          isPublished: false,
          updatedAt: new Date(),
        })
        .returning();

      for (let i = 0; i < qSummary.questions.length; i++) {
        const q = qSummary.questions[i];
        const [newQ] = await tx
          .insert(questions)
          .values({
            gradeId: source.gradeId,
            unitId: q.unitId,
            lessonId: q.lessonId,
            questionType: q.questionType,
            difficulty: q.difficulty,
            promptAr: q.promptAr,
            latexFormula: q.latexFormula,
            imageUrl: q.imageUrl,
            points: q.points,
            negativePoints: q.negativePoints.toFixed(2),
            numericAnswer: q.numericAnswer ? q.numericAnswer : null,
            numericTolerance: q.numericTolerance || '0.05',
            numericUnit: q.numericUnit || '',
            shortAnswerRulesJson: q.shortAnswerRules,
            modelAnswerAr: q.modelAnswerAr,
            explanationAr: q.explanationAr,
            isBankItem: false,
            sourceBankQuestionId: q.sourceBankQuestionId ?? null,
          })
          .returning();

        if (q.choices.length > 0) {
          await tx.insert(choices).values(
            q.choices.map((c, idx) => ({
              questionId: newQ.id,
              labelAr: c.labelAr,
              latexFormula: c.latexFormula,
              isCorrect: c.isCorrect,
              sortOrder: idx + 1,
            })),
          );
        }

        const clonedAtts = [
          ...(q.questionImages || []).map((a) => ({
            questionId: newQ.id,
            attachmentRole: 'QUESTION_IMAGE',
            storageKey: a.storageKey,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            captionAr: '',
            displayOrder: a.displayOrder,
          })),
          ...(q.modelAnswerFiles || []).map((a) => ({
            questionId: newQ.id,
            attachmentRole: a.mimeType === 'application/pdf' ? 'MODEL_ANSWER_PDF' : 'MODEL_ANSWER_IMAGE',
            storageKey: a.storageKey,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            captionAr: '',
            displayOrder: a.displayOrder,
          })),
        ];
        if (clonedAtts.length > 0) {
          await tx.insert(questionAttachments).values(clonedAtts);
        }

        await tx.insert(examQuestions).values({
          examId: copyExam.id,
          questionId: newQ.id,
          sortOrder: i + 1,
        });
      }

      if (sourceAssignments.length > 0) {
        await tx.insert(examAssignments).values(
          sourceAssignments.map((a) => ({
            examId: copyExam.id,
            studentId: a.studentId,
            groupId: a.groupId,
          })),
        );
      }

      return copyExam;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PHASE2_EXAM_DUPLICATED',
      entityType: 'exam',
      entityId: duplicated.id,
      details: { sourceExamId: examId },
    });

    return res.status(201).json({ exam: duplicated });
  } catch (error) {
    console.error('Duplicate exam error:', error);
    return res.status(500).json({ error: 'تعذر نسخ الامتحان' });
  }
});

// 6. Safe Delete Exam (never touches unrelated records)
adminExamsRouter.delete('/:id', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const [existing] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    await db.delete(exams).where(eq(exams.id, examId));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PHASE2_EXAM_DELETED',
      entityType: 'exam',
      entityId: examId,
      details: { titleAr: existing.titleAr },
    });

    return res.json({ deleted: true, id: examId });
  } catch (error) {
    console.error('Delete exam error:', error);
    return res.status(500).json({ error: 'تعذر حذف الامتحان' });
  }
});

// 7. Embedded Question Management: Add Question to Exam
adminExamsRouter.post('/:id/questions', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const parsed = questionPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات السؤال غير مكتملة' });
    }
    const d = parsed.data;

    const imgCheck = validateQuestionImageInput(d.imageUrl);
    if (!imgCheck.valid) {
      return res.status(400).json({ error: imgCheck.errorAr });
    }

    if (d.questionType === 'MCQ') {
      if (d.choices.length < 2) {
        return res.status(400).json({ error: 'سؤال الاختيار من متعدد يتطلب اختيارين على الأقل (يفضل 4 اختيارات)' });
      }
      if (!d.choices.some((c) => c.isCorrect)) {
        return res.status(400).json({ error: 'يرجى تحديد الإجابة الصحيحة بين الاختيارات' });
      }
    }

    if (d.questionType === 'NUMERIC' && (!d.numericAnswer || Number.isNaN(Number(d.numericAnswer.replace(',', '.'))))) {
      return res.status(400).json({ error: 'يرجى إدخال الإجابة الرقمية الصحيحة للسؤال الحسابي' });
    }

    const existingLinks = await db.select().from(examQuestions).where(eq(examQuestions.examId, examId));
    const nextOrder = existingLinks.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 1;

    const createdQ = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(questions)
        .values({
          gradeId: examRow.gradeId,
          unitId: d.unitId ?? examRow.unitId ?? null,
          lessonId: d.lessonId ?? examRow.lessonId ?? null,
          questionType: d.questionType,
          difficulty: d.difficulty,
          promptAr: d.promptAr,
          latexFormula: d.latexFormula || null,
          imageUrl: imgCheck.sanitized,
          points: d.points,
          negativePoints: d.negativePoints.toFixed(2),
          numericAnswer: d.numericAnswer && d.numericAnswer.trim() ? d.numericAnswer.replace(',', '.') : null,
          numericTolerance: d.numericTolerance || '0.05',
          numericUnit: d.numericUnit || '',
          shortAnswerRulesJson: d.shortAnswerRules.map((s) => s.trim()).filter(Boolean),
          modelAnswerAr: d.modelAnswerAr,
          explanationAr: d.explanationAr,
          isBankItem: false,
        })
        .returning();

      const choicesToSave =
        d.questionType === 'TRUE_FALSE' && d.choices.length === 0
          ? [
              { labelAr: 'صواب', latexFormula: null, isCorrect: true },
              { labelAr: 'خطأ', latexFormula: null, isCorrect: false },
            ]
          : d.choices;

      if (choicesToSave.length > 0) {
        await tx.insert(choices).values(
          choicesToSave.map((c, idx) => ({
            questionId: inserted.id,
            labelAr: c.labelAr,
            latexFormula: c.latexFormula || null,
            isCorrect: c.isCorrect,
            sortOrder: idx + 1,
          })),
        );
      }

      await tx.insert(examQuestions).values({
        examId,
        questionId: inserted.id,
        sortOrder: nextOrder,
      });

      // If exam totalMarks was 0 (not explicitly set yet), auto-sync totalMarks with sum
      if (Number(examRow.totalMarks) === 0) {
        const sumNow = existingLinks.length === 0 ? d.points : undefined;
        if (sumNow !== undefined) {
          await tx
            .update(exams)
            .set({ totalMarks: sumNow.toFixed(2), updatedAt: new Date() })
            .where(eq(exams.id, examId));
        }
      }

      return inserted;
    });

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    return res.status(201).json({ question: createdQ, ...qSummary });
  } catch (error) {
    console.error('Add exam question error:', error);
    return res.status(500).json({ error: 'تعذر إضافة السؤال إلى الامتحان' });
  }
});

// 7B. Select Approved Questions from Central Question Bank into Exam (Immutable Snapshot Clones)
adminExamsRouter.post(
  '/:id/questions/from-bank',
  requirePermission(PERMISSIONS.EXAMS_MANAGE),
  async (req: AuthRequest, res) => {
    try {
      const examId = Number(req.params.id);
      const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
      if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

      const schema = z.object({
        items: z
          .array(
            z.object({
              bankQuestionId: z.coerce.number().int().positive(),
              pointsOverride: z.coerce.number().int().min(1).max(200).optional(),
            }),
          )
          .min(1, 'يرجى اختيار سؤال واحد على الأقل من بنك الأسئلة')
          .max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'بيانات الأسئلة المختارة غير صالحة',
        });
      }

      const bankIds = Array.from(new Set(parsed.data.items.map((i) => i.bankQuestionId)));
      const bankRows = await db
        .select()
        .from(questions)
        .where(and(inArray(questions.id, bankIds), eq(questions.isBankItem, true)));

      const bankById = new Map(bankRows.map((b) => [b.id, b]));
      for (const item of parsed.data.items) {
        const bq = bankById.get(item.bankQuestionId);
        if (!bq) {
          return res.status(404).json({ error: `السؤال رقم ${item.bankQuestionId} غير موجود في بنك الأسئلة.` });
        }
        if (bq.isArchived || bq.approvalStatus !== 'APPROVED') {
          return res.status(400).json({
            error: `لا يمكن إضافة السؤال (${bq.bankCode || bq.id}) إلى الامتحان لأنه غير معتمد أو مؤرشف. يُسمح فقط بالأسئلة المعتمدة.`,
          });
        }
      }

      const [bankChoices, bankAttachments, existingLinks] = await Promise.all([
        db
          .select()
          .from(choices)
          .where(inArray(choices.questionId, bankIds))
          .orderBy(asc(choices.sortOrder), asc(choices.id)),
        db
          .select()
          .from(questionAttachments)
          .where(inArray(questionAttachments.questionId, bankIds))
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id)),
        db.select().from(examQuestions).where(eq(examQuestions.examId, examId)),
      ]);

      let nextOrder = existingLinks.reduce((m, l) => Math.max(m, l.sortOrder), 0);

      await db.transaction(async (tx) => {
        for (const item of parsed.data.items) {
          const bq = bankById.get(item.bankQuestionId)!;
          nextOrder += 1;
          const effectivePoints = item.pointsOverride ?? bq.points;

          // Create an immutable exam-scoped snapshot clone linked via sourceBankQuestionId
          const [clonedQ] = await tx
            .insert(questions)
            .values({
              trackId: bq.trackId,
              gradeId: bq.gradeId,
              unitId: bq.unitId ?? examRow.unitId ?? null,
              lessonId: bq.lessonId ?? examRow.lessonId ?? null,
              topicAr: bq.topicAr,
              questionType: bq.questionType,
              difficulty: bq.difficulty,
              promptAr: bq.promptAr || (bq.topicAr ? `سؤال مصور — ${bq.topicAr}` : 'سؤال مصور من بنك الأسئلة'),
              latexFormula: bq.latexFormula,
              imageUrl: bq.imageUrl,
              points: effectivePoints,
              negativePoints: bq.negativePoints,
              numericAnswer: bq.numericAnswer,
              numericTolerance: bq.numericTolerance,
              numericUnit: bq.numericUnit,
              shortAnswerRulesJson: bq.shortAnswerRulesJson,
              modelAnswerAr: bq.modelAnswerAr,
              explanationAr: bq.explanationAr,
              sourceAr: bq.sourceAr,
              tagsJson: bq.tagsJson,
              isBankItem: false,
              sourceBankQuestionId: bq.id,
              approvalStatus: 'APPROVED',
              createdById: req.authUser!.id,
              version: bq.version,
              isArchived: false,
            })
            .returning();

          const bqChoices = bankChoices.filter((c) => c.questionId === bq.id);
          if (bqChoices.length > 0) {
            await tx.insert(choices).values(
              bqChoices.map((c, idx) => ({
                questionId: clonedQ.id,
                labelAr: c.labelAr,
                latexFormula: c.latexFormula,
                isCorrect: c.isCorrect,
                sortOrder: idx + 1,
              })),
            );
          }

          const bqAtts = bankAttachments.filter((a) => a.questionId === bq.id);
          if (bqAtts.length > 0) {
            await tx.insert(questionAttachments).values(
              bqAtts.map((a) => ({
                questionId: clonedQ.id,
                attachmentRole: a.attachmentRole,
                storageKey: a.storageKey,
                fileName: a.fileName,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
                captionAr: a.captionAr,
                displayOrder: a.displayOrder,
              })),
            );
          }

          await tx.insert(examQuestions).values({
            examId,
            questionId: clonedQ.id,
            sortOrder: nextOrder,
            pointsOverride: effectivePoints,
          });
        }
      });

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'EXAM_QUESTIONS_ADDED_FROM_BANK',
        entityType: 'exam',
        entityId: examId,
        details: { bankQuestionIds: bankIds, count: parsed.data.items.length },
      });

      const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
      return res.status(201).json({
        addedCount: parsed.data.items.length,
        message: `تمت إضافة ${parsed.data.items.length} سؤالًا من بنك الأسئلة إلى الامتحان بنجاح.`,
        ...qSummary,
      });
    } catch (error) {
      console.error('Add questions from bank error:', error);
      return res.status(500).json({ error: 'تعذر إضافة الأسئلة من بنك الأسئلة' });
    }
  },
);

// 8. Edit Question inside Exam
adminExamsRouter.patch('/:id/questions/:questionId', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    const [link] = await db
      .select()
      .from(examQuestions)
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)))
      .limit(1);
    if (!link) return res.status(404).json({ error: 'السؤال غير مرتبط بهذا الامتحان' });

    const parsed = questionPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل السؤال غير صالحة' });
    }
    const d = parsed.data;
    const imgCheck = validateQuestionImageInput(d.imageUrl);
    if (!imgCheck.valid) return res.status(400).json({ error: imgCheck.errorAr });

    if (d.questionType === 'MCQ' && !d.choices.some((c) => c.isCorrect)) {
      return res.status(400).json({ error: 'يرجى تحديد الإجابة الصحيحة بين الاختيارات' });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(questions)
        .set({
          questionType: d.questionType,
          difficulty: d.difficulty,
          promptAr: d.promptAr,
          latexFormula: d.latexFormula || null,
          imageUrl: imgCheck.sanitized,
          points: d.points,
          negativePoints: d.negativePoints.toFixed(2),
          numericAnswer: d.numericAnswer && d.numericAnswer.trim() ? d.numericAnswer.replace(',', '.') : null,
          numericTolerance: d.numericTolerance || '0.05',
          numericUnit: d.numericUnit || '',
          shortAnswerRulesJson: d.shortAnswerRules.map((s) => s.trim()).filter(Boolean),
          modelAnswerAr: d.modelAnswerAr,
          explanationAr: d.explanationAr,
          unitId: d.unitId ?? null,
          lessonId: d.lessonId ?? null,
        })
        .where(eq(questions.id, questionId));

      await tx
        .update(examQuestions)
        .set({ pointsOverride: d.points })
        .where(eq(examQuestions.id, link.id));

      await tx.delete(choices).where(eq(choices.questionId, questionId));
      if (d.choices.length > 0) {
        await tx.insert(choices).values(
          d.choices.map((c, idx) => ({
            questionId,
            labelAr: c.labelAr,
            latexFormula: c.latexFormula || null,
            isCorrect: c.isCorrect,
            sortOrder: idx + 1,
          })),
        );
      }
    });

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    return res.json(qSummary);
  } catch (error) {
    console.error('Update exam question error:', error);
    return res.status(500).json({ error: 'تعذر تعديل السؤال' });
  }
});

// 9. Duplicate Question inside Exam
adminExamsRouter.post('/:id/questions/:questionId/duplicate', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    const [srcQ] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!srcQ) return res.status(404).json({ error: 'السؤال غير موجود' });

    const srcChoices = await db
      .select()
      .from(choices)
      .where(eq(choices.questionId, questionId))
      .orderBy(asc(choices.sortOrder));
    const existingLinks = await db.select().from(examQuestions).where(eq(examQuestions.examId, examId));
    const nextOrder = existingLinks.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 1;

    await db.transaction(async (tx) => {
      const [clone] = await tx
        .insert(questions)
        .values({
          gradeId: srcQ.gradeId,
          unitId: srcQ.unitId,
          lessonId: srcQ.lessonId,
          questionType: srcQ.questionType,
          difficulty: srcQ.difficulty,
          promptAr: `${srcQ.promptAr} (نسخة)`,
          latexFormula: srcQ.latexFormula,
          imageUrl: srcQ.imageUrl,
          points: srcQ.points,
          negativePoints: srcQ.negativePoints,
          numericAnswer: srcQ.numericAnswer,
          numericTolerance: srcQ.numericTolerance,
          numericUnit: srcQ.numericUnit,
          shortAnswerRulesJson: srcQ.shortAnswerRulesJson,
          modelAnswerAr: srcQ.modelAnswerAr,
          explanationAr: srcQ.explanationAr,
          isBankItem: false,
          sourceBankQuestionId: srcQ.sourceBankQuestionId ?? null,
        })
        .returning();

      if (srcChoices.length > 0) {
        await tx.insert(choices).values(
          srcChoices.map((c, idx) => ({
            questionId: clone.id,
            labelAr: c.labelAr,
            latexFormula: c.latexFormula,
            isCorrect: c.isCorrect,
            sortOrder: idx + 1,
          })),
        );
      }

      const srcAtts = await tx
        .select()
        .from(questionAttachments)
        .where(eq(questionAttachments.questionId, questionId));
      if (srcAtts.length > 0) {
        await tx.insert(questionAttachments).values(
          srcAtts.map((a) => ({
            questionId: clone.id,
            attachmentRole: a.attachmentRole,
            storageKey: a.storageKey,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            captionAr: a.captionAr,
            displayOrder: a.displayOrder,
          })),
        );
      }

      await tx.insert(examQuestions).values({
        examId,
        questionId: clone.id,
        sortOrder: nextOrder,
      });
    });

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    return res.status(201).json(qSummary);
  } catch (error) {
    console.error('Duplicate exam question error:', error);
    return res.status(500).json({ error: 'تعذر نسخ السؤال' });
  }
});

// 10. Remove Question from Exam
adminExamsRouter.delete('/:id/questions/:questionId', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    await db
      .delete(examQuestions)
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)));

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    return res.json(qSummary);
  } catch (error) {
    console.error('Delete exam question error:', error);
    return res.status(500).json({ error: 'تعذر حذف السؤال من الامتحان' });
  }
});

// 11. Reorder Questions inside Exam
adminExamsRouter.put('/:id/questions/reorder', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const schema = z.object({
      orderedQuestionIds: z.array(z.coerce.number().int().positive()).min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'قائمة ترتيب الأسئلة غير صالحة' });

    await db.transaction(async (tx) => {
      for (let idx = 0; idx < parsed.data.orderedQuestionIds.length; idx++) {
        await tx
          .update(examQuestions)
          .set({ sortOrder: idx + 1 })
          .where(
            and(
              eq(examQuestions.examId, examId),
              eq(examQuestions.questionId, parsed.data.orderedQuestionIds[idx]),
            ),
          );
      }
    });

    const qSummary = await computeExamQuestionsSummary(examId, req.authUser);
    return res.json(qSummary);
  } catch (error) {
    console.error('Reorder exam questions error:', error);
    return res.status(500).json({ error: 'تعذر حفظ ترتيب الأسئلة' });
  }
});

// 12. Real Exam Analytics + Student Attempts List
adminExamsRouter.get(
  '/:id/analytics',
  requirePermission([PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE]),
  async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    // Calculate REAL assigned students count from DB
    const [studentRole] = await db.select().from(roles).where(eq(roles.slug, 'STUDENT')).limit(1);
    const assignmentsRows = await db.select().from(examAssignments).where(eq(examAssignments.examId, examId));
    const scope = examRow.assignmentScope || 'GRADE';

    let assignedStudentIds = new Set<number>();
    if (scope === 'STUDENTS' || examRow.assignedUserId) {
      for (const a of assignmentsRows) if (a.studentId) assignedStudentIds.add(a.studentId);
      if (examRow.assignedUserId) assignedStudentIds.add(examRow.assignedUserId);
    } else if (scope === 'GROUP' || examRow.groupId) {
      const groupIds = [
        ...new Set([
          ...assignmentsRows.filter((a) => a.groupId !== null).map((a) => a.groupId!),
          ...(examRow.groupId ? [examRow.groupId] : []),
        ]),
      ];
      if (groupIds.length > 0) {
        const gm = await db.select().from(groupMembers).where(inArray(groupMembers.groupId, groupIds));
        for (const m of gm) assignedStudentIds.add(m.userId);
      }
    } else if (studentRole) {
      const gradeStudents = await db
        .select({ userId: users.id })
        .from(users)
        .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.status, 'ACTIVE')))
        .where(
          and(
            eq(users.roleId, studentRole.id),
            eq(users.status, 'ACTIVE'),
            eq(enrollments.gradeId, examRow.gradeId),
          ),
        );
      for (const s of gradeStudents) assignedStudentIds.add(s.userId);
    }

    const attemptsRows = await db
      .select({
        attempt: examAttempts,
        studentName: users.fullName,
        studentPhone: users.phone,
      })
      .from(examAttempts)
      .innerJoin(users, eq(examAttempts.userId, users.id))
      .where(eq(examAttempts.examId, examId))
      .orderBy(desc(examAttempts.startedAt));

    const attemptIds = attemptsRows.map((a) => a.attempt.id);
    const answersRows = attemptIds.length
      ? await db.select().from(studentAnswers).where(inArray(studentAnswers.attemptId, attemptIds))
      : [];

    const enrichedAttempts = attemptsRows.map((row) => {
      const ans = answersRows.filter((a) => a.attemptId === row.attempt.id);
      const pendingManual = ans.filter((a) => a.needsManualGrading).length;
      const maxScore = Number(row.attempt.maxScore || 0);
      const totalScore = Number(row.attempt.totalScore || 0);
      const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
      return {
        id: row.attempt.id,
        examId: row.attempt.examId,
        userId: row.attempt.userId,
        studentName: row.studentName,
        studentPhone: row.studentPhone,
        attemptNumber: row.attempt.attemptNumber,
        status: row.attempt.status,
        startedAt: row.attempt.startedAt,
        submittedAt: row.attempt.submittedAt,
        autoScore: Number(row.attempt.autoScore || 0),
        manualScore: Number(row.attempt.manualScore || 0),
        totalScore,
        maxScore,
        percent,
        passed: row.attempt.passed,
        resultPublished: row.attempt.resultPublished,
        generalFeedback: row.attempt.generalFeedback || '',
        pendingManualAnswers: pendingManual,
      };
    });

    const analytics = computeExamAnalytics(
      assignedStudentIds.size,
      enrichedAttempts.map((a) => ({
        userId: a.userId,
        status: a.status,
        totalScore: a.totalScore,
        maxScore: a.maxScore,
        passed: a.passed,
        pendingManualAnswers: a.pendingManualAnswers,
      })),
    );

    return res.json({
      exam: {
        id: examRow.id,
        titleAr: examRow.titleAr,
        examType: examRow.examType,
        durationMin: examRow.durationMin,
        passScorePercent: examRow.passScorePercent,
        totalMarks: Number(examRow.totalMarks || 0),
      },
      analytics,
      attempts: enrichedAttempts,
    });
  } catch (error) {
    console.error('Exam analytics error:', error);
    return res.status(500).json({ error: 'تعذر تحميل إحصائيات الامتحان' });
  }
});

// 13. Teacher Detailed Attempt Review (for grading & feedback)
adminExamsRouter.get(
  '/attempts/:attemptId',
  requirePermission([PERMISSIONS.EXAMS_GRADE, PERMISSIONS.EXAMS_MANAGE]),
  async (req, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const [row] = await db
      .select({
        attempt: examAttempts,
        exam: exams,
        studentName: users.fullName,
        studentPhone: users.phone,
      })
      .from(examAttempts)
      .innerJoin(exams, eq(examAttempts.examId, exams.id))
      .innerJoin(users, eq(examAttempts.userId, users.id))
      .where(eq(examAttempts.id, attemptId))
      .limit(1);

    if (!row) return res.status(404).json({ error: 'المحاولة غير موجودة' });

    const qSummary = await computeExamQuestionsSummary(row.exam.id);
    const savedAnswers = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.attemptId, attemptId));
    const ansMap = new Map(savedAnswers.map((a) => [a.questionId, a]));

    const items = qSummary.questions.map((q) => {
      const a = ansMap.get(q.id);
      return {
        question: q,
        answer: a
          ? {
              id: a.id,
              selectedChoiceId: a.selectedChoiceId,
              textAnswer: a.textAnswer,
              numericAnswer: a.numericAnswer,
              uploadedFileName: a.uploadedFileName,
              uploadedFileData: a.uploadedFileData,
              isCorrect: a.isCorrect,
              awardedPoints: Number(a.awardedPoints || 0),
              needsManualGrading: a.needsManualGrading,
              graderFeedback: a.graderFeedback || '',
            }
          : null,
      };
    });

    return res.json({
      attempt: {
        ...row.attempt,
        autoScore: Number(row.attempt.autoScore || 0),
        manualScore: Number(row.attempt.manualScore || 0),
        totalScore: Number(row.attempt.totalScore || 0),
        maxScore: Number(row.attempt.maxScore || 0),
        studentName: row.studentName,
        studentPhone: row.studentPhone,
      },
      exam: {
        id: row.exam.id,
        titleAr: row.exam.titleAr,
        passScorePercent: row.exam.passScorePercent,
      },
      items,
    });
  } catch (error) {
    console.error('Admin attempt detail error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل محاولة الطالب' });
  }
});

// 14. Save Manual Grading, Per-Question Feedback, General Feedback & Publish Result
adminExamsRouter.post('/attempts/:attemptId/grade', requirePermission(PERMISSIONS.EXAMS_GRADE), async (req: AuthRequest, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const [attempt] = await db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1);
    if (!attempt) return res.status(404).json({ error: 'المحاولة غير موجودة' });

    const [examRow] = await db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const schema = z.object({
      grades: z
        .array(
          z.object({
            questionId: z.coerce.number().int().positive(),
            awardedPoints: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)),
            graderFeedback: z.string().optional().default(''),
          }),
        )
        .default([]),
      generalFeedback: z.string().optional(),
      publishResult: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات التصحيح غير صالحة' });

    const d = parsed.data;
    const eqRows = await db
      .select({ link: examQuestions, q: questions })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .where(eq(examQuestions.examId, examRow.id));
    const maxByQ = new Map(eqRows.map((r) => [r.q.id, r.link.pointsOverride ?? r.q.points]));
    const typeByQ = new Map(eqRows.map((r) => [r.q.id, r.q.questionType]));

    const updatedAttempt = await db.transaction(async (tx) => {
      for (const g of d.grades) {
        const qMax = maxByQ.get(g.questionId) ?? 100;
        const clamped = Math.min(qMax, Math.max(0, g.awardedPoints));
        await tx
          .insert(studentAnswers)
          .values({
            attemptId,
            questionId: g.questionId,
            awardedPoints: clamped.toFixed(2),
            isCorrect: clamped >= qMax * 0.5,
            needsManualGrading: false,
            graderFeedback: g.graderFeedback.trim(),
            gradedById: req.authUser!.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [studentAnswers.attemptId, studentAnswers.questionId],
            set: {
              awardedPoints: clamped.toFixed(2),
              isCorrect: clamped >= qMax * 0.5,
              needsManualGrading: false,
              graderFeedback: g.graderFeedback.trim(),
              gradedById: req.authUser!.id,
              updatedAt: new Date(),
            },
          });
      }

      const allAnswers = await tx
        .select()
        .from(studentAnswers)
        .where(eq(studentAnswers.attemptId, attemptId));

      let objectiveSum = 0;
      let manualSum = 0;
      let stillPending = false;

      for (const a of allAnswers) {
        if (a.needsManualGrading) stillPending = true;
        const qType = typeByQ.get(a.questionId) || 'MCQ';
        const pts = Number(a.awardedPoints || 0);
        if (qType === 'ESSAY' || qType === 'PHYSICS_PROBLEM' || qType === 'FILE_UPLOAD' || qType === 'SHORT_ANSWER') {
          manualSum += pts;
        } else {
          objectiveSum += pts;
        }
      }

      const totalScore = Math.max(0, Number((objectiveSum + manualSum).toFixed(2)));
      const maxScore = Number(attempt.maxScore) || eqRows.reduce((s, r) => s + (r.link.pointsOverride ?? r.q.points), 0) || 1;
      const pct = (totalScore / maxScore) * 100;
      const nextResultPublished = d.publishResult !== undefined ? d.publishResult : attempt.resultPublished;

      const [saved] = await tx
        .update(examAttempts)
        .set({
          autoScore: Math.max(0, objectiveSum).toFixed(2),
          manualScore: Math.max(0, manualSum).toFixed(2),
          totalScore: totalScore.toFixed(2),
          maxScore: maxScore.toFixed(2),
          passed: pct >= examRow.passScorePercent,
          status: stillPending ? 'AWAITING_MANUAL_GRADING' : 'GRADED',
          generalFeedback: d.generalFeedback !== undefined ? d.generalFeedback.trim() : attempt.generalFeedback,
          resultPublished: nextResultPublished,
          gradedAt: stillPending ? attempt.gradedAt : new Date(),
          gradedById: req.authUser!.id,
        })
        .where(eq(examAttempts.id, attemptId))
        .returning();

      return { saved, stillPending, totalScore, maxScore };
    });

    if (!updatedAttempt.stillPending && updatedAttempt.saved.resultPublished) {
      await createNotification({
        userId: attempt.userId,
        titleAr: `إعلان نتيجة ${examRow.titleAr}`,
        bodyAr: `تم اعتماد وتصحيح امتحانك بنجاح — الدرجة النهائية ${updatedAttempt.totalScore} من ${updatedAttempt.maxScore}.`,
        type: 'EXAM_RESULT',
        targetType: 'EXAM_RESULT',
        targetId: attemptId,
        targetMetaJson: { examId: examRow.id },
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PHASE2_ATTEMPT_GRADED',
      entityType: 'exam_attempt',
      entityId: attemptId,
      details: { totalScore: updatedAttempt.totalScore, resultPublished: updatedAttempt.saved.resultPublished },
    });

    return res.json({ attempt: updatedAttempt.saved });
  } catch (error) {
    console.error('Grade attempt error:', error);
    return res.status(500).json({ error: 'تعذر حفظ التصحيح والدرجات' });
  }
});

// 15. Publish All Graded Results for an Exam
adminExamsRouter.post('/:id/publish-results', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const unpublished = await db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, examId), eq(examAttempts.resultPublished, false)));

    if (unpublished.length > 0) {
      await db
        .update(examAttempts)
        .set({ resultPublished: true })
        .where(and(eq(examAttempts.examId, examId), eq(examAttempts.resultPublished, false)));

      for (const att of unpublished) {
        if (att.status !== 'IN_PROGRESS') {
          await createNotification({
            userId: att.userId,
            titleAr: `تم نشر نتيجة ${examRow.titleAr}`,
            bodyAr: `يمكنك الآن الاطلاع على نتيجتك وملاحظات المدرس في قسم «نتائجي».`,
            type: 'EXAM_RESULT',
            targetType: 'EXAM_RESULT',
            targetId: att.id,
            targetMetaJson: { examId: examRow.id },
          });
        }
      }
    }

    return res.json({ publishedCount: unpublished.length });
  } catch (error) {
    console.error('Publish results error:', error);
    return res.status(500).json({ error: 'تعذر نشر النتائج' });
  }
});
