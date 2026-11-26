import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr } from '../../lib/api.ts';
import { hasPermission, PERMISSIONS } from '../../lib/permissions.ts';
import type { AuthUser } from '../../types/lms.ts';
import type { AdminCatalogData, AdminVideoRecord } from './AdminContentPanel.tsx';
import { AdminStatusBadge, type AdminTone } from './AdminUiPrimitives.tsx';

export type VideoAccessModalTab = 'codes' | 'subscriptions';

interface VideoAccessEntitlement {
  id: number;
  userId: number;
  source: string;
  startsAt: string;
  expiresAt: string | null;
  isRevoked: boolean;
  revokedAt: string | null;
  note: string | null;
  createdAt: string;
  studentName: string;
  studentPhone: string | null;
  gradeNameAr: string;
  isActive: boolean;
  isExpired: boolean;
}

interface VideoAccessCodeItem {
  id: number;
  codePrefix: string;
  durationDays: number;
  maxUses: number;
  usedCount: number;
  status: string;
  batchLabel: string;
  expiresAt: string | null;
  createdAt: string;
  canDelete: boolean;
}

interface VideoAccessStudentOption {
  id: number;
  fullName: string;
  phone: string | null;
  gradeId: number | null;
  gradeNameAr: string;
}

interface VideoAccessResponse {
  video: {
    id: number;
    titleAr: string;
    gradeId: number;
    courseId: number | null;
    videoType: 'FREE' | 'PAID' | 'COURSE' | string;
    priceEgp: number;
    publicationStatus: string;
    isPublished: boolean;
  };
  entitlements: VideoAccessEntitlement[];
  codes: VideoAccessCodeItem[];
  students: VideoAccessStudentOption[];
}

interface AdminVideoAccessCodesModalProps {
  video: AdminVideoRecord | null;
  initialTab: VideoAccessModalTab;
  catalog: AdminCatalogData;
  currentUser?: AuthUser;
  onClose: () => void;
  onReload: () => Promise<void>;
  onToast: (msg: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL_GRANT: 'فتح يدوي من المدرس',
  ACTIVATION_CODE: 'كود تفعيل',
  PURCHASE: 'شراء مباشر',
  SUBSCRIPTION: 'اشتراك باقة',
};

const CODE_STATUS_META: Record<string, { label: string; tone: AdminTone }> = {
  AVAILABLE: { label: 'متاح', tone: 'emerald' },
  REDEEMED: { label: 'مُستخدم', tone: 'blue' },
  DISABLED: { label: 'معطّل', tone: 'amber' },
  REVOKED: { label: 'ملغي', tone: 'rose' },
  CANCELLED: { label: 'ملغي', tone: 'rose' },
  EXPIRED: { label: 'منتهي', tone: 'slate' },
};

export const AdminVideoAccessCodesModal: React.FC<AdminVideoAccessCodesModalProps> = ({
  video,
  initialTab,
  catalog,
  currentUser,
  onClose,
  onReload,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<VideoAccessModalTab>(initialTab);
  const [data, setData] = useState<VideoAccessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Permissions
  const canManageCodes = currentUser
    ? hasPermission(currentUser, PERMISSIONS.CODES_MANAGE)
    : true;
  const canManageContent = currentUser
    ? hasPermission(currentUser, PERMISSIONS.CONTENT_MANAGE)
    : true;
  const canGrantAccess = currentUser
    ? hasPermission(currentUser, PERMISSIONS.STUDENT_ACCESS_GRANT)
    : true;
  const canRevokeAccess = currentUser
    ? hasPermission(currentUser, PERMISSIONS.STUDENT_ACCESS_REVOKE)
    : true;

  // Code generation form state
  const [quantity, setQuantity] = useState(5);
  const [durationDays, setDurationDays] = useState(30);
  const [maxUses, setMaxUses] = useState(1);
  const [prefix, setPrefix] = useState('VID');
  const [batchLabel, setBatchLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [codeActionBusyId, setCodeActionBusyId] = useState<number | null>(null);

  // Subscription / lock mode state
  const [accessMode, setAccessMode] = useState<'FREE' | 'PAID' | 'COURSE'>('PAID');
  const [priceEgp, setPriceEgp] = useState(90);
  const [courseId, setCourseId] = useState<number | ''>('');
  const [savingAccessMode, setSavingAccessMode] = useState(false);

  // Direct student grant state
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | ''>('');
  const [grantDurationDays, setGrantDurationDays] = useState(30);
  const [grantNote, setGrantNote] = useState('');
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const loadAccessHub = useCallback(async () => {
    if (!video) return;
    setLoading(true);
    setError('');
    try {
      const resp = await apiRequest<VideoAccessResponse>(`/api/admin/videos/${video.id}/access`);
      setData(resp);
      setAccessMode((resp.video.videoType as 'FREE' | 'PAID' | 'COURSE') || 'FREE');
      setPriceEgp(resp.video.priceEgp || 90);
      setCourseId(resp.video.courseId || '');
    } catch (err) {
      setError((err as Error).message || 'تعذر تحميل بيانات اشتراكات وأكواد الفيديو');
    } finally {
      setLoading(false);
    }
  }, [video]);

  useEffect(() => {
    if (!video) return;
    setActiveTab(initialTab);
    setGeneratedCodes([]);
    setCopiedAll(false);
    setBatchLabel(`أكواد: ${video.titleAr}`.slice(0, 80));
    setStudentSearch('');
    setSelectedStudentId('');
    setGrantNote('');
    void loadAccessHub();
  }, [video, initialTab, loadAccessHub]);

  const gradeCourses = useMemo(() => {
    if (!video) return catalog.courses;
    return catalog.courses.filter((c) => c.gradeId === video.gradeId);
  }, [catalog.courses, video]);

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    const q = studentSearch.trim().toLowerCase();
    if (!q) return data.students;
    return data.students.filter((s) =>
      `${s.fullName} ${s.phone || ''} ${s.gradeNameAr}`.toLowerCase().includes(q),
    );
  }, [data, studentSearch]);

  if (!video) return null;

  const effectiveVideoType = data?.video.videoType || video.videoType;

  const handleSaveAccessMode = async (
    overrideType?: 'FREE' | 'PAID' | 'COURSE',
    overridePrice?: number,
  ) => {
    const targetType = overrideType ?? accessMode;
    const targetPrice = overridePrice ?? priceEgp;
    if (targetType === 'COURSE' && gradeCourses.length > 0 && !courseId) {
      onToast('يرجى اختيار الكورس المرتبط بهذا الفيديو');
      return;
    }
    setSavingAccessMode(true);
    try {
      await apiRequest(`/api/admin/videos/${video.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          videoType: targetType,
          priceEgp: targetType === 'FREE' ? 0 : Math.max(0, Number(targetPrice) || 0),
          courseId: targetType === 'COURSE' ? (courseId ? Number(courseId) : null) : null,
        }),
      });
      onToast(
        targetType === 'FREE'
          ? 'تم فتح الفيديو مجانًا لجميع طلاب الصف المعتمدين'
          : targetType === 'PAID'
            ? 'تم قفل الفيديو بنظام الاشتراك وأكواد التفعيل بنجاح'
            : 'تم ربط الفيديو باشتراك الكورس بنجاح',
      );
      await Promise.all([loadAccessHub(), onReload()]);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingAccessMode(false);
    }
  };

  const handleGenerateCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setCopiedAll(false);
    try {
      const resp = await apiRequest<{
        plaintextCodesOnce: string[];
        quantity: number;
      }>('/api/admin/codes/generate', {
        method: 'POST',
        body: JSON.stringify({
          codeCategory: 'CONTENT',
          targetType: 'VIDEO',
          targetId: video.id,
          gradeId: video.gradeId,
          quantity: Math.max(1, Math.min(500, Number(quantity) || 1)),
          durationDays: Math.max(1, Math.min(730, Number(durationDays) || 30)),
          maxUses: Math.max(1, Math.min(100, Number(maxUses) || 1)),
          prefix: prefix.trim().toUpperCase().slice(0, 6) || 'VID',
          batchLabel: batchLabel.trim() || `أكواد فيديو: ${video.titleAr}`,
        }),
      });
      setGeneratedCodes(resp.plaintextCodesOnce || []);
      onToast(`تم توليد ${resp.quantity} كود تفعيل للفيديو بنجاح`);
      await Promise.all([loadAccessHub(), onReload()]);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyAllCodes = async () => {
    if (!generatedCodes.length) return;
    try {
      await navigator.clipboard.writeText(generatedCodes.join('\n'));
      setCopiedAll(true);
      onToast('تم نسخ جميع الأكواد إلى الحافظة');
    } catch {
      onToast('تعذر النسخ التلقائي — يمكنك تحديد الأكواد ونسخها يدويًا');
    }
  };

  const handleDownloadCsv = () => {
    if (!generatedCodes.length) return;
    const csvHeader = 'Code,Video,DurationDays\n';
    const safeTitle = video.titleAr.replace(/"/g, '""');
    const csvBody = generatedCodes
      .map((c) => `"${c}","${safeTitle}",${durationDays}`)
      .join('\n');
    const blob = new Blob(['\uFEFF' + csvHeader + csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-${video.id}-codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRevokeCode = async (codeId: number) => {
    setCodeActionBusyId(codeId);
    try {
      await apiRequest(`/api/admin/codes/${codeId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ note: 'إلغاء من إدارة الفيديو' }),
      });
      onToast('تم إلغاء الكود بنجاح');
      await Promise.all([loadAccessHub(), onReload()]);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setCodeActionBusyId(null);
    }
  };

  const handleDeleteCode = async (codeId: number) => {
    setCodeActionBusyId(codeId);
    try {
      await apiRequest(`/api/admin/codes/${codeId}`, { method: 'DELETE' });
      onToast('تم حذف الكود غير المستخدم بنجاح');
      await Promise.all([loadAccessHub(), onReload()]);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setCodeActionBusyId(null);
    }
  };

  const handleGrantStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) {
      onToast('يرجى اختيار الطالب أولًا');
      return;
    }
    setGranting(true);
    try {
      const resp = await apiRequest<{ message: string }>(
        `/api/admin/videos/${video.id}/grant-student`,
        {
          method: 'POST',
          body: JSON.stringify({
            userId: Number(selectedStudentId),
            durationDays: Math.max(0, Number(grantDurationDays) || 0),
            note: grantNote.trim(),
          }),
        },
      );
      onToast(resp.message || 'تم فتح اشتراك الفيديو للطالب بنجاح');
      setSelectedStudentId('');
      setGrantNote('');
      await loadAccessHub();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setGranting(false);
    }
  };

  const handleRevokeStudent = async (entitlementId: number) => {
    setRevokingId(entitlementId);
    try {
      const resp = await apiRequest<{ message: string }>(
        `/api/admin/videos/${video.id}/revoke-student`,
        {
          method: 'POST',
          body: JSON.stringify({ entitlementId }),
        },
      );
      onToast(resp.message || 'تم قفل اشتراك الطالب عن هذا الفيديو');
      await loadAccessHub();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  };

  const activeEntitlementsCount = (data?.entitlements || []).filter((e) => e.isActive).length;
  const availableCodesCount = (data?.codes || []).filter((c) => c.status === 'AVAILABLE').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-access-modal-title"
      data-testid="video-access-codes-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-4 overflow-y-auto"
    >
      <div className="my-auto flex w-full max-w-4xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              {activeTab === 'codes' ? (
                <KeyRound className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3
                id="video-access-modal-title"
                className="truncate text-base font-extrabold text-[#0F172A]"
              >
                إدارة اشتراكات وأكواد الفيديو
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="truncate font-semibold text-slate-700">{video.titleAr}</span>
                <AdminStatusBadge
                  tone={effectiveVideoType === 'FREE' ? 'emerald' : 'amber'}
                  dot
                >
                  {effectiveVideoType === 'FREE'
                    ? 'مفتوح مجانًا'
                    : effectiveVideoType === 'PAID'
                      ? `مغلق باشتراك (${data?.video.priceEgp ?? video.priceEgp} ج.م)`
                      : 'ضمن كورس كامل'}
                </AdminStatusBadge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="تحديث بيانات الاشتراك والأكواد"
              onClick={() => void loadAccessHub()}
              disabled={loading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              aria-label="إغلاق نافذة اشتراكات وأكواد الفيديو"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-5 py-2.5">
          <button
            type="button"
            data-testid="video-access-tab-codes"
            onClick={() => setActiveTab('codes')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-colors ${
              activeTab === 'codes'
                ? 'bg-[#2563EB] text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:text-[#0F172A]'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>أكواد تفعيل الفيديو ({availableCodesCount} متاح)</span>
          </button>
          <button
            type="button"
            data-testid="video-access-tab-subscriptions"
            onClick={() => setActiveTab('subscriptions')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-colors ${
              activeTab === 'subscriptions'
                ? 'bg-[#2563EB] text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:text-[#0F172A]'
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            <span>قفل وفتح الاشتراكات ({activeEntitlementsCount} نشط)</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'codes' ? (
            <>
              {/* Helpful notice when video is currently FREE */}
              {effectiveVideoType === 'FREE' && canManageContent && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs">
                  <div className="flex items-start gap-2 text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-extrabold">هذا الفيديو مفتوح مجانًا حاليًا</div>
                      <div className="mt-0.5 text-amber-800">
                        لتقييد الفيديو بأكواد التفعيل والاشتراكات فقط، قم بتحويله إلى «فيديو مدفوع / مغلق باشتراك».
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={savingAccessMode}
                    onClick={() => void handleSaveAccessMode('PAID', priceEgp || 90)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>قفل الفيديو (مدفوع بأكواد)</span>
                  </button>
                </div>
              )}

              {/* Generate Codes Form */}
              {canManageCodes ? (
                <form
                  onSubmit={handleGenerateCodes}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-extrabold text-[#0F172A]">
                        توليد أكواد تفعيل مخصصة لهذا الفيديو
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        أي طالب يُدخل الكود من حسابه سيُفتح له هذا الفيديو مباشرةً للمدة المحددة.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div>
                      <label htmlFor="vid-code-qty" className="block text-[11px] font-bold text-slate-700">
                        عدد الأكواد
                      </label>
                      <input
                        id="vid-code-qty"
                        type="number"
                        min={1}
                        max={500}
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="vid-code-days" className="block text-[11px] font-bold text-slate-700">
                        مدة الاشتراك (أيام)
                      </label>
                      <input
                        id="vid-code-days"
                        type="number"
                        min={1}
                        max={730}
                        value={durationDays}
                        onChange={(e) => setDurationDays(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="vid-code-uses" className="block text-[11px] font-bold text-slate-700">
                        مرات الاستخدام
                      </label>
                      <input
                        id="vid-code-uses"
                        type="number"
                        min={1}
                        max={100}
                        value={maxUses}
                        onChange={(e) => setMaxUses(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="vid-code-prefix" className="block text-[11px] font-bold text-slate-700">
                        بادئة الكود
                      </label>
                      <input
                        id="vid-code-prefix"
                        type="text"
                        dir="ltr"
                        maxLength={6}
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs uppercase"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex items-end">
                      <button
                        type="submit"
                        data-testid="generate-video-codes-submit-btn"
                        disabled={generating}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>{generating ? 'جارٍ التوليد...' : 'توليد الأكواد'}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="vid-code-batch" className="block text-[11px] font-bold text-slate-700">
                      اسم الدفعة (اختياري لسهولة التمييز)
                    </label>
                    <input
                      id="vid-code-batch"
                      type="text"
                      value={batchLabel}
                      onChange={(e) => setBatchLabel(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                  </div>
                </form>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
                  توليد الأكواد متاح فقط لصاحب المنصة أو من يملك صلاحية إدارة أكواد التفعيل.
                </div>
              )}

              {/* Newly Generated Plaintext Codes (Shown Once) */}
              {generatedCodes.length > 0 && (
                <div
                  data-testid="generated-video-codes-box"
                  className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/70 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>
                        تم توليد {generatedCodes.length} كود تفعيل (احفظها الآن — لن تظهر كاملة مرة أخرى)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyAllCodes()}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedAll ? 'تم النسخ' : 'نسخ الكل'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadCsv}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>تحميل CSV</span>
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3" dir="ltr">
                    {generatedCodes.map((code) => (
                      <div
                        key={code}
                        className="flex items-center justify-between rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono-num text-xs font-bold text-[#0F172A]"
                      >
                        <span>{code}</span>
                        <button
                          type="button"
                          aria-label={`نسخ الكود ${code}`}
                          onClick={() => {
                            void navigator.clipboard.writeText(code).catch(() => undefined);
                            onToast(`تم نسخ الكود ${code}`);
                          }}
                          className="text-slate-400 hover:text-[#2563EB]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing Codes Table for This Video */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-[#0F172A]">
                  الأكواد المُصدرة لهذا الفيديو ({data?.codes.length ?? 0})
                </h4>
                {loading && !data ? (
                  <div className="py-8 text-center text-xs text-slate-500">جارٍ التحميل...</div>
                ) : !data || data.codes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
                    لا توجد أكواد تفعيل صادرة لهذا الفيديو حتى الآن. استخدم النموذج أعلاه لتوليد دفعة أكواد جديدة.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[580px] text-right text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">الكود (مُقنّع)</th>
                          <th className="px-3 py-2.5">الدفعة</th>
                          <th className="px-3 py-2.5">الاستخدام</th>
                          <th className="px-3 py-2.5">المدة</th>
                          <th className="px-3 py-2.5">الحالة</th>
                          <th className="px-3 py-2.5">التاريخ</th>
                          {canManageCodes && <th className="px-3 py-2.5 text-left">إجراء</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.codes.map((c) => {
                          const meta = CODE_STATUS_META[c.status] || {
                            label: c.status,
                            tone: 'slate' as AdminTone,
                          };
                          return (
                            <tr key={c.id} className="hover:bg-slate-50/60">
                              <td dir="ltr" className="px-3 py-2.5 text-right font-mono-num font-bold text-[#0F172A]">
                                {c.codePrefix}
                              </td>
                              <td className="px-3 py-2.5 text-slate-600 max-w-[180px] truncate">
                                {c.batchLabel || '—'}
                              </td>
                              <td className="px-3 py-2.5 font-mono-num font-bold tabular-nums">
                                {c.usedCount} / {c.maxUses}
                              </td>
                              <td className="px-3 py-2.5 font-mono-num text-slate-600">
                                {c.durationDays} يوم
                              </td>
                              <td className="px-3 py-2.5">
                                <AdminStatusBadge tone={meta.tone} dot>
                                  {meta.label}
                                </AdminStatusBadge>
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-slate-500">
                                {formatDateAr(c.createdAt)}
                              </td>
                              {canManageCodes && (
                                <td className="px-3 py-2.5 text-left">
                                  <div className="flex items-center justify-end gap-1">
                                    {c.status === 'AVAILABLE' && (
                                      <button
                                        type="button"
                                        disabled={codeActionBusyId === c.id}
                                        onClick={() => void handleRevokeCode(c.id)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                                      >
                                        <Ban className="h-3 w-3" />
                                        <span>إلغاء</span>
                                      </button>
                                    )}
                                    {c.canDelete && (
                                      <button
                                        type="button"
                                        aria-label={`حذف الكود ${c.codePrefix}`}
                                        disabled={codeActionBusyId === c.id}
                                        onClick={() => void handleDeleteCode(c.id)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Section 1: Lock / Unlock Video Access Mode */}
              {canManageContent && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#0F172A]">
                      حالة قفل وفتح الاشتراك للفيديو
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      تحكم في ما إذا كان الفيديو مفتوحًا مجانًا لطلاب الصف أو مغلقًا يتطلب اشتراكًا أو كود تفعيل.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <button
                      type="button"
                      data-testid="video-access-mode-paid"
                      onClick={() => setAccessMode('PAID')}
                      className={`flex flex-col items-start rounded-xl border p-3 text-right transition-all ${
                        accessMode === 'PAID'
                          ? 'border-amber-400 bg-amber-50/80 ring-2 ring-amber-400/30'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A]">
                        <Lock className="h-4 w-4 text-amber-600" />
                        <span>مغلق باشتراك / كود</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        يُفتح للمشتركين عبر كود تفعيل أو شراء أو فتح يدوي من المدرس.
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="video-access-mode-course"
                      onClick={() => setAccessMode('COURSE')}
                      className={`flex flex-col items-start rounded-xl border p-3 text-right transition-all ${
                        accessMode === 'COURSE'
                          ? 'border-blue-400 bg-blue-50/80 ring-2 ring-blue-400/30'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A]">
                        <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
                        <span>ضمن كورس كامل</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        متاح لطلاب الكورس المحدد + من تفتح لهم الفيديو يدويًا.
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="video-access-mode-free"
                      onClick={() => setAccessMode('FREE')}
                      className={`flex flex-col items-start rounded-xl border p-3 text-right transition-all ${
                        accessMode === 'FREE'
                          ? 'border-emerald-400 bg-emerald-50/80 ring-2 ring-emerald-400/30'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A]">
                        <Unlock className="h-4 w-4 text-emerald-600" />
                        <span>مفتوح مجانًا</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        مفتوح فورًا لكل الطلاب المعتمدين في هذا الصف الدراسي.
                      </p>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {accessMode !== 'FREE' && (
                      <div className="w-36">
                        <label htmlFor="vid-access-price" className="block text-[11px] font-bold text-slate-700">
                          سعر الفيديو (ج.م)
                        </label>
                        <input
                          id="vid-access-price"
                          type="number"
                          min={0}
                          value={priceEgp}
                          onChange={(e) => setPriceEgp(Number(e.target.value))}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs"
                        />
                      </div>
                    )}
                    {accessMode === 'COURSE' && (
                      <div className="min-w-[200px] flex-1">
                        <label htmlFor="vid-access-course" className="block text-[11px] font-bold text-slate-700">
                          الكورس المرتبط
                        </label>
                        <select
                          id="vid-access-course"
                          value={courseId}
                          onChange={(e) =>
                            setCourseId(e.target.value ? Number(e.target.value) : '')
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                        >
                          <option value="">اختر الكورس...</option>
                          {gradeCourses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.titleAr}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid="save-video-access-mode-btn"
                      disabled={savingAccessMode}
                      onClick={() => void handleSaveAccessMode()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#2563EB] disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{savingAccessMode ? 'جارٍ الحفظ...' : 'حفظ حالة الاشتراك'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Section 2: Open Subscription for a Specific Student */}
              {canGrantAccess && (
                <form
                  onSubmit={handleGrantStudent}
                  className="rounded-2xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-[#2563EB]" />
                    <h4 className="text-sm font-extrabold text-[#0F172A]">
                      فتح اشتراك الفيديو لطالب محدد
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <label htmlFor="vid-student-search" className="block text-[11px] font-bold text-slate-700">
                        بحث عن طالب
                      </label>
                      <div className="relative mt-1">
                        <Search className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          id="vid-student-search"
                          type="text"
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          placeholder="الاسم أو الهاتف..."
                          className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-8 pl-2.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-5">
                      <label htmlFor="vid-student-select" className="block text-[11px] font-bold text-slate-700">
                        اختر الطالب *
                      </label>
                      <select
                        id="vid-student-select"
                        data-testid="video-grant-student-select"
                        value={selectedStudentId}
                        onChange={(e) =>
                          setSelectedStudentId(e.target.value ? Number(e.target.value) : '')
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        <option value="">— اختر طالبًا لفتح الفيديو له —</option>
                        {filteredStudents.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName} {s.phone ? `(${s.phone})` : ''} · {s.gradeNameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <label htmlFor="vid-grant-days" className="block text-[11px] font-bold text-slate-700">
                        مدة الفتح
                      </label>
                      <select
                        id="vid-grant-days"
                        value={grantDurationDays}
                        onChange={(e) => setGrantDurationDays(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      >
                        <option value={7}>7 أيام</option>
                        <option value={30}>30 يومًا</option>
                        <option value={90}>90 يومًا</option>
                        <option value={180}>180 يومًا</option>
                        <option value={365}>سنة كاملة</option>
                        <option value={0}>مفتوح دائمًا</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      value={grantNote}
                      onChange={(e) => setGrantNote(e.target.value)}
                      placeholder="ملاحظة اختيارية (مثال: دفع نقدي في السنتر)"
                      className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      data-testid="grant-video-student-submit-btn"
                      disabled={granting || !selectedStudentId}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      <span>{granting ? 'جارٍ الفتح...' : 'فتح الاشتراك للطالب'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Section 3: Direct Subscribers List */}
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A]">
                  <UserCheck className="h-4 w-4 text-emerald-600" />
                  <span>الطلاب المشتركون مباشرةً في هذا الفيديو ({data?.entitlements.length ?? 0})</span>
                </h4>
                {!data || data.entitlements.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
                    لا توجد اشتراكات فردية مسجلة لهذا الفيديو بعد. يمكنك فتح الاشتراك لأي طالب من الأعلى أو عبر أكواد التفعيل.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[580px] text-right text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">الطالب</th>
                          <th className="px-3 py-2.5">المصدر</th>
                          <th className="px-3 py-2.5">الانتهاء</th>
                          <th className="px-3 py-2.5">الحالة</th>
                          {canRevokeAccess && <th className="px-3 py-2.5 text-left">إجراء</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.entitlements.map((ent) => (
                          <tr key={ent.id} className="hover:bg-slate-50/60">
                            <td className="px-3 py-2.5">
                              <div className="font-extrabold text-[#0F172A]">{ent.studentName}</div>
                              <div className="text-[10px] text-slate-500">
                                {ent.studentPhone || '—'} · {ent.gradeNameAr}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              <div>{SOURCE_LABELS[ent.source] || ent.source}</div>
                              {ent.note && (
                                <div className="max-w-[180px] truncate text-[10px] text-slate-400">
                                  {ent.note}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-slate-600">
                              {ent.expiresAt ? formatDateAr(ent.expiresAt) : 'دائم'}
                            </td>
                            <td className="px-3 py-2.5">
                              <AdminStatusBadge
                                tone={ent.isActive ? 'emerald' : ent.isRevoked ? 'rose' : 'slate'}
                                dot
                              >
                                {ent.isActive ? 'نشط' : ent.isRevoked ? 'موقوف / مغلق' : 'منتهي'}
                              </AdminStatusBadge>
                            </td>
                            {canRevokeAccess && (
                              <td className="px-3 py-2.5 text-left">
                                {ent.isActive ? (
                                  <button
                                    type="button"
                                    data-testid={`revoke-video-entitlement-${ent.id}`}
                                    disabled={revokingId === ent.id}
                                    onClick={() => void handleRevokeStudent(ent.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                  >
                                    <Lock className="h-3 w-3" />
                                    <span>{revokingId === ent.id ? 'جارٍ القفل...' : 'قفل الاشتراك'}</span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-400">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-bold text-white hover:bg-[#1E293B]"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
