import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Atom,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  Film,
  Loader2,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../../lib/api.ts';
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

interface TrackOption {
  id: number;
  nameAr: string;
}

interface GradeOption {
  id: number;
  trackId: number;
  nameAr: string;
}

interface GroupOption {
  id: number;
  nameAr: string;
}

interface AdminAnnouncementRow {
  id: number;
  titleAr: string;
  bodyAr: string;
  mediaType: 'NONE' | 'IMAGE' | 'GIF' | 'VIDEO_UPLOAD' | 'EXTERNAL_VIDEO';
  storageKey: string | null;
  mediaFileName: string | null;
  mediaMimeType: string | null;
  mediaUrl: string | null;
  externalVideoUrl: string | null;
  ctaLabelAr: string;
  ctaTargetType:
    | 'NONE'
    | 'VIDEO'
    | 'COURSE'
    | 'HOMEWORK'
    | 'EXAM'
    | 'PDF'
    | 'SCHEDULE'
    | 'CURRICULUM'
    | 'BILLING'
    | 'EXTERNAL_URL';
  ctaTargetId: number | null;
  ctaExternalUrl: string | null;
  targetScope: 'ALL' | 'TRACK' | 'GRADE' | 'GROUP';
  targetTrackId: number | null;
  targetTrackNameAr: string | null;
  targetGradeId: number | null;
  targetGradeNameAr: string | null;
  targetGroupId: number | null;
  targetGroupNameAr: string | null;
  priority: number;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

interface AdminAnnouncementsManagerProps {
  tracks: TrackOption[];
  grades: GradeOption[];
  groups: GroupOption[];
  initialAction?: 'NONE' | 'CREATE';
  navigationNonce?: number;
}

type AnnTabFilter = 'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';

function isScheduledRow(item: AdminAnnouncementRow): boolean {
  if (item.status !== 'PUBLISHED' || !item.startsAt) return false;
  return new Date(item.startsAt).getTime() > Date.now();
}

function getAnnouncementStatusMeta(item: AdminAnnouncementRow): { label: string; tone: AdminTone } {
  if (isScheduledRow(item)) return { label: 'مجدول', tone: 'purple' };
  if (item.status === 'PUBLISHED') return { label: 'منشور', tone: 'emerald' };
  if (item.status === 'PAUSED') return { label: 'متوقف', tone: 'amber' };
  if (item.status === 'ARCHIVED') return { label: 'مؤرشف', tone: 'slate' };
  return { label: 'مسودة', tone: 'slate' };
}

function formatAudience(item: AdminAnnouncementRow): { label: string; tone: AdminTone } {
  if (item.targetScope === 'ALL') return { label: 'جميع الطلاب', tone: 'slate' };
  if (item.targetScope === 'TRACK') {
    return { label: item.targetTrackNameAr || `مسار #${item.targetTrackId}`, tone: 'blue' };
  }
  if (item.targetScope === 'GRADE') {
    return { label: item.targetGradeNameAr || `صف #${item.targetGradeId}`, tone: 'purple' };
  }
  return { label: item.targetGroupNameAr || `مجموعة #${item.targetGroupId}`, tone: 'amber' };
}

function formatMediaSubtitle(item: AdminAnnouncementRow): string {
  const parts: string[] = [];
  if (item.mediaType === 'IMAGE' || item.mediaType === 'GIF') parts.push('صورة');
  else if (item.mediaType === 'VIDEO_UPLOAD' || item.mediaType === 'EXTERNAL_VIDEO') parts.push('فيديو');
  parts.push('نص');
  if (item.ctaTargetType !== 'NONE') parts.push('رابط');
  return parts.join(' + ');
}

export const AdminAnnouncementsManager: React.FC<AdminAnnouncementsManagerProps> = ({
  tracks,
  grades,
  groups,
  initialAction,
  navigationNonce,
}) => {
  const [items, setItems] = useState<AdminAnnouncementRow[]>([]);
  const [fetchedGroups, setFetchedGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters & Master-Detail Selection
  const [statusTab, setStatusTab] = useState<AnnTabFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create / Edit Form
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [mediaType, setMediaType] = useState<AdminAnnouncementRow['mediaType']>('NONE');
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [externalVideoUrl, setExternalVideoUrl] = useState('');
  const [ctaLabelAr, setCtaLabelAr] = useState('');
  const [ctaTargetType, setCtaTargetType] =
    useState<AdminAnnouncementRow['ctaTargetType']>('NONE');
  const [ctaTargetId, setCtaTargetId] = useState('');
  const [ctaExternalUrl, setCtaExternalUrl] = useState('');
  const [targetScope, setTargetScope] = useState<AdminAnnouncementRow['targetScope']>('ALL');
  const [targetTrackId, setTargetTrackId] = useState<string>('');
  const [targetGradeId, setTargetGradeId] = useState<string>('');
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [priority, setPriority] = useState<number>(10);
  const [status, setStatus] = useState<AdminAnnouncementRow['status']>('PUBLISHED');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        announcements: AdminAnnouncementRow[];
        groups?: GroupOption[];
      }>('/api/admin/announcements');
      setItems(res.announcements || []);
      if (Array.isArray(res.groups)) {
        setFetchedGroups(res.groups);
      }
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  const availableGroups = groups.length > 0 ? groups : fetchedGroups;

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setTitleAr('');
    setBodyAr('');
    setMediaType('NONE');
    setStorageKey(null);
    setMediaFileName(null);
    setMediaMimeType(null);
    setMediaPreviewUrl(null);
    setExternalVideoUrl('');
    setCtaLabelAr('');
    setCtaTargetType('NONE');
    setCtaTargetId('');
    setCtaExternalUrl('');
    setTargetScope('ALL');
    setTargetTrackId('');
    setTargetGradeId('');
    setTargetGroupId('');
    setPriority(10);
    setStatus('PUBLISHED');
    setStartsAt('');
    setEndsAt('');
  }, []);

  useEffect(() => {
    if (initialAction === 'CREATE') {
      resetForm();
      setShowForm(true);
    }
  }, [initialAction, navigationNonce, resetForm]);

  const openEdit = (row: AdminAnnouncementRow) => {
    setEditingId(row.id);
    setTitleAr(row.titleAr);
    setBodyAr(row.bodyAr || '');
    setMediaType(row.mediaType);
    setStorageKey(row.storageKey);
    setMediaFileName(row.mediaFileName);
    setMediaMimeType(row.mediaMimeType);
    setMediaPreviewUrl(row.mediaUrl);
    setExternalVideoUrl(row.externalVideoUrl || '');
    setCtaLabelAr(row.ctaLabelAr || '');
    setCtaTargetType(row.ctaTargetType);
    setCtaTargetId(row.ctaTargetId ? String(row.ctaTargetId) : '');
    setCtaExternalUrl(row.ctaExternalUrl || '');
    setTargetScope(row.targetScope);
    setTargetTrackId(row.targetTrackId ? String(row.targetTrackId) : '');
    setTargetGradeId(row.targetGradeId ? String(row.targetGradeId) : '');
    setTargetGroupId(row.targetGroupId ? String(row.targetGroupId) : '');
    setPriority(row.priority);
    setStatus(row.status);
    setStartsAt(row.startsAt ? row.startsAt.slice(0, 16) : '');
    setEndsAt(row.endsAt ? row.endsAt.slice(0, 16) : '');
    setShowForm(true);
  };

  const handleMediaFileUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('تعذر قراءة الملف المختار'));
        reader.readAsDataURL(file);
      });
      const res = await apiRequest<{
        storageKey: string;
        fileName: string;
        mimeType: string;
        mediaType: 'IMAGE' | 'GIF' | 'VIDEO_UPLOAD';
        previewUrl: string;
      }>('/api/admin/announcements/upload-media', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, dataBase64 }),
      });
      setStorageKey(res.storageKey);
      setMediaFileName(res.fileName);
      setMediaMimeType(res.mimeType);
      setMediaType(res.mediaType);
      setMediaPreviewUrl(res.previewUrl);
      setNotice({ type: 'success', text: 'تم رفع ملف الوسائط بنجاح' });
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        titleAr: titleAr.trim(),
        bodyAr: bodyAr.trim(),
        mediaType,
        storageKey:
          mediaType === 'IMAGE' || mediaType === 'GIF' || mediaType === 'VIDEO_UPLOAD'
            ? storageKey
            : null,
        mediaFileName,
        mediaMimeType,
        externalVideoUrl: mediaType === 'EXTERNAL_VIDEO' ? externalVideoUrl.trim() : null,
        ctaLabelAr: ctaLabelAr.trim(),
        ctaTargetType,
        ctaTargetId:
          ctaTargetType !== 'NONE' && ctaTargetType !== 'EXTERNAL_URL' && ctaTargetId
            ? Number(ctaTargetId)
            : null,
        ctaExternalUrl: ctaTargetType === 'EXTERNAL_URL' ? ctaExternalUrl.trim() : null,
        targetScope,
        targetTrackId: targetScope === 'TRACK' && targetTrackId ? Number(targetTrackId) : null,
        targetGradeId: targetScope === 'GRADE' && targetGradeId ? Number(targetGradeId) : null,
        targetGroupId: targetScope === 'GROUP' && targetGroupId ? Number(targetGroupId) : null,
        priority,
        status,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (editingId) {
        const res = await apiRequest<{ message: string }>(`/api/admin/announcements/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice({ type: 'success', text: res.message });
      } else {
        const res = await apiRequest<{ message: string }>('/api/admin/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice({ type: 'success', text: res.message });
      }
      resetForm();
      setShowForm(false);
      await loadAnnouncements();
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (id: number, nextStatus: AdminAnnouncementRow['status']) => {
    try {
      await apiRequest(`/api/admin/announcements/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadAnnouncements();
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: 'تم حذف الإعلان بنجاح' });
      await loadAnnouncements();
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    }
  };

  // Real KPI stats
  const stats = useMemo(() => {
    let published = 0;
    let scheduled = 0;
    let draft = 0;
    let paused = 0;
    let archived = 0;
    for (const item of items) {
      if (isScheduledRow(item)) scheduled += 1;
      else if (item.status === 'PUBLISHED') published += 1;
      else if (item.status === 'DRAFT') draft += 1;
      else if (item.status === 'PAUSED') paused += 1;
      else if (item.status === 'ARCHIVED') archived += 1;
    }
    return { total: items.length, published, scheduled, draft, paused, archived };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusTab === 'SCHEDULED' && !isScheduledRow(item)) return false;
      if (statusTab === 'PUBLISHED' && (item.status !== 'PUBLISHED' || isScheduledRow(item))) return false;
      if (statusTab === 'DRAFT' && item.status !== 'DRAFT') return false;
      if (statusTab === 'PAUSED' && item.status !== 'PAUSED') return false;
      if (statusTab === 'ARCHIVED' && item.status !== 'ARCHIVED') return false;
      if (scopeFilter !== 'ALL' && item.targetScope !== scopeFilter) return false;
      if (q) {
        const hay = `${item.titleAr} ${item.bodyAr || ''} ${item.targetGradeNameAr || ''} ${item.targetGroupNameAr || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusTab, scopeFilter, search]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(
    () => filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredItems, safePage],
  );

  const selectedItem = useMemo(() => {
    if (selectedId != null) {
      return filteredItems.find((i) => i.id === selectedId) || items.find((i) => i.id === selectedId) || null;
    }
    return filteredItems[0] || items[0] || null;
  }, [selectedId, filteredItems, items]);

  const hasFilters = Boolean(search.trim() || scopeFilter !== 'ALL' || statusTab !== 'ALL');

  return (
    <div className="space-y-5" dir="rtl" data-testid="admin-announcements-manager">
      <AdminPageHeader
        title="إدارة الإعلانات"
        subtitle="إنشاء إعلانات نصية ومرئية وجدولتها واستهداف الصفوف والمجموعات."
        icon={<Megaphone className="h-5 w-5" />}
        actions={
          <button
            type="button"
            data-testid="new-announcement-btn"
            onClick={() => {
              resetForm();
              setShowForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            <span>{showForm ? 'إغلاق النموذج' : 'إعلان جديد'}</span>
          </button>
        }
      />

      {notice && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-xs font-bold ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 4 Real KPI Cards */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الإعلانات"
          value={stats.total}
          subtitle="كل الإعلانات"
          tone="blue"
          icon={<Megaphone className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="منشورة"
          value={stats.published}
          subtitle="تظهر للطلاب المستهدفين"
          tone="emerald"
          icon={<CheckCircle2 className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('PUBLISHED');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="مجدولة"
          value={stats.scheduled}
          subtitle="حسب تاريخ النشر"
          tone="purple"
          icon={<Calendar className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('SCHEDULED');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="مسودات"
          value={stats.draft}
          subtitle="لم تُنشر بعد"
          tone="amber"
          icon={<FileText className="h-5 w-5" />}
          onClick={() => {
            setStatusTab('DRAFT');
            setPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Collapsible Create / Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="grid gap-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm lg:grid-cols-12"
        >
          <div className="space-y-4 lg:col-span-8">
            <h3 className="text-sm font-extrabold text-[#0F172A]">
              {editingId ? 'تعديل الإعلان' : 'إنشاء إعلان جديد للطلاب'}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">عنوان الإعلان *</label>
                <input
                  type="text"
                  required
                  value={titleAr}
                  onChange={(e) => setTitleAr(e.target.value)}
                  placeholder="مثال: مراجعة ليلة الامتحان — الفصل الأول"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">نص الإعلان</label>
                <textarea
                  rows={3}
                  value={bodyAr}
                  onChange={(e) => setBodyAr(e.target.value)}
                  placeholder="تفاصيل موجزة وواضحة للطلاب..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">نوع الوسائط</label>
                <select
                  value={mediaType}
                  onChange={(e) =>
                    setMediaType(e.target.value as AdminAnnouncementRow['mediaType'])
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="NONE">بدون وسائط (نص فقط)</option>
                  <option value="IMAGE">صورة مرفوعة (JPG / PNG / WEBP)</option>
                  <option value="GIF">صورة متحركة (GIF)</option>
                  <option value="VIDEO_UPLOAD">فيديو قصير مرفوع (MP4 / WEBM)</option>
                  <option value="EXTERNAL_VIDEO">رابط فيديو خارجي آمن (https://)</option>
                </select>
              </div>

              {(mediaType === 'IMAGE' || mediaType === 'GIF' || mediaType === 'VIDEO_UPLOAD') && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">رفع الملف</label>
                  <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-400 bg-blue-50/60 px-3 py-2 text-xs font-bold text-[#2563EB] hover:bg-blue-50">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span className="truncate">{mediaFileName || 'اختر ملفًا للرفع'}</span>
                    <input
                      type="file"
                      accept={
                        mediaType === 'VIDEO_UPLOAD'
                          ? 'video/mp4,video/webm'
                          : mediaType === 'GIF'
                            ? 'image/gif'
                            : 'image/jpeg,image/png,image/webp,image/gif'
                      }
                      className="hidden"
                      onChange={(e) => {
                        void handleMediaFileUpload(e.target.files?.[0] || null);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}

              {mediaType === 'EXTERNAL_VIDEO' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    رابط الفيديو الخارجي (https://)
                  </label>
                  <input
                    type="url"
                    value={externalVideoUrl}
                    onChange={(e) => setExternalVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">نطاق الاستهداف</label>
                <select
                  value={targetScope}
                  onChange={(e) =>
                    setTargetScope(e.target.value as AdminAnnouncementRow['targetScope'])
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="ALL">جميع الطلاب</option>
                  <option value="TRACK">مسار دراسي محدد</option>
                  <option value="GRADE">صف دراسي محدد</option>
                  <option value="GROUP">مجموعة محددة</option>
                </select>
              </div>

              {targetScope === 'TRACK' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">المسار المستهدف</label>
                  <select
                    value={targetTrackId}
                    onChange={(e) => setTargetTrackId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">اختر المسار</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetScope === 'GRADE' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">الصف المستهدف</label>
                  <select
                    value={targetGradeId}
                    onChange={(e) => setTargetGradeId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">اختر الصف</option>
                    {grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetScope === 'GROUP' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">المجموعة المستهدفة</label>
                  <select
                    value={targetGroupId}
                    onChange={(e) => setTargetGroupId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">اختر المجموعة</option>
                    {availableGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  وجهة زر الإجراء (CTA)
                </label>
                <select
                  value={ctaTargetType}
                  onChange={(e) =>
                    setCtaTargetType(e.target.value as AdminAnnouncementRow['ctaTargetType'])
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="NONE">بدون زر</option>
                  <option value="CURRICULUM">خطة المنهج</option>
                  <option value="VIDEO">محاضرة فيديو</option>
                  <option value="COURSE">كورس</option>
                  <option value="HOMEWORK">واجب</option>
                  <option value="EXAM">امتحان</option>
                  <option value="PDF">المذكرات والملخصات</option>
                  <option value="SCHEDULE">الجدول والمواعيد</option>
                  <option value="BILLING">الاشتراكات والأكواد</option>
                  <option value="EXTERNAL_URL">رابط خارجي آمن</option>
                </select>
              </div>

              {ctaTargetType !== 'NONE' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">نص الزر</label>
                  <input
                    type="text"
                    value={ctaLabelAr}
                    onChange={(e) => setCtaLabelAr(e.target.value)}
                    placeholder="مثال: افتح التفاصيل الآن"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              )}

              {ctaTargetType === 'EXTERNAL_URL' && (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    الرابط الخارجي (https://)
                  </label>
                  <input
                    type="url"
                    value={ctaExternalUrl}
                    onChange={(e) => setCtaExternalUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              )}

              {['VIDEO', 'COURSE', 'HOMEWORK', 'EXAM'].includes(ctaTargetType) && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    رقم العنصر (ID — اختياري)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={ctaTargetId}
                    onChange={(e) => setCtaTargetId(e.target.value)}
                    placeholder="اتركه فارغًا لفتح القسم"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">الحالة</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as AdminAnnouncementRow['status'])}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="PUBLISHED">منشور الآن</option>
                  <option value="DRAFT">مسودة</option>
                  <option value="PAUSED">متوقف مؤقتًا</option>
                  <option value="ARCHIVED">مؤرشف</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">الأولوية</label>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  بداية الظهور (اختياري)
                </label>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  نهاية الظهور (اختياري)
                </label>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving || uploading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{editingId ? 'حفظ التعديلات' : 'نشر وحفظ الإعلان'}</span>
              </button>
            </div>
          </div>

          {/* Live Student Card Preview inside Form */}
          <div className="space-y-2 lg:col-span-4">
            <div className="text-xs font-extrabold text-slate-600">معاينة الإعلان كما يظهر للطالب</div>
            <div className="space-y-3 rounded-2xl border border-blue-500/25 bg-[#0D172B] p-4 text-white shadow-lg">
              <div className="flex items-center justify-between text-[11px] font-bold text-blue-300">
                <span className="inline-flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" />
                  <span>إعلانات الأستاذ</span>
                </span>
                <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px]">معاينة حية</span>
              </div>
              {mediaPreviewUrl && (mediaType === 'IMAGE' || mediaType === 'GIF') && (
                <img
                  src={mediaPreviewUrl}
                  alt="معاينة الإعلان"
                  className="max-h-44 w-full rounded-xl border border-white/10 object-cover"
                />
              )}
              {mediaPreviewUrl && mediaType === 'VIDEO_UPLOAD' && (
                <video
                  src={mediaPreviewUrl}
                  controls
                  muted
                  preload="metadata"
                  className="max-h-44 w-full rounded-xl border border-white/10 bg-black"
                />
              )}
              <div className="text-sm font-extrabold leading-snug">
                {titleAr || 'عنوان الإعلان سيظهر هنا'}
              </div>
              {bodyAr && (
                <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">{bodyAr}</p>
              )}
              {ctaTargetType !== 'NONE' && (
                <div className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-extrabold text-white">
                  <span>{ctaLabelAr || 'عرض التفاصيل'}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {/* Segmented Status Tabs */}
      <AdminSegmentedTabs
        activeId={statusTab}
        onChange={(id) => {
          setStatusTab(id);
          setPage(1);
        }}
        items={[
          { id: 'ALL', label: 'كل الإعلانات', count: stats.total },
          { id: 'PUBLISHED', label: 'منشورة', count: stats.published },
          { id: 'SCHEDULED', label: 'مجدولة', count: stats.scheduled },
          { id: 'DRAFT', label: 'مسودات', count: stats.draft },
          { id: 'PAUSED', label: 'متوقفة', count: stats.paused },
          { id: 'ARCHIVED', label: 'الأرشيف', count: stats.archived },
        ]}
      />

      {/* Filter Bar */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="ابحث بعنوان الإعلان أو محتواه..."
        hasActiveFilters={hasFilters}
        onReset={() => {
          setSearch('');
          setScopeFilter('ALL');
          setStatusTab('ALL');
          setPage(1);
        }}
      >
        <select
          value={scopeFilter}
          onChange={(e) => {
            setScopeFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
        >
          <option value="ALL">كل الفئات</option>
          <option value="ALL_ONLY" disabled hidden />
          <option value="TRACK">مسار محدد</option>
          <option value="GRADE">صف محدد</option>
          <option value="GROUP">مجموعة محددة</option>
        </select>
      </AdminFilterBar>

      {/* Master-Detail: Announcements Table (8 cols) + Sticky Student Preview Card (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-extrabold text-[#0F172A]">قائمة الإعلانات</h3>
              <span className="font-mono-num text-xs font-semibold text-slate-500">
                {filteredItems.length} إعلان
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-xs text-slate-500">
                <Loader2 className="ml-2 h-4 w-4 animate-spin text-[#2563EB]" />
                <span>جارٍ تحميل الإعلانات...</span>
              </div>
            ) : paginatedItems.length === 0 ? (
              <div className="p-6">
                <AdminEmptyState
                  icon={<Megaphone className="h-5 w-5" />}
                  title="لا توجد إعلانات مطابقة"
                  description="اضغط «إعلان جديد» لإنشاء إعلان موجه للطلاب في لوحتهم الرئيسية."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">الإعلان</th>
                      <th className="px-4 py-3">الجمهور</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">تاريخ النشر</th>
                      <th className="px-4 py-3">الأولوية</th>
                      <th className="px-4 py-3 text-left">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedItems.map((item) => {
                      const stMeta = getAnnouncementStatusMeta(item);
                      const aud = formatAudience(item);
                      const isSelected = selectedItem?.id === item.id;
                      const menuItems: AdminActionMenuItem[] = [
                        {
                          id: 'edit',
                          label: 'تعديل الإعلان',
                          icon: <Edit3 className="h-3.5 w-3.5" />,
                          onClick: () => openEdit(item),
                        },
                        item.status !== 'PUBLISHED'
                          ? {
                              id: 'publish',
                              label: 'نشر الإعلان',
                              icon: <PlayCircle className="h-3.5 w-3.5" />,
                              tone: 'success',
                              onClick: () => void handleQuickStatus(item.id, 'PUBLISHED'),
                            }
                          : {
                              id: 'pause',
                              label: 'إيقاف مؤقت',
                              icon: <PauseCircle className="h-3.5 w-3.5" />,
                              onClick: () => void handleQuickStatus(item.id, 'PAUSED'),
                            },
                      ];
                      if (item.status !== 'ARCHIVED') {
                        menuItems.push({
                          id: 'archive',
                          label: 'أرشفة الإعلان',
                          icon: <Archive className="h-3.5 w-3.5" />,
                          onClick: () => void handleQuickStatus(item.id, 'ARCHIVED'),
                        });
                      }
                      menuItems.push({
                        id: 'delete',
                        label: 'حذف نهائي',
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        tone: 'danger',
                        onClick: () => void handleDelete(item.id),
                      });

                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="px-4 py-3.5 max-w-[230px]">
                            <div className="font-extrabold text-[#0F172A] line-clamp-1">
                              {item.titleAr}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              {formatMediaSubtitle(item)}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <AdminStatusBadge tone={aud.tone}>{aud.label}</AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3.5">
                            <AdminStatusBadge tone={stMeta.tone}>{stMeta.label}</AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                            {item.startsAt
                              ? formatDateAr(item.startsAt)
                              : item.status === 'DRAFT'
                                ? '—'
                                : formatDateAr(item.createdAt)}
                          </td>
                          <td className="px-4 py-3.5 font-mono-num font-bold text-[#0F172A]">
                            {item.priority}
                          </td>
                          <td className="px-4 py-3.5 text-left">
                            <div
                              className="inline-flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.status === 'PUBLISHED' ? (
                                <button
                                  type="button"
                                  onClick={() => void handleQuickStatus(item.id, 'PAUSED')}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  إيقاف مؤقت
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openEdit(item)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  <span>تعديل</span>
                                </button>
                              )}
                              <AdminActionMenu items={menuItems} ariaLabel={`إجراءات ${item.titleAr}`} />
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
                  <strong className="font-mono-num text-[#0F172A]">{filteredItems.length}</strong> إعلان
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
          selectedItem ? (
            <AdminCard className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  معاينة الإعلان كما يظهر للطالب
                </h3>
              </div>

              {/* Visual Banner / Uploaded Media */}
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-[#0D172B] via-[#132952] to-[#1D4ED8]">
                {selectedItem.mediaUrl &&
                (selectedItem.mediaType === 'IMAGE' || selectedItem.mediaType === 'GIF') ? (
                  <img
                    src={selectedItem.mediaUrl}
                    alt={selectedItem.titleAr}
                    loading="lazy"
                    className="h-40 w-full object-cover"
                  />
                ) : selectedItem.mediaUrl && selectedItem.mediaType === 'VIDEO_UPLOAD' ? (
                  <video
                    src={selectedItem.mediaUrl}
                    controls
                    muted
                    preload="metadata"
                    className="h-40 w-full bg-black object-cover"
                  />
                ) : selectedItem.mediaType === 'EXTERNAL_VIDEO' ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-blue-200">
                    <Film className="h-9 w-9" />
                    <span className="text-[11px] font-bold">إعلان بفيديو خارجي</span>
                  </div>
                ) : (
                  <div className="flex h-36 items-center justify-center text-sky-300/85">
                    <Atom className="h-14 w-14 stroke-[1.5]" />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <h4 className="text-sm font-extrabold text-[#0F172A]">{selectedItem.titleAr}</h4>
                <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-line">
                  {selectedItem.bodyAr || 'لا يوجد وصف إضافي لهذا الإعلان.'}
                </p>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500">الجمهور</span>
                  <span className="font-bold text-[#0F172A]">
                    {formatAudience(selectedItem).label}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500">الحالة</span>
                  <AdminStatusBadge tone={getAnnouncementStatusMeta(selectedItem).tone}>
                    {getAnnouncementStatusMeta(selectedItem).label}
                  </AdminStatusBadge>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500">الأولوية</span>
                  <span className="font-mono-num font-extrabold text-[#0F172A]">
                    {selectedItem.priority}
                  </span>
                </div>
                {selectedItem.startsAt && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500">يبدأ في</span>
                    <span className="font-medium text-slate-700">
                      {formatDateTimeAr(selectedItem.startsAt)}
                    </span>
                  </div>
                )}
                {selectedItem.endsAt && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500">ينتهي في</span>
                    <span className="font-medium text-slate-700">
                      {formatDateTimeAr(selectedItem.endsAt)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openEdit(selectedItem)}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>تعديل الإعلان</span>
                </button>
                {selectedItem.status !== 'PUBLISHED' ? (
                  <button
                    type="button"
                    onClick={() => void handleQuickStatus(selectedItem.id, 'PUBLISHED')}
                    className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    <span>نشر</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleQuickStatus(selectedItem.id, 'PAUSED')}
                    className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    <span>إيقاف</span>
                  </button>
                )}
              </div>
            </AdminCard>
          ) : (
            <AdminCard>
              <AdminEmptyState
                icon={<Megaphone className="h-5 w-5" />}
                title="معاينة الإعلان"
                description="اختر أي إعلان من الجدول لمعاينة شكله كما يظهر للطالب."
              />
            </AdminCard>
          )
        }
      />
    </div>
  );
};
