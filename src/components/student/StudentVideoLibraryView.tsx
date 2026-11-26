import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  FileText,
  Filter,
  Layers,
  Lock,
  Play,
  PlayCircle,
  Search,
  Sparkles,
  Video,
} from 'lucide-react';
import type {
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../../types/lms.ts';
import { formatDurationAr } from '../../lib/api.ts';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentProgressRing,
  StudentRailCard,
  StudentTwoColShell,
  pickPhysicsArtwork,
} from './StudentUiPrimitives.tsx';

interface StudentVideoLibraryViewProps {
  data: StudentDashboardData;
  initialMode?: 'library' | 'free' | 'paid';
  onPlayVideo: (video: StudentVideoItem) => void;
  onStartCheckout: (target: {
    targetType: 'VIDEO' | 'COURSE' | 'PLAN';
    targetId: number;
    titleAr: string;
    priceEgp: number;
  }) => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
  onOpenResults: () => void;
  onOpenBilling: () => void;
}

type CategoryKey = 'ALL' | 'FREE' | 'PAID' | 'COURSE' | 'WITH_PDF';

export const StudentVideoLibraryView: React.FC<StudentVideoLibraryViewProps> = ({
  data,
  initialMode = 'library',
  onPlayVideo,
  onStartCheckout,
  onNavigateTarget,
  onOpenResults,
  onOpenBilling,
}) => {
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<number>(0);
  const [lessonFilter, setLessonFilter] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'WATCHING' | 'UNSTARTED'>(
    'ALL',
  );
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>(
    initialMode === 'free' ? 'FREE' : initialMode === 'paid' ? 'PAID' : 'ALL',
  );
  const [collapsedUnits, setCollapsedUnits] = useState<Record<number, boolean>>({});

  // Sync when user switches between library / free / paid sidebar or top routes
  React.useEffect(() => {
    if (initialMode === 'free') setCategoryFilter('FREE');
    else if (initialMode === 'paid') setCategoryFilter('PAID');
    else setCategoryFilter('ALL');
  }, [initialMode]);

  const counts = useMemo(() => {
    const all = data.videos.length;
    const completed = data.videos.filter((v) => v.progress.isCompleted).length;
    const watching = data.videos.filter(
      (v) => !v.progress.isCompleted && v.progress.completionPercent > 0,
    ).length;
    const unstarted = Math.max(0, all - completed - watching);
    const free = data.videos.filter((v) => v.videoType === 'FREE').length;
    const paid = data.videos.filter((v) => v.videoType === 'PAID').length;
    const course = data.videos.filter((v) => v.videoType === 'COURSE').length;
    const withPdf = data.videos.filter((v) => v.hasPdfAttachment).length;
    return { all, completed, watching, unstarted, free, paid, course, withPdf };
  }, [data.videos]);

  const lessonsForSelectedUnit = useMemo(() => {
    if (!unitFilter) return data.lessons;
    return data.lessons.filter((l) => l.unitId === unitFilter);
  }, [data.lessons, unitFilter]);

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.videos.filter((v) => {
      if (
        q &&
        !v.titleAr.toLowerCase().includes(q) &&
        !v.descriptionAr.toLowerCase().includes(q) &&
        !(v.unitTitleAr || '').toLowerCase().includes(q) &&
        !(v.lessonTitleAr || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (unitFilter && v.unitId !== unitFilter) return false;
      if (lessonFilter && v.lessonId !== lessonFilter) return false;
      if (categoryFilter === 'FREE' && v.videoType !== 'FREE') return false;
      if (categoryFilter === 'PAID' && v.videoType !== 'PAID') return false;
      if (categoryFilter === 'COURSE' && v.videoType !== 'COURSE') return false;
      if (categoryFilter === 'WITH_PDF' && !v.hasPdfAttachment) return false;

      if (statusFilter === 'COMPLETED' && !v.progress.isCompleted) return false;
      if (
        statusFilter === 'WATCHING' &&
        (v.progress.isCompleted || v.progress.completionPercent <= 0)
      ) {
        return false;
      }
      if (
        statusFilter === 'UNSTARTED' &&
        (v.progress.isCompleted || v.progress.completionPercent > 0)
      ) {
        return false;
      }
      return true;
    });
  }, [data.videos, search, unitFilter, lessonFilter, categoryFilter, statusFilter]);

  // Featured resume video
  const resumeVideo = useMemo(() => {
    if (data.lastWatchedVideo && data.lastWatchedVideo.hasAccess) return data.lastWatchedVideo;
    const inProgress = data.videos.find(
      (v) => v.hasAccess && !v.progress.isCompleted && v.progress.completionPercent > 0,
    );
    if (inProgress) return inProgress;
    return data.videos.find((v) => v.hasAccess) || data.videos[0] || null;
  }, [data.lastWatchedVideo, data.videos]);

  // Active unit name for middle KPI card
  const activeUnitTitle = useMemo(() => {
    if (resumeVideo?.unitTitleAr) return resumeVideo.unitTitleAr;
    return data.units[0]?.titleAr || 'جميع الوحدات';
  }, [resumeVideo, data.units]);

  // Group filtered videos by unit (plus fallback group for videos without unitId)
  const unitGroups = useMemo(() => {
    const groups: Array<{
      id: number;
      titleAr: string;
      descriptionAr: string;
      videos: StudentVideoItem[];
    }> = [];

    for (const u of data.units) {
      const vids = filteredVideos.filter((v) => v.unitId === u.id);
      if (vids.length > 0) {
        groups.push({
          id: u.id,
          titleAr: u.titleAr,
          descriptionAr: u.descriptionAr,
          videos: vids,
        });
      }
    }

    const assignedIds = new Set(groups.flatMap((g) => g.videos.map((v) => v.id)));
    const unassigned = filteredVideos.filter((v) => !assignedIds.has(v.id));
    if (unassigned.length > 0) {
      groups.push({
        id: -1,
        titleAr: 'محاضرات ودروس إضافية',
        descriptionAr: '',
        videos: unassigned,
      });
    }
    return groups;
  }, [data.units, filteredVideos]);

  const toggleUnitCollapse = (id: number) => {
    setCollapsedUnits((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const categoryItems: Array<{
    id: CategoryKey;
    label: string;
    count: number;
    icon: React.ReactNode;
  }> = [
    {
      id: 'ALL',
      label: 'جميع الفيديوهات',
      count: counts.all,
      icon: <PlayCircle className="h-4 w-4" />,
    },
    {
      id: 'FREE',
      label: 'الفيديوهات المجانية',
      count: counts.free,
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      id: 'PAID',
      label: 'الفيديوهات المدفوعة',
      count: counts.paid,
      icon: <Crown className="h-4 w-4" />,
    },
    {
      id: 'COURSE',
      label: 'فيديوهات الكورسات',
      count: counts.course,
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      id: 'WITH_PDF',
      label: 'مرفق بها مذكرة PDF',
      count: counts.withPdf,
      icon: <FileText className="h-4 w-4" />,
    },
  ];

  const rail = (
    <>
      {/* 1. Video Progress Ring */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">تقدمك في الفيديوهات</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{counts.completed}</strong> فيديو مكتمل
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <PlayCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{counts.watching}</strong> قيد المشاهدة
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <Video className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{counts.unstarted}</strong> لم يبدأ بعد
              </span>
            </div>
          </div>
          <StudentProgressRing percent={data.overallProgressPercent} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={onOpenResults}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          <span>عرض تقارير الأداء</span>
        </button>
      </StudentRailCard>

      {/* 2. Video Categories Interactive Filter Card */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">فئات الفيديوهات</h2>
          <Filter className="h-4 w-4 text-sky-300" />
        </div>
        <div className="mt-3 space-y-1.5">
          {categoryItems.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${
                  active
                    ? 'bg-gradient-to-l from-[#1C64F2] to-[#0EA5E9] text-white shadow-[0_6px_18px_rgba(37,99,235,0.4)]'
                    : 'bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={active ? 'text-white' : 'text-sky-300'}>{cat.icon}</span>
                  <span className="truncate">{cat.label}</span>
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 font-mono-num text-[11px] font-extrabold ${
                    active ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>
      </StudentRailCard>
    </>
  );

  return (
    <StudentTwoColShell rail={rail} testId="student-video-library">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="مكتبة الفيديوهات والدروس المنظمة"
        subtitle="جميع المحاضرات مرتبة حسب الوحدة والدرس مع تتبع تلقائي لنسبة المشاهدة وحفظ آخر نقطة توقف."
        icon={<Video className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.videoLibrary}
        artworkAlt="مكتبة الفيديوهات التعليمية"
        chips={[
          ...(data.activeGrade
            ? [
                {
                  icon: <Layers className="h-3.5 w-3.5" />,
                  label: `${data.activeGrade.trackNameAr} — ${data.activeGrade.nameAr}`,
                },
              ]
            : []),
          { icon: <PlayCircle className="h-3.5 w-3.5" />, label: `${counts.all} محاضرة متاحة` },
        ]}
      />

      {/* 2. Three Gradient Summary Stat Banners (matching 05_Video_Library.png) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() =>
            setStatusFilter((prev) => (prev === 'COMPLETED' ? 'ALL' : 'COMPLETED'))
          }
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-right text-white shadow-[0_8px_22px_rgba(91,33,182,0.28)] transition-all hover:-translate-y-0.5 ${
            statusFilter === 'COMPLETED'
              ? 'border-violet-300 ring-2 ring-violet-300/60'
              : 'border-violet-400/45'
          } bg-gradient-to-l from-[#5B21B6]/90 via-[#4C1D95]/85 to-[#1E1B4B]/95`}
        >
          <div>
            <div className="font-mono-num text-2xl font-extrabold leading-none">
              {counts.completed}
            </div>
            <div className="mt-1 text-xs font-bold text-violet-100">فيديو مكتمل</div>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-violet-100 ring-1 ring-white/25">
            <CheckCircle2 className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            const targetUnitId = resumeVideo?.unitId || data.units[0]?.id || 0;
            if (!targetUnitId) return;
            setUnitFilter((prev) => (prev === targetUnitId ? 0 : targetUnitId));
            setLessonFilter(0);
          }}
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-right text-white shadow-[0_8px_22px_rgba(29,78,216,0.28)] transition-all hover:-translate-y-0.5 ${
            unitFilter > 0 && unitFilter === (resumeVideo?.unitId || data.units[0]?.id || 0)
              ? 'border-sky-300 ring-2 ring-sky-300/60'
              : 'border-blue-400/45'
          } bg-gradient-to-l from-[#1D4ED8]/90 via-[#1E40AF]/85 to-[#0F1E54]/95`}
        >
          <div className="min-w-0">
            <div className="font-display text-sm sm:text-base font-extrabold truncate">
              {activeUnitTitle}
            </div>
            <div className="mt-1 text-xs font-bold text-blue-100">الوحدة النشطة حاليًا</div>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-sky-100 ring-1 ring-white/25">
            <Layers className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSearch('');
            setUnitFilter(0);
            setLessonFilter(0);
            setStatusFilter('ALL');
            setCategoryFilter('ALL');
          }}
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-right text-white shadow-[0_8px_22px_rgba(2,132,199,0.28)] transition-all hover:-translate-y-0.5 ${
            !search && unitFilter === 0 && lessonFilter === 0 && statusFilter === 'ALL' && categoryFilter === 'ALL'
              ? 'border-cyan-300 ring-2 ring-cyan-300/50'
              : 'border-cyan-400/45'
          } bg-gradient-to-l from-[#0284C7]/90 via-[#0369A1]/85 to-[#0B2249]/95`}
        >
          <div>
            <div className="font-mono-num text-2xl font-extrabold leading-none">{counts.all}</div>
            <div className="mt-1 text-xs font-bold text-cyan-100">إجمالي الدروس المتاحة</div>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-cyan-100 ring-1 ring-white/25">
            <PlayCircle className="h-5 w-5" />
          </span>
        </button>
      </div>

      {/* 3. Unified Search & Filter Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-2.5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="ابحث في الفيديوهات والدروس"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث في الفيديوهات والدروس..."
            className="w-full rounded-xl border border-white/15 bg-[#081330] py-2 pr-9 pl-3 text-xs text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <select
          aria-label="تصفية حسب الوحدة"
          value={unitFilter}
          onChange={(e) => {
            setUnitFilter(Number(e.target.value));
            setLessonFilter(0);
          }}
          className="rounded-xl border border-white/15 bg-[#081330] px-2.5 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value={0}>كل الوحدات الدراسية</option>
          {data.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.titleAr}
            </option>
          ))}
        </select>

        <select
          aria-label="تصفية حسب الدرس"
          value={lessonFilter}
          onChange={(e) => setLessonFilter(Number(e.target.value))}
          className="rounded-xl border border-white/15 bg-[#081330] px-2.5 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value={0}>كل الدروس</option>
          {lessonsForSelectedUnit.map((l) => (
            <option key={l.id} value={l.id}>
              {l.titleAr}
            </option>
          ))}
        </select>

        <select
          aria-label="تصفية حسب حالة المشاهدة"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'ALL' | 'COMPLETED' | 'WATCHING' | 'UNSTARTED')
          }
          className="rounded-xl border border-white/15 bg-[#081330] px-2.5 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value="ALL">كل حالات المشاهدة</option>
          <option value="COMPLETED">المكتملة فقط</option>
          <option value="WATCHING">قيد المشاهدة</option>
          <option value="UNSTARTED">لم تبدأ بعد</option>
        </select>
      </div>

      {/* 4. Featured "Continue Your Current Lesson" Card */}
      {resumeVideo && (
        <section className="overflow-hidden rounded-2xl border border-[#4F46E5]/50 bg-gradient-to-l from-[#141F5C]/95 via-[#1C1E66]/95 to-[#0B163C]/95 p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.5)]">
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.9fr] gap-5 items-center">
            {/* Right side (RTL): Info & CTA */}
            <div className="space-y-2.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-500/20 px-3 py-0.5 text-[11px] font-extrabold text-emerald-200">
                  <PlayCircle className="h-3.5 w-3.5" />
                  متابعة درسك الحالي
                </span>
                {resumeVideo.unitTitleAr && (
                  <span className="text-xs font-bold text-sky-300 truncate">
                    {resumeVideo.unitTitleAr}
                  </span>
                )}
              </div>

              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white leading-snug">
                {resumeVideo.titleAr}
              </h2>
              {resumeVideo.descriptionAr && (
                <p className="text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
                  {resumeVideo.descriptionAr}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                {resumeVideo.durationSec > 0 && (
                  <span className="inline-flex items-center gap-1 font-mono-num text-slate-200">
                    <Clock className="h-3.5 w-3.5 text-sky-300" />
                    {formatDurationAr(resumeVideo.durationSec)}
                  </span>
                )}
                {resumeVideo.hasPdfAttachment && (
                  <button
                    type="button"
                    onClick={() =>
                      resumeVideo.hasAccess
                        ? onPlayVideo(resumeVideo)
                        : resumeVideo.videoType === 'COURSE' && resumeVideo.courseId
                          ? onNavigateTarget({ type: 'COURSE', entityId: resumeVideo.courseId })
                          : onStartCheckout({
                              targetType: 'VIDEO',
                              targetId: resumeVideo.id,
                              titleAr: resumeVideo.titleAr,
                              priceEgp: resumeVideo.priceEgp,
                            })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/25 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>ملف PDF مرفق{resumeVideo.pdfTitle ? `: ${resumeVideo.pdfTitle}` : ''}</span>
                  </button>
                )}
              </div>

              {resumeVideo.hasAccess && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-300">نسبة المشاهدة</span>
                    <span className="font-mono-num text-sky-300">
                      {resumeVideo.progress.completionPercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      style={{ width: `${resumeVideo.progress.completionPercent}%` }}
                      className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-blue-500"
                    />
                  </div>
                </div>
              )}

              <div className="pt-1">
                {resumeVideo.hasAccess ? (
                  <button
                    type="button"
                    onClick={() => onPlayVideo(resumeVideo)}
                    className="inline-flex w-full sm:w-auto sm:min-w-[240px] items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-6 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,0.42)] hover:brightness-110"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>
                      {resumeVideo.progress.lastPositionSec > 0
                        ? 'استكمال المشاهدة'
                        : 'مشاهدة الدرس الآن'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      resumeVideo.videoType === 'COURSE' && resumeVideo.courseId
                        ? onNavigateTarget({ type: 'COURSE', entityId: resumeVideo.courseId })
                        : onStartCheckout({
                            targetType: 'VIDEO',
                            targetId: resumeVideo.id,
                            titleAr: resumeVideo.titleAr,
                            priceEgp: resumeVideo.priceEgp,
                          })
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#7C3AED] to-[#2563EB] px-6 py-2.5 text-sm font-extrabold text-white shadow-md hover:brightness-110"
                  >
                    <Lock className="h-4 w-4" />
                    <span>فتح الدرس الآن</span>
                  </button>
                )}
              </div>
            </div>

            {/* Left side (RTL): Featured Video Thumbnail */}
            <div className="relative overflow-hidden rounded-2xl border border-sky-400/35 bg-[#07112B] aspect-[16/9] group">
              <img
                src={resumeVideo.thumbnailUrl || pickPhysicsArtwork(resumeVideo.id)}
                alt={resumeVideo.titleAr}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/85 via-transparent to-transparent" />
              <span
                className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold border backdrop-blur-xs ${
                  resumeVideo.videoType === 'FREE'
                    ? 'border-emerald-300/60 bg-emerald-600/85 text-white'
                    : 'border-violet-300/60 bg-violet-600/85 text-white'
                }`}
              >
                {resumeVideo.videoType === 'FREE'
                  ? 'مجاني'
                  : resumeVideo.videoType === 'COURSE'
                    ? 'ضمن كورس'
                    : 'مدفوع'}
              </span>
              {resumeVideo.hasAccess ? (
                <button
                  type="button"
                  onClick={() => onPlayVideo(resumeVideo)}
                  aria-label="تشغيل الفيديو"
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-[#1D4ED8] shadow-[0_0_28px_rgba(56,189,248,0.65)] transition-transform group-hover:scale-110">
                    <Play className="h-6 w-6 fill-current mr-0.5" />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    resumeVideo.videoType === 'COURSE' && resumeVideo.courseId
                      ? onNavigateTarget({ type: 'COURSE', entityId: resumeVideo.courseId })
                      : onStartCheckout({
                          targetType: 'VIDEO',
                          targetId: resumeVideo.id,
                          titleAr: resumeVideo.titleAr,
                          priceEgp: resumeVideo.priceEgp,
                        })
                  }
                  aria-label={`فتح الدرس المغلق ${resumeVideo.titleAr}`}
                  className="absolute inset-0 flex items-center justify-center bg-[#060E24]/30 hover:bg-[#060E24]/45 transition-colors"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#07112B]/90 text-white border border-white/30 shadow-lg transition-transform group-hover:scale-105">
                    <Lock className="h-6 w-6" />
                  </span>
                </button>
              )}
              {resumeVideo.durationSec > 0 && (
                <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg bg-[#07112B]/85 px-2 py-0.5 font-mono-num text-[11px] font-bold text-white border border-white/15">
                  <Clock className="h-3 w-3 text-sky-300" />
                  {formatDurationAr(resumeVideo.durationSec)}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 5. Collapsible Unit Accordions with High-Contrast White-Bottom Video Cards */}
      {unitGroups.length === 0 ? (
        <StudentEmptyState
          icon={<Video className="h-6 w-6" />}
          title="لا توجد فيديوهات مطابقة للبحث أو التصفية الحالية"
          description="جرّب إزالة بعض الفلاتر أو استعراض جميع الفيديوهات المتاحة لصفك."
          actionLabel="إعادة تعيين الفلاتر"
          onAction={() => {
            setSearch('');
            setUnitFilter(0);
            setLessonFilter(0);
            setStatusFilter('ALL');
            setCategoryFilter('ALL');
          }}
        />
      ) : (
        <div className="space-y-3.5">
          {unitGroups.map((group) => {
            const isCollapsed = Boolean(collapsedUnits[group.id]);
            const unitPct =
              group.videos.length > 0
                ? Math.round(
                    group.videos.reduce(
                      (sum, v) =>
                        sum +
                        (v.progress.isCompleted
                          ? 100
                          : Math.min(100, Math.max(0, v.progress.completionPercent || 0))),
                      0,
                    ) / group.videos.length,
                  )
                : 0;

            return (
              <section
                key={group.id}
                className="overflow-hidden rounded-2xl border border-[#2D4A8A]/50 bg-[#0B173B]/92 text-white shadow-[0_8px_24px_rgba(2,8,28,0.42)]"
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleUnitCollapse(group.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-right hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
                      <Layers className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm sm:text-base font-extrabold text-white truncate">
                        {group.titleAr}
                      </h3>
                      {group.descriptionAr && (
                        <p className="text-[11px] text-slate-400 truncate">{group.descriptionAr}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 font-mono-num text-[11px] font-bold text-slate-200">
                      {group.videos.length} دروس
                    </span>
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-300">
                        تقدم الوحدة{' '}
                        <strong className="font-mono-num text-sky-300">{unitPct}%</strong>
                      </span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/12">
                        <div
                          style={{ width: `${unitPct}%` }}
                          className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-blue-500"
                        />
                      </div>
                    </div>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-slate-300">
                      {isCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                </button>

                {/* White-Bottom Video Cards Grid (matching 05_Video_Library.png) */}
                {!isCollapsed && (
                  <div className="border-t border-white/10 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                      {group.videos.map((v) => {
                        const isFree = v.videoType === 'FREE';
                        const isDone = v.hasAccess && v.progress.isCompleted;
                        return (
                          <article
                            key={v.id}
                            data-testid={`student-video-card-${v.id}`}
                            className="flex flex-col justify-between overflow-hidden rounded-2xl border border-white/80 bg-[#F8FAFF] text-[#0B162C] shadow-[0_10px_26px_rgba(2,8,28,0.45)] transition-all hover:-translate-y-0.5"
                          >
                            <div>
                              {/* Dark Thumbnail Top */}
                              <div className="relative aspect-[16/10] bg-[#07112B] overflow-hidden group">
                                <img
                                  src={v.thumbnailUrl || pickPhysicsArtwork(v.id)}
                                  alt={v.titleAr}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                                    !v.hasAccess ? 'opacity-60' : ''
                                  }`}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/85 via-transparent to-[#060E24]/30" />

                                {/* Status Badge Top-Right */}
                                <div className="absolute top-2 right-2 flex items-center gap-1">
                                  {isDone ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
                                      <CheckCircle2 className="h-3 w-3" />
                                      مكتمل
                                    </span>
                                  ) : isFree ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                                      مجاني
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                                      <Crown className="h-2.5 w-2.5 text-amber-300" />
                                      {v.videoType === 'COURSE' ? 'ضمن كورس' : 'مدفوع'}
                                    </span>
                                  )}
                                </div>

                                {/* Center Play / Lock */}
                                {v.hasAccess ? (
                                  <button
                                    type="button"
                                    onClick={() => onPlayVideo(v)}
                                    aria-label={`تشغيل ${v.titleAr}`}
                                    className="absolute inset-0 flex items-center justify-center"
                                  >
                                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-[#1D4ED8] shadow-lg transition-transform group-hover:scale-110">
                                      <Play className="h-5 w-5 fill-current mr-0.5" />
                                    </span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      v.videoType === 'COURSE' && v.courseId
                                        ? onNavigateTarget({
                                            type: 'COURSE',
                                            entityId: v.courseId,
                                          })
                                        : onStartCheckout({
                                            targetType: 'VIDEO',
                                            targetId: v.id,
                                            titleAr: v.titleAr,
                                            priceEgp: v.priceEgp,
                                          })
                                    }
                                    aria-label={`فتح المحاضرة المغلقة ${v.titleAr}`}
                                    className="absolute inset-0 flex items-center justify-center bg-[#060E24]/20 hover:bg-[#060E24]/40 transition-colors"
                                  >
                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#07112B]/85 text-white border border-white/25 transition-transform group-hover:scale-105">
                                      <Lock className="h-4 w-4" />
                                    </span>
                                  </button>
                                )}

                                {/* Duration Overlay Bottom-Left */}
                                {v.durationSec > 0 && (
                                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-[#060E24]/85 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-white">
                                    <Clock className="h-2.5 w-2.5 text-sky-300" />
                                    {formatDurationAr(v.durationSec)}
                                  </span>
                                )}
                              </div>

                              {/* Crisp WHITE Lower Body */}
                              <div className="p-3 space-y-2">
                                <div className="text-[10.5px] font-bold text-[#2563EB] truncate">
                                  {v.lessonTitleAr || v.unitTitleAr || 'محاضرة فيزياء'}
                                </div>
                                <h4 className="font-display text-sm font-extrabold text-[#0B162C] leading-snug line-clamp-2 min-h-[2.4rem]">
                                  {v.titleAr}
                                </h4>

                                {v.hasPdfAttachment && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      v.hasAccess
                                        ? onPlayVideo(v)
                                        : v.videoType === 'COURSE' && v.courseId
                                          ? onNavigateTarget({
                                              type: 'COURSE',
                                              entityId: v.courseId,
                                            })
                                          : onStartCheckout({
                                              targetType: 'VIDEO',
                                              targetId: v.id,
                                              titleAr: v.titleAr,
                                              priceEgp: v.priceEgp,
                                            })
                                    }
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                                  >
                                    <FileText className="h-3 w-3 shrink-0" />
                                    <span className="truncate max-w-[155px]">
                                      {v.pdfTitle || 'مذكرة PDF مرفقة'}
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Progress + Action Footer */}
                            <div className="px-3 pb-3 pt-1 space-y-2">
                              {v.hasAccess ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                                      <div
                                        style={{ width: `${v.progress.completionPercent}%` }}
                                        className={`h-full rounded-full ${
                                          isDone
                                            ? 'bg-emerald-500'
                                            : 'bg-gradient-to-l from-[#0EA5E9] to-[#2563EB]'
                                        }`}
                                      />
                                    </div>
                                    <span className="font-mono-num text-[11px] font-extrabold text-[#0B162C]">
                                      {v.progress.completionPercent}%
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onPlayVideo(v)}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
                                  >
                                    <Play className="h-3.5 w-3.5 fill-current" />
                                    <span>
                                      {v.progress.lastPositionSec > 0 ? 'استكمال' : 'مشاهدة الدرس'}
                                    </span>
                                  </button>
                                </>
                              ) : (
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      v.videoType === 'COURSE' && v.courseId
                                        ? onNavigateTarget({
                                            type: 'COURSE',
                                            entityId: v.courseId,
                                          })
                                        : onStartCheckout({
                                            targetType: 'VIDEO',
                                            targetId: v.id,
                                            titleAr: v.titleAr,
                                            priceEgp: v.priceEgp,
                                          })
                                    }
                                    className="flex-1 rounded-xl bg-[#1D4ED8] py-2 text-[11px] font-extrabold text-white hover:bg-[#1E40AF]"
                                  >
                                    {v.videoType === 'COURSE'
                                      ? 'اشترك بالكورس'
                                      : `شراء (${v.priceEgp} ج.م)`}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onOpenBilling}
                                    className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    كود
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </StudentTwoColShell>
  );
};
