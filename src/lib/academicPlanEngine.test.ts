import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAcademicAdherence,
  computeAcademicProgression,
  evaluateCurriculumTask,
  evaluateWeekSummary,
  generateCurriculumWeekRanges,
  resolveCurrentCurriculumWeek,
  type CurriculumPlanRecord,
  type CurriculumWeekRecord,
  type StudentAcademicSignals,
} from './academicPlanEngine.ts';
import {
  buildHomeworkQuestionSnapshot,
  sanitizeHomeworkChoicesForStudent,
  validateHomeworkStructuredAnswers,
} from '../server/domain/questionBank.ts';
import { buildHashForNavState, parseHashToNavState } from './navigationHistory.ts';

function createEmptySignals(): StudentAcademicSignals {
  return {
    videosById: {},
    homeworkById: {},
    examsById: {},
    pdfsById: {},
    coursesById: {},
    scheduleById: {},
    manualReviewedTaskIds: {},
  };
}

test('generateCurriculumWeekRanges creates sequential 7-day Cairo ranges', () => {
  const ranges = generateCurriculumWeekRanges('2026-11-01', 3);
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges[0], {
    weekNumber: 1,
    titleAr: 'الأسبوع 1',
    startDate: '2026-11-01',
    endDate: '2026-11-07',
  });
  assert.deepEqual(ranges[1], {
    weekNumber: 2,
    titleAr: 'الأسبوع 2',
    startDate: '2026-11-08',
    endDate: '2026-11-14',
  });
  assert.deepEqual(ranges[2], {
    weekNumber: 3,
    titleAr: 'الأسبوع 3',
    startDate: '2026-11-15',
    endDate: '2026-11-21',
  });
});

test('resolveCurrentCurriculumWeek prioritizes active/matching date week', () => {
  const weeks: CurriculumWeekRecord[] = [
    {
      id: 1,
      planId: 10,
      weekNumber: 1,
      titleAr: 'الأسبوع 1',
      descriptionAr: '',
      objectivesAr: '',
      teacherNotesAr: '',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      status: 'COMPLETED',
      displayOrder: 0,
      unitIds: [],
      lessonIds: [],
      tasks: [],
    },
    {
      id: 2,
      planId: 10,
      weekNumber: 2,
      titleAr: 'الأسبوع 2',
      descriptionAr: '',
      objectivesAr: '',
      teacherNotesAr: '',
      startDate: '2026-11-20',
      endDate: '2026-11-26',
      status: 'ACTIVE',
      displayOrder: 1,
      unitIds: [],
      lessonIds: [],
      tasks: [],
    },
  ];
  const resolved = resolveCurrentCurriculumWeek(weeks, new Date('2026-11-24T12:00:00Z'));
  assert.equal(resolved?.id, 2);
});

test('evaluateWeekSummary uses required tasks as denominator and optional tasks do not block 100%', () => {
  const week: CurriculumWeekRecord = {
    id: 2,
    planId: 10,
    weekNumber: 2,
    titleAr: 'الأسبوع 2',
    descriptionAr: '',
    objectivesAr: '',
    teacherNotesAr: '',
    startDate: '2026-11-20',
    endDate: '2026-11-28',
    status: 'ACTIVE',
    displayOrder: 1,
    unitIds: [],
    lessonIds: [],
    tasks: [
      {
        id: 101,
        weekId: 2,
        taskType: 'VIDEO',
        entityId: 50,
        titleAr: 'محاضرة قانون أوم',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 0,
        availableAt: null,
        dueAt: '2026-11-27T20:00:00Z',
      },
      {
        id: 102,
        weekId: 2,
        taskType: 'HOMEWORK',
        entityId: 60,
        titleAr: 'واجب قانون أوم',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 1,
        availableAt: null,
        dueAt: '2026-11-28T20:00:00Z',
      },
      {
        id: 103,
        weekId: 2,
        taskType: 'PDF',
        entityId: 70,
        titleAr: 'ملخص إضافي اختياري',
        instructionsAr: '',
        isRequired: false,
        displayOrder: 2,
        availableAt: null,
        dueAt: null,
      },
    ],
  };

  const signals = createEmptySignals();
  signals.videosById[50] = {
    id: 50,
    titleAr: 'محاضرة قانون أوم',
    percentComplete: 100,
    isCompleted: true,
    updatedAt: '2026-11-24T10:00:00Z',
  };
  signals.homeworkById[60] = {
    id: 60,
    titleAr: 'واجب قانون أوم',
    deadline: '2026-11-28T20:00:00Z',
    statusCode: 'SUBMITTED',
    submittedVersionsCount: 1,
    latestSubmittedAt: '2026-11-24T11:00:00Z',
  };
  signals.pdfsById[70] = {
    id: 70,
    titleAr: 'ملخص إضافي اختياري',
    hasPdf: true,
  };

  const summary = evaluateWeekSummary(week, signals, new Date('2026-11-24T12:00:00Z'));
  assert.equal(summary.requiredTotal, 2);
  assert.equal(summary.requiredCompleted, 2);
  assert.equal(summary.completionPercent, 100);
  assert.equal(summary.isAllRequiredDone, true);
  assert.equal(summary.optionalTotal, 1);
  assert.equal(summary.optionalCompleted, 0);
});

test('computeAcademicProgression follows Videos -> Homework -> Exams -> Completed sequence and respects future exam date', () => {
  const week: CurriculumWeekRecord = {
    id: 2,
    planId: 10,
    weekNumber: 2,
    titleAr: 'الأسبوع 2',
    descriptionAr: '',
    objectivesAr: '',
    teacherNotesAr: '',
    startDate: '2026-11-20',
    endDate: '2026-11-28',
    status: 'ACTIVE',
    displayOrder: 0,
    unitIds: [],
    lessonIds: [],
    tasks: [
      {
        id: 1,
        weekId: 2,
        taskType: 'VIDEO',
        entityId: 10,
        titleAr: 'فيديو 1',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 0,
        availableAt: null,
        dueAt: null,
      },
      {
        id: 2,
        weekId: 2,
        taskType: 'HOMEWORK',
        entityId: 20,
        titleAr: 'واجب 1',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 1,
        availableAt: null,
        dueAt: null,
      },
      {
        id: 3,
        weekId: 2,
        taskType: 'EXAM',
        entityId: 30,
        titleAr: 'امتحان الأسبوع',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 2,
        availableAt: '2026-11-26T16:00:00Z',
        dueAt: '2026-11-27T16:00:00Z',
      },
    ],
  };

  const plan: CurriculumPlanRecord = {
    id: 10,
    titleAr: 'خطة الفيزياء 3ث',
    trackId: 1,
    gradeId: 3,
    academicYearAr: '2026-2027',
    descriptionAr: '',
    startDate: '2026-11-20',
    endDate: '2026-12-20',
    totalWeeks: 4,
    status: 'PUBLISHED',
    publishedAt: '2026-11-19T00:00:00Z',
    weeks: [week],
  };

  const now = new Date('2026-11-24T12:00:00Z');
  const signals = createEmptySignals();
  signals.videosById[10] = { id: 10, titleAr: 'فيديو 1', percentComplete: 40, isCompleted: false };
  signals.homeworkById[20] = { id: 20, titleAr: 'واجب 1', deadline: null, statusCode: 'NOT_STARTED' };
  signals.examsById[30] = {
    id: 30,
    titleAr: 'امتحان الأسبوع',
    durationMinutes: 30,
    startsAt: '2026-11-26T16:00:00Z',
    endsAt: '2026-11-27T16:00:00Z',
    statusCode: 'UPCOMING',
  };

  // Step 1: Video is incomplete -> stage VIDEOS
  let ws = evaluateWeekSummary(week, signals, now);
  let prog = computeAcademicProgression(plan, ws);
  assert.equal(prog.stageKey, 'VIDEOS');
  assert.equal(prog.recommendedTask?.task.id, 1);

  // Step 2: Complete video -> stage HOMEWORK
  signals.videosById[10].isCompleted = true;
  signals.videosById[10].percentComplete = 100;
  ws = evaluateWeekSummary(week, signals, now);
  prog = computeAcademicProgression(plan, ws);
  assert.equal(prog.stageKey, 'HOMEWORK');
  assert.equal(prog.recommendedTask?.task.id, 2);

  // Step 3: Submit homework -> stage EXAMS (future exam shows countdown target, never starts early)
  signals.homeworkById[20].statusCode = 'SUBMITTED';
  signals.homeworkById[20].submittedVersionsCount = 1;
  ws = evaluateWeekSummary(week, signals, now);
  prog = computeAcademicProgression(plan, ws);
  assert.equal(prog.stageKey, 'EXAMS');
  assert.equal(prog.recommendedTask?.task.id, 3);
  assert.equal(prog.countdownTargetIso, '2026-11-26T16:00:00Z');
  assert.equal(prog.recommendedTask?.isFuture, true);

  // Step 4: Complete exam -> stage COMPLETED
  signals.examsById[30].statusCode = 'COMPLETED';
  signals.examsById[30].attemptsUsed = 1;
  ws = evaluateWeekSummary(week, signals, now);
  prog = computeAcademicProgression(plan, ws);
  assert.equal(prog.stageKey, 'COMPLETED');
  assert.equal(prog.recommendedTask, null);
});

test('computeAcademicAdherence returns neutral state when no plan exists and never fabricates previous-week comparison', () => {
  const empty = computeAcademicAdherence(null, [], null);
  assert.equal(empty.hasPlan, false);
  assert.equal(empty.onTimeAdherencePercent, null);
  assert.equal(empty.previousWeekDelta, null);
  assert.equal(empty.statusTone, 'NEUTRAL');

  // Single week plan: previousWeekDelta must be null
  const w1: CurriculumWeekRecord = {
    id: 1,
    planId: 10,
    weekNumber: 1,
    titleAr: 'الأسبوع 1',
    descriptionAr: '',
    objectivesAr: '',
    teacherNotesAr: '',
    startDate: '2026-11-20',
    endDate: '2026-11-26',
    status: 'ACTIVE',
    displayOrder: 0,
    unitIds: [],
    lessonIds: [],
    tasks: [
      {
        id: 1,
        weekId: 1,
        taskType: 'PDF',
        entityId: null,
        titleAr: 'مراجعة مذكرة 1',
        instructionsAr: '',
        isRequired: true,
        displayOrder: 0,
        availableAt: null,
        dueAt: '2026-11-22T20:00:00Z', // overdue as of Nov 24
      },
    ],
  };
  const plan: CurriculumPlanRecord = {
    id: 10,
    titleAr: 'خطة',
    trackId: 1,
    gradeId: 1,
    academicYearAr: '2026',
    descriptionAr: '',
    startDate: '2026-11-20',
    endDate: '2026-11-26',
    totalWeeks: 1,
    status: 'PUBLISHED',
    publishedAt: null,
    weeks: [w1],
  };
  const ws1 = evaluateWeekSummary(w1, createEmptySignals(), new Date('2026-11-24T12:00:00Z'));
  const adh = computeAcademicAdherence(plan, [ws1], ws1);
  assert.equal(adh.previousWeekDelta, null);
  assert.equal(adh.overdueRequiredCount, 1);
  assert.equal(adh.onTimeAdherencePercent, 0);
  assert.equal(adh.statusTone, 'ATTENTION');
});

test('Homework MCQ snapshot preserves choices, strips isCorrect for students, and validates structured answers', () => {
  const snap = buildHomeworkQuestionSnapshot({
    bankQuestion: {
      id: 42,
      bankCode: 'QB-0042',
      version: 2,
      questionType: 'MCQ',
      promptAr: 'ما وحدة قياس شدة التيار؟',
      modelAnswerAr: 'الأمبير',
      explanationAr: 'I = Q / t',
      points: 2,
    },
    questionImages: [],
    modelAnswerFiles: [],
    choices: [
      { id: 101, labelAr: 'الأمبير', isCorrect: true, sortOrder: 0 },
      { id: 102, labelAr: 'الفولت', isCorrect: false, sortOrder: 1 },
      { id: 103, labelAr: 'الأوم', isCorrect: false, sortOrder: 2 },
    ],
    questionNumber: 1,
  });

  assert.equal(snap.choicesSnapshotJson.length, 3);
  assert.equal(snap.choicesSnapshotJson[0].isCorrect, true);

  // Student view before model answer release must NEVER leak isCorrect
  const studentSafe = sanitizeHomeworkChoicesForStudent(snap.choicesSnapshotJson, false);
  assert.equal(studentSafe.length, 3);
  assert.equal('isCorrect' in studentSafe[0], false);

  // Released model answer includes isCorrect
  const released = sanitizeHomeworkChoicesForStudent(snap.choicesSnapshotJson, true);
  assert.equal(released[0].isCorrect, true);

  // Validate structured answer
  const okRes = validateHomeworkStructuredAnswers(
    [{ id: 9, questionType: 'MCQ', choicesSnapshotJson: snap.choicesSnapshotJson }],
    [{ questionId: 9, selectedChoiceId: '101' }],
  );
  assert.equal(okRes.valid, true);
  assert.equal(okRes.answeredCount, 1);

  const badChoice = validateHomeworkStructuredAnswers(
    [{ id: 9, questionType: 'MCQ', choicesSnapshotJson: snap.choicesSnapshotJson }],
    [{ questionId: 9, selectedChoiceId: '99999' }],
  );
  assert.equal(badChoice.valid, false);
});

test('navigationHistory builds and parses deep student & admin hashes accurately', () => {
  const hash = buildHashForNavState({
    __lmsNav: true,
    screen: 'dashboard',
    studentTab: 'curriculum',
    curriculumWeekId: 5,
    curriculumFilter: 'OVERDUE',
  });
  assert.equal(hash, '#student/curriculum?week=5&filter=OVERDUE');
  const parsed = parseHashToNavState(hash);
  assert.equal(parsed?.screen, 'dashboard');
  assert.equal(parsed?.studentTab, 'curriculum');
  assert.equal(parsed?.curriculumWeekId, 5);
  assert.equal(parsed?.curriculumFilter, 'OVERDUE');
});
