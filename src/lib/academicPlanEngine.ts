export type CurriculumPlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type CurriculumWeekStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'POSTPONED';
export type CurriculumTaskType =
  | 'VIDEO'
  | 'HOMEWORK'
  | 'EXAM'
  | 'PDF'
  | 'COURSE'
  | 'LIVE_SESSION'
  | 'CUSTOM';

export type EvaluatedTaskStatus =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'NOT_STARTED'
  | 'UPCOMING'
  | 'OVERDUE'
  | 'UNAVAILABLE';

export interface CurriculumTaskRecord {
  id: number;
  weekId: number;
  taskType: CurriculumTaskType;
  entityId: number | null;
  titleAr: string;
  instructionsAr: string;
  isRequired: boolean;
  displayOrder: number;
  availableAt: string | null;
  dueAt: string | null;
}

export interface CurriculumWeekRecord {
  id: number;
  planId: number;
  weekNumber: number;
  titleAr: string;
  descriptionAr: string;
  objectivesAr: string;
  teacherNotesAr: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: CurriculumWeekStatus;
  displayOrder: number;
  unitIds: number[];
  lessonIds: number[];
  tasks: CurriculumTaskRecord[];
}

export interface CurriculumPlanRecord {
  id: number;
  titleAr: string;
  trackId: number;
  trackNameAr?: string;
  gradeId: number;
  gradeNameAr?: string;
  academicYearAr: string;
  descriptionAr: string;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  status: CurriculumPlanStatus;
  publishedAt: string | null;
  weeks: CurriculumWeekRecord[];
}

export interface StudentVideoSignal {
  id: number;
  titleAr: string;
  thumbnailUrl?: string | null;
  youtubeId?: string | null;
  unitTitleAr?: string | null;
  lessonTitleAr?: string | null;
  durationSec?: number;
  watchedSeconds?: number;
  percentComplete?: number;
  isCompleted?: boolean;
  isLocked?: boolean;
  updatedAt?: string | null;
}

export interface StudentHomeworkSignal {
  id: number;
  titleAr: string;
  deadline: string | null;
  statusCode: string;
  statusLabelAr?: string;
  submittedVersionsCount?: number;
  latestSubmittedAt?: string | null;
}

export interface StudentExamSignal {
  id: number;
  titleAr: string;
  durationMinutes?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  statusCode: string; // AVAILABLE | UPCOMING | IN_PROGRESS | COMPLETED | PENDING_GRADING | RESULT_PUBLISHED | EXPIRED | LOCKED
  attemptsUsed?: number;
  hasInProgressAttempt?: boolean;
  lastSubmittedAt?: string | null;
  isAccessible?: boolean;
}

export interface StudentPdfSignal {
  id: number; // lessonId
  titleAr: string;
  pdfTitleAr?: string | null;
  hasPdf?: boolean;
  isAccessible?: boolean;
}

export interface StudentCourseSignal {
  id: number;
  titleAr: string;
  completedLessons?: number;
  totalLessons?: number;
  isAccessible?: boolean;
}

export interface StudentScheduleSignal {
  id: number;
  titleAr: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface StudentAcademicSignals {
  videosById: Record<number, StudentVideoSignal>;
  homeworkById: Record<number, StudentHomeworkSignal>;
  examsById: Record<number, StudentExamSignal>;
  pdfsById: Record<number, StudentPdfSignal>;
  coursesById: Record<number, StudentCourseSignal>;
  scheduleById: Record<number, StudentScheduleSignal>;
  manualReviewedTaskIds: Record<number, { isReviewed: boolean; reviewedAt: string | null }>;
}

export interface EvaluatedCurriculumTask {
  task: CurriculumTaskRecord;
  status: EvaluatedTaskStatus;
  statusLabelAr: string;
  progressPercent: number; // 0-100
  isCompleted: boolean;
  isCompletedOnTime: boolean | null; // null when no deadline applies
  completedAt: string | null;
  effectiveDueAt: string | null;
  effectiveAvailableAt: string | null;
  isOverdue: boolean;
  isFuture: boolean;
  isAccessible: boolean;
  canToggleManualReview: boolean;
  isManuallyReviewed: boolean;
  subtitleAr: string;
  durationMinutes?: number;
  thumbnailUrl?: string | null;
}

export interface EvaluatedWeekSummary {
  week: CurriculumWeekRecord;
  tasks: EvaluatedCurriculumTask[];
  requiredTotal: number;
  requiredCompleted: number;
  requiredInProgress: number;
  requiredOverdue: number;
  requiredRemaining: number;
  optionalTotal: number;
  optionalCompleted: number;
  completionPercent: number;
  isAllRequiredDone: boolean;
}

export type ProgressionStageKey = 'VIDEOS' | 'HOMEWORK' | 'EXAMS' | 'OTHER' | 'COMPLETED' | 'EMPTY';

export interface AcademicProgressionResult {
  hasPlan: boolean;
  stageKey: ProgressionStageKey;
  stageLabelAr: string;
  stages: Array<{
    key: 'VIDEOS' | 'HOMEWORK' | 'EXAMS';
    labelAr: string;
    total: number;
    completed: number;
    status: 'DONE' | 'ACTIVE' | 'PENDING' | 'NONE';
  }>;
  recommendedTask: EvaluatedCurriculumTask | null;
  weekNumber: number | null;
  weekTitleAr: string | null;
  headlineAr: string;
  sublineAr: string;
  ctaLabelAr: string;
  countdownTargetIso: string | null;
  nextWeekId: number | null;
  nextWeekTitleAr: string | null;
}

export interface AcademicAdherenceSummary {
  hasPlan: boolean;
  hasEvaluatedDeadlines: boolean;
  weeklyCompletionPercent: number;
  onTimeAdherencePercent: number | null; // null if no deadlines exist yet
  completedTasksCount: number;
  inProgressTasksCount: number;
  overdueRequiredCount: number;
  remainingRequiredCount: number;
  previousWeekCompletionPercent: number | null;
  previousWeekDelta: number | null; // ONLY computed when a comparable previous published week has required tasks
  statusTone: 'EXCELLENT' | 'GOOD' | 'ATTENTION' | 'NEUTRAL';
  encouragementAr: string;
}

const CAIRO_TZ = 'Africa/Cairo';

export function getCairoDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function generateCurriculumWeekRanges(
  startDateYmd: string,
  totalWeeks: number,
): Array<{ weekNumber: number; titleAr: string; startDate: string; endDate: string }> {
  const safeWeeks = Math.max(1, Math.min(52, Math.floor(totalWeeks || 1)));
  const out: Array<{ weekNumber: number; titleAr: string; startDate: string; endDate: string }> = [];
  for (let i = 0; i < safeWeeks; i++) {
    const start = addDaysToYmd(startDateYmd, i * 7);
    const end = addDaysToYmd(startDateYmd, i * 7 + 6);
    out.push({
      weekNumber: i + 1,
      titleAr: `الأسبوع ${i + 1}`,
      startDate: start,
      endDate: end,
    });
  }
  return out;
}

export function resolveCurrentCurriculumWeek(
  weeks: CurriculumWeekRecord[],
  now: Date = new Date(),
): CurriculumWeekRecord | null {
  if (!weeks || weeks.length === 0) return null;
  const ordered = [...weeks].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.weekNumber - b.weekNumber,
  );
  const today = getCairoDateString(now);

  // 1. Explicit ACTIVE week whose date covers today
  const activeMatchingToday = ordered.find(
    (w) => w.status === 'ACTIVE' && w.startDate <= today && today <= w.endDate,
  );
  if (activeMatchingToday) return activeMatchingToday;

  // 2. Any non-postponed week whose date range covers today
  const matchingToday = ordered.find(
    (w) => w.status !== 'POSTPONED' && w.startDate <= today && today <= w.endDate,
  );
  if (matchingToday) return matchingToday;

  // 3. Explicit ACTIVE week
  const explicitActive = ordered.find((w) => w.status === 'ACTIVE');
  if (explicitActive) return explicitActive;

  // 4. First upcoming planned week (closest future)
  const firstFuture = ordered.find((w) => w.status !== 'POSTPONED' && w.startDate > today);
  if (firstFuture) return firstFuture;

  // 5. Fallback to the most recent non-postponed week
  const nonPostponed = ordered.filter((w) => w.status !== 'POSTPONED');
  return nonPostponed.length > 0 ? nonPostponed[nonPostponed.length - 1] : ordered[0];
}

function parseIsoTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function parseEndOfCairoDateMs(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  // End of Cairo day (UTC+2 approx 23:59:59+02:00)
  const t = new Date(`${ymd}T23:59:59+02:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

export function evaluateCurriculumTask(
  task: CurriculumTaskRecord,
  week: CurriculumWeekRecord,
  signals: StudentAcademicSignals,
  now: Date = new Date(),
): EvaluatedCurriculumTask {
  const nowMs = now.getTime();
  const manualProgress = signals.manualReviewedTaskIds[task.id];
  const isManuallyReviewed = Boolean(manualProgress?.isReviewed);

  let effectiveAvailableAt = task.availableAt;
  let effectiveDueAt = task.dueAt;
  let progressPercent = 0;
  let isCompleted = false;
  let isInProgress = false;
  let isAccessible = true;
  let completedAt: string | null = null;
  let subtitleAr = task.instructionsAr || '';
  let durationMinutes: number | undefined;
  let thumbnailUrl: string | null | undefined;
  let canToggleManualReview = false;
  let entityFound = true;

  if (task.taskType === 'VIDEO') {
    const v = task.entityId ? signals.videosById[task.entityId] : undefined;
    if (!v) {
      entityFound = false;
      isAccessible = false;
      subtitleAr = 'فيديو الدرس غير متاح حاليًا لصفك';
    } else {
      isAccessible = !v.isLocked;
      progressPercent = v.isCompleted ? 100 : Math.max(0, Math.min(99, Math.round(v.percentComplete || 0)));
      isCompleted = Boolean(v.isCompleted || progressPercent >= 95);
      isInProgress = !isCompleted && progressPercent > 0;
      completedAt = isCompleted ? v.updatedAt || null : null;
      thumbnailUrl =
        v.thumbnailUrl ||
        (v.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` : null);
      if (v.durationSec && v.durationSec > 0) {
        durationMinutes = Math.max(1, Math.round(v.durationSec / 60));
      }
      subtitleAr =
        subtitleAr ||
        [v.unitTitleAr, v.lessonTitleAr].filter(Boolean).join(' · ') ||
        (v.isLocked ? 'يتطلب اشتراكًا نشطًا للمشاهدة' : 'محاضرة فيديو');
    }
  } else if (task.taskType === 'HOMEWORK') {
    const hw = task.entityId ? signals.homeworkById[task.entityId] : undefined;
    if (!hw) {
      entityFound = false;
      isAccessible = false;
      subtitleAr = 'الواجب غير منشور أو غير متاح لصفك حاليًا';
    } else {
      effectiveDueAt = effectiveDueAt || hw.deadline;
      const submittedCodes = new Set(['SUBMITTED', 'LATE', 'UNDER_REVIEW', 'GRADED']);
      const submitted =
        submittedCodes.has(hw.statusCode) || (hw.submittedVersionsCount ?? 0) > 0;
      const returned = hw.statusCode === 'RETURNED_FOR_REVISION';
      isCompleted = submitted && !returned;
      isInProgress = hw.statusCode === 'IN_PROGRESS' || returned;
      progressPercent = isCompleted ? 100 : isInProgress ? 50 : 0;
      completedAt = isCompleted ? hw.latestSubmittedAt || null : null;
      subtitleAr =
        subtitleAr ||
        (returned
          ? 'مُعاد للمراجعة وإعادة التسليم'
          : isCompleted
            ? 'تم تسليم الواجب'
            : hw.statusLabelAr || 'واجب مطلوب للتسليم');
    }
  } else if (task.taskType === 'EXAM') {
    const ex = task.entityId ? signals.examsById[task.entityId] : undefined;
    if (!ex) {
      entityFound = false;
      isAccessible = false;
      subtitleAr = 'الامتحان غير متاح لصفك حاليًا';
    } else {
      effectiveAvailableAt = effectiveAvailableAt || ex.startsAt || null;
      effectiveDueAt = effectiveDueAt || ex.endsAt || null;
      durationMinutes = ex.durationMinutes;
      isAccessible = ex.isAccessible !== false && ex.statusCode !== 'LOCKED';
      const completedCodes = new Set(['COMPLETED', 'PENDING_GRADING', 'RESULT_PUBLISHED']);
      isCompleted = completedCodes.has(ex.statusCode) || ((ex.attemptsUsed ?? 0) > 0 && !ex.hasInProgressAttempt);
      isInProgress = Boolean(ex.hasInProgressAttempt || ex.statusCode === 'IN_PROGRESS');
      progressPercent = isCompleted ? 100 : isInProgress ? 50 : 0;
      completedAt = isCompleted ? ex.lastSubmittedAt || null : null;
      subtitleAr =
        subtitleAr ||
        (isCompleted
          ? 'تم تسليم الامتحان'
          : isInProgress
            ? 'محاولة جارية — استكمل الحل'
            : ex.statusCode === 'UPCOMING'
              ? 'امتحان مجدول — يُفتح في موعده'
              : ex.statusCode === 'EXPIRED'
                ? 'انتهى موعد الامتحان'
                : `امتحان ${durationMinutes ? `(${durationMinutes} دقيقة)` : ''}`.trim());
    }
  } else if (task.taskType === 'PDF') {
    const pdf = task.entityId ? signals.pdfsById[task.entityId] : undefined;
    canToggleManualReview = true;
    isAccessible = pdf ? pdf.isAccessible !== false : true;
    isCompleted = isManuallyReviewed;
    progressPercent = isCompleted ? 100 : 0;
    completedAt = isCompleted ? manualProgress?.reviewedAt || null : null;
    subtitleAr =
      subtitleAr ||
      pdf?.pdfTitleAr ||
      pdf?.titleAr ||
      'ملخص أو مذكرة PDF للمراجعة';
  } else if (task.taskType === 'COURSE') {
    const c = task.entityId ? signals.coursesById[task.entityId] : undefined;
    if (!c) {
      entityFound = false;
      isAccessible = false;
      subtitleAr = 'الكورس غير متاح حاليًا';
    } else {
      isAccessible = c.isAccessible !== false;
      const tot = c.totalLessons || 0;
      const done = c.completedLessons || 0;
      progressPercent = tot > 0 ? Math.min(100, Math.round((done / tot) * 100)) : 0;
      isCompleted = tot > 0 && done >= tot;
      isInProgress = !isCompleted && done > 0;
      subtitleAr = subtitleAr || (tot > 0 ? `أكملت ${done} من ${tot} دروس` : 'كورس دراسي');
    }
  } else if (task.taskType === 'LIVE_SESSION') {
    const ev = task.entityId ? signals.scheduleById[task.entityId] : undefined;
    canToggleManualReview = true;
    effectiveAvailableAt = effectiveAvailableAt || ev?.startsAt || null;
    effectiveDueAt = effectiveDueAt || ev?.endsAt || null;
    isCompleted = isManuallyReviewed;
    progressPercent = isCompleted ? 100 : 0;
    completedAt = isCompleted ? manualProgress?.reviewedAt || null : null;
    // Honest indicator — never fabricate attendance!
    subtitleAr =
      subtitleAr ||
      (isCompleted
        ? 'تم تحديد الحصة كمُراجعة بواسطة الطالب'
        : 'حصة مباشرة / مراجعة (التأكيد يدوي بواسطة الطالب)');
  } else {
    // CUSTOM
    canToggleManualReview = true;
    isCompleted = isManuallyReviewed;
    progressPercent = isCompleted ? 100 : 0;
    completedAt = isCompleted ? manualProgress?.reviewedAt || null : null;
    subtitleAr = subtitleAr || 'مهمة دراسية';
  }

  const availMs = parseIsoTime(effectiveAvailableAt);
  const dueMs = parseIsoTime(effectiveDueAt) ?? (task.isRequired ? parseEndOfCairoDateMs(week.endDate) : null);
  const isFuture = Boolean(availMs !== null && availMs > nowMs);
  const isOverdue = Boolean(!isCompleted && dueMs !== null && dueMs < nowMs && !isFuture);

  let isCompletedOnTime: boolean | null = null;
  if (dueMs !== null) {
    if (isCompleted) {
      const doneMs = parseIsoTime(completedAt);
      isCompletedOnTime = doneMs !== null ? doneMs <= dueMs : true;
    } else if (dueMs < nowMs) {
      isCompletedOnTime = false;
    }
  }

  let status: EvaluatedTaskStatus;
  let statusLabelAr: string;

  if (!entityFound) {
    status = 'UNAVAILABLE';
    statusLabelAr = 'غير متاح';
  } else if (isCompleted) {
    status = 'COMPLETED';
    statusLabelAr = 'مكتمل';
  } else if (isFuture) {
    status = 'UPCOMING';
    statusLabelAr = 'متاح لاحقًا';
  } else if (!isAccessible) {
    status = 'UNAVAILABLE';
    statusLabelAr = 'مغلق';
  } else if (isInProgress) {
    status = 'IN_PROGRESS';
    statusLabelAr = 'قيد التنفيذ';
  } else if (isOverdue) {
    status = 'OVERDUE';
    statusLabelAr = 'متأخر';
  } else {
    status = 'NOT_STARTED';
    statusLabelAr = 'لم يبدأ';
  }

  return {
    task,
    status,
    statusLabelAr,
    progressPercent,
    isCompleted,
    isCompletedOnTime,
    completedAt,
    effectiveDueAt,
    effectiveAvailableAt,
    isOverdue,
    isFuture,
    isAccessible,
    canToggleManualReview,
    isManuallyReviewed,
    subtitleAr,
    durationMinutes,
    thumbnailUrl,
  };
}

export function evaluateWeekSummary(
  week: CurriculumWeekRecord,
  signals: StudentAcademicSignals,
  now: Date = new Date(),
): EvaluatedWeekSummary {
  const orderedTasks = [...week.tasks].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id - b.id,
  );
  const evaluated = orderedTasks.map((t) => evaluateCurriculumTask(t, week, signals, now));

  const requiredTasks = evaluated.filter((e) => e.task.isRequired);
  const optionalTasks = evaluated.filter((e) => !e.task.isRequired);

  const requiredTotal = requiredTasks.length;
  const requiredCompleted = requiredTasks.filter((e) => e.isCompleted).length;
  const requiredInProgress = requiredTasks.filter((e) => e.status === 'IN_PROGRESS').length;
  const requiredOverdue = requiredTasks.filter((e) => e.status === 'OVERDUE').length;
  const requiredRemaining = Math.max(0, requiredTotal - requiredCompleted);

  const optionalTotal = optionalTasks.length;
  const optionalCompleted = optionalTasks.filter((e) => e.isCompleted).length;

  const completionPercent =
    requiredTotal > 0
      ? Math.round((requiredCompleted / requiredTotal) * 100)
      : optionalTotal > 0
        ? Math.round((optionalCompleted / optionalTotal) * 100)
        : 0;

  return {
    week,
    tasks: evaluated,
    requiredTotal,
    requiredCompleted,
    requiredInProgress,
    requiredOverdue,
    requiredRemaining,
    optionalTotal,
    optionalCompleted,
    completionPercent,
    isAllRequiredDone: requiredTotal > 0 && requiredCompleted === requiredTotal,
  };
}

export function computeAcademicProgression(
  plan: CurriculumPlanRecord | null,
  currentWeekSummary: EvaluatedWeekSummary | null,
): AcademicProgressionResult {
  if (!plan || !currentWeekSummary) {
    return {
      hasPlan: false,
      stageKey: 'EMPTY',
      stageLabelAr: 'لا توجد خطة أسبوعية منشورة حاليًا',
      stages: [
        { key: 'VIDEOS', labelAr: 'المحاضرات', total: 0, completed: 0, status: 'NONE' },
        { key: 'HOMEWORK', labelAr: 'الواجبات', total: 0, completed: 0, status: 'NONE' },
        { key: 'EXAMS', labelAr: 'الامتحانات', total: 0, completed: 0, status: 'NONE' },
      ],
      recommendedTask: null,
      weekNumber: null,
      weekTitleAr: null,
      headlineAr: 'لا توجد خطة دراسية منشورة لصفك بعد',
      sublineAr: 'بمجرد نشر الأستاذ لخطة المنهج الأسبوعية ستظهر خطوتك التالية تلقائيًا هنا.',
      ctaLabelAr: 'استعراض الفيديوهات',
      countdownTargetIso: null,
      nextWeekId: null,
      nextWeekTitleAr: null,
    };
  }

  const reqTasks = currentWeekSummary.tasks.filter((t) => t.task.isRequired);
  const videoTasks = reqTasks.filter((t) => t.task.taskType === 'VIDEO');
  const hwTasks = reqTasks.filter((t) => t.task.taskType === 'HOMEWORK');
  const examTasks = reqTasks.filter((t) => t.task.taskType === 'EXAM');
  const otherTasks = reqTasks.filter(
    (t) =>
      t.task.taskType !== 'VIDEO' &&
      t.task.taskType !== 'HOMEWORK' &&
      t.task.taskType !== 'EXAM',
  );

  const nextVideo =
    videoTasks.find((t) => t.status === 'IN_PROGRESS') ||
    videoTasks.find((t) => !t.isCompleted && t.status !== 'UNAVAILABLE') ||
    null;
  const nextHomework =
    hwTasks.find((t) => t.status === 'IN_PROGRESS') ||
    hwTasks.find((t) => !t.isCompleted && t.status !== 'UNAVAILABLE') ||
    null;
  const nextExam =
    examTasks.find((t) => t.status === 'IN_PROGRESS') ||
    examTasks.find((t) => !t.isCompleted && t.status !== 'UNAVAILABLE') ||
    null;
  const nextOther = otherTasks.find((t) => !t.isCompleted && t.status !== 'UNAVAILABLE') || null;

  const videoDone = videoTasks.filter((t) => t.isCompleted).length;
  const hwDone = hwTasks.filter((t) => t.isCompleted).length;
  const examDone = examTasks.filter((t) => t.isCompleted).length;

  let stageKey: ProgressionStageKey = 'COMPLETED';
  let recommendedTask: EvaluatedCurriculumTask | null = null;

  if (nextVideo) {
    stageKey = 'VIDEOS';
    recommendedTask = nextVideo;
  } else if (nextHomework) {
    stageKey = 'HOMEWORK';
    recommendedTask = nextHomework;
  } else if (nextExam) {
    stageKey = 'EXAMS';
    recommendedTask = nextExam;
  } else if (nextOther) {
    stageKey = 'OTHER';
    recommendedTask = nextOther;
  } else if (reqTasks.length === 0) {
    stageKey = 'EMPTY';
    recommendedTask = null;
  } else {
    stageKey = 'COMPLETED';
    recommendedTask = null;
  }

  const stageStatus = (
    key: 'VIDEOS' | 'HOMEWORK' | 'EXAMS',
    total: number,
    done: number,
  ): 'DONE' | 'ACTIVE' | 'PENDING' | 'NONE' => {
    if (total === 0) return 'NONE';
    if (done >= total) return 'DONE';
    if (stageKey === key) return 'ACTIVE';
    return 'PENDING';
  };

  const stages = [
    {
      key: 'VIDEOS' as const,
      labelAr: 'المحاضرات',
      total: videoTasks.length,
      completed: videoDone,
      status: stageStatus('VIDEOS', videoTasks.length, videoDone),
    },
    {
      key: 'HOMEWORK' as const,
      labelAr: 'الواجبات',
      total: hwTasks.length,
      completed: hwDone,
      status: stageStatus('HOMEWORK', hwTasks.length, hwDone),
    },
    {
      key: 'EXAMS' as const,
      labelAr: 'الامتحانات',
      total: examTasks.length,
      completed: examDone,
      status: stageStatus('EXAMS', examTasks.length, examDone),
    },
  ];

  // Find next week in plan if current week is complete
  const orderedWeeks = [...plan.weeks].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.weekNumber - b.weekNumber,
  );
  const curIdx = orderedWeeks.findIndex((w) => w.id === currentWeekSummary.week.id);
  const nextWeek =
    curIdx >= 0 && curIdx + 1 < orderedWeeks.length ? orderedWeeks[curIdx + 1] : null;

  let stageLabelAr = 'أكملت خطة هذا الأسبوع بنجاح!';
  let headlineAr = `أحسنت! أنهيت جميع مهام ${currentWeekSummary.week.titleAr}`;
  let sublineAr = nextWeek
    ? `يمكنك الاطلاع على ${nextWeek.titleAr} أو مراجعة ملخصاتك ونتائجك.`
    : 'أتممت جميع المهام المطلوبة لهذا الأسبوع بنجاح.';
  let ctaLabelAr = nextWeek ? `استعراض ${nextWeek.titleAr}` : 'عرض خطة المنهج';
  let countdownTargetIso: string | null = null;

  if (recommendedTask) {
    headlineAr = recommendedTask.task.titleAr;
    sublineAr = recommendedTask.subtitleAr;
    if (stageKey === 'VIDEOS') {
      stageLabelAr = 'المرحلة الحالية: استكمال المحاضرات';
      ctaLabelAr =
        recommendedTask.progressPercent > 0 ? 'استكمال المشاهدة' : 'بدء مشاهدة المحاضرة';
    } else if (stageKey === 'HOMEWORK') {
      stageLabelAr = 'المرحلة الحالية: حل الواجبات المطلوبة';
      ctaLabelAr =
        recommendedTask.status === 'IN_PROGRESS' ? 'استكمال تسليم الواجب' : 'حل الواجب الآن';
    } else if (stageKey === 'EXAMS') {
      stageLabelAr = 'المرحلة الحالية: الامتحان التقييمي';
      if (recommendedTask.isFuture) {
        ctaLabelAr = 'عرض تفاصيل الامتحان';
        countdownTargetIso = recommendedTask.effectiveAvailableAt;
        sublineAr = 'الامتحان مجدول ولم يحن موعد فتحه بعد';
      } else if (recommendedTask.status === 'IN_PROGRESS') {
        ctaLabelAr = 'استكمال محاولة الامتحان';
      } else {
        ctaLabelAr = 'فتح صفحة الامتحان';
      }
    } else {
      stageLabelAr = 'المرحلة الحالية: مهام المراجعة والمذكرات';
      ctaLabelAr =
        recommendedTask.task.taskType === 'PDF'
          ? 'فتح المذكرة للمراجعة'
          : 'فتح المهمة الآن';
    }
  } else if (stageKey === 'EMPTY') {
    stageLabelAr = 'لا توجد مهام مطلوبة هذا الأسبوع';
    headlineAr = `${currentWeekSummary.week.titleAr} جاهز للاستعراض`;
    sublineAr = 'لم يُضف الأستاذ مهام مطلوبة في هذا الأسبوع بعد.';
    ctaLabelAr = 'عرض خطة المنهج';
  }

  return {
    hasPlan: true,
    stageKey,
    stageLabelAr,
    stages,
    recommendedTask,
    weekNumber: currentWeekSummary.week.weekNumber,
    weekTitleAr: currentWeekSummary.week.titleAr,
    headlineAr,
    sublineAr,
    ctaLabelAr,
    countdownTargetIso,
    nextWeekId: nextWeek?.id ?? null,
    nextWeekTitleAr: nextWeek?.titleAr ?? null,
  };
}

export function computeAcademicAdherence(
  plan: CurriculumPlanRecord | null,
  allWeekSummaries: EvaluatedWeekSummary[],
  currentWeekSummary: EvaluatedWeekSummary | null,
): AcademicAdherenceSummary {
  if (!plan || !currentWeekSummary) {
    return {
      hasPlan: false,
      hasEvaluatedDeadlines: false,
      weeklyCompletionPercent: 0,
      onTimeAdherencePercent: null,
      completedTasksCount: 0,
      inProgressTasksCount: 0,
      overdueRequiredCount: 0,
      remainingRequiredCount: 0,
      previousWeekCompletionPercent: null,
      previousWeekDelta: null,
      statusTone: 'NEUTRAL',
      encouragementAr: 'سيبدأ احتساب التزامك الدراسي تلقائيًا فور نشر خطة المنهج الأسبوعية.',
    };
  }

  // Evaluate on-time adherence across tasks with actual deadlines up to the current week
  const curIdx = allWeekSummaries.findIndex((w) => w.week.id === currentWeekSummary.week.id);
  const relevantSummaries =
    curIdx >= 0 ? allWeekSummaries.slice(0, curIdx + 1) : [currentWeekSummary];

  const deadlineEvaluatedTasks = relevantSummaries
    .flatMap((ws) => ws.tasks)
    .filter((t) => t.task.isRequired && t.isCompletedOnTime !== null);

  const onTimeCount = deadlineEvaluatedTasks.filter((t) => t.isCompletedOnTime === true).length;
  const hasEvaluatedDeadlines = deadlineEvaluatedTasks.length > 0;
  const onTimeAdherencePercent = hasEvaluatedDeadlines
    ? Math.round((onTimeCount / deadlineEvaluatedTasks.length) * 100)
    : null;

  // Previous week comparison ONLY if a comparable previous published week has required tasks
  const prevSummary = curIdx > 0 ? allWeekSummaries[curIdx - 1] : null;
  const previousWeekCompletionPercent =
    prevSummary && prevSummary.requiredTotal > 0 ? prevSummary.completionPercent : null;
  const previousWeekDelta =
    previousWeekCompletionPercent !== null && currentWeekSummary.requiredTotal > 0
      ? currentWeekSummary.completionPercent - previousWeekCompletionPercent
      : null;

  const overdueRequiredCount = relevantSummaries.reduce((acc, ws) => acc + ws.requiredOverdue, 0);

  let statusTone: 'EXCELLENT' | 'GOOD' | 'ATTENTION' | 'NEUTRAL' = 'NEUTRAL';
  let encouragementAr = 'ابدأ بمهام هذا الأسبوع لبناء التزام دراسي قوي ومستقر.';

  if (currentWeekSummary.requiredTotal === 0) {
    statusTone = 'NEUTRAL';
    encouragementAr = 'لا توجد مهام مطلوبة بمواعيد نهائية في هذا الأسبوع حاليًا.';
  } else if (currentWeekSummary.completionPercent >= 85 && overdueRequiredCount === 0) {
    statusTone = 'EXCELLENT';
    encouragementAr = 'التزام ممتاز! أنت تسير بثبات مع خطة الأستاذ بدون أي تأخير.';
  } else if (currentWeekSummary.completionPercent >= 50 && overdueRequiredCount <= 1) {
    statusTone = 'GOOD';
    encouragementAr = 'تقدم جيد جدًا! أكمل المهام المتبقية لتحقيق 100% هذا الأسبوع.';
  } else if (overdueRequiredCount > 0) {
    statusTone = 'ATTENTION';
    encouragementAr = `لديك ${overdueRequiredCount} مهمة متأخرة؛ ابدأ بها الآن للعودة إلى مسار الخطة.`;
  } else {
    statusTone = 'GOOD';
    encouragementAr = 'بداية موفقة! إنجاز مهمة واحدة يوميًا يضمن لك إنهاء الأسبوع بسهولة.';
  }

  return {
    hasPlan: true,
    hasEvaluatedDeadlines,
    weeklyCompletionPercent: currentWeekSummary.completionPercent,
    onTimeAdherencePercent,
    completedTasksCount: currentWeekSummary.requiredCompleted,
    inProgressTasksCount: currentWeekSummary.requiredInProgress,
    overdueRequiredCount,
    remainingRequiredCount: currentWeekSummary.requiredRemaining,
    previousWeekCompletionPercent,
    previousWeekDelta,
    statusTone,
    encouragementAr,
  };
}
