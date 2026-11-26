import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Eye,
  PlayCircle,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr, formatDurationAr } from '../../lib/api.ts';
import type { AdminVideoRecord } from './AdminContentPanel.tsx';
import { AdminStatusBadge } from './AdminUiPrimitives.tsx';

interface VideoViewerItem {
  userId: number;
  fullName: string;
  phone: string | null;
  gradeNameAr: string;
  watchedSec: number;
  watchedMinutes: number;
  watchedDurationLabelAr: string;
  lastPositionSec: number;
  completionPercent: number;
  isCompleted: boolean;
  countedOpens: number;
  lastWatchedAt: string | null;
}

interface VideoViewersResponse {
  video: {
    id: number;
    titleAr: string;
    durationSec: number;
    viewsCount: number;
  };
  summary: {
    uniqueViewers: number;
    completedCount: number;
    inProgressCount: number;
    totalWatchedSec: number;
    totalWatchedMinutes: number;
    averageCompletionPercent: number;
    viewsCount: number;
  };
  viewers: VideoViewerItem[];
}

interface AdminVideoViewersModalProps {
  video: AdminVideoRecord | null;
  onClose: () => void;
}

export const AdminVideoViewersModal: React.FC<AdminVideoViewersModalProps> = ({
  video,
  onClose,
}) => {
  const [data, setData] = useState<VideoViewersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'IN_PROGRESS'>('ALL');

  const loadViewers = useCallback(async () => {
    if (!video) return;
    setLoading(true);
    setError('');
    try {
      const resp = await apiRequest<VideoViewersResponse>(`/api/admin/videos/${video.id}/viewers`);
      setData(resp);
    } catch (err) {
      setError((err as Error).message || 'تعذر تحميل قائمة المشاهدين');
    } finally {
      setLoading(false);
    }
  }, [video]);

  useEffect(() => {
    if (!video) return;
    setSearch('');
    setStatusFilter('ALL');
    void loadViewers();
  }, [video, loadViewers]);

  const filteredViewers = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.viewers.filter((v) => {
      if (statusFilter === 'COMPLETED' && !v.isCompleted) return false;
      if (statusFilter === 'IN_PROGRESS' && v.isCompleted) return false;
      if (q) {
        const hay = `${v.fullName} ${v.phone || ''} ${v.gradeNameAr}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, statusFilter]);

  if (!video) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-viewers-modal-title"
      data-testid="video-viewers-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-4 overflow-y-auto"
    >
      <div className="my-auto flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="video-viewers-modal-title"
                className="truncate text-base font-extrabold text-[#0F172A]"
              >
                مشاهدو الفيديو وإحصائيات المشاهدة
              </h3>
              <p className="truncate text-xs text-slate-500">
                {video.titleAr}
                {video.durationSec > 0 ? ` · المدة: ${formatDurationAr(video.durationSec)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="تحديث قائمة المشاهدين"
              onClick={() => void loadViewers()}
              disabled={loading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              aria-label="إغلاق نافذة المشاهدين"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* KPI Summary Row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Users className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>الطلاب المشاهدون</span>
              </div>
              <div className="mt-1 font-mono-num text-xl font-extrabold text-[#0F172A] tabular-nums">
                {data?.summary.uniqueViewers ?? 0}
              </div>
              <div className="text-[10px] text-slate-400">
                إجمالي التشغيلات: {data?.summary.viewsCount ?? video.viewsCount}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Clock className="h-3.5 w-3.5 text-indigo-600" />
                <span>إجمالي الدقائق الفعلية</span>
              </div>
              <div className="mt-1 font-mono-num text-xl font-extrabold text-indigo-700 tabular-nums">
                {data?.summary.totalWatchedMinutes ?? 0}{' '}
                <span className="text-xs font-bold">دقيقة</span>
              </div>
              <div className="text-[10px] text-slate-400">وقت مشاهدة فعلي مسجّل</div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <span>متوسط نسبة الإكمال</span>
              </div>
              <div className="mt-1 font-mono-num text-xl font-extrabold text-emerald-700 tabular-nums">
                {data?.summary.averageCompletionPercent ?? 0}%
              </div>
              <div className="text-[10px] text-slate-400">بين جميع المشاهدين</div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>أكملوا الفيديو</span>
              </div>
              <div className="mt-1 font-mono-num text-xl font-extrabold text-[#0F172A] tabular-nums">
                {data?.summary.completedCount ?? 0}
              </div>
              <div className="text-[10px] text-slate-400">
                قيد المشاهدة: {data?.summary.inProgressCount ?? 0}
              </div>
            </div>
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث باسم الطالب أو رقم الهاتف..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(
                [
                  { id: 'ALL', label: `الكل (${data?.summary.uniqueViewers ?? 0})` },
                  { id: 'COMPLETED', label: `مكتمل (${data?.summary.completedCount ?? 0})` },
                  { id: 'IN_PROGRESS', label: `قيد المشاهدة (${data?.summary.inProgressCount ?? 0})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-[#2563EB] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error / Loading / Table */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700"
            >
              {error}
            </div>
          )}

          {loading && !data ? (
            <div className="flex items-center justify-center py-12 text-xs font-semibold text-slate-500">
              جارٍ تحميل بيانات مشاهدي الفيديو...
            </div>
          ) : filteredViewers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-xs">
                <Eye className="h-6 w-6" />
              </div>
              <h4 className="mt-3 text-sm font-extrabold text-[#0F172A]">
                {data && data.viewers.length > 0
                  ? 'لا توجد نتائج مطابقة للبحث'
                  : 'لم يشاهد أي طالب هذا الفيديو بعد'}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                بمجرد تشغيل الطلاب للفيديو، ستظهر هنا أسماؤهم مع الدقائق الفعلية للمشاهدة ونسبة إكمال كل طالب بدقة.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                  <tr>
                    <th className="px-3.5 py-3">الطالب</th>
                    <th className="px-3.5 py-3">الصف الدراسي</th>
                    <th className="px-3.5 py-3">الدقائق الفعلية للمشاهدة</th>
                    <th className="px-3.5 py-3">نسبة الإكمال</th>
                    <th className="px-3.5 py-3">مرات الفتح</th>
                    <th className="px-3.5 py-3">آخر مشاهدة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredViewers.map((viewer) => (
                    <tr key={viewer.userId} className="hover:bg-slate-50/70">
                      <td className="px-3.5 py-3">
                        <div className="font-extrabold text-[#0F172A]">{viewer.fullName}</div>
                        <div dir="ltr" className="mt-0.5 font-mono-num text-[11px] text-slate-500 text-right">
                          {viewer.phone || '—'}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 text-slate-600">{viewer.gradeNameAr}</td>
                      <td className="px-3.5 py-3">
                        <div className="inline-flex items-center gap-1.5 font-mono-num font-extrabold text-[#0F172A] tabular-nums">
                          <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                          <span>{viewer.watchedMinutes} دقيقة</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          المدة المسجلة: {viewer.watchedDurationLabelAr}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 min-w-[165px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-num font-extrabold text-[#0F172A] tabular-nums">
                            {viewer.completionPercent}%
                          </span>
                          <AdminStatusBadge tone={viewer.isCompleted ? 'emerald' : 'blue'}>
                            {viewer.isCompleted ? 'مكتمل' : 'قيد المشاهدة'}
                          </AdminStatusBadge>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all ${
                              viewer.isCompleted ? 'bg-emerald-500' : 'bg-[#2563EB]'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, viewer.completionPercent))}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="inline-flex items-center gap-1 font-mono-num font-bold text-slate-700 tabular-nums">
                          <PlayCircle className="h-3.5 w-3.5 text-slate-400" />
                          {viewer.countedOpens > 0 ? viewer.countedOpens : 1}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-[11px] text-slate-500">
                        {viewer.lastWatchedAt ? formatDateTimeAr(viewer.lastWatchedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            تُحتسب الدقائق الفعلية من سجل المشاهدة الحقيقي للطالب دون احتساب التقديم اليدوي.
          </span>
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
