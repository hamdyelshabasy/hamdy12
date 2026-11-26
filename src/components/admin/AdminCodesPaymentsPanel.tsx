import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileText,
  KeyRound,
  PauseCircle,
  PlayCircle,
  Plus,
  Printer,
  ShieldBan,
  ShieldCheck,
  Trash2,
  Users,
  Video,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../../lib/api.ts';
import { parseLocalizedInt, sanitizeNumericInputValue } from '../../lib/numerals.ts';
import { PERMISSIONS, hasPermission } from '../../lib/permissions.ts';
import type { AuthUser } from '../../types/lms.ts';
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

interface AccessCodeRow {
  id: number;
  codePrefix: string;
  codeCategory?: 'PLATFORM' | 'CONTENT';
  targetType: string;
  targetId: number;
  targetTitleAr?: string;
  gradeNameAr: string;
  durationDays: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabledUntil?: string | null;
  cancelledAt?: string | null;
  statusNote?: string | null;
  status: string;
  batchLabel: string;
  canDelete?: boolean;
  createdAt: string;
}

interface CodeDetailResponse {
  code: AccessCodeRow;
  redemptions: Array<{
    id: number;
    userId: number;
    redeemedAt: string;
    entitlementId: number | null;
    studentName: string;
    studentPhone: string | null;
  }>;
}

interface PlatformSubRow {
  id: number;
  userId: number;
  studentName: string;
  studentPhone: string;
  codePrefix: string;
  startsAt: string;
  expiresAt: string;
  durationDays: number;
  status: string;
  isActive: boolean;
  remainingDays: number;
  accessScope: string;
  accessScopeAr: string;
  note: string;
}

interface OrderRow {
  id: number;
  orderNumber: string;
  studentName: string;
  studentPhone: string | null;
  targetType: string;
  targetTitleAr: string;
  amountEgp: number;
  discountEgp: number;
  finalAmountEgp: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  payment: {
    id: number;
    provider: string;
    providerRef: string;
    receiptNote: string;
    status: string;
  } | null;
}

interface AdminCodesPaymentsPanelProps {
  section: 'codes' | 'payments';
  catalog: AdminCatalogData;
  currentUser: AuthUser;
  onToast: (msg: string) => void;
}

const CODE_STATUS_META: Record<string, { label: string; tone: AdminTone }> = {
  AVAILABLE: { label: 'غير مستخدم', tone: 'emerald' },
  REDEEMED: { label: 'مستهلك', tone: 'slate' },
  USED: { label: 'مستهلك', tone: 'slate' },
  DISABLED: { label: 'معطّل مؤقتًا', tone: 'amber' },
  CANCELLED: { label: 'ملغي', tone: 'rose' },
  REVOKED: { label: 'مسحوب', tone: 'rose' },
};

const ORDER_STATUS_META: Record<string, { label: string; tone: AdminTone }> = {
  PAID: { label: 'مؤكد', tone: 'emerald' },
  UNDER_REVIEW: { label: 'قيد المراجعة', tone: 'amber' },
  PENDING: { label: 'قيد المراجعة', tone: 'amber' },
  FAILED: { label: 'مرفوض', tone: 'rose' },
  CANCELLED: { label: 'ملغي', tone: 'slate' },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  INSTAPAY: 'إنستا باي',
  VODAFONE_CASH: 'فودافون كاش',
  BANK_TRANSFER: 'تحويل بنكي',
  PAYMOB: 'Paymob',
  FAWRY: 'فوري',
  CASH: 'نقدي',
};

function formatPaymentMethod(method: string): string {
  return PAYMENT_METHOD_LABELS[method] || method || 'غير محدد';
}

export const AdminCodesPaymentsPanel: React.FC<AdminCodesPaymentsPanelProps> = ({
  section,
  catalog,
  currentUser,
  onToast,
}) => {
  const canManageCodes = hasPermission(currentUser, PERMISSIONS.CODES_MANAGE);
  const canVerifyPayments = hasPermission(currentUser, PERMISSIONS.PAYMENTS_VERIFY);

  const generatorRef = useRef<HTMLFormElement>(null);

  // Activation Codes state
  const [codeSectionTab, setCodeSectionTab] = useState<'PLATFORM' | 'CONTENT' | 'SUBSCRIPTIONS'>('PLATFORM');
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [platformSubs, setPlatformSubs] = useState<PlatformSubRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [codeSearch, setCodeSearch] = useState('');
  const [codePage, setCodePage] = useState(1);
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState('ALL');
  const [busyAction, setBusyAction] = useState(false);

  // Payments & Orders state
  const [orderTab, setOrderTab] = useState<'ALL' | 'PENDING' | 'PAID' | 'FAILED'>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderMethodFilter, setOrderMethodFilter] = useState('ALL');
  const [orderPage, setOrderPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  // Section A: Platform Subscription Code Generator
  const [platformGen, setPlatformGen] = useState({
    quantity: '10',
    durationPreset: '30' as '30' | '60' | '365' | 'CUSTOM',
    customDays: '45',
    maxUses: '1',
    expiresInDays: '180',
    batchLabel: 'دفعة اشتراك المنصة الشهري',
    prefix: 'PLT',
  });

  // Section B: Content (Videos / Courses / Grade) Code Generator
  const [genForm, setGenForm] = useState({
    quantity: '10',
    targetType: 'VIDEO' as 'VIDEO' | 'COURSE' | 'GRADE_ALL',
    targetId: catalog.videos.find((v) => v.videoType !== 'FREE')?.id || catalog.videos[0]?.id || 0,
    gradeId: catalog.grades[0]?.id || 0,
    durationDays: '30',
    maxUses: '1',
    expiresInDays: '90',
    batchLabel: 'دفعة سنتر الفيزياء',
    prefix: 'PHY',
  });

  const [generating, setGenerating] = useState(false);
  const [revealedBatch, setRevealedBatch] = useState<{
    category: 'PLATFORM' | 'CONTENT';
    batchLabel: string;
    durationDays: number;
    targetLabel: string;
    codes: string[];
    securityNotice: string;
  } | null>(null);

  // Lifecycle modals
  const [detailModal, setDetailModal] = useState<CodeDetailResponse | null>(null);
  const [disableModal, setDisableModal] = useState<{ code: AccessCodeRow; until: string; note: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'codes') {
        const [codesRes, subsRes] = await Promise.all([
          apiRequest<{ codes: AccessCodeRow[] }>('/api/admin/codes'),
          apiRequest<{ subscriptions: PlatformSubRow[] }>('/api/admin/platform-subscriptions').catch(() => ({
            subscriptions: [] as PlatformSubRow[],
          })),
        ]);
        setCodes(codesRes.codes);
        setPlatformSubs(subsRes.subscriptions || []);
      } else {
        const res = await apiRequest<{ orders: OrderRow[] }>('/api/admin/orders');
        setOrders(res.orders);
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [section, onToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleTargetTypeChange = (nextType: 'VIDEO' | 'COURSE' | 'GRADE_ALL') => {
    const nextTargetId =
      nextType === 'VIDEO'
        ? catalog.videos.find((v) => v.videoType !== 'FREE')?.id || catalog.videos[0]?.id || 0
        : nextType === 'COURSE'
          ? catalog.courses[0]?.id || 0
          : catalog.grades[0]?.id || 0;
    setGenForm((prev) => ({ ...prev, targetType: nextType, targetId: nextTargetId }));
  };

  const handleGeneratePlatformBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const durationDays =
      platformGen.durationPreset === 'CUSTOM'
        ? parseLocalizedInt(platformGen.customDays) || 30
        : Number(platformGen.durationPreset);
    const quantity = parseLocalizedInt(platformGen.quantity) || 1;
    const maxUses = parseLocalizedInt(platformGen.maxUses) || 1;
    const expiresInDays = parseLocalizedInt(platformGen.expiresInDays) || 180;

    setGenerating(true);
    try {
      const res = await apiRequest<{
        quantity: number;
        batchLabel: string;
        plaintextCodesOnce: string[];
        securityNotice: string;
      }>('/api/admin/codes/generate', {
        method: 'POST',
        body: JSON.stringify({
          codeCategory: 'PLATFORM',
          targetType: 'PLATFORM_ACCESS',
          targetId: 0,
          quantity,
          durationDays,
          maxUses,
          expiresInDays,
          batchLabel: platformGen.batchLabel || `اشتراك منصة (${durationDays} يوم)`,
          prefix: platformGen.prefix || 'PLT',
        }),
      });
      setRevealedBatch({
        category: 'PLATFORM',
        batchLabel: res.batchLabel,
        durationDays,
        targetLabel: 'اشتراك دخول المنصة فقط',
        codes: res.plaintextCodesOnce,
        securityNotice: res.securityNotice,
      });
      onToast(`تم توليد ${res.quantity} كود اشتراك منصة بنجاح`);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateContentBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genForm.targetId) {
      onToast('يرجى اختيار المحتوى المستهدف أولًا');
      return;
    }
    const quantity = parseLocalizedInt(genForm.quantity) || 1;
    const durationDays = parseLocalizedInt(genForm.durationDays) || 30;
    const maxUses = parseLocalizedInt(genForm.maxUses) || 1;
    const expiresInDays = parseLocalizedInt(genForm.expiresInDays) || 90;

    setGenerating(true);
    try {
      const res = await apiRequest<{
        quantity: number;
        batchLabel: string;
        plaintextCodesOnce: string[];
        securityNotice: string;
      }>('/api/admin/codes/generate', {
        method: 'POST',
        body: JSON.stringify({
          codeCategory: 'CONTENT',
          targetType: genForm.targetType,
          targetId: genForm.targetId,
          gradeId: genForm.gradeId || null,
          quantity,
          durationDays,
          maxUses,
          expiresInDays,
          batchLabel: genForm.batchLabel,
          prefix: genForm.prefix || 'PHY',
        }),
      });
      setRevealedBatch({
        category: 'CONTENT',
        batchLabel: res.batchLabel,
        durationDays,
        targetLabel: genForm.targetType,
        codes: res.plaintextCodesOnce,
        securityNotice: res.securityNotice,
      });
      onToast(`تم توليد ${res.quantity} كود محتوى بنجاح`);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleExportCsv = () => {
    if (!revealedBatch) return;
    const rows = [
      ['الكود', 'القسم', 'اسم الدفعة', 'مدة الصلاحية (يوم)', 'النطاق'],
      ...revealedBatch.codes.map((c) => [
        c,
        revealedBatch.category === 'PLATFORM' ? 'اشتراك المنصة' : 'فيديوهات وكورسات',
        revealedBatch.batchLabel,
        String(revealedBatch.durationDays),
        revealedBatch.targetLabel,
      ]),
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `physics-codes-${revealedBatch.category.toLowerCase()}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCodes = async () => {
    if (!revealedBatch) return;
    try {
      await navigator.clipboard.writeText(revealedBatch.codes.join('\n'));
      onToast('تم نسخ جميع الأكواد إلى الحافظة');
    } catch {
      onToast('تعذر النسخ التلقائي — يمكنك استخدام زر تصدير CSV');
    }
  };

  const handleViewDetails = async (id: number) => {
    try {
      const res = await apiRequest<CodeDetailResponse>(`/api/admin/codes/${id}`);
      setDetailModal(res);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleCancelUnused = async (id: number) => {
    setBusyAction(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/codes/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ note: 'إلغاء كود غير مستخدم من لوحة التحكم' }),
      });
      onToast(res.message);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleSubmitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disableModal) return;
    setBusyAction(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/codes/${disableModal.code.id}/disable`,
        {
          method: 'POST',
          body: JSON.stringify({
            disabledUntil: new Date(disableModal.until).toISOString(),
            note: disableModal.note,
          }),
        },
      );
      setDisableModal(null);
      onToast(res.message);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleReactivateCode = async (id: number) => {
    setBusyAction(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/codes/${id}/reactivate`, {
        method: 'POST',
      });
      onToast(res.message);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteUnusedCode = async (id: number) => {
    setBusyAction(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/codes/${id}`, {
        method: 'DELETE',
      });
      onToast(res.message);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRevokeCode = async (id: number, revokeGrantedAccess: boolean) => {
    setBusyAction(true);
    try {
      await apiRequest(`/api/admin/codes/${id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ revokeGrantedAccess }),
      });
      onToast(
        revokeGrantedAccess
          ? 'تم سحب الكود وإلغاء الصلاحيات الممنوحة به'
          : 'تم سحب الكود ومنع استخدامه مستقبلاً',
      );
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleVerifyOrder = async (orderId: number) => {
    setBusyAction(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/orders/${orderId}/verify`, {
        method: 'POST',
      });
      onToast(res.message);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRejectOrder = async (orderId: number) => {
    setBusyAction(true);
    try {
      await apiRequest(`/api/admin/orders/${orderId}/reject`, { method: 'POST' });
      onToast('تم رفض الطلب وتحديث حالته');
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  // ==================== DERIVED DATA: CODES ====================
  const codeStats = useMemo(() => {
    let platformCount = 0;
    let contentCount = 0;
    let unusedCount = 0;
    let redeemedCount = 0;
    for (const c of codes) {
      const isPlatform = c.codeCategory === 'PLATFORM' || c.targetType === 'PLATFORM_ACCESS';
      if (isPlatform) platformCount += 1;
      else contentCount += 1;
      if (c.status === 'AVAILABLE' && c.usedCount < c.maxUses) unusedCount += 1;
      if (c.usedCount > 0 || c.status === 'REDEEMED' || c.status === 'USED') redeemedCount += 1;
    }
    return { platformCount, contentCount, unusedCount, redeemedCount };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    const q = codeSearch.trim().toLowerCase();
    return codes.filter((c) => {
      const isPlatform = c.codeCategory === 'PLATFORM' || c.targetType === 'PLATFORM_ACCESS';
      if (codeSectionTab === 'PLATFORM' && !isPlatform) return false;
      if (codeSectionTab === 'CONTENT' && isPlatform) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (q) {
        const hay = `${c.codePrefix} ${c.batchLabel} ${c.targetTitleAr || ''} ${c.gradeNameAr || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [codes, codeSectionTab, statusFilter, codeSearch]);

  const filteredSubs = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return platformSubs.filter((s) => {
      if (subStatusFilter !== 'ALL' && s.status !== subStatusFilter) return false;
      if (q) {
        const hay = `${s.studentName} ${s.studentPhone} ${s.codePrefix}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [platformSubs, subSearch, subStatusFilter]);

  const codesPageSize = 10;
  const totalCodePages = Math.max(1, Math.ceil(filteredCodes.length / codesPageSize));
  const safeCodePage = Math.min(codePage, totalCodePages);
  const paginatedCodes = useMemo(
    () => filteredCodes.slice((safeCodePage - 1) * codesPageSize, safeCodePage * codesPageSize),
    [filteredCodes, safeCodePage],
  );

  // ==================== DERIVED DATA: PAYMENTS ====================
  const orderStats = useMemo(() => {
    let paidTotal = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    const methods = new Set<string>();
    for (const o of orders) {
      if (o.paymentMethod) methods.add(o.paymentMethod);
      if (o.status === 'PAID') {
        paidTotal += o.finalAmountEgp;
        paidCount += 1;
      } else if (o.status === 'UNDER_REVIEW' || o.status === 'PENDING') {
        pendingCount += 1;
      } else {
        failedCount += 1;
      }
    }
    return {
      paidTotal,
      paidCount,
      pendingCount,
      failedCount,
      methods: Array.from(methods),
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderTab === 'PENDING' && o.status !== 'UNDER_REVIEW' && o.status !== 'PENDING') return false;
      if (orderTab === 'PAID' && o.status !== 'PAID') return false;
      if (orderTab === 'FAILED' && o.status !== 'FAILED' && o.status !== 'CANCELLED') return false;
      if (orderMethodFilter !== 'ALL' && o.paymentMethod !== orderMethodFilter) return false;
      if (q) {
        const hay = `${o.orderNumber} ${o.studentName} ${o.studentPhone || ''} ${o.targetTitleAr} ${o.payment?.providerRef || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, orderTab, orderMethodFilter, orderSearch]);

  const ordersPageSize = 10;
  const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / ordersPageSize));
  const safeOrderPage = Math.min(orderPage, totalOrderPages);
  const paginatedOrders = useMemo(
    () => filteredOrders.slice((safeOrderPage - 1) * ordersPageSize, safeOrderPage * ordersPageSize),
    [filteredOrders, safeOrderPage],
  );

  const selectedOrder = useMemo(() => {
    if (selectedOrderId != null) {
      const found = filteredOrders.find((o) => o.id === selectedOrderId) || orders.find((o) => o.id === selectedOrderId);
      if (found) return found;
    }
    return filteredOrders[0] || orders[0] || null;
  }, [selectedOrderId, filteredOrders, orders]);

  // =========================================================================
  // SCREEN 06: ACTIVATION CODES
  // =========================================================================
  if (section === 'codes') {
    const defaultDisableUntil = () => {
      const d = new Date(Date.now() + 7 * 86400_000);
      return d.toISOString().slice(0, 16);
    };

    const isContentMode = codeSectionTab === 'CONTENT';

    const scrollToGenerator = () => {
      if (codeSectionTab === 'SUBSCRIPTIONS') {
        setCodeSectionTab('PLATFORM');
      }
      setTimeout(() => {
        generatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 40);
    };

    return (
      <div className="space-y-5" data-testid="admin-activation-codes-panel">
        <AdminPageHeader
          title="أكواد التفعيل"
          subtitle="فصل أكواد اشتراك المنصة عن أكواد فتح المحتوى مع سجل استخدام واضح."
          icon={<KeyRound className="h-5 w-5" />}
          actions={
            canManageCodes ? (
              <button
                type="button"
                onClick={scrollToGenerator}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
              >
                <Plus className="h-4 w-4" />
                <span>توليد أكواد جديدة</span>
              </button>
            ) : undefined
          }
        />

        {/* 4 Real KPI Cards */}
        <AdminKpiGrid cols={4}>
          <AdminKpiCard
            label="أكواد المحتوى"
            value={codeStats.contentCount}
            subtitle="فيديوهات وكورسات"
            tone="blue"
            icon={<KeyRound className="h-5 w-5" />}
            onClick={() => {
              setCodeSectionTab('CONTENT');
              setStatusFilter('ALL');
              setCodePage(1);
            }}
          />
          <AdminKpiCard
            label="أكواد اشتراك المنصة"
            value={codeStats.platformCount}
            subtitle="صلاحية دخول المنصة فقط"
            tone="purple"
            icon={<ShieldCheck className="h-5 w-5" />}
            onClick={() => {
              setCodeSectionTab('PLATFORM');
              setStatusFilter('ALL');
              setCodePage(1);
            }}
          />
          <AdminKpiCard
            label="أكواد غير مستخدمة"
            value={codeStats.unusedCount}
            subtitle="متاحة للتفعيل"
            tone="emerald"
            icon={<CheckCircle2 className="h-5 w-5" />}
            onClick={() => {
              if (codeSectionTab === 'SUBSCRIPTIONS') setCodeSectionTab('PLATFORM');
              setStatusFilter('AVAILABLE');
              setCodePage(1);
            }}
          />
          <AdminKpiCard
            label="أكواد مستهلكة"
            value={codeStats.redeemedCount}
            subtitle="سجل الاستخدام"
            tone="amber"
            icon={<Clock className="h-5 w-5" />}
            onClick={() => {
              if (codeSectionTab === 'SUBSCRIPTIONS') setCodeSectionTab('PLATFORM');
              setStatusFilter('REDEEMED');
              setCodePage(1);
            }}
          />
        </AdminKpiGrid>

        {/* Segmented Section Tabs (preserving testids) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={codeSectionTab === 'PLATFORM'}
              data-testid="codes-section-platform"
              onClick={() => {
                setCodeSectionTab('PLATFORM');
                setStatusFilter('ALL');
                setCodePage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                codeSectionTab === 'PLATFORM'
                  ? 'bg-blue-50 text-[#2563EB] ring-1 ring-inset ring-blue-200/80'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>أكواد اشتراك المنصة</span>
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono-num text-[11px] font-extrabold tabular-nums ${
                  codeSectionTab === 'PLATFORM' ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {codeStats.platformCount}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={codeSectionTab === 'CONTENT'}
              data-testid="codes-section-content"
              onClick={() => {
                setCodeSectionTab('CONTENT');
                setStatusFilter('ALL');
                setCodePage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                codeSectionTab === 'CONTENT'
                  ? 'bg-blue-50 text-[#2563EB] ring-1 ring-inset ring-blue-200/80'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
              }`}
            >
              <Video className="h-3.5 w-3.5" />
              <span>أكواد الفيديوهات والكورسات</span>
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono-num text-[11px] font-extrabold tabular-nums ${
                  codeSectionTab === 'CONTENT' ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {codeStats.contentCount}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={codeSectionTab === 'SUBSCRIPTIONS'}
              data-testid="codes-section-subscriptions"
              onClick={() => setCodeSectionTab('SUBSCRIPTIONS')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                codeSectionTab === 'SUBSCRIPTIONS'
                  ? 'bg-blue-50 text-[#2563EB] ring-1 ring-inset ring-blue-200/80'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>الاشتراكات المفعّلة</span>
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono-num text-[11px] font-extrabold tabular-nums ${
                  codeSectionTab === 'SUBSCRIPTIONS' ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {platformSubs.length}
              </span>
            </button>
          </div>
        </div>

        {/* One-Time Plaintext Reveal Box */}
        {revealedBatch && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/80 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-amber-950">
                  تم توليد {revealedBatch.codes.length} كود — {revealedBatch.batchLabel}
                </h3>
                <p className="mt-1 text-xs text-amber-900/90">{revealedBatch.securityNotice}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#0D172B] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>تصدير CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyCodes}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-amber-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>نسخ الكل</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-amber-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRevealedBatch(null)}
                  aria-label="إخفاء الأكواد"
                  className="rounded-xl border border-amber-300 bg-white p-2 text-amber-900 hover:bg-amber-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
              {revealedBatch.codes.map((code) => (
                <div
                  key={code}
                  dir="ltr"
                  className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-center font-mono-num text-xs font-bold text-[#0F172A]"
                >
                  {code}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Master-Detail Workspace: Records Table (8 cols) + Sticky Generation Form (4 cols) */}
        <AdminMasterDetail
          mainSpan="8"
          main={
            <div className="space-y-4">
              {codeSectionTab !== 'SUBSCRIPTIONS' ? (
                <>
                  <AdminCard padding="none" className="overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                      <div>
                        <h3 className="text-sm font-extrabold text-[#0F172A]">
                          {codeSectionTab === 'PLATFORM'
                            ? 'سجل أكواد اشتراك المنصة'
                            : 'سجل أكواد الفيديوهات والكورسات'}
                        </h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          الأكواد مشفّرة بالكامل ولا يظهر منها سوى المرجع المقنّع للأمان.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={codeSearch}
                          onChange={(e) => {
                            setCodeSearch(e.target.value);
                            setCodePage(1);
                          }}
                          placeholder="ابحث بالمرجع أو الدفعة..."
                          className="h-9 w-44 rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-[#0F172A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
                        />
                        <select
                          value={statusFilter}
                          onChange={(e) => {
                            setStatusFilter(e.target.value);
                            setCodePage(1);
                          }}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus:border-[#2563EB] focus:outline-none"
                        >
                          <option value="ALL">كل الحالات</option>
                          <option value="AVAILABLE">غير مستخدم</option>
                          <option value="REDEEMED">مستهلك</option>
                          <option value="DISABLED">معطّل مؤقتًا</option>
                          <option value="CANCELLED">ملغي</option>
                          <option value="REVOKED">مسحوب</option>
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                          <tr>
                            <th className="px-4 py-3">مرجع الكود</th>
                            <th className="px-4 py-3">الدفعة / الهدف</th>
                            <th className="px-4 py-3">المدة</th>
                            <th className="px-4 py-3">الاستخدام</th>
                            <th className="px-4 py-3">الحالة</th>
                            <th className="px-4 py-3 text-left">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {loading ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                                جارٍ تحميل سجل الأكواد...
                              </td>
                            </tr>
                          ) : paginatedCodes.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-6">
                                <AdminEmptyState
                                  icon={<KeyRound className="h-5 w-5" />}
                                  title="لا توجد أكواد مطابقة"
                                  description="جرّب تغيير حالة التصفية أو توليد دفعة أكواد جديدة من النموذج الجانبي."
                                />
                              </td>
                            </tr>
                          ) : (
                            paginatedCodes.map((c) => {
                              const st = CODE_STATUS_META[c.status] || { label: c.status, tone: 'slate' as AdminTone };
                              const unused = c.usedCount === 0;
                              const menuItems: AdminActionMenuItem[] = [
                                {
                                  id: 'details',
                                  label: 'عرض التفاصيل وسجل الاستخدام',
                                  icon: <Eye className="h-3.5 w-3.5" />,
                                  onClick: () => void handleViewDetails(c.id),
                                },
                              ];
                              if (canManageCodes && c.status === 'AVAILABLE') {
                                menuItems.push({
                                  id: 'disable',
                                  label: 'تعطيل مؤقت حتى تاريخ',
                                  icon: <PauseCircle className="h-3.5 w-3.5" />,
                                  disabled: busyAction,
                                  onClick: () =>
                                    setDisableModal({ code: c, until: defaultDisableUntil(), note: '' }),
                                });
                              }
                              if (canManageCodes && c.status === 'DISABLED') {
                                menuItems.push({
                                  id: 'reactivate',
                                  label: 'إعادة تفعيل الكود',
                                  icon: <PlayCircle className="h-3.5 w-3.5" />,
                                  tone: 'success',
                                  disabled: busyAction,
                                  onClick: () => void handleReactivateCode(c.id),
                                });
                              }
                              if (canManageCodes && unused && c.status === 'AVAILABLE') {
                                menuItems.push({
                                  id: 'cancel',
                                  label: 'إلغاء كود غير مستخدم',
                                  icon: <Ban className="h-3.5 w-3.5" />,
                                  disabled: busyAction,
                                  onClick: () => void handleCancelUnused(c.id),
                                });
                              }
                              if (canManageCodes && unused) {
                                menuItems.push({
                                  id: 'delete',
                                  label: 'حذف نهائي (غير مستخدم)',
                                  icon: <Trash2 className="h-3.5 w-3.5" />,
                                  tone: 'danger',
                                  disabled: busyAction,
                                  onClick: () => void handleDeleteUnusedCode(c.id),
                                });
                              }
                              if (canManageCodes && c.usedCount > 0 && c.status !== 'REVOKED') {
                                menuItems.push({
                                  id: 'revoke',
                                  label: 'سحب الكود وإلغاء الصلاحية',
                                  icon: <ShieldBan className="h-3.5 w-3.5" />,
                                  tone: 'danger',
                                  disabled: busyAction,
                                  onClick: () => void handleRevokeCode(c.id, true),
                                });
                              }

                              return (
                                <tr key={c.id} className="transition-colors hover:bg-slate-50/70">
                                  <td className="px-4 py-3">
                                    <span
                                      dir="ltr"
                                      className="inline-block rounded-lg bg-slate-100 px-2 py-1 font-mono-num text-xs font-extrabold text-[#0F172A]"
                                    >
                                      {c.codePrefix}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="font-bold text-[#0F172A]">{c.batchLabel}</div>
                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                      {c.targetTitleAr ||
                                        (c.targetType === 'PLATFORM_ACCESS'
                                          ? 'اشتراك دخول المنصة فقط'
                                          : c.targetType)}{' '}
                                      · {formatDateAr(c.createdAt)}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 font-mono-num font-bold text-slate-700 whitespace-nowrap">
                                    {c.durationDays} يومًا
                                  </td>
                                  <td className="px-4 py-3 font-mono-num font-bold text-slate-700 whitespace-nowrap">
                                    {c.usedCount} / {c.maxUses}
                                  </td>
                                  <td className="px-4 py-3">
                                    <AdminStatusBadge tone={st.tone}>{st.label}</AdminStatusBadge>
                                    {c.status === 'DISABLED' && c.disabledUntil && (
                                      <div className="mt-1 text-[10px] font-medium text-amber-800">
                                        حتى {formatDateTimeAr(c.disabledUntil)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-left">
                                    <AdminActionMenu items={menuItems} ariaLabel={`إجراءات الكود ${c.codePrefix}`} />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Footer */}
                    {filteredCodes.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs">
                        <span className="font-medium text-slate-500">
                          عرض <strong className="font-mono-num text-[#0F172A]">{(safeCodePage - 1) * codesPageSize + 1}</strong>–
                          <strong className="font-mono-num text-[#0F172A]">
                            {Math.min(safeCodePage * codesPageSize, filteredCodes.length)}
                          </strong>{' '}
                          من <strong className="font-mono-num text-[#0F172A]">{filteredCodes.length}</strong> كود
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={safeCodePage <= 1}
                            onClick={() => setCodePage((p) => Math.max(1, p - 1))}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                            <span>السابق</span>
                          </button>
                          <span className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 font-mono-num font-bold text-white">
                            {safeCodePage}
                          </span>
                          <button
                            type="button"
                            disabled={safeCodePage >= totalCodePages}
                            onClick={() => setCodePage((p) => Math.min(totalCodePages, p + 1))}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                          >
                            <span>التالي</span>
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </AdminCard>

                  {/* Compact Activated Subscriptions Preview under Platform tab */}
                  {codeSectionTab === 'PLATFORM' && (
                    <AdminCard padding="none" className="overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
                        <div>
                          <h3 className="text-sm font-extrabold text-[#0F172A]">
                            الاشتراكات المفعّلة ({platformSubs.length})
                          </h3>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            متابعة تاريخ التفعيل والانتهاء والمدة المتبقية لكل طالب.
                          </p>
                        </div>
                        {platformSubs.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setCodeSectionTab('SUBSCRIPTIONS')}
                            className="text-xs font-bold text-[#2563EB] hover:underline"
                          >
                            عرض كل الاشتراكات ({platformSubs.length})
                          </button>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                            <tr>
                              <th className="px-4 py-2.5">الطالب</th>
                              <th className="px-4 py-2.5">التفعيل</th>
                              <th className="px-4 py-2.5">الانتهاء</th>
                              <th className="px-4 py-2.5">المتبقي</th>
                              <th className="px-4 py-2.5">الحالة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {platformSubs.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                                  لم يتم تفعيل أي اشتراك منصة بأكواد المنصة بعد.
                                </td>
                              </tr>
                            ) : (
                              platformSubs.slice(0, 5).map((s) => (
                                <tr key={s.id} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-2.5">
                                    <div className="font-bold text-[#0F172A]">{s.studentName}</div>
                                    <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                                      {s.studentPhone}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-600">{formatDateAr(s.startsAt)}</td>
                                  <td className="px-4 py-2.5 text-slate-600">{formatDateAr(s.expiresAt)}</td>
                                  <td className="px-4 py-2.5 font-mono-num font-bold text-[#0F172A]">
                                    {s.isActive ? `${s.remainingDays} يوم` : '0 يوم'}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <AdminStatusBadge
                                      tone={
                                        s.status === 'ACTIVE'
                                          ? 'emerald'
                                          : s.status === 'EXPIRED'
                                            ? 'amber'
                                            : 'rose'
                                      }
                                    >
                                      {s.status === 'ACTIVE'
                                        ? 'نشط'
                                        : s.status === 'EXPIRED'
                                          ? 'منتهي'
                                          : 'ملغي'}
                                    </AdminStatusBadge>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </AdminCard>
                  )}
                </>
              ) : (
                /* Full Activated Platform Subscriptions View */
                <AdminCard padding="none" className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">
                        اشتراكات المنصة المفعّلة للطلاب ({filteredSubs.length})
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        فصل كامل بين اشتراك دخول المنصة وبين الكورسات والفيديوهات المدفوعة.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={subSearch}
                        onChange={(e) => setSubSearch(e.target.value)}
                        placeholder="ابحث باسم الطالب أو الهاتف..."
                        className="h-9 w-48 rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-[#0F172A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
                      />
                      <select
                        value={subStatusFilter}
                        onChange={(e) => setSubStatusFilter(e.target.value)}
                        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
                      >
                        <option value="ALL">كل الحالات</option>
                        <option value="ACTIVE">نشط</option>
                        <option value="EXPIRED">منتهي الصلاحية</option>
                        <option value="REVOKED">ملغي</option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                        <tr>
                          <th className="px-4 py-3">الطالب</th>
                          <th className="px-4 py-3">مرجع الكود</th>
                          <th className="px-4 py-3">التفعيل والانتهاء</th>
                          <th className="px-4 py-3">المتبقي</th>
                          <th className="px-4 py-3">الحالة والنطاق</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredSubs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6">
                              <AdminEmptyState
                                icon={<Users className="h-5 w-5" />}
                                title="لا توجد اشتراكات مطابقة"
                                description="لم يتم تفعيل اشتراكات منصة مطابقة لخيارات البحث الحالية."
                              />
                            </td>
                          </tr>
                        ) : (
                          filteredSubs.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-50/60">
                              <td className="px-4 py-3">
                                <div className="font-bold text-[#0F172A]">{s.studentName}</div>
                                <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                                  {s.studentPhone}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono-num font-bold text-slate-700" dir="ltr">
                                {s.codePrefix}
                              </td>
                              <td className="px-4 py-3 text-[11px] text-slate-600">
                                <div>بداية: {formatDateAr(s.startsAt)}</div>
                                <div>انتهاء: {formatDateAr(s.expiresAt)}</div>
                              </td>
                              <td className="px-4 py-3 font-mono-num font-extrabold text-[#0F172A]">
                                {s.isActive ? `${s.remainingDays} يوم` : '0 يوم'}
                              </td>
                              <td className="px-4 py-3">
                                <AdminStatusBadge
                                  tone={
                                    s.status === 'ACTIVE'
                                      ? 'emerald'
                                      : s.status === 'EXPIRED'
                                        ? 'amber'
                                        : 'rose'
                                  }
                                >
                                  {s.status === 'ACTIVE'
                                    ? 'نشط'
                                    : s.status === 'EXPIRED'
                                      ? 'منتهي الصلاحية'
                                      : 'ملغي'}
                                </AdminStatusBadge>
                                <div className="mt-1 text-[10px] text-slate-500">{s.accessScopeAr}</div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </AdminCard>
              )}
            </div>
          }
          detail={
            canManageCodes ? (
              !isContentMode ? (
                /* Sticky Platform Subscription Code Generator */
                <form
                  ref={generatorRef}
                  onSubmit={handleGeneratePlatformBatch}
                  className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4"
                >
                  <div>
                    <h3 className="text-base font-extrabold text-[#0F172A]">توليد أكواد اشتراك المنصة</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      يفتح اشتراك المنصة لمدة محددة، ولا يفتح المحتوى المدفوع تلقائيًا.
                    </p>
                  </div>

                  {/* Duration Presets */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: '30', label: '30 يومًا' },
                      { id: '60', label: '60 يومًا' },
                      { id: '365', label: '365 يومًا' },
                      { id: 'CUSTOM', label: 'مدة مخصصة' },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setPlatformGen((prev) => ({
                            ...prev,
                            durationPreset: preset.id as typeof prev.durationPreset,
                            batchLabel:
                              preset.id === '30'
                                ? 'دفعة اشتراك المنصة الشهري'
                                : preset.id === '60'
                                  ? 'دفعة اشتراك المنصة - شهرين'
                                  : preset.id === '365'
                                    ? 'دفعة اشتراك المنصة السنوي'
                                    : prev.batchLabel,
                          }))
                        }
                        className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
                          platformGen.durationPreset === preset.id
                            ? 'border-[#2563EB] bg-[#2563EB] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {platformGen.durationPreset === 'CUSTOM' && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">عدد الأيام المخصص</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        value={platformGen.customDays}
                        onChange={(e) =>
                          setPlatformGen({
                            ...platformGen,
                            customDays: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">عدد الأكواد</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        value={platformGen.quantity}
                        onChange={(e) =>
                          setPlatformGen({
                            ...platformGen,
                            quantity: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">مرات الاستخدام</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={platformGen.maxUses}
                        onChange={(e) =>
                          setPlatformGen({
                            ...platformGen,
                            maxUses: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">اسم الدفعة</label>
                    <input
                      type="text"
                      value={platformGen.batchLabel}
                      onChange={(e) => setPlatformGen({ ...platformGen, batchLabel: e.target.value })}
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-medium focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">البادئة</label>
                    <input
                      type="text"
                      dir="ltr"
                      maxLength={6}
                      value={platformGen.prefix}
                      onChange={(e) => setPlatformGen({ ...platformGen, prefix: e.target.value.toUpperCase() })}
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left font-mono-num text-sm font-bold focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={generating}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
                  >
                    <KeyRound className="h-4 w-4" />
                    <span>{generating ? 'جارٍ التوليد الآمن...' : 'توليد الأكواد'}</span>
                  </button>
                </form>
              ) : (
                /* Sticky Content (Videos / Courses / Grade) Code Generator */
                <form
                  ref={generatorRef}
                  onSubmit={handleGenerateContentBatch}
                  className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4"
                >
                  <div>
                    <h3 className="text-base font-extrabold text-[#0F172A]">توليد أكواد المحتوى</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      تشفير SHA-256 + Pepper؛ تظهر الأكواد كاملة مرة واحدة فقط بعد التوليد للنسخ أو الطباعة.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">نوع المحتوى</label>
                    <select
                      value={genForm.targetType}
                      onChange={(e) =>
                        handleTargetTypeChange(e.target.value as 'VIDEO' | 'COURSE' | 'GRADE_ALL')
                      }
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="VIDEO">فيديو مدفوع محدد</option>
                      <option value="COURSE">كورس كامل</option>
                      <option value="GRADE_ALL">كل محتوى صف دراسي</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">المحتوى المستهدف</label>
                    <select
                      value={genForm.targetId}
                      onChange={(e) => setGenForm({ ...genForm, targetId: Number(e.target.value) })}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:border-[#2563EB] focus:outline-none"
                    >
                      {genForm.targetType === 'VIDEO' &&
                        catalog.videos.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.titleAr} ({v.videoType === 'FREE' ? 'مجاني' : `${v.priceEgp} ج.م`})
                          </option>
                        ))}
                      {genForm.targetType === 'COURSE' &&
                        catalog.courses
                          .filter((c) => c.publicationStatus !== 'REMOVED')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.titleAr} ({c.discountPriceEgp} ج.م)
                            </option>
                          ))}
                      {genForm.targetType === 'GRADE_ALL' &&
                        catalog.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nameAr}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">عدد الأكواد</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        value={genForm.quantity}
                        onChange={(e) =>
                          setGenForm({
                            ...genForm,
                            quantity: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">مدة التفعيل (أيام)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={genForm.durationDays}
                        onChange={(e) =>
                          setGenForm({
                            ...genForm,
                            durationDays: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">مرات الاستخدام</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={genForm.maxUses}
                        onChange={(e) =>
                          setGenForm({
                            ...genForm,
                            maxUses: sanitizeNumericInputValue(e.target.value, { allowDecimal: false }),
                          })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">البادئة</label>
                      <input
                        type="text"
                        dir="ltr"
                        maxLength={6}
                        value={genForm.prefix}
                        onChange={(e) => setGenForm({ ...genForm, prefix: e.target.value.toUpperCase() })}
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left font-mono-num text-sm font-bold focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">اسم الدفعة</label>
                    <input
                      type="text"
                      value={genForm.batchLabel}
                      onChange={(e) => setGenForm({ ...genForm, batchLabel: e.target.value })}
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-medium focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={generating}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
                  >
                    <KeyRound className="h-4 w-4" />
                    <span>{generating ? 'جارٍ التوليد الآمن...' : 'توليد دفعة أكواد المحتوى'}</span>
                  </button>
                </form>
              )
            ) : (
              <AdminCard>
                <div className="flex items-start gap-2.5 text-xs text-slate-600">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                  <div>
                    <div className="font-bold text-[#0F172A]">وضع العرض فقط</div>
                    <p className="mt-1 leading-relaxed">
                      صلاحياتك الحالية تسمح بمتابعة سجل الأكواد دون توليد دفعات جديدة أو تعديل حالتها.
                    </p>
                  </div>
                </div>
              </AdminCard>
            )
          }
        />

        {/* Code Details & Redemption History Modal */}
        {detailModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تفاصيل الكود"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          >
            <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 className="text-base font-extrabold text-[#0F172A]">
                  تفاصيل الكود{' '}
                  <span className="font-mono-num text-[#2563EB]" dir="ltr">
                    {detailModal.code.codePrefix}
                  </span>
                </h4>
                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  aria-label="إغلاق"
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                <div>
                  <span className="text-slate-500">الدفعة:</span>{' '}
                  <strong className="text-[#0F172A]">{detailModal.code.batchLabel}</strong>
                </div>
                <div>
                  <span className="text-slate-500">المدة:</span>{' '}
                  <strong className="font-mono-num">{detailModal.code.durationDays} يوم</strong>
                </div>
                <div>
                  <span className="text-slate-500">الاستخدام:</span>{' '}
                  <strong className="font-mono-num">
                    {detailModal.code.usedCount} / {detailModal.code.maxUses}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">الحالة:</span>{' '}
                  <strong>{CODE_STATUS_META[detailModal.code.status]?.label || detailModal.code.status}</strong>
                </div>
                {detailModal.code.statusNote && (
                  <div className="col-span-2 text-slate-600">
                    ملاحظة الحالة: {detailModal.code.statusNote}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-extrabold text-[#0F172A]">
                  سجل الاستخدام ({detailModal.redemptions.length})
                </h5>
                {detailModal.redemptions.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500">
                    لم يتم استخدام هذا الكود من قِبل أي طالب حتى الآن.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {detailModal.redemptions.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-3 text-xs">
                        <div>
                          <div className="font-bold text-[#0F172A]">{r.studentName}</div>
                          <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                            {r.studentPhone || '—'}
                          </div>
                        </div>
                        <span className="text-[11px] text-slate-500">{formatDateTimeAr(r.redeemedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Temporary Disable Until Chosen Date Modal */}
        {disableModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تعطيل الكود مؤقتًا"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          >
            <form
              onSubmit={handleSubmitDisable}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2 text-amber-800">
                <CalendarClock className="h-5 w-5" />
                <h4 className="text-base font-extrabold">تعطيل الكود مؤقتًا حتى تاريخ محدد</h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                الكود{' '}
                <strong className="font-mono-num" dir="ltr">
                  {disableModal.code.codePrefix}
                </strong>{' '}
                سيتم رفض تفعيله حتى الموعد الذي تحدده، أو يمكنك إعادة تفعيله يدويًا في أي وقت.
              </p>
              <label className="block space-y-1 text-xs font-bold text-slate-700">
                <span>معطّل حتى تاريخ ووقت</span>
                <input
                  type="datetime-local"
                  required
                  value={disableModal.until}
                  onChange={(e) => setDisableModal({ ...disableModal, until: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono-num"
                />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>سبب التعطيل المؤقت (اختياري)</span>
                <input
                  type="text"
                  value={disableModal.note}
                  onChange={(e) => setDisableModal({ ...disableModal, note: e.target.value })}
                  placeholder="مثال: لحين مراجعة دفعة السنتر"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDisableModal(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  تأكيد التعطيل المؤقت
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // SCREEN 07: PAYMENTS & ORDERS
  // =========================================================================
  const hasOrderFilters = Boolean(orderSearch.trim() || orderMethodFilter !== 'ALL' || orderTab !== 'ALL');

  return (
    <div className="space-y-5" data-testid="admin-payments-panel">
      <AdminPageHeader
        title="المدفوعات والطلبات"
        subtitle="مراجعة طلبات الدفع والإيصالات وتأكيد التحويلات قبل فتح المحتوى."
        icon={<CreditCard className="h-5 w-5" />}
      />

      {/* 3 Real KPI Cards */}
      <AdminKpiGrid cols={3}>
        <AdminKpiCard
          label="الإيرادات المؤكدة"
          value={`${orderStats.paidTotal.toLocaleString('en-US')} ج.م`}
          subtitle="الطلبات المعتمدة فقط"
          tone="emerald"
          icon={<Wallet className="h-5 w-5" />}
          onClick={() => {
            setOrderTab('PAID');
            setOrderPage(1);
          }}
        />
        <AdminKpiCard
          label="طلبات بانتظار المراجعة"
          value={orderStats.pendingCount}
          subtitle="تحتاج إلى قرار"
          tone="amber"
          icon={<Clock className="h-5 w-5" />}
          onClick={() => {
            setOrderTab('PENDING');
            setOrderPage(1);
          }}
        />
        <AdminKpiCard
          label="إجمالي الطلبات"
          value={orders.length}
          subtitle="جميع الحالات"
          tone="blue"
          icon={<FileText className="h-5 w-5" />}
          onClick={() => {
            setOrderTab('ALL');
            setOrderPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Segmented Status Tabs */}
      <AdminSegmentedTabs
        activeId={orderTab}
        onChange={(id) => {
          setOrderTab(id);
          setOrderPage(1);
        }}
        items={[
          { id: 'ALL', label: 'كل الطلبات', count: orders.length },
          { id: 'PENDING', label: 'بانتظار المراجعة', count: orderStats.pendingCount },
          { id: 'PAID', label: 'مؤكدة', count: orderStats.paidCount },
          { id: 'FAILED', label: 'مرفوضة', count: orderStats.failedCount },
        ]}
      />

      {/* Filter Bar */}
      <AdminFilterBar
        searchValue={orderSearch}
        onSearchChange={(val) => {
          setOrderSearch(val);
          setOrderPage(1);
        }}
        searchPlaceholder="ابحث برقم الطلب أو الطالب أو المرجع..."
        hasActiveFilters={hasOrderFilters}
        onReset={() => {
          setOrderSearch('');
          setOrderMethodFilter('ALL');
          setOrderTab('ALL');
          setOrderPage(1);
        }}
      >
        <select
          value={orderMethodFilter}
          onChange={(e) => {
            setOrderMethodFilter(e.target.value);
            setOrderPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus:border-[#2563EB] focus:outline-none"
        >
          <option value="ALL">كل طرق الدفع</option>
          {orderStats.methods.map((m) => (
            <option key={m} value={m}>
              {formatPaymentMethod(m)}
            </option>
          ))}
        </select>
      </AdminFilterBar>

      {/* Master-Detail Workspace: Orders Table (8 cols) + Sticky Order Review Panel (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-extrabold text-[#0F172A]">طلبات الدفع</h3>
              <span className="font-mono-num text-xs font-semibold text-slate-500">
                {filteredOrders.length} طلب
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">رقم الطلب</th>
                    <th className="px-4 py-3">الطالب</th>
                    <th className="px-4 py-3">المحتوى</th>
                    <th className="px-4 py-3">المبلغ</th>
                    <th className="px-4 py-3">الطريقة</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3 text-left">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">
                        جارٍ تحميل الطلبات...
                      </td>
                    </tr>
                  ) : paginatedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6">
                        <AdminEmptyState
                          icon={<CreditCard className="h-5 w-5" />}
                          title="لا توجد طلبات دفع مطابقة"
                          description="ستظهر هنا طلبات الدفع الجديدة فور إرسالها من بوابة الطالب."
                        />
                      </td>
                    </tr>
                  ) : (
                    paginatedOrders.map((o) => {
                      const st = ORDER_STATUS_META[o.status] || { label: o.status, tone: 'slate' as AdminTone };
                      const isPending = o.status === 'UNDER_REVIEW' || o.status === 'PENDING';
                      const isSelected = selectedOrder?.id === o.id;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => setSelectedOrderId(o.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="px-4 py-3 font-mono-num font-bold text-[#0F172A]" dir="ltr">
                            {o.orderNumber}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-[#0F172A]">{o.studentName}</div>
                            <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                              {o.studentPhone || '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700 max-w-[180px] truncate">
                            {o.targetTitleAr}
                          </td>
                          <td className="px-4 py-3 font-mono-num font-extrabold text-[#0F172A] whitespace-nowrap">
                            {o.finalAmountEgp.toLocaleString('en-US')} ج.م
                          </td>
                          <td className="px-4 py-3">
                            <AdminStatusBadge tone="purple">
                              {formatPaymentMethod(o.paymentMethod)}
                            </AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3">
                            <AdminStatusBadge tone={st.tone}>{st.label}</AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3 text-left">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrderId(o.id);
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                                isPending
                                  ? 'border-blue-200 bg-blue-50 text-[#2563EB] hover:bg-blue-100'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {!isPending && <Eye className="h-3 w-3" />}
                              <span>{isPending ? 'مراجعة' : 'معاينة'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredOrders.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs">
                <span className="font-medium text-slate-500">
                  عرض <strong className="font-mono-num text-[#0F172A]">{(safeOrderPage - 1) * ordersPageSize + 1}</strong>–
                  <strong className="font-mono-num text-[#0F172A]">
                    {Math.min(safeOrderPage * ordersPageSize, filteredOrders.length)}
                  </strong>{' '}
                  من <strong className="font-mono-num text-[#0F172A]">{filteredOrders.length}</strong> عنصر
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safeOrderPage <= 1}
                    onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>السابق</span>
                  </button>
                  <span className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 font-mono-num font-bold text-white">
                    {safeOrderPage}
                  </span>
                  <button
                    type="button"
                    disabled={safeOrderPage >= totalOrderPages}
                    onClick={() => setOrderPage((p) => Math.min(totalOrderPages, p + 1))}
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
          selectedOrder ? (
            <AdminCard className="space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  مراجعة الطلب{' '}
                  <span className="font-mono-num text-[#2563EB]" dir="ltr">
                    {selectedOrder.orderNumber}
                  </span>
                </h3>
                <AdminStatusBadge
                  tone={ORDER_STATUS_META[selectedOrder.status]?.tone || 'slate'}
                >
                  {ORDER_STATUS_META[selectedOrder.status]?.label || selectedOrder.status}
                </AdminStatusBadge>
              </div>

              {/* Amount & Target Card */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#2563EB]">
                  <CreditCard className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="font-mono-num text-lg font-extrabold text-[#0F172A]">
                    {selectedOrder.finalAmountEgp.toLocaleString('en-US')} ج.م
                  </div>
                  <div className="truncate text-xs font-medium text-slate-500">
                    {selectedOrder.targetTitleAr}
                  </div>
                </div>
              </div>

              {/* Metadata rows */}
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">الطالب</span>
                  <div className="text-left">
                    <div className="font-bold text-[#0F172A]">{selectedOrder.studentName}</div>
                    {selectedOrder.studentPhone && (
                      <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                        {selectedOrder.studentPhone}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">طريقة الدفع</span>
                  <span className="font-bold text-[#0F172A]">
                    {formatPaymentMethod(selectedOrder.paymentMethod)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">تاريخ الطلب</span>
                  <span className="font-medium text-slate-700">
                    {formatDateTimeAr(selectedOrder.createdAt)}
                  </span>
                </div>
                {selectedOrder.discountEgp > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">الخصم المطبّق</span>
                    <span className="font-mono-num font-bold text-emerald-700">
                      -{selectedOrder.discountEgp} ج.م
                    </span>
                  </div>
                )}
              </div>

              {/* Transfer / Receipt Data Box */}
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5 text-xs">
                <div className="font-bold text-slate-700">بيانات التحويل والإيصال</div>
                {selectedOrder.payment?.providerRef ? (
                  <div className="font-mono-num font-bold text-[#0F172A]" dir="ltr">
                    Ref: {selectedOrder.payment.providerRef}
                  </div>
                ) : null}
                <p className="leading-relaxed text-slate-600">
                  {selectedOrder.payment?.receiptNote || 'لم يرفق الطالب ملاحظة أو رقم عملية إضافي.'}
                </p>
              </div>

              {/* Security Notice */}
              <div className="flex items-start gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 p-3 text-[11px] font-semibold leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>لا يتم فتح المحتوى إلا بعد التحقق من التحويل واعتماد الطلب أو استلام Webhook موثّق.</span>
              </div>

              {/* Real Action Controls */}
              {selectedOrder.status === 'PAID' ? (
                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-extrabold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>تم تأكيد الدفع وفتح المحتوى للطالب</span>
                </div>
              ) : selectedOrder.status === 'FAILED' || selectedOrder.status === 'CANCELLED' ? (
                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-xs font-extrabold text-rose-700">
                  <XCircle className="h-4 w-4" />
                  <span>تم رفض الطلب</span>
                </div>
              ) : canVerifyPayments ? (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleVerifyOrder(selectedOrder.id)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-55"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>تأكيد وفتح المحتوى</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleRejectOrder(selectedOrder.id)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-55"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>رفض الطلب</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-center text-xs font-semibold text-slate-600">
                  بانتظار مراجعة صاحب صلاحية تأكيد المدفوعات
                </div>
              )}
            </AdminCard>
          ) : (
            <AdminCard>
              <AdminEmptyState
                icon={<CreditCard className="h-5 w-5" />}
                title="اختر طلبًا للمراجعة"
                description="اضغط على أي طلب من الجدول لعرض تفاصيل التحويل واتخاذ القرار."
              />
            </AdminCard>
          )
        }
      />
    </div>
  );
};
