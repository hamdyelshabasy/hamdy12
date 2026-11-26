export interface TableScrollSnapshot {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface TableScrollMetrics {
  hasOverflowX: boolean;
  hasOverflowY: boolean;
  canScrollStart: boolean;
  canScrollEnd: boolean;
  isScrolledX: boolean;
  isScrolledY: boolean;
  progressX: number;
  progressY: number;
  hasMoreEndShadow: boolean;
  hasMoreBottomShadow: boolean;
}

export const INITIAL_TABLE_SCROLL_METRICS: TableScrollMetrics = {
  hasOverflowX: false,
  hasOverflowY: false,
  canScrollStart: false,
  canScrollEnd: false,
  isScrolledX: false,
  isScrolledY: false,
  progressX: 0,
  progressY: 0,
  hasMoreEndShadow: false,
  hasMoreBottomShadow: false,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Computes RTL-safe horizontal and vertical scroll state & normalized progress (0..1)
 * for responsive data tables. Handles negative RTL scrollLeft cleanly across browsers.
 */
export function computeTableScrollMetrics(
  snapshot: TableScrollSnapshot,
  thresholdPx = 4,
): TableScrollMetrics {
  const maxScrollX = Math.max(0, snapshot.scrollWidth - snapshot.clientWidth);
  const maxScrollY = Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);

  const hasOverflowX = maxScrollX > thresholdPx;
  const hasOverflowY = maxScrollY > thresholdPx;

  const absX = Math.min(maxScrollX, Math.abs(snapshot.scrollLeft || 0));
  const clampedY = Math.min(maxScrollY, Math.max(0, snapshot.scrollTop || 0));

  const isScrolledX = hasOverflowX && absX > thresholdPx;
  const isScrolledY = hasOverflowY && clampedY > thresholdPx;

  const canScrollStart = isScrolledX;
  const canScrollEnd = hasOverflowX && absX < maxScrollX - thresholdPx;

  const progressX = hasOverflowX ? clamp01(absX / maxScrollX) : 0;
  const progressY = hasOverflowY ? clamp01(clampedY / maxScrollY) : 0;

  return {
    hasOverflowX,
    hasOverflowY,
    canScrollStart,
    canScrollEnd,
    isScrolledX,
    isScrolledY,
    progressX,
    progressY,
    hasMoreEndShadow: canScrollEnd,
    hasMoreBottomShadow: hasOverflowY && clampedY < maxScrollY - thresholdPx,
  };
}

/**
 * Returns a gentle, bounded CSS transition delay (ms) for staggered table row entrance.
 */
export function getScheduleRowStaggerMs(index: number, stepMs = 28, maxMs = 168): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index) * stepMs, maxMs);
}
