import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { deviceSessions, entitlements, roles, users } from '../db/schema.ts';
import {
  STUDENT_ROLE_SLUG,
  evaluateBulkStudentTargetAccess,
  evaluateStudentTargetAccess,
} from './domain/adminControl.ts';

export type ResolvedStudentTarget =
  | {
      ok: true;
      user: typeof users.$inferSelect;
      role: typeof roles.$inferSelect;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorAr: string;
      targetRoleSlug?: string;
    };

/**
 * Loads a single user joined with its actual database role and enforces
 * that the target is strictly a STUDENT account.
 */
export async function resolveStrictStudentTarget(rawUserId: unknown): Promise<ResolvedStudentTarget> {
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, statusCode: 400, errorAr: 'معرّف الطالب غير صالح' };
  }

  const rows = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!rows.length) {
    return { ok: false, statusCode: 404, errorAr: 'الطالب غير موجود' };
  }

  const { user, role } = rows[0];
  const decision = evaluateStudentTargetAccess({ id: user.id, roleSlug: role.slug });
  if (!decision.allowed) {
    return {
      ok: false,
      statusCode: decision.statusCode,
      errorAr: decision.errorAr,
      targetRoleSlug: role.slug,
    };
  }

  return { ok: true, user, role };
}

export type ResolvedBulkStudentTargets =
  | {
      ok: true;
      studentIds: number[];
      studentRoleId: number;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404 | 500;
      errorAr: string;
      blockedIds?: number[];
      blockedRoles?: string[];
    };

/**
 * Loads all targeted users joined with their database roles and rejects
 * the entire bulk request if ANY targeted user is not a STUDENT.
 */
export async function resolveStrictStudentBulkTargets(
  rawUserIds: number[],
): Promise<ResolvedBulkStudentTargets> {
  const uniqueIds = Array.from(new Set(rawUserIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) {
    return { ok: false, statusCode: 400, errorAr: 'يرجى تحديد طالب واحد على الأقل' };
  }

  const [studentRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.slug, STUDENT_ROLE_SLUG))
    .limit(1);

  if (!studentRole) {
    return { ok: false, statusCode: 500, errorAr: 'دور الطالب غير موجود في النظام' };
  }

  const resolvedRows = await db
    .select({ id: users.id, roleSlug: roles.slug })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(inArray(users.id, uniqueIds));

  const decision = evaluateBulkStudentTargetAccess({
    requestedIds: uniqueIds,
    resolvedUsers: resolvedRows,
  });

  if (!decision.allowed) {
    return {
      ok: false,
      statusCode: decision.statusCode,
      errorAr: decision.errorAr,
      blockedIds: decision.blockedIds,
      blockedRoles: decision.blockedRoles,
    };
  }

  return {
    ok: true,
    studentIds: decision.studentIds,
    studentRoleId: studentRole.id,
  };
}

export type ResolvedStudentSessionTarget =
  | {
      ok: true;
      targetUserId: number;
      sessionId?: number;
      deviceFingerprint?: string;
      deviceLabel?: string;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorAr: string;
      targetRoleSlug?: string;
    };

/**
 * Verifies that session revocation / device blocking / unblocking / logout-all actions
 * from student management can ONLY affect STUDENT accounts.
 */
export async function resolveStrictStudentSessionTarget(params: {
  action: 'REVOKE_ONE' | 'BLOCK_DEVICE' | 'UNBLOCK_DEVICE' | 'LOGOUT_ALL_USER';
  sessionId?: number;
  userId?: number;
}): Promise<ResolvedStudentSessionTarget> {
  if (params.action === 'LOGOUT_ALL_USER') {
    if (!params.userId) {
      return { ok: false, statusCode: 400, errorAr: 'معرّف الطالب مطلوب لتسجيل الخروج من جميع الأجهزة' };
    }
    const target = await resolveStrictStudentTarget(params.userId);
    if (!target.ok) return target;
    return { ok: true, targetUserId: target.user.id };
  }

  if (!params.sessionId || !Number.isInteger(params.sessionId) || params.sessionId <= 0) {
    return { ok: false, statusCode: 400, errorAr: 'معرّف الجلسة غير صالح' };
  }

  const rows = await db
    .select({
      sessionId: deviceSessions.id,
      deviceFingerprint: deviceSessions.deviceFingerprint,
      deviceLabel: deviceSessions.deviceLabel,
      userId: users.id,
      roleSlug: roles.slug,
    })
    .from(deviceSessions)
    .innerJoin(users, eq(deviceSessions.userId, users.id))
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(deviceSessions.id, params.sessionId))
    .limit(1);

  if (!rows.length) {
    return { ok: false, statusCode: 404, errorAr: 'الجلسة غير موجودة' };
  }

  const decision = evaluateStudentTargetAccess({ id: rows[0].userId, roleSlug: rows[0].roleSlug });
  if (!decision.allowed) {
    return {
      ok: false,
      statusCode: decision.statusCode,
      errorAr: decision.errorAr,
      targetRoleSlug: rows[0].roleSlug,
    };
  }

  return {
    ok: true,
    targetUserId: rows[0].userId,
    sessionId: rows[0].sessionId,
    deviceFingerprint: rows[0].deviceFingerprint,
    deviceLabel: rows[0].deviceLabel,
  };
}

export type ResolvedStudentEntitlementTarget =
  | {
      ok: true;
      entitlement: typeof entitlements.$inferSelect;
      roleSlug: string;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorAr: string;
      targetRoleSlug?: string;
    };

/**
 * Verifies that an entitlement being updated or revoked via student management
 * belongs strictly to a STUDENT account.
 */
export async function resolveStrictStudentEntitlementTarget(
  rawEntitlementId: unknown,
): Promise<ResolvedStudentEntitlementTarget> {
  const entId = Number(rawEntitlementId);
  if (!Number.isInteger(entId) || entId <= 0) {
    return { ok: false, statusCode: 400, errorAr: 'معرّف الصلاحية غير صالح' };
  }

  const rows = await db
    .select({
      entitlement: entitlements,
      userId: users.id,
      roleSlug: roles.slug,
    })
    .from(entitlements)
    .innerJoin(users, eq(entitlements.userId, users.id))
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(entitlements.id, entId))
    .limit(1);

  if (!rows.length) {
    return { ok: false, statusCode: 404, errorAr: 'الصلاحية غير موجودة' };
  }

  const decision = evaluateStudentTargetAccess({ id: rows[0].userId, roleSlug: rows[0].roleSlug });
  if (!decision.allowed) {
    return {
      ok: false,
      statusCode: decision.statusCode,
      errorAr: decision.errorAr,
      targetRoleSlug: rows[0].roleSlug,
    };
  }

  return {
    ok: true,
    entitlement: rows[0].entitlement,
    roleSlug: rows[0].roleSlug,
  };
}
