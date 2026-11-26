import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Atom,
  BookOpen,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  KeyRound,
  Layers,
  Plus,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { parseLocalizedInt, sanitizeNumericInputValue } from '../../lib/numerals.ts';
import type { AuthUser } from '../../types/lms.ts';
import { AdminCourseDetailModal, type CourseModalTab } from './AdminCourseDetailModal.tsx';
import { AdminCouponsManager } from './AdminCouponsManager.tsx';
import {
  AdminActionMenu,
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMasterDetail,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
  type AdminTone,
} from './AdminUiPrimitives.tsx';

export interface AdminVideoRecord {
  id: number;
  trackId: number | null;
  lessonId: number;
  unitId: number | null;
  gradeId: number;
  courseId: number | null;
  titleAr: string;
  descriptionAr: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  thumbnailUrl: string | null;
  durationSec: number;
  videoType: string;
  priceEgp: number;
  publicationStatus: string;
  isPublished: boolean;
  viewsCount: number;
  uniqueViewersCount?: number;
  activeCodesCount?: number;
  sortOrder: number;
  pdfDriveUrl?: string | null;
  pdfDriveFileId?: string | null;
  pdfTitle?: string | null;
  pdfDescription?: string | null;
  pdfAttachedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminCatalogData {
  tracks: Array<{
    id: number;
    nameAr: string;
    subtitleAr: string;
    isVisible: boolean;
    sortOrder: number;
  }>;
  grades: Array<{
    id: number;
    trackId: number;
    nameAr: string;
    descriptionAr: string;
    isVisible: boolean;
    sortOrder: number;
  }>;
  units: Array<{
    id: number;
    gradeId: number;
    titleAr: string;
    descriptionAr?: string | null;
    sortOrder?: number;
    isVisible?: boolean;
  }>;
  lessons: Array<{
    id: number;
    unitId: number;
    titleAr: string;
    descriptionAr?: string | null;
    sortOrder?: number;
    isVisible?: boolean;
    pdfTitleAr: string | null;
    pdfContentSummary?: string | null;
    allowPdfDownload?: boolean;
    allowComments?: boolean;
  }>;
  videos: AdminVideoRecord[];
  courses: Array<{
    id: number;
    gradeId: number;
    titleAr: string;
    descriptionAr?: string | null;
    thumbnailUrl?: string | null;
    originalPriceEgp: number;
    discountPriceEgp: number;
    validityDays: number;
    publicationStatus?: string;
    isPublished?: boolean;
    defaultVideoMaxOpens?: number | null;
    sortOrder?: number;
    lessonIds: number[];
  }>;
  coupons: Array<{
    id: number;
    code: string;
    discountType?: string;
    discountPercent: number;
    discountAmountEgp?: number;
    maxUses: number;
    usedCount: number;
    expiresAt?: string | null;
    isActive: boolean;
    isArchived?: boolean;
  }>;
}

interface AdminContentPanelProps {
  section: 'tracks' | 'videos' | 'courses';
  catalog: AdminCatalogData;
  currentUser?: AuthUser;
  onReload: () => Promise<void>;
  onToast: (msg: string) => void;
  initialAction?: 'NONE' | 'CREATE';
  navigationNonce?: number;
}

const COURSE_STATUS_META: Record<string, { label: string; tone: AdminTone }> = {
  PUBLISHED: { label: 'منشور', tone: 'emerald' },
  DRAFT: { label: 'مسودة', tone: 'amber' },
  HIDDEN: { label: 'مخفي', tone: 'slate' },
  ARCHIVED: { label: 'مؤرشف', tone: 'amber' },
  REMOVED: { label: 'مُزال', tone: 'rose' },
};

export const AdminContentPanel: React.FC<AdminContentPanelProps> = ({
  section,
  catalog,
  currentUser,
  onReload,
  onToast,
  initialAction,
  navigationNonce,
}) => {
  // Tracks & Grades state (Ref 03)
  const [selectedTrackId, setSelectedTrackId] = useState<number>(catalog.tracks[0]?.id || 0);
  const [trackSearch, setTrackSearch] = useState('');
  const [trackVisFilter, setTrackVisFilter] = useState<'ALL' | 'VISIBLE' | 'HIDDEN'>('ALL');
  const [addGradeOpen, setAddGradeOpen] = useState(false);
  const [gradeForm, setGradeForm] = useState({
    trackId: catalog.tracks[0]?.id || 0,
    nameAr: '',
    descriptionAr: '',
  });

  // Courses & Coupons state (Ref 05)
  const [coursesTab, setCoursesTab] = useState<'courses' | 'coupons' | 'archive'>('courses');
  const [courseSearch, setCourseSearch] = useState('');
  const [courseTrackFilter, setCourseTrackFilter] = useState(0);
  const [courseGradeFilter, setCourseGradeFilter] = useState(0);
  const [courseStatusFilter, setCourseStatusFilter] = useState('ALL');
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [courseForm, setCourseForm] = useState({
    gradeId: catalog.grades[0]?.id || 0,
    titleAr: '',
    descriptionAr: '',
    originalPriceEgp: '500',
    discountPriceEgp: '380',
    validityDays: '120',
    lessonIds: [] as number[],
  });
  const [courseModal, setCourseModal] = useState<{ courseId: number; tab: CourseModalTab } | null>(
    null,
  );

  useEffect(() => {
    if (section === 'courses' && initialAction === 'CREATE') {
      setCreateCourseOpen(true);
    }
  }, [section, initialAction, navigationNonce]);

  useEffect(() => {
    if (selectedTrackId === 0 && catalog.tracks[0]?.id) {
      setSelectedTrackId(catalog.tracks[0].id);
    }
  }, [catalog.tracks, selectedTrackId]);

  const gradeById = useMemo(
    () => new Map(catalog.grades.map((g) => [g.id, g])),
    [catalog.grades],
  );
  const trackById = useMemo(
    () => new Map(catalog.tracks.map((t) => [t.id, t])),
    [catalog.tracks],
  );

  const handleAddGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/grades', {
        method: 'POST',
        body: JSON.stringify(gradeForm),
      });
      setGradeForm({ ...gradeForm, nameAr: '', descriptionAr: '' });
      setAddGradeOpen(false);
      onToast('تمت إضافة الصف الدراسي بنجاح');
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const toggleGradeVisibility = async (id: number, current: boolean) => {
    try {
      await apiRequest(`/api/admin/grades/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible: !current }),
      });
      onToast(!current ? 'تم إظهار الصف في الصفحة الرئيسية' : 'تم إخفاء الصف مؤقتًا');
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const deleteGrade = async (id: number) => {
    try {
      await apiRequest(`/api/admin/grades/${id}`, { method: 'DELETE' });
      onToast('تم حذف الصف');
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const originalPrice = parseLocalizedInt(courseForm.originalPriceEgp) ?? 0;
      const discountPrice = parseLocalizedInt(courseForm.discountPriceEgp) ?? 0;
      const validityDays = parseLocalizedInt(courseForm.validityDays) ?? 120;
      await apiRequest('/api/admin/courses', {
        method: 'POST',
        body: JSON.stringify({
          ...courseForm,
          originalPriceEgp: originalPrice,
          discountPriceEgp: discountPrice,
          validityDays,
        }),
      });
      setCourseForm({ ...courseForm, titleAr: '', descriptionAr: '', lessonIds: [] });
      setCreateCourseOpen(false);
      onToast('تم إنشاء الكورس الكامل بنجاح');
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleQuickCourseVisibility = async (courseId: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED';
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/visibility`,
        {
          method: 'PATCH',
          body: JSON.stringify({ publicationStatus: nextStatus }),
        },
      );
      onToast(res.message);
      await onReload();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  // =========================================================================
  // SCREEN 03: TRACKS & GRADES (Ref 03_Tracks_and_Grades.png)
  // =========================================================================
  if (section === 'tracks') {
    const activeTrack =
      catalog.tracks.find((t) => t.id === selectedTrackId) || catalog.tracks[0] || null;

    const getTrackStats = (trackId: number) => {
      const trackGrades = catalog.grades.filter((g) => g.trackId === trackId);
      const gradeIds = new Set(trackGrades.map((g) => g.id));
      const coursesCount = catalog.courses.filter(
        (c) => gradeIds.has(c.gradeId) && c.publicationStatus !== 'REMOVED',
      ).length;
      const videosCount = catalog.videos.filter(
        (v) => v.trackId === trackId || gradeIds.has(v.gradeId),
      ).length;
      const unitsCount = catalog.units.filter((u) => gradeIds.has(u.gradeId)).length;
      return {
        grades: trackGrades,
        gradesCount: trackGrades.length,
        coursesCount,
        videosCount,
        unitsCount,
      };
    };

    const activeTrackStats = activeTrack ? getTrackStats(activeTrack.id) : null;
    const filteredGrades = (activeTrackStats?.grades || []).filter((g) => {
      if (trackVisFilter === 'VISIBLE' && !g.isVisible) return false;
      if (trackVisFilter === 'HIDDEN' && g.isVisible) return false;
      const q = trackSearch.trim().toLowerCase();
      if (q && !g.nameAr.toLowerCase().includes(q) && !g.descriptionAr.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    const activeCoursesTotal = catalog.courses.filter(
      (c) => c.publicationStatus !== 'REMOVED',
    ).length;

    return (
      <div className="space-y-4">
        <AdminPageHeader
          title="المسارات والصفوف"
          subtitle="إدارة المسارات التعليمية (البكالوريا، التعليم الأزهري) والصفوف الدراسية المرتبطة بها وإظهارها للطلاب."
          icon={<GraduationCap className="h-5 w-5" />}
          actions={
            <button
              type="button"
              onClick={() => {
                setGradeForm({
                  trackId: activeTrack?.id || catalog.tracks[0]?.id || 0,
                  nameAr: '',
                  descriptionAr: '',
                });
                setAddGradeOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة صف دراسي</span>
            </button>
          }
        />

        {/* 4 Real KPI Cards */}
        <AdminKpiGrid cols={4}>
          <AdminKpiCard
            label="إجمالي المسارات"
            value={catalog.tracks.length}
            subtitle="المسارات التعليمية المعتمدة"
            icon={<GraduationCap className="h-5 w-5" />}
            tone="amber"
          />
          <AdminKpiCard
            label="إجمالي الصفوف"
            value={catalog.grades.length}
            subtitle={`ظاهر: ${catalog.grades.filter((g) => g.isVisible).length} · مخفي: ${catalog.grades.filter((g) => !g.isVisible).length}`}
            icon={<Layers className="h-5 w-5" />}
            tone="purple"
          />
          <AdminKpiCard
            label="الكورسات النشطة"
            value={activeCoursesTotal}
            subtitle="موزعة على جميع الصفوف"
            icon={<BookOpen className="h-5 w-5" />}
            tone="emerald"
          />
          <AdminKpiCard
            label="إجمالي الفيديوهات"
            value={catalog.videos.length}
            subtitle={`في ${catalog.units.length} وحدة و ${catalog.lessons.length} درس`}
            icon={<Video className="h-5 w-5" />}
            tone="blue"
          />
        </AdminKpiGrid>

        {/* Filter Bar */}
        <AdminFilterBar
          searchValue={trackSearch}
          onSearchChange={setTrackSearch}
          searchPlaceholder="ابحث عن صف دراسي أو وصف..."
          hasActiveFilters={trackSearch.trim() !== '' || trackVisFilter !== 'ALL'}
          onReset={() => {
            setTrackSearch('');
            setTrackVisFilter('ALL');
          }}
        >
          <select
            aria-label="تصفية حسب حالة الظهور"
            value={trackVisFilter}
            onChange={(e) => setTrackVisFilter(e.target.value as 'ALL' | 'VISIBLE' | 'HIDDEN')}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
          >
            <option value="ALL">كل الحالات</option>
            <option value="VISIBLE">ظاهر للطلاب</option>
            <option value="HIDDEN">مخفي</option>
          </select>
        </AdminFilterBar>

        {/* Prominent 2-Column Track Cards */}
        <div>
          <div className="mb-2.5 flex items-center gap-2 text-xs font-extrabold text-[#0F172A]">
            <GraduationCap className="h-4 w-4 text-[#2563EB]" />
            <span>المسارات التعليمية ({catalog.tracks.length})</span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {catalog.tracks.map((track, idx) => {
              const stats = getTrackStats(track.id);
              const isSelected = activeTrack?.id === track.id;
              return (
                <div
                  key={track.id}
                  onClick={() => setSelectedTrackId(track.id)}
                  className={`cursor-pointer rounded-2xl border bg-white p-5 transition-all ${
                    isSelected
                      ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20 shadow-[0_8px_22px_rgba(37,99,235,0.08)]'
                      : 'border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                          idx % 2 === 0
                            ? 'bg-blue-50 text-[#2563EB]'
                            : 'bg-amber-50 text-amber-600'
                        }`}
                      >
                        <GraduationCap className="h-6 w-6" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-base font-extrabold text-[#0F172A]">
                            {track.nameAr}
                          </h3>
                          <AdminStatusBadge tone={track.isVisible ? 'emerald' : 'slate'} dot>
                            {track.isVisible ? 'نشط' : 'مخفي'}
                          </AdminStatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{track.subtitleAr}</p>
                      </div>
                    </div>
                  </div>

                  {/* Real Stats Strip */}
                  <div className="mt-4 grid grid-cols-3 gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                    <div>
                      <div className="font-mono-num text-base font-extrabold text-[#0F172A] tabular-nums">
                        {stats.gradesCount}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-500">صفوف دراسية</div>
                    </div>
                    <div className="border-x border-slate-200/70">
                      <div className="font-mono-num text-base font-extrabold text-[#2563EB] tabular-nums">
                        {stats.coursesCount}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-500">كورسات</div>
                    </div>
                    <div>
                      <div className="font-mono-num text-base font-extrabold text-emerald-700 tabular-nums">
                        {stats.videosCount}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-500">فيديوهات</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackId(track.id);
                      }}
                      className={`rounded-xl px-4 py-2 text-xs font-extrabold transition-colors ${
                        isSelected
                          ? 'bg-[#2563EB] text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB]'
                      }`}
                    >
                      {isSelected ? 'المسار المحدد حاليًا' : 'عرض صفوف المسار'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackId(track.id);
                        setGradeForm({ trackId: track.id, nameAr: '', descriptionAr: '' });
                        setAddGradeOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-[#2563EB] hover:bg-blue-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة صف لهذا المسار</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Track Detail Panel: Grades Table (8 cols) + Track Summary Card (4 cols) */}
        {activeTrack && activeTrackStats && (
          <AdminMasterDetail
            mainSpan="8"
            main={
              <AdminCard padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A]">
                      تفاصيل مسار: {activeTrack.nameAr}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      إدارة الصفوف الدراسية وإظهارها أو إخفائها دون التأثير على السجلات المرتبطة.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGradeForm({ trackId: activeTrack.id, nameAr: '', descriptionAr: '' });
                      setAddGradeOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة صف</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                      <tr>
                        <th className="px-4 py-3">الصف الدراسي</th>
                        <th className="px-4 py-3">الوصف</th>
                        <th className="px-4 py-3">الكورسات</th>
                        <th className="px-4 py-3">الفيديوهات</th>
                        <th className="px-4 py-3">الحالة</th>
                        <th className="px-4 py-3 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredGrades.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6">
                            <AdminEmptyState
                              icon={<Layers className="h-5 w-5" />}
                              title="لا توجد صفوف مطابقة"
                              description="أضف صفًا دراسيًا جديدًا أو عدّل معايير التصفية."
                            />
                          </td>
                        </tr>
                      ) : (
                        filteredGrades.map((g) => {
                          const gCourses = catalog.courses.filter(
                            (c) => c.gradeId === g.id && c.publicationStatus !== 'REMOVED',
                          ).length;
                          const gVideos = catalog.videos.filter((v) => v.gradeId === g.id).length;
                          return (
                            <tr key={g.id} className="hover:bg-slate-50/80">
                              <td className="px-4 py-3 font-extrabold text-[#0F172A]">
                                {g.nameAr}
                              </td>
                              <td className="px-4 py-3 text-slate-500">
                                {g.descriptionAr || '—'}
                              </td>
                              <td className="px-4 py-3 font-mono-num font-bold text-slate-700">
                                {gCourses}
                              </td>
                              <td className="px-4 py-3 font-mono-num font-bold text-slate-700">
                                {gVideos}
                              </td>
                              <td className="px-4 py-3">
                                <AdminStatusBadge tone={g.isVisible ? 'emerald' : 'amber'} dot>
                                  {g.isVisible ? 'ظاهر' : 'مخفي'}
                                </AdminStatusBadge>
                              </td>
                              <td className="px-4 py-3 text-left">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void toggleGradeVisibility(g.id, g.isVisible)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    {g.isVisible ? (
                                      <>
                                        <EyeOff className="h-3.5 w-3.5 text-amber-600" />
                                        <span>إخفاء</span>
                                      </>
                                    ) : (
                                      <>
                                        <Eye className="h-3.5 w-3.5 text-emerald-600" />
                                        <span>إظهار</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`حذف ${g.nameAr}`}
                                    onClick={() => void deleteGrade(g.id)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50/60 text-rose-600 hover:bg-rose-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </AdminCard>
            }
            detail={
              <AdminCard padding="md" className="space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-[#0F172A]">ملخص المسار</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{activeTrack.nameAr}</p>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{activeTrack.subtitleAr}</p>
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">عدد الصفوف الدراسية</span>
                    <span className="font-mono-num font-extrabold text-[#0F172A]">
                      {activeTrackStats.gradesCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">عدد الكورسات النشطة</span>
                    <span className="font-mono-num font-extrabold text-[#2563EB]">
                      {activeTrackStats.coursesCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">عدد الوحدات الدراسية</span>
                    <span className="font-mono-num font-extrabold text-[#0F172A]">
                      {activeTrackStats.unitsCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">إجمالي الفيديوهات</span>
                    <span className="font-mono-num font-extrabold text-emerald-700">
                      {activeTrackStats.videosCount}
                    </span>
                  </div>
                </div>
              </AdminCard>
            }
          />
        )}

        {/* Add Grade Modal */}
        {addGradeOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="إضافة صف دراسي جديد"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-[#0F172A]">إضافة صف دراسي جديد</h3>
                <button
                  type="button"
                  onClick={() => setAddGradeOpen(false)}
                  aria-label="إغلاق"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleAddGrade} className="mt-4 space-y-3 text-xs">
                <label className="block space-y-1 font-bold text-slate-700">
                  <span>المسار التعليمي</span>
                  <select
                    value={gradeForm.trackId}
                    onChange={(e) =>
                      setGradeForm({ ...gradeForm, trackId: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"
                  >
                    {catalog.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 font-bold text-slate-700">
                  <span>اسم الصف الدراسي</span>
                  <input
                    type="text"
                    required
                    placeholder="مثال: الصف الثالث الثانوي"
                    value={gradeForm.nameAr}
                    onChange={(e) => setGradeForm({ ...gradeForm, nameAr: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal"
                  />
                </label>
                <label className="block space-y-1 font-bold text-slate-700">
                  <span>وصف مختصر للمنهج</span>
                  <input
                    type="text"
                    placeholder="مثال: الفيزياء — المنهج الكامل والمراجعة"
                    value={gradeForm.descriptionAr}
                    onChange={(e) =>
                      setGradeForm({ ...gradeForm, descriptionAr: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal"
                  />
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAddGradeOpen(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8]"
                  >
                    حفظ الصف الدراسي
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // SCREEN 05: COURSES & COUPONS (Ref 05_Courses_and_Coupons.png)
  // =========================================================================
  const activeCourses = catalog.courses.filter(
    (c) => c.publicationStatus !== 'REMOVED' && c.publicationStatus !== 'ARCHIVED',
  );
  const archivedCourses = catalog.courses.filter(
    (c) => c.publicationStatus === 'REMOVED' || c.publicationStatus === 'ARCHIVED',
  );
  const publishedCoursesCount = activeCourses.filter(
    (c) => (c.publicationStatus || (c.isPublished === false ? 'HIDDEN' : 'PUBLISHED')) === 'PUBLISHED',
  ).length;
  const draftOrHiddenCount = activeCourses.length - publishedCoursesCount;
  const activeCouponsCount = catalog.coupons.filter((cp) => cp.isActive && !cp.isArchived).length;

  const filterGradeOptions = courseTrackFilter
    ? catalog.grades.filter((g) => g.trackId === courseTrackFilter)
    : catalog.grades;

  const displayedCourses = (coursesTab === 'archive' ? archivedCourses : activeCourses).filter(
    (c) => {
      const grade = gradeById.get(c.gradeId);
      const status = c.publicationStatus || (c.isPublished === false ? 'HIDDEN' : 'PUBLISHED');
      if (courseTrackFilter && grade?.trackId !== courseTrackFilter) return false;
      if (courseGradeFilter && c.gradeId !== courseGradeFilter) return false;
      if (courseStatusFilter !== 'ALL' && status !== courseStatusFilter) return false;
      const q = courseSearch.trim().toLowerCase();
      if (
        q &&
        !c.titleAr.toLowerCase().includes(q) &&
        !(c.descriptionAr || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    },
  );

  const hasCourseFilters =
    courseSearch.trim() !== '' ||
    courseTrackFilter > 0 ||
    courseGradeFilter > 0 ||
    courseStatusFilter !== 'ALL';

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="الكورسات والكوبونات"
        subtitle="إدارة الكورسات ومحتواها والمشتركين وحدود المشاهدة وكوبونات الخصم من مكان واحد."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <button
            type="button"
            onClick={() => setCreateCourseOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            <span>إنشاء كورس جديد</span>
          </button>
        }
      />

      {/* 4 Real KPI Cards (Ref 05) */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الكورسات"
          value={activeCourses.length}
          subtitle="الكورسات الفعالة على المنصة"
          icon={<BookOpen className="h-5 w-5" />}
          tone="blue"
          onClick={() => setCoursesTab('courses')}
        />
        <AdminKpiCard
          label="الكورسات المنشورة"
          value={publishedCoursesCount}
          subtitle="متاحة للطلاب حسب الصلاحيات"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
          onClick={() => {
            setCoursesTab('courses');
            setCourseStatusFilter('PUBLISHED');
          }}
        />
        <AdminKpiCard
          label="المسودات والمخفية"
          value={draftOrHiddenCount}
          subtitle="غير منشورة حاليًا للطلاب"
          icon={<FileText className="h-5 w-5" />}
          tone="amber"
          onClick={() => {
            setCoursesTab('courses');
            setCourseStatusFilter('HIDDEN');
          }}
        />
        <AdminKpiCard
          label="الكوبونات النشطة"
          value={activeCouponsCount}
          subtitle={`من إجمالي ${catalog.coupons.length} كوبون`}
          icon={<KeyRound className="h-5 w-5" />}
          tone="purple"
          onClick={() => setCoursesTab('coupons')}
        />
      </AdminKpiGrid>

      {/* Segmented Tabs (Ref 05) */}
      <AdminSegmentedTabs<'courses' | 'coupons' | 'archive'>
        activeId={coursesTab}
        onChange={setCoursesTab}
        items={[
          { id: 'courses', label: 'الكورسات', count: activeCourses.length },
          { id: 'coupons', label: 'كوبونات الخصم', count: catalog.coupons.length },
          { id: 'archive', label: 'الأرشيف', count: archivedCourses.length },
        ]}
      />

      {coursesTab === 'coupons' ? (
        <AdminCouponsManager
          courses={catalog.courses
            .filter((c) => c.publicationStatus !== 'REMOVED')
            .map((c) => ({ id: c.id, titleAr: c.titleAr }))}
          onChanged={onReload}
          onToast={onToast}
        />
      ) : (
        <>
          {/* Filter Bar (Ref 05) */}
          <AdminFilterBar
            searchValue={courseSearch}
            onSearchChange={setCourseSearch}
            searchPlaceholder="ابحث باسم الكورس أو وصفه..."
            hasActiveFilters={hasCourseFilters}
            onReset={() => {
              setCourseSearch('');
              setCourseTrackFilter(0);
              setCourseGradeFilter(0);
              setCourseStatusFilter('ALL');
            }}
          >
            <select
              aria-label="تصفية الكورسات حسب المسار"
              value={courseTrackFilter}
              onChange={(e) => {
                setCourseTrackFilter(Number(e.target.value));
                setCourseGradeFilter(0);
              }}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
            >
              <option value={0}>كل المسارات</option>
              {catalog.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </select>
            <select
              aria-label="تصفية الكورسات حسب الصف"
              value={courseGradeFilter}
              onChange={(e) => setCourseGradeFilter(Number(e.target.value))}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
            >
              <option value={0}>كل الصفوف</option>
              {filterGradeOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>
            <select
              aria-label="تصفية الكورسات حسب الحالة"
              value={courseStatusFilter}
              onChange={(e) => setCourseStatusFilter(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
            >
              <option value="ALL">كل الحالات</option>
              <option value="PUBLISHED">منشور</option>
              <option value="DRAFT">مسودة</option>
              <option value="HIDDEN">مخفي</option>
            </select>
          </AdminFilterBar>

          {/* 3-Column Premium Course Cards Grid (Ref 05) */}
          {displayedCourses.length === 0 ? (
            <AdminEmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title={
                coursesTab === 'archive'
                  ? 'لا توجد كورسات مؤرشفة'
                  : 'لا توجد كورسات مطابقة للتصفية'
              }
              description={
                coursesTab === 'archive'
                  ? 'الكورسات التي يتم أرشفتها أو إزالتها ستظهر هنا بأمان.'
                  : 'يمكنك إنشاء كورس جديد أو مسح الفلاتر لعرض جميع الكورسات.'
              }
              action={
                coursesTab !== 'archive' && (
                  <button
                    type="button"
                    onClick={() => setCreateCourseOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>إنشاء كورس جديد</span>
                  </button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {displayedCourses.map((c) => {
                const pubStatus =
                  c.publicationStatus || (c.isPublished === false ? 'HIDDEN' : 'PUBLISHED');
                const badge = COURSE_STATUS_META[pubStatus] || COURSE_STATUS_META.PUBLISHED;
                const grade = gradeById.get(c.gradeId);
                const track = grade ? trackById.get(grade.trackId) : undefined;
                const courseVideosCount = catalog.videos.filter(
                  (v) => v.courseId === c.id || c.lessonIds.includes(v.lessonId),
                ).length;

                return (
                  <div
                    key={c.id}
                    data-testid={`admin-course-card-${c.id}`}
                    className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:border-blue-200 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
                  >
                    {/* Navy Physics Cover Header (Ref 05) */}
                    <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-[#0B1733] via-[#132954] to-[#0D1E42]">
                      {c.thumbnailUrl ? (
                        <img
                          src={c.thumbnailUrl}
                          alt={c.titleAr}
                          loading="lazy"
                          className="h-full w-full object-cover opacity-85"
                        />
                      ) : (
                        <Atom className="h-14 w-14 text-sky-400/55" />
                      )}
                      <div className="absolute top-3 right-3">
                        <AdminStatusBadge tone={badge.tone}>{badge.label}</AdminStatusBadge>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="flex flex-1 flex-col justify-between p-4">
                      <div>
                        <h4 className="line-clamp-1 font-display text-base font-extrabold text-[#0F172A]">
                          {c.titleAr}
                        </h4>
                        <div className="mt-0.5 text-xs font-medium text-slate-500">
                          {grade?.nameAr || '—'}
                          {track ? ` · ${track.nameAr}` : ''}
                        </div>
                        {c.descriptionAr && (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">
                            {c.descriptionAr}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <AdminStatusBadge tone="slate">
                            <span className="font-mono-num">{c.validityDays}</span> يوم
                          </AdminStatusBadge>
                          <AdminStatusBadge tone="purple">
                            <span className="font-mono-num">{courseVideosCount}</span> فيديو
                          </AdminStatusBadge>
                          {c.defaultVideoMaxOpens ? (
                            <AdminStatusBadge tone="blue">
                              حد المشاهدة: {c.defaultVideoMaxOpens}
                            </AdminStatusBadge>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                        {/* Price & Contextual Menu */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono-num text-xl font-extrabold text-[#2563EB] tabular-nums">
                              {c.discountPriceEgp} ج.م
                            </span>
                            {c.originalPriceEgp > c.discountPriceEgp && (
                              <span className="font-mono-num text-xs text-slate-400 line-through">
                                {c.originalPriceEgp} ج.م
                              </span>
                            )}
                          </div>

                          <AdminActionMenu
                            ariaLabel={`المزيد من الإجراءات لـ ${c.titleAr}`}
                            items={[
                              ...(pubStatus !== 'REMOVED'
                                ? [
                                    {
                                      id: 'toggle-vis',
                                      label:
                                        pubStatus === 'PUBLISHED'
                                          ? 'إخفاء عن الطلاب'
                                          : 'نشر للطلاب',
                                      icon:
                                        pubStatus === 'PUBLISHED' ? (
                                          <EyeOff className="h-3.5 w-3.5" />
                                        ) : (
                                          <Eye className="h-3.5 w-3.5" />
                                        ),
                                      onClick: () =>
                                        void handleQuickCourseVisibility(c.id, pubStatus),
                                    },
                                  ]
                                : []),
                              {
                                id: 'lifecycle',
                                label: 'إخفاء / أرشفة / حذف',
                                icon: <Archive className="h-3.5 w-3.5" />,
                                tone: 'danger',
                                onClick: () => setCourseModal({ courseId: c.id, tab: 'lifecycle' }),
                              },
                            ]}
                          />
                        </div>

                        {/* Primary & Secondary Action Buttons (Ref 05) */}
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setCourseModal({ courseId: c.id, tab: 'content' })}
                            className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#2563EB] px-2 py-2 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
                          >
                            <Video className="h-3.5 w-3.5" />
                            <span>إدارة المحتوى</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCourseModal({ courseId: c.id, tab: 'subscribers' })}
                            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700 hover:border-blue-200 hover:text-[#2563EB]"
                          >
                            <Users className="h-3.5 w-3.5" />
                            <span>المشتركون</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCourseModal({ courseId: c.id, tab: 'basic' })}
                            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700 hover:border-blue-200 hover:text-[#2563EB]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>تعديل</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick Preview Strip of Coupons under Courses tab (matching Ref 05 bottom) */}
          {coursesTab === 'courses' && (
            <AdminCard padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[#7C3AED]" />
                  <h3 className="text-sm font-extrabold text-[#0F172A]">كوبونات الخصم</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCoursesTab('coupons')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB]"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>إدارة الكوبونات</span>
                </button>
              </div>
              {catalog.coupons.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-slate-500">
                  لا توجد كوبونات خصم مضافة بعد. اضغط «إدارة الكوبونات» لإنشاء كوبون جديد.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">الكوبون</th>
                        <th className="px-4 py-2.5">القيمة</th>
                        <th className="px-4 py-2.5">الاستخدام</th>
                        <th className="px-4 py-2.5">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {catalog.coupons.slice(0, 4).map((cp) => (
                        <tr key={cp.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-mono-num font-extrabold text-[#2563EB]" dir="ltr">
                            {cp.code}
                          </td>
                          <td className="px-4 py-2.5 font-mono-num font-bold text-[#0F172A]">
                            {cp.discountType === 'FIXED'
                              ? `${cp.discountAmountEgp || 0} ج.م`
                              : `${cp.discountPercent}%`}
                          </td>
                          <td className="px-4 py-2.5 font-mono-num text-slate-600">
                            {cp.usedCount} / {cp.maxUses}
                          </td>
                          <td className="px-4 py-2.5">
                            <AdminStatusBadge
                              tone={cp.isArchived ? 'slate' : cp.isActive ? 'emerald' : 'amber'}
                            >
                              {cp.isArchived ? 'مؤرشف' : cp.isActive ? 'نشط' : 'متوقف'}
                            </AdminStatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AdminCard>
          )}
        </>
      )}

      {/* Create Course Modal */}
      {createCourseOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="إنشاء كورس جديد"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-[#0F172A]">إنشاء كورس جديد</h3>
              <button
                type="button"
                onClick={() => setCreateCourseOpen(false)}
                aria-label="إغلاق"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleAddCourse} className="mt-4 space-y-3.5 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 font-bold text-slate-700">
                  <span>الصف الدراسي</span>
                  <select
                    aria-label="الصف الدراسي للكورس"
                    value={courseForm.gradeId}
                    onChange={(e) =>
                      setCourseForm({ ...courseForm, gradeId: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    {catalog.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 font-bold text-slate-700">
                  <span>الصلاحية (بالأيام)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={courseForm.validityDays}
                    onChange={(e) =>
                      setCourseForm({
                        ...courseForm,
                        validityDays: sanitizeNumericInputValue(e.target.value, {
                          allowDecimal: false,
                        }),
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                  />
                </label>
              </div>
              <label className="block space-y-1 font-bold text-slate-700">
                <span>اسم الكورس</span>
                <input
                  type="text"
                  required
                  placeholder="مثال: الكورس الشامل في الفيزياء الحديثة"
                  value={courseForm.titleAr}
                  onChange={(e) => setCourseForm({ ...courseForm, titleAr: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 font-bold text-slate-700">
                  <span>السعر الأصلي (ج.م)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={courseForm.originalPriceEgp}
                    onChange={(e) =>
                      setCourseForm({
                        ...courseForm,
                        originalPriceEgp: sanitizeNumericInputValue(e.target.value, {
                          allowDecimal: false,
                        }),
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                  />
                </label>
                <label className="space-y-1 font-bold text-slate-700">
                  <span>السعر بعد الخصم (ج.م)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={courseForm.discountPriceEgp}
                    onChange={(e) =>
                      setCourseForm({
                        ...courseForm,
                        discountPriceEgp: sanitizeNumericInputValue(e.target.value, {
                          allowDecimal: false,
                        }),
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                  />
                </label>
              </div>
              <label className="block space-y-1 font-bold text-slate-700">
                <span>وصف ومحتويات الكورس</span>
                <textarea
                  rows={3}
                  placeholder="شرح تفصيلي لما يغطيه الكورس..."
                  value={courseForm.descriptionAr}
                  onChange={(e) =>
                    setCourseForm({ ...courseForm, descriptionAr: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateCourseOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8]"
                >
                  <Plus className="h-4 w-4" />
                  <span>إنشاء الكورس</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Course Full Management Modal */}
      {courseModal && (
        <AdminCourseDetailModal
          courseId={courseModal.courseId}
          initialTab={courseModal.tab}
          catalog={catalog}
          currentUser={currentUser}
          onClose={() => setCourseModal(null)}
          onChanged={onReload}
          onToast={onToast}
        />
      )}
    </div>
  );
};
