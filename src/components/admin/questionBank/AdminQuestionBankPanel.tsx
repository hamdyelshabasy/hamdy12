import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BookCheck,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Edit3,
  Eye,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../../lib/api.ts';
import { PERMISSIONS, hasAnyPermission, hasPermission } from '../../../lib/permissions.ts';
import type { MeResponse } from '../../../types/lms.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import { QUESTION_TYPE_LABELS } from '../../../types/exams.ts';
import {
  APPROVAL_STATUS_LABELS,
  DIFFICULTY_LABELS,
  type QuestionApprovalStatus,
  type QuestionBankDetail,
  type QuestionBankListItem,
  type QuestionBankStats,
  type QuestionDifficulty,
} from '../../../types/questionBank.ts';
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
} from '../AdminUiPrimitives.tsx';
import { QuestionBankEditorModal } from './QuestionBankEditorModal.tsx';
import { QuestionBankBulkUploadModal } from './QuestionBankBulkUploadModal.tsx';
import { QuestionBankReviewModal } from './QuestionBankReviewModal.tsx';

interface AdminQuestionBankPanelProps {
  catalog: AdminCatalogData;
  currentUser: MeResponse['user'];
  onToast: (msg: string) => void;
  initialStatusTab?: StatusTab;
  initialAction?: 'NONE' | 'CREATE';
  navigationNonce?: number;
}

type StatusTab = 'ALL' | 'PENDING_REVIEW' | 'APPROVED' | 'DRAFT' | 'RETURNED' | 'ARCHIVED' | 'MINE';

function getStatusTone(status: QuestionApprovalStatus, isArchived: boolean): AdminTone {
  if (isArchived || status === 'ARCHIVED') return 'slate';
  if (status === 'APPROVED') return 'emerald';
  if (status === 'PENDING_REVIEW') return 'amber';
  if (status === 'RETURNED') return 'rose';
  return 'blue';
}

function getDifficultyTone(diff: string): AdminTone {
  if (diff === 'EASY') return 'emerald';
  if (diff === 'HARD') return 'rose';
  return 'amber';
}

export const AdminQuestionBankPanel: React.FC<AdminQuestionBankPanelProps> = ({
  catalog,
  currentUser,
  onToast,
  initialStatusTab,
  initialAction,
  navigationNonce,
}) => {
  const canContribute = hasAnyPermission(currentUser, [
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ]);
  const canReview = hasAnyPermission(currentUser, [
    PERMISSIONS.QUESTION_BANK_REVIEW,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ]);
  const canManage = hasPermission(currentUser, PERMISSIONS.QUESTION_BANK_MANAGE);

  const [stats, setStats] = useState<QuestionBankStats | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>(initialStatusTab || 'ALL');
  const [search, setSearch] = useState('');
  const [trackId, setTrackId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [questionType, setQuestionType] = useState('ALL');
  const [difficulty, setDifficulty] = useState('ALL');
  const [hasImages, setHasImages] = useState(false);
  const [hasModelAnswer, setHasModelAnswer] = useState(false);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<QuestionBankListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Master-Detail Sticky Preview (lazy-loaded ONLY when clicked)
  const [activePreviewId, setActivePreviewId] = useState<number | null>(null);
  const [previewDetail, setPreviewDetail] = useState<QuestionBankDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const previewCacheRef = useRef<Map<number, QuestionBankDetail>>(new Map());

  // Modals
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [reviewQuestionId, setReviewQuestionId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionBankListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [zoomImage, setZoomImage] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (initialStatusTab) {
      setStatusTab(initialStatusTab);
      setPage(1);
    }
    if (initialAction === 'CREATE' && canContribute) {
      setEditingId(null);
      setEditorOpen(true);
    }
  }, [initialStatusTab, initialAction, navigationNonce, canContribute]);

  const filteredGrades = useMemo(
    () => (trackId ? catalog.grades.filter((g) => g.trackId === Number(trackId)) : catalog.grades),
    [catalog.grades, trackId],
  );
  const filteredUnits = useMemo(
    () => (gradeId ? catalog.units.filter((u) => u.gradeId === Number(gradeId)) : []),
    [catalog.units, gradeId],
  );
  const filteredLessons = useMemo(
    () => (unitId ? catalog.lessons.filter((l) => l.unitId === Number(unitId)) : []),
    [catalog.lessons, unitId],
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await apiRequest<QuestionBankStats>('/api/admin/question-bank/stats');
      setStats(s);
    } catch {
      // non-fatal
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('pageSize', '20');
      if (statusTab === 'MINE') {
        qs.set('createdByMe', '1');
      } else if (statusTab !== 'ALL') {
        qs.set('status', statusTab);
      }
      if (search.trim()) qs.set('search', search.trim());
      if (trackId) qs.set('trackId', trackId);
      if (gradeId) qs.set('gradeId', gradeId);
      if (unitId) qs.set('unitId', unitId);
      if (lessonId) qs.set('lessonId', lessonId);
      if (questionType !== 'ALL') qs.set('questionType', questionType);
      if (difficulty !== 'ALL') qs.set('difficulty', difficulty);
      if (hasImages) qs.set('hasImages', '1');
      if (hasModelAnswer) qs.set('hasModelAnswer', '1');

      const res = await apiRequest<{
        items: QuestionBankListItem[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/admin/question-bank?${qs.toString()}`);

      setItems(res.items);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.totalPages);
      setSelectedIds([]);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    statusTab,
    search,
    trackId,
    gradeId,
    unitId,
    lessonId,
    questionType,
    difficulty,
    hasImages,
    hasModelAnswer,
    onToast,
  ]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  // Lazy-load full question details ONLY when explicitly selected
  const selectQuestionForPreview = useCallback(
    async (id: number, forceReload = false) => {
      setActivePreviewId(id);
      if (!forceReload && previewCacheRef.current.has(id)) {
        setPreviewDetail(previewCacheRef.current.get(id) || null);
        return;
      }
      setPreviewLoading(true);
      try {
        const res = await apiRequest<{ question: QuestionBankDetail }>(
          `/api/admin/question-bank/${id}`,
        );
        previewCacheRef.current.set(id, res.question);
        setPreviewDetail(res.question);
      } catch (err) {
        onToast((err as Error).message);
      } finally {
        setPreviewLoading(false);
      }
    },
    [onToast],
  );

  const reloadAll = useCallback(async () => {
    previewCacheRef.current.clear();
    await Promise.all([loadStats(), loadQuestions()]);
    if (activePreviewId != null) {
      void selectQuestionForPreview(activePreviewId, true);
    }
  }, [loadStats, loadQuestions, activePreviewId, selectQuestionForPreview]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAllOnPage = () => {
    if (selectedIds.length === items.length && items.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((it) => it.id));
    }
  };

  const handleBulkReview = async (action: 'APPROVE' | 'ARCHIVE') => {
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/question-bank/bulk-review', {
        method: 'POST',
        body: JSON.stringify({ questionIds: selectedIds, action }),
      });
      onToast(res.message);
      await reloadAll();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkSubmitForReview = async () => {
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/question-bank/bulk-meta', {
        method: 'POST',
        body: JSON.stringify({ questionIds: selectedIds, submitForReview: true }),
      });
      onToast(res.message);
      await reloadAll();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleQuickApprove = async (id: number) => {
    if (approvingId != null) return;
    setApprovingId(id);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/question-bank/${id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'APPROVE' }),
        },
      );
      onToast(res.message);
      await reloadAll();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleQuickArchive = async (q: QuestionBankListItem) => {
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/question-bank/${q.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ action: q.isArchived ? 'RESTORE' : 'ARCHIVE' }),
        },
      );
      onToast(res.message);
      await reloadAll();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/question-bank/${deleteTarget.id}`,
        { method: 'DELETE' },
      );
      onToast(res.message);
      if (activePreviewId === deleteTarget.id) {
        setActivePreviewId(null);
        setPreviewDetail(null);
      }
      setDeleteTarget(null);
      await reloadAll();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const activeListItem = useMemo(() => {
    if (activePreviewId != null) {
      return items.find((i) => i.id === activePreviewId) || null;
    }
    return items[0] || null;
  }, [activePreviewId, items]);

  const activeDetailMatches =
    previewDetail && activeListItem && previewDetail.id === activeListItem.id
      ? previewDetail
      : null;

  const hasFilters = Boolean(
    search.trim() ||
      trackId ||
      gradeId ||
      unitId ||
      lessonId ||
      questionType !== 'ALL' ||
      difficulty !== 'ALL' ||
      hasImages ||
      hasModelAnswer,
  );

  const resetFilters = () => {
    setSearch('');
    setTrackId('');
    setGradeId('');
    setUnitId('');
    setLessonId('');
    setQuestionType('ALL');
    setDifficulty('ALL');
    setHasImages(false);
    setHasModelAnswer(false);
    setPage(1);
  };

  return (
    <div className="space-y-5" data-testid="admin-question-bank-panel">
      {/* Header */}
      <AdminPageHeader
        title="بنك الأسئلة"
        subtitle="بنك مركزي للأسئلة المعتمدة والمصنّفة لبناء الامتحانات والواجبات دون تكرار."
        icon={<FileQuestion className="h-5 w-5" />}
        actions={
          canContribute ? (
            <>
              <button
                type="button"
                data-testid="open-bulk-upload-btn"
                onClick={() => setBulkModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/50 hover:text-[#2563EB]"
              >
                <Layers className="h-4 w-4" />
                <span>رفع جماعي بالصور</span>
              </button>
              <button
                type="button"
                data-testid="open-new-bank-question-btn"
                onClick={() => {
                  setEditingId(null);
                  setEditorOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة سؤال جديد</span>
              </button>
            </>
          ) : undefined
        }
      />

      {/* 4 Real KPI Cards */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الأسئلة"
          value={stats?.total ?? total}
          subtitle="كل الحالات"
          tone="blue"
          icon={<FileText className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="معتمد وجاهز"
          value={stats?.approved ?? 0}
          subtitle="جاهز للامتحانات والواجبات"
          tone="emerald"
          icon={<CheckCircle2 className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('APPROVED');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="بانتظار المراجعة"
          value={stats?.pendingReview ?? 0}
          subtitle="يحتاج اعتماد الأستاذ"
          tone="amber"
          icon={<Clock className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('PENDING_REVIEW');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="أسئلة بصور"
          value={stats?.withImages ?? 0}
          subtitle={stats ? `${stats.withModelAnswer} بإجابة نموذجية` : 'صور ومسائل مصوّرة'}
          tone="purple"
          icon={<ImageIcon className="h-5 w-5" />}
          onClick={() => {
            setHasImages((v) => !v);
            setPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Segmented Status Tabs */}
      <AdminSegmentedTabs
        activeId={statusTab}
        onChange={(id) => {
          setStatusTab(id);
          setPage(1);
        }}
        items={[
          { id: 'ALL', label: 'الكل', count: stats?.total },
          { id: 'PENDING_REVIEW', label: 'بانتظار المراجعة', count: stats?.pendingReview },
          { id: 'APPROVED', label: 'معتمد', count: stats?.approved },
          { id: 'DRAFT', label: 'مسودات', count: stats?.draft },
          { id: 'RETURNED', label: 'مُعاد للتعديل', count: stats?.returned },
          { id: 'ARCHIVED', label: 'الأرشيف', count: stats?.archived },
          { id: 'MINE', label: 'إضافاتي', count: stats?.myContributions },
        ]}
      />

      {/* Compact Filter Bar */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="ابحث بالكود (QB-00012)، نص السؤال، المصدر..."
        hasActiveFilters={hasFilters}
        onReset={resetFilters}
      >
        <select
          value={trackId}
          onChange={(e) => {
            setTrackId(e.target.value);
            setGradeId('');
            setUnitId('');
            setLessonId('');
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="">كل المسارات</option>
          {catalog.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nameAr}
            </option>
          ))}
        </select>

        <select
          value={gradeId}
          onChange={(e) => {
            setGradeId(e.target.value);
            setUnitId('');
            setLessonId('');
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="">كل الصفوف</option>
          {filteredGrades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nameAr}
            </option>
          ))}
        </select>

        {filteredUnits.length > 0 && (
          <select
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
              setLessonId('');
              setPage(1);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
          >
            <option value="">كل الوحدات</option>
            {filteredUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.titleAr}
              </option>
            ))}
          </select>
        )}

        {filteredLessons.length > 0 && (
          <select
            value={lessonId}
            onChange={(e) => {
              setLessonId(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
          >
            <option value="">كل الدروس</option>
            {filteredLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.titleAr}
              </option>
            ))}
          </select>
        )}

        <select
          value={questionType}
          onChange={(e) => {
            setQuestionType(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="ALL">كل الأنواع</option>
          {Object.entries(QUESTION_TYPE_LABELS).map(([k, lbl]) => (
            <option key={k} value={k}>
              {lbl}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          onChange={(e) => {
            setDifficulty(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="ALL">كل الصعوبات</option>
          <option value="EASY">سهل</option>
          <option value="MEDIUM">متوسط</option>
          <option value="HARD">متقدم / صعب</option>
        </select>

        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold text-slate-700">
          <input
            type="checkbox"
            checked={hasImages}
            onChange={(e) => {
              setHasImages(e.target.checked);
              setPage(1);
            }}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB]"
          />
          <span>بصور</span>
        </label>

        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold text-slate-700">
          <input
            type="checkbox"
            checked={hasModelAnswer}
            onChange={(e) => {
              setHasModelAnswer(e.target.checked);
              setPage(1);
            }}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB]"
          />
          <span>بإجابة نموذجية</span>
        </label>
      </AdminFilterBar>

      {/* Multi-Select Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/90 px-4 py-3 shadow-sm">
          <span className="text-xs font-extrabold text-[#0F172A]">
            تم تحديد <span className="font-mono-num text-[#2563EB]">{selectedIds.length}</span> سؤالًا
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {canContribute && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkSubmitForReview()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                <span>إرسال للمراجعة</span>
              </button>
            )}
            {canReview && (
              <>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void handleBulkReview('APPROVE')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>اعتماد جماعي</span>
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void handleBulkReview('ARCHIVE')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span>أرشفة جماعية</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {/* Master-Detail Workspace: Table (8 cols) + Sticky Teacher-Only Preview (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSelectAllOnPage}
                  className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-[#0F172A]"
                >
                  {selectedIds.length === items.length && items.length > 0 ? (
                    <CheckSquare className="h-4 w-4 text-[#2563EB]" />
                  ) : (
                    <Square className="h-4 w-4 text-slate-400" />
                  )}
                  <span>قائمة الأسئلة</span>
                </button>
              </div>
              <span className="font-mono-num text-xs font-semibold text-slate-500">
                إجمالي المطابق: <strong className="text-[#0F172A]">{total}</strong> سؤال
              </span>
            </div>

            {loading ? (
              <div className="py-16 text-center text-xs text-slate-500">جارٍ تحميل بنك الأسئلة...</div>
            ) : items.length === 0 ? (
              <div className="p-6">
                <AdminEmptyState
                  icon={<FileQuestion className="h-5 w-5" />}
                  title="لا توجد أسئلة مطابقة للتصفية الحالية"
                  description="يمكنك إضافة سؤال جديد أو استخدام الرفع الجماعي بالصور للبدء."
                  action={
                    hasFilters ? (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        إعادة ضبط التصفية
                      </button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="w-10 px-3 py-3 text-center">تحديد</th>
                      <th className="px-3 py-3">الكود / السؤال</th>
                      <th className="px-3 py-3">الوحدة / الصف</th>
                      <th className="px-3 py-3">النوع</th>
                      <th className="px-3 py-3">الصعوبة</th>
                      <th className="px-3 py-3">الحالة</th>
                      <th className="px-3 py-3 text-left">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((q) => {
                      const checked = selectedIds.includes(q.id);
                      const isActive = activeListItem?.id === q.id;
                      const firstImg = q.questionImages[0]?.previewUrl || q.imageUrl || null;

                      const menuItems: AdminActionMenuItem[] = [
                        {
                          id: 'review',
                          label: canReview ? 'فتح شاشة المراجعة الكاملة' : 'معاينة كاملة',
                          icon: <Eye className="h-3.5 w-3.5" />,
                          onClick: () => setReviewQuestionId(q.id),
                        },
                      ];
                      if (canReview && q.approvalStatus === 'PENDING_REVIEW') {
                        menuItems.push({
                          id: 'approve',
                          label: 'اعتماد سريع للسؤال',
                          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                          tone: 'success',
                          onClick: () => void handleQuickApprove(q.id),
                        });
                      }
                      if (q.canEdit) {
                        menuItems.push({
                          id: 'edit',
                          label: 'تعديل السؤال',
                          icon: <Edit3 className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setEditingId(q.id);
                            setEditorOpen(true);
                          },
                        });
                      }
                      if (canReview) {
                        menuItems.push({
                          id: 'archive',
                          label: q.isArchived ? 'استعادة من الأرشيف' : 'أرشفة السؤال',
                          icon: <Archive className="h-3.5 w-3.5" />,
                          onClick: () => void handleQuickArchive(q),
                        });
                      }
                      if (canManage) {
                        menuItems.push({
                          id: 'delete',
                          label: 'حذف السؤال',
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          tone: 'danger',
                          onClick: () => setDeleteTarget(q),
                        });
                      }

                      return (
                        <tr
                          key={q.id}
                          data-testid={`bank-question-row-${q.id}`}
                          onClick={() => void selectQuestionForPreview(q.id)}
                          className={`cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-blue-50/70'
                              : checked
                                ? 'bg-blue-50/30'
                                : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td
                            className="px-3 py-3 text-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(q.id);
                            }}
                          >
                            <button
                              type="button"
                              aria-label={`تحديد السؤال ${q.bankCode}`}
                              className="text-slate-400 hover:text-[#2563EB]"
                            >
                              {checked ? (
                                <CheckSquare className="h-4 w-4 text-[#2563EB]" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-3 max-w-[260px]">
                            <div className="flex items-start gap-2.5">
                              {firstImg && (
                                <span className="mt-0.5 flex h-9 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                  <img
                                    src={firstImg}
                                    alt={q.bankCode}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono-num text-[11px] font-extrabold text-[#2563EB]">
                                    {q.bankCode}
                                  </span>
                                  <span className="font-mono-num text-[10px] font-bold text-slate-400">
                                    · {q.points} د
                                  </span>
                                  {q.hasModelAnswer && (
                                    <span
                                      title="يحتوي على إجابة نموذجية"
                                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                                    />
                                  )}
                                </div>
                                <div className="mt-0.5 line-clamp-1 font-bold text-[#0F172A]">
                                  {q.promptAr.trim() ? q.promptAr : 'سؤال مصوّر (بدون نص إضافي)'}
                                </div>
                                <div className="mt-0.5 text-[10px] text-slate-400">
                                  {q.examsUsageCount} امتحان · {q.homeworkUsageCount} واجب
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-700">
                              {q.unitTitleAr || q.gradeNameAr}
                            </div>
                            <div className="text-[11px] text-slate-400">{q.gradeNameAr}</div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                            {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}
                          </td>
                          <td className="px-3 py-3">
                            <AdminStatusBadge tone={getDifficultyTone(String(q.difficulty))}>
                              {DIFFICULTY_LABELS[q.difficulty as QuestionDifficulty] || q.difficulty}
                            </AdminStatusBadge>
                          </td>
                          <td className="px-3 py-3">
                            <AdminStatusBadge tone={getStatusTone(q.approvalStatus, q.isArchived)}>
                              {q.approvalStatus === 'APPROVED'
                                ? 'معتمد'
                                : q.approvalStatus === 'PENDING_REVIEW'
                                  ? 'بانتظار المراجعة'
                                  : APPROVAL_STATUS_LABELS[q.approvalStatus] || q.approvalStatus}
                            </AdminStatusBadge>
                          </td>
                          <td className="px-3 py-3 text-left">
                            <AdminActionMenu items={menuItems} ariaLabel={`إجراءات ${q.bankCode}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs">
                <span className="text-slate-600">
                  صفحة <strong className="font-mono-num text-[#0F172A]">{page}</strong> من{' '}
                  <strong className="font-mono-num text-[#0F172A]">{totalPages}</strong>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>السابق</span>
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
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
          activeListItem ? (
            <AdminCard className="space-y-4">
              {/* Preview Header */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
                  <h3 className="text-sm font-extrabold text-[#0F172A]">معاينة السؤال</h3>
                </div>
                <span className="rounded-lg bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-[#6D28D9]">
                  للمدرس فقط
                </span>
              </div>

              {/* Meta Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-lg bg-[#0D172B] px-2 py-0.5 font-mono-num text-[11px] font-bold text-white">
                    {activeListItem.bankCode}
                  </span>
                  <AdminStatusBadge
                    tone={getStatusTone(activeListItem.approvalStatus, activeListItem.isArchived)}
                  >
                    {APPROVAL_STATUS_LABELS[activeListItem.approvalStatus] || activeListItem.approvalStatus}
                  </AdminStatusBadge>
                  <AdminStatusBadge tone={getDifficultyTone(String(activeListItem.difficulty))}>
                    {DIFFICULTY_LABELS[activeListItem.difficulty as QuestionDifficulty] ||
                      activeListItem.difficulty}
                  </AdminStatusBadge>
                </div>
                <span className="font-mono-num text-xs font-extrabold text-[#2563EB]">
                  {activeListItem.points} درجة
                </span>
              </div>

              {/* Taxonomy */}
              <div className="text-[11px] font-medium text-slate-500">
                {activeListItem.trackNameAr} · {activeListItem.gradeNameAr}
                {activeListItem.unitTitleAr ? ` · ${activeListItem.unitTitleAr}` : ''}
                {activeListItem.lessonTitleAr ? ` · ${activeListItem.lessonTitleAr}` : ''}
              </div>

              {/* Question Prompt */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-xs font-bold leading-relaxed text-[#0F172A]">
                {activeListItem.promptAr.trim()
                  ? activeListItem.promptAr
                  : 'سؤال مصوّر — اضغط على الصورة لتكبيرها.'}
              </div>

              {/* Question Images */}
              {activeListItem.questionImages.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {activeListItem.questionImages.map((img, idx) =>
                    img.previewUrl ? (
                      <button
                        key={img.storageKey || idx}
                        type="button"
                        onClick={() =>
                          setZoomImage({
                            url: img.previewUrl!,
                            label: `${activeListItem.bankCode} — صورة ${idx + 1}`,
                          })
                        }
                        className="group relative h-28 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 hover:border-[#2563EB]"
                      >
                        <img
                          src={img.previewUrl}
                          alt={`${activeListItem.bankCode}-${idx + 1}`}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white opacity-0 transition-all group-hover:bg-slate-950/35 group-hover:opacity-100">
                          <ZoomIn className="h-4 w-4" />
                        </span>
                      </button>
                    ) : null,
                  )}
                </div>
              )}

              {/* Lazy-loaded Teacher Choices & Model Answer */}
              {previewLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 py-6 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
                  <span>جارٍ تحميل الاختيارات والإجابة النموذجية...</span>
                </div>
              ) : activeDetailMatches ? (
                <div className="space-y-3">
                  {activeDetailMatches.choices && activeDetailMatches.choices.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-500">الاختيارات</div>
                      {activeDetailMatches.choices.map((ch, idx) => (
                        <div
                          key={ch.id || idx}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                            ch.isCorrect
                              ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <span>{ch.labelAr}</span>
                          {ch.isCorrect && (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeDetailMatches.modelAnswerAr ||
                    activeDetailMatches.numericAnswer ||
                    activeDetailMatches.explanationAr) && (
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 text-xs space-y-1">
                      <div className="font-extrabold text-emerald-800">الإجابة النموذجية</div>
                      {activeDetailMatches.numericAnswer && (
                        <div className="font-mono-num font-bold text-emerald-900">
                          القيمة: {activeDetailMatches.numericAnswer}{' '}
                          {activeDetailMatches.numericUnit || ''}
                        </div>
                      )}
                      {activeDetailMatches.modelAnswerAr && (
                        <p className="leading-relaxed text-emerald-900/90">
                          {activeDetailMatches.modelAnswerAr}
                        </p>
                      )}
                      {activeDetailMatches.explanationAr && (
                        <p className="pt-1 text-[11px] text-emerald-800/80">
                          التوضيح: {activeDetailMatches.explanationAr}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void selectQuestionForPreview(activeListItem.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-blue-200 bg-blue-50/50 py-3 text-xs font-bold text-[#2563EB] transition-colors hover:bg-blue-50"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>تحميل الاختيارات والإجابة النموذجية</span>
                </button>
              )}

              {/* Usage & Metadata */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <ClipboardCheck className="h-3.5 w-3.5 text-[#2563EB]" />
                    {activeListItem.examsUsageCount} امتحان
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <BookCheck className="h-3.5 w-3.5 text-emerald-600" />
                    {activeListItem.homeworkUsageCount} واجب
                  </span>
                </div>
                <span className="text-[10px]">
                  {formatDateTimeAr(activeListItem.updatedAt)}
                </span>
              </div>

              {activeListItem.approvalStatus === 'RETURNED' && activeListItem.reviewFeedbackAr && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                  ملاحظة المراجعة: {activeListItem.reviewFeedbackAr}
                </div>
              )}

              {/* Direct Teacher Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {canReview && activeListItem.approvalStatus === 'PENDING_REVIEW' && (
                  <button
                    type="button"
                    disabled={approvingId === activeListItem.id}
                    onClick={() => void handleQuickApprove(activeListItem.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>اعتماد</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReviewQuestionId(activeListItem.id)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{canReview ? 'مراجعة كاملة' : 'معاينة كاملة'}</span>
                </button>
                {activeListItem.canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(activeListItem.id);
                      setEditorOpen(true);
                    }}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>تعديل</span>
                  </button>
                )}
              </div>
            </AdminCard>
          ) : (
            <AdminCard>
              <AdminEmptyState
                icon={<FileQuestion className="h-5 w-5" />}
                title="معاينة السؤال"
                description="اختر أي سؤال من الجدول لعرض نصه وصوره وإجابته النموذجية للمدرس."
              />
            </AdminCard>
          )
        }
      />

      {/* 3-Tab Question Editor Modal */}
      <QuestionBankEditorModal
        open={editorOpen}
        catalog={catalog}
        editingQuestionId={editingId}
        canReview={canReview}
        onClose={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
        onSaved={(msg) => {
          onToast(msg);
          void reloadAll();
        }}
      />

      {/* TA Bulk Upload Modal */}
      <QuestionBankBulkUploadModal
        open={bulkModalOpen}
        catalog={catalog}
        canReview={canReview}
        onClose={() => setBulkModalOpen(false)}
        onSaved={(msg) => {
          onToast(msg);
          void reloadAll();
        }}
      />

      {/* Side-by-Side Review & History Modal */}
      <QuestionBankReviewModal
        questionId={reviewQuestionId}
        canReview={canReview}
        currentUserId={currentUser.id}
        onClose={() => setReviewQuestionId(null)}
        onUpdated={(msg) => {
          onToast(msg);
          void reloadAll();
        }}
      />

      {/* Safe Delete Dialog */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف السؤال"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-[#0F172A]">
              حذف السؤال {deleteTarget.bankCode}
            </h3>
            {deleteTarget.examsUsageCount > 0 || deleteTarget.homeworkUsageCount > 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
                هذا السؤال مستخدم حاليًا في ({deleteTarget.examsUsageCount}) امتحان و (
                {deleteTarget.homeworkUsageCount}) واجب، ولذلك يمنع النظام حذفه نهائيًا حفاظًا على السجل التاريخي للطلاب. يمكنك أرشفته بدلًا من الحذف.
              </p>
            ) : (
              <p className="text-sm text-slate-600">
                هل أنت متأكد من حذف هذا السؤال غير المستخدم نهائيًا من بنك الأسئلة؟
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              {deleteTarget.examsUsageCount > 0 || deleteTarget.homeworkUsageCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const target = deleteTarget;
                    setDeleteTarget(null);
                    void handleQuickArchive(target);
                  }}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
                >
                  أرشفة بدلًا من الحذف
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleConfirmDelete()}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Lightbox */}
      {zoomImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تكبير صورة السؤال"
          onClick={() => setZoomImage(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-white p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <span className="truncate text-xs font-bold text-[#0F172A]">{zoomImage.label}</span>
              <button
                type="button"
                onClick={() => setZoomImage(null)}
                aria-label="إغلاق المعاينة"
                className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={zoomImage.url}
              alt={zoomImage.label}
              className="max-h-[78vh] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
