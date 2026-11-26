import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Laptop,
  Loader2,
  LogOut,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import {
  AdminCard,
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMasterDetail,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
} from './admin/AdminUiPrimitives.tsx';

interface OwnSessionItem {
  id: number;
  deviceLabel: string;
  browserDescription: string;
  ipAddress: string;
  isCurrent: boolean;
  status: 'ACTIVE' | 'REVOKED' | 'BLOCKED' | 'EXPIRED';
  isRevoked: boolean;
  isBlocked: boolean;
  createdAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
}

interface SessionsResponse {
  currentSessionId: number | null;
  maxDevices: number;
  activeDistinctDeviceCount: number;
  activeSessionCount: number;
  sessions: OwnSessionItem[];
}

interface ActiveDevicesPanelProps {
  onLoggedOutCurrent?: () => Promise<void> | void;
  onToast?: (msg: string) => void;
  compact?: boolean;
  darkTheme?: boolean;
  adminLayout?: boolean;
}

const STATUS_BADGE: Record<
  OwnSessionItem['status'],
  { label: string; cls: string; darkCls: string; tone: 'emerald' | 'slate' | 'rose' | 'amber' }
> = {
  ACTIVE: {
    label: 'نشط حاليًا',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    darkCls: 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200',
    tone: 'emerald',
  },
  REVOKED: {
    label: 'تم إنهاء الجلسة',
    cls: 'border-slate-200 bg-slate-100 text-slate-600',
    darkCls: 'border-white/15 bg-white/10 text-slate-300',
    tone: 'slate',
  },
  BLOCKED: {
    label: 'جهاز محظور',
    cls: 'border-red-200 bg-red-50 text-red-700',
    darkCls: 'border-rose-400/45 bg-rose-500/20 text-rose-200',
    tone: 'rose',
  },
  EXPIRED: {
    label: 'منتهي الصلاحية',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
    darkCls: 'border-amber-400/45 bg-amber-500/20 text-amber-200',
    tone: 'amber',
  },
};

export const ActiveDevicesPanel: React.FC<ActiveDevicesPanelProps> = ({
  onLoggedOutCurrent,
  onToast,
  compact = false,
  darkTheme = false,
  adminLayout = false,
}) => {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [adminTab, setAdminTab] = useState<'active' | 'history'>('active');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<SessionsResponse>('/api/auth/sessions');
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    if (onToast) onToast(text);
  };

  const handleRevokeSession = async (session: OwnSessionItem) => {
    setActionBusy(`revoke-${session.id}`);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        success: boolean;
        revokedCurrent: boolean;
        message: string;
      }>(`/api/auth/sessions/${session.id}/revoke`, {
        method: 'POST',
      });
      notify('success', res.message);
      if (res.revokedCurrent && onLoggedOutCurrent) {
        await onLoggedOutCurrent();
        return;
      }
      await loadSessions();
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRevokeAllOthers = async () => {
    setActionBusy('revoke-others');
    setFeedback(null);
    try {
      const res = await apiRequest<{
        success: boolean;
        revokedCount: number;
        message: string;
      }>('/api/auth/sessions/revoke-others', {
        method: 'POST',
      });
      notify('success', res.message);
      await loadSessions();
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const activeSessions = (data?.sessions || []).filter((s) => s.status === 'ACTIVE');
  const historySessions = (data?.sessions || []).filter((s) => s.status !== 'ACTIVE');
  const otherActiveCount = activeSessions.filter((s) => !s.isCurrent).length;
  const visibleSessions = showHistory ? data?.sessions || [] : activeSessions;

  // ==================== ADMIN PORTAL HIGH-FIDELITY LAYOUT (REF 15) ====================
  if (adminLayout) {
    const activeDistinct = data?.activeDistinctDeviceCount ?? 0;
    const maxDevices = data?.maxDevices ?? 1;
    const remainingSlots = Math.max(0, maxDevices - activeDistinct);
    const usagePercent = Math.min(100, Math.round((activeDistinct / Math.max(1, maxDevices)) * 100));

    return (
      <div data-testid="active-devices-panel" className="space-y-5">
        <AdminPageHeader
          icon={<MonitorSmartphone className="h-5 w-5" />}
          title="الأجهزة والجلسات"
          subtitle="مراجعة الأجهزة المسجّلة على حسابك الإداري والتحكم في الجلسات المفتوحة وإنهاء أي جلسة غير معروفة فورًا."
          actions={
            <>
              <button
                type="button"
                onClick={() => void loadSessions()}
                disabled={loading}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
              {otherActiveCount > 0 && (
                <button
                  type="button"
                  data-testid="revoke-other-sessions-btn"
                  disabled={actionBusy !== null}
                  onClick={() => void handleRevokeAllOthers()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
                >
                  {actionBusy === 'revoke-others' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  <span>إنهاء جميع الأجهزة الأخرى ({otherActiveCount})</span>
                </button>
              )}
            </>
          }
        />

        <AdminKpiGrid cols={3}>
          <AdminKpiCard
            label="الأجهزة النشطة الآن"
            value={
              <span data-testid="active-devices-count">
                {activeDistinct} / {maxDevices}
              </span>
            }
            subtitle={`متاح ${remainingSlots} ${remainingSlots === 1 ? 'جهاز إضافي' : 'أجهزة إضافية'}`}
            icon={<Laptop className="h-5 w-5" />}
            tone="blue"
          />
          <AdminKpiCard
            label="الجلسات المفتوحة"
            value={data?.activeSessionCount ?? 0}
            subtitle="جلسات نشطة على الخادم حاليًا"
            icon={<ShieldCheck className="h-5 w-5" />}
            tone="emerald"
          />
          <AdminKpiCard
            label="الجلسات السابقة"
            value={historySessions.length}
            subtitle="جلسات منتهية أو تم تسجيل الخروج منها"
            icon={<Clock className="h-5 w-5" />}
            tone="slate"
          />
        </AdminKpiGrid>

        <AdminSegmentedTabs
          activeId={adminTab}
          onChange={setAdminTab}
          items={[
            { id: 'active', label: 'الأجهزة النشطة', count: activeSessions.length },
            { id: 'history', label: 'سجل الجلسات السابقة', count: historySessions.length },
          ]}
        />

        {feedback && (
          <div
            role="status"
            className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <ShieldAlert className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        <AdminMasterDetail
          main={
            <div className="space-y-4">
              {loading && !data ? (
                <AdminCard className="flex items-center justify-center py-12 text-xs text-slate-500">
                  <Loader2 className="ml-2 h-4 w-4 animate-spin text-[#2563EB]" />
                  <span>جارٍ تحميل الأجهزة والجلسات...</span>
                </AdminCard>
              ) : adminTab === 'active' ? (
                <>
                  <AdminCard
                    title="الأجهزة النشطة حاليًا"
                    subtitle="كل جهاز مرتبط بجلسة موثّقة على الخادم ويمكن إنهاؤها فورًا."
                  >
                    {activeSessions.length === 0 ? (
                      <AdminEmptyState
                        icon={<Monitor className="h-5 w-5" />}
                        title="لا توجد جلسات نشطة حاليًا"
                        description="ستظهر هنا جميع الأجهزة المتصلة بحسابك فور تسجيل الدخول."
                      />
                    ) : (
                      <div className="space-y-3">
                        {activeSessions.map((session) => {
                          const isMobile = /iPhone|Android|Mobile|iPad/i.test(
                            session.browserDescription,
                          );
                          const badge = STATUS_BADGE[session.status];
                          return (
                            <div
                              key={session.id}
                              data-testid={`session-row-${session.id}`}
                              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 transition-colors ${
                                session.isCurrent
                                  ? 'border-blue-200 bg-blue-50/45'
                                  : 'border-slate-200/90 bg-white hover:border-slate-300'
                              }`}
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <div
                                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                                    session.isCurrent
                                      ? 'bg-[#2563EB] text-white shadow-sm'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {isMobile ? (
                                    <Smartphone className="h-5 w-5" />
                                  ) : session.isCurrent ? (
                                    <Laptop className="h-5 w-5" />
                                  ) : (
                                    <Monitor className="h-5 w-5" />
                                  )}
                                </div>

                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-extrabold text-[#0F172A]">
                                      {session.browserDescription}
                                    </span>
                                    {session.isCurrent && (
                                      <AdminStatusBadge tone="blue">هذا الجهاز الحالي</AdminStatusBadge>
                                    )}
                                    <AdminStatusBadge tone={badge.tone} dot>
                                      {badge.label}
                                    </AdminStatusBadge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                    <span className="inline-flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      <span>الدخول: {formatDateTimeAr(session.createdAt)}</span>
                                    </span>
                                    <span>·</span>
                                    <span>آخر نشاط: {formatDateTimeAr(session.lastHeartbeatAt)}</span>
                                    {session.deviceLabel &&
                                      session.deviceLabel !== session.browserDescription && (
                                        <>
                                          <span>·</span>
                                          <span>{session.deviceLabel}</span>
                                        </>
                                      )}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                data-testid={`revoke-session-btn-${session.id}`}
                                disabled={actionBusy !== null}
                                onClick={() => void handleRevokeSession(session)}
                                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${
                                  session.isCurrent
                                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                }`}
                              >
                                {actionBusy === `revoke-${session.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : session.isCurrent ? (
                                  <LogOut className="h-3.5 w-3.5" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {session.isCurrent ? 'تسجيل الخروج من هذا الجهاز' : 'إنهاء الجلسة'}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>
                        إذا لاحظت أي جهاز غير مألوف ضمن الجلسات النشطة، قم بإنهاء جلسته فورًا وتغيير كلمة المرور لحماية حسابك الإداري.
                      </span>
                    </div>
                  </AdminCard>

                  {historySessions.length > 0 && (
                    <AdminCard
                      title="آخر الجلسات السابقة"
                      headerAction={
                        <button
                          type="button"
                          onClick={() => setAdminTab('history')}
                          className="text-xs font-bold text-[#2563EB] hover:underline"
                        >
                          عرض السجل الكامل ({historySessions.length})
                        </button>
                      }
                      noPadding
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                            <tr>
                              <th className="px-4 py-2.5 font-bold">الجهاز والمتصفح</th>
                              <th className="px-4 py-2.5 font-bold">وقت الدخول</th>
                              <th className="px-4 py-2.5 font-bold">آخر نشاط</th>
                              <th className="px-4 py-2.5 font-bold">الحالة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {historySessions.slice(0, 5).map((s) => {
                              const badge = STATUS_BADGE[s.status];
                              return (
                                <tr key={s.id} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-2.5 font-bold text-[#0F172A]">
                                    {s.browserDescription}
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-500">
                                    {formatDateTimeAr(s.createdAt)}
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-500">
                                    {formatDateTimeAr(s.lastHeartbeatAt)}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <AdminStatusBadge tone={badge.tone}>{badge.label}</AdminStatusBadge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </AdminCard>
                  )}
                </>
              ) : (
                <AdminCard
                  title="سجل الجلسات السابقة"
                  subtitle="جميع الجلسات المنتهية أو المسجّل الخروج منها لحسابك."
                  noPadding
                >
                  {historySessions.length === 0 ? (
                    <div className="p-6">
                      <AdminEmptyState
                        icon={<Clock className="h-5 w-5" />}
                        title="لا توجد جلسات سابقة مسجّلة"
                        description="عندما تقوم بتسجيل الخروج أو انتهاء صلاحية جلسة ستظهر هنا."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                          <tr>
                            <th className="px-4 py-3 font-bold">الجهاز والمتصفح</th>
                            <th className="px-4 py-3 font-bold">وقت الدخول</th>
                            <th className="px-4 py-3 font-bold">آخر نشاط</th>
                            <th className="px-4 py-3 font-bold">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {historySessions.map((s) => {
                            const badge = STATUS_BADGE[s.status];
                            return (
                              <tr key={s.id} className="hover:bg-slate-50/60">
                                <td className="px-4 py-3">
                                  <div className="font-bold text-[#0F172A]">
                                    {s.browserDescription}
                                  </div>
                                  {s.deviceLabel && s.deviceLabel !== s.browserDescription && (
                                    <div className="text-[11px] text-slate-400">{s.deviceLabel}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {formatDateTimeAr(s.createdAt)}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {formatDateTimeAr(s.lastHeartbeatAt)}
                                </td>
                                <td className="px-4 py-3">
                                  <AdminStatusBadge tone={badge.tone}>{badge.label}</AdminStatusBadge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </AdminCard>
              )}
            </div>
          }
          detail={
            <AdminCard title="ملخص الجلسات والأمان" subtitle="الحد المسموح لحسابك الإداري">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-600">استهلاك حد الأجهزة</span>
                    <span className="font-mono-num text-[#0F172A]">
                      {activeDistinct} / {maxDevices}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usagePercent >= 90 ? 'bg-amber-500' : 'bg-[#2563EB]'
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">الأجهزة النشطة الآن</span>
                    <span className="font-mono-num font-extrabold text-[#0F172A]">
                      {activeDistinct}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">الأجهزة المتاحة للإضافة</span>
                    <span className="font-mono-num font-extrabold text-emerald-700">
                      {remainingSlots}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">إجمالي الجلسات المفتوحة</span>
                    <span className="font-mono-num font-extrabold text-[#2563EB]">
                      {data?.activeSessionCount ?? 0}
                    </span>
                  </div>
                </div>

                {otherActiveCount > 0 ? (
                  <button
                    type="button"
                    disabled={actionBusy !== null}
                    onClick={() => void handleRevokeAllOthers()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
                  >
                    {actionBusy === 'revoke-others' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="h-4 w-4" />
                    )}
                    <span>إنهاء باقي الأجهزة ({otherActiveCount})</span>
                  </button>
                ) : (
                  <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-xs font-semibold text-emerald-800">
                    أنت متصل من جهاز واحد فقط حاليًا. لا توجد جلسات أخرى مفتوحة على حسابك.
                  </div>
                )}
              </div>
            </AdminCard>
          }
        />
      </div>
    );
  }

  return (
    <div
      data-testid="active-devices-panel"
      className={`space-y-4 ${
        compact
          ? ''
          : darkTheme
            ? 'rounded-2xl border border-[#3B82F6]/35 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-5 sm:p-6 text-white shadow-xl'
            : 'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6'
      }`}
    >
      {/* Header & Summary */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className={`flex items-center gap-2 text-base font-extrabold sm:text-lg ${
              darkTheme ? 'text-white' : 'text-[#0B162C]'
            }`}
          >
            <ShieldCheck className={`h-5 w-5 ${darkTheme ? 'text-sky-300' : 'text-[#2563EB]'}`} />
            <span>الأجهزة والجلسات النشطة</span>
          </h2>
          <p className={`mt-1 text-xs ${darkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
            تحكم كامل في الأجهزة المسجّلة على حسابك وإنهاء أي جلسة قديمة فورًا من الخادم.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSessions()}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${
              darkTheme
                ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          {otherActiveCount > 0 && (
            <button
              type="button"
              data-testid="revoke-other-sessions-btn"
              disabled={actionBusy !== null}
              onClick={() => void handleRevokeAllOthers()}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${
                darkTheme
                  ? 'border-rose-400/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                  : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              {actionBusy === 'revoke-others' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              <span>تسجيل الخروج من جميع الأجهزة الأخرى ({otherActiveCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div
            className={`rounded-xl border p-3.5 ${
              darkTheme
                ? 'border-white/12 bg-[#081330]/80'
                : 'border-slate-200 bg-[#F7F9FC]'
            }`}
          >
            <div className={`text-[11px] font-semibold ${darkTheme ? 'text-slate-300' : 'text-slate-500'}`}>
              الأجهزة النشطة حاليًا
            </div>
            <div
              data-testid="active-devices-count"
              className={`mt-1 font-mono-num text-xl font-extrabold ${darkTheme ? 'text-white' : 'text-[#0B162C]'}`}
            >
              {data.activeDistinctDeviceCount}{' '}
              <span className={`text-xs font-bold ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                / {data.maxDevices} الحد الأقصى
              </span>
            </div>
          </div>
          <div
            className={`rounded-xl border p-3.5 ${
              darkTheme
                ? 'border-white/12 bg-[#081330]/80'
                : 'border-slate-200 bg-[#F7F9FC]'
            }`}
          >
            <div className={`text-[11px] font-semibold ${darkTheme ? 'text-slate-300' : 'text-slate-500'}`}>
              إجمالي الجلسات المفتوحة
            </div>
            <div className={`mt-1 font-mono-num text-xl font-extrabold ${darkTheme ? 'text-sky-300' : 'text-[#2563EB]'}`}>
              {data.activeSessionCount}
            </div>
          </div>
          <div
            className={`rounded-xl border p-3.5 flex items-center justify-between gap-2 ${
              darkTheme
                ? 'border-white/12 bg-[#081330]/80'
                : 'border-slate-200 bg-[#F7F9FC]'
            }`}
          >
            <div>
              <div className={`text-[11px] font-semibold ${darkTheme ? 'text-slate-300' : 'text-slate-500'}`}>
                الجلسات المنتهية والسابقة
              </div>
              <div className={`mt-1 text-xs font-bold ${darkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
                {(data.sessions.length || 0) - activeSessions.length} جلسة سابقة
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                darkTheme
                  ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {showHistory ? 'إخفاء السجل' : 'عرض السجل'}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold ${
            feedback.type === 'success'
              ? darkTheme
                ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : darkTheme
                ? 'border-rose-400/40 bg-rose-500/20 text-rose-200'
                : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {loading && !data ? (
        <div className={`flex items-center justify-center py-10 text-xs ${darkTheme ? 'text-slate-300' : 'text-slate-500'}`}>
          <Loader2 className="ml-2 h-4 w-4 animate-spin text-[#2563EB]" />
          <span>جارٍ تحميل الجلسات النشطة...</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 p-4 text-xs font-semibold text-rose-200">
          {error}
        </div>
      ) : visibleSessions.length === 0 ? (
        <div
          className={`rounded-xl border p-8 text-center text-xs ${
            darkTheme
              ? 'border-white/12 bg-[#081330]/60 text-slate-300'
              : 'border-slate-200 bg-[#F7F9FC] text-slate-500'
          }`}
        >
          لا توجد جلسات نشطة للعرض حاليًا.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleSessions.map((session) => {
            const isMobile = /iPhone|Android|Mobile|iPad/i.test(session.browserDescription);
            const badge = STATUS_BADGE[session.status];
            return (
              <div
                key={session.id}
                data-testid={`session-row-${session.id}`}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${
                  darkTheme
                    ? session.isCurrent
                      ? 'border-sky-400/55 bg-sky-500/15'
                      : 'border-white/12 bg-[#0B173A]/85'
                    : session.isCurrent
                      ? 'border-[#2563EB] bg-blue-50/40'
                      : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      session.isCurrent
                        ? 'bg-[#2563EB] text-white'
                        : darkTheme
                          ? 'bg-white/10 text-slate-200'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isMobile ? (
                      <Smartphone className="h-5 w-5" />
                    ) : session.isCurrent ? (
                      <Laptop className="h-5 w-5" />
                    ) : (
                      <Monitor className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-extrabold ${darkTheme ? 'text-white' : 'text-[#0B162C]'}`}>
                        {session.browserDescription}
                      </span>
                      {session.isCurrent && (
                        <span className="rounded-md bg-[#2563EB] px-2 py-0.5 text-[10px] font-bold text-white">
                          هذا الجهاز الحالي
                        </span>
                      )}
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          darkTheme ? badge.darkCls : badge.cls
                        }`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${
                        darkTheme ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>الدخول: {formatDateTimeAr(session.createdAt)}</span>
                      </span>
                      <span>·</span>
                      <span>آخر نشاط: {formatDateTimeAr(session.lastHeartbeatAt)}</span>
                      {session.deviceLabel && session.deviceLabel !== session.browserDescription && (
                        <>
                          <span>·</span>
                          <span>الوصف: {session.deviceLabel}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {session.status === 'ACTIVE' && (
                  <div className="shrink-0">
                    <button
                      type="button"
                      data-testid={`revoke-session-btn-${session.id}`}
                      disabled={actionBusy !== null}
                      onClick={() => void handleRevokeSession(session)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                        darkTheme
                          ? session.isCurrent
                            ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
                            : 'border-rose-400/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                          : session.isCurrent
                            ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {actionBusy === `revoke-${session.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : session.isCurrent ? (
                        <LogOut className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {session.isCurrent ? 'تسجيل الخروج من هذا الجهاز' : 'إنهاء الجلسة'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};


