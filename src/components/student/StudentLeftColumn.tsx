import React from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  Layers,
  PlayCircle,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  LessonProgressSummary,
  StudentNavTarget,
  WeeklyAgendaItem,
} from '../../lib/studentDashboardMetrics.ts';
import type { AcademicAdherenceSummary } from '../../lib/academicPlanEngine.ts';
import type { StudentAnnouncementItem, StudentDeepLinkTarget } from '../../types/lms.ts';
import { StudentAnnouncementsCard } from './StudentAnnouncementsCard.tsx';

interface StudentLeftColumnProps {
  progress: LessonProgressSummary;
  adherence: AcademicAdherenceSummary;
  weeklyAgenda: WeeklyAgendaItem[];
  announcements: StudentAnnouncementItem[];
  onSelectTab: (tab: StudentNavTarget) => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

export const StudentLeftColumn: React.FC<StudentLeftColumnProps> = React.memo(({
  progress,
  adherence,
  weeklyAgenda,
  announcements,
  onSelectTab,
  onNavigateTarget,
}) => {
  // Circular SVG Donut math (radius = 36, circumference ≈ 226.19)
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.max(0, Math.min(100, progress.percent));
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference;

  const adherenceBadgeTone =
    adherence.statusTone === 'EXCELLENT'
      ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
      : adherence.statusTone === 'ATTENTION'
        ? 'bg-rose-500/20 text-rose-200 border-rose-400/40'
        : adherence.statusTone === 'GOOD'
          ? 'bg-sky-500/20 text-sky-200 border-sky-400/40'
          : 'bg-white/10 text-slate-300 border-white/15';

  const handleAgendaClick = (item: WeeklyAgendaItem) => {
    if (item.kind === 'EXAM' && item.entityId) {
      onNavigateTarget({ type: 'EXAM', entityId: item.entityId });
      return;
    }
    if (item.kind === 'HOMEWORK' && item.entityId) {
      onNavigateTarget({ type: 'HOMEWORK', entityId: item.entityId });
      return;
    }
    if (item.kind === 'SCHEDULE') {
      onNavigateTarget({ type: 'SCHEDULE', entityId: item.entityId });
      return;
    }
    onSelectTab(item.targetTab);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5 xl:w-[268px] shrink-0">
      {/* A. تقدمك في المنهج */}
      <section
        aria-label="تقدمك في المنهج"
        className="rounded-2xl border border-[#3B82F6]/35 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-3.5 text-white shadow-[0_8px_24px_rgba(2,8,24,0.45)]"
      >
        <h2 className="font-display text-[14.5px] font-extrabold text-white">تقدمك في المنهج</h2>

        <div className="mt-2.5 flex items-center justify-between gap-2.5">
          {/* Stats Legend (Right in RTL) */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="font-mono-num font-extrabold text-white">{progress.completed}</span>
              <span className="text-slate-300">دروس مكتملة</span>
            </div>
            <div className="flex items-center gap-1.5">
              <PlayCircle className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="font-mono-num font-extrabold text-white">{progress.inProgress}</span>
              <span className="text-slate-300">دروس جارية</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Circle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="font-mono-num font-extrabold text-white">{progress.remaining}</span>
              <span className="text-slate-300">دروس متبقية</span>
            </div>
          </div>

          {/* Glowing Gradient Progress Donut (Left in RTL) */}
          <div className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center">
            <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden="true">
              <defs>
                <linearGradient id="curriculumRingGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="55%" stopColor="#818CF8" />
                  <stop offset="100%" stopColor="#E879F9" />
                </linearGradient>
              </defs>
              <circle
                cx="46"
                cy="46"
                r={radius}
                fill="none"
                stroke="rgba(148,163,184,0.2)"
                strokeWidth="9"
              />
              <circle
                cx="46"
                cy="46"
                r={radius}
                fill="none"
                stroke="url(#curriculumRingGrad)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                style={{ transition: 'stroke-dashoffset 450ms ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-num text-lg font-extrabold text-white">
                {clampedPct}%
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateTarget({ type: 'CURRICULUM', curriculumFilter: 'ALL' })}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-violet-400/50 bg-[#1B2358]/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-[#25317A] hover:border-sky-400/70 transition-all"
        >
          <Layers className="h-3.5 w-3.5 text-sky-300" />
          <span>عرض خطة المنهج</span>
        </button>
      </section>

      {/* B. التزامك الدراسي (Replaces Study Streak — #9) */}
      <section
        aria-label="التزامك الدراسي"
        className="rounded-2xl border border-[#3B82F6]/35 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-3.5 text-white shadow-[0_8px_24px_rgba(2,8,24,0.45)]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-[14.5px] font-extrabold text-white">التزامك الدراسي</h2>
            {adherence.hasPlan && (
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-mono-num text-xl font-extrabold text-sky-300">
                  {adherence.weeklyCompletionPercent}%
                </span>
                <span className="text-[11px] font-semibold text-slate-300">إنجاز الأسبوع</span>
              </div>
            )}
          </div>
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${adherenceBadgeTone}`}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        {!adherence.hasPlan ? (
          <div className="mt-2.5 rounded-xl border border-white/10 bg-[#122455]/55 px-3 py-2.5 text-[11px] leading-relaxed text-slate-300">
            {adherence.encouragementAr}
          </div>
        ) : (
          <div className="mt-2.5 space-y-2">
            {/* Weekly completion bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${adherence.weeklyCompletionPercent}%` }}
                className="h-full rounded-full bg-gradient-to-l from-emerald-400 via-sky-400 to-blue-500 transition-all duration-300"
              />
            </div>

            {/* Secondary metric: On-time adherence + optional real previous-week delta */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
              <span className="text-slate-300">
                الالتزام بالمواعيد:{' '}
                <strong className="font-mono-num text-white">
                  {adherence.onTimeAdherencePercent !== null
                    ? `${adherence.onTimeAdherencePercent}%`
                    : '—'}
                </strong>
              </span>
              {adherence.previousWeekDelta !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                    adherence.previousWeekDelta >= 0
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {adherence.previousWeekDelta >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {adherence.previousWeekDelta > 0 ? '+' : ''}
                  {adherence.previousWeekDelta}% عن السابق
                </span>
              )}
            </div>

            {/* Completed / In-Progress / Overdue mini counters */}
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg border border-white/10 bg-[#122455]/70 px-1.5 py-1.5">
                <div className="font-mono-num text-xs font-extrabold text-emerald-300">
                  {adherence.completedTasksCount}
                </div>
                <div className="text-[10px] text-slate-300">مكتمل</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#122455]/70 px-1.5 py-1.5">
                <div className="font-mono-num text-xs font-extrabold text-sky-300">
                  {adherence.inProgressTasksCount}
                </div>
                <div className="text-[10px] text-slate-300">جاري</div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onNavigateTarget({
                    type: 'CURRICULUM',
                    curriculumFilter: adherence.overdueRequiredCount > 0 ? 'OVERDUE' : 'CURRENT',
                  })
                }
                title="اضغط لعرض المهام المتأخرة في خطة المنهج"
                className={`rounded-lg border px-1.5 py-1.5 transition-colors ${
                  adherence.overdueRequiredCount > 0
                    ? 'border-rose-400/50 bg-rose-500/20 hover:bg-rose-500/30 cursor-pointer'
                    : 'border-white/10 bg-[#122455]/70 hover:bg-[#19306E]'
                }`}
              >
                <div
                  className={`flex items-center justify-center gap-0.5 font-mono-num text-xs font-extrabold ${
                    adherence.overdueRequiredCount > 0 ? 'text-rose-200' : 'text-slate-300'
                  }`}
                >
                  {adherence.overdueRequiredCount > 0 && (
                    <AlertTriangle className="h-3 w-3 text-rose-300" />
                  )}
                  <span>{adherence.overdueRequiredCount}</span>
                </div>
                <div className="text-[10px] text-slate-200">متأخر</div>
              </button>
            </div>

            <p className="text-[10.5px] leading-snug text-slate-300">{adherence.encouragementAr}</p>
          </div>
        )}
      </section>

      {/* C. مواعيد هذا الأسبوع */}
      <section
        aria-label="مواعيد هذا الأسبوع"
        className="rounded-2xl border border-[#3B82F6]/35 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-3.5 text-white shadow-[0_8px_24px_rgba(2,8,24,0.45)]"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[14.5px] font-extrabold text-white">مواعيد هذا الأسبوع</h2>
          <Calendar className="h-4 w-4 text-sky-300" />
        </div>

        <div className="mt-2.5 space-y-1.5">
          {weeklyAgenda.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#122455]/55 px-3 py-2.5 text-center text-xs text-slate-300">
              لا توجد حصص أو مواعيد تسليم خلال الـ 7 أيام القادمة.
            </div>
          ) : (
            weeklyAgenda.slice(0, 3).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleAgendaClick(item)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#122455]/75 px-2.5 py-1.5 text-right hover:border-sky-400/55 hover:bg-[#19306E] transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span className="text-[10.5px] font-bold text-sky-200 whitespace-nowrap">
                    {item.dateLabelAr}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-[11.5px] font-semibold text-white truncate">
                    {item.titleAr}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelectTab('schedule')}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-sky-400/40 bg-[#15285C]/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1E377A] transition-colors"
        >
          <Calendar className="h-3.5 w-3.5 text-sky-300" />
          <span>عرض الجدول الكامل</span>
        </button>
      </section>

      {/* D. إعلانات المنصة (Replaces Quick Notes — #5; stored localStorage notes are NOT deleted) */}
      <StudentAnnouncementsCard
        announcements={announcements}
        onNavigateTarget={onNavigateTarget}
      />
    </div>
  );
});
