import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTodayPlan,
  buildWeeklyAgenda,
  computeLessonProgressCounts,
  computePublishedResultsAndAverage,
  computeStudyStreakFromDates,
  formatUpcomingDateBadge,
  searchStudentContent,
} from './studentDashboardMetrics.ts';
import type { StudentDashboardData, StudentVideoItem } from '../types/lms.ts';

function makeVideo(overrides: Partial<StudentVideoItem> = {}): StudentVideoItem {
  return {
    id: 1,
    trackId: 1,
    trackNameAr: 'البكالوريا',
    lessonId: 10,
    lessonTitleAr: 'قانون أوم',
    unitId: 1,
    unitTitleAr: 'الوحدة الأولى: الكهربية',
    gradeId: 3,
    courseId: null,
    courseTitleAr: null,
    titleAr: 'شرح قانون أوم للدائرة المغلقة',
    descriptionAr: '',
    durationSec: 1800,
    thumbnailUrl: '',
    videoType: 'FREE',
    priceEgp: 0,
    sortOrder: 1,
    hasYouTubeVideo: true,
    allowSpeedChange: true,
    maxPlaybackSpeed: 2,
    viewsCount: 10,
    hasAccess: true,
    accessReason: 'FREE',
    lockReasonAr: null,
    accessSource: null,
    accessExpiresAt: null,
    progress: {
      lastPositionSec: 0,
      watchedSec: 0,
      completionPercent: 0,
      isCompleted: false,
      updatedAt: null,
    },
    ...overrides,
  };
}

test('computeLessonProgressCounts calculates completed, inProgress, remaining, and percent accurately', () => {
  const empty = computeLessonProgressCounts([]);
  assert.deepEqual(empty, { completed: 0, inProgress: 0, remaining: 0, total: 0, percent: 0 });

  const videos = [
    makeVideo({ id: 1, progress: { lastPositionSec: 1800, watchedSec: 1800, completionPercent: 100, isCompleted: true, updatedAt: '2026-11-20T10:00:00Z' } }),
    makeVideo({ id: 2, progress: { lastPositionSec: 900, watchedSec: 900, completionPercent: 50, isCompleted: false, updatedAt: '2026-11-21T10:00:00Z' } }),
    makeVideo({ id: 3, progress: { lastPositionSec: 0, watchedSec: 0, completionPercent: 0, isCompleted: false, updatedAt: null } }),
    makeVideo({ id: 4, hasAccess: false, progress: { lastPositionSec: 0, watchedSec: 0, completionPercent: 0, isCompleted: false, updatedAt: null } }),
  ];

  const stats = computeLessonProgressCounts(videos);
  assert.equal(stats.total, 3);
  assert.equal(stats.completed, 1);
  assert.equal(stats.inProgress, 1);
  assert.equal(stats.remaining, 1);
  assert.equal(stats.percent, 50);
});

test('computePublishedResultsAndAverage strictly excludes unpublished attempts and ungraded homework', () => {
  const res = computePublishedResultsAndAverage(
    [
      {
        id: 1,
        examId: 10,
        examTitleAr: 'امتحان الوحدة الأولى',
        status: 'GRADED',
        totalScore: 18,
        maxScore: 20,
        passed: true,
        resultPublished: true,
        submittedAt: '2026-11-22T10:00:00Z',
      },
      {
        id: 2,
        examId: 11,
        examTitleAr: 'امتحان غير منشور',
        status: 'GRADED',
        totalScore: 5,
        maxScore: 20,
        passed: false,
        resultPublished: false,
        submittedAt: '2026-11-23T10:00:00Z',
      },
    ],
    [
      {
        id: 50,
        titleAr: 'واجب التيار الكهربي',
        deadline: null,
        maximumGrade: 10,
        submissionStatus: 'GRADED',
        awardedGrade: 8,
        isGradePublished: true,
        submittedAt: '2026-11-21T10:00:00Z',
        gradedAt: '2026-11-21T12:00:00Z',
      },
      {
        id: 51,
        titleAr: 'واجب لم تُنشر درجته',
        deadline: null,
        maximumGrade: 10,
        submissionStatus: 'GRADED',
        awardedGrade: 10,
        isGradePublished: false,
        submittedAt: '2026-11-23T09:00:00Z',
        gradedAt: '2026-11-23T10:00:00Z',
      },
    ],
  );

  assert.equal(res.gradedCount, 2);
  assert.equal(res.averageScorePercent, 85); // (90 + 80) / 2
  assert.equal(res.items.some((i) => i.titleAr.includes('غير منشور')), false);
  assert.equal(res.items.some((i) => i.titleAr.includes('لم تُنشر')), false);
});

test('computeStudyStreakFromDates computes honest streak and never fabricates days when empty', () => {
  const now = new Date('2026-11-23T12:00:00Z');

  const empty = computeStudyStreakFromDates([], now);
  assert.equal(empty.currentStreakDays, 0);
  assert.equal(empty.hasRecordedActivity, false);
  assert.equal(empty.last7Days.length, 7);
  assert.equal(empty.last7Days.every((d) => !d.active), true);

  const threeDayStreak = computeStudyStreakFromDates(
    ['2026-11-23T08:00:00Z', '2026-11-22T15:00:00Z', '2026-11-21T18:00:00Z', '2026-11-18T10:00:00Z'],
    now,
  );
  assert.equal(threeDayStreak.currentStreakDays, 3);
  assert.equal(threeDayStreak.hasRecordedActivity, true);
});

test('buildTodayPlan, buildWeeklyAgenda, searchStudentContent, and formatUpcomingDateBadge use only real data', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  const video = makeVideo({
    id: 7,
    titleAr: 'مراجعة المغناطيسية',
    progress: { lastPositionSec: 600, watchedSec: 600, completionPercent: 33, isCompleted: false, updatedAt: '2026-11-22T10:00:00Z' },
  });

  const data: StudentDashboardData = {
    activeGrade: { id: 3, nameAr: 'الصف الثالث بكالوريا', descriptionAr: '', trackId: 1, trackNameAr: 'البكالوريا' },
    parentShareCode: 'PAR-123',
    overallProgressPercent: 33,
    lastWatchedVideo: video,
    units: [],
    lessons: [],
    videos: [video],
    courses: [],
    plans: [],
    exams: [
      {
        id: 22,
        gradeId: 3,
        titleAr: 'امتحان الوحدة الثانية',
        descriptionAr: '',
        examType: 'UNIT_EXAM',
        durationMin: 45,
        maxAttempts: 2,
        passScorePercent: 60,
        startsAt: '2026-11-24T12:00:00Z',
        attemptsUsed: 0,
        lockedByVideo: false,
        latestAttempt: null,
      },
    ],
    recentAttempts: [],
    homeworkSummary: {
      totalCount: 1,
      completedCount: 0,
      items: [
        {
          id: 9,
          titleAr: 'واجب قانون لينز',
          deadline: '2026-11-25T20:00:00Z',
          maximumGrade: 10,
          submissionStatus: null,
          awardedGrade: null,
          isGradePublished: false,
          submittedAt: null,
          gradedAt: null,
        },
      ],
    },
    studyActivityDates: [],
    schedules: [],
    groups: [],
    notifications: [],
    orders: [],
  };

  const plan = buildTodayPlan(data);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].videoToPlay?.id, 7);
  assert.equal(plan[1].targetTab, 'homework');
  assert.equal(plan[2].examIdToOpen, 22);

  const agenda = buildWeeklyAgenda(data.schedules, data.exams, data.homeworkSummary?.items, now);
  assert.equal(agenda.length, 2);
  assert.equal(agenda[0].kind, 'EXAM');
  assert.equal(agenda[1].kind, 'HOMEWORK');

  const searchMatches = searchStudentContent(data, 'المغناطيسية');
  assert.equal(searchMatches.length, 1);
  assert.equal(searchMatches[0].video?.id, 7);

  const badge = formatUpcomingDateBadge('2026-11-24T12:00:00Z', now);
  assert.equal(badge?.tone, 'urgent');
});
