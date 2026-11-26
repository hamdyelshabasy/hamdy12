import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROLE_PERMISSIONS, type PermissionSubject } from '../../lib/permissions.ts';
import {
  buildAttentionTasks,
  buildQuickActions,
  buildSummaryCards,
  computeTaskPriority,
  formatCairoDateTime,
  getAllowedAuditActionsForRole,
  isWithinUpcomingWindow,
  resolveDashboardAccess,
  sanitizeActivityEvent,
  type SmartDashboardRawAggregates,
} from './smartDashboard.ts';

function makeUser(
  roleSlug: keyof typeof DEFAULT_ROLE_PERMISSIONS,
  status = 'ACTIVE',
): PermissionSubject {
  return {
    roleSlug,
    status,
    permissions: DEFAULT_ROLE_PERMISSIONS[roleSlug],
  };
}

function makeSampleAggregates(now: Date): SmartDashboardRawAggregates {
  return {
    pendingStudentsCount: 4,
    recentPendingStudents7dCount: 2,
    oldestPendingStudentAt: new Date(now.getTime() - 50 * 60 * 60 * 1000), // 50h waiting -> URGENT
    totalStudentsCount: 120,
    activeStudentsCount: 112,

    homeworkAwaitingGradingCount: 5,
    homeworkAssignmentsWithPendingCount: 2,
    oldestPendingHomeworkAt: new Date(now.getTime() - 28 * 60 * 60 * 1000), // 28h waiting -> SOON

    examsAwaitingManualGradingCount: 2,
    examsWithPendingGradingCount: 1,
    oldestPendingExamAttemptAt: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4h waiting -> NORMAL

    questionBankPendingReviewCount: 12, // >= 10 -> URGENT
    oldestPendingQuestionAt: new Date(now.getTime() - 10 * 60 * 60 * 1000),
    myReturnedQuestionsCount: 2,

    upcomingExams7dCount: 2,
    upcomingExamsPublishedCount: 1,
    upcomingExamsScheduledCount: 1,
    nearestUpcomingExamStartsAt: new Date(now.getTime() + 18 * 60 * 60 * 1000), // 18h ahead -> URGENT
    nearestUpcomingExamTitleAr: 'اختبار الفصل الأول — التيار الكهربي',

    upcomingHomework7dCount: 1,
    nearestUpcomingHomeworkDeadlineAt: new Date(now.getTime() + 36 * 60 * 60 * 1000), // 36h ahead -> SOON
    nearestUpcomingHomeworkTitleAr: 'واجب قانون أوم للدائرة المغلقة',

    totalActiveExamsCount: 9,
    publishedOrScheduledExamsCount: 6,
    draftExamsCount: 3,
  };
}

test('resolveDashboardAccess enforces strict role boundaries and blocks STUDENT & suspended staff', () => {
  const superAccess = resolveDashboardAccess(makeUser('SUPER_ADMIN'));
  assert.equal(superAccess.canSeePendingStudents, true);
  assert.equal(superAccess.canManageExams, true);
  assert.equal(superAccess.canSeeQuestionBankPendingReview, true);
  assert.equal(superAccess.canManageStaff, true);
  assert.equal(superAccess.canViewReports, true);

  const cmAccess = resolveDashboardAccess(makeUser('CONTENT_MANAGER'));
  assert.equal(cmAccess.canManageExams, true);
  assert.equal(cmAccess.canManageHomework, true);
  assert.equal(cmAccess.canContributeQuestionBank, true);
  assert.equal(cmAccess.canSeePendingStudents, false);
  assert.equal(cmAccess.canSeeTotalStudents, false);
  assert.equal(cmAccess.canSeeHomeworkGrading, false);
  assert.equal(cmAccess.canSeeExamGrading, false);
  assert.equal(cmAccess.canManageStaff, false);
  assert.equal(cmAccess.canViewPayments, false);
  assert.equal(cmAccess.canViewReports, false);

  const taAccess = resolveDashboardAccess(makeUser('TEACHING_ASSISTANT'));
  assert.equal(taAccess.canApproveStudents, true);
  assert.equal(taAccess.canSeeHomeworkGrading, true);
  assert.equal(taAccess.canSeeExamGrading, true);
  assert.equal(taAccess.canContributeQuestionBank, true);
  assert.equal(taAccess.canManageExams, false);
  assert.equal(taAccess.canManageHomework, false);
  assert.equal(taAccess.canSeeQuestionBankPendingReview, false);
  assert.equal(taAccess.canManageStaff, false);
  assert.equal(taAccess.canViewPayments, false);
  assert.equal(taAccess.canViewReports, false);

  const supportAccess = resolveDashboardAccess(makeUser('SUPPORT'));
  assert.equal(supportAccess.canSeeTotalStudents, true);
  assert.equal(supportAccess.canViewPayments, true);
  assert.equal(supportAccess.canApproveStudents, false);
  assert.equal(supportAccess.canSeeHomeworkGrading, false);
  assert.equal(supportAccess.canSeeExamGrading, false);
  assert.equal(supportAccess.canSeeExamsOverview, false);
  assert.equal(supportAccess.canManageStaff, false);

  const studentAccess = resolveDashboardAccess(makeUser('STUDENT'));
  assert.equal(Object.values(studentAccess).every((v) => v === false), true);

  const suspendedTaAccess = resolveDashboardAccess(makeUser('TEACHING_ASSISTANT', 'SUSPENDED'));
  assert.equal(Object.values(suspendedTaAccess).every((v) => v === false), true);
});

test('buildSummaryCards nullifies every unauthorized card on the server side', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const agg = makeSampleAggregates(now);

  const cmCards = buildSummaryCards(agg, resolveDashboardAccess(makeUser('CONTENT_MANAGER')));
  assert.equal(cmCards.pendingStudents, null);
  assert.equal(cmCards.totalStudents, null);
  assert.equal(cmCards.homeworkAwaitingGrading, null);
  assert.equal(cmCards.examsAwaitingGrading, null);
  assert.notEqual(cmCards.upcomingExams, null);
  assert.notEqual(cmCards.examsAndDrafts, null);
  assert.equal(cmCards.examsAndDrafts?.canCreateSmartExam, true);

  const taCards = buildSummaryCards(agg, resolveDashboardAccess(makeUser('TEACHING_ASSISTANT')));
  assert.notEqual(taCards.pendingStudents, null);
  assert.notEqual(taCards.homeworkAwaitingGrading, null);
  assert.notEqual(taCards.examsAwaitingGrading, null);
  assert.equal(taCards.questionBankPending?.pendingReviewCount, 0); // TA cannot review others' pending questions
  assert.equal(taCards.questionBankPending?.myReturnedCount, 2); // TA sees own returned questions
  assert.equal(taCards.examsAndDrafts?.canCreateSmartExam, false);

  const supportCards = buildSummaryCards(agg, resolveDashboardAccess(makeUser('SUPPORT')));
  assert.notEqual(supportCards.totalStudents, null);
  assert.equal(supportCards.homeworkAwaitingGrading, null);
  assert.equal(supportCards.examsAwaitingGrading, null);
  assert.equal(supportCards.upcomingExams, null);
  assert.equal(supportCards.upcomingHomework, null);
  assert.equal(supportCards.questionBankPending, null);
});

test('computeTaskPriority applies explicit deterministic rules for URGENT, SOON, and NORMAL', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  // Deadline <= 24h -> URGENT
  assert.equal(
    computeTaskPriority({ count: 1, now, upcomingDueAt: new Date(now.getTime() + 12 * 3600_000) }),
    'URGENT',
  );
  // Deadline 48h -> SOON
  assert.equal(
    computeTaskPriority({ count: 1, now, upcomingDueAt: new Date(now.getTime() + 48 * 3600_000) }),
    'SOON',
  );
  // Waiting >= 48h -> URGENT
  assert.equal(
    computeTaskPriority({ count: 1, now, oldestWaitingAt: new Date(now.getTime() - 49 * 3600_000) }),
    'URGENT',
  );
  // Waiting 30h -> SOON
  assert.equal(
    computeTaskPriority({ count: 1, now, oldestWaitingAt: new Date(now.getTime() - 30 * 3600_000) }),
    'SOON',
  );
  // Large backlog >= 10 -> URGENT
  assert.equal(computeTaskPriority({ count: 10, now }), 'URGENT');
  // Moderate backlog >= 3 -> SOON
  assert.equal(computeTaskPriority({ count: 3, now }), 'SOON');
  // Returned questions -> SOON
  assert.equal(computeTaskPriority({ count: 1, now, isReturnedForFix: true }), 'SOON');
  // Small fresh item -> NORMAL
  assert.equal(computeTaskPriority({ count: 1, now }), 'NORMAL');
});

test('buildAttentionTasks produces prioritized, deduplicated, role-filtered tasks and omits zero counts', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const agg = makeSampleAggregates(now);

  const superTasks = buildAttentionTasks(agg, resolveDashboardAccess(makeUser('SUPER_ADMIN')), now);
  assert.ok(superTasks.length >= 6);
  // All IDs unique
  const uniqueIds = new Set(superTasks.map((t) => t.id));
  assert.equal(uniqueIds.size, superTasks.length);
  // Sorted URGENT before SOON before NORMAL
  assert.equal(superTasks[0].priority, 'URGENT');
  assert.equal(superTasks[superTasks.length - 1].priority, 'NORMAL');

  // Teaching Assistant gets delegated tasks only (NO question-bank-review, NO draft-exams-review)
  const taTasks = buildAttentionTasks(agg, resolveDashboardAccess(makeUser('TEACHING_ASSISTANT')), now);
  const taIds = new Set(taTasks.map((t) => t.id));
  assert.equal(taIds.has('pending-students'), true);
  assert.equal(taIds.has('homework-grading'), true);
  assert.equal(taIds.has('exam-manual-grading'), true);
  assert.equal(taIds.has('question-bank-returned-mine'), true);
  assert.equal(taIds.has('question-bank-review'), false);
  assert.equal(taIds.has('draft-exams-review'), false);

  // Zero-count aggregates produce empty task queue
  const zeroAgg: SmartDashboardRawAggregates = {
    pendingStudentsCount: 0,
    recentPendingStudents7dCount: 0,
    oldestPendingStudentAt: null,
    totalStudentsCount: 5,
    activeStudentsCount: 5,
    homeworkAwaitingGradingCount: 0,
    homeworkAssignmentsWithPendingCount: 0,
    oldestPendingHomeworkAt: null,
    examsAwaitingManualGradingCount: 0,
    examsWithPendingGradingCount: 0,
    oldestPendingExamAttemptAt: null,
    questionBankPendingReviewCount: 0,
    oldestPendingQuestionAt: null,
    myReturnedQuestionsCount: 0,
    upcomingExams7dCount: 0,
    upcomingExamsPublishedCount: 0,
    upcomingExamsScheduledCount: 0,
    nearestUpcomingExamStartsAt: null,
    nearestUpcomingExamTitleAr: null,
    upcomingHomework7dCount: 0,
    nearestUpcomingHomeworkDeadlineAt: null,
    nearestUpcomingHomeworkTitleAr: null,
    totalActiveExamsCount: 2,
    publishedOrScheduledExamsCount: 2,
    draftExamsCount: 0,
  };
  assert.deepEqual(
    buildAttentionTasks(zeroAgg, resolveDashboardAccess(makeUser('SUPER_ADMIN')), now),
    [],
  );
});

test('buildQuickActions strictly respects role permissions (TA cannot see smart exam or staff management)', () => {
  const superActions = buildQuickActions(resolveDashboardAccess(makeUser('SUPER_ADMIN')));
  const superIds = new Set(superActions.map((a) => a.id));
  assert.equal(superIds.has('smart-exam'), true);
  assert.equal(superIds.has('create-exam'), true);
  assert.equal(superIds.has('manage-staff'), true);
  assert.equal(superIds.has('review-questions'), true);

  const taActions = buildQuickActions(resolveDashboardAccess(makeUser('TEACHING_ASSISTANT')));
  const taIds = new Set(taActions.map((a) => a.id));
  assert.equal(taIds.has('smart-exam'), false);
  assert.equal(taIds.has('create-exam'), false);
  assert.equal(taIds.has('create-homework'), false);
  assert.equal(taIds.has('manage-staff'), false);
  assert.equal(taIds.has('review-questions'), false);
  assert.equal(taIds.has('add-question'), true);
  assert.equal(taIds.has('approve-students'), true);
  assert.equal(taIds.has('grade-homework'), true);

  const supportActions = buildQuickActions(resolveDashboardAccess(makeUser('SUPPORT')));
  assert.deepEqual(
    supportActions.map((a) => a.id),
    ['manage-students'],
  );
});

test('sanitizeActivityEvent allow-lists safe events, drops secrets/logins, and filters by role', () => {
  const superAccess = resolveDashboardAccess(makeUser('SUPER_ADMIN'));
  const taAccess = resolveDashboardAccess(makeUser('TEACHING_ASSISTANT'));
  const cmAccess = resolveDashboardAccess(makeUser('CONTENT_MANAGER'));

  // Password resets and login events are NEVER exposed even to SUPER_ADMIN
  assert.equal(
    sanitizeActivityEvent(
      {
        id: 1,
        actorName: 'المدير العام',
        action: 'STAFF_PASSWORD_RESET',
        entityType: 'staff',
        entityId: '2',
        createdAt: new Date().toISOString(),
      },
      superAccess,
    ),
    null,
  );
  assert.equal(
    sanitizeActivityEvent(
      {
        id: 2,
        actorName: 'طالب',
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: '5',
        createdAt: new Date().toISOString(),
      },
      superAccess,
    ),
    null,
  );

  // Payment event is visible to SUPER_ADMIN, hidden from TA and CONTENT_MANAGER
  const paymentRow = {
    id: 3,
    actorName: 'المدير العام',
    action: 'PAYMENT_VERIFIED_AND_GRANTED',
    entityType: 'order',
    entityId: '10',
    createdAt: '2026-11-22T10:00:00Z',
  };
  assert.notEqual(sanitizeActivityEvent(paymentRow, superAccess), null);
  assert.equal(sanitizeActivityEvent(paymentRow, taAccess), null);
  assert.equal(sanitizeActivityEvent(paymentRow, cmAccess), null);

  // Student registration is hidden from CONTENT_MANAGER, visible to TA
  const studentRegRow = {
    id: 4,
    actorName: 'أحمد محمود',
    action: 'STUDENT_REGISTERED',
    entityType: 'user',
    entityId: '11',
    createdAt: '2026-11-22T10:05:00Z',
  };
  assert.equal(sanitizeActivityEvent(studentRegRow, cmAccess), null);
  assert.notEqual(sanitizeActivityEvent(studentRegRow, taAccess), null);

  // Allowed actions list for SUPPORT never includes grading or staff actions
  const supportActions = getAllowedAuditActionsForRole(resolveDashboardAccess(makeUser('SUPPORT')));
  assert.equal(supportActions.includes('STAFF_CREATED'), false);
  assert.equal(supportActions.includes('HOMEWORK_GRADED'), false);
  assert.equal(supportActions.includes('STUDENT_REGISTERED'), true);
  assert.equal(supportActions.includes('PAYMENT_VERIFIED_AND_GRANTED'), true);
});

test('isWithinUpcomingWindow and formatCairoDateTime enforce 7-day bounds and Cairo timezone', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.equal(isWithinUpcomingWindow(new Date('2026-11-22T11:59:59Z'), now, 7), false); // past
  assert.equal(isWithinUpcomingWindow(new Date('2026-11-22T12:00:00Z'), now, 7), true); // exact now
  assert.equal(isWithinUpcomingWindow(new Date('2026-11-29T12:00:00Z'), now, 7), true); // exact +7d
  assert.equal(isWithinUpcomingWindow(new Date('2026-11-29T12:00:01Z'), now, 7), false); // past +7d

  const formatted = formatCairoDateTime('2026-11-22T12:00:00Z');
  assert.ok(formatted.length > 3 && formatted !== '—');
});
