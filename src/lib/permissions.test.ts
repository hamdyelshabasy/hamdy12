import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROLE_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PERMISSIONS,
  canAccessAdminTab,
  evaluateStaffAuthorization,
  hasAnyPermission,
  hasPermission,
  type PermissionSubject,
} from './permissions.ts';

function makeSubject(
  roleSlug: keyof typeof DEFAULT_ROLE_PERMISSIONS,
  status = 'ACTIVE',
  permissionsOverride?: string[],
): PermissionSubject {
  return {
    roleSlug,
    status,
    permissions: permissionsOverride ?? DEFAULT_ROLE_PERMISSIONS[roleSlug],
  };
}

test('SUPER_ADMIN retains full access to every recognized admin permission', () => {
  const superAdmin = makeSubject('SUPER_ADMIN', 'ACTIVE');
  for (const perm of Object.values(PERMISSIONS)) {
    assert.equal(hasPermission(superAdmin, perm), true, `SUPER_ADMIN should have ${perm}`);
  }
  assert.equal(evaluateStaffAuthorization(superAdmin, PERMISSIONS.STAFF_MANAGE).allowed, true);
  assert.equal(evaluateStaffAuthorization(superAdmin, PERMISSIONS.SETTINGS_MANAGE).allowed, true);
  assert.equal(evaluateStaffAuthorization(superAdmin, PERMISSIONS.BACKUPS_MANAGE).allowed, true);
});

test('Deny-by-default rejects unrecognized permission strings even for SUPER_ADMIN', () => {
  const superAdmin = makeSubject('SUPER_ADMIN', 'ACTIVE');
  assert.equal(hasPermission(superAdmin, 'unknown:action'), false);
  assert.equal(hasPermission(superAdmin, ''), false);
  const decision = evaluateStaffAuthorization(superAdmin, 'nonexistent:perm');
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.statusCode, 403);
    assert.equal(decision.reason, 'MISSING_PERMISSION');
  }
});

test('TEACHING_ASSISTANT has educational permissions and is denied staff, settings, payments, codes, and destructive controls', () => {
  const ta = makeSubject('TEACHING_ASSISTANT', 'ACTIVE');

  // Allowed educational support tasks
  assert.equal(hasPermission(ta, PERMISSIONS.STUDENTS_VIEW), true);
  assert.equal(hasPermission(ta, PERMISSIONS.STUDENTS_APPROVE), true);
  assert.equal(hasPermission(ta, PERMISSIONS.EXAMS_VIEW), true);
  assert.equal(hasPermission(ta, PERMISSIONS.EXAMS_GRADE), true);
  assert.equal(hasPermission(ta, PERMISSIONS.HOMEWORK_VIEW), true);
  assert.equal(hasPermission(ta, PERMISSIONS.HOMEWORK_GRADE), true);
  assert.equal(hasPermission(ta, PERMISSIONS.COMMENTS_MODERATE), true);
  assert.equal(hasPermission(ta, PERMISSIONS.GROUPS_MANAGE), true);

  // Denied high-risk / unauthorized tasks
  const deniedPerms = [
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.STUDENTS_DELETE,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.STUDENT_ACCESS_GRANT,
    PERMISSIONS.STUDENT_ACCESS_REVOKE,
    PERMISSIONS.CODES_MANAGE,
    PERMISSIONS.PAYMENTS_VERIFY,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.COUPONS_MANAGE,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.HOMEWORK_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
  ];
  for (const perm of deniedPerms) {
    assert.equal(hasPermission(ta, perm), false, `TEACHING_ASSISTANT must NOT have ${perm}`);
  }
});

test('CONTENT_MANAGER can manage curriculum, courses, exams, and homework but cannot approve payments or manage staff/settings', () => {
  const cm = makeSubject('CONTENT_MANAGER', 'ACTIVE');

  assert.equal(hasPermission(cm, PERMISSIONS.CONTENT_VIEW), true);
  assert.equal(hasPermission(cm, PERMISSIONS.CONTENT_MANAGE), true);
  assert.equal(hasPermission(cm, PERMISSIONS.COURSES_MANAGE), true);
  assert.equal(hasPermission(cm, PERMISSIONS.EXAMS_MANAGE), true);
  assert.equal(hasPermission(cm, PERMISSIONS.HOMEWORK_MANAGE), true);
  assert.equal(hasPermission(cm, PERMISSIONS.SCHEDULE_MANAGE), true);

  const deniedPerms = [
    PERMISSIONS.PAYMENTS_VERIFY,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.CODES_MANAGE,
    PERMISSIONS.COUPONS_MANAGE,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.STUDENTS_DELETE,
    PERMISSIONS.STUDENT_ACCESS_GRANT,
  ];
  for (const perm of deniedPerms) {
    assert.equal(hasPermission(cm, perm), false, `CONTENT_MANAGER must NOT have ${perm}`);
  }
});

test('SUPPORT has read-only student/order/code lookup and session assistance, but cannot generate codes, verify payments, or edit accounts', () => {
  const support = makeSubject('SUPPORT', 'ACTIVE');

  assert.equal(hasPermission(support, PERMISSIONS.STUDENTS_VIEW), true);
  assert.equal(hasPermission(support, PERMISSIONS.SESSIONS_MANAGE), true);
  assert.equal(hasPermission(support, PERMISSIONS.PAYMENTS_VIEW), true);
  assert.equal(hasPermission(support, PERMISSIONS.CODES_VIEW), true);

  const deniedPerms = [
    PERMISSIONS.CODES_MANAGE,
    PERMISSIONS.PAYMENTS_VERIFY,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.STUDENTS_DELETE,
    PERMISSIONS.STUDENT_ACCESS_GRANT,
    PERMISSIONS.STUDENT_ACCESS_REVOKE,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.EXAMS_GRADE,
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_MANAGE,
    PERMISSIONS.HOMEWORK_GRADE,
    PERMISSIONS.COUPONS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
  ];
  for (const perm of deniedPerms) {
    assert.equal(hasPermission(support, perm), false, `SUPPORT must NOT have ${perm}`);
  }
});

test('STUDENT role is unconditionally denied every administrative endpoint', () => {
  const student = makeSubject('STUDENT', 'ACTIVE');
  const decision = evaluateStaffAuthorization(student, PERMISSIONS.STUDENTS_VIEW);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.statusCode, 403);
    assert.equal(decision.reason, 'NOT_STAFF');
    assert.equal(decision.shouldRevokeSession, false);
  }
  assert.equal(hasAnyPermission(student, Object.values(PERMISSIONS)), false);
});

test('Owner-only ceiling blocks non-SUPER_ADMIN even if DB permissions_json contains wildcard or owner-only keys', () => {
  const misconfiguredTa = makeSubject('TEACHING_ASSISTANT', 'ACTIVE', [
    '*',
    ...Array.from(OWNER_ONLY_PERMISSIONS),
    PERMISSIONS.CODES_MANAGE,
  ]);

  // Wildcard must NOT grant unlisted permissions like payments:verify
  assert.equal(hasPermission(misconfiguredTa, PERMISSIONS.PAYMENTS_VERIFY), false);

  // Owner-only permissions must NEVER be granted to non-SUPER_ADMIN
  for (const ownerPerm of OWNER_ONLY_PERMISSIONS) {
    assert.equal(
      hasPermission(misconfiguredTa, ownerPerm),
      false,
      `Non-SUPER_ADMIN must never bypass owner ceiling for ${ownerPerm}`,
    );
  }
});

test('Suspended, archived, rejected, or pending staff accounts are immediately blocked and flagged for session revocation', () => {
  const inactiveStates = ['SUSPENDED', 'ARCHIVED', 'REJECTED', 'PENDING_APPROVAL', 'DISABLED'];

  for (const status of inactiveStates) {
    const ta = makeSubject('TEACHING_ASSISTANT', status);
    const decision = evaluateStaffAuthorization(ta, PERMISSIONS.STUDENTS_VIEW);
    assert.equal(decision.allowed, false, `Staff with status ${status} must be rejected`);
    if (!decision.allowed) {
      assert.equal(decision.statusCode, 403);
      assert.equal(decision.reason, 'ACCOUNT_INACTIVE');
      assert.equal(decision.shouldRevokeSession, true);
    }

    // Even SUPER_ADMIN must be blocked if marked non-ACTIVE
    const suspendedAdmin = makeSubject('SUPER_ADMIN', status);
    assert.equal(hasPermission(suspendedAdmin, PERMISSIONS.SETTINGS_MANAGE), false);
    const adminDecision = evaluateStaffAuthorization(suspendedAdmin);
    assert.equal(adminDecision.allowed, false);
    if (!adminDecision.allowed) {
      assert.equal(adminDecision.reason, 'ACCOUNT_INACTIVE');
      assert.equal(adminDecision.shouldRevokeSession, true);
    }
  }
});

test('Admin dashboard tab visibility aligns with each role policy', () => {
  const superAdmin = makeSubject('SUPER_ADMIN');
  const cm = makeSubject('CONTENT_MANAGER');
  const ta = makeSubject('TEACHING_ASSISTANT');
  const support = makeSubject('SUPPORT');

  assert.equal(canAccessAdminTab(superAdmin, 'overview'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'operations'), true);

  assert.equal(canAccessAdminTab(cm, 'videos'), true);
  assert.equal(canAccessAdminTab(cm, 'courses'), true);
  assert.equal(canAccessAdminTab(cm, 'exams'), true);
  assert.equal(canAccessAdminTab(cm, 'homework'), true);
  assert.equal(canAccessAdminTab(cm, 'payments'), false);
  assert.equal(canAccessAdminTab(cm, 'codes'), false);
  assert.equal(canAccessAdminTab(cm, 'students'), false);
  assert.equal(canAccessAdminTab(cm, 'overview'), true); // Role-filtered Smart Dashboard landing

  assert.equal(canAccessAdminTab(ta, 'overview'), true);
  assert.equal(canAccessAdminTab(ta, 'students'), true);
  assert.equal(canAccessAdminTab(ta, 'exams'), true);
  assert.equal(canAccessAdminTab(ta, 'homework'), true);
  assert.equal(canAccessAdminTab(ta, 'operations'), true);
  assert.equal(canAccessAdminTab(ta, 'codes'), false);
  assert.equal(canAccessAdminTab(ta, 'payments'), false);
  assert.equal(canAccessAdminTab(ta, 'videos'), false);

  assert.equal(canAccessAdminTab(support, 'overview'), true);
  assert.equal(canAccessAdminTab(support, 'students'), true);
  assert.equal(canAccessAdminTab(support, 'codes'), true);
  assert.equal(canAccessAdminTab(support, 'payments'), true);
  assert.equal(canAccessAdminTab(support, 'videos'), false);
  assert.equal(canAccessAdminTab(support, 'exams'), false);
  assert.equal(canAccessAdminTab(support, 'homework'), false);
  assert.equal(canAccessAdminTab(support, 'operations'), false);

  // Dedicated system & communication tabs enforce strict RBAC
  assert.equal(canAccessAdminTab(superAdmin, 'groups'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'communications'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'devices'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'staff'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'settings'), true);
  assert.equal(canAccessAdminTab(superAdmin, 'audit'), true);

  assert.equal(canAccessAdminTab(cm, 'groups'), true);
  assert.equal(canAccessAdminTab(cm, 'devices'), true);
  assert.equal(canAccessAdminTab(cm, 'communications'), false);
  assert.equal(canAccessAdminTab(cm, 'staff'), false);
  assert.equal(canAccessAdminTab(cm, 'settings'), false);
  assert.equal(canAccessAdminTab(cm, 'audit'), false);

  assert.equal(canAccessAdminTab(ta, 'groups'), true);
  assert.equal(canAccessAdminTab(ta, 'communications'), true);
  assert.equal(canAccessAdminTab(ta, 'devices'), true);
  assert.equal(canAccessAdminTab(ta, 'staff'), false);
  assert.equal(canAccessAdminTab(ta, 'settings'), false);
  assert.equal(canAccessAdminTab(ta, 'audit'), false);

  assert.equal(canAccessAdminTab(support, 'devices'), true);
  assert.equal(canAccessAdminTab(support, 'groups'), false);
  assert.equal(canAccessAdminTab(support, 'communications'), false);
  assert.equal(canAccessAdminTab(support, 'staff'), false);
  assert.equal(canAccessAdminTab(support, 'settings'), false);
  assert.equal(canAccessAdminTab(support, 'audit'), false);

  // STUDENT and suspended staff must NEVER access the Smart Dashboard overview or devices tabs
  assert.equal(canAccessAdminTab(makeSubject('STUDENT'), 'overview'), false);
  assert.equal(canAccessAdminTab(makeSubject('STUDENT'), 'devices'), false);
  assert.equal(canAccessAdminTab(makeSubject('TEACHING_ASSISTANT', 'SUSPENDED'), 'overview'), false);
  assert.equal(canAccessAdminTab(makeSubject('TEACHING_ASSISTANT', 'SUSPENDED'), 'devices'), false);
});

test('Unknown admin tab IDs and undefined permission arrays fail closed without throwing', () => {
  const superAdmin = makeSubject('SUPER_ADMIN');
  assert.equal(
    canAccessAdminTab(superAdmin, 'nonexistent_tab' as unknown as 'overview'),
    false,
  );
  assert.equal(
    canAccessAdminTab(superAdmin, 'toString' as unknown as 'overview'),
    false,
  );
  assert.equal(hasAnyPermission(superAdmin, undefined), false);
  assert.equal(hasAnyPermission(superAdmin, null), false);
  assert.equal(hasAnyPermission(superAdmin, []), false);
});

