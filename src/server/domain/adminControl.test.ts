import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCouponDiscount,
  evaluateBulkStudentTargetAccess,
  evaluateCourseDeletionSafety,
  evaluateStudentDeletionSafety,
  evaluateStudentTargetAccess,
  evaluateVideoOpenLimit,
  isStudentRoleSlug,
  planManualCourseGrants,
  resolveCouponStatus,
  resolveEffectiveVideoMaxOpens,
} from './adminControl.ts';

test('resolveEffectiveVideoMaxOpens respects precedence: student override > video > course > unlimited', () => {
  assert.equal(
    resolveEffectiveVideoMaxOpens({
      courseDefaultMaxOpens: null,
      videoMaxOpens: null,
      studentMaxOpensOverride: null,
      bonusOpens: 0,
    }),
    null,
  );

  assert.equal(
    resolveEffectiveVideoMaxOpens({
      courseDefaultMaxOpens: 5,
      videoMaxOpens: null,
      studentMaxOpensOverride: null,
      bonusOpens: 2,
    }),
    7,
  );

  assert.equal(
    resolveEffectiveVideoMaxOpens({
      courseDefaultMaxOpens: 5,
      videoMaxOpens: 3,
      studentMaxOpensOverride: null,
      bonusOpens: 0,
    }),
    3,
  );

  assert.equal(
    resolveEffectiveVideoMaxOpens({
      courseDefaultMaxOpens: 5,
      videoMaxOpens: 3,
      studentMaxOpensOverride: 10,
      bonusOpens: 1,
    }),
    11,
  );

  // Explicit student unlimited override (-1) beats course/video cap
  assert.equal(
    resolveEffectiveVideoMaxOpens({
      courseDefaultMaxOpens: 5,
      videoMaxOpens: 2,
      studentMaxOpensOverride: -1,
      bonusOpens: 0,
    }),
    null,
  );
});

test('evaluateVideoOpenLimit is idempotent within same session cooldown and blocks once cap is reached', () => {
  const t0 = new Date('2026-11-21T10:00:00Z');
  // First open -> counts 1 of 2
  const first = evaluateVideoOpenLimit({
    isStaff: false,
    courseDefaultMaxOpens: 2,
    videoMaxOpens: null,
    studentMaxOpensOverride: null,
    bonusOpens: 0,
    countedOpens: 0,
    currentSessionId: 42,
    lastSessionId: null,
    lastCountedAt: null,
    now: t0,
  });
  assert.equal(first.allowed, true);
  assert.equal(first.shouldIncrement, true);
  assert.equal(first.countedOpensAfter, 1);
  assert.equal(first.remainingOpens, 1);

  // Page refresh / React re-render 5 minutes later in same session -> MUST NOT double-charge
  const refresh = evaluateVideoOpenLimit({
    isStaff: false,
    courseDefaultMaxOpens: 2,
    videoMaxOpens: null,
    studentMaxOpensOverride: null,
    bonusOpens: 0,
    countedOpens: 1,
    currentSessionId: 42,
    lastSessionId: 42,
    lastCountedAt: t0,
    now: new Date('2026-11-21T10:05:00Z'),
  });
  assert.equal(refresh.allowed, true);
  assert.equal(refresh.shouldIncrement, false);
  assert.equal(refresh.countedOpensAfter, 1);
  assert.equal(refresh.reasonCode, 'WITHIN_IDEMPOTENCY_WINDOW');

  // New open 40 minutes later -> counts 2 of 2
  const second = evaluateVideoOpenLimit({
    isStaff: false,
    courseDefaultMaxOpens: 2,
    videoMaxOpens: null,
    studentMaxOpensOverride: null,
    bonusOpens: 0,
    countedOpens: 1,
    currentSessionId: 42,
    lastSessionId: 42,
    lastCountedAt: t0,
    now: new Date('2026-11-21T10:40:00Z'),
  });
  assert.equal(second.allowed, true);
  assert.equal(second.shouldIncrement, true);
  assert.equal(second.countedOpensAfter, 2);
  assert.equal(second.remainingOpens, 0);

  // Third open after cooldown -> blocked
  const third = evaluateVideoOpenLimit({
    isStaff: false,
    courseDefaultMaxOpens: 2,
    videoMaxOpens: null,
    studentMaxOpensOverride: null,
    bonusOpens: 0,
    countedOpens: 2,
    currentSessionId: 42,
    lastSessionId: 42,
    lastCountedAt: new Date('2026-11-21T10:40:00Z'),
    now: new Date('2026-11-21T11:20:00Z'),
  });
  assert.equal(third.allowed, false);
  assert.equal(third.reasonCode, 'OPEN_LIMIT_REACHED');

  // Staff always allowed without consuming count
  const staff = evaluateVideoOpenLimit({
    isStaff: true,
    courseDefaultMaxOpens: 1,
    videoMaxOpens: 1,
    studentMaxOpensOverride: null,
    bonusOpens: 0,
    countedOpens: 99,
    currentSessionId: 1,
    lastSessionId: 1,
    lastCountedAt: t0,
    now: new Date('2026-11-21T12:00:00Z'),
  });
  assert.equal(staff.allowed, true);
  assert.equal(staff.shouldIncrement, false);
});

test('coupon status resolution and percent/fixed discount with course eligibility', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  assert.equal(
    resolveCouponStatus(
      { code: 'A', discountPercent: 10, maxUses: 10, usedCount: 0, expiresAt: null, isActive: true, isArchived: true },
      now,
    ),
    'ARCHIVED',
  );
  assert.equal(
    resolveCouponStatus(
      { code: 'B', discountPercent: 10, maxUses: 5, usedCount: 5, expiresAt: null, isActive: true },
      now,
    ),
    'LIMIT_REACHED',
  );
  assert.equal(
    resolveCouponStatus(
      { code: 'C', discountPercent: 10, maxUses: 5, usedCount: 1, expiresAt: '2026-11-20T00:00:00Z', isActive: true },
      now,
    ),
    'EXPIRED',
  );

  // Fixed amount coupon restricted to course #3
  const fixedCoupon = {
    code: 'FIX100',
    discountType: 'FIXED',
    discountPercent: 0,
    discountAmountEgp: 100,
    maxUses: 20,
    usedCount: 2,
    expiresAt: '2027-01-01T00:00:00Z',
    eligibleCourseIdsJson: [3],
    isActive: true,
    isArchived: false,
  };

  const allowedCourse = computeCouponDiscount({
    coupon: fixedCoupon,
    amountEgp: 350,
    targetType: 'COURSE',
    targetId: 3,
    now,
  });
  assert.equal(allowedCourse.valid, true);
  assert.equal(allowedCourse.discountEgp, 100);
  assert.equal(allowedCourse.finalAmountEgp, 250);

  const wrongCourse = computeCouponDiscount({
    coupon: fixedCoupon,
    amountEgp: 350,
    targetType: 'COURSE',
    targetId: 9,
    now,
  });
  assert.equal(wrongCourse.valid, false);
});

test('student and course deletion safety guards protect Super Admin and historical data', () => {
  const adminSafety = evaluateStudentDeletionSafety({
    roleSlug: 'SUPER_ADMIN',
    paidOrdersCount: 0,
    examAttemptsCount: 0,
    activeSubscriptionsCount: 0,
    manualEntitlementsCount: 0,
    redemptionsCount: 0,
  });
  assert.equal(adminSafety.canArchive, false);
  assert.equal(adminSafety.canPermanentlyDelete, false);

  const studentWithExams = evaluateStudentDeletionSafety({
    roleSlug: 'STUDENT',
    paidOrdersCount: 0,
    examAttemptsCount: 2,
    activeSubscriptionsCount: 0,
    manualEntitlementsCount: 1,
    redemptionsCount: 0,
  });
  assert.equal(studentWithExams.canArchive, true);
  assert.equal(studentWithExams.canPermanentlyDelete, false);

  const cleanStudent = evaluateStudentDeletionSafety({
    roleSlug: 'STUDENT',
    paidOrdersCount: 0,
    examAttemptsCount: 0,
    activeSubscriptionsCount: 0,
    manualEntitlementsCount: 0,
    redemptionsCount: 0,
  });
  assert.equal(cleanStudent.canArchive, true);
  assert.equal(cleanStudent.canPermanentlyDelete, true);

  const courseWithSubs = evaluateCourseDeletionSafety({
    subscribersCount: 3,
    ordersCount: 0,
    linkedExamsCount: 0,
    linkedVideosCount: 5,
  });
  assert.equal(courseWithSubs.canArchive, true);
  assert.equal(courseWithSubs.canPermanentlyDelete, false);

  const emptyCourse = evaluateCourseDeletionSafety({
    subscribersCount: 0,
    ordersCount: 0,
    linkedExamsCount: 0,
    linkedVideosCount: 2,
  });
  assert.equal(emptyCourse.canPermanentlyDelete, true);
});

test('planManualCourseGrants skips already-active entitlements and avoids duplicates', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const plan = planManualCourseGrants({
    requestedCourseIds: [1, 2, 2, 3],
    availableCourses: [
      { id: 1, titleAr: 'كورس 1', gradeId: 3 },
      { id: 2, titleAr: 'كورس 2', gradeId: 3 },
      { id: 3, titleAr: 'كورس 3', gradeId: 3 },
    ],
    existingEntitlements: [
      { targetType: 'COURSE', targetId: 1, source: 'PURCHASE', isRevoked: false, expiresAt: null },
      { targetType: 'COURSE', targetId: 2, source: 'MANUAL_GRANT', isRevoked: true, expiresAt: null },
    ],
    now,
  });

  assert.deepEqual(
    plan.toGrant.map((c) => c.id),
    [2, 3],
  );
  assert.deepEqual(
    plan.skippedAlreadyActive.map((c) => c.id),
    [1],
  );
});

test('student-management single-target guard allows ONLY STUDENT and rejects all privileged roles', () => {
  assert.equal(isStudentRoleSlug('STUDENT'), true);

  for (const privilegedRole of [
    'SUPER_ADMIN',
    'ADMIN',
    'TEACHER',
    'CONTENT_MANAGER',
    'TEACHING_ASSISTANT',
    'SUPPORT',
    '',
    null,
    undefined,
    'student',
  ]) {
    assert.equal(isStudentRoleSlug(privilegedRole), false);
    const decision = evaluateStudentTargetAccess({ id: 1, roleSlug: privilegedRole });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.statusCode, 403);
    }
  }

  const missing = evaluateStudentTargetAccess(null);
  assert.equal(missing.allowed, false);
  if (!missing.allowed) {
    assert.equal(missing.statusCode, 404);
  }

  const validStudent = evaluateStudentTargetAccess({ id: 5, roleSlug: 'STUDENT' });
  assert.equal(validStudent.allowed, true);
});

test('student-management bulk guard rejects entire batch if ANY target is non-STUDENT', () => {
  // Mixed batch containing a student + SUPER_ADMIN -> MUST reject entire batch with 403
  const mixedAdmin = evaluateBulkStudentTargetAccess({
    requestedIds: [3, 1, 4],
    resolvedUsers: [
      { id: 1, roleSlug: 'SUPER_ADMIN' },
      { id: 3, roleSlug: 'STUDENT' },
      { id: 4, roleSlug: 'STUDENT' },
    ],
  });
  assert.equal(mixedAdmin.allowed, false);
  if (!mixedAdmin.allowed) {
    assert.equal(mixedAdmin.statusCode, 403);
    assert.deepEqual(mixedAdmin.blockedIds, [1]);
    assert.deepEqual(mixedAdmin.blockedRoles, ['SUPER_ADMIN']);
  }

  // Batch targeting TEACHING_ASSISTANT or SUPPORT -> MUST reject with 403
  const staffTarget = evaluateBulkStudentTargetAccess({
    requestedIds: [2, 9],
    resolvedUsers: [
      { id: 2, roleSlug: 'TEACHING_ASSISTANT' },
      { id: 9, roleSlug: 'SUPPORT' },
    ],
  });
  assert.equal(staffTarget.allowed, false);
  if (!staffTarget.allowed) {
    assert.equal(staffTarget.statusCode, 403);
    assert.deepEqual(staffTarget.blockedIds, [2, 9]);
  }

  // Empty batch -> 400
  const empty = evaluateBulkStudentTargetAccess({ requestedIds: [], resolvedUsers: [] });
  assert.equal(empty.allowed, false);
  if (!empty.allowed) {
    assert.equal(empty.statusCode, 400);
  }

  // Legitimate student-only batch -> allowed and deduplicated
  const validBatch = evaluateBulkStudentTargetAccess({
    requestedIds: [3, 4, 3],
    resolvedUsers: [
      { id: 3, roleSlug: 'STUDENT' },
      { id: 4, roleSlug: 'STUDENT' },
    ],
  });
  assert.equal(validBatch.allowed, true);
  if (validBatch.allowed) {
    assert.deepEqual(validBatch.studentIds, [3, 4]);
  }
});

