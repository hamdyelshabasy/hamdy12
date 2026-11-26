export type TopLevelScreen = 'landing' | 'login' | 'register' | 'parent' | 'dashboard';

export interface AppNavHistoryState {
  __lmsNav: true;
  __lmsGuard?: boolean;
  __lmsDepth?: number;
  screen: TopLevelScreen;
  studentTab?: string;
  adminTab?: string;
  videoId?: number | null;
  courseId?: number | null;
  homeworkId?: number | null;
  examId?: number | null;
  curriculumWeekId?: number | null;
  curriculumFilter?: 'ALL' | 'OVERDUE' | null;
}

export type AppNavInput = Omit<AppNavHistoryState, '__lmsNav' | '__lmsGuard' | '__lmsDepth'>;

export interface GuardPopInput {
  currentScreen: TopLevelScreen;
  lastGuardHitAt: number;
  nowMs: number;
  doubleBackWindowMs?: number;
}

export interface GuardPopDecision {
  action: 'go-landing' | 'warn-and-stay' | 'allow-exit';
  shouldWarn: boolean;
  nextGuardHitAt: number;
}

export function buildHashForNavState(state: AppNavHistoryState | AppNavInput): string {
  if (state.screen === 'landing') return '#home';
  if (state.screen === 'login') return '#login';
  if (state.screen === 'register') return '#register';
  if (state.screen === 'parent') return '#parent-report';

  if (state.adminTab) {
    return `#admin/${encodeURIComponent(state.adminTab)}`;
  }

  const tab = state.studentTab || 'overview';
  const params = new URLSearchParams();
  if (state.videoId) params.set('video', String(state.videoId));
  if (state.courseId) params.set('course', String(state.courseId));
  if (state.homeworkId) params.set('homework', String(state.homeworkId));
  if (state.examId) params.set('exam', String(state.examId));
  if (state.curriculumWeekId) params.set('week', String(state.curriculumWeekId));
  if (state.curriculumFilter && state.curriculumFilter !== 'ALL') {
    params.set('filter', state.curriculumFilter);
  }
  const qs = params.toString();
  return qs ? `#student/${encodeURIComponent(tab)}?${qs}` : `#student/${encodeURIComponent(tab)}`;
}

export function parseHashToNavState(hash: string): Partial<AppNavHistoryState> | null {
  const clean = (hash || '').replace(/^#/, '').trim();
  if (!clean || clean === 'home') return { screen: 'landing' };
  if (clean === 'login') return { screen: 'login' };
  if (clean === 'register') return { screen: 'register' };
  if (clean === 'parent-report') return { screen: 'parent' };

  if (clean.startsWith('admin/')) {
    return {
      screen: 'dashboard',
      adminTab: decodeURIComponent(clean.slice('admin/'.length).split('?')[0] || 'overview'),
    };
  }

  if (clean.startsWith('student/')) {
    const [pathPart, queryPart] = clean.slice('student/'.length).split('?');
    const params = new URLSearchParams(queryPart || '');
    const toInt = (val: string | null) => {
      if (!val) return null;
      const n = Number(val);
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    const filterRaw = params.get('filter');
    return {
      screen: 'dashboard',
      studentTab: decodeURIComponent(pathPart || 'overview'),
      videoId: toInt(params.get('video')),
      courseId: toInt(params.get('course')),
      homeworkId: toInt(params.get('homework')),
      examId: toInt(params.get('exam')),
      curriculumWeekId: toInt(params.get('week')),
      curriculumFilter: filterRaw === 'OVERDUE' ? 'OVERDUE' : null,
    };
  }

  return null;
}

export function isNavStatesEqual(
  a: Partial<AppNavHistoryState> | null | undefined,
  b: Partial<AppNavHistoryState> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.screen === b.screen &&
    (a.studentTab || '') === (b.studentTab || '') &&
    (a.adminTab || '') === (b.adminTab || '') &&
    (a.videoId ?? null) === (b.videoId ?? null) &&
    (a.courseId ?? null) === (b.courseId ?? null) &&
    (a.homeworkId ?? null) === (b.homeworkId ?? null) &&
    (a.examId ?? null) === (b.examId ?? null) &&
    (a.curriculumWeekId ?? null) === (b.curriculumWeekId ?? null) &&
    (a.curriculumFilter ?? null) === (b.curriculumFilter ?? null)
  );
}

/**
 * Pure builder for the initial in-app history stack so pressing the phone's
 * hardware/gesture Back button always steps backwards inside the platform
 * instead of immediately closing the browser tab or exiting the app.
 */
export function buildInitialHistoryChain(initial: AppNavInput): AppNavHistoryState[] {
  const guard: AppNavHistoryState = {
    __lmsNav: true,
    __lmsGuard: true,
    __lmsDepth: 0,
    screen: 'landing',
  };

  const landingEntry: AppNavHistoryState = {
    __lmsNav: true,
    __lmsDepth: 1,
    screen: 'landing',
  };

  if (initial.screen === 'landing') {
    return [guard, landingEntry];
  }

  if (initial.screen === 'dashboard') {
    const chain: AppNavHistoryState[] = [guard, landingEntry];

    if (initial.adminTab) {
      if (initial.adminTab !== 'overview') {
        chain.push({
          __lmsNav: true,
          __lmsDepth: 2,
          screen: 'dashboard',
          adminTab: 'overview',
        });
        chain.push({
          __lmsNav: true,
          __lmsDepth: 3,
          ...initial,
        });
      } else {
        chain.push({
          __lmsNav: true,
          __lmsDepth: 2,
          ...initial,
        });
      }
      return chain;
    }

    const studentTab = initial.studentTab || 'overview';
    const hasOverlay = Boolean(initial.videoId || initial.examId || initial.homeworkId);

    if (studentTab !== 'overview') {
      chain.push({
        __lmsNav: true,
        __lmsDepth: 2,
        screen: 'dashboard',
        studentTab: 'overview',
      });
      if (hasOverlay) {
        chain.push({
          __lmsNav: true,
          __lmsDepth: 3,
          screen: 'dashboard',
          studentTab,
        });
        chain.push({
          __lmsNav: true,
          __lmsDepth: 4,
          ...initial,
          studentTab,
        });
      } else {
        chain.push({
          __lmsNav: true,
          __lmsDepth: 3,
          ...initial,
          studentTab,
        });
      }
      return chain;
    }

    if (hasOverlay) {
      chain.push({
        __lmsNav: true,
        __lmsDepth: 2,
        screen: 'dashboard',
        studentTab: 'overview',
      });
      chain.push({
        __lmsNav: true,
        __lmsDepth: 3,
        ...initial,
        studentTab: 'overview',
      });
      return chain;
    }

    chain.push({
      __lmsNav: true,
      __lmsDepth: 2,
      ...initial,
      studentTab: 'overview',
    });
    return chain;
  }

  return [
    guard,
    landingEntry,
    {
      __lmsNav: true,
      __lmsDepth: 2,
      ...initial,
    },
  ];
}

/**
 * Pure decision function when the user's hardware/browser Back button reaches
 * the root guard sentinel. Guarantees single accidental presses never kick the
 * user out of the platform.
 */
export function evaluateGuardPop({
  currentScreen,
  lastGuardHitAt,
  nowMs,
  doubleBackWindowMs = 2500,
}: GuardPopInput): GuardPopDecision {
  if (currentScreen !== 'landing') {
    return {
      action: 'go-landing',
      shouldWarn: false,
      nextGuardHitAt: 0,
    };
  }

  if (lastGuardHitAt > 0 && nowMs - lastGuardHitAt <= doubleBackWindowMs) {
    return {
      action: 'allow-exit',
      shouldWarn: false,
      nextGuardHitAt: 0,
    };
  }

  return {
    action: 'warn-and-stay',
    shouldWarn: true,
    nextGuardHitAt: nowMs,
  };
}

let trackedNavDepth = 1;
const depthListeners = new Set<() => void>();

function setTrackedNavDepth(nextDepth: number): void {
  const safe = Math.max(0, nextDepth);
  if (trackedNavDepth !== safe) {
    trackedNavDepth = safe;
    depthListeners.forEach((fn) => fn());
  }
}

export function getLmsHistoryDepth(): number {
  if (typeof window !== 'undefined' && window.history?.state) {
    const st = window.history.state as AppNavHistoryState | null;
    if (st?.__lmsNav && typeof st.__lmsDepth === 'number') {
      return st.__lmsDepth;
    }
  }
  return trackedNavDepth;
}

export function syncTrackedNavDepthFromState(state: unknown): void {
  const st = state as AppNavHistoryState | null;
  if (st?.__lmsNav && typeof st.__lmsDepth === 'number') {
    setTrackedNavDepth(st.__lmsDepth);
  }
}

export function subscribeLmsNavDepth(listener: () => void): () => void {
  depthListeners.add(listener);
  return () => {
    depthListeners.delete(listener);
  };
}

/**
 * Seeds the bottom root guard sentinel and any missing parent entries on boot.
 */
export function ensureLmsRootGuard(initial: AppNavInput): void {
  if (typeof window === 'undefined' || !window.history) return;
  const current = window.history.state as AppNavHistoryState | null;

  // Guard already seeded in this browsing session (e.g. reload with preserved state)
  if (current?.__lmsNav && !current.__lmsGuard && (current.__lmsDepth ?? 0) >= 1) {
    setTrackedNavDepth(current.__lmsDepth ?? 1);
    if (!isNavStatesEqual(current, initial)) {
      pushLmsHistoryState(initial, 'replace');
    }
    return;
  }

  const chain = buildInitialHistoryChain(initial);
  try {
    window.history.replaceState(chain[0], '', buildHashForNavState(chain[0]));
    for (let i = 1; i < chain.length; i += 1) {
      window.history.pushState(chain[i], '', buildHashForNavState(chain[i]));
    }
    setTrackedNavDepth(chain[chain.length - 1].__lmsDepth ?? 1);
  } catch {
    // Ignore history API errors in restricted sandboxed contexts
  }
}

export function pushLmsHistoryState(
  next: AppNavInput,
  mode: 'push' | 'replace' = 'push',
): void {
  if (typeof window === 'undefined' || !window.history) return;
  const current = window.history.state as AppNavHistoryState | null;

  if (current?.__lmsNav && !current.__lmsGuard && isNavStatesEqual(current, next)) {
    if (typeof current.__lmsDepth === 'number') {
      setTrackedNavDepth(current.__lmsDepth);
    }
    return;
  }

  // Never overwrite the root guard sentinel via replaceState
  const effectiveMode: 'push' | 'replace' = current?.__lmsGuard ? 'push' : mode;
  const baseDepth =
    current?.__lmsNav && typeof current.__lmsDepth === 'number'
      ? current.__lmsDepth
      : trackedNavDepth;

  const nextDepth =
    effectiveMode === 'replace' ? Math.max(1, baseDepth) : Math.max(1, baseDepth + 1);

  const fullState: AppNavHistoryState = {
    __lmsNav: true,
    __lmsDepth: nextDepth,
    ...next,
  };

  const hash = buildHashForNavState(fullState);
  try {
    if (effectiveMode === 'replace') {
      window.history.replaceState(fullState, '', hash);
    } else {
      window.history.pushState(fullState, '', hash);
    }
    setTrackedNavDepth(nextDepth);
  } catch {
    // Ignore history API errors in restricted sandboxed contexts
  }
}

/**
 * Safely navigates back inside the platform without ever kicking the user out
 * of the website/browser. Uses browser history when an in-app parent entry
 * exists (depth > 1), otherwise runs the provided in-app fallback.
 */
export function goBackInLms(fallback: () => void): boolean {
  if (typeof window !== 'undefined' && window.history && getLmsHistoryDepth() > 1) {
    window.history.back();
    return true;
  }
  fallback();
  return false;
}
