import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BookCheck,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiRequest, formatDateAr } from '../../lib/api.ts';
import { PERMISSIONS, hasPermission } from '../../lib/permissions.ts';
import { pickBestHomeworkForSubmissions } from '../../lib/smartDashboardLinks.ts';
import type { AuthUser } from '../../types/lms.ts';
import type { AdminHomeworkListItem, HomeworkPublicationStatus } from '../../types/homework.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';
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
  type AdminActionMenuItem,
  type AdminTone,
} from './AdminUiPrimitives.tsx';
import { AdminHomeworkFormModal } from './AdminHomeworkFormModal.tsx';
import { AdminHomeworkSubmissionsView } from './AdminHomeworkSubmissionsView.tsx';
import { StudentHomeworkModal } from '../StudentHomeworkModal.tsx';

interface AdminHomeworkManagerProps {
  catalog: AdminCatalogData;
  currentUser?: AuthUser;
  onToast: (msg: string) => void;
  initialStatusFilter?: 'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT';
  initialAction?: 'NONE' | 'CREATE' | 'OPEN_SUBMISSIONS';
  navigationNonce?: number;
}

type HwStatusTab = 'ALL' | 'PENDING_GRADING' | 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';

const STATUS_META: Record<HomeworkPublicationStatus, { label: string; tone: AdminTone }> = {
  PUBLISHED: { label: 'منشور', tone: 'emerald' },
  DRAFT: { label: 'مسودة', tone: 'slate' },
  SCHEDULED: { label: 'مجدول', tone: 'purple' },
  HIDDEN: { label: 'مخفي', tone: 'amber' },
  ARCHIVED: { label: 'مؤرشف', tone: 'slate' },
};

const MODEL_POLICY_SHORT: Record<string, string> = {
  HIDDEN: 'مخفي',
  AFTER_DEADLINE: 'بعد الموعد',
  AFTER_SUBMISSION: 'بعد التسليم',
  AFTER_GRADING: 'بعد التصحيح',
  MANUAL_RELEASE: 'إتاحة يدوية',
  SCHEDULED_RELEASE: 'مجدول',
};

export const AdminHomeworkManager: React.FC<AdminHomeworkManagerProps> = ({
  catalog,
  currentUser,
  onToast,
  initialStatusFilter,
  initialAction,
  navigationNonce,
}) => {
  const canManageHomework = currentUser
    ? hasPermission(currentUser, PERMISSIONS.HOMEWORK_MANAGE)
    : true;
  const [items, setItems] = useState<AdminHomeworkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState(0);
  const [gradeFilter, setGradeFilter] = useState(0);
  const [statusTab, setStatusTab] = useState<HwStatusTab>(
    initialStatusFilter === 'PUBLISHED'
      ? 'PUBLISHED'
      : initialStatusFilter === 'DRAFT'
        ? 'DRAFT'
        : 'ALL',
  );
  const [statusSelect, setStatusSelect] = useState<string>(initialStatusFilter || 'ALL');
  const [page, setPage] = useState(1);
  const [selectedHwId, setSelectedHwId] = useState<number | null>(null);

  const [studentsMeta, setStudentsMeta] = useState<
    Array<{ id: number; fullName: string; phone: string | null; gradeIds: number[] }>
  >([]);
  const [groupsMeta, setGroupsMeta] = useState<Array<{ id: number; gradeId: number; nameAr: string }>>([]);

  // Sub-views & Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submissionsAssignmentId, setSubmissionsAssignmentId] = useState<number | null>(null);
  const [previewAssignmentId, setPreviewAssignmentId] = useState<number | null>(null);
  const handledSubmissionsNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusSelect(initialStatusFilter);
      if (initialStatusFilter === 'PUBLISHED' || initialStatusFilter === 'DRAFT' || initialStatusFilter === 'ALL') {
        setStatusTab(initialStatusFilter);
      }
      setPage(1);
    }
    if (initialAction === 'CREATE' && canManageHomework) {
      setSubmissionsAssignmentId(null);
      setEditingId(null);
      setFormOpen(true);
    }
  }, [initialStatusFilter, initialAction, navigationNonce, canManageHomework]);

  useEffect(() => {
    if (initialAction !== 'OPEN_SUBMISSIONS' || loading) return;
    const nonce = navigationNonce ?? 0;
    if (handledSubmissionsNonceRef.current === nonce) return;
    handledSubmissionsNonceRef.current = nonce;

    setFormOpen(false);
    const bestId = pickBestHomeworkForSubmissions(items);
    if (bestId !== null) {
      setSelectedHwId(bestId);
      setSubmissionsAssignmentId(bestId);
    } else {
      setSubmissionsAssignmentId(null);
      setStatusTab('ALL');
      setStatusSelect('ALL');
    }
  }, [initialAction, navigationNonce, loading, items]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: AdminHomeworkListItem[] }>('/api/admin/homework');
      setItems(res.items || []);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    apiRequest<{
      students: Array<{ id: number; fullName: string; phone: string | null; gradeIds: number[] }>;
      groups: Array<{ id: number; gradeId: number; nameAr: string }>;
    }>('/api/admin/homework/meta')
      .then((res) => {
        setStudentsMeta(res.students || []);
        setGroupsMeta(res.groups || []);
      })
      .catch(() => undefined);
  }, []);

  const hwStats = useMemo(() => {
    let published = 0;
    let pendingSubmissions = 0;
    let gradedSubmissions = 0;
    let draftOrArchived = 0;
    let draftCount = 0;
    let archivedCount = 0;
    let withPendingAssignments = 0;
    for (const hw of items) {
      if (hw.publicationStatus === 'PUBLISHED') published += 1;
      if (hw.publicationStatus === 'DRAFT') {
        draftCount += 1;
        draftOrArchived += 1;
      } else if (hw.publicationStatus === 'ARCHIVED' || hw.publicationStatus === 'HIDDEN') {
        if (hw.publicationStatus === 'ARCHIVED') archivedCount += 1;
        draftOrArchived += 1;
      }
      pendingSubmissions += hw.stats.awaitingReviewCount;
      gradedSubmissions += hw.stats.gradedCount;
      if (hw.stats.awaitingReviewCount > 0) withPendingAssignments += 1;
    }
    return {
      total: items.length,
      published,
      pendingSubmissions,
      gradedSubmissions,
      draftOrArchived,
      draftCount,
      archivedCount,
      withPendingAssignments,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((hw) => {
      if (statusTab === 'PENDING_GRADING' && hw.stats.awaitingReviewCount <= 0) return false;
      if (statusTab === 'PUBLISHED' && hw.publicationStatus !== 'PUBLISHED') return false;
      if (statusTab === 'DRAFT' && hw.publicationStatus !== 'DRAFT') return false;
      if (statusTab === 'ARCHIVED' && hw.publicationStatus !== 'ARCHIVED') return false;
      if (statusSelect !== 'ALL' && hw.publicationStatus !== statusSelect) return false;
      if (trackFilter && hw.trackId !== trackFilter) return false;
      if (gradeFilter && hw.gradeId !== gradeFilter) return false;
      if (q) {
        const hay = `${hw.titleAr} ${hw.gradeNameAr} ${hw.trackNameAr} ${hw.videoTitleAr || ''} ${hw.courseTitleAr || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, statusTab, statusSelect, trackFilter, gradeFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(
    () => filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredItems, safePage],
  );

  const gradingQueueItems = useMemo(
    () =>
      items
        .filter((h) => h.stats.awaitingReviewCount > 0)
        .sort((a, b) => b.stats.awaitingReviewCount - a.stats.awaitingReviewCount),
    [items],
  );

  const selectedHw = useMemo(() => {
    if (selectedHwId != null) {
      return filteredItems.find((h) => h.id === selectedHwId) || items.find((h) => h.id === selectedHwId) || null;
    }
    return gradingQueueItems[0] || filteredItems[0] || items[0] || null;
  }, [selectedHwId, filteredItems, items, gradingQueueItems]);

  if (submissionsAssignmentId !== null) {
    return (
      <AdminHomeworkSubmissionsView
        assignmentId={submissionsAssignmentId}
        catalog={catalog}
        onBack={() => {
          setSubmissionsAssignmentId(null);
          void loadList();
        }}
        onToast={onToast}
      />
    );
  }

  const handleStatusChange = async (id: number, publicationStatus: HomeworkPublicationStatus) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/homework/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ publicationStatus }),
      });
      onToast(res.message);
      await loadList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/homework/${id}/duplicate`, {
        method: 'POST',
      });
      onToast(res.message);
      await loadList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDelete = async (hw: AdminHomeworkListItem) => {
    if (hw.stats.submittedCount > 0) {
      onToast(
        'يحتوي هذا الواجب على تسليمات طلابية؛ استخدم «أرشفة» بدلًا من الحذف للحفاظ على سجل الدرجات.',
      );
      return;
    }
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/homework/${hw.id}`, {
        method: 'DELETE',
      });
      onToast(res.message);
      await loadList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleToggleManualModelAnswer = async (hw: AdminHomeworkListItem) => {
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/homework/${hw.id}/model-answer/release`,
        {
          method: 'PATCH',
          body: JSON.stringify({ manuallyReleased: !hw.modelAnswerManuallyReleased }),
        },
      );
      onToast(res.message);
      await loadList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const hasFilters = Boolean(
    search.trim() || trackFilter || gradeFilter || statusSelect !== 'ALL' || statusTab !== 'ALL',
  );

  const resetFilters = () => {
    setSearch('');
    setTrackFilter(0);
    setGradeFilter(0);
    setStatusSelect('ALL');
    setStatusTab('ALL');
    setPage(1);
  };

  return (
    <div data-testid="admin-homework-manager" className="space-y-5">
      <AdminPageHeader
        title="الواجبات والتصحيح"
        subtitle="تنظيم الواجبات والتسليمات ومراجعة الحلول وإدارة التصحيح ونماذج الإجابة."
        icon={<BookCheck className="h-5 w-5" />}
        actions={
          canManageHomework ? (
            <button
              type="button"
              data-testid="create-homework-btn"
              onClick={() => {
                setEditingId(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>إنشاء واجب جديد</span>
            </button>
          ) : undefined
        }
      />

      {/* 4 Real KPI Cards */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="الواجبات المنشورة"
          value={hwStats.published}
          subtitle="متاحة للطلاب"
          tone="blue"
          icon={<FileText className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('PUBLISHED');
            setStatusSelect('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="بانتظار التصحيح"
          value={hwStats.pendingSubmissions}
          subtitle="تسليمات تحتاج مراجعة"
          tone="amber"
          icon={<Clock className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('PENDING_GRADING');
            setStatusSelect('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="تم التصحيح"
          value={hwStats.gradedSubmissions}
          subtitle="تسليمات مصحّحة"
          tone="emerald"
          icon={<CheckCircle2 className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('ALL');
            setStatusSelect('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="مسودات وأرشيف"
          value={hwStats.draftOrArchived}
          subtitle="غير منشورة"
          tone="purple"
          icon={<BookOpen className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('DRAFT');
            setStatusSelect('ALL');
            setPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Segmented Status Tabs */}
      <AdminSegmentedTabs
        activeId={statusTab}
        onChange={(id) => {
          setStatusTab(id);
          setStatusSelect('ALL');
          setPage(1);
        }}
        items={[
          { id: 'ALL', label: 'كل الواجبات', count: hwStats.total },
          { id: 'PENDING_GRADING', label: 'بانتظار التصحيح', count: hwStats.withPendingAssignments },
          { id: 'PUBLISHED', label: 'منشورة', count: hwStats.published },
          { id: 'DRAFT', label: 'مسودات', count: hwStats.draftCount },
          { id: 'ARCHIVED', label: 'الأرشيف', count: hwStats.archivedCount },
        ]}
      />

      {/* Filter Bar */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="ابحث بعنوان الواجب..."
        hasActiveFilters={hasFilters}
        onReset={resetFilters}
      >
        <select
          aria-label="تصفية حسب المسار"
          value={trackFilter}
          onChange={(e) => {
            setTrackFilter(Number(e.target.value));
            setGradeFilter(0);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value={0}>كل المسارات</option>
          {catalog.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nameAr}
            </option>
          ))}
        </select>

        <select
          aria-label="تصفية حسب الصف"
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(Number(e.target.value));
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value={0}>كل الصفوف</option>
          {catalog.grades
            .filter((g) => !trackFilter || g.trackId === trackFilter)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr}
              </option>
            ))}
        </select>

        <select
          aria-label="تصفية حسب الحالة"
          value={statusSelect}
          onChange={(e) => {
            setStatusSelect(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="ALL">كل الحالات</option>
          <option value="PUBLISHED">منشور</option>
          <option value="DRAFT">مسودة</option>
          <option value="SCHEDULED">مجدول</option>
          <option value="HIDDEN">مخفي</option>
          <option value="ARCHIVED">مؤرشف</option>
        </select>
      </AdminFilterBar>

      {/* Master-Detail: Homework Table (8 cols) + Sticky Grading Queue (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-extrabold text-[#0F172A]">متابعة الواجبات</h3>
              <span className="font-mono-num text-xs font-semibold text-slate-500">
                {filteredItems.length} واجب
              </span>
            </div>

            {loading ? (
              <div className="py-16 text-center text-xs text-slate-500">جارٍ تحميل الواجبات...</div>
            ) : paginatedItems.length === 0 ? (
              <div className="p-6">
                <AdminEmptyState
                  icon={<BookCheck className="h-5 w-5" />}
                  title="لا توجد واجبات مطابقة"
                  description="اضغط «إنشاء واجب جديد» لإضافة أول واجب وربطه بالفيديوهات أو الكورسات."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">الواجب</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">آخر موعد</th>
                      <th className="px-4 py-3">التسليمات</th>
                      <th className="px-4 py-3">التصحيح</th>
                      <th className="px-4 py-3">الدرجة</th>
                      <th className="px-4 py-3 text-left">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedItems.map((hw) => {
                      const st = STATUS_META[hw.publicationStatus] || STATUS_META.DRAFT;
                      const isSelected = selectedHw?.id === hw.id;
                      const menuItems: AdminActionMenuItem[] = [
                        {
                          id: 'submissions',
                          label: `التسليمات والتصحيح (${hw.stats.submittedCount})`,
                          icon: <ClipboardList className="h-3.5 w-3.5" />,
                          onClick: () => setSubmissionsAssignmentId(hw.id),
                        },
                        {
                          id: 'preview',
                          label: 'معاينة كطالب',
                          icon: <Eye className="h-3.5 w-3.5" />,
                          onClick: () => setPreviewAssignmentId(hw.id),
                        },
                      ];
                      if (canManageHomework) {
                        menuItems.push(
                          {
                            id: 'edit',
                            label: 'تعديل الواجب',
                            icon: <Edit3 className="h-3.5 w-3.5" />,
                            onClick: () => {
                              setEditingId(hw.id);
                              setFormOpen(true);
                            },
                          },
                          {
                            id: 'duplicate',
                            label: 'نسخ كمسودة',
                            icon: <Copy className="h-3.5 w-3.5" />,
                            onClick: () => void handleDuplicate(hw.id),
                          },
                        );
                        if (hw.hasModelAnswer && hw.modelAnswerPolicy === 'MANUAL_RELEASE') {
                          menuItems.push({
                            id: 'model-answer',
                            label: hw.modelAnswerManuallyReleased
                              ? 'إيقاف إتاحة نموذج الإجابة'
                              : 'إتاحة نموذج الإجابة الآن',
                            icon: hw.modelAnswerManuallyReleased ? (
                              <Lock className="h-3.5 w-3.5" />
                            ) : (
                              <Unlock className="h-3.5 w-3.5" />
                            ),
                            onClick: () => void handleToggleManualModelAnswer(hw),
                          });
                        }
                        if (hw.publicationStatus !== 'PUBLISHED') {
                          menuItems.push({
                            id: 'publish',
                            label: 'نشر الواجب للطلاب',
                            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                            tone: 'success',
                            onClick: () => void handleStatusChange(hw.id, 'PUBLISHED'),
                          });
                        } else {
                          menuItems.push({
                            id: 'hide',
                            label: 'إخفاء عن الطلاب',
                            icon: <EyeOff className="h-3.5 w-3.5" />,
                            onClick: () => void handleStatusChange(hw.id, 'HIDDEN'),
                          });
                        }
                        if (hw.publicationStatus !== 'ARCHIVED') {
                          menuItems.push({
                            id: 'archive',
                            label: 'أرشفة الواجب',
                            icon: <Archive className="h-3.5 w-3.5" />,
                            onClick: () => void handleStatusChange(hw.id, 'ARCHIVED'),
                          });
                        }
                        if (hw.stats.submittedCount === 0) {
                          menuItems.push({
                            id: 'delete',
                            label: 'حذف الواجب',
                            icon: <Trash2 className="h-3.5 w-3.5" />,
                            tone: 'danger',
                            onClick: () => void handleDelete(hw),
                          });
                        }
                      }

                      return (
                        <tr
                          key={hw.id}
                          data-testid={`admin-homework-card-${hw.id}`}
                          onClick={() => setSelectedHwId(hw.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="px-4 py-3.5 max-w-[230px]">
                            <div className="font-extrabold text-[#0F172A] line-clamp-1">{hw.titleAr}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                              {hw.gradeNameAr} · {hw.trackNameAr}
                              {hw.videoTitleAr ? ` · ${hw.videoTitleAr}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <AdminStatusBadge tone={st.tone}>{st.label}</AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                            {hw.deadline ? formatDateAr(hw.deadline) : '—'}
                          </td>
                          <td className="px-4 py-3.5 font-mono-num font-bold text-[#0F172A] whitespace-nowrap">
                            {hw.stats.submittedCount} / {hw.stats.totalAssigned}
                          </td>
                          <td className="px-4 py-3.5">
                            {hw.stats.awaitingReviewCount > 0 ? (
                              <AdminStatusBadge tone="amber">
                                {hw.stats.awaitingReviewCount} للتصحيح
                              </AdminStatusBadge>
                            ) : hw.stats.gradedCount > 0 ? (
                              <AdminStatusBadge tone="emerald">تم التصحيح</AdminStatusBadge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono-num font-bold text-slate-700 whitespace-nowrap">
                            {hw.maximumGrade} درجة
                          </td>
                          <td className="px-4 py-3.5 text-left">
                            <div
                              className="inline-flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {hw.stats.awaitingReviewCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setSubmissionsAssignmentId(hw.id)}
                                  className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                                >
                                  التسليمات والتصحيح
                                </button>
                              ) : hw.publicationStatus === 'DRAFT' && canManageHomework ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(hw.id);
                                    setFormOpen(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  <span>تعديل</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setSubmissionsAssignmentId(hw.id)}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB]"
                                >
                                  التسليمات
                                </button>
                              )}
                              <AdminActionMenu items={menuItems} ariaLabel={`إجراءات ${hw.titleAr}`} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs">
                <span className="text-slate-500">
                  <strong className="font-mono-num text-[#0F172A]">{filteredItems.length}</strong> واجب مطابق
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>السابق</span>
                  </button>
                  <span className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 font-mono-num font-bold text-white">
                    {safePage}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <span>التالي</span>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </AdminCard>
        }
        detail={
          <AdminCard className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-[#0F172A]">طابور التصحيح</h3>
              <AdminStatusBadge tone={hwStats.pendingSubmissions > 0 ? 'amber' : 'emerald'}>
                {hwStats.pendingSubmissions} تسليم
              </AdminStatusBadge>
            </div>

            {gradingQueueItems.length > 0 ? (
              <div className="space-y-2.5">
                <p className="text-xs text-slate-500">
                  افتح تسليمات أي واجب مباشرة لمراجعة الحلول واعتماد الدرجات.
                </p>
                {gradingQueueItems.slice(0, 6).map((hw) => (
                  <div
                    key={hw.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 transition-colors hover:border-blue-200"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#2563EB]">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-extrabold text-[#0F172A]">
                          {hw.titleAr}
                        </div>
                        <div className="text-[11px] font-semibold text-amber-700">
                          {hw.stats.awaitingReviewCount} بانتظار التصحيح · {hw.gradeNameAr}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubmissionsAssignmentId(hw.id)}
                      className="shrink-0 rounded-xl bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                    >
                      تصحيح
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-center space-y-1">
                <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
                <div className="text-xs font-extrabold text-emerald-800">
                  لا توجد تسليمات معلّقة للتصحيح
                </div>
                <p className="text-[11px] text-emerald-700/80">
                  كل تسليمات الطلاب الحالية تم تصحيحها ومراجعتها.
                </p>
              </div>
            )}

            {/* Selected Homework Quick Details */}
            {selectedHw && (
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-400">الواجب المحدد</div>
                  <div className="mt-0.5 text-sm font-extrabold text-[#0F172A]">
                    {selectedHw.titleAr}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {selectedHw.gradeNameAr}
                    {selectedHw.hasModelAnswer
                      ? ` · نموذج الإجابة: ${MODEL_POLICY_SHORT[selectedHw.modelAnswerPolicy || 'HIDDEN']}`
                      : ''}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-center">
                  <div>
                    <div className="font-mono-num text-sm font-extrabold text-[#0F172A]">
                      {selectedHw.stats.submittedCount}/{selectedHw.stats.totalAssigned}
                    </div>
                    <div className="text-[10px] text-slate-500">التسليمات</div>
                  </div>
                  <div>
                    <div className="font-mono-num text-sm font-extrabold text-emerald-700">
                      {selectedHw.stats.gradedCount}
                    </div>
                    <div className="text-[10px] text-slate-500">مصحّح</div>
                  </div>
                  <div>
                    <div className="font-mono-num text-sm font-extrabold text-[#2563EB]">
                      {selectedHw.stats.averageGrade !== null ? selectedHw.stats.averageGrade : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">المتوسط</div>
                  </div>
                </div>

                {canManageHomework &&
                  selectedHw.hasModelAnswer &&
                  selectedHw.modelAnswerPolicy === 'MANUAL_RELEASE' && (
                    <button
                      type="button"
                      onClick={() => void handleToggleManualModelAnswer(selectedHw)}
                      className={`flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold ${
                        selectedHw.modelAnswerManuallyReleased
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <FileCheck2 className="h-3.5 w-3.5" />
                      <span>
                        {selectedHw.modelAnswerManuallyReleased
                          ? 'إيقاف إتاحة نموذج الإجابة'
                          : 'إتاحة نموذج الإجابة للطلاب الآن'}
                      </span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => setSubmissionsAssignmentId(selectedHw.id)}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                >
                  <ClipboardList className="h-4 w-4" />
                  <span>عرض جميع التسليمات ({selectedHw.stats.submittedCount})</span>
                </button>
              </div>
            )}
          </AdminCard>
        }
      />

      {/* Create / Edit Modal */}
      {formOpen && (
        <AdminHomeworkFormModal
          catalog={catalog}
          studentsMeta={studentsMeta}
          groupsMeta={groupsMeta}
          editingId={editingId}
          onClose={() => {
            setFormOpen(false);
            setEditingId(null);
          }}
          onSaved={(msg) => {
            setFormOpen(false);
            setEditingId(null);
            onToast(msg);
            void loadList();
          }}
        />
      )}

      {/* Teacher Student-View Preview Modal */}
      {previewAssignmentId !== null && (
        <StudentHomeworkModal
          assignmentId={previewAssignmentId}
          onClose={() => setPreviewAssignmentId(null)}
        />
      )}
    </div>
  );
};
