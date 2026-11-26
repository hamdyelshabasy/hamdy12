import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  KeyRound,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  apiRequest,
  formatDateTimeAr,
  getDeviceFingerprint,
  getDeviceLabel,
  setAuthToken,
} from '../lib/api.ts';
import type { AuthUser, BootstrapResponse, MeResponse } from '../types/lms.ts';

const EGYPT_GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'القليوبية',
  'الدقهلية',
  'الشرقية',
  'الغربية',
  'المنوفية',
  'البحيرة',
  'كفر الشيخ',
  'دمياط',
  'بورسعيد',
  'الإسماعيلية',
  'السويس',
  'الفيوم',
  'بني سويف',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'الأقصر',
  'أسوان',
];

interface AuthViewProps {
  bootstrap: BootstrapResponse;
  initialMode: 'login' | 'register';
  preselectedTrackId?: number;
  preselectedGradeId?: number;
  currentUser: AuthUser | null;
  onAuthenticated: (prefetchedMe?: MeResponse) => Promise<void>;
  onLogout: () => Promise<void>;
  onBackHome: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  bootstrap,
  initialMode,
  preselectedTrackId,
  preselectedGradeId,
  currentUser,
  onAuthenticated,
  onLogout,
  onBackHome,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Code-only chunk prefetch while user types credentials (zero confidential data fetched)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./StudentDashboard.tsx');
      void import('./AdminDashboard.tsx');
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  // Login fields
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [recoveryState, setRecoveryState] = useState<{
    maxDevices: number;
    activeDistinctDeviceCount: number;
    sessions: Array<{
      id: number;
      deviceLabel: string;
      browserDescription: string;
      ipAddress: string;
      createdAt: string;
      lastHeartbeatAt: string;
    }>;
  } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Registration fields
  const defaultTrackId = preselectedTrackId || bootstrap.tracks[0]?.id || 0;
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [trackId, setTrackId] = useState<number>(defaultTrackId);
  const availableGrades = useMemo(
    () => bootstrap.tracks.find((t) => t.id === trackId)?.grades || [],
    [bootstrap.tracks, trackId],
  );
  const [gradeId, setGradeId] = useState<number>(
    preselectedGradeId || availableGrades[0]?.id || 0,
  );
  const [governorate, setGovernorate] = useState('القاهرة');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const handleTrackChange = (newTrackId: number) => {
    setTrackId(newTrackId);
    const nextGrades = bootstrap.tracks.find((t) => t.id === newTrackId)?.grades || [];
    setGradeId(nextGrades[0]?.id || 0);
  };

  // Pending / Rejected / Suspended Lock Screen
  if (currentUser && currentUser.roleSlug === 'STUDENT' && currentUser.status !== 'ACTIVE') {
    const isPending = currentUser.status === 'PENDING_APPROVAL';
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9FC] px-4 py-12">
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-xl ${
              isPending ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
            }`}
          >
            {isPending ? <Clock className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
          </div>
          <h1 className="mt-5 text-2xl font-extrabold text-[#0B162C]">
            {isPending
              ? 'حسابك في انتظار موافقة المدرس'
              : currentUser.status === 'REJECTED'
                ? 'لم تتم الموافقة على طلب التسجيل'
                : 'تم تعليق الحساب مؤقتًا'}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            مرحبًا <strong className="text-[#0B162C]">{currentUser.fullName}</strong>.{' '}
            {isPending
              ? 'تم استلام بيانات تسجيلك بنجاح ووصلت فورًا إلى لوحة تحكم المدرس. لا يمكن مشاهدة الفيديوهات أو فتح الامتحانات قبل اعتماد الحساب.'
              : 'يرجى التواصل مع إدارة المنصة لمعرفة سبب القرار أو إعادة تفعيل حسابك.'}
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 text-right text-xs text-slate-600">
            <div>رقم الهاتف المسجل: {currentUser.phone || currentUser.email}</div>
            <div className="mt-1">
              حالة الحساب الحالية:{' '}
              <strong className={isPending ? 'text-amber-700' : 'text-red-700'}>
                {isPending ? 'قيد المراجعة (Pending Approval)' : currentUser.status}
              </strong>
            </div>
            <div className="mt-1">
              دعم المنصة: <span className="font-mono-num" dir="ltr">{bootstrap.settings.contactPhone}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onAuthenticated()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <RefreshCw className="h-4 w-4" />
              <span>تحديث حالة الموافقة</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setRecoveryState(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser; me?: MeResponse }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          phone: loginPhone,
          password: loginPassword,
          deviceFingerprint: getDeviceFingerprint(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      setAuthToken(res.token);
      await onAuthenticated(res.me);
    } catch (err) {
      const apiErr = err as Error & { reasonCode?: string };
      setError(apiErr.message);
      if (apiErr.reasonCode === 'DEVICE_LIMIT_EXCEEDED') {
        try {
          const listRes = await apiRequest<{
            maxDevices: number;
            activeDistinctDeviceCount: number;
            sessions: Array<{
              id: number;
              deviceLabel: string;
              browserDescription: string;
              ipAddress: string;
              createdAt: string;
              lastHeartbeatAt: string;
            }>;
          }>('/api/auth/sessions/recover-login', {
            method: 'POST',
            body: JSON.stringify({
              phone: loginPhone,
              password: loginPassword,
              deviceFingerprint: getDeviceFingerprint(),
              deviceLabel: getDeviceLabel(),
              action: 'LIST',
            }),
          });
          setRecoveryState(listRes);
        } catch {
          // keep original error displayed
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverLogin = async (opts: { revokeSessionIds?: number[]; revokeAllOthers?: boolean }) => {
    setRecoveryBusy(true);
    setError('');
    try {
      const res = await apiRequest<{ token: string; user: AuthUser; me?: MeResponse; message?: string }>(
        '/api/auth/sessions/recover-login',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: loginPhone,
            password: loginPassword,
            deviceFingerprint: getDeviceFingerprint(),
            deviceLabel: getDeviceLabel(),
            action: 'REVOKE_AND_LOGIN',
            revokeSessionIds: opts.revokeSessionIds,
            revokeAllOthers: opts.revokeAllOthers,
          }),
        },
      );
      setRecoveryState(null);
      setAuthToken(res.token);
      await onAuthenticated(res.me);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const [{ signInWithPopup }, { auth, googleAuthProvider }] = await Promise.all([
        import('@firebase/auth'),
        import('../lib/firebase.ts'),
      ]);
      const result = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await result.user.getIdToken();
      const res = await apiRequest<{ token: string; user: AuthUser; me?: MeResponse }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          idToken,
          deviceFingerprint: getDeviceFingerprint(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      setAuthToken(res.token);
      await onAuthenticated(res.me);
    } catch (err) {
      try {
        const [{ signOut }, { auth }] = await Promise.all([
          import('@firebase/auth'),
          import('../lib/firebase.ts'),
        ]);
        await signOut(auth);
      } catch {
        // ignore Firebase cleanup error
      }
      setAuthToken(null);
      setError((err as Error).message || 'تعذر تسجيل الدخول عبر حساب Google');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!acceptTerms) {
      setError('يجب الموافقة على سياسة الخصوصية والشروط والأحكام لإتمام التسجيل');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          phone,
          parentPhone,
          email,
          password,
          confirmPassword,
          trackId,
          gradeId,
          governorate,
          acceptTerms: true,
          deviceFingerprint: getDeviceFingerprint(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      setAuthToken(res.token);
      setSuccessMsg(res.message);
      await onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onBackHome}
          className="mb-5 inline-flex min-h-[40px] items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 hover:text-[#0B162C]"
        >
          <ArrowRight className="h-4 w-4" />
          <span>العودة للصفحة الرئيسية</span>
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="border-b border-slate-100 pb-5">
            <div className="text-xs font-semibold text-[#2563EB]">{bootstrap.settings.platformName}</div>
            <h1 className="mt-1 text-2xl font-extrabold text-[#0B162C]">
              {mode === 'login' ? 'تسجيل الدخول إلى حسابك' : 'إنشاء حساب طالب جديد'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {mode === 'login'
                ? 'أدخل رقم الهاتف وكلمة المرور للوصول إلى محاضراتك وامتحاناتك'
                : 'سجّل بياناتك بدقة؛ سيتم مراجعة الحساب والموافقة عليه من قِبل المدرس'}
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                mode === 'login' ? 'bg-white text-[#0B162C] shadow-sm' : 'text-slate-600 hover:text-[#0B162C]'
              }`}
            >
              <KeyRound className="h-4 w-4" />
              <span>تسجيل الدخول</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                mode === 'register' ? 'bg-white text-[#0B162C] shadow-sm' : 'text-slate-600 hover:text-[#0B162C]'
              }`}
            >
              <UserPlus className="h-4 w-4" />
              <span>إنشاء حساب جديد</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {recoveryState && (
            <div
              data-testid="device-limit-recovery-box"
              className="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-[#0B162C]">
                    إدارة الأجهزة النشطة لتسجيل الدخول ({recoveryState.activeDistinctDeviceCount} /{' '}
                    {recoveryState.maxDevices})
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-700">
                    اختر جلسة قديمة لإنهائها فورًا ثم الدخول من هذا الجهاز، أو قم بتسجيل الخروج من جميع الأجهزة الأخرى.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="recover-revoke-all-btn"
                  disabled={recoveryBusy}
                  onClick={() => void handleRecoverLogin({ revokeAllOthers: true })}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2563EB] disabled:opacity-60"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>إنهاء كل الأجهزة الأخرى والدخول</span>
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto">
                {recoveryState.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Monitor className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-[#0B162C]">
                          {s.browserDescription}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          الدخول: {formatDateTimeAr(s.createdAt)} · آخر نشاط:{' '}
                          {formatDateTimeAr(s.lastHeartbeatAt)}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={recoveryBusy}
                      onClick={() => void handleRecoverLogin({ revokeSessionIds: [s.id] })}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>إنهاء والدخول</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {successMsg && (
            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {successMsg}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-phone" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  رقم الهاتف
                </label>
                <input
                  id="login-phone"
                  type="tel"
                  required
                  dir="ltr"
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  كلمة المرور
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#2563EB] py-3 text-sm font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {loading ? 'جارٍ التحقق...' : 'دخول إلى المنصة'}
              </button>

              <div className="relative my-4 text-center text-xs text-slate-400">
                <span className="bg-white px-3">أو الدخول السريع لحسابات الإدارة عبر Google</span>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                تسجيل الدخول بحساب Google
              </button>

              {bootstrap.demoAccountsEnabled &&
                Array.isArray(bootstrap.demoQuickAccounts) &&
                bootstrap.demoQuickAccounts.length > 0 && (
                  <div className="mt-6 rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                    <div className="text-xs font-bold text-slate-700">
                      حسابات تجريبية للمعاينة والاختبار (تُعطَّل تلقائيًا في بيئة الإنتاج)
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {bootstrap.demoQuickAccounts.map((acc) => (
                        <button
                          key={acc.phone}
                          type="button"
                          onClick={() => {
                            setError('');
                            setSuccessMsg('');
                            setRecoveryState(null);
                            setLoginPhone(acc.phone);
                            setLoginPassword(acc.password);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#0B162C] hover:border-[#2563EB]"
                        >
                          {acc.labelAr}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="reg-name" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    الاسم بالكامل (رباعي) *
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: أحمد محمود السيد حسن"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-phone" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    رقم هاتف الطالب *
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-parent-phone" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    رقم هاتف ولي الأمر *
                  </label>
                  <input
                    id="reg-parent-phone"
                    type="tel"
                    required
                    dir="ltr"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    placeholder="011XXXXXXXX"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-track" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    المسار الدراسي *
                  </label>
                  <select
                    id="reg-track"
                    value={trackId}
                    onChange={(e) => handleTrackChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    {bootstrap.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-grade" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    الصف الدراسي *
                  </label>
                  <select
                    id="reg-grade"
                    value={gradeId}
                    onChange={(e) => setGradeId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    {availableGrades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-email" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    البريد الإلكتروني (اختياري)
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@example.com"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-left text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-gov" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    المحافظة (اختياري)
                  </label>
                  <select
                    id="reg-gov"
                    value={governorate}
                    onChange={(e) => setGovernorate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    {EGYPT_GOVERNORATES.map((gov) => (
                      <option key={gov} value={gov}>
                        {gov}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-pass" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    كلمة المرور *
                  </label>
                  <input
                    id="reg-pass"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="reg-confirm-pass" className="mb-1.5 block text-sm font-semibold text-slate-700">
                    تأكيد كلمة المرور *
                  </label>
                  <input
                    id="reg-confirm-pass"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 pt-2 text-xs leading-relaxed text-slate-600">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                />
                <span>
                  أوافق على سياسة الخصوصية والشروط والأحكام، وأقرّ بأن الحساب للاستخدام الشخصي فقط وأن تفعيله يخضع لموافقة المدرس.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#2563EB] py-3 text-sm font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {loading ? 'جارٍ إنشاء الحساب...' : 'إنشاء الحساب وإرسال طلب الموافقة'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
