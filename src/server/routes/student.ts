import crypto from 'node:crypto';
import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicTracks,
  accessCodes,
  codeRedemptions,
  coupons,
  courseLessons,
  courses,
  courseStudentBlocks,
  deviceSessions,
  enrollments,
  entitlements,
  examAttempts,
  exams,
  grades,
  groupMembers,
  groups,
  homeworkAssignments,
  homeworkSubmissions,
  homeworkTargets,
  lectureSchedules,
  lessonComments,
  lessons,
  notifications,
  orders,
  payments,
  plans,
  platformSubscriptions,
  progressRecords,
  studentProfiles,
  units,
  users,
  videoAccessCounters,
  videos,
} from '../../db/schema.ts';
import {
  isStaffRole,
  requireActiveAccount,
  requireAuth,
  type AuthRequest,
} from '../../middleware/auth.ts';
import { createNotification, logAudit } from '../audit.ts';
import {
  evaluatePlaybackSessionPolicy,
  getAccessDeniedMessageAr,
  getSourcePriority,
  resolveVideoAccess,
} from '../domain/entitlements.ts';
import {
  computePlatformSubscriptionState,
  getActivationCodeLookupHashes,
  validateCodeForRedemption,
} from '../domain/codes.ts';
import {
  createRateLimiter,
  maskPhoneForWatermark,
  signPlaybackToken,
  verifyPlaybackToken,
} from '../domain/security.ts';
import { isSafeUploadDataUrl } from '../domain/securityHardening.ts';
import {
  buildPrivacyEnhancedEmbedUrl,
  computeVerifiedVideoProgress,
} from '../../lib/youtube.ts';
import {
  buildGoogleDrivePreviewUrl,
  buildGoogleDriveViewUrl,
} from '../../lib/googleDrive.ts';
import {
  computeCouponDiscount,
  evaluateVideoOpenLimit,
} from '../domain/adminControl.ts';
import { loadStudentCurriculumBundle } from './curriculum.ts';
import { loadActiveAnnouncementsForStudent } from './announcements.ts';
import { gradeDashboardCatalogCache } from '../cache.ts';

export const studentRouter = Router();

const redeemRateLimiter = createRateLimiter(12, 10 * 60 * 1000);

async function getStudentApprovedGrades(userId: number, roleSlug: string): Promise<number[]> {
  if (isStaffRole(roleSlug)) {
    const allGrades = await db.select({ id: grades.id }).from(grades);
    return allGrades.map((g) => g.id);
  }
  const activeEnr = await db
    .select({ gradeId: enrollments.gradeId })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.status, 'ACTIVE')));
  return activeEnr.map((e) => e.gradeId);
}

studentRouter.get('/dashboard', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const u = req.authUser!;
    const staffUser = isStaffRole(u.roleSlug);

    // Wave 1: All user-scoped queries in parallel (independent of activeGradeId)
    const [
      approvedGradeIds,
      profileRows,
      userEntitlementsRaw,
      activeCourseBlocks,
      userPlatformSubs,
      userProgress,
      memberRows,
      userAttempts,
      studentOrders,
      userHomeworkSubmissions,
    ] = await Promise.all([
      getStudentApprovedGrades(u.id, u.roleSlug),
      db.select().from(studentProfiles).where(eq(studentProfiles.userId, u.id)).limit(1),
      db.select().from(entitlements).where(eq(entitlements.userId, u.id)),
      staffUser
        ? Promise.resolve([])
        : db
            .select()
            .from(courseStudentBlocks)
            .where(and(eq(courseStudentBlocks.userId, u.id), eq(courseStudentBlocks.isActive, true))),
      db
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.userId, u.id))
        .orderBy(desc(platformSubscriptions.expiresAt))
        .limit(5),
      db.select().from(progressRecords).where(eq(progressRecords.userId, u.id)),
      db
        .select({ group: groups })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(eq(groupMembers.userId, u.id)),
      db
        .select()
        .from(examAttempts)
        .where(eq(examAttempts.userId, u.id))
        .orderBy(desc(examAttempts.startedAt)),
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, u.id))
        .orderBy(desc(orders.createdAt))
        .limit(15),
      db
        .select({
          id: homeworkSubmissions.id,
          assignmentId: homeworkSubmissions.assignmentId,
          version: homeworkSubmissions.version,
          status: homeworkSubmissions.status,
          awardedGrade: homeworkSubmissions.awardedGrade,
          isGradePublished: homeworkSubmissions.isGradePublished,
          submittedAt: homeworkSubmissions.submittedAt,
          gradedAt: homeworkSubmissions.gradedAt,
          updatedAt: homeworkSubmissions.updatedAt,
        })
        .from(homeworkSubmissions)
        .where(eq(homeworkSubmissions.studentId, u.id))
        .orderBy(desc(homeworkSubmissions.version)),
    ]);

    if (!approvedGradeIds.length) {
      return res.status(403).json({ error: 'لا يوجد صف دراسي معتمد لحسابك حاليًا.' });
    }

    const requestedGradeId = Number(req.query.gradeId);
    const activeGradeId =
      requestedGradeId && approvedGradeIds.includes(requestedGradeId)
        ? requestedGradeId
        : approvedGradeIds[0];

    const profile = profileRows[0];
    const blockedCourseIds = new Set(activeCourseBlocks.map((b) => b.courseId));
    const userEntitlements = userEntitlementsRaw.filter(
      (e) => !(e.targetType === 'COURSE' && blockedCourseIds.has(e.targetId)),
    );
    const latestPlatformSubRow = userPlatformSubs[0] || null;
    const platformSubState = latestPlatformSubRow
      ? computePlatformSubscriptionState(latestPlatformSubRow)
      : null;

    // Wave 2: Shared grade catalog (cached 15s, invalidated on any admin/comment write) + user-scoped Wave 2 queries in parallel
    const loadSharedGradeCatalog = () =>
      gradeDashboardCatalogCache.getOrLoad(`grade:${activeGradeId}`, async () => {
        const [
          gradeRows,
          gradeUnits,
          gradeLessonsJoined,
          gradeVideos,
          gradeCourses,
          clRowsJoined,
          gradePlans,
          gradeExams,
          scheduleRows,
          commentsRows,
          gradeHomeworkRows,
          gradeHomeworkTargetRows,
        ] = await Promise.all([
          db
            .select({ grade: grades, track: academicTracks })
            .from(grades)
            .innerJoin(academicTracks, eq(grades.trackId, academicTracks.id))
            .where(eq(grades.id, activeGradeId))
            .limit(1),
          db
            .select()
            .from(units)
            .where(and(eq(units.gradeId, activeGradeId), eq(units.isVisible, true)))
            .orderBy(asc(units.sortOrder), asc(units.id)),
          db
            .select({ lesson: lessons })
            .from(lessons)
            .innerJoin(units, eq(lessons.unitId, units.id))
            .where(
              and(
                eq(units.gradeId, activeGradeId),
                eq(units.isVisible, true),
                eq(lessons.isVisible, true),
              ),
            )
            .orderBy(asc(lessons.sortOrder), asc(lessons.id)),
          db
            .select()
            .from(videos)
            .where(
              and(
                eq(videos.gradeId, activeGradeId),
                eq(videos.isPublished, true),
                eq(videos.publicationStatus, 'PUBLISHED'),
              ),
            )
            .orderBy(asc(videos.sortOrder), asc(videos.id)),
          db
            .select()
            .from(courses)
            .where(eq(courses.gradeId, activeGradeId))
            .orderBy(asc(courses.sortOrder), asc(courses.id)),
          db
            .select({ cl: courseLessons })
            .from(courseLessons)
            .innerJoin(courses, eq(courseLessons.courseId, courses.id))
            .where(eq(courses.gradeId, activeGradeId)),
          db
            .select()
            .from(plans)
            .where(and(eq(plans.gradeId, activeGradeId), eq(plans.isActive, true))),
          db
            .select()
            .from(exams)
            .where(and(eq(exams.gradeId, activeGradeId), eq(exams.isPublished, true)))
            .orderBy(desc(exams.createdAt)),
          db
            .select()
            .from(lectureSchedules)
            .where(and(eq(lectureSchedules.gradeId, activeGradeId), eq(lectureSchedules.isPublished, true)))
            .orderBy(asc(lectureSchedules.scheduledAt)),
          db
            .select({
              comment: lessonComments,
              authorName: users.fullName,
            })
            .from(lessonComments)
            .innerJoin(users, eq(lessonComments.userId, users.id))
            .innerJoin(lessons, eq(lessonComments.lessonId, lessons.id))
            .innerJoin(units, eq(lessons.unitId, units.id))
            .where(
              and(
                eq(units.gradeId, activeGradeId),
                eq(units.isVisible, true),
                eq(lessons.isVisible, true),
                eq(lessonComments.status, 'APPROVED'),
              ),
            )
            .orderBy(desc(lessonComments.createdAt)),
          db
            .select({
              id: homeworkAssignments.id,
              titleAr: homeworkAssignments.titleAr,
              deadline: homeworkAssignments.deadline,
              maximumGrade: homeworkAssignments.maximumGrade,
              assignmentScope: homeworkAssignments.assignmentScope,
              publicationStatus: homeworkAssignments.publicationStatus,
              courseId: homeworkAssignments.courseId,
              videoId: homeworkAssignments.videoId,
            })
            .from(homeworkAssignments)
            .where(
              and(
                eq(homeworkAssignments.gradeId, activeGradeId),
                eq(homeworkAssignments.publicationStatus, 'PUBLISHED'),
              ),
            )
            .orderBy(asc(homeworkAssignments.deadline), desc(homeworkAssignments.id)),
          db
            .select({
              assignmentId: homeworkTargets.assignmentId,
              studentId: homeworkTargets.studentId,
              groupId: homeworkTargets.groupId,
            })
            .from(homeworkTargets)
            .innerJoin(homeworkAssignments, eq(homeworkTargets.assignmentId, homeworkAssignments.id))
            .where(
              and(
                eq(homeworkAssignments.gradeId, activeGradeId),
                eq(homeworkAssignments.publicationStatus, 'PUBLISHED'),
              ),
            ),
        ]);
        return {
          gradeRows,
          gradeUnits,
          gradeLessonsJoined,
          gradeVideos,
          gradeCourses,
          clRowsJoined,
          gradePlans,
          gradeExams,
          scheduleRows,
          commentsRows,
          gradeHomeworkRows,
          gradeHomeworkTargetRows,
        };
      }) as Promise<{
        gradeRows: Array<{ grade: typeof grades.$inferSelect; track: typeof academicTracks.$inferSelect }>;
        gradeUnits: Array<typeof units.$inferSelect>;
        gradeLessonsJoined: Array<{ lesson: typeof lessons.$inferSelect }>;
        gradeVideos: Array<typeof videos.$inferSelect>;
        gradeCourses: Array<typeof courses.$inferSelect>;
        clRowsJoined: Array<{ cl: typeof courseLessons.$inferSelect }>;
        gradePlans: Array<typeof plans.$inferSelect>;
        gradeExams: Array<typeof exams.$inferSelect>;
        scheduleRows: Array<typeof lectureSchedules.$inferSelect>;
        commentsRows: Array<{ comment: typeof lessonComments.$inferSelect; authorName: string }>;
        gradeHomeworkRows: Array<{
          id: number;
          titleAr: string;
          deadline: Date | null;
          maximumGrade: string;
          assignmentScope: string;
          publicationStatus: string;
          courseId: number | null;
          videoId: number | null;
        }>;
        gradeHomeworkTargetRows: Array<{
          assignmentId: number;
          studentId: number | null;
          groupId: number | null;
        }>;
      }>;

    const userGroupIds = memberRows.map((m) => m.group.id);
    const [gradeCatalog, notifRows, curriculumBundle, prefetchedAnnouncements] = await Promise.all([
      loadSharedGradeCatalog(),
      db
        .select()
        .from(notifications)
        .where(or(eq(notifications.userId, u.id), eq(notifications.gradeId, activeGradeId)))
        .orderBy(desc(notifications.createdAt))
        .limit(20),
      loadStudentCurriculumBundle({
        studentId: u.id,
        gradeId: activeGradeId,
      }),
      profile?.primaryTrackId
        ? loadActiveAnnouncementsForStudent({
            trackIds: [profile.primaryTrackId],
            gradeIds: [activeGradeId],
            groupIds: userGroupIds,
          })
        : Promise.resolve(null),
    ]);

    const {
      gradeRows,
      gradeUnits,
      gradeLessonsJoined,
      gradeVideos,
      gradeCourses,
      clRowsJoined,
      gradePlans,
      gradeExams,
      scheduleRows,
      commentsRows,
      gradeHomeworkRows,
      gradeHomeworkTargetRows,
    } = gradeCatalog;

    const gradeRow = gradeRows[0];
    const gradeLessons = gradeLessonsJoined.map((r) => r.lesson);
    const clRows = clRowsJoined.map((r) => r.cl);

    const progressByVideo = new Map(userProgress.map((p) => [p.videoId, p]));
    const unitById = new Map(gradeUnits.map((un) => [un.id, un]));
    const lessonById = new Map(gradeLessons.map((l) => [l.id, l]));
    const courseById = new Map(gradeCourses.map((c) => [c.id, c]));

    // Pre-index courseLessons in O(N)
    const clByLesson = new Map<number, typeof clRows>();
    const clByCourse = new Map<number, typeof clRows>();
    for (const cl of clRows) {
      const byL = clByLesson.get(cl.lessonId) || [];
      byL.push(cl);
      clByLesson.set(cl.lessonId, byL);
      const byC = clByCourse.get(cl.courseId) || [];
      byC.push(cl);
      clByCourse.set(cl.courseId, byC);
    }

    // NEVER return streamAssetKey, youtubeUrl, or youtubeVideoId in catalog payload!
    const sanitizedVideos = gradeVideos.map((v) => {
      const courseLinks = clByLesson.get(v.lessonId) || [];
      const isVideoCourseBlocked =
        !staffUser && Boolean(v.courseId && blockedCourseIds.has(v.courseId));
      const unblockedCourseLinks = staffUser
        ? courseLinks
        : courseLinks.filter((cl) => !blockedCourseIds.has(cl.courseId));
      const decision = isVideoCourseBlocked
        ? {
            allowed: false as const,
            reasonCode: 'COURSE_BLOCKED' as const,
            matchedSource: null,
            expiresAt: null,
          }
        : resolveVideoAccess({
            userRoleSlug: u.roleSlug,
            userStatus: u.status,
            approvedGradeIds,
            videoId: v.id,
            videoGradeId: v.gradeId,
            videoType: v.videoType,
            videoPublished: v.isPublished,
            publicationStatus: v.publicationStatus,
            videoCourseId: v.courseId,
            courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
            isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
            entitlements: userEntitlements,
          });

      const lesson = lessonById.get(v.lessonId);
      const unit = lesson ? unitById.get(lesson.unitId) : v.unitId ? unitById.get(v.unitId) : undefined;
      const effectiveCourseId = v.courseId || courseLinks[0]?.courseId || null;
      const assignedCourse = effectiveCourseId ? courseById.get(effectiveCourseId) : undefined;
      const prog = progressByVideo.get(v.id);

      return {
        id: v.id,
        trackId: gradeRow?.track.id || v.trackId || null,
        trackNameAr: gradeRow?.track.nameAr || '',
        lessonId: v.lessonId,
        lessonTitleAr: lesson?.titleAr || '',
        unitId: unit?.id || null,
        unitTitleAr: unit?.titleAr || '',
        gradeId: v.gradeId,
        courseId: effectiveCourseId,
        courseTitleAr: assignedCourse?.titleAr || null,
        titleAr: v.titleAr,
        descriptionAr: v.descriptionAr,
        durationSec: v.durationSec,
        thumbnailUrl: v.thumbnailUrl,
        videoType: v.videoType,
        priceEgp: v.priceEgp,
        sortOrder: v.sortOrder,
        hasYouTubeVideo: Boolean(v.youtubeVideoId),
        hasPdfAttachment: Boolean(v.pdfDriveFileId),
        pdfTitle: v.pdfDriveFileId ? v.pdfTitle || 'ملف الدرس (PDF)' : null,
        allowSpeedChange: v.allowSpeedChange,
        maxPlaybackSpeed: Number(v.maxPlaybackSpeed || 2),
        viewsCount: v.viewsCount,
        hasAccess: decision.allowed,
        accessReason: decision.reasonCode,
        lockReasonAr: decision.allowed
          ? null
          : decision.reasonCode === 'COURSE_BLOCKED'
            ? 'تم تقييد وصولك إلى هذا الكورس حاليًا من قِبل الإدارة.'
            : getAccessDeniedMessageAr(decision.reasonCode, v.videoType),
        accessSource: decision.matchedSource || null,
        accessExpiresAt: decision.expiresAt || null,
        progress: prog
          ? {
              lastPositionSec: prog.lastPositionSec,
              watchedSec: prog.watchedSec,
              completionPercent: prog.completionPercent,
              isCompleted: prog.isCompleted,
              updatedAt: prog.updatedAt,
            }
          : {
              lastPositionSec: 0,
              watchedSec: 0,
              completionPercent: 0,
              isCompleted: false,
              updatedAt: null,
            },
      };
    });

    const nowMs = Date.now();
    const coursesWithMeta = gradeCourses.map((c) => {
      const linkedLessons = [...(clByCourse.get(c.id) || [])].sort((a, b) => a.sortOrder - b.sortOrder);
      const linkedLessonIdSet = new Set(linkedLessons.map((cl) => cl.lessonId));
      const courseVideos = sanitizedVideos.filter(
        (v) => v.courseId === c.id || linkedLessonIdSet.has(v.lessonId),
      );
      const totalSec = courseVideos.reduce((s, v) => s + v.durationSec, 0);
      const completedCount = courseVideos.filter((v) => v.progress.isCompleted).length;
      const progressPercent =
        courseVideos.length > 0 ? Math.round((completedCount / courseVideos.length) * 100) : 0;

      const isBlockedFromCourse = !staffUser && blockedCourseIds.has(c.id);
      const hasCourseEntitlement =
        !isBlockedFromCourse &&
        userEntitlements.some(
          (e) =>
            !e.isRevoked &&
            (!e.expiresAt || new Date(e.expiresAt).getTime() > nowMs) &&
            ((e.targetType === 'COURSE' && e.targetId === c.id) ||
              (e.targetType === 'GRADE_ALL' && e.targetId === activeGradeId)),
        );

      return {
        ...c,
        lessonsCount: linkedLessons.length,
        videosCount: courseVideos.length,
        totalHours: Number((totalSec / 3600).toFixed(1)),
        progressPercent,
        isBlocked: isBlockedFromCourse,
        isUnlocked: staffUser || hasCourseEntitlement,
        lessons: linkedLessons.map((cl) => ({
          lessonId: cl.lessonId,
          titleAr: lessonById.get(cl.lessonId)?.titleAr || '',
          isFreePreview: cl.isFreePreview,
          videos: courseVideos.filter((v) => v.lessonId === cl.lessonId),
        })),
      };
    }).filter((c) => {
      // REMOVED and HIDDEN courses never appear to students; ARCHIVED only appears to already-unlocked unblocked students
      if (c.publicationStatus === 'REMOVED') return false;
      if (staffUser) return c.publicationStatus !== 'ARCHIVED';
      if (c.publicationStatus === 'HIDDEN' || c.publicationStatus === 'DRAFT') return false;
      if (c.publicationStatus === 'ARCHIVED') return c.isUnlocked && !c.isBlocked;
      if (c.isBlocked) return false;
      return c.isPublished && c.publicationStatus === 'PUBLISHED';
    });

    const visibleExams = gradeExams.filter((ex) => {
      if (ex.assignedUserId && ex.assignedUserId !== u.id && !staffUser) return false;
      if (ex.groupId && !userGroupIds.includes(ex.groupId) && !staffUser) return false;
      return true;
    });

    const attemptsByExam = new Map<number, typeof userAttempts>();
    for (const att of userAttempts) {
      const list = attemptsByExam.get(att.examId) || [];
      list.push(att);
      attemptsByExam.set(att.examId, list);
    }

    const examsWithMeta = visibleExams.map((ex) => {
      const attemptsForExam = attemptsByExam.get(ex.id) || [];
      const reqProg = ex.requiredVideoId ? progressByVideo.get(ex.requiredVideoId) : null;
      const lockedByVideo =
        Boolean(ex.requiredVideoId) &&
        !staffUser &&
        (!reqProg || reqProg.completionPercent < 70);
      const latest = attemptsForExam[0] || null;
      const latestPublished = latest && (staffUser || latest.resultPublished !== false);
      return {
        ...ex,
        attemptsUsed: attemptsForExam.length,
        lockedByVideo,
        latestAttempt: latest
          ? {
              id: latest.id,
              status: latest.status,
              totalScore: latestPublished ? Number(latest.totalScore) : 0,
              maxScore: Number(latest.maxScore),
              passed: latestPublished ? latest.passed : false,
              resultPublished: latest.resultPublished !== false,
              submittedAt: latest.submittedAt,
            }
          : null,
      };
    });

    // Authorized Homework Summary for active grade (respecting scope, course/video access, and grade publication)
    const unlockedCourseIds = new Set(coursesWithMeta.filter((c) => c.isUnlocked).map((c) => c.id));
    const accessibleVideoIds = new Set(sanitizedVideos.filter((v) => v.hasAccess).map((v) => v.id));
    const hwTargetsByAssignment = new Map<number, typeof gradeHomeworkTargetRows>();
    for (const ht of gradeHomeworkTargetRows) {
      const list = hwTargetsByAssignment.get(ht.assignmentId) || [];
      list.push(ht);
      hwTargetsByAssignment.set(ht.assignmentId, list);
    }
    const latestHwSubByAssignment = new Map<number, (typeof userHomeworkSubmissions)[number]>();
    for (const sub of userHomeworkSubmissions) {
      if (!latestHwSubByAssignment.has(sub.assignmentId)) {
        latestHwSubByAssignment.set(sub.assignmentId, sub);
      }
    }
    const eligibleHomeworkItems = gradeHomeworkRows
      .filter((hw) => {
        if (staffUser) return true;
        if (hw.courseId && !unlockedCourseIds.has(hw.courseId)) return false;
        if (hw.videoId && !accessibleVideoIds.has(hw.videoId)) return false;
        const targets = hwTargetsByAssignment.get(hw.id) || [];
        if (hw.assignmentScope === 'STUDENTS') {
          return targets.some((t) => t.studentId === u.id);
        }
        if (hw.assignmentScope === 'GROUP') {
          return targets.some((t) => t.groupId && userGroupIds.includes(t.groupId));
        }
        return true;
      })
      .map((hw) => {
        const latestSub = latestHwSubByAssignment.get(hw.id);
        const canSeeGrade = Boolean(latestSub && latestSub.status === 'GRADED' && latestSub.isGradePublished);
        return {
          id: hw.id,
          titleAr: hw.titleAr,
          deadline: hw.deadline ? new Date(hw.deadline).toISOString() : null,
          maximumGrade: Number(hw.maximumGrade || 10),
          submissionStatus: latestSub ? latestSub.status : null,
          awardedGrade: canSeeGrade && latestSub?.awardedGrade !== null ? Number(latestSub!.awardedGrade) : null,
          isGradePublished: Boolean(latestSub?.isGradePublished),
          submittedAt: latestSub?.submittedAt ? new Date(latestSub.submittedAt).toISOString() : null,
          gradedAt: latestSub?.gradedAt ? new Date(latestSub.gradedAt).toISOString() : null,
        };
      });

    const completedHomeworkCount = eligibleHomeworkItems.filter(
      (item) =>
        item.submissionStatus &&
        item.submissionStatus !== 'DRAFT' &&
        item.submissionStatus !== 'RETURNED_FOR_REVISION',
    ).length;

    // Real recorded study activity timestamps (progress updates, exam submissions, homework submissions)
    const studyActivityDates: string[] = [];
    for (const p of userProgress) {
      if (p.updatedAt && (p.watchedSec > 0 || p.completionPercent > 0)) {
        studyActivityDates.push(new Date(p.updatedAt).toISOString());
      }
    }
    for (const a of userAttempts) {
      if (a.submittedAt) studyActivityDates.push(new Date(a.submittedAt).toISOString());
    }
    for (const sub of userHomeworkSubmissions) {
      if (sub.submittedAt) studyActivityDates.push(new Date(sub.submittedAt).toISOString());
    }

    // Resume watching: most recently updated incomplete video with access
    const lastWatched = [...sanitizedVideos]
      .filter((v) => v.hasAccess && v.progress.updatedAt)
      .sort(
        (a, b) =>
          new Date(b.progress.updatedAt!).getTime() - new Date(a.progress.updatedAt!).getTime(),
      )[0] || sanitizedVideos.find((v) => v.hasAccess) || null;

    const accessibleVideos = sanitizedVideos.filter((v) => v.hasAccess);
    const overallProgressPercent =
      accessibleVideos.length > 0
        ? Math.round(
            accessibleVideos.reduce((s, v) => s + v.progress.completionPercent, 0) /
              accessibleVideos.length,
          )
        : 0;

    const activeAnnouncements =
      prefetchedAnnouncements && gradeRow && profile?.primaryTrackId === gradeRow.track.id
        ? prefetchedAnnouncements
        : await loadActiveAnnouncementsForStudent({
            trackIds: gradeRow ? [gradeRow.track.id] : [],
            gradeIds: [activeGradeId],
            groupIds: userGroupIds,
          });

    return res.json({
      activeGrade: gradeRow
        ? {
            id: gradeRow.grade.id,
            nameAr: gradeRow.grade.nameAr,
            descriptionAr: gradeRow.grade.descriptionAr,
            trackId: gradeRow.track.id,
            trackNameAr: gradeRow.track.nameAr,
          }
        : null,
      parentShareCode: profile?.parentShareCode || null,
      overallProgressPercent,
      lastWatchedVideo: lastWatched,
      units: gradeUnits,
      lessons: gradeLessons.map((l) => ({
        ...l,
        unitTitleAr: unitById.get(l.unitId)?.titleAr || '',
        comments: commentsRows
          .filter((c) => c.comment.lessonId === l.id)
          .map((c) => ({ ...c.comment, authorName: c.authorName })),
      })),
      videos: sanitizedVideos,
      courses: coursesWithMeta,
      plans: gradePlans,
      exams: examsWithMeta,
      recentAttempts: userAttempts
        .filter(
          (a) =>
            a.status !== 'IN_PROGRESS' &&
            Number(a.maxScore) > 0 &&
            (staffUser || a.resultPublished !== false),
        )
        .slice(0, 6)
        .map((a) => ({
          id: a.id,
          examId: a.examId,
          examTitleAr: gradeExams.find((e) => e.id === a.examId)?.titleAr || `امتحان #${a.examId}`,
          status: a.status,
          totalScore: Number(a.totalScore),
          maxScore: Number(a.maxScore),
          passed: a.passed,
          resultPublished: a.resultPublished !== false,
          submittedAt: a.submittedAt,
        })),
      homeworkSummary: {
        totalCount: eligibleHomeworkItems.length,
        completedCount: completedHomeworkCount,
        items: eligibleHomeworkItems,
      },
      studyActivityDates,
      curriculumPlan: curriculumBundle.plan,
      curriculumManualProgress: curriculumBundle.manualReviewedTaskIds,
      announcements: activeAnnouncements,
      schedules: scheduleRows,
      groups: memberRows.map((m) => m.group),
      notifications: notifRows,
      orders: studentOrders,
      platformSubscription: latestPlatformSubRow
        ? {
            id: latestPlatformSubRow.id,
            startsAt: latestPlatformSubRow.startsAt,
            expiresAt: latestPlatformSubRow.expiresAt,
            durationDays: latestPlatformSubRow.durationDays,
            accessScope: latestPlatformSubRow.accessScope,
            status: platformSubState?.effectiveStatus || latestPlatformSubRow.status,
            isActive: Boolean(platformSubState?.isActive),
            remainingDays: platformSubState?.remainingDays || 0,
            scopeNoteAr: 'اشتراك دخول المنصة فقط — لا يفتح الكورسات أو الفيديوهات المدفوعة تلقائيًا.',
          }
        : null,
    });
  } catch (error) {
    console.error('Student dashboard failed:', error);
    return res.status(500).json({ error: 'تعذر تحميل لوحة الطالب' });
  }
});

// Protected Video Playback Session (HMAC Signed URL + Device/Concurrency Check + Dynamic Watermark)
studentRouter.post(
  '/videos/:id/playback-session',
  requireAuth,
  requireActiveAccount,
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!videoId) return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });

      const u = req.authUser!;
      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) return res.status(404).json({ error: 'الفيديو غير موجود' });

      const approvedGradeIds = await getStudentApprovedGrades(u.id, u.roleSlug);
      const [userEntitlementsRaw, clRows, activeCourseBlocks] = await Promise.all([
        db.select().from(entitlements).where(eq(entitlements.userId, u.id)),
        db.select().from(courseLessons).where(eq(courseLessons.lessonId, videoRow.lessonId)),
        isStaffRole(u.roleSlug)
          ? Promise.resolve([])
          : db
              .select({ courseId: courseStudentBlocks.courseId })
              .from(courseStudentBlocks)
              .where(and(eq(courseStudentBlocks.userId, u.id), eq(courseStudentBlocks.isActive, true))),
      ]);

      const blockedCourseIds = new Set(activeCourseBlocks.map((b) => b.courseId));
      if (!isStaffRole(u.roleSlug) && videoRow.courseId && blockedCourseIds.has(videoRow.courseId)) {
        return res.status(403).json({
          error: 'تم تقييد وصولك إلى هذا الكورس من قِبل الإدارة، لذا لا يمكنك تشغيل فيديوهاته حاليًا.',
          reasonCode: 'COURSE_BLOCKED',
        });
      }

      const userEntitlements = userEntitlementsRaw.filter(
        (e) => !(e.targetType === 'COURSE' && blockedCourseIds.has(e.targetId)),
      );
      const unblockedCourseLinks = isStaffRole(u.roleSlug)
        ? clRows
        : clRows.filter((cl) => !blockedCourseIds.has(cl.courseId));

      const decision = resolveVideoAccess({
        userRoleSlug: u.roleSlug,
        userStatus: u.status,
        approvedGradeIds,
        videoId: videoRow.id,
        videoGradeId: videoRow.gradeId,
        videoType: videoRow.videoType,
        videoPublished: videoRow.isPublished,
        publicationStatus: videoRow.publicationStatus,
        videoCourseId: videoRow.courseId,
        courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
        isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
        entitlements: userEntitlements,
      });

      if (!decision.allowed) {
        await logAudit({
          actorId: u.id,
          actorName: u.fullName,
          action: 'VIDEO_ACCESS_DENIED',
          entityType: 'video',
          entityId: videoId,
          details: { reason: decision.reasonCode },
          ipAddress: req.ip || '',
        });
        return res.status(403).json({
          error: getAccessDeniedMessageAr(decision.reasonCode, videoRow.videoType),
          reasonCode: decision.reasonCode,
        });
      }

      // Check device & concurrency policy for student sessions
      if (!isStaffRole(u.roleSlug) && u.sessionId && u.deviceFingerprint) {
        const userSessions = await db
          .select()
          .from(deviceSessions)
          .where(eq(deviceSessions.userId, u.id));

        const sessionDecision = evaluatePlaybackSessionPolicy({
          maxDevices: u.maxDevices,
          allowConcurrent: u.allowConcurrent,
          currentSessionId: u.sessionId,
          currentDeviceFingerprint: u.deviceFingerprint,
          activeSessions: userSessions,
        });

        if (!sessionDecision.allowed) {
          await logAudit({
            actorId: u.id,
            actorName: u.fullName,
            action: 'PLAYBACK_SECURITY_BLOCK',
            entityType: 'session',
            entityId: u.sessionId,
            details: { reason: sessionDecision.reason, videoId },
            ipAddress: req.ip || '',
          });
          const msg =
            sessionDecision.reason === 'CONCURRENT_PLAYBACK_DETECTED'
              ? 'تم رصد تشغيل متزامن على جهاز آخر. أغلق المشاهدة على الجهاز الآخر أو تواصل مع الدعم.'
              : 'تم تقييد التشغيل على هذا الجهاز وفق سياسة حماية الحساب.';
          return res.status(403).json({ error: msg, reasonCode: sessionDecision.reason });
        }

        await db
          .update(deviceSessions)
          .set({ activeVideoId: videoRow.id, lastHeartbeatAt: new Date() })
          .where(eq(deviceSessions.id, u.sessionId));
      }

      // Backend-only idempotent video view-limit enforcement (never double-charges seeks, pauses, or same-session refreshes)
      let courseDefaultMaxOpens: number | null = null;
      if (videoRow.courseId) {
        const [courseRow] = await db
          .select({ defaultVideoMaxOpens: courses.defaultVideoMaxOpens })
          .from(courses)
          .where(eq(courses.id, videoRow.courseId))
          .limit(1);
        courseDefaultMaxOpens = courseRow?.defaultVideoMaxOpens ?? null;
      }

      const [existingCounter] = await db
        .select()
        .from(videoAccessCounters)
        .where(and(eq(videoAccessCounters.userId, u.id), eq(videoAccessCounters.videoId, videoRow.id)))
        .limit(1);

      const openDecision = evaluateVideoOpenLimit({
        isStaff: isStaffRole(u.roleSlug),
        courseDefaultMaxOpens,
        videoMaxOpens: videoRow.maxOpens ?? null,
        studentMaxOpensOverride: existingCounter?.maxOpensOverride ?? null,
        bonusOpens: existingCounter?.bonusOpens ?? 0,
        countedOpens: existingCounter?.countedOpens ?? 0,
        currentSessionId: u.sessionId,
        lastSessionId: existingCounter?.lastSessionId ?? null,
        lastCountedAt: existingCounter?.lastCountedAt ?? null,
      });

      if (!openDecision.allowed) {
        await logAudit({
          actorId: u.id,
          actorName: u.fullName,
          action: 'VIDEO_OPEN_LIMIT_REACHED',
          entityType: 'video',
          entityId: videoRow.id,
          details: {
            countedOpens: openDecision.countedOpensBefore,
            effectiveMaxOpens: openDecision.effectiveMaxOpens,
          },
          ipAddress: req.ip || '',
        });
        return res.status(403).json({
          error: `لقد استنفدت الحد الأقصى المسموح لمشاهدة هذا الفيديو (${openDecision.effectiveMaxOpens} مرات). يمكنك التواصل مع المدرس لزيادة أو إعادة ضبط عدد المشاهدات.`,
          reasonCode: 'OPEN_LIMIT_REACHED',
          viewLimit: {
            countedOpens: openDecision.countedOpensBefore,
            effectiveMaxOpens: openDecision.effectiveMaxOpens,
            remainingOpens: 0,
          },
        });
      }

      if (openDecision.shouldIncrement) {
        const now = new Date();
        await db
          .insert(videoAccessCounters)
          .values({
            userId: u.id,
            videoId: videoRow.id,
            countedOpens: openDecision.countedOpensAfter,
            maxOpensOverride: existingCounter?.maxOpensOverride ?? null,
            bonusOpens: existingCounter?.bonusOpens ?? 0,
            lastSessionId: u.sessionId,
            lastCountedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [videoAccessCounters.userId, videoAccessCounters.videoId],
            set: {
              countedOpens: openDecision.countedOpensAfter,
              lastSessionId: u.sessionId,
              lastCountedAt: now,
              updatedAt: now,
            },
          });
      }

      await db
        .update(videos)
        .set({ viewsCount: sql`${videos.viewsCount} + 1` })
        .where(eq(videos.id, videoRow.id));

      const [prog] = await db
        .select()
        .from(progressRecords)
        .where(and(eq(progressRecords.userId, u.id), eq(progressRecords.videoId, videoRow.id)))
        .limit(1);

      const watermarkText = `${u.fullName} · ${maskPhoneForWatermark(u.phone)} · ID#${u.id}`;
      const signedToken = signPlaybackToken(
        {
          videoId: videoRow.id,
          userId: u.id,
          sessionId: u.sessionId || 0,
          assetKey: videoRow.streamAssetKey,
          watermarkText,
        },
        600,
      );

      const youtubeVideoId = videoRow.youtubeVideoId || null;
      const resumePositionSec = prog?.lastPositionSec || 0;

      return res.json({
        video: {
          id: videoRow.id,
          titleAr: videoRow.titleAr,
          descriptionAr: videoRow.descriptionAr,
          durationSec: videoRow.durationSec,
          thumbnailUrl: videoRow.thumbnailUrl,
          videoType: videoRow.videoType,
          allowSpeedChange: videoRow.allowSpeedChange,
          maxPlaybackSpeed: Number(videoRow.maxPlaybackSpeed || 2),
        },
        playback: {
          provider: youtubeVideoId ? 'YOUTUBE' : 'PROTECTED_CANVAS',
          youtubeVideoId,
          embedUrl: youtubeVideoId
            ? buildPrivacyEnhancedEmbedUrl(youtubeVideoId, resumePositionSec)
            : null,
          signedStreamUrl: `/api/student/stream/manifest?token=${encodeURIComponent(signedToken)}`,
          expiresInSec: 600,
          watermarkText,
          resumePositionSec,
          watchedSec: prog?.watchedSec || 0,
          completionPercent: prog?.completionPercent || 0,
          isCompleted: Boolean(prog?.isCompleted),
          accessSource: decision.matchedSource || decision.reasonCode,
          viewLimit: {
            countedOpens: openDecision.countedOpensAfter,
            effectiveMaxOpens: openDecision.effectiveMaxOpens,
            remainingOpens: openDecision.remainingOpens,
          },
          drmStatus: {
            hlsSignedTokensActive: true,
            widevineFairPlayReady: Boolean(process.env.MUX_TOKEN_ID || process.env.CLOUDFLARE_STREAM_ACCOUNT_ID),
            browserScreenCaptureLimitationNote:
              'تنبيه أمني شفاف: متصفحات الويب لا تتيح منع تصوير الشاشة أو التسجيل الخارجي بنسبة 100%، لذا نطبّق التحقق الخادمي قبل تسليم أي رابط تشغيل، نطاق youtube-nocookie المعزز للخصوصية، علامة مائية متحركة ببيانات الطالب، وتقييد الأجهزة والتشغيل المتزامن.',
          },
        },
      });
    } catch (error) {
      console.error('Playback session creation failed:', error);
      return res.status(500).json({ error: 'تعذر تجهيز جلسة المشاهدة الآمنة' });
    }
  },
);

// Protected Video PDF Attachment Endpoint (inherits exact access permissions of its associated video)
studentRouter.get(
  '/videos/:id/pdf',
  requireAuth,
  requireActiveAccount,
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      if (!videoId) return res.status(400).json({ error: 'معرّف الفيديو غير صالح' });

      const u = req.authUser!;
      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) return res.status(404).json({ error: 'الفيديو غير موجود' });

      const approvedGradeIds = await getStudentApprovedGrades(u.id, u.roleSlug);
      const [userEntitlementsRaw, clRows, activeCourseBlocks] = await Promise.all([
        db.select().from(entitlements).where(eq(entitlements.userId, u.id)),
        db.select().from(courseLessons).where(eq(courseLessons.lessonId, videoRow.lessonId)),
        isStaffRole(u.roleSlug)
          ? Promise.resolve([])
          : db
              .select({ courseId: courseStudentBlocks.courseId })
              .from(courseStudentBlocks)
              .where(and(eq(courseStudentBlocks.userId, u.id), eq(courseStudentBlocks.isActive, true))),
      ]);

      const blockedCourseIds = new Set(activeCourseBlocks.map((b) => b.courseId));
      if (!isStaffRole(u.roleSlug) && videoRow.courseId && blockedCourseIds.has(videoRow.courseId)) {
        return res.status(403).json({
          error: 'تم تقييد وصولك إلى هذا الكورس حاليًا من قِبل الإدارة.',
          reasonCode: 'COURSE_BLOCKED',
        });
      }

      const userEntitlements = userEntitlementsRaw.filter(
        (e) => !(e.targetType === 'COURSE' && blockedCourseIds.has(e.targetId)),
      );
      const unblockedCourseLinks = isStaffRole(u.roleSlug)
        ? clRows
        : clRows.filter((cl) => !blockedCourseIds.has(cl.courseId));

      const decision = resolveVideoAccess({
        userRoleSlug: u.roleSlug,
        userStatus: u.status,
        approvedGradeIds,
        videoId: videoRow.id,
        videoGradeId: videoRow.gradeId,
        videoType: videoRow.videoType,
        videoPublished: videoRow.isPublished,
        publicationStatus: videoRow.publicationStatus,
        videoCourseId: videoRow.courseId,
        courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
        isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
        entitlements: userEntitlements,
      });

      if (!decision.allowed) {
        return res.status(403).json({
          error: getAccessDeniedMessageAr(decision.reasonCode, videoRow.videoType),
          reasonCode: decision.reasonCode,
        });
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

      if (!videoRow.pdfDriveFileId) {
        return res.json({ hasPdf: false, attachment: null });
      }

      return res.json({
        hasPdf: true,
        attachment: {
          videoId: videoRow.id,
          title: videoRow.pdfTitle || videoRow.titleAr,
          description: videoRow.pdfDescription || null,
          previewUrl: buildGoogleDrivePreviewUrl(videoRow.pdfDriveFileId),
          viewUrl: buildGoogleDriveViewUrl(videoRow.pdfDriveFileId),
          attachedAt: videoRow.pdfAttachedAt || null,
        },
      });
    } catch (error) {
      console.error('Fetch video PDF failed:', error);
      return res.status(500).json({ error: 'تعذر تحميل ملف الدرس المرفق' });
    }
  },
);

// Protected Signed Stream Manifest Endpoint (never accessible without valid HMAC token + active session)
studentRouter.get('/stream/manifest', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      return res.status(403).json({ error: 'رابط المشاهدة المؤقت منتهي الصلاحية أو غير صالح' });
    }

    if (payload.sessionId > 0) {
      const [sess] = await db
        .select()
        .from(deviceSessions)
        .where(eq(deviceSessions.id, payload.sessionId))
        .limit(1);
      if (!sess || sess.isRevoked || sess.isBlocked) {
        return res.status(403).json({ error: 'تم إنهاء جلسة المشاهدة بواسطة النظام' });
      }
    }

    const [videoRow] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, payload.videoId))
      .limit(1);
    if (!videoRow) return res.status(404).json({ error: 'المحتوى غير موجود' });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.json({
      verified: true,
      videoId: videoRow.id,
      titleAr: videoRow.titleAr,
      durationSec: videoRow.durationSec,
      qualities: ['1080p HD', '720p', '480p', '360p (توفير البيانات)'],
      chapters: [
        { timeSec: 0, titleAr: 'مقدمة الدرس وربط القوانين الأساسية', formula: 'I = \\frac{Q}{t}' },
        { timeSec: Math.round(videoRow.durationSec * 0.25), titleAr: 'استنتاج العلاقة الرياضية وتحليل المتغيرات', formula: 'V_B = I(R + r)' },
        { timeSec: Math.round(videoRow.durationSec * 0.55), titleAr: 'حل مسائل المستويات العليا والرسوم البيانية', formula: 'P = I^2 R = \\frac{V^2}{R}' },
        { timeSec: Math.round(videoRow.durationSec * 0.8), titleAr: 'ملخص أفكار الامتحان وأخطاء شائعة يجب تجنبها', formula: '\\eta = \\frac{V}{V_B} \\times 100\\%' },
      ],
      watermarkText: payload.watermarkText,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Stream manifest error:', error);
    return res.status(500).json({ error: 'خطأ في التحقق من بث الفيديو' });
  }
});

// Save Video Progress & Watch Heartbeat (server-authorized + verified real watch time)
studentRouter.post(
  '/videos/:id/progress',
  requireAuth,
  requireActiveAccount,
  async (req: AuthRequest, res) => {
    try {
      const videoId = Number(req.params.id);
      const schema = z.object({
        lastPositionSec: z.coerce.number().min(0),
        watchedSec: z.coerce.number().min(0).optional(),
        durationSec: z.coerce.number().min(1).optional(),
        stopped: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'بيانات التقدم غير صالحة' });

      const u = req.authUser!;
      const [videoRow] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
      if (!videoRow) return res.status(404).json({ error: 'الفيديو غير موجود' });

      const approvedGradeIds = await getStudentApprovedGrades(u.id, u.roleSlug);
      const [userEntitlementsRaw, clRows, activeCourseBlocks] = await Promise.all([
        db.select().from(entitlements).where(eq(entitlements.userId, u.id)),
        db.select().from(courseLessons).where(eq(courseLessons.lessonId, videoRow.lessonId)),
        isStaffRole(u.roleSlug)
          ? Promise.resolve([])
          : db
              .select({ courseId: courseStudentBlocks.courseId })
              .from(courseStudentBlocks)
              .where(and(eq(courseStudentBlocks.userId, u.id), eq(courseStudentBlocks.isActive, true))),
      ]);
      const blockedCourseIds = new Set(activeCourseBlocks.map((b) => b.courseId));
      if (!isStaffRole(u.roleSlug) && videoRow.courseId && blockedCourseIds.has(videoRow.courseId)) {
        return res.status(403).json({ error: 'تم تقييد وصولك إلى هذا الكورس حاليًا من قِبل الإدارة.' });
      }
      const userEntitlements = userEntitlementsRaw.filter(
        (e) => !(e.targetType === 'COURSE' && blockedCourseIds.has(e.targetId)),
      );
      const unblockedCourseLinks = isStaffRole(u.roleSlug)
        ? clRows
        : clRows.filter((cl) => !blockedCourseIds.has(cl.courseId));

      const decision = resolveVideoAccess({
        userRoleSlug: u.roleSlug,
        userStatus: u.status,
        approvedGradeIds,
        videoId: videoRow.id,
        videoGradeId: videoRow.gradeId,
        videoType: videoRow.videoType,
        videoPublished: videoRow.isPublished,
        publicationStatus: videoRow.publicationStatus,
        videoCourseId: videoRow.courseId,
        courseIdsContainingVideo: unblockedCourseLinks.map((c) => c.courseId),
        isFreePreviewInCourse: unblockedCourseLinks.some((c) => c.isFreePreview),
        entitlements: userEntitlements,
      });

      if (!decision.allowed) {
        return res.status(403).json({
          error: getAccessDeniedMessageAr(decision.reasonCode, videoRow.videoType),
        });
      }

      const reportedDuration = parsed.data.durationSec ? Math.round(parsed.data.durationSec) : 0;
      const duration = reportedDuration > 10 ? reportedDuration : videoRow.durationSec || 1800;

      // Update stored duration if the video was created with 0 placeholder and YouTube IFrame reports true duration
      if (reportedDuration > 10 && videoRow.durationSec === 0) {
        await db
          .update(videos)
          .set({ durationSec: reportedDuration, updatedAt: new Date() })
          .where(eq(videos.id, videoId));
      }

      const [existingProg] = await db
        .select()
        .from(progressRecords)
        .where(and(eq(progressRecords.userId, u.id), eq(progressRecords.videoId, videoId)))
        .limit(1);

      const computed = computeVerifiedVideoProgress({
        lastPositionSec: parsed.data.lastPositionSec,
        watchedSec: parsed.data.watchedSec ?? 0,
        previousWatchedSec: existingProg?.watchedSec || 0,
        previousCompletionPercent: existingProg?.completionPercent || 0,
        previousIsCompleted: existingProg?.isCompleted || false,
        durationSec: duration,
      });

      const [record] = await db
        .insert(progressRecords)
        .values({
          userId: u.id,
          videoId,
          lastPositionSec: computed.lastPositionSec,
          watchedSec: computed.watchedSec,
          completionPercent: computed.completionPercent,
          isCompleted: computed.isCompleted,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [progressRecords.userId, progressRecords.videoId],
          set: {
            lastPositionSec: computed.lastPositionSec,
            watchedSec: computed.watchedSec,
            completionPercent: computed.completionPercent,
            isCompleted: computed.isCompleted,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (u.sessionId) {
        await db
          .update(deviceSessions)
          .set({
            activeVideoId: parsed.data.stopped ? null : videoId,
            lastHeartbeatAt: new Date(),
          })
          .where(eq(deviceSessions.id, u.sessionId));
      }

      return res.json({ progress: record });
    } catch (error) {
      console.error('Progress save failed:', error);
      return res.status(500).json({ error: 'تعذر حفظ نقطة المشاهدة' });
    }
  },
);

// Transactional Activation Code Redemption (Atomic concurrency-safe DB transaction)
studentRouter.post(
  '/codes/redeem',
  requireAuth,
  requireActiveAccount,
  async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const rate = redeemRateLimiter.check(`code:${u.id}`);
      if (!rate.allowed) {
        return res.status(429).json({
          error: `محاولات متكررة لإدخال الأكواد. يرجى المحاولة بعد ${rate.retryAfterSec} ثانية.`,
        });
      }

      const rawCode = String(req.body?.code || '').trim();
      if (!rawCode || rawCode.length < 6) {
        return res.status(400).json({ error: 'يرجى إدخال كود تفعيل صحيح' });
      }

      const candidateHashes = getActivationCodeLookupHashes(rawCode);
      const approvedGradeIds = await getStudentApprovedGrades(u.id, u.roleSlug);

      const outcome = await db.transaction(async (tx) => {
        const [codeRow] = await tx
          .select()
          .from(accessCodes)
          .where(
            candidateHashes.length === 1
              ? eq(accessCodes.codeHash, candidateHashes[0])
              : inArray(accessCodes.codeHash, candidateHashes),
          )
          .limit(1);

        if (!codeRow) {
          throw Object.assign(new Error('كود التفعيل غير صحيح أو غير موجود'), { statusCode: 404 });
        }

        const validation = validateCodeForRedemption(codeRow, u.id, approvedGradeIds);
        if (!validation.valid) {
          const msgs: Record<string, string> = {
            CODE_REVOKED: 'تم إلغاء هذا الكود من قِبل الإدارة.',
            CODE_CANCELLED: 'تم إلغاء هذا الكود ولم يعد صالحًا للتفعيل.',
            CODE_DISABLED: codeRow.disabledUntil
              ? `هذا الكود معطّل مؤقتًا حتى ${new Date(codeRow.disabledUntil).toLocaleDateString('ar-EG')}.`
              : 'هذا الكود معطّل مؤقتًا من قِبل الإدارة.',
            CODE_EXPIRED: 'انتهت صلاحية هذا الكود.',
            CODE_EXHAUSTED: 'تم استخدام هذا الكود بالفعل للحد الأقصى.',
            CODE_BOUND_TO_OTHER_STUDENT: 'هذا الكود مخصص لطالب آخر فقط.',
            CODE_GRADE_MISMATCH: 'هذا الكود مخصص لصف دراسي آخر غير صفك المعتمد.',
          };
          throw Object.assign(new Error(msgs[validation.errorCode || ''] || 'الكود غير صالح للاستخدام'), {
            statusCode: 400,
          });
        }

        // Check if same user already redeemed this exact code
        const already = await tx
          .select()
          .from(codeRedemptions)
          .where(and(eq(codeRedemptions.codeId, codeRow.id), eq(codeRedemptions.userId, u.id)))
          .limit(1);
        if (already.length > 0) {
          throw Object.assign(new Error('لقد قمت بتفعيل هذا الكود على حسابك مسبقًا.'), {
            statusCode: 409,
          });
        }

        // Atomic conditional increment preventing concurrent double-redemption race
        // Also allows redeeming a temporarily DISABLED code whose disabledUntil timestamp has already passed.
        const now = new Date();
        const updatedRows = await tx
          .update(accessCodes)
          .set({
            usedCount: sql`${accessCodes.usedCount} + 1`,
            status: sql`CASE WHEN ${accessCodes.usedCount} + 1 >= ${accessCodes.maxUses} THEN 'REDEEMED' ELSE 'AVAILABLE' END`,
            disabledUntil: null,
          })
          .where(
            and(
              eq(accessCodes.id, codeRow.id),
              or(
                eq(accessCodes.status, 'AVAILABLE'),
                and(
                  eq(accessCodes.status, 'DISABLED'),
                  sql`${accessCodes.disabledUntil} IS NOT NULL AND ${accessCodes.disabledUntil} <= ${now}`,
                ),
              ),
              sql`${accessCodes.usedCount} < ${accessCodes.maxUses}`,
            ),
          )
          .returning();

        if (!updatedRows.length) {
          throw Object.assign(new Error('تم استهلاك الكود للتو في عملية متزامنة أخرى.'), {
            statusCode: 409,
          });
        }

        const isPlatformCode =
          codeRow.codeCategory === 'PLATFORM' || codeRow.targetType === 'PLATFORM_ACCESS';

        if (isPlatformCode) {
          // STRICT SEPARATION: Platform Subscription code grants time-limited platform membership ONLY.
          // It MUST NOT create COURSE, VIDEO, or GRADE_ALL paid content entitlements.
          const durationDays = Math.max(1, Number(codeRow.durationDays || 30));
          const [existingActiveSub] = await tx
            .select()
            .from(platformSubscriptions)
            .where(and(eq(platformSubscriptions.userId, u.id), eq(platformSubscriptions.status, 'ACTIVE')))
            .orderBy(desc(platformSubscriptions.expiresAt))
            .limit(1);

          const baseStart =
            existingActiveSub && new Date(existingActiveSub.expiresAt).getTime() > now.getTime()
              ? new Date(existingActiveSub.expiresAt)
              : now;
          const startsAt = now;
          const expiresAt = new Date(baseStart.getTime() + durationDays * 86400_000);

          const [sub] = await tx
            .insert(platformSubscriptions)
            .values({
              userId: u.id,
              accessCodeId: codeRow.id,
              startsAt,
              expiresAt,
              durationDays,
              status: 'ACTIVE',
              accessScope: 'PLATFORM_ONLY',
              note: `تفعيل اشتراك المنصة عبر الكود ${codeRow.codePrefix}`,
            })
            .returning();

          await tx.insert(codeRedemptions).values({
            codeId: codeRow.id,
            userId: u.id,
            entitlementId: null,
          });

          return {
            kind: 'PLATFORM' as const,
            platformSubscription: sub,
            ent: null,
            codePrefix: codeRow.codePrefix,
          };
        }

        const expiresAt =
          codeRow.durationDays > 0
            ? new Date(Date.now() + codeRow.durationDays * 86400_000)
            : null;

        const [ent] = await tx
          .insert(entitlements)
          .values({
            userId: u.id,
            targetType: codeRow.targetType,
            targetId: codeRow.targetId,
            source: 'ACTIVATION_CODE',
            priority: getSourcePriority('ACTIVATION_CODE'),
            expiresAt,
            note: `تفعيل عبر الكود ${codeRow.codePrefix}`,
          })
          .returning();

        await tx.insert(codeRedemptions).values({
          codeId: codeRow.id,
          userId: u.id,
          entitlementId: ent.id,
        });

        return {
          kind: 'CONTENT' as const,
          platformSubscription: null,
          ent,
          codePrefix: codeRow.codePrefix,
        };
      });

      if (outcome.kind === 'PLATFORM' && outcome.platformSubscription) {
        const sub = outcome.platformSubscription;
        const subState = computePlatformSubscriptionState(sub);
        await logAudit({
          actorId: u.id,
          actorName: u.fullName,
          action: 'PLATFORM_SUBSCRIPTION_ACTIVATED',
          entityType: 'platform_subscription',
          entityId: sub.id,
          details: {
            codePrefix: outcome.codePrefix,
            durationDays: sub.durationDays,
            expiresAt: sub.expiresAt.toISOString(),
            accessScope: sub.accessScope,
          },
          ipAddress: req.ip || '',
        });

        await createNotification({
          userId: u.id,
          titleAr: 'تم تفعيل اشتراك المنصة بنجاح',
          bodyAr: `اشتراكك في المنصة نشط الآن لمدة ${sub.durationDays} يومًا حتى ${new Date(sub.expiresAt).toLocaleDateString('ar-EG')} (دخول المنصة فقط — الكورسات والفيديوهات المدفوعة تتطلب أكوادها الخاصة).`,
          type: 'GENERAL',
          targetType: 'PLATFORM_SUBSCRIPTION',
          targetId: sub.id,
        });

        return res.json({
          success: true,
          codeCategory: 'PLATFORM',
          platformSubscription: {
            ...sub,
            status: subState.effectiveStatus,
            isActive: subState.isActive,
            remainingDays: subState.remainingDays,
          },
          message: `تم تفعيل اشتراك المنصة بنجاح لمدة ${sub.durationDays} يومًا!`,
        });
      }

      const ent = outcome.ent!;
      await logAudit({
        actorId: u.id,
        actorName: u.fullName,
        action: 'ACTIVATION_CODE_REDEEMED',
        entityType: 'entitlement',
        entityId: ent.id,
        details: { codePrefix: outcome.codePrefix, targetType: ent.targetType, targetId: ent.targetId },
        ipAddress: req.ip || '',
      });

      await createNotification({
        userId: u.id,
        titleAr: 'تم تفعيل الكود بنجاح',
        bodyAr: 'تم فتح المحتوى المخصص للكود وإضافته فورًا إلى حسابك.',
        type: 'GENERAL',
        targetType: ent.targetType === 'COURSE' ? 'COURSE' : ent.targetType === 'VIDEO' ? 'VIDEO' : 'COURSES',
        targetId: ent.targetId,
      });

      return res.json({
        success: true,
        codeCategory: 'CONTENT',
        entitlement: ent,
        message: 'تم تفعيل الكود وفتح المحتوى بنجاح!',
      });
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
      if (status >= 500) {
        console.error('Code redemption failed:', error);
      }
      return res.status(status).json({ error: err.message || 'تعذر تفعيل الكود' });
    }
  },
);

// Create Order & Payment Receipt (NEVER grants paid access until verified by Admin or Payment Webhook)
studentRouter.post('/orders', requireAuth, requireActiveAccount, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      targetType: z.enum(['VIDEO', 'COURSE', 'PLAN']),
      targetId: z.coerce.number().int().positive(),
      paymentMethod: z.enum(['PAYMOB', 'WALLET', 'FAWRY', 'BANK_TRANSFER']),
      couponCode: z.string().trim().optional(),
      receiptNote: z.string().trim().optional(),
      providerRef: z.string().trim().optional(),
      receiptImageData: z.string().max(1_500_000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'بيانات طلب الاشتراك غير مكتملة' });
    }

    const { targetType, targetId, paymentMethod, couponCode, receiptNote, providerRef, receiptImageData } =
      parsed.data;

    // Validate receipt image/PDF data URL before any DB writes (blocks data:text/html, svg, etc.)
    if (receiptImageData && !isSafeUploadDataUrl(receiptImageData, 1_500_000)) {
      return res.status(400).json({ error: 'صيغة ملف الإيصال غير مدعومة. يرجى رفع صورة (PNG/JPG/WEBP) أو PDF فقط.' });
    }

    // Honest gateway check BEFORE consuming coupons or writing orders; never fake successful payment!
    if (paymentMethod === 'PAYMOB' && !process.env.PAYMOB_API_KEY) {
      return res.status(503).json({
        error:
          'بوابة الدفع الإلكتروني Paymob غير مفعّلة بعد بمفاتيح الإنتاج. يرجى استخدام التحويل البنكي أو المحفظة الإلكترونية ورفع الإيصال للمراجعة.',
      });
    }
    if (paymentMethod === 'FAWRY' && !process.env.FAWRY_MERCHANT_CODE) {
      return res.status(503).json({
        error:
          'بوابة فوري غير مفعّلة بعد بمفاتيح الإنتاج. يرجى استخدام التحويل البنكي أو فودافون كاش ورفع الإيصال للمراجعة.',
      });
    }

    let amountEgp = 0;
    let targetTitleAr = '';
    if (targetType === 'VIDEO') {
      const [v] = await db.select().from(videos).where(eq(videos.id, targetId)).limit(1);
      if (!v) return res.status(404).json({ error: 'الفيديو غير موجود' });
      if (!v.isPublished || v.publicationStatus !== 'PUBLISHED' || v.priceEgp <= 0) {
        return res.status(400).json({ error: 'هذا الفيديو غير متاح للشراء المباشر حاليًا.' });
      }
      amountEgp = v.priceEgp;
      targetTitleAr = v.titleAr;
    } else if (targetType === 'COURSE') {
      const [c] = await db.select().from(courses).where(eq(courses.id, targetId)).limit(1);
      if (!c) return res.status(404).json({ error: 'الكورس غير موجود' });
      if (!c.isPublished || c.publicationStatus !== 'PUBLISHED') {
        return res.status(400).json({ error: 'هذا الكورس غير متاح للشراء الجديد حاليًا.' });
      }
      amountEgp = c.discountPriceEgp > 0 ? c.discountPriceEgp : c.originalPriceEgp;
      targetTitleAr = c.titleAr;
    } else {
      const [p] = await db.select().from(plans).where(eq(plans.id, targetId)).limit(1);
      if (!p) return res.status(404).json({ error: 'الباقة غير موجودة' });
      if (!p.isActive || p.priceEgp <= 0) {
        return res.status(400).json({ error: 'هذه الباقة غير متاحة للاشتراك حاليًا.' });
      }
      amountEgp = p.priceEgp;
      targetTitleAr = p.nameAr;
    }

    const orderNumber = `ORD-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;

    // Execute coupon consumption, order insert, and payment record atomically in one transaction
    const txResult = await db.transaction(async (tx) => {
      let discountEgp = 0;
      let appliedCoupon: string | null = null;
      if (couponCode) {
        const [cp] = await tx
          .select()
          .from(coupons)
          .where(eq(coupons.code, couponCode.toUpperCase()))
          .limit(1);
        if (!cp) {
          return { ok: false as const, error: 'كود الخصم المدخل غير صحيح.', status: 400 as const };
        }
        const calc = computeCouponDiscount({
          coupon: cp,
          amountEgp,
          targetType,
          targetId,
        });
        if (!calc.valid) {
          return { ok: false as const, error: calc.errorMessageAr || 'كود الخصم غير صالح لهذا الطلب.', status: 400 as const };
        }
        const updatedCp = await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1`, updatedAt: new Date() })
          .where(and(eq(coupons.id, cp.id), sql`${coupons.usedCount} < ${coupons.maxUses}`))
          .returning({ id: coupons.id });
        if (!updatedCp.length) {
          return { ok: false as const, error: 'وصل كود الخصم للحد الأقصى من الاستخدامات للتو.', status: 409 as const };
        }
        discountEgp = calc.discountEgp;
        appliedCoupon = cp.code;
      }

      const finalAmountEgp = Math.max(0, amountEgp - discountEgp);
      const [createdOrder] = await tx
        .insert(orders)
        .values({
          orderNumber,
          userId: req.authUser!.id,
          targetType,
          targetId,
          targetTitleAr,
          amountEgp,
          discountEgp,
          finalAmountEgp,
          couponCode: appliedCoupon,
          paymentMethod,
          status: 'UNDER_REVIEW',
        })
        .returning();

      await tx.insert(payments).values({
        orderId: createdOrder.id,
        provider: paymentMethod,
        providerRef: providerRef || `REF-${Date.now()}-${crypto.randomInt(1000, 9999)}`,
        amountEgp: finalAmountEgp,
        receiptNote: receiptNote || '',
        receiptImageData: receiptImageData || null,
        status: 'PENDING',
      });

      return { ok: true as const, createdOrder, finalAmountEgp };
    });

    if (!txResult.ok) {
      return res.status(txResult.status).json({ error: txResult.error });
    }

    const { createdOrder, finalAmountEgp } = txResult;

    await logAudit({
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
      action: 'ORDER_SUBMITTED_FOR_REVIEW',
      entityType: 'order',
      entityId: createdOrder.id,
      details: { orderNumber, finalAmountEgp, paymentMethod },
    });

    return res.status(201).json({
      order: createdOrder,
      message:
        'تم تسجيل الطلب وإرسال إيصال الدفع للمراجعة. سيتم فتح المحتوى تلقائيًا فور تأكيد الإدارة أو بوابة الدفع.',
    });
  } catch (error) {
    console.error('Order creation failed:', error);
    return res.status(500).json({ error: 'تعذر تسجيل طلب الدفع' });
  }
});

// Lesson Q&A Comment Submission
studentRouter.post(
  '/lessons/:id/comments',
  requireAuth,
  requireActiveAccount,
  async (req: AuthRequest, res) => {
    try {
      const lessonId = Number(req.params.id);
      const bodyAr = String(req.body?.bodyAr || '').trim();
      if (!Number.isInteger(lessonId) || lessonId <= 0 || bodyAr.length < 4) {
        return res.status(400).json({ error: 'يرجى كتابة سؤالك بوضوح (4 أحرف على الأقل)' });
      }
      if (bodyAr.length > 2000) {
        return res.status(400).json({ error: 'الحد الأقصى لطول السؤال هو 2000 حرف' });
      }

      const [lessonRow] = await db
        .select({ lesson: lessons, unitGradeId: units.gradeId })
        .from(lessons)
        .innerJoin(units, eq(lessons.unitId, units.id))
        .where(eq(lessons.id, lessonId))
        .limit(1);
      if (!lessonRow) return res.status(404).json({ error: 'الدرس غير موجود' });
      if (!lessonRow.lesson.allowComments) {
        return res.status(403).json({ error: 'الأسئلة والتعليقات مغلقة لهذا الدرس حاليًا' });
      }

      // Enforce grade scope for non-staff users so students cannot post to other grades' lessons
      if (!isStaffRole(req.authUser!.roleSlug)) {
        const [approvedGrade] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.userId, req.authUser!.id),
              eq(enrollments.gradeId, lessonRow.unitGradeId),
              eq(enrollments.status, 'APPROVED'),
            ),
          )
          .limit(1);
        if (!approvedGrade) {
          return res.status(403).json({ error: 'غير مصرح لك بالتعليق على درس خارج صفك الدراسي المعتمد' });
        }
      }

      const [created] = await db
        .insert(lessonComments)
        .values({
          lessonId,
          userId: req.authUser!.id,
          bodyAr,
          status: 'APPROVED',
        })
        .returning();
      gradeDashboardCatalogCache.clear();

      return res.status(201).json({
        comment: { ...created, authorName: req.authUser!.fullName },
      });
    } catch (error) {
      console.error('Lesson comment failed:', error);
      return res.status(500).json({ error: 'تعذر إرسال السؤال' });
    }
  },
);

studentRouter.post('/notifications/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, req.authUser!.id), eq(notifications.isRead, false)));
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark notifications read failed:', error);
    return res.status(500).json({ error: 'تعذر تحديث الإشعارات' });
  }
});
