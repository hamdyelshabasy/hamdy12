import test from 'node:test';
import assert from 'node:assert/strict';
import type { AdminExamQuestion } from '../../types/exams.ts';
import {
  canActorAccessWizardDraft,
  isStaleDraftWrite,
  resolveEffectivePublishStatus,
  summarizeWizardQuestions,
  validateExamWizardDraft,
  validateExamWizardSettings,
  validateExamWizardStep1,
} from './examWizard.ts';

function makeQuestion(overrides: Partial<AdminExamQuestion> = {}): AdminExamQuestion {
  return {
    id: 101,
    sortOrder: 1,
    questionType: 'MCQ',
    difficulty: 'MEDIUM',
    promptAr: 'احسب شدة التيار في دائرة مغلقة',
    latexFormula: null,
    imageUrl: null,
    points: 4,
    negativePoints: 0,
    numericAnswer: '',
    numericTolerance: '0.05',
    numericUnit: '',
    shortAnswerRules: [],
    modelAnswerAr: '',
    explanationAr: '',
    unitId: 1,
    lessonId: 1,
    sourceBankQuestionId: null,
    choices: [
      { labelAr: '2 أمبير', isCorrect: true },
      { labelAr: '4 أمبير', isCorrect: false },
    ],
    ...overrides,
  };
}

test('validateExamWizardStep1 enforces title length and grade selection', () => {
  assert.equal(validateExamWizardStep1({ titleAr: 'اب', gradeId: 1 }).valid, false);
  assert.equal(validateExamWizardStep1({ titleAr: 'امتحان الوحدة الأولى', gradeId: 0 }).valid, false);
  assert.equal(validateExamWizardStep1({ titleAr: 'امتحان الوحدة الأولى', gradeId: 3 }).valid, true);
});

test('validateExamWizardSettings validates duration, pass score, date range, and targeting', () => {
  const base = {
    durationMin: 45,
    totalMarks: 20,
    passScorePercent: 60,
    maxAttempts: 2,
    startsAt: '2026-12-01T10:00:00Z',
    endsAt: '2026-12-01T12:00:00Z',
    assignmentScope: 'GRADE',
    assignedGroupIds: [],
    assignedStudentIds: [],
  };
  assert.equal(validateExamWizardSettings(base).valid, true);

  // Invalid date range (end <= start)
  assert.equal(
    validateExamWizardSettings({ ...base, endsAt: '2026-12-01T09:00:00Z' }).valid,
    false,
  );
  // Missing groups when scope = GROUP
  assert.equal(
    validateExamWizardSettings({ ...base, assignmentScope: 'GROUP', assignedGroupIds: [] }).valid,
    false,
  );
  assert.equal(
    validateExamWizardSettings({ ...base, assignmentScope: 'GROUP', assignedGroupIds: [5] }).valid,
    true,
  );
  // Missing students when scope = STUDENTS
  assert.equal(
    validateExamWizardSettings({ ...base, assignmentScope: 'STUDENTS', assignedStudentIds: [] })
      .valid,
    false,
  );
});

test('summarizeWizardQuestions distinguishes bank vs manual questions and detects duplicate bank sources', () => {
  const summary = summarizeWizardQuestions([
    makeQuestion({ id: 1, points: 3, sourceBankQuestionId: 10 }),
    makeQuestion({ id: 2, points: 5, sourceBankQuestionId: null }),
    makeQuestion({ id: 3, points: 2, sourceBankQuestionId: 10 }),
  ]);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.bankCount, 2);
  assert.equal(summary.manualCount, 1);
  assert.equal(summary.calculatedMarks, 10);
  assert.deepEqual(summary.duplicateBankQuestionIds, [10]);
});

test('validateExamWizardDraft blocks publishing with missing questions, missing correct answer, or invalid numeric answer', () => {
  const baseExam = {
    titleAr: 'امتحان الفصل الأول',
    gradeId: 1,
    durationMin: 30,
    totalMarks: 4,
    passScorePercent: 60,
    maxAttempts: 2,
    startsAt: null,
    endsAt: null,
    assignmentScope: 'GRADE',
    assignedGroupIds: [],
    assignedStudentIds: [],
  };

  // Empty questions -> blocked
  const emptyRes = validateExamWizardDraft(baseExam, []);
  assert.equal(emptyRes.isReadyToPublish, false);
  assert.equal(emptyRes.errors.some((e) => e.code === 'NO_QUESTIONS'), true);

  // MCQ missing correct answer -> blocked
  const noCorrect = validateExamWizardDraft(baseExam, [
    makeQuestion({
      choices: [
        { labelAr: 'أ', isCorrect: false },
        { labelAr: 'ب', isCorrect: false },
      ],
    }),
  ]);
  assert.equal(noCorrect.isReadyToPublish, false);
  assert.equal(noCorrect.errors.some((e) => e.code === 'MISSING_CORRECT_CHOICE'), true);

  // Numeric question missing numeric answer -> blocked
  const badNum = validateExamWizardDraft(baseExam, [
    makeQuestion({ questionType: 'NUMERIC', numericAnswer: '' }),
  ]);
  assert.equal(badNum.isReadyToPublish, false);
  assert.equal(badNum.errors.some((e) => e.code === 'MISSING_NUMERIC_ANSWER'), true);

  // Valid exam with marks mismatch warning -> ready to publish with warning
  const validWithWarn = validateExamWizardDraft(
    { ...baseExam, totalMarks: 10 },
    [makeQuestion({ points: 4 })],
    { hasUnsavedChanges: true },
  );
  assert.equal(validWithWarn.isReadyToPublish, true);
  assert.equal(validWithWarn.warnings.some((w) => w.code === 'MARKS_MISMATCH'), true);
  assert.equal(validWithWarn.warnings.some((w) => w.code === 'UNSAVED_CHANGES'), true);
});

test('isStaleDraftWrite detects concurrent edits and protects newer saves from stale overwrites', () => {
  const serverTime = new Date('2026-11-22T12:00:10.000Z');
  assert.equal(isStaleDraftWrite(serverTime, '2026-11-22T12:00:10.000Z'), false);
  assert.equal(isStaleDraftWrite(serverTime, '2026-11-22T12:00:10.400Z'), false); // within 1s tolerance
  assert.equal(isStaleDraftWrite(serverTime, '2026-11-22T12:00:00.000Z'), true); // stale!
  assert.equal(isStaleDraftWrite(serverTime, null), false);
});

test('resolveEffectivePublishStatus chooses SCHEDULED for future start dates and PUBLISHED otherwise', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.equal(resolveEffectivePublishStatus(null, now), 'PUBLISHED');
  assert.equal(resolveEffectivePublishStatus(new Date('2026-11-22T11:00:00Z'), now), 'PUBLISHED');
  assert.equal(resolveEffectivePublishStatus(new Date('2026-11-23T12:00:00Z'), now), 'SCHEDULED');
});

test('canActorAccessWizardDraft enforces cross-account draft isolation for non-SUPER_ADMIN', () => {
  assert.equal(
    canActorAccessWizardDraft({ actorRoleSlug: 'SUPER_ADMIN', actorId: 1, creatorActorId: 9 }),
    true,
  );
  assert.equal(
    canActorAccessWizardDraft({ actorRoleSlug: 'CONTENT_MANAGER', actorId: 9, creatorActorId: 9 }),
    true,
  );
  assert.equal(
    canActorAccessWizardDraft({ actorRoleSlug: 'CONTENT_MANAGER', actorId: 9, creatorActorId: 1 }),
    false,
  );
  assert.equal(
    canActorAccessWizardDraft({ actorRoleSlug: 'CONTENT_MANAGER', actorId: 9, creatorActorId: null }),
    false,
  );
});
