import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Crown,
  FileText,
  Gem,
  Info,
  KeyRound,
  Layers,
  Lock,
  Play,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  StudentCourseItem,
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../../types/lms.ts';
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

interface StudentCoursesViewProps {
  data: StudentDashboardData;
  selectedCourseId?: number | null;
  onPlayVideo: (video: StudentVideoItem) => void;
  onStartCheckout: (target: {
    targetType: 'VIDEO' | 'COURSE' | 'PLAN';
    targetId: number;
    titleAr: string;
    priceEgp: number;
  }) => void;
  onOpenBilling: () => void;
  onNavigateTarget?: (target: StudentDeepLinkTarget) => void;
}

type CourseFilterTab = 'ALL' | 'ENROLLED' | 'AVAILABLE' | 'PLANS';

export const StudentCoursesView: React.FC<StudentCoursesViewProps> = ({
  data,
  selectedCourseId = null,
  onPlayVideo,
  onStartCheckout,
  onOpenBilling,
  onNavigateTarget,
}) => {
  const [filter, setFilter] = useState<CourseFilterTab>('ALL');
  const [detailsCourse, setDetailsCourse] = useState<StudentCourseItem | null>(null);

  const stats = useMemo(() => {
    const enrolled = data.courses.filter((c) => c.isUnlocked);
    const completed = enrolled.filter((c) => c.progressPercent >= 100).length;
    const inProgress = enrolled.filter(
      (c) => c.progressPercent > 0 && c.progressPercent < 100,
    ).length;
    const notStarted = data.courses.length - completed - inProgress;
    const avgProgress =
      enrolled.length > 0
        ? Math.round(
            enrolled.reduce((sum, c) => sum + c.progressPercent, 0) / enrolled.length,
          )
        : 0;
    const totalLessons = data.courses.reduce((sum, c) => sum + c.lessonsCount, 0);
    return {
      enrolledCount: enrolled.length,
      completed,
      inProgress,
      notStarted,
      avgProgress,
      totalLessons,
    };
  }, [data.courses]);

  const featuredCourse = useMemo(() => {
    if (selectedCourseId) {
      const match = data.courses.find((c) => c.id === selectedCourseId);
      if (match) return match;
    }
    const activeEnrolled = data.courses.find(
      (c) => c.isUnlocked && c.progressPercent < 100,
    );
    if (activeEnrolled) return activeEnrolled;
    const anyEnrolled = data.courses.find((c) => c.isUnlocked);
    if (anyEnrolled) return anyEnrolled;
    return data.courses[0] || null;
  }, [data.courses, selectedCourseId]);

  const filteredCourses = useMemo(() => {
    if (filter === 'PLANS') return [];
    if (filter === 'ENROLLED') return data.courses.filter((c) => c.isUnlocked);
    if (filter === 'AVAILABLE') return data.courses.filter((c) => !c.isUnlocked);
    return data.courses;
  }, [data.courses, filter]);

  const showPlans = filter === 'ALL' || filter === 'PLANS';
  const spotlightPlan = data.plans[0] || null;

  const findResumeVideo = (course: StudentCourseItem): StudentVideoItem | null => {
    const allVids = course.lessons.flatMap((l) => l.videos);
    return (
      allVids.find((v) => v.hasAccess && !v.progress.isCompleted) ||
      allVids.find((v) => v.hasAccess) ||
      null
    );
  };

  const rail = (
    <>
      {/* 1. Course Progress Gauge */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">تقدمك في الكورسات</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.completed}</strong> كورس مكتمل
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <PlayCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.inProgress}</strong> قيد الدراسة
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <Layers className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.notStarted}</strong> لم يبدأ بعد
              </span>
            </div>
          </div>
          <StudentProgressRing percent={stats.avgProgress} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={() => setFilter(stats.enrolledCount > 0 ? 'ENROLLED' : 'ALL')}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>عرض جميع كورساتي ({stats.enrolledCount})</span>
        </button>
      </StudentRailCard>

      {/* 2. Conditional Subscription Spotlight */}
      {(spotlightPlan || data.platformSubscription) && (
        <StudentRailCard glow="purple" className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-violet-500/30 text-amber-300 ring-1 ring-amber-300/40 shadow-[0_0_24px_rgba(251,191,36,0.28)]">
            <Crown className="h-6 w-6" />
          </div>
          {data.platformSubscription?.isActive ? (
            <>
              <h3 className="mt-3 font-display text-base font-extrabold text-white">
                اشتراكك الشامل نشط
              </h3>
              <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                متبقي{' '}
                <strong className="font-mono-num text-amber-300">
                  {data.platformSubscription.remainingDays} يوم
                </strong>{' '}
                · {data.platformSubscription.scopeNoteAr}
              </p>
              <button
                type="button"
                onClick={onOpenBilling}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>إدارة اشتراكي والأكواد</span>
              </button>
            </>
          ) : spotlightPlan ? (
            <>
              <h3 className="mt-3 font-display text-base font-extrabold text-white">
                {spotlightPlan.nameAr}
              </h3>
              <p className="mt-1 text-xs text-slate-300 leading-relaxed line-clamp-2">
                {spotlightPlan.descriptionAr ||
                  `اشتراك لمدة ${spotlightPlan.durationDays} يومًا بقيمة ${spotlightPlan.priceEgp} ج.م`}
              </p>
              <div className="mt-2 font-mono-num text-lg font-extrabold text-amber-300">
                {spotlightPlan.priceEgp} <span className="text-xs font-normal text-slate-300">ج.م</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onStartCheckout({
                    targetType: 'PLAN',
                    targetId: spotlightPlan.id,
                    titleAr: spotlightPlan.nameAr,
                    priceEgp: spotlightPlan.priceEgp,
                  })
                }
                className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] via-[#3B82F6] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>الاشتراك في الباقة الآن</span>
              </button>
            </>
          ) : null}
        </StudentRailCard>
      )}

      {/* 3. Subscription Benefits */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h3 className="font-display text-sm font-extrabold text-white">مزايا الاشتراك</h3>
          <Gem className="h-4 w-4 text-sky-300" />
        </div>
        <ul className="mt-3 space-y-2.5 text-xs text-slate-200">
          {[
            'الوصول الكامل لمحاضرات الكورس المنظمة',
            'تتبع تلقائي لنسبة المشاهدة والإنجاز',
            'مذكرات PDF وملخصات مرفقة بالدروس',
            'تفعيل فوري عبر أكواد السنتر أو الدفع',
          ].map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      </StudentRailCard>
    </>
  );

  return (
    <StudentTwoColShell rail={rail} testId="student-courses-view">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="الكورسات وباقات الاشتراك"
        subtitle="تعرّف على جميع الكورسات المتاحة لصفك واختر الباقة الأنسب للوصول إلى المحتوى الكامل وخطة التعلم المتكاملة."
        icon={<BookOpen className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.courses}
        artworkAlt="الكورسات وباقات الاشتراك"
        chips={[
          { icon: <BookOpen className="h-3.5 w-3.5" />, label: `${data.courses.length} كورس` },
          { icon: <PlayCircle className="h-3.5 w-3.5" />, label: `${stats.totalLessons} درس` },
          { icon: <Crown className="h-3.5 w-3.5 text-amber-300" />, label: `${data.plans.length} باقات اشتراك` },
        ]}
      />

      {/* 2. Featured Enrolled / Highlighted Course Spotlight */}
      {featuredCourse && (
        <section className="overflow-hidden rounded-2xl border border-[#3B82F6]/45 bg-gradient-to-l from-[#12225B]/95 via-[#172162]/95 to-[#0C173E]/95 p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.48)]">
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.95fr] gap-5 items-center">
            {/* Right side (RTL): Details & Progress */}
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {featuredCourse.isUnlocked ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 py-0.5 text-[11px] font-extrabold text-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    كورس مسجل به
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/45 bg-sky-500/20 px-3 py-0.5 text-[11px] font-extrabold text-sky-200">
                    <Sparkles className="h-3.5 w-3.5" />
                    كورس مميز للصف
                  </span>
                )}
                {featuredCourse.hasCertificate && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-200">
                    <Award className="h-3 w-3" />
                    شهادة إتمام
                  </span>
                )}
              </div>

              <h2 className="font-display text-lg sm:text-2xl font-extrabold text-white leading-snug">
                {featuredCourse.titleAr}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-2">
                {featuredCourse.descriptionAr}
              </p>

              {/* Metadata Strip */}
              <div className="inline-flex flex-wrap items-center gap-3 rounded-xl border border-white/12 bg-[#091435]/80 px-3.5 py-2 text-xs text-slate-200">
                <span className="inline-flex items-center gap-1.5 font-mono-num font-bold">
                  <PlayCircle className="h-3.5 w-3.5 text-sky-300" />
                  {featuredCourse.lessonsCount} درسًا
                </span>
                <span className="text-white/25">|</span>
                <span className="inline-flex items-center gap-1.5 font-mono-num font-bold">
                  <Clock className="h-3.5 w-3.5 text-sky-300" />
                  {featuredCourse.totalHours} ساعة
                </span>
                <span className="text-white/25">|</span>
                <span className="font-mono-num text-slate-300">
                  صلاحية {featuredCourse.validityDays} يومًا
                </span>
              </div>

              {featuredCourse.isUnlocked ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-200">التقدم في الكورس</span>
                    <span className="font-mono-num text-sky-300">
                      {featuredCourse.progressPercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/12">
                    <div
                      style={{ width: `${featuredCourse.progressPercent}%` }}
                      className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="font-mono-num text-2xl font-extrabold text-sky-300">
                    {featuredCourse.discountPriceEgp} ج.م
                  </span>
                  {featuredCourse.originalPriceEgp > featuredCourse.discountPriceEgp && (
                    <span className="font-mono-num text-xs text-slate-400 line-through">
                      {featuredCourse.originalPriceEgp} ج.م
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {featuredCourse.isUnlocked ? (
                  <button
                    type="button"
                    onClick={() => {
                      const vid = findResumeVideo(featuredCourse);
                      if (vid) onPlayVideo(vid);
                      else setDetailsCourse(featuredCourse);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,0.42)] hover:brightness-110"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>استكمال الكورس</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onStartCheckout({
                        targetType: 'COURSE',
                        targetId: featuredCourse.id,
                        titleAr: featuredCourse.titleAr,
                        priceEgp: featuredCourse.discountPriceEgp,
                      })
                    }
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,0.42)] hover:brightness-110"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>التسجيل في الكورس الآن</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setDetailsCourse(featuredCourse)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/8 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/15"
                >
                  <Info className="h-4 w-4 text-sky-300" />
                  <span>عرض تفاصيل الكورس</span>
                </button>
              </div>
            </div>

            {/* Left side (RTL): Thumbnail Preview */}
            <div className="relative overflow-hidden rounded-2xl border border-sky-400/35 bg-[#07112B] aspect-[16/9] group">
              <img
                src={featuredCourse.thumbnailUrl || pickPhysicsArtwork(featuredCourse.id)}
                alt={featuredCourse.titleAr}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/85 via-transparent to-transparent" />
              <button
                type="button"
                onClick={() => {
                  const vid = findResumeVideo(featuredCourse);
                  if (vid) onPlayVideo(vid);
                  else setDetailsCourse(featuredCourse);
                }}
                aria-label="معاينة الكورس"
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-[#1D4ED8] shadow-[0_0_28px_rgba(56,189,248,0.6)] transition-transform group-hover:scale-110">
                  <Play className="h-6 w-6 fill-current mr-0.5" />
                </span>
              </button>
              <div className="absolute bottom-3 right-3 rounded-lg bg-[#081330]/85 px-2.5 py-1 font-mono-num text-[11px] font-bold text-sky-200 border border-white/15">
                {featuredCourse.videosCount} محاضرة فيديو
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Filter Pills Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#2D4A8A]/45 bg-[#0A1638]/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-sky-300" />
          <h2 className="font-display text-sm font-extrabold text-white">الكورسات المتاحة</h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: `الكل (${data.courses.length + data.plans.length})` },
              { id: 'ENROLLED', label: `مسجل بها (${stats.enrolledCount})` },
              {
                id: 'AVAILABLE',
                label: `متاحة للاشتراك (${data.courses.length - stats.enrolledCount})`,
              },
              { id: 'PLANS', label: `باقات الاشتراك (${data.plans.length})` },
            ] as const
          ).map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all ${
                  active
                    ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)]'
                    : 'border border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Crisp Contrast White Course & Plan Cards Grid (matching 04_Courses.png) */}
      {filteredCourses.length === 0 && (!showPlans || data.plans.length === 0) ? (
        <StudentEmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={
            filter === 'ENROLLED'
              ? 'لست مسجلًا في أي كورس حتى الآن'
              : 'لا توجد كورسات أو باقات مطابقة لهذا التصنيف'
          }
          description="تصفّح جميع الكورسات المتاحة أو استخدم كود تفعيل السنتر لفتح المحتوى فورًا."
          actionLabel="عرض الكل"
          onAction={() => setFilter('ALL')}
          secondaryActionLabel="تفعيل بكود"
          onSecondaryAction={onOpenBilling}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map((course) => {
            const isHighlighted = selectedCourseId === course.id;
            return (
              <StudentWhiteCard
                key={course.id}
                className={`flex flex-col justify-between overflow-hidden transition-all ${
                  isHighlighted ? 'ring-2 ring-sky-400' : 'hover:-translate-y-0.5'
                }`}
              >
                <div>
                  {/* Dark Physics Header Artwork */}
                  <div className="relative h-36 bg-[#07112B] overflow-hidden">
                    <img
                      src={course.thumbnailUrl || pickPhysicsArtwork(course.id)}
                      alt={course.titleAr}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#07112B]/85 via-transparent to-[#07112B]/35" />
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold backdrop-blur-xs border ${
                          course.isUnlocked
                            ? 'border-emerald-300/60 bg-emerald-600/85 text-white'
                            : 'border-sky-300/60 bg-[#1D4ED8]/85 text-white'
                        }`}
                      >
                        {course.isUnlocked ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            مسجل به
                          </>
                        ) : (
                          <>
                            <BookOpen className="h-3 w-3" />
                            كورس كامل
                          </>
                        )}
                      </span>
                    </div>
                    <div className="absolute bottom-2.5 left-2.5 rounded-lg bg-[#07112B]/85 px-2.5 py-0.5 font-mono-num text-xs font-extrabold text-sky-300 border border-white/15">
                      {course.isUnlocked ? `${course.progressPercent}% مكتمل` : `${course.discountPriceEgp} ج.م`}
                    </div>
                  </div>

                  {/* Crisp White Body */}
                  <div className="p-4 space-y-2.5">
                    <h3 className="font-display text-base font-extrabold text-[#0B162C] leading-snug line-clamp-1">
                      {course.titleAr}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 min-h-[2.4rem]">
                      {course.descriptionAr}
                    </p>

                    {/* Real Metadata Row */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 text-[11.5px] font-bold text-slate-700">
                      <span className="inline-flex items-center gap-1 font-mono-num">
                        <PlayCircle className="h-3.5 w-3.5 text-[#2563EB]" />
                        {course.lessonsCount} درسًا
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="inline-flex items-center gap-1 font-mono-num">
                        <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                        {course.totalHours} ساعة
                      </span>
                      {course.originalPriceEgp > course.discountPriceEgp && !course.isUnlocked && (
                        <>
                          <span className="text-slate-300">|</span>
                          <span className="font-mono-num text-slate-400 line-through">
                            {course.originalPriceEgp} ج.م
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="px-4 pb-4 pt-1 space-y-2">
                  {course.isUnlocked ? (
                    <button
                      type="button"
                      onClick={() => {
                        const vid = findResumeVideo(course);
                        if (vid) onPlayVideo(vid);
                        else setDetailsCourse(course);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-md hover:brightness-110"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>استكمال الكورس</span>
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onStartCheckout({
                            targetType: 'COURSE',
                            targetId: course.id,
                            titleAr: course.titleAr,
                            priceEgp: course.discountPriceEgp,
                          })
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-md hover:brightness-110"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>التسجيل في الكورس</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenBilling}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        كود
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setDetailsCourse(course)}
                    className="w-full text-center text-[11px] font-bold text-[#2563EB] hover:underline"
                  >
                    عرض محتوى ودروس الكورس ({course.lessons.length})
                  </button>
                </div>
              </StudentWhiteCard>
            );
          })}

          {/* Subscription Plan Cards matching 04_Courses.png purple-accent card */}
          {showPlans &&
            data.plans.map((pl) => (
              <StudentWhiteCard
                key={`plan-${pl.id}`}
                className="flex flex-col justify-between overflow-hidden hover:-translate-y-0.5 transition-all"
              >
                <div>
                  <div className="relative h-36 bg-gradient-to-br from-[#2E1065] via-[#4C1D95] to-[#1E1B4B] overflow-hidden">
                    <img
                      src={STUDENT_ARTWORK.courses}
                      alt={pl.nameAr}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-80"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#1E1B4B]/90 via-transparent to-transparent" />
                    <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-500/90 px-2.5 py-0.5 text-[10.5px] font-extrabold text-slate-950">
                      <Crown className="h-3 w-3" />
                      باقة اشتراك
                    </span>
                    <div className="absolute bottom-2.5 left-2.5 rounded-lg bg-[#091232]/85 px-2.5 py-0.5 font-mono-num text-xs font-extrabold text-amber-300 border border-white/15">
                      {pl.priceEgp} ج.م
                    </div>
                  </div>

                  <div className="p-4 space-y-2.5">
                    <h3 className="font-display text-base font-extrabold text-[#0B162C] leading-snug">
                      {pl.nameAr}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 min-h-[2.4rem]">
                      {pl.descriptionAr}
                    </p>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 text-[11.5px] font-bold text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-violet-600" />
                        {pl.billingCycle === 'MONTHLY'
                          ? 'اشتراك شهري'
                          : pl.billingCycle === 'TERM'
                            ? 'اشتراك فصلي'
                            : 'اشتراك سنوي'}
                      </span>
                      <span className="font-mono-num text-violet-700">
                        {pl.durationDays} يومًا
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-4 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onStartCheckout({
                        targetType: 'PLAN',
                        targetId: pl.id,
                        titleAr: pl.nameAr,
                        priceEgp: pl.priceEgp,
                      })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] to-[#4F46E5] py-2.5 text-xs font-extrabold text-white shadow-md hover:brightness-110"
                  >
                    <Crown className="h-3.5 w-3.5" />
                    <span>الاشتراك في الباقة ({pl.priceEgp} ج.م)</span>
                  </button>
                </div>
              </StudentWhiteCard>
            ))}
        </div>
      )}

      {/* Course Content & Lessons Modal */}
      {detailsCourse && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#3B82F6]/40 bg-[#0B173B] text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <div className="text-xs font-bold text-sky-300">محتوى ودروس الكورس</div>
                <h3 className="font-display text-lg font-extrabold text-white truncate">
                  {detailsCourse.titleAr}
                </h3>
              </div>
              <button
                type="button"
                aria-label="إغلاق تفاصيل الكورس"
                onClick={() => setDetailsCourse(null)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {detailsCourse.descriptionAr}
              </p>

              <div className="space-y-2">
                {detailsCourse.lessons.length === 0 ? (
                  <p className="text-xs text-slate-400">لم تُضف دروس تفصيلية لهذا الكورس بعد.</p>
                ) : (
                  detailsCourse.lessons.map((l, idx) => {
                    const playableVid = l.videos.find((v) => v.hasAccess);
                    const lessonPdf = data.lessons.find(
                      (ls) => ls.id === l.lessonId && Boolean(ls.pdfUrl || ls.pdfTitleAr),
                    );
                    const canOpenPdf = Boolean(
                      lessonPdf && onNavigateTarget && (detailsCourse.isUnlocked || l.isFreePreview),
                    );

                    return (
                      <div
                        key={l.lessonId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/12 bg-[#0F204E]/80 px-3.5 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 font-mono-num text-[11px] font-extrabold text-sky-200">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="font-bold text-white truncate">{l.titleAr}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {canOpenPdf && (
                            <button
                              type="button"
                              onClick={() => {
                                setDetailsCourse(null);
                                onNavigateTarget?.({ type: 'PDF', entityId: l.lessonId });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/25"
                            >
                              <FileText className="h-3 w-3" />
                              <span>PDF</span>
                            </button>
                          )}
                          {playableVid ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDetailsCourse(null);
                                onPlayVideo(playableVid);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-1 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>مشاهدة</span>
                            </button>
                          ) : l.isFreePreview ? (
                            l.videos[0] ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setDetailsCourse(null);
                                  onPlayVideo(l.videos[0]);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-extrabold text-white hover:bg-emerald-500"
                              >
                                <Play className="h-3 w-3 fill-current" />
                                <span>معاينة مجانية</span>
                              </button>
                            ) : (
                              <span className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
                                معاينة مجانية
                              </span>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const target = detailsCourse;
                                setDetailsCourse(null);
                                onStartCheckout({
                                  targetType: 'COURSE',
                                  targetId: target.id,
                                  titleAr: target.titleAr,
                                  priceEgp: target.discountPriceEgp,
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-400/35 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25"
                            >
                              <Lock className="h-3 w-3" />
                              <span>فتح بالاشتراك</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-white/10 px-5 py-3.5">
              {!detailsCourse.isUnlocked && (
                <button
                  type="button"
                  onClick={() => {
                    const target = detailsCourse;
                    setDetailsCourse(null);
                    onStartCheckout({
                      targetType: 'COURSE',
                      targetId: target.id,
                      titleAr: target.titleAr,
                      priceEgp: target.discountPriceEgp,
                    });
                  }}
                  className="rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-5 py-2 text-xs font-extrabold text-white hover:brightness-110"
                >
                  شراء الكورس ({detailsCourse.discountPriceEgp} ج.م)
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailsCourse(null)}
                className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </StudentTwoColShell>
  );
};
