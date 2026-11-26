import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderedIds,
  computeAttemptDeadline,
  computeExamAnalytics,
  computeRemainingSeconds,
  evaluateStudentExamAccess,
  gradeExamSubmission,
  isAttemptExpired,
  validateQuestionImageInput,
} from './exams.ts';

test('auto-grades MCQ, True/False, and Numeric with tolerance while flagging Essay for manual grading', () => {
  const summary = gradeExamSubmission(
    [
      {
        id: 1,
        lessonId: 10,
        lessonTitleAr: 'قانون أوم للدائرة المغلقة',
        questionType: 'MCQ',
        points: 4,
        numericAnswer: null,
        numericTolerance: 0,
        correctChoiceIds: [101],
      },
      {
        id: 2,
        lessonId: 10,
        lessonTitleAr: 'قانون أوم للدائرة المغلقة',
        questionType: 'NUMERIC',
        points: 4,
        numericAnswer: 9.8,
        numericTolerance: 0.1,
        correctChoiceIds: [],
      },
      {
        id: 3,
        lessonId: 11,
        lessonTitleAr: 'قانونا كيرشوف',
        questionType: 'TRUE_FALSE',
        points: 2,
        numericAnswer: null,
        numericTolerance: 0,
        correctChoiceIds: [201],
      },
      {
        id: 4,
        lessonId: 11,
        lessonTitleAr: 'قانونا كيرشوف',
        questionType: 'ESSAY',
        points: 5,
        numericAnswer: null,
        numericTolerance: 0,
        correctChoiceIds: [],
      },
    ],
    [
      { questionId: 1, selectedChoiceId: 101 },
      { questionId: 2, numericAnswer: '9.85' },
      { questionId: 3, selectedChoiceId: 202 },
      { questionId: 4, textAnswer: 'نطبق قانون حفظ الشحنة والطاقة...' },
    ],
    50,
  );

  assert.equal(summary.autoScore, 8);
  assert.equal(summary.maxScore, 15);
  assert.equal(summary.hasManualQuestions, true);
  assert.equal(summary.passed, true);
  assert.equal(summary.correctCount, 2);
  assert.equal(summary.incorrectCount, 1);
  assert.equal(summary.unansweredCount, 0);
  assert.equal(summary.manualPendingCount, 1);

  const essayOutcome = summary.outcomes.find((o) => o.questionId === 4);
  assert.equal(essayOutcome?.needsManualGrading, true);
  assert.equal(essayOutcome?.isCorrect, null);

  const ohmAnalytics = summary.lessonAnalytics.find((l) => l.lessonId === 10);
  assert.equal(ohmAnalytics?.level, 'STRONG');
  assert.equal(ohmAnalytics?.percent, 100);

  const kirchhoffAnalytics = summary.lessonAnalytics.find((l) => l.lessonId === 11);
  assert.equal(kirchhoffAnalytics?.level, 'NEEDS_WORK');
  assert.equal(kirchhoffAnalytics?.percent, 0);
});

test('supports Arabic digits in numeric answers, short-answer auto rules vs manual grading, and optional negative marking', () => {
  const summary = gradeExamSubmission(
    [
      {
        id: 10,
        lessonId: 1,
        questionType: 'MCQ',
        points: 4,
        negativePoints: 1,
        numericAnswer: null,
        numericTolerance: 0,
        correctChoiceIds: [1],
      },
      {
        id: 11,
        lessonId: 1,
        questionType: 'MCQ',
        points: 4,
        negativePoints: 1,
        numericAnswer: null,
        numericTolerance: 0,
        correctChoiceIds: [5],
      },
      {
        id: 12,
        lessonId: 1,
        questionType: 'NUMERIC',
        points: 3,
        negativePoints: 0.5,
        numericAnswer: 2.5,
        numericTolerance: 0.05,
        correctChoiceIds: [],
      },
      {
        id: 13,
        lessonId: 1,
        questionType: 'SHORT_ANSWER',
        points: 2,
        numericAnswer: null,
        numericTolerance: 0,
        shortAnswerRules: ['الأمبير', 'امبير'],
        correctChoiceIds: [],
      },
      {
        id: 14,
        lessonId: 1,
        questionType: 'SHORT_ANSWER',
        points: 3,
        numericAnswer: null,
        numericTolerance: 0,
        shortAnswerRules: [], // manual grading when no explicit auto rules
        correctChoiceIds: [],
      },
    ],
    [
      { questionId: 10, selectedChoiceId: 2 }, // wrong => -1 penalty
      // questionId 11 unanswered => 0 (no negative penalty for unanswered)
      { questionId: 12, numericAnswer: '٢,٥٢' }, // Arabic digits & comma => 2.52 within 0.05 => +3
      { questionId: 13, textAnswer: 'الامبير' }, // normalized Arabic alef match => +2
      { questionId: 14, textAnswer: 'شدة التيار تتناسب طرديا مع فرق الجهد' }, // manual
    ],
    50,
    { allowNegativeMarking: true },
  );

  // +3 + 2 - 1 = 4
  assert.equal(summary.autoScore, 4);
  assert.equal(summary.maxScore, 16);
  assert.equal(summary.correctCount, 2);
  assert.equal(summary.incorrectCount, 1);
  assert.equal(summary.unansweredCount, 1);
  assert.equal(summary.manualPendingCount, 1);
  assert.equal(summary.hasManualQuestions, true);
});

test('computes server-authoritative deadline clamped to exam end time and tracks expiry', () => {
  const start = new Date('2026-11-20T10:00:00Z');
  const examEndEarly = new Date('2026-11-20T10:15:00Z');
  const examEndLate = new Date('2026-11-20T12:00:00Z');

  const d1 = computeAttemptDeadline(start, 30, examEndEarly);
  assert.equal(d1.toISOString(), examEndEarly.toISOString());

  const d2 = computeAttemptDeadline(start, 30, examEndLate);
  assert.equal(d2.toISOString(), '2026-11-20T10:30:00.000Z');

  assert.equal(computeRemainingSeconds(d1, new Date('2026-11-20T10:10:00Z')), 300);
  assert.equal(computeRemainingSeconds(d1, new Date('2026-11-20T10:20:00Z')), 0);
  assert.equal(isAttemptExpired(d1, new Date('2026-11-20T10:15:01Z')), true);
  assert.equal(isAttemptExpired(d1, new Date('2026-11-20T10:15:03Z'), 5), false);
});

test('deterministic persisted question/choice shuffle preserves elements and changes order when enabled', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(buildOrderedIds(original, false), original);
  const shuffled1 = buildOrderedIds(original, true, 42);
  const shuffled2 = buildOrderedIds(original, true, 42);
  assert.deepEqual(shuffled1, shuffled2);
  assert.deepEqual([...shuffled1].sort((a, b) => a - b), original);
  assert.notDeepEqual(shuffled1, original);
});

test('enforces student exam access by approval status, grade, assignment scope, course entitlement, and schedule', () => {
  const baseExam = {
    gradeId: 3,
    courseId: null as number | null,
    publicationStatus: 'PUBLISHED',
    isPublished: true,
    assignmentScope: 'GRADE',
    groupId: null,
    assignedUserId: null,
    startsAt: null as Date | null,
    endsAt: null as Date | null,
    maxAttempts: 2,
  };

  // Pending student blocked
  const pending = evaluateStudentExamAccess({
    isStaff: false,
    userStatus: 'PENDING_APPROVAL',
    userId: 9,
    approvedGradeIds: [3],
    userGroupIds: [],
    hasCourseAccess: true,
    exam: baseExam,
    assignedGroupIds: [],
    assignedStudentIds: [],
    attemptsUsed: 0,
    hasInProgressAttempt: false,
  });
  assert.equal(pending.visible, false);

  // Wrong grade blocked
  const wrongGrade = evaluateStudentExamAccess({
    isStaff: false,
    userStatus: 'ACTIVE',
    userId: 9,
    approvedGradeIds: [1],
    userGroupIds: [],
    hasCourseAccess: true,
    exam: baseExam,
    assignedGroupIds: [],
    assignedStudentIds: [],
    attemptsUsed: 0,
    hasInProgressAttempt: false,
  });
  assert.equal(wrongGrade.visible, false);

  // Specific students assignment restricts others
  const notAssigned = evaluateStudentExamAccess({
    isStaff: false,
    userStatus: 'ACTIVE',
    userId: 9,
    approvedGradeIds: [3],
    userGroupIds: [],
    hasCourseAccess: true,
    exam: { ...baseExam, assignmentScope: 'STUDENTS' },
    assignedGroupIds: [],
    assignedStudentIds: [12, 15],
    attemptsUsed: 0,
    hasInProgressAttempt: false,
  });
  assert.equal(notAssigned.visible, false);

  // Course-restricted exam shows locked when unpaid
  const lockedCourse = evaluateStudentExamAccess({
    isStaff: false,
    userStatus: 'ACTIVE',
    userId: 9,
    approvedGradeIds: [3],
    userGroupIds: [],
    hasCourseAccess: false,
    exam: { ...baseExam, courseId: 5 },
    assignedGroupIds: [],
    assignedStudentIds: [],
    attemptsUsed: 0,
    hasInProgressAttempt: false,
  });
  assert.equal(lockedCourse.visible, true);
  assert.equal(lockedCourse.canStart, false);
  assert.equal(lockedCourse.bucket, 'LOCKED');

  // Scheduled future exam appears under UPCOMING
  const upcoming = evaluateStudentExamAccess({
    isStaff: false,
    userStatus: 'ACTIVE',
    userId: 9,
    approvedGradeIds: [3],
    userGroupIds: [],
    hasCourseAccess: true,
    exam: { ...baseExam, startsAt: new Date(Date.now() + 3600_000) },
    assignedGroupIds: [],
    assignedStudentIds: [],
    attemptsUsed: 0,
    hasInProgressAttempt: false,
  });
  assert.equal(upcoming.bucket, 'UPCOMING');
  assert.equal(upcoming.canStart, false);
});

test('computes accurate exam analytics from real attempts and validates question image uploads', () => {
  const analytics = computeExamAnalytics(10, [
    { userId: 1, status: 'GRADED', totalScore: 18, maxScore: 20, passed: true, pendingManualAnswers: 0 },
    { userId: 2, status: 'GRADED', totalScore: 10, maxScore: 20, passed: false, pendingManualAnswers: 0 },
    { userId: 3, status: 'AWAITING_MANUAL_GRADING', totalScore: 8, maxScore: 20, passed: false, pendingManualAnswers: 1 },
    { userId: 4, status: 'IN_PROGRESS', totalScore: 0, maxScore: 20, passed: false, pendingManualAnswers: 0 },
  ]);

  assert.equal(analytics.totalAssignedStudents, 10);
  assert.equal(analytics.startedCount, 4);
  assert.equal(analytics.submittedCount, 3);
  assert.equal(analytics.notStartedCount, 6);
  assert.equal(analytics.highestScore, 18);
  assert.equal(analytics.lowestScore, 8);
  assert.equal(analytics.averageScore, 12);
  assert.equal(analytics.passRate, 50);
  assert.equal(analytics.failRate, 50);
  assert.equal(analytics.pendingManualGradingCount, 1);

  assert.equal(validateQuestionImageInput('data:image/png;base64,iVBORw0KGgo=').valid, true);
  assert.equal(validateQuestionImageInput('https://example.com/circuit.png').valid, true);
  assert.equal(validateQuestionImageInput('javascript:alert(1)').valid, false);
  assert.equal(validateQuestionImageInput('data:text/html;base64,PHNjcmlwdD4=').valid, false);
});
