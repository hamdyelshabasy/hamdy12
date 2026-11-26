import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookCheck,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardCheck,
  Clock,
  FileText,
  Flag,
  GraduationCap,
  Layers,
  ListChecks,
  Lock,
  Play,
  PlayCircle,
  Radio,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import type {
  CurriculumPlanRecord,
  CurriculumTaskType,
  EvaluatedCurriculumTask,
  EvaluatedWeekSummary,
} from '../../lib/academicPlanEngine.ts';
import type {
  StudentDeepLinkTarget,
  StudentExamItem,
  StudentVideoItem,
} from '../../types/lms.ts';
import { formatDurationAr } from '../../lib/api.ts';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentRailCard,
  StudentTwoColShell,
  pickPhysicsArtwork,
} from './StudentUiPrimitives.tsx';

interface StudentCurriculumViewProps {
  plan: CurriculumPlanRecord | null;
  allWeekSummaries: EvaluatedWeekSummary[];
  currentWeekId: number | null;
  initialFilter?: 'ALL' | 'CURRENT' | 'OVERDUE';
  initialWeekId?: number | null;
  togglingTaskId: number | null;
  exams?: StudentExamItem[];
  videos?: StudentVideoItem[];
  onToggleManualReview: (taskId: number, isReviewed: boolean) => Promise<void>;
  onOpenTask: (evaluated: EvaluatedCurriculumTask) => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

const TASK_STYLE_MAP: Record<
  CurriculumTaskType,
  { labelAr: string; badgeClass: string; icon: React.ReactNode }
> = {
  VIDEO: {
    labelAr: 'محاضرة فيديو',
    badgeClass: 'bg-sky-500/20 text-sky-200 border-sky-400/35',
    icon: <PlayCircle className="h-4 w-4 text-sky-300" />,
  },
  HOMEWORK: {
    labelAr: 'واجب',
    badgeClass: 'bg-orange-500/20 text-orange-200 border-orange-400/35',
    icon: <BookCheck className="h-4 w-4 text-orange-300" />,
  },
  EXAM: {
    labelAr: 'امتحان',
    badgeClass: 'bg-pink-500/20 text-pink-200 border-pink-400/35',
    icon: <ClipboardCheck className="h-4 w-4 text-pink-300" />,
  },
  PDF: {
    labelAr: 'مذكرة PDF',
    badgeClass: 'bg-violet-500/20 text-violet-200 border-violet-400/35',
    icon: <FileText className="h-4 w-4 text-violet-300" />,
  },
  COURSE: {
    labelAr: 'كورس',
    badgeClass: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/35',
    icon: <BookOpen className="h-4 w-4 text-indigo-300" />,
  },
  LIVE_SESSION: {
    labelAr: 'حصة مباشرة',
    badgeClass: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/35',
    icon: <Radio className="h-4 w-4 text-cyan-300" />,
  },
  CUSTOM: {
    labelAr: 'مهمة دراسية',
    badgeClass: 'bg-slate-500/20 text-slate-200 border-slate-400/35',
    icon: <Sparkles className="h-4 w-4 text-slate-300" />,
  },
};

function statusPillClasses(status: EvaluatedCurriculumTask['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40';
    case 'IN_PROGRESS':
      return 'bg-sky-500/20 text-sky-200 border-sky-400/40';
    case 'OVERDUE':
      return 'bg-rose-500/20 text-rose-200 border-rose-400/45';
    case 'UPCOMING':
      return 'bg-violet-500/20 text-violet-200 border-violet-400/40';
    case 'UNAVAILABLE':
      return 'bg-amber-500/20 text-amber-200 border-amber-400/40';
    default:
      return 'bg-white/10 text-slate-200 border-white/15';
  }
}

function formatArabicFullDate(ymd: string): string {
  if (!ymd) return '—';
  const dt = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

function formatArabicShortDate(ymd: string): string {
  if (!ymd) return '—';
  const dt = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
  }).format(dt);
}

function formatDayMonthParts(iso: string): { day: string; month: string } {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { day: '—', month: '' };
  const day = new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
  }).format(dt);
  const month = new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    month: 'long',
  }).format(dt);
  return { day, month };
}

function daysUntilYmd(ymd: string): number | null {
  if (!ymd) return null;
  const target = new Date(`${ymd}T12:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export const StudentCurriculumView: React.FC<StudentCurriculumViewProps> = ({
  plan,
  allWeekSummaries,
  currentWeekId,
  initialFilter = 'ALL',
  initialWeekId = null,
  togglingTaskId,
  exams = [],
  videos = [],
  onToggleManualReview,
  onOpenTask,
  onNavigateTarget,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'CURRENT' | 'OVERDUE'>(initialFilter);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(
    initialWeekId || currentWeekId || allWeekSummaries[0]?.week.id || null,
  );
  const [showFullWeekDetails, setShowFullWeekDetails] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL' | 'VIDEO' | 'HOMEWORK' | 'PDF' | 'EXAM'
  >('ALL');
  const [showFullPlanDrawer, setShowFullPlanDrawer] = useState(false);

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const tasksSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (initialWeekId && allWeekSummaries.some((w) => w.week.id === initialWeekId)) {
      setSelectedWeekId(initialWeekId);
      return;
    }
    if (
      !selectedWeekId ||
      !allWeekSummaries.some((w) => w.week.id === selectedWeekId)
    ) {
      setSelectedWeekId(currentWeekId || allWeekSummaries[0]?.week.id || null);
    }
  }, [initialWeekId, currentWeekId, allWeekSummaries, selectedWeekId]);

  const metrics = useMemo(() => {
    const totalWeeks = allWeekSummaries.length;
    const deliveredWeeks = allWeekSummaries.filter(
      (ws) => ws.week.status === 'COMPLETED' || ws.week.status === 'ACTIVE',
    ).length;
    const teacherDeliveryPct =
      totalWeeks > 0 ? Math.round((deliveredWeeks / totalWeeks) * 100) : 0;

    const totalRequired = allWeekSummaries.reduce((acc, w) => acc + w.requiredTotal, 0);
    const completedRequired = allWeekSummaries.reduce((acc, w) => acc + w.requiredCompleted, 0);
    const overdueRequired = allWeekSummaries.reduce((acc, w) => acc + w.requiredOverdue, 0);
    const studentCompletionPct =
      totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

    const currentIndex = allWeekSummaries.findIndex((w) => w.week.id === currentWeekId);
    const currentWeekNumber =
      currentIndex >= 0
        ? allWeekSummaries[currentIndex].week.weekNumber
        : allWeekSummaries[0]?.week.weekNumber ?? 0;

    return {
      totalWeeks,
      deliveredWeeks,
      teacherDeliveryPct,
      totalRequired,
      completedRequired,
      overdueRequired,
      studentCompletionPct,
      currentWeekNumber,
    };
  }, [allWeekSummaries, currentWeekId]);

  const activeWeekSummary = useMemo(() => {
    if (allWeekSummaries.length === 0) return null;
    if (filter === 'OVERDUE') {
      const overdueFound = allWeekSummaries.find(
        (w) => w.week.id === selectedWeekId && w.requiredOverdue > 0,
      );
      if (overdueFound) return overdueFound;
      return allWeekSummaries.find((w) => w.requiredOverdue > 0) || allWeekSummaries[0];
    }
    return (
      allWeekSummaries.find((w) => w.week.id === selectedWeekId) ||
      allWeekSummaries.find((w) => w.week.id === currentWeekId) ||
      allWeekSummaries[0]
    );
  }, [allWeekSummaries, selectedWeekId, currentWeekId, filter]);

  // Real upcoming milestones derived from upcoming weeks in the plan
  const upcomingMilestones = useMemo(() => {
    const currentNum = metrics.currentWeekNumber;
    const candidates = allWeekSummaries.filter(
      (ws) => ws.week.weekNumber >= currentNum && ws.week.status !== 'COMPLETED',
    );
    return candidates.slice(0, 3);
  }, [allWeekSummaries, metrics.currentWeekNumber]);

  // Real upcoming exams for the left rail
  const upcomingExamsList = useMemo(() => {
    const now = Date.now();
    return exams
      .filter((ex) => {
        if (ex.startsAt && new Date(ex.startsAt).getTime() >= now - 86400000) return true;
        if (!ex.latestAttempt && ex.attemptsUsed < ex.maxAttempts) return true;
        return false;
      })
      .sort((a, b) => {
        const at = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return at - bt;
      })
      .slice(0, 3);
  }, [exams]);

  // Upcoming weeks after selected week for the bottom rail strip
  const nextWeeks = useMemo(() => {
    if (!activeWeekSummary) return [];
    const idx = allWeekSummaries.findIndex((w) => w.week.id === activeWeekSummary.week.id);
    if (idx < 0) return allWeekSummaries.slice(0, 4);
    const after = allWeekSummaries.slice(idx + 1, idx + 5);
    return after.length > 0 ? after : allWeekSummaries.slice(0, 4);
  }, [allWeekSummaries, activeWeekSummary]);

  // Categorize active week tasks into the 4 reference cards: VIDEO | HOMEWORK | PDF/OTHER | EXAM
  const weekBuckets = useMemo(() => {
    const tasks = activeWeekSummary?.tasks || [];
    const videoTasks = tasks.filter(
      (t) =>
        t.task.taskType === 'VIDEO' ||
        t.task.taskType === 'COURSE' ||
        t.task.taskType === 'LIVE_SESSION',
    );
    const homeworkTasks = tasks.filter((t) => t.task.taskType === 'HOMEWORK');
    const pdfTasks = tasks.filter(
      (t) => t.task.taskType === 'PDF' || t.task.taskType === 'CUSTOM',
    );
    const examTasks = tasks.filter((t) => t.task.taskType === 'EXAM');

    // Find representative real video for featured spotlight preview
    const firstVideoTask = tasks.find((t) => t.task.taskType === 'VIDEO' && t.task.entityId);
    const matchedVideo = firstVideoTask
      ? videos.find((v) => v.id === firstVideoTask.task.entityId) || null
      : null;

    const totalDurationSec = videoTasks.reduce((sum, t) => {
      const v = t.task.entityId ? videos.find((item) => item.id === t.task.entityId) : null;
      return sum + (v?.durationSec || 0);
    }, 0);

    return {
      videoTasks,
      homeworkTasks,
      pdfTasks,
      examTasks,
      matchedVideo,
      firstVideoTask: firstVideoTask || null,
      totalDurationSec,
    };
  }, [activeWeekSummary, videos]);

  const displayedTasks = useMemo(() => {
    if (!activeWeekSummary) return [];
    let list = activeWeekSummary.tasks;
    if (filter === 'OVERDUE') {
      list = list.filter((t) => t.status === 'OVERDUE');
    }
    if (categoryFilter === 'VIDEO') {
      list = list.filter(
        (t) =>
          t.task.taskType === 'VIDEO' ||
          t.task.taskType === 'COURSE' ||
          t.task.taskType === 'LIVE_SESSION',
      );
    } else if (categoryFilter === 'HOMEWORK') {
      list = list.filter((t) => t.task.taskType === 'HOMEWORK');
    } else if (categoryFilter === 'PDF') {
      list = list.filter((t) => t.task.taskType === 'PDF' || t.task.taskType === 'CUSTOM');
    } else if (categoryFilter === 'EXAM') {
      list = list.filter((t) => t.task.taskType === 'EXAM');
    }
    return list;
  }, [activeWeekSummary, filter, categoryFilter]);

  const scrollTimeline = (dir: 'prev' | 'next') => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollBy({
      left: dir === 'next' ? -240 : 240,
      behavior: 'smooth',
    });
  };

  const handleCategoryClick = (cat: 'VIDEO' | 'HOMEWORK' | 'PDF' | 'EXAM') => {
    setCategoryFilter((prev) => (prev === cat ? 'ALL' : cat));
    setShowFullWeekDetails(true);
    window.setTimeout(() => {
      tasksSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  if (!plan) {
    return (
      <div className="space-y-4" data-testid="student-curriculum-view">
        <StudentPageHero
          title="خطة المنهج"
          subtitle="خارطة رحلتك الدراسية منظمة أسبوعيًا لمتابعة الشرح والواجبات والمراجعات والامتحانات حتى نهاية المنهج."
          icon={<Layers className="h-6 w-6" />}
          artworkSrc={STUDENT_ARTWORK.curriculum}
          artworkAlt="خطة المنهج الدراسي في الفيزياء"
        />
        <StudentEmptyState
          icon={<Layers className="h-6 w-6" />}
          title="خطة المنهج الدراسي غير منشورة بعد"
          description="لم يقم الأستاذ بنشر خطة المنهج الأسبوعية لهذا الصف بعد. يمكنك الاستمرار في مشاهدة الدروس المتاحة وحل الواجبات والامتحانات من الأقسام الرئيسية."
          actionLabel="استعراض الفيديوهات"
          onAction={() => onNavigateTarget({ type: 'VIDEO' })}
          secondaryActionLabel="الانتقال للواجبات"
          onSecondaryAction={() => onNavigateTarget({ type: 'HOMEWORK' })}
        />
      </div>
    );
  }

  const rail = (
    <>
      {/* 1. Plan Overview Card */}
      <StudentRailCard glow="blue">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">نظرة عامة على الخطة</h2>
          <BarChart3 className="h-4 w-4 text-sky-300" />
        </div>

        <div className="mt-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <Calendar className="h-3.5 w-3.5 text-sky-300" />
              إجمالي الأسابيع
            </span>
            <span className="font-mono-num font-extrabold text-white">
              {metrics.totalWeeks} أسبوعًا
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <CalendarDays className="h-3.5 w-3.5 text-sky-300" />
              تاريخ البداية
            </span>
            <span className="font-semibold text-slate-100 text-[11px] truncate max-w-[140px]">
              {formatArabicShortDate(plan.startDate)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <CalendarDays className="h-3.5 w-3.5 text-violet-300" />
              تاريخ النهاية
            </span>
            <span className="font-semibold text-slate-100 text-[11px] truncate max-w-[140px]">
              {formatArabicShortDate(plan.endDate)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <Target className="h-3.5 w-3.5 text-sky-300" />
              الأسبوع الحالي
            </span>
            <span className="rounded-lg bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-2.5 py-1 font-mono-num text-[11px] font-extrabold text-white shadow-sm">
              الأسبوع {metrics.currentWeekNumber} من {metrics.totalWeeks}
            </span>
          </div>
        </div>

        {/* Dual Progress Bars */}
        <div className="mt-4 space-y-3 border-t border-white/10 pt-3.5">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-sky-200">
                <PlayCircle className="h-3.5 w-3.5 text-sky-300" />
                تقدم شرح الأستاذ
              </span>
              <span className="font-mono-num font-extrabold text-white">
                {metrics.teacherDeliveryPct}%
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${metrics.teacherDeliveryPct}%` }}
                className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-blue-500 transition-all duration-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-violet-200">
                <GraduationCap className="h-3.5 w-3.5 text-violet-300" />
                إنجاز الطالب
              </span>
              <span className="font-mono-num font-extrabold text-white">
                {metrics.studentCompletionPct}%
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${metrics.studentCompletionPct}%` }}
                className="h-full rounded-full bg-gradient-to-l from-fuchsia-400 to-violet-500 transition-all duration-500"
              />
            </div>
            <div className="mt-1 text-[10.5px] text-slate-400">
              أتممت {metrics.completedRequired} من {metrics.totalRequired} مهمة مطلوبة
            </div>
          </div>
        </div>
      </StudentRailCard>

      {/* 2. Upcoming Milestones */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">أهم المحطات القادمة</h2>
          <Flag className="h-4 w-4 text-sky-300" />
        </div>
        {upcomingMilestones.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            تم إتمام جميع محطات هذه الخطة الدراسية.
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {upcomingMilestones.map((ms) => {
              const dLeft = daysUntilYmd(ms.week.startDate);
              const badgeText =
                ms.week.id === currentWeekId
                  ? 'الأسبوع الحالي'
                  : dLeft !== null && dLeft > 0
                    ? `بعد ${dLeft} يوم`
                    : `أسبوع ${ms.week.weekNumber}`;
              return (
                <button
                  key={ms.week.id}
                  type="button"
                  onClick={() => {
                    setSelectedWeekId(ms.week.id);
                    setFilter('ALL');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B1739]/80 px-3 py-2.5 text-right hover:border-sky-400/45 transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-extrabold text-white">
                        {ms.week.titleAr}
                      </div>
                      <div className="text-[10.5px] text-slate-400">
                        {formatArabicShortDate(ms.week.startDate)}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg border border-sky-400/35 bg-sky-500/15 px-2 py-0.5 font-mono-num text-[10px] font-bold text-sky-200">
                    {badgeText}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </StudentRailCard>

      {/* 3. Upcoming Exams Dates */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">
            مواعيد الامتحانات القادمة
          </h2>
          <ClipboardCheck className="h-4 w-4 text-violet-300" />
        </div>
        {upcomingExamsList.length === 0 ? (
          <div className="mt-3 space-y-2 text-xs text-slate-400">
            <p>لا توجد مواعيد امتحانات مجدولة حاليًا.</p>
            <button
              type="button"
              onClick={() => onNavigateTarget({ type: 'EXAM' })}
              className="text-sky-300 font-bold hover:underline"
            >
              عرض جميع الامتحانات ←
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {upcomingExamsList.map((ex) => {
              const dt = ex.startsAt ? formatDayMonthParts(ex.startsAt) : null;
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => onNavigateTarget({ type: 'EXAM', entityId: ex.id })}
                  className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-violet-400/30 bg-gradient-to-l from-[#241A5B]/90 to-[#141848]/90 px-3 py-2.5 text-right hover:border-violet-300/60 transition-all"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-extrabold text-white">{ex.titleAr}</div>
                    <div className="mt-0.5 text-[10.5px] text-slate-300 truncate">
                      {ex.durationMin} دقيقة · نجاح {ex.passScorePercent}%
                    </div>
                  </div>
                  <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-violet-400/40 bg-[#0B1438]/85 text-center leading-tight">
                    {dt ? (
                      <>
                        <span className="font-mono-num text-sm font-extrabold text-white">
                          {dt.day}
                        </span>
                        <span className="text-[9.5px] font-bold text-violet-200 truncate max-w-[40px]">
                          {dt.month}
                        </span>
                      </>
                    ) : (
                      <Award className="h-4 w-4 text-violet-300" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </StudentRailCard>
    </>
  );

  const renderCategorySummaryStatus = (tasks: EvaluatedCurriculumTask[]) => {
    if (tasks.length === 0) return { label: 'غير مضاف', done: false };
    const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
    if (completed === tasks.length) return { label: 'مكتمل', done: true };
    const hasOverdue = tasks.some((t) => t.status === 'OVERDUE');
    if (hasOverdue) return { label: 'متأخر عن الموعد', done: false };
    const hasInProgress = tasks.some((t) => t.status === 'IN_PROGRESS');
    if (hasInProgress) return { label: 'قيد التنفيذ', done: false };
    const hasNotStarted = tasks.some((t) => t.status === 'NOT_STARTED');
    if (hasNotStarted && completed === 0) return { label: 'متاح الآن', done: false };
    return { label: `${completed} / ${tasks.length} مكتمل`, done: false };
  };

  const vidStatus = renderCategorySummaryStatus(weekBuckets.videoTasks);
  const hwStatus = renderCategorySummaryStatus(weekBuckets.homeworkTasks);
  const pdfStatus = renderCategorySummaryStatus(weekBuckets.pdfTasks);
  const examStatus = renderCategorySummaryStatus(weekBuckets.examTasks);

  return (
    <StudentTwoColShell rail={rail} testId="student-curriculum-view">
      {/* 1. Physics Hero Banner */}
      <StudentPageHero
        title={plan.titleAr || 'خطة المنهج'}
        subtitle={
          plan.descriptionAr ||
          'خارطة رحلتك الدراسية منظمة أسبوعيًا لمتابعة الشرح والواجبات والمراجعات والامتحانات حتى نهاية المنهج.'
        }
        icon={<Layers className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.curriculum}
        artworkAlt="خطة المنهج الدراسي"
        chips={[
          { icon: <Calendar className="h-3.5 w-3.5" />, label: plan.academicYearAr },
          { icon: <Layers className="h-3.5 w-3.5" />, label: `${metrics.totalWeeks} أسبوع دراسي` },
          ...(metrics.overdueRequired > 0
            ? [
                {
                  icon: <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />,
                  label: `${metrics.overdueRequired} مهام متأخرة`,
                },
              ]
            : []),
        ]}
      />

      {/* 2. Horizontal Interactive Week Timeline Bar */}
      <div className="rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 px-3 py-3 shadow-[0_8px_24px_rgba(2,8,28,0.42)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="الأسابيع السابقة"
            onClick={() => scrollTimeline('prev')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#10204E] text-slate-200 hover:border-sky-400/50 hover:text-white transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div
            ref={timelineRef}
            className="flex flex-1 items-center gap-2.5 overflow-x-auto pb-1.5 pt-0.5 scroll-smooth"
          >
            {allWeekSummaries.map((ws) => {
              const isSelected = activeWeekSummary?.week.id === ws.week.id;
              const isDone = ws.requiredTotal > 0 && ws.requiredCompleted === ws.requiredTotal;
              const isCurrent = ws.week.id === currentWeekId;
              return (
                <button
                  key={ws.week.id}
                  type="button"
                  onClick={() => {
                    setSelectedWeekId(ws.week.id);
                    setCategoryFilter('ALL');
                    if (filter === 'OVERDUE' && ws.requiredOverdue === 0) setFilter('ALL');
                  }}
                  className={`relative min-w-[144px] max-w-[175px] shrink-0 rounded-xl border px-3.5 py-2.5 text-right transition-all ${
                    isSelected
                      ? 'border-sky-300/80 bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] text-white shadow-[0_0_22px_rgba(37,99,235,0.45)]'
                      : 'border-[#2D4A8A]/50 bg-[#0D1C46]/90 text-slate-200 hover:border-sky-400/50 hover:bg-[#13265A]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                    <span className={isSelected ? 'text-sky-100' : 'text-sky-300'}>
                      الأسبوع {ws.week.weekNumber}
                    </span>
                    {isDone ? (
                      <CheckCircle2
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? 'text-white' : 'text-emerald-400'
                        }`}
                      />
                    ) : isCurrent ? (
                      <span
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                          isSelected ? 'bg-white' : 'bg-sky-400'
                        }`}
                      />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0 opacity-45" />
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs font-extrabold">{ws.week.titleAr}</div>
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-[#2563EB]"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="الأسابيع التالية"
            onClick={() => scrollTimeline('next')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#10204E] text-slate-200 hover:border-sky-400/50 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Filter Strip */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`rounded-lg px-3 py-1 font-bold transition-all ${
                filter === 'ALL'
                  ? 'bg-sky-500/25 text-sky-100 border border-sky-400/45'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              كل الأسابيع ({allWeekSummaries.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilter('CURRENT');
                if (currentWeekId) setSelectedWeekId(currentWeekId);
              }}
              className={`rounded-lg px-3 py-1 font-bold transition-all ${
                filter === 'CURRENT'
                  ? 'bg-sky-500/25 text-sky-100 border border-sky-400/45'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              الأسبوع الحالي
            </button>
            <button
              type="button"
              onClick={() => setFilter('OVERDUE')}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 font-bold transition-all ${
                filter === 'OVERDUE'
                  ? 'bg-rose-600 text-white'
                  : metrics.overdueRequired > 0
                    ? 'bg-rose-500/15 text-rose-200 border border-rose-400/35 hover:bg-rose-500/25'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>المهام المتأخرة ({metrics.overdueRequired})</span>
            </button>
          </div>
          {activeWeekSummary && (
            <span className="text-[11px] text-slate-300">
              {formatArabicFullDate(activeWeekSummary.week.startDate)} —{' '}
              {formatArabicShortDate(activeWeekSummary.week.endDate)}
            </span>
          )}
        </div>
      </div>

      {/* 3. Featured Selected Week Spotlight + 4 Color-Coded Task Cards */}
      {activeWeekSummary && (
        <section className="overflow-hidden rounded-2xl border border-[#4F46E5]/50 bg-gradient-to-b from-[#171D5B]/95 via-[#101A4A]/95 to-[#0B1539]/95 p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.5)] space-y-4">
          {/* Top Split Spotlight */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.95fr] gap-4 items-center">
            {/* Right side (RTL): Week Info + Metrics */}
            <div className="space-y-3 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/45">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/45 bg-violet-500/20 px-2.5 py-0.5 text-[10.5px] font-bold text-violet-200">
                        <Target className="h-3 w-3" />
                        {activeWeekSummary.week.id === currentWeekId
                          ? 'الأسبوع الحالي'
                          : activeWeekSummary.week.status === 'COMPLETED'
                            ? 'مكتمل من الأستاذ'
                            : 'أسبوع مجدول'}
                      </span>
                      {activeWeekSummary.requiredOverdue > 0 && (
                        <span className="rounded-full border border-rose-400/45 bg-rose-500/20 px-2.5 py-0.5 text-[10.5px] font-bold text-rose-200">
                          {activeWeekSummary.requiredOverdue} متأخر
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 font-display text-lg sm:text-2xl font-extrabold text-white leading-snug">
                      الأسبوع {activeWeekSummary.week.weekNumber} : {activeWeekSummary.week.titleAr}
                    </h2>
                  </div>
                </div>
              </div>

              {(activeWeekSummary.week.objectivesAr || activeWeekSummary.week.teacherNotesAr) && (
                <p className="text-xs sm:text-[13px] leading-relaxed text-slate-200/90">
                  {activeWeekSummary.week.objectivesAr || activeWeekSummary.week.teacherNotesAr}
                </p>
              )}

              {/* 3-Metric Glass Bar */}
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/12 bg-[#091435]/80 p-3">
                <div className="border-l border-white/10 pl-2">
                  <div className="flex items-center gap-1 text-[11px] text-slate-300">
                    <ListChecks className="h-3.5 w-3.5 text-sky-300" />
                    <span>المهام</span>
                  </div>
                  <div className="mt-1 font-mono-num text-base font-extrabold text-white">
                    {activeWeekSummary.requiredCompleted} / {activeWeekSummary.requiredTotal}
                  </div>
                </div>

                <div className="border-l border-white/10 pl-2">
                  <div className="flex items-center gap-1 text-[11px] text-slate-300">
                    <Clock className="h-3.5 w-3.5 text-sky-300" />
                    <span>المدة / الدروس</span>
                  </div>
                  <div className="mt-1 font-mono-num text-sm font-extrabold text-white">
                    {weekBuckets.totalDurationSec > 0
                      ? formatDurationAr(weekBuckets.totalDurationSec)
                      : `${weekBuckets.videoTasks.length} درس`}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span>التقدم</span>
                    <span className="font-mono-num font-extrabold text-sky-200">
                      {activeWeekSummary.completionPercent}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      style={{ width: `${activeWeekSummary.completionPercent}%` }}
                      className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-blue-500 transition-all duration-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Left side (RTL): Representative Video/Physics Preview */}
            <div className="relative overflow-hidden rounded-2xl border border-sky-400/35 bg-[#07112B] aspect-[16/9] shadow-[0_10px_28px_rgba(2,8,28,0.55)] group">
              <img
                src={
                  weekBuckets.matchedVideo?.thumbnailUrl ||
                  pickPhysicsArtwork(activeWeekSummary.week.weekNumber)
                }
                alt={activeWeekSummary.week.titleAr}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/90 via-[#060E24]/25 to-transparent" />
              {weekBuckets.firstVideoTask && (
                <button
                  type="button"
                  onClick={() => onOpenTask(weekBuckets.firstVideoTask!)}
                  aria-label="تشغيل شرح الأسبوع"
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-[#1D4ED8] shadow-[0_0_30px_rgba(56,189,248,0.65)] transition-transform group-hover:scale-110">
                    <Play className="h-6 w-6 fill-current mr-0.5" />
                  </span>
                </button>
              )}
              <div className="absolute bottom-3 right-3 left-3 flex items-center justify-between gap-2 text-xs font-bold text-white">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#081330]/85 px-2.5 py-1 backdrop-blur-xs border border-white/15">
                  <PlayCircle className="h-3.5 w-3.5 text-sky-300" />
                  <span className="truncate max-w-[190px]">
                    {weekBuckets.matchedVideo?.titleAr || 'محتوى الأسبوع'}
                  </span>
                </span>
                {weekBuckets.matchedVideo && weekBuckets.matchedVideo.durationSec > 0 && (
                  <span className="rounded-lg bg-[#081330]/85 px-2 py-1 font-mono-num text-[11px] text-sky-200 border border-white/15">
                    {formatDurationAr(weekBuckets.matchedVideo.durationSec)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 4 Color-Coded Week Task Category Cards */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-sm font-extrabold text-white">
                <CalendarDays className="h-4 w-4 text-sky-300" />
                <span>مهام الأسبوع {activeWeekSummary.week.weekNumber}</span>
              </h3>
              {categoryFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setCategoryFilter('ALL')}
                  className="text-xs font-bold text-sky-300 hover:underline"
                >
                  عرض جميع المهام ({activeWeekSummary.tasks.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Blue: الشرح */}
              <button
                type="button"
                onClick={() => handleCategoryClick('VIDEO')}
                className={`flex flex-col justify-between rounded-2xl border p-4 text-right transition-all ${
                  categoryFilter === 'VIDEO'
                    ? 'ring-2 ring-sky-300 border-sky-300'
                    : 'border-sky-400/45 hover:border-sky-300/80'
                } bg-gradient-to-br from-[#0284C7]/90 via-[#1D4ED8]/85 to-[#0C2461]/95 shadow-[0_8px_22px_rgba(2,132,199,0.28)]`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-base font-extrabold text-white">الشرح</div>
                    <div className="mt-0.5 text-xs text-sky-100/90 font-mono-num">
                      {weekBuckets.videoTasks.length} دروس فيديو
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                    <PlayCircle className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-white/95">
                  {vidStatus.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-sky-200" />
                  )}
                  <span>{vidStatus.label}</span>
                </div>
              </button>

              {/* Orange: الواجب */}
              <button
                type="button"
                onClick={() => handleCategoryClick('HOMEWORK')}
                className={`flex flex-col justify-between rounded-2xl border p-4 text-right transition-all ${
                  categoryFilter === 'HOMEWORK'
                    ? 'ring-2 ring-amber-200 border-amber-200'
                    : 'border-orange-400/50 hover:border-orange-300/85'
                } bg-gradient-to-br from-[#EA580C]/90 via-[#C2410C]/85 to-[#431407]/95 shadow-[0_8px_22px_rgba(234,88,12,0.26)]`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-base font-extrabold text-white">الواجب</div>
                    <div className="mt-0.5 text-xs text-orange-100/90 font-mono-num">
                      {weekBuckets.homeworkTasks.length} واجب تطبيقي
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                    <BookCheck className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-white/95">
                  {hwStatus.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-orange-200" />
                  )}
                  <span>{hwStatus.label}</span>
                </div>
              </button>

              {/* Purple: مراجعة PDF */}
              <button
                type="button"
                onClick={() => handleCategoryClick('PDF')}
                className={`flex flex-col justify-between rounded-2xl border p-4 text-right transition-all ${
                  categoryFilter === 'PDF'
                    ? 'ring-2 ring-violet-200 border-violet-200'
                    : 'border-violet-400/50 hover:border-violet-300/85'
                } bg-gradient-to-br from-[#7C3AED]/90 via-[#5B21B6]/85 to-[#2E1065]/95 shadow-[0_8px_22px_rgba(124,58,237,0.28)]`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-base font-extrabold text-white">
                      مراجعة PDF
                    </div>
                    <div className="mt-0.5 text-xs text-violet-100/90 font-mono-num">
                      {weekBuckets.pdfTasks.length} ملخص ومراجعة
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                    <FileText className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-white/95">
                  {pdfStatus.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-violet-200" />
                  )}
                  <span>{pdfStatus.label}</span>
                </div>
              </button>

              {/* Magenta: الامتحان */}
              <button
                type="button"
                onClick={() => handleCategoryClick('EXAM')}
                className={`flex flex-col justify-between rounded-2xl border p-4 text-right transition-all ${
                  categoryFilter === 'EXAM'
                    ? 'ring-2 ring-pink-200 border-pink-200'
                    : 'border-pink-400/50 hover:border-pink-300/85'
                } bg-gradient-to-br from-[#DB2777]/90 via-[#9D174D]/85 to-[#500724]/95 shadow-[0_8px_22px_rgba(219,39,119,0.28)]`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-base font-extrabold text-white">الامتحان</div>
                    <div className="mt-0.5 text-xs text-pink-100/90 font-mono-num">
                      {weekBuckets.examTasks.length} اختبار وتقييم
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                    <Award className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-white/95">
                  {examStatus.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-pink-200" />
                  )}
                  <span>{examStatus.label}</span>
                </div>
              </button>
            </div>

            {/* Full-Width Primary Button matching reference */}
            <button
              type="button"
              onClick={() => setShowFullWeekDetails((prev) => !prev)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] py-2.5 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(37,99,235,0.42)] hover:brightness-110 transition-all"
            >
              {showFullWeekDetails ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  <span>إخفاء قائمة مهام الأسبوع التفصيلية</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  <span>عرض تفاصيل الأسبوع كاملة ({activeWeekSummary.tasks.length} مهام)</span>
                </>
              )}
            </button>

            {/* Detailed Task List for Selected Week */}
            {showFullWeekDetails && (
              <div ref={tasksSectionRef} className="space-y-2 pt-1">
                {activeWeekSummary.week.teacherNotesAr && activeWeekSummary.week.objectivesAr && (
                  <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                    <strong className="text-amber-300">توجيهات الأستاذ: </strong>
                    {activeWeekSummary.week.teacherNotesAr}
                  </div>
                )}

                {displayedTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/15 bg-[#091435]/70 px-4 py-6 text-center text-xs text-slate-300">
                    {filter === 'OVERDUE'
                      ? 'لا توجد مهام متأخرة في هذا الأسبوع.'
                      : 'لا توجد مهام ضمن هذا التصنيف في هذا الأسبوع.'}
                  </div>
                ) : (
                  displayedTasks.map((ev, idx) => {
                    const style = TASK_STYLE_MAP[ev.task.taskType] || TASK_STYLE_MAP.CUSTOM;
                    const isBusy = togglingTaskId === ev.task.id;

                    return (
                      <div
                        key={ev.task.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/12 bg-[#0B173B]/90 px-3.5 py-3 hover:border-sky-400/50 transition-all"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenTask(ev)}
                          className="flex flex-1 items-center gap-3 min-w-0 text-right group"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/12">
                            {ev.status === 'UNAVAILABLE' ? (
                              <Lock className="h-4 w-4 text-amber-300" />
                            ) : (
                              style.icon
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono-num text-[11px] font-bold text-slate-400">
                                {idx + 1}.
                              </span>
                              <span className="text-sm font-extrabold text-white group-hover:text-sky-300 transition-colors truncate">
                                {ev.task.titleAr}
                              </span>
                              <span
                                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${style.badgeClass}`}
                              >
                                {style.labelAr}
                              </span>
                              {!ev.task.isRequired && (
                                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                                  اختياري
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-300">
                              <span className="truncate">{ev.subtitleAr}</span>
                              {ev.effectiveDueAt && (
                                <span className="inline-flex items-center gap-1 text-amber-200/90">
                                  <Clock className="h-3 w-3" />
                                  موعد:{' '}
                                  {new Intl.DateTimeFormat('ar-EG', {
                                    timeZone: 'Africa/Cairo',
                                    day: 'numeric',
                                    month: 'short',
                                  }).format(new Date(ev.effectiveDueAt))}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${statusPillClasses(ev.status)}`}
                          >
                            {ev.statusLabelAr}
                          </span>

                          {ev.canToggleManualReview && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void onToggleManualReview(ev.task.id, !ev.isManuallyReviewed)
                              }
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                                ev.isManuallyReviewed
                                  ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/45 hover:bg-emerald-500/35'
                                  : 'bg-white/10 text-white border border-white/15 hover:bg-white/20'
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>
                                {isBusy
                                  ? '...'
                                  : ev.isManuallyReviewed
                                    ? 'تمت المراجعة'
                                    : 'تحديد كمُراجع'}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenTask(ev)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                          >
                            <span>فتح</span>
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 4. Upcoming Weeks Bottom Strip + Full Plan Toggle */}
      <section className="rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-4 text-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-violet-300" />
            <h3 className="font-display text-sm font-extrabold text-white">الأسابيع القادمة</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowFullPlanDrawer((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/40 bg-violet-500/15 px-3.5 py-1.5 text-xs font-bold text-violet-200 hover:bg-violet-500/25 transition-colors"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{showFullPlanDrawer ? 'إغلاق العرض الكامل' : 'عرض الخطة الكاملة'}</span>
            {showFullPlanDrawer ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {nextWeeks.map((ws) => (
            <button
              key={ws.week.id}
              type="button"
              onClick={() => {
                setSelectedWeekId(ws.week.id);
                setCategoryFilter('ALL');
              }}
              className="flex items-center gap-3 rounded-xl border border-[#2D4A8A]/50 bg-[#0E1E4A]/90 px-3.5 py-3 text-right hover:border-sky-400/60 hover:bg-[#13265A] transition-all"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/35">
                <Calendar className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-sky-300">
                  الأسبوع {ws.week.weekNumber}
                </div>
                <div className="truncate text-xs font-extrabold text-white">{ws.week.titleAr}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Optional Expanded Full Plan Matrix */}
        {showFullPlanDrawer && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
            {allWeekSummaries.map((ws) => (
              <button
                key={ws.week.id}
                type="button"
                onClick={() => {
                  setSelectedWeekId(ws.week.id);
                  setShowFullPlanDrawer(false);
                }}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#081330]/80 px-3.5 py-2.5 text-right hover:border-sky-400/45 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="rounded-lg bg-sky-500/20 px-2 py-0.5 font-mono-num text-xs font-extrabold text-sky-200">
                    أ{ws.week.weekNumber}
                  </span>
                  <span className="truncate text-xs font-bold text-white">{ws.week.titleAr}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-300 shrink-0">
                  <span>
                    {formatArabicShortDate(ws.week.startDate)} —{' '}
                    {formatArabicShortDate(ws.week.endDate)}
                  </span>
                  <span className="font-mono-num font-bold text-emerald-300">
                    {ws.requiredCompleted}/{ws.requiredTotal} ({ws.completionPercent}%)
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </StudentTwoColShell>
  );
};
