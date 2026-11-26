import { Router } from 'express';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  choices,
  examQuestions,
  exams,
  grades,
  lessons,
  questionAttachments,
  questions,
  units,
} from '../../db/schema.ts';
import { PERMISSIONS, requirePermission, type AuthRequest } from '../../middleware/auth.ts';
import { logAudit } from '../audit.ts';
import { buildSignedQuestionBankFileUrl } from '../domain/questionBank.ts';
import {
  findReplacementCandidates,
  generateSmartExamDraft,
  summarizeAvailability,
  validateSmartExamBlueprint,
  type SmartBankQuestionRecord,
} from '../domain/smartExamGenerator.ts';
import {
  EXAM_TYPE_LABELS,
  type ExamType,
  type QuestionType,
} from '../../types/exams.ts';
import type { QuestionDifficulty } from '../../types/questionBank.ts';
import type {
  SmartExamBlueprint,
  SmartExamDistributionSummary,
  SmartExamPreviewQuestion,
  SmartExamReplacementCandidate,
} from '../../types/smartExamGenerator.ts';

export const smartExamGeneratorRouter = Router();

// Strictly gate ALL Smart Exam Generator routes with EXAMS_MANAGE (SUPER_ADMIN & CONTENT_MANAGER only).
smartExamGeneratorRouter.use(requirePermission(PERMISSIONS.EXAMS_MANAGE));

const EXAM_TYPES = [
  'LESSON_QUIZ',
  'UNIT_EXAM',
  'MONTHLY',
  'COMPREHENSIVE',
  'FINAL_SIMULATION',
  'HOMEWORK',
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

const DISTRIBUTION_MODES = ['AUTO', 'COUNT', 'PERCENT'] as const;

const availabilitySchema = z.object({
  trackId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  unitIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  lessonIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  questionTypes: z.array(z.enum(QUESTION_TYPES)).optional().default([]),
  excludePreviouslyUsed: z.boolean().optional().default(false),
  excludeExamIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

const blueprintSchema = availabilitySchema.extend({
  titleAr: z.string().trim().max(180).optional().default(''),
  examType: z.enum(EXAM_TYPES).default('UNIT_EXAM'),
  totalQuestions: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(100)),
  durationMin: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(360)).default(45),
  scoreMode: z.enum(['BANK_DEFAULT', 'TARGET_TOTAL']).default('BANK_DEFAULT'),
  targetTotalScore: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(5000)).nullable().optional(),
  difficultyDistribution: z
    .object({
      mode: z.enum(DISTRIBUTION_MODES).default('AUTO'),
      easy: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)).default(0),
      medium: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)).default(0),
      hard: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)).default(0),
    })
    .default({ mode: 'AUTO', easy: 0, medium: 0, hard: 0 }),
  unitDistributionMode: z.enum(DISTRIBUTION_MODES).default('AUTO'),
  unitDistribution: z
    .array(
      z.object({
        unitId: z.coerce.number().int().positive(),
        value: z.preprocess(preprocessLocalizedNumber, z.coerce.number().min(0)),
      }),
    )
    .optional()
    .default([]),
  seed: z.coerce.number().int().optional(),
});

const replacementsSchema = z.object({
  targetBankQuestionId: z.coerce.number().int().positive(),
  excludeBankQuestionIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  trackId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  unitIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  questionTypes: z.array(z.enum(QUESTION_TYPES)).optional().default([]),
  excludePreviouslyUsed: z.boolean().optional().default(false),
  excludeExamIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

const saveDraftSchema = z.object({
  titleAr: z.string().trim().min(3, 'عنوان الامتحان يجب أن يكون 3 أحرف على الأقل').max(180),
  descriptionAr: z.string().trim().max(2000).optional().default(''),
  instructionsAr: z.string().trim().max(2000).optional().default(''),
  trackId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  unitId: z.coerce.number().int().positive().nullable().optional(),
  lessonId: z.coerce.number().int().positive().nullable().optional(),
  examType: z.enum(EXAM_TYPES).default('UNIT_EXAM'),
  durationMin: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(360)).default(45),
  passScorePercent: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(100)).default(60),
  questions: z
    .array(
      z.object({
        bankQuestionId: z.coerce.number().int().positive(),
        points: z.preprocess(
          preprocessLocalizedNumber,
          z.coerce.number().int().min(1, 'درجة كل سؤال يجب أن تكون 1 على الأقل').max(200),
        ),
      }),
    )
    .min(1, 'يجب أن يحتوي الامتحان على سؤال واحد على الأقل')
    .max(100, 'الحد الأقصى للأسئلة في مسودة الامتحان الذكي هو 100 سؤال'),
});

type FullBankRow = typeof questions.$inferSelect;

async function loadUsedBankQuestionIds(excludeExamIds?: number[]): Promise<Set<number>> {
  const conditions = [isNotNull(questions.sourceBankQuestionId)];
  if (excludeExamIds && excludeExamIds.length > 0) {
    conditions.push(inArray(examQuestions.examId, excludeExamIds));
  }
  const rows = await db
    .select({
      sourceBankQuestionId: questions.sourceBankQuestionId,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(examQuestions.questionId, questions.id))
    .where(and(...conditions));

  const set = new Set<number>();
  for (const r of rows) {
    if (r.sourceBankQuestionId) set.add(r.sourceBankQuestionId);
  }
  return set;
}

async function loadApprovedPoolForGrade(trackId: number, gradeId: number): Promise<FullBankRow[]> {
  const [gradeRow] = await db.select().from(grades).where(eq(grades.id, gradeId)).limit(1);
  if (!gradeRow || gradeRow.trackId !== trackId) return [];
  const rows = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.isBankItem, true),
        eq(questions.approvalStatus, 'APPROVED'),
        eq(questions.isArchived, false),
        eq(questions.gradeId, gradeId),
      ),
    )
    .orderBy(asc(questions.id));
  return rows.map((r) => ({ ...r, trackId: r.trackId ?? gradeRow.trackId }));
}

function toDomainRecord(row: FullBankRow): SmartBankQuestionRecord {
  return {
    id: row.id,
    bankCode: row.bankCode,
    isBankItem: row.isBankItem,
    approvalStatus: row.approvalStatus,
    isArchived: row.isArchived,
    trackId: row.trackId,
    gradeId: row.gradeId,
    unitId: row.unitId,
    lessonId: row.lessonId,
    questionType: row.questionType as QuestionType,
    difficulty: row.difficulty as QuestionDifficulty,
    points: row.points,
  };
}

async function hydratePreviewQuestions(
  items: Array<{ row: FullBankRow; points: number; sortOrder: number }>,
  viewer: { id: number; roleSlug: string },
  usedBankIds: ReadonlySet<number>,
): Promise<SmartExamPreviewQuestion[]> {
  if (items.length === 0) return [];
  const qIds = items.map((i) => i.row.id);
  const unitIds = Array.from(new Set(items.map((i) => i.row.unitId).filter((v): v is number => v !== null)));
  const lessonIds = Array.from(new Set(items.map((i) => i.row.lessonId).filter((v): v is number => v !== null)));

  const [choiceRows, attRows, unitRows, lessonRows] = await Promise.all([
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
    unitIds.length ? db.select().from(units).where(inArray(units.id, unitIds)) : Promise.resolve([]),
    lessonIds.length ? db.select().from(lessons).where(inArray(lessons.id, lessonIds)) : Promise.resolve([]),
  ]);

  const unitMap = new Map(unitRows.map((u) => [u.id, u.titleAr]));
  const lessonMap = new Map(lessonRows.map((l) => [l.id, l.titleAr]));

  return items.map(({ row, points, sortOrder }) => {
    const qAtts = attRows.filter((a) => a.questionId === row.id);
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
          context: 'bank',
          resourceId: row.id,
          fileRole: 'question',
        }),
      }));

    const hasModelAnswerFiles = qAtts.some((a) => a.attachmentRole !== 'QUESTION_IMAGE');
    const qChoices = choiceRows
      .filter((c) => c.questionId === row.id)
      .map((c) => ({
        id: c.id,
        labelAr: c.labelAr,
        latexFormula: c.latexFormula,
        isCorrect: c.isCorrect,
        sortOrder: c.sortOrder,
      }));

    return {
      bankQuestionId: row.id,
      bankCode: row.bankCode,
      sortOrder,
      trackId: row.trackId,
      gradeId: row.gradeId,
      unitId: row.unitId,
      unitNameAr: row.unitId ? unitMap.get(row.unitId) || null : null,
      lessonId: row.lessonId,
      lessonNameAr: row.lessonId ? lessonMap.get(row.lessonId) || null : null,
      topicAr: row.topicAr,
      questionType: row.questionType as QuestionType,
      difficulty: row.difficulty as QuestionDifficulty,
      promptAr: row.promptAr || (row.topicAr ? `سؤال مصور — ${row.topicAr}` : 'سؤال مصور من بنك الأسئلة'),
      latexFormula: row.latexFormula,
      imageUrl: row.imageUrl,
      questionImages,
      points,
      defaultBankPoints: row.points,
      usedPreviously: usedBankIds.has(row.id),
      choices: qChoices,
      hasModelAnswer: Boolean((row.modelAnswerAr && row.modelAnswerAr.trim()) || hasModelAnswerFiles),
    };
  });
}

function buildDistributionSummary(
  previewQuestions: SmartExamPreviewQuestion[],
  durationMin: number,
): SmartExamDistributionSummary {
  const byDifficulty: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  const byQuestionType: Record<string, number> = {};
  const byUnitMap = new Map<string, { unitId: number | null; unitNameAr: string; count: number }>();

  let totalMarks = 0;
  for (const q of previewQuestions) {
    totalMarks += q.points;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
    byQuestionType[q.questionType] = (byQuestionType[q.questionType] || 0) + 1;
    const uKey = q.unitId === null ? 'null' : String(q.unitId);
    const existing = byUnitMap.get(uKey);
    if (existing) {
      existing.count += 1;
    } else {
      byUnitMap.set(uKey, {
        unitId: q.unitId,
        unitNameAr: q.unitNameAr || 'عام / غير محدد الوحدة',
        count: 1,
      });
    }
  }

  return {
    totalQuestions: previewQuestions.length,
    totalMarks,
    durationMin,
    byDifficulty,
    byUnit: Array.from(byUnitMap.values()),
    byQuestionType,
  };
}

// 1. Live Availability Preview for Blueprint Configuration
smartExamGeneratorRouter.post('/availability', async (req: AuthRequest, res) => {
  try {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'معايير الفحص غير صالحة' });
    }
    const d = parsed.data;
    const [poolRows, usedBankIds] = await Promise.all([
      loadApprovedPoolForGrade(d.trackId, d.gradeId),
      loadUsedBankQuestionIds(d.excludeExamIds),
    ]);

    const { availability } = summarizeAvailability(
      poolRows.map(toDomainRecord),
      {
        trackId: d.trackId,
        gradeId: d.gradeId,
        unitIds: d.unitIds,
        lessonIds: d.lessonIds,
        questionTypes: d.questionTypes,
        excludePreviouslyUsed: d.excludePreviouslyUsed,
      },
      usedBankIds,
    );

    return res.json(availability);
  } catch (error) {
    console.error('Smart exam availability error:', error);
    return res.status(500).json({ error: 'تعذر حساب الأسئلة المتاحة في بنك الأسئلة' });
  }
});

// 2. Generate Smart Exam Draft Preview (Constraint-Based, Zero External AI)
smartExamGeneratorRouter.post('/generate', async (req: AuthRequest, res) => {
  try {
    const parsed = blueprintSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'مواصفات الامتحان غير صالحة' });
    }
    const d = parsed.data;
    const blueprint: SmartExamBlueprint = {
      titleAr: d.titleAr,
      examType: d.examType,
      trackId: d.trackId,
      gradeId: d.gradeId,
      unitIds: d.unitIds,
      lessonIds: d.lessonIds,
      questionTypes: d.questionTypes,
      totalQuestions: d.totalQuestions,
      durationMin: d.durationMin,
      scoreMode: d.scoreMode,
      targetTotalScore: d.targetTotalScore ?? null,
      difficultyDistribution: d.difficultyDistribution,
      unitDistributionMode: d.unitDistributionMode,
      unitDistribution: d.unitDistribution,
      excludePreviouslyUsed: d.excludePreviouslyUsed,
      excludeExamIds: d.excludeExamIds,
      seed: d.seed,
    };

    const validation = validateSmartExamBlueprint(blueprint);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
    }

    const [poolRows, usedBankIds, gradeUnits, gradeRows] = await Promise.all([
      loadApprovedPoolForGrade(d.trackId, d.gradeId),
      loadUsedBankQuestionIds(d.excludeExamIds),
      db.select().from(units).where(eq(units.gradeId, d.gradeId)),
      db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1),
    ]);

    const unitNamesById = new Map(gradeUnits.map((u) => [u.id, u.titleAr]));
    const rowById = new Map(poolRows.map((r) => [r.id, r]));

    const result = generateSmartExamDraft(
      poolRows.map(toDomainRecord),
      blueprint,
      usedBankIds,
      { unitNamesById },
    );

    if (!result.ok) {
      return res.status(422).json({
        ok: false,
        error: result.errorAr || 'عدد الأسئلة المعتمدة المتاحة لا يكفي لتوليد الامتحان وفق الشروط المحددة.',
        shortages: result.shortages,
        suggestions: result.suggestions,
        availability: result.availability,
      });
    }

    const previewItems = await hydratePreviewQuestions(
      result.selected.map((s, idx) => ({
        row: rowById.get(s.question.id)!,
        points: s.points,
        sortOrder: idx + 1,
      })),
      req.authUser!,
      usedBankIds,
    );

    const summary = buildDistributionSummary(previewItems, blueprint.durationMin);
    const gradeName = gradeRows[0]?.nameAr || '';
    const examTypeLabel = EXAM_TYPE_LABELS[blueprint.examType as ExamType] || 'امتحان';
    const unitHint =
      blueprint.unitIds.length === 1 && unitNamesById.has(blueprint.unitIds[0])
        ? ` — ${unitNamesById.get(blueprint.unitIds[0])}`
        : '';
    const suggestedTitleAr =
      blueprint.titleAr && blueprint.titleAr.trim().length >= 3
        ? blueprint.titleAr.trim()
        : `${examTypeLabel}${unitHint}${gradeName ? ` (${gradeName})` : ''}`;

    return res.json({
      ok: true,
      seed: result.seed,
      suggestedTitleAr,
      questions: previewItems,
      summary,
    });
  } catch (error) {
    console.error('Smart exam generate error:', error);
    return res.status(500).json({ error: 'تعذر توليد مسودة الامتحان الذكي' });
  }
});

// 3. Propose Replacement Candidates for a Single Question inside Draft Preview
smartExamGeneratorRouter.post('/replacements', async (req: AuthRequest, res) => {
  try {
    const parsed = replacementsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات البحث عن بدائل غير صالحة' });
    }
    const d = parsed.data;

    const [poolRows, usedBankIds, targetRows] = await Promise.all([
      loadApprovedPoolForGrade(d.trackId, d.gradeId),
      loadUsedBankQuestionIds(d.excludeExamIds),
      db.select().from(questions).where(eq(questions.id, d.targetBankQuestionId)).limit(1),
    ]);

    const targetRow = targetRows[0];
    if (!targetRow) {
      return res.status(404).json({ error: 'السؤال المطلوب استبداله غير موجود.' });
    }

    const rowById = new Map(poolRows.map((r) => [r.id, r]));
    const excludedSet = new Set<number>([...d.excludeBankQuestionIds, d.targetBankQuestionId]);

    const ranked = findReplacementCandidates(poolRows.map(toDomainRecord), toDomainRecord(targetRow), {
      excludedBankIds: excludedSet,
      usedBankIds,
      preferUnused: d.excludePreviouslyUsed,
      allowedUnitIds: d.unitIds,
      allowedQuestionTypes: d.questionTypes,
      limit: 15,
    });

    const hydrated = await hydratePreviewQuestions(
      ranked.map((r, idx) => ({
        row: rowById.get(r.question.id)!,
        points: r.question.points,
        sortOrder: idx + 1,
      })),
      req.authUser!,
      usedBankIds,
    );

    const candidates: SmartExamReplacementCandidate[] = hydrated.map((item, idx) => ({
      ...item,
      matchScore: ranked[idx].matchScore,
      matchReasonsAr: ranked[idx].matchReasonsAr,
    }));

    return res.json({
      candidates,
      messageAr:
        candidates.length === 0
          ? 'لا توجد أسئلة بديلة معتمدة أخرى متاحة حاليًا بنفس الصف والمسار خارج الأسئلة المختارة بالفعل.'
          : null,
    });
  } catch (error) {
    console.error('Smart exam replacements error:', error);
    return res.status(500).json({ error: 'تعذر البحث عن أسئلة بديلة' });
  }
});

// 4. Save Generated Draft into Existing Exam Tables (ALWAYS as DRAFT — NEVER auto-published!)
smartExamGeneratorRouter.post('/save-draft', async (req: AuthRequest, res) => {
  try {
    const parsed = saveDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات حفظ المسودة غير صالحة' });
    }
    const d = parsed.data;

    // Enforce zero duplicate bankQuestionIds
    const uniqueBankIds = new Set(d.questions.map((q) => q.bankQuestionId));
    if (uniqueBankIds.size !== d.questions.length) {
      return res.status(400).json({ error: 'لا يمكن حفظ الامتحان لوجود أسئلة مكررة داخل المسودة.' });
    }

    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) {
      return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود.' });
    }

    const bankIds = Array.from(uniqueBankIds);
    const bankRows = await db
      .select()
      .from(questions)
      .where(and(inArray(questions.id, bankIds), eq(questions.isBankItem, true)));

    const bankById = new Map(bankRows.map((b) => [b.id, b]));
    for (const item of d.questions) {
      const bq = bankById.get(item.bankQuestionId);
      if (!bq) {
        return res.status(404).json({ error: `السؤال رقم ${item.bankQuestionId} غير موجود في بنك الأسئلة.` });
      }
      if (bq.isArchived || bq.approvalStatus !== 'APPROVED') {
        return res.status(400).json({
          error: `لا يمكن حفظ السؤال (${bq.bankCode || bq.id}) لأنه غير معتمد أو مؤرشف. يُسمح بالأسئلة المعتمدة فقط.`,
        });
      }
      if (bq.gradeId !== d.gradeId) {
        return res.status(400).json({
          error: `السؤال (${bq.bankCode || bq.id}) لا ينتمي إلى الصف الدراسي المحدد للامتحان.`,
        });
      }
    }

    const [bankChoices, bankAttachments] = await Promise.all([
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
    ]);

    const totalMarks = d.questions.reduce((acc, q) => acc + q.points, 0);

    const created = await db.transaction(async (tx) => {
      // ALWAYS saved as DRAFT (publicationStatus='DRAFT', isPublished=false). Never auto-published.
      const [insertedExam] = await tx
        .insert(exams)
        .values({
          trackId: d.trackId || gradeRow.trackId,
          gradeId: d.gradeId,
          unitId: d.unitId ?? null,
          lessonId: d.lessonId ?? null,
          courseId: null,
          requiredVideoId: null,
          groupId: null,
          assignedUserId: null,
          titleAr: d.titleAr,
          descriptionAr: d.descriptionAr || 'تم إنشاء هذا الامتحان عبر مولّد الامتحان الذكي كمسودة قابلة للمراجعة والتعديل.',
          instructionsAr: d.instructionsAr || '',
          examType: d.examType,
          totalMarks: totalMarks.toFixed(2),
          durationMin: d.durationMin,
          passScorePercent: d.passScorePercent,
          startsAt: null,
          endsAt: null,
          maxAttempts: 2,
          shuffleQuestions: false,
          shuffleChoices: false,
          allowNavigation: true,
          allowReviewBeforeSubmit: true,
          allowStudentReview: true,
          showResultImmediately: true,
          showCorrectAnswers: true,
          showExplanations: true,
          allowNegativeMarking: false,
          assignmentScope: 'GRADE',
          publicationStatus: 'DRAFT',
          isPublished: false,
          updatedAt: new Date(),
        })
        .returning();

      let sortOrder = 0;
      for (const item of d.questions) {
        const bq = bankById.get(item.bankQuestionId)!;
        sortOrder += 1;

        const [clonedQ] = await tx
          .insert(questions)
          .values({
            trackId: bq.trackId,
            gradeId: bq.gradeId,
            unitId: bq.unitId ?? d.unitId ?? null,
            lessonId: bq.lessonId ?? d.lessonId ?? null,
            topicAr: bq.topicAr,
            questionType: bq.questionType,
            difficulty: bq.difficulty,
            promptAr: bq.promptAr || (bq.topicAr ? `سؤال مصور — ${bq.topicAr}` : 'سؤال مصور من بنك الأسئلة'),
            latexFormula: bq.latexFormula,
            imageUrl: bq.imageUrl,
            points: item.points,
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
          examId: insertedExam.id,
          questionId: clonedQ.id,
          sortOrder,
          pointsOverride: item.points,
        });
      }

      return insertedExam;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'SMART_EXAM_DRAFT_CREATED',
      entityType: 'exam',
      entityId: created.id,
      details: {
        titleAr: created.titleAr,
        bankQuestionIds: bankIds,
        questionCount: d.questions.length,
        totalMarks,
        publicationStatus: 'DRAFT',
      },
    });

    return res.status(201).json({
      exam: {
        ...created,
        totalMarks,
        publicationStatus: 'DRAFT',
        isPublished: false,
      },
      addedCount: d.questions.length,
      totalMarks,
      message: `تم حفظ مسودة الامتحان الذكي (${d.questions.length} سؤال بإجمالي ${totalMarks} درجة) كمسودة غير منشورة بنجاح.`,
    });
  } catch (error) {
    console.error('Smart exam save draft error:', error);
    return res.status(500).json({ error: 'تعذر حفظ مسودة الامتحان الذكي' });
  }
});
