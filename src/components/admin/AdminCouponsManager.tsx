import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Edit3, Eye, Plus, Power, Tag, Trash2, X } from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../../lib/api.ts';

interface CouponRow {
  id: number;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountPercent: number;
  discountAmountEgp: number;
  maxUses: number;
  usedCount: number;
  remainingUses: number;
  expiresAt: string | null;
  eligibleCourseIdsJson: number[];
  eligibleCourseTitles: string[];
  isActive: boolean;
  isArchived: boolean;
  derivedStatus: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED' | 'ARCHIVED';
  createdAt: string;
}

interface CouponUsageResponse {
  coupon: CouponRow & { canDeletePermanently: boolean };
  usages: Array<{
    orderId: number;
    orderNumber: string;
    userId: number;
    studentName: string;
    studentPhone: string | null;
    targetTitleAr: string;
    amountEgp: number;
    discountEgp: number;
    finalAmountEgp: number;
    status: string;
    createdAt: string;
  }>;
}

interface AdminCouponsManagerProps {
  courses: Array<{ id: number; titleAr: string }>;
  onChanged: () => Promise<void>;
  onToast: (msg: string) => void;
}

const STATUS_BADGE: Record<CouponRow['derivedStatus'], { label: string; cls: string }> = {
  ACTIVE: { label: 'نشط', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  INACTIVE: { label: 'متوقف', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  EXPIRED: { label: 'منتهي الصلاحية', cls: 'bg-red-50 text-red-700 border-red-200' },
  LIMIT_REACHED: { label: 'مكتمل الحد', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ARCHIVED: { label: 'مؤرشف', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
};

export const AdminCouponsManager: React.FC<AdminCouponsManagerProps> = ({
  courses,
  onChanged,
  onToast,
}) => {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Create / Edit modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponRow | null>(null);
  const [form, setForm] = useState({
    code: '',
    discountType: 'PERCENT' as 'PERCENT' | 'FIXED',
    discountPercent: 15,
    discountAmountEgp: 50,
    maxUses: 100,
    expiresAt: '',
    eligibleCourseIds: [] as number[],
    isActive: true,
  });

  // Usage Details Modal
  const [usageModal, setUsageModal] = useState<CouponUsageResponse | null>(null);

  const loadCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ coupons: CouponRow[] }>('/api/admin/manage/coupons');
      setCoupons(res.coupons);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  const openCreateModal = () => {
    setEditingCoupon(null);
    setForm({
      code: '',
      discountType: 'PERCENT',
      discountPercent: 15,
      discountAmountEgp: 50,
      maxUses: 100,
      expiresAt: '',
      eligibleCourseIds: [],
      isActive: true,
    });
    setEditorOpen(true);
  };

  const openEditModal = (cp: CouponRow) => {
    setEditingCoupon(cp);
    setForm({
      code: cp.code,
      discountType: cp.discountType === 'FIXED' ? 'FIXED' : 'PERCENT',
      discountPercent: cp.discountPercent || 15,
      discountAmountEgp: cp.discountAmountEgp || 50,
      maxUses: cp.maxUses,
      expiresAt: cp.expiresAt ? cp.expiresAt.slice(0, 10) : '',
      eligibleCourseIds: Array.isArray(cp.eligibleCourseIdsJson) ? cp.eligibleCourseIdsJson : [],
      isActive: cp.isActive,
    });
    setEditorOpen(true);
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        code: form.code,
        discountType: form.discountType,
        discountPercent: form.discountType === 'PERCENT' ? form.discountPercent : 0,
        discountAmountEgp: form.discountType === 'FIXED' ? form.discountAmountEgp : 0,
        maxUses: form.maxUses,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        eligibleCourseIds: form.eligibleCourseIds,
        isActive: form.isActive,
      };
      if (editingCoupon) {
        const res = await apiRequest<{ message: string }>(
          `/api/admin/manage/coupons/${editingCoupon.id}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
        );
        onToast(res.message);
      } else {
        const res = await apiRequest<{ message: string }>('/api/admin/manage/coupons', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(res.message);
      }
      setEditorOpen(false);
      await loadCoupons();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (cp: CouponRow) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/manage/coupons/${cp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !cp.isActive, isArchived: false }),
      });
      onToast(res.message);
      await loadCoupons();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveCoupon = async (cp: CouponRow) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/manage/coupons/${cp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: true, isActive: false }),
      });
      onToast(res.message);
      await loadCoupons();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCoupon = async (cp: CouponRow) => {
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/manage/coupons/${cp.id}`, {
        method: 'DELETE',
      });
      onToast(res.message);
      setUsageModal(null);
      await loadCoupons();
      await onChanged();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openUsageDetails = async (couponId: number) => {
    try {
      const res = await apiRequest<CouponUsageResponse>(
        `/api/admin/manage/coupons/${couponId}/usage`,
      );
      setUsageModal(res);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-extrabold text-[#0B162C]">
            <Tag className="h-4 w-4 text-[#2563EB]" />
            <span>إدارة كوبونات الخصم وتفاصيل الاستخدام</span>
          </h3>
          <p className="text-xs text-slate-500">
            إنشاء وتعديل وتعطيل وأرشفة الكوبونات ومتابعة الطلاب الذين استخدموا كل كوبون
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
        >
          <Plus className="h-4 w-4" />
          <span>إنشاء كوبون جديد</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
            <tr>
              <th className="p-3">كود الخصم</th>
              <th className="p-3">قيمة الخصم</th>
              <th className="p-3">الاستخدام / المتبقي</th>
              <th className="p-3">الصلاحية والكورسات</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  جارٍ تحميل الكوبونات...
                </td>
              </tr>
            ) : coupons.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  لا توجد كوبونات خصم مسجلة بعد.
                </td>
              </tr>
            ) : (
              coupons.map((cp) => {
                const badge = STATUS_BADGE[cp.derivedStatus] || STATUS_BADGE.INACTIVE;
                return (
                  <tr key={cp.id} className="hover:bg-slate-50/70">
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => void openUsageDetails(cp.id)}
                        className="font-mono-num text-sm font-extrabold text-[#2563EB] hover:underline"
                        dir="ltr"
                      >
                        {cp.code}
                      </button>
                    </td>
                    <td className="p-3 font-mono-num font-bold text-[#0B162C]">
                      {cp.discountType === 'FIXED'
                        ? `${cp.discountAmountEgp} ج.م ثابت`
                        : `${cp.discountPercent}%`}
                    </td>
                    <td className="p-3 font-mono-num">
                      {cp.usedCount} / {cp.maxUses}{' '}
                      <span className="text-slate-500">(متبقي {cp.remainingUses})</span>
                    </td>
                    <td className="p-3 text-slate-600">
                      <div>الانتهاء: {cp.expiresAt ? formatDateAr(cp.expiresAt) : 'بدون تاريخ انتهاء'}</div>
                      <div className="text-[11px] text-slate-500">
                        {cp.eligibleCourseTitles.length === 0
                          ? 'جميع الكورسات'
                          : cp.eligibleCourseTitles.join('، ')}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openUsageDetails(cp.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-semibold text-[#0B162C] hover:border-[#2563EB]"
                        >
                          <Eye className="h-3 w-3" />
                          <span>تفاصيل الاستخدام</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(cp)}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-[#2563EB] hover:bg-blue-100"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleToggleActive(cp)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Power className="h-3 w-3" />
                          <span>{cp.isActive && !cp.isArchived ? 'إيقاف' : 'تفعيل'}</span>
                        </button>
                        {cp.usedCount === 0 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteCoupon(cp)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>حذف</span>
                          </button>
                        ) : (
                          !cp.isArchived && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleArchiveCoupon(cp)}
                              className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              <Archive className="h-3 w-3" />
                              <span>أرشفة</span>
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Coupon Modal */}
      {editorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingCoupon ? 'تعديل كوبون الخصم' : 'إنشاء كوبون خصم جديد'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-extrabold text-[#0B162C]">
                {editingCoupon ? `تعديل الكوبون: ${editingCoupon.code}` : 'إنشاء كوبون خصم جديد'}
              </h4>
              <button type="button" onClick={() => setEditorOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleSaveCoupon} className="space-y-3 text-xs">
              <label className="block space-y-1 font-semibold text-slate-700">
                <span>
                  كود الخصم{' '}
                  {editingCoupon && editingCoupon.usedCount > 0 && (
                    <span className="text-amber-700">(لا يمكن تعديل الكود بعد استخدامه)</span>
                  )}
                </span>
                <input
                  type="text"
                  required
                  dir="ltr"
                  disabled={Boolean(editingCoupon && editingCoupon.usedCount > 0)}
                  placeholder="مثال: PHYSICS25"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-sm disabled:bg-slate-100"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 font-semibold text-slate-700">
                  <span>نوع الخصم</span>
                  <select
                    value={form.discountType}
                    onChange={(e) =>
                      setForm({ ...form, discountType: e.target.value as 'PERCENT' | 'FIXED' })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="PERCENT">نسبة مئوية (%)</option>
                    <option value="FIXED">مبلغ ثابت (ج.م)</option>
                  </select>
                </label>

                {form.discountType === 'PERCENT' ? (
                  <label className="space-y-1 font-semibold text-slate-700">
                    <span>نسبة الخصم (%)</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={form.discountPercent}
                      onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                    />
                  </label>
                ) : (
                  <label className="space-y-1 font-semibold text-slate-700">
                    <span>قيمة الخصم الثابت (ج.م)</span>
                    <input
                      type="number"
                      min={1}
                      max={50000}
                      required
                      value={form.discountAmountEgp}
                      onChange={(e) =>
                        setForm({ ...form, discountAmountEgp: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                    />
                  </label>
                )}

                <label className="space-y-1 font-semibold text-slate-700">
                  <span>الحد الأقصى للاستخدام</span>
                  <input
                    type="number"
                    min={editingCoupon ? Math.max(1, editingCoupon.usedCount) : 1}
                    required
                    value={form.maxUses}
                    onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                  />
                </label>

                <label className="space-y-1 font-semibold text-slate-700">
                  <span>تاريخ انتهاء الصلاحية (اختياري)</span>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-normal"
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700">
                  الكورسات المؤهلة (اتركها غير محددة ليسري الكوبون على جميع الكورسات)
                </div>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 p-2.5 space-y-1">
                  {courses.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={form.eligibleCourseIds.includes(c.id)}
                        onChange={() =>
                          setForm({
                            ...form,
                            eligibleCourseIds: form.eligibleCourseIds.includes(c.id)
                              ? form.eligibleCourseIds.filter((x) => x !== c.id)
                              : [...form.eligibleCourseIds, c.id],
                          })
                        }
                      />
                      <span>{c.titleAr}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 font-semibold text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span>الكوبون نشط ومتاح للاستخدام</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#2563EB] px-5 py-2 font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {editingCoupon ? 'حفظ تعديلات الكوبون' : 'إنشاء الكوبون'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Coupon Usage Details Modal */}
      {usageModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تفاصيل استخدام الكوبون"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-mono-num text-lg font-extrabold text-[#2563EB]" dir="ltr">
                    {usageModal.coupon.code}
                  </h4>
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-bold ${
                      (STATUS_BADGE[usageModal.coupon.derivedStatus] || STATUS_BADGE.INACTIVE).cls
                    }`}
                  >
                    {(STATUS_BADGE[usageModal.coupon.derivedStatus] || STATUS_BADGE.INACTIVE).label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  تاريخ الإنشاء: {formatDateAr(usageModal.coupon.createdAt)} · الانتهاء:{' '}
                  {usageModal.coupon.expiresAt ? formatDateAr(usageModal.coupon.expiresAt) : 'دائم'}
                </p>
              </div>
              <button type="button" onClick={() => setUsageModal(null)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                <div className="text-slate-500">قيمة الخصم</div>
                <div className="mt-1 font-mono-num text-sm font-extrabold text-[#0B162C]">
                  {usageModal.coupon.discountType === 'FIXED'
                    ? `${usageModal.coupon.discountAmountEgp} ج.م`
                    : `${usageModal.coupon.discountPercent}%`}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                <div className="text-slate-500">مرات الاستخدام</div>
                <div className="mt-1 font-mono-num text-sm font-extrabold text-[#0B162C]">
                  {usageModal.coupon.usedCount} / {usageModal.coupon.maxUses}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3">
                <div className="text-slate-500">الاستخدامات المتبقية</div>
                <div className="mt-1 font-mono-num text-sm font-extrabold text-[#2563EB]">
                  {usageModal.coupon.remainingUses}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-600">
              <strong>الكورسات المؤهلة:</strong>{' '}
              {usageModal.coupon.eligibleCourseTitles.length === 0
                ? 'جميع الكورسات'
                : usageModal.coupon.eligibleCourseTitles.join('، ')}
            </div>

            <div>
              <h5 className="text-sm font-extrabold text-[#0B162C]">
                سجل الطلاب والطلبات التي استخدمت هذا الكوبون ({usageModal.usages.length})
              </h5>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                    <tr>
                      <th className="p-2.5">الطالب</th>
                      <th className="p-2.5">المحتوى / الطلب</th>
                      <th className="p-2.5">الخصم / النهائي</th>
                      <th className="p-2.5">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usageModal.usages.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-5 text-center text-slate-500">
                          لم يستخدم أي طالب هذا الكوبون حتى الآن.
                        </td>
                      </tr>
                    ) : (
                      usageModal.usages.map((u) => (
                        <tr key={u.orderId}>
                          <td className="p-2.5">
                            <div className="font-bold text-[#0B162C]">{u.studentName}</div>
                            <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                              {u.studentPhone}
                            </div>
                          </td>
                          <td className="p-2.5">
                            <div className="font-semibold">{u.targetTitleAr}</div>
                            <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                              {u.orderNumber}
                            </div>
                          </td>
                          <td className="p-2.5 font-mono-num">
                            <span className="text-emerald-700">-{u.discountEgp} ج.م</span> ·{' '}
                            <strong>{u.finalAmountEgp} ج.م</strong>
                          </td>
                          <td className="p-2.5 text-slate-500">{formatDateTimeAr(u.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
