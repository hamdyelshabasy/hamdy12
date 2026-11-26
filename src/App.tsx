import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, getAuthToken, invalidateApiCache, setAuthToken } from './lib/api.ts';
import {
  ensureLmsRootGuard,
  evaluateGuardPop,
  goBackInLms,
  parseHashToNavState,
  pushLmsHistoryState,
  syncTrackedNavDepthFromState,
  type AppNavHistoryState,
  type TopLevelScreen,
} from './lib/navigationHistory.ts';
import type { BootstrapResponse, GradeItem, MeResponse, TrackItem } from './types/lms.ts';

const loadLandingPageModule = () => import('./components/LandingPage.tsx');
const loadAuthViewModule = () => import('./components/AuthView.tsx');
const loadStudentDashboardModule = () => import('./components/StudentDashboard.tsx');
const loadAdminDashboardModule = () => import('./components/AdminDashboard.tsx');
const loadParentReportModule = () => import('./components/ParentReportView.tsx');

export function preloadAuthView() {
  void loadAuthViewModule();
}

export function preloadDashboardChunks() {
  void loadAdminDashboardModule();
  void loadStudentDashboardModule();
}

const LandingPage = lazy(() => loadLandingPageModule().then((m) => ({ default: m.LandingPage })));
const AuthView = lazy(() => loadAuthViewModule().then((m) => ({ default: m.AuthView })));
const StudentDashboard = lazy(() =>
  loadStudentDashboardModule().then((m) => ({ default: m.StudentDashboard })),
);
const AdminDashboard = lazy(() =>
  loadAdminDashboardModule().then((m) => ({ default: m.AdminDashboard })),
);
const ParentReportView = lazy(() =>
  loadParentReportModule().then((m) => ({ default: m.ParentReportView })),
);

const RouteLoadingFallback: React.FC = () => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-[#060D21] text-white">
    <div className="h-9 w-9 animate-spin rounded-full border-4 border-white/15 border-t-[#2563EB]" />
    <p className="mt-3 text-xs font-semibold text-slate-300">جارٍ تحميل الصفحة...</p>
  </div>
);

type AppView = 'landing' | 'auth' | 'student' | 'admin' | 'parent-report';

const STAFF_ROLES = new Set(['SUPER_ADMIN', 'CONTENT_MANAGER', 'TEACHING_ASSISTANT', 'SUPPORT']);

export const App: React.FC = () => {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState('');

  const [view, setViewState] = useState<AppView>('landing');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [preselectedTrackId, setPreselectedTrackId] = useState<number | undefined>();
  const [preselectedGradeId, setPreselectedGradeId] = useState<number | undefined>();
  const [activeGradeId, setActiveGradeId] = useState<number | undefined>();
  const [parentShareCode, setParentShareCode] = useState('');
  const [exitGuardToast, setExitGuardToast] = useState('');

  const meRef = useRef<MeResponse | null>(null);
  meRef.current = me;

  const currentScreenRef = useRef<TopLevelScreen>('landing');
  currentScreenRef.current =
    view === 'landing'
      ? 'landing'
      : view === 'auth'
        ? authMode
        : view === 'parent-report'
          ? 'parent'
          : 'dashboard';

  const lastGuardHitRef = useRef<number>(0);
  const exitToastTimerRef = useRef<number | null>(null);

  const triggerExitGuardToast = useCallback((msg: string) => {
    setExitGuardToast(msg);
    if (exitToastTimerRef.current) {
      window.clearTimeout(exitToastTimerRef.current);
    }
    exitToastTimerRef.current = window.setTimeout(() => {
      setExitGuardToast('');
      exitToastTimerRef.current = null;
    }, 2600);
  }, []);

  const navigateView = useCallback(
    (
      nextView: AppView,
      opts?: { authMode?: 'login' | 'register'; historyMode?: 'push' | 'replace' | 'none' },
    ) => {
      const mode = opts?.historyMode ?? 'push';
      const nextAuthMode = opts?.authMode ?? authMode;
      if (opts?.authMode) {
        setAuthMode(opts.authMode);
      }
      setViewState(nextView);

      if (mode !== 'none') {
        if (nextView === 'landing') {
          pushLmsHistoryState({ screen: 'landing' }, mode);
        } else if (nextView === 'auth') {
          pushLmsHistoryState({ screen: nextAuthMode }, mode);
        } else if (nextView === 'parent-report') {
          pushLmsHistoryState({ screen: 'parent' }, mode);
        } else if (nextView === 'admin') {
          pushLmsHistoryState({ screen: 'dashboard', adminTab: 'overview' }, mode);
        } else if (nextView === 'student') {
          pushLmsHistoryState({ screen: 'dashboard', studentTab: 'overview' }, mode);
        }
      }
    },
    [authMode],
  );

  const loadBootstrap = useCallback(async (forceFresh = false) => {
    if (forceFresh) invalidateApiCache('/api/public/bootstrap');
    const b = await apiRequest<BootstrapResponse>('/api/public/bootstrap');
    setBootstrap(b);
    if (b.settings?.platformName) {
      document.title = `${b.settings.platformName} | ${b.settings.teacherName}`;
    }
    return b;
  }, []);

  const loadMe = useCallback(async (): Promise<MeResponse | null> => {
    const token = getAuthToken();
    if (!token) {
      setMe(null);
      return null;
    }
    try {
      const m = await apiRequest<MeResponse>('/api/auth/me');
      setMe(m);
      return m;
    } catch {
      setAuthToken(null);
      setMe(null);
      return null;
    }
  }, []);

  // Initial bootstrap + hash route restoration
  useEffect(() => {
    void loadLandingPageModule();
    (async () => {
      try {
        const [, currentMe] = await Promise.all([loadBootstrap(), loadMe()]);
        const parsedHash = parseHashToNavState(window.location.hash);

        if (currentMe && currentMe.user.status === 'ACTIVE') {
          const isStaffUser = STAFF_ROLES.has(currentMe.user.roleSlug);
          if (isStaffUser) {
            void loadAdminDashboardModule();
          } else {
            void loadStudentDashboardModule();
          }

          if (parsedHash?.screen === 'parent') {
            setViewState('parent-report');
            ensureLmsRootGuard({ screen: 'parent' });
          } else if (parsedHash?.screen === 'dashboard') {
            if (parsedHash.adminTab && isStaffUser) {
              setViewState('admin');
              ensureLmsRootGuard({ screen: 'dashboard', adminTab: parsedHash.adminTab });
            } else if (parsedHash.studentTab) {
              setViewState('student');
              ensureLmsRootGuard({
                screen: 'dashboard',
                studentTab: parsedHash.studentTab,
                videoId: parsedHash.videoId ?? null,
                courseId: parsedHash.courseId ?? null,
                homeworkId: parsedHash.homeworkId ?? null,
                examId: parsedHash.examId ?? null,
                curriculumWeekId: parsedHash.curriculumWeekId ?? null,
                curriculumFilter: parsedHash.curriculumFilter ?? null,
              });
            } else {
              const target = isStaffUser ? 'admin' : 'student';
              setViewState(target);
              ensureLmsRootGuard(
                isStaffUser
                  ? { screen: 'dashboard', adminTab: 'overview' }
                  : { screen: 'dashboard', studentTab: 'overview' },
              );
            }
          } else {
            ensureLmsRootGuard({ screen: 'landing' });
          }
        } else {
          if (parsedHash?.screen === 'login' || parsedHash?.screen === 'register') {
            setAuthMode(parsedHash.screen);
            setViewState('auth');
            ensureLmsRootGuard({ screen: parsedHash.screen });
          } else if (parsedHash?.screen === 'parent') {
            setViewState('parent-report');
            ensureLmsRootGuard({ screen: 'parent' });
          } else {
            ensureLmsRootGuard({ screen: 'landing' });
          }
        }
      } catch (err) {
        setFatalError((err as Error).message || 'تعذر الاتصال بخادم المنصة');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBootstrap, loadMe]);

  // Browser & Mobile Hardware Back / Forward sync — NEVER logs out or exits accidentally!
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      syncTrackedNavDepthFromState(event.state);
      const rawState = event.state as Partial<AppNavHistoryState> | null;

      // Root guard sentinel reached via hardware/browser Back button
      if (rawState?.__lmsGuard) {
        const decision = evaluateGuardPop({
          currentScreen: currentScreenRef.current,
          lastGuardHitAt: lastGuardHitRef.current,
          nowMs: Date.now(),
        });

        if (decision.action === 'go-landing') {
          lastGuardHitRef.current = 0;
          setExitGuardToast('');
          setViewState('landing');
          pushLmsHistoryState({ screen: 'landing' }, 'push');
          return;
        }

        if (decision.action === 'warn-and-stay') {
          lastGuardHitRef.current = decision.nextGuardHitAt;
          setViewState('landing');
          pushLmsHistoryState({ screen: 'landing' }, 'push');
          triggerExitGuardToast('اضغط زر الرجوع مرة أخرى للخروج من المنصة');
          return;
        }

        // Explicit second Back press on landing within 2.5s -> allow browser exit
        lastGuardHitRef.current = 0;
        setExitGuardToast('');
        window.history.back();
        return;
      }

      lastGuardHitRef.current = 0;
      setExitGuardToast('');

      const state = rawState || parseHashToNavState(window.location.hash);

      const currentMe = meRef.current;
      const isActiveUser = Boolean(currentMe && currentMe.user.status === 'ACTIVE');
      const isStaffUser = Boolean(currentMe && STAFF_ROLES.has(currentMe.user.roleSlug));

      if (!state || !state.screen || state.screen === 'landing') {
        setViewState('landing');
        return;
      }

      if (state.screen === 'parent') {
        setViewState('parent-report');
        return;
      }

      if (state.screen === 'login' || state.screen === 'register') {
        if (isActiveUser) {
          // Stay logged in cleanly — return to landing instead of showing login form to an active user
          setViewState('landing');
          return;
        }
        setAuthMode(state.screen);
        setViewState('auth');
        return;
      }

      if (state.screen === 'dashboard') {
        if (!isActiveUser) {
          setAuthMode('login');
          setViewState('auth');
          return;
        }
        if (state.adminTab && isStaffUser) {
          setViewState('admin');
          return;
        }
        if (state.studentTab) {
          setViewState('student');
          return;
        }
        setViewState(isStaffUser ? 'admin' : 'student');
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (exitToastTimerRef.current) {
        window.clearTimeout(exitToastTimerRef.current);
      }
    };
  }, [triggerExitGuardToast]);

  const handleAuthenticated = async (prefetchedMe?: MeResponse) => {
    const m = prefetchedMe || (await loadMe());
    if (!m) return;
    if (prefetchedMe) {
      setMe(prefetchedMe);
    }
    if (STAFF_ROLES.has(m.user.roleSlug) && m.user.status === 'ACTIVE') {
      void loadAdminDashboardModule();
      // Replace auth history entry so Back goes cleanly to landing instead of login loop
      navigateView('admin', { historyMode: 'replace' });
    } else if (!STAFF_ROLES.has(m.user.roleSlug) && m.user.status === 'ACTIVE') {
      void loadStudentDashboardModule();
      navigateView('student', { historyMode: 'replace' });
    } else {
      navigateView('auth', { historyMode: 'replace' });
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      const [{ signOut }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('./lib/firebase.ts'),
      ]);
      await signOut(auth);
    } catch {
      // ignore
    }
    setAuthToken(null);
    setMe(null);
    navigateView('landing', { historyMode: 'replace' });
  };

  const handleSelectGrade = (track: TrackItem, grade: GradeItem) => {
    if (!me) {
      setPreselectedTrackId(track.id);
      setPreselectedGradeId(grade.id);
      navigateView('auth', { authMode: 'register' });
      return;
    }
    if (me.user.status !== 'ACTIVE') {
      navigateView('auth');
      return;
    }
    setActiveGradeId(grade.id);
    navigateView('student');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#060D21] text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-[#2563EB]" />
        <p className="mt-4 text-sm text-slate-300">جارٍ تحميل منصة الفيزياء...</p>
      </div>
    );
  }

  if (fatalError || !bootstrap) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#060D21] p-6 text-center text-white">
        <div className="max-w-md rounded-2xl border border-white/15 bg-[#0E1E4A] p-8">
          <h1 className="text-xl font-bold text-white">تعذر تحميل بيانات المنصة</h1>
          <p className="mt-2 text-sm text-slate-300">{fatalError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  const exitToastBanner = exitGuardToast ? (
    <div
      role="status"
      data-testid="exit-guard-toast"
      className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-sky-400/40 bg-[#0B1739]/95 px-5 py-2.5 text-center text-xs font-bold text-white shadow-2xl backdrop-blur-md sm:text-sm"
    >
      {exitGuardToast}
    </div>
  ) : null;

  if (view === 'parent-report') {
    return (
      <>
        <Suspense fallback={<RouteLoadingFallback />}>
          <ParentReportView
            initialCode={parentShareCode}
            onBack={() =>
              goBackInLms(() =>
                navigateView(
                  me?.user.status === 'ACTIVE'
                    ? STAFF_ROLES.has(me.user.roleSlug)
                      ? 'admin'
                      : 'student'
                    : 'landing',
                ),
              )
            }
          />
        </Suspense>
        {exitToastBanner}
      </>
    );
  }

  if (view === 'auth') {
    return (
      <>
        <Suspense fallback={<RouteLoadingFallback />}>
          <AuthView
            bootstrap={bootstrap}
            initialMode={authMode}
            preselectedTrackId={preselectedTrackId}
            preselectedGradeId={preselectedGradeId}
            currentUser={me?.user || null}
            onAuthenticated={handleAuthenticated}
            onLogout={handleLogout}
            onBackHome={() => goBackInLms(() => navigateView('landing'))}
          />
        </Suspense>
        {exitToastBanner}
      </>
    );
  }

  if (view === 'admin' && me && STAFF_ROLES.has(me.user.roleSlug) && me.user.status === 'ACTIVE') {
    return (
      <>
        <Suspense fallback={<RouteLoadingFallback />}>
          <AdminDashboard
            bootstrap={bootstrap}
            me={me}
            onRefreshBootstrap={async () => {
              await loadBootstrap(true);
            }}
            onOpenStudentPreview={() => navigateView('student')}
            onBackHome={() => navigateView('landing')}
            onLogout={handleLogout}
          />
        </Suspense>
        {exitToastBanner}
      </>
    );
  }

  if (view === 'student' && me) {
    if (me.user.status !== 'ACTIVE') {
      return (
        <>
          <Suspense fallback={<RouteLoadingFallback />}>
            <AuthView
              bootstrap={bootstrap}
              initialMode="login"
              currentUser={me.user}
              onAuthenticated={handleAuthenticated}
              onLogout={handleLogout}
              onBackHome={() => goBackInLms(() => navigateView('landing'))}
            />
          </Suspense>
          {exitToastBanner}
        </>
      );
    }

    return (
      <>
        <Suspense fallback={<RouteLoadingFallback />}>
          <StudentDashboard
            bootstrap={bootstrap}
            me={me}
            initialGradeId={activeGradeId}
            onRefreshMe={async () => {
              await loadMe();
            }}
            onLogout={handleLogout}
            onOpenParentReport={(code) => {
              setParentShareCode(code);
              navigateView('parent-report');
            }}
            onOpenAdmin={
              STAFF_ROLES.has(me.user.roleSlug) ? () => navigateView('admin') : undefined
            }
            onBackHome={() => navigateView('landing')}
          />
        </Suspense>
        {exitToastBanner}
      </>
    );
  }

  return (
    <>
      <Suspense fallback={<RouteLoadingFallback />}>
        <LandingPage
          bootstrap={bootstrap}
          currentUser={me?.user || null}
          onSelectGrade={handleSelectGrade}
          onOpenAuth={(mode) => {
            setPreselectedTrackId(undefined);
            setPreselectedGradeId(undefined);
            navigateView('auth', { authMode: mode });
          }}
          onOpenDashboard={() => {
            if (me && !STAFF_ROLES.has(me.user.roleSlug) && me.user.status !== 'ACTIVE') {
              navigateView('auth');
            } else {
              navigateView('student');
            }
          }}
          onOpenAdmin={() => navigateView('admin')}
          onOpenParentReport={() => {
            setParentShareCode('');
            navigateView('parent-report');
          }}
        />
      </Suspense>
      {exitToastBanner}
    </>
  );
};

export default App;
