import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  HelpCircle,
  Layers,
  Lightbulb,
  Lock,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Star,
  Trophy,
  XCircle,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import {
  ATTEMPT_STATUS_LABELS,
  EXAM_TYPE_LABELS,
  type StudentPhase2ExamCard,
} from '../types/exams.ts';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentProgressRing,
  StudentRailCard,
  StudentTwoColShell,
  StudentWhiteCard,
  pickPhysicsArtwork,
} from './student/StudentUiPrimitives.tsx';

import type { StudentDeepLinkTarget } from '../types/lms.ts';

interface StudentExamsListResponse {
  serverNow: string;
  exams: StudentPhase2ExamCard[];
}

interface StudentExamsHubProps {
  gradeId?: number;
  onOpenExam: (examId: number) => void;
  onOpenResults: (examId?: number) => void;
  onNavigateTarget?: (target: StudentDeepLinkTarget) => void;
}

type FilterBucket =
  | 'ALL'
  | 'AVAILABLE_ALL'
  | 'UPCOMING'
  | 'COMPLETED'
  | 'AWAITING_RESULT'
  | 'EXPIRED'
  | 'LOCKED';

type DisplayBucket = 'IN_PROGRESS' | 'AVAILABLE' | 'UPCOMING' | 'COMPLETED' | 'EXPIRED' | 'LOCKED';

/**
 * Truthfully distinguishes EXPIRED/CLOSED exams (0 attempts & deadline passed) from COMPLETED exams.
 */
function resolveDisplayBucket(ex: StudentPhase2ExamCard, nowMs: number): DisplayBucket {
  if (ex.bucket === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (ex.bucket === 'AVAILABLE') return 'AVAILABLE';
  if (ex.bucket === 'UPCOMING') return 'UPCOMING';

  const ended = ex.endsAt ? new Date(ex.endsAt).getTime() < nowMs : false;
  if (ex.attemptsUsed === 0 && ended) {
    return 'EXPIRED';
  }
  if (ex.bucket === 'COMPLETED' && ex.attemptsUsed > 0) {
    return 'COMPLETED';
  }
  if (ex.bucket === 'LOCKED' && ended && ex.attemptsUsed === 0) {
    return 'EXPIRED';
  }
  return ex.bucket === 'COMPLETED' ? 'COMPLETED' : 'LOCKED';
}

function isAwaitingResult(ex: StudentPhase2ExamCard): boolean {
  return Boolean(
    ex.latestAttempt &&
      ex.latestAttempt.status !== 'IN_PROGRESS' &&
      !ex.latestAttempt.resultPublished,
  );
}

export const StudentExamsHub: React.FC<StudentExamsHubProps> = ({
  gradeId,
  onOpenExam,
  onOpenResults,
  onNavigateTarget,
}) => {
  const [exams, setExams] = useState<StudentPhase2ExamCard[]>([]);
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterBucket>('ALL');

  const loadExams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = gradeId ? `?gradeId=${gradeId}` : '';
      const res = await apiRequest<StudentExamsListResponse>(`/api/exams/student/list${qs}`);
      setExams(res.exams || []);
      if (res.serverNow) {
        const parsed = new Date(res.serverNow).getTime();
        if (Number.isFinite(parsed)) setServerNowMs(parsed);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gradeId]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const enrichedExams = useMemo(
    () =>
      exams.map((ex) => ({
        ex,
        displayBucket: resolveDisplayBucket(ex, serverNowMs),
        awaiting: isAwaitingResult(ex),
      })),
    [exams, serverNowMs],
  );

  const stats = useMemo(() => {
    const availableCount = enrichedExams.filter(
      (i) => i.displayBucket === 'AVAILABLE' || i.displayBucket === 'IN_PROGRESS',
    ).length;
    const upcomingCount = enrichedExams.filter((i) => i.displayBucket === 'UPCOMING').length;
    const completedCount = enrichedExams.filter((i) => i.displayBucket === 'COMPLETED').length;
    const awaitingCount = enrichedExams.filter((i) => i.awaiting).length;
    const expiredCount = enrichedExams.filter((i) => i.displayBucket === 'EXPIRED').length;
    const lockedCount = enrichedExams.filter((i) => i.displayBucket === 'LOCKED').length;

    const totalCount = enrichedExams.length;
    const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Real published average across completed exams
    const publishedPercents = enrichedExams
      .map((i) => {
        const a = i.ex.latestAttempt;
        if (!a || !a.resultPublished || a.totalScore === null || !a.maxScore) return null;
        return Math.round((a.totalScore / a.maxScore) * 100);
      })
      .filter((p): p is number => p !== null);

    const avgPublishedPercent =
      publishedPercents.length > 0
        ? Math.round(publishedPercents.reduce((s, p) => s + p, 0) / publishedPercents.length)
        : null;

    return {
      totalCount,
      availableCount,
      upcomingCount,
      completedCount,
      awaitingCount,
      expiredCount,
      lockedCount,
      remainingCount: Math.max(0, totalCount - completedCount),
      completionPct,
      avgPublishedPercent,
      publishedCount: publishedPercents.length,
    };
  }, [enrichedExams]);

  // Featured Exam Spotlight: prefer IN_PROGRESS, then AVAILABLE
  const featuredItem = useMemo(() => {
    return (
      enrichedExams.find((i) => i.displayBucket === 'IN_PROGRESS') ||
      enrichedExams.find((i) => i.displayBucket === 'AVAILABLE') ||
      null
    );
  }, [enrichedExams]);

  const sections = useMemo(() => {
    const defs: Array<{
      id: string;
      bucketFilter: FilterBucket;
      title: string;
      icon: React.ReactNode;
      items: typeof enrichedExams;
      cardVariant: 'UPCOMING' | 'COMPLETED' | 'AVAILABLE' | 'OTHER';
    }> = [
      {
        id: 'available',
        bucketFilter: 'AVAILABLE_ALL',
        title: 'الامتحانات المتاحة وقيد الحل',
        icon: <PlayCircle className="h-4 w-4 text-sky-300" />,
        items: enrichedExams.filter(
          (i) => i.displayBucket === 'IN_PROGRESS' || i.displayBucket === 'AVAILABLE',
        ),
        cardVariant: 'AVAILABLE',
      },
      {
        id: 'upcoming',
        bucketFilter: 'UPCOMING',
        title: 'الامتحانات القادمة',
        icon: <CalendarClock className="h-4 w-4 text-violet-300" />,
        items: enrichedExams.filter((i) => i.displayBucket === 'UPCOMING'),
        cardVariant: 'UPCOMING',
      },
      {
        id: 'completed',
        bucketFilter: 'COMPLETED',
        title: 'الامتحانات المكتملة',
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
        items: enrichedExams.filter((i) => i.displayBucket === 'COMPLETED'),
        cardVariant: 'COMPLETED',
      },
      {
        id: 'awaiting',
        bucketFilter: 'AWAITING_RESULT',
        title: 'امتحانات بانتظار اعتماد النتيجة',
        icon: <Clock className="h-4 w-4 text-amber-300" />,
        items: enrichedExams.filter((i) => i.awaiting),
        cardVariant: 'COMPLETED',
      },
      {
        id: 'expired',
        bucketFilter: 'EXPIRED',
        title: 'امتحانات منتهية / مغلقة',
        icon: <XCircle className="h-4 w-4 text-rose-300" />,
        items: enrichedExams.filter((i) => i.displayBucket === 'EXPIRED'),
        cardVariant: 'OTHER',
      },
      {
        id: 'locked',
        bucketFilter: 'LOCKED',
        title: 'امتحانات مقفلة حاليًا',
        icon: <Lock className="h-4 w-4 text-slate-300" />,
        items: enrichedExams.filter((i) => i.displayBucket === 'LOCKED'),
        cardVariant: 'OTHER',
      },
    ];

    if (filter === 'ALL') {
      // Avoid duplicating awaiting inside ALL since they already appear under COMPLETED
      return defs.filter((d) => d.id !== 'awaiting' && d.items.length > 0);
    }
    return defs.filter((d) => d.bucketFilter === filter && d.items.length > 0);
  }, [enrichedExams, filter]);

  const rail = (
    <>
      {/* 1. Exam Progress Ring */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">تقدمك في الامتحانات</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFilter('COMPLETED')}
              className="flex items-center gap-2 text-slate-200 hover:text-white transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.completedCount}</strong> مكتملة
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('AWAITING_RESULT')}
              className="flex items-center gap-2 text-slate-200 hover:text-white transition-colors"
            >
              <Clock className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.awaitingCount}</strong> بانتظار
                النتيجة
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('AVAILABLE_ALL')}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
            >
              <ClipboardList className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.remainingCount}</strong> متبقية
              </span>
            </button>
          </div>
          <StudentProgressRing percent={stats.completionPct} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          <span>عرض جميع الامتحانات ({stats.totalCount})</span>
        </button>
      </StudentRailCard>

      {/* 2. Conditional Performance Trophy Card (ONLY when real published results exist) */}
      {stats.avgPublishedPercent !== null && (
        <StudentRailCard glow="purple" className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-violet-500/30 text-amber-300 ring-1 ring-amber-300/40 shadow-[0_0_24px_rgba(251,191,36,0.28)]">
            <Trophy className="h-6 w-6" />
          </div>
          <h3 className="mt-3 font-display text-base font-extrabold text-white">
            {stats.avgPublishedPercent >= 85
              ? 'أداؤك ممتاز!'
              : stats.avgPublishedPercent >= 65
                ? 'مستوى جيد جدًا'
                : 'استمر في التدريب'}
          </h3>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
            متوسط نتائجك المنشورة{' '}
            <strong className="font-mono-num text-sky-300">{stats.avgPublishedPercent}%</strong> من{' '}
            <strong className="font-mono-num text-white">{stats.publishedCount}</strong> اختبار منشور
          </p>
          <button
            type="button"
            onClick={() => onOpenResults()}
            className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] via-[#3B82F6] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>عرض تقارير الأداء</span>
          </button>
        </StudentRailCard>
      )}

      {/* 3. Exam Tips Card */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h3 className="font-display text-sm font-extrabold text-white">نصائح للاختبارات</h3>
          <Lightbulb className="h-4 w-4 text-sky-300" />
        </div>
        <ul className="mt-3 space-y-2.5 text-xs text-slate-200">
          {[
            'راجع ملخصات الوحدة والقوانين جيدًا قبل البدء',
            'اقرأ تعليمات الامتحان والزمن المحدد بدقة',
            'تُحفظ إجاباتك تلقائيًا أثناء الحل',
            'راجع أسئلتك قبل الضغط على تسليم الامتحان',
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </StudentRailCard>
    </>
  );

  const renderWhiteSplitExamCard = (
    item: (typeof enrichedExams)[number],
    idx: number,
  ) => {
    const { ex, displayBucket } = item;
    const latest = ex.latestAttempt;
    const publishedPct =
      latest && latest.resultPublished && latest.totalScore !== null && latest.maxScore > 0
        ? Math.round((latest.totalScore / latest.maxScore) * 100)
        : null;

    const badgeInfo =
      displayBucket === 'IN_PROGRESS'
        ? { text: 'قيد الحل', cls: 'bg-amber-500 text-slate-950' }
        : displayBucket === 'AVAILABLE'
          ? { text: 'متاح الآن', cls: 'bg-sky-500 text-white' }
          : displayBucket === 'UPCOMING'
            ? { text: 'قادم', cls: 'bg-violet-600 text-white' }
            : displayBucket === 'COMPLETED'
              ? { text: 'مكتمل', cls: 'bg-emerald-500 text-white' }
              : displayBucket === 'EXPIRED'
                ? { text: 'منتهي', cls: 'bg-rose-600 text-white' }
                : { text: 'مقفل', cls: 'bg-slate-600 text-white' };

    return (
      <StudentWhiteCard
        key={ex.id}
        className="overflow-hidden p-3 sm:p-3.5 transition-all hover:-translate-y-0.5"
      >
        <article
          data-testid={`student-exam-card-${ex.id}`}
          className="flex flex-col sm:flex-row items-stretch gap-3.5"
        >
          {/* Right side (RTL): Info + Meta + Action */}
          <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-display text-sm sm:text-base font-extrabold text-[#0B162C] leading-snug">
                    {ex.titleAr}
                  </h4>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                    {EXAM_TYPE_LABELS[ex.examType] || ex.examType}
                    {ex.lessonTitleAr ? ` · ${ex.lessonTitleAr}` : ''}
                  </div>
                </div>
              </div>

              {ex.unitTitleAr && (
                <div className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 text-[10.5px] font-bold text-[#1D4ED8]">
                  <Layers className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[210px]">{ex.unitTitleAr}</span>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-600">
                <span className="inline-flex items-center gap-1 font-mono-num">
                  <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                  {ex.durationMin} دقيقة
                </span>
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1 font-mono-num">
                  <HelpCircle className="h-3.5 w-3.5 text-[#2563EB]" />
                  {ex.questionCount} سؤال
                </span>
                <span className="text-slate-300">|</span>
                <span className="font-mono-num">
                  المحاولات: {ex.attemptsUsed}/{ex.maxAttempts}
                </span>
              </div>

              {(ex.startsAt || ex.endsAt) && (
                <div className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
                  <Calendar className="h-3 w-3 text-violet-500 shrink-0" />
                  <span className="truncate">
                    {ex.startsAt
                      ? `يبدأ: ${formatDateTimeAr(ex.startsAt)}`
                      : `ينتهي: ${formatDateTimeAr(ex.endsAt!)}`}
                  </span>
                </div>
              )}

              {ex.lockReasonAr && !ex.canStart && (
                <div className="mt-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[10.5px] font-semibold text-slate-600">
                  {ex.lockReasonAr}
                </div>
              )}
            </div>

            {/* Action Button */}
            <div className="pt-1">
              {displayBucket === 'IN_PROGRESS' && ex.canStart ? (
                <button
                  type="button"
                  onClick={() => onOpenExam(ex.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>استئناف المحاولة الآن</span>
                </button>
              ) : ex.canStart ? (
                <button
                  type="button"
                  onClick={() => onOpenExam(ex.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>
                    {ex.attemptsUsed > 0 ? 'بدء محاولة جديدة' : 'عرض التعليمات وبدء الامتحان'}
                  </span>
                </button>
              ) : displayBucket === 'COMPLETED' ? (
                <button
                  type="button"
                  onClick={() => onOpenResults(ex.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-500"
                >
                  <Award className="h-3.5 w-3.5" />
                  <span>عرض النتيجة والتفاصيل</span>
                </button>
              ) : displayBucket === 'UPCOMING' ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-violet-100 px-3 py-1.5 text-[11px] font-extrabold text-violet-800">
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span>يُفتح تلقائيًا في موعده</span>
                </span>
              ) : displayBucket === 'EXPIRED' ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-100 px-3 py-1.5 text-[11px] font-extrabold text-rose-800">
                  <XCircle className="h-3.5 w-3.5" />
                  <span>انتهى موعد الامتحان ولم يتم الحل</span>
                </span>
              ) : onNavigateTarget && ex.lockReasonAr && /فيديو|الدرس|مشاهدة/.test(ex.lockReasonAr) ? (
                <button
                  type="button"
                  onClick={() => onNavigateTarget({ type: 'VIDEO' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100 transition-colors"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  <span>استكمال الدرس المطلوب أولًا</span>
                </button>
              ) : onNavigateTarget && ex.lockReasonAr && /اشتراك|كورس|تفعيل/.test(ex.lockReasonAr) ? (
                <button
                  type="button"
                  onClick={() => onNavigateTarget({ type: 'BILLING' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 py-1.5 text-[11px] font-extrabold text-violet-900 hover:bg-violet-100 transition-colors"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>تفعيل الاشتراك أو الكود</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700">
                  <Lock className="h-3.5 w-3.5" />
                  <span>غير متاح للبدء حاليًا</span>
                </span>
              )}
            </div>
          </div>

          {/* Center Score Ring for COMPLETED cards (matching 07_Exams.png) */}
          {displayBucket === 'COMPLETED' && (
            <div className="flex sm:flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-100/90 px-3 py-2 shrink-0 min-w-[88px]">
              {publishedPct !== null && latest ? (
                <>
                  <span className="text-[10px] font-bold text-slate-500">النتيجة</span>
                  <StudentProgressRing
                    percent={publishedPct}
                    size={58}
                    strokeWidth={6}
                    variant="light"
                    accent={latest.passed ? 'emerald-cyan' : 'amber'}
                  />
                  <span className="font-mono-num text-[10.5px] font-extrabold text-[#0B162C]">
                    {latest.totalScore} من {latest.maxScore}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                      latest.passed
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    <Star className="h-2.5 w-2.5 fill-current" />
                    {latest.passed ? 'ناجح' : 'مراجعة'}
                  </span>
                </>
              ) : (
                <div className="text-center space-y-1">
                  <Clock className="mx-auto h-5 w-5 text-amber-600" />
                  <div className="text-[10.5px] font-extrabold text-amber-800 leading-tight">
                    {latest
                      ? ATTEMPT_STATUS_LABELS[latest.status] || 'بانتظار النتيجة'
                      : 'بانتظار النتيجة'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Left side (RTL): Physics Art Thumbnail + Status Pill */}
          <div className="relative w-full sm:w-32 h-28 sm:h-auto shrink-0 overflow-hidden rounded-xl bg-[#07112B]">
            <img
              src={pickPhysicsArtwork(ex.id + idx)}
              alt={ex.titleAr}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/75 via-transparent to-[#060E24]/25" />
            <span
              className={`absolute top-2 right-2 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm ${badgeInfo.cls}`}
            >
              {badgeInfo.text}
            </span>
          </div>
        </article>
      </StudentWhiteCard>
    );
  };

  return (
    <StudentTwoColShell rail={rail} testId="student-exams-hub">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="الامتحانات والتقييمات"
        subtitle="اختبارات الدروس والوحدات والامتحانات الشهرية والشاملة بنظام وقت دقيق وحفظ تلقائي للإجابات."
        icon={<ClipboardList className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.exams}
        artworkAlt="الامتحانات والتقييمات"
      />

      {/* 2. Four Soft-Tinted Light KPI Cards matching 07_Exams.png */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setFilter(filter === 'AVAILABLE_ALL' ? 'ALL' : 'AVAILABLE_ALL')}
          className={`flex items-center justify-between gap-2 rounded-2xl border p-3.5 text-right transition-all ${
            filter === 'AVAILABLE_ALL'
              ? 'border-sky-400 ring-2 ring-sky-400/50'
              : 'border-white/80 hover:-translate-y-0.5'
          } bg-gradient-to-l from-[#E8F4FF] to-[#D9ECFF] text-[#0B162C] shadow-[0_8px_22px_rgba(2,8,28,0.38)]`}
        >
          <div>
            <div className="text-xs font-extrabold text-slate-700">متاحة الآن</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
              {stats.availableCount}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">امتحان</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[#0284C7]">
            <PlayCircle className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'UPCOMING' ? 'ALL' : 'UPCOMING')}
          className={`flex items-center justify-between gap-2 rounded-2xl border p-3.5 text-right transition-all ${
            filter === 'UPCOMING'
              ? 'border-violet-400 ring-2 ring-violet-400/50'
              : 'border-white/80 hover:-translate-y-0.5'
          } bg-gradient-to-l from-[#F3EFFF] to-[#E9E4FF] text-[#0B162C] shadow-[0_8px_22px_rgba(2,8,28,0.38)]`}
        >
          <div>
            <div className="text-xs font-extrabold text-slate-700">قادمة</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
              {stats.upcomingCount}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">امتحان</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-600">
            <CalendarClock className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'COMPLETED' ? 'ALL' : 'COMPLETED')}
          className={`flex items-center justify-between gap-2 rounded-2xl border p-3.5 text-right transition-all ${
            filter === 'COMPLETED'
              ? 'border-emerald-400 ring-2 ring-emerald-400/50'
              : 'border-white/80 hover:-translate-y-0.5'
          } bg-gradient-to-l from-[#E7FAF2] to-[#D6F5E7] text-[#0B162C] shadow-[0_8px_22px_rgba(2,8,28,0.38)]`}
        >
          <div>
            <div className="text-xs font-extrabold text-slate-700">مكتملة</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
              {stats.completedCount}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">امتحان</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'AWAITING_RESULT' ? 'ALL' : 'AWAITING_RESULT')}
          className={`flex items-center justify-between gap-2 rounded-2xl border p-3.5 text-right transition-all ${
            filter === 'AWAITING_RESULT'
              ? 'border-indigo-400 ring-2 ring-indigo-400/50'
              : 'border-white/80 hover:-translate-y-0.5'
          } bg-gradient-to-l from-[#F0F2FF] to-[#E4E8FF] text-[#0B162C] shadow-[0_8px_22px_rgba(2,8,28,0.38)]`}
        >
          <div>
            <div className="text-xs font-extrabold text-slate-700">بانتظار النتيجة</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
              {stats.awaitingCount}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">امتحان</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600">
            <Clock className="h-5 w-5" />
          </span>
        </button>
      </div>

      {/* 3. Segmented Filter Pill Bar + Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: `الكل (${stats.totalCount})` },
              { id: 'AVAILABLE_ALL', label: `متاحة الآن (${stats.availableCount})` },
              { id: 'UPCOMING', label: `قادمة (${stats.upcomingCount})` },
              { id: 'COMPLETED', label: `مكتملة (${stats.completedCount})` },
              ...(stats.expiredCount > 0
                ? [{ id: 'EXPIRED' as const, label: `منتهية / مغلقة (${stats.expiredCount})` }]
                : []),
              ...(stats.lockedCount > 0
                ? [{ id: 'LOCKED' as const, label: `مقفلة (${stats.lockedCount})` }]
                : []),
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-[0_4px_14px_rgba(37,99,235,0.42)]'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void loadExams()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/15"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>تحديث</span>
        </button>
      </div>

      {/* 4. Featured Available / In-Progress Exam Spotlight */}
      {featuredItem && !loading && (filter === 'ALL' || filter === 'AVAILABLE_ALL') && (
        <section className="overflow-hidden rounded-2xl border border-[#4F46E5]/55 bg-gradient-to-l from-[#12225B] via-[#1C1E66] to-[#0B163C] p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.5)]">
          <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.85fr] gap-5 items-center">
            {/* Right side (RTL): Featured Exam Info + Start CTA */}
            <div className="space-y-3 min-w-0">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40">
                  <ClipboardList className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-lg sm:text-xl font-extrabold text-white leading-snug">
                    {featuredItem.ex.titleAr}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span>
                      {EXAM_TYPE_LABELS[featuredItem.ex.examType] || featuredItem.ex.examType}
                    </span>
                    {featuredItem.ex.unitTitleAr && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-bold text-sky-200">
                        <Layers className="h-3 w-3" />
                        {featuredItem.ex.unitTitleAr}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata + Button Row */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenExam(featuredItem.ex.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-6 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,0.45)] hover:brightness-110"
                >
                  {featuredItem.displayBucket === 'IN_PROGRESS' ? (
                    <>
                      <RotateCcw className="h-4 w-4" />
                      <span>استئناف المحاولة</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-current" />
                      <span>عرض التعليمات وبدء الامتحان</span>
                    </>
                  )}
                </button>

                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/12 bg-[#091435]/80 px-4 py-2 text-xs">
                  <div>
                    <div className="text-[10.5px] text-slate-400">مدة الامتحان</div>
                    <div className="font-mono-num font-extrabold text-white">
                      {featuredItem.ex.durationMin} دقيقة
                    </div>
                  </div>
                  <div className="h-7 w-px bg-white/10" />
                  <div>
                    <div className="text-[10.5px] text-slate-400">عدد الأسئلة</div>
                    <div className="font-mono-num font-extrabold text-white">
                      {featuredItem.ex.questionCount} سؤالًا
                    </div>
                  </div>
                  <div className="h-7 w-px bg-white/10" />
                  <div>
                    <div className="text-[10.5px] text-slate-400">المحاولات المتبقية</div>
                    <div className="font-mono-num font-extrabold text-sky-300">
                      {Math.max(0, featuredItem.ex.maxAttempts - featuredItem.ex.attemptsUsed)} من{' '}
                      {featuredItem.ex.maxAttempts}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Left side (RTL): Physics Art Card */}
            <button
              type="button"
              onClick={() => onOpenExam(featuredItem.ex.id)}
              aria-label={`فتح امتحان ${featuredItem.ex.titleAr}`}
              className="group relative overflow-hidden rounded-2xl border border-violet-400/35 bg-[#081234] aspect-[16/9] text-right"
            >
              <img
                src={STUDENT_ARTWORK.exams}
                alt={featuredItem.ex.titleAr}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/75 via-transparent to-transparent" />
              <span
                className={`absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold shadow-md ${
                  featuredItem.displayBucket === 'IN_PROGRESS'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-amber-400/95 text-slate-950'
                }`}
              >
                <Play className="h-3 w-3 fill-current" />
                {featuredItem.displayBucket === 'IN_PROGRESS' ? 'قيد الحل' : 'متاح الآن'}
              </span>
            </button>
          </div>
        </section>
      )}

      {/* 5. Sections List */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-white/10 bg-[#0E1E4A]/70"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-950/60 p-6 text-sm text-rose-100">
          {error}
        </div>
      ) : sections.length === 0 ? (
        <StudentEmptyState
          icon={<ClipboardList className="h-6 w-6 text-pink-300" />}
          title="لا توجد امتحانات في هذا التصنيف حاليًا"
          description="ستظهر هنا جميع الامتحانات التي ينشرها الأستاذ لصفك أو مجموعتك الدراسية فور إتاحتها."
          actionLabel={filter !== 'ALL' ? 'عرض جميع الامتحانات' : undefined}
          onAction={filter !== 'ALL' ? () => setFilter('ALL') : undefined}
        />
      ) : (
        <div className="space-y-5">
          {sections.map((sec) => (
            <section key={sec.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-white">
                  {sec.icon}
                  <span>{sec.title}</span>
                </h3>
                <span className="rounded-full border border-white/15 bg-white/8 px-3 py-0.5 font-mono-num text-xs font-bold text-sky-200">
                  {sec.items.length} امتحان
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {sec.items.map((item, idx) => renderWhiteSplitExamCard(item, idx))}
              </div>
            </section>
          ))}
        </div>
      )}
    </StudentTwoColShell>
  );
};
