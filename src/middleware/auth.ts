import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { deviceSessions, roles, users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { hashToken } from '../server/domain/security.ts';
import {
  getCachedAuthSession,
  invalidateAuthCacheBySessionId,
  invalidateAuthCacheByUserId,
  setCachedAuthSession,
} from '../server/cache.ts';
import {
  DEFAULT_ROLE_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PERMISSIONS,
  STAFF_ROLES,
  evaluateStaffAuthorization,
  getInactiveStaffErrorMessage,
  hasAnyPermission,
  hasPermission,
  isAccountActive,
  isStaffRole,
  type RoleSlug,
} from '../lib/permissions.ts';

import {
  DEVICE_BLOCKED_ERROR_AR,
  normalizeDeviceFingerprint,
} from '../server/domain/deviceAccess.ts';

export { PERMISSIONS, STAFF_ROLES, hasAnyPermission, hasPermission, isAccountActive, isStaffRole };

/**
 * Resolves effective permissions for a role by combining database permissions
 * with canonical DEFAULT_ROLE_PERMISSIONS for built-in roles, while strictly
 * preventing non-SUPER_ADMIN roles from receiving wildcard or owner-only permissions.
 */
export function resolveEffectiveRolePermissions(
  roleSlug: string,
  dbPermissions: unknown,
): string[] {
  if (roleSlug === 'SUPER_ADMIN') {
    return ['*'];
  }
  const defaults = DEFAULT_ROLE_PERMISSIONS[roleSlug as RoleSlug] || [];
  const fromDb = Array.isArray(dbPermissions)
    ? dbPermissions.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  const merged = new Set<string>([...defaults, ...fromDb]);
  merged.delete('*');
  for (const ownerPerm of OWNER_ONLY_PERMISSIONS) {
    merged.delete(ownerPerm);
  }
  return Array.from(merged);
}

export interface AuthUserContext {
  id: number;
  uid: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  roleId: number;
  roleSlug: string;
  roleNameAr: string;
  permissions: string[];
  maxDevices: number;
  allowConcurrent: boolean;
  sessionId: number | null;
  deviceFingerprint: string | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthUserContext;
}

/**
 * Safely revokes all active sessions for a single specific user without affecting any other user.
 */
export async function revokeAllUserSessions(userId: number): Promise<void> {
  await db
    .update(deviceSessions)
    .set({ isRevoked: true, activeVideoId: null })
    .where(eq(deviceSessions.userId, userId));
  invalidateAuthCacheByUserId(userId);
}

async function revokeSingleSessionSafely(sessionId: number | null): Promise<void> {
  if (!sessionId) return;
  try {
    await db
      .update(deviceSessions)
      .set({ isRevoked: true, activeVideoId: null })
      .where(eq(deviceSessions.id, sessionId));
    invalidateAuthCacheBySessionId(sessionId);
  } catch (err) {
    console.error('Failed to revoke inactive staff session:', err);
  }
}

async function hasBlockedDeviceRecord(userId: number, rawFingerprint: string | null | undefined): Promise<boolean> {
  const fp = normalizeDeviceFingerprint(rawFingerprint);
  if (!fp) return false;
  const blocked = await db
    .select({ id: deviceSessions.id })
    .from(deviceSessions)
    .where(
      and(
        eq(deviceSessions.userId, userId),
        eq(deviceSessions.deviceFingerprint, fp),
        eq(deviceSessions.isBlocked, true),
      ),
    )
    .limit(1);
  return blocked.length > 0;
}

export async function resolveFirebaseUserFromIdToken(rawToken: string): Promise<AuthUserContext | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(rawToken);
    const email = (decoded.email || '').toLowerCase();
    const ownerEmail = (process.env.INITIAL_ADMIN_EMAIL || 'hamdyelshabasy@gmail.com').toLowerCase();

    const existing = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.uid, decoded.uid))
      .limit(1);

    if (existing.length > 0) {
      const { user, role } = existing[0];
      return {
        id: user.id,
        uid: user.uid,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        roleId: role.id,
        roleSlug: role.slug,
        roleNameAr: role.nameAr,
        permissions: resolveEffectiveRolePermissions(role.slug, role.permissionsJson),
        maxDevices: user.maxDevices,
        allowConcurrent: user.allowConcurrent,
        sessionId: null,
        deviceFingerprint: null,
      };
    }

    // Link existing user by email or upsert new user safely
    const targetRoleSlug = email && email === ownerEmail ? 'SUPER_ADMIN' : 'STUDENT';
    const [targetRole] = await db.select().from(roles).where(eq(roles.slug, targetRoleSlug)).limit(1);
    if (!targetRole) return null;

    const [upserted] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email: email || null,
        fullName: decoded.name || email.split('@')[0] || 'مستخدم جديد',
        roleId: targetRole.id,
        status: targetRoleSlug === 'SUPER_ADMIN' ? 'ACTIVE' : 'PENDING_APPROVAL',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || null,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    return {
      id: upserted.id,
      uid: upserted.uid,
      fullName: upserted.fullName,
      email: upserted.email,
      phone: upserted.phone,
      status: upserted.status,
      roleId: targetRole.id,
      roleSlug: targetRole.slug,
      roleNameAr: targetRole.nameAr,
      permissions: resolveEffectiveRolePermissions(targetRole.slug, targetRole.permissionsJson),
      maxDevices: upserted.maxDevices,
      allowConcurrent: upserted.allowConcurrent,
      sessionId: null,
      deviceFingerprint: null,
    };
  } catch {
    return null;
  }
}

type TokenResolutionResult =
  | { ok: true; user: AuthUserContext }
  | { ok: false; statusCode: 401 | 403; errorAr: string; reasonCode?: string };

async function resolveUserByToken(
  rawToken: string,
  presentedDeviceFingerprint?: string | null,
): Promise<TokenResolutionResult> {
  // 1. Local DB-backed session token (prefixed with sess_)
  if (rawToken.startsWith('sess_')) {
    const tokenHash = hashToken(rawToken);
    const cachedUser = getCachedAuthSession<AuthUserContext>(tokenHash);
    if (cachedUser) {
      return { ok: true, user: cachedUser };
    }

    const now = new Date();
    const rows = await db
      .select({
        session: deviceSessions,
        user: users,
        role: roles,
        hasBlockedDevice: sql<boolean>`EXISTS (
          SELECT 1
          FROM device_sessions ds_blk
          WHERE ds_blk.user_id = ${deviceSessions.userId}
            AND ds_blk.device_fingerprint = ${deviceSessions.deviceFingerprint}
            AND ds_blk.is_blocked = true
        )`,
      })
      .from(deviceSessions)
      .innerJoin(users, eq(deviceSessions.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(
        and(
          eq(deviceSessions.sessionTokenHash, tokenHash),
          eq(deviceSessions.isRevoked, false),
          eq(deviceSessions.isBlocked, false),
          gt(deviceSessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!rows.length) {
      return { ok: false, statusCode: 401, errorAr: 'انتهت صلاحية الجلسة أو تم تسجيل الخروج منها' };
    }
    const { session, user, role, hasBlockedDevice } = rows[0];

    // Defense-in-depth: if this recognized device fingerprint is marked blocked on ANY record
    // (including historical/revoked rows), immediately revoke and reject this session.
    if (Boolean(hasBlockedDevice)) {
      await revokeSingleSessionSafely(session.id);
      return {
        ok: false,
        statusCode: 403,
        errorAr: DEVICE_BLOCKED_ERROR_AR,
        reasonCode: 'DEVICE_BLOCKED',
      };
    }

    const resolvedUser: AuthUserContext = {
      id: user.id,
      uid: user.uid,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleId: role.id,
      roleSlug: role.slug,
      roleNameAr: role.nameAr,
      permissions: resolveEffectiveRolePermissions(role.slug, role.permissionsJson),
      maxDevices: user.maxDevices,
      allowConcurrent: user.allowConcurrent,
      sessionId: session.id,
      deviceFingerprint: session.deviceFingerprint,
    };
    setCachedAuthSession(tokenHash, resolvedUser, session.expiresAt);

    return {
      ok: true,
      user: resolvedUser,
    };
  }

  // 2. Firebase Auth ID Token verification (fallback for direct Firebase tokens)
  const firebaseUser = await resolveFirebaseUserFromIdToken(rawToken);
  if (!firebaseUser) {
    return { ok: false, statusCode: 401, errorAr: 'انتهت صلاحية الجلسة أو تم تسجيل الخروج منها' };
  }

  const normalizedFp = normalizeDeviceFingerprint(presentedDeviceFingerprint);
  if (normalizedFp && !isStaffRole(firebaseUser.roleSlug)) {
    const blocked = await hasBlockedDeviceRecord(firebaseUser.id, normalizedFp);
    if (blocked) {
      return {
        ok: false,
        statusCode: 403,
        errorAr: DEVICE_BLOCKED_ERROR_AR,
        reasonCode: 'DEVICE_BLOCKED',
      };
    }
  }

  return {
    ok: true,
    user: {
      ...firebaseUser,
      deviceFingerprint: normalizedFp,
    },
  };
}

function extractPresentedDeviceFingerprint(req: Request): string | null {
  const raw = req.headers['x-device-fingerprint'];
  if (Array.isArray(raw)) return normalizeDeviceFingerprint(raw[0]);
  return normalizeDeviceFingerprint(typeof raw === 'string' ? raw : null);
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) {
      try {
        const result = await resolveUserByToken(token, extractPresentedDeviceFingerprint(req));
        if (result.ok) req.authUser = result.user;
      } catch (err) {
        console.error('Optional auth lookup error:', err);
      }
    }
  }
  next();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
  }
  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'رمز الجلسة غير صالح' });
  }
  try {
    const result = await resolveUserByToken(token, extractPresentedDeviceFingerprint(req));
    if (!result.ok) {
      return res.status(result.statusCode).json({
        error: result.errorAr,
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      });
    }
    req.authUser = result.user;
    return next();
  } catch (err) {
    console.error('Auth verification error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الجلسة' });
  }
}

export async function requireActiveAccount(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'غير مصرح بالدخول' });
  }
  if (!isAccountActive(req.authUser.status)) {
    if (isStaffRole(req.authUser.roleSlug)) {
      await revokeSingleSessionSafely(req.authUser.sessionId);
      return res.status(403).json({
        error: getInactiveStaffErrorMessage(req.authUser.status),
        status: req.authUser.status,
      });
    }
    return res.status(403).json({
      error: 'حسابك غير مفعّل حاليًا. يرجى انتظار موافقة المدرس للوصول إلى المحتوى.',
      status: req.authUser.status,
    });
  }
  return next();
}

export function requireStaff(requiredPermissions?: string | readonly string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const decision = evaluateStaffAuthorization(req.authUser, requiredPermissions);
    if (!decision.allowed) {
      if (decision.shouldRevokeSession && req.authUser?.sessionId) {
        await revokeSingleSessionSafely(req.authUser.sessionId);
      }
      return res.status(decision.statusCode).json({
        error: decision.errorAr,
        reason: decision.reason,
      });
    }
    return next();
  };
}

/**
 * Explicit granular permission middleware for administrative endpoints.
 * Requires an authenticated, ACTIVE staff account holding at least one of the specified permissions.
 */
export function requirePermission(permission: string | readonly string[]) {
  return requireStaff(permission);
}
