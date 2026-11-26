import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTableScrollMetrics,
  getScheduleRowStaggerMs,
  INITIAL_TABLE_SCROLL_METRICS,
} from './tableScrollMotion.ts';

test('computeTableScrollMetrics returns zeroed state when table fits without overflow', () => {
  const res = computeTableScrollMetrics({
    scrollLeft: 0,
    scrollWidth: 600,
    clientWidth: 640,
    scrollTop: 0,
    scrollHeight: 280,
    clientHeight: 400,
  });

  assert.deepEqual(res, INITIAL_TABLE_SCROLL_METRICS);
});

test('computeTableScrollMetrics tracks RTL negative scrollLeft progression accurately', () => {
  // Initial RTL position (at right edge: scrollLeft = 0)
  const atStart = computeTableScrollMetrics({
    scrollLeft: 0,
    scrollWidth: 800,
    clientWidth: 350,
    scrollTop: 0,
    scrollHeight: 600,
    clientHeight: 300,
  });
  assert.equal(atStart.hasOverflowX, true);
  assert.equal(atStart.hasOverflowY, true);
  assert.equal(atStart.canScrollStart, false);
  assert.equal(atStart.canScrollEnd, true);
  assert.equal(atStart.isScrolledX, false);
  assert.equal(atStart.hasMoreEndShadow, true);
  assert.equal(atStart.hasMoreBottomShadow, true);
  assert.equal(atStart.progressX, 0);

  // Mid-scroll in RTL (Chromium/Firefox use negative scrollLeft)
  const mid = computeTableScrollMetrics({
    scrollLeft: -225,
    scrollWidth: 800,
    clientWidth: 350,
    scrollTop: 150,
    scrollHeight: 600,
    clientHeight: 300,
  });
  assert.equal(mid.canScrollStart, true);
  assert.equal(mid.canScrollEnd, true);
  assert.equal(mid.isScrolledX, true);
  assert.equal(mid.isScrolledY, true);
  assert.equal(mid.progressX, 0.5);
  assert.equal(mid.progressY, 0.5);
  assert.equal(mid.hasMoreEndShadow, true);
  assert.equal(mid.hasMoreBottomShadow, true);

  // Reached far-left end & bottom end
  const atEnd = computeTableScrollMetrics({
    scrollLeft: -450,
    scrollWidth: 800,
    clientWidth: 350,
    scrollTop: 300,
    scrollHeight: 600,
    clientHeight: 300,
  });
  assert.equal(atEnd.canScrollStart, true);
  assert.equal(atEnd.canScrollEnd, false);
  assert.equal(atEnd.hasMoreEndShadow, false);
  assert.equal(atEnd.hasMoreBottomShadow, false);
  assert.equal(atEnd.progressX, 1);
  assert.equal(atEnd.progressY, 1);
});

test('getScheduleRowStaggerMs caps delay cleanly and handles invalid/negative indices', () => {
  assert.equal(getScheduleRowStaggerMs(-2), 0);
  assert.equal(getScheduleRowStaggerMs(0), 0);
  assert.equal(getScheduleRowStaggerMs(3), 84);
  assert.equal(getScheduleRowStaggerMs(20), 168);
});
