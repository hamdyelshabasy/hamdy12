import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHashForNavState,
  buildInitialHistoryChain,
  evaluateGuardPop,
  isNavStatesEqual,
  parseHashToNavState,
} from './navigationHistory.ts';

test('buildHashForNavState and parseHashToNavState round-trip all primary routes', () => {
  assert.equal(buildHashForNavState({ screen: 'landing' }), '#home');
  assert.equal(buildHashForNavState({ screen: 'login' }), '#login');
  assert.equal(buildHashForNavState({ screen: 'register' }), '#register');
  assert.equal(buildHashForNavState({ screen: 'parent' }), '#parent-report');
  assert.equal(buildHashForNavState({ screen: 'dashboard', adminTab: 'students' }), '#admin/students');
  assert.equal(
    buildHashForNavState({ screen: 'dashboard', studentTab: 'library', videoId: 42 }),
    '#student/library?video=42',
  );

  assert.deepEqual(parseHashToNavState('#admin/students'), {
    screen: 'dashboard',
    adminTab: 'students',
  });
  assert.deepEqual(parseHashToNavState('#student/library?video=42'), {
    screen: 'dashboard',
    studentTab: 'library',
    videoId: 42,
    courseId: null,
    homeworkId: null,
    examId: null,
    curriculumWeekId: null,
    curriculumFilter: null,
  });
});

test('buildInitialHistoryChain seeds root guard below landing screen', () => {
  const chain = buildInitialHistoryChain({ screen: 'landing' });
  assert.equal(chain.length, 2);
  assert.equal(chain[0].__lmsGuard, true);
  assert.equal(chain[0].__lmsDepth, 0);
  assert.equal(chain[1].__lmsGuard, undefined);
  assert.equal(chain[1].__lmsDepth, 1);
  assert.equal(chain[1].screen, 'landing');
});

test('buildInitialHistoryChain inserts landing and overview underneath deep admin sub-tab', () => {
  const chain = buildInitialHistoryChain({ screen: 'dashboard', adminTab: 'students' });
  assert.equal(chain.length, 4);
  assert.equal(chain[0].__lmsGuard, true);
  assert.equal(chain[1].screen, 'landing');
  assert.equal(chain[2].adminTab, 'overview');
  assert.equal(chain[3].adminTab, 'students');
  assert.equal(chain[3].__lmsDepth, 3);
});

test('buildInitialHistoryChain inserts landing, overview, and section tab underneath deep student video overlay', () => {
  const chain = buildInitialHistoryChain({
    screen: 'dashboard',
    studentTab: 'library',
    videoId: 17,
  });
  assert.equal(chain.length, 5);
  assert.equal(chain[0].__lmsGuard, true);
  assert.equal(chain[1].screen, 'landing');
  assert.equal(chain[2].studentTab, 'overview');
  assert.equal(chain[3].studentTab, 'library');
  assert.equal(chain[3].videoId, undefined);
  assert.equal(chain[4].studentTab, 'library');
  assert.equal(chain[4].videoId, 17);
  assert.equal(chain[4].__lmsDepth, 4);
});

test('evaluateGuardPop prevents accidental single-back exit and allows intentional double-back on landing', () => {
  // From dashboard/auth -> returns to landing instead of exiting
  const fromDash = evaluateGuardPop({
    currentScreen: 'dashboard',
    lastGuardHitAt: 0,
    nowMs: 1000,
  });
  assert.equal(fromDash.action, 'go-landing');
  assert.equal(fromDash.shouldWarn, false);

  // First Back press on landing -> warn & stay
  const firstLanding = evaluateGuardPop({
    currentScreen: 'landing',
    lastGuardHitAt: 0,
    nowMs: 5000,
  });
  assert.equal(firstLanding.action, 'warn-and-stay');
  assert.equal(firstLanding.shouldWarn, true);
  assert.equal(firstLanding.nextGuardHitAt, 5000);

  // Second Back press within 2.5s window -> allow exit
  const secondFast = evaluateGuardPop({
    currentScreen: 'landing',
    lastGuardHitAt: firstLanding.nextGuardHitAt,
    nowMs: 6500,
  });
  assert.equal(secondFast.action, 'allow-exit');
  assert.equal(secondFast.shouldWarn, false);

  // Second Back press after 2.5s window -> warn & stay again
  const secondSlow = evaluateGuardPop({
    currentScreen: 'landing',
    lastGuardHitAt: firstLanding.nextGuardHitAt,
    nowMs: 9000,
  });
  assert.equal(secondSlow.action, 'warn-and-stay');
  assert.equal(secondSlow.shouldWarn, true);
});

test('isNavStatesEqual compares semantic navigation fields while ignoring metadata', () => {
  assert.equal(
    isNavStatesEqual(
      { __lmsNav: true, __lmsDepth: 2, screen: 'dashboard', adminTab: 'exams' },
      { __lmsNav: true, __lmsDepth: 3, screen: 'dashboard', adminTab: 'exams' },
    ),
    true,
  );
  assert.equal(
    isNavStatesEqual(
      { screen: 'dashboard', adminTab: 'exams' },
      { screen: 'dashboard', adminTab: 'videos' },
    ),
    false,
  );
});
