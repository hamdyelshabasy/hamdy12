import { Router } from 'express';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  accessCodes,
  auditLogs,
  codeRedemptions,
  courseLessons,
  courses,
  courseStudentBlocks,
  coupons,
  deviceSessions,
  enrollments,
  entitlements,
  examAssignments,
  examAttempts,
  exams,
  grades,
  groupMembers,
  groups,
  homeworkAssignments,
  lessons,
  orders,
  payments,
  plans,
  progressRecords,
  roles,
  studentProfiles,
  subscriptions,
  units,
  users,
  videoAccessCounters,
  videos,
} from '../../db/schema.ts';
import {
  PERMISSIONS,
  requireAuth,
  requirePermission,
  requireStaff,
  revokeAllUserSessions,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification, logAudit } from '../audit.ts';
import { getSourcePriority } from '../domain/entitlements.ts';
import { getBlockedDeviceFingerprints } from '../domain/deviceAccess.ts';
import { hashPassword, verifyPassword } from '../domain/security.ts';
import { preprocessLocalizedNumber } from '../../lib/numerals.ts';
import {
  computeRemainingDays,
  evaluateCourseDeletionSafety,
  evaluateStudentDeletionSafety,
  planManualCourseGrants,
  resolveCouponStatus,
  resolveEffectiveVideoMaxOpens,
} from '../domain/adminControl.ts';
import {
  resolveStrictStudentEntitlementTarget,
  resolveStrictStudentTarget,
} from '../studentTargetGuard.ts';

export const adminUpgradeRouter = Router();
adminUpgradeRouter.use(requireAuth, requireStaff());

// ============================================================
// PHASE A — ADVANCED STUDENT MANAGEMENT & COMPLETE PROFILE
// ============================================================

// 1. Complete 360° Student Profile (Personal, Courses, Video Access, Exams, Payments/Codes, Real Activity Log)
adminUpgradeRouter.get(
  '/students/:id/full-profile',
  requirePermission([PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_APPROVE, PERMISSIONS.STUDENTS_MANAGE]),
  async (req: AuthRequest, res) => {
  try {
    const target = await resolveStrictStudentTarget(req.params.id);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const { user, role } = target;
    const userId = user.id;

    const [
      profileRows,
      enrollmentRows,
      entitlementRows,
      subscriptionRows,
      orderRows,
      redemptionRows,
      attemptRows,
      progressRows,
      counterRows,
      sessionRows,
      groupRows,
      allTracks,
      allGrades,
      allCourses,
      allVideos,
      allUnits,
      allLessons,
      allExams,
      studentAuditRows,
    ] = await Promise.all([
      db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1),
      db.select().from(enrollments).where(eq(enrollments.userId, userId)).orderBy(desc(enrollments.createdAt)),
      db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(desc(entitlements.createdAt)),
      db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)),
      db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)),
      db
        .select({
          redemption: codeRedemptions,
          codePrefix: accessCodes.codePrefix,
          targetType: accessCodes.targetType,
          targetId: accessCodes.targetId,
          durationDays: accessCodes.durationDays,
        })
        .from(codeRedemptions)
        .innerJoin(accessCodes, eq(codeRedemptions.codeId, accessCodes.id))
        .where(eq(codeRedemptions.userId, userId))
        .orderBy(desc(codeRedemptions.redeemedAt)),
      db
        .select({
          attempt: examAttempts,
          examTitleAr: exams.titleAr,
          examType: exams.examType,
          passScorePercent: exams.passScorePercent,
          gradeId: exams.gradeId,
        })
        .from(examAttempts)
        .innerJoin(exams, eq(examAttempts.examId, exams.id))
        .where(eq(examAttempts.userId, userId))
        .orderBy(desc(examAttempts.startedAt)),
      db.select().from(progressRecords).where(eq(progressRecords.userId, userId)).orderBy(desc(progressRecords.updatedAt)),
      db.select().from(videoAccessCounters).where(eq(videoAccessCounters.userId, userId)),
      db.select().from(deviceSessions).where(eq(deviceSessions.userId, userId)).orderBy(desc(deviceSessions.lastHeartbeatAt)),
      db
        .select({
          groupId: groups.id,
          nameAr: groups.nameAr,
          scheduleTextAr: groups.scheduleTextAr,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(eq(groupMembers.userId, userId)),
      db.select().from(academicTracks).orderBy(asc(academicTracks.sortOrder)),
      db.select().from(grades).orderBy(asc(grades.sortOrder)),
      db.select().from(courses).orderBy(asc(courses.sortOrder), asc(courses.id)),
      db.select().from(videos).orderBy(asc(videos.sortOrder), asc(videos.id)),
      db.select().from(units).orderBy(asc(units.sortOrder)),
      db.select().from(lessons).orderBy(asc(lessons.sortOrder)),
      db.select().from(exams).orderBy(desc(exams.createdAt)),
      db
        .select()
        .from(auditLogs)
        .where(
          or(
            eq(auditLogs.actorId, userId),
            and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, String(userId))),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(80),
    ]);

    // Fetch payments for student orders
    const orderIds = orderRows.map((o) => o.id);
    const paymentRows = orderIds.length
      ? await db.select().from(payments).where(inArray(payments.orderId, orderIds)).orderBy(desc(payments.createdAt))
      : [];

    // Fetch exam assignments targeting this student or their groups
    const studentGroupIds = groupRows.map((g) => g.groupId);
    const assignmentRows = await db
      .select()
      .from(examAssignments)
      .where(
        studentGroupIds.length > 0
          ? or(eq(examAssignments.studentId, userId), inArray(examAssignments.groupId, studentGroupIds))
          : eq(examAssignments.studentId, userId),
      );

    // Fetch grantedBy names for entitlements
    const granterIds = Array.from(
      new Set(entitlementRows.map((e) => e.grantedById).filter((id): id is number => Boolean(id))),
    );
    const granters = granterIds.length
      ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, granterIds))
      : [];
    const granterMap = new Map(granters.map((g) => [g.id, g.fullName]));

    const trackMap = new Map(allTracks.map((t) => [t.id, t]));
    const gradeMap = new Map(allGrades.map((g) => [g.id, g]));
    const courseMap = new Map(allCourses.map((c) => [c.id, c]));
    const videoMap = new Map(allVideos.map((v) => [v.id, v]));
    const unitMap = new Map(allUnits.map((u) => [u.id, u]));
    const lessonMap = new Map(allLessons.map((l) => [l.id, l]));
    const counterMap = new Map(counterRows.map((c) => [c.videoId, c]));
    const progressMap = new Map(progressRows.map((p) => [p.videoId, p]));
    const paymentByOrder = new Map(paymentRows.map((p) => [p.orderId, p]));

    const profile = profileRows[0] || null;
    const primaryGrade = profile?.primaryGradeId ? gradeMap.get(profile.primaryGradeId) : null;
    const primaryTrack = profile?.primaryTrackId ? trackMap.get(profile.primaryTrackId) : null;
    const now = new Date();

    const approvedGradeIds = new Set(
      enrollmentRows.filter((e) => e.status === 'ACTIVE').map((e) => e.gradeId),
    );
    if (profile?.primaryGradeId && user.status === 'ACTIVE') {
      approvedGradeIds.add(profile.primaryGradeId);
    }

    // Resolve enriched course entitlements & subscriptions
    const courseEntitlements = entitlementRows
      .filter((e) => e.targetType === 'COURSE' || e.targetType === 'GRADE_ALL')
      .map((e) => {
        const course = e.targetType === 'COURSE' ? courseMap.get(e.targetId) : null;
        const grade = e.targetType === 'GRADE_ALL' ? gradeMap.get(e.targetId) : course ? gradeMap.get(course.gradeId) : null;
        const isExpired = Boolean(e.expiresAt && new Date(e.expiresAt).getTime() <= now.getTime());
        const remainingDays = computeRemainingDays(e.expiresAt, now);
        const status = e.isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE';
        return {
          ...e,
          targetTitleAr:
            e.targetType === 'COURSE'
              ? course?.titleAr || `كورس #${e.targetId}`
              : `فتح جميع محتويات ${grade?.nameAr || `الصف #${e.targetId}`}`,
          gradeNameAr: grade?.nameAr || '—',
          grantedByName: e.grantedById ? granterMap.get(e.grantedById) || 'الإدارة' : null,
          status,
          remainingDays,
        };
      });

    // Resolve enriched video entitlements
    const videoEntitlements = entitlementRows
      .filter((e) => e.targetType === 'VIDEO')
      .map((e) => {
        const video = videoMap.get(e.targetId);
        const grade = video ? gradeMap.get(video.gradeId) : null;
        const unit = video?.unitId ? unitMap.get(video.unitId) : null;
        const course = video?.courseId ? courseMap.get(video.courseId) : null;
        const counter = counterMap.get(e.targetId);
        const isExpired = Boolean(e.expiresAt && new Date(e.expiresAt).getTime() <= now.getTime());
        const status = e.isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE';
        const effectiveMaxOpens = resolveEffectiveVideoMaxOpens({
          courseDefaultMaxOpens: course?.defaultVideoMaxOpens ?? null,
          videoMaxOpens: video?.maxOpens ?? null,
          studentMaxOpensOverride: counter?.maxOpensOverride ?? null,
          bonusOpens: counter?.bonusOpens ?? 0,
        });
        const countedOpens = counter?.countedOpens ?? 0;
        return {
          ...e,
          videoTitleAr: video?.titleAr || `فيديو #${e.targetId}`,
          videoType: video?.videoType || 'PAID',
          gradeNameAr: grade?.nameAr || '—',
          unitTitleAr: unit?.titleAr || '—',
          grantedByName: e.grantedById ? granterMap.get(e.grantedById) || 'الإدارة' : null,
          status,
          remainingDays: computeRemainingDays(e.expiresAt, now),
          countedOpens,
          effectiveMaxOpens,
          remainingOpens: effectiveMaxOpens === null ? null : Math.max(0, effectiveMaxOpens - countedOpens),
          maxOpensOverride: counter?.maxOpensOverride ?? null,
          bonusOpens: counter?.bonusOpens ?? 0,
        };
      });

    // Video view-limit tracker across all student-grade or accessed videos
    const trackedVideoIds = new Set<number>([
      ...counterRows.map((c) => c.videoId),
      ...progressRows.map((p) => p.videoId),
      ...videoEntitlements.map((v) => v.targetId),
      ...allVideos.filter((v) => approvedGradeIds.has(v.gradeId)).map((v) => v.id),
    ]);

    const videoAccessLedger = Array.from(trackedVideoIds)
      .map((vid) => {
        const v = videoMap.get(vid);
        if (!v) return null;
        const course = v.courseId ? courseMap.get(v.courseId) : null;
        const counter = counterMap.get(vid);
        const prog = progressMap.get(vid);
        const effectiveMaxOpens = resolveEffectiveVideoMaxOpens({
          courseDefaultMaxOpens: course?.defaultVideoMaxOpens ?? null,
          videoMaxOpens: v.maxOpens ?? null,
          studentMaxOpensOverride: counter?.maxOpensOverride ?? null,
          bonusOpens: counter?.bonusOpens ?? 0,
        });
        const countedOpens = counter?.countedOpens ?? 0;
        return {
          videoId: v.id,
          titleAr: v.titleAr,
          gradeNameAr: gradeMap.get(v.gradeId)?.nameAr || '—',
          lessonTitleAr: lessonMap.get(v.lessonId)?.titleAr || '—',
          courseTitleAr: course?.titleAr || null,
          videoType: v.videoType,
          countedOpens,
          effectiveMaxOpens,
          remainingOpens: effectiveMaxOpens === null ? null : Math.max(0, effectiveMaxOpens - countedOpens),
          maxOpensOverride: counter?.maxOpensOverride ?? null,
          bonusOpens: counter?.bonusOpens ?? 0,
          completionPercent: prog?.completionPercent ?? 0,
          isCompleted: Boolean(prog?.isCompleted),
          lastCountedAt: counter?.lastCountedAt ?? null,
        };
      })
      .filter(Boolean);

    // Assigned & completed exams overview
    const assignedExamIds = new Set(assignmentRows.map((a) => a.examId));
    const attemptsByExam = new Map<number, typeof attemptRows>();
    for (const row of attemptRows) {
      const list = attemptsByExam.get(row.attempt.examId) || [];
      list.push(row);
      attemptsByExam.set(row.attempt.examId, list);
    }

    const relevantExams = allExams.filter((ex) => {
      if (attemptsByExam.has(ex.id)) return true;
      if (ex.publicationStatus !== 'PUBLISHED' && !ex.isPublished) return false;
      if (ex.assignmentScope === 'GRADE') return approvedGradeIds.has(ex.gradeId);
      if (ex.assignmentScope === 'GROUP') {
        return (ex.groupId && studentGroupIds.includes(ex.groupId)) || assignedExamIds.has(ex.id);
      }
      if (ex.assignmentScope === 'STUDENTS') {
        return ex.assignedUserId === userId || assignedExamIds.has(ex.id);
      }
      return false;
    });

    const examsOverview = relevantExams.map((ex) => {
      const list = attemptsByExam.get(ex.id) || [];
      const latest = list[0]?.attempt || null;
      const best = list.reduce(
        (acc, cur) => (Number(cur.attempt.totalScore) > Number(acc?.totalScore || -1) ? cur.attempt : acc),
        null as (typeof attemptRows)[number]['attempt'] | null,
      );
      const maxScore = Number(latest?.maxScore || ex.totalMarks || 0);
      const obtainedScore = latest ? Number(latest.totalScore) : null;
      const percent = obtainedScore !== null && maxScore > 0 ? Math.round((obtainedScore / maxScore) * 100) : null;
      return {
        examId: ex.id,
        titleAr: ex.titleAr,
        examType: ex.examType,
        gradeNameAr: gradeMap.get(ex.gradeId)?.nameAr || '—',
        attemptsCount: list.length,
        maxAttempts: ex.maxAttempts,
        status: !latest
          ? 'NOT_STARTED'
          : latest.status === 'AWAITING_MANUAL_GRADING'
            ? 'AWAITING_MANUAL_GRADING'
            : latest.status === 'IN_PROGRESS'
              ? 'IN_PROGRESS'
              : 'COMPLETED',
        latestAttemptId: latest?.id || null,
        submittedAt: latest?.submittedAt || latest?.startedAt || null,
        obtainedScore,
        bestScore: best ? Number(best.totalScore) : null,
        maxScore,
        percent,
        passed: latest ? latest.passed : null,
        generalFeedback: latest?.generalFeedback || '',
      };
    });

    // Available eligible courses for one-click / bulk / all-eligible granting
    const availableCourses = allCourses
      .filter((c) => c.publicationStatus !== 'ARCHIVED')
      .map((c) => {
        const grade = gradeMap.get(c.gradeId);
        const track = grade ? trackMap.get(grade.trackId) : null;
        const alreadyActive = courseEntitlements.some(
          (e) => e.targetType === 'COURSE' && e.targetId === c.id && e.status === 'ACTIVE',
        );
        return {
          id: c.id,
          titleAr: c.titleAr,
          gradeId: c.gradeId,
          gradeNameAr: grade?.nameAr || '—',
          trackNameAr: track?.nameAr || '—',
          validityDays: c.validityDays,
          publicationStatus: c.publicationStatus,
          isPublished: c.isPublished,
          isStudentGrade: approvedGradeIds.has(c.gradeId) || profile?.primaryGradeId === c.gradeId,
          alreadyActive,
        };
      });

    // Deletion safety summary
    const deletionSafety = evaluateStudentDeletionSafety({
      roleSlug: role.slug,
      paidOrdersCount: orderRows.filter((o) => o.status === 'PAID' || o.status === 'UNDER_REVIEW').length,
      examAttemptsCount: attemptRows.length,
      activeSubscriptionsCount: subscriptionRows.length,
      manualEntitlementsCount: entitlementRows.filter((e) => e.source === 'MANUAL_GRANT').length,
      redemptionsCount: redemptionRows.length,
    });

    // Real subscriptions list
    const planIds = Array.from(
      new Set(subscriptionRows.map((s) => s.planId).filter((id): id is number => Boolean(id))),
    );
    const planRows = planIds.length ? await db.select().from(plans).where(inArray(plans.id, planIds)) : [];
    const planMap = new Map(planRows.map((p) => [p.id, p]));

    return res.json({
      student: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        status: user.status,
        roleSlug: role.slug,
        roleNameAr: role.nameAr,
        maxDevices: user.maxDevices,
        allowConcurrent: user.allowConcurrent,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        parentPhone: profile?.parentPhone || '',
        governorate: profile?.governorate || '',
        parentShareCode: profile?.parentShareCode || '',
        primaryTrackId: profile?.primaryTrackId || null,
        primaryGradeId: profile?.primaryGradeId || null,
        trackNameAr: primaryTrack?.nameAr || '—',
        gradeNameAr: primaryGrade?.nameAr || '—',
        approvedAt: profile?.approvedAt || null,
        decisionNote: profile?.decisionNote || '',
      },
      groups: groupRows,
      enrollments: enrollmentRows.map((en) => ({
        ...en,
        trackNameAr: trackMap.get(en.trackId)?.nameAr || '—',
        gradeNameAr: gradeMap.get(en.gradeId)?.nameAr || '—',
      })),
      courseEntitlements,
      subscriptions: subscriptionRows.map((s) => ({
        ...s,
        courseTitleAr: s.courseId ? courseMap.get(s.courseId)?.titleAr || `كورس #${s.courseId}` : null,
        planNameAr: s.planId ? planMap.get(s.planId)?.nameAr || `باقة #${s.planId}` : null,
        remainingDays: computeRemainingDays(s.expiresAt, now),
      })),
      availableCourses,
      videoEntitlements,
      videoAccessLedger,
      examsOverview,
      examAttempts: attemptRows.map((a) => ({
        id: a.attempt.id,
        examId: a.attempt.examId,
        examTitleAr: a.examTitleAr,
        examType: a.examType,
        attemptNumber: a.attempt.attemptNumber,
        status: a.attempt.status,
        totalScore: Number(a.attempt.totalScore),
        maxScore: Number(a.attempt.maxScore),
        passed: a.attempt.passed,
        startedAt: a.attempt.startedAt,
        submittedAt: a.attempt.submittedAt,
        generalFeedback: a.attempt.generalFeedback || '',
      })),
      orders: orderRows.map((o) => {
        const pay = paymentByOrder.get(o.id);
        return {
          ...o,
          paymentStatus: pay?.status || null,
          providerRef: pay?.providerRef || null,
          verifiedAt: pay?.verifiedAt || null,
        };
      }),
      codeRedemptions: redemptionRows.map((r) => ({
        id: r.redemption.id,
        codePrefix: r.codePrefix,
        targetType: r.targetType,
        targetId: r.targetId,
        durationDays: r.durationDays,
        redeemedAt: r.redemption.redeemedAt,
      })),
      sessions: (() => {
        const blockedFps = getBlockedDeviceFingerprints(sessionRows);
        return sessionRows.map((s) => ({
          ...s,
          isBlocked: s.isBlocked || blockedFps.has(s.deviceFingerprint.trim()),
        }));
      })(),
      activityLogs: studentAuditRows,
      deletionSafety,
      catalogRefs: {
        units: allUnits.map((u) => ({
          id: u.id,
          gradeId: u.gradeId,
          titleAr: u.titleAr,
          gradeNameAr: gradeMap.get(u.gradeId)?.nameAr || '—',
        })),
      },
    });
  } catch (error) {
    console.error('Full student profile load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل الملف الكامل للطالب' });
  }
});

// 2. Edit Student Personal & Academic Profile
adminUpgradeRouter.patch('/students/:id/profile', requirePermission(PERMISSIONS.STUDENTS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرّف الطالب غير صالح' });
    }

    const schema = z.object({
      fullName: z.string().trim().min(2).optional(),
      phone: z.string().trim().min(6).optional(),
      parentPhone: z.string().trim().optional(),
      email: z.string().trim().email('صيغة البريد غير صحيحة').optional().or(z.literal('')).nullable(),
      governorate: z.string().trim().optional(),
      trackId: z.coerce.number().int().positive().optional(),
      gradeId: z.coerce.number().int().positive().optional(),
      status: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'REJECTED', 'SUSPENDED', 'ARCHIVED']).optional(),
      maxDevices: z.coerce.number().int().min(1).max(10).optional(),
      allowConcurrent: z.boolean().optional(),
      newPassword: z.string().min(6).optional().or(z.literal('')),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات التعديل غير صالحة' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const d = parsed.data;
    if (d.phone && d.phone !== target.user.phone) {
      const dup = await db.select({ id: users.id }).from(users).where(eq(users.phone, d.phone)).limit(1);
      if (dup.length > 0 && dup[0].id !== userId) {
        return res.status(409).json({ error: 'رقم الهاتف مستخدم بالفعل لحساب آخر' });
      }
    }

    const now = new Date();
    const userUpdates: Record<string, unknown> = { updatedAt: now };
    if (d.fullName) userUpdates.fullName = d.fullName;
    if (d.phone) userUpdates.phone = d.phone;
    if (d.email !== undefined) userUpdates.email = d.email || null;
    if (d.status) userUpdates.status = d.status;
    if (d.maxDevices !== undefined) userUpdates.maxDevices = d.maxDevices;
    if (d.allowConcurrent !== undefined) userUpdates.allowConcurrent = d.allowConcurrent;
    if (d.newPassword && d.newPassword.length >= 6) {
      userUpdates.passwordHash = hashPassword(d.newPassword);
    }

    await db
      .update(users)
      .set(userUpdates)
      .where(and(eq(users.id, userId), eq(users.roleId, target.role.id)));

    // Revoke all sessions and clear auth cache if archived, suspended, rejected, or password reset
    if (
      d.status === 'ARCHIVED' ||
      d.status === 'SUSPENDED' ||
      d.status === 'REJECTED' ||
      Boolean(d.newPassword && d.newPassword.length >= 6)
    ) {
      await revokeAllUserSessions(userId);
    }

    const profileUpdates: Record<string, unknown> = {};
    if (d.parentPhone !== undefined) profileUpdates.parentPhone = d.parentPhone;
    if (d.governorate !== undefined) profileUpdates.governorate = d.governorate;
    if (d.trackId) profileUpdates.primaryTrackId = d.trackId;
    if (d.gradeId) profileUpdates.primaryGradeId = d.gradeId;

    if (Object.keys(profileUpdates).length > 0) {
      await db.update(studentProfiles).set(profileUpdates).where(eq(studentProfiles.userId, userId));
    }

    if (d.trackId && d.gradeId) {
      await db
        .insert(enrollments)
        .values({
          userId,
          trackId: d.trackId,
          gradeId: d.gradeId,
          status: 'ACTIVE',
          decidedById: req.authUser!.id,
          decidedAt: now,
        })
        .onConflictDoUpdate({
          target: [enrollments.userId, enrollments.gradeId],
          set: { trackId: d.trackId, status: 'ACTIVE', decidedById: req.authUser!.id, decidedAt: now },
        });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_PROFILE_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: {
        updatedFields: Object.keys(d).filter((k) => k !== 'newPassword'),
        passwordReset: Boolean(d.newPassword),
      },
      ipAddress: req.ip || '',
    });

    return res.json({ success: true, message: 'تم تحديث بيانات الطالب بنجاح' });
  } catch (error) {
    console.error('Student profile update failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث بيانات الطالب' });
  }
});

// 3. Safe Level-1 Student Archive / Deactivate (Default safe delete behavior)
adminUpgradeRouter.post('/students/:id/archive', requirePermission(PERMISSIONS.STUDENTS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرّف الطالب غير صالح' });
    }
    if (userId === req.authUser!.id) {
      return res.status(403).json({ error: 'لا يمكنك أرشفة حسابك الشخصي' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: 'ARCHIVED', updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.roleId, target.role.id)));
      await tx
        .update(deviceSessions)
        .set({ isRevoked: true, activeVideoId: null })
        .where(eq(deviceSessions.userId, userId));
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_ARCHIVED',
      entityType: 'user',
      entityId: userId,
      details: { studentName: target.user.fullName, reason },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تمت أرشفة وتعطيل حساب "${target.user.fullName}" وإنهاء جميع جلساته مع الحفاظ الكامل على سجل الامتحانات والمدفوعات.`,
    });
  } catch (error) {
    console.error('Student archive failed:', error);
    return res.status(500).json({ error: 'تعذر أرشفة حساب الطالب' });
  }
});

// 4. Restore Archived / Suspended Student
adminUpgradeRouter.post('/students/:id/restore', requirePermission(PERMISSIONS.STUDENTS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const target = await resolveStrictStudentTarget(req.params.id);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }
    const userId = target.user.id;

    await db
      .update(users)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.roleId, target.role.id)));

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_RESTORED',
      entityType: 'user',
      entityId: userId,
      details: { studentName: target.user.fullName, previousStatus: target.user.status },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تمت استعادة وتفعيل حساب "${target.user.fullName}" بنجاح.`,
    });
  } catch (error) {
    console.error('Student restore failed:', error);
    return res.status(500).json({ error: 'تعذر استعادة حساب الطالب' });
  }
});

// 5. Safe Level-2 Permanent Student Delete (Strictly guarded — blocked if Super Admin/staff or historical exams/payments exist)
adminUpgradeRouter.delete('/students/:id/permanent', requirePermission(PERMISSIONS.STUDENTS_DELETE), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرّف الطالب غير صالح' });
    }
    if (userId === req.authUser!.id) {
      return res.status(403).json({ error: 'لا يمكنك حذف حسابك الشخصي' });
    }

    const confirmText = String(req.body?.confirmText || '').trim();
    if (confirmText !== 'حذف نهائي' && confirmText !== 'DELETE') {
      return res.status(400).json({ error: 'يرجى كتابة "حذف نهائي" لتأكيد الحذف الدائم' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }
    const { user, role } = target;

    const [orderRows, attemptRows, subRows, entRows, redRows] = await Promise.all([
      db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.userId, userId)),
      db.select({ id: examAttempts.id }).from(examAttempts).where(eq(examAttempts.userId, userId)),
      db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId)),
      db.select({ id: entitlements.id, source: entitlements.source }).from(entitlements).where(eq(entitlements.userId, userId)),
      db.select({ id: codeRedemptions.id }).from(codeRedemptions).where(eq(codeRedemptions.userId, userId)),
    ]);

    const safety = evaluateStudentDeletionSafety({
      roleSlug: role.slug,
      paidOrdersCount: orderRows.filter((o) => o.status === 'PAID' || o.status === 'UNDER_REVIEW').length,
      examAttemptsCount: attemptRows.length,
      activeSubscriptionsCount: subRows.length,
      manualEntitlementsCount: entRows.filter((e) => e.source === 'MANUAL_GRANT').length,
      redemptionsCount: redRows.length,
    });

    if (!safety.canPermanentlyDelete) {
      return res.status(409).json({
        error: safety.blockReasonAr || 'لا يمكن الحذف النهائي لهذا الحساب حفاظًا على السجلات التاريخية.',
        safety,
      });
    }

    await db.transaction(async (tx) => {
      // Nullify non-cascading audit/reference foreign keys before removing user
      await tx.update(auditLogs).set({ actorId: null }).where(eq(auditLogs.actorId, userId));
      await tx.update(accessCodes).set({ boundUserId: null }).where(eq(accessCodes.boundUserId, userId));
      await tx.update(entitlements).set({ grantedById: null }).where(eq(entitlements.grantedById, userId));
      await tx.delete(users).where(and(eq(users.id, userId), eq(users.roleId, role.id)));
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_PERMANENTLY_DELETED',
      entityType: 'user',
      entityId: userId,
      details: { deletedName: user.fullName, deletedPhone: user.phone },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تم حذف حساب "${user.fullName}" نهائيًا من النظام.`,
    });
  } catch (error) {
    console.error('Permanent student delete failed:', error);
    return res.status(500).json({ error: 'تعذر الحذف النهائي للطالب (قد توجد سجلات مرتبطة به)' });
  }
});

// 6. Grant Course(s) to Student (Single, Multiple Selected, or All Currently Available Eligible Courses)
adminUpgradeRouter.post('/students/:id/courses/grant', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرّف الطالب غير صالح' });
    }

    const schema = z.object({
      courseIds: z.array(z.coerce.number().int().positive()).optional(),
      grantAllEligible: z.boolean().optional().default(false),
      includeAllGrades: z.boolean().optional().default(false),
      durationDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
      expiresAt: z.string().optional().nullable(),
      note: z.string().trim().max(240).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات منح الكورسات غير صالحة' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);
    const studentEnrollments = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.status, 'ACTIVE')));

    const eligibleGradeIds = new Set<number>(studentEnrollments.map((e) => e.gradeId));
    if (profile?.primaryGradeId) eligibleGradeIds.add(profile.primaryGradeId);

    const allCourses = await db.select().from(courses).orderBy(asc(courses.sortOrder), asc(courses.id));
    const availableCourses = allCourses.filter((c) => c.publicationStatus !== 'ARCHIVED');

    let requestedIds: number[] = [];
    if (parsed.data.grantAllEligible) {
      requestedIds = availableCourses
        .filter((c) => parsed.data.includeAllGrades || eligibleGradeIds.size === 0 || eligibleGradeIds.has(c.gradeId))
        .map((c) => c.id);
    } else {
      requestedIds = parsed.data.courseIds || [];
    }

    if (requestedIds.length === 0) {
      return res.status(400).json({ error: 'لا توجد كورسات محددة أو متاحة لمنحها لهذا الطالب' });
    }

    const existingEnts = await db
      .select()
      .from(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.targetType, 'COURSE')));

    const plan = planManualCourseGrants({
      requestedCourseIds: requestedIds,
      availableCourses,
      existingEntitlements: existingEnts,
    });

    if (plan.toGrant.length === 0) {
      return res.json({
        success: true,
        grantedCourses: [],
        skippedCourses: plan.skippedAlreadyActive.map((c) => ({ id: c.id, titleAr: c.titleAr })),
        message: 'الطالب يملك بالفعل صلاحية نشطة لجميع الكورسات المختارة.',
      });
    }

    let customExpiresAt: Date | null = null;
    if (parsed.data.expiresAt) {
      const dt = new Date(parsed.data.expiresAt);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: 'تاريخ انتهاء الصلاحية غير صالح' });
      }
      customExpiresAt = dt;
    } else if (parsed.data.durationDays > 0) {
      customExpiresAt = new Date(Date.now() + parsed.data.durationDays * 86400_000);
    }

    const noteText =
      parsed.data.note ||
      (parsed.data.grantAllEligible
        ? 'منحة إدارية: جميع الكورسات المتاحة حاليًا'
        : 'منحة كورس مباشرة من المدرس');

    const inserted = await db.transaction(async (tx) => {
      const rows = [];
      for (const course of plan.toGrant) {
        const [row] = await tx
          .insert(entitlements)
          .values({
            userId,
            targetType: 'COURSE',
            targetId: course.id,
            source: 'MANUAL_GRANT',
            priority: getSourcePriority('MANUAL_GRANT'),
            expiresAt: customExpiresAt,
            grantedById: req.authUser!.id,
            note: noteText,
          })
          .returning();
        rows.push(row);
      }
      return rows;
    });

    await createNotification({
      userId,
      titleAr: plan.toGrant.length > 1 ? 'تم فتح كورسات جديدة في حسابك' : 'تم فتح كورس جديد في حسابك',
      bodyAr: `منحك المدرس صلاحية الوصول إلى: ${plan.toGrant.map((c) => c.titleAr).join('، ')}.`,
      type: 'GENERAL',
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: parsed.data.grantAllEligible ? 'STUDENT_GRANTED_ALL_ELIGIBLE_COURSES' : 'STUDENT_COURSES_GRANTED',
      entityType: 'user',
      entityId: userId,
      details: {
        grantedIds: plan.toGrant.map((c) => c.id),
        grantedTitles: plan.toGrant.map((c) => c.titleAr),
        skippedIds: plan.skippedAlreadyActive.map((c) => c.id),
        expiresAt: customExpiresAt ? customExpiresAt.toISOString() : 'PERMANENT',
      },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      entitlements: inserted,
      grantedCourses: plan.toGrant.map((c) => ({ id: c.id, titleAr: c.titleAr })),
      skippedCourses: plan.skippedAlreadyActive.map((c) => ({ id: c.id, titleAr: c.titleAr })),
      message: `تم منح صلاحية ${plan.toGrant.length} كورس بنجاح${
        plan.skippedAlreadyActive.length > 0 ? ` (وتم تخطي ${plan.skippedAlreadyActive.length} كورس مفعّل مسبقًا)` : ''
      }.`,
    });
  } catch (error) {
    console.error('Grant courses failed:', error);
    return res.status(500).json({ error: 'تعذر منح صلاحية الكورسات للطالب' });
  }
});

// 7. Grant Video(s) or Unit Videos to Student
adminUpgradeRouter.post('/students/:id/videos/grant', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'معرّف الطالب غير صالح' });
    }

    const schema = z.object({
      videoIds: z.array(z.coerce.number().int().positive()).optional(),
      unitId: z.coerce.number().int().positive().optional(),
      durationDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
      expiresAt: z.string().optional().nullable(),
      note: z.string().trim().max(240).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات منح صلاحية الفيديوهات غير صالحة' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    let targetVideoIds = parsed.data.videoIds || [];
    if (parsed.data.unitId) {
      const unitVids = await db
        .select({ id: videos.id })
        .from(videos)
        .where(eq(videos.unitId, parsed.data.unitId));
      targetVideoIds = [...targetVideoIds, ...unitVids.map((v) => v.id)];
    }
    targetVideoIds = Array.from(new Set(targetVideoIds.filter((id) => id > 0)));

    if (!targetVideoIds.length) {
      return res.status(400).json({ error: 'يرجى اختيار فيديو واحد على الأقل أو وحدة تحتوي على فيديوهات' });
    }

    const existing = await db
      .select()
      .from(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.targetType, 'VIDEO'), eq(entitlements.isRevoked, false)));
    const now = new Date();
    const activeSet = new Set(
      existing
        .filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now.getTime())
        .map((e) => e.targetId),
    );

    const toGrant = targetVideoIds.filter((id) => !activeSet.has(id));
    if (!toGrant.length) {
      return res.json({ success: true, grantedCount: 0, message: 'الطالب يملك بالفعل صلاحية نشطة لجميع الفيديوهات المختارة.' });
    }

    let expiresAt: Date | null = null;
    if (parsed.data.expiresAt) {
      const dt = new Date(parsed.data.expiresAt);
      if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'تاريخ الانتهاء غير صالح' });
      expiresAt = dt;
    } else if (parsed.data.durationDays > 0) {
      expiresAt = new Date(Date.now() + parsed.data.durationDays * 86400_000);
    }

    await db.transaction(async (tx) => {
      for (const vid of toGrant) {
        await tx.insert(entitlements).values({
          userId,
          targetType: 'VIDEO',
          targetId: vid,
          source: 'MANUAL_GRANT',
          priority: getSourcePriority('MANUAL_GRANT'),
          expiresAt,
          grantedById: req.authUser!.id,
          note: parsed.data.note || 'منحة فيديو مباشرة من المدرس',
        });
      }
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_VIDEOS_GRANTED',
      entityType: 'user',
      entityId: userId,
      details: { videoIds: toGrant, unitId: parsed.data.unitId || null, expiresAt: expiresAt?.toISOString() || 'PERMANENT' },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      grantedCount: toGrant.length,
      message: `تم فتح ${toGrant.length} فيديو للطالب بنجاح.`,
    });
  } catch (error) {
    console.error('Grant videos failed:', error);
    return res.status(500).json({ error: 'تعذر منح صلاحية الفيديوهات' });
  }
});

// 8. Extend / Change Expiry / Restore an Entitlement
adminUpgradeRouter.patch('/entitlements/:id', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const entId = Number(req.params.id);
    if (!Number.isInteger(entId) || entId <= 0) {
      return res.status(400).json({ error: 'معرّف الصلاحية غير صالح' });
    }

    const schema = z.object({
      extendDays: z.coerce.number().int().min(1).max(3650).optional(),
      expiresAt: z.string().nullable().optional(),
      restore: z.boolean().optional(),
      note: z.string().trim().max(240).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بيانات تحديث الصلاحية غير صالحة' });

    const entTarget = await resolveStrictStudentEntitlementTarget(entId);
    if (!entTarget.ok) {
      return res.status(entTarget.statusCode).json({ error: entTarget.errorAr });
    }
    const ent = entTarget.entitlement;

    const updates: Record<string, unknown> = {};
    if (parsed.data.restore) {
      updates.isRevoked = false;
      updates.revokedAt = null;
    }

    if (parsed.data.extendDays) {
      const baseTime =
        ent.expiresAt && new Date(ent.expiresAt).getTime() > Date.now()
          ? new Date(ent.expiresAt).getTime()
          : Date.now();
      updates.expiresAt = new Date(baseTime + parsed.data.extendDays * 86400_000);
    } else if (parsed.data.expiresAt !== undefined) {
      if (parsed.data.expiresAt === null || parsed.data.expiresAt === '') {
        updates.expiresAt = null;
      } else {
        const dt = new Date(parsed.data.expiresAt);
        if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'تاريخ الانتهاء غير صالح' });
        updates.expiresAt = dt;
      }
    }

    if (parsed.data.note !== undefined) {
      updates.note = parsed.data.note;
    }

    const [updated] = await db
      .update(entitlements)
      .set(updates)
      .where(eq(entitlements.id, entId))
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: parsed.data.restore ? 'ENTITLEMENT_RESTORED' : 'ENTITLEMENT_UPDATED',
      entityType: 'user',
      entityId: ent.userId,
      details: {
        entitlementId: entId,
        targetType: ent.targetType,
        targetId: ent.targetId,
        extendDays: parsed.data.extendDays || null,
        expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : 'PERMANENT',
        restored: Boolean(parsed.data.restore),
      },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      entitlement: updated,
      message: parsed.data.restore ? 'تمت استعادة الصلاحية بنجاح' : 'تم تحديث صلاحية المحتوى بنجاح',
    });
  } catch (error) {
    console.error('Update entitlement failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث الصلاحية' });
  }
});

// 9. Safe Revoke Entitlement (protects paid/subscription grants unless explicitly confirmed)
adminUpgradeRouter.post('/entitlements/:id/revoke', requirePermission(PERMISSIONS.STUDENT_ACCESS_REVOKE), async (req: AuthRequest, res) => {
  try {
    const entId = Number(req.params.id);
    if (!Number.isInteger(entId) || entId <= 0) {
      return res.status(400).json({ error: 'معرّف الصلاحية غير صالح' });
    }

    const entTarget = await resolveStrictStudentEntitlementTarget(entId);
    if (!entTarget.ok) {
      return res.status(entTarget.statusCode).json({ error: entTarget.errorAr });
    }
    const ent = entTarget.entitlement;

    const confirmPaidRevoke = Boolean(req.body?.confirmPaidRevoke);
    if (ent.source !== 'MANUAL_GRANT' && !confirmPaidRevoke) {
      return res.status(409).json({
        error: 'هذه الصلاحية ناتجة عن اشتراك/شراء أو كود تفعيل وليست منحة يدوية. يلزم التأكيد الصريح لسحبها.',
        requiresConfirmation: true,
        source: ent.source,
      });
    }

    const [updated] = await db
      .update(entitlements)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(entitlements.id, entId))
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ENTITLEMENT_REVOKED',
      entityType: 'user',
      entityId: ent.userId,
      details: { entitlementId: entId, source: ent.source, targetType: ent.targetType, targetId: ent.targetId },
      ipAddress: req.ip || '',
    });

    return res.json({ success: true, entitlement: updated, message: 'تم سحب الصلاحية بنجاح' });
  } catch (error) {
    console.error('Revoke entitlement failed:', error);
    return res.status(500).json({ error: 'تعذر سحب الصلاحية' });
  }
});

// 10. Per-Student Video View Limit Override / Reset / Add Bonus Opens
adminUpgradeRouter.put('/students/:id/videos/:videoId/limit', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const videoId = Number(req.params.videoId);
    if (!Number.isInteger(userId) || !Number.isInteger(videoId) || userId <= 0 || videoId <= 0) {
      return res.status(400).json({ error: 'معرّفات غير صالحة' });
    }

    const schema = z.object({
      maxOpensOverride: z.coerce.number().int().min(-1).max(1000).nullable().optional(),
      bonusOpens: z.coerce.number().int().min(0).max(500).optional(),
      resetOpens: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'إعدادات حد المشاهدة غير صالحة' });
    }

    const target = await resolveStrictStudentTarget(userId);
    if (!target.ok) {
      return res.status(target.statusCode).json({ error: target.errorAr });
    }

    const [existing] = await db
      .select()
      .from(videoAccessCounters)
      .where(and(eq(videoAccessCounters.userId, userId), eq(videoAccessCounters.videoId, videoId)))
      .limit(1);

    const nextCounted = parsed.data.resetOpens ? 0 : existing?.countedOpens ?? 0;
    const nextOverride =
      parsed.data.maxOpensOverride !== undefined
        ? parsed.data.maxOpensOverride
        : existing?.maxOpensOverride ?? null;
    const nextBonus =
      parsed.data.bonusOpens !== undefined ? parsed.data.bonusOpens : existing?.bonusOpens ?? 0;

    const [saved] = await db
      .insert(videoAccessCounters)
      .values({
        userId,
        videoId,
        countedOpens: nextCounted,
        maxOpensOverride: nextOverride,
        bonusOpens: nextBonus,
        lastSessionId: parsed.data.resetOpens ? null : existing?.lastSessionId ?? null,
        lastCountedAt: parsed.data.resetOpens ? null : existing?.lastCountedAt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [videoAccessCounters.userId, videoAccessCounters.videoId],
        set: {
          countedOpens: nextCounted,
          maxOpensOverride: nextOverride,
          bonusOpens: nextBonus,
          lastSessionId: parsed.data.resetOpens ? null : existing?.lastSessionId ?? null,
          lastCountedAt: parsed.data.resetOpens ? null : existing?.lastCountedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'STUDENT_VIDEO_LIMIT_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: {
        videoId,
        maxOpensOverride: nextOverride,
        bonusOpens: nextBonus,
        resetOpens: parsed.data.resetOpens,
      },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      counter: saved,
      message: parsed.data.resetOpens
        ? 'تم تصفير عداد المشاهدات لهذا الطالب بنجاح'
        : 'تم حفظ إعدادات حد المشاهدة للطالب بنجاح',
    });
  } catch (error) {
    console.error('Update student video limit failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث حد المشاهدة للطالب' });
  }
});

// ============================================================
// PHASE B — COMPLETE COURSE MANAGEMENT & SUBSCRIBERS
// ============================================================

// 11. Complete Course Detail (Metadata, Course Videos + PDFs, Available Library Videos, Subscribers, Audit, Safety)
adminUpgradeRouter.get(
  '/courses/:id/detail',
  requirePermission([PERMISSIONS.CONTENT_VIEW, PERMISSIONS.CONTENT_MANAGE, PERMISSIONS.COURSES_MANAGE]),
  async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

    const [
      allTracks,
      allGrades,
      allUnits,
      allLessons,
      clRows,
      allVideos,
      courseEntitlements,
      courseSubscriptions,
      courseOrders,
      courseExams,
      courseAudit,
      allStudents,
      courseBlocks,
    ] = await Promise.all([
      db.select().from(academicTracks).orderBy(asc(academicTracks.sortOrder)),
      db.select().from(grades).orderBy(asc(grades.sortOrder)),
      db.select().from(units).orderBy(asc(units.sortOrder)),
      db.select().from(lessons).orderBy(asc(lessons.sortOrder)),
      db.select().from(courseLessons).where(eq(courseLessons.courseId, courseId)).orderBy(asc(courseLessons.sortOrder)),
      db.select().from(videos).orderBy(asc(videos.sortOrder), asc(videos.id)),
      db
        .select()
        .from(entitlements)
        .where(and(eq(entitlements.targetType, 'COURSE'), eq(entitlements.targetId, courseId)))
        .orderBy(desc(entitlements.createdAt)),
      db.select().from(subscriptions).where(eq(subscriptions.courseId, courseId)).orderBy(desc(subscriptions.createdAt)),
      db.select().from(orders).where(and(eq(orders.targetType, 'COURSE'), eq(orders.targetId, courseId))),
      db.select({ id: exams.id, titleAr: exams.titleAr }).from(exams).where(eq(exams.courseId, courseId)),
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'course'), eq(auditLogs.entityId, String(courseId))))
        .orderBy(desc(auditLogs.createdAt))
        .limit(40),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
          status: users.status,
          primaryGradeId: studentProfiles.primaryGradeId,
          primaryTrackId: studentProfiles.primaryTrackId,
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
        .where(eq(roles.slug, 'STUDENT'))
        .orderBy(desc(users.createdAt)),
      db
        .select()
        .from(courseStudentBlocks)
        .where(and(eq(courseStudentBlocks.courseId, courseId), eq(courseStudentBlocks.isActive, true))),
    ]);

    const trackMap = new Map(allTracks.map((t) => [t.id, t]));
    const gradeMap = new Map(allGrades.map((g) => [g.id, g]));
    const unitMap = new Map(allUnits.map((u) => [u.id, u]));
    const lessonMap = new Map(allLessons.map((l) => [l.id, l]));
    const studentMap = new Map(allStudents.map((s) => [s.id, s]));
    const blockByUserId = new Map(courseBlocks.map((b) => [b.userId, b]));

    const linkedLessonIds = new Set(clRows.map((cl) => cl.lessonId));
    const courseVideos = allVideos
      .filter((v) => v.courseId === courseId || linkedLessonIds.has(v.lessonId))
      .map((v) => ({
        ...v,
        unitTitleAr: v.unitId ? unitMap.get(v.unitId)?.titleAr || '—' : '—',
        lessonTitleAr: lessonMap.get(v.lessonId)?.titleAr || '—',
        gradeNameAr: gradeMap.get(v.gradeId)?.nameAr || '—',
        linkedDirectly: v.courseId === courseId,
        linkedViaLesson: linkedLessonIds.has(v.lessonId),
        effectiveMaxOpens: resolveEffectiveVideoMaxOpens({
          courseDefaultMaxOpens: course.defaultVideoMaxOpens,
          videoMaxOpens: v.maxOpens,
          studentMaxOpensOverride: null,
          bonusOpens: 0,
        }),
      }));

    const courseVideoIdSet = new Set(courseVideos.map((v) => v.id));
    const availableLibraryVideos = allVideos
      .filter((v) => !courseVideoIdSet.has(v.id))
      .map((v) => ({
        id: v.id,
        titleAr: v.titleAr,
        gradeId: v.gradeId,
        gradeNameAr: gradeMap.get(v.gradeId)?.nameAr || '—',
        lessonId: v.lessonId,
        lessonTitleAr: lessonMap.get(v.lessonId)?.titleAr || '—',
        videoType: v.videoType,
        publicationStatus: v.publicationStatus,
        hasPdf: Boolean(v.pdfDriveFileId || v.pdfDriveUrl),
      }));

    const now = new Date();
    const searchQuery = String(req.query.search || '').trim().toLowerCase();
    const subscribers = courseEntitlements
      .map((ent) => {
        const st = studentMap.get(ent.userId);
        const stGrade = st?.primaryGradeId ? gradeMap.get(st.primaryGradeId) : null;
        const stTrack = st?.primaryTrackId ? trackMap.get(st.primaryTrackId) : null;
        const isExpired = Boolean(ent.expiresAt && new Date(ent.expiresAt).getTime() <= now.getTime());
        const block = blockByUserId.get(ent.userId);
        const isBlocked = Boolean(block && block.isActive);
        const status = isBlocked
          ? 'BLOCKED'
          : ent.isRevoked
            ? 'REVOKED'
            : isExpired
              ? 'EXPIRED'
              : 'ACTIVE';
        return {
          entitlementId: ent.id,
          userId: ent.userId,
          fullName: st?.fullName || `طالب #${ent.userId}`,
          phone: st?.phone || '—',
          accountStatus: st?.status || 'ACTIVE',
          trackNameAr: stTrack?.nameAr || '—',
          gradeNameAr: stGrade?.nameAr || '—',
          source: ent.source,
          startsAt: ent.startsAt,
          expiresAt: ent.expiresAt,
          remainingDays: computeRemainingDays(ent.expiresAt, now),
          status,
          isBlocked,
          blockReason: block?.reason || '',
          blockedAt: block?.blockedAt || null,
          note: ent.note || '',
        };
      })
      .filter((s) => {
        if (!searchQuery) return true;
        return (
          s.fullName.toLowerCase().includes(searchQuery) ||
          String(s.phone || '').toLowerCase().includes(searchQuery)
        );
      });

    const uniqueSubscriberUsers = new Set([
      ...courseEntitlements.filter((e) => !e.isRevoked).map((e) => e.userId),
      ...courseSubscriptions.map((s) => s.userId),
    ]);

    const deletionSafety = evaluateCourseDeletionSafety({
      subscribersCount: uniqueSubscriberUsers.size,
      ordersCount: courseOrders.length,
      linkedExamsCount: courseExams.length,
      linkedVideosCount: courseVideos.length,
    });

    const grade = gradeMap.get(course.gradeId);
    const track = grade ? trackMap.get(grade.trackId) : null;

    return res.json({
      course: {
        ...course,
        trackId: grade?.trackId || null,
        trackNameAr: track?.nameAr || '—',
        gradeNameAr: grade?.nameAr || '—',
        videosCount: courseVideos.length,
        activeSubscribersCount: subscribers.filter((s) => s.status === 'ACTIVE').length,
        ordersCount: courseOrders.length,
      },
      videos: courseVideos,
      availableLibraryVideos,
      subscribers,
      linkedExams: courseExams,
      auditLogs: courseAudit,
      deletionSafety,
      studentsForManualAdd: allStudents
        .filter((s) => s.status !== 'ARCHIVED')
        .map((s) => ({
          id: s.id,
          fullName: s.fullName,
          phone: s.phone,
          gradeNameAr: s.primaryGradeId ? gradeMap.get(s.primaryGradeId)?.nameAr || '—' : '—',
        })),
    });
  } catch (error) {
    console.error('Course detail load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الكورس' });
  }
});

// 12. Edit Complete Course Details + Optional Explicit Validity Propagation
adminUpgradeRouter.patch('/courses/:id', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
    }

    const schema = z.object({
      gradeId: z.coerce.number().int().positive().optional(),
      titleAr: z.string().trim().min(2).optional(),
      descriptionAr: z.string().trim().optional(),
      thumbnailUrl: z.string().trim().optional(),
      originalPriceEgp: z.coerce.number().int().min(0).optional(),
      discountPriceEgp: z.coerce.number().int().min(0).optional(),
      validityDays: z.coerce.number().int().min(1).max(3650).optional(),
      publicationStatus: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED']).optional(),
      isPublished: z.boolean().optional(),
      hasFreePreview: z.boolean().optional(),
      hasCertificate: z.boolean().optional(),
      sortOrder: z.coerce.number().int().optional(),
      defaultVideoMaxOpens: z.coerce.number().int().min(0).max(500).nullable().optional(),
      applyValidityToExisting: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل الكورس غير صالحة' });
    }

    const [existing] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الكورس غير موجود' });

    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (d.gradeId !== undefined) updates.gradeId = d.gradeId;
    if (d.titleAr !== undefined) updates.titleAr = d.titleAr;
    if (d.descriptionAr !== undefined) updates.descriptionAr = d.descriptionAr;
    if (d.thumbnailUrl !== undefined) updates.thumbnailUrl = d.thumbnailUrl;
    if (d.originalPriceEgp !== undefined) updates.originalPriceEgp = d.originalPriceEgp;
    if (d.discountPriceEgp !== undefined) updates.discountPriceEgp = d.discountPriceEgp;
    if (d.validityDays !== undefined) updates.validityDays = d.validityDays;
    if (d.hasFreePreview !== undefined) updates.hasFreePreview = d.hasFreePreview;
    if (d.hasCertificate !== undefined) updates.hasCertificate = d.hasCertificate;
    if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;

    if (d.defaultVideoMaxOpens !== undefined) {
      updates.defaultVideoMaxOpens =
        d.defaultVideoMaxOpens === null || d.defaultVideoMaxOpens === 0 ? null : d.defaultVideoMaxOpens;
    }

    if (d.publicationStatus !== undefined) {
      updates.publicationStatus = d.publicationStatus;
      updates.isPublished = d.publicationStatus === 'PUBLISHED';
    } else if (d.isPublished !== undefined) {
      updates.isPublished = d.isPublished;
      updates.publicationStatus = d.isPublished ? 'PUBLISHED' : 'HIDDEN';
    }

    const [updated] = await db.update(courses).set(updates).where(eq(courses.id, courseId)).returning();

    let updatedExistingGrantsCount = 0;
    if (d.applyValidityToExisting && d.validityDays && d.validityDays !== existing.validityDays) {
      const activeCourseEnts = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.targetType, 'COURSE'),
            eq(entitlements.targetId, courseId),
            eq(entitlements.isRevoked, false),
          ),
        );

      for (const ent of activeCourseEnts) {
        if (ent.expiresAt) {
          const nextExp = new Date(new Date(ent.startsAt).getTime() + d.validityDays * 86400_000);
          await db.update(entitlements).set({ expiresAt: nextExp }).where(eq(entitlements.id, ent.id));
          updatedExistingGrantsCount++;
        }
      }
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_UPDATED',
      entityType: 'course',
      entityId: courseId,
      details: {
        titleAr: updated.titleAr,
        publicationStatus: updated.publicationStatus,
        defaultVideoMaxOpens: updated.defaultVideoMaxOpens,
        updatedExistingGrantsCount,
      },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      course: updated,
      updatedExistingGrantsCount,
      message: 'تم تحديث بيانات الكورس بنجاح (دون التأثير على الطلبات السابقة).',
    });
  } catch (error) {
    console.error('Course update failed:', error);
    return res.status(500).json({ error: 'تعذر تعديل بيانات الكورس' });
  }
});

// 13. Attach Existing Video to Course
adminUpgradeRouter.post('/courses/:id/videos/attach', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    const videoId = Number(req.body?.videoId);
    if (!Number.isInteger(courseId) || !Number.isInteger(videoId) || courseId <= 0 || videoId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس أو الفيديو غير صالح' });
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (!course || !video) return res.status(404).json({ error: 'الكورس أو الفيديو غير موجود' });

    await db.transaction(async (tx) => {
      await tx.update(videos).set({ courseId, updatedAt: new Date() }).where(eq(videos.id, videoId));
      await tx
        .insert(courseLessons)
        .values({ courseId, lessonId: video.lessonId, isFreePreview: video.videoType === 'FREE', sortOrder: video.sortOrder })
        .onConflictDoNothing();
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_VIDEO_ATTACHED',
      entityType: 'course',
      entityId: courseId,
      details: { videoId, videoTitle: video.titleAr },
      ipAddress: req.ip || '',
    });

    return res.json({ success: true, message: `تم ربط الفيديو "${video.titleAr}" بالكورس بنجاح.` });
  } catch (error) {
    console.error('Attach video to course failed:', error);
    return res.status(500).json({ error: 'تعذر إضافة الفيديو إلى الكورس' });
  }
});

// 14. Detach Video from Course (NEVER deletes the video from the main library!)
adminUpgradeRouter.post('/courses/:id/videos/detach', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    const videoId = Number(req.body?.videoId);
    if (!Number.isInteger(courseId) || !Number.isInteger(videoId) || courseId <= 0 || videoId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس أو الفيديو غير صالح' });
    }

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (!video) return res.status(404).json({ error: 'الفيديو غير موجود' });

    await db.transaction(async (tx) => {
      if (video.courseId === courseId) {
        await tx.update(videos).set({ courseId: null, updatedAt: new Date() }).where(eq(videos.id, videoId));
      }
      // Remove course_lessons mapping only if no other video in that lesson is directly assigned to this course
      const remainingSameLesson = await tx
        .select({ id: videos.id })
        .from(videos)
        .where(and(eq(videos.courseId, courseId), eq(videos.lessonId, video.lessonId)));
      if (remainingSameLesson.length === 0) {
        await tx
          .delete(courseLessons)
          .where(and(eq(courseLessons.courseId, courseId), eq(courseLessons.lessonId, video.lessonId)));
      }
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_VIDEO_DETACHED',
      entityType: 'course',
      entityId: courseId,
      details: { videoId, videoTitle: video.titleAr },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تم فك ارتباط الفيديو "${video.titleAr}" عن الكورس بنجاح (يبقى الفيديو محفوظًا في مكتبة الفيديوهات).`,
    });
  } catch (error) {
    console.error('Detach video from course failed:', error);
    return res.status(500).json({ error: 'تعذر إزالة الفيديو من الكورس' });
  }
});

// 15. Reorder Videos inside Course
adminUpgradeRouter.post('/courses/:id/videos/reorder', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    const orderedIds = Array.isArray(req.body?.orderedVideoIds)
      ? (req.body.orderedVideoIds as unknown[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!Number.isInteger(courseId) || courseId <= 0 || orderedIds.length === 0) {
      return res.status(400).json({ error: 'قائمة ترتيب الفيديوهات غير صالحة' });
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(videos).set({ sortOrder: i + 1, updatedAt: new Date() }).where(eq(videos.id, orderedIds[i]));
      }
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_VIDEOS_REORDERED',
      entityType: 'course',
      entityId: courseId,
      details: { orderedVideoIds: orderedIds },
      ipAddress: req.ip || '',
    });

    return res.json({ success: true, message: 'تم حفظ ترتيب فيديوهات الكورس بنجاح' });
  } catch (error) {
    console.error('Reorder course videos failed:', error);
    return res.status(500).json({ error: 'تعذر حفظ ترتيب الفيديوهات' });
  }
});

// 16. Update Per-Video Max Opens (null/0 = inherit course default or unlimited)
adminUpgradeRouter.patch('/videos/:videoId/view-limit', requirePermission(PERMISSIONS.CONTENT_MANAGE), async (req: AuthRequest, res) => {
  try {
    const videoId = Number(req.params.videoId);
    if (!Number.isInteger(videoId) || videoId <= 0) {
      return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });
    }
    const raw = req.body?.maxOpens;
    const maxOpens = raw === null || raw === '' || Number(raw) <= 0 ? null : Math.min(500, Math.floor(Number(raw)));

    const [updated] = await db
      .update(videos)
      .set({ maxOpens, updatedAt: new Date() })
      .where(eq(videos.id, videoId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'الفيديو غير موجود' });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'VIDEO_MAX_OPENS_UPDATED',
      entityType: 'video',
      entityId: videoId,
      details: { maxOpens },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      video: updated,
      message: maxOpens ? `تم تعيين حد المشاهدة لهذا الفيديو إلى ${maxOpens} فتحات.` : 'تم جعل المشاهدة غير محدودة / تابعة لإعداد الكورس.',
    });
  } catch (error) {
    console.error('Update video maxOpens failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث حد مشاهدة الفيديو' });
  }
});

// 17. Archive or Restore Course
adminUpgradeRouter.post('/courses/:id/archive', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    const restore = Boolean(req.body?.restore);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
    }

    const [updated] = await db
      .update(courses)
      .set({
        publicationStatus: restore ? 'PUBLISHED' : 'ARCHIVED',
        isPublished: restore,
        updatedAt: new Date(),
      })
      .where(eq(courses.id, courseId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'الكورس غير موجود' });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: restore ? 'COURSE_RESTORED' : 'COURSE_ARCHIVED',
      entityType: 'course',
      entityId: courseId,
      details: { titleAr: updated.titleAr },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      course: updated,
      message: restore
        ? `تمت استعادة ونشر الكورس "${updated.titleAr}" بنجاح.`
        : `تمت أرشفة الكورس "${updated.titleAr}" (أُخفي من المبيعات الجديدة مع الحفاظ الكامل على المشتركين الحاليين والفيديوهات).`,
    });
  } catch (error) {
    console.error('Archive course failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث حالة أرشفة الكورس' });
  }
});

// 18. Safe Permanent Course Delete (Blocked if subscribers, orders, or linked exams exist; NEVER deletes library videos)
adminUpgradeRouter.delete('/courses/:id', requirePermission(PERMISSIONS.COURSES_MANAGE), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId) || courseId <= 0) {
      return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

    const [entRows, subRows, orderRows, examRows, vidRows] = await Promise.all([
      db
        .select({ userId: entitlements.userId, isRevoked: entitlements.isRevoked })
        .from(entitlements)
        .where(and(eq(entitlements.targetType, 'COURSE'), eq(entitlements.targetId, courseId))),
      db.select({ userId: subscriptions.userId }).from(subscriptions).where(eq(subscriptions.courseId, courseId)),
      db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.targetType, 'COURSE'), eq(orders.targetId, courseId))),
      db.select({ id: exams.id }).from(exams).where(eq(exams.courseId, courseId)),
      db.select({ id: videos.id }).from(videos).where(eq(videos.courseId, courseId)),
    ]);

    const safety = evaluateCourseDeletionSafety({
      subscribersCount: new Set([...entRows.filter((e) => !e.isRevoked).map((e) => e.userId), ...subRows.map((s) => s.userId)]).size,
      ordersCount: orderRows.length,
      linkedExamsCount: examRows.length,
      linkedVideosCount: vidRows.length,
    });

    if (!safety.canPermanentlyDelete) {
      return res.status(409).json({
        error: safety.blockReasonAr || 'لا يمكن حذف الكورس نهائيًا لوجود سجلات مرتبطة به.',
        safety,
      });
    }

    await db.transaction(async (tx) => {
      // Explicitly detach videos so shared library videos are NEVER deleted
      await tx.update(videos).set({ courseId: null }).where(eq(videos.courseId, courseId));
      await tx.delete(courseLessons).where(eq(courseLessons.courseId, courseId));
      await tx.delete(courses).where(eq(courses.id, courseId));
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_DELETED',
      entityType: 'course',
      entityId: courseId,
      details: { deletedTitle: course.titleAr },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      message: `تم حذف الكورس "${course.titleAr}" نهائيًا مع الحفاظ على جميع الفيديوهات في المكتبة.`,
    });
  } catch (error) {
    console.error('Delete course failed:', error);
    return res.status(500).json({ error: 'تعذر حذف الكورس' });
  }
});

// 18A. Explicit Course Visibility Control (PUBLISHED / HIDDEN / ARCHIVED)
adminUpgradeRouter.patch(
  '/courses/:id/visibility',
  requirePermission(PERMISSIONS.COURSES_MANAGE),
  async (req: AuthRequest, res) => {
    try {
      const courseId = Number(req.params.id);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
      }
      const schema = z.object({
        status: z.enum(['PUBLISHED', 'HIDDEN', 'ARCHIVED']),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'حالة الظهور المطلوبة غير صالحة' });
      }

      const nextStatus = parsed.data.status;
      const now = new Date();
      const [updated] = await db
        .update(courses)
        .set({
          publicationStatus: nextStatus,
          isPublished: nextStatus === 'PUBLISHED',
          archivedAt: nextStatus === 'ARCHIVED' ? now : null,
          updatedAt: now,
        })
        .where(eq(courses.id, courseId))
        .returning();

      if (!updated) return res.status(404).json({ error: 'الكورس غير موجود' });

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: `COURSE_VISIBILITY_${nextStatus}`,
        entityType: 'course',
        entityId: courseId,
        details: { titleAr: updated.titleAr, status: nextStatus },
        ipAddress: req.ip || '',
      });

      const msgMap: Record<typeof nextStatus, string> = {
        PUBLISHED: `تم إظهار ونشر الكورس "${updated.titleAr}" للطلاب بنجاح.`,
        HIDDEN: `تم إخفاء الكورس "${updated.titleAr}" مؤقتًا من صفحات الطلاب دون حذف أي بيانات.`,
        ARCHIVED: `تمت أرشفة الكورس "${updated.titleAr}" (أُخفي من المبيعات الجديدة مع الحفاظ على السجلات التاريخية والمشتركين الحاليين).`,
      };

      return res.json({ success: true, course: updated, message: msgMap[nextStatus] });
    } catch (error) {
      console.error('Update course visibility failed:', error);
      return res.status(500).json({ error: 'تعذر تحديث حالة ظهور الكورس' });
    }
  },
);

// 18B. Course Deletion Dependency Impact Analyzer
adminUpgradeRouter.get(
  '/courses/:id/deletion-impact',
  requirePermission(PERMISSIONS.COURSES_MANAGE),
  async (req: AuthRequest, res) => {
    try {
      const courseId = Number(req.params.id);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

      const [entRows, subRows, orderRows, examRows, hwRows, vidRows, codeRows] = await Promise.all([
        db
          .select({ id: entitlements.id, userId: entitlements.userId, isRevoked: entitlements.isRevoked })
          .from(entitlements)
          .where(and(eq(entitlements.targetType, 'COURSE'), eq(entitlements.targetId, courseId))),
        db.select({ id: subscriptions.id, userId: subscriptions.userId }).from(subscriptions).where(eq(subscriptions.courseId, courseId)),
        db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.targetType, 'COURSE'), eq(orders.targetId, courseId))),
        db.select({ id: exams.id }).from(exams).where(eq(exams.courseId, courseId)),
        db.select({ id: homeworkAssignments.id }).from(homeworkAssignments).where(eq(homeworkAssignments.courseId, courseId)),
        db.select({ id: videos.id }).from(videos).where(eq(videos.courseId, courseId)),
        db
          .select({ id: accessCodes.id, usedCount: accessCodes.usedCount })
          .from(accessCodes)
          .where(and(eq(accessCodes.targetType, 'COURSE'), eq(accessCodes.targetId, courseId))),
      ]);

      const historicalRecordsCount =
        entRows.length +
        subRows.length +
        orderRows.length +
        examRows.length +
        hwRows.length +
        codeRows.filter((c) => c.usedCount > 0).length;

      const canPhysicalDelete = historicalRecordsCount === 0;

      return res.json({
        courseId,
        courseTitleAr: course.titleAr,
        counts: {
          entitlements: entRows.length,
          activeSubscribers: new Set(entRows.filter((e) => !e.isRevoked).map((e) => e.userId)).size,
          subscriptions: subRows.length,
          orders: orderRows.length,
          linkedExams: examRows.length,
          linkedHomework: hwRows.length,
          linkedVideos: vidRows.length,
          redeemedCodes: codeRows.filter((c) => c.usedCount > 0).length,
        },
        canPhysicalDelete,
        mode: canPhysicalDelete ? 'PHYSICAL_DELETE' : 'ACTIVE_REMOVAL',
        explanationAr: canPhysicalDelete
          ? 'لا توجد سجلات مالية أو أكاديمية أو اشتراكات مرتبطة بهذا الكورس، لذا سيتم حذفه نهائيًا من قاعدة البيانات مع الإبقاء على الفيديوهات في المكتبة.'
          : 'يحتوي الكورس على سجلات تاريخية (مشتركين أو طلبات دفع أو امتحانات أو واجبات أو أكواد مستخدمة). لحماية السلامة المالية والأكاديمية، ستتم إزالة الكورس نهائيًا من المنصة النشطة (REMOVED) وفك ارتباط الفيديوهات مع الحفاظ على السجلات التاريخية وسجل التدقيق.',
      });
    } catch (error) {
      console.error('Course deletion impact failed:', error);
      return res.status(500).json({ error: 'تعذر تحليل تأثير حذف الكورس' });
    }
  },
);

// 18C. SUPER_ADMIN-only Guarded Permanent Course Delete / Safe Active-Platform Removal
adminUpgradeRouter.post(
  '/courses/:id/permanent-delete',
  requirePermission(PERMISSIONS.COURSES_MANAGE),
  async (req: AuthRequest, res) => {
    try {
      if (req.authUser!.roleSlug !== 'SUPER_ADMIN') {
        return res.status(403).json({
          error: 'هذا الإجراء الحساس مقتصر على المدير العام (SUPER_ADMIN) فقط.',
        });
      }

      const courseId = Number(req.params.id);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
      }

      const schema = z.object({
        currentPassword: z.string().min(1, 'كلمة مرور المدير العام مطلوبة للتأكيد'),
        confirmCourseTitle: z.string().trim().min(1, 'يرجى كتابة اسم الكورس للتأكيد'),
        backupConfirmed: z.boolean(),
        reason: z.string().trim().max(300).optional().default(''),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'يرجى استكمال جميع خطوات التحقق قبل الحذف النهائي.' });
      }
      if (!parsed.data.backupConfirmed) {
        return res.status(400).json({ error: 'يرجى تأكيد التحقق من النسخة الاحتياطية قبل تنفيذ الحذف النهائي.' });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

      if (parsed.data.confirmCourseTitle.trim() !== course.titleAr.trim()) {
        return res.status(400).json({
          error: `اسم الكورس المدخل لا يطابق الاسم الفعلي ("${course.titleAr}").`,
        });
      }

      // Step-up password verification against current Super Admin's DB hash
      const [adminRow] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, req.authUser!.id))
        .limit(1);
      if (!adminRow || !verifyPassword(parsed.data.currentPassword, adminRow.passwordHash)) {
        return res.status(401).json({ error: 'كلمة مرور المدير العام غير صحيحة.' });
      }

      const [entRows, subRows, orderRows, examRows, hwRows, codeRows] = await Promise.all([
        db
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(and(eq(entitlements.targetType, 'COURSE'), eq(entitlements.targetId, courseId))),
        db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.courseId, courseId)),
        db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.targetType, 'COURSE'), eq(orders.targetId, courseId))),
        db.select({ id: exams.id }).from(exams).where(eq(exams.courseId, courseId)),
        db.select({ id: homeworkAssignments.id }).from(homeworkAssignments).where(eq(homeworkAssignments.courseId, courseId)),
        db
          .select({ id: accessCodes.id, usedCount: accessCodes.usedCount })
          .from(accessCodes)
          .where(and(eq(accessCodes.targetType, 'COURSE'), eq(accessCodes.targetId, courseId))),
      ]);

      const hasProtectedHistory =
        entRows.length > 0 ||
        subRows.length > 0 ||
        orderRows.length > 0 ||
        examRows.length > 0 ||
        hwRows.length > 0 ||
        codeRows.some((c) => c.usedCount > 0);

      if (!hasProtectedHistory) {
        await db.transaction(async (tx) => {
          await tx.update(videos).set({ courseId: null }).where(eq(videos.courseId, courseId));
          await tx.delete(courseLessons).where(eq(courseLessons.courseId, courseId));
          await tx.delete(courseStudentBlocks).where(eq(courseStudentBlocks.courseId, courseId));
          await tx.delete(courses).where(eq(courses.id, courseId));
        });

        await logAudit({
          actorId: req.authUser!.id,
          actorName: req.authUser!.fullName,
          action: 'COURSE_PERMANENTLY_DELETED',
          entityType: 'course',
          entityId: courseId,
          details: { titleAr: course.titleAr, mode: 'PHYSICAL_DELETE', reason: parsed.data.reason },
          ipAddress: req.ip || '',
        });

        return res.json({
          success: true,
          mode: 'PHYSICAL_DELETE',
          message: `تم حذف الكورس "${course.titleAr}" نهائيًا من قاعدة البيانات بنجاح (مع الإبقاء على الفيديوهات في المكتبة).`,
        });
      }

      // Protected financial/academic history exists -> honest active-platform removal
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(videos).set({ courseId: null }).where(eq(videos.courseId, courseId));
        await tx.delete(courseLessons).where(eq(courseLessons.courseId, courseId));
        await tx
          .update(courses)
          .set({
            publicationStatus: 'REMOVED',
            isPublished: false,
            removedAt: now,
            removedById: req.authUser!.id,
            removalReason: parsed.data.reason || 'إزالة دائمة من المنصة النشطة مع حفظ السجلات التاريخية',
            updatedAt: now,
          })
          .where(eq(courses.id, courseId));
      });

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'COURSE_REMOVED_FROM_PLATFORM',
        entityType: 'course',
        entityId: courseId,
        details: {
          titleAr: course.titleAr,
          mode: 'ACTIVE_REMOVAL',
          reason: parsed.data.reason,
          preservedCounts: {
            entitlements: entRows.length,
            subscriptions: subRows.length,
            orders: orderRows.length,
            exams: examRows.length,
            homework: hwRows.length,
          },
        },
        ipAddress: req.ip || '',
      });

      return res.json({
        success: true,
        mode: 'ACTIVE_REMOVAL',
        message: `تمت إزالة الكورس "${course.titleAr}" نهائيًا من المنصة النشطة وإخفاؤه عن جميع الطلاب، مع الحفاظ الكامل على السجلات المالية والأكاديمية وسجل التدقيق.`,
      });
    } catch (error) {
      console.error('Permanent course delete failed:', error);
      return res.status(500).json({ error: 'تعذر تنفيذ عملية الحذف النهائي للكورس' });
    }
  },
);

// 18D. Per-Course Student Block (restricts student ONLY from this course; other courses stay accessible)
adminUpgradeRouter.post(
  '/courses/:id/subscribers/:userId/block',
  requirePermission(PERMISSIONS.STUDENT_ACCESS_REVOKE),
  async (req: AuthRequest, res) => {
    try {
      const courseId = Number(req.params.id);
      const userId = Number(req.params.userId);
      if (!Number.isInteger(courseId) || courseId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'بيانات الكورس أو الطالب غير صالحة' });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

      const target = await resolveStrictStudentTarget(userId);
      if (!target.ok) return res.status(target.statusCode).json({ error: target.errorAr });

      const reason = String(req.body?.reason || '').trim().slice(0, 300);
      const now = new Date();

      await db
        .insert(courseStudentBlocks)
        .values({
          courseId,
          userId,
          isActive: true,
          reason,
          blockedById: req.authUser!.id,
          blockedAt: now,
          restoredAt: null,
          restoredById: null,
        })
        .onConflictDoUpdate({
          target: [courseStudentBlocks.courseId, courseStudentBlocks.userId],
          set: {
            isActive: true,
            reason,
            blockedById: req.authUser!.id,
            blockedAt: now,
            restoredAt: null,
            restoredById: null,
          },
        });

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'COURSE_STUDENT_BLOCKED',
        entityType: 'course',
        entityId: courseId,
        details: { userId, studentName: target.user.fullName, courseTitleAr: course.titleAr, reason },
        ipAddress: req.ip || '',
      });

      await createNotification({
        userId,
        titleAr: 'تنبيه بخصوص صلاحية كورس',
        bodyAr: `تم تقييد وصولك إلى كورس "${course.titleAr}" مؤقتًا${reason ? ` (${reason})` : ''}. باقي الكورسات المشترك بها لم تتأثر.`,
        type: 'GENERAL',
        targetType: 'COURSES',
        targetId: courseId,
      });

      return res.json({
        success: true,
        message: `تم حظر الطالب "${target.user.fullName}" من كورس "${course.titleAr}" فقط بنجاح (دون التأثير على باقي كورساته).`,
      });
    } catch (error) {
      console.error('Course student block failed:', error);
      return res.status(500).json({ error: 'تعذر حظر الطالب من الكورس' });
    }
  },
);

// 18E. Restore Student Access to a Specific Course
adminUpgradeRouter.post(
  '/courses/:id/subscribers/:userId/restore',
  requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT),
  async (req: AuthRequest, res) => {
    try {
      const courseId = Number(req.params.id);
      const userId = Number(req.params.userId);
      if (!Number.isInteger(courseId) || courseId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'بيانات الكورس أو الطالب غير صالحة' });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
      if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

      const target = await resolveStrictStudentTarget(userId);
      if (!target.ok) return res.status(target.statusCode).json({ error: target.errorAr });

      const now = new Date();
      await db
        .update(courseStudentBlocks)
        .set({
          isActive: false,
          restoredAt: now,
          restoredById: req.authUser!.id,
        })
        .where(and(eq(courseStudentBlocks.courseId, courseId), eq(courseStudentBlocks.userId, userId)));

      await logAudit({
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
        action: 'COURSE_STUDENT_RESTORED',
        entityType: 'course',
        entityId: courseId,
        details: { userId, studentName: target.user.fullName, courseTitleAr: course.titleAr },
        ipAddress: req.ip || '',
      });

      await createNotification({
        userId,
        titleAr: 'تمت استعادة صلاحية الكورس',
        bodyAr: `تمت إعادة فتح وصولك إلى كورس "${course.titleAr}" بنجاح.`,
        type: 'GENERAL',
        targetType: 'COURSE',
        targetId: courseId,
      });

      return res.json({
        success: true,
        message: `تمت استعادة وصول الطالب "${target.user.fullName}" إلى كورس "${course.titleAr}" بنجاح.`,
      });
    } catch (error) {
      console.error('Course student restore failed:', error);
      return res.status(500).json({ error: 'تعذر استعادة صلاحية الطالب للكورس' });
    }
  },
);

// 19. Add Subscriber Manually to Course
adminUpgradeRouter.post('/courses/:id/subscribers/add', requirePermission(PERMISSIONS.STUDENT_ACCESS_GRANT), async (req: AuthRequest, res) => {
  try {
    const courseId = Number(req.params.id);
    const schema = z.object({
      userId: z.coerce.number().int().positive(),
      durationDays: z.preprocess(preprocessLocalizedNumber, z.coerce.number().int().min(0).max(3650)).optional().default(0),
      expiresAt: z.string().nullable().optional(),
      note: z.string().trim().max(240).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(courseId) || courseId <= 0 || !parsed.success) {
      return res.status(400).json({ error: 'بيانات إضافة المشترك غير صالحة' });
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

    const studentTarget = await resolveStrictStudentTarget(parsed.data.userId);
    if (!studentTarget.ok) {
      return res.status(studentTarget.statusCode).json({ error: studentTarget.errorAr });
    }
    const student = studentTarget.user;

    const existingEnts = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, student.id),
          eq(entitlements.targetType, 'COURSE'),
          eq(entitlements.targetId, courseId),
          eq(entitlements.isRevoked, false),
        ),
      );
    const now = new Date();
    if (existingEnts.some((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now.getTime())) {
      return res.status(409).json({ error: 'الطالب مشترك بالفعل ويملك صلاحية نشطة لهذا الكورس.' });
    }

    let expiresAt: Date | null = null;
    if (parsed.data.expiresAt) {
      const dt = new Date(parsed.data.expiresAt);
      if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'تاريخ الانتهاء غير صالح' });
      expiresAt = dt;
    } else if (parsed.data.durationDays > 0) {
      expiresAt = new Date(Date.now() + parsed.data.durationDays * 86400_000);
    }

    const [created] = await db
      .insert(entitlements)
      .values({
        userId: student.id,
        targetType: 'COURSE',
        targetId: courseId,
        source: 'MANUAL_GRANT',
        priority: getSourcePriority('MANUAL_GRANT'),
        expiresAt,
        grantedById: req.authUser!.id,
        note: parsed.data.note || `إضافة يدوية إلى كورس ${course.titleAr}`,
      })
      .returning();

    await createNotification({
      userId: student.id,
      titleAr: 'تمت إضافتك إلى كورس جديد',
      bodyAr: `منحك المدرس صلاحية الوصول إلى كورس "${course.titleAr}".`,
      type: 'GENERAL',
    });

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COURSE_SUBSCRIBER_ADDED',
      entityType: 'course',
      entityId: courseId,
      details: { userId: student.id, studentName: student.fullName, expiresAt: expiresAt?.toISOString() || 'PERMANENT' },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      entitlement: created,
      message: `تمت إضافة "${student.fullName}" إلى الكورس بنجاح.`,
    });
  } catch (error) {
    console.error('Add course subscriber failed:', error);
    return res.status(500).json({ error: 'تعذر إضافة الطالب إلى الكورس' });
  }
});

// ============================================================
// PHASE C — COMPLETE COUPON MANAGEMENT & USAGE DETAILS
// ============================================================

// 20. List All Coupons with Computed Status & Eligible Courses
adminUpgradeRouter.get('/coupons', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (_req, res) => {
  try {
    const [cpRows, cRows] = await Promise.all([
      db.select().from(coupons).orderBy(desc(coupons.createdAt)),
      db.select({ id: courses.id, titleAr: courses.titleAr }).from(courses),
    ]);
    const courseMap = new Map(cRows.map((c) => [c.id, c.titleAr]));
    const now = new Date();

    return res.json({
      coupons: cpRows.map((cp) => {
        const eligibleIds = Array.isArray(cp.eligibleCourseIdsJson) ? cp.eligibleCourseIdsJson : [];
        return {
          ...cp,
          derivedStatus: resolveCouponStatus(cp, now),
          remainingUses: Math.max(0, cp.maxUses - cp.usedCount),
          eligibleCourseTitles: eligibleIds.map((id) => courseMap.get(id) || `كورس #${id}`),
        };
      }),
    });
  } catch (error) {
    console.error('List coupons failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الكوبونات' });
  }
});

// 21. Create Full Coupon (Percent or Fixed, Eligible Courses, Expiry)
adminUpgradeRouter.post('/coupons', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      code: z.string().trim().min(3, 'كود الخصم يجب أن لا يقل عن 3 أحرف').max(32),
      discountType: z.enum(['PERCENT', 'FIXED']).default('PERCENT'),
      discountPercent: z.coerce.number().int().min(0).max(100).optional().default(0),
      discountAmountEgp: z.coerce.number().int().min(0).max(50000).optional().default(0),
      maxUses: z.coerce.number().int().min(1).max(100000).default(100),
      expiresAt: z.string().nullable().optional(),
      eligibleCourseIds: z.array(z.coerce.number().int().positive()).optional().default([]),
      isActive: z.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات الكوبون غير صالحة' });
    }

    const d = parsed.data;
    const normalizedCode = d.code.toUpperCase().replace(/\s+/g, '');
    if (d.discountType === 'PERCENT' && (d.discountPercent < 1 || d.discountPercent > 100)) {
      return res.status(400).json({ error: 'نسبة الخصم يجب أن تكون بين 1% و 100%' });
    }
    if (d.discountType === 'FIXED' && d.discountAmountEgp < 1) {
      return res.status(400).json({ error: 'قيمة الخصم الثابت يجب أن تكون أكبر من صفر' });
    }

    let expiresAt: Date | null = null;
    if (d.expiresAt) {
      const dt = new Date(d.expiresAt);
      if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'تاريخ انتهاء الكوبون غير صالح' });
      expiresAt = dt;
    }

    const dup = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, normalizedCode)).limit(1);
    if (dup.length > 0) {
      return res.status(409).json({ error: 'يوجد كوبون بنفس هذا الكود بالفعل' });
    }

    const [created] = await db
      .insert(coupons)
      .values({
        code: normalizedCode,
        discountType: d.discountType,
        discountPercent: d.discountType === 'PERCENT' ? d.discountPercent : 0,
        discountAmountEgp: d.discountType === 'FIXED' ? d.discountAmountEgp : 0,
        maxUses: d.maxUses,
        expiresAt,
        eligibleCourseIdsJson: Array.from(new Set(d.eligibleCourseIds)),
        isActive: d.isActive,
        isArchived: false,
      })
      .returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COUPON_CREATED',
      entityType: 'coupon',
      entityId: created.id,
      details: { code: created.code, discountType: created.discountType },
      ipAddress: req.ip || '',
    });

    return res.status(201).json({
      success: true,
      coupon: { ...created, derivedStatus: resolveCouponStatus(created) },
      message: `تم إنشاء كوبون الخصم ${created.code} بنجاح.`,
    });
  } catch (error) {
    console.error('Create coupon failed:', error);
    return res.status(500).json({ error: 'تعذر إنشاء كوبون الخصم' });
  }
});

// 22. Edit Coupon (Code editable ONLY if never used; never alters past orders)
adminUpgradeRouter.patch('/coupons/:id', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const couponId = Number(req.params.id);
    if (!Number.isInteger(couponId) || couponId <= 0) {
      return res.status(400).json({ error: 'معرّف الكوبون غير صالح' });
    }

    const [existing] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الكوبون غير موجود' });

    const schema = z.object({
      code: z.string().trim().min(3).max(32).optional(),
      discountType: z.enum(['PERCENT', 'FIXED']).optional(),
      discountPercent: z.coerce.number().int().min(0).max(100).optional(),
      discountAmountEgp: z.coerce.number().int().min(0).max(50000).optional(),
      maxUses: z.coerce.number().int().min(1).max(100000).optional(),
      expiresAt: z.string().nullable().optional(),
      eligibleCourseIds: z.array(z.coerce.number().int().positive()).optional(),
      isActive: z.boolean().optional(),
      isArchived: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات تعديل الكوبون غير صالحة' });
    }

    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (d.code !== undefined) {
      const normalized = d.code.toUpperCase().replace(/\s+/g, '');
      if (normalized !== existing.code) {
        if (existing.usedCount > 0) {
          return res.status(409).json({
            error: 'لا يمكن تغيير نص كود الكوبون بعد استخدامه من قِبل الطلاب حفاظًا على سجل الطلبات المالية.',
          });
        }
        const dup = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, normalized)).limit(1);
        if (dup.length > 0 && dup[0].id !== couponId) {
          return res.status(409).json({ error: 'هذا الكود مستخدم بالفعل في كوبون آخر' });
        }
        updates.code = normalized;
      }
    }

    const nextType = d.discountType || (existing.discountType as 'PERCENT' | 'FIXED') || 'PERCENT';
    if (d.discountType !== undefined) updates.discountType = d.discountType;
    if (d.discountPercent !== undefined) updates.discountPercent = d.discountPercent;
    if (d.discountAmountEgp !== undefined) updates.discountAmountEgp = d.discountAmountEgp;
    if (nextType === 'PERCENT' && updates.discountPercent === 0 && d.discountType === 'PERCENT') {
      return res.status(400).json({ error: 'يرجى تحديد نسبة خصم صحيحة أكبر من صفر' });
    }
    if (nextType === 'FIXED' && updates.discountAmountEgp === 0 && d.discountType === 'FIXED') {
      return res.status(400).json({ error: 'يرجى تحديد مبلغ خصم ثابت أكبر من صفر' });
    }

    if (d.maxUses !== undefined) {
      if (d.maxUses < existing.usedCount) {
        return res.status(400).json({
          error: `لا يمكن جعل الحد الأقصى أقل من عدد الاستخدامات الحالية (${existing.usedCount}).`,
        });
      }
      updates.maxUses = d.maxUses;
    }

    if (d.expiresAt !== undefined) {
      if (!d.expiresAt) {
        updates.expiresAt = null;
      } else {
        const dt = new Date(d.expiresAt);
        if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'تاريخ الانتهاء غير صالح' });
        updates.expiresAt = dt;
      }
    }

    if (d.eligibleCourseIds !== undefined) {
      updates.eligibleCourseIdsJson = Array.from(new Set(d.eligibleCourseIds));
    }
    if (d.isActive !== undefined) updates.isActive = d.isActive;
    if (d.isArchived !== undefined) {
      updates.isArchived = d.isArchived;
      if (d.isArchived) updates.isActive = false;
    }

    const [updated] = await db.update(coupons).set(updates).where(eq(coupons.id, couponId)).returning();

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COUPON_UPDATED',
      entityType: 'coupon',
      entityId: couponId,
      details: { code: updated.code, isActive: updated.isActive, isArchived: updated.isArchived },
      ipAddress: req.ip || '',
    });

    return res.json({
      success: true,
      coupon: { ...updated, derivedStatus: resolveCouponStatus(updated) },
      message: `تم تحديث الكوبون ${updated.code} بنجاح.`,
    });
  } catch (error) {
    console.error('Update coupon failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث الكوبون' });
  }
});

// 23. Coupon Usage Details (Real Redeemed Orders & Students)
adminUpgradeRouter.get('/coupons/:id/usage', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const couponId = Number(req.params.id);
    if (!Number.isInteger(couponId) || couponId <= 0) {
      return res.status(400).json({ error: 'معرّف الكوبون غير صالح' });
    }

    const [cp] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!cp) return res.status(404).json({ error: 'الكوبون غير موجود' });

    const [redemptionOrders, allCourses] = await Promise.all([
      db
        .select({
          order: orders,
          studentName: users.fullName,
          studentPhone: users.phone,
        })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))
        .where(eq(orders.couponCode, cp.code))
        .orderBy(desc(orders.createdAt)),
      db.select({ id: courses.id, titleAr: courses.titleAr }).from(courses),
    ]);

    const courseMap = new Map(allCourses.map((c) => [c.id, c.titleAr]));
    const eligibleIds = Array.isArray(cp.eligibleCourseIdsJson) ? cp.eligibleCourseIdsJson : [];

    return res.json({
      coupon: {
        ...cp,
        derivedStatus: resolveCouponStatus(cp),
        remainingUses: Math.max(0, cp.maxUses - cp.usedCount),
        eligibleCourseTitles: eligibleIds.map((id) => courseMap.get(id) || `كورس #${id}`),
        canDeletePermanently: cp.usedCount === 0 && redemptionOrders.length === 0,
      },
      usages: redemptionOrders.map((r) => ({
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        userId: r.order.userId,
        studentName: r.studentName,
        studentPhone: r.studentPhone,
        targetTitleAr: r.order.targetTitleAr,
        amountEgp: r.order.amountEgp,
        discountEgp: r.order.discountEgp,
        finalAmountEgp: r.order.finalAmountEgp,
        status: r.order.status,
        createdAt: r.order.createdAt,
      })),
    });
  } catch (error) {
    console.error('Coupon usage load failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل استخدام الكوبون' });
  }
});

// 24. Safe Coupon Delete (Unused only; used coupons must be disabled/archived)
adminUpgradeRouter.delete('/coupons/:id', requirePermission(PERMISSIONS.COUPONS_MANAGE), async (req: AuthRequest, res) => {
  try {
    const couponId = Number(req.params.id);
    if (!Number.isInteger(couponId) || couponId <= 0) {
      return res.status(400).json({ error: 'معرّف الكوبون غير صالح' });
    }

    const txDel = await db.transaction(async (tx) => {
      const [cp] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
      if (!cp) return { status: 404 as const, error: 'الكوبون غير موجود' };

      const linkedOrders = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.couponCode, cp.code))
        .limit(1);

      if (cp.usedCount > 0 || linkedOrders.length > 0) {
        return {
          status: 409 as const,
          error: 'لا يمكن حذف كوبون تم استخدامه سابقًا حفاظًا على السجلات المالية. استخدم "تعطيل / أرشفة الكوبون" بدلًا من ذلك.',
        };
      }

      const deleted = await tx
        .delete(coupons)
        .where(and(eq(coupons.id, couponId), eq(coupons.usedCount, 0)))
        .returning({ id: coupons.id });
      if (!deleted.length) {
        return { status: 409 as const, error: 'تم استخدام الكوبون للتو ولا يمكن حذفه.' };
      }

      return { status: 200 as const, code: cp.code };
    });

    if (txDel.status !== 200) {
      return res.status(txDel.status).json({ error: txDel.error });
    }

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'COUPON_DELETED',
      entityType: 'coupon',
      entityId: couponId,
      details: { code: txDel.code },
      ipAddress: req.ip || '',
    });

    return res.json({ success: true, message: `تم حذف الكوبون ${txDel.code} بنجاح.` });
  } catch (error) {
    console.error('Delete coupon failed:', error);
    return res.status(500).json({ error: 'تعذر حذف الكوبون' });
  }
});
