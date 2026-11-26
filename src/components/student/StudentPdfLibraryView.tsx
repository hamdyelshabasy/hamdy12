import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  Eye,
  FileText,
  Gem,
  Layers,
  Loader2,
  Lock,
  Play,
  PlayCircle,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../../types/lms.ts';
import { apiRequest, formatDurationAr } from '../../lib/api.ts';
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

interface VideoPdfPreviewData {
  video: StudentVideoItem;
  title: string;
  description: string | null;
  previewUrl: string;
  viewUrl: string;
}

interface StudentPdfLibraryViewProps {
  data: StudentDashboardData;
  initialLessonId?: number | null;
  onConsumeInitialLesson?: () => void;
  onPlayVideo: (video: StudentVideoItem) => void;
  onOpenBilling: () => void;
  onOpenCourses: () => void;
  onNavigateTarget?: (target: StudentDeepLinkTarget) => void;
}

type PdfFilterType = 'ALL' | 'VIDEO_ATTACHED' | 'STANDALONE';

export const StudentPdfLibraryView: React.FC<StudentPdfLibraryViewProps> = ({
  data,
  initialLessonId = null,
  onConsumeInitialLesson,
  onPlayVideo,
  onOpenBilling,
  onOpenCourses,
  onNavigateTarget,
}) => {
  const [filterType, setFilterType] = useState<PdfFilterType>('ALL');
  const [unitFilter, setUnitFilter] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [readingLesson, setReadingLesson] = useState<StudentDashboardData['lessons'][number] | null>(
    null,
  );
  const [videoPdfPreview, setVideoPdfPreview] = useState<VideoPdfPreviewData | null>(null);
  const [loadingPdfVideoId, setLoadingPdfVideoId] = useState<number | null>(null);
  const [videoPdfError, setVideoPdfError] = useState<string | null>(null);

  const handleOpenVideoPdfDirect = async (v: StudentVideoItem) => {
    if (!v.hasAccess) {
      if (v.videoType === 'COURSE' && v.courseId && onNavigateTarget) {
        onNavigateTarget({ type: 'COURSE', entityId: v.courseId });
      } else {
        onOpenBilling();
      }
      return;
    }
    setVideoPdfError(null);
    setLoadingPdfVideoId(v.id);
    try {
      const res = await apiRequest<{
        hasPdf: boolean;
        attachment: {
          title: string;
          description: string | null;
          previewUrl: string;
          viewUrl: string;
        } | null;
      }>(`/api/student/videos/${v.id}/pdf`);
      if (res.hasPdf && res.attachment) {
        setVideoPdfPreview({
          video: v,
          title: res.attachment.title,
          description: res.attachment.description,
          previewUrl: res.attachment.previewUrl,
          viewUrl: res.attachment.viewUrl,
        });
      } else {
        onPlayVideo(v);
      }
    } catch (err) {
      setVideoPdfError((err as Error).message || 'تعذر تحميل ملف PDF المرفق حاليًا.');
    } finally {
      setLoadingPdfVideoId(null);
    }
  };

  const handleUnlockVideoPdf = (v: StudentVideoItem) => {
    if (v.videoType === 'COURSE' && v.courseId && onNavigateTarget) {
      onNavigateTarget({ type: 'COURSE', entityId: v.courseId });
    } else {
      onOpenBilling();
    }
  };

  const allVideoPdfs = useMemo(
    () => data.videos.filter((v) => v.hasPdfAttachment),
    [data.videos],
  );
  const allLessonPdfs = useMemo(
    () => data.lessons.filter((l) => Boolean(l.pdfTitleAr || l.pdfUrl)),
    [data.lessons],
  );

  useEffect(() => {
    if (!initialLessonId) return;
    const match = allLessonPdfs.find((l) => l.id === initialLessonId);
    if (match) {
      setFilterType('ALL');
      setUnitFilter(0);
      setSearch('');
      setReadingLesson(match);
    }
    onConsumeInitialLesson?.();
  }, [initialLessonId, allLessonPdfs, onConsumeInitialLesson]);

  const stats = useMemo(() => {
    const total = allVideoPdfs.length + allLessonPdfs.length;
    const accessibleVideoPdfs = allVideoPdfs.filter((v) => v.hasAccess).length;
    const lockedVideoPdfs = allVideoPdfs.length - accessibleVideoPdfs;
    const accessibleTotal = accessibleVideoPdfs + allLessonPdfs.length;
    const accessPct = total > 0 ? Math.round((accessibleTotal / total) * 100) : 0;
    return {
      total,
      accessibleTotal,
      lockedVideoPdfs,
      videoCount: allVideoPdfs.length,
      lessonCount: allLessonPdfs.length,
      accessPct,
    };
  }, [allVideoPdfs, allLessonPdfs]);

  const filteredVideoPdfs = useMemo(() => {
    if (filterType === 'STANDALONE') return [];
    const q = search.trim().toLowerCase();
    return allVideoPdfs.filter((v) => {
      if (unitFilter && v.unitId !== unitFilter) return false;
      if (
        q &&
        !(v.pdfTitle || '').toLowerCase().includes(q) &&
        !v.titleAr.toLowerCase().includes(q) &&
        !(v.unitTitleAr || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allVideoPdfs, filterType, unitFilter, search]);

  const filteredLessonPdfs = useMemo(() => {
    if (filterType === 'VIDEO_ATTACHED') return [];
    const q = search.trim().toLowerCase();
    return allLessonPdfs.filter((l) => {
      if (unitFilter && l.unitId !== unitFilter) return false;
      if (
        q &&
        !(l.pdfTitleAr || '').toLowerCase().includes(q) &&
        !l.titleAr.toLowerCase().includes(q) &&
        !(l.pdfContentSummary || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allLessonPdfs, filterType, unitFilter, search]);

  const rail = (
    <>
      {/* 1. Library Summary Ring */}
      <StudentRailCard glow="blue">
        <h2 className="font-display text-sm font-extrabold text-white">مكتبة المذكرات</h2>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.accessibleTotal}</strong> مذكرة
                متاحة
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <PlayCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.videoCount}</strong> مرفقة
                بفيديو
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <FileText className="h-3.5 w-3.5 text-violet-300 shrink-0" />
              <span>
                <strong className="font-mono-num text-white">{stats.lessonCount}</strong> مذكرات
                مستقلة
              </span>
            </div>
          </div>
          <StudentProgressRing percent={stats.accessPct} size={84} strokeWidth={8} />
        </div>
        <button
          type="button"
          onClick={() => {
            setFilterType('ALL');
            setUnitFilter(0);
            setSearch('');
          }}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>عرض جميع المذكرات ({stats.total})</span>
        </button>
      </StudentRailCard>

      {/* 2. Conditional Upgrade / Activation Card (when locked PDFs or plans exist) */}
      {(stats.lockedVideoPdfs > 0 || data.plans.length > 0) && (
        <StudentRailCard glow="purple" className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-violet-500/30 text-amber-300 ring-1 ring-amber-300/40 shadow-[0_0_24px_rgba(251,191,36,0.28)]">
            <Crown className="h-6 w-6" />
          </div>
          <h3 className="mt-3 font-display text-base font-extrabold text-white">مذكرات شاملة</h3>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
            {stats.lockedVideoPdfs > 0
              ? `لديك ${stats.lockedVideoPdfs} مذكرة مرتبطة بمحاضرات مدفوعة. فعّل كودك أو اشترك لفتحها فورًا.`
              : 'استكشف باقات الاشتراك والكورسات لفتح جميع المحاضرات ومذكراتها.'}
          </p>
          <button
            type="button"
            onClick={stats.lockedVideoPdfs > 0 ? onOpenBilling : onOpenCourses}
            className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] via-[#3B82F6] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{stats.lockedVideoPdfs > 0 ? 'تفعيل كود أو اشتراك' : 'استعراض الباقات'}</span>
          </button>
        </StudentRailCard>
      )}

      {/* 3. PDF Library Benefits */}
      <StudentRailCard>
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h3 className="font-display text-sm font-extrabold text-white">مزايا مكتبة المذكرات</h3>
          <Gem className="h-4 w-4 text-sky-300" />
        </div>
        <ul className="mt-3 space-y-2.5 text-xs text-slate-200">
          {[
            'مذكرات PDF منظمة حسب وحدات ودروس المنهج',
            'ملفات شرح مرفقة مباشرة بمحاضرات الفيديو',
            'ملخصات قوانين وأفكار مسائل للمراجعة السريعة',
            'عرض آمن يحترم صلاحيات الطباعة والتحميل',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </StudentRailCard>
    </>
  );

  const unitBadgeStyles = [
    'bg-blue-600/90 text-white',
    'bg-violet-600/90 text-white',
    'bg-emerald-600/90 text-white',
    'bg-indigo-600/90 text-white',
  ];

  return (
    <StudentTwoColShell rail={rail} testId="student-pdfs-view">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="مكتبة المذكرات وملخصات القوانين (PDF)"
        subtitle="جميع ملفات PDF المرفقة بمحاضرات الفيديو المتاحة لك بالإضافة إلى مذكرات وملخصات الدروس."
        icon={<FileText className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.pdfs}
        artworkAlt="مكتبة المذكرات وملخصات القوانين"
        chips={[
          { icon: <PlayCircle className="h-3.5 w-3.5" />, label: `${stats.videoCount} مرتبطة بالفيديوهات` },
          { icon: <FileText className="h-3.5 w-3.5" />, label: `${stats.lessonCount} مذكرات دروس` },
          { icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />, label: 'محتوى محمي ومنظم' },
        ]}
      />

      {/* 2. Filter Bar matching 09_PDF_Notes.png */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: `الكل (${stats.total})` },
              { id: 'VIDEO_ATTACHED', label: `مذكرات مرتبطة بالدروس (${stats.videoCount})` },
              { id: 'STANDALONE', label: `مذكرات مستقلة (${stats.lessonCount})` },
            ] as const
          ).map((t) => {
            const active = filterType === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterType(t.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-md'
                    : 'border border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label="ابحث في المذكرات"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في المذكرات..."
              className="w-44 rounded-xl border border-white/15 bg-[#081330] py-1.5 pr-8 pl-2.5 text-xs text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <select
            aria-label="تصفية حسب الوحدة"
            value={unitFilter}
            onChange={(e) => setUnitFilter(Number(e.target.value))}
            className="rounded-xl border border-white/15 bg-[#081330] px-3 py-1.5 text-xs text-white focus:border-sky-400 focus:outline-none"
          >
            <option value={0}>كل الوحدات</option>
            {data.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.titleAr}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty State if zero PDFs */}
      {filteredVideoPdfs.length === 0 && filteredLessonPdfs.length === 0 ? (
        <StudentEmptyState
          icon={<FileText className="h-6 w-6" />}
          title="لا توجد مذكرات PDF متاحة في هذا التصنيف حاليًا"
          description="عندما يرفع الأستاذ ملفات PDF جديدة أو ملخصات دروس لصفك ستظهر هنا فورًا."
          actionLabel={filterType !== 'ALL' || unitFilter !== 0 || search ? 'عرض الكل' : undefined}
          onAction={
            filterType !== 'ALL' || unitFilter !== 0 || search
              ? () => {
                  setFilterType('ALL');
                  setUnitFilter(0);
                  setSearch('');
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {/* 3. Attached-to-Video PDFs (Featured Dark Split Cards matching 09_PDF_Notes.png) */}
          {filteredVideoPdfs.length > 0 && (
            <section className="rounded-2xl border border-[#2D4A8A]/50 bg-[#0B173B]/92 p-4 sm:p-5 text-white space-y-3.5">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-extrabold text-white">
                  <PlayCircle className="h-5 w-5 text-violet-300" />
                  <span>مذكرات مرفقة بالدروس</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-300">
                  ملفات PDF مصاحبة لمحاضرات الفيديو لمراجعة الدرس وتثبيت أهم النقاط
                </p>
              </div>

              <div className="space-y-3.5">
                {filteredVideoPdfs.map((v) => (
                  <article
                    key={v.id}
                    className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.85fr] gap-4 items-center rounded-2xl border border-[#3B5CA8]/50 bg-gradient-to-l from-[#12225B]/95 via-[#171E61]/95 to-[#0B163C]/95 p-4 shadow-lg"
                  >
                    {/* Right side (RTL): Glowing PDF Badge + Details + Actions */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="hidden sm:flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-xl border border-violet-400/50 bg-gradient-to-b from-violet-500/30 to-indigo-600/30 shadow-[0_0_24px_rgba(139,92,246,0.3)]">
                        <FileText className="h-7 w-7 text-sky-200" />
                        <span className="mt-1 rounded bg-rose-600 px-1.5 py-0.5 font-mono-num text-[9.5px] font-extrabold text-white">
                          PDF
                        </span>
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 py-0.5 text-[10.5px] font-bold text-sky-200">
                            <Layers className="h-3 w-3" />
                            {v.unitTitleAr || 'محاضرة فيديو'}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-300">
                            مرفق مع الفيديو
                          </span>
                        </div>

                        <h3 className="font-display text-base sm:text-lg font-extrabold text-white leading-snug">
                          {v.pdfTitle || `مذكرة: ${v.titleAr}`}
                        </h3>
                        <p className="text-xs text-slate-300 line-clamp-2">
                          المحاضرة المرتبطة: {v.titleAr}
                          {v.lessonTitleAr ? ` · ${v.lessonTitleAr}` : ''}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {v.hasAccess ? (
                            <>
                              <button
                                type="button"
                                disabled={loadingPdfVideoId === v.id}
                                onClick={() => void handleOpenVideoPdfDirect(v)}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-md hover:brightness-110 disabled:opacity-60"
                              >
                                {loadingPdfVideoId === v.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5" />
                                )}
                                <span>عرض ملف PDF الآن</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onPlayVideo(v)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/8 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/15"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                <span>تشغيل المحاضرة</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-200">
                                <Lock className="h-3.5 w-3.5" />
                                <span>يتطلب فتح المحاضرة أولًا</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleUnlockVideoPdf(v)}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] to-[#2563EB] px-4 py-2 text-xs font-extrabold text-white hover:brightness-110"
                              >
                                <span>
                                  {v.videoType === 'COURSE' && v.courseId
                                    ? 'عرض الكورس وفتحه'
                                    : 'اشتراك / كود تفعيل'}
                                </span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Left side (RTL): Associated Video Thumbnail */}
                    <div className="relative overflow-hidden rounded-xl border border-sky-400/30 bg-[#07112B] aspect-[16/9] group">
                      <img
                        src={v.thumbnailUrl || pickPhysicsArtwork(v.id)}
                        alt={v.titleAr}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className={`h-full w-full object-cover ${!v.hasAccess ? 'opacity-60' : ''}`}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/80 via-transparent to-transparent" />
                      {v.hasAccess ? (
                        <button
                          type="button"
                          onClick={() => onPlayVideo(v)}
                          aria-label={`تشغيل ${v.titleAr}`}
                          className="absolute inset-0 flex items-center justify-center"
                        >
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#1D4ED8] shadow-lg transition-transform group-hover:scale-110">
                            <Play className="h-5 w-5 fill-current mr-0.5" />
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUnlockVideoPdf(v)}
                          aria-label={`فتح المحاضرة المغلقة ${v.titleAr}`}
                          className="absolute inset-0 flex items-center justify-center bg-[#060E24]/25 hover:bg-[#060E24]/45 transition-colors"
                        >
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#07112B]/85 text-white border border-white/25 transition-transform group-hover:scale-105">
                            <Lock className="h-5 w-5" />
                          </span>
                        </button>
                      )}
                      {v.durationSec > 0 && (
                        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-[#060E24]/85 px-2 py-0.5 font-mono-num text-[10.5px] font-bold text-white">
                          <Clock className="h-3 w-3 text-sky-300" />
                          {formatDurationAr(v.durationSec)}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* 4. Standalone Lesson PDFs (Crisp WHITE Cards Grid matching 09_PDF_Notes.png) */}
          {filteredLessonPdfs.length > 0 && (
            <section className="rounded-2xl border border-[#2D4A8A]/50 bg-[#0B173B]/92 p-4 sm:p-5 text-white space-y-3.5">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-extrabold text-white">
                  <Sparkles className="h-5 w-5 text-sky-300" />
                  <span>مذكرات دروس مستقلة</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-300">
                  مذكرات وملخصات شاملة لأهم دروس المنهج جاهزة للمراجعة الفورية
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {filteredLessonPdfs.map((l, idx) => (
                  <StudentWhiteCard
                    key={l.id}
                    className="flex flex-col justify-between overflow-hidden hover:-translate-y-0.5 transition-all"
                  >
                    <div>
                      <div className="relative h-28 bg-[#07112B] overflow-hidden">
                        <img
                          src={pickPhysicsArtwork(l.id + idx)}
                          alt={l.pdfTitleAr || l.titleAr}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#060E24]/85 via-transparent to-[#060E24]/25" />

                        {/* Unit Pill Top-Right */}
                        <span
                          className={`absolute top-2 right-2 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold shadow-sm truncate max-w-[140px] ${
                            unitBadgeStyles[idx % unitBadgeStyles.length]
                          }`}
                        >
                          {l.unitTitleAr}
                        </span>

                        {/* Red PDF Icon Bottom-Left */}
                        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-0.5 font-mono-num text-[10px] font-extrabold text-white shadow-md">
                          <FileText className="h-3 w-3" />
                          PDF
                        </span>
                      </div>

                      <div className="p-3.5 space-y-2">
                        <h3 className="font-display text-sm font-extrabold text-[#0B162C] leading-snug line-clamp-2 min-h-[2.3rem]">
                          {l.pdfTitleAr || l.titleAr}
                        </h3>
                        {l.pdfContentSummary && (
                          <p className="text-[11.5px] text-slate-600 leading-relaxed line-clamp-2">
                            {l.pdfContentSummary}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 border-t border-slate-200/80 pt-2 text-[10.5px] font-bold text-slate-500">
                          <ShieldCheck className="h-3.5 w-3.5 text-[#2563EB] shrink-0" />
                          <span className="truncate">
                            {l.allowPdfDownload
                              ? 'مسموح بالاطلاع والطباعة PDF'
                              : 'للاطلاع فقط داخل المنصة'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="px-3.5 pb-3.5">
                      {l.pdfUrl ? (
                        <div className="flex items-center gap-2">
                          <a
                            href={l.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>فتح المذكرة</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {l.pdfContentSummary && (
                            <button
                              type="button"
                              onClick={() => setReadingLesson(l)}
                              title="عرض ملخص المذكرة داخل المنصة"
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReadingLesson(l)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1E3A8A] to-[#2563EB] py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>قراءة الملخص النصي</span>
                        </button>
                      )}
                    </div>
                  </StudentWhiteCard>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Standalone Lesson PDF & Summary Reader Modal */}
      {readingLesson && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 text-[#0B162C]"
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-[#2563EB] truncate">
                  {readingLesson.unitTitleAr}
                </div>
                <h3 className="font-display text-base font-extrabold text-[#0B162C] truncate">
                  {readingLesson.pdfTitleAr || readingLesson.titleAr}
                </h3>
              </div>
              <button
                type="button"
                aria-label="إغلاق المذكرة"
                onClick={() => setReadingLesson(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs font-semibold text-[#1E3A8A]">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[#2563EB]" />
                <span>
                  {readingLesson.allowPdfDownload
                    ? 'هذه المذكرة متاحة للاطلاع والطباعة بصيغة PDF.'
                    : 'هذه المذكرة مخصصة للاطلاع داخل المنصة فقط.'}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 text-sm leading-relaxed text-[#0B162C] whitespace-pre-line">
                {readingLesson.pdfContentSummary ||
                  'تحتوي هذه المذكرة على الشرح والملخص المرفق بالدرس.'}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              {readingLesson.pdfUrl && (
                <a
                  href={readingLesson.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>فتح ملف PDF الكامل</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setReadingLesson(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video-Attached Authorized PDF Preview Modal */}
      {videoPdfError && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-xl border border-rose-400/40 bg-rose-950/95 px-4 py-3 text-xs font-bold text-rose-100 shadow-2xl"
        >
          <span>{videoPdfError}</span>
          <button
            type="button"
            onClick={() => setVideoPdfError(null)}
            aria-label="إغلاق التنبيه"
            className="rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {videoPdfPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة ملف PDF المرفق بالدرس"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-5 text-[#0B162C]"
        >
          <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-[#2563EB] truncate">
                  {videoPdfPreview.video.unitTitleAr || videoPdfPreview.video.titleAr}
                </div>
                <h3 className="font-display text-base font-extrabold text-[#0B162C] truncate">
                  {videoPdfPreview.title}
                </h3>
              </div>
              <button
                type="button"
                aria-label="إغلاق معاينة PDF"
                onClick={() => setVideoPdfPreview(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {videoPdfPreview.description && (
              <div className="border-b border-slate-100 bg-[#F7F9FC] px-5 py-2 text-xs text-slate-600">
                {videoPdfPreview.description}
              </div>
            )}

            <div className="flex-1 bg-slate-100">
              <iframe
                title={`ملف PDF: ${videoPdfPreview.title}`}
                src={videoPdfPreview.previewUrl}
                className="h-full w-full border-0 bg-white"
                referrerPolicy="no-referrer"
                allow="autoplay"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  const vid = videoPdfPreview.video;
                  setVideoPdfPreview(null);
                  onPlayVideo(vid);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:brightness-110"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>تشغيل المحاضرة المرتبطة</span>
              </button>

              <div className="flex items-center gap-2">
                <a
                  href={videoPdfPreview.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>فتح في Google Drive</span>
                </a>
                <button
                  type="button"
                  onClick={() => setVideoPdfPreview(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </StudentTwoColShell>
  );
};
