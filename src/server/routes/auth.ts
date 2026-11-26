import { Router } from 'express';
import { and, count, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  deviceSessions,
  enrollments,
  entitlements,
  grades,
  notifications,
  roles,
  studentProfiles,
  users,
} from '../../db/schema.ts';
import {
  isAccountActive,
  isStaffRole,
  requireActiveAccount,
  requireAuth,
  resolveEffectiveRolePermissions,
  resolveFirebaseUserFromIdToken,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { getInactiveStaffErrorMessage } from '../../lib/permissions.ts';
import { createNotification, logAudit } from '../audit.ts';
import {
  classifySessionStatus,
  describeUserAgent,
  evaluateDeviceLoginPolicy,
  isDeviceBlockedForUser,
  normalizeDeviceFingerprint,
} from '../domain/deviceAccess.ts';
import {
  createRateLimiter,
  DUMMY_PASSWORD_HASH,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyPasswordAsync,
} from '../domain/security.ts';
import {
  invalidateAuthCacheBySessionId,
  invalidateAuthCacheByUserId,
} from '../cache.ts';

export const authRouter = Router();

const authRateLimiter = createRateLimiter(20, 10 * 60 * 1000);
const authPhoneRateLimiter = createRateLimiter(12, 15 * 60 * 1000);
const registerRateLimiter = createRateLimiter(10, 15 * 60 * 1000);

const registerSchema = z
  .object({
    fullName: z.string().trim().min(3, 'يرجى إدخال الاسم بالكامل (3 أحرف على الأقل)'),
    phone: z.string().trim().regex(/^01[0125][0-9]{8}$/, 'يرجى إدخال رقم هاتف مصري صحيح (11 رقمًا يبدأ بـ 01)'),
    parentPhone: z
      .string()
      .trim()
      .regex(/^01[0125][0-9]{8}$/, 'يرجى إدخال رقم هاتف ولي الأمر بشكل صحيح (11 رقمًا)'),
    email: z.string().trim().email('صيغة البريد الإلكتروني غير صحيحة').optional().or(z.literal('')),
    password: z.string().min(6, 'كلمة المرور يجب أن لا تقل عن 6 أحرف'),
    confirmPassword: z.string(),
    trackId: z.coerce.number().int().positive('يرجى اختيار المسار الدراسي'),
    gradeId: z.coerce.number().int().positive('يرجى اختيار الصف الدراسي'),
    governorate: z.string().trim().optional().default(''),
    acceptTerms: z.literal(true, { message: 'يجب الموافقة على الشروط وسياسة الخصوصية' }),
    deviceFingerprint: z.string().trim().optional(),
    deviceLabel: z.string().trim().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'تأكيد كلمة المرور غير متطابق',
    path: ['confirmPassword'],
  })
  .refine((d) => d.phone !== d.parentPhone, {
    message: 'رقم هاتف ولي الأمر يجب أن يكون مختلفًا عن رقم الطالب',
    path: ['parentPhone'],
  });

const loginSchema = z.object({
  phone: z.string().trim().min(6, 'يرجى إدخال رقم الهاتف'),
  password: z.string().min(1, 'يرجى إدخال كلمة المرور'),
  deviceFingerprint: z.string().trim().optional(),
  deviceLabel: z.string().trim().optional(),
});

const googleLoginSchema = z.object({
  idToken: z.string().trim().min(10, 'رمز التحقق من Google غير صالح'),
  deviceFingerprint: z.string().trim().optional(),
  deviceLabel: z.string().trim().optional(),
});

async function createSessionForUser(params: {
  userId: number;
  maxDevices: number;
  deviceFingerprint: string;
  deviceLabel: string;
  userAgent: string;
  ipAddress: string;
}) {
  const now = new Date();
  const normalizedFingerprint =
    normalizeDeviceFingerprint(params.deviceFingerprint) || `web-${generateOpaqueToken(8)}`;

  // Load ALL sessions for this user (including revoked and expired rows) so that
  // a blocked device fingerprint can NEVER bypass its block by being revoked or expired.
  const allUserSessions = await db
    .select({
      id: deviceSessions.id,
      deviceFingerprint: deviceSessions.deviceFingerprint,
      isRevoked: deviceSessions.isRevoked,
      isBlocked: deviceSessions.isBlocked,
      expiresAt: deviceSessions.expiresAt,
    })
    .from(deviceSessions)
    .where(eq(deviceSessions.userId, params.userId));

  const policyDecision = evaluateDeviceLoginPolicy({
    sessions: allUserSessions,
    deviceFingerprint: normalizedFingerprint,
    maxDevices: params.maxDevices,
    now,
  });

  if (!policyDecision.allowed) {
    throw Object.assign(new Error(policyDecision.errorAr), {
      statusCode: policyDecision.statusCode,
      reasonCode: policyDecision.reason,
    });
  }

  const rawToken = `sess_${generateOpaqueToken(32)}`;
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 14 * 86400_000);

  const [session] = await db
    .insert(deviceSessions)
    .values({
      userId: params.userId,
      sessionTokenHash: tokenHash,
      deviceFingerprint: normalizedFingerprint,
      deviceLabel: params.deviceLabel,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      expiresAt,
    })
    .returning();

  return { token: rawToken, sessionId: session.id, expiresAt, deviceFingerprint: normalizedFingerprint };
}

async function buildMePayload(u: {
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
}) {
  const isStaff = isStaffRole(u.roleSlug);
  const [profileRows, userEnrollments, unreadRows, activeEntRows] = await Promise.all([
    isStaff
      ? Promise.resolve([])
      : db.select().from(studentProfiles).where(eq(studentProfiles.userId, u.id)).limit(1),
    isStaff
      ? Promise.resolve([])
      : db
          .select({
            enrollment: enrollments,
            gradeNameAr: grades.nameAr,
            gradeSlug: grades.slug,
            trackNameAr: academicTracks.nameAr,
          })
          .from(enrollments)
          .innerJoin(grades, eq(enrollments.gradeId, grades.id))
          .innerJoin(academicTracks, eq(enrollments.trackId, academicTracks.id))
          .where(eq(enrollments.userId, u.id))
          .orderBy(desc(enrollments.createdAt)),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, u.id), eq(notifications.isRead, false))),
    isStaff
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(entitlements)
          .where(and(eq(entitlements.userId, u.id), eq(entitlements.isRevoked, false))),
  ]);

  return {
    user: u,
    profile: profileRows[0] || null,
    enrollments: userEnrollments.map((e) => ({
      ...e.enrollment,
      gradeNameAr: e.gradeNameAr,
      gradeSlug: e.gradeSlug,
      trackNameAr: e.trackNameAr,
    })),
    unreadNotifications: unreadRows[0]?.value ?? 0,
    activeEntitlementsCount: activeEntRows[0]?.value ?? 0,
  };
}

authRouter.post('/register', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = registerRateLimiter.check(`reg:${ip}`);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `تم إرسال طلبات تسجيل متكررة. حاول مرة أخرى بعد ${rate.retryAfterSec} ثانية.`,
      });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التسجيل غير مكتملة' });
    }
    const data = parsed.data;

    const existing = await db.select().from(users).where(eq(users.phone, data.phone)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل. يمكنك تسجيل الدخول مباشرة.' });
    }

    const [gradeRow] = await db
      .select()
      .from(grades)
      .where(and(eq(grades.id, data.gradeId), eq(grades.trackId, data.trackId)))
      .limit(1);
    if (!gradeRow) {
      return res.status(400).json({ error: 'الصف الدراسي المختار لا ينتمي لهذا المسار' });
    }

    const [studentRole] = await db.select().from(roles).where(eq(roles.slug, 'STUDENT')).limit(1);
    if (!studentRole) {
      return res.status(500).json({ error: 'خطأ في تهيئة صلاحيات الطلاب' });
    }

    const parentShareCode = `PAR-${generateOpaqueToken(5).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;

    const newUser = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          fullName: data.fullName,
          phone: data.phone,
          email: data.email || null,
          passwordHash: hashPassword(data.password),
          roleId: studentRole.id,
          status: 'PENDING_APPROVAL',
          maxDevices: 2,
          allowConcurrent: false,
        })
        .returning();

      await tx.insert(studentProfiles).values({
        userId: createdUser.id,
        parentPhone: data.parentPhone,
        governorate: data.governorate || '',
        primaryTrackId: data.trackId,
        primaryGradeId: data.gradeId,
        parentShareCode,
        parentAccessEnabled: true,
      });

      await tx.insert(enrollments).values({
        userId: createdUser.id,
        trackId: data.trackId,
        gradeId: data.gradeId,
        status: 'PENDING_APPROVAL',
      });

      return createdUser;
    });

    const session = await createSessionForUser({
      userId: newUser.id,
      maxDevices: newUser.maxDevices,
      deviceFingerprint: data.deviceFingerprint || `web-${generateOpaqueToken(8)}`,
      deviceLabel: data.deviceLabel || 'متصفح التسجيل',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: ip,
    });

    await createNotification({
      userId: newUser.id,
      titleAr: 'تم استلام طلب التسجيل بنجاح',
      bodyAr: `طلب انضمامك إلى ${gradeRow.nameAr} قيد المراجعة حاليًا من قِبل المدرس. سيتم إشعارك فور الموافقة.`,
      type: 'APPROVAL',
    });

    await logAudit({
      actorId: newUser.id,
      actorName: newUser.fullName,
      action: 'STUDENT_REGISTERED',
      entityType: 'user',
      entityId: newUser.id,
      details: { phone: data.phone, gradeName: gradeRow.nameAr },
      ipAddress: ip,
    });

    return res.status(201).json({
      token: session.token,
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        phone: newUser.phone,
        email: newUser.email,
        status: newUser.status,
        roleSlug: 'STUDENT',
        roleNameAr: studentRole.nameAr,
      },
      message: 'تم إنشاء حسابك بنجاح وهو الآن في انتظار موافقة المدرس.',
    });
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string };
    console.error('Register failed:', error);
    return res.status(err.statusCode || 500).json({ error: err.message || 'تعذر إنشاء الحساب حاليًا' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = authRateLimiter.check(`login:${ip}`);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `محاولات دخول متكررة جدًا. يرجى الانتظار ${rate.retryAfterSec} ثانية.`,
      });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الدخول غير صحيحة' });
    }

    const { phone, password, deviceFingerprint, deviceLabel } = parsed.data;
    const phoneKey = `login:phone:${phone.replace(/\s+/g, '')}`;
    const phoneRate = authPhoneRateLimiter.check(phoneKey);
    if (!phoneRate.allowed) {
      return res.status(429).json({
        error: `تم تجاوز عدد محاولات الدخول لهذا الحساب مؤقتًا. يرجى الانتظار ${phoneRate.retryAfterSec} ثانية.`,
      });
    }

    const rows = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.phone, phone))
      .limit(1);

    const passwordMatches = await verifyPasswordAsync(
      password,
      rows.length ? rows[0].user.passwordHash : DUMMY_PASSWORD_HASH,
    );
    if (!rows.length || !passwordMatches) {
      return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }
    authPhoneRateLimiter.reset(phoneKey);

    const { user, role } = rows[0];
    if (isStaffRole(role.slug) && !isAccountActive(user.status)) {
      return res.status(403).json({ error: getInactiveStaffErrorMessage(user.status) });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'تم إيقاف هذا الحساب مؤقتًا. يرجى التواصل مع إدارة المنصة.' });
    }
    if (user.status === 'ARCHIVED') {
      return res.status(403).json({ error: 'تم أرشفة وتعطيل هذا الحساب من قِبل الإدارة. يرجى التواصل مع المدرس للاستعادة.' });
    }

    const session = await createSessionForUser({
      userId: user.id,
      maxDevices: user.maxDevices,
      deviceFingerprint: deviceFingerprint || `web-${generateOpaqueToken(8)}`,
      deviceLabel: deviceLabel || 'متصفح ويب',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: ip,
    });

    const effectivePermissions = resolveEffectiveRolePermissions(role.slug, role.permissionsJson);
    const authCtx = {
      id: user.id,
      uid: user.uid,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleId: role.id,
      roleSlug: role.slug,
      roleNameAr: role.nameAr,
      permissions: effectivePermissions,
      maxDevices: user.maxDevices,
      allowConcurrent: user.allowConcurrent,
      sessionId: session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
    };

    const [, , mePayload] = await Promise.all([
      db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)),
      logAudit({
        actorId: user.id,
        actorName: user.fullName,
        action: 'USER_LOGIN',
        entityType: 'session',
        entityId: session.sessionId,
        details: { role: role.slug },
        ipAddress: ip,
      }),
      buildMePayload(authCtx),
    ]);

    return res.json({
      token: session.token,
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        status: user.status,
        roleSlug: role.slug,
        roleNameAr: role.nameAr,
        permissions: effectivePermissions,
      },
      me: mePayload,
    });
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string; reasonCode?: string };
    console.error('Login failed:', error);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'تعذر تسجيل الدخول',
      ...(err.reasonCode ? { reasonCode: err.reasonCode } : {}),
    });
  }
});

authRouter.post('/google', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = authRateLimiter.check(`login:${ip}`);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `محاولات دخول متكررة جدًا. يرجى الانتظار ${rate.retryAfterSec} ثانية.`,
      });
    }

    const parsed = googleLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الدخول عبر Google غير صالحة' });
    }

    const { idToken, deviceFingerprint, deviceLabel } = parsed.data;
    const resolved = await resolveFirebaseUserFromIdToken(idToken);
    if (!resolved) {
      return res.status(401).json({ error: 'تعذر التحقق من حساب Google. يرجى المحاولة مرة أخرى.' });
    }

    if (isStaffRole(resolved.roleSlug) && !isAccountActive(resolved.status)) {
      return res.status(403).json({ error: getInactiveStaffErrorMessage(resolved.status) });
    }
    if (resolved.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'تم إيقاف هذا الحساب مؤقتًا. يرجى التواصل مع إدارة المنصة.' });
    }
    if (resolved.status === 'ARCHIVED') {
      return res.status(403).json({ error: 'تم أرشفة وتعطيل هذا الحساب من قِبل الإدارة. يرجى التواصل مع المدرس للاستعادة.' });
    }

    const session = await createSessionForUser({
      userId: resolved.id,
      maxDevices: resolved.maxDevices,
      deviceFingerprint: deviceFingerprint || `web-${generateOpaqueToken(8)}`,
      deviceLabel: deviceLabel || 'متصفح ويب (Google)',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: ip,
    });

    const authCtx = {
      ...resolved,
      sessionId: session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
    };

    const [, , mePayload] = await Promise.all([
      db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, resolved.id)),
      logAudit({
        actorId: resolved.id,
        actorName: resolved.fullName,
        action: 'USER_LOGIN',
        entityType: 'session',
        entityId: session.sessionId,
        details: { role: resolved.roleSlug, provider: 'google' },
        ipAddress: ip,
      }),
      buildMePayload(authCtx),
    ]);

    return res.json({
      token: session.token,
      user: {
        id: resolved.id,
        fullName: resolved.fullName,
        phone: resolved.phone,
        email: resolved.email,
        status: resolved.status,
        roleSlug: resolved.roleSlug,
        roleNameAr: resolved.roleNameAr,
        permissions: resolved.permissions,
      },
      me: mePayload,
    });
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string; reasonCode?: string };
    console.error('Google login failed:', error);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'تعذر تسجيل الدخول عبر حساب Google',
      ...(err.reasonCode ? { reasonCode: err.reasonCode } : {}),
    });
  }
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    if (isStaffRole(u.roleSlug) && !isAccountActive(u.status)) {
      if (u.sessionId) {
        await db
          .update(deviceSessions)
          .set({ isRevoked: true, activeVideoId: null })
          .where(eq(deviceSessions.id, u.sessionId));
        invalidateAuthCacheBySessionId(u.sessionId);
      }
      return res.status(403).json({
        error: getInactiveStaffErrorMessage(u.status),
        status: u.status,
      });
    }
    const payload = await buildMePayload(u);
    return res.json(payload);
  } catch (error) {
    console.error('Auth me failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات الحساب' });
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.authUser?.sessionId) {
      await db
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(eq(deviceSessions.id, req.authUser.sessionId));
      invalidateAuthCacheBySessionId(req.authUser.sessionId);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout failed:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الخروج' });
  }
});

authRouter.post('/logout-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(deviceSessions)
      .set({ isRevoked: true, activeVideoId: null })
      .where(eq(deviceSessions.userId, req.authUser!.id));
    invalidateAuthCacheByUserId(req.authUser!.id);
    return res.json({ success: true, message: 'تم تسجيل الخروج من جميع الأجهزة بنجاح' });
  } catch (error) {
    console.error('Logout all failed:', error);
    return res.status(500).json({ error: 'تعذر تسجيل الخروج من الأجهزة' });
  }
});

// Active Devices & Sessions management for the currently authenticated user (Admin, Staff, or Student)
authRouter.get('/sessions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const now = new Date();
    const rows = await db
      .select({
        id: deviceSessions.id,
        deviceFingerprint: deviceSessions.deviceFingerprint,
        deviceLabel: deviceSessions.deviceLabel,
        userAgent: deviceSessions.userAgent,
        ipAddress: deviceSessions.ipAddress,
        isRevoked: deviceSessions.isRevoked,
        isBlocked: deviceSessions.isBlocked,
        lastHeartbeatAt: deviceSessions.lastHeartbeatAt,
        expiresAt: deviceSessions.expiresAt,
        createdAt: deviceSessions.createdAt,
      })
      .from(deviceSessions)
      .where(eq(deviceSessions.userId, u.id))
      .orderBy(desc(deviceSessions.lastHeartbeatAt), desc(deviceSessions.createdAt))
      .limit(30);

    const activeDistinctFingerprints = new Set<string>();
    const formatted = rows.map((row) => {
      const status = classifySessionStatus(row, now);
      if (status === 'ACTIVE') {
        activeDistinctFingerprints.add(row.deviceFingerprint);
      }
      return {
        id: row.id,
        deviceLabel: row.deviceLabel || 'متصفح ويب',
        browserDescription: describeUserAgent(row.userAgent, row.deviceLabel),
        ipAddress: row.ipAddress || '',
        isCurrent: u.sessionId !== null && row.id === u.sessionId,
        status,
        isRevoked: row.isRevoked,
        isBlocked: row.isBlocked,
        createdAt: row.createdAt,
        lastHeartbeatAt: row.lastHeartbeatAt,
        expiresAt: row.expiresAt,
      };
    });

    return res.json({
      currentSessionId: u.sessionId,
      maxDevices: u.maxDevices,
      activeDistinctDeviceCount: activeDistinctFingerprints.size,
      activeSessionCount: formatted.filter((s) => s.status === 'ACTIVE').length,
      sessions: formatted,
    });
  } catch (error) {
    console.error('Fetch own sessions failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الأجهزة والجلسات النشطة' });
  }
});

authRouter.post('/sessions/:id/revoke', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: 'معرّف الجلسة غير صالح' });
    }

    const [target] = await db
      .select({ id: deviceSessions.id, userId: deviceSessions.userId, deviceLabel: deviceSessions.deviceLabel })
      .from(deviceSessions)
      .where(and(eq(deviceSessions.id, sessionId), eq(deviceSessions.userId, u.id)))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'الجلسة غير موجودة أو لا تخص حسابك' });
    }

    await db
      .update(deviceSessions)
      .set({ isRevoked: true, activeVideoId: null })
      .where(eq(deviceSessions.id, target.id));
    invalidateAuthCacheBySessionId(target.id);

    const revokedCurrent = u.sessionId !== null && target.id === u.sessionId;
    await logAudit({
      actorId: u.id,
      actorName: u.fullName,
      action: revokedCurrent ? 'SELF_SESSION_LOGOUT' : 'SELF_REMOTE_SESSION_REVOKED',
      entityType: 'session',
      entityId: target.id,
      details: { deviceLabel: target.deviceLabel, revokedCurrent },
      ipAddress: req.ip || 'unknown',
    });

    return res.json({
      success: true,
      revokedCurrent,
      message: revokedCurrent
        ? 'تم تسجيل الخروج من هذا الجهاز بنجاح'
        : 'تم إنهاء جلسة الجهاز بنجاح',
    });
  } catch (error) {
    console.error('Revoke own session failed:', error);
    return res.status(500).json({ error: 'تعذر إنهاء الجلسة المختارة' });
  }
});

authRouter.post('/sessions/revoke-others', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    if (!u.sessionId) {
      return res.status(400).json({ error: 'تعذر تحديد الجلسة الحالية' });
    }

    const revoked = await db
      .update(deviceSessions)
      .set({ isRevoked: true, activeVideoId: null })
      .where(
        and(
          eq(deviceSessions.userId, u.id),
          ne(deviceSessions.id, u.sessionId),
          eq(deviceSessions.isRevoked, false),
        ),
      )
      .returning({ id: deviceSessions.id });
    for (const r of revoked) invalidateAuthCacheBySessionId(r.id);

    await logAudit({
      actorId: u.id,
      actorName: u.fullName,
      action: 'SELF_REVOKE_OTHER_SESSIONS',
      entityType: 'user',
      entityId: u.id,
      details: { revokedCount: revoked.length, keptSessionId: u.sessionId },
      ipAddress: req.ip || 'unknown',
    });

    return res.json({
      success: true,
      revokedCount: revoked.length,
      message:
        revoked.length > 0
          ? `تم تسجيل الخروج من ${revoked.length} جلسة على الأجهزة الأخرى مع إبقاء جهازك الحالي نشطًا.`
          : 'لا توجد جلسات نشطة أخرى على حسابك.',
    });
  } catch (error) {
    console.error('Revoke other sessions failed:', error);
    return res.status(500).json({ error: 'تعذر إنهاء الجلسات الأخرى' });
  }
});

// Verified credential-based recovery when hitting the max device limit at login
const recoverLoginSchema = z.object({
  phone: z.string().trim().min(6, 'يرجى إدخال رقم الهاتف'),
  password: z.string().min(1, 'يرجى إدخال كلمة المرور'),
  deviceFingerprint: z.string().trim().optional(),
  deviceLabel: z.string().trim().optional(),
  action: z.enum(['LIST', 'REVOKE_AND_LOGIN']),
  revokeSessionIds: z.array(z.coerce.number().int().positive()).optional(),
  revokeAllOthers: z.boolean().optional(),
});

authRouter.post('/sessions/recover-login', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = authRateLimiter.check(`recover:${ip}`);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `محاولات متكررة جدًا. يرجى الانتظار ${rate.retryAfterSec} ثانية.`,
      });
    }

    const parsed = recoverLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الاسترداد غير صالحة' });
    }

    const { phone, password, deviceFingerprint, deviceLabel, action, revokeSessionIds, revokeAllOthers } =
      parsed.data;

    const recoverPhoneKey = `login:phone:${phone.replace(/\s+/g, '')}`;
    const phoneRate = authPhoneRateLimiter.check(recoverPhoneKey);
    if (!phoneRate.allowed) {
      return res.status(429).json({
        error: `تم تجاوز عدد المحاولات لهذا الحساب مؤقتًا. يرجى الانتظار ${phoneRate.retryAfterSec} ثانية.`,
      });
    }

    const rows = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.phone, phone))
      .limit(1);

    const passwordMatches = await verifyPasswordAsync(
      password,
      rows.length ? rows[0].user.passwordHash : DUMMY_PASSWORD_HASH,
    );
    if (!rows.length || !passwordMatches) {
      return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }
    authPhoneRateLimiter.reset(recoverPhoneKey);

    const { user, role } = rows[0];
    if (isStaffRole(role.slug) && !isAccountActive(user.status)) {
      return res.status(403).json({ error: getInactiveStaffErrorMessage(user.status) });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'تم إيقاف هذا الحساب مؤقتًا. يرجى التواصل مع إدارة المنصة.' });
    }
    if (user.status === 'ARCHIVED') {
      return res.status(403).json({ error: 'تم أرشفة وتعطيل هذا الحساب من قِبل الإدارة.' });
    }

    const now = new Date();
    const allUserSessions = await db
      .select({
        id: deviceSessions.id,
        deviceFingerprint: deviceSessions.deviceFingerprint,
        deviceLabel: deviceSessions.deviceLabel,
        userAgent: deviceSessions.userAgent,
        ipAddress: deviceSessions.ipAddress,
        isRevoked: deviceSessions.isRevoked,
        isBlocked: deviceSessions.isBlocked,
        lastHeartbeatAt: deviceSessions.lastHeartbeatAt,
        expiresAt: deviceSessions.expiresAt,
        createdAt: deviceSessions.createdAt,
      })
      .from(deviceSessions)
      .where(eq(deviceSessions.userId, user.id))
      .orderBy(desc(deviceSessions.lastHeartbeatAt), desc(deviceSessions.createdAt));

    const normalizedFp = normalizeDeviceFingerprint(deviceFingerprint);
    if (normalizedFp && isDeviceBlockedForUser(allUserSessions, normalizedFp)) {
      return res.status(403).json({
        error: 'تم حظر هذا الجهاز من قِبل إدارة المنصة. تواصل مع الدعم الفني.',
        reasonCode: 'DEVICE_BLOCKED',
      });
    }

    const activeSessions = allUserSessions.filter((s) => classifySessionStatus(s, now) === 'ACTIVE');

    if (action === 'LIST') {
      const distinctFps = new Set(activeSessions.map((s) => s.deviceFingerprint));
      return res.json({
        maxDevices: user.maxDevices,
        activeDistinctDeviceCount: distinctFps.size,
        sessions: activeSessions.map((s) => ({
          id: s.id,
          deviceLabel: s.deviceLabel || 'متصفح ويب',
          browserDescription: describeUserAgent(s.userAgent, s.deviceLabel),
          ipAddress: s.ipAddress || '',
          createdAt: s.createdAt,
          lastHeartbeatAt: s.lastHeartbeatAt,
        })),
      });
    }

    // REVOKE_AND_LOGIN: revoke chosen sessions (or all active sessions) belonging to this verified user
    let revokedCount = 0;
    if (revokeAllOthers) {
      const revoked = await db
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(and(eq(deviceSessions.userId, user.id), eq(deviceSessions.isRevoked, false)))
        .returning({ id: deviceSessions.id });
      revokedCount = revoked.length;
    } else if (revokeSessionIds && revokeSessionIds.length > 0) {
      // Also revoke any duplicate active sessions sharing the same fingerprint as selected sessions so a device slot is cleanly freed
      const targetRows = activeSessions.filter((s) => revokeSessionIds.includes(s.id));
      if (!targetRows.length) {
        return res.status(400).json({ error: 'يرجى اختيار جلسة نشطة واحدة على الأقل لإنهائها' });
      }
      const targetFps = [...new Set(targetRows.map((s) => s.deviceFingerprint))];
      const revoked = await db
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(
          and(
            eq(deviceSessions.userId, user.id),
            inArray(deviceSessions.deviceFingerprint, targetFps),
            eq(deviceSessions.isRevoked, false),
          ),
        )
        .returning({ id: deviceSessions.id });
      revokedCount = revoked.length;
    } else {
      return res.status(400).json({ error: 'يرجى اختيار جلسة لإنهائها أو اختيار إنهاء جميع الجلسات الأخرى' });
    }
    invalidateAuthCacheByUserId(user.id);

    const session = await createSessionForUser({
      userId: user.id,
      maxDevices: user.maxDevices,
      deviceFingerprint: deviceFingerprint || `web-${generateOpaqueToken(8)}`,
      deviceLabel: deviceLabel || 'متصفح ويب',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: ip,
    });

    const effectivePermissions = resolveEffectiveRolePermissions(role.slug, role.permissionsJson);
    const authCtx = {
      id: user.id,
      uid: user.uid,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleId: role.id,
      roleSlug: role.slug,
      roleNameAr: role.nameAr,
      permissions: effectivePermissions,
      maxDevices: user.maxDevices,
      allowConcurrent: user.allowConcurrent,
      sessionId: session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
    };

    const [, , mePayload] = await Promise.all([
      db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)),
      logAudit({
        actorId: user.id,
        actorName: user.fullName,
        action: 'DEVICE_LIMIT_RECOVERY_LOGIN',
        entityType: 'session',
        entityId: session.sessionId,
        details: { role: role.slug, revokedCount, revokeAllOthers: Boolean(revokeAllOthers) },
        ipAddress: ip,
      }),
      buildMePayload(authCtx),
    ]);

    return res.json({
      token: session.token,
      revokedCount,
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        status: user.status,
        roleSlug: role.slug,
        roleNameAr: role.nameAr,
        permissions: effectivePermissions,
      },
      me: mePayload,
      message: 'تم إنهاء الجلسة السابقة وتسجيل الدخول بنجاح.',
    });
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string; reasonCode?: string };
    console.error('Device limit recovery login failed:', error);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'تعذر استرداد تسجيل الدخول حاليًا',
      ...(err.reasonCode ? { reasonCode: err.reasonCode } : {}),
    });
  }
});

// Existing student requests joining an additional grade (subject to teacher approval)
authRouter.post('/request-grade', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      trackId: z.coerce.number().int().positive(),
      gradeId: z.coerce.number().int().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'يرجى اختيار المسار والصف الدراسي' });
    }

    const [gradeRow] = await db
      .select()
      .from(grades)
      .where(and(eq(grades.id, parsed.data.gradeId), eq(grades.trackId, parsed.data.trackId)))
      .limit(1);
    if (!gradeRow) {
      return res.status(400).json({ error: 'الصف المختار غير صالح' });
    }

    const existing = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, req.authUser!.id), eq(enrollments.gradeId, parsed.data.gradeId)))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'لديك طلب أو اشتراك مسجل بالفعل في هذا الصف' });
    }

    const [created] = await db
      .insert(enrollments)
      .values({
        userId: req.authUser!.id,
        trackId: parsed.data.trackId,
        gradeId: parsed.data.gradeId,
        status: 'PENDING_APPROVAL',
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ADDITIONAL_GRADE_REQUESTED',
      entityType: 'enrollment',
      entityId: created.id,
      details: { gradeName: gradeRow.nameAr },
    });

    return res.status(201).json({
      enrollment: created,
      message: `تم إرسال طلب الانضمام إلى ${gradeRow.nameAr} وهو الآن بانتظار موافقة المدرس.`,
    });
  } catch (error) {
    console.error('Request grade failed:', error);
    return res.status(500).json({ error: 'تعذر إرسال طلب الانضمام للصف الجديد' });
  }
});
