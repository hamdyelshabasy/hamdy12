import { Router } from 'express';
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { auditLogs } from '../../db/schema.ts';
import type { AuthRequest } from '../../middleware/auth.ts';
import {
  CAIRO_TIMEZONE,
  UPCOMING_WINDOW_DAYS,
  buildAttentionTasks,
  buildQuickActions,
  buildSummaryCards,
  getAllowedAuditActionsForRole,
  resolveDashboardAccess,
  sanitizeActivityEvent,
  type SmartDashboardRawAggregates,
} from '../domain/smartDashboard.ts';
import type {
  GradeDistributionStat,
  SmartDashboardAcademicStats,
  SmartDashboardResponse,
  UpcomingExamItem,
  UpcomingHomeworkItem,
} from '../../types/smartDashboard.ts';

export const smartDashboardRouter = Router();

function toDateOrNull(val: unknown): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(val: unknown): number {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * GET /api/admin/smart-dashboard
 * Read-only, SQL-aggregate, strictly role-aware daily operations center.
 * Accessible to any active authenticated staff role (requireAuth + requireStaff mounted on adminRouter).
 * Every single metric, summary card, task, upcoming list, activity feed, and statistic
 * is strictly filtered server-side by the caller's existing RBAC permissions.
 */
smartDashboardRouter.get('/smart-dashboard', async (req: AuthRequest, res) => {
  try {
    const authUser = req.authUser;
    if (!authUser) {
      return res.status(401).json({ error: 'غير مصرح بالدخول. يرجى تسجيل الدخول للمتابعة.' });
    }

    const access = resolveDashboardAccess(authUser);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAhead = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const allowedAuditActions = getAllowedAuditActionsForRole(access);

    // Execute ONLY the SQL aggregate queries authorized for this staff role in parallel
    const [
      studentAggRes,
      studentsByGradeRes,
      homeworkSubsAggRes,
      homeworkUpcomingAggRes,
      homeworkUpcomingListRes,
      examAttemptsAggRes,
      examsOverviewAggRes,
      examsUpcomingListRes,
      questionBankAggRes,
      recentAuditRows,
      executiveOverviewRes,
    ] = await Promise.all([
      // 1. Students aggregates (strictly STUDENT role, non-archived)
      access.canSeeTotalStudents || access.canSeePendingStudents
        ? db.execute(sql`
            SELECT
              COUNT(*)::int AS total_students,
              COUNT(*) FILTER (WHERE u.status = 'ACTIVE')::int AS active_students,
              COUNT(*) FILTER (WHERE u.status = 'PENDING_APPROVAL')::int AS pending_students,
              COUNT(*) FILTER (WHERE u.status = 'PENDING_APPROVAL' AND u.created_at >= ${sevenDaysAgo})::int AS recent_pending_7d,
              MIN(u.created_at) FILTER (WHERE u.status = 'PENDING_APPROVAL') AS oldest_pending_at,
              COUNT(*) FILTER (WHERE u.created_at >= ${thirtyDaysAgo})::int AS recent_registrations_30d
            FROM users u
            INNER JOIN roles r ON r.id = u.role_id
            WHERE r.slug = 'STUDENT'
              AND u.status <> 'ARCHIVED'
          `)
        : Promise.resolve(null),

      // 2. Students distribution by grade (for Academic Stats)
      access.canSeeTotalStudents
        ? db.execute(sql`
            SELECT
              g.id AS grade_id,
              g.name_ar AS grade_name_ar,
              t.name_ar AS track_name_ar,
              COUNT(u.id)::int AS students_count
            FROM grades g
            INNER JOIN academic_tracks t ON t.id = g.track_id
            LEFT JOIN student_profiles sp ON sp.primary_grade_id = g.id
            LEFT JOIN users u ON u.id = sp.user_id
              AND u.status <> 'ARCHIVED'
              AND u.role_id = (SELECT id FROM roles WHERE slug = 'STUDENT' LIMIT 1)
            GROUP BY g.id, g.name_ar, t.name_ar, t.sort_order, g.sort_order
            ORDER BY t.sort_order ASC, g.sort_order ASC
          `)
        : Promise.resolve(null),

      // 3. Homework submissions awaiting grading (latest non-draft version per student+assignment)
      access.canSeeHomeworkGrading || access.canSeeHomeworkUpcoming
        ? db.execute(sql`
            WITH latest_subs AS (
              SELECT DISTINCT ON (hs.assignment_id, hs.student_id)
                hs.assignment_id,
                hs.status,
                hs.is_grade_published,
                COALESCE(hs.submitted_at, hs.created_at) AS effective_submitted_at
              FROM homework_submissions hs
              INNER JOIN homework_assignments ha ON ha.id = hs.assignment_id
              WHERE hs.status <> 'DRAFT'
                AND ha.publication_status <> 'ARCHIVED'
              ORDER BY hs.assignment_id, hs.student_id, hs.version DESC
            )
            SELECT
              COUNT(*) FILTER (
                WHERE status IN ('SUBMITTED', 'SUBMITTED_LATE', 'UNDER_REVIEW')
                   OR (status = 'GRADED' AND is_grade_published = false)
              )::int AS awaiting_count,
              COUNT(DISTINCT assignment_id) FILTER (
                WHERE status IN ('SUBMITTED', 'SUBMITTED_LATE', 'UNDER_REVIEW')
                   OR (status = 'GRADED' AND is_grade_published = false)
              )::int AS assignments_with_pending_count,
              MIN(effective_submitted_at) FILTER (
                WHERE status IN ('SUBMITTED', 'SUBMITTED_LATE', 'UNDER_REVIEW')
                   OR (status = 'GRADED' AND is_grade_published = false)
              ) AS oldest_pending_at,
              COUNT(*)::int AS submitted_count,
              COUNT(*) FILTER (
                WHERE status = 'GRADED' AND is_grade_published = true
              )::int AS graded_published_count
            FROM latest_subs
          `)
        : Promise.resolve(null),

      // 4. Active homework & upcoming 7-day count
      access.canSeeHomeworkUpcoming
        ? db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE publication_status <> 'ARCHIVED')::int AS active_assignments,
              COUNT(*) FILTER (
                WHERE publication_status IN ('PUBLISHED', 'SCHEDULED')
                  AND deadline IS NOT NULL
                  AND deadline >= ${now}
                  AND deadline <= ${sevenDaysAhead}
              )::int AS upcoming_7d_count
            FROM homework_assignments
          `)
        : Promise.resolve(null),

      // 5. Upcoming 7-day homework list (bounded LIMIT 8)
      access.canSeeHomeworkUpcoming
        ? db.execute(sql`
            SELECT
              ha.id,
              ha.title_ar,
              ha.deadline,
              ha.publication_status,
              t.name_ar AS track_name_ar,
              g.name_ar AS grade_name_ar,
              COALESCE(sub_counts.submitted_count, 0)::int AS submitted_count
            FROM homework_assignments ha
            INNER JOIN academic_tracks t ON t.id = ha.track_id
            INNER JOIN grades g ON g.id = ha.grade_id
            LEFT JOIN (
              SELECT assignment_id, COUNT(DISTINCT student_id)::int AS submitted_count
              FROM homework_submissions
              WHERE status <> 'DRAFT'
              GROUP BY assignment_id
            ) sub_counts ON sub_counts.assignment_id = ha.id
            WHERE ha.publication_status IN ('PUBLISHED', 'SCHEDULED')
              AND ha.deadline IS NOT NULL
              AND ha.deadline >= ${now}
              AND ha.deadline <= ${sevenDaysAhead}
            ORDER BY ha.deadline ASC
            LIMIT 8
          `)
        : Promise.resolve(null),

      // 6. Exam attempts awaiting manual grading + published score stats
      access.canSeeExamGrading || access.canSeeExamsOverview
        ? db.execute(sql`
            SELECT
              COUNT(*) FILTER (
                WHERE ea.status IN ('AWAITING_MANUAL_GRADING', 'SUBMITTED')
                   OR (
                     ea.status <> 'IN_PROGRESS'
                     AND EXISTS (
                       SELECT 1 FROM student_answers sa
                       WHERE sa.attempt_id = ea.id AND sa.needs_manual_grading = true
                     )
                   )
              )::int AS awaiting_attempts_count,
              COUNT(DISTINCT ea.exam_id) FILTER (
                WHERE ea.status IN ('AWAITING_MANUAL_GRADING', 'SUBMITTED')
                   OR (
                     ea.status <> 'IN_PROGRESS'
                     AND EXISTS (
                       SELECT 1 FROM student_answers sa
                       WHERE sa.attempt_id = ea.id AND sa.needs_manual_grading = true
                     )
                   )
              )::int AS exams_with_pending_count,
              MIN(COALESCE(ea.submitted_at, ea.started_at)) FILTER (
                WHERE ea.status IN ('AWAITING_MANUAL_GRADING', 'SUBMITTED')
                   OR (
                     ea.status <> 'IN_PROGRESS'
                     AND EXISTS (
                       SELECT 1 FROM student_answers sa
                       WHERE sa.attempt_id = ea.id AND sa.needs_manual_grading = true
                     )
                   )
              ) AS oldest_attempt_at,
              COUNT(*) FILTER (WHERE ea.status <> 'IN_PROGRESS')::int AS submitted_attempts_count,
              COUNT(*) FILTER (WHERE ea.status = 'GRADED')::int AS graded_attempts_count,
              ROUND(
                AVG(
                  CASE
                    WHEN ea.status = 'GRADED' AND ea.result_published = true AND ea.max_score > 0
                    THEN (ea.total_score / ea.max_score) * 100
                    ELSE NULL
                  END
                )
              )::int AS avg_published_percent
            FROM exam_attempts ea
            INNER JOIN exams e ON e.id = ea.exam_id
            WHERE e.publication_status <> 'ARCHIVED'
          `)
        : Promise.resolve(null),

      // 7. Exams active / published / draft / upcoming 7-day aggregate
      access.canSeeExamsOverview
        ? db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE publication_status <> 'ARCHIVED')::int AS total_active_exams,
              COUNT(*) FILTER (WHERE publication_status IN ('PUBLISHED', 'SCHEDULED'))::int AS published_or_scheduled_count,
              COUNT(*) FILTER (WHERE publication_status = 'DRAFT')::int AS draft_count,
              COUNT(*) FILTER (
                WHERE publication_status IN ('PUBLISHED', 'SCHEDULED')
                  AND starts_at IS NOT NULL
                  AND starts_at >= ${now}
                  AND starts_at <= ${sevenDaysAhead}
              )::int AS upcoming_7d_count,
              COUNT(*) FILTER (
                WHERE publication_status = 'PUBLISHED'
                  AND starts_at IS NOT NULL
                  AND starts_at >= ${now}
                  AND starts_at <= ${sevenDaysAhead}
              )::int AS upcoming_published_count,
              COUNT(*) FILTER (
                WHERE publication_status = 'SCHEDULED'
                  AND starts_at IS NOT NULL
                  AND starts_at >= ${now}
                  AND starts_at <= ${sevenDaysAhead}
              )::int AS upcoming_scheduled_count
            FROM exams
          `)
        : Promise.resolve(null),

      // 8. Upcoming 7-day exams list (bounded LIMIT 8; strictly excludes DRAFT/HIDDEN/ARCHIVED)
      access.canSeeExamsOverview
        ? db.execute(sql`
            SELECT
              e.id,
              e.title_ar,
              e.starts_at,
              e.ends_at,
              e.publication_status,
              e.duration_min,
              COALESCE(t.name_ar, gt.name_ar, 'غير محدد') AS track_name_ar,
              g.name_ar AS grade_name_ar
            FROM exams e
            INNER JOIN grades g ON g.id = e.grade_id
            LEFT JOIN academic_tracks t ON t.id = e.track_id
            LEFT JOIN academic_tracks gt ON gt.id = g.track_id
            WHERE e.publication_status IN ('PUBLISHED', 'SCHEDULED')
              AND e.starts_at IS NOT NULL
              AND e.starts_at >= ${now}
              AND e.starts_at <= ${sevenDaysAhead}
            ORDER BY e.starts_at ASC
            LIMIT 8
          `)
        : Promise.resolve(null),

      // 9. Question Bank aggregates (pending review, own returned, approved)
      access.canSeeQuestionBankStats ||
      access.canSeeQuestionBankPendingReview ||
      access.canContributeQuestionBank
        ? db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE approval_status = 'PENDING_REVIEW')::int AS pending_review_count,
              MIN(created_at) FILTER (WHERE approval_status = 'PENDING_REVIEW') AS oldest_pending_at,
              COUNT(*) FILTER (
                WHERE approval_status = 'RETURNED' AND created_by_id = ${authUser.id}
              )::int AS my_returned_count,
              COUNT(*) FILTER (WHERE approval_status = 'APPROVED')::int AS approved_count,
              COUNT(*)::int AS total_active_count
            FROM questions
            WHERE is_bank_item = true
              AND is_archived = false
          `)
        : Promise.resolve(null),

      // 10. Bounded recent safe audit events (strictly filtered to allowed actions, NEVER selecting detailsJson/ipAddress)
      allowedAuditActions.length > 0
        ? db
            .select({
              id: auditLogs.id,
              actorName: auditLogs.actorName,
              action: auditLogs.action,
              entityType: auditLogs.entityType,
              entityId: auditLogs.entityId,
              createdAt: auditLogs.createdAt,
            })
            .from(auditLogs)
            .where(inArray(auditLogs.action, allowedAuditActions))
            .orderBy(desc(auditLogs.createdAt))
            .limit(12)
        : Promise.resolve([]),

      // 11. Executive overview KPIs (ONLY for REPORTS_VIEW / SUPER_ADMIN)
      access.canViewReports
        ? db.execute(sql`
            SELECT
              (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'ACTIVE' AND expires_at > ${now}) AS active_subscriptions,
              (SELECT COUNT(*)::int FROM device_sessions WHERE is_revoked = false AND is_blocked = false AND last_heartbeat_at > ${fiveMinAgo}) AS online_now,
              (SELECT COALESCE(SUM(final_amount_egp), 0)::int FROM orders WHERE status = 'PAID') AS total_revenue_egp,
              (SELECT COALESCE(SUM(final_amount_egp), 0)::int FROM orders WHERE status IN ('PENDING', 'UNDER_REVIEW')) AS pending_revenue_egp
          `)
        : Promise.resolve(null),
    ]);

    const sRow = (studentAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const hwSubRow = (homeworkSubsAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const hwUpRow = (homeworkUpcomingAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const exAttRow = (examAttemptsAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const exOvRow = (examsOverviewAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const qbRow = (questionBankAggRes?.rows?.[0] ?? {}) as Record<string, unknown>;
    const execRow = (executiveOverviewRes?.rows?.[0] ?? {}) as Record<string, unknown>;

    const upcomingExamsList: UpcomingExamItem[] | null = access.canSeeExamsOverview
      ? ((examsUpcomingListRes?.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
          const status = row.publication_status === 'SCHEDULED' ? 'SCHEDULED' : 'PUBLISHED';
          return {
            id: toInt(row.id),
            titleAr: String(row.title_ar ?? ''),
            trackNameAr: String(row.track_name_ar ?? ''),
            gradeNameAr: String(row.grade_name_ar ?? ''),
            startsAtIso: toDateOrNull(row.starts_at)?.toISOString() ?? now.toISOString(),
            endsAtIso: toDateOrNull(row.ends_at)?.toISOString() ?? null,
            publicationStatus: status,
            publicationStatusLabelAr: status === 'SCHEDULED' ? 'مجدول' : 'منشور',
            durationMin: toInt(row.duration_min),
          };
        })
      : null;

    const upcomingHomeworkList: UpcomingHomeworkItem[] | null = access.canSeeHomeworkUpcoming
      ? ((homeworkUpcomingListRes?.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
          const status = row.publication_status === 'SCHEDULED' ? 'SCHEDULED' : 'PUBLISHED';
          return {
            id: toInt(row.id),
            titleAr: String(row.title_ar ?? ''),
            trackNameAr: String(row.track_name_ar ?? ''),
            gradeNameAr: String(row.grade_name_ar ?? ''),
            deadlineIso: toDateOrNull(row.deadline)?.toISOString() ?? now.toISOString(),
            publicationStatus: status,
            publicationStatusLabelAr: status === 'SCHEDULED' ? 'مجدول' : 'منشور',
            submittedCount: toInt(row.submitted_count),
          };
        })
      : null;

    const nearestUpcomingExam = upcomingExamsList?.[0] ?? null;
    const nearestUpcomingHomework = upcomingHomeworkList?.[0] ?? null;

    const rawAggregates: SmartDashboardRawAggregates = {
      pendingStudentsCount: toInt(sRow.pending_students),
      recentPendingStudents7dCount: toInt(sRow.recent_pending_7d),
      oldestPendingStudentAt: toDateOrNull(sRow.oldest_pending_at),
      totalStudentsCount: toInt(sRow.total_students),
      activeStudentsCount: toInt(sRow.active_students),

      homeworkAwaitingGradingCount: toInt(hwSubRow.awaiting_count),
      homeworkAssignmentsWithPendingCount: toInt(hwSubRow.assignments_with_pending_count),
      oldestPendingHomeworkAt: toDateOrNull(hwSubRow.oldest_pending_at),

      examsAwaitingManualGradingCount: toInt(exAttRow.awaiting_attempts_count),
      examsWithPendingGradingCount: toInt(exAttRow.exams_with_pending_count),
      oldestPendingExamAttemptAt: toDateOrNull(exAttRow.oldest_attempt_at),

      questionBankPendingReviewCount: toInt(qbRow.pending_review_count),
      oldestPendingQuestionAt: toDateOrNull(qbRow.oldest_pending_at),
      myReturnedQuestionsCount: toInt(qbRow.my_returned_count),

      upcomingExams7dCount: toInt(exOvRow.upcoming_7d_count),
      upcomingExamsPublishedCount: toInt(exOvRow.upcoming_published_count),
      upcomingExamsScheduledCount: toInt(exOvRow.upcoming_scheduled_count),
      nearestUpcomingExamStartsAt: nearestUpcomingExam
        ? new Date(nearestUpcomingExam.startsAtIso)
        : null,
      nearestUpcomingExamTitleAr: nearestUpcomingExam?.titleAr ?? null,

      upcomingHomework7dCount: toInt(hwUpRow.upcoming_7d_count),
      nearestUpcomingHomeworkDeadlineAt: nearestUpcomingHomework
        ? new Date(nearestUpcomingHomework.deadlineIso)
        : null,
      nearestUpcomingHomeworkTitleAr: nearestUpcomingHomework?.titleAr ?? null,

      totalActiveExamsCount: toInt(exOvRow.total_active_exams),
      publishedOrScheduledExamsCount: toInt(exOvRow.published_or_scheduled_count),
      draftExamsCount: toInt(exOvRow.draft_count),
    };

    const summary = buildSummaryCards(rawAggregates, access);
    const attentionTasks = buildAttentionTasks(rawAggregates, access, now);
    const quickActions = buildQuickActions(access);

    const recentActivity = recentAuditRows
      .map((row) => sanitizeActivityEvent(row, access))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 10);

    const studentsByGrade: GradeDistributionStat[] | null = access.canSeeTotalStudents
      ? ((studentsByGradeRes?.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
          gradeId: toInt(row.grade_id),
          gradeNameAr: String(row.grade_name_ar ?? ''),
          trackNameAr: String(row.track_name_ar ?? ''),
          studentsCount: toInt(row.students_count),
        }))
      : null;

    const avgPublishedRaw = exAttRow.avg_published_percent;
    const avgPublishedScorePercent =
      avgPublishedRaw === null || avgPublishedRaw === undefined ? null : toInt(avgPublishedRaw);

    const academicStats: SmartDashboardAcademicStats = {
      studentsByGrade,
      recentRegistrations30d: access.canSeeTotalStudents
        ? toInt(sRow.recent_registrations_30d)
        : null,
      homeworkTotals: access.canSeeHomeworkUpcoming
        ? {
            activeAssignments: toInt(hwUpRow.active_assignments),
            submittedCount: toInt(hwSubRow.submitted_count),
            gradedPublishedCount: toInt(hwSubRow.graded_published_count),
            awaitingReviewCount: access.canSeeHomeworkGrading
              ? toInt(hwSubRow.awaiting_count)
              : 0,
          }
        : null,
      examTotals: access.canSeeExamsOverview
        ? {
            activeExams: toInt(exOvRow.total_active_exams),
            submittedAttempts: toInt(exAttRow.submitted_attempts_count),
            gradedAttempts: toInt(exAttRow.graded_attempts_count),
            awaitingManualCount: access.canSeeExamGrading
              ? toInt(exAttRow.awaiting_attempts_count)
              : 0,
            averagePublishedScorePercent: avgPublishedScorePercent,
          }
        : null,
      questionBankTotals: access.canSeeQuestionBankStats
        ? {
            approvedCount: toInt(qbRow.approved_count),
            pendingReviewCount: access.canSeeQuestionBankPendingReview
              ? toInt(qbRow.pending_review_count)
              : 0,
            totalActiveCount: toInt(qbRow.total_active_count),
          }
        : null,
      executiveOverview: access.canViewReports
        ? {
            activeSubscriptions: toInt(execRow.active_subscriptions),
            onlineNow: toInt(execRow.online_now),
            totalRevenueEgp: toInt(execRow.total_revenue_egp),
            pendingRevenueEgp: toInt(execRow.pending_revenue_egp),
          }
        : null,
    };

    const payload: SmartDashboardResponse = {
      generatedAtIso: now.toISOString(),
      timezone: CAIRO_TIMEZONE,
      upcomingWindowDays: UPCOMING_WINDOW_DAYS,
      roleSlug: authUser.roleSlug,
      roleNameAr: authUser.roleNameAr,
      userFullName: authUser.fullName,
      access,
      summary,
      attentionTasks,
      quickActions,
      upcoming: {
        exams: upcomingExamsList,
        homework: upcomingHomeworkList,
      },
      recentActivity,
      academicStats,
    };

    return res.json(payload);
  } catch (error) {
    console.error('GET /api/admin/smart-dashboard error:', error);
    return res
      .status(500)
      .json({ error: 'تعذر تحميل بيانات لوحة التحكم الذكية. يرجى المحاولة مرة أخرى.' });
  }
});
