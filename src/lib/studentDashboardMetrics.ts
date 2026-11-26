import type {
  StudentDashboardData,
  StudentDashboardHomeworkItem,
  StudentExamItem,
  StudentVideoItem,
} from '../types/lms.ts';

export type StudentNavTarget =
  | 'overview'
  | 'curriculum'
  | 'courses'
  | 'library'
  | 'free'
  | 'paid'
  | 'homework'
  | 'exams'
  | 'practice'
  | 'pdfs'
  | 'schedule'
  | 'results'
  | 'billing'
  | 'devices'
  | 'settings';

export interface LessonProgressSummary {
  completed: number;
  inProgress: number;
  remaining: number;
  total: number;
  percent: number;
}

export interface PublishedResultItem {
  id: string;
  kind: 'EXAM' | 'HOMEWORK';
  titleAr: string;
  percent: number;
  scoreLabel: string;
  passed: boolean;
  dateIso: string | null;
}

export interface StudyStreakSummary {
  currentStreakDays: number;
  hasRecordedActivity: boolean;
  last7Days: Array<{
    dayKey: string;
    shortLabelAr: string;
    active: boolean;
    isToday: boolean;
  }>;
}

export interface TodayPlanAction {
  id: string;
  order: number;
  titleAr: string;
  subtitleAr: string;
  badgeText?: string;
  completed: boolean;
  targetTab: StudentNavTarget;
  videoToPlay?: StudentVideoItem;
  examIdToOpen?: number;
}

export interface WeeklyAgendaItem {
  id: string;
  kind: 'SCHEDULE' | 'EXAM' | 'HOMEWORK';
  dateLabelAr: string;
  titleAr: string;
  dateMs: number;
  targetTab: StudentNavTarget;
  entityId?: number;
  joinUrl?: string;
}

export interface StudentSearchResult {
  id: string;
  kind: 'VIDEO' | 'COURSE' | 'EXAM' | 'HOMEWORK' | 'PDF' | 'SCHEDULE';
  kindLabelAr: string;
  titleAr: string;
  subtitleAr: string;
  targetTab: StudentNavTarget;
  entityId?: number;
  video?: StudentVideoItem;
  examId?: number;
}

/**
 * Compute real lesson progress breakdown from student's authorized videos.
 */
export function computeLessonProgressCounts(videos: StudentVideoItem[]): LessonProgressSummary {
  const accessible = videos.filter((v) => v.hasAccess);
  const pool = accessible.length > 0 ? accessible : videos;
  const total = pool.length;
  if (total === 0) {
    return { completed: 0, inProgress: 0, remaining: 0, total: 0, percent: 0 };
  }

  let completed = 0;
  let inProgress = 0;
  let sumPercent = 0;

  for (const v of pool) {
    const pct = Math.max(0, Math.min(100, Math.round(v.progress.completionPercent || 0)));
    sumPercent += pct;
    if (v.progress.isCompleted || pct >= 90) {
      completed += 1;
    } else if (pct > 0 || (v.progress.watchedSec || 0) > 0) {
      inProgress += 1;
    }
  }

  const remaining = Math.max(0, total - completed - inProgress);
  const percent = Math.round(sumPercent / total);

  return { completed, inProgress, remaining, total, percent };
}

/**
 * Strictly combine ONLY published exam attempts and published graded homework scores.
 * Never reveals unpublished exam attempts or ungraded/unpublished homework scores.
 */
export function computePublishedResultsAndAverage(
  recentAttempts: StudentDashboardData['recentAttempts'],
  homeworkItems: StudentDashboardHomeworkItem[] = [],
): {
  items: PublishedResultItem[];
  averageScorePercent: number | null;
  gradedCount: number;
} {
  const items: PublishedResultItem[] = [];

  for (const att of recentAttempts) {
    if (att.status === 'IN_PROGRESS') continue;
    if (att.resultPublished === false) continue;
    if (!Number.isFinite(att.maxScore) || att.maxScore <= 0) continue;
    const percent = Math.max(0, Math.min(100, Math.round((att.totalScore / att.maxScore) * 100)));
    items.push({
      id: `exam-${att.id}`,
      kind: 'EXAM',
      titleAr: att.examTitleAr,
      percent,
      scoreLabel: `${att.totalScore}/${att.maxScore}`,
      passed: Boolean(att.passed),
      dateIso: att.submittedAt || null,
    });
  }

  for (const hw of homeworkItems) {
    if (hw.submissionStatus !== 'GRADED' || !hw.isGradePublished) continue;
    if (hw.awardedGrade === null || !Number.isFinite(hw.maximumGrade) || hw.maximumGrade <= 0) continue;
    const percent = Math.max(0, Math.min(100, Math.round((hw.awardedGrade / hw.maximumGrade) * 100)));
    items.push({
      id: `hw-${hw.id}`,
      kind: 'HOMEWORK',
      titleAr: hw.titleAr,
      percent,
      scoreLabel: `${hw.awardedGrade}/${hw.maximumGrade}`,
      passed: percent >= 50,
      dateIso: hw.gradedAt || hw.submittedAt || null,
    });
  }

  items.sort((a, b) => {
    const ta = a.dateIso ? new Date(a.dateIso).getTime() : 0;
    const tb = b.dateIso ? new Date(b.dateIso).getTime() : 0;
    return tb - ta;
  });

  const gradedCount = items.length;
  const averageScorePercent =
    gradedCount > 0 ? Math.round(items.reduce((sum, x) => sum + x.percent, 0) / gradedCount) : null;

  return { items, averageScorePercent, gradedCount };
}

const CAIRO_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ARABIC_SHORT_DAY_MAP: Record<number, string> = {
  0: 'ح', // الأحد
  1: 'ن', // الإثنين
  2: 'ث', // الثلاثاء
  3: 'ر', // الأربعاء
  4: 'خ', // الخميس
  5: 'ج', // الجمعة
  6: 'س', // السبت
};

function toCairoDayKey(d: Date): string {
  return CAIRO_DAY_FORMATTER.format(d);
}

/**
 * Compute an honest study streak strictly from real recorded activity timestamps.
 * Returns 0 when no recorded activity exists — never fabricates a streak.
 */
export function computeStudyStreakFromDates(
  activityIsoDates: string[] = [],
  nowDate: Date = new Date(),
): StudyStreakSummary {
  const activeDayKeys = new Set<string>();
  for (const raw of activityIsoDates) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      activeDayKeys.add(toCairoDayKey(parsed));
    }
  }

  const todayNoonUtc = new Date(
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), 12, 0, 0),
  );
  const last7Days: StudyStreakSummary['last7Days'] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(todayNoonUtc.getTime() - offset * 86_400_000);
    const key = toCairoDayKey(d);
    const [y, m, day] = key.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, day, 12, 0, 0)).getUTCDay();
    last7Days.push({
      dayKey: key,
      shortLabelAr: ARABIC_SHORT_DAY_MAP[weekday] || '•',
      active: activeDayKeys.has(key),
      isToday: offset === 0,
    });
  }

  // Count consecutive active days ending today (or yesterday if student hasn't studied yet today)
  let currentStreakDays = 0;
  const todayKey = toCairoDayKey(todayNoonUtc);
  const yesterdayKey = toCairoDayKey(new Date(todayNoonUtc.getTime() - 86_400_000));
  let startOffset = -1;
  if (activeDayKeys.has(todayKey)) {
    startOffset = 0;
  } else if (activeDayKeys.has(yesterdayKey)) {
    startOffset = 1;
  }

  if (startOffset >= 0) {
    for (let offset = startOffset; offset < 365; offset += 1) {
      const checkKey = toCairoDayKey(new Date(todayNoonUtc.getTime() - offset * 86_400_000));
      if (activeDayKeys.has(checkKey)) {
        currentStreakDays += 1;
      } else {
        break;
      }
    }
  }

  return {
    currentStreakDays,
    hasRecordedActivity: activeDayKeys.size > 0,
    last7Days,
  };
}

/**
 * Build up to 3 real actionable steps for "خطتك اليوم" from actual student data.
 */
export function buildTodayPlan(data: StudentDashboardData): TodayPlanAction[] {
  const actions: TodayPlanAction[] = [];

  // 1. Continue an unfinished accessible video (or start the first accessible video)
  const unfinishedVideo =
    (data.lastWatchedVideo &&
      data.lastWatchedVideo.hasAccess &&
      !data.lastWatchedVideo.progress.isCompleted &&
      data.lastWatchedVideo) ||
    data.videos.find((v) => v.hasAccess && !v.progress.isCompleted) ||
    null;

  if (unfinishedVideo) {
    const remainingSec = Math.max(
      0,
      (unfinishedVideo.durationSec || 0) - (unfinishedVideo.progress.lastPositionSec || 0),
    );
    const remainingMin = remainingSec > 0 ? Math.max(1, Math.ceil(remainingSec / 60)) : null;
    actions.push({
      id: `video-${unfinishedVideo.id}`,
      order: actions.length + 1,
      titleAr:
        unfinishedVideo.progress.lastPositionSec > 0
          ? `استكمال درس: ${unfinishedVideo.titleAr}`
          : `ابدأ درس: ${unfinishedVideo.titleAr}`,
      subtitleAr: unfinishedVideo.unitTitleAr || unfinishedVideo.lessonTitleAr || 'محاضرة فيديو',
      badgeText: remainingMin ? `${remainingMin} دقيقة` : undefined,
      completed: false,
      targetTab: 'library',
      videoToPlay: unfinishedVideo,
    });
  }

  // 2. Pending or revision-needed homework assignment
  const pendingHw = (data.homeworkSummary?.items || []).find(
    (hw) =>
      !hw.submissionStatus ||
      hw.submissionStatus === 'DRAFT' ||
      hw.submissionStatus === 'RETURNED_FOR_REVISION',
  );
  if (pendingHw) {
    const deadlineText = pendingHw.deadline
      ? `موعد التسليم: ${new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(
          new Date(pendingHw.deadline),
        )}`
      : 'واجب متاح للتسليم';
    actions.push({
      id: `hw-${pendingHw.id}`,
      order: actions.length + 1,
      titleAr: `حل واجب: ${pendingHw.titleAr}`,
      subtitleAr: deadlineText,
      completed: false,
      targetTab: 'homework',
    });
  }

  // 3. Available unattempted (or retryable) exam
  const openExam = data.exams.find((ex) => !ex.lockedByVideo && ex.attemptsUsed < ex.maxAttempts);
  if (openExam && actions.length < 3) {
    actions.push({
      id: `exam-${openExam.id}`,
      order: actions.length + 1,
      titleAr: `تقييم: ${openExam.titleAr}`,
      subtitleAr: `المدة ${openExam.durationMin} دقيقة`,
      completed: false,
      targetTab: 'exams',
      examIdToOpen: openExam.id,
    });
  }

  // 4. Fallback to a real lesson PDF review if fewer than 3 items
  const pdfLesson = data.lessons.find((l) => Boolean(l.pdfTitleAr || l.pdfUrl));
  if (pdfLesson && actions.length < 3) {
    actions.push({
      id: `pdf-${pdfLesson.id}`,
      order: actions.length + 1,
      titleAr: `مراجعة: ${pdfLesson.pdfTitleAr || pdfLesson.titleAr}`,
      subtitleAr: pdfLesson.unitTitleAr || 'مذكرة الدرس PDF',
      completed: false,
      targetTab: 'pdfs',
    });
  }

  return actions.slice(0, 3);
}

/**
 * Build real upcoming weekly agenda items (schedules, scheduled exams, homework deadlines) within next 7 days.
 */
export function buildWeeklyAgenda(
  schedules: StudentDashboardData['schedules'],
  exams: StudentExamItem[],
  homeworkItems: StudentDashboardHomeworkItem[] = [],
  nowDate: Date = new Date(),
): WeeklyAgendaItem[] {
  const nowMs = nowDate.getTime();
  const weekAheadMs = nowMs + 7 * 86_400_000;
  const shortFmt = new Intl.DateTimeFormat('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const list: WeeklyAgendaItem[] = [];

  for (const s of schedules) {
    const ms = new Date(s.scheduledAt).getTime();
    if (!Number.isNaN(ms) && ms >= nowMs - 3_600_000 && ms <= weekAheadMs) {
      list.push({
        id: `sched-${s.id}`,
        kind: 'SCHEDULE',
        dateLabelAr: shortFmt.format(new Date(ms)),
        titleAr: s.titleAr,
        dateMs: ms,
        targetTab: 'schedule',
        entityId: s.id,
        joinUrl: s.joinUrl || undefined,
      });
    }
  }

  for (const ex of exams) {
    const targetIso = ex.startsAt || ex.endsAt;
    if (!targetIso) continue;
    const ms = new Date(targetIso).getTime();
    if (!Number.isNaN(ms) && ms >= nowMs - 3_600_000 && ms <= weekAheadMs) {
      list.push({
        id: `exam-${ex.id}`,
        kind: 'EXAM',
        dateLabelAr: shortFmt.format(new Date(ms)),
        titleAr: `امتحان: ${ex.titleAr}`,
        dateMs: ms,
        targetTab: 'exams',
        entityId: ex.id,
      });
    }
  }

  for (const hw of homeworkItems) {
    if (!hw.deadline) continue;
    const ms = new Date(hw.deadline).getTime();
    if (!Number.isNaN(ms) && ms >= nowMs - 3_600_000 && ms <= weekAheadMs) {
      list.push({
        id: `hw-${hw.id}`,
        kind: 'HOMEWORK',
        dateLabelAr: shortFmt.format(new Date(ms)),
        titleAr: `تسليم واجب: ${hw.titleAr}`,
        dateMs: ms,
        targetTab: 'homework',
        entityId: hw.id,
      });
    }
  }

  return list.sort((a, b) => a.dateMs - b.dateMs).slice(0, 4);
}

/**
 * Search permitted student learning content already authorized in StudentDashboardData.
 */
export function searchStudentContent(
  data: StudentDashboardData | null,
  rawQuery: string,
): StudentSearchResult[] {
  const q = rawQuery.trim().toLowerCase();
  if (!data || q.length < 1) return [];

  const results: StudentSearchResult[] = [];

  for (const v of data.videos) {
    if (
      v.titleAr.toLowerCase().includes(q) ||
      v.lessonTitleAr.toLowerCase().includes(q) ||
      v.unitTitleAr.toLowerCase().includes(q)
    ) {
      results.push({
        id: `v-${v.id}`,
        kind: 'VIDEO',
        kindLabelAr: 'فيديو',
        titleAr: v.titleAr,
        subtitleAr: v.unitTitleAr || v.lessonTitleAr || 'مكتبة الفيديوهات',
        targetTab: 'library',
        entityId: v.id,
        video: v.hasAccess ? v : undefined,
      });
    }
  }

  for (const c of data.courses) {
    if (c.titleAr.toLowerCase().includes(q) || c.descriptionAr.toLowerCase().includes(q)) {
      results.push({
        id: `c-${c.id}`,
        kind: 'COURSE',
        kindLabelAr: 'كورس',
        titleAr: c.titleAr,
        subtitleAr: c.isUnlocked ? 'مفتوح على حسابك' : `${c.discountPriceEgp || c.originalPriceEgp} ج.م`,
        targetTab: 'courses',
        entityId: c.id,
      });
    }
  }

  for (const ex of data.exams) {
    if (ex.titleAr.toLowerCase().includes(q) || ex.descriptionAr.toLowerCase().includes(q)) {
      results.push({
        id: `ex-${ex.id}`,
        kind: 'EXAM',
        kindLabelAr: 'امتحان',
        titleAr: ex.titleAr,
        subtitleAr: `${ex.durationMin} دقيقة`,
        targetTab: 'exams',
        entityId: ex.id,
        examId: ex.id,
      });
    }
  }

  for (const hw of data.homeworkSummary?.items || []) {
    if (hw.titleAr.toLowerCase().includes(q)) {
      results.push({
        id: `hw-${hw.id}`,
        kind: 'HOMEWORK',
        kindLabelAr: 'واجب',
        titleAr: hw.titleAr,
        subtitleAr: hw.submissionStatus ? 'تم التسليم / قيد المتابعة' : 'متاح للتسليم',
        targetTab: 'homework',
        entityId: hw.id,
      });
    }
  }

  for (const l of data.lessons) {
    if (
      (l.pdfTitleAr || l.pdfUrl) &&
      (l.titleAr.toLowerCase().includes(q) || (l.pdfTitleAr || '').toLowerCase().includes(q))
    ) {
      results.push({
        id: `pdf-${l.id}`,
        kind: 'PDF',
        kindLabelAr: 'مذكرة PDF',
        titleAr: l.pdfTitleAr || l.titleAr,
        subtitleAr: l.unitTitleAr || 'مكتبة المذكرات',
        targetTab: 'pdfs',
        entityId: l.id,
      });
    }
  }

  for (const s of data.schedules) {
    if (s.titleAr.toLowerCase().includes(q)) {
      results.push({
        id: `s-${s.id}`,
        kind: 'SCHEDULE',
        kindLabelAr: 'موعد',
        titleAr: s.titleAr,
        subtitleAr: s.liveProvider || 'الجدول والمواعيد',
        targetTab: 'schedule',
        entityId: s.id,
      });
    }
  }

  return results.slice(0, 8);
}

/**
 * Format an exam's relative upcoming date label honestly (returns null if no date exists).
 */
export function formatUpcomingDateBadge(iso: string | null | undefined, nowDate: Date = new Date()): {
  label: string;
  tone: 'urgent' | 'soon' | 'normal';
} | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;

  const [ny, nm, nd] = toCairoDayKey(nowDate).split('-').map(Number);
  const [ty, tm, td] = toCairoDayKey(target).split('-').map(Number);
  const nowDayUtc = Date.UTC(ny, nm - 1, nd);
  const targetDayUtc = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.round((targetDayUtc - nowDayUtc) / 86_400_000);

  if (diffDays <= 0) return { label: 'اليوم', tone: 'urgent' };
  if (diffDays === 1) return { label: 'غدًا', tone: 'urgent' };
  if (diffDays === 2) return { label: 'بعد يومين', tone: 'soon' };
  if (diffDays <= 6) return { label: `خلال ${diffDays} أيام`, tone: 'soon' };
  return {
    label: new Intl.DateTimeFormat('ar-EG', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Cairo',
    }).format(target),
    tone: 'normal',
  };
}
