const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export interface ParsedYouTubeUrl {
  valid: boolean;
  videoId: string | null;
  canonicalUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  fallbackThumbnailUrl: string | null;
  isLiveUrl: boolean;
  isShortsUrl: boolean;
  errorAr?: string;
}

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

export function buildYouTubeThumbnailUrl(videoId: string, quality: 'hqdefault' | 'mqdefault' | 'maxresdefault' = 'hqdefault'): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

export function buildPrivacyEnhancedEmbedUrl(videoId: string, startSec = 0, origin?: string): string {
  const params = new URLSearchParams({
    rel: '0',
    playsinline: '1',
    iv_load_policy: '3',
    fs: '1',
    enablejsapi: '1',
  });
  if (startSec >= 3) {
    params.set('start', String(Math.floor(startSec)));
  }
  if (origin) {
    params.set('origin', origin);
  }
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function extractYouTubeVideoId(rawInput: string): ParsedYouTubeUrl {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      videoId: null,
      canonicalUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
      fallbackThumbnailUrl: null,
      isLiveUrl: false,
      isShortsUrl: false,
      errorAr: 'يرجى إدخال رابط فيديو يوتيوب صحيح.',
    };
  }

  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      valid: false,
      videoId: null,
      canonicalUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
      fallbackThumbnailUrl: null,
      isLiveUrl: false,
      isShortsUrl: false,
      errorAr: 'صيغة الرابط غير صالحة. يرجى لصق رابط يوتيوب كامل وصحيح.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return {
      valid: false,
      videoId: null,
      canonicalUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
      fallbackThumbnailUrl: null,
      isLiveUrl: false,
      isShortsUrl: false,
      errorAr: 'الرابط المدخل ليس رابط يوتيوب معتمدًا (youtube.com أو youtu.be).',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let candidateId: string | null = null;
  let isLiveUrl = false;
  let isShortsUrl = false;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidateId = segments[0] || null;
  } else {
    const first = segments[0]?.toLowerCase() || '';
    if (first === 'watch' || segments.length === 0) {
      candidateId = parsed.searchParams.get('v');
    } else if (first === 'shorts') {
      candidateId = segments[1] || null;
      isShortsUrl = true;
    } else if (first === 'embed' || first === 'v') {
      candidateId = segments[1] || null;
    } else if (first === 'live') {
      candidateId = segments[1] || null;
      isLiveUrl = true;
    } else {
      // Fallback for watch URLs with unusual prefixes carrying ?v=
      candidateId = parsed.searchParams.get('v');
    }
  }

  if (!candidateId || !YOUTUBE_ID_REGEX.test(candidateId)) {
    return {
      valid: false,
      videoId: null,
      canonicalUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
      fallbackThumbnailUrl: null,
      isLiveUrl,
      isShortsUrl,
      errorAr: 'تعذر استخراج معرّف فيديو يوتيوب صالح (يجب أن يتكون من 11 حرفًا). تأكد من نسخ رابط الفيديو نفسه وليس رابط القناة أو قائمة التشغيل.',
    };
  }

  return {
    valid: true,
    videoId: candidateId,
    canonicalUrl: `https://www.youtube.com/watch?v=${candidateId}`,
    embedUrl: buildPrivacyEnhancedEmbedUrl(candidateId),
    thumbnailUrl: buildYouTubeThumbnailUrl(candidateId, 'hqdefault'),
    fallbackThumbnailUrl: buildYouTubeThumbnailUrl(candidateId, 'mqdefault'),
    isLiveUrl,
    isShortsUrl,
  };
}

export function getYouTubeErrorMessageAr(errorCode: number): string {
  switch (errorCode) {
    case 2:
      return 'معرّف فيديو يوتيوب غير صالح. يرجى التواصل مع المدرس لتحديث رابط المحاضرة.';
    case 5:
      return 'تعذر تشغيل الفيديو داخل مشغل المتصفح (خطأ HTML5). جرّب تحديث الصفحة أو استخدام متصفح حديث.';
    case 100:
      return 'هذا الفيديو غير متاح حاليًا على يوتيوب (ربما تم حذفه أو تحويله إلى خاص). يرجى إبلاغ المدرس.';
    case 101:
    case 150:
      return 'مالك الفيديو على يوتيوب عطّل خيار التضمين داخل المواقع الخارجية أو قيّده بعمر محدد. يرجى تفعيل خيار "السماح بالتضمين" من إعدادات الفيديو في YouTube Studio.';
    case 153:
      return 'رفض مشغل يوتيوب التشغيل بسبب إعدادات سياسة المُحيل (Referrer) في المتصفح. جرّب تعطيل إضافات حجب المُحيل أو تحديث الصفحة.';
    default:
      return 'حدث خطأ أثناء تحميل فيديو يوتيوب. تأكد من اتصالك بالإنترنت أو تواصل مع الدعم الفني.';
  }
}

export interface ProgressComputationInput {
  lastPositionSec: number;
  watchedSec: number;
  previousWatchedSec: number;
  previousCompletionPercent: number;
  previousIsCompleted: boolean;
  durationSec: number;
  completionThresholdPercent?: number;
}

export interface ProgressComputationResult {
  lastPositionSec: number;
  watchedSec: number;
  completionPercent: number;
  isCompleted: boolean;
}

/**
 * Computes verified video playback progress.
 * Completion requires actual accumulated watched seconds >= threshold (default 85%),
 * preventing false completion when a student jumps the seekbar to the end without watching.
 */
export function computeVerifiedVideoProgress(
  input: ProgressComputationInput,
): ProgressComputationResult {
  const duration = Math.max(1, Math.round(input.durationSec));
  const threshold = input.completionThresholdPercent ?? 85;
  const clampedPos = Math.min(duration, Math.max(0, Math.round(input.lastPositionSec)));
  const clampedWatched = Math.min(duration, Math.max(0, Math.round(input.watchedSec)));
  const totalWatched = Math.min(duration, Math.max(Math.round(input.previousWatchedSec || 0), clampedWatched));

  const pctFromWatch = Math.min(100, Math.max(0, Math.round((totalWatched / duration) * 100)));
  const completionPercent = Math.min(100, Math.max(Math.round(input.previousCompletionPercent || 0), pctFromWatch));
  const isCompleted = Boolean(input.previousIsCompleted) || pctFromWatch >= threshold;

  return {
    lastPositionSec: clampedPos,
    watchedSec: totalWatched,
    completionPercent,
    isCompleted,
  };
}

/**
 * Clamps a relative seek operation (forward or backward) within [0, durationSec].
 */
export function clampSeekTarget(currentSec: number, deltaSec: number, durationSec: number): number {
  const safeCurrent = Number.isFinite(currentSec) ? Math.max(0, currentSec) : 0;
  const safeDelta = Number.isFinite(deltaSec) ? deltaSec : 0;
  const rawTarget = Math.max(0, safeCurrent + safeDelta);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    return Math.min(durationSec, rawTarget);
  }
  return rawTarget;
}

/**
 * Resolves the playback resume timestamp without unexpectedly resetting to 00:00.
 * Prefers the live in-session position (e.g. after an error retry), falling back to
 * the server-saved position when reopening a lesson. Restarts from 0 only if the
 * saved position is at the very start (< 3s) or already within 3s of the end.
 */
export function resolveResumePositionSec(params: {
  currentTimeSec: number;
  savedResumeSec: number;
  durationSec: number;
}): number {
  const livePos = Number.isFinite(params.currentTimeSec) ? Math.max(0, Math.floor(params.currentTimeSec)) : 0;
  const savedPos = Number.isFinite(params.savedResumeSec) ? Math.max(0, Math.floor(params.savedResumeSec)) : 0;
  const candidate = livePos >= 3 ? livePos : savedPos;
  if (candidate < 3) return 0;
  if (Number.isFinite(params.durationSec) && params.durationSec > 10 && candidate >= params.durationSec - 3) {
    return 0;
  }
  return candidate;
}

export interface PlayerMountIdentity {
  videoId: number;
  youtubeVideoId: string | null;
  retryNonce: number;
}

/**
 * Returns true when an existing mounted YT.Player instance must be preserved rather
 * than destroyed/recreated. Progress updates, time ticks, and parent re-renders
 * never alter the mount identity.
 */
export function shouldPreservePlayerInstance(
  prev: PlayerMountIdentity | null,
  next: PlayerMountIdentity,
): boolean {
  if (!prev || !next.youtubeVideoId) return false;
  return (
    prev.videoId === next.videoId &&
    prev.youtubeVideoId === next.youtubeVideoId &&
    prev.retryNonce === next.retryNonce
  );
}

