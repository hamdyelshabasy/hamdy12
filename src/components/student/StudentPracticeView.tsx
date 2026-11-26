import React, { useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BookCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  HelpCircle,
  History,
  Layers,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import type {
  StudentDashboardData,
  StudentDeepLinkTarget,
} from '../../types/lms.ts';
import { formatDateTimeAr } from '../../lib/api.ts';
import { resolveStudentExamStatus } from '../../lib/studentAcademicSignals.ts';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentProgressRing,
  StudentRailCard,
  StudentTwoColShell,
  StudentWhiteCard,
  pickPhysicsArtwork,
} from './StudentUiPrimitives.tsx';

interface StudentPracticeViewProps {
  data: StudentDashboardData;
  onOpenExam: (examId: number) => void;
  onOpenHomework: (homeworkId: number) => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
}

export const StudentPracticeView: React.FC<StudentPracticeViewProps> = ({
  data,
  onOpenExam,
  onOpenHomework,
  onNavigateTarget,
}) => {
  const [selectedUnitId, setSelectedUnitId] = useState<number>(0);

  const hwItems = data.homeworkSummary?.items || [];
  const hwTotal = data.homeworkSummary?.totalCount ?? hwItems.length;
  const hwCompleted = data.homeworkSummary?.completedCount ?? 0;

  const stats = useMemo(() => {
    const totalExams = data.exams.length;
    const completedExams = data.exams.filter((e) => e.attemptsUsed > 0).length;
    const totalActivities = totalExams + hwTotal;
    const completedActivities = completedExams + hwCompleted;
    const completionPct =
      totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

    const publishedAttempts = data.recentAttempts.filter(
      (a) => a.resultPublished !== false && a.maxScore > 0,
    );
    const avgScorePct =
      publishedAttempts.length > 0
        ? Math.round(
            publishedAttempts.reduce(
              (sum, a) => sum + Math.round((a.totalScore / a.maxScore) * 100),
              0,
            ) / publishedAttempts.length,
          )
        : null;

    return {
      totalExams,
      completedExams,
      hwTotal,
      hwCompleted,
      totalActivities,
      completedActivities,
      completionPct,
      avgScorePct,
    };
  }, [data.exams, data.recentAttempts, hwTotal, hwCompleted]);

  // Next real challenge: prefer an actually startable/resumable exam, else an unsubmitted homework
  const nextChallenge = useMemo(() => {
    const availExam = data.exams.find((e) => resolveStudentExamStatus(e).canStartOrResume);
    if (availExam) {
      return {
        kind: 'EXAM' as const,
        id: availExam.id,
        title: availExam.titleAr,
        subtitle: `مدة ${availExam.durationMin} دقيقة · نجاح ${availExam.passScorePercent}%`,
      };
    }
    const pendingHw = hwItems.find(
      (h) => !h.submissionStatus || h.submissionStatus === 'RETURNED_FOR_REVISION',
    );
    if (pendingHw) {
      return {
        kind: 'HOMEWORK' as const,
        id: pendingHw.id,
        title: pendingHw.titleAr,
        subtitle: `الدرجة الكلية: ${pendingHw.maximumGrade} درجة`,
      };
    }
    return null;
  }, [data.exams, hwItems]);

  // Recent real activity feed (exams + homework)
  const recentActivity = useMemo(() => {
    const list: Array<{
      key: string;
      title: string;
      subtitle: string;
      done: boolean;
      onClick: () => void;
    }> = [];

    for (const att of data.recentAttempts.slice(0, 3)) {
      list.push({
        key: `att-${att.id}`,
        title: att.examTitleAr,
        subtitle: att.submittedAt ? formatDateTimeAr(att.submittedAt) : 'محاولة امتحان',
        done: att.resultPublished !== false,
        onClick: () => onNavigateTarget({ type: 'RESULTS', entityId: att.examId }),
      });
    }

    for (const hw of hwItems.slice(0, 3)) {
      if (list.length >= 4) break;
      list.push({
        key: `hw-${hw.id}`,
        title: hw.titleAr,
        subtitle: hw.submittedAt
          ? `سُلّم ${formatDateTimeAr(hw.submittedAt)}`
          : hw.deadline
            ? `موعده ${formatDateTimeAr(hw.deadline)}`
            : 'واجب تدريبي',
        done: hw.submissionStatus === 'GRADED' || hw.submissionStatus === 'SUBMITTED',
        onClick: () => onOpenHomework(hw.id),
      });
    }

    return list.slice(0, 4);
  }, [data.recentAttempts, hwItems, onNavigateTarget, onOpenHomework]);

  // Build real practice cards from authorized exams & homework
  const practiceCards = useMemo(() => {
    const selectedUnit = selectedUnitId
      ? data.units.find((u) => u.id === selectedUnitId) || null
      : null;

    const unitKeywords = (() => {
      if (!selectedUnit) return [] as string[];
      const stopWords = new Set([
        'الوحدة',
        'الفصل',
        'الباب',
        'الأولى',
        'الثانية',
        'الثالثة',
        'الرابعة',
        'الخامسة',
        'الأول',
        'الثاني',
        'الثالث',
        'الرابع',
        'الخامس',
        'درس',
        'الدروس',
        'في',
        'عن',
        'على',
        'من',
        'إلى',
        'و',
      ]);
      const phrases: string[] = [
        selectedUnit.titleAr,
        ...data.lessons.filter((l) => l.unitId === selectedUnit.id).map((l) => l.titleAr),
        ...data.videos.filter((v) => v.unitId === selectedUnit.id).map((v) => v.titleAr),
      ];
      const normalizedSet = new Set<string>();
      for (const phrase of phrases) {
        const cleaned = phrase
          .replace(/^(الوحدة|الفصل|الباب)\s+\S+\s*[:：\-–]?\s*/u, '')
          .trim()
          .toLowerCase();
        if (cleaned.length >= 3) normalizedSet.add(cleaned);
        for (const tok of cleaned.split(/[\s،,.:؛\-–/()]+/u)) {
          const t = tok.trim();
          if (t.length >= 3 && !stopWords.has(t)) {
            normalizedSet.add(t);
          }
        }
      }
      return Array.from(normalizedSet);
    })();

    const matchesSelectedUnit = (text: string): boolean => {
      if (!selectedUnit) return true;
      const hay = text.toLowerCase();
      if (hay.includes(selectedUnit.titleAr.trim().toLowerCase())) return true;
      return unitKeywords.some((kw) => hay.includes(kw));
    };

    const cards: Array<{
      key: string;
      kind: 'EXAM' | 'HOMEWORK';
      id: number;
      title: string;
      description: string;
      badgeLabel: string;
      badgeCls: string;
      metaRight: string;
      metaLeft: string;
      ctaLabel: string;
      ctaVariant: 'blue' | 'purple';
      onAction: () => void;
    }> = [];

    for (const ex of data.exams) {
      if (!matchesSelectedUnit(`${ex.titleAr} ${ex.descriptionAr || ''}`)) {
        continue;
      }
      const st = resolveStudentExamStatus(ex);
      const badgeCls =
        st.code === 'RESULT_PUBLISHED'
          ? 'bg-emerald-500 text-white'
          : st.code === 'IN_PROGRESS'
            ? 'bg-sky-500 text-white'
            : st.code === 'AVAILABLE'
              ? 'bg-amber-400 text-slate-950'
              : st.code === 'UPCOMING'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-600 text-white';

      const ctaLabel =
        st.code === 'IN_PROGRESS'
          ? 'استئناف المحاولة'
          : st.code === 'AVAILABLE'
            ? 'ابدأ التدريب والامتحان'
            : st.code === 'RESULT_PUBLISHED'
              ? 'عرض النتيجة والمراجعة'
              : 'عرض حالة الامتحان';

      cards.push({
        key: `ex-${ex.id}`,
        kind: 'EXAM',
        id: ex.id,
        title: ex.titleAr,
        description:
          ex.descriptionAr || 'اختبار تفاعلي بتصحيح تلقائي ومتابعة دقيقة للوقت والنتائج.',
        badgeLabel: st.labelAr,
        badgeCls,
        metaRight: `نجاح ${ex.passScorePercent}%`,
        metaLeft: `${ex.durationMin} دقيقة`,
        ctaLabel,
        ctaVariant: 'blue',
        onAction: () =>
          st.canStartOrResume
            ? onOpenExam(ex.id)
            : onNavigateTarget({ type: 'EXAM', entityId: ex.id }),
      });
    }

    for (const hw of hwItems) {
      if (!matchesSelectedUnit(hw.titleAr)) {
        continue;
      }
      cards.push({
        key: `hw-${hw.id}`,
        kind: 'HOMEWORK',
        id: hw.id,
        title: hw.titleAr,
        description:
          hw.submissionStatus === 'GRADED'
            ? `تم تصحيح الواجب (${hw.awardedGrade ?? 0}/${hw.maximumGrade}) ويمكنك مراجعة الحل.`
            : 'واجب تطبيقي بأسئلة اختيار من متعدد أو رفع صور الحل للمراجعة والتصحيح.',
        badgeLabel: hw.submissionStatus === 'GRADED' ? 'مُصحّح' : 'واجب تطبيقي',
        badgeCls:
          hw.submissionStatus === 'GRADED'
            ? 'bg-emerald-500 text-white'
            : 'bg-violet-600 text-white',
        metaRight: `${hw.maximumGrade} درجة`,
        metaLeft: hw.submissionStatus === 'GRADED' ? 'مكتمل' : 'متاح للحل',
        ctaLabel: hw.submissionStatus === 'GRADED' ? 'عرض النتيجة والحل' : 'فتح الواجب للتدريب',
        ctaVariant: 'purple',
        onAction: () => onOpenHomework(hw.id),
      });
    }

    return cards;
  }, [data.exams, data.units, data.lessons, data.videos, hwItems, selectedUnitId, onOpenExam, onOpenHomework, onNavigateTarget]);

  const rail = (
    <>
      {/* 1. Practice Progress Ring */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">تقدمك في التدريب</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.completedExams}</strong> امتحان
                محلول
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <BookCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.hwCompleted}</strong> واجب مكتمل
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <Award className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span>
                متوسط:{' '}
                <strong className="font-mono-num text-white">
                  {stats.avgScorePct !== null ? `${stats.avgScorePct}%` : '—'}
                </strong>
              </span>
            </div>
          </div>
          <StudentProgressRing percent={stats.completionPct} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={() => onNavigateTarget({ type: 'RESULTS' })}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          <span>عرض التقرير التفصيلي</span>
        </button>
      </StudentRailCard>

      {/* 2. Weekly / Next Real Challenge Card */}
      <StudentRailCard glow="purple" className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-violet-500/30 text-amber-300 ring-1 ring-amber-300/40 shadow-[0_0_24px_rgba(251,191,36,0.28)]">
          <Trophy className="h-6 w-6" />
        </div>
        <h3 className="mt-3 font-display text-base font-extrabold text-white">
          {nextChallenge ? 'تحدي متاح الآن' : 'أتممت تدريباتك!'}
        </h3>
        <p className="mt-1 text-xs text-slate-300 leading-relaxed line-clamp-2">
          {nextChallenge
            ? `${nextChallenge.title} — ${nextChallenge.subtitle}`
            : 'يمكنك مراجعة نتائجك أو استعراض خطة المنهج للمذاكرة.'}
        </p>
        <button
          type="button"
          onClick={() => {
            if (nextChallenge?.kind === 'EXAM') onOpenExam(nextChallenge.id);
            else if (nextChallenge?.kind === 'HOMEWORK') onOpenHomework(nextChallenge.id);
            else onNavigateTarget({ type: 'EXAM' });
          }}
          className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] via-[#3B82F6] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>{nextChallenge ? 'ابدأ التحدي الآن' : 'استعراض الامتحانات'}</span>
        </button>
      </StudentRailCard>

      {/* 3. Recent Activity Card */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h3 className="font-display text-sm font-extrabold text-white">نشاطك الأخير</h3>
          <History className="h-4 w-4 text-sky-300" />
        </div>
        {recentActivity.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            لم تسجّل محاولات تدريبية بعد. ابدأ بأي اختبار أو واجب من صفك.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {recentActivity.map((act) => (
              <button
                key={act.key}
                type="button"
                onClick={act.onClick}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B1739]/80 px-3 py-2 text-right hover:border-sky-400/45 transition-all"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-extrabold text-white">{act.title}</div>
                  <div className="truncate text-[10.5px] text-slate-400">{act.subtitle}</div>
                </div>
                <CheckCircle2
                  className={`h-4 w-4 shrink-0 ${
                    act.done ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onNavigateTarget({ type: 'RESULTS' })}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/8 py-2 text-xs font-bold text-slate-200 hover:bg-white/15"
        >
          <span>عرض كل النشاط والنتائج</span>
        </button>
      </StudentRailCard>
    </>
  );

  return (
    <StudentTwoColShell rail={rail} testId="student-practice-view">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="بنك الأسئلة والتدريب التفاعلي"
        subtitle="تدرّب على أسئلة المنهج من خلال اختبارات صفك وواجباتك التفاعلية مع التصحيح والمراجعة المنظمة."
        icon={<HelpCircle className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.practice}
        artworkAlt="بنك الأسئلة والتدريب التفاعلي"
        chips={[
          { icon: <ClipboardList className="h-3.5 w-3.5" />, label: `${stats.totalExams} اختبار متاح` },
          { icon: <BookCheck className="h-3.5 w-3.5" />, label: `${stats.hwTotal} واجب تدريبي` },
          { icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />, label: 'نماذج الإجابة محمية' },
        ]}
      />

      {/* 2. Three Vibrant Gradient Action Cards matching 08_Question_Practice.png */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* Electric Blue: Exams */}
        <div className="flex flex-col justify-between rounded-2xl border border-sky-400/50 bg-gradient-to-br from-[#0284C7]/95 via-[#1D4ED8]/90 to-[#0B2259]/95 p-4 text-white shadow-[0_10px_26px_rgba(2,132,199,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-white">
                الاختبارات والتدريبات المتاحة
              </h2>
              <p className="mt-1 text-xs text-sky-100/90 leading-relaxed">
                لديك{' '}
                <strong className="font-mono-num text-white">{stats.totalExams}</strong> اختبار في
                صفك للتدرب والتصحيح التلقائي.
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <ClipboardList className="h-5 w-5" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTarget({ type: 'EXAM' })}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/20 py-2 text-xs font-extrabold text-white backdrop-blur-xs hover:bg-white/30 transition-colors"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>استعرض الاختبارات</span>
          </button>
        </div>

        {/* Vibrant Orange: Homework */}
        <div className="flex flex-col justify-between rounded-2xl border border-orange-400/50 bg-gradient-to-br from-[#EA580C]/95 via-[#C2410C]/90 to-[#431407]/95 p-4 text-white shadow-[0_10px_26px_rgba(234,88,12,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-white">
                واجبات وتدريبات الدروس
              </h2>
              <p className="mt-1 text-xs text-orange-100/90 leading-relaxed">
                تصفّح واجبات صفك (
                <strong className="font-mono-num text-white">{stats.hwTotal}</strong> واجب) وسلّم
                إجاباتك للتصحيح والمراجعة.
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <BookCheck className="h-5 w-5" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTarget({ type: 'HOMEWORK' })}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/20 py-2 text-xs font-extrabold text-white backdrop-blur-xs hover:bg-white/30 transition-colors"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>الانتقال إلى الواجبات</span>
          </button>
        </div>

        {/* Royal Purple: Curriculum & Quick Reviews */}
        <div className="flex flex-col justify-between rounded-2xl border border-violet-400/50 bg-gradient-to-br from-[#7C3AED]/95 via-[#5B21B6]/90 to-[#2E1065]/95 p-4 text-white shadow-[0_10px_26px_rgba(124,58,237,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-white">
                مراجعات سريعة وخطة المنهج
              </h2>
              <p className="mt-1 text-xs text-violet-100/90 leading-relaxed">
                راجع ملخصات القوانين (
                <strong className="font-mono-num text-white">{data.units.length}</strong> وحدات)
                وتابع خطتك الأسبوعية بتركيز.
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <Zap className="h-5 w-5" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTarget({ type: 'CURRICULUM' })}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/20 py-2 text-xs font-extrabold text-white backdrop-blur-xs hover:bg-white/30 transition-colors"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>ابدأ المراجعة</span>
          </button>
        </div>
      </div>

      {/* 3. Real Training Summary Strip (Zero Fabricated Numbers) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 px-4 py-3.5 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-extrabold text-white">ملخص تدريبك</div>
            <div className="text-[11px] text-slate-400">بيانات حقيقية من صفك</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-r border-white/10 pr-3">
          <HelpCircle className="h-5 w-5 text-violet-300 shrink-0" />
          <div>
            <div className="font-mono-num text-base font-extrabold text-white">
              {stats.totalActivities}
            </div>
            <div className="text-[11px] text-slate-300">إجمالي الأنشطة المتاحة</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-r border-white/10 pr-3">
          <Star className="h-5 w-5 text-sky-300 shrink-0" />
          <div>
            <div className="font-mono-num text-base font-extrabold text-sky-300">
              {stats.avgScorePct !== null ? `${stats.avgScorePct}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-300">متوسط النتائج المنشورة</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-r border-white/10 pr-3">
          <Target className="h-5 w-5 text-emerald-300 shrink-0" />
          <div>
            <div className="font-mono-num text-base font-extrabold text-emerald-300">
              {stats.completedActivities} / {stats.totalActivities}
            </div>
            <div className="text-[11px] text-slate-300">أنشطة مكتملة</div>
          </div>
        </div>
      </div>

      {/* 4. Topic / Unit Filter Chips */}
      {data.units.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#2D4A8A]/45 bg-[#0A1638]/90 px-3.5 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-200 whitespace-nowrap shrink-0 pl-1">
            <Layers className="h-4 w-4 text-sky-300" />
            تصفح حسب الموضوع
          </span>
          <button
            type="button"
            onClick={() => setSelectedUnitId(0)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold whitespace-nowrap shrink-0 transition-all ${
              selectedUnitId === 0
                ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-md'
                : 'border border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            كل الموضوعات
          </button>
          {data.units.map((u) => {
            const active = selectedUnitId === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedUnitId(active ? 0 : u.id)}
                className={`max-w-full truncate rounded-full px-3.5 py-2 text-xs font-bold transition-all ${
                  active
                    ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-md'
                    : 'border border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {u.titleAr}
              </button>
            );
          })}
        </div>
      )}

      {/* 5. Recommended Interactive Practice Cards (Crisp WHITE Cards matching 08_Question_Practice.png) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-white">
              <Sparkles className="h-4 w-4 text-amber-300" />
              <span>تدريبات وتقييمات متاحة لك</span>
            </h3>
            <p className="text-xs text-slate-300">
              اختبارات وواجبات صفك الحقيقية المتاحة للتدريب والتصحيح الفوري
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTarget({ type: 'EXAM' })}
            className="rounded-xl border border-white/15 bg-white/8 px-3.5 py-1.5 text-xs font-bold text-sky-200 hover:bg-white/15"
          >
            عرض المزيد من الامتحانات
          </button>
        </div>

        {practiceCards.length === 0 ? (
          <StudentEmptyState
            icon={<HelpCircle className="h-6 w-6" />}
            title="لا توجد تدريبات مطابقة لهذا الموضوع حاليًا"
            description="جرّب اختيار (كل الموضوعات) لعرض جميع اختبارات وواجبات صفك."
            actionLabel={selectedUnitId !== 0 ? 'عرض كل الموضوعات' : undefined}
            onAction={selectedUnitId !== 0 ? () => setSelectedUnitId(0) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {practiceCards.map((card, idx) => (
              <StudentWhiteCard
                key={card.key}
                className="flex flex-col justify-between overflow-hidden hover:-translate-y-0.5 transition-all"
              >
                <div>
                  <div className="relative h-28 bg-[#07112B] overflow-hidden">
                    <img
                      src={pickPhysicsArtwork(card.id + idx)}
                      alt={card.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/80 via-transparent to-[#060E24]/25" />
                    <span
                      className={`absolute top-2 left-2 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm ${card.badgeCls}`}
                    >
                      {card.badgeLabel}
                    </span>
                  </div>

                  <div className="p-3.5 space-y-2">
                    <h4 className="font-display text-sm font-extrabold text-[#0B162C] leading-snug line-clamp-1">
                      {card.title}
                    </h4>
                    <p className="text-[11.5px] text-slate-600 leading-relaxed line-clamp-2 min-h-[2.2rem]">
                      {card.description}
                    </p>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-[11px] font-bold text-slate-600 font-mono-num">
                      <span className="inline-flex items-center gap-1">
                        <Award className="h-3.5 w-3.5 text-[#2563EB]" />
                        {card.metaRight}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                        {card.metaLeft}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-3.5 pb-3.5">
                  <button
                    type="button"
                    onClick={card.onAction}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110 ${
                      card.ctaVariant === 'purple'
                        ? 'bg-gradient-to-l from-[#7C3AED] to-[#4F46E5]'
                        : 'bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9]'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>{card.ctaLabel}</span>
                  </button>
                </div>
              </StudentWhiteCard>
            ))}
          </div>
        )}

        {/* Truthful Security Notice */}
        <div className="flex items-center gap-2.5 rounded-xl border border-sky-400/25 bg-[#0A1638]/85 px-4 py-3 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            حفاظًا على سرية نماذج الإجابات والأسئلة الإدارية، يتم التدريب هنا عبر الاختبارات
            والواجبات المعتمدة لصفك فقط.
          </span>
        </div>
      </section>
    </StudentTwoColShell>
  );
};
