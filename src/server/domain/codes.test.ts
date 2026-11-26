import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDeleteActivationCode,
  computePlatformSubscriptionState,
  generateActivationCode,
  hashActivationCode,
  maskActivationCode,
  validateCodeForRedemption,
} from './codes.ts';

test('activation codes generate uniquely, hash deterministically, and mask cleanly', () => {
  const c1 = generateActivationCode('PHY');
  const c2 = generateActivationCode('PHY');
  assert.notEqual(c1, c2);
  assert.match(c1, /^PHY-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const h1 = hashActivationCode(c1, 'test-pepper');
  const h1Lower = hashActivationCode(`  ${c1.toLowerCase()}  `, 'test-pepper');
  const pastedVariant = `\u200F ${c1.toLowerCase().replace(/-/g, '—').replace(/2/g, '٢').replace(/3/g, '٣')}\u200E`;
  const h1Pasted = hashActivationCode(pastedVariant, 'test-pepper');
  assert.equal(h1, h1Lower);
  assert.equal(h1, h1Pasted);
  assert.notEqual(h1, c1);

  const masked = maskActivationCode(c1);
  assert.ok(masked.includes('••••'));
  assert.notEqual(masked, c1);
});

test('validation rejects expired, revoked, cancelled, temporarily disabled, exhausted, wrong student, and wrong grade codes', () => {
  const now = new Date('2026-11-20T12:00:00Z');

  assert.equal(
    validateCodeForRedemption(
      { status: 'REVOKED', usedCount: 0, maxUses: 1, expiresAt: null, boundUserId: null, gradeId: 1 },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_REVOKED',
  );

  assert.equal(
    validateCodeForRedemption(
      { status: 'CANCELLED', usedCount: 0, maxUses: 1, expiresAt: null, boundUserId: null, gradeId: 1 },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_CANCELLED',
  );

  // Temporarily disabled until a future date -> blocked
  assert.equal(
    validateCodeForRedemption(
      {
        status: 'DISABLED',
        usedCount: 0,
        maxUses: 1,
        expiresAt: null,
        disabledUntil: new Date('2026-11-25T12:00:00Z'),
        boundUserId: null,
        gradeId: 1,
      },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_DISABLED',
  );

  // Temporarily disabled until a past date -> automatically allowed again
  assert.equal(
    validateCodeForRedemption(
      {
        status: 'DISABLED',
        usedCount: 0,
        maxUses: 1,
        expiresAt: null,
        disabledUntil: new Date('2026-11-19T12:00:00Z'),
        boundUserId: null,
        gradeId: 1,
      },
      5,
      [1],
      now,
    ).valid,
    true,
  );

  assert.equal(
    validateCodeForRedemption(
      {
        status: 'AVAILABLE',
        usedCount: 0,
        maxUses: 1,
        expiresAt: new Date('2026-11-19T00:00:00Z'),
        boundUserId: null,
        gradeId: 1,
      },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_EXPIRED',
  );

  assert.equal(
    validateCodeForRedemption(
      { status: 'AVAILABLE', usedCount: 1, maxUses: 1, expiresAt: null, boundUserId: null, gradeId: 1 },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_EXHAUSTED',
  );

  assert.equal(
    validateCodeForRedemption(
      { status: 'AVAILABLE', usedCount: 0, maxUses: 1, expiresAt: null, boundUserId: 99, gradeId: 1 },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_BOUND_TO_OTHER_STUDENT',
  );

  assert.equal(
    validateCodeForRedemption(
      { status: 'AVAILABLE', usedCount: 0, maxUses: 1, expiresAt: null, boundUserId: null, gradeId: 3 },
      5,
      [1],
      now,
    ).errorCode,
    'CODE_GRADE_MISMATCH',
  );

  assert.equal(
    validateCodeForRedemption(
      { status: 'AVAILABLE', usedCount: 0, maxUses: 2, expiresAt: null, boundUserId: 5, gradeId: 1 },
      5,
      [1],
      now,
    ).valid,
    true,
  );
});

test('canDeleteActivationCode allows unused codes and blocks used or redeemed codes', () => {
  assert.equal(canDeleteActivationCode({ usedCount: 0, redemptionsCount: 0 }).allowed, true);
  assert.equal(canDeleteActivationCode({ usedCount: 1, redemptionsCount: 0 }).allowed, false);
  assert.equal(canDeleteActivationCode({ usedCount: 0, redemptionsCount: 1 }).allowed, false);
});

test('computePlatformSubscriptionState accurately computes ACTIVE, EXPIRED, and REVOKED states', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const startsAt = new Date('2026-11-20T00:00:00Z');
  const active = computePlatformSubscriptionState(
    { status: 'ACTIVE', startsAt, expiresAt: new Date('2026-12-20T12:00:00Z') },
    now,
  );
  assert.equal(active.isActive, true);
  assert.equal(active.effectiveStatus, 'ACTIVE');
  assert.equal(active.remainingDays, 30);

  const expired = computePlatformSubscriptionState(
    { status: 'ACTIVE', startsAt: new Date('2026-10-20T00:00:00Z'), expiresAt: new Date('2026-11-19T12:00:00Z') },
    now,
  );
  assert.equal(expired.isActive, false);
  assert.equal(expired.effectiveStatus, 'EXPIRED');
  assert.equal(expired.remainingDays, 0);

  const revoked = computePlatformSubscriptionState(
    { status: 'REVOKED', startsAt, expiresAt: new Date('2026-12-20T12:00:00Z') },
    now,
  );
  assert.equal(revoked.isActive, false);
  assert.equal(revoked.effectiveStatus, 'REVOKED');
});
