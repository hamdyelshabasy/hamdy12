import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLocalDateTimeInput,
  sanitizeScheduleJoinUrl,
  validateGroupPayload,
  validateSchedulePayload,
} from './schedules.ts';

test('validateSchedulePayload accepts a complete valid live session payload', () => {
  const result = validateSchedulePayload({
    gradeId: 3,
    groupId: 2,
    titleAr: 'مراجعة قوانين كيرشوف المباشرة',
    descriptionAr: 'حل مسائل مستويات عليا على الدوائر الكهربية',
    scheduledAt: '2026-12-01T18:00:00.000Z',
    durationMin: 90,
    sessionType: 'LIVE',
    liveProvider: 'ZOOM',
    joinUrl: 'https://zoom.us/j/123456789',
    isPublished: true,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.gradeId, 3);
    assert.equal(result.data.groupId, 2);
    assert.equal(result.data.titleAr, 'مراجعة قوانين كيرشوف المباشرة');
    assert.equal(result.data.durationMin, 90);
    assert.equal(result.data.sessionType, 'LIVE');
    assert.equal(result.data.liveProvider, 'ZOOM');
    assert.equal(result.data.joinUrl, 'https://zoom.us/j/123456789');
    assert.equal(result.data.isPublished, true);
  }
});

test('validateSchedulePayload defaults optional fields and treats groupId=0 as null', () => {
  const result = validateSchedulePayload({
    gradeId: 1,
    groupId: 0,
    titleAr: 'ورشة مراجعة سريعة',
    scheduledAt: '2026-12-02T15:30:00.000Z',
    isPublished: false,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.groupId, null);
    assert.equal(result.data.durationMin, 90);
    assert.equal(result.data.sessionType, 'LIVE');
    assert.equal(result.data.liveProvider, 'ZOOM');
    assert.equal(result.data.joinUrl, '');
    assert.equal(result.data.isPublished, false);
  }
});

test('sanitizeScheduleJoinUrl blocks javascript:, data:, and malformed URLs', () => {
  assert.equal(sanitizeScheduleJoinUrl('').ok, true);
  assert.equal(sanitizeScheduleJoinUrl('https://meet.google.com/abc-defg-hij').ok, true);
  assert.equal(sanitizeScheduleJoinUrl('javascript:alert(1)').ok, false);
  assert.equal(sanitizeScheduleJoinUrl('data:text/html,<script>alert(1)</script>').ok, false);
  assert.equal(sanitizeScheduleJoinUrl('not-a-valid-url').ok, false);
});

test('validateSchedulePayload rejects missing title, invalid date, out-of-range duration, and bad enums', () => {
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'أ',
      scheduledAt: '2026-12-01T10:00:00Z',
    }).ok,
    false,
  );
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'حصة فيزياء',
      scheduledAt: 'invalid-date',
    }).ok,
    false,
  );
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'حصة فيزياء',
      scheduledAt: '2026-12-01T10:00:00Z',
      durationMin: 5,
    }).ok,
    false,
  );
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'حصة فيزياء',
      scheduledAt: '2026-12-01T10:00:00Z',
      durationMin: 900,
    }).ok,
    false,
  );
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'حصة فيزياء',
      scheduledAt: '2026-12-01T10:00:00Z',
      sessionType: 'HACKED',
    }).ok,
    false,
  );
  assert.equal(
    validateSchedulePayload({
      gradeId: 1,
      titleAr: 'حصة فيزياء',
      scheduledAt: '2026-12-01T10:00:00Z',
      liveProvider: 'UNKNOWN_APP',
    }).ok,
    false,
  );
});

test('validateGroupPayload validates required grade and Arabic group name', () => {
  const valid = validateGroupPayload({
    gradeId: 2,
    nameAr: 'مجموعة المتفوقين أ',
    scheduleTextAr: 'السبت والثلاثاء 7 مساءً',
    descriptionAr: 'مجموعة أونلاين للصف الثاني',
  });
  assert.equal(valid.ok, true);

  assert.equal(validateGroupPayload({ gradeId: 0, nameAr: 'مجموعة' }).ok, false);
  assert.equal(validateGroupPayload({ gradeId: 2, nameAr: 'أ' }).ok, false);
});

test('formatLocalDateTimeInput returns YYYY-MM-DDTHH:mm and handles invalid dates safely', () => {
  const sample = new Date(2026, 10, 26, 19, 5);
  assert.equal(formatLocalDateTimeInput(sample), '2026-11-26T19:05');
  assert.equal(formatLocalDateTimeInput('not-a-date'), '');
});
