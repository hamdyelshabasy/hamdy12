import { parseLocalizedNumber } from '../../lib/numerals.ts';

export interface GradeableQuestion {
  id: number;
  lessonId: number | null;
  lessonTitleAr?: string;
  questionType: string; // MCQ | TRUE_FALSE | NUMERIC | SHORT_ANSWER | ESSAY | PHYSICS_PROBLEM | IMAGE_DIAGRAM | FILE_UPLOAD
  points: number;
  negativePoints?: number;
  numericAnswer: number | null;
  numericTolerance: number;
  shortAnswerRules?: string[];
  correctChoiceIds: number[];
}

export interface SubmittedAnswer {
  questionId: number;
  selectedChoiceId?: number | null;
  textAnswer?: string | null;
  numericAnswer?: string | null;
  uploadedFileName?: string | null;
}

export interface GradedAnswerOutcome {
  questionId: number;
  isCorrect: boolean | null;
  isAnswered: boolean;
  awardedPoints: number;
  maxPoints: number;
  needsManualGrading: boolean;
}

export interface LessonPerformanceMetric {
  lessonId: number;
  lessonTitleAr: string;
  earnedPoints: number;
  possiblePoints: number;
  percent: number;
  level: 'STRONG' | 'AVERAGE' | 'NEEDS_WORK';
}

export interface ExamGradingOptions {
  allowNegativeMarking?: boolean;
}

export interface ExamGradingSummary {
  autoScore: number;
  maxScore: number;
  hasManualQuestions: boolean;
  percent: number;
  passed: boolean;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  manualPendingCount: number;
  outcomes: GradedAnswerOutcome[];
  lessonAnalytics: LessonPerformanceMetric[];
}

export function normalizeShortAnswer(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

export function parseNumericInput(raw: string | null | undefined): number {
  const parsed = parseLocalizedNumber(raw);
  return parsed === null ? Number.NaN : parsed;
}

export function gradeExamSubmission(
  questions: GradeableQuestion[],
  answers: SubmittedAnswer[],
  passScorePercent: number,
  options?: ExamGradingOptions,
): ExamGradingSummary {
  const allowNegative = Boolean(options?.allowNegativeMarking);
  const answerMap = new Map<number, SubmittedAnswer>();
  for (const a of answers) {
    answerMap.set(a.questionId, a);
  }

  let rawAutoScore = 0;
  let maxScore = 0;
  let hasManualQuestions = false;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let manualPendingCount = 0;

  const outcomes: GradedAnswerOutcome[] = [];
  const lessonBuckets = new Map<
    number,
    { title: string; earned: number; possible: number }
  >();

  for (const q of questions) {
    maxScore += q.points;
    const ans = answerMap.get(q.id);
    const negPenalty = allowNegative ? Math.max(0, Number(q.negativePoints || 0)) : 0;

    let isCorrect: boolean | null = false;
    let isAnswered = false;
    let awardedPoints = 0;
    let needsManualGrading = false;

    const isChoiceBased =
      q.questionType === 'MCQ' ||
      q.questionType === 'TRUE_FALSE' ||
      (q.questionType === 'IMAGE_DIAGRAM' && q.correctChoiceIds.length > 0);

    if (isChoiceBased) {
      isAnswered = Boolean(ans?.selectedChoiceId);
      if (!isAnswered) {
        isCorrect = false;
        awardedPoints = 0;
        unansweredCount += 1;
      } else {
        isCorrect = q.correctChoiceIds.includes(ans!.selectedChoiceId!);
        if (isCorrect) {
          awardedPoints = q.points;
          correctCount += 1;
        } else {
          awardedPoints = negPenalty > 0 ? -negPenalty : 0;
          incorrectCount += 1;
        }
      }
    } else if (q.questionType === 'NUMERIC' && q.numericAnswer !== null) {
      const rawNum = ans?.numericAnswer?.trim() || '';
      isAnswered = rawNum.length > 0;
      if (!isAnswered) {
        isCorrect = false;
        awardedPoints = 0;
        unansweredCount += 1;
      } else {
        const parsed = parseNumericInput(rawNum);
        if (!Number.isNaN(parsed)) {
          isCorrect = Math.abs(parsed - q.numericAnswer) <= Math.max(0, q.numericTolerance);
          if (isCorrect) {
            awardedPoints = q.points;
            correctCount += 1;
          } else {
            awardedPoints = negPenalty > 0 ? -negPenalty : 0;
            incorrectCount += 1;
          }
        } else {
          isCorrect = false;
          awardedPoints = negPenalty > 0 ? -negPenalty : 0;
          incorrectCount += 1;
        }
      }
    } else if (
      q.questionType === 'SHORT_ANSWER' &&
      Array.isArray(q.shortAnswerRules) &&
      q.shortAnswerRules.filter((r) => r.trim().length > 0).length > 0
    ) {
      const rawText = ans?.textAnswer?.trim() || '';
      isAnswered = rawText.length > 0;
      if (!isAnswered) {
        isCorrect = false;
        awardedPoints = 0;
        unansweredCount += 1;
      } else {
        const normAns = normalizeShortAnswer(rawText);
        const accepted = q.shortAnswerRules
          .filter((r) => r.trim().length > 0)
          .map(normalizeShortAnswer);
        isCorrect = accepted.includes(normAns);
        if (isCorrect) {
          awardedPoints = q.points;
          correctCount += 1;
        } else {
          awardedPoints = negPenalty > 0 ? -negPenalty : 0;
          incorrectCount += 1;
        }
      }
    } else {
      // ESSAY, SHORT_ANSWER (without explicit auto rules), PHYSICS_PROBLEM, FILE_UPLOAD, open IMAGE_DIAGRAM
      const hasText = Boolean(ans?.textAnswer && ans.textAnswer.trim().length > 0);
      const hasFile = Boolean(ans?.uploadedFileName && ans.uploadedFileName.trim().length > 0);
      isAnswered = hasText || hasFile;
      if (!isAnswered) {
        unansweredCount += 1;
      }
      needsManualGrading = true;
      hasManualQuestions = true;
      manualPendingCount += 1;
      isCorrect = null;
      awardedPoints = 0;
    }

    rawAutoScore += awardedPoints;
    outcomes.push({
      questionId: q.id,
      isCorrect,
      isAnswered,
      awardedPoints,
      maxPoints: q.points,
      needsManualGrading,
    });

    if (q.lessonId !== null && !needsManualGrading) {
      const bucket = lessonBuckets.get(q.lessonId) || {
        title: q.lessonTitleAr || `الدرس #${q.lessonId}`,
        earned: 0,
        possible: 0,
      };
      bucket.earned += Math.max(0, awardedPoints);
      bucket.possible += q.points;
      lessonBuckets.set(q.lessonId, bucket);
    }
  }

  const autoScore = Math.max(0, Number(rawAutoScore.toFixed(2)));
  const percent = maxScore > 0 ? Math.round((autoScore / maxScore) * 100) : 0;
  const passed = percent >= passScorePercent;

  const lessonAnalytics: LessonPerformanceMetric[] = [];
  for (const [lessonId, b] of lessonBuckets.entries()) {
    const pct = b.possible > 0 ? Math.round((b.earned / b.possible) * 100) : 0;
    const level: LessonPerformanceMetric['level'] =
      pct >= 80 ? 'STRONG' : pct >= 60 ? 'AVERAGE' : 'NEEDS_WORK';
    lessonAnalytics.push({
      lessonId,
      lessonTitleAr: b.title,
      earnedPoints: b.earned,
      possiblePoints: b.possible,
      percent: pct,
      level,
    });
  }

  return {
    autoScore,
    maxScore,
    hasManualQuestions,
    percent,
    passed,
    correctCount,
    incorrectCount,
    unansweredCount,
    manualPendingCount,
    outcomes,
    lessonAnalytics,
  };
}

/**
 * Server-authoritative deadline calculation:
 * expiresAt = min(startedAt + durationMin, exam.endsAt if configured)
 */
export function computeAttemptDeadline(
  startedAt: Date,
  durationMin: number,
  examEndsAt: Date | null | undefined,
): Date {
  const byDuration = new Date(startedAt.getTime() + Math.max(1, durationMin) * 60 * 1000);
  if (examEndsAt && examEndsAt.getTime() < byDuration.getTime()) {
    return new Date(examEndsAt.getTime());
  }
  return byDuration;
}

export function computeRemainingSeconds(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

export function isAttemptExpired(expiresAt: Date, now: Date = new Date(), graceSec = 0): boolean {
  return now.getTime() > expiresAt.getTime() + graceSec * 1000;
}

/**
 * Deterministic Fisher-Yates shuffle (persisted per attempt so reopening preserves order).
 */
export function buildOrderedIds(ids: number[], shuffle: boolean, seedInput?: number): number[] {
  const copy = [...ids];
  if (!shuffle || copy.length <= 1) return copy;

  let seed = seedInput !== undefined ? seedInput : Math.floor(Math.random() * 2147483647);
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface ExamAccessInput {
  isStaff: boolean;
  userStatus: string;
  userId: number;
  approvedGradeIds: number[];
  userGroupIds: number[];
  hasCourseAccess: boolean;
  exam: {
    gradeId: number;
    courseId: number | null;
    publicationStatus: string;
    isPublished: boolean;
    assignmentScope: string; // GRADE | GROUP | STUDENTS
    groupId: number | null;
    assignedUserId: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    maxAttempts: number;
  };
  assignedGroupIds: number[];
  assignedStudentIds: number[];
  attemptsUsed: number;
  hasInProgressAttempt: boolean;
  now?: Date;
}

export interface ExamAccessResult {
  visible: boolean;
  canStart: boolean;
  bucket: 'IN_PROGRESS' | 'AVAILABLE' | 'UPCOMING' | 'COMPLETED' | 'LOCKED' | 'HIDDEN';
  reasonAr: string | null;
}

export function evaluateStudentExamAccess(input: ExamAccessInput): ExamAccessResult {
  const now = input.now || new Date();
  const { exam } = input;

  if (!input.isStaff) {
    if (input.userStatus !== 'ACTIVE') {
      return { visible: false, canStart: false, bucket: 'HIDDEN', reasonAr: 'حسابك بانتظار موافقة المدرس.' };
    }
    if (!input.approvedGradeIds.includes(exam.gradeId)) {
      return { visible: false, canStart: false, bucket: 'HIDDEN', reasonAr: 'هذا الامتحان مخصص لصف دراسي آخر.' };
    }

    const effectivePubStatus = exam.publicationStatus || (exam.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (effectivePubStatus === 'DRAFT' || effectivePubStatus === 'HIDDEN' || effectivePubStatus === 'ARCHIVED') {
      return { visible: false, canStart: false, bucket: 'HIDDEN', reasonAr: 'هذا الامتحان غير منشور حاليًا.' };
    }

    // Assignment scope verification (supports both legacy groupId/assignedUserId and exam_assignments table)
    const scope = exam.assignmentScope || 'GRADE';
    if (scope === 'STUDENTS' || exam.assignedUserId) {
      const allowedStudents = new Set<number>(input.assignedStudentIds);
      if (exam.assignedUserId) allowedStudents.add(exam.assignedUserId);
      if (!allowedStudents.has(input.userId)) {
        return { visible: false, canStart: false, bucket: 'HIDDEN', reasonAr: 'هذا الامتحان مخصص لطلاب محددين.' };
      }
    } else if (scope === 'GROUP' || exam.groupId) {
      const allowedGroups = new Set<number>(input.assignedGroupIds);
      if (exam.groupId) allowedGroups.add(exam.groupId);
      const inGroup = input.userGroupIds.some((gid) => allowedGroups.has(gid));
      if (!inGroup) {
        return { visible: false, canStart: false, bucket: 'HIDDEN', reasonAr: 'هذا الامتحان مخصص لمجموعة دراسية محددة.' };
      }
    }

    // Course entitlement check if exam belongs to a paid course
    if (exam.courseId && !input.hasCourseAccess) {
      return {
        visible: true,
        canStart: false,
        bucket: 'LOCKED',
        reasonAr: 'هذا الامتحان متاح فقط للمشتركين في الكورس المرتبط به.',
      };
    }
  }

  if (input.hasInProgressAttempt) {
    return { visible: true, canStart: true, bucket: 'IN_PROGRESS', reasonAr: null };
  }

  if (exam.startsAt && exam.startsAt.getTime() > now.getTime()) {
    return {
      visible: true,
      canStart: input.isStaff,
      bucket: 'UPCOMING',
      reasonAr: 'لم يحن موعد بدء هذا الامتحان بعد.',
    };
  }

  if (exam.endsAt && exam.endsAt.getTime() < now.getTime()) {
    return {
      visible: true,
      canStart: input.isStaff,
      bucket: 'COMPLETED',
      reasonAr: 'انتهى موعد إتاحة هذا الامتحان.',
    };
  }

  if (!input.isStaff && input.attemptsUsed >= exam.maxAttempts) {
    return {
      visible: true,
      canStart: false,
      bucket: 'COMPLETED',
      reasonAr: `لقد استنفدت عدد المحاولات المسموحة (${exam.maxAttempts}).`,
    };
  }

  return { visible: true, canStart: true, bucket: 'AVAILABLE', reasonAr: null };
}

export interface AnalyticsAttemptRow {
  userId: number;
  status: string;
  totalScore: number;
  maxScore: number;
  passed: boolean;
  pendingManualAnswers: number;
}

export interface ExamAnalyticsSummary {
  totalAssignedStudents: number;
  startedCount: number;
  submittedCount: number;
  notStartedCount: number;
  averageScore: number;
  averagePercent: number;
  highestScore: number;
  lowestScore: number;
  passCount: number;
  failCount: number;
  passRate: number;
  failRate: number;
  pendingManualGradingCount: number;
}

export function computeExamAnalytics(
  totalAssignedStudents: number,
  attempts: AnalyticsAttemptRow[],
): ExamAnalyticsSummary {
  const startedUsers = new Set<number>();
  const submittedUsers = new Set<number>();
  const completedAttempts: AnalyticsAttemptRow[] = [];
  let pendingManualGradingCount = 0;

  for (const a of attempts) {
    startedUsers.add(a.userId);
    if (a.status !== 'IN_PROGRESS') {
      submittedUsers.add(a.userId);
      completedAttempts.push(a);
    }
    if (a.pendingManualAnswers > 0 || a.status === 'AWAITING_MANUAL_GRADING' || a.status === 'SUBMITTED') {
      pendingManualGradingCount += 1;
    }
  }

  const gradedForScores = completedAttempts.filter((a) => a.maxScore > 0);
  const scores = gradedForScores.map((a) => a.totalScore);
  const percents = gradedForScores.map((a) => (a.totalScore / a.maxScore) * 100);

  const averageScore =
    scores.length > 0 ? Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)) : 0;
  const averagePercent =
    percents.length > 0 ? Math.round(percents.reduce((s, v) => s + v, 0) / percents.length) : 0;
  const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

  const finalizedAttempts = completedAttempts.filter((a) => a.status === 'GRADED');
  const passCount = finalizedAttempts.filter((a) => a.passed).length;
  const failCount = finalizedAttempts.length - passCount;
  const passRate = finalizedAttempts.length > 0 ? Math.round((passCount / finalizedAttempts.length) * 100) : 0;
  const failRate = finalizedAttempts.length > 0 ? 100 - passRate : 0;

  return {
    totalAssignedStudents,
    startedCount: startedUsers.size,
    submittedCount: submittedUsers.size,
    notStartedCount: Math.max(0, totalAssignedStudents - startedUsers.size),
    averageScore,
    averagePercent,
    highestScore,
    lowestScore,
    passCount,
    failCount,
    passRate,
    failRate,
    pendingManualGradingCount,
  };
}

const ALLOWED_IMAGE_MIME = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const SAFE_IMAGE_URL = /^(https?:\/\/|\/assets\/|\/src\/assets\/)/i;

export function validateQuestionImageInput(input: string | null | undefined): {
  valid: boolean;
  sanitized: string | null;
  errorAr?: string;
} {
  if (!input || !input.trim()) return { valid: true, sanitized: null };
  const trimmed = input.trim();

  if (trimmed.startsWith('data:')) {
    if (!ALLOWED_IMAGE_MIME.test(trimmed)) {
      return {
        valid: false,
        sanitized: null,
        errorAr: 'صيغة الصورة غير مدعومة. يرجى رفع صورة PNG أو JPG أو WebP أو GIF فقط.',
      };
    }
    // ~2MB binary limit => ~2.8MB base64 string
    if (trimmed.length > 2_800_000) {
      return {
        valid: false,
        sanitized: null,
        errorAr: 'حجم الصورة يتجاوز الحد المسموح (2 ميجابايت). يرجى ضغط الصورة قبل الرفع.',
      };
    }
    return { valid: true, sanitized: trimmed };
  }

  if (SAFE_IMAGE_URL.test(trimmed) && trimmed.length <= 2000) {
    return { valid: true, sanitized: trimmed };
  }

  return {
    valid: false,
    sanitized: null,
    errorAr: 'رابط الصورة غير صالح. أدخل رابط https:// صحيح أو ارفع صورة من جهازك.',
  };
}
