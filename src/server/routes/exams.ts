import { Router, type RequestHandler } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  choices,
  courseStudentBlocks,
  enrollments,
  entitlements,
  examAssignments,
  examAttempts,
  examQuestions,
  exams,
  grades,
  groupMembers,
  lessons,
  progressRecords,
  questionAttachments,
  questions,
  studentAnswers,
  units,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  isStaffRole,
  requireActiveAccount,
  requireAuth,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification } from '../audit.ts';
import {
  buildOrderedIds,
  computeAttemptDeadline,
  computeRemainingSeconds,
  evaluateStudentExamAccess,
  gradeExamSubmission,
  isAttemptExpired,
  type GradeableQuestion,
} from '../domain/exams.ts';
import { buildSignedQuestionBankFileUrl } from '../domain/questionBank.ts';
import { createRateLimiter } from '../domain/security.ts';
import { isSafeUploadDataUrl } from '../domain/securityHardening.ts';

export const examsRouter = Router();

const examActionLimiter = createRateLimiter(120, 60 * 1000);
const examSubmitLimiter = createRateLimiter(20, 60 * 1000);

function makeRateLimitMiddleware(
  limiter: ReturnType<typeof createRateLimiter>,
  prefix: string,
): RequestHandler {
  return (req, res, next) => {
    const authReq = req as AuthRequest;
    const key = `${prefix}:${authReq.authUser?.id ?? req.ip ?? 'anon'}`;
    const check = limiter.check(key);
    if (!check.allowed) {
      return res.status(429).json({
        error: `طلبات كثيرة جدًا، يرجى الانتظار ${check.retryAfterSec} ثانية ثم المحاولة مجددًا.`,
      });
    }
    return next();
  };
}

const examActionRateLimiter = makeRateLimitMiddleware(examActionLimiter, 'exam-action');
const examSubmitRateLimiter = makeRateLimitMiddleware(examSubmitLimiter, 'exam-submit');

async function getApprovedGradeIds(userId: number, roleSlug: string): Promise<number[]> {
  if (isStaffRole(roleSlug)) {
    const all = await db.select({ id: grades.id }).from(grades);
    return all.map((g) => g.id);
  }
  const active = await db
    .select({ gradeId: enrollments.gradeId })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.status, 'ACTIVE')));
  return active.map((e) => e.gradeId);
}

async function getUserGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => r.groupId);
}

async function hasUserCourseAccess(
  userId: number,
  roleSlug: string,
  courseId: number | null,
  gradeId: number,
): Promise<boolean> {
  if (!courseId || isStaffRole(roleSlug)) return true;
  const [blockRow] = await db
    .select({ id: courseStudentBlocks.id })
    .from(courseStudentBlocks)
    .where(
      and(
        eq(courseStudentBlocks.userId, userId),
        eq(courseStudentBlocks.courseId, courseId),
        eq(courseStudentBlocks.isActive, true),
      ),
    )
    .limit(1);
  if (blockRow) return false;

  const ents = await db.select().from(entitlements).where(eq(entitlements.userId, userId));
  const now = Date.now();
  return ents.some(
    (e) =>
      !e.isRevoked &&
      (!e.expiresAt || new Date(e.expiresAt).getTime() > now) &&
      ((e.targetType === 'COURSE' && e.targetId === courseId) ||
        (e.targetType === 'GRADE_ALL' && e.targetId === gradeId)),
  );
}

async function finalizeAttemptOnServer(
  attemptId: number,
  userId: number,
  opts: {
    autoSubmitted?: boolean;
    finalAnswersBatch?: Array<{
      questionId: number;
      selectedChoiceId?: number | null;
      textAnswer?: string | null;
      numericAnswer?: string | null;
      uploadedFileName?: string | null;
      uploadedFileData?: string | null;
    }>;
    flaggedQuestions?: number[];
  },
) {
  const [attempt] = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.userId, userId)))
    .limit(1);

  if (!attempt) return { error: 'المحاولة غير موجودة', status: 404 as const };
  if (attempt.status !== 'IN_PROGRESS') {
    return { alreadySubmitted: true as const, attempt };
  }

  const [examRow] = await db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
  if (!examRow) return { error: 'الامتحان غير موجود', status: 404 as const };

  // Save final batch of answers if provided
  if (Array.isArray(opts.finalAnswersBatch)) {
    for (const raw of opts.finalAnswersBatch) {
      if (!raw?.questionId) continue;
      await db
        .insert(studentAnswers)
        .values({
          attemptId,
          questionId: Number(raw.questionId),
          selectedChoiceId: raw.selectedChoiceId ? Number(raw.selectedChoiceId) : null,
          textAnswer: raw.textAnswer ?? null,
          numericAnswer:
            raw.numericAnswer !== undefined && raw.numericAnswer !== null ? String(raw.numericAnswer) : null,
          uploadedFileName: raw.uploadedFileName ?? null,
          uploadedFileData: raw.uploadedFileData ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [studentAnswers.attemptId, studentAnswers.questionId],
          set: {
            selectedChoiceId: raw.selectedChoiceId ? Number(raw.selectedChoiceId) : null,
            textAnswer: raw.textAnswer ?? null,
            numericAnswer:
              raw.numericAnswer !== undefined && raw.numericAnswer !== null ? String(raw.numericAnswer) : null,
            uploadedFileName: raw.uploadedFileName ?? null,
            uploadedFileData: raw.uploadedFileData ?? null,
            updatedAt: new Date(),
          },
        });
    }
  }

  const eqRows = await db
    .select({
      link: examQuestions,
      question: questions,
      lessonTitleAr: lessons.titleAr,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(examQuestions.questionId, questions.id))
    .leftJoin(lessons, eq(questions.lessonId, lessons.id))
    .where(eq(examQuestions.examId, examRow.id))
    .orderBy(asc(examQuestions.sortOrder), asc(examQuestions.id));

  const qIds = eqRows.map((r) => r.question.id);
  const allChoices = qIds.length
    ? await db
        .select()
        .from(choices)
        .where(inArray(choices.questionId, qIds))
        .orderBy(asc(choices.sortOrder), asc(choices.id))
    : [];
  const savedAnswers = await db
    .select()
    .from(studentAnswers)
    .where(eq(studentAnswers.attemptId, attemptId));

  const gradeable: GradeableQuestion[] = eqRows.map((r) => ({
    id: r.question.id,
    lessonId: r.question.lessonId,
    lessonTitleAr: r.lessonTitleAr || undefined,
    questionType: r.question.questionType,
    points: r.link.pointsOverride ?? r.question.points,
    negativePoints: Number(r.question.negativePoints || 0),
    numericAnswer: r.question.numericAnswer !== null ? Number(r.question.numericAnswer) : null,
    numericTolerance: r.question.numericTolerance !== null ? Number(r.question.numericTolerance) : 0.05,
    shortAnswerRules: Array.isArray(r.question.shortAnswerRulesJson) ? r.question.shortAnswerRulesJson : [],
    correctChoiceIds: allChoices
      .filter((c) => c.questionId === r.question.id && c.isCorrect)
      .map((c) => c.id),
  }));

  const summary = gradeExamSubmission(
    gradeable,
    savedAnswers.map((a) => ({
      questionId: a.questionId,
      selectedChoiceId: a.selectedChoiceId,
      textAnswer: a.textAnswer,
      numericAnswer: a.numericAnswer,
      uploadedFileName: a.uploadedFileName,
    })),
    examRow.passScorePercent,
    { allowNegativeMarking: examRow.allowNegativeMarking },
  );

  // Atomic status transition to prevent duplicate submissions / double grading
  const finalStatus = summary.hasManualQuestions
    ? 'AWAITING_MANUAL_GRADING'
    : opts.autoSubmitted
      ? 'AUTO_SUBMITTED'
      : 'GRADED';
  const resultPublished = examRow.showResultImmediately && !summary.hasManualQuestions;

  const [updatedAttempt] = await db
    .update(examAttempts)
    .set({
      status: finalStatus,
      submittedAt: new Date(),
      autoScore: summary.autoScore.toFixed(2),
      totalScore: summary.autoScore.toFixed(2),
      maxScore: summary.maxScore.toFixed(2),
      passed: summary.passed,
      resultPublished,
      gradedAt: summary.hasManualQuestions ? null : new Date(),
      flaggedQuestionsJson: Array.isArray(opts.flaggedQuestions)
        ? opts.flaggedQuestions
        : attempt.flaggedQuestionsJson,
    })
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.status, 'IN_PROGRESS')))
    .returning();

  if (!updatedAttempt) {
    // Another concurrent request already submitted this attempt!
    const [current] = await db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1);
    return { alreadySubmitted: true as const, attempt: current };
  }

  for (const out of summary.outcomes) {
    await db
      .insert(studentAnswers)
      .values({
        attemptId,
        questionId: out.questionId,
        isCorrect: out.isCorrect,
        awardedPoints: out.awardedPoints.toFixed(2),
        needsManualGrading: out.needsManualGrading,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [studentAnswers.attemptId, studentAnswers.questionId],
        set: {
          isCorrect: out.isCorrect,
          awardedPoints: out.awardedPoints.toFixed(2),
          needsManualGrading: out.needsManualGrading,
          updatedAt: new Date(),
        },
      });
  }

  await createNotification({
    userId,
    titleAr: opts.autoSubmitted ? `تم التسليم التلقائي: ${examRow.titleAr}` : `تم تسليم: ${examRow.titleAr}`,
    bodyAr: !examRow.showResultImmediately
      ? 'تم استلام إجاباتك بنجاح وستظهر النتيجة فور اعتماد المدرس.'
      : summary.hasManualQuestions
        ? `تم التصحيح التلقائي للأسئلة الموضوعية (${summary.autoScore}/${summary.maxScore})، والأسئلة المقالية قيد تصحيح المدرس.`
        : `حصلت على ${summary.autoScore} من ${summary.maxScore} (${summary.percent}%).`,
    type: 'EXAM_RESULT',
  });

  // NEVER leak scores or answer keys if showResultImmediately is false!
  const canRevealReview =
    resultPublished && examRow.allowStudentReview && examRow.showCorrectAnswers;

  const reviewQIds = canRevealReview ? eqRows.map((r) => r.question.id) : [];
  const reviewAtts =
    canRevealReview && reviewQIds.length
      ? await db
          .select()
          .from(questionAttachments)
          .where(inArray(questionAttachments.questionId, reviewQIds))
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id))
      : [];

  const detailedReview = canRevealReview
    ? eqRows.map((r) => {
        const ans = savedAnswers.find((a) => a.questionId === r.question.id);
        const out = summary.outcomes.find((o) => o.questionId === r.question.id);
        const qChoices = allChoices.filter((c) => c.questionId === r.question.id);
        const qAtts = reviewAtts.filter((a) => a.questionId === r.question.id);
        return {
          questionId: r.question.id,
          promptAr: r.question.promptAr,
          latexFormula: r.question.latexFormula,
          imageUrl: r.question.imageUrl,
          questionImages: qAtts
            .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
            .map((a) => ({
              storageKey: a.storageKey,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              displayOrder: a.displayOrder,
              previewUrl: buildSignedQuestionBankFileUrl({
                storageKey: a.storageKey,
                userId,
                roleSlug: 'STUDENT',
                context: 'exam',
                resourceId: examRow.id,
                fileRole: 'question',
              }),
            })),
          modelAnswerFiles: qAtts
            .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
            .map((a) => ({
              storageKey: a.storageKey,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              displayOrder: a.displayOrder,
              previewUrl: buildSignedQuestionBankFileUrl({
                storageKey: a.storageKey,
                userId,
                roleSlug: 'STUDENT',
                context: 'exam',
                resourceId: examRow.id,
                fileRole: 'model_answer',
              }),
            })),
          questionType: r.question.questionType,
          points: r.link.pointsOverride ?? r.question.points,
          awardedPoints: out?.awardedPoints ?? 0,
          isCorrect: out?.isCorrect ?? null,
          needsManualGrading: out?.needsManualGrading ?? false,
          selectedChoiceId: ans?.selectedChoiceId ?? null,
          textAnswer: ans?.textAnswer ?? null,
          numericAnswer: ans?.numericAnswer ?? null,
          numericUnit: r.question.numericUnit || '',
          correctNumericAnswer: r.question.numericAnswer !== null ? String(r.question.numericAnswer) : null,
          modelAnswerAr: r.question.modelAnswerAr || '',
          explanationAr: examRow.showExplanations ? r.question.explanationAr || '' : '',
          choices: qChoices.map((c) => ({
            id: c.id,
            labelAr: c.labelAr,
            latexFormula: c.latexFormula,
            isCorrect: c.isCorrect,
          })),
        };
      })
    : [];

  return {
    alreadySubmitted: false as const,
    exam: examRow,
    attempt: updatedAttempt,
    summary: examRow.showResultImmediately
      ? summary
      : {
          autoScore: null,
          maxScore: summary.maxScore,
          hasManualQuestions: summary.hasManualQuestions,
          percent: null,
          passed: null,
          correctCount: null,
          incorrectCount: null,
          unansweredCount: summary.unansweredCount,
          manualPendingCount: summary.manualPendingCount,
          lessonAnalytics: [],
        },
    resultPublished,
    showResultImmediately: examRow.showResultImmediately,
    showCorrectAnswers: canRevealReview,
    allowStudentReview: examRow.allowStudentReview,
    review: detailedReview,
  };
}

// 1. Student Exams Hub + Dedicated "نتائجي" (My Results) API
examsRouter.get('/student/list', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const staffUser = isStaffRole(u.roleSlug);
    const [
      approvedGradeIds,
      userGroupIds,
      userAttempts,
      userProgress,
      userEntitlements,
      activeCourseBlocks,
    ] = await Promise.all([
      getApprovedGradeIds(u.id, u.roleSlug),
      getUserGroupIds(u.id),
      db
        .select()
        .from(examAttempts)
        .where(eq(examAttempts.userId, u.id))
        .orderBy(desc(examAttempts.startedAt)),
      db.select().from(progressRecords).where(eq(progressRecords.userId, u.id)),
      db.select().from(entitlements).where(eq(entitlements.userId, u.id)),
      staffUser
        ? Promise.resolve([])
        : db
            .select({ courseId: courseStudentBlocks.courseId })
            .from(courseStudentBlocks)
            .where(
              and(
                eq(courseStudentBlocks.userId, u.id),
                eq(courseStudentBlocks.isActive, true),
              ),
            ),
    ]);

    if (!approvedGradeIds.length) {
      return res.status(403).json({ error: 'لا يوجد صف دراسي معتمد لحسابك حاليًا.' });
    }

    const requestedGradeId = Number(req.query.gradeId);
    const activeGradeId =
      requestedGradeId && approvedGradeIds.includes(requestedGradeId)
        ? requestedGradeId
        : approvedGradeIds[0];

    const [gradeExams, gradeUnits, gradeLessonsJoined, allEq, allAssign] = await Promise.all([
      db.select().from(exams).where(eq(exams.gradeId, activeGradeId)).orderBy(desc(exams.createdAt)),
      db.select().from(units).where(eq(units.gradeId, activeGradeId)),
      db
        .select({ id: lessons.id, titleAr: lessons.titleAr })
        .from(lessons)
        .innerJoin(units, eq(lessons.unitId, units.id))
        .where(eq(units.gradeId, activeGradeId)),
      db
        .select({
          examId: examQuestions.examId,
          pointsOverride: examQuestions.pointsOverride,
          qPoints: questions.points,
        })
        .from(examQuestions)
        .innerJoin(exams, eq(examQuestions.examId, exams.id))
        .innerJoin(questions, eq(examQuestions.questionId, questions.id))
        .where(eq(exams.gradeId, activeGradeId)),
      db
        .select({
          id: examAssignments.id,
          examId: examAssignments.examId,
          groupId: examAssignments.groupId,
          studentId: examAssignments.studentId,
        })
        .from(examAssignments)
        .innerJoin(exams, eq(examAssignments.examId, exams.id))
        .where(eq(exams.gradeId, activeGradeId)),
    ]);

    const now = new Date();
    const progressByVideo = new Map(userProgress.map((p) => [p.videoId, p]));
    const unitMap = new Map(gradeUnits.map((un) => [un.id, un.titleAr]));
    const lessonMap = new Map(gradeLessonsJoined.map((l) => [l.id, l.titleAr]));

    // Auto-close any expired IN_PROGRESS attempts for this student lazily
    for (const att of userAttempts) {
      if (att.status === 'IN_PROGRESS') {
        const ex = gradeExams.find((e) => e.id === att.examId);
        if (ex) {
          const deadline = att.expiresAt
            ? new Date(att.expiresAt)
            : computeAttemptDeadline(new Date(att.startedAt), ex.durationMin, ex.endsAt);
          if (isAttemptExpired(deadline, now, 2)) {
            const finalized = await finalizeAttemptOnServer(att.id, u.id, { autoSubmitted: true });
            if (finalized && 'attempt' in finalized && finalized.attempt) {
              att.status = finalized.attempt.status;
              att.submittedAt = finalized.attempt.submittedAt;
              att.totalScore = finalized.attempt.totalScore;
              att.maxScore = finalized.attempt.maxScore;
              att.passed = finalized.attempt.passed;
              att.resultPublished = finalized.attempt.resultPublished;
            }
          }
        }
      }
    }

    const blockedCourseSet = new Set(activeCourseBlocks.map((b) => b.courseId));

    const examsList = [];
    for (const ex of gradeExams) {
      const exAssigns = allAssign.filter((a) => a.examId === ex.id);
      const assignedGroupIds = exAssigns.filter((a) => a.groupId !== null).map((a) => a.groupId!);
      const assignedStudentIds = exAssigns.filter((a) => a.studentId !== null).map((a) => a.studentId!);

      const hasCourseAccess =
        !ex.courseId ||
        isStaffRole(u.roleSlug) ||
        (!blockedCourseSet.has(ex.courseId) &&
          userEntitlements.some(
            (e) =>
              !e.isRevoked &&
              (!e.expiresAt || new Date(e.expiresAt).getTime() > now.getTime()) &&
              ((e.targetType === 'COURSE' && e.targetId === ex.courseId) ||
                (e.targetType === 'GRADE_ALL' && e.targetId === activeGradeId)),
          ));

      const exAttempts = userAttempts.filter((a) => a.examId === ex.id);
      const inProgressAttempt = exAttempts.find((a) => a.status === 'IN_PROGRESS') || null;
      const submittedAttempts = exAttempts.filter((a) => a.status !== 'IN_PROGRESS');

      const access = evaluateStudentExamAccess({
        isStaff: isStaffRole(u.roleSlug),
        userStatus: u.status,
        userId: u.id,
        approvedGradeIds,
        userGroupIds,
        hasCourseAccess,
        exam: {
          gradeId: ex.gradeId,
          courseId: ex.courseId,
          publicationStatus: ex.publicationStatus,
          isPublished: ex.isPublished,
          assignmentScope: ex.assignmentScope,
          groupId: ex.groupId,
          assignedUserId: ex.assignedUserId,
          startsAt: ex.startsAt ? new Date(ex.startsAt) : null,
          endsAt: ex.endsAt ? new Date(ex.endsAt) : null,
          maxAttempts: ex.maxAttempts,
        },
        assignedGroupIds,
        assignedStudentIds,
        attemptsUsed: submittedAttempts.length,
        hasInProgressAttempt: Boolean(inProgressAttempt),
        now,
      });

      if (!access.visible) continue;

      const reqProg = ex.requiredVideoId ? progressByVideo.get(ex.requiredVideoId) : null;
      const lockedByVideo =
        Boolean(ex.requiredVideoId) &&
        !isStaffRole(u.roleSlug) &&
        (!reqProg || reqProg.completionPercent < 70);

      const qRows = allEq.filter((l) => l.examId === ex.id);
      const calcMarks = qRows.reduce((s, r) => s + (r.pointsOverride ?? r.qPoints), 0);
      const totalMarks = Number(ex.totalMarks) > 0 ? Number(ex.totalMarks) : calcMarks;

      const latest = exAttempts[0] || null;
      const canShowLatestScore = latest && latest.status !== 'IN_PROGRESS' && latest.resultPublished;

      const remainingSec = inProgressAttempt
        ? computeRemainingSeconds(
            inProgressAttempt.expiresAt
              ? new Date(inProgressAttempt.expiresAt)
              : computeAttemptDeadline(new Date(inProgressAttempt.startedAt), ex.durationMin, ex.endsAt),
            now,
          )
        : null;

      examsList.push({
        id: ex.id,
        gradeId: ex.gradeId,
        unitId: ex.unitId,
        unitTitleAr: ex.unitId ? unitMap.get(ex.unitId) || null : null,
        lessonId: ex.lessonId,
        lessonTitleAr: ex.lessonId ? lessonMap.get(ex.lessonId) || null : null,
        titleAr: ex.titleAr,
        descriptionAr: ex.descriptionAr || '',
        instructionsAr: ex.instructionsAr || '',
        examType: ex.examType,
        durationMin: ex.durationMin,
        totalMarks,
        questionCount: qRows.length,
        passScorePercent: ex.passScorePercent,
        startsAt: ex.startsAt,
        endsAt: ex.endsAt,
        maxAttempts: ex.maxAttempts,
        attemptsUsed: submittedAttempts.length,
        bucket: lockedByVideo ? 'LOCKED' : access.bucket,
        canStart: !lockedByVideo && access.canStart,
        lockReasonAr: lockedByVideo
          ? 'مقفل حتى إتمام مشاهدة المحاضرة المرتبطة بنسبة 70% على الأقل.'
          : access.reasonAr,
        inProgressAttemptId: inProgressAttempt?.id || null,
        remainingSec,
        latestAttempt: latest
          ? {
              id: latest.id,
              attemptNumber: latest.attemptNumber,
              status: latest.status,
              resultPublished: latest.resultPublished,
              totalScore: canShowLatestScore ? Number(latest.totalScore) : null,
              maxScore: Number(latest.maxScore),
              passed: canShowLatestScore ? latest.passed : null,
              submittedAt: latest.submittedAt,
            }
          : null,
      });
    }

    // Build "نتائجي" (My Results) from all student's submitted/graded attempts across approved grades
    const completedAttempts = userAttempts.filter((a) => a.status !== 'IN_PROGRESS');
    const examById = new Map(gradeExams.map((e) => [e.id, e]));
    const attemptExamIds = [...new Set(completedAttempts.map((a) => a.examId))];
    const missingExamIds = attemptExamIds.filter((id) => !examById.has(id));
    const completedAttemptIds = completedAttempts.map((a) => a.id);

    const [missingExams, attemptAnswers, extraEqCounts] = await Promise.all([
      missingExamIds.length
        ? db.select().from(exams).where(inArray(exams.id, missingExamIds))
        : Promise.resolve([]),
      completedAttemptIds.length
        ? db
            .select({
              attemptId: studentAnswers.attemptId,
              selectedChoiceId: studentAnswers.selectedChoiceId,
              textAnswer: studentAnswers.textAnswer,
              numericAnswer: studentAnswers.numericAnswer,
              uploadedFileName: studentAnswers.uploadedFileName,
              needsManualGrading: studentAnswers.needsManualGrading,
              isCorrect: studentAnswers.isCorrect,
            })
            .from(studentAnswers)
            .where(inArray(studentAnswers.attemptId, completedAttemptIds))
        : Promise.resolve([]),
      missingExamIds.length
        ? db
            .select({ examId: examQuestions.examId })
            .from(examQuestions)
            .where(inArray(examQuestions.examId, missingExamIds))
        : Promise.resolve([]),
    ]);

    for (const ex of missingExams) examById.set(ex.id, ex);

    const eqCountByExam = new Map<number, number>();
    for (const q of allEq) {
      eqCountByExam.set(q.examId, (eqCountByExam.get(q.examId) || 0) + 1);
    }
    for (const q of extraEqCounts) {
      eqCountByExam.set(q.examId, (eqCountByExam.get(q.examId) || 0) + 1);
    }

    const answersByAttempt = new Map<number, typeof attemptAnswers>();
    for (const a of attemptAnswers) {
      const list = answersByAttempt.get(a.attemptId) || [];
      list.push(a);
      answersByAttempt.set(a.attemptId, list);
    }

    const myResults = completedAttempts
      .map((att) => {
        const ex = examById.get(att.examId);
        if (!ex) return null;
        const answers = answersByAttempt.get(att.id) || [];
        const totalQuestions = eqCountByExam.get(att.examId) || 0;
        const pendingManualCount = answers.filter((a) => a.needsManualGrading).length;
        const canRevealScore = Boolean(att.resultPublished);
        const maxScore = Number(att.maxScore || 0);
        const totalScore = Number(att.totalScore || 0);
        const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

        let correctCount = 0;
        let incorrectCount = 0;
        let answeredCount = 0;
        for (const a of answers) {
          const hasAns = Boolean(
            a.selectedChoiceId ||
              (a.textAnswer && a.textAnswer.trim()) ||
              (a.numericAnswer && a.numericAnswer.trim()) ||
              a.uploadedFileName,
          );
          if (hasAns) answeredCount += 1;
          if (!a.needsManualGrading) {
            if (a.isCorrect === true) correctCount += 1;
            else if (hasAns && a.isCorrect === false) incorrectCount += 1;
          }
        }
        const unansweredCount = Math.max(0, totalQuestions - answeredCount);

        return {
          attemptId: att.id,
          examId: att.examId,
          examTitleAr: ex.titleAr,
          examType: ex.examType,
          attemptNumber: att.attemptNumber,
          submittedAt: att.submittedAt || att.startedAt,
          status: att.status,
          resultPublished: att.resultPublished,
          totalMarks: maxScore,
          studentScore: canRevealScore ? totalScore : null,
          percent: canRevealScore ? percent : null,
          passed: canRevealScore ? att.passed : null,
          passScorePercent: ex.passScorePercent,
          correctCount: canRevealScore ? correctCount : null,
          incorrectCount: canRevealScore ? incorrectCount : null,
          unansweredCount,
          pendingManualCount,
          generalFeedback: canRevealScore ? att.generalFeedback || '' : '',
          canReview: canRevealScore && ex.allowStudentReview,
          showCorrectAnswers: canRevealScore && ex.showCorrectAnswers,
        };
      })
      .filter(Boolean);

    return res.json({
      serverNow: now.toISOString(),
      exams: examsList,
      myResults,
    });
  } catch (error) {
    console.error('Student exams list error:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الامتحانات والنتائج' });
  }
});

// 2. Exam Instruction Brief before starting (Zero questions or answers exposed!)
examsRouter.get('/:id/brief', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const examId = Number(req.params.id);
    const u = req.authUser!;
    const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const [approvedGradeIds, userGroupIds, assignmentsRows, existingAttempts, eqRows] = await Promise.all([
      getApprovedGradeIds(u.id, u.roleSlug),
      getUserGroupIds(u.id),
      db.select().from(examAssignments).where(eq(examAssignments.examId, examId)),
      db
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, examId), eq(examAttempts.userId, u.id)))
        .orderBy(desc(examAttempts.attemptNumber)),
      db
        .select({ pointsOverride: examQuestions.pointsOverride, qPoints: questions.points })
        .from(examQuestions)
        .innerJoin(questions, eq(examQuestions.questionId, questions.id))
        .where(eq(examQuestions.examId, examId)),
    ]);

    const hasCourseAccess = await hasUserCourseAccess(u.id, u.roleSlug, examRow.courseId, examRow.gradeId);
    const inProgress = existingAttempts.find((a) => a.status === 'IN_PROGRESS') || null;
    const submittedCount = existingAttempts.filter((a) => a.status !== 'IN_PROGRESS').length;

    const access = evaluateStudentExamAccess({
      isStaff: isStaffRole(u.roleSlug),
      userStatus: u.status,
      userId: u.id,
      approvedGradeIds,
      userGroupIds,
      hasCourseAccess,
      exam: {
        gradeId: examRow.gradeId,
        courseId: examRow.courseId,
        publicationStatus: examRow.publicationStatus,
        isPublished: examRow.isPublished,
        assignmentScope: examRow.assignmentScope,
        groupId: examRow.groupId,
        assignedUserId: examRow.assignedUserId,
        startsAt: examRow.startsAt ? new Date(examRow.startsAt) : null,
        endsAt: examRow.endsAt ? new Date(examRow.endsAt) : null,
        maxAttempts: examRow.maxAttempts,
      },
      assignedGroupIds: assignmentsRows.filter((a) => a.groupId !== null).map((a) => a.groupId!),
      assignedStudentIds: assignmentsRows.filter((a) => a.studentId !== null).map((a) => a.studentId!),
      attemptsUsed: submittedCount,
      hasInProgressAttempt: Boolean(inProgress),
    });

    if (!access.visible) {
      return res.status(403).json({ error: access.reasonAr || 'غير مصرح لك بالوصول إلى هذا الامتحان' });
    }

    const calcMarks = eqRows.reduce((s, r) => s + (r.pointsOverride ?? r.qPoints), 0);
    const totalMarks = Number(examRow.totalMarks) > 0 ? Number(examRow.totalMarks) : calcMarks;

    return res.json({
      exam: {
        id: examRow.id,
        titleAr: examRow.titleAr,
        descriptionAr: examRow.descriptionAr || '',
        instructionsAr: examRow.instructionsAr || '',
        examType: examRow.examType,
        durationMin: examRow.durationMin,
        totalMarks,
        questionCount: eqRows.length,
        passScorePercent: examRow.passScorePercent,
        maxAttempts: examRow.maxAttempts,
        attemptsUsed: submittedCount,
        remainingAttempts: Math.max(0, examRow.maxAttempts - submittedCount),
        startsAt: examRow.startsAt,
        endsAt: examRow.endsAt,
        allowNavigation: examRow.allowNavigation,
        allowReviewBeforeSubmit: examRow.allowReviewBeforeSubmit,
        allowNegativeMarking: examRow.allowNegativeMarking,
        showResultImmediately: examRow.showResultImmediately,
        shuffleQuestions: examRow.shuffleQuestions,
        shuffleChoices: examRow.shuffleChoices,
      },
      canStart: access.canStart,
      reasonAr: access.reasonAr,
      inProgressAttemptId: inProgress?.id || null,
    });
  } catch (error) {
    console.error('Exam brief failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل تعليمات الامتحان' });
  }
});

// 3. Start or Resume Exam Attempt (Server-authoritative timer + persisted shuffle + zero answer key leak)
examsRouter.post(
  '/:id/start',
  requireAuth,
  requireActiveAccount,
  examActionRateLimiter,
  async (req: AuthRequest, res) => {
    try {
      const examId = Number(req.params.id);
      const u = req.authUser!;
      const [examRow] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
      if (!examRow) return res.status(404).json({ error: 'الامتحان غير متاح حاليًا' });

      const [approvedGradeIds, userGroupIds, assignmentsRows] = await Promise.all([
        getApprovedGradeIds(u.id, u.roleSlug),
        getUserGroupIds(u.id),
        db.select().from(examAssignments).where(eq(examAssignments.examId, examId)),
      ]);
      const hasCourseAccess = await hasUserCourseAccess(u.id, u.roleSlug, examRow.courseId, examRow.gradeId);

      const now = new Date();
      const existingAttempts = await db
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, examId), eq(examAttempts.userId, u.id)))
        .orderBy(desc(examAttempts.attemptNumber));

      let inProgress = existingAttempts.find((a) => a.status === 'IN_PROGRESS') || null;

      // If existing IN_PROGRESS attempt already expired on server, auto-submit it first!
      if (inProgress) {
        const deadline = inProgress.expiresAt
          ? new Date(inProgress.expiresAt)
          : computeAttemptDeadline(new Date(inProgress.startedAt), examRow.durationMin, examRow.endsAt);
        if (isAttemptExpired(deadline, now, 2)) {
          await finalizeAttemptOnServer(inProgress.id, u.id, { autoSubmitted: true });
          inProgress = null;
        }
      }

      const freshAttempts = inProgress
        ? existingAttempts
        : await db
            .select()
            .from(examAttempts)
            .where(and(eq(examAttempts.examId, examId), eq(examAttempts.userId, u.id)))
            .orderBy(desc(examAttempts.attemptNumber));
      const submittedCount = freshAttempts.filter((a) => a.status !== 'IN_PROGRESS').length;

      const access = evaluateStudentExamAccess({
        isStaff: isStaffRole(u.roleSlug),
        userStatus: u.status,
        userId: u.id,
        approvedGradeIds,
        userGroupIds,
        hasCourseAccess,
        exam: {
          gradeId: examRow.gradeId,
          courseId: examRow.courseId,
          publicationStatus: examRow.publicationStatus,
          isPublished: examRow.isPublished,
          assignmentScope: examRow.assignmentScope,
          groupId: examRow.groupId,
          assignedUserId: examRow.assignedUserId,
          startsAt: examRow.startsAt ? new Date(examRow.startsAt) : null,
          endsAt: examRow.endsAt ? new Date(examRow.endsAt) : null,
          maxAttempts: examRow.maxAttempts,
        },
        assignedGroupIds: assignmentsRows.filter((a) => a.groupId !== null).map((a) => a.groupId!),
        assignedStudentIds: assignmentsRows.filter((a) => a.studentId !== null).map((a) => a.studentId!),
        attemptsUsed: submittedCount,
        hasInProgressAttempt: Boolean(inProgress),
        now,
      });

      if (!access.visible || !access.canStart) {
        return res.status(403).json({ error: access.reasonAr || 'غير مصرح لك ببدء هذا الامتحان حاليًا' });
      }

      if (!isStaffRole(u.roleSlug) && examRow.requiredVideoId) {
        const [prog] = await db
          .select()
          .from(progressRecords)
          .where(and(eq(progressRecords.userId, u.id), eq(progressRecords.videoId, examRow.requiredVideoId)))
          .limit(1);
        if (!prog || prog.completionPercent < 70) {
          return res.status(403).json({
            error: 'هذا الامتحان مقفل حتى إتمام مشاهدة الدرس المرتبط به بنسبة 70% على الأقل.',
          });
        }
      }

      const eqRows = await db
        .select({
          link: examQuestions,
          question: questions,
        })
        .from(examQuestions)
        .innerJoin(questions, eq(examQuestions.questionId, questions.id))
        .where(eq(examQuestions.examId, examId))
        .orderBy(asc(examQuestions.sortOrder), asc(examQuestions.id));

      if (eqRows.length === 0) {
        return res.status(400).json({ error: 'لا يحتوي هذا الامتحان على أسئلة بعد.' });
      }

      const qIds = eqRows.map((r) => r.question.id);
      const [choiceRows, qAttachmentRows] = await Promise.all([
        db
          .select()
          .from(choices)
          .where(inArray(choices.questionId, qIds))
          .orderBy(asc(choices.sortOrder), asc(choices.id)),
        db
          .select()
          .from(questionAttachments)
          .where(
            and(
              inArray(questionAttachments.questionId, qIds),
              eq(questionAttachments.attachmentRole, 'QUESTION_IMAGE'),
            ),
          )
          .orderBy(asc(questionAttachments.displayOrder), asc(questionAttachments.id)),
      ]);

      let activeAttempt = inProgress;
      if (!activeAttempt) {
        const nextNum = (freshAttempts[0]?.attemptNumber || 0) + 1;
        const startedAt = new Date();
        const expiresAt = computeAttemptDeadline(startedAt, examRow.durationMin, examRow.endsAt);

        // Generate & persist randomized question & choice orders ONCE per attempt
        const orderedQuestionIds = buildOrderedIds(qIds, examRow.shuffleQuestions);
        const choiceOrderMap: Record<string, number[]> = {};
        for (const qId of qIds) {
          const cIds = choiceRows.filter((c) => c.questionId === qId).map((c) => c.id);
          choiceOrderMap[String(qId)] = buildOrderedIds(cIds, examRow.shuffleChoices);
        }

        const totalPossible = eqRows.reduce((s, r) => s + (r.link.pointsOverride ?? r.question.points), 0);

        // Use transaction to prevent race condition across multiple tabs opening simultaneously
        activeAttempt = await db.transaction(async (tx) => {
          const [existingLive] = await tx
            .select()
            .from(examAttempts)
            .where(
              and(
                eq(examAttempts.examId, examId),
                eq(examAttempts.userId, u.id),
                eq(examAttempts.status, 'IN_PROGRESS'),
              ),
            )
            .limit(1);
          if (existingLive) return existingLive;

          const [created] = await tx
            .insert(examAttempts)
            .values({
              examId,
              userId: u.id,
              attemptNumber: nextNum,
              status: 'IN_PROGRESS',
              startedAt,
              expiresAt,
              questionOrderJson: orderedQuestionIds,
              choiceOrderJson: choiceOrderMap,
              flaggedQuestionsJson: [],
              maxScore: totalPossible.toFixed(2),
              resultPublished: examRow.showResultImmediately,
            })
            .returning();
          return created;
        });
      }

      const savedAnswers = await db
        .select()
        .from(studentAnswers)
        .where(eq(studentAnswers.attemptId, activeAttempt.id));

      const eqById = new Map(eqRows.map((r) => [r.question.id, r]));
      const persistedOrder =
        Array.isArray(activeAttempt.questionOrderJson) && activeAttempt.questionOrderJson.length > 0
          ? activeAttempt.questionOrderJson.filter((id) => eqById.has(id))
          : qIds;
      // Append any newly added questions not yet in persistedOrder
      for (const id of qIds) {
        if (!persistedOrder.includes(id)) persistedOrder.push(id);
      }

      const persistedChoiceMap =
        activeAttempt.choiceOrderJson && typeof activeAttempt.choiceOrderJson === 'object'
          ? activeAttempt.choiceOrderJson
          : {};

      // CRITICAL SECURITY: NEVER include isCorrect, numericAnswer, modelAnswerAr, explanationAr, or shortAnswerRulesJson!
      const formattedQuestions = persistedOrder.map((qId) => {
        const r = eqById.get(qId)!;
        const rawChoices = choiceRows.filter((c) => c.questionId === r.question.id);
        const cById = new Map(rawChoices.map((c) => [c.id, c]));
        const orderForQ = persistedChoiceMap[String(qId)] || rawChoices.map((c) => c.id);
        const orderedChoices = orderForQ
          .filter((cid) => cById.has(cid))
          .map((cid) => {
            const c = cById.get(cid)!;
            return {
              id: c.id,
              labelAr: c.labelAr,
              latexFormula: c.latexFormula,
            };
          });

        const saved = savedAnswers.find((a) => a.questionId === r.question.id);
        const qImages = qAttachmentRows
          .filter((a) => a.questionId === r.question.id)
          .map((a) => ({
            storageKey: a.storageKey,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            displayOrder: a.displayOrder,
            previewUrl: buildSignedQuestionBankFileUrl({
              storageKey: a.storageKey,
              userId: u.id,
              roleSlug: u.roleSlug,
              context: 'exam',
              resourceId: examId,
              fileRole: 'question',
            }),
          }));
        return {
          id: r.question.id,
          questionType: r.question.questionType,
          difficulty: r.question.difficulty,
          promptAr: r.question.promptAr,
          latexFormula: r.question.latexFormula,
          imageUrl: r.question.imageUrl,
          questionImages: qImages,
          points: r.link.pointsOverride ?? r.question.points,
          negativePoints: examRow.allowNegativeMarking ? Number(r.question.negativePoints || 0) : 0,
          numericUnit: r.question.numericUnit || '',
          choices: orderedChoices,
          savedAnswer: saved
            ? {
                selectedChoiceId: saved.selectedChoiceId,
                textAnswer: saved.textAnswer,
                numericAnswer: saved.numericAnswer,
                uploadedFileName: saved.uploadedFileName,
              }
            : null,
        };
      });

      const effectiveExpiresAt = activeAttempt.expiresAt
        ? new Date(activeAttempt.expiresAt)
        : computeAttemptDeadline(new Date(activeAttempt.startedAt), examRow.durationMin, examRow.endsAt);
      const serverNow = new Date();
      const remainingSec = computeRemainingSeconds(effectiveExpiresAt, serverNow);

      return res.json({
        attempt: {
          id: activeAttempt.id,
          attemptNumber: activeAttempt.attemptNumber,
          startedAt: activeAttempt.startedAt,
          expiresAt: effectiveExpiresAt.toISOString(),
          flaggedQuestions: Array.isArray(activeAttempt.flaggedQuestionsJson)
            ? activeAttempt.flaggedQuestionsJson
            : [],
        },
        exam: {
          id: examRow.id,
          titleAr: examRow.titleAr,
          descriptionAr: examRow.descriptionAr || '',
          instructionsAr: examRow.instructionsAr || '',
          durationMin: examRow.durationMin,
          passScorePercent: examRow.passScorePercent,
          allowNavigation: examRow.allowNavigation,
          allowReviewBeforeSubmit: examRow.allowReviewBeforeSubmit,
          allowNegativeMarking: examRow.allowNegativeMarking,
          showResultImmediately: examRow.showResultImmediately,
          showCorrectAnswers: examRow.showCorrectAnswers,
        },
        serverNow: serverNow.toISOString(),
        expiresAt: effectiveExpiresAt.toISOString(),
        remainingSec,
        questions: formattedQuestions,
      });
    } catch (error) {
      console.error('Exam start failed:', error);
      return res.status(500).json({ error: 'تعذر بدء الامتحان' });
    }
  },
);

// 4. Autosave Single Answer + Flagged Questions (enforces server deadline!)
examsRouter.post(
  '/attempts/:attemptId/autosave',
  requireAuth,
  requireActiveAccount,
  examActionRateLimiter,
  async (req: AuthRequest, res) => {
    try {
      const attemptId = Number(req.params.attemptId);
      const u = req.authUser!;
      const [attempt] = await db
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.userId, u.id)))
        .limit(1);

      if (!attempt) return res.status(404).json({ error: 'المحاولة غير موجودة' });
      if (attempt.status !== 'IN_PROGRESS') {
        return res.status(409).json({ error: 'تم تسليم هذه المحاولة بالفعل', alreadySubmitted: true });
      }

      const [examRow] = await db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
      if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

      const deadline = attempt.expiresAt
        ? new Date(attempt.expiresAt)
        : computeAttemptDeadline(new Date(attempt.startedAt), examRow.durationMin, examRow.endsAt);
      const now = new Date();

      if (isAttemptExpired(deadline, now, 5)) {
        // Server-authoritative timeout enforcement: auto-submit immediately!
        const autoRes = await finalizeAttemptOnServer(attemptId, u.id, { autoSubmitted: true });
        return res.status(409).json({
          error: 'انتهى وقت الامتحان وتم تسليم إجاباتك تلقائيًا.',
          expired: true,
          autoSubmitResult: autoRes,
        });
      }

      const answerSchema = z.object({
        questionId: z.coerce.number().int().positive().optional(),
        selectedChoiceId: z.coerce.number().int().positive().nullable().optional(),
        textAnswer: z.string().nullable().optional(),
        numericAnswer: z.string().nullable().optional(),
        uploadedFileName: z.string().nullable().optional(),
        uploadedFileData: z.string().max(2_000_000).nullable().optional(),
        flaggedQuestions: z.array(z.coerce.number().int().positive()).optional(),
      });

      const parsed = answerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'صيغة الإجابة غير صالحة' });

      const d = parsed.data;
      if (d.uploadedFileData && !isSafeUploadDataUrl(d.uploadedFileData, 2_000_000)) {
        return res.status(400).json({ error: 'صيغة الملف المرفق غير مدعومة (صور أو PDF فقط).' });
      }

      if (d.questionId) {
        const [validExamQ] = await db
          .select({ id: examQuestions.id })
          .from(examQuestions)
          .where(and(eq(examQuestions.examId, attempt.examId), eq(examQuestions.questionId, d.questionId)))
          .limit(1);
        if (!validExamQ) {
          return res.status(400).json({ error: 'السؤال المحدد لا ينتمي لهذا الامتحان' });
        }

        if (d.selectedChoiceId) {
          const [validChoice] = await db
            .select({ id: choices.id })
            .from(choices)
            .where(and(eq(choices.id, d.selectedChoiceId), eq(choices.questionId, d.questionId)))
            .limit(1);
          if (!validChoice) {
            return res.status(400).json({ error: 'الاختيار المحدد غير تابع لهذا السؤال' });
          }
        }

        await db
          .insert(studentAnswers)
          .values({
            attemptId,
            questionId: d.questionId,
            selectedChoiceId: d.selectedChoiceId ?? null,
            textAnswer: d.textAnswer ?? null,
            numericAnswer: d.numericAnswer ?? null,
            uploadedFileName: d.uploadedFileName ?? null,
            uploadedFileData: d.uploadedFileData ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [studentAnswers.attemptId, studentAnswers.questionId],
            set: {
              selectedChoiceId: d.selectedChoiceId ?? null,
              textAnswer: d.textAnswer ?? null,
              numericAnswer: d.numericAnswer ?? null,
              uploadedFileName: d.uploadedFileName ?? null,
              uploadedFileData: d.uploadedFileData ?? null,
              updatedAt: new Date(),
            },
          });
      }

      if (Array.isArray(d.flaggedQuestions)) {
        await db
          .update(examAttempts)
          .set({ flaggedQuestionsJson: d.flaggedQuestions })
          .where(eq(examAttempts.id, attemptId));
      }

      return res.json({
        saved: true,
        savedAt: now.toISOString(),
        serverNow: now.toISOString(),
        remainingSec: computeRemainingSeconds(deadline, now),
      });
    } catch (error) {
      console.error('Exam autosave failed:', error);
      return res.status(500).json({ error: 'تعذر حفظ الإجابة تلقائيًا' });
    }
  },
);

// 5. Submit Exam Attempt (Duplicate-submission protected + server deadline validated)
examsRouter.post(
  '/attempts/:attemptId/submit',
  requireAuth,
  requireActiveAccount,
  examSubmitRateLimiter,
  async (req: AuthRequest, res) => {
    try {
      const attemptId = Number(req.params.attemptId);
      const u = req.authUser!;
      const autoSubmitted = Boolean(req.body?.autoSubmitted);
      const finalAnswersBatch = Array.isArray(req.body?.answers) ? req.body.answers : undefined;
      const flaggedQuestions = Array.isArray(req.body?.flaggedQuestions) ? req.body.flaggedQuestions : undefined;

      const out = await finalizeAttemptOnServer(attemptId, u.id, {
        autoSubmitted,
        finalAnswersBatch,
        flaggedQuestions,
      });

      if ('error' in out && out.error) {
        return res.status(out.status).json({ error: out.error });
      }
      if (out.alreadySubmitted) {
        return res.status(409).json({ error: 'تم تسليم هذا الامتحان مسبقًا ولا يمكن تكرار التسليم' });
      }

      return res.json({
        attempt: out.attempt,
        summary: out.summary,
        resultPublished: out.resultPublished,
        showResultImmediately: out.showResultImmediately,
        showCorrectAnswers: out.showCorrectAnswers,
        allowStudentReview: out.allowStudentReview,
        review: out.review,
      });
    } catch (error) {
      console.error('Exam submit failed:', error);
      return res.status(500).json({ error: 'تعذر تسليم وتصحيح الامتحان' });
    }
  },
);

// 6. Student Attempt Result & Answer Review (strictly enforces ownership + teacher result visibility policy!)
examsRouter.get('/attempts/:attemptId/result', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const attemptId = Number(req.params.attemptId);
    const u = req.authUser!;

    const [attempt] = await db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).limit(1);
    if (!attempt) return res.status(404).json({ error: 'المحاولة غير موجودة' });

    const hasExamStaffPrivilege =
      isStaffRole(u.roleSlug) &&
      hasAnyPermission(u, [PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE]);

    // Strict student privacy & least-privilege RBAC: only owner or authorized exam staff may view attempt results
    if (attempt.userId !== u.id && !hasExamStaffPrivilege) {
      return res.status(403).json({ error: 'غير مصرح لك بعرض نتيجة طالب آخر' });
    }

    if (attempt.status === 'IN_PROGRESS') {
      return res.status(400).json({ error: 'هذه المحاولة ما زالت قيد التنفيذ ولم يتم تسليمها بعد' });
    }

    const [examRow] = await db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
    if (!examRow) return res.status(404).json({ error: 'الامتحان غير موجود' });

    if (!attempt.resultPublished && !hasExamStaffPrivilege) {
      return res.json({
        resultPublished: false,
        message: 'تم استلام إجاباتك بنجاح. النتيجة بانتظار اعتماد ونشر المدرس.',
        exam: { id: examRow.id, titleAr: examRow.titleAr, examType: examRow.examType },
        attempt: {
          id: attempt.id,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
        },
        review: [],
      });
    }

    const eqRows = await db
      .select({ link: examQuestions, question: questions })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .where(eq(examQuestions.examId, examRow.id))
      .orderBy(asc(examQuestions.sortOrder), asc(examQuestions.id));

    const qIds = eqRows.map((r) => r.question.id);
    const [allChoices, allAtts] = qIds.length
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
    const savedAnswers = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.attemptId, attemptId));

    const canReview = examRow.allowStudentReview || hasExamStaffPrivilege;
    const showCorrect = examRow.showCorrectAnswers || hasExamStaffPrivilege;
    const showExpl = examRow.showExplanations || hasExamStaffPrivilege;

    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    let manualPendingCount = 0;

    const review = canReview
      ? eqRows.map((r) => {
          const ans = savedAnswers.find((a) => a.questionId === r.question.id);
          const hasAns = Boolean(
            ans &&
              (ans.selectedChoiceId ||
                (ans.textAnswer && ans.textAnswer.trim()) ||
                (ans.numericAnswer && ans.numericAnswer.trim()) ||
                ans.uploadedFileName),
          );
          if (ans?.needsManualGrading) manualPendingCount += 1;
          else if (!hasAns) unansweredCount += 1;
          else if (ans?.isCorrect) correctCount += 1;
          else incorrectCount += 1;

          const qChoices = allChoices.filter((c) => c.questionId === r.question.id);
          const qAtts = allAtts.filter((a) => a.questionId === r.question.id);
          return {
            questionId: r.question.id,
            promptAr: r.question.promptAr,
            latexFormula: r.question.latexFormula,
            imageUrl: r.question.imageUrl,
            questionImages: qAtts
              .filter((a) => a.attachmentRole === 'QUESTION_IMAGE')
              .map((a) => ({
                storageKey: a.storageKey,
                fileName: a.fileName,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
                displayOrder: a.displayOrder,
                previewUrl: buildSignedQuestionBankFileUrl({
                  storageKey: a.storageKey,
                  userId: u.id,
                  roleSlug: u.roleSlug,
                  context: 'exam',
                  resourceId: examRow.id,
                  fileRole: 'question',
                }),
              })),
            modelAnswerFiles: showCorrect
              ? qAtts
                  .filter((a) => a.attachmentRole !== 'QUESTION_IMAGE')
                  .map((a) => ({
                    storageKey: a.storageKey,
                    fileName: a.fileName,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                    displayOrder: a.displayOrder,
                    previewUrl: buildSignedQuestionBankFileUrl({
                      storageKey: a.storageKey,
                      userId: u.id,
                      roleSlug: u.roleSlug,
                      context: 'exam',
                      resourceId: examRow.id,
                      fileRole: 'model_answer',
                    }),
                  }))
              : [],
            questionType: r.question.questionType,
            points: r.link.pointsOverride ?? r.question.points,
            awardedPoints: ans ? Number(ans.awardedPoints) : 0,
            isCorrect: ans ? ans.isCorrect : false,
            needsManualGrading: ans ? ans.needsManualGrading : false,
            selectedChoiceId: ans?.selectedChoiceId ?? null,
            textAnswer: ans?.textAnswer ?? null,
            numericAnswer: ans?.numericAnswer ?? null,
            numericUnit: r.question.numericUnit || '',
            uploadedFileName: ans?.uploadedFileName ?? null,
            graderFeedback: ans?.graderFeedback || '',
            correctNumericAnswer: showCorrect && r.question.numericAnswer !== null ? String(r.question.numericAnswer) : null,
            modelAnswerAr: showCorrect ? r.question.modelAnswerAr || '' : '',
            explanationAr: showExpl ? r.question.explanationAr || '' : '',
            choices: qChoices.map((c) => ({
              id: c.id,
              labelAr: c.labelAr,
              latexFormula: c.latexFormula,
              ...(showCorrect ? { isCorrect: c.isCorrect } : {}),
            })),
          };
        })
      : [];

    const maxScore = Number(attempt.maxScore || 0);
    const totalScore = Number(attempt.totalScore || 0);
    const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    return res.json({
      resultPublished: true,
      exam: {
        id: examRow.id,
        titleAr: examRow.titleAr,
        examType: examRow.examType,
        passScorePercent: examRow.passScorePercent,
        allowStudentReview: examRow.allowStudentReview,
        showCorrectAnswers: examRow.showCorrectAnswers,
        showExplanations: examRow.showExplanations,
      },
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        autoScore: Number(attempt.autoScore || 0),
        manualScore: Number(attempt.manualScore || 0),
        totalScore,
        maxScore,
        percent,
        passed: attempt.passed,
        generalFeedback: attempt.generalFeedback || '',
        correctCount,
        incorrectCount,
        unansweredCount,
        manualPendingCount,
      },
      review,
    });
  } catch (error) {
    console.error('Get student attempt result error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تقرير نتيجة الامتحان' });
  }
});
