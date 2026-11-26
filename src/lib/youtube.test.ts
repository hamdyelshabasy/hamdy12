import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrivacyEnhancedEmbedUrl,
  clampSeekTarget,
  computeVerifiedVideoProgress,
  extractYouTubeVideoId,
  getYouTubeErrorMessageAr,
  resolveResumePositionSec,
  shouldPreservePlayerInstance,
} from './youtube.ts';

test('extractYouTubeVideoId supports watch, youtu.be, shorts, embed, nocookie, and live URLs', () => {
  const id = 'mc979OhitAg';
  const urls = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?v=${id}&t=125s&list=PL123456`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc123`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `youtube.com/watch?v=${id}`,
  ];

  for (const url of urls) {
    const parsed = extractYouTubeVideoId(url);
    assert.equal(parsed.valid, true, `Expected URL to be valid: ${url}`);
    assert.equal(parsed.videoId, id, `Expected video ID ${id} for ${url}`);
    assert.ok(parsed.embedUrl?.startsWith(`https://www.youtube-nocookie.com/embed/${id}`));
    assert.equal(parsed.thumbnailUrl, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  }

  assert.equal(extractYouTubeVideoId(`https://www.youtube.com/live/${id}`).isLiveUrl, true);
  assert.equal(extractYouTubeVideoId(`https://www.youtube.com/shorts/${id}`).isShortsUrl, true);
});

test('extractYouTubeVideoId rejects non-YouTube domains, playlists without video ID, and malformed IDs', () => {
  const invalidUrls = [
    '',
    'not a url',
    'https://vimeo.com/123456789',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/too_long_video_id_12345',
    'https://evil-youtube.com/watch?v=mc979OhitAg',
  ];

  for (const url of invalidUrls) {
    const parsed = extractYouTubeVideoId(url);
    assert.equal(parsed.valid, false, `Expected URL to be invalid: ${url}`);
    assert.equal(parsed.videoId, null);
    assert.ok(parsed.errorAr && parsed.errorAr.length > 5);
  }
});

test('getYouTubeErrorMessageAr returns clear Arabic messages for private/deleted/non-embeddable/referrer errors', () => {
  assert.ok(getYouTubeErrorMessageAr(100).includes('غير متاح'));
  assert.ok(getYouTubeErrorMessageAr(101).includes('التضمين'));
  assert.ok(getYouTubeErrorMessageAr(150).includes('التضمين'));
  assert.ok(getYouTubeErrorMessageAr(153).includes('Referrer'));
  assert.ok(getYouTubeErrorMessageAr(2).includes('غير صالح'));
});

test('computeVerifiedVideoProgress does not falsely mark completed when seeking to end without watching', () => {
  const skipped = computeVerifiedVideoProgress({
    lastPositionSec: 990,
    watchedSec: 25,
    previousWatchedSec: 0,
    previousCompletionPercent: 0,
    previousIsCompleted: false,
    durationSec: 1000,
  });
  assert.equal(skipped.isCompleted, false);
  assert.equal(skipped.completionPercent, 3);
  assert.equal(skipped.lastPositionSec, 990);

  const watchedEnough = computeVerifiedVideoProgress({
    lastPositionSec: 900,
    watchedSec: 860,
    previousWatchedSec: 400,
    previousCompletionPercent: 40,
    previousIsCompleted: false,
    durationSec: 1000,
  });
  assert.equal(watchedEnough.isCompleted, true);
  assert.equal(watchedEnough.completionPercent, 86);
  assert.equal(watchedEnough.watchedSec, 860);
});

test('clampSeekTarget clamps forward and backward seeks safely within [0, duration]', () => {
  assert.equal(clampSeekTarget(120, 15, 600), 135);
  assert.equal(clampSeekTarget(120, -15, 600), 105);
  assert.equal(clampSeekTarget(5, -15, 600), 0);
  assert.equal(clampSeekTarget(595, 20, 600), 600);
  assert.equal(clampSeekTarget(50, 10, 0), 60);
});

test('resolveResumePositionSec preserves active position and restores saved position without resetting to 0', () => {
  // Active live position wins on retry
  assert.equal(
    resolveResumePositionSec({ currentTimeSec: 245, savedResumeSec: 120, durationSec: 600 }),
    245,
  );
  // Saved server position is restored when reopening lesson
  assert.equal(
    resolveResumePositionSec({ currentTimeSec: 0, savedResumeSec: 185, durationSec: 600 }),
    185,
  );
  // Near very start (< 3s) starts cleanly at 0
  assert.equal(
    resolveResumePositionSec({ currentTimeSec: 0, savedResumeSec: 2, durationSec: 600 }),
    0,
  );
  // Already finished (within 3s of end) restarts at 0 for clean replay
  assert.equal(
    resolveResumePositionSec({ currentTimeSec: 0, savedResumeSec: 599, durationSec: 600 }),
    0,
  );
});

test('shouldPreservePlayerInstance keeps player mounted unless videoId, youtubeVideoId, or retryNonce changes', () => {
  const initial = { videoId: 1, youtubeVideoId: 'mc979OhitAg', retryNonce: 0 };
  assert.equal(shouldPreservePlayerInstance(initial, { ...initial }), true);
  assert.equal(
    shouldPreservePlayerInstance(initial, { videoId: 2, youtubeVideoId: 'mc979OhitAg', retryNonce: 0 }),
    false,
  );
  assert.equal(
    shouldPreservePlayerInstance(initial, { videoId: 1, youtubeVideoId: 'ZM8ECpBuQYE', retryNonce: 0 }),
    false,
  );
  assert.equal(
    shouldPreservePlayerInstance(initial, { videoId: 1, youtubeVideoId: 'mc979OhitAg', retryNonce: 1 }),
    false,
  );
  assert.equal(shouldPreservePlayerInstance(null, initial), false);
});

test('buildPrivacyEnhancedEmbedUrl uses youtube-nocookie.com with supported params only', () => {
  const url = buildPrivacyEnhancedEmbedUrl('mc979OhitAg', 45, 'https://example.com');
  assert.ok(url.startsWith('https://www.youtube-nocookie.com/embed/mc979OhitAg?'));
  assert.ok(url.includes('rel=0'));
  assert.ok(url.includes('fs=1'));
  assert.ok(url.includes('start=45'));
  assert.ok(url.includes('origin=https%3A%2F%2Fexample.com'));
  assert.ok(!url.includes('modestbranding'));
});

