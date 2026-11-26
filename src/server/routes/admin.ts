import { Router } from 'express';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  accessCodes,
  auditLogs,
  choices,
  codeRedemptions,
  coupons,
  courseLessons,
  courses,
  deviceSessions,
  enrollments,
  entitlements,
  examAttempts,
  examQuestions,
  exams,
  grades,
  groupMembers,
  groups,
  lectureSchedules,
  lessonComments,
  lessons,
  notifications,
  orders,
  payments,
  plans,
  platformSubscriptions,
  progressRecords,
  questions,
  roles,
  settings,
  studentAnswers,
  studentProfiles,
  subscriptions,
  units,
  users,
  videoAccessCounters,
  videos,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isStaffRole,
  requireAuth,
  requirePermission,
  requireStaff,
  revokeAllUserSessions,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification, logAudit } from '../audit.ts';
import { adminCatalogCache, invalidateAllContentCaches } from '../cache.ts';
import {
  canDeleteActivationCode,
  computePlatformSubscriptionState,
  generateActivationCode,
  hashActivationCode,
  maskActivationCode,
} from '../domain/codes.ts';
import { getSourcePriority } from '../domain/entitlements.ts';
import { getBlockedDeviceFingerprints } from '../domain/deviceAccess.ts';
import { validateGroupPayload, validateSchedulePayload } from '../domain/schedules.ts';
import {
  buildVideoViewersAnalytics,
  validateVideoThumbnailUrl,
} from '../domain/videoManagement.ts';
import {
  evaluateStaffRoleChange,
  evaluateStaffTargetMutation,
  isAssignableStaffRole,
  sanitizeStaffPublicRecord,
  validateEgyptianPhone,
  validateOptionalEmail,
  validateStaffFullName,
  validateStrongStaffPassword,
} from '../domain/staffManagement.ts';
import { generateOpaqueToken, hashPassword, verifyPassword, verifyWebhookHmac } from '../domain/security.ts';
import { extractYouTubeVideoId } from '../../lib/youtube.ts';
import { extractGoogleDriveFileId } from '../../lib/googleDrive.ts';
import { parseLocalizedInt, preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  resolveStrictStudentBulkTargets,
  resolveStrictStudentEntitlementTarget,
  resolveStrictStudentSessionTarget,
  resolveStrictStudentTarget,
} from '../studentTargetGuard.ts';
import { smartDashboardRouter } from './smartDashboard.ts';
import { invalidatePublicBootstrapCache } from './public.ts';

export const adminRouter = Router();

// Public Paymob HMAC-verified webhook (mounted before requireAuth)
adminRouter.post('/webhooks/paymob', async (req, res) => {
  try {
    const secret = process.env.PAYMOB_HMAC_SECRET || '';
    const hmacHeader = String(req.headers['x-paymob-hmac'] || req.query.hmac || '');
    const rawBody = JSON.stringify(req.body || {});
    if (!secret || !verifyWebhookHmac(rawBody, hmacHeader, secret)) {
      return res.status(401).json({ error: 'Invalid Paymob HMAC signature' });
    }

    const orderNumber = String(req.body?.order?.merchant_order_id || '').trim();
    if (!orderNumber) {
      return res.status(400).json({ error: 'Missing merchant_order_id' });
    }
    const paid = Boolean(req.body?.success);
    const [orderRow] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });

    const rawAmountCents = req.body?.amount_cents ?? req.body?.order?.amount_cents;
    if (rawAmountCents !== undefined && rawAmountCents !== null) {
      const amountCents = Number(rawAmountCents);
      const expectedCents = Math.round(Number(orderRow.finalAmountEgp) * 100);
      if (!Number.isFinite(amountCents) || amountCents < expectedCents) {
        return res.status(400).json({ error: 'Paid amount mismatch' });
      }
    }

    if (paid && orderRow.status !== 'PAID') {
      await fulfillOrderAndGrantAccess(orderRow.id, null, 'Paymob Webhook', req.body);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Paymob webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function fulfillOrderAndGrantAccess(
  orderId: number,
  actorId: number | null,
  actorName: string,
  webhookPayload?: unknown,
): Promise<{ fulfilled: boolean; alreadyProcessed?: boolean; orderNumber?: string }> {
  const result = await db.transaction(async (tx) => {
    const [claimedOrder] = await tx
      .update(orders)
      .set({ status: 'PAID' })
      .where(and(eq(orders.id, orderId), inArray(orders.status, ['PENDING', 'UNDER_REVIEW'])))
      .returning();

    if (!claimedOrder) {
      const [existing] = await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!existing) {
        throw Object.assign(new Error('الطلب غير موجود'), { statusCode: 404 });
      }
      return { fulfilled: false as const, alreadyProcessed: true as const };
    }

    await tx
      .update(payments)
      .set({
        status: 'VERIFIED',
        verifiedById: actorId,
        verifiedAt: new Date(),
        ...(webhookPayload ? { webhookPayloadJson: webhookPayload } : {}),
      })
      .where(eq(payments.orderId, orderId));

    let durationDays = 90;
    let entTargetType: 'VIDEO' | 'COURSE' | 'GRADE_ALL' = 'VIDEO';
    let entTargetId = claimedOrder.targetId;
    let source: 'PURCHASE' | 'SUBSCRIPTION' = 'PURCHASE';

    if (claimedOrder.targetType === 'COURSE') {
      const [c] = await tx.select().from(courses).where(eq(courses.id, claimedOrder.targetId)).limit(1);
      durationDays = c?.validityDays || 120;
      entTargetType = 'COURSE';
      await tx.insert(subscriptions).values({
        userId: claimedOrder.userId,
        courseId: claimedOrder.targetId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + durationDays * 86400_000),
      });
    } else if (claimedOrder.targetType === 'PLAN') {
      const [p] = await tx.select().from(plans).where(eq(plans.id, claimedOrder.targetId)).limit(1);
      durationDays = p?.durationDays || 30;
      entTargetType = 'GRADE_ALL';
      entTargetId = p?.gradeId || claimedOrder.targetId;
      source = 'SUBSCRIPTION';
      await tx.insert(subscriptions).values({
        userId: claimedOrder.userId,
        planId: claimedOrder.targetId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + durationDays * 86400_000),
      });
    }

    await tx.insert(entitlements).values({
      userId: claimedOrder.userId,
      targetType: entTargetType,
      targetId: entTargetId,
      source,
      priority: getSourcePriority(source),
      expiresAt: new Date(Date.now() + durationDays * 86400_000),
      grantedById: actorId,
      note: `تفعيل تلقائي بعد تأكيد الطلب ${claimedOrder.orderNumber}`,
    });

    return { fulfilled: true as const, orderRow: claimedOrder };
  });

  if (!result.fulfilled) {
    return { fulfilled: false, alreadyProcessed: true };
  }

  const { orderRow } = result;
  await createNotification({
    userId: orderRow.userId,
    titleAr: 'تم تأكيد الدفع وفتح المحتوى',
    bodyAr: `تم تأكيد عملية الدفع للطلب ${orderRow.orderNumber} (${orderRow.targetTitleAr}) وفتح المحتوى في حسابك.`,
    type: 'GENERAL',
  });

  await logAudit({
    actorId,
    actorName,
    action: 'PAYMENT_VERIFIED_AND_GRANTED',
    entityType: 'order',
    entityId: orderId,
    details: { orderNumber: orderRow.orderNumber, amountEgp: orderRow.finalAmountEgp },
  });

  return { fulfilled: true, orderNumber: orderRow.orderNumber };
}

// Protect all following routes for authenticated staff
adminRouter.use(requireAuth, requireStaff());
adminRouter.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        invalidatePublicBootstrapCache();
      }
    });
  }
  next();
});
adminRouter.use(smartDashboardRouter);

// 1. Overview Dashboard KPIs & Charts (single parallel DB roundtrip with SQL aggregates)
adminRouter.get('/overview', requirePermission(PERMISSIONS.REPORTS_VIEW), async (_req, res) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const [
      kpiRes,
      topVideos,
      trackRows,
      gradeRows,
      enrCountsRes,
      recentOrders,
      recentAudit,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM users u INNER JOIN roles r ON u.role_id = r.id WHERE r.slug = 'STUDENT') AS total_students,
          (SELECT COUNT(*)::int FROM users u INNER JOIN roles r ON u.role_id = r.id WHERE r.slug = 'STUDENT' AND u.status = 'ACTIVE') AS active_students,
          (SELECT COUNT(*)::int FROM users u INNER JOIN roles r ON u.role_id = r.id WHERE r.slug = 'STUDENT' AND u.status = 'PENDING_APPROVAL') AS pending_students,
          (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'ACTIVE' AND expires_at > NOW()) AS active_subscriptions,
          (SELECT COALESCE(SUM(final_amount_egp), 0)::int FROM orders WHERE status = 'PAID') AS total_revenue_egp,
          (SELECT COALESCE(SUM(final_amount_egp), 0)::int FROM orders WHERE status IN ('UNDER_REVIEW', 'PENDING')) AS pending_revenue_egp,
          (SELECT COUNT(DISTINCT user_id)::int FROM device_sessions WHERE is_revoked = false AND last_heartbeat_at > ${fiveMinAgo}) AS online_now,
          (SELECT COALESCE(ROUND(AVG((total_score::numeric / NULLIF(GREATEST(max_score::numeric, 1), 0)) * 100)), 0)::int FROM exam_attempts) AS avg_exam_score_percent,
          (SELECT COUNT(*)::int FROM student_answers WHERE needs_manual_grading = true) AS pending_manual_grading_count
      `),
      db
        .select({
          id: videos.id,
          titleAr: videos.titleAr,
          viewsCount: videos.viewsCount,
          videoType: videos.videoType,
          gradeNameAr: grades.nameAr,
        })
        .from(videos)
        .innerJoin(grades, eq(videos.gradeId, grades.id))
        .orderBy(desc(videos.viewsCount))
        .limit(6),
      db.select().from(academicTracks).orderBy(asc(academicTracks.sortOrder)),
      db.select().from(grades).orderBy(asc(grades.sortOrder)),
      db.execute(sql`SELECT grade_id, COUNT(*)::int AS cnt FROM enrollments GROUP BY grade_id`),
      db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(12),
    ]);

    const kpiRow = ((kpiRes.rows || [])[0] || {}) as Record<string, unknown>;
    const trackNameById = new Map(trackRows.map((t) => [t.id, t.nameAr]));
    const enrCountByGrade = new Map<number, number>();
    for (const row of (enrCountsRes.rows || []) as Array<Record<string, unknown>>) {
      enrCountByGrade.set(Number(row.grade_id), Number(row.cnt || 0));
    }
    const viewsByGradeName = new Map<string, number>();
    for (const v of topVideos) {
      viewsByGradeName.set(v.gradeNameAr, (viewsByGradeName.get(v.gradeNameAr) || 0) + v.viewsCount);
    }

    const studentsByGradeChart = gradeRows.map((g) => ({
      name: g.nameAr.replace('الصف ', ''),
      track: trackNameById.get(g.trackId) || '',
      students: enrCountByGrade.get(g.id) || 0,
      videos: viewsByGradeName.get(g.nameAr) || 0,
    }));

    return res.json({
      kpis: {
        totalStudents: Number(kpiRow.total_students || 0),
        activeStudents: Number(kpiRow.active_students || 0),
        pendingStudents: Number(kpiRow.pending_students || 0),
        activeSubscriptions: Number(kpiRow.active_subscriptions || 0),
        totalRevenueEgp: Number(kpiRow.total_revenue_egp || 0),
        pendingRevenueEgp: Number(kpiRow.pending_revenue_egp || 0),
        onlineNow: Number(kpiRow.online_now || 0),
        avgExamScorePercent: Number(kpiRow.avg_exam_score_percent || 0),
        pendingManualGradingCount: Number(kpiRow.pending_manual_grading_count || 0),
      },
      topVideos,
      studentsByGradeChart,
      recentOrders,
      recentAudit,
    });
  } catch (error) {
    console.error('Admin overview failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل ملخص لوحة التحكم' });
  }
});

// 2. Students Management & Approval Queue
adminRouter.get(
  '/students',
  requirePermission([PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_APPROVE, PERMISSIONS.STUDENTS_MANAGE]),
  async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'ALL');
    const gradeIdFilter = Number(req.query.gradeId || 0);

    const [studentRows, allEnrollments] = await Promise.all([
      db
        .select({
          user: users,
          profile: studentProfiles,
          grade: grades,
          track: academicTracks,
        })
        .from(users)
        .innerJoin(roles, and(eq(users.roleId, roles.id), eq(roles.slug, 'STUDENT')))
        .leftJoin(studentProfiles, eq(users.id, studentProfiles.userId))
        .leftJoin(grades, eq(studentProfiles.primaryGradeId, grades.id))
        .leftJoin(academicTracks, eq(studentProfiles.primaryTrackId, academicTracks.id))
        .orderBy(desc(users.createdAt)),
      db
        .select({
          enrollment: enrollments,
          gradeNameAr: grades.nameAr,
          trackNameAr: academicTracks.nameAr,
        })
        .from(enrollments)
        .innerJoin(grades, eq(enrollments.gradeId, grades.id))
        .innerJoin(academicTracks, eq(enrollments.trackId, academicTracks.id)),
    ]);

    const enrollmentsByUser = new Map<number, typeof allEnrollments>();
    for (const e of allEnrollments) {
      const list = enrollmentsByUser.get(e.enrollment.userId) || [];
      list.push(e);
      enrollmentsByUser.set(e.enrollment.userId, list);
    }

    const filtered = studentRows
      .map((r) => ({
        id: r.user.id,
        fullName: r.user.fullName,
        phone: r.user.phone,
        email: r.user.email,
        status: r.user.status,
        maxDevices: r.user.maxDevices,
        allowConcurrent: r.user.allowConcurrent,
        lastLoginAt: r.user.lastLoginAt,
        createdAt: r.user.createdAt,
        parentPhone: r.profile?.parentPhone || '',
        governorate: r.profile?.governorate || '',
        parentShareCode: r.profile?.parentShareCode || '',
        primaryTrackId: r.profile?.primaryTrackId || null,
        primaryGradeId: r.profile?.primaryGradeId || null,
        trackNameAr: r.track?.nameAr || '',
        gradeNameAr: r.grade?.nameAr || '',
        enrollments: (enrollmentsByUser.get(r.user.id) || []).map((e) => ({
          ...e.enrollment,
          gradeNameAr: e.gradeNameAr,
          trackNameAr: e.trackNameAr,
        })),
      }))
      .filter((s) => {
        if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
        if (gradeIdFilter > 0 && s.primaryGradeId !== gradeIdFilter) return false;
        if (search) {
          const hay = `${s.fullName} ${s.phone || ''} ${s.parentPhone} ${s.governorate}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

    return res.json({ students: filtered });
  } catch (error) {
    console.error('Admin students list failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الطلاب' });
  }
});

// Manual add student by teacher
adminRouter.post('/students', requirePermission(PERMISSIONS.STUDENTS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      fullName: z.string().trim().min(3),
      phone: z.string().trim().min(8),
      parentPhone: z.string().trim().min(8),
      email: z.string().trim().optional(),
      password: z.string().min(6),
      trackId: z.coerce.number().int().positive(),
      gradeId: z.coerce.number().int().positive(),
      governorate: z.string().trim().optional().default(''),
      status: z.enum(['ACTIVE', 'PENDING_APPROVAL']).default('ACTIVE'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'يرجى استكمال بيانات الطالب بشكل صحيح' });

    const d = parsed.data;
    const [studentRole] = await db.select().from(roles).where(eq(roles.slug, 'STUDENT')).limit(1);
    if (!studentRole) return res.status(500).json({ error: 'دور الطالب غير موجود' });

    const shareCode = `PAR-${generateOpaqueToken(4).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;
    const created = await db.transaction(async (tx) => {
      const [userRow] = await tx
        .insert(users)
        .values({
          fullName: d.fullName,
          phone: d.phone,
          email: d.email || null,
          passwordHash: hashPassword(d.password),
          roleId: studentRole.id,
          status: d.status,
        })
        .returning();

      await tx.insert(studentProfiles).values({
        userId: userRow.id,
        parentPhone: d.parentPhone,
        governorate: d.governorate,
        primaryTrackId: d.trackId,
        primaryGradeId: d.gradeId,
        approvedById: d.status === 'ACTIVE' ? req.authUser!.id : null,
        approvedAt: d.status === 'ACTIVE' ? new Date() : null,
        parentShareCode: shareCode,
      });

      await tx.insert(enrollments).values({
        userId: userRow.id,
        trackId: d.trackId,
        gradeId: d.gradeId,
        status: d.status,
        decidedById: d.status === 'ACTIVE' ? req.authUser!.id : null,
        decidedAt: d.status === 'ACTIVE' ? new Date() : null,
      });

      return userRow;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_ADDED_MANUALLY',
      entityType: 'user',
      entityId: created.id,
      details: { fullName: d.fullName, phone: d.phone },
    });

    const { passwordHash: _redactedPasswordHash, ...safeStudent } = created;
    return res.status(201).json({ student: safeStudent });
  } catch (error) {
    console.error('Manual add student failed:', error);
    return res.status(500).json({ error: 'تعذر إضافة الطالب (ربما رقم الهاتف مسجل مسبقًا)' });
  }
});

// Bulk Approve / Reject / Suspend Students
adminRouter.post(
  '/students/bulk-decision',
  requirePermission([PERMISSIONS.STUDENTS_APPROVE, PERMISSIONS.STUDENTS_MANAGE]),
  async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      userIds: z.array(z.coerce.number().int().positive()).min(1),
      decision: z.enum(['ACTIVE', 'REJECTED', 'SUSPENDED']),
      note: z.string().trim().optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'يرجى تحديد طالب واحد على الأقل' });

    const { userIds, decision, note } = parsed.data;
    if (decision === 'SUSPENDED' && !hasPermission(req.authUser, PERMISSIONS.STUDENTS_MANAGE)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لإيقاف حسابات الطلاب.' });
    }
    const targetCheck = await resolveStrictStudentBulkTargets(userIds);
    if (!targetCheck.ok) {
      return res.status(targetCheck.statusCode).json({ error: targetCheck.errorAr });
    }

    const { studentIds, studentRoleId } = targetCheck;
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: decision, updatedAt: now })
        .where(and(inArray(users.id, studentIds), eq(users.roleId, studentRoleId)));

      await tx
        .update(enrollments)
        .set({
          status: decision,
          decidedById: req.authUser!.id,
          decidedAt: now,
          decisionNote: note,
        })
        .where(inArray(enrollments.userId, studentIds));

      if (decision === 'ACTIVE') {
        await tx
          .update(studentProfiles)
          .set({ approvedById: req.authUser!.id, approvedAt: now, decisionNote: note })
          .where(inArray(studentProfiles.userId, studentIds));
      }
    });

    // Immediately terminate active sessions & invalidate auth cache when suspending or rejecting students
    if (decision === 'SUSPENDED' || decision === 'REJECTED') {
      await Promise.all(studentIds.map((uid) => revokeAllUserSessions(uid)));
    }

    for (const uid of studentIds) {
      await createNotification({
        userId: uid,
        titleAr:
          decision === 'ACTIVE'
            ? 'تم قبول وتفعيل حسابك بنجاح'
            : decision === 'REJECTED'
              ? 'تحديث بخصوص طلب التسجيل'
              : 'تنبيه: تم تعليق الحساب مؤقتًا',
        bodyAr:
          decision === 'ACTIVE'
            ? 'يمكنك الآن الدخول إلى لوحة الطالب ومشاهدة الدروس وحل الامتحانات.'
            : note || 'يرجى التواصل مع إدارة المنصة لمزيد من التفاصيل.',
        type: 'APPROVAL',
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: `BULK_STUDENT_${decision}`,
      entityType: 'user',
      entityId: studentIds.join(','),
      details: { count: studentIds.length, note },
    });

    return res.json({ success: true, updatedCount: studentIds.length });
  } catch (error) {
    console.error('Bulk student decision failed:', error);
    return res.status(500).json({ error: 'تعذر تنفيذ القرار الجماعي' });
  }
});

// Edit single student (status, grade/track, device limit, password reset)
adminRouter.patch('/students/:id', requirePermission(PERMISSIONS.STUDENTS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const target = await resolveStrictStudentTarget(req.params.id);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }
    const userId = target.user.id;

    const schema = z.object({
      fullName: z.string().trim().min(2).optional(),
      status: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'REJECTED', 'SUSPENDED']).optional(),
      maxDevices: z.coerce.number().int().min(1).max(10).optional(),
      allowConcurrent: z.boolean().optional(),
      trackId: z.coerce.number().int().positive().optional(),
      gradeId: z.coerce.number().int().positive().optional(),
      newPassword: z.string().min(6).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات التعديل غير صالحة' });

    const d = parsed.data;
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (d.fullName) updateFields.fullName = d.fullName;
    if (d.status) updateFields.status = d.status;
    if (d.maxDevices !== undefined) updateFields.maxDevices = d.maxDevices;
    if (d.allowConcurrent !== undefined) updateFields.allowConcurrent = d.allowConcurrent;
    if (d.newPassword) updateFields.passwordHash = hashPassword(d.newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set(updateFields)
        .where(and(eq(users.id, userId), eq(users.roleId, target.role.id)));

      if (d.trackId && d.gradeId) {
        await tx
          .update(studentProfiles)
          .set({ primaryTrackId: d.trackId, primaryGradeId: d.gradeId })
          .where(eq(studentProfiles.userId, userId));

        await tx
          .insert(enrollments)
          .values({
            userId,
            trackId: d.trackId,
            gradeId: d.gradeId,
            status: 'ACTIVE',
            decidedById: req.authUser!.id,
            decidedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [enrollments.userId, enrollments.gradeId],
            set: { status: 'ACTIVE', decidedById: req.authUser!.id, decidedAt: new Date() },
          });
      }
    });

    // Immediately revoke sessions & clear auth cache on suspension, rejection, or password reset
    if (d.status === 'SUSPENDED' || d.status === 'REJECTED' || Boolean(d.newPassword)) {
      await revokeAllUserSessions(userId);
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: {
        status: d.status,
        maxDevices: d.maxDevices,
        allowConcurrent: d.allowConcurrent,
        passwordReset: Boolean(d.newPassword),
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Student update failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الطالب' });
  }
});

// Student 360° Detail (Entitlements, Watch History, Exam Results, Active Sessions)
adminRouter.get(
  '/students/:id/detail',
  requirePermission([PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_APPROVE, PERMISSIONS.STUDENTS_MANAGE]),
  async (req, res) => {
  try {
    const target = await resolveStrictStudentTarget(req.params.id);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }
    const userId = target.user.id;
    const u = target.user;

    const [profileRows, entRows, watchRows, attemptRows, allSessionRows] = await Promise.all([
      db
        .select()
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId))
        .limit(1),
      db
        .select()
        .from(entitlements)
        .where(eq(entitlements.userId, userId))
        .orderBy(desc(entitlements.createdAt)),
      db
        .select({
          progress: progressRecords,
          videoTitleAr: videos.titleAr,
        })
        .from(progressRecords)
        .innerJoin(videos, eq(progressRecords.videoId, videos.id))
        .where(eq(progressRecords.userId, userId))
        .orderBy(desc(progressRecords.updatedAt)),
      db
        .select({
          attempt: examAttempts,
          examTitleAr: exams.titleAr,
        })
        .from(examAttempts)
        .innerJoin(exams, eq(examAttempts.examId, exams.id))
        .where(eq(examAttempts.userId, userId))
        .orderBy(desc(examAttempts.startedAt)),
      db
        .select()
        .from(deviceSessions)
        .where(eq(deviceSessions.userId, userId))
        .orderBy(desc(deviceSessions.lastHeartbeatAt)),
    ]);
    const profile = profileRows[0];
    const blockedFps = getBlockedDeviceFingerprints(allSessionRows);
    const sessionRows = allSessionRows.slice(0, 15).map((s) => ({
      ...s,
      isBlocked: s.isBlocked || blockedFps.has(s.deviceFingerprint.trim()),
    }));

    return res.json({
      student: {
        id: u.id,
        fullName: u.fullName,
        phone: u.phone,
        email: u.email,
        status: u.status,
        maxDevices: u.maxDevices,
        allowConcurrent: u.allowConcurrent,
        lastLoginAt: u.lastLoginAt,
        parentPhone: profile?.parentPhone || '',
        governorate: profile?.governorate || '',
        parentShareCode: profile?.parentShareCode || '',
      },
      entitlements: entRows,
      watchHistory: watchRows.map((w) => ({
        ...w.progress,
        videoTitleAr: w.videoTitleAr,
      })),
      examAttempts: attemptRows.map((a) => ({
        ...a.attempt,
        examTitleAr: a.examTitleAr,
        totalScore: Number(a.attempt.totalScore),
        maxScore: Number(a.attempt.maxScore),
      })),
      sessions: sessionRows,
    });
  } catch (error) {
    console.error('Student detail failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل ملف الطالب التفصيلي' });
  }
});

// Direct Video / Course / Grade Entitlement Grant ("السماح بالمشاهدة")
adminRouter.post('/entitlements/grant', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      userId: z.coerce.number().int().positive(),
      targetType: z.enum(['VIDEO', 'COURSE', 'GRADE_ALL']),
      targetId: z.coerce.number().int().positive(),
      durationDays: z.coerce.number().int().min(0).default(0), // 0 = permanent
      note: z.string().trim().optional().default('صلاحية مباشرة من المدرس'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'يرجى تحديد الطالب والمحتوى المطلوب فتحه' });

    const d = parsed.data;
    const target = await resolveStrictStudentTarget(d.userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const expiresAt = d.durationDays > 0 ? new Date(Date.now() + d.durationDays * 86400_000) : null;

    const [created] = await db
      .insert(entitlements)
      .values({
        userId: d.userId,
        targetType: d.targetType,
        targetId: d.targetId,
        source: 'MANUAL_GRANT',
        priority: getSourcePriority('MANUAL_GRANT'),
        expiresAt,
        grantedById: req.authUser!.id,
        note: d.note,
      })
      .returning();

    await createNotification({
      userId: d.userId,
      titleAr: 'تم منحك صلاحية مشاهدة جديدة',
      bodyAr: d.durationDays > 0
        ? `قام المدرس بفتح محتوى جديد لحسابك لمدة ${d.durationDays} يومًا.`
        : 'قام المدرس بفتح محتوى جديد لحسابك بشكل دائم.',
      type: 'GENERAL',
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'DIRECT_ENTITLEMENT_GRANTED',
      entityType: 'entitlement',
      entityId: created.id,
      details: d,
    });

    return res.status(201).json({ entitlement: created, message: 'تم السماح بالمشاهدة بنجاح' });
  } catch (error) {
    console.error('Direct grant failed:', error);
    return res.status(500).json({ error: 'تعذر منح الصلاحية' });
  }
});

adminRouter.post('/entitlements/:id/revoke', requirePermission(PERMISSIONS.STUDENT_ACCESS_REVOKE), async (req: AuthRequest, res) => {
  try {
    const target = await resolveStrictStudentEntitlementTarget(req.params.id);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }
    const entId = target.entitlement.id;
    const [updated] = await db
      .update(entitlements)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(entitlements.id, entId))
      .returning();
    if (!updated) return res.status(404).json({ error: 'الصلاحية غير موجودة' });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ENTITLEMENT_REVOKED',
      entityType: 'entitlement',
      entityId: entId,
      details: { userId: updated.userId, targetType: updated.targetType, targetId: updated.targetId },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Revoke entitlement failed:', error);
    return res.status(500).json({ error: 'تعذر سحب الصلاحية' });
  }
});

// Device Session Actions (Revoke / Block / Unblock / Logout All)
adminRouter.post('/sessions/action', requirePermission(PERMISSIONS.SESSIONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      action: z.enum(['REVOKE_ONE', 'BLOCK_DEVICE', 'UNBLOCK_DEVICE', 'LOGOUT_ALL_USER']),
      sessionId: z.coerce.number().int().positive().optional(),
      userId: z.coerce.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'إجراء غير صالح' });

    const { action, sessionId, userId } = parsed.data;
    const sessionTarget = await resolveStrictStudentSessionTarget({ action, sessionId, userId });
    if (!sessionTarget.ok) {
      return res.status(sessionTarget.statusCode).json({ error: sessionTarget.errorAr });
    }

    if (action === 'LOGOUT_ALL_USER') {
      // Session revocation only: terminates active sessions without altering any device block state
      await db
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(eq(deviceSessions.userId, sessionTarget.targetUserId));
    } else if (action === 'REVOKE_ONE' && sessionTarget.sessionId) {
      // Session revocation only: terminates this single session without blocking the device
      await db
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(eq(deviceSessions.id, sessionTarget.sessionId));
    } else if (action === 'BLOCK_DEVICE' && sessionTarget.sessionId && sessionTarget.deviceFingerprint) {
      // Device blocking: revokes ALL active sessions for this (userId, deviceFingerprint)
      // and marks the recognized device identifier blocked so it cannot log in again until unblocked.
      await db
        .update(deviceSessions)
        .set({ isRevoked: true, isBlocked: true, activeVideoId: null })
        .where(
          and(
            eq(deviceSessions.userId, sessionTarget.targetUserId),
            eq(deviceSessions.deviceFingerprint, sessionTarget.deviceFingerprint),
          ),
        );
    } else if (action === 'UNBLOCK_DEVICE' && sessionTarget.sessionId && sessionTarget.deviceFingerprint) {
      // Device unblocking: clears isBlocked across all records for this (userId, deviceFingerprint)
      // while keeping previously revoked session tokens revoked so the student must log in fresh.
      await db
        .update(deviceSessions)
        .set({ isBlocked: false })
        .where(
          and(
            eq(deviceSessions.userId, sessionTarget.targetUserId),
            eq(deviceSessions.deviceFingerprint, sessionTarget.deviceFingerprint),
          ),
        );
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: `SESSION_${action}`,
      entityType: 'session',
      entityId: sessionTarget.sessionId || sessionTarget.targetUserId || '',
      details: {
        targetUserId: sessionTarget.targetUserId,
        deviceFingerprint: sessionTarget.deviceFingerprint || null,
        deviceLabel: sessionTarget.deviceLabel || null,
      },
      ipAddress: req.ip || '',
    });

    const messageMap: Record<typeof action, string> = {
      REVOKE_ONE: 'تم إنهاء الجلسة بنجاح',
      BLOCK_DEVICE: 'تم حظر الجهاز وإنهاء جلساته النشطة بنجاح',
      UNBLOCK_DEVICE: 'تم إلغاء حظر الجهاز بنجاح، ويمكن للطالب تسجيل الدخول منه مجددًا',
      LOGOUT_ALL_USER: 'تم تسجيل الخروج من جميع الأجهزة النشطة بنجاح',
    };

    return res.json({ success: true, message: messageMap[action] });
  } catch (error) {
    console.error('Session action failed:', error);
    return res.status(500).json({ error: 'تعذر تنفيذ الإجراء على الجلسة' });
  }
});

// 3. Full Curriculum Catalog for Admin CMS (Tracks, Grades, Units, Lessons, Videos, Courses, Plans, Coupons)
adminRouter.get(
  '/catalog',
  requirePermission([
    PERMISSIONS.CONTENT_VIEW,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.EXAMS_VIEW,
    PERMISSIONS.EXAMS_GRADE,
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_GRADE,
    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.GROUPS_MANAGE,
    PERMISSIONS.COMMENTS_MODERATE,
    PERMISSIONS.CODES_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
  ]),
  async (req: AuthRequest, res) => {
  try {
    const canViewCoupons = hasPermission(req.authUser, PERMISSIONS.COUPONS_MANAGE);
    const cacheKey = canViewCoupons ? 'full' : 'no-coupons';
    const payload = await adminCatalogCache.getOrLoad(cacheKey, async () => {
      const [tRows, gRows, uRows, lRows, vRows, cRows, clRows, pRows, cpRows, progCountRows, codeCountRows] = await Promise.all([
        db.select().from(academicTracks).orderBy(asc(academicTracks.sortOrder), asc(academicTracks.id)),
        db.select().from(grades).orderBy(asc(grades.sortOrder), asc(grades.id)),
        db.select().from(units).orderBy(asc(units.sortOrder), asc(units.id)),
        db.select().from(lessons).orderBy(asc(lessons.sortOrder), asc(lessons.id)),
        db.select().from(videos).orderBy(asc(videos.sortOrder), asc(videos.id)),
        db.select().from(courses).orderBy(asc(courses.sortOrder), asc(courses.id)),
        db.select().from(courseLessons),
        db.select().from(plans).orderBy(asc(plans.id)),
        canViewCoupons ? db.select().from(coupons).orderBy(desc(coupons.createdAt)) : Promise.resolve([]),
        db
          .select({
            videoId: progressRecords.videoId,
            viewersCount: sql<number>`count(distinct ${progressRecords.userId})::int`,
          })
          .from(progressRecords)
          .groupBy(progressRecords.videoId),
        db
          .select({
            targetId: accessCodes.targetId,
            activeCodesCount: sql<number>`count(*)::int`,
          })
          .from(accessCodes)
          .where(and(eq(accessCodes.targetType, 'VIDEO'), eq(accessCodes.status, 'AVAILABLE')))
          .groupBy(accessCodes.targetId),
      ]);
      const viewersCountByVideo = new Map(progCountRows.map((r) => [r.videoId, Number(r.viewersCount || 0)]));
      const activeCodesByVideo = new Map(codeCountRows.map((r) => [r.targetId, Number(r.activeCodesCount || 0)]));
      const lessonIdsByCourse = new Map<number, number[]>();
      for (const cl of clRows) {
        const list = lessonIdsByCourse.get(cl.courseId) || [];
        list.push(cl.lessonId);
        lessonIdsByCourse.set(cl.courseId, list);
      }
      return {
        tracks: tRows,
        grades: gRows,
        units: uRows,
        lessons: lRows,
        videos: vRows.map((v) => ({
          ...v,
          uniqueViewersCount: viewersCountByVideo.get(v.id) || 0,
          activeCodesCount: activeCodesByVideo.get(v.id) || 0,
        })),
        courses: cRows.map((c) => ({
          ...c,
          lessonIds: lessonIdsByCourse.get(c.id) || [],
        })),
        plans: pRows,
        coupons: cpRows,
      };
    });

    return res.json(payload);
  } catch (error) {
    console.error('Admin catalog load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل محتوى المنصة' });
  }
});

// Tracks & Grades CRUD
adminRouter.post('/tracks', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const { nameAr, subtitleAr, descriptionAr, sortOrder } = req.body || {};
    if (!nameAr) return res.status(400).json({ error: 'اسم المسار مطلوب' });
    const slug = `track-${Date.now()}`;
    const [created] = await db
      .insert(academicTracks)
      .values({ nameAr, subtitleAr: subtitleAr || '', descriptionAr: descriptionAr || '', slug, sortOrder: Number(sortOrder) || 10 })
      .returning();
    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'TRACK_CREATED', entityType: 'track', entityId: created.id });
    return res.status(201).json({ track: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إضافة المسار' });
  }
});

adminRouter.patch('/tracks/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { nameAr, subtitleAr, descriptionAr, isVisible, sortOrder } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (nameAr !== undefined) updates.nameAr = nameAr;
    if (subtitleAr !== undefined) updates.subtitleAr = subtitleAr;
    if (descriptionAr !== undefined) updates.descriptionAr = descriptionAr;
    if (isVisible !== undefined) updates.isVisible = Boolean(isVisible);
    if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);
    const [updated] = await db.update(academicTracks).set(updates).where(eq(academicTracks.id, id)).returning();
    return res.json({ track: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر تعديل المسار' });
  }
});

adminRouter.post('/grades', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const { trackId, nameAr, descriptionAr, sortOrder } = req.body || {};
    if (!trackId || !nameAr) return res.status(400).json({ error: 'المسار واسم الصف مطلوبان' });
    const [created] = await db
      .insert(grades)
      .values({
        trackId: Number(trackId),
        slug: `grade-${Date.now()}`,
        nameAr,
        descriptionAr: descriptionAr || '',
        sortOrder: Number(sortOrder) || 10,
      })
      .returning();
    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'GRADE_CREATED', entityType: 'grade', entityId: created.id });
    return res.status(201).json({ grade: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إضافة الصف الدراسي' });
  }
});

adminRouter.patch('/grades/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { nameAr, descriptionAr, isVisible, sortOrder } = req.body || {};
    const updates: Record<string, unknown> = {};
    if (nameAr !== undefined) updates.nameAr = nameAr;
    if (descriptionAr !== undefined) updates.descriptionAr = descriptionAr;
    if (isVisible !== undefined) updates.isVisible = Boolean(isVisible);
    if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);
    const [updated] = await db.update(grades).set(updates).where(eq(grades.id, id)).returning();
    return res.json({ grade: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر تعديل الصف الدراسي' });
  }
});

adminRouter.delete('/grades/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(grades).where(eq(grades.id, id));
    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'GRADE_DELETED', entityType: 'grade', entityId: id });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر حذف الصف الدراسي (قد يحتوي على سجلات مرتبطة)' });
  }
});

// Units, Lessons & Videos CRUD
const createUnitSchema = z.object({
  gradeId: z.coerce.number().int().positive('الصف الدراسي مطلوب'),
  titleAr: z
    .string()
    .trim()
    .min(2, 'اسم الوحدة يجب أن يكون حرفين على الأقل')
    .max(160, 'اسم الوحدة طويل جدًا'),
  descriptionAr: z.string().trim().max(600, 'وصف الوحدة طويل جدًا').optional().default(''),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional().default(true),
});

const updateUnitSchema = z.object({
  gradeId: z.coerce.number().int().positive('الصف الدراسي غير صالح').optional(),
  titleAr: z
    .string()
    .trim()
    .min(2, 'اسم الوحدة يجب أن يكون حرفين على الأقل')
    .max(160, 'اسم الوحدة طويل جدًا')
    .optional(),
  descriptionAr: z.string().trim().max(600, 'وصف الوحدة طويل جدًا').optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional(),
});

const createLessonSchema = z.object({
  unitId: z.coerce.number().int().positive('الوحدة الدراسية مطلوبة'),
  titleAr: z
    .string()
    .trim()
    .min(2, 'اسم الدرس يجب أن يكون حرفين على الأقل')
    .max(180, 'اسم الدرس طويل جدًا'),
  descriptionAr: z.string().trim().max(800, 'وصف الدرس طويل جدًا').optional().default(''),
  pdfTitleAr: z.string().trim().max(180, 'عنوان مذكرة PDF طويل جدًا').optional().nullable(),
  pdfContentSummary: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional().default(true),
  allowPdfDownload: z.boolean().optional().default(true),
  allowComments: z.boolean().optional().default(true),
});

const updateLessonSchema = z.object({
  unitId: z.coerce.number().int().positive('الوحدة الدراسية غير صالحة').optional(),
  titleAr: z
    .string()
    .trim()
    .min(2, 'اسم الدرس يجب أن يكون حرفين على الأقل')
    .max(180, 'اسم الدرس طويل جدًا')
    .optional(),
  descriptionAr: z.string().trim().max(800, 'وصف الدرس طويل جدًا').optional(),
  pdfTitleAr: z.string().trim().max(180, 'عنوان مذكرة PDF طويل جدًا').optional().nullable(),
  pdfContentSummary: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional(),
  allowPdfDownload: z.boolean().optional(),
  allowComments: z.boolean().optional(),
});

adminRouter.post('/units', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = createUnitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الوحدة غير صالحة' });
    }
    const d = parsed.data;
    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) {
      return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });
    }

    let resolvedSortOrder = d.sortOrder;
    if (resolvedSortOrder === undefined) {
      const existingUnits = await db
        .select({ sortOrder: units.sortOrder })
        .from(units)
        .where(eq(units.gradeId, d.gradeId));
      const maxOrder = existingUnits.reduce((acc, row) => Math.max(acc, row.sortOrder || 0), 0);
      resolvedSortOrder = maxOrder + 1;
    }

    const [created] = await db
      .insert(units)
      .values({
        gradeId: d.gradeId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        sortOrder: resolvedSortOrder,
        isVisible: d.isVisible,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'UNIT_CREATED',
      entityType: 'unit',
      entityId: created.id,
      details: { titleAr: created.titleAr, gradeId: created.gradeId },
    });
    return res.status(201).json({ unit: created });
  } catch (error) {
    console.error('Unit creation failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الوحدة الدراسية' });
  }
});

adminRouter.patch('/units/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الوحدة غير صالح' });
    }
    const [existing] = await db.select().from(units).where(eq(units.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الوحدة الدراسية غير موجودة' });
    }

    const parsed = updateUnitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل الوحدة غير صالحة' });
    }
    const d = parsed.data;
    const updates: Record<string, unknown> = {};
    let nextGradeRow: typeof grades.$inferSelect | null = null;

    if (d.gradeId !== undefined && d.gradeId !== existing.gradeId) {
      const [gRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
      if (!gRow) {
        return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });
      }
      nextGradeRow = gRow;
      updates.gradeId = d.gradeId;
    }
    if (d.titleAr !== undefined) updates.titleAr = d.titleAr;
    if (d.descriptionAr !== undefined) updates.descriptionAr = d.descriptionAr;
    if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;
    if (d.isVisible !== undefined) updates.isVisible = d.isVisible;

    if (Object.keys(updates).length === 0) {
      return res.json({ unit: existing });
    }

    const updated = await db.transaction(async (tx) => {
      const [uRow] = await tx.update(units).set(updates).where(eq(units.id, id)).returning();
      if (nextGradeRow) {
        const unitLessons = await tx
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.unitId, id));
        const lessonIds = unitLessons.map((l) => l.id);
        if (lessonIds.length > 0) {
          await tx
            .update(videos)
            .set({ gradeId: nextGradeRow.id, trackId: nextGradeRow.trackId, updatedAt: new Date() })
            .where(inArray(videos.lessonId, lessonIds));
        }
        await tx
          .update(videos)
          .set({ gradeId: nextGradeRow.id, trackId: nextGradeRow.trackId, updatedAt: new Date() })
          .where(eq(videos.unitId, id));
      }
      return uRow;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'UNIT_UPDATED',
      entityType: 'unit',
      entityId: id,
      details: {
        previousTitleAr: existing.titleAr,
        titleAr: updated.titleAr,
        gradeId: updated.gradeId,
        isVisible: updated.isVisible,
      },
    });
    return res.json({ unit: updated });
  } catch (error) {
    console.error('Unit update failed:', error);
    return res.status(500).json({ error: 'تعذر تعديل بيانات الوحدة الدراسية' });
  }
});

adminRouter.delete('/units/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الوحدة غير صالح' });
    }
    const [existing] = await db.select().from(units).where(eq(units.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الوحدة الدراسية غير موجودة' });
    }

    const summary = await db.transaction(async (tx) => {
      const unitLessons = await tx
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.unitId, id));
      const lessonIds = unitLessons.map((l) => l.id);

      let videoIds: number[] = [];
      if (lessonIds.length > 0) {
        const lessonVideos = await tx
          .select({ id: videos.id })
          .from(videos)
          .where(inArray(videos.lessonId, lessonIds));
        videoIds = lessonVideos.map((v) => v.id);
      }

      if (videoIds.length > 0) {
        await tx
          .update(exams)
          .set({ requiredVideoId: null })
          .where(inArray(exams.requiredVideoId, videoIds));
        await tx
          .update(deviceSessions)
          .set({ activeVideoId: null })
          .where(inArray(deviceSessions.activeVideoId, videoIds));
      }

      await tx.delete(units).where(eq(units.id, id));
      return { deletedLessonsCount: lessonIds.length, deletedVideosCount: videoIds.length };
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'UNIT_DELETED',
      entityType: 'unit',
      entityId: id,
      details: {
        titleAr: existing.titleAr,
        gradeId: existing.gradeId,
        deletedLessonsCount: summary.deletedLessonsCount,
        deletedVideosCount: summary.deletedVideosCount,
      },
    });
    return res.json({ success: true, ...summary });
  } catch (error) {
    console.error('Unit deletion failed:', error);
    return res.status(500).json({ error: 'تعذر حذف الوحدة الدراسية' });
  }
});

adminRouter.post('/lessons', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = createLessonSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الدرس غير صالحة' });
    }
    const d = parsed.data;
    const [unitRow] = await db.select().from(units).where(eq(units.id, d.unitId)).limit(1);
    if (!unitRow) {
      return res.status(404).json({ error: 'الوحدة الدراسية المحددة غير موجودة' });
    }

    let resolvedSortOrder = d.sortOrder;
    if (resolvedSortOrder === undefined) {
      const existingLessons = await db
        .select({ sortOrder: lessons.sortOrder })
        .from(lessons)
        .where(eq(lessons.unitId, d.unitId));
      const maxOrder = existingLessons.reduce((acc, row) => Math.max(acc, row.sortOrder || 0), 0);
      resolvedSortOrder = maxOrder + 1;
    }

    const cleanPdfTitle = (d.pdfTitleAr || '').trim() || null;
    const cleanPdfSummary = (d.pdfContentSummary || '').trim() || null;

    const [created] = await db
      .insert(lessons)
      .values({
        unitId: d.unitId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        sortOrder: resolvedSortOrder,
        isVisible: d.isVisible,
        pdfTitleAr: cleanPdfTitle,
        pdfContentSummary: cleanPdfSummary,
        pdfUrl: cleanPdfTitle ? `/api/public/pdf-note/lesson-${Date.now()}` : null,
        allowPdfDownload: d.allowPdfDownload,
        allowComments: d.allowComments,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'LESSON_CREATED',
      entityType: 'lesson',
      entityId: created.id,
      details: { titleAr: created.titleAr, unitId: created.unitId },
    });
    return res.status(201).json({ lesson: created });
  } catch (error) {
    console.error('Lesson creation failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الدرس' });
  }
});

adminRouter.patch('/lessons/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الدرس غير صالح' });
    }
    const [existing] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الدرس غير موجود' });
    }

    const parsed = updateLessonSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل الدرس غير صالحة' });
    }
    const d = parsed.data;
    const updates: Record<string, unknown> = {};
    let movedTargetUnit: { id: number; gradeId: number; trackId: number } | null = null;

    if (d.unitId !== undefined && d.unitId !== existing.unitId) {
      const [uRow] = await db.select().from(units).where(eq(units.id, d.unitId)).limit(1);
      if (!uRow) {
        return res.status(404).json({ error: 'الوحدة الدراسية المحددة غير موجودة' });
      }
      const [gRow] = await db.select().from(grades).where(eq(grades.id, uRow.gradeId)).limit(1);
      if (!gRow) {
        return res.status(404).json({ error: 'الصف الدراسي المرتبط بالوحدة غير موجود' });
      }
      movedTargetUnit = { id: uRow.id, gradeId: gRow.id, trackId: gRow.trackId };
      updates.unitId = d.unitId;
    }

    if (d.titleAr !== undefined) updates.titleAr = d.titleAr;
    if (d.descriptionAr !== undefined) updates.descriptionAr = d.descriptionAr;
    if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;
    if (d.isVisible !== undefined) updates.isVisible = d.isVisible;
    if (d.allowPdfDownload !== undefined) updates.allowPdfDownload = d.allowPdfDownload;
    if (d.allowComments !== undefined) updates.allowComments = d.allowComments;
    if (d.pdfTitleAr !== undefined) {
      const cleanPdfTitle = (d.pdfTitleAr || '').trim() || null;
      updates.pdfTitleAr = cleanPdfTitle;
      if (cleanPdfTitle && !existing.pdfUrl) {
        updates.pdfUrl = `/api/public/pdf-note/lesson-${id}-${Date.now()}`;
      } else if (!cleanPdfTitle) {
        updates.pdfUrl = null;
      }
    }
    if (d.pdfContentSummary !== undefined) {
      updates.pdfContentSummary = (d.pdfContentSummary || '').trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ lesson: existing });
    }

    const updated = await db.transaction(async (tx) => {
      const [lRow] = await tx.update(lessons).set(updates).where(eq(lessons.id, id)).returning();
      if (movedTargetUnit) {
        await tx
          .update(videos)
          .set({
            unitId: movedTargetUnit.id,
            gradeId: movedTargetUnit.gradeId,
            trackId: movedTargetUnit.trackId,
            updatedAt: new Date(),
          })
          .where(eq(videos.lessonId, id));
      }
      return lRow;
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'LESSON_UPDATED',
      entityType: 'lesson',
      entityId: id,
      details: {
        previousTitleAr: existing.titleAr,
        titleAr: updated.titleAr,
        unitId: updated.unitId,
        isVisible: updated.isVisible,
      },
    });
    return res.json({ lesson: updated });
  } catch (error) {
    console.error('Lesson update failed:', error);
    return res.status(500).json({ error: 'تعذر تعديل بيانات الدرس' });
  }
});

adminRouter.delete('/lessons/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الدرس غير صالح' });
    }
    const [existing] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الدرس غير موجود' });
    }

    const summary = await db.transaction(async (tx) => {
      const lessonVideos = await tx
        .select({ id: videos.id })
        .from(videos)
        .where(eq(videos.lessonId, id));
      const videoIds = lessonVideos.map((v) => v.id);

      if (videoIds.length > 0) {
        await tx
          .update(exams)
          .set({ requiredVideoId: null })
          .where(inArray(exams.requiredVideoId, videoIds));
        await tx
          .update(deviceSessions)
          .set({ activeVideoId: null })
          .where(inArray(deviceSessions.activeVideoId, videoIds));
      }

      await tx.delete(lessons).where(eq(lessons.id, id));
      return { deletedVideosCount: videoIds.length };
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'LESSON_DELETED',
      entityType: 'lesson',
      entityId: id,
      details: {
        titleAr: existing.titleAr,
        unitId: existing.unitId,
        deletedVideosCount: summary.deletedVideosCount,
      },
    });
    return res.json({ success: true, ...summary });
  } catch (error) {
    console.error('Lesson deletion failed:', error);
    return res.status(500).json({ error: 'تعذر حذف الدرس' });
  }
});

adminRouter.post('/videos', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      trackId: z.coerce.number().int().positive().optional().nullable(),
      gradeId: z.coerce.number().int().positive(),
      unitId: z.coerce.number().int().positive().optional().nullable(),
      lessonId: z.coerce.number().int().positive(),
      titleAr: z.string().trim().min(2, 'عنوان الفيديو مطلوب (حرفان على الأقل)'),
      youtubeUrl: z.string().trim().min(5, 'رابط فيديو يوتيوب مطلوب'),
      descriptionAr: z.string().trim().optional().default(''),
      durationSec: z.coerce.number().int().min(0).optional().default(0),
      thumbnailUrl: z.string().trim().optional().default(''),
      videoType: z.enum(['FREE', 'PAID', 'COURSE']).default('FREE'),
      courseId: z.coerce.number().int().positive().optional().nullable(),
      priceEgp: z.coerce.number().int().min(0).optional().default(0),
      sortOrder: z.coerce.number().int().min(0).optional().default(0),
      publicationStatus: z.enum(['PUBLISHED', 'DRAFT', 'HIDDEN']).optional(),
      isPublished: z.boolean().optional(),
      allowSpeedChange: z.boolean().optional().default(true),
      pdfDriveUrl: z.string().trim().optional().nullable(),
      pdfTitle: z.string().trim().max(200).optional().nullable(),
      pdfDescription: z.string().trim().max(1000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message || 'بيانات الفيديو غير مكتملة' });
    }

    const d = parsed.data;
    const yt = extractYouTubeVideoId(d.youtubeUrl);
    if (!yt.valid || !yt.videoId) {
      return res.status(400).json({ error: yt.errorAr || 'رابط يوتيوب غير صالح' });
    }

    let resolvedPdfDriveUrl: string | null = null;
    let resolvedPdfDriveFileId: string | null = null;
    let resolvedPdfTitle: string | null = null;
    let resolvedPdfDescription: string | null = null;
    let resolvedPdfAttachedAt: Date | null = null;

    const rawPdfUrl = (d.pdfDriveUrl || '').trim();
    if (rawPdfUrl) {
      const drive = extractGoogleDriveFileId(rawPdfUrl);
      if (!drive.valid || !drive.fileId) {
        return res.status(400).json({ error: drive.errorAr || 'رابط ملف PDF على Google Drive غير صالح' });
      }
      resolvedPdfDriveUrl = drive.viewUrl || rawPdfUrl;
      resolvedPdfDriveFileId = drive.fileId;
      resolvedPdfTitle = (d.pdfTitle || '').trim() || d.titleAr;
      resolvedPdfDescription = (d.pdfDescription || '').trim() || null;
      resolvedPdfAttachedAt = new Date();
    }

    const [gradeRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود' });

    const [lessonRow] = await db.select().from(lessons).where(eq(lessons.id, d.lessonId)).limit(1);
    if (!lessonRow) return res.status(400).json({ error: 'الدرس المحدد غير موجود' });

    const resolvedTrackId = gradeRow.trackId;
    const resolvedUnitId = lessonRow.unitId;
    const resolvedCourseId = d.videoType === 'COURSE' && d.courseId ? d.courseId : d.courseId || null;

    if (resolvedCourseId) {
      const [courseRow] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, resolvedCourseId))
        .limit(1);
      if (!courseRow) return res.status(400).json({ error: 'الكورس المحدد غير موجود' });
    }

    const thumbValidation = validateVideoThumbnailUrl(d.thumbnailUrl);
    if (!thumbValidation.valid) {
      return res.status(400).json({ error: thumbValidation.errorAr || 'الصورة المصغرة غير صالحة' });
    }

    const publicationStatus: 'PUBLISHED' | 'DRAFT' | 'HIDDEN' =
      d.publicationStatus ?? (d.isPublished === false ? 'HIDDEN' : 'PUBLISHED');
    const isPublished = publicationStatus === 'PUBLISHED';

    const resolvedThumb =
      thumbValidation.normalized ||
      yt.thumbnailUrl ||
      '/src/assets/images/course_electricity_1795161648586.jpg';
    const resolvedPrice = d.videoType === 'FREE' ? 0 : d.priceEgp;

    const [created] = await db
      .insert(videos)
      .values({
        trackId: resolvedTrackId,
        gradeId: d.gradeId,
        unitId: resolvedUnitId,
        lessonId: d.lessonId,
        courseId: resolvedCourseId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        youtubeUrl: yt.canonicalUrl || d.youtubeUrl,
        youtubeVideoId: yt.videoId,
        durationSec: d.durationSec,
        thumbnailUrl: resolvedThumb,
        videoType: d.videoType,
        priceEgp: resolvedPrice,
        sortOrder: d.sortOrder,
        publicationStatus,
        isPublished,
        allowSpeedChange: d.allowSpeedChange,
        streamAssetKey: `protected/g${d.gradeId}/yt-${yt.videoId}-${generateOpaqueToken(4)}`,
        pdfDriveUrl: resolvedPdfDriveUrl,
        pdfDriveFileId: resolvedPdfDriveFileId,
        pdfTitle: resolvedPdfTitle,
        pdfDescription: resolvedPdfDescription,
        pdfAttachedAt: resolvedPdfAttachedAt,
        updatedAt: new Date(),
      })
      .returning();

    if (resolvedCourseId) {
      await db
        .insert(courseLessons)
        .values({
          courseId: resolvedCourseId,
          lessonId: d.lessonId,
          isFreePreview: false,
          sortOrder: d.sortOrder || 10,
        })
        .onConflictDoNothing();
    }

    if (isPublished) {
      await createNotification({
        gradeId: d.gradeId,
        titleAr: 'تم نشر محاضرة فيديو جديدة',
        bodyAr: `تمت إضافة المحاضرة: ${d.titleAr}`,
        type: 'NEW_VIDEO',
      });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'VIDEO_CREATED',
      entityType: 'video',
      entityId: created.id,
      details: {
        titleAr: d.titleAr,
        videoType: d.videoType,
        youtubeVideoId: yt.videoId,
        publicationStatus,
      },
    });

    invalidateAllContentCaches();
    return res.status(201).json({ video: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إضافة الفيديو' });
  }
});

adminRouter.patch('/videos/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });

    const [existing] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الفيديو غير موجود' });

    const schema = z.object({
      trackId: z.coerce.number().int().positive().optional().nullable(),
      gradeId: z.coerce.number().int().positive().optional(),
      unitId: z.coerce.number().int().positive().optional().nullable(),
      lessonId: z.coerce.number().int().positive().optional(),
      courseId: z.coerce.number().int().positive().optional().nullable(),
      titleAr: z.string().trim().min(2).optional(),
      descriptionAr: z.string().trim().optional(),
      youtubeUrl: z.string().trim().optional(),
      thumbnailUrl: z.string().trim().optional(),
      videoType: z.enum(['FREE', 'PAID', 'COURSE']).optional(),
      priceEgp: z.coerce.number().int().min(0).optional(),
      durationSec: z.coerce.number().int().min(0).optional(),
      sortOrder: z.coerce.number().int().min(0).optional(),
      publicationStatus: z.enum(['PUBLISHED', 'DRAFT', 'HIDDEN']).optional(),
      isPublished: z.boolean().optional(),
      allowSpeedChange: z.boolean().optional(),
      pdfDriveUrl: z.string().trim().optional().nullable(),
      pdfTitle: z.string().trim().max(200).optional().nullable(),
      pdfDescription: z.string().trim().max(1000).optional().nullable(),
      removePdf: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل الفيديو غير صالحة' });
    }

    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (d.titleAr !== undefined) updates.titleAr = d.titleAr;
    if (d.descriptionAr !== undefined) updates.descriptionAr = d.descriptionAr;
    if (d.durationSec !== undefined) updates.durationSec = d.durationSec;
    if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;
    if (d.allowSpeedChange !== undefined) updates.allowSpeedChange = d.allowSpeedChange;

    if (d.gradeId !== undefined) {
      const [gRow] = await db.select().from(grades).where(eq(grades.id, d.gradeId)).limit(1);
      if (!gRow) return res.status(400).json({ error: 'الصف الدراسي المحدد غير موجود' });
      updates.gradeId = gRow.id;
      updates.trackId = gRow.trackId;
    }

    if (d.lessonId !== undefined) {
      const [lRow] = await db.select().from(lessons).where(eq(lessons.id, d.lessonId)).limit(1);
      if (!lRow) return res.status(400).json({ error: 'الدرس المحدد غير موجود' });
      updates.lessonId = lRow.id;
      updates.unitId = lRow.unitId;
    }

    if (d.videoType !== undefined) {
      updates.videoType = d.videoType;
      if (d.videoType === 'FREE') {
        updates.priceEgp = 0;
        if (d.courseId === undefined) updates.courseId = null;
      }
    }
    if (d.priceEgp !== undefined && (d.videoType ?? existing.videoType) !== 'FREE') {
      updates.priceEgp = d.priceEgp;
    }

    if (d.courseId !== undefined) {
      updates.courseId = d.courseId;
      if (d.courseId) {
        const targetLessonId = d.lessonId ?? existing.lessonId;
        await db
          .insert(courseLessons)
          .values({
            courseId: d.courseId,
            lessonId: targetLessonId,
            isFreePreview: false,
            sortOrder: d.sortOrder ?? existing.sortOrder ?? 10,
          })
          .onConflictDoNothing();
      }
    }

    if (d.youtubeUrl !== undefined && d.youtubeUrl !== '') {
      const yt = extractYouTubeVideoId(d.youtubeUrl);
      if (!yt.valid || !yt.videoId) {
        return res.status(400).json({ error: yt.errorAr || 'رابط يوتيوب غير صالح' });
      }
      updates.youtubeUrl = yt.canonicalUrl || d.youtubeUrl;
      updates.youtubeVideoId = yt.videoId;
      if (!d.thumbnailUrl) {
        // Refresh thumbnail automatically when replacing YouTube link unless custom override provided
        const wasYouTubeThumb =
          !existing.thumbnailUrl || existing.thumbnailUrl.includes('ytimg.com');
        if (wasYouTubeThumb) {
          updates.thumbnailUrl = yt.thumbnailUrl;
        }
      }
    }

    if (d.thumbnailUrl !== undefined) {
      const thumbValidation = validateVideoThumbnailUrl(d.thumbnailUrl);
      if (!thumbValidation.valid) {
        return res.status(400).json({ error: thumbValidation.errorAr || 'الصورة المصغرة غير صالحة' });
      }
      if (thumbValidation.normalized !== '') {
        updates.thumbnailUrl = thumbValidation.normalized;
      } else if (existing.youtubeVideoId) {
        updates.thumbnailUrl = `https://i.ytimg.com/vi/${existing.youtubeVideoId}/hqdefault.jpg`;
      }
    }

    if (d.publicationStatus !== undefined) {
      updates.publicationStatus = d.publicationStatus;
      updates.isPublished = d.publicationStatus === 'PUBLISHED';
    } else if (d.isPublished !== undefined) {
      updates.isPublished = d.isPublished;
      updates.publicationStatus = d.isPublished ? 'PUBLISHED' : 'HIDDEN';
    }

    // Optional Google Drive PDF attachment management (never affects video playback or deletes video)
    if (d.removePdf === true) {
      updates.pdfDriveUrl = null;
      updates.pdfDriveFileId = null;
      updates.pdfTitle = null;
      updates.pdfDescription = null;
      updates.pdfAttachedAt = null;
    } else if (d.pdfDriveUrl !== undefined) {
      const rawPdfUrl = (d.pdfDriveUrl || '').trim();
      if (!rawPdfUrl) {
        updates.pdfDriveUrl = null;
        updates.pdfDriveFileId = null;
        updates.pdfTitle = null;
        updates.pdfDescription = null;
        updates.pdfAttachedAt = null;
      } else {
        const drive = extractGoogleDriveFileId(rawPdfUrl);
        if (!drive.valid || !drive.fileId) {
          return res.status(400).json({ error: drive.errorAr || 'رابط ملف PDF على Google Drive غير صالح' });
        }
        updates.pdfDriveUrl = drive.viewUrl || rawPdfUrl;
        updates.pdfDriveFileId = drive.fileId;
        if (d.pdfTitle !== undefined) {
          updates.pdfTitle = (d.pdfTitle || '').trim() || d.titleAr || existing.titleAr;
        } else if (!existing.pdfTitle) {
          updates.pdfTitle = d.titleAr || existing.titleAr;
        }
        if (d.pdfDescription !== undefined) {
          updates.pdfDescription = (d.pdfDescription || '').trim() || null;
        }
        updates.pdfAttachedAt =
          existing.pdfDriveFileId === drive.fileId && existing.pdfAttachedAt
            ? existing.pdfAttachedAt
            : new Date();
      }
    } else {
      if (d.pdfTitle !== undefined && existing.pdfDriveFileId) {
        updates.pdfTitle = (d.pdfTitle || '').trim() || existing.titleAr;
      }
      if (d.pdfDescription !== undefined && existing.pdfDriveFileId) {
        updates.pdfDescription = (d.pdfDescription || '').trim() || null;
      }
    }

    const [updated] = await db.update(videos).set(updates).where(eq(videos.id, id)).returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'VIDEO_UPDATED',
      entityType: 'video',
      entityId: id,
      details: {
        titleAr: updated.titleAr,
        videoType: updated.videoType,
        publicationStatus: updated.publicationStatus,
        youtubeVideoId: updated.youtubeVideoId,
      },
    });

    invalidateAllContentCaches();
    return res.json({ video: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر تعديل الفيديو' });
  }
});

adminRouter.post('/videos/reorder', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      orderedIds: z.array(z.coerce.number().int().positive()).min(1),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'قائمة ترتيب الفيديوهات غير صالحة' });
    }

    const { orderedIds } = parsed.data;
    await db.transaction(async (tx) => {
      for (let idx = 0; idx < orderedIds.length; idx++) {
        await tx
          .update(videos)
          .set({ sortOrder: idx + 1, updatedAt: new Date() })
          .where(eq(videos.id, orderedIds[idx]));
      }
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'VIDEOS_REORDERED',
      entityType: 'video',
      entityId: orderedIds.join(','),
      details: { count: orderedIds.length },
    });

    invalidateAllContentCaches();
    return res.json({ success: true });
  } catch (error) {
    console.error('Video reorder failed:', error);
    return res.status(500).json({ error: 'تعذر حفظ الترتيب الجديد للفيديوهات' });
  }
});

adminRouter.delete('/videos/:id', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });

    const [existing] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الفيديو غير موجود' });

    // Safe deletion: detach optional references without touching student accounts, exams, orders, or course purchases
    await db.transaction(async (tx) => {
      await tx.update(exams).set({ requiredVideoId: null }).where(eq(exams.requiredVideoId, id));
      await tx
        .update(deviceSessions)
        .set({ activeVideoId: null })
        .where(eq(deviceSessions.activeVideoId, id));
      await tx.delete(videos).where(eq(videos.id, id));
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'VIDEO_DELETED',
      entityType: 'video',
      entityId: id,
      details: { titleAr: existing.titleAr },
    });
    invalidateAllContentCaches();
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر حذف الفيديو' });
  }
});

// Per-Video Viewers & Watch-Time Analytics (Student Names, Actual Watched Minutes, Completion %)
adminRouter.get(
  '/videos/:id/viewers',
  requirePermission([PERMISSIONS.CONTENT_VIEW, PERMISSIONS.CONTENT_MANAGE, PERMISSIONS.REPORTS_VIEW]),
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!Number.isInteger(videoId) || videoId <= 0) {
        return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
      }

      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) {
        return res.status(404).json({ error: 'الفيديو غير موجود' });
      }

      const [progRows, openCounterRows] = await Promise.all([
        db
          .select({
            userId: progressRecords.userId,
            watchedSec: progressRecords.watchedSec,
            lastPositionSec: progressRecords.lastPositionSec,
            completionPercent: progressRecords.completionPercent,
            isCompleted: progressRecords.isCompleted,
            updatedAt: progressRecords.updatedAt,
            fullName: users.fullName,
            phone: users.phone,
            gradeNameAr: grades.nameAr,
          })
          .from(progressRecords)
          .innerJoin(users, eq(progressRecords.userId, users.id))
          .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
          .leftJoin(grades, eq(studentProfiles.primaryGradeId, grades.id))
          .where(eq(progressRecords.videoId, videoId))
          .orderBy(desc(progressRecords.updatedAt)),
        db
          .select({
            userId: videoAccessCounters.userId,
            countedOpens: videoAccessCounters.countedOpens,
          })
          .from(videoAccessCounters)
          .where(eq(videoAccessCounters.videoId, videoId)),
      ]);

      const opensByUser = new Map(openCounterRows.map((c) => [c.userId, Number(c.countedOpens || 0)]));

      const analytics = buildVideoViewersAnalytics(
        {
          id: videoRow.id,
          titleAr: videoRow.titleAr,
          durationSec: videoRow.durationSec,
          viewsCount: videoRow.viewsCount,
        },
        progRows.map((r) => ({
          userId: r.userId,
          fullName: r.fullName,
          phone: r.phone,
          gradeNameAr: r.gradeNameAr,
          watchedSec: r.watchedSec,
          lastPositionSec: r.lastPositionSec,
          completionPercent: r.completionPercent,
          isCompleted: r.isCompleted,
          countedOpens: opensByUser.get(r.userId) || 0,
          updatedAt: r.updatedAt,
        })),
      );

      return res.json(analytics);
    } catch (error) {
      console.error('Load video viewers failed:', error);
      return res.status(500).json({ error: 'تعذر تحميل قائمة مشاهدي الفيديو' });
    }
  },
);

// Per-Video Subscriptions, Entitlements & Activation Codes Hub
adminRouter.get(
  '/videos/:id/access',
  requirePermission([
    PERMISSIONS.CONTENT_VIEW,
    PERMISSIONS.CONTENT_MANAGE,
    PERMISSIONS.CODES_VIEW,
    PERMISSIONS.CODES_MANAGE,
    PERMISSIONS.STUDENT_ACCESS_GRANT,
  ]),
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!Number.isInteger(videoId) || videoId <= 0) {
        return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
      }

      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) {
        return res.status(404).json({ error: 'الفيديو غير موجود' });
      }

      const canViewCodes = hasAnyPermission(req.authUser, [
        PERMISSIONS.CODES_VIEW,
        PERMISSIONS.CODES_MANAGE,
      ]);
      const canManageAccess = hasAnyPermission(req.authUser, [
        PERMISSIONS.STUDENT_ACCESS_GRANT,
        PERMISSIONS.STUDENT_ACCESS_REVOKE,
        PERMISSIONS.STUDENTS_VIEW,
      ]);

      const [entRows, codeRows, studentRows] = await Promise.all([
        canManageAccess
          ? db
              .select({
                id: entitlements.id,
                userId: entitlements.userId,
                source: entitlements.source,
                startsAt: entitlements.startsAt,
                expiresAt: entitlements.expiresAt,
                isRevoked: entitlements.isRevoked,
                revokedAt: entitlements.revokedAt,
                note: entitlements.note,
                createdAt: entitlements.createdAt,
                studentName: users.fullName,
                studentPhone: users.phone,
                gradeNameAr: grades.nameAr,
              })
              .from(entitlements)
              .innerJoin(users, eq(entitlements.userId, users.id))
              .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
              .leftJoin(grades, eq(studentProfiles.primaryGradeId, grades.id))
              .where(and(eq(entitlements.targetType, 'VIDEO'), eq(entitlements.targetId, videoId)))
              .orderBy(desc(entitlements.createdAt))
              .limit(200)
          : Promise.resolve([]),
        canViewCodes
          ? db
              .select()
              .from(accessCodes)
              .where(and(eq(accessCodes.targetType, 'VIDEO'), eq(accessCodes.targetId, videoId)))
              .orderBy(desc(accessCodes.createdAt))
              .limit(150)
          : Promise.resolve([]),
        canManageAccess
          ? db
              .select({
                id: users.id,
                fullName: users.fullName,
                phone: users.phone,
                status: users.status,
                gradeId: studentProfiles.primaryGradeId,
                gradeNameAr: grades.nameAr,
              })
              .from(users)
              .innerJoin(roles, eq(users.roleId, roles.id))
              .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
              .leftJoin(grades, eq(studentProfiles.primaryGradeId, grades.id))
              .where(and(eq(roles.slug, 'STUDENT'), eq(users.status, 'ACTIVE')))
              .orderBy(asc(users.fullName))
              .limit(500)
          : Promise.resolve([]),
      ]);

      const nowMs = Date.now();
      return res.json({
        video: {
          id: videoRow.id,
          titleAr: videoRow.titleAr,
          gradeId: videoRow.gradeId,
          courseId: videoRow.courseId,
          videoType: videoRow.videoType,
          priceEgp: videoRow.priceEgp,
          publicationStatus: videoRow.publicationStatus,
          isPublished: videoRow.isPublished,
        },
        entitlements: entRows.map((e) => {
          const isExpired = Boolean(e.expiresAt && new Date(e.expiresAt).getTime() <= nowMs);
          return {
            ...e,
            gradeNameAr: e.gradeNameAr || 'غير محدد',
            isActive: !e.isRevoked && !isExpired,
            isExpired,
          };
        }),
        codes: codeRows.map((c) => ({
          id: c.id,
          codePrefix: c.codePrefix,
          durationDays: c.durationDays,
          maxUses: c.maxUses,
          usedCount: c.usedCount,
          status: c.status,
          batchLabel: c.batchLabel || '',
          expiresAt: c.expiresAt,
          createdAt: c.createdAt,
          canDelete: c.usedCount === 0,
        })),
        students: studentRows.map((s) => ({
          id: s.id,
          fullName: s.fullName,
          phone: s.phone,
          gradeId: s.gradeId,
          gradeNameAr: s.gradeNameAr || 'غير محدد',
        })),
      });
    } catch (error) {
      console.error('Load video access hub failed:', error);
      return res.status(500).json({ error: 'تعذر تحميل بيانات اشتراكات وأكواد الفيديو' });
    }
  },
);

// Grant / Open Subscription to a Specific Video for a Student
adminRouter.post(
  '/videos/:id/grant-student',
  requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT),
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!Number.isInteger(videoId) || videoId <= 0) {
        return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
      }

      const schema = z.object({
        userId: z.coerce.number().int().positive(),
        durationDays: z.coerce.number().int().min(0).max(3650).optional().default(30),
        note: z.string().trim().max(240).optional().default(''),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'بيانات فتح اشتراك الطالب غير صالحة' });
      }

      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) {
        return res.status(404).json({ error: 'الفيديو غير موجود' });
      }

      const target = await resolveStrictStudentTarget(parsed.data.userId);
      if (!target.ok) {
        return res.status(target.statusCode).json({ error: target.errorAr });
      }

      const existing = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, parsed.data.userId),
            eq(entitlements.targetType, 'VIDEO'),
            eq(entitlements.targetId, videoId),
            eq(entitlements.isRevoked, false),
          ),
        );

      const now = Date.now();
      const activeExisting = existing.find(
        (e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now,
      );
      if (activeExisting) {
        return res.json({
          success: true,
          alreadyActive: true,
          message: 'الطالب يملك بالفعل اشتراكًا نشطًا لهذا الفيديو.',
        });
      }

      const expiresAt =
        parsed.data.durationDays > 0
          ? new Date(now + parsed.data.durationDays * 86400_000)
          : null;

      const [created] = await db
        .insert(entitlements)
        .values({
          userId: parsed.data.userId,
          targetType: 'VIDEO',
          targetId: videoId,
          source: 'MANUAL_GRANT',
          priority: getSourcePriority('MANUAL_GRANT'),
          expiresAt,
          grantedById: req.authUser!.id,
          note: parsed.data.note || `فتح اشتراك مباشر للفيديو: ${videoRow.titleAr}`,
        })
        .returning();

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'VIDEO_SUBSCRIPTION_GRANTED',
        entityType: 'video',
        entityId: videoId,
        details: {
          studentUserId: parsed.data.userId,
          videoTitle: videoRow.titleAr,
          durationDays: parsed.data.durationDays,
          entitlementId: created.id,
        },
      });

      return res.status(201).json({
        success: true,
        entitlement: created,
        message: 'تم فتح اشتراك الفيديو للطالب بنجاح.',
      });
    } catch (error) {
      console.error('Grant video subscription failed:', error);
      return res.status(500).json({ error: 'تعذر فتح اشتراك الفيديو للطالب' });
    }
  },
);

// Revoke / Close a Student's Subscription to a Specific Video
adminRouter.post(
  '/videos/:id/revoke-student',
  requirePermission(PERMISSIONS.STUDENT_ACCESS_REVOKE),
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!Number.isInteger(videoId) || videoId <= 0) {
        return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
      }

      const schema = z.object({
        entitlementId: z.coerce.number().int().positive(),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'معرّف الاشتراك غير صالح' });
      }

      const [existing] = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.id, parsed.data.entitlementId),
            eq(entitlements.targetType, 'VIDEO'),
            eq(entitlements.targetId, videoId),
          ),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'الاشتراك غير موجود لهذا الفيديو' });
      }

      await db
        .update(entitlements)
        .set({ isRevoked: true, revokedAt: new Date() })
        .where(eq(entitlements.id, existing.id));

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'VIDEO_SUBSCRIPTION_REVOKED',
        entityType: 'video',
        entityId: videoId,
        details: {
          entitlementId: existing.id,
          studentUserId: existing.userId,
        },
      });

      return res.json({
        success: true,
        message: 'تم قفل/سحب اشتراك الطالب عن هذا الفيديو بنجاح.',
      });
    } catch (error) {
      console.error('Revoke video subscription failed:', error);
      return res.status(500).json({ error: 'تعذر قفل اشتراك الطالب' });
    }
  },
);

// Courses & Coupons CRUD
adminRouter.post('/courses', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      gradeId: z.coerce.number().int().positive(),
      titleAr: z.string().trim().min(3),
      descriptionAr: z.string().trim().optional().default(''),
      originalPriceEgp: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(0)),
      discountPriceEgp: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(0)).default(0),
      validityDays: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1)).default(120),
      lessonIds: z.array(z.coerce.number().int().positive()).optional().default([]),
      thumbnailUrl: z.string().optional().default('/src/assets/images/course_mechanics_1795161650057.jpg'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات الكورس غير مكتملة' });

    const d = parsed.data;
    const [created] = await db
      .insert(courses)
      .values({
        gradeId: d.gradeId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        originalPriceEgp: d.originalPriceEgp,
        discountPriceEgp: d.discountPriceEgp || d.originalPriceEgp,
        validityDays: d.validityDays,
        thumbnailUrl: d.thumbnailUrl,
      })
      .returning();

    for (let i = 0; i < d.lessonIds.length; i++) {
      await db
        .insert(courseLessons)
        .values({ courseId: created.id, lessonId: d.lessonIds[i], isFreePreview: i === 0, sortOrder: i + 1 })
        .onConflictDoNothing();
    }

    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'COURSE_CREATED', entityType: 'course', entityId: created.id });
    return res.status(201).json({ course: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إنشاء الكورس' });
  }
});

adminRouter.post('/coupons', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const { code, discountPercent, maxUses } = req.body || {};
    const parsedDiscount = parseLocalizedInt(discountPercent);
    const parsedMaxUses = parseLocalizedInt(maxUses) ?? 100;
    if (!code || !parsedDiscount || parsedDiscount < 1) {
      return res.status(400).json({ error: 'رمز الكوبون ونسبة الخصم مطلوبان' });
    }
    const [created] = await db
      .insert(coupons)
      .values({
        code: String(code).trim().toUpperCase(),
        discountPercent: Math.min(90, Math.max(1, parsedDiscount)),
        maxUses: Math.max(1, parsedMaxUses),
      })
      .returning();
    return res.status(201).json({ coupon: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إنشاء الكوبون (ربما الرمز مستخدم بالفعل)' });
  }
});

// 4. Activation Codes Batch Generator & Management (Separated: PLATFORM vs CONTENT)
adminRouter.get('/codes', requirePermission([PERMISSIONS.CODES_VIEW, PERMISSIONS.CODES_MANAGE]), async (req, res) => {
  try {
    const categoryFilter = String(req.query.category || '').toUpperCase();
    const [rows, allCourses, allVideos, allGrades] = await Promise.all([
      db
        .select({
          code: accessCodes,
          gradeNameAr: grades.nameAr,
        })
        .from(accessCodes)
        .leftJoin(grades, eq(accessCodes.gradeId, grades.id))
        .orderBy(desc(accessCodes.createdAt))
        .limit(300),
      db.select({ id: courses.id, titleAr: courses.titleAr }).from(courses),
      db.select({ id: videos.id, titleAr: videos.titleAr }).from(videos),
      db.select({ id: grades.id, nameAr: grades.nameAr }).from(grades),
    ]);

    const courseMap = new Map(allCourses.map((c) => [c.id, c.titleAr]));
    const videoMap = new Map(allVideos.map((v) => [v.id, v.titleAr]));
    const gradeMap = new Map(allGrades.map((g) => [g.id, g.nameAr]));

    const filtered = rows.filter((r) => {
      const cat =
        r.code.codeCategory === 'PLATFORM' || r.code.targetType === 'PLATFORM_ACCESS'
          ? 'PLATFORM'
          : 'CONTENT';
      if (categoryFilter === 'PLATFORM') return cat === 'PLATFORM';
      if (categoryFilter === 'CONTENT') return cat === 'CONTENT';
      return true;
    });

    return res.json({
      codes: filtered.map((r) => {
        const cat =
          r.code.codeCategory === 'PLATFORM' || r.code.targetType === 'PLATFORM_ACCESS'
            ? 'PLATFORM'
            : 'CONTENT';
        const targetTitleAr =
          cat === 'PLATFORM'
            ? 'اشتراك دخول المنصة فقط'
            : r.code.targetType === 'COURSE'
              ? courseMap.get(r.code.targetId) || `كورس #${r.code.targetId}`
              : r.code.targetType === 'VIDEO'
                ? videoMap.get(r.code.targetId) || `فيديو #${r.code.targetId}`
                : gradeMap.get(r.code.targetId) || `صف دراسي #${r.code.targetId}`;
        return {
          ...r.code,
          codeCategory: cat,
          codeHash: undefined, // never expose hash
          gradeNameAr: r.gradeNameAr || 'جميع الصفوف',
          targetTitleAr,
          canDelete: r.code.usedCount === 0,
        };
      }),
    });
  } catch (error) {
    console.error('List codes failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل أكواد التفعيل' });
  }
});

adminRouter.post('/codes/generate', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      codeCategory: z.enum(['CONTENT', 'PLATFORM']).optional().default('CONTENT'),
      quantity: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(1000)),
      targetType: z.enum(['VIDEO', 'COURSE', 'GRADE_ALL', 'PLATFORM_ACCESS']).optional(),
      targetId: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(0)).optional().default(0),
      gradeId: z.coerce.number().int().positive().nullable().optional(),
      durationDays: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(730)).default(30),
      maxUses: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(100)).default(1),
      expiresInDays: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(1).max(730)).optional(),
      boundUserId: z.coerce.number().int().positive().nullable().optional(),
      batchLabel: z.string().trim().optional().default('دفعة أكواد'),
      prefix: z.string().trim().max(6).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'إعدادات توليد الأكواد غير صالحة' });

    const d = parsed.data;
    const isPlatform = d.codeCategory === 'PLATFORM' || d.targetType === 'PLATFORM_ACCESS';
    const effectiveCategory: 'PLATFORM' | 'CONTENT' = isPlatform ? 'PLATFORM' : 'CONTENT';
    const effectiveTargetType = isPlatform ? 'PLATFORM_ACCESS' : d.targetType || 'COURSE';
    const effectiveTargetId = isPlatform ? 0 : d.targetId;

    if (!isPlatform && effectiveTargetId <= 0) {
      return res.status(400).json({ error: 'يرجى تحديد الكورس أو الفيديو أو الصف المستهدف للكود' });
    }

    const effectivePrefix = (d.prefix || (isPlatform ? 'PLT' : 'PHY')).toUpperCase();
    const expiresAt = d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86400_000) : null;
    const generatedPlaintext: string[] = [];
    const rowsToInsert = [];

    for (let i = 0; i < d.quantity; i++) {
      const plain = generateActivationCode(effectivePrefix);
      generatedPlaintext.push(plain);
      rowsToInsert.push({
        codeHash: hashActivationCode(plain),
        codePrefix: maskActivationCode(plain),
        codeCategory: effectiveCategory,
        targetType: effectiveTargetType,
        targetId: effectiveTargetId,
        gradeId: d.gradeId ?? null,
        durationDays: d.durationDays,
        maxUses: d.maxUses,
        expiresAt,
        boundUserId: d.boundUserId ?? null,
        status: 'AVAILABLE',
        batchLabel: d.batchLabel || (isPlatform ? `اشتراك منصة (${d.durationDays} يوم)` : 'دفعة أكواد'),
        createdById: req.authUser!.id,
      });
    }

    await db.insert(accessCodes).values(rowsToInsert);

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: isPlatform ? 'PLATFORM_CODES_GENERATED' : 'ACTIVATION_CODES_GENERATED',
      entityType: 'access_codes',
      details: {
        codeCategory: effectiveCategory,
        quantity: d.quantity,
        targetType: effectiveTargetType,
        targetId: effectiveTargetId,
        durationDays: d.durationDays,
        batchLabel: d.batchLabel,
      },
    });

    // Plaintext codes are returned ONCE ONLY here for immediate download/CSV/printing!
    invalidateAllContentCaches();
    return res.status(201).json({
      codeCategory: effectiveCategory,
      quantity: generatedPlaintext.length,
      batchLabel: d.batchLabel,
      plaintextCodesOnce: generatedPlaintext,
      securityNotice:
        'تنبيه أمني: لا يتم تخزين الأكواد كنص مكشوف في قاعدة البيانات. قم بتصديرها أو طباعتها الآن لأنها لن تظهر كاملة مرة أخرى.',
    });
  } catch (error) {
    console.error('Generate codes failed:', error);
    return res.status(500).json({ error: 'تعذر توليد دفعة الأكواد' });
  }
});

// Activation Code Full Details + Redemption History
adminRouter.get('/codes/:id', requirePermission([PERMISSIONS.CODES_VIEW, PERMISSIONS.CODES_MANAGE]), async (req, res) => {
  try {
    const codeId = Number(req.params.id);
    if (!Number.isInteger(codeId) || codeId <= 0) {
      return res.status(400).json({ error: 'معرّف الكود غير صالح' });
    }

    const [row] = await db
      .select({ code: accessCodes, gradeNameAr: grades.nameAr })
      .from(accessCodes)
      .leftJoin(grades, eq(accessCodes.gradeId, grades.id))
      .where(eq(accessCodes.id, codeId))
      .limit(1);

    if (!row) return res.status(404).json({ error: 'الكود غير موجود' });

    const redemptions = await db
      .select({
        id: codeRedemptions.id,
        userId: codeRedemptions.userId,
        redeemedAt: codeRedemptions.redeemedAt,
        entitlementId: codeRedemptions.entitlementId,
        studentName: users.fullName,
        studentPhone: users.phone,
      })
      .from(codeRedemptions)
      .innerJoin(users, eq(codeRedemptions.userId, users.id))
      .where(eq(codeRedemptions.codeId, codeId))
      .orderBy(desc(codeRedemptions.redeemedAt));

    return res.json({
      code: {
        ...row.code,
        codeHash: undefined,
        gradeNameAr: row.gradeNameAr || 'جميع الصفوف',
        canDelete: row.code.usedCount === 0 && redemptions.length === 0,
      },
      redemptions,
    });
  } catch (error) {
    console.error('Fetch code details failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الكود' });
  }
});

// Cancel Unused Activation Code
adminRouter.post('/codes/:id/cancel', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const codeId = Number(req.params.id);
    const [existing] = await db.select().from(accessCodes).where(eq(accessCodes.id, codeId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الكود غير موجود' });
    if (existing.usedCount > 0) {
      return res.status(409).json({ error: 'لا يمكن إلغاء كود تم استخدامه بالفعل. استخدم خيار الإيقاف/الإلغاء الإداري.' });
    }

    const note = String(req.body?.note || '').trim().slice(0, 240);
    await db
      .update(accessCodes)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), statusNote: note || 'تم إلغاء الكود غير المستخدم' })
      .where(eq(accessCodes.id, codeId));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ACTIVATION_CODE_CANCELLED',
      entityType: 'access_code',
      entityId: codeId,
      details: { codePrefix: existing.codePrefix, note },
    });

    return res.json({ success: true, message: 'تم إلغاء الكود غير المستخدم بنجاح.' });
  } catch (error) {
    console.error('Cancel code failed:', error);
    return res.status(500).json({ error: 'تعذر إلغاء الكود' });
  }
});

// Temporarily Disable Activation Code Until Chosen Date
adminRouter.post('/codes/:id/disable', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const codeId = Number(req.params.id);
    const [existing] = await db.select().from(accessCodes).where(eq(accessCodes.id, codeId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الكود غير موجود' });
    if (existing.status === 'REVOKED' || existing.status === 'CANCELLED') {
      return res.status(400).json({ error: 'لا يمكن تعطيل كود ملغى.' });
    }

    const rawUntil = String(req.body?.disabledUntil || '').trim();
    const untilDate = rawUntil ? new Date(rawUntil) : null;
    if (!untilDate || Number.isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'يرجى تحديد تاريخ ووقت مستقبلي صحيح لنهاية التعطيل المؤقت.' });
    }
    const note = String(req.body?.note || '').trim().slice(0, 240);

    await db
      .update(accessCodes)
      .set({
        status: 'DISABLED',
        disabledUntil: untilDate,
        statusNote: note || `معطّل مؤقتًا حتى ${untilDate.toLocaleDateString('ar-EG')}`,
      })
      .where(eq(accessCodes.id, codeId));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ACTIVATION_CODE_DISABLED_TEMPORARILY',
      entityType: 'access_code',
      entityId: codeId,
      details: { codePrefix: existing.codePrefix, disabledUntil: untilDate.toISOString(), note },
    });

    return res.json({
      success: true,
      disabledUntil: untilDate.toISOString(),
      message: `تم تعطيل الكود مؤقتًا حتى ${untilDate.toLocaleDateString('ar-EG')} بنجاح.`,
    });
  } catch (error) {
    console.error('Disable code failed:', error);
    return res.status(500).json({ error: 'تعذر تعطيل الكود مؤقتًا' });
  }
});

// Reactivate Temporarily Disabled Activation Code
adminRouter.post('/codes/:id/reactivate', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const codeId = Number(req.params.id);
    const [existing] = await db.select().from(accessCodes).where(eq(accessCodes.id, codeId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الكود غير موجود' });
    if (existing.status !== 'DISABLED') {
      return res.status(400).json({ error: 'هذا الكود ليس في حالة تعطيل مؤقت.' });
    }

    const nextStatus = existing.usedCount >= existing.maxUses ? 'REDEEMED' : 'AVAILABLE';
    await db
      .update(accessCodes)
      .set({ status: nextStatus, disabledUntil: null, statusNote: 'تمت إعادة تفعيل الكود يدويًا' })
      .where(eq(accessCodes.id, codeId));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ACTIVATION_CODE_REACTIVATED',
      entityType: 'access_code',
      entityId: codeId,
      details: { codePrefix: existing.codePrefix, nextStatus },
    });

    return res.json({ success: true, status: nextStatus, message: 'تمت إعادة تفعيل الكود بنجاح.' });
  } catch (error) {
    console.error('Reactivate code failed:', error);
    return res.status(500).json({ error: 'تعذر إعادة تفعيل الكود' });
  }
});

// Delete Unused Activation Code ONLY (STRICTLY blocked if usedCount > 0 or redemptions exist)
adminRouter.delete('/codes/:id', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const codeId = Number(req.params.id);
    if (!Number.isInteger(codeId) || codeId <= 0) {
      return res.status(400).json({ error: 'معرّف الكود غير صالح' });
    }

    const txOut = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(accessCodes).where(eq(accessCodes.id, codeId)).limit(1);
      if (!existing) return { status: 404 as const, error: 'الكود غير موجود' };

      const redemptions = await tx
        .select({ id: codeRedemptions.id })
        .from(codeRedemptions)
        .where(eq(codeRedemptions.codeId, codeId))
        .limit(1);

      const check = canDeleteActivationCode({
        usedCount: existing.usedCount,
        redemptionsCount: redemptions.length,
      });
      if (!check.allowed) {
        return { status: 409 as const, error: check.errorAr };
      }

      const deleted = await tx
        .delete(accessCodes)
        .where(and(eq(accessCodes.id, codeId), eq(accessCodes.usedCount, 0)))
        .returning({ id: accessCodes.id });
      if (!deleted.length) {
        return { status: 409 as const, error: 'تم استخدام الكود للتو ولا يمكن حذفه.' };
      }

      return { status: 200 as const, existing };
    });

    if (txOut.status !== 200) {
      return res.status(txOut.status).json({ error: txOut.error });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ACTIVATION_CODE_DELETED',
      entityType: 'access_code',
      entityId: codeId,
      details: { codePrefix: txOut.existing.codePrefix, codeCategory: txOut.existing.codeCategory },
    });

    return res.json({ success: true, message: 'تم حذف الكود غير المستخدم نهائيًا.' });
  } catch (error) {
    console.error('Delete code failed:', error);
    return res.status(500).json({ error: 'تعذر حذف الكود' });
  }
});

// List Platform Subscriptions (Student, Activation Date, Expiry, Remaining Duration, Status, Scope)
adminRouter.get(
  '/platform-subscriptions',
  requirePermission([PERMISSIONS.CODES_VIEW, PERMISSIONS.CODES_MANAGE, PERMISSIONS.STUDENTS_VIEW]),
  async (_req, res) => {
    try {
      const rows = await db
        .select({
          sub: platformSubscriptions,
          studentName: users.fullName,
          studentPhone: users.phone,
          codePrefix: accessCodes.codePrefix,
        })
        .from(platformSubscriptions)
        .innerJoin(users, eq(platformSubscriptions.userId, users.id))
        .leftJoin(accessCodes, eq(platformSubscriptions.accessCodeId, accessCodes.id))
        .orderBy(desc(platformSubscriptions.createdAt))
        .limit(200);

      const now = new Date();
      return res.json({
        subscriptions: rows.map((r) => {
          const state = computePlatformSubscriptionState(r.sub, now);
          return {
            id: r.sub.id,
            userId: r.sub.userId,
            studentName: r.studentName,
            studentPhone: r.studentPhone || '—',
            codePrefix: r.codePrefix || '—',
            startsAt: r.sub.startsAt,
            expiresAt: r.sub.expiresAt,
            durationDays: r.sub.durationDays,
            status: state.effectiveStatus,
            isActive: state.isActive,
            remainingDays: state.remainingDays,
            accessScope: r.sub.accessScope,
            accessScopeAr: 'اشتراك دخول المنصة فقط (لا يفتح الكورسات أو الفيديوهات المدفوعة تلقائيًا)',
            note: r.sub.note || '',
          };
        }),
      });
    } catch (error) {
      console.error('List platform subscriptions failed:', error);
      return res.status(500).json({ error: 'تعذر تحميل اشتراكات المنصة' });
    }
  },
);

adminRouter.post('/codes/:id/revoke', requirePermission(PERMISSIONS.CODES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const codeId = Number(req.params.id);
    const revokeGrantedAccess = Boolean(req.body?.revokeGrantedAccess);

    await db.update(accessCodes).set({ status: 'REVOKED' }).where(eq(accessCodes.id, codeId));

    if (revokeGrantedAccess) {
      const redemptions = await db
        .select()
        .from(codeRedemptions)
        .where(eq(codeRedemptions.codeId, codeId));
      const entIds = redemptions.map((r) => r.entitlementId).filter((x): x is number => Boolean(x));
      if (entIds.length) {
        await db
          .update(entitlements)
          .set({ isRevoked: true, revokedAt: new Date() })
          .where(inArray(entitlements.id, entIds));
      }
      // Also revoke any platform subscriptions granted by this code
      await db
        .update(platformSubscriptions)
        .set({ status: 'REVOKED' })
        .where(eq(platformSubscriptions.accessCodeId, codeId));
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ACTIVATION_CODE_REVOKED',
      entityType: 'access_code',
      entityId: codeId,
      details: { revokeGrantedAccess },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Revoke code failed:', error);
    return res.status(500).json({ error: 'تعذر إلغاء الكود' });
  }
});

// 5. Orders & Payments Review
adminRouter.get('/orders', requirePermission([PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_VERIFY]), async (_req, res) => {
  try {
    const rows = await db
      .select({
        order: orders,
        payment: payments,
        studentName: users.fullName,
        studentPhone: users.phone,
      })
      .from(orders)
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .innerJoin(users, eq(orders.userId, users.id))
      .orderBy(desc(orders.createdAt));

    return res.json({
      orders: rows.map((r) => ({
        ...r.order,
        studentName: r.studentName,
        studentPhone: r.studentPhone,
        payment: r.payment || null,
      })),
    });
  } catch (error) {
    console.error('Orders list failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل الطلبات والمدفوعات' });
  }
});

adminRouter.post('/orders/:id/verify', requirePermission(PERMISSIONS.PAYMENTS_VERIFY), async (req: AuthRequest, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'معرّف الطلب غير صالح' });
    }
    const result = await fulfillOrderAndGrantAccess(orderId, req.authUser!.id, req.authUser!.fullName);
    if (result.alreadyProcessed) {
      return res.status(409).json({ error: 'تمت معالجة هذا الطلب مسبقًا ولا يمكن تأكيده مرة أخرى.' });
    }
    return res.json({ success: true, message: 'تم تأكيد الدفع وفتح المحتوى للطالب' });
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string };
    console.error('Verify order failed:', error);
    return res.status(err.statusCode || 500).json({ error: err.message || 'تعذر تأكيد الدفع' });
  }
});

adminRouter.post('/orders/:id/reject', requirePermission(PERMISSIONS.PAYMENTS_VERIFY), async (req: AuthRequest, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'معرّف الطلب غير صالح' });
    }
    const rejectResult = await db.transaction(async (tx) => {
      const [updatedOrder] = await tx
        .update(orders)
        .set({ status: 'FAILED' })
        .where(and(eq(orders.id, orderId), inArray(orders.status, ['PENDING', 'UNDER_REVIEW'])))
        .returning({ id: orders.id });
      if (!updatedOrder) {
        const [existing] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1);
        return existing ? { status: 409 as const, error: 'لا يمكن رفض طلب تمت معالجته أو تأكيده بالفعل.' } : { status: 404 as const, error: 'الطلب غير موجود' };
      }
      await tx.update(payments).set({ status: 'REJECTED' }).where(eq(payments.orderId, orderId));
      return { status: 200 as const };
    });

    if (rejectResult.status !== 200) {
      return res.status(rejectResult.status).json({ error: rejectResult.error });
    }

    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'ORDER_REJECTED', entityType: 'order', entityId: orderId });
    return res.json({ success: true });
  } catch (error) {
    console.error('Reject order failed:', error);
    return res.status(500).json({ error: 'تعذر رفض الطلب' });
  }
});

// 6. Question Bank, Exam Builder & Manual Essay Grading Queue
adminRouter.get(
  '/exams-suite',
  requirePermission([PERMISSIONS.EXAMS_VIEW, PERMISSIONS.EXAMS_MANAGE, PERMISSIONS.EXAMS_GRADE]),
  async (_req, res) => {
  try {
    const [examRows, questionRows, choiceRows, pendingAnswers] = await Promise.all([
      db.select().from(exams).orderBy(desc(exams.createdAt)),
      db.select().from(questions).orderBy(desc(questions.createdAt)),
      db.select().from(choices),
      db
        .select({
          answer: studentAnswers,
          questionPromptAr: questions.promptAr,
          questionPoints: questions.points,
          modelAnswerAr: questions.modelAnswerAr,
          attemptId: examAttempts.id,
          examId: examAttempts.examId,
          studentName: users.fullName,
          examTitleAr: exams.titleAr,
        })
        .from(studentAnswers)
        .innerJoin(questions, eq(studentAnswers.questionId, questions.id))
        .innerJoin(examAttempts, eq(studentAnswers.attemptId, examAttempts.id))
        .innerJoin(users, eq(examAttempts.userId, users.id))
        .innerJoin(exams, eq(examAttempts.examId, exams.id))
        .where(eq(studentAnswers.needsManualGrading, true))
        .orderBy(desc(studentAnswers.updatedAt)),
    ]);

    return res.json({
      exams: examRows,
      questions: questionRows.map((q) => ({
        ...q,
        choices: choiceRows.filter((c) => c.questionId === q.id),
      })),
      gradingQueue: pendingAnswers.map((p) => ({
        answerId: p.answer.id,
        attemptId: p.attemptId,
        examTitleAr: p.examTitleAr,
        studentName: p.studentName,
        questionPromptAr: p.questionPromptAr,
        maxPoints: p.questionPoints,
        modelAnswerAr: p.modelAnswerAr,
        textAnswer: p.answer.textAnswer,
        uploadedFileName: p.answer.uploadedFileName,
      })),
    });
  } catch (error) {
    console.error('Exams suite load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل نظام الامتحانات وبنك الأسئلة' });
  }
});

adminRouter.post('/questions', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      gradeId: z.coerce.number().int().positive(),
      unitId: z.coerce.number().int().positive().nullable().optional(),
      lessonId: z.coerce.number().int().positive().nullable().optional(),
      questionType: z.enum(['MCQ', 'TRUE_FALSE', 'NUMERIC', 'ESSAY', 'PHYSICS_PROBLEM', 'IMAGE_DIAGRAM', 'FILE_UPLOAD']),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
      promptAr: z.string().trim().min(5),
      latexFormula: z.string().trim().nullable().optional(),
      points: z.coerce.number().int().min(1).default(2),
      numericAnswer: z.string().nullable().optional(),
      numericTolerance: z.string().optional().default('0.05'),
      modelAnswerAr: z.string().optional().default(''),
      explanationAr: z.string().optional().default(''),
      choices: z
        .array(z.object({ labelAr: z.string().min(1), isCorrect: z.boolean() }))
        .optional()
        .default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات السؤال غير مكتملة' });

    const d = parsed.data;
    const [created] = await db
      .insert(questions)
      .values({
        gradeId: d.gradeId,
        unitId: d.unitId ?? null,
        lessonId: d.lessonId ?? null,
        questionType: d.questionType,
        difficulty: d.difficulty,
        promptAr: d.promptAr,
        latexFormula: d.latexFormula || null,
        points: d.points,
        numericAnswer: d.numericAnswer ? d.numericAnswer : null,
        numericTolerance: d.numericTolerance,
        modelAnswerAr: d.modelAnswerAr,
        explanationAr: d.explanationAr,
      })
      .returning();

    if (d.choices.length > 0) {
      await db.insert(choices).values(
        d.choices.map((c, idx) => ({
          questionId: created.id,
          labelAr: c.labelAr,
          isCorrect: c.isCorrect,
          sortOrder: idx + 1,
        })),
      );
    }

    return res.status(201).json({ question: created });
  } catch (error) {
    console.error('Create question failed:', error);
    return res.status(500).json({ error: 'تعذر إضافة السؤال لبنك الأسئلة' });
  }
});

adminRouter.post('/exams', requirePermission(PERMISSIONS.EXAMS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      gradeId: z.coerce.number().int().positive(),
      titleAr: z.string().trim().min(3),
      descriptionAr: z.string().optional().default(''),
      examType: z.enum(['LESSON_QUIZ', 'UNIT_EXAM', 'MONTHLY', 'COMPREHENSIVE', 'FINAL_SIMULATION', 'HOMEWORK']).default('LESSON_QUIZ'),
      durationMin: z.coerce.number().int().min(5).default(30),
      maxAttempts: z.coerce.number().int().min(1).default(2),
      passScorePercent: z.coerce.number().int().min(10).max(100).default(60),
      shuffleQuestions: z.boolean().default(false),
      shuffleChoices: z.boolean().default(false),
      showResultImmediately: z.boolean().default(true),
      showCorrectAnswers: z.boolean().default(true),
      requiredVideoId: z.coerce.number().int().positive().nullable().optional(),
      questionIds: z.array(z.coerce.number().int().positive()).min(1, 'اختر سؤالًا واحدًا على الأقل'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الامتحان غير صالحة' });

    const d = parsed.data;
    const [created] = await db
      .insert(exams)
      .values({
        gradeId: d.gradeId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        examType: d.examType,
        durationMin: d.durationMin,
        maxAttempts: d.maxAttempts,
        passScorePercent: d.passScorePercent,
        shuffleQuestions: d.shuffleQuestions,
        shuffleChoices: d.shuffleChoices,
        showResultImmediately: d.showResultImmediately,
        showCorrectAnswers: d.showCorrectAnswers,
        requiredVideoId: d.requiredVideoId ?? null,
        isPublished: true,
      })
      .returning();

    await db.insert(examQuestions).values(
      d.questionIds.map((qId, idx) => ({
        examId: created.id,
        questionId: qId,
        sortOrder: idx + 1,
      })),
    );

    await createNotification({
      gradeId: d.gradeId,
      titleAr: 'تم نشر امتحان جديد',
      bodyAr: `تمت إضافة الامتحان: ${d.titleAr} (المدة ${d.durationMin} دقيقة).`,
      type: 'NEW_EXAM',
    });

    await logAudit({ actorId: req.authUser!.id, actorName: req.authUser!.fullName, action: 'EXAM_CREATED', entityType: 'exam', entityId: created.id });
    return res.status(201).json({ exam: created });
  } catch (error) {
    console.error('Create exam failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء الامتحان' });
  }
});

// Manual Essay Grading
adminRouter.post('/answers/:id/grade', requirePermission(PERMISSIONS.EXAMS_GRADE), async (req: AuthRequest, res) => {
  try {
    const answerId = Number(req.params.id);
    if (!Number.isInteger(answerId) || answerId <= 0) {
      return res.status(400).json({ error: 'معرّف الإجابة غير صالح' });
    }
    const gradeSchema = z.object({
      awardedPoints: z.coerce.number().finite().min(0),
      graderFeedback: z.string().trim().max(2000).optional().default(''),
    });
    const parsed = gradeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'قيمة الدرجة غير صالحة' });
    }

    const gradeResult = await db.transaction(async (tx) => {
      const [existingRow] = await tx
        .select({ answer: studentAnswers, maxQuestionPoints: questions.points })
        .from(studentAnswers)
        .innerJoin(questions, eq(studentAnswers.questionId, questions.id))
        .where(eq(studentAnswers.id, answerId))
        .limit(1);

      if (!existingRow) return { notFound: true as const };

      const maxPts = Math.max(0, Number(existingRow.maxQuestionPoints || 0));
      const clampedPoints = Math.min(parsed.data.awardedPoints, maxPts);

      const [ans] = await tx
        .update(studentAnswers)
        .set({
          awardedPoints: clampedPoints.toFixed(2),
          isCorrect: clampedPoints > 0,
          needsManualGrading: false,
          graderFeedback: parsed.data.graderFeedback,
          gradedById: req.authUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(studentAnswers.id, answerId))
        .returning();

      const allAns = await tx
        .select()
        .from(studentAnswers)
        .where(eq(studentAnswers.attemptId, ans.attemptId));
      const stillPending = allAns.some((a) => a.needsManualGrading);
      const total = allAns.reduce((s, a) => s + Number(a.awardedPoints), 0);
      const manualTotal = allAns
        .filter((a) => a.gradedById !== null)
        .reduce((s, a) => s + Number(a.awardedPoints), 0);

      const [attempt] = await tx
        .select()
        .from(examAttempts)
        .where(eq(examAttempts.id, ans.attemptId))
        .limit(1);

      if (attempt) {
        const [ex] = await tx.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
        const maxScore = Number(attempt.maxScore) || 1;
        const pct = (total / maxScore) * 100;
        await tx
          .update(examAttempts)
          .set({
            manualScore: manualTotal.toFixed(2),
            totalScore: total.toFixed(2),
            status: stillPending ? 'SUBMITTED' : 'GRADED',
            passed: pct >= (ex?.passScorePercent || 60),
          })
          .where(eq(examAttempts.id, attempt.id));

        return {
          notFound: false as const,
          notify: !stillPending
            ? {
                userId: attempt.userId,
                examTitle: ex?.titleAr || 'الامتحان',
                total,
                maxScore,
              }
            : null,
        };
      }

      return { notFound: false as const, notify: null };
    });

    if (gradeResult.notFound) return res.status(404).json({ error: 'الإجابة غير موجودة' });

    if (gradeResult.notify) {
      await createNotification({
        userId: gradeResult.notify.userId,
        titleAr: 'تم تصحيح سؤالك المقالي وإعلان النتيجة النهائية',
        bodyAr: `درجتك النهائية في ${gradeResult.notify.examTitle} هي ${gradeResult.notify.total} من ${gradeResult.notify.maxScore}.`,
        type: 'EXAM_RESULT',
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Manual grade failed:', error);
    return res.status(500).json({ error: 'تعذر حفظ درجة التصحيح' });
  }
});

// 7. Groups, Schedules, Comments, Broadcast Notifications, Settings, Staff, Backup & Audit Logs
adminRouter.get(
  '/operations',
  requirePermission([
    PERMISSIONS.GROUPS_MANAGE,
    PERMISSIONS.SCHEDULE_MANAGE,
    PERMISSIONS.COMMENTS_MODERATE,
    PERMISSIONS.NOTIFICATIONS_SEND,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
  ]),
  async (req: AuthRequest, res) => {
  try {
    const canGroups = hasPermission(req.authUser, PERMISSIONS.GROUPS_MANAGE);
    const canSchedules = hasPermission(req.authUser, PERMISSIONS.SCHEDULE_MANAGE);
    const canComments = hasPermission(req.authUser, PERMISSIONS.COMMENTS_MODERATE);
    const canStaff = hasPermission(req.authUser, PERMISSIONS.STAFF_MANAGE);
    const canAudit = hasPermission(req.authUser, PERMISSIONS.AUDIT_VIEW);

    const [gRows, gmRows, schRows, commentRows, staffRows, roleRows, auditRows] = await Promise.all([
      canGroups ? db.select().from(groups).orderBy(desc(groups.createdAt)) : Promise.resolve([]),
      canGroups ? db.select().from(groupMembers) : Promise.resolve([]),
      canSchedules ? db.select().from(lectureSchedules).orderBy(asc(lectureSchedules.scheduledAt)) : Promise.resolve([]),
      canComments
        ? db
            .select({
              comment: lessonComments,
              authorName: users.fullName,
              lessonTitleAr: lessons.titleAr,
            })
            .from(lessonComments)
            .innerJoin(users, eq(lessonComments.userId, users.id))
            .innerJoin(lessons, eq(lessonComments.lessonId, lessons.id))
            .orderBy(desc(lessonComments.createdAt))
            .limit(40)
        : Promise.resolve([]),
      canStaff
        ? db
            .select({ user: users, role: roles })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(inArray(roles.slug, ['SUPER_ADMIN', 'CONTENT_MANAGER', 'TEACHING_ASSISTANT', 'SUPPORT']))
        : Promise.resolve([]),
      canStaff ? db.select().from(roles) : Promise.resolve([]),
      canAudit ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(60) : Promise.resolve([]),
    ]);

    return res.json({
      groups: gRows.map((g) => ({
        ...g,
        memberCount: gmRows.filter((m) => m.groupId === g.id).length,
      })),
      schedules: schRows,
      comments: commentRows.map((c) => ({
        ...c.comment,
        authorName: c.authorName,
        lessonTitleAr: c.lessonTitleAr,
      })),
      staff: staffRows
        .map((s) =>
          sanitizeStaffPublicRecord({
            id: s.user.id,
            fullName: s.user.fullName,
            phone: s.user.phone,
            email: s.user.email,
            status: s.user.status,
            roleSlug: s.role.slug,
            roleNameAr: s.role.nameAr,
            lastLoginAt: s.user.lastLoginAt,
            createdAt: s.user.createdAt,
          }),
        )
        .sort((a, b) => {
          if (a.roleSlug === 'SUPER_ADMIN' && b.roleSlug !== 'SUPER_ADMIN') return -1;
          if (b.roleSlug === 'SUPER_ADMIN' && a.roleSlug !== 'SUPER_ADMIN') return 1;
          return a.id - b.id;
        }),
      roles: roleRows,
      auditLogs: auditRows,
    });
  } catch (error) {
    console.error('Operations load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل بيانات التشغيل' });
  }
});

adminRouter.post('/groups', requirePermission(PERMISSIONS.GROUPS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = validateGroupPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errorAr });
    const d = parsed.data;
    const [gradeRow] = await db.select({ id: grades.id }).from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });

    const [created] = await db
      .insert(groups)
      .values({
        gradeId: d.gradeId,
        nameAr: d.nameAr,
        scheduleTextAr: d.scheduleTextAr,
        descriptionAr: d.descriptionAr,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'GROUP_CREATED',
      entityType: 'group',
      entityId: created.id,
      details: { gradeId: d.gradeId, nameAr: d.nameAr },
    });

    return res.status(201).json({ group: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إنشاء المجموعة' });
  }
});

adminRouter.put('/groups/:id', requirePermission(PERMISSIONS.GROUPS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف المجموعة غير صالح' });
    }
    const [existing] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const parsed = validateGroupPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errorAr });
    const d = parsed.data;

    const [gradeRow] = await db.select({ id: grades.id }).from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });

    const [updated] = await db
      .update(groups)
      .set({
        gradeId: d.gradeId,
        nameAr: d.nameAr,
        scheduleTextAr: d.scheduleTextAr,
        descriptionAr: d.descriptionAr,
      })
      .where(eq(groups.id, id))
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'GROUP_UPDATED',
      entityType: 'group',
      entityId: id,
      details: { gradeId: d.gradeId, nameAr: d.nameAr },
    });

    return res.json({ group: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر تعديل بيانات المجموعة' });
  }
});

adminRouter.delete('/groups/:id', requirePermission(PERMISSIONS.GROUPS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف المجموعة غير صالح' });
    }
    const [existing] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    await db.transaction(async (tx) => {
      await tx.update(lectureSchedules).set({ groupId: null }).where(eq(lectureSchedules.groupId, id));
      await tx.delete(groups).where(eq(groups.id, id));
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'GROUP_DELETED',
      entityType: 'group',
      entityId: id,
      details: { nameAr: existing.nameAr, gradeId: existing.gradeId },
    });

    return res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر حذف المجموعة' });
  }
});

adminRouter.post('/schedules', requirePermission(PERMISSIONS.SCHEDULE_MANAGE), async (req: AuthRequest, res) => {
  try {
    const parsed = validateSchedulePayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errorAr });
    const d = parsed.data;

    const [gradeRow] = await db.select({ id: grades.id }).from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });

    if (d.groupId !== null) {
      const [groupRow] = await db
        .select({ id: groups.id, gradeId: groups.gradeId })
        .from(groups)
        .where(eq(groups.id, d.groupId))
        .limit(1);
      if (!groupRow || groupRow.gradeId !== d.gradeId) {
        return res.status(400).json({ error: 'المجموعة المحددة غير تابعة لهذا الصف الدراسي' });
      }
    }

    const [created] = await db
      .insert(lectureSchedules)
      .values({
        gradeId: d.gradeId,
        groupId: d.groupId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        scheduledAt: d.scheduledAt,
        durationMin: d.durationMin,
        sessionType: d.sessionType,
        liveProvider: d.liveProvider,
        joinUrl: d.joinUrl,
        isPublished: d.isPublished,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'SCHEDULE_CREATED',
      entityType: 'schedule',
      entityId: created.id,
      details: { titleAr: d.titleAr, gradeId: d.gradeId, scheduledAt: d.scheduledAt.toISOString() },
    });

    return res.status(201).json({ schedule: created });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إضافة الموعد' });
  }
});

adminRouter.put('/schedules/:id', requirePermission(PERMISSIONS.SCHEDULE_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الموعد غير صالح' });
    }
    const [existing] = await db
      .select()
      .from(lectureSchedules)
      .where(eq(lectureSchedules.id, id))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الموعد غير موجود' });
    }

    const parsed = validateSchedulePayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errorAr });
    const d = parsed.data;

    const [gradeRow] = await db.select({ id: grades.id }).from(grades).where(eq(grades.id, d.gradeId)).limit(1);
    if (!gradeRow) return res.status(404).json({ error: 'الصف الدراسي المحدد غير موجود' });

    if (d.groupId !== null) {
      const [groupRow] = await db
        .select({ id: groups.id, gradeId: groups.gradeId })
        .from(groups)
        .where(eq(groups.id, d.groupId))
        .limit(1);
      if (!groupRow || groupRow.gradeId !== d.gradeId) {
        return res.status(400).json({ error: 'المجموعة المحددة غير تابعة لهذا الصف الدراسي' });
      }
    }

    const [updated] = await db
      .update(lectureSchedules)
      .set({
        gradeId: d.gradeId,
        groupId: d.groupId,
        titleAr: d.titleAr,
        descriptionAr: d.descriptionAr,
        scheduledAt: d.scheduledAt,
        durationMin: d.durationMin,
        sessionType: d.sessionType,
        liveProvider: d.liveProvider,
        joinUrl: d.joinUrl,
        isPublished: d.isPublished,
      })
      .where(eq(lectureSchedules.id, id))
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'SCHEDULE_UPDATED',
      entityType: 'schedule',
      entityId: id,
      details: {
        titleAr: d.titleAr,
        gradeId: d.gradeId,
        scheduledAt: d.scheduledAt.toISOString(),
        isPublished: d.isPublished,
      },
    });

    return res.json({ schedule: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر تعديل الموعد' });
  }
});

adminRouter.delete('/schedules/:id', requirePermission(PERMISSIONS.SCHEDULE_MANAGE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف الموعد غير صالح' });
    }
    const [existing] = await db
      .select()
      .from(lectureSchedules)
      .where(eq(lectureSchedules.id, id))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'الموعد غير موجود' });
    }

    await db.delete(lectureSchedules).where(eq(lectureSchedules.id, id));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'SCHEDULE_DELETED',
      entityType: 'schedule',
      entityId: id,
      details: { titleAr: existing.titleAr, gradeId: existing.gradeId },
    });

    return res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر حذف الموعد' });
  }
});

adminRouter.post('/comments/:id/reply', requirePermission(PERMISSIONS.COMMENTS_MODERATE), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'معرّف التعليق غير صالح' });
    }
    const schema = z.object({
      replyAr: z.string().trim().max(3000).optional(),
      status: z.enum(['APPROVED', 'HIDDEN', 'PENDING']).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات الرد أو الحالة غير صالحة' });
    }
    const { replyAr, status } = parsed.data;
    await db
      .update(lessonComments)
      .set({
        ...(replyAr !== undefined ? { replyAr } : {}),
        ...(status ? { status } : {}),
        repliedById: req.authUser!.id,
      })
      .where(eq(lessonComments.id, id));
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر حفظ الرد' });
  }
});

adminRouter.post('/notifications/broadcast', requirePermission(PERMISSIONS.NOTIFICATIONS_SEND), async (req: AuthRequest, res) => {
  try {
    const { userId, gradeId, titleAr, bodyAr, type } = req.body || {};
    if (!titleAr || !bodyAr) return res.status(400).json({ error: 'عنوان ونص الإشعار مطلوبان' });
    await createNotification({
      userId: userId ? Number(userId) : null,
      gradeId: gradeId ? Number(gradeId) : null,
      titleAr,
      bodyAr,
      type: type || 'GENERAL',
    });
    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'NOTIFICATION_SENT',
      entityType: 'notification',
      details: { userId, gradeId, titleAr },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'تعذر إرسال الإشعار' });
  }
});

// ==================== SUPER_ADMIN STAFF MANAGEMENT ====================
// Strictly protected by PERMISSIONS.STAFF_MANAGE (owner-only ceiling) + explicit SUPER_ADMIN check.

adminRouter.post('/staff', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    if (req.authUser!.roleSlug !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'إنشاء حسابات فريق العمل متاح للمدير العام الرئيسي فقط' });
    }

    const body = req.body || {};
    const nameCheck = validateStaffFullName(body.fullName);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.errorAr });

    const phoneCheck = validateEgyptianPhone(body.phone);
    if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.errorAr });

    const emailCheck = validateOptionalEmail(body.email);
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.errorAr });

    const requestedRole = typeof body.roleSlug === 'string' ? body.roleSlug.trim() : '';
    if (requestedRole === 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'لا يمكن إنشاء حساب مدير عام رئيسي (SUPER_ADMIN) من هذه الواجهة.',
      });
    }
    if (!isAssignableStaffRole(requestedRole)) {
      return res.status(400).json({
        error: 'الدور الوظيفي غير صالح. الأدوار المتاحة: مساعد مدرس، مدير محتوى، دعم فني.',
      });
    }

    const passwordCheck = validateStrongStaffPassword(
      typeof body.password === 'string' ? body.password : '',
      typeof body.confirmPassword === 'string' ? body.confirmPassword : '',
    );
    if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.errorAr });

    const [existingPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, phoneCheck.phone))
      .limit(1);
    if (existingPhone) {
      return res.status(409).json({ error: 'رقم الهاتف مسجّل بالفعل لحساب آخر على المنصة.' });
    }

    if (emailCheck.email) {
      const [existingEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailCheck.email}`)
        .limit(1);
      if (existingEmail) {
        return res.status(409).json({ error: 'البريد الإلكتروني مسجّل بالفعل لحساب آخر على المنصة.' });
      }
    }

    const [roleRow] = await db.select().from(roles).where(eq(roles.slug, requestedRole)).limit(1);
    if (!roleRow) {
      return res.status(500).json({ error: 'تعذر العثور على الدور الوظيفي المطلوب في قاعدة البيانات.' });
    }

    const [created] = await db
      .insert(users)
      .values({
        fullName: nameCheck.fullName,
        phone: phoneCheck.phone,
        email: emailCheck.email,
        passwordHash: hashPassword(body.password),
        roleId: roleRow.id,
        status: 'ACTIVE',
        maxDevices: 3,
        allowConcurrent: true,
        isDemoAccount: false,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STAFF_CREATED',
      entityType: 'staff',
      entityId: created.id,
      details: {
        roleSlug: roleRow.slug,
        phone: created.phone,
        hasEmail: Boolean(created.email),
      },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      staff: sanitizeStaffPublicRecord({
        id: created.id,
        fullName: created.fullName,
        phone: created.phone,
        email: created.email,
        status: created.status,
        roleSlug: roleRow.slug,
        roleNameAr: roleRow.nameAr,
        lastLoginAt: created.lastLoginAt,
        createdAt: created.createdAt,
      }),
      message: `تم إنشاء حساب الموظف "${created.fullName}" بدور (${roleRow.nameAr}) وتفعيله بنجاح.`,
    });
  } catch (error) {
    console.error('Create staff failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء حساب الموظف حاليًا' });
  }
});

adminRouter.patch('/staff/:id', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    const staffId = Number(req.params.id);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'معرّف الموظف غير صالح' });
    }

    const [target] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, staffId))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'حساب الموظف غير موجود' });
    }

    const targetDecision = evaluateStaffTargetMutation({
      actorId: req.authUser!.id,
      actorRoleSlug: req.authUser!.roleSlug,
      targetId: staffId,
      targetRoleSlug: target.role.slug,
    });
    if (!targetDecision.allowed) {
      return res.status(targetDecision.statusCode).json({ error: targetDecision.errorAr });
    }

    const body = req.body || {};
    const nameCheck = validateStaffFullName(
      body.fullName !== undefined ? body.fullName : target.user.fullName,
    );
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.errorAr });

    const phoneCheck = validateEgyptianPhone(
      body.phone !== undefined ? body.phone : target.user.phone || '',
    );
    if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.errorAr });

    const emailCheck = validateOptionalEmail(
      body.email !== undefined ? body.email : target.user.email,
    );
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.errorAr });

    const [dupPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phoneCheck.phone), ne(users.id, staffId)))
      .limit(1);
    if (dupPhone) {
      return res.status(409).json({ error: 'رقم الهاتف مستخدم بالفعل في حساب آخر.' });
    }

    if (emailCheck.email) {
      const [dupEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${emailCheck.email}`, ne(users.id, staffId)))
        .limit(1);
      if (dupEmail) {
        return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.' });
      }
    }

    let nextRoleRow = target.role;
    let roleChanged = false;
    if (body.roleSlug !== undefined) {
      const roleDecision = evaluateStaffRoleChange({
        currentRoleSlug: target.role.slug,
        nextRoleSlug: typeof body.roleSlug === 'string' ? body.roleSlug.trim() : body.roleSlug,
      });
      if (!roleDecision.allowed) {
        return res.status(roleDecision.statusCode).json({ error: roleDecision.errorAr });
      }
      if (roleDecision.changed) {
        const [foundRole] = await db
          .select()
          .from(roles)
          .where(eq(roles.slug, String(body.roleSlug).trim()))
          .limit(1);
        if (!foundRole) {
          return res.status(500).json({ error: 'تعذر العثور على الدور الوظيفي المطلوب' });
        }
        nextRoleRow = foundRole;
        roleChanged = true;
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        fullName: nameCheck.fullName,
        phone: phoneCheck.phone,
        email: emailCheck.email,
        roleId: nextRoleRow.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, staffId))
      .returning();

    if (roleChanged) {
      await revokeAllUserSessions(staffId);
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: roleChanged ? 'STAFF_ROLE_CHANGED' : 'STAFF_UPDATED',
      entityType: 'staff',
      entityId: staffId,
      details: {
        previousRole: target.role.slug,
        newRole: nextRoleRow.slug,
        roleChanged,
        phone: updated.phone,
      },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      sessionsRevoked: roleChanged,
      staff: sanitizeStaffPublicRecord({
        id: updated.id,
        fullName: updated.fullName,
        phone: updated.phone,
        email: updated.email,
        status: updated.status,
        roleSlug: nextRoleRow.slug,
        roleNameAr: nextRoleRow.nameAr,
        lastLoginAt: updated.lastLoginAt,
        createdAt: updated.createdAt,
      }),
      message: roleChanged
        ? `تم تحديث بيانات الموظف وتغيير دوره إلى (${nextRoleRow.nameAr}) مع إنهاء جلساته السابقة فورًا.`
        : 'تم تحديث بيانات الموظف بنجاح.',
    });
  } catch (error) {
    console.error('Update staff failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الموظف' });
  }
});

adminRouter.patch('/staff/:id/role', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    const staffId = Number(req.params.id);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'معرّف الموظف غير صالح' });
    }

    const [target] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, staffId))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'حساب الموظف غير موجود' });
    }

    const targetDecision = evaluateStaffTargetMutation({
      actorId: req.authUser!.id,
      actorRoleSlug: req.authUser!.roleSlug,
      targetId: staffId,
      targetRoleSlug: target.role.slug,
    });
    if (!targetDecision.allowed) {
      return res.status(targetDecision.statusCode).json({ error: targetDecision.errorAr });
    }

    const requestedRole = typeof req.body?.roleSlug === 'string' ? req.body.roleSlug.trim() : req.body?.roleSlug;
    const roleDecision = evaluateStaffRoleChange({
      currentRoleSlug: target.role.slug,
      nextRoleSlug: requestedRole,
    });
    if (!roleDecision.allowed) {
      return res.status(roleDecision.statusCode).json({ error: roleDecision.errorAr });
    }

    if (!roleDecision.changed) {
      return res.json({
        success: true,
        sessionsRevoked: false,
        staff: sanitizeStaffPublicRecord({
          id: target.user.id,
          fullName: target.user.fullName,
          phone: target.user.phone,
          email: target.user.email,
          status: target.user.status,
          roleSlug: target.role.slug,
          roleNameAr: target.role.nameAr,
          lastLoginAt: target.user.lastLoginAt,
          createdAt: target.user.createdAt,
        }),
        message: 'الدور الوظيفي المختار هو نفس الدور الحالي للموظف.',
      });
    }

    const [nextRoleRow] = await db.select().from(roles).where(eq(roles.slug, requestedRole)).limit(1);
    if (!nextRoleRow) {
      return res.status(500).json({ error: 'تعذر العثور على الدور الوظيفي المطلوب' });
    }

    await db
      .update(users)
      .set({ roleId: nextRoleRow.id, updatedAt: new Date() })
      .where(eq(users.id, staffId));

    // Immediately revoke all existing sessions so stale sessions cannot retain previous role privileges.
    await revokeAllUserSessions(staffId);

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STAFF_ROLE_CHANGED',
      entityType: 'staff',
      entityId: staffId,
      details: { previousRole: target.role.slug, newRole: nextRoleRow.slug },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      sessionsRevoked: true,
      staff: sanitizeStaffPublicRecord({
        id: target.user.id,
        fullName: target.user.fullName,
        phone: target.user.phone,
        email: target.user.email,
        status: target.user.status,
        roleSlug: nextRoleRow.slug,
        roleNameAr: nextRoleRow.nameAr,
        lastLoginAt: target.user.lastLoginAt,
        createdAt: target.user.createdAt,
      }),
      message: `تم تغيير دور الموظف إلى (${nextRoleRow.nameAr}) وإنهاء جميع جلساته الحالية فورًا (يتطلب تسجيل دخول جديد).`,
    });
  } catch (error) {
    console.error('Update staff role failed:', error);
    return res.status(500).json({ error: 'تعذر تغيير الدور الوظيفي للموظف' });
  }
});

// SUPER_ADMIN-only Staff Account Suspension / Reactivation (with immediate session revocation)
adminRouter.patch('/staff/:id/status', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    const staffId = Number(req.params.id);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'معرّف الموظف غير صالح' });
    }
    if (staffId === req.authUser!.id) {
      return res.status(403).json({ error: 'لا يمكن تعديل حالة حساب المدير العام الخاص بك من هذا الإجراء' });
    }

    const schema = z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'حالة الحساب المطلوبة غير صالحة' });
    }

    const [target] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, staffId))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'حساب الموظف غير موجود' });
    }
    if (!isStaffRole(target.role.slug)) {
      return res.status(400).json({ error: 'هذا الإجراء مخصص لحسابات فريق العمل فقط' });
    }
    if (target.role.slug === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'لا يمكن إيقاف أو تعديل حساب المدير العام الرئيسي' });
    }

    await db
      .update(users)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(users.id, staffId));

    // When suspending a staff account, immediately revoke all of that staff member's sessions only.
    // Reactivating does NOT restore previously revoked sessions; normal login is required again.
    if (parsed.data.status === 'SUSPENDED') {
      await revokeAllUserSessions(staffId);
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: parsed.data.status === 'SUSPENDED' ? 'STAFF_SUSPENDED' : 'STAFF_REACTIVATED',
      entityType: 'staff',
      entityId: staffId,
      details: { targetRole: target.role.slug, status: parsed.data.status },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      staff: {
        id: staffId,
        status: parsed.data.status,
        roleSlug: target.role.slug,
      },
      message:
        parsed.data.status === 'SUSPENDED'
          ? 'تم إيقاف حساب الموظف وإنهاء جميع جلساته النشطة فورًا'
          : 'تم إعادة تفعيل حساب الموظف (يتطلب تسجيل دخول جديد)',
    });
  } catch (error) {
    console.error('Update staff status failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث حالة حساب الموظف' });
  }
});

// SUPER_ADMIN-only Staff Password Reset (revokes all existing sessions immediately; never logs credentials)
adminRouter.post('/staff/:id/reset-password', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    const staffId = Number(req.params.id);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'معرّف الموظف غير صالح' });
    }

    const [target] = await db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, staffId))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'حساب الموظف غير موجود' });
    }

    const targetDecision = evaluateStaffTargetMutation({
      actorId: req.authUser!.id,
      actorRoleSlug: req.authUser!.roleSlug,
      targetId: staffId,
      targetRoleSlug: target.role.slug,
    });
    if (!targetDecision.allowed) {
      return res.status(targetDecision.statusCode).json({ error: targetDecision.errorAr });
    }

    const body = req.body || {};
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    const passwordCheck = validateStrongStaffPassword(newPassword, confirmPassword);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.errorAr });
    }

    await db
      .update(users)
      .set({
        passwordHash: hashPassword(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, staffId));

    // Immediately invalidate all active sessions so old tokens cannot remain logged in.
    await revokeAllUserSessions(staffId);

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STAFF_PASSWORD_RESET',
      entityType: 'staff',
      entityId: staffId,
      details: { targetRole: target.role.slug },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تم إعادة تعيين كلمة مرور الموظف "${target.user.fullName}" وإنهاء جميع جلساته السابقة فورًا.`,
    });
  } catch (error) {
    console.error('Reset staff password failed:', error);
    return res.status(500).json({ error: 'تعذر إعادة تعيين كلمة المرور حاليًا' });
  }
});

// SUPER_ADMIN-ONLY: Create an additional SUPER_ADMIN account with step-up password reauthentication
adminRouter.post('/staff/super-admin', requirePermission(PERMISSIONS.STAFF_MANAGE), async (req: AuthRequest, res) => {
  try {
    if (req.authUser!.roleSlug !== 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'إنشاء حساب مدير عام (Super Admin) مقتصر حصريًا على المدير العام الحالي.',
      });
    }

    const body = req.body || {};
    const currentAdminPassword = typeof body.currentAdminPassword === 'string' ? body.currentAdminPassword : '';
    if (!currentAdminPassword) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة مرور حسابك الحالي لتأكيد الصلاحية.' });
    }
    if (!body.explicitConfirmation) {
      return res.status(400).json({ error: 'يرجى تفعيل مربع التأكيد الصريح لمنح صلاحيات المدير العام الكاملة.' });
    }

    const [actorRow] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .limit(1);
    if (!actorRow || !verifyPassword(currentAdminPassword, actorRow.passwordHash)) {
      return res.status(401).json({ error: 'كلمة مرور المدير العام الحالي غير صحيحة.' });
    }

    const nameCheck = validateStaffFullName(body.fullName);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.errorAr });

    const phoneCheck = validateEgyptianPhone(body.phone);
    if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.errorAr });

    const emailCheck = validateOptionalEmail(body.email);
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.errorAr });

    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    const passCheck = validateStrongStaffPassword(password, confirmPassword);
    if (!passCheck.ok) return res.status(400).json({ error: passCheck.errorAr });

    // Strictly reject promoting or colliding with any existing student or staff account
    const existingPhone = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, phoneCheck.phone))
      .limit(1);
    if (existingPhone.length > 0) {
      return res.status(409).json({
        error: 'رقم الهاتف مسجل بالفعل لحساب آخر. لا يُسمح بترقية حساب طالب أو موظف قائم إلى مدير عام.',
      });
    }

    if (emailCheck.email) {
      const existingEmail = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailCheck.email}`)
        .limit(1);
      if (existingEmail.length > 0) {
        return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل لحساب آخر.' });
      }
    }

    const [superAdminRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.slug, 'SUPER_ADMIN'))
      .limit(1);
    if (!superAdminRole) {
      return res.status(500).json({ error: 'دور SUPER_ADMIN غير متوفر في النظام' });
    }

    const [created] = await db
      .insert(users)
      .values({
        roleId: superAdminRole.id,
        fullName: nameCheck.fullName,
        phone: phoneCheck.phone,
        email: emailCheck.email,
        passwordHash: hashPassword(password),
        status: 'ACTIVE',
        maxDevices: 5,
        allowConcurrent: true,
        isDemoAccount: false,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'SUPER_ADMIN_CREATED',
      entityType: 'staff',
      entityId: created.id,
      details: {
        createdFullName: created.fullName,
        createdPhone: created.phone,
        roleSlug: 'SUPER_ADMIN',
      },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      staff: sanitizeStaffPublicRecord({
        id: created.id,
        fullName: created.fullName,
        phone: created.phone,
        email: created.email,
        status: created.status,
        roleSlug: superAdminRole.slug,
        roleNameAr: superAdminRole.nameAr,
        lastLoginAt: created.lastLoginAt,
        createdAt: created.createdAt,
      }),
      message: `تم إنشاء حساب المدير العام الإضافي "${created.fullName}" بنجاح.`,
    });
  } catch (error) {
    console.error('Create Super Admin failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء حساب المدير العام الإضافي' });
  }
});

// Admin & Staff Actionable Notifications
adminRouter.get('/notifications', async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    return res.json({
      notifications: rows,
      unreadCount: rows.filter((r) => !r.isRead).length,
    });
  } catch (error) {
    console.error('Admin notifications failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل الإشعارات' });
  }
});

adminRouter.post('/notifications/read', async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const id = Number(req.body?.id || 0);
    if (id > 0) {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, id), eq(notifications.userId, u.id)));
    } else {
      await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, u.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark admin notifications read failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث حالة الإشعارات' });
  }
});

// Platform Settings CMS (SUPER_ADMIN only)
adminRouter.put('/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'بيانات الإعدادات غير صالحة' });
    }
    await db
      .insert(settings)
      .values({ key: 'platform_config', valueJson: payload, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { valueJson: payload, updatedAt: new Date() },
      });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'settings',
      entityId: 'platform_config',
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Update settings failed:', error);
    return res.status(500).json({ error: 'تعذر حفظ إعدادات المنصة' });
  }
});

// Safe Database Snapshot Backup Export (SUPER_ADMIN only — excludes password hashes & code hashes)
adminRouter.get('/backup/export', requirePermission(PERMISSIONS.BACKUPS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const [tRows, gRows, uRows, lRows, vRows, cRows, exRows, setRows] = await Promise.all([
      db.select().from(academicTracks),
      db.select().from(grades),
      db.select().from(units),
      db.select().from(lessons),
      db.select().from(videos),
      db.select().from(courses),
      db.select().from(exams),
      db.select().from(settings),
    ]);

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'BACKUP_EXPORTED',
      entityType: 'system',
    });

    return res.json({
      exportedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
      counts: {
        tracks: tRows.length,
        grades: gRows.length,
        units: uRows.length,
        lessons: lRows.length,
        videos: vRows.length,
        courses: cRows.length,
        exams: exRows.length,
      },
      data: {
        academicTracks: tRows,
        grades: gRows,
        units: uRows,
        lessons: lRows,
        videos: vRows,
        courses: cRows,
        exams: exRows,
        settings: setRows,
      },
    });
  } catch (error) {
    console.error('Backup export failed:', error);
    return res.status(500).json({ error: 'تعذر تصدير النسخة الاحتياطية' });
  }
});
