import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookCheck,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  Info,
  Layers,
  LayoutGrid,
  Play,
  Radio,
  Table2,
  Users,
  Video,
} from 'lucide-react';
import type {
  StudentDashboardData,
  StudentDeepLinkTarget,
} from '../../types/lms.ts';
import { formatDateTimeAr } from '../../lib/api.ts';
import {
  computeTableScrollMetrics,
  getScheduleRowStaggerMs,
  INITIAL_TABLE_SCROLL_METRICS,
  type TableScrollMetrics,
} from '../../lib/tableScrollMotion.ts';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentProgressRing,
  StudentRailCard,
  StudentTwoColShell,
  StudentWhiteCard,
} from './StudentUiPrimitives.tsx';

interface StudentScheduleViewProps {
  data: StudentDashboardData;
  initialSessionId?: number | null;
  onConsumeInitialSession?: () => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

function toCairoYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function formatCairoWeekday(date: Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
  }).format(date);
}

function formatCairoDayMonth(date: Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function formatCairoTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function formatCairoDateBox(iso: string): { weekday: string; day: string; monthYear: string } {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return { weekday: 'موعد', day: '—', monthYear: '' };
  }
  return {
    weekday: new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      weekday: 'long',
    }).format(dt),
    day: new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      day: 'numeric',
    }).format(dt),
    monthYear: new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      month: 'long',
      year: 'numeric',
    }).format(dt),
  };
}

export const StudentScheduleView: React.FC<StudentScheduleViewProps> = ({
  data,
  initialSessionId = null,
  onConsumeInitialSession,
  onNavigateTarget,
}) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<number | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [scheduleDisplayMode, setScheduleDisplayMode] = useState<'table' | 'cards'>('table');
  const studentTableScrollRef = useRef<HTMLDivElement | null>(null);
  const studentScrollRafRef = useRef<number | null>(null);
  const [studentScrollState, setStudentScrollState] = useState<TableScrollMetrics>(
    INITIAL_TABLE_SCROLL_METRICS,
  );

  const updateStudentScrollState = useCallback(() => {
    const el = studentTableScrollRef.current;
    if (!el) return;
    setStudentScrollState(
      computeTableScrollMetrics({
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }),
    );
  }, []);

  const handleStudentTableScroll = useCallback(() => {
    if (studentScrollRafRef.current !== null) return;
    studentScrollRafRef.current = requestAnimationFrame(() => {
      studentScrollRafRef.current = null;
      updateStudentScrollState();
    });
  }, [updateStudentScrollState]);

  const scrollStudentScheduleTable = (direction: 'start' | 'end') => {
    const el = studentTableScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'end' ? -220 : 220, behavior: 'smooth' });
  };

  useEffect(() => {
    if (scheduleDisplayMode !== 'table') return;
    const raf = requestAnimationFrame(updateStudentScrollState);
    window.addEventListener('resize', updateStudentScrollState);
    return () => {
      cancelAnimationFrame(raf);
      if (studentScrollRafRef.current !== null) {
        cancelAnimationFrame(studentScrollRafRef.current);
        studentScrollRafRef.current = null;
      }
      window.removeEventListener('resize', updateStudentScrollState);
    };
  }, [scheduleDisplayMode, data.schedules.length, selectedYmd, updateStudentScrollState]);

  const todayYmd = useMemo(() => toCairoYmd(new Date()), []);

  const sortedSchedules = useMemo(() => {
    return [...data.schedules].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  }, [data.schedules]);

  const focusSession = useCallback(
    (session: StudentDashboardData['schedules'][number]) => {
      const dt = new Date(session.scheduledAt);
      if (!Number.isNaN(dt.getTime())) {
        const ymd = toCairoYmd(dt);
        setSelectedYmd(ymd);
        const nowDay = new Date(`${todayYmd}T00:00:00Z`).getTime();
        const targetDay = new Date(`${ymd}T00:00:00Z`).getTime();
        const diffDays = Math.floor((targetDay - nowDay) / 86400000);
        setWeekOffset(Math.floor(diffDays / 7));
      }
      setFocusedSessionId(session.id);
      setExpandedSessionId(session.id);
    },
    [todayYmd],
  );

  useEffect(() => {
    if (!initialSessionId) return;
    const match = sortedSchedules.find((s) => s.id === initialSessionId);
    if (match) {
      focusSession(match);
    }
    onConsumeInitialSession?.();
  }, [initialSessionId, sortedSchedules, focusSession, onConsumeInitialSession]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const liveCount = sortedSchedules.filter((s) => s.sessionType === 'LIVE').length;
    const reviewCount = sortedSchedules.length - liveCount;
    const pastCount = sortedSchedules.filter(
      (s) => new Date(s.scheduledAt).getTime() < now,
    ).length;
    const totalMinutes = sortedSchedules.reduce((sum, s) => sum + (s.durationMin || 0), 0);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    const pct =
      sortedSchedules.length > 0
        ? Math.round((pastCount / sortedSchedules.length) * 100)
        : data.overallProgressPercent;

    return {
      liveCount,
      reviewCount,
      pastCount,
      totalSessions: sortedSchedules.length,
      groupsCount: data.groups.length,
      totalHours,
      pct,
    };
  }, [sortedSchedules, data.groups.length, data.overallProgressPercent]);

  // Real upcoming deadlines & exams for the left rail + calendar dot indicators
  const importantDeadlines = useMemo(() => {
    const items: Array<{
      key: string;
      ymd: string;
      iso: string;
      title: string;
      kind: 'SESSION' | 'EXAM' | 'HOMEWORK';
      onClick: () => void;
    }> = [];

    for (const s of sortedSchedules) {
      const dt = new Date(s.scheduledAt);
      if (!Number.isNaN(dt.getTime())) {
        items.push({
          key: `s-${s.id}`,
          ymd: toCairoYmd(dt),
          iso: s.scheduledAt,
          title: s.titleAr,
          kind: 'SESSION',
          onClick: () => focusSession(s),
        });
      }
    }

    for (const ex of data.exams) {
      const iso = ex.startsAt || ex.endsAt;
      if (!iso) continue;
      const dt = new Date(iso);
      if (!Number.isNaN(dt.getTime())) {
        items.push({
          key: `ex-${ex.id}`,
          ymd: toCairoYmd(dt),
          iso,
          title: `امتحان: ${ex.titleAr}`,
          kind: 'EXAM',
          onClick: () => onNavigateTarget({ type: 'EXAM', entityId: ex.id }),
        });
      }
    }

    for (const hw of data.homeworkSummary?.items || []) {
      if (!hw.deadline) continue;
      const dt = new Date(hw.deadline);
      if (!Number.isNaN(dt.getTime())) {
        items.push({
          key: `hw-${hw.id}`,
          ymd: toCairoYmd(dt),
          iso: hw.deadline,
          title: `تسليم واجب: ${hw.titleAr}`,
          kind: 'HOMEWORK',
          onClick: () => onNavigateTarget({ type: 'HOMEWORK', entityId: hw.id }),
        });
      }
    }

    return items.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  }, [sortedSchedules, data.exams, data.homeworkSummary, onNavigateTarget, focusSession]);

  const eventsByYmd = useMemo(() => {
    const map = new Map<string, typeof importantDeadlines>();
    for (const ev of importantDeadlines) {
      const list = map.get(ev.ymd) || [];
      list.push(ev);
      map.set(ev.ymd, list);
    }
    return map;
  }, [importantDeadlines]);

  // 7-day Cairo week strip
  const weekDays = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    const list: Array<{
      ymd: string;
      weekday: string;
      dayMonth: string;
      isToday: boolean;
      events: typeof importantDeadlines;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const ymd = toCairoYmd(d);
      list.push({
        ymd,
        weekday: formatCairoWeekday(d),
        dayMonth: formatCairoDayMonth(d),
        isToday: ymd === todayYmd,
        events: eventsByYmd.get(ymd) || [],
      });
    }
    return list;
  }, [weekOffset, todayYmd, eventsByYmd]);

  // Featured next/selected session
  const featuredSession = useMemo(() => {
    if (focusedSessionId) {
      const exact = sortedSchedules.find((s) => s.id === focusedSessionId);
      if (exact) return exact;
    }
    if (selectedYmd) {
      const match = sortedSchedules.find((s) => toCairoYmd(new Date(s.scheduledAt)) === selectedYmd);
      if (match) return match;
    }
    const now = Date.now();
    return (
      sortedSchedules.find((s) => new Date(s.scheduledAt).getTime() >= now - 3600000) ||
      sortedSchedules[0] ||
      null
    );
  }, [sortedSchedules, selectedYmd, focusedSessionId]);

  const visibleSchedules = useMemo(() => {
    if (!selectedYmd) return sortedSchedules;
    return sortedSchedules.filter((s) => toCairoYmd(new Date(s.scheduledAt)) === selectedYmd);
  }, [sortedSchedules, selectedYmd]);

  const rail = (
    <>
      {/* 1. Weekly Schedule Progress Ring */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">تقدمك هذا الأسبوع</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                حصص مباشرة{' '}
                <strong className="font-mono-num text-white">{metrics.liveCount}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                ورش مراجعة{' '}
                <strong className="font-mono-num text-white">{metrics.reviewCount}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <Users className="h-3.5 w-3.5 text-violet-300 shrink-0" />
              <span>
                مجموعات <strong className="font-mono-num text-white">{metrics.groupsCount}</strong>
              </span>
            </div>
          </div>
          <StudentProgressRing percent={metrics.pct} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={() => onNavigateTarget({ type: 'CURRICULUM' })}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>عرض خطة المنهج الأسبوعية</span>
        </button>
      </StudentRailCard>

      {/* 2. Study Groups Card */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">مجموعاتي الدراسية</h2>
          <Users className="h-4 w-4 text-sky-300" />
        </div>
        {data.groups.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">لست مضافًا إلى مجموعة دراسية خاصة بعد.</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {data.groups.map((g) => (
              <div
                key={g.id}
                className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#0B1739]/80 p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/35">
                  <Users className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-white truncate">{g.nameAr}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-sky-300">
                    {g.scheduleTextAr}
                  </div>
                  {g.descriptionAr && (
                    <div className="mt-0.5 text-[10.5px] text-slate-400 line-clamp-2">
                      {g.descriptionAr}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </StudentRailCard>

      {/* 3. Real Upcoming Important Dates (Sessions / Exams / Homework Deadlines) */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">المواعيد القادمة</h2>
          <Clock className="h-4 w-4 text-sky-300" />
        </div>
        {importantDeadlines.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">لا توجد مواعيد أو تسليمات قادمة مسجلة حاليًا.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {importantDeadlines.slice(0, 4).map((ev) => (
              <button
                key={ev.key}
                type="button"
                onClick={ev.onClick}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B1739]/80 px-3 py-2 text-right hover:border-sky-400/45 transition-all"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white">{ev.title}</div>
                  <div className="truncate text-[10.5px] text-slate-400">
                    {formatDateTimeAr(ev.iso)}
                  </div>
                </div>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    ev.kind === 'SESSION'
                      ? 'bg-sky-400'
                      : ev.kind === 'EXAM'
                        ? 'bg-pink-400'
                        : 'bg-amber-400'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </StudentRailCard>
    </>
  );

  return (
    <StudentTwoColShell rail={rail} testId="student-schedule-view">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="الجدول والمواعيد المباشرة"
        subtitle="تابع جدولك الأسبوعي بتوقيت القاهرة، انضم إلى الحصص المباشرة، وكن على اطلاع بمواعيد المراجعات والمجموعات الدراسية."
        icon={<Calendar className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.schedule}
        artworkAlt="الجدول والمواعيد المباشرة"
        chips={[
          { dotColor: 'bg-rose-400', label: `حصص مباشرة (${metrics.liveCount})` },
          { icon: <Layers className="h-3.5 w-3.5" />, label: `مراجعات (${metrics.reviewCount})` },
          { icon: <Users className="h-3.5 w-3.5" />, label: `مجموعات (${metrics.groupsCount})` },
        ]}
      />

      {/* 2. Weekly Summary Bar matching 10_Schedule.png */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 px-4 py-3.5 text-white items-center">
        <div className="col-span-2 lg:col-span-1 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-sky-300 shrink-0" />
          <span className="font-display text-xs sm:text-sm font-extrabold text-white">
            ملخص الجدول
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-sky-300 shrink-0" />
          <div>
            <div className="font-mono-num text-sm font-extrabold">{metrics.liveCount}</div>
            <div className="text-[10.5px] text-slate-300">حصص مباشرة</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-300 shrink-0" />
          <div>
            <div className="font-mono-num text-sm font-extrabold">{metrics.reviewCount}</div>
            <div className="text-[10.5px] text-slate-300">ورش مراجعة</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-300 shrink-0" />
          <div>
            <div className="font-mono-num text-sm font-extrabold">{metrics.groupsCount}</div>
            <div className="text-[10.5px] text-slate-300">مجموعات دراسة</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-cyan-300 shrink-0" />
          <div>
            <div className="font-mono-num text-sm font-extrabold">{metrics.totalHours} ساعة</div>
            <div className="text-[10.5px] text-slate-300">إجمالي الوقت</div>
          </div>
        </div>
      </div>

      {/* 3. Interactive 7-Day Cairo Week Selector matching 10_Schedule.png */}
      <div className="rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-3 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-sky-300" />
            <span className="font-display text-xs sm:text-sm font-extrabold">جدول الأسبوع</span>
            <span className="text-[11px] text-slate-400">(توقيت القاهرة)</span>
          </div>

          <div className="flex items-center gap-1.5">
            {selectedYmd && (
              <button
                type="button"
                onClick={() => setSelectedYmd(null)}
                className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-[11px] font-bold text-sky-200 hover:bg-sky-500/30"
              >
                عرض كل المواعيد
              </button>
            )}
            <button
              type="button"
              aria-label="الأسبوع السابق"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 hover:bg-white/15"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setWeekOffset(0);
                setSelectedYmd(null);
              }}
              className="min-h-[36px] rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/15"
            >
              اليوم
            </button>
            <button
              type="button"
              aria-label="الأسبوع التالي"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 hover:bg-white/15"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="responsive-table-scroll-dark flex snap-x snap-mandatory gap-2 pb-1.5 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0 lg:grid-cols-7">
          {weekDays.map((day) => {
            const isActive = selectedYmd === day.ymd || (!selectedYmd && day.isToday);
            return (
              <button
                key={day.ymd}
                type="button"
                onClick={() => {
                  setFocusedSessionId(null);
                  setSelectedYmd(selectedYmd === day.ymd ? null : day.ymd);
                }}
                className={`min-w-[104px] shrink-0 snap-start rounded-xl border px-2.5 py-2.5 text-center transition-all sm:min-w-0 ${
                  isActive
                    ? 'border-sky-300/80 bg-gradient-to-b from-[#1FA4FF] to-[#1D4ED8] text-white shadow-[0_6px_20px_rgba(37,99,235,0.45)]'
                    : 'border-white/10 bg-[#0D1C46]/85 text-slate-200 hover:border-sky-400/45'
                }`}
              >
                <div className="text-xs font-extrabold whitespace-nowrap">{day.weekday}</div>
                <div
                  className={`mt-0.5 text-[11px] font-semibold whitespace-nowrap ${
                    isActive ? 'text-sky-100' : 'text-slate-400'
                  }`}
                >
                  {day.dayMonth}
                </div>
                <div className="mt-2 flex items-center justify-center gap-1 min-h-[8px]">
                  {day.events.length === 0 ? (
                    <span className="h-1 w-3 rounded-full bg-white/20" />
                  ) : (
                    day.events.slice(0, 3).map((ev) => (
                      <span
                        key={ev.key}
                        className={`h-2 w-2 rounded-full ${
                          isActive
                            ? 'bg-white'
                            : ev.kind === 'SESSION'
                              ? 'bg-sky-400'
                              : ev.kind === 'EXAM'
                                ? 'bg-pink-400'
                                : 'bg-amber-400'
                        }`}
                      />
                    ))
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Featured Live Session Spotlight Card matching 10_Schedule.png */}
      {featuredSession ? (
        (() => {
          const box = formatCairoDateBox(featuredSession.scheduledAt);
          const isDetailsOpen = expandedSessionId === featuredSession.id;
          return (
            <section className="overflow-hidden rounded-2xl border border-[#4F46E5]/55 bg-gradient-to-l from-[#12225B] via-[#1C1E66] to-[#0B163C] p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.5)]">
              <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.75fr] gap-4 items-center">
                {/* Right side (RTL): Date Square + Session Info + Join Link */}
                <div className="flex flex-col sm:flex-row items-start gap-4 min-w-0">
                  <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border border-sky-400/40 bg-[#0A163C]/90 text-center shadow-inner">
                    <span className="text-[11px] font-bold text-sky-300">{box.weekday}</span>
                    <span className="font-mono-num text-3xl font-extrabold leading-tight text-white">
                      {box.day}
                    </span>
                    <span className="text-[10.5px] font-semibold text-slate-300">
                      {box.monthYear}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/50 bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-extrabold text-rose-200">
                        <Radio className="h-3 w-3" />
                        {featuredSession.sessionType === 'LIVE'
                          ? 'حصة مباشرة تفاعلية'
                          : 'ورشة مراجعة مجدولة'}
                      </span>
                      <span className="rounded-lg border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] font-bold text-sky-200">
                        {featuredSession.liveProvider}
                      </span>
                    </div>

                    <h2 className="font-display text-lg sm:text-xl font-extrabold text-white leading-snug">
                      {featuredSession.titleAr}
                    </h2>
                    {featuredSession.descriptionAr && (
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        {featuredSession.descriptionAr}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-200">
                      <span className="inline-flex items-center gap-1 font-mono-num font-bold">
                        <Calendar className="h-3.5 w-3.5 text-sky-300" />
                        {formatCairoTime(featuredSession.scheduledAt)} (توقيت القاهرة)
                      </span>
                      <span className="text-white/25">|</span>
                      <span className="inline-flex items-center gap-1 font-mono-num font-bold">
                        <Clock className="h-3.5 w-3.5 text-sky-300" />
                        {featuredSession.durationMin} دقيقة
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      {featuredSession.joinUrl ? (
                        <a
                          href={featuredSession.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-6 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,0.45)] hover:brightness-110"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>رابط الحصة المباشرة</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-xs font-bold text-slate-200">
                          <Video className="h-4 w-4 text-sky-300" />
                          <span>يُضاف رابط البث قبل الموعد مباشرة</span>
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSessionId(isDetailsOpen ? null : featuredSession.id)
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/8 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/15"
                      >
                        <Info className="h-4 w-4 text-sky-300" />
                        <span>{isDetailsOpen ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</span>
                      </button>
                    </div>

                    {isDetailsOpen && (
                      <div className="rounded-xl border border-sky-400/30 bg-[#091435]/85 p-3 text-xs text-slate-200 space-y-1">
                        <div>
                          <strong className="text-sky-300">الموعد الكامل: </strong>
                          {formatDateTimeAr(featuredSession.scheduledAt)}
                        </div>
                        <div>
                          <strong className="text-sky-300">منصة البث: </strong>
                          {featuredSession.liveProvider}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Left side (RTL): Physics Artwork */}
                <div className="hidden lg:block relative overflow-hidden rounded-2xl border border-violet-400/35 bg-[#081234] aspect-[16/10]">
                  <img
                    src={STUDENT_ARTWORK.curriculum}
                    alt={featuredSession.titleAr}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/75 via-transparent to-transparent" />
                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-rose-600/90 px-3 py-0.5 text-[10.5px] font-extrabold text-white shadow-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                    حصة مجدولة
                  </span>
                </div>
              </div>
            </section>
          );
        })()
      ) : (
        <StudentEmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="لا توجد حصص مباشرة مجدولة حاليًا"
          description="عندما يحدد الأستاذ مواعيد الحصص المباشرة أو ورش المراجعة لصفك ستظهر هنا مع رابط الانضمام."
          actionLabel="عرض خطة المنهج"
          onAction={() => onNavigateTarget({ type: 'CURRICULUM' })}
        />
      )}

      {/* Full Responsive Study Schedule Table & Cards */}
      {visibleSchedules.length > 0 && (
        <div className="space-y-2.5 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-3.5 sm:p-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-extrabold text-white">
                الجدول الدراسي الكامل ({visibleSchedules.length})
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                جميع الحصص والمواعيد بتوقيت القاهرة
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-white/15 bg-[#07112B] p-0.5">
              <button
                type="button"
                onClick={() => setScheduleDisplayMode('table')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  scheduleDisplayMode === 'table'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span>جدول</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleDisplayMode('cards')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  scheduleDisplayMode === 'cards'
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>بطاقات</span>
              </button>
            </div>
          </div>

          {scheduleDisplayMode === 'table' ? (
            <div className="space-y-2">
              {studentScrollState.hasOverflowX && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#07112B]/80 px-3 py-1.5 text-[11px] text-sky-200">
                  <span className="truncate font-semibold">
                    اسحب الجدول أفقيًا وعموديًا لعرض كافة المواعيد والتفاصيل
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="تمرير الجدول الدراسي لليمين"
                      disabled={!studentScrollState.canScrollStart}
                      onClick={() => scrollStudentScheduleTable('start')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white transition-transform duration-150 hover:bg-white/15 active:scale-95 disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="تمرير الجدول الدراسي لليسار"
                      disabled={!studentScrollState.canScrollEnd}
                      onClick={() => scrollStudentScheduleTable('end')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white transition-transform duration-150 hover:bg-white/15 active:scale-95 disabled:opacity-30"
                    >
                      <ChevronLeft
                        className={`h-4 w-4 ${
                          !studentScrollState.isScrolledX && studentScrollState.canScrollEnd
                            ? 'schedule-scroll-nudge'
                            : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

              <div className="relative overflow-hidden rounded-xl border border-[#2D4A8A]/55 bg-[#081333]">
                {/* GPU-accelerated horizontal scroll progress hairline */}
                {studentScrollState.hasOverflowX && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 right-0 left-0 z-40 h-[2.5px] bg-[#10245E]/90"
                  >
                    <div
                      data-testid="student-schedule-scroll-progress"
                      style={{
                        transform: `scaleX(${Math.max(0.14, studentScrollState.progressX)})`,
                      }}
                      className="schedule-progress-fill h-full w-full bg-gradient-to-l from-[#38BDF8] to-[#2563EB]"
                    />
                  </div>
                )}

                {/* Smooth left-edge horizontal scroll fade cue (RTL) */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-8 bg-gradient-to-r from-[#081333] via-[#081333]/70 to-transparent transition-opacity duration-200 ${
                    studentScrollState.hasMoreEndShadow ? 'opacity-100' : 'opacity-0'
                  }`}
                />

                {/* Smooth bottom-edge vertical scroll fade cue */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute right-0 bottom-0 left-0 z-30 h-7 bg-gradient-to-t from-[#081333] via-[#081333]/65 to-transparent transition-opacity duration-200 ${
                    studentScrollState.hasMoreBottomShadow ? 'opacity-100' : 'opacity-0'
                  }`}
                />

                <div
                  ref={studentTableScrollRef}
                  onScroll={handleStudentTableScroll}
                  tabIndex={0}
                  aria-label="الجدول الدراسي القابل للتمرير أفقيًا وعموديًا"
                  data-testid="student-schedule-responsive-table"
                  data-scrolled-x={studentScrollState.isScrolledX ? 'true' : 'false'}
                  data-scrolled-y={studentScrollState.isScrolledY ? 'true' : 'false'}
                  className="responsive-table-scroll-dark relative max-h-[55vh] sm:max-h-[420px] w-full bg-[#081333] focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                >
                  <table className="w-full min-w-[640px] border-separate border-spacing-0 text-right text-xs">
                    <thead>
                      <tr
                        className={`text-sky-200 transition-shadow duration-200 ${
                          studentScrollState.isScrolledY
                            ? 'shadow-[0_6px_14px_-6px_rgba(2,8,28,0.8)]'
                            : ''
                        }`}
                      >
                        <th
                          scope="col"
                          className={`sticky top-0 right-0 z-30 min-w-[140px] max-w-[160px] sm:min-w-[195px] sm:max-w-[240px] border-b border-l border-[#2D4A8A]/55 bg-[#0D1E4D] px-3 sm:px-3.5 py-3 font-bold whitespace-nowrap transition-shadow duration-200 ${
                            studentScrollState.isScrolledX
                              ? 'shadow-[-8px_0_18px_-6px_rgba(2,8,28,0.88)]'
                              : 'shadow-[-3px_0_10px_-6px_rgba(2,8,28,0.5)]'
                          }`}
                        >
                          الحصة / الموعد
                        </th>
                        <th
                          scope="col"
                          className="sticky top-0 z-20 min-w-[130px] border-b border-[#2D4A8A]/55 bg-[#0D1E4D]/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                        >
                          النوع والمنصة
                        </th>
                        <th
                          scope="col"
                          className="sticky top-0 z-20 min-w-[155px] border-b border-[#2D4A8A]/55 bg-[#0D1E4D]/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                        >
                          التاريخ والوقت
                        </th>
                        <th
                          scope="col"
                          className="sticky top-0 z-20 min-w-[85px] border-b border-[#2D4A8A]/55 bg-[#0D1E4D]/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                        >
                          المدة
                        </th>
                        <th
                          scope="col"
                          className="sticky top-0 z-20 min-w-[115px] border-b border-[#2D4A8A]/55 bg-[#0D1E4D]/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                        >
                          الإجراء
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSchedules.map((s, rowIdx) => {
                        const isSelected = featuredSession?.id === s.id;
                        const stickyBg = isSelected
                          ? 'bg-[#12265E]'
                          : 'bg-[#081333] group-hover:bg-[#0D1D48]';
                        return (
                          <tr
                            key={s.id}
                            onClick={() => focusSession(s)}
                            style={{ animationDelay: `${getScheduleRowStaggerMs(rowIdx)}ms` }}
                            className={`schedule-row-enter group cursor-pointer transition-colors duration-150 ${
                              isSelected ? 'bg-[#12265E]/90' : 'hover:bg-[#0D1D48]/80'
                            }`}
                          >
                            <td
                              className={`sticky right-0 z-10 min-w-[140px] max-w-[160px] sm:min-w-[195px] sm:max-w-[240px] border-b border-l border-white/10 px-3 sm:px-3.5 py-3 transition-all duration-200 ${stickyBg} ${
                                studentScrollState.isScrolledX
                                  ? 'shadow-[-8px_0_18px_-6px_rgba(2,8,28,0.85)]'
                                  : 'shadow-[-3px_0_10px_-6px_rgba(2,8,28,0.45)]'
                              }`}
                            >
                              <div className="line-clamp-2 font-display font-extrabold leading-snug text-white">
                                {s.titleAr}
                              </div>
                              {s.descriptionAr && (
                                <div className="mt-0.5 line-clamp-1 text-[10.5px] text-slate-400">
                                  {s.descriptionAr}
                                </div>
                              )}
                            </td>
                            <td className="border-b border-white/10 px-3.5 py-3 text-slate-200 whitespace-nowrap">
                              <div className="font-bold text-sky-300">
                                {s.sessionType === 'LIVE' ? 'بث مباشر' : 'ورشة مراجعة'}
                              </div>
                              <div className="mt-0.5 text-[10.5px] text-slate-400">
                                {s.liveProvider}
                              </div>
                            </td>
                            <td className="border-b border-white/10 px-3.5 py-3 font-mono-num text-slate-200 whitespace-nowrap tabular-nums">
                              {formatDateTimeAr(s.scheduledAt)}
                            </td>
                            <td className="border-b border-white/10 px-3.5 py-3 font-mono-num text-slate-200 whitespace-nowrap tabular-nums">
                              {s.durationMin} دقيقة
                            </td>
                            <td
                              className="border-b border-white/10 px-3.5 py-3 whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {s.joinUrl ? (
                                <a
                                  href={s.joinUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-[#2563EB] px-3 py-1.5 text-xs font-extrabold text-white transition-transform duration-150 hover:bg-[#1D4ED8] active:scale-95 whitespace-nowrap"
                                >
                                  <span>انضم</span>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => focusSession(s)}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-sky-200 transition-transform duration-150 hover:bg-white/15 active:scale-95 whitespace-nowrap"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                  <span>التفاصيل</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visibleSchedules.map((s) => {
                const isSelected = featuredSession?.id === s.id;
                return (
                  <div
                    key={s.id}
                    className={`flex min-w-0 max-w-full overflow-hidden items-center justify-between gap-3 rounded-2xl border p-4 text-white transition-all ${
                      isSelected
                        ? 'border-sky-400/75 bg-[#12265E]/95 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
                        : 'border-[#2D4A8A]/50 bg-[#0D1C46]/90 hover:border-sky-400/45'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => focusSession(s)}
                      className="min-w-0 flex-1 text-right"
                    >
                      <div className="text-[11px] font-bold text-sky-300">
                        {s.sessionType === 'LIVE' ? 'بث مباشر' : 'ورشة مراجعة'} · {s.liveProvider}
                      </div>
                      <div className="mt-0.5 font-display text-sm font-extrabold truncate">
                        {s.titleAr}
                      </div>
                      <div className="mt-1 font-mono-num text-[11px] text-slate-300 tabular-nums">
                        {formatDateTimeAr(s.scheduledAt)} · {s.durationMin} دقيقة
                      </div>
                    </button>
                    {s.joinUrl ? (
                      <a
                        href={s.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-[#2563EB] px-3 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8]"
                      >
                        <span>انضم</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => focusSession(s)}
                        className="shrink-0 inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-white/15"
                      >
                        <Info className="h-3.5 w-3.5" />
                        <span>التفاصيل</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 5. Bottom 3 Crisp WHITE Summary Cards matching 10_Schedule.png */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* Card 1: Weekly Breakdown */}
        <StudentWhiteCard className="overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between bg-gradient-to-l from-[#10245E] to-[#1D4ED8] px-4 py-3 text-white">
              <h3 className="font-display text-sm font-extrabold">ملخص جدولك الدراسي</h3>
              <Calendar className="h-4 w-4 text-sky-200" />
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-bold text-[#0B162C]">
                  <span>حصص مباشرة</span>
                  <span className="font-mono-num text-[#2563EB]">{metrics.liveCount}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    style={{
                      width: `${metrics.totalSessions > 0 ? Math.round((metrics.liveCount / metrics.totalSessions) * 100) : 0}%`,
                    }}
                    className="h-full rounded-full bg-gradient-to-l from-[#0EA5E9] to-[#2563EB]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between font-bold text-[#0B162C]">
                  <span>ورش المراجعة</span>
                  <span className="font-mono-num text-violet-700">{metrics.reviewCount}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    style={{
                      width: `${metrics.totalSessions > 0 ? Math.round((metrics.reviewCount / metrics.totalSessions) * 100) : 0}%`,
                    }}
                    className="h-full rounded-full bg-gradient-to-l from-violet-500 to-indigo-600"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between font-bold text-[#0B162C]">
                  <span>مجموعات الدراسة</span>
                  <span className="font-mono-num text-emerald-700">{metrics.groupsCount}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    style={{ width: metrics.groupsCount > 0 ? '100%' : '0%' }}
                    className="h-full rounded-full bg-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => onNavigateTarget({ type: 'CURRICULUM' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#7C3AED] py-2.5 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>عرض خطة المنهج الكاملة</span>
            </button>
          </div>
        </StudentWhiteCard>

        {/* Card 2: Active Study Groups */}
        <StudentWhiteCard className="overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between bg-gradient-to-l from-[#10245E] to-[#0284C7] px-4 py-3 text-white">
              <h3 className="font-display text-sm font-extrabold">مجموعات الدراسة النشطة</h3>
              <Users className="h-4 w-4 text-sky-200" />
            </div>
            <div className="p-4 space-y-2.5">
              {data.groups.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  لا توجد مجموعات خاصة مسجل بها حاليًا.
                </p>
              ) : (
                data.groups.slice(0, 3).map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-extrabold text-[#0B162C]">
                        {g.nameAr}
                      </div>
                      <div className="truncate text-[11px] font-semibold text-slate-500">
                        {g.scheduleTextAr}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => onNavigateTarget({ type: 'VIDEO' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>مكتبة محاضرات الصف</span>
            </button>
          </div>
        </StudentWhiteCard>

        {/* Card 3: Upcoming Reviews & Deadlines */}
        <StudentWhiteCard className="overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between bg-gradient-to-l from-[#4C1D95] to-[#7C3AED] px-4 py-3 text-white">
              <h3 className="font-display text-sm font-extrabold">المراجعات والمواعيد القادمة</h3>
              <Layers className="h-4 w-4 text-violet-200" />
            </div>
            <div className="p-4 space-y-2.5">
              {importantDeadlines.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  لا توجد مراجعات أو مواعيد قادمة حاليًا.
                </p>
              ) : (
                importantDeadlines.slice(0, 3).map((ev) => (
                  <button
                    key={ev.key}
                    type="button"
                    onClick={ev.onClick}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-right hover:border-[#2563EB] transition-colors"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        ev.kind === 'EXAM'
                          ? 'bg-pink-100 text-pink-700'
                          : ev.kind === 'HOMEWORK'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      {ev.kind === 'EXAM' ? (
                        <ClipboardList className="h-4 w-4" />
                      ) : ev.kind === 'HOMEWORK' ? (
                        <BookCheck className="h-4 w-4" />
                      ) : (
                        <Calendar className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-extrabold text-[#0B162C]">
                        {ev.title}
                      </div>
                      <div className="truncate text-[10.5px] font-semibold text-slate-500">
                        {formatDateTimeAr(ev.iso)}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => onNavigateTarget({ type: 'EXAM' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] to-[#4F46E5] py-2.5 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>الانتقال إلى الامتحانات</span>
            </button>
          </div>
        </StudentWhiteCard>
      </div>
    </StudentTwoColShell>
  );
};
