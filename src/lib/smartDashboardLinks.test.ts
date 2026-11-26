import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAcademicStatTarget,
  pickBestExamForAttempts,
  pickBestHomeworkForSubmissions,
} from './smartDashboardLinks';
import { DEFAULT_ROLE_PERMISSIONS } from './permissions';

const ownerUser = {
  roleSlug: 'SUPER_ADMIN',
  status: 'ACTIVE',
  permissions: DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN,
};

const supportUser = {
  roleSlug: 'SUPPORT',
  status: 'ACTIVE',
  permissions: DEFAULT_ROLE_PERMISSIONS.SUPPORT,
};

test('buildAcademicStatTarget resolves deep-link targets for authorized teacher/owner and blocks unauthorized roles', () => {
  assert.deepEqual(buildAcademicStatTarget('homework_submissions', ownerUser), {
    tab: 'homework',
    homeworkStatusFilter: 'ALL',
    homeworkAction: 'OPEN_SUBMISSIONS',
  });

  assert.deepEqual(buildAcademicStatTarget('exam_attempts', ownerUser), {
    tab: 'exams',
    examStatusFilter: 'ALL',
    examAction: 'OPEN_ATTEMPTS',
  });

  assert.deepEqual(buildAcademicStatTarget('approved_questions', ownerUser), {
    tab: 'question_bank',
    questionBankStatusTab: 'APPROVED',
    questionBankAction: 'NONE',
  });

  // SUPPORT cannot access homework, exams, or question bank
  assert.equal(buildAcademicStatTarget('homework_submissions', supportUser), null);
  assert.equal(buildAcademicStatTarget('exam_attempts', supportUser), null);
  assert.equal(buildAcademicStatTarget('approved_questions', supportUser), null);
  assert.equal(buildAcademicStatTarget('homework_submissions', null), null);
});

test('pickBestHomeworkForSubmissions prioritizes awaitingReviewCount, then submittedCount, then null', () => {
  assert.equal(pickBestHomeworkForSubmissions([]), null);
  assert.equal(
    pickBestHomeworkForSubmissions([
      { id: 1, stats: { submittedCount: 0, awaitingReviewCount: 0 } },
    ]),
    null,
  );
  assert.equal(
    pickBestHomeworkForSubmissions([
      { id: 1, stats: { submittedCount: 10, awaitingReviewCount: 0 } },
      { id: 2, stats: { submittedCount: 4, awaitingReviewCount: 2 } },
      { id: 3, stats: { submittedCount: 6, awaitingReviewCount: 5 } },
    ]),
    3,
  );
  assert.equal(
    pickBestHomeworkForSubmissions([
      { id: 1, stats: { submittedCount: 3, awaitingReviewCount: 0 } },
      { id: 2, stats: { submittedCount: 9, awaitingReviewCount: 0 } },
    ]),
    2,
  );
});

test('pickBestExamForAttempts prioritizes pendingManualCount, then submittedCount, then attemptsCount, then null', () => {
  assert.equal(pickBestExamForAttempts([]), null);
  assert.equal(
    pickBestExamForAttempts([
      { id: 10, attemptsCount: 0, submittedCount: 0, pendingManualCount: 0 },
    ]),
    null,
  );
  assert.equal(
    pickBestExamForAttempts([
      { id: 10, attemptsCount: 12, submittedCount: 12, pendingManualCount: 0 },
      { id: 11, attemptsCount: 5, submittedCount: 5, pendingManualCount: 3 },
      { id: 12, attemptsCount: 7, submittedCount: 6, pendingManualCount: 4 },
    ]),
    12,
  );
  assert.equal(
    pickBestExamForAttempts([
      { id: 10, attemptsCount: 4, submittedCount: 2, pendingManualCount: 0 },
      { id: 11, attemptsCount: 8, submittedCount: 7, pendingManualCount: 0 },
    ]),
    11,
  );
  assert.equal(
    pickBestExamForAttempts([
      { id: 10, attemptsCount: 2, submittedCount: 0, pendingManualCount: 0 },
      { id: 11, attemptsCount: 5, submittedCount: 0, pendingManualCount: 0 },
    ]),
    11,
  );
});
