import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BookCheck,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  Layers,
  Lock,
  Play,
  PlayCircle,
  Radio,
  Sparkles,
  Target,
  Trophy,
  Video,
} from 'lucide-react';
import type {
  MeResponse,
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../../types/lms.ts';
import {
  buildWeeklyAgenda,
  computeLessonProgressCounts,
  computePublishedResultsAndAverage,
  formatUpcomingDateBadge,
  type StudentNavTarget,
} from '../../lib/studentDashboardMetrics.ts';
import {
  computeAcademicAdherence,
  computeAcademicProgression,
  type CurriculumTaskType,
  type EvaluatedCurriculumTask,
  type EvaluatedWeekSummary,
} from '../../lib/academicPlanEngine.ts';
import { resolveStudentExamStatus } from '../../lib/studentAcademicSignals.ts';
import { StudentLeftColumn } from './StudentLeftColumn.tsx';

interface StudentDashboardHomeProps {
  me: MeResponse;
  data: StudentDashboardData;
  allWeekSummaries: EvaluatedWeekSummary[];
  currentWeekSummary: EvaluatedWeekSummary | null;
  togglingTaskId: number | null;
  onSelectTab: (tab: StudentNavTarget) => void;
  onPreloadTab: (tab: StudentNavTarget) => void;
  onPlayVideo: (video: StudentVideoItem) => void;
  onOpenExam: (examId: number) => void;
  onOpenCurriculumTask: (evaluated: EvaluatedCurriculumTask) => void;
  onToggleManualReview: (taskId: number, isReviewed: boolean) => Promise<void>;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

function formatDurationClock(sec: number): string {
  if (!sec || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatShortArabicDate(ymd: string): string {
  if (!ymd) return '';
  const dt = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(dt);
}

function formatCountdownArabic(targetIso: string, nowMs: number): string | null {
  const diff = new Date(targetIso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `متبقي ${days} يوم و ${hours} ساعة`;
  return `متبقي ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getTaskVisualStyle(type: CurriculumTaskType): {
  dotClass: string;
  labelAr: string;
  icon: React.ReactNode;
} {
  switch (type) {
    case 'VIDEO':
      return {
        dotClass: 'bg-blue-100 text-blue-700',
        labelAr: 'محاضرة',
        icon: <PlayCircle className="h-3.5 w-3.5" />,
      };
    case 'HOMEWORK':
      return {
        dotClass: 'bg-orange-100 text-orange-700',
        labelAr: 'واجب',
        icon: <BookCheck className="h-3.5 w-3.5" />,
      };
    case 'EXAM':
      return {
        dotClass: 'bg-pink-100 text-pink-700',
        labelAr: 'امتحان',
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
      };
    case 'PDF':
      return {
        dotClass: 'bg-emerald-100 text-emerald-700',
        labelAr: 'مذكرة PDF',
        icon: <FileText className="h-3.5 w-3.5" />,
      };
    case 'LIVE_SESSION':
      return {
        dotClass: 'bg-violet-100 text-violet-700',
        labelAr: 'حصة مباشرة',
        icon: <Radio className="h-3.5 w-3.5" />,
      };
    default:
      return {
        dotClass: 'bg-slate-100 text-slate-700',
        labelAr: 'مهمة',
        icon: <Sparkles className="h-3.5 w-3.5" />,
      };
  }
}

function getTaskStatusBadgeClasses(status: EvaluatedCurriculumTask['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-800';
    case 'IN_PROGRESS':
      return 'bg-sky-100 text-sky-800';
    case 'OVERDUE':
      return 'bg-rose-100 text-rose-700';
    case 'UPCOMING':
      return 'bg-violet-100 text-violet-700';
    case 'UNAVAILABLE':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

const ExamCountdownPill: React.FC<{ targetIso: string }> = React.memo(({ targetIso }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetIso]);
  const label = formatCountdownArabic(targetIso, nowMs);
  if (!label) return null;
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 font-mono-num text-[11px] font-extrabold text-violet-700">
      <Clock className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
});

export const StudentDashboardHome: React.FC<StudentDashboardHomeProps> = React.memo(({
  me,
  data,
  allWeekSummaries,
  currentWeekSummary,
  togglingTaskId,
  onSelectTab,
  onPreloadTab,
  onPlayVideo,
  onOpenExam,
  onOpenCurriculumTask,
  onToggleManualReview,
  onNavigateTarget,
}) => {
  const firstName = me.user.fullName.trim().split(/\s+/)[0] || me.user.fullName;

  // Week switcher state for "خطتك هذا الأسبوع"
  const currentWeekIdx = useMemo(() => {
    if (!currentWeekSummary) return 0;
    const idx = allWeekSummaries.findIndex((w) => w.week.id === currentWeekSummary.week.id);
    return idx >= 0 ? idx : 0;
  }, [allWeekSummaries, currentWeekSummary]);

  const [selectedWeekIdx, setSelectedWeekIdx] = useState(currentWeekIdx);
  useEffect(() => {
    setSelectedWeekIdx(currentWeekIdx);
  }, [currentWeekIdx]);

  const selectedWeekSummary = allWeekSummaries[selectedWeekIdx] || currentWeekSummary || null;

  const progression = useMemo(
    () => computeAcademicProgression(data.curriculumPlan || null, currentWeekSummary),
    [data.curriculumPlan, currentWeekSummary],
  );

  const adherence = useMemo(
    () =>
      computeAcademicAdherence(
        data.curriculumPlan || null,
        allWeekSummaries,
        currentWeekSummary,
      ),
    [data.curriculumPlan, allWeekSummaries, currentWeekSummary],
  );

  const todayArabicDate = useMemo(
    () =>
      new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
    [],
  );

  const progress = useMemo(() => computeLessonProgressCounts(data.videos), [data.videos]);
  const homeworkTotal = data.homeworkSummary?.totalCount ?? 0;
  const homeworkCompleted = data.homeworkSummary?.completedCount ?? 0;

  const publishedResults = useMemo(
    () => computePublishedResultsAndAverage(data.recentAttempts, data.homeworkSummary?.items || []),
    [data.recentAttempts, data.homeworkSummary],
  );

  const weeklyAgenda = useMemo(
    () => buildWeeklyAgenda(data.schedules, data.exams, data.homeworkSummary?.items || []),
    [data.schedules, data.exams, data.homeworkSummary],
  );

  const displayCourses = useMemo(() => {
    const unlocked = data.courses.filter((c) => c.isUnlocked);
    return (unlocked.length > 0 ? unlocked : data.courses).slice(0, 2);
  }, [data.courses]);

  const colorTiles: Array<{
    id: StudentNavTarget;
    title: string;
    subtitle: string;
    gradient: string;
    borderGlow: string;
    iconBg: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'schedule',
      title: 'الجدول',
      subtitle: 'مواعيدك الدراسية',
      gradient: 'from-[#8B5CF6] via-[#7C3AED] to-[#5B21B6]',
      borderGlow: 'border-violet-300/60 shadow-[0_8px_22px_rgba(124,58,237,0.42)]',
      iconBg: 'bg-white/20',
      icon: <Calendar className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'practice',
      title: 'بنك الأسئلة',
      subtitle: 'تدريب وحل الأسئلة',
      gradient: 'from-[#22D3EE] via-[#06B6D4] to-[#0284C7]',
      borderGlow: 'border-cyan-200/65 shadow-[0_8px_22px_rgba(6,182,212,0.42)]',
      iconBg: 'bg-white/20',
      icon: <HelpCircle className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'pdfs',
      title: 'المذكرات',
      subtitle: 'ملخصات وملفات',
      gradient: 'from-[#22C55E] via-[#16A34A] to-[#15803D]',
      borderGlow: 'border-emerald-300/60 shadow-[0_8px_22px_rgba(22,163,74,0.42)]',
      iconBg: 'bg-white/20',
      icon: <FileText className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'exams',
      title: 'الامتحانات',
      subtitle: 'الاختبارات والتقييمات',
      gradient: 'from-[#F43F5E] via-[#EC4899] to-[#BE185D]',
      borderGlow: 'border-pink-300/65 shadow-[0_8px_22px_rgba(236,72,153,0.44)]',
      iconBg: 'bg-white/20',
      icon: <ClipboardCheck className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'homework',
      title: 'الواجبات',
      subtitle: 'التكليفات والأنشطة',
      gradient: 'from-[#FB923C] via-[#F97316] to-[#EA580C]',
      borderGlow: 'border-orange-200/65 shadow-[0_8px_22px_rgba(249,115,22,0.44)]',
      iconBg: 'bg-white/20',
      icon: <BookCheck className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'library',
      title: 'الفيديوهات',
      subtitle: 'جميع المحاضرات',
      gradient: 'from-[#38BDF8] via-[#2563EB] to-[#1D4ED8]',
      borderGlow: 'border-sky-300/65 shadow-[0_8px_22px_rgba(37,99,235,0.45)]',
      iconBg: 'bg-white/20',
      icon: <Video className="h-7 w-7 text-white drop-shadow" />,
    },
    {
      id: 'courses',
      title: 'الكورسات',
      subtitle: 'دوراتك المسجلة',
      gradient: 'from-[#9333EA] via-[#7E22CE] to-[#4F46E5]',
      borderGlow: 'border-purple-300/65 shadow-[0_8px_22px_rgba(147,51,234,0.44)]',
      iconBg: 'bg-white/20',
      icon: <GraduationCap className="h-7 w-7 text-white drop-shadow" />,
    },
  ];

  const resumeVideo = data.lastWatchedVideo;

  const recommendedVideoItem = useMemo(() => {
    const task = progression.recommendedTask?.task;
    if (!task || task.taskType !== 'VIDEO' || !task.entityId) return null;
    return data.videos.find((v) => v.id === task.entityId) || null;
  }, [progression.recommendedTask, data.videos]);

  return (
    <div className="flex flex-col xl:flex-row gap-3.5 items-start">
      {/* CENTRAL WORKSPACE (Right/Main area in RTL) */}
      <div className="flex-1 min-w-0 w-full space-y-2.5">
        {/* 1. WIDE PHYSICS WELCOME HERO BANNER */}
        <section
          aria-label="ترحيب الطالب"
          className="relative overflow-hidden rounded-2xl border border-[#3B82F6]/45 bg-gradient-to-l from-[#102359] via-[#1B2268] to-[#0B1742] shadow-[0_10px_30px_rgba(2,8,28,0.55)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-14 right-1/3 h-40 w-64 rounded-full bg-fuchsia-500/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-14 left-1/4 h-36 w-56 rounded-full bg-sky-500/25 blur-3xl"
          />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-3 px-5 py-2.5 sm:px-6 min-h-[126px]">
            <div className="w-full md:w-[45%] text-right z-10">
              <h1 className="font-display text-2xl sm:text-[27px] font-extrabold tracking-tight text-white leading-snug">
                أهلاً بك يا {firstName} <span aria-hidden="true">👋</span>
              </h1>
              <p className="mt-0.5 text-sm font-medium text-sky-100/90">
                جاهز نكمل رحلتك في تعلم الفيزياء؟
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/35 bg-[#0A1A47]/80 px-3 py-1 text-[11.5px] font-semibold text-sky-100">
                  <Calendar className="h-3.5 w-3.5 text-sky-300" />
                  <span>اليوم: {todayArabicDate}</span>
                </span>
                {data.activeGrade && (
                  <span className="inline-flex items-center rounded-full border border-violet-300/30 bg-violet-500/15 px-2.5 py-1 text-[11px] font-bold text-violet-100">
                    {data.activeGrade.trackNameAr} · {data.activeGrade.nameAr}
                  </span>
                )}
              </div>
            </div>

            <div className="relative w-full md:w-[55%] flex justify-center md:justify-end">
              <img
                src="/assets/student-hero-physics.jpg"
                alt="أدوات فيزيائية: بندول نيوتن، كتب الفيزياء، نموذج الذرة، والمغناطيس"
                fetchPriority="high"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-[108px] sm:h-[118px] w-full max-w-[540px] object-contain object-left select-none mix-blend-lighten"
                style={{
                  maskImage:
                    'radial-gradient(ellipse 92% 90% at 50% 50%, black 62%, transparent 100%)',
                  WebkitMaskImage:
                    'radial-gradient(ellipse 92% 90% at 50% 50%, black 62%, transparent 100%)',
                }}
              />
            </div>
          </div>
        </section>

        {/* 2. FIVE HORIZONTAL STATISTICS CARDS */}
        <section
          aria-label="ملخص إحصاءات الطالب"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5"
        >
          {/* Stat 1: التقدم في المنهج */}
          <button
            type="button"
            onClick={() => onNavigateTarget({ type: 'CURRICULUM', curriculumFilter: 'ALL' })}
            className="group rounded-2xl bg-[#F5F8FF] px-3 py-2.5 text-right shadow-[0_6px_20px_rgba(3,10,30,0.35)] ring-1 ring-white/80 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-600 truncate">التقدم في المنهج</div>
                <div className="mt-0.5 font-mono-num text-[21px] font-extrabold text-[#0B162C] leading-tight">
                  {progress.percent}%
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-[#2563EB]">
                <BarChart3 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                style={{ width: `${progress.percent}%` }}
                className="h-full rounded-full bg-gradient-to-l from-[#2563EB] to-[#38BDF8]"
              />
            </div>
          </button>

          {/* Stat 2: الدروس المكتملة */}
          <button
            type="button"
            onClick={() => onSelectTab('library')}
            className="group rounded-2xl bg-[#F5F8FF] px-3 py-2.5 text-right shadow-[0_6px_20px_rgba(3,10,30,0.35)] ring-1 ring-white/80 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-600 truncate">الدروس المكتملة</div>
                <div
                  className="mt-0.5 font-mono-num text-[21px] font-extrabold text-[#0B162C] leading-tight"
                  dir="ltr"
                >
                  {progress.completed} / {progress.total}
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-[#0284C7]">
                <PlayCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-1.5 text-[10.5px] font-medium text-slate-500 truncate">
              {progress.total > 0 ? `${progress.inProgress} جارية الآن` : 'لا توجد دروس متاحة بعد'}
            </div>
          </button>

          {/* Stat 3: الامتحانات */}
          <button
            type="button"
            onClick={() => onSelectTab('exams')}
            onMouseEnter={() => onPreloadTab('exams')}
            className="group rounded-2xl bg-[#F5F8FF] px-3 py-2.5 text-right shadow-[0_6px_20px_rgba(3,10,30,0.35)] ring-1 ring-white/80 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-600 truncate">الامتحانات</div>
                <div className="mt-0.5 font-mono-num text-[21px] font-extrabold text-[#0B162C] leading-tight">
                  {data.exams.length}
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-[#7C3AED]">
                <ClipboardCheck className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-1.5 text-[10.5px] font-medium text-slate-500 truncate">
              {data.exams.length > 0 ? 'امتحان متاح لصفك' : 'لا توجد امتحانات حاليًا'}
            </div>
          </button>

          {/* Stat 4: الواجبات المكتملة */}
          <button
            type="button"
            onClick={() => onSelectTab('homework')}
            onMouseEnter={() => onPreloadTab('homework')}
            className="group rounded-2xl bg-[#F5F8FF] px-3 py-2.5 text-right shadow-[0_6px_20px_rgba(3,10,30,0.35)] ring-1 ring-white/80 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-600 truncate">الواجبات المكتملة</div>
                <div
                  className="mt-0.5 font-mono-num text-[21px] font-extrabold text-[#0B162C] leading-tight"
                  dir="ltr"
                >
                  {homeworkCompleted} / {homeworkTotal}
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-1.5 text-[10.5px] font-medium text-slate-500 truncate">
              {homeworkTotal > 0 ? 'من واجبات صفك' : 'لا توجد واجبات مطلوبة'}
            </div>
          </button>

          {/* Stat 5: متوسط درجاتك */}
          <button
            type="button"
            onClick={() => onSelectTab('results')}
            onMouseEnter={() => onPreloadTab('results')}
            className="col-span-2 sm:col-span-1 group rounded-2xl bg-[#F5F8FF] px-3 py-2.5 text-right shadow-[0_6px_20px_rgba(3,10,30,0.35)] ring-1 ring-white/80 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-600 truncate">متوسط درجاتك</div>
                <div className="mt-0.5 font-mono-num text-[21px] font-extrabold text-[#0B162C] leading-tight">
                  {publishedResults.averageScorePercent !== null
                    ? `${publishedResults.averageScorePercent}%`
                    : '—'}
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <Award className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-1.5 text-[10.5px] font-semibold text-emerald-600 truncate">
              {publishedResults.gradedCount > 0
                ? `من ${publishedResults.gradedCount} تقييم منشور`
                : 'لا توجد نتائج منشورة بعد'}
            </div>
          </button>
        </section>

        {/* 3. SEVEN LARGE COLORFUL NAVIGATION TILES */}
        <section
          aria-label="الأقسام الرئيسية السريعة"
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5"
        >
          {colorTiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => onSelectTab(tile.id)}
              onMouseEnter={() => onPreloadTab(tile.id)}
              onFocus={() => onPreloadTab(tile.id)}
              className={`group relative flex flex-col items-center justify-center rounded-2xl border bg-gradient-to-b ${tile.gradient} ${tile.borderGlow} px-2 py-2.5 text-center text-white transition-all duration-150 hover:-translate-y-1 hover:brightness-110 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300`}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2 top-1 h-4 rounded-full bg-white/15 blur-xs"
              />
              <div
                className={`relative flex h-11 w-11 items-center justify-center rounded-2xl ${tile.iconBg} ring-1 ring-white/30 shadow-inner transition-transform duration-150 group-hover:scale-105`}
              >
                {tile.icon}
              </div>
              <div className="mt-2 font-display text-[13.5px] font-extrabold leading-tight">
                {tile.title}
              </div>
              <div className="mt-0.5 text-[10px] font-medium text-white/90 leading-tight line-clamp-1">
                {tile.subtitle}
              </div>
            </button>
          ))}
        </section>

        {/* 4. MIDDLE ROW: خطتك هذا الأسبوع (Right, #7) + أكمل رحلتك الدراسية (Left, #8) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* RIGHT PANEL: خطتك هذا الأسبوع (#7) */}
          <section
            aria-label="خطتك هذا الأسبوع"
            className="lg:col-span-6 rounded-2xl bg-[#F5F8FF] p-3.5 shadow-[0_8px_24px_rgba(3,10,30,0.35)] ring-1 ring-white/80 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[#6D28D9]">
                  <Target className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-[14.5px] font-extrabold text-[#0B162C] truncate">
                    خطتك هذا الأسبوع
                  </h2>
                </div>
              </div>

              {selectedWeekSummary && allWeekSummaries.length > 0 ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="الأسبوع السابق"
                    disabled={selectedWeekIdx <= 0}
                    onClick={() => setSelectedWeekIdx((i) => Math.max(0, i - 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <span className="rounded-md bg-violet-50 px-2 py-0.5 font-mono-num text-[10.5px] font-extrabold text-[#6D28D9]">
                    أسبوع {selectedWeekSummary.week.weekNumber}
                  </span>
                  <button
                    type="button"
                    aria-label="الأسبوع التالي"
                    disabled={selectedWeekIdx >= allWeekSummaries.length - 1}
                    onClick={() =>
                      setSelectedWeekIdx((i) => Math.min(allWeekSummaries.length - 1, i + 1))
                    }
                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigateTarget({ type: 'CURRICULUM', curriculumFilter: 'ALL' })}
                  className="text-[11px] font-bold text-[#2563EB] hover:underline"
                >
                  خطة المنهج
                </button>
              )}
            </div>

            {!selectedWeekSummary ? (
              <div className="mt-2.5 flex flex-1 min-h-[138px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 p-4 text-center">
                <Layers className="h-6 w-6 text-slate-400" />
                <p className="mt-1.5 text-xs font-extrabold text-slate-700">
                  لم ينشر الأستاذ خطة أسبوعية لهذا الصف بعد
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  يمكنك متابعة محاضراتك وواجباتك المتاحة مباشرة من الأقسام السريعة.
                </p>
                <button
                  type="button"
                  onClick={() => onSelectTab('library')}
                  className="mt-2.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                >
                  تصفح الفيديوهات المتاحة
                </button>
              </div>
            ) : (
              <div className="mt-2 flex-1 flex flex-col">
                {/* Week Meta + Completion Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-[#0B162C] truncate">
                    {selectedWeekSummary.week.titleAr}
                  </span>
                  <span className="text-slate-500">
                    {formatShortArabicDate(selectedWeekSummary.week.startDate)} —{' '}
                    {formatShortArabicDate(selectedWeekSummary.week.endDate)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      style={{ width: `${selectedWeekSummary.completionPercent}%` }}
                      className="h-full rounded-full bg-gradient-to-l from-[#6D28D9] to-[#2563EB] transition-all"
                    />
                  </div>
                  <span className="font-mono-num text-[11px] font-extrabold text-[#0B162C]">
                    {selectedWeekSummary.requiredCompleted}/{selectedWeekSummary.requiredTotal}
                  </span>
                </div>

                {/* Tasks List */}
                <div className="mt-2 flex-1 space-y-1.5 max-h-[188px] overflow-y-auto pl-0.5">
                  {selectedWeekSummary.tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-center text-xs text-slate-500">
                      لا توجد مهام مضافة في هذا الأسبوع بعد.
                    </div>
                  ) : (
                    selectedWeekSummary.tasks.map((ev) => {
                      const style = getTaskVisualStyle(ev.task.taskType);
                      const isBusy = togglingTaskId === ev.task.id;
                      return (
                        <div
                          key={ev.task.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 hover:border-[#2563EB]/60 hover:bg-blue-50/35 transition-all"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenCurriculumTask(ev)}
                            className="flex flex-1 items-center gap-2 min-w-0 text-right group"
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${style.dotClass}`}
                            >
                              {ev.status === 'UNAVAILABLE' ? (
                                <Lock className="h-3.5 w-3.5" />
                              ) : (
                                style.icon
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11.5px] font-extrabold text-[#0B162C] truncate group-hover:text-[#2563EB]">
                                {ev.task.titleAr}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">
                                {style.labelAr} · {ev.subtitleAr}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            {ev.canToggleManualReview && (
                              <button
                                type="button"
                                disabled={isBusy}
                                title={
                                  ev.isManuallyReviewed
                                    ? 'إلغاء تحديد المراجعة'
                                    : 'تحديد كمُراجع'
                                }
                                onClick={() =>
                                  void onToggleManualReview(ev.task.id, !ev.isManuallyReviewed)
                                }
                                className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-colors ${
                                  ev.isManuallyReviewed
                                    ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-emerald-400 hover:text-emerald-600'
                                }`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${getTaskStatusBadgeClasses(ev.status)}`}
                            >
                              {ev.statusLabelAr}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-slate-200/70">
                  <span className="text-[10.5px] text-slate-500">
                    متبقي {selectedWeekSummary.requiredRemaining} مهمة مطلوبة
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateTarget({
                        type: 'CURRICULUM',
                        weekId: selectedWeekSummary.week.id,
                        curriculumFilter: 'ALL',
                      })
                    }
                    className="text-[11px] font-extrabold text-[#2563EB] hover:underline"
                  >
                    فتح الخطة الكاملة ←
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* LEFT PANEL: أكمل رحلتك الدراسية (#8 Academic Progression Engine) */}
          <section
            aria-label="أكمل رحلتك الدراسية"
            className="lg:col-span-6 rounded-2xl bg-[#F5F8FF] p-3.5 shadow-[0_8px_24px_rgba(3,10,30,0.35)] ring-1 ring-white/80 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-[#2563EB]">
                  <PlayCircle className="h-3.5 w-3.5" />
                </div>
                <h2 className="font-display text-[14.5px] font-extrabold text-[#0B162C]">
                  أكمل رحلتك الدراسية
                </h2>
              </div>
              <button
                type="button"
                onClick={() =>
                  onNavigateTarget(
                    progression.hasPlan
                      ? { type: 'CURRICULUM', curriculumFilter: 'CURRENT' }
                      : { type: 'VIDEO' },
                  )
                }
                className="text-[11px] font-bold text-[#2563EB] hover:underline"
              >
                {progression.hasPlan ? 'تفاصيل الأسبوع' : 'كل الدروس'}
              </button>
            </div>

            {/* Stage Progression Strip: المحاضرات ← الواجبات ← الامتحانات */}
            {progression.hasPlan && (
              <div className="mt-2 flex items-center gap-1.5">
                {progression.stages.map((st, idx) => {
                  const targetTab: StudentNavTarget =
                    st.key === 'VIDEOS'
                      ? 'library'
                      : st.key === 'HOMEWORK'
                        ? 'homework'
                        : st.key === 'EXAMS'
                          ? 'exams'
                          : 'curriculum';
                  return (
                    <React.Fragment key={st.key}>
                      <button
                        type="button"
                        onClick={() => onSelectTab(targetTab)}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold transition-all hover:brightness-95 ${
                          st.status === 'DONE'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : st.status === 'ACTIVE'
                              ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {st.status === 'DONE' && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{st.labelAr}</span>
                        {st.total > 0 && (
                          <span className="font-mono-num text-[10px]">
                            ({st.completed}/{st.total})
                          </span>
                        )}
                      </button>
                      {idx < progression.stages.length - 1 && (
                        <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Dynamic Body driven by Academic Progression Engine */}
            {progression.hasPlan ? (
              progression.stageKey === 'COMPLETED' ? (
                <div className="mt-2.5 flex flex-1 flex-col items-center justify-center rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 p-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <h3 className="mt-2 font-display text-sm font-extrabold text-[#0B162C]">
                    {progression.headlineAr}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600">{progression.sublineAr}</p>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateTarget({
                        type: 'CURRICULUM',
                        weekId: progression.nextWeekId ?? undefined,
                        curriculumFilter: 'ALL',
                      })
                    }
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-l from-emerald-600 to-teal-500 px-5 py-1.5 text-xs font-extrabold text-white shadow hover:brightness-110"
                  >
                    <span>{progression.ctaLabelAr}</span>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : progression.recommendedTask ? (
                <div className="mt-2.5 flex flex-col sm:flex-row items-center gap-3 flex-1">
                  <div className="flex-1 min-w-0 w-full text-right">
                    <div className="text-[11px] font-bold text-[#2563EB]">
                      {progression.stageLabelAr}
                    </div>
                    <h3 className="mt-0.5 font-display text-[15px] font-extrabold text-[#0B162C] line-clamp-1">
                      {progression.headlineAr}
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-600 line-clamp-2">
                      {progression.sublineAr}
                    </p>

                    {progression.countdownTargetIso && (
                      <ExamCountdownPill targetIso={progression.countdownTargetIso} />
                    )}

                    {progression.stageKey === 'VIDEOS' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="font-mono-num text-xs font-extrabold text-[#0B162C]">
                          {progression.recommendedTask.progressPercent}%
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                          <div
                            style={{ width: `${progression.recommendedTask.progressPercent}%` }}
                            className="h-full rounded-full bg-gradient-to-l from-[#1D4ED8] to-[#38BDF8]"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenCurriculumTask(progression.recommendedTask!)}
                      className="mt-3 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-5 py-1.5 text-xs font-extrabold text-white shadow-[0_6px_16px_rgba(37,99,235,0.4)] hover:brightness-110 active:scale-[0.98] transition-all"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>{progression.ctaLabelAr}</span>
                    </button>
                  </div>

                  {/* Right visual preview box: video thumbnail if video, else sleek stage tile */}
                  {recommendedVideoItem ? (
                    <button
                      type="button"
                      onClick={() => onPlayVideo(recommendedVideoItem)}
                      aria-label={`تشغيل درس ${recommendedVideoItem.titleAr}`}
                      className="group relative w-full sm:w-[196px] h-[116px] shrink-0 overflow-hidden rounded-xl border border-slate-300/70 bg-[#0A1742] shadow-md"
                    >
                      {recommendedVideoItem.thumbnailUrl ? (
                        <img
                          src={recommendedVideoItem.thumbnailUrl}
                          alt={recommendedVideoItem.titleAr}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0B1E59] via-[#1D4ED8] to-[#4C1D95]">
                          <PlayCircle className="h-9 w-9 text-sky-200/80" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-slate-950/25 flex items-center justify-center group-hover:bg-slate-950/35 transition-colors">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#1D4ED8] shadow-lg">
                          <Play className="h-4 w-4 fill-current" />
                        </span>
                      </div>
                      {recommendedVideoItem.durationSec > 0 && (
                        <span
                          dir="ltr"
                          className="absolute bottom-1.5 left-1.5 rounded-md bg-slate-950/85 px-2 py-0.5 font-mono-num text-[10px] font-bold text-white"
                        >
                          {formatDurationClock(recommendedVideoItem.durationSec)}
                        </span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenCurriculumTask(progression.recommendedTask!)}
                      className={`flex w-full sm:w-[164px] h-[112px] shrink-0 flex-col items-center justify-center rounded-xl border text-white shadow-md transition-transform hover:-translate-y-0.5 ${
                        progression.stageKey === 'HOMEWORK'
                          ? 'border-orange-300/50 bg-gradient-to-br from-orange-500 to-amber-600'
                          : progression.stageKey === 'EXAMS'
                            ? 'border-pink-300/50 bg-gradient-to-br from-pink-600 to-violet-700'
                            : 'border-sky-300/50 bg-gradient-to-br from-blue-600 to-indigo-700'
                      }`}
                    >
                      {progression.stageKey === 'HOMEWORK' ? (
                        <BookCheck className="h-8 w-8" />
                      ) : progression.stageKey === 'EXAMS' ? (
                        <ClipboardCheck className="h-8 w-8" />
                      ) : (
                        <FileText className="h-8 w-8" />
                      )}
                      <span className="mt-2 text-xs font-extrabold">
                        {progression.stageKey === 'HOMEWORK'
                          ? 'الواجب المطلوب'
                          : progression.stageKey === 'EXAMS'
                            ? 'الامتحان الأسبوعي'
                            : 'مهمة المراجعة'}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-2.5 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 p-4 text-center">
                  <p className="text-xs font-bold text-slate-700">{progression.headlineAr}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{progression.sublineAr}</p>
                  <button
                    type="button"
                    onClick={() => onNavigateTarget({ type: 'CURRICULUM', curriculumFilter: 'ALL' })}
                    className="mt-2 rounded-full bg-[#2563EB] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                  >
                    {progression.ctaLabelAr}
                  </button>
                </div>
              )
            ) : resumeVideo ? (
              /* Fallback when no published curriculum plan exists yet: honest resume last watched video */
              <div className="mt-2.5 flex flex-col sm:flex-row items-center gap-3.5 flex-1">
                <div className="flex-1 min-w-0 w-full text-right">
                  <h3 className="font-display text-[15px] font-extrabold text-[#0B162C] line-clamp-1">
                    {resumeVideo.titleAr}
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-600 line-clamp-1">
                    {resumeVideo.unitTitleAr || resumeVideo.lessonTitleAr}
                  </p>

                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="font-mono-num text-sm font-extrabold text-[#0B162C]">
                      {resumeVideo.progress.completionPercent}%
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        style={{ width: `${resumeVideo.progress.completionPercent}%` }}
                        className="h-full rounded-full bg-gradient-to-l from-[#1D4ED8] to-[#38BDF8]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onPlayVideo(resumeVideo)}
                    className="mt-3 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-5 py-1.5 text-xs font-extrabold text-white shadow-[0_6px_16px_rgba(37,99,235,0.4)] hover:brightness-110 active:scale-[0.98] transition-all"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>
                      {resumeVideo.progress.lastPositionSec > 0 ? 'استكمال المشاهدة' : 'بدء المشاهدة'}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onPlayVideo(resumeVideo)}
                  aria-label={`تشغيل درس ${resumeVideo.titleAr}`}
                  className="group relative w-full sm:w-[204px] h-[120px] shrink-0 overflow-hidden rounded-xl border border-slate-300/70 bg-[#0A1742] shadow-md"
                >
                  {resumeVideo.thumbnailUrl ? (
                    <img
                      src={resumeVideo.thumbnailUrl}
                      alt={resumeVideo.titleAr}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0B1E59] via-[#1D4ED8] to-[#4C1D95]">
                      <PlayCircle className="h-10 w-10 text-sky-200/80" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-slate-950/25 flex items-center justify-center group-hover:bg-slate-950/35 transition-colors">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1D4ED8] shadow-lg transition-transform group-hover:scale-110">
                      <Play className="h-4.5 w-4.5 fill-current" />
                    </span>
                  </div>
                  {resumeVideo.durationSec > 0 && (
                    <span
                      dir="ltr"
                      className="absolute bottom-1.5 left-1.5 rounded-md bg-slate-950/85 px-2 py-0.5 font-mono-num text-[10.5px] font-bold text-white"
                    >
                      {formatDurationClock(resumeVideo.durationSec)}
                    </span>
                  )}
                </button>
              </div>
            ) : (
              <div className="mt-2.5 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 p-4 text-center">
                <p className="text-xs font-bold text-slate-700">لم تبدأ مشاهدة أي درس في هذا الصف بعد.</p>
                <button
                  type="button"
                  onClick={() => onSelectTab('library')}
                  className="mt-2 rounded-full bg-[#2563EB] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                >
                  تصفح مكتبة الفيديوهات
                </button>
              </div>
            )}
          </section>
        </div>

        {/* 5. BOTTOM ROW: الامتحانات القادمة (Right) + آخر نتائجي (Center) + كورساتي المسجلة (Left) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3">
          {/* RIGHT: الامتحانات القادمة */}
          <section
            aria-label="الامتحانات القادمة"
            className="lg:col-span-4 rounded-2xl bg-[#F5F8FF] p-3.5 shadow-[0_8px_24px_rgba(3,10,30,0.35)] ring-1 ring-white/80 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#6D28D9]" />
                <h2 className="font-display text-[14.5px] font-extrabold text-[#0B162C]">
                  الامتحانات
                </h2>
              </div>
              <span className="font-mono-num text-[11px] font-bold text-slate-500">
                {data.exams.length}
              </span>
            </div>

            <div className="mt-2.5 flex-1 space-y-2">
              {data.exams.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/75 px-3 py-5 text-center text-xs text-slate-500">
                  لا توجد امتحانات مجدولة أو متاحة حاليًا.
                </div>
              ) : (
                data.exams.slice(0, 3).map((ex) => {
                  const status = resolveStudentExamStatus(ex);
                  const dateBadge =
                    status.code === 'UPCOMING'
                      ? formatUpcomingDateBadge(ex.startsAt)
                      : null;

                  const badgeTone =
                    status.code === 'AVAILABLE'
                      ? 'bg-emerald-100 text-emerald-700'
                      : status.code === 'IN_PROGRESS'
                        ? 'bg-sky-100 text-sky-700'
                        : status.code === 'UPCOMING'
                          ? 'bg-violet-100 text-violet-700'
                          : status.code === 'EXPIRED'
                            ? 'bg-slate-200 text-slate-700'
                            : status.code === 'PENDING_GRADING'
                              ? 'bg-amber-100 text-amber-800'
                              : status.code === 'RESULT_PUBLISHED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800';

                  const badgeLabel = dateBadge ? `قادم · ${dateBadge.label}` : status.labelAr;

                  return (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => {
                        if (status.canStartOrResume) {
                          onOpenExam(ex.id);
                        } else {
                          onNavigateTarget({ type: 'EXAM', entityId: ex.id });
                        }
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200/85 bg-white px-3 py-2 text-right hover:border-[#6D28D9]/50 hover:bg-violet-50/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ClipboardCheck className="h-4 w-4 shrink-0 text-[#6D28D9]" />
                        <span className="text-xs font-bold text-[#0B162C] truncate">{ex.titleAr}</span>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-bold ${badgeTone}`}
                      >
                        {badgeLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectTab('exams')}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-l from-[#5B21B6] to-[#3B82F6] py-1.5 text-xs font-extrabold text-white hover:brightness-110 transition-all"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>عرض كل الامتحانات</span>
            </button>
          </section>

          {/* CENTER: آخر نتائجي (Strictly Published Only) */}
          <section
            aria-label="آخر نتائجي"
            className="lg:col-span-4 rounded-2xl bg-[#F5F8FF] p-3.5 shadow-[0_8px_24px_rgba(3,10,30,0.35)] ring-1 ring-white/80 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="font-display text-[14.5px] font-extrabold text-[#0B162C]">آخر نتائجي</h2>
              </div>
              <span className="font-mono-num text-[11px] font-bold text-slate-500">
                {publishedResults.gradedCount}
              </span>
            </div>

            <div className="mt-2 flex-1 space-y-1.5">
              {publishedResults.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/75 px-3 py-4 text-center text-xs text-slate-500">
                  لم تُنشر درجات امتحانات أو واجبات بعد.
                </div>
              ) : (
                publishedResults.items.slice(0, 3).map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => {
                      if (res.kind === 'HOMEWORK') {
                        const hwId = Number(res.id.replace('hw-', ''));
                        if (Number.isInteger(hwId) && hwId > 0) {
                          onNavigateTarget({ type: 'HOMEWORK', entityId: hwId });
                          return;
                        }
                      }
                      if (res.kind === 'EXAM') {
                        const examId = Number(res.id.replace('exam-', ''));
                        if (Number.isInteger(examId) && examId > 0) {
                          onNavigateTarget({ type: 'RESULTS', entityId: examId });
                          return;
                        }
                      }
                      onSelectTab('results');
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200/85 bg-white px-2.5 py-1.5 text-right hover:border-[#2563EB]/50 hover:bg-blue-50/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Award
                        className={`h-3.5 w-3.5 shrink-0 ${
                          res.kind === 'EXAM' ? 'text-[#6D28D9]' : 'text-[#2563EB]'
                        }`}
                      />
                      <span className="text-[11.5px] font-bold text-[#0B162C] truncate">
                        {res.titleAr}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 font-mono-num text-[11px] font-extrabold ${
                        res.percent >= 80
                          ? 'bg-emerald-100 text-emerald-700'
                          : res.percent >= 50
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {res.percent}%
                    </span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectTab('results')}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-l from-[#1E3A8A] to-[#2563EB] py-1.5 text-xs font-extrabold text-white hover:brightness-110 transition-all"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>عرض كل النتائج</span>
            </button>
          </section>

          {/* LEFT: كورساتي المسجلة / الكورسات المتاحة */}
          <section
            aria-label="كورساتي"
            className="md:col-span-2 lg:col-span-4 rounded-2xl bg-[#F5F8FF] p-3.5 shadow-[0_8px_24px_rgba(3,10,30,0.35)] ring-1 ring-white/80 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-[#7C3AED]" />
                <h2 className="font-display text-[14.5px] font-extrabold text-[#0B162C]">
                  {(() => {
                    const unlockedCount = data.courses.filter((c) => c.isUnlocked).length;
                    if (unlockedCount > 0) return `كورساتي المسجلة (${unlockedCount})`;
                    return data.courses.length > 0
                      ? `الكورسات المتاحة (${data.courses.length})`
                      : 'كورساتي المسجلة (0)';
                  })()}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onSelectTab('courses')}
                className="text-[11px] font-bold text-[#2563EB] hover:underline"
              >
                عرض الكل
              </button>
            </div>

            <div className="mt-2 flex-1">
              {displayCourses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/75 px-3 py-4 text-center text-xs text-slate-500">
                  لا توجد كورسات منشورة لهذا الصف حاليًا.
                </div>
              ) : (
                <div
                  className={`grid gap-2 h-full ${
                    displayCourses.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  }`}
                >
                  {displayCourses.map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      onClick={() => onNavigateTarget({ type: 'COURSE', entityId: course.id })}
                      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-right hover:border-[#2563EB]/60 hover:shadow-md transition-all"
                    >
                      <div className="relative h-[78px] w-full overflow-hidden bg-[#0A1742]">
                        {course.thumbnailUrl ? (
                          <img
                            src={course.thumbnailUrl}
                            alt={course.titleAr}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1E1B4B] via-[#312E81] to-[#1D4ED8]">
                            <BookOpen className="h-6 w-6 text-sky-300" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col justify-between p-2">
                        <div className="font-display text-xs font-extrabold text-[#0B162C] line-clamp-1 group-hover:text-[#2563EB]">
                          {course.titleAr}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-white">
                            <Play className="h-2.5 w-2.5 fill-current" />
                          </span>
                          <span className="font-mono-num text-[11px] font-extrabold text-[#0B162C]">
                            {course.progressPercent}%
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              style={{ width: `${course.progressPercent}%` }}
                              className="h-full rounded-full bg-gradient-to-l from-[#2563EB] to-[#38BDF8]"
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* LEFT INFORMATION COLUMN (Dark glowing widgets) */}
      <StudentLeftColumn
        progress={progress}
        adherence={adherence}
        weeklyAgenda={weeklyAgenda}
        announcements={data.announcements || []}
        onSelectTab={onSelectTab}
        onNavigateTarget={onNavigateTarget}
      />
    </div>
  );
});
