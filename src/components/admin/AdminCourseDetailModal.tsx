import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  BookOpen,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  History,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Unlink,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../../lib/api.ts';
import { sanitizeNumericInputValue } from '../../lib/numerals.ts';
import type { AuthUser } from '../../types/lms.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';

export type CourseModalTab = 'basic' | 'content' | 'subscribers' | 'lifecycle';

interface CourseDetailResponse {
  course: {
    id: number;
    gradeId: number;
    trackId: number | null;
    trackNameAr: string;
    gradeNameAr: string;
    titleAr: string;
    descriptionAr: string | null;
    thumbnailUrl: string | null;
    originalPriceEgp: number;
    discountPriceEgp: number;
    validityDays: number;
    hasFreePreview: boolean;
    hasCertificate: boolean;
    publicationStatus: string;
    isPublished: boolean;
    defaultVideoMaxOpens: number | null;
    sortOrder: number;
    videosCount: number;
    activeSubscribersCount: number;
    ordersCount: number;
  };
  videos: Array<{
    id: number;
    titleAr: string;
    youtubeUrl: string | null;
    youtubeVideoId: string | null;
    unitId: number | null;
    unitTitleAr: string;
    lessonId: number;
    lessonTitleAr: string;
    gradeId: number;
    gradeNameAr: string;
    videoType: string;
    publicationStatus: string;
    isPublished: boolean;
    sortOrder: number;
    maxOpens: number | null;
    effectiveMaxOpens: number | null;
    pdfDriveUrl: string | null;
    pdfDriveFileId: string | null;
    pdfTitle: string | null;
    pdfDescription: string | null;
  }>;
  availableLibraryVideos: Array<{
    id: number;
    titleAr: string;
    gradeId: number;
    gradeNameAr: string;
    lessonTitleAr: string;
    videoType: string;
    hasPdf: boolean;
  }>;
  subscribers: Array<{
    entitlementId: number;
    userId: number;
    fullName: string;
    phone: string;
    accountStatus: string;
    trackNameAr: string;
    gradeNameAr: string;
    source: string;
    startsAt: string;
    expiresAt: string | null;
    remainingDays: number | null;
    status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED' | 'REVOKED';
    isBlocked?: boolean;
    blockReason?: string;
    blockedAt?: string | null;
    note: string;
  }>;
  linkedExams: Array<{ id: number; titleAr: string }>;
  auditLogs: Array<{ id: number; actorName: string; action: string; createdAt: string }>;
  deletionSafety: {
    canArchive: boolean;
    canPermanentlyDelete: boolean;
    blockReasonAr: string | null;
    warningsAr: string[];
  };
  studentsForManualAdd: Array<{
    id: number;
    fullName: string;
    phone: string | null;
    gradeNameAr: string;
  }>;
}

interface DeletionImpactData {
  courseId: number;
  courseTitleAr: string;
  counts: {
    entitlements: number;
    activeSubscribers: number;
    subscriptions: number;
    orders: number;
    linkedExams: number;
    linkedHomework: number;
    linkedVideos: number;
    redeemedCodes: number;
  };
  canPhysicalDelete: boolean;
  mode: 'PHYSICAL_DELETE' | 'ACTIVE_REMOVAL';
  explanationAr: string;
}

interface AdminCourseDetailModalProps {
  courseId: number;
  initialTab?: CourseModalTab;
  catalog: AdminCatalogData;
  currentUser?: AuthUser;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onToast: (msg: string) => void;
}

const PUB_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PUBLISHED: { label: 'منشور ومتاح', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT: { label: 'مسودة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  HIDDEN: { label: 'مخفي عن الطلاب', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  ARCHIVED: { label: 'مؤرشف', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  REMOVED: { label: 'مُزال من المنصة النشطة', cls: 'bg-red-50 text-red-700 border-red-200' },
};

const SOURCE_AR: Record<string, string> = {
  MANUAL_GRANT: 'منحة يدوية',
  PURCHASE: 'شراء مباشر',
  SUBSCRIPTION: 'اشتراك',
  ACTIVATION_CODE: 'كود تفعيل',
};

export const AdminCourseDetailModal: React.FC<AdminCourseDetailModalProps> = ({
  courseId,
  initialTab = 'basic',
  catalog,
  currentUser,
  onClose,
  onChanged,
  onToast,
}) => {
  const isSuperAdmin = currentUser?.roleSlug === 'SUPER_ADMIN';
  const [tab, setTab] = useState<CourseModalTab>(initialTab);
  const [data, setData] = useState<CourseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Basic course edit state
  const [form, setForm] = useState({
    gradeId: 0,
    titleAr: '',
    descriptionAr: '',
    thumbnailUrl: '',
    originalPriceEgp: 0,
    discountPriceEgp: 0,
    validityDays: 120,
    publicationStatus: 'PUBLISHED',
    sortOrder: 0,
    defaultVideoMaxOpens: '' as string,
    applyValidityToExisting: false,
  });

  // Attach library video state
  const [attachVideoId, setAttachVideoId] = useState<number>(0);

  // Inline video & PDF editor state
  const [editingVideoId, setEditingVideoId] = useState<number | null>(null);
  const [vidEditForm, setVidEditForm] = useState({
    titleAr: '',
    youtubeUrl: '',
    lessonId: 0,
    maxOpens: '' as string,
    pdfDriveUrl: '',
    pdfTitle: '',
    pdfDescription: '',
  });

  // Add subscriber state
  const [addSubUserId, setAddSubUserId] = useState<number>(0);
  const [addSubDays, setAddSubDays] = useState<number>(0);
  const [addSubNote, setAddSubNote] = useState('');
  const [subSearch, setSubSearch] = useState('');

  // Per-course block modal state
  const [blockTarget, setBlockTarget] = useState<{ userId: number; fullName: string } | null>(null);
  const [blockReason, setBlockReason] = useState('');

  // Guarded SUPER_ADMIN permanent delete state
  const [deletionImpact, setDeletionImpact] = useState<DeletionImpactData | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [permDeleteOpen, setPermDeleteOpen] = useState(false);
  const [permPassword, setPermPassword] = useState('');
  const [permTitleConfirm, setPermTitleConfirm] = useState('');
  const [permBackupConfirmed, setPermBackupConfirmed] = useState(false);
  const [permReason, setPermReason] = useState('');

  // Paid revoke confirmation
  const [confirmPaidRevoke, setConfirmPaidRevoke] = useState<{
    entitlementId: number;
    fullName: string;
    source: string;
  } | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<CourseDetailResponse>(
        `/api/admin/manage/courses/${courseId}/detail`,
      );
      setData(res);
      setForm({
        gradeId: res.course.gradeId,
        titleAr: res.course.titleAr,
        descriptionAr: res.course.descriptionAr || '',
        thumbnailUrl: res.course.thumbnailUrl || '',
        originalPriceEgp: res.course.originalPriceEgp,
        discountPriceEgp: res.course.discountPriceEgp,
        validityDays: res.course.validityDays,
        publicationStatus: res.course.publicationStatus || (res.course.isPublished ? 'PUBLISHED' : 'HIDDEN'),
        sortOrder: res.course.sortOrder,
        defaultVideoMaxOpens:
          res.course.defaultVideoMaxOpens === null || res.course.defaultVideoMaxOpens === undefined
            ? ''
            : String(res.course.defaultVideoMaxOpens),
        applyValidityToExisting: false,
      });
      if (res.availableLibraryVideos.length > 0) {
        setAttachVideoId((prev) =>
          res.availableLibraryVideos.some((v) => v.id === prev) ? prev : res.availableLibraryVideos[0].id,
        );
      } else {
        setAttachVideoId(0);
      }
      if (res.studentsForManualAdd.length > 0 && addSubUserId === 0) {
        setAddSubUserId(res.studentsForManualAdd[0].id);
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [courseId, onToast, addSubUserId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/manage/courses/${courseId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gradeId: form.gradeId,
          titleAr: form.titleAr,
          descriptionAr: form.descriptionAr,
          thumbnailUrl: form.thumbnailUrl,
          originalPriceEgp: form.originalPriceEgp,
          discountPriceEgp: form.discountPriceEgp,
          validityDays: form.validityDays,
          publicationStatus: form.publicationStatus,
          sortOrder: form.sortOrder,
          defaultVideoMaxOpens:
            form.defaultVideoMaxOpens.trim() === '' ? null : Number(form.defaultVideoMaxOpens),
          applyValidityToExisting: form.applyValidityToExisting,
        }),
      });
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAttachVideo = async () => {
    if (!attachVideoId) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/videos/attach`,
        { method: 'POST', body: JSON.stringify({ videoId: attachVideoId }) },
      );
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDetachVideo = async (videoId: number) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/videos/detach`,
        { method: 'POST', body: JSON.stringify({ videoId }) },
      );
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleMoveVideo = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= data.videos.length) return;
    const reordered = [...data.videos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/videos/reorder`,
        {
          method: 'POST',
          body: JSON.stringify({ orderedVideoIds: reordered.map((v) => v.id) }),
        },
      );
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openVideoEditor = (v: CourseDetailResponse['videos'][number]) => {
    if (editingVideoId === v.id) {
      setEditingVideoId(null);
      return;
    }
    setEditingVideoId(v.id);
    setVidEditForm({
      titleAr: v.titleAr,
      youtubeUrl: v.youtubeUrl || '',
      lessonId: v.lessonId,
      maxOpens: v.maxOpens === null || v.maxOpens === undefined ? '' : String(v.maxOpens),
      pdfDriveUrl: v.pdfDriveUrl || '',
      pdfTitle: v.pdfTitle || '',
      pdfDescription: v.pdfDescription || '',
    });
  };

  const handleSaveVideoAndPdf = async (videoId: number, removePdf = false) => {
    setBusy(true);
    try {
      // Reuse existing PATCH /api/admin/videos/:id for metadata + Google Drive PDF attachment
      const videoPayload: Record<string, unknown> = {
        titleAr: vidEditForm.titleAr,
        lessonId: vidEditForm.lessonId || undefined,
      };
      if (vidEditForm.youtubeUrl.trim()) {
        videoPayload.youtubeUrl = vidEditForm.youtubeUrl.trim();
      }
      if (removePdf) {
        videoPayload.removePdf = true;
      } else if (vidEditForm.pdfDriveUrl.trim()) {
        videoPayload.pdfDriveUrl = vidEditForm.pdfDriveUrl.trim();
        videoPayload.pdfTitle = vidEditForm.pdfTitle.trim() || undefined;
        videoPayload.pdfDescription = vidEditForm.pdfDescription.trim() || undefined;
      }

      await apiRequest(`/api/admin/videos/${videoId}`, {
        method: 'PATCH',
        body: JSON.stringify(videoPayload),
      });

      // Save per-video max opens limit
      await apiRequest(`/api/admin/manage/videos/${videoId}/view-limit`, {
        method: 'PATCH',
        body: JSON.stringify({
          maxOpens: vidEditForm.maxOpens.trim() === '' ? null : Number(vidEditForm.maxOpens),
        }),
      });

      setEditingVideoId(null);
      onToast(removePdf ? 'تمت إزالة ملف PDF المرفق وتحديث الفيديو' : 'تم حفظ تعديلات الفيديو ومرفق PDF وحد المشاهدة');
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addSubUserId) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/subscribers/add`,
        {
          method: 'POST',
          body: JSON.stringify({
            userId: addSubUserId,
            durationDays: addSubDays,
            note: addSubNote,
          }),
        },
      );
      setAddSubNote('');
      onToast(res.message);
      await loadDetail();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubscriberAction = async (
    entitlementId: number,
    action: 'EXTEND_30' | 'RESTORE' | 'REVOKE',
    meta?: { fullName: string; source: string },
    confirmPaid = false,
  ) => {
    if (action === 'REVOKE' && meta && meta.source !== 'MANUAL_GRANT' && !confirmPaid) {
      setConfirmPaidRevoke({ entitlementId, fullName: meta.fullName, source: meta.source });
      return;
    }
    setBusy(true);
    try {
      if (action === 'REVOKE') {
        const res = await apiRequest<{ message: string }>(
          `/api/admin/manage/entitlements/${entitlementId}/revoke`,
          { method: 'POST', body: JSON.stringify({ confirmPaidRevoke: confirmPaid }) },
        );
        setConfirmPaidRevoke(null);
        onToast(res.message);
      } else {
        const res = await apiRequest<{ message: string }>(
          `/api/admin/manage/entitlements/${entitlementId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(action === 'RESTORE' ? { restore: true } : { extendDays: 30 }),
          },
        );
        onToast(res.message);
      }
      await loadDetail();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleBlockStudentFromCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockTarget) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/subscribers/${blockTarget.userId}/block`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: blockReason.trim() || 'حظر من هذا الكورس فقط' }),
        },
      );
      setBlockTarget(null);
      setBlockReason('');
      onToast(res.message);
      await loadDetail();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreBlockedStudent = async (userId: number) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/subscribers/${userId}/restore`,
        { method: 'POST' },
      );
      onToast(res.message);
      await loadDetail();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSetVisibility = async (publicationStatus: 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED' | 'DRAFT') => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/visibility`,
        {
          method: 'PATCH',
          body: JSON.stringify({ publicationStatus }),
        },
      );
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveToggle = async (restore: boolean) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/manage/courses/${courseId}/archive`,
        { method: 'POST', body: JSON.stringify({ restore }) },
      );
      onToast(res.message);
      await loadDetail();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenGuardedPermanentDelete = async () => {
    setPermDeleteOpen(true);
    setPermPassword('');
    setPermTitleConfirm('');
    setPermBackupConfirmed(false);
    setPermReason('');
    setLoadingImpact(true);
    try {
      const impact = await apiRequest<DeletionImpactData>(
        `/api/admin/manage/courses/${courseId}/deletion-impact`,
      );
      setDeletionImpact(impact);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoadingImpact(false);
    }
  };

  const handleGuardedPermanentDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string; mode: string }>(
        `/api/admin/manage/courses/${courseId}/permanent-delete`,
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: permPassword,
            confirmCourseTitle: permTitleConfirm,
            backupConfirmed: permBackupConfirmed,
            reason: permReason,
          }),
        },
      );
      onToast(res.message);
      setPermDeleteOpen(false);
      await onChanged();
      onClose();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pubMeta = data
    ? PUB_STATUS_LABELS[data.course.publicationStatus] || PUB_STATUS_LABELS.PUBLISHED
    : null;

  const TABS: Array<{ id: CourseModalTab; label: string; icon: React.ReactNode }> = [
    { id: 'basic', label: 'البيانات والصلاحية والحدود', icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: 'content', label: 'الفيديوهات ومرفقات PDF', icon: <Video className="h-3.5 w-3.5" /> },
    { id: 'subscribers', label: 'الطلاب المشتركون', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'lifecycle', label: 'السجل والأرشفة والحذف', icon: <History className="h-3.5 w-3.5" /> },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إدارة الكورس الكاملة"
      className="fixed inset-0 z-[55] flex justify-end bg-slate-950/55"
    >
      <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#F7F9FC] px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold text-[#0B162C]">
                {data ? data.course.titleAr : 'إدارة الكورس'}
              </h3>
              {pubMeta && (
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${pubMeta.cls}`}>
                  {pubMeta.label}
                </span>
              )}
            </div>
            {data && (
              <p className="mt-1 text-xs text-slate-600">
                {data.course.trackNameAr} · {data.course.gradeNameAr} · {data.course.videosCount} فيديو ·{' '}
                {data.course.activeSubscribersCount} مشترك نشط
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة الكورس"
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="أقسام إدارة الكورس"
          className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-4 py-2"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                tab === t.id
                  ? 'bg-[#0B162C] text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B162C]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading || !data ? (
            <div className="py-12 text-center text-sm text-slate-500">جارٍ تحميل تفاصيل الكورس...</div>
          ) : (
            <>
              {/* TAB 1: BASIC INFO, PRICING, VALIDITY & DEFAULT VIEW LIMIT */}
              {tab === 'basic' && (
                <form onSubmit={handleSaveCourse} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                      <span>عنوان الكورس</span>
                      <input
                        type="text"
                        required
                        value={form.titleAr}
                        onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>الصف الدراسي</span>
                      <select
                        value={form.gradeId}
                        onChange={(e) => setForm({ ...form, gradeId: Number(e.target.value) })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      >
                        {catalog.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nameAr}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>حالة النشر والظهور</span>
                      <select
                        value={form.publicationStatus}
                        onChange={(e) => setForm({ ...form, publicationStatus: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      >
                        <option value="PUBLISHED">منشور ومتاح للطلاب</option>
                        <option value="DRAFT">مسودة (غير ظاهر)</option>
                        <option value="HIDDEN">مخفي مؤقتًا</option>
                        <option value="ARCHIVED">مؤرشف (مغلق للمبيعات الجديدة)</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>السعر الأصلي (ج.م)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(form.originalPriceEgp)}
                        onChange={(e) => {
                          const c = sanitizeNumericInputValue(e.target.value, { allowDecimal: false });
                          setForm({ ...form, originalPriceEgp: c ? Number(c) : 0 });
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>السعر بعد الخصم (ج.م)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(form.discountPriceEgp)}
                        onChange={(e) => {
                          const c = sanitizeNumericInputValue(e.target.value, { allowDecimal: false });
                          setForm({ ...form, discountPriceEgp: c ? Number(c) : 0 });
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>مدة الصلاحية الافتراضية (بالأيام)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(form.validityDays)}
                        onChange={(e) => {
                          const c = sanitizeNumericInputValue(e.target.value, { allowDecimal: false });
                          setForm({ ...form, validityDays: c ? Number(c) : 1 });
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>حد مرات فتح الفيديو الافتراضي (اتركه فارغًا = غير محدود)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="غير محدود"
                        value={form.defaultVideoMaxOpens}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            defaultVideoMaxOpens: sanitizeNumericInputValue(e.target.value, {
                              allowDecimal: false,
                            }),
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>رابط صورة الكورس (اختياري)</span>
                      <input
                        type="text"
                        dir="ltr"
                        value={form.thumbnailUrl}
                        onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>ترتيب الظهور</span>
                      <input
                        type="number"
                        value={form.sortOrder}
                        onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                      <span>وصف ومحتويات الكورس</span>
                      <textarea
                        rows={3}
                        value={form.descriptionAr}
                        onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 p-3 text-sm font-normal"
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs text-slate-700 space-y-2">
                    <div className="font-bold text-[#0B162C]">ضمان عدم التأثير على السجلات السابقة</div>
                    <p>
                      تعديل السعر لا يغير أي طلبات مالية سابقة. كما أن حد مرات فتح الفيديو يُحتسب بأمان من الخادم
                      مع نافذة حماية 30 دقيقة لنفس الجلسة حتى لا يُخصم التقديم أو الإيقاف المؤقت أو إعادة التحميل.
                    </p>
                    <label className="flex items-center gap-2 pt-1 font-semibold text-[#0B162C]">
                      <input
                        type="checkbox"
                        checked={form.applyValidityToExisting}
                        onChange={(e) => setForm({ ...form, applyValidityToExisting: e.target.checked })}
                      />
                      <span>تطبيق مدة الصلاحية الجديدة على اشتراكات الكورس النشطة الحالية أيضًا (اختياري)</span>
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      <span>حفظ تعديلات الكورس</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 2: COURSE VIDEOS & GOOGLE DRIVE PDF ATTACHMENTS */}
              {tab === 'content' && (
                <div className="space-y-5">
                  {/* Attach existing library video */}
                  <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                    <div className="text-xs font-extrabold text-[#0B162C]">
                      إضافة فيديو موجود من مكتبة الفيديوهات إلى هذا الكورس
                    </div>
                    {data.availableLibraryVideos.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        جميع الفيديوهات المتاحة في المكتبة مرتبطة بالفعل بهذا الكورس.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <select
                          aria-label="اختر فيديو لإضافته للكورس"
                          value={attachVideoId}
                          onChange={(e) => setAttachVideoId(Number(e.target.value))}
                          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                        >
                          {data.availableLibraryVideos.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.titleAr} ({v.gradeNameAr} · {v.lessonTitleAr})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || !attachVideoId}
                          onClick={() => void handleAttachVideo()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                        >
                          <Plus className="h-4 w-4" />
                          <span>إضافة إلى الكورس</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Course Videos List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-extrabold text-[#0B162C]">
                        فيديوهات الكورس ومرفقات PDF ({data.videos.length})
                      </h4>
                      <span className="text-[11px] text-slate-500">
                        إزالة فيديو من الكورس تفك ارتباطه فقط ولا تحذفه من مكتبة الفيديوهات
                      </span>
                    </div>

                    {data.videos.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
                        لا توجد فيديوهات مضافة إلى هذا الكورس بعد.
                      </div>
                    ) : (
                      data.videos.map((v, idx) => (
                        <div key={v.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono-num text-[11px] font-bold text-slate-700">
                                  #{idx + 1}
                                </span>
                                <span className="font-bold text-sm text-[#0B162C]">{v.titleAr}</span>
                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                    v.isPublished
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {v.isPublished ? 'منشور' : 'مسودة / مخفي'}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                <span>
                                  {v.unitTitleAr} · {v.lessonTitleAr}
                                </span>
                                <span className="font-mono-num text-[#2563EB]">
                                  حد المشاهدة: {v.effectiveMaxOpens === null ? 'غير محدود' : `${v.effectiveMaxOpens} مرات`}
                                </span>
                                {v.pdfDriveFileId || v.pdfDriveUrl ? (
                                  <a
                                    href={v.pdfDriveUrl || `https://drive.google.com/file/d/${v.pdfDriveFileId}/view`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    <span>{v.pdfTitle || 'ملف PDF مرفق'}</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-slate-400">بدون ملف PDF</span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`تحريك ${v.titleAr} لأعلى`}
                                disabled={busy || idx === 0}
                                onClick={() => void handleMoveVideo(idx, -1)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`تحريك ${v.titleAr} لأسفل`}
                                disabled={busy || idx === data.videos.length - 1}
                                onClick={() => void handleMoveVideo(idx, 1)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openVideoEditor(v)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-[#0B162C] hover:border-[#2563EB]"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                <span>تعديل / PDF / الحد</span>
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleDetachVideo(v.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                                <span>إزالة من الكورس</span>
                              </button>
                            </div>
                          </div>

                          {/* Inline Video, PDF Attachment & View Limit Editor */}
                          {editingVideoId === v.id && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50/35 p-4 space-y-3 text-xs">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-1 font-semibold">
                                  <span>عنوان الفيديو</span>
                                  <input
                                    type="text"
                                    value={vidEditForm.titleAr}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, titleAr: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-normal"
                                  />
                                </label>
                                <label className="space-y-1 font-semibold">
                                  <span>رابط يوتيوب</span>
                                  <input
                                    type="url"
                                    dir="ltr"
                                    value={vidEditForm.youtubeUrl}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, youtubeUrl: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left font-normal"
                                  />
                                </label>
                                <label className="space-y-1 font-semibold">
                                  <span>الدرس المرتبط</span>
                                  <select
                                    value={vidEditForm.lessonId}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, lessonId: Number(e.target.value) })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-normal"
                                  >
                                    {catalog.lessons.map((l) => (
                                      <option key={l.id} value={l.id}>
                                        {l.titleAr}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="space-y-1 font-semibold">
                                  <span>حد المشاهدة لهذا الفيديو (فارغ = افتراضي الكورس)</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={500}
                                    placeholder="افتراضي الكورس / غير محدود"
                                    value={vidEditForm.maxOpens}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, maxOpens: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono-num font-normal"
                                  />
                                </label>
                              </div>

                              <div className="border-t border-blue-200/70 pt-3 space-y-2">
                                <div className="font-extrabold text-[#0B162C]">
                                  مرفق Google Drive PDF لهذا الفيديو
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <input
                                    type="url"
                                    dir="ltr"
                                    placeholder="https://drive.google.com/file/d/.../view"
                                    value={vidEditForm.pdfDriveUrl}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, pdfDriveUrl: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left sm:col-span-2"
                                  />
                                  <input
                                    type="text"
                                    placeholder="عنوان ملف PDF (مثال: ملخص القوانين)"
                                    value={vidEditForm.pdfTitle}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, pdfTitle: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                                  />
                                  <input
                                    type="text"
                                    placeholder="وصف مختصر للملف (اختياري)"
                                    value={vidEditForm.pdfDescription}
                                    onChange={(e) =>
                                      setVidEditForm({ ...vidEditForm, pdfDescription: e.target.value })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <div>
                                  {(v.pdfDriveFileId || v.pdfDriveUrl) && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void handleSaveVideoAndPdf(v.id, true)}
                                      className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 font-bold text-red-700 hover:bg-red-100"
                                    >
                                      إزالة ملف PDF المرفق
                                    </button>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingVideoId(null)}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                                  >
                                    إلغاء
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleSaveVideoAndPdf(v.id, false)}
                                    className="rounded-md bg-[#2563EB] px-4 py-1.5 font-bold text-white hover:bg-[#1D4ED8]"
                                  >
                                    حفظ التعديلات
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: COURSE SUBSCRIBERS */}
              {tab === 'subscribers' && (
                <div className="space-y-5">
                  <form
                    onSubmit={handleAddSubscriber}
                    className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3"
                  >
                    <div className="text-xs font-extrabold text-[#0B162C]">
                      إضافة طالب يدويًا إلى الكورس
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-4">
                      <select
                        aria-label="اختيار الطالب"
                        value={addSubUserId}
                        onChange={(e) => setAddSubUserId(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:col-span-2"
                      >
                        {data.studentsForManualAdd.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName} ({s.phone}) · {s.gradeNameAr}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="مدة الصلاحية"
                        value={addSubDays}
                        onChange={(e) => setAddSubDays(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        <option value={0}>صلاحية دائمة</option>
                        <option value={30}>30 يومًا</option>
                        <option value={90}>90 يومًا</option>
                        <option value={data.course.validityDays}>
                          صلاحية الكورس ({data.course.validityDays} يومًا)
                        </option>
                      </select>
                      <button
                        type="submit"
                        disabled={busy || !addSubUserId}
                        className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        إضافة للكورس
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="ملاحظة إدارية (اختياري)"
                      value={addSubNote}
                      onChange={(e) => setAddSubNote(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    />
                  </form>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={subSearch}
                        onChange={(e) => setSubSearch(e.target.value)}
                        placeholder="ابحث في مشتركي الكورس بالاسم أو رقم الموبايل أو الصف..."
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      حظر الطالب هنا يمنعه من <strong className="text-[#0B162C]">هذا الكورس فقط</strong> دون التأثير على باقي كورساته.
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-right text-xs">
                      <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                        <tr>
                          <th className="p-3">الطالب</th>
                          <th className="p-3">المصدر</th>
                          <th className="p-3">الحالة والصلاحية</th>
                          <th className="p-3">تحكم</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(() => {
                          const q = subSearch.trim().toLowerCase();
                          const filteredSubs = q
                            ? data.subscribers.filter(
                                (s) =>
                                  s.fullName.toLowerCase().includes(q) ||
                                  s.phone.toLowerCase().includes(q) ||
                                  s.gradeNameAr.toLowerCase().includes(q),
                              )
                            : data.subscribers;

                          if (filteredSubs.length === 0) {
                            return (
                              <tr>
                                <td colSpan={4} className="p-6 text-center text-slate-500">
                                  {data.subscribers.length === 0
                                    ? 'لا يوجد طلاب مشتركون في هذا الكورس حاليًا.'
                                    : 'لا توجد نتائج مطابقة للبحث.'}
                                </td>
                              </tr>
                            );
                          }

                          return filteredSubs.map((sub) => (
                            <tr key={`${sub.entitlementId}-${sub.userId}`}>
                              <td className="p-3">
                                <div className="font-bold text-[#0B162C]">{sub.fullName}</div>
                                <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                                  {sub.phone} · {sub.gradeNameAr}
                                </div>
                              </td>
                              <td className="p-3">{SOURCE_AR[sub.source] || sub.source}</td>
                              <td className="p-3">
                                <div
                                  className={`font-bold ${
                                    sub.status === 'ACTIVE'
                                      ? 'text-emerald-700'
                                      : sub.status === 'BLOCKED'
                                        ? 'text-red-700'
                                        : sub.status === 'EXPIRED'
                                          ? 'text-amber-700'
                                          : 'text-slate-600'
                                  }`}
                                >
                                  {sub.status === 'ACTIVE'
                                    ? 'نشط'
                                    : sub.status === 'BLOCKED'
                                      ? 'محظور من هذا الكورس فقط'
                                      : sub.status === 'EXPIRED'
                                        ? 'منتهي'
                                        : 'مسحوب'}
                                </div>
                                {sub.isBlocked && sub.blockReason && (
                                  <div className="mt-0.5 text-[11px] text-red-600">
                                    السبب: {sub.blockReason}
                                  </div>
                                )}
                                <div className="text-[11px] text-slate-500">
                                  {sub.expiresAt ? `ينتهي ${formatDateAr(sub.expiresAt)}` : 'دائم'}
                                  {sub.remainingDays !== null && sub.status === 'ACTIVE'
                                    ? ` (${sub.remainingDays} يوم)`
                                    : ''}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {sub.isBlocked || sub.status === 'BLOCKED' ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void handleRestoreBlockedStudent(sub.userId)}
                                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      <span>إلغاء الحظر</span>
                                    </button>
                                  ) : sub.status === 'REVOKED' ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleSubscriberAction(sub.entitlementId, 'RESTORE')
                                      }
                                      className="rounded bg-emerald-600 px-2.5 py-1 font-bold text-white"
                                    >
                                      استعادة
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleSubscriberAction(sub.entitlementId, 'EXTEND_30')
                                        }
                                        className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-[#2563EB]"
                                      >
                                        +30 يومًا
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                          setBlockTarget({ userId: sub.userId, fullName: sub.fullName });
                                          setBlockReason('');
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-900 hover:bg-amber-100"
                                      >
                                        <Ban className="h-3 w-3" />
                                        <span>حظر من الكورس</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void handleSubscriberAction(sub.entitlementId, 'REVOKE', {
                                            fullName: sub.fullName,
                                            source: sub.source,
                                          })
                                        }
                                        className="rounded border border-red-200 bg-red-50 px-2 py-1 font-bold text-red-700"
                                      >
                                        سحب
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: LIFECYCLE, VISIBILITY, SAFE ARCHIVE & GUARDED PERMANENT DELETE, AUDIT LOG */}
              {tab === 'lifecycle' && (
                <div className="space-y-5">
                  {/* Visibility Controls */}
                  <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-5 space-y-3 text-xs">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-[#0B162C]">
                      <Eye className="h-4 w-4 text-[#2563EB]" />
                      <span>التحكم في ظهور الكورس للطلاب</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      يمكنك إخفاء الكورس مؤقتًا عن الطلاب أو إعادة إظهاره في أي وقت دون فقدان أي بيانات أو اشتراكات.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {data.course.publicationStatus !== 'PUBLISHED' && data.course.publicationStatus !== 'REMOVED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSetVisibility('PUBLISHED')}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
                        >
                          <Eye className="h-4 w-4" />
                          <span>إظهار ونشر الكورس</span>
                        </button>
                      )}
                      {data.course.publicationStatus !== 'HIDDEN' && data.course.publicationStatus !== 'REMOVED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSetVisibility('HIDDEN')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700 hover:bg-slate-100"
                        >
                          <EyeOff className="h-4 w-4 text-amber-600" />
                          <span>إخفاء الكورس عن الطلاب</span>
                        </button>
                      )}
                      {data.course.publicationStatus === 'ARCHIVED' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleArchiveToggle(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span>استعادة من الأرشيف</span>
                        </button>
                      ) : data.course.publicationStatus !== 'REMOVED' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleArchiveToggle(false)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-4 py-2 font-bold text-white hover:bg-[#1E293B]"
                        >
                          <Archive className="h-4 w-4" />
                          <span>أرشفة الكورس بأمان</span>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* SUPER_ADMIN-only Guarded Permanent Delete */}
                  <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 space-y-3 text-xs">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-red-800">
                      <ShieldAlert className="h-4 w-4" />
                      <span>حذف الكورس نهائيًا (مقتصر على المدير العام SUPER_ADMIN)</span>
                    </div>
                    <p className="leading-relaxed text-red-900">
                      يتطلب هذا الإجراء تحققًا أمنيًا متعدد الخطوات: تحليل الأثر، كلمة مرور المدير العام، كتابة اسم الكورس
                      للتأكيد، والتأكد من النسخة الاحتياطية. إذا كان للكورس سجلات مالية أو اشتراكات أو امتحانات تاريخية، يتم
                      إزالته نهائيًا من المنصة النشطة مع حفظ السجلات التاريخية دون تدميرها.
                    </p>
                    {isSuperAdmin ? (
                      data.course.publicationStatus === 'REMOVED' ? (
                        <div className="rounded-lg border border-red-300 bg-white p-3 font-bold text-red-800">
                          هذا الكورس مُزال بالفعل من المنصة النشطة ومحفوظ في السجل التاريخي فقط.
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          data-testid="open-permanent-course-delete-btn"
                          onClick={() => void handleOpenGuardedPermanentDelete()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>حذف الكورس نهائيًا (مع خطوات التحقق)</span>
                        </button>
                      )
                    ) : (
                      <div className="rounded-lg border border-red-200 bg-white p-3 font-semibold text-red-800">
                        هذا الإجراء الحساس متاح فقط لحساب المدير العام (SUPER_ADMIN). يمكنك استخدام الإخفاء أو الأرشفة أعلاه.
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-extrabold text-[#0B162C]">
                      سجل تغييرات الكورس ({data.auditLogs.length})
                    </h4>
                    <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                      {data.auditLogs.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">لا توجد أحداث مسجلة بعد.</p>
                      ) : (
                        data.auditLogs.map((a) => (
                          <div key={a.id} className="flex items-center justify-between p-3 text-xs">
                            <span>
                              <strong>{a.actorName}</strong> ·{' '}
                              <span className="font-mono-num text-[#2563EB]">{a.action}</span>
                            </span>
                            <span className="text-slate-500">{formatDateTimeAr(a.createdAt)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Per-Course Student Block Confirmation Modal */}
      {blockTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleBlockStudentFromCourse}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-2 text-amber-800">
              <Ban className="h-5 w-5" />
              <h4 className="text-base font-extrabold">حظر طالب من هذا الكورس فقط</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              سيتم منع الطالب <strong>{blockTarget.fullName}</strong> من الوصول إلى فيديوهات وواجبات وامتحانات هذا
              الكورس فقط، بينما تبقى جميع كورساته الأخرى وحسابه نشطين بشكل طبيعي.
            </p>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>سبب الحظر (اختياري)</span>
              <input
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="مثال: مخالفة شروط هذا الكورس أو لحين استكمال السداد"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBlockTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                تأكيد الحظر من هذا الكورس
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUPER_ADMIN Guarded Permanent Delete Modal */}
      {permDeleteOpen && data && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/70 p-4">
          <form
            onSubmit={handleGuardedPermanentDelete}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 text-red-700">
                <ShieldAlert className="h-5 w-5" />
                <h4 className="text-base font-extrabold">التحقق الأمني قبل حذف الكورس نهائيًا</h4>
              </div>
              <button type="button" onClick={() => setPermDeleteOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {loadingImpact ? (
              <div className="py-6 text-center text-xs text-slate-500">جارٍ تحليل السجلات المرتبطة بالكورس...</div>
            ) : deletionImpact ? (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-950">
                <div className="font-extrabold">
                  نتيجة تحليل الأثر ({deletionImpact.mode === 'PHYSICAL_DELETE' ? 'حذف فعلي كامل' : 'إزالة من المنصة النشطة مع حفظ التاريخ'}):
                </div>
                <p className="leading-relaxed">{deletionImpact.explanationAr}</p>
                <div className="grid grid-cols-2 gap-2 pt-1 font-mono-num text-[11px]">
                  <div>المشتركون النشطون: {deletionImpact.counts.activeSubscribers}</div>
                  <div>سجلات الصلاحيات: {deletionImpact.counts.entitlements}</div>
                  <div>طلبات الدفع: {deletionImpact.counts.orders}</div>
                  <div>الامتحانات المرتبطة: {deletionImpact.counts.linkedExams}</div>
                  <div>الواجبات المرتبطة: {deletionImpact.counts.linkedHomework}</div>
                  <div>الفيديوهات المرتبطة: {deletionImpact.counts.linkedVideos}</div>
                </div>
              </div>
            ) : null}

            <label className="block space-y-1 text-xs font-bold text-slate-700">
              <span>1) كلمة مرور المدير العام الحالية للتأكيد</span>
              <input
                type="password"
                required
                value={permPassword}
                onChange={(e) => setPermPassword(e.target.value)}
                placeholder="أدخل كلمة مرورك الحالية"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>

            <label className="block space-y-1 text-xs font-bold text-slate-700">
              <span>
                2) اكتب اسم الكورس بالضبط للتأكيد:{' '}
                <strong className="text-red-700">{data.course.titleAr}</strong>
              </span>
              <input
                type="text"
                required
                value={permTitleConfirm}
                onChange={(e) => setPermTitleConfirm(e.target.value)}
                placeholder={data.course.titleAr}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>

            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>سبب الإجراء (اختياري - يُسجل في سجل التدقيق)</span>
              <input
                type="text"
                value={permReason}
                onChange={(e) => setPermReason(e.target.value)}
                placeholder="مثال: كورس مكرر أو انتهى العمل به"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal"
              />
            </label>

            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
              <input
                type="checkbox"
                checked={permBackupConfirmed}
                onChange={(e) => setPermBackupConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>3) أؤكد مراجعة النسخة الاحتياطية وفهم أثر حذف/إزالة هذا الكورس بالكامل.</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPermDeleteOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                تراجع
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  !permBackupConfirmed ||
                  !permPassword.trim() ||
                  permTitleConfirm.trim() !== data.course.titleAr.trim()
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'جارٍ التنفيذ...' : 'تنفيذ الحذف النهائي'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Paid subscriber revoke confirm */}
      {confirmPaidRevoke && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="text-base font-extrabold">تأكيد سحب صلاحية اشتراك مدفوع</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              اشتراك الطالب <strong>{confirmPaidRevoke.fullName}</strong> مصدره{' '}
              <strong>{SOURCE_AR[confirmPaidRevoke.source] || confirmPaidRevoke.source}</strong> وليس منحة يدوية. هل
              تؤكد رغبتك في سحب الصلاحية؟
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmPaidRevoke(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void handleSubscriberAction(
                    confirmPaidRevoke.entitlementId,
                    'REVOKE',
                    confirmPaidRevoke,
                    true,
                  )
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white"
              >
                تأكيد السحب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
