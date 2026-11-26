const SAFE_IMAGE_DATA_URL_REGEX =
  /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

const MAX_THUMBNAIL_DATA_URL_LENGTH = 3_500_000; // ~2.5MB decoded image max

export interface ThumbnailValidationResult {
  valid: boolean;
  normalized: string;
  errorAr?: string;
}

/**
 * Strictly validates a video thumbnail URL or uploaded image data URL.
 * Allows:
 * - empty string (falls back to YouTube thumbnail)
 * - trusted relative asset paths (/src/assets/... or /assets/...)
 * - http:// or https:// image URLs
 * - safe raster image base64 data URLs (PNG, JPEG, WEBP, GIF) within size limit
 * Blocks javascript:, data:text/html, data:image/svg+xml, application/pdf, etc.
 */
export function validateVideoThumbnailUrl(input: unknown): ThumbnailValidationResult {
  if (input === null || input === undefined) {
    return { valid: true, normalized: '' };
  }
  if (typeof input !== 'string') {
    return { valid: false, normalized: '', errorAr: 'صيغة الصورة المصغرة غير صالحة.' };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  // Allow safe internal static asset paths (no traversal)
  if (
    (trimmed.startsWith('/src/assets/') || trimmed.startsWith('/assets/')) &&
    !trimmed.includes('..') &&
    !trimmed.includes('\\')
  ) {
    return { valid: true, normalized: trimmed };
  }

  // Allow safe raster image data URLs uploaded from computer
  if (trimmed.toLowerCase().startsWith('data:')) {
    if (trimmed.length > MAX_THUMBNAIL_DATA_URL_LENGTH) {
      return {
        valid: false,
        normalized: '',
        errorAr: 'حجم الصورة المصغرة كبير جدًا. يرجى اختيار صورة أصغر من 2.5 ميجابايت.',
      };
    }
    if (!SAFE_IMAGE_DATA_URL_REGEX.test(trimmed)) {
      return {
        valid: false,
        normalized: '',
        errorAr: 'نوع الصورة غير مدعوم. الصيغ المسموحة فقط هي PNG و JPG و WEBP و GIF.',
      };
    }
    return { valid: true, normalized: trimmed };
  }

  // Allow valid http(s) URLs only
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        normalized: '',
        errorAr: 'رابط الصورة المصغرة يجب أن يبدأ بـ https:// أو http:// أو يتم رفعه من الجهاز.',
      };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return {
      valid: false,
      normalized: '',
      errorAr: 'رابط الصورة المصغرة غير صالح.',
    };
  }
}

/**
 * Converts watched seconds to minutes rounded to 1 decimal place (e.g., 90 -> 1.5).
 */
export function computeWatchedMinutes(watchedSec: number): number {
  const safeSec = Math.max(0, Number.isFinite(watchedSec) ? watchedSec : 0);
  return Math.round((safeSec / 60) * 10) / 10;
}

/**
 * Formats actual watched duration into concise Arabic (e.g. "0 د", "45 ث", "12 د 30 ث", "1 س 15 د").
 */
export function formatWatchedDurationAr(watchedSec: number): string {
  const safeSec = Math.max(0, Math.floor(Number.isFinite(watchedSec) ? watchedSec : 0));
  if (safeSec === 0) return '0 دقيقة';
  if (safeSec < 60) return `${safeSec} ثانية`;

  const hours = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;

  if (hours > 0) {
    return mins > 0 ? `${hours} س ${mins} د` : `${hours} ساعة`;
  }
  return secs > 0 ? `${mins} د ${secs} ث` : `${mins} دقيقة`;
}

export interface RawVideoViewerRow {
  userId: number;
  fullName: string;
  phone: string | null;
  gradeNameAr: string | null;
  watchedSec: number;
  lastPositionSec: number;
  completionPercent: number;
  isCompleted: boolean;
  countedOpens: number;
  updatedAt: Date | string | null;
}

export interface VideoViewerItem {
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

export interface VideoViewersAnalytics {
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

/**
 * Aggregates real per-student viewing data for a single video.
 */
export function buildVideoViewersAnalytics(
  video: { id: number; titleAr: string; durationSec: number; viewsCount: number },
  rows: readonly RawVideoViewerRow[],
): VideoViewersAnalytics {
  const safeDuration = Math.max(0, Number(video.durationSec) || 0);

  const viewers: VideoViewerItem[] = rows
    .map((r) => {
      const watchedSec = Math.max(0, Math.floor(Number(r.watchedSec) || 0));
      const lastPositionSec = Math.max(0, Math.floor(Number(r.lastPositionSec) || 0));
      let completion = Math.round(Number(r.completionPercent) || 0);
      if (completion === 0 && safeDuration > 0 && watchedSec > 0) {
        completion = Math.round((Math.min(watchedSec, safeDuration) / safeDuration) * 100);
      }
      completion = Math.max(0, Math.min(100, completion));
      const isCompleted = Boolean(r.isCompleted) || completion >= 90;

      const updatedDate = r.updatedAt ? new Date(r.updatedAt) : null;
      const lastWatchedAt =
        updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toISOString() : null;

      return {
        userId: r.userId,
        fullName: r.fullName || 'طالب',
        phone: r.phone || null,
        gradeNameAr: r.gradeNameAr || 'غير محدد',
        watchedSec,
        watchedMinutes: computeWatchedMinutes(watchedSec),
        watchedDurationLabelAr: formatWatchedDurationAr(watchedSec),
        lastPositionSec,
        completionPercent: completion,
        isCompleted,
        countedOpens: Math.max(0, Math.floor(Number(r.countedOpens) || 0)),
        lastWatchedAt,
      };
    })
    .sort((a, b) => {
      const timeA = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
      const timeB = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return b.watchedSec - a.watchedSec;
    });

  const uniqueViewers = viewers.length;
  const completedCount = viewers.filter((v) => v.isCompleted).length;
  const inProgressCount = uniqueViewers - completedCount;
  const totalWatchedSec = viewers.reduce((acc, v) => acc + v.watchedSec, 0);
  const totalWatchedMinutes = computeWatchedMinutes(totalWatchedSec);
  const averageCompletionPercent =
    uniqueViewers > 0
      ? Math.round(viewers.reduce((acc, v) => acc + v.completionPercent, 0) / uniqueViewers)
      : 0;

  return {
    video: {
      id: video.id,
      titleAr: video.titleAr,
      durationSec: safeDuration,
      viewsCount: Math.max(0, Number(video.viewsCount) || 0),
    },
    summary: {
      uniqueViewers,
      completedCount,
      inProgressCount,
      totalWatchedSec,
      totalWatchedMinutes,
      averageCompletionPercent,
      viewsCount: Math.max(0, Number(video.viewsCount) || 0),
    },
    viewers,
  };
}
