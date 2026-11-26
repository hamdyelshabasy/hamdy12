import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoViewersAnalytics,
  computeWatchedMinutes,
  formatWatchedDurationAr,
  validateVideoThumbnailUrl,
} from './videoManagement.ts';

test('validateVideoThumbnailUrl accepts safe image data URLs, https URLs, and internal asset paths', () => {
  assert.equal(validateVideoThumbnailUrl('').valid, true);
  assert.equal(validateVideoThumbnailUrl('https://i.ytimg.com/vi/abc12345678/hqdefault.jpg').valid, true);
  assert.equal(validateVideoThumbnailUrl('/src/assets/images/course_electricity.jpg').valid, true);
  assert.equal(validateVideoThumbnailUrl('data:image/png;base64,iVBORw0KGgo=').valid, true);
  assert.equal(validateVideoThumbnailUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==').valid, true);
  assert.equal(validateVideoThumbnailUrl('data:image/webp;base64,UklGRh4AAABXRUJQ').valid, true);
  assert.equal(validateVideoThumbnailUrl('data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==').valid, true);
});

test('validateVideoThumbnailUrl blocks XSS payloads, SVG, PDF, javascript:, and path traversal', () => {
  assert.equal(validateVideoThumbnailUrl('data:image/svg+xml;base64,PHN2Zz4=').valid, false);
  assert.equal(validateVideoThumbnailUrl('data:text/html;base64,PHNjcmlwdD4=').valid, false);
  assert.equal(validateVideoThumbnailUrl('data:application/pdf;base64,JVBERi0xLjQ=').valid, false);
  assert.equal(validateVideoThumbnailUrl('javascript:alert(1)').valid, false);
  assert.equal(validateVideoThumbnailUrl('/src/assets/../../etc/passwd').valid, false);
  assert.equal(validateVideoThumbnailUrl('ftp://evil.example/img.png').valid, false);
  // Oversized data URL
  const huge = 'data:image/png;base64,' + 'A'.repeat(3_600_000);
  assert.equal(validateVideoThumbnailUrl(huge).valid, false);
});

test('computeWatchedMinutes and formatWatchedDurationAr format real watch times cleanly', () => {
  assert.equal(computeWatchedMinutes(0), 0);
  assert.equal(computeWatchedMinutes(90), 1.5);
  assert.equal(computeWatchedMinutes(630), 10.5);
  assert.equal(computeWatchedMinutes(-25), 0);

  assert.equal(formatWatchedDurationAr(0), '0 دقيقة');
  assert.equal(formatWatchedDurationAr(45), '45 ثانية');
  assert.equal(formatWatchedDurationAr(120), '2 دقيقة');
  assert.equal(formatWatchedDurationAr(750), '12 د 30 ث');
  assert.equal(formatWatchedDurationAr(4500), '1 س 15 د');
});

test('buildVideoViewersAnalytics calculates unique viewers, actual minutes, completion clamp, and sorting', () => {
  const analytics = buildVideoViewersAnalytics(
    { id: 10, titleAr: 'قانون كيرشوف', durationSec: 1200, viewsCount: 8 },
    [
      {
        userId: 1,
        fullName: 'أحمد علي',
        phone: '01011112222',
        gradeNameAr: 'الصف الثالث بكالوريا',
        watchedSec: 600,
        lastPositionSec: 610,
        completionPercent: 50,
        isCompleted: false,
        countedOpens: 2,
        updatedAt: '2026-11-25T10:00:00Z',
      },
      {
        userId: 2,
        fullName: 'يوسف محمد',
        phone: '01033334444',
        gradeNameAr: 'الصف الثالث بكالوريا',
        watchedSec: 1260,
        lastPositionSec: 1200,
        completionPercent: 115, // should clamp to 100
        isCompleted: true,
        countedOpens: 3,
        updatedAt: '2026-11-26T12:00:00Z',
      },
      {
        userId: 3,
        fullName: 'مريم حسن',
        phone: null,
        gradeNameAr: null,
        watchedSec: 300,
        lastPositionSec: 300,
        completionPercent: 0, // fallback from watchedSec / durationSec = 25%
        isCompleted: false,
        countedOpens: 1,
        updatedAt: '2026-11-24T08:00:00Z',
      },
    ],
  );

  assert.equal(analytics.summary.uniqueViewers, 3);
  assert.equal(analytics.summary.completedCount, 1);
  assert.equal(analytics.summary.inProgressCount, 2);
  assert.equal(analytics.summary.totalWatchedSec, 2160);
  assert.equal(analytics.summary.totalWatchedMinutes, 36);
  assert.equal(analytics.summary.averageCompletionPercent, 58); // (50 + 100 + 25) / 3 = 58.33 -> 58

  // Sorted by most recent watch timestamp first
  assert.equal(analytics.viewers[0].userId, 2);
  assert.equal(analytics.viewers[0].completionPercent, 100);
  assert.equal(analytics.viewers[0].watchedMinutes, 21);

  assert.equal(analytics.viewers[1].userId, 1);
  assert.equal(analytics.viewers[1].watchedMinutes, 10);

  assert.equal(analytics.viewers[2].userId, 3);
  assert.equal(analytics.viewers[2].completionPercent, 25);
  assert.equal(analytics.viewers[2].gradeNameAr, 'غير محدد');
});

test('buildVideoViewersAnalytics handles empty viewer list gracefully', () => {
  const analytics = buildVideoViewersAnalytics(
    { id: 12, titleAr: 'فيديو جديد', durationSec: 900, viewsCount: 0 },
    [],
  );
  assert.equal(analytics.summary.uniqueViewers, 0);
  assert.equal(analytics.summary.totalWatchedMinutes, 0);
  assert.equal(analytics.summary.averageCompletionPercent, 0);
  assert.deepEqual(analytics.viewers, []);
});
