import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGED_STAFF_ROLES,
  evaluateStaffRoleChange,
  evaluateStaffTargetMutation,
  isAssignableStaffRole,
  normalizeOptionalEmail,
  sanitizeStaffPublicRecord,
  validateEgyptianPhone,
  validateOptionalEmail,
  validateStaffFullName,
  validateStrongStaffPassword,
} from './staffManagement.ts';

test('only TEACHING_ASSISTANT, CONTENT_MANAGER, and SUPPORT are assignable staff roles', () => {
  assert.deepEqual([...MANAGED_STAFF_ROLES], ['TEACHING_ASSISTANT', 'CONTENT_MANAGER', 'SUPPORT']);
  assert.equal(isAssignableStaffRole('TEACHING_ASSISTANT'), true);
  assert.equal(isAssignableStaffRole('CONTENT_MANAGER'), true);
  assert.equal(isAssignableStaffRole('SUPPORT'), true);

  assert.equal(isAssignableStaffRole('SUPER_ADMIN'), false);
  assert.equal(isAssignableStaffRole('STUDENT'), false);
  assert.equal(isAssignableStaffRole('ADMIN'), false);
  assert.equal(isAssignableStaffRole(''), false);
  assert.equal(isAssignableStaffRole(null), false);
});

test('phone, email, and fullName validation enforce clean Egyptian staff inputs', () => {
  const validPhone = validateEgyptianPhone(' 010-1234-5678 ');
  assert.equal(validPhone.ok, true);
  if (validPhone.ok) assert.equal(validPhone.phone, '01012345678');

  assert.equal(validateEgyptianPhone('01912345678').ok, false);
  assert.equal(validateEgyptianPhone('010123').ok, false);

  const emptyEmail = validateOptionalEmail('   ');
  assert.equal(emptyEmail.ok, true);
  if (emptyEmail.ok) assert.equal(emptyEmail.email, null);

  const validEmail = validateOptionalEmail(' TA.User@Physics.EG ');
  assert.equal(validEmail.ok, true);
  if (validEmail.ok) assert.equal(validEmail.email, 'ta.user@physics.eg');
  assert.equal(normalizeOptionalEmail(''), null);

  assert.equal(validateOptionalEmail('not-an-email').ok, false);

  assert.equal(validateStaffFullName('أ. كريم').ok, true);
  assert.equal(validateStaffFullName('أب').ok, false);
});

test('strong staff password policy enforces length, character diversity, and confirmation', () => {
  assert.equal(validateStrongStaffPassword('Staff@2026', 'Staff@2026').ok, true);
  assert.equal(validateStrongStaffPassword('Abcd1234', 'Abcd1234').ok, true);

  // Too short
  assert.equal(validateStrongStaffPassword('Ab12345', 'Ab12345').ok, false);
  // Missing uppercase
  assert.equal(validateStrongStaffPassword('staff2026', 'staff2026').ok, false);
  // Missing lowercase
  assert.equal(validateStrongStaffPassword('STAFF2026', 'STAFF2026').ok, false);
  // Missing digit
  assert.equal(validateStrongStaffPassword('StaffOnly!', 'StaffOnly!').ok, false);
  // Mismatched confirmation
  assert.equal(validateStrongStaffPassword('Staff@2026', 'Staff@2027').ok, false);
});

test('evaluateStaffTargetMutation restricts mutations to SUPER_ADMIN targeting managed staff only', () => {
  // SUPER_ADMIN targeting managed staff -> allowed
  assert.equal(
    evaluateStaffTargetMutation({
      actorId: 1,
      actorRoleSlug: 'SUPER_ADMIN',
      targetId: 2,
      targetRoleSlug: 'TEACHING_ASSISTANT',
    }).allowed,
    true,
  );

  // Non-SUPER_ADMIN actor -> 403
  const nonSuper = evaluateStaffTargetMutation({
    actorId: 2,
    actorRoleSlug: 'TEACHING_ASSISTANT',
    targetId: 3,
    targetRoleSlug: 'SUPPORT',
  });
  assert.equal(nonSuper.allowed, false);
  if (!nonSuper.allowed) assert.equal(nonSuper.statusCode, 403);

  // Targeting self -> 403
  const selfMut = evaluateStaffTargetMutation({
    actorId: 1,
    actorRoleSlug: 'SUPER_ADMIN',
    targetId: 1,
    targetRoleSlug: 'SUPER_ADMIN',
  });
  assert.equal(selfMut.allowed, false);
  if (!selfMut.allowed) assert.equal(selfMut.statusCode, 403);

  // Targeting another SUPER_ADMIN -> 403
  const otherSuper = evaluateStaffTargetMutation({
    actorId: 1,
    actorRoleSlug: 'SUPER_ADMIN',
    targetId: 99,
    targetRoleSlug: 'SUPER_ADMIN',
  });
  assert.equal(otherSuper.allowed, false);
  if (!otherSuper.allowed) assert.equal(otherSuper.statusCode, 403);

  // Targeting STUDENT -> 400 (must not convert/manage students via staff endpoints)
  const studentTarget = evaluateStaffTargetMutation({
    actorId: 1,
    actorRoleSlug: 'SUPER_ADMIN',
    targetId: 5,
    targetRoleSlug: 'STUDENT',
  });
  assert.equal(studentTarget.allowed, false);
  if (!studentTarget.allowed) assert.equal(studentTarget.statusCode, 400);
});

test('evaluateStaffRoleChange blocks SUPER_ADMIN promotion and invalid roles', () => {
  const validChange = evaluateStaffRoleChange({
    currentRoleSlug: 'TEACHING_ASSISTANT',
    nextRoleSlug: 'CONTENT_MANAGER',
  });
  assert.equal(validChange.allowed, true);
  if (validChange.allowed) assert.equal(validChange.changed, true);

  const sameRole = evaluateStaffRoleChange({
    currentRoleSlug: 'SUPPORT',
    nextRoleSlug: 'SUPPORT',
  });
  assert.equal(sameRole.allowed, true);
  if (sameRole.allowed) assert.equal(sameRole.changed, false);

  const superPromo = evaluateStaffRoleChange({
    currentRoleSlug: 'TEACHING_ASSISTANT',
    nextRoleSlug: 'SUPER_ADMIN',
  });
  assert.equal(superPromo.allowed, false);
  if (!superPromo.allowed) assert.equal(superPromo.statusCode, 403);

  const studentRole = evaluateStaffRoleChange({
    currentRoleSlug: 'TEACHING_ASSISTANT',
    nextRoleSlug: 'STUDENT',
  });
  assert.equal(studentRole.allowed, false);
  if (!studentRole.allowed) assert.equal(studentRole.statusCode, 400);
});

test('sanitizeStaffPublicRecord strips sensitive properties', () => {
  const raw = {
    id: 10,
    fullName: 'أ. سارة محمود',
    phone: '01099988877',
    email: 'sara@example.eg',
    status: 'ACTIVE',
    roleSlug: 'CONTENT_MANAGER',
    roleNameAr: 'مدير المحتوى',
    passwordHash: 'scrypt$secret$hash',
    uid: 'firebase-secret',
  } as unknown as Parameters<typeof sanitizeStaffPublicRecord>[0];

  const safe = sanitizeStaffPublicRecord(raw);
  assert.equal('passwordHash' in safe, false);
  assert.equal('uid' in safe, false);
  assert.equal(safe.fullName, 'أ. سارة محمود');
  assert.equal(safe.roleSlug, 'CONTENT_MANAGER');
});
