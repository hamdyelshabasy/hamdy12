import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySessionStatus,
  describeUserAgent,
  evaluateDeviceLoginPolicy,
  getBlockedDeviceFingerprints,
  isDeviceBlockedForUser,
  normalizeDeviceFingerprint,
  type DeviceSessionRecord,
} from './deviceAccess.ts';
import { evaluatePlaybackSessionPolicy } from './entitlements.ts';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const FUTURE = new Date('2026-12-01T12:00:00.000Z');
const PAST = new Date('2026-11-01T12:00:00.000Z');

test('normal student login succeeds from an unblocked device', () => {
  const decision = evaluateDeviceLoginPolicy({
    sessions: [],
    deviceFingerprint: 'dev-allowed-1',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(decision.allowed, true);
});

test('revoking an ordinary session does NOT block re-login and frees the device slot', () => {
  const sessions: DeviceSessionRecord[] = [
    {
      id: 1,
      deviceFingerprint: 'dev-1',
      isRevoked: true,
      isBlocked: false,
      expiresAt: FUTURE,
    },
  ];
  const decision = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-1',
    maxDevices: 1,
    now: NOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(isDeviceBlockedForUser(sessions, 'dev-1'), false);
});

test('a revoked-and-blocked session still blocks the same recognized device fingerprint', () => {
  const sessions: DeviceSessionRecord[] = [
    {
      id: 10,
      deviceFingerprint: 'dev-bad-1',
      isRevoked: true,
      isBlocked: true,
      expiresAt: FUTURE,
    },
  ];
  const decision = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-bad-1',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.reason, 'DEVICE_BLOCKED');
    assert.equal(decision.statusCode, 403);
  }
});

test('an expired blocked session still blocks the recognized device until explicitly unblocked', () => {
  const sessions: DeviceSessionRecord[] = [
    {
      id: 11,
      deviceFingerprint: 'dev-expired-bad',
      isRevoked: true,
      isBlocked: true,
      expiresAt: PAST,
    },
  ];
  const decision = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: '  dev-expired-bad  ',
    maxDevices: 3,
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.reason, 'DEVICE_BLOCKED');
  }
});

test('blocking one device does NOT block an unrelated authorized device for the same student', () => {
  const sessions: DeviceSessionRecord[] = [
    {
      id: 20,
      deviceFingerprint: 'dev-blocked',
      isRevoked: true,
      isBlocked: true,
      expiresAt: FUTURE,
    },
    {
      id: 21,
      deviceFingerprint: 'dev-good',
      isRevoked: false,
      isBlocked: false,
      expiresAt: FUTURE,
    },
  ];
  assert.equal(isDeviceBlockedForUser(sessions, 'dev-blocked'), true);
  assert.equal(isDeviceBlockedForUser(sessions, 'dev-good'), false);

  const goodDecision = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-good',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(goodDecision.allowed, true);

  const newDeviceDecision = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-new-legit',
    maxDevices: 2,
    now: NOW,
  });
  // Blocked device does not consume an active device slot
  assert.equal(newDeviceDecision.allowed, true);
});

test('unblocking clears isBlocked while keeping old sessions revoked so fresh login works', () => {
  const sessionsAfterUnblock: DeviceSessionRecord[] = [
    {
      id: 30,
      deviceFingerprint: 'dev-unblocked',
      isRevoked: true,
      isBlocked: false,
      expiresAt: FUTURE,
    },
  ];
  assert.equal(getBlockedDeviceFingerprints(sessionsAfterUnblock).size, 0);
  const decision = evaluateDeviceLoginPolicy({
    sessions: sessionsAfterUnblock,
    deviceFingerprint: 'dev-unblocked',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(decision.allowed, true);
});

test('student maxDevices limit still blocks a third distinct active device while allowing an existing active device', () => {
  const sessions: DeviceSessionRecord[] = [
    { id: 40, deviceFingerprint: 'dev-A', isRevoked: false, isBlocked: false, expiresAt: FUTURE },
    { id: 41, deviceFingerprint: 'dev-B', isRevoked: false, isBlocked: false, expiresAt: FUTURE },
    // Expired active-flag session should not count
    { id: 42, deviceFingerprint: 'dev-C-old', isRevoked: false, isBlocked: false, expiresAt: PAST },
  ];

  const thirdDevice = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-C',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(thirdDevice.allowed, false);
  if (!thirdDevice.allowed) {
    assert.equal(thirdDevice.reason, 'DEVICE_LIMIT_EXCEEDED');
  }

  const existingDevice = evaluateDeviceLoginPolicy({
    sessions,
    deviceFingerprint: 'dev-A',
    maxDevices: 2,
    now: NOW,
  });
  assert.equal(existingDevice.allowed, true);
});

test('evaluatePlaybackSessionPolicy rejects playback if ANY historical session for that fingerprint is blocked', () => {
  const decision = evaluatePlaybackSessionPolicy({
    maxDevices: 2,
    allowConcurrent: true,
    currentSessionId: 51,
    currentDeviceFingerprint: 'dev-shared-fp',
    activeSessions: [
      {
        id: 50,
        deviceFingerprint: 'dev-shared-fp',
        isRevoked: true,
        isBlocked: true,
        activeVideoId: null,
        lastHeartbeatAt: PAST,
      },
      {
        id: 51,
        deviceFingerprint: 'dev-shared-fp',
        isRevoked: false,
        isBlocked: false,
        activeVideoId: null,
        lastHeartbeatAt: NOW,
      },
    ],
    now: NOW,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'DEVICE_BLOCKED');
  assert.equal(normalizeDeviceFingerprint('   '), null);
});

test('describeUserAgent produces clean Arabic/human-readable device descriptions', () => {
  const winChrome = describeUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  );
  assert.ok(winChrome.includes('Chrome'));
  assert.ok(winChrome.includes('Windows'));

  const iphone = describeUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
  );
  assert.ok(iphone.includes('Safari'));
  assert.ok(iphone.includes('iPhone'));
});

test('classifySessionStatus distinguishes ACTIVE, BLOCKED, REVOKED, and EXPIRED sessions', () => {
  assert.equal(
    classifySessionStatus({ isBlocked: true, isRevoked: true, expiresAt: FUTURE }, NOW),
    'BLOCKED',
  );
  assert.equal(
    classifySessionStatus({ isBlocked: false, isRevoked: true, expiresAt: FUTURE }, NOW),
    'REVOKED',
  );
  assert.equal(
    classifySessionStatus({ isBlocked: false, isRevoked: false, expiresAt: PAST }, NOW),
    'EXPIRED',
  );
  assert.equal(
    classifySessionStatus({ isBlocked: false, isRevoked: false, expiresAt: FUTURE }, NOW),
    'ACTIVE',
  );
});
