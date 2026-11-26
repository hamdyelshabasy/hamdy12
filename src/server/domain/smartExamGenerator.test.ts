import test from 'node:test';
import assert from 'node:assert/strict';
import type { QuestionType } from '../../types/exams.ts';
import type { QuestionDifficulty } from '../../types/questionBank.ts';
import type { SmartExamBlueprint } from '../../types/smartExamGenerator.ts';
import {
  assignQuestionPoints,
  findReplacementCandidates,
  generateSmartExamDraft,
  percentagesToExactCounts,
  validateSmartExamBlueprint,
  type SmartBankQuestionRecord,
} from './smartExamGenerator.ts';

function makeQuestion(
  id: number,
  overrides: Partial<SmartBankQuestionRecord> = {},
): SmartBankQuestionRecord {
  return {
    id,
    bankCode: `QB-${String(id).padStart(5, '0')}`,
    isBankItem: true,
    approvalStatus: 'APPROVED',
    isArchived: false,
    trackId: 1,
    gradeId: 10,
    unitId: 100,
    lessonId: 1000,
    questionType: 'MCQ',
    difficulty: 'MEDIUM',
    points: 2,
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<SmartExamBlueprint> = {}): SmartExamBlueprint {
  return {
    examType: 'UNIT_EXAM',
    trackId: 1,
    gradeId: 10,
    unitIds: [],
    lessonIds: [],
    questionTypes: [],
    totalQuestions: 5,
    durationMin: 45,
    scoreMode: 'BANK_DEFAULT',
    targetTotalScore: null,
    difficultyDistribution: { mode: 'AUTO', easy: 0, medium: 0, hard: 0 },
    unitDistributionMode: 'AUTO',
    unitDistribution: [],
    excludePreviouslyUsed: false,
    seed: 12345,
    ...overrides,
  };
}

function buildRichPool(): SmartBankQuestionRecord[] {
  const pool: SmartBankQuestionRecord[] = [];
  let id = 1;
  const units = [101, 102, 103];
  const diffs: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
  const types: QuestionType[] = ['MCQ', 'TRUE_FALSE', 'NUMERIC', 'ESSAY', 'PHYSICS_PROBLEM'];

  for (const unitId of units) {
    for (const difficulty of diffs) {
      for (let i = 0; i < 4; i += 1) {
        pool.push(
          makeQuestion(id++, {
            unitId,
            lessonId: unitId * 10 + (i % 2) + 1,
            difficulty,
            questionType: types[(id + i) % types.length],
            points: difficulty === 'EASY' ? 1 : difficulty === 'MEDIUM' ? 2 : 4,
          }),
        );
      }
    }
  }
  return pool; // 3 units * 3 difficulties * 4 = 36 approved questions
}

test('percentagesToExactCounts resolves rounding cleanly using largest remainder', () => {
  const counts = percentagesToExactCounts(
    [
      { key: 'EASY', percent: 33.33 },
      { key: 'MEDIUM', percent: 33.33 },
      { key: 'HARD', percent: 33.34 },
    ],
    10,
  );
  const sum = (counts.get('EASY') || 0) + (counts.get('MEDIUM') || 0) + (counts.get('HARD') || 0);
  assert.equal(sum, 10);
  assert.equal(counts.get('HARD'), 4);
  assert.equal(counts.get('EASY'), 3);
  assert.equal(counts.get('MEDIUM'), 3);
});

test('1. Sufficient pool generates exact requested count with zero duplicates', () => {
  const pool = buildRichPool();
  const res = generateSmartExamDraft(pool, makeBlueprint({ totalQuestions: 12 }), new Set());
  assert.equal(res.ok, true);
  assert.equal(res.selected.length, 12);
  const uniqueIds = new Set(res.selected.map((s) => s.question.id));
  assert.equal(uniqueIds.size, 12);
});

test('2. Insufficient pool returns clear Arabic shortage message and safe suggestions', () => {
  const pool = [
    makeQuestion(1, { difficulty: 'HARD' }),
    makeQuestion(2, { difficulty: 'HARD' }),
    makeQuestion(3, { difficulty: 'EASY' }),
  ];
  const res = generateSmartExamDraft(
    pool,
    makeBlueprint({
      totalQuestions: 5,
      difficultyDistribution: { mode: 'COUNT', easy: 1, medium: 0, hard: 4 },
    }),
    new Set(),
  );
  assert.equal(res.ok, false);
  assert.equal(res.selected.length, 0);
  assert.ok(res.shortages.some((s) => s.code === 'DIFFICULTY' && s.difficulty === 'HARD' && s.available === 2 && s.requested === 4));
  assert.ok(res.errorAr?.includes('المتاح 2 أسئلة صعبة فقط'));
  assert.ok(res.suggestions.some((s) => s.code === 'REDUCE_TOTAL' && s.patch.totalQuestions === 3));
});

test('3. Exact difficulty counts and exact difficulty percentages are enforced strictly', () => {
  const pool = buildRichPool();

  // Count mode
  const resCount = generateSmartExamDraft(
    pool,
    makeBlueprint({
      totalQuestions: 10,
      difficultyDistribution: { mode: 'COUNT', easy: 3, medium: 5, hard: 2 },
    }),
    new Set(),
  );
  assert.equal(resCount.ok, true);
  assert.equal(resCount.selected.filter((x) => x.question.difficulty === 'EASY').length, 3);
  assert.equal(resCount.selected.filter((x) => x.question.difficulty === 'MEDIUM').length, 5);
  assert.equal(resCount.selected.filter((x) => x.question.difficulty === 'HARD').length, 2);

  // Percentage mode (20% / 50% / 30% of 10 = 2 / 5 / 3)
  const resPct = generateSmartExamDraft(
    pool,
    makeBlueprint({
      totalQuestions: 10,
      difficultyDistribution: { mode: 'PERCENT', easy: 20, medium: 50, hard: 30 },
    }),
    new Set(),
  );
  assert.equal(resPct.ok, true);
  assert.equal(resPct.selected.filter((x) => x.question.difficulty === 'EASY').length, 2);
  assert.equal(resPct.selected.filter((x) => x.question.difficulty === 'MEDIUM').length, 5);
  assert.equal(resPct.selected.filter((x) => x.question.difficulty === 'HARD').length, 3);
});

test('4. Unit coverage counts, percentages, and joint Unit x Difficulty Max-Flow feasibility', () => {
  // Asymmetric pool where greedy fails if done naively, but exact max-flow succeeds:
  // Unit 101: 2 EASY, 0 HARD
  // Unit 102: 2 EASY, 2 HARD
  // Want: Unit 101 = 2, Unit 102 = 2 AND EASY = 2, HARD = 2 -> unique valid solution: U101 takes 2 EASY, U102 takes 2 HARD!
  const asymmetricPool: SmartBankQuestionRecord[] = [
    makeQuestion(1, { unitId: 101, difficulty: 'EASY' }),
    makeQuestion(2, { unitId: 101, difficulty: 'EASY' }),
    makeQuestion(3, { unitId: 102, difficulty: 'EASY' }),
    makeQuestion(4, { unitId: 102, difficulty: 'EASY' }),
    makeQuestion(5, { unitId: 102, difficulty: 'HARD' }),
    makeQuestion(6, { unitId: 102, difficulty: 'HARD' }),
  ];

  const res = generateSmartExamDraft(
    asymmetricPool,
    makeBlueprint({
      totalQuestions: 4,
      unitIds: [101, 102],
      difficultyDistribution: { mode: 'COUNT', easy: 2, medium: 0, hard: 2 },
      unitDistributionMode: 'COUNT',
      unitDistribution: [
        { unitId: 101, value: 2 },
        { unitId: 102, value: 2 },
      ],
    }),
    new Set(),
  );

  assert.equal(res.ok, true);
  assert.equal(res.selected.length, 4);
  assert.equal(res.selected.filter((x) => x.question.unitId === 101).length, 2);
  assert.equal(res.selected.filter((x) => x.question.unitId === 102).length, 2);
  assert.equal(res.selected.filter((x) => x.question.difficulty === 'EASY').length, 2);
  assert.equal(res.selected.filter((x) => x.question.difficulty === 'HARD').length, 2);
});

test('5. Joint Unit x Difficulty impossible combination returns COMBINED shortage and AUTO_UNIT_DISTRIBUTION suggestion', () => {
  // Unit 101 has 2 EASY only; Unit 102 has 2 EASY + 1 HARD (total 5).
  // Want Unit 101=2, Unit 102=1 AND HARD=2 -> Unit 102 only requested 1, so max HARD across quotas is 1!
  const pool: SmartBankQuestionRecord[] = [
    makeQuestion(1, { unitId: 101, difficulty: 'EASY' }),
    makeQuestion(2, { unitId: 101, difficulty: 'EASY' }),
    makeQuestion(3, { unitId: 102, difficulty: 'HARD' }),
    makeQuestion(4, { unitId: 102, difficulty: 'HARD' }),
  ];

  const res = generateSmartExamDraft(
    pool,
    makeBlueprint({
      totalQuestions: 3,
      unitIds: [101, 102],
      difficultyDistribution: { mode: 'COUNT', easy: 1, medium: 0, hard: 2 },
      unitDistributionMode: 'COUNT',
      unitDistribution: [
        { unitId: 101, value: 2 },
        { unitId: 102, value: 1 },
      ],
    }),
    new Set(),
  );

  assert.equal(res.ok, false);
  assert.ok(res.shortages.some((s) => s.code === 'COMBINED'));
  assert.ok(res.suggestions.some((s) => s.code === 'AUTO_UNIT_DISTRIBUTION'));
});

test('6. Mixed question types strictly filters to requested types only', () => {
  const pool = buildRichPool();
  const res = generateSmartExamDraft(
    pool,
    makeBlueprint({
      totalQuestions: 6,
      questionTypes: ['MCQ', 'NUMERIC'],
    }),
    new Set(),
  );
  assert.equal(res.ok, true);
  assert.equal(res.selected.length, 6);
  assert.ok(res.selected.every((s) => s.question.questionType === 'MCQ' || s.question.questionType === 'NUMERIC'));
});

test('7 & 8. Strictly excludes DRAFT, PENDING_REVIEW, RETURNED_FOR_EDIT, ARCHIVED, non-bank, and wrong track/grade questions', () => {
  const pool: SmartBankQuestionRecord[] = [
    makeQuestion(1, { approvalStatus: 'APPROVED', isBankItem: true, isArchived: false }),
    makeQuestion(2, { approvalStatus: 'DRAFT' }),
    makeQuestion(3, { approvalStatus: 'PENDING_REVIEW' }),
    makeQuestion(4, { approvalStatus: 'RETURNED_FOR_EDIT' }),
    makeQuestion(5, { approvalStatus: 'APPROVED', isArchived: true }),
    makeQuestion(6, { approvalStatus: 'APPROVED', isBankItem: false }),
    makeQuestion(7, { approvalStatus: 'APPROVED', gradeId: 99 }),
    makeQuestion(8, { approvalStatus: 'APPROVED', trackId: 99 }),
  ];

  const res = generateSmartExamDraft(pool, makeBlueprint({ totalQuestions: 1 }), new Set());
  assert.equal(res.ok, true);
  assert.equal(res.selected.length, 1);
  assert.equal(res.selected[0].question.id, 1);
  assert.equal(res.availability.totalEligible, 1);
});

test('9. Excluding previously used questions enforces exclusion and suggests relaxing when needed', () => {
  const pool = [makeQuestion(1), makeQuestion(2), makeQuestion(3), makeQuestion(4)];
  const used = new Set([1, 2]);

  const okRes = generateSmartExamDraft(
    pool,
    makeBlueprint({ totalQuestions: 2, excludePreviouslyUsed: true }),
    used,
  );
  assert.equal(okRes.ok, true);
  assert.ok(okRes.selected.every((s) => !used.has(s.question.id)));

  const shortRes = generateSmartExamDraft(
    pool,
    makeBlueprint({ totalQuestions: 3, excludePreviouslyUsed: true }),
    used,
  );
  assert.equal(shortRes.ok, false);
  assert.ok(shortRes.suggestions.some((s) => s.code === 'RELAX_EXCLUDE_USED' && s.patch.excludePreviouslyUsed === false));
});

test('10. Single-question replacement ranks closest match first and excludes all in-draft IDs', () => {
  const target = makeQuestion(1, { unitId: 101, lessonId: 1011, difficulty: 'HARD', questionType: 'MCQ', points: 4 });
  const pool = [
    target,
    makeQuestion(2, { unitId: 101, lessonId: 1011, difficulty: 'HARD', questionType: 'MCQ', points: 4 }), // already in draft
    makeQuestion(3, { unitId: 101, lessonId: 1011, difficulty: 'HARD', questionType: 'MCQ', points: 4 }), // perfect match
    makeQuestion(4, { unitId: 101, lessonId: 1012, difficulty: 'HARD', questionType: 'MCQ', points: 4 }), // same unit
    makeQuestion(5, { unitId: 102, lessonId: 1021, difficulty: 'EASY', questionType: 'ESSAY', points: 2 }), // looser match
    makeQuestion(6, { unitId: 101, lessonId: 1011, difficulty: 'HARD', questionType: 'MCQ', approvalStatus: 'PENDING_REVIEW' }), // unapproved
  ];

  const candidates = findReplacementCandidates(pool, target, {
    excludedBankIds: new Set([1, 2]),
    usedBankIds: new Set([4]),
    preferUnused: true,
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].question.id, 3);
  assert.equal(candidates[1].question.id, 4);
  assert.equal(candidates[2].question.id, 5);
  assert.ok(!candidates.some((c) => c.question.id === 1 || c.question.id === 2 || c.question.id === 6));
});

test('11. Regeneration with different seeds produces distinct selections from a rich pool', () => {
  const pool = buildRichPool();
  const r1 = generateSmartExamDraft(pool, makeBlueprint({ totalQuestions: 8, seed: 101 }), new Set());
  const r2 = generateSmartExamDraft(pool, makeBlueprint({ totalQuestions: 8, seed: 99999 }), new Set());
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const ids1 = r1.selected.map((s) => s.question.id).join(',');
  const ids2 = r2.selected.map((s) => s.question.id).join(',');
  assert.notEqual(ids1, ids2);
});

test('12. Target total score distributes integer points summing exactly to requested total', () => {
  const selected = [
    makeQuestion(1, { points: 1 }),
    makeQuestion(2, { points: 2 }),
    makeQuestion(3, { points: 4 }),
  ];
  const scored = assignQuestionPoints(selected, 'TARGET_TOTAL', 20);
  const total = scored.reduce((acc, s) => acc + s.points, 0);
  assert.equal(total, 20);
  assert.ok(scored.every((s) => Number.isInteger(s.points) && s.points >= 1));
  assert.ok(scored[2].points > scored[0].points);
});

test('13. Invalid mathematical blueprints (wrong count sum / percent sum != 100) are rejected cleanly', () => {
  const badDiffSum = validateSmartExamBlueprint(
    makeBlueprint({
      totalQuestions: 10,
      difficultyDistribution: { mode: 'COUNT', easy: 3, medium: 3, hard: 2 },
    }),
  );
  assert.equal(badDiffSum.valid, false);
  assert.ok(badDiffSum.errors[0].includes('مجموع توزيع الصعوبة'));

  const badDiffPct = validateSmartExamBlueprint(
    makeBlueprint({
      totalQuestions: 10,
      difficultyDistribution: { mode: 'PERCENT', easy: 50, medium: 30, hard: 10 },
    }),
  );
  assert.equal(badDiffPct.valid, false);
  assert.ok(badDiffPct.errors[0].includes('100%'));

  const badTargetScore = validateSmartExamBlueprint(
    makeBlueprint({
      totalQuestions: 10,
      scoreMode: 'TARGET_TOTAL',
      targetTotalScore: 5,
    }),
  );
  assert.equal(badTargetScore.valid, false);
});
