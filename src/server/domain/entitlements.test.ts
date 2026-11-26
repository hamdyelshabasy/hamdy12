import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePlaybackSessionPolicy,
  getSourcePriority,
  resolveVideoAccess,
  type EntitlementRecord,
} from './entitlements.ts';

const baseNow = new Date('2026-11-20T12:00:00Z');

test('pending student cannot access even free videos', () => {
  const decision = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'PENDING_APPROVAL',
    approvedGradeIds: [1],
    videoId: 10,
    videoGradeId: 1,
    videoType: 'FREE',
    videoPublished: true,
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, 'ACCOUNT_NOT_ACTIVE');
});

test('approved student can access free video in approved grade only', () => {
  const ok = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [1],
    videoId: 10,
    videoGradeId: 1,
    videoType: 'FREE',
    videoPublished: true,
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(ok.allowed, true);
  assert.equal(ok.reasonCode, 'FREE_VIDEO');

  const wrongGrade = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [1],
    videoId: 11,
    videoGradeId: 2,
    videoType: 'FREE',
    videoPublished: true,
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(wrongGrade.allowed, false);
  assert.equal(wrongGrade.reasonCode, 'GRADE_NOT_APPROVED');
});

test('paid video requires active non-revoked entitlement and respects priority', () => {
  const ents: EntitlementRecord[] = [
    {
      id: 1,
      userId: 5,
      targetType: 'VIDEO',
      targetId: 20,
      source: 'ACTIVATION_CODE',
      priority: getSourcePriority('ACTIVATION_CODE'),
      startsAt: new Date('2026-11-01T00:00:00Z'),
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      isRevoked: false,
    },
    {
      id: 2,
      userId: 5,
      targetType: 'VIDEO',
      targetId: 20,
      source: 'MANUAL_GRANT',
      priority: getSourcePriority('MANUAL_GRANT'),
      startsAt: new Date('2026-11-01T00:00:00Z'),
      expiresAt: null,
      isRevoked: false,
    },
  ];

  const decision = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [3],
    videoId: 20,
    videoGradeId: 3,
    videoType: 'PAID',
    videoPublished: true,
    courseIdsContainingVideo: [],
    entitlements: ents,
    now: baseNow,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.matchedSource, 'MANUAL_GRANT');
  assert.equal(decision.matchedEntitlementId, 2);
});

test('revoked or expired entitlement blocks paid video immediately', () => {
  const revokedAndExpired: EntitlementRecord[] = [
    {
      id: 3,
      userId: 5,
      targetType: 'VIDEO',
      targetId: 20,
      source: 'MANUAL_GRANT',
      priority: 100,
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: null,
      isRevoked: true,
    },
    {
      id: 4,
      userId: 5,
      targetType: 'COURSE',
      targetId: 7,
      source: 'PURCHASE',
      priority: 60,
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-11-10T00:00:00Z'),
      isRevoked: false,
    },
  ];

  const decision = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [3],
    videoId: 20,
    videoGradeId: 3,
    videoType: 'PAID',
    videoPublished: true,
    courseIdsContainingVideo: [7],
    entitlements: revokedAndExpired,
    now: baseNow,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, 'PAYMENT_OR_CODE_REQUIRED');
});

test('concurrent playback policy blocks second simultaneous stream when disabled', () => {
  const result = evaluatePlaybackSessionPolicy({
    maxDevices: 2,
    allowConcurrent: false,
    currentSessionId: 102,
    currentDeviceFingerprint: 'dev-b',
    activeSessions: [
      {
        id: 101,
        deviceFingerprint: 'dev-a',
        isRevoked: false,
        isBlocked: false,
        activeVideoId: 20,
        lastHeartbeatAt: new Date(baseNow.getTime() - 10_000),
      },
      {
        id: 102,
        deviceFingerprint: 'dev-b',
        isRevoked: false,
        isBlocked: false,
        activeVideoId: null,
        lastHeartbeatAt: baseNow,
      },
    ],
    now: baseNow,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'CONCURRENT_PLAYBACK_DETECTED');
});

test('draft and hidden videos are blocked for students but allowed for staff preview', () => {
  const draftStudent = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [3],
    videoId: 30,
    videoGradeId: 3,
    videoType: 'FREE',
    videoPublished: true,
    publicationStatus: 'DRAFT',
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(draftStudent.allowed, false);
  assert.equal(draftStudent.reasonCode, 'VIDEO_UNPUBLISHED');

  const hiddenStaff = resolveVideoAccess({
    userRoleSlug: 'SUPER_ADMIN',
    userStatus: 'ACTIVE',
    approvedGradeIds: [],
    videoId: 30,
    videoGradeId: 3,
    videoType: 'PAID',
    videoPublished: false,
    publicationStatus: 'HIDDEN',
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(hiddenStaff.allowed, true);
  assert.equal(hiddenStaff.reasonCode, 'STAFF_ACCESS');
});

test('course video requires enrollment in assigned videoCourseId', () => {
  const locked = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [3],
    videoId: 40,
    videoGradeId: 3,
    videoType: 'COURSE',
    videoPublished: true,
    publicationStatus: 'PUBLISHED',
    videoCourseId: 9,
    courseIdsContainingVideo: [],
    entitlements: [],
    now: baseNow,
  });
  assert.equal(locked.allowed, false);
  assert.equal(locked.reasonCode, 'COURSE_ENROLLMENT_REQUIRED');

  const unlocked = resolveVideoAccess({
    userRoleSlug: 'STUDENT',
    userStatus: 'ACTIVE',
    approvedGradeIds: [3],
    videoId: 40,
    videoGradeId: 3,
    videoType: 'COURSE',
    videoPublished: true,
    publicationStatus: 'PUBLISHED',
    videoCourseId: 9,
    courseIdsContainingVideo: [],
    entitlements: [
      {
        id: 10,
        userId: 5,
        targetType: 'COURSE',
        targetId: 9,
        source: 'PURCHASE',
        priority: 60,
        startsAt: new Date('2026-11-01T00:00:00Z'),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
        isRevoked: false,
      },
    ],
    now: baseNow,
  });
  assert.equal(unlocked.allowed, true);
  assert.equal(unlocked.matchedSource, 'PURCHASE');
});

