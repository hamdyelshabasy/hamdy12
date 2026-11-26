import {
  PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isAccountActive,
  isStaffRole,
  type PermissionSubject,
} from '../../lib/permissions.ts';
import type {
  ActivityCategory,
  AttentionTaskItem,
  AttentionTaskPriority,
  DashboardNavigationTarget,
  QuickActionItem,
  RecentActivityItem,
  SmartDashboardAccess,
  SmartDashboardSummaryCards,
} from '../../types/smartDashboard.ts';

export const CAIRO_TIMEZONE = 'Africa/Cairo' as const;
export const UPCOMING_WINDOW_DAYS = 7;

export const PRIORITY_LABELS_AR: Record<AttentionTaskPriority, string> = {
  URGENT: 'عاجل',
  SOON: 'قريب',
  NORMAL: 'عادي',
};

const PRIORITY_RANK: Record<AttentionTaskPriority, number> = {
  URGENT: 0,
  SOON: 1,
  NORMAL: 2,
};

export interface SmartDashboardRawAggregates {
  pendingStudentsCount: number;
  recentPendingStudents7dCount: number;
  oldestPendingStudentAt: Date | null;
  totalStudentsCount: number;
  activeStudentsCount: number;

  homeworkAwaitingGradingCount: number;
  homeworkAssignmentsWithPendingCount: number;
  oldestPendingHomeworkAt: Date | null;

  examsAwaitingManualGradingCount: number;
  examsWithPendingGradingCount: number;
  oldestPendingExamAttemptAt: Date | null;

  questionBankPendingReviewCount: number;
  oldestPendingQuestionAt: Date | null;
  myReturnedQuestionsCount: number;

  upcomingExams7dCount: number;
  upcomingExamsPublishedCount: number;
  upcomingExamsScheduledCount: number;
  nearestUpcomingExamStartsAt: Date | null;
  nearestUpcomingExamTitleAr: string | null;

  upcomingHomework7dCount: number;
  nearestUpcomingHomeworkDeadlineAt: Date | null;
  nearestUpcomingHomeworkTitleAr: string | null;

  totalActiveExamsCount: number;
  publishedOrScheduledExamsCount: number;
  draftExamsCount: number;
}

/**
 * Computes strictly permission-gated visibility flags from existing RBAC permissions.
 * Never grants any permission not already owned by the role; deny-by-default for students/inactive staff.
 */
export function resolveDashboardAccess(
  subject: PermissionSubject | null | undefined,
): SmartDashboardAccess {
  if (!subject || !isStaffRole(subject.roleSlug) || !isAccountActive(subject.status)) {
    return {
      canSeePendingStudents: false,
      canSeeTotalStudents: false,
      canApproveStudents: false,
      canSeeHomeworkGrading: false,
      canSeeHomeworkUpcoming: false,
      canManageHomework: false,
      canSeeExamGrading: false,
      canSeeExamsOverview: false,
      canManageExams: false,
      canSeeQuestionBankPendingReview: false,
      canContributeQuestionBank: false,
      canSeeQuestionBankStats: false,
      canManageStaff: false,
      canViewPayments: false,
      canViewReports: false,
      canViewAudit: false,
    };
  }

  const canApproveStudents = hasAnyPermission(subject, [
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.STUDENTS_MANAGE,
  ]);
  const canSeeTotalStudents = hasAnyPermission(subject, [
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.STUDENTS_MANAGE,
  ]);
  const canSeeHomeworkGrading = hasPermission(subject, PERMISSIONS.HOMEWORK_GRADE);
  const canManageHomework = hasPermission(subject, PERMISSIONS.HOMEWORK_MANAGE);
  const canSeeHomeworkUpcoming = hasAnyPermission(subject, [
    PERMISSIONS.HOMEWORK_VIEW,
    PERMISSIONS.HOMEWORK_MANAGE,
    PERMISSIONS.HOMEWORK_GRADE,
  ]);
  const canSeeExamGrading = hasPermission(subject, PERMISSIONS.EXAMS_GRADE);
  const canManageExams = hasPermission(subject, PERMISSIONS.EXAMS_MANAGE);
  const canSeeExamsOverview = hasAnyPermission(subject, [
    PERMISSIONS.EXAMS_VIEW,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.EXAMS_GRADE,
  ]);
  const canSeeQuestionBankPendingReview = hasAnyPermission(subject, [
    PERMISSIONS.QUESTION_BANK_REVIEW,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ]);
  const canContributeQuestionBank = hasAnyPermission(subject, [
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ]);
  const canSeeQuestionBankStats = hasAnyPermission(subject, [
    PERMISSIONS.QUESTION_BANK_VIEW,
    PERMISSIONS.QUESTION_BANK_CONTRIBUTE,
    PERMISSIONS.QUESTION_BANK_REVIEW,
    PERMISSIONS.QUESTION_BANK_MANAGE,
  ]);

  return {
    canSeePendingStudents: canApproveStudents || hasPermission(subject, PERMISSIONS.STUDENTS_VIEW),
    canSeeTotalStudents,
    canApproveStudents,
    canSeeHomeworkGrading,
    canSeeHomeworkUpcoming,
    canManageHomework,
    canSeeExamGrading,
    canSeeExamsOverview,
    canManageExams,
    canSeeQuestionBankPendingReview,
    canContributeQuestionBank,
    canSeeQuestionBankStats,
    canManageStaff: hasPermission(subject, PERMISSIONS.STAFF_MANAGE),
    canViewPayments: hasAnyPermission(subject, [
      PERMISSIONS.PAYMENTS_VIEW,
      PERMISSIONS.PAYMENTS_VERIFY,
    ]),
    canViewReports: hasPermission(subject, PERMISSIONS.REPORTS_VIEW),
    canViewAudit: hasPermission(subject, PERMISSIONS.AUDIT_VIEW),
  };
}

/**
 * Checks whether a timestamp falls within [now, now + days].
 */
export function isWithinUpcomingWindow(
  targetDate: Date | string | null | undefined,
  now: Date,
  days = UPCOMING_WINDOW_DAYS,
): boolean {
  if (!targetDate) return false;
  const parsed = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const diffMs = parsed.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Formats an ISO timestamp in Africa/Cairo (DST-aware) in clean Arabic.
 */
export function formatCairoDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

/**
 * Deterministic, explicit business-rule priority calculation for teacher tasks.
 * Never uses arbitrary or fake urgency:
 *  - URGENT ('عاجل'): upcoming deadline <= 24h, OR oldest waiting item >= 48h, OR backlog >= 10.
 *  - SOON   ('قريب'): upcoming deadline <= 72h, OR oldest waiting item >= 24h, OR backlog >= 3, OR returned-for-fix items.
 *  - NORMAL ('عادي'): all other active pending items.
 */
export function computeTaskPriority(params: {
  count: number;
  now: Date;
  upcomingDueAt?: Date | null;
  oldestWaitingAt?: Date | null;
  isReturnedForFix?: boolean;
}): AttentionTaskPriority {
  const { count, now, upcomingDueAt, oldestWaitingAt, isReturnedForFix } = params;

  if (upcomingDueAt && !Number.isNaN(upcomingDueAt.getTime())) {
    const hoursUntil = (upcomingDueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil >= 0 && hoursUntil <= 24) return 'URGENT';
    if (hoursUntil > 24 && hoursUntil <= 72) return 'SOON';
  }

  if (oldestWaitingAt && !Number.isNaN(oldestWaitingAt.getTime())) {
    const waitingHours = (now.getTime() - oldestWaitingAt.getTime()) / (1000 * 60 * 60);
    if (waitingHours >= 48) return 'URGENT';
    if (waitingHours >= 24) return 'SOON';
  }

  if (count >= 10) return 'URGENT';
  if (isReturnedForFix || count >= 3) return 'SOON';
  return 'NORMAL';
}

/**
 * Builds the 8 summary cards, strictly returning null for any card the role cannot access.
 */
export function buildSummaryCards(
  agg: SmartDashboardRawAggregates,
  access: SmartDashboardAccess,
): SmartDashboardSummaryCards {
  return {
    pendingStudents: access.canSeePendingStudents
      ? {
          count: agg.pendingStudentsCount,
          recent7dCount: agg.recentPendingStudents7dCount,
          oldestPendingAt: agg.oldestPendingStudentAt
            ? agg.oldestPendingStudentAt.toISOString()
            : null,
        }
      : null,
    homeworkAwaitingGrading: access.canSeeHomeworkGrading
      ? {
          awaitingCount: agg.homeworkAwaitingGradingCount,
          assignmentsWithPendingCount: agg.homeworkAssignmentsWithPendingCount,
          oldestSubmissionAt: agg.oldestPendingHomeworkAt
            ? agg.oldestPendingHomeworkAt.toISOString()
            : null,
        }
      : null,
    examsAwaitingGrading: access.canSeeExamGrading
      ? {
          awaitingAttemptsCount: agg.examsAwaitingManualGradingCount,
          examsWithPendingCount: agg.examsWithPendingGradingCount,
          oldestAttemptAt: agg.oldestPendingExamAttemptAt
            ? agg.oldestPendingExamAttemptAt.toISOString()
            : null,
        }
      : null,
    questionBankPending:
      access.canSeeQuestionBankPendingReview || access.canContributeQuestionBank
        ? {
            pendingReviewCount: access.canSeeQuestionBankPendingReview
              ? agg.questionBankPendingReviewCount
              : 0,
            myReturnedCount: agg.myReturnedQuestionsCount,
            oldestPendingAt:
              access.canSeeQuestionBankPendingReview && agg.oldestPendingQuestionAt
                ? agg.oldestPendingQuestionAt.toISOString()
                : null,
          }
        : null,
    upcomingExams: access.canSeeExamsOverview
      ? {
          within7DaysCount: agg.upcomingExams7dCount,
          publishedCount: agg.upcomingExamsPublishedCount,
          scheduledCount: agg.upcomingExamsScheduledCount,
          nearestStartsAt: agg.nearestUpcomingExamStartsAt
            ? agg.nearestUpcomingExamStartsAt.toISOString()
            : null,
          nearestExamTitleAr: agg.nearestUpcomingExamTitleAr,
        }
      : null,
    upcomingHomework: access.canSeeHomeworkUpcoming
      ? {
          within7DaysCount: agg.upcomingHomework7dCount,
          nearestDeadlineAt: agg.nearestUpcomingHomeworkDeadlineAt
            ? agg.nearestUpcomingHomeworkDeadlineAt.toISOString()
            : null,
          nearestHomeworkTitleAr: agg.nearestUpcomingHomeworkTitleAr,
        }
      : null,
    totalStudents: access.canSeeTotalStudents
      ? {
          totalStudents: agg.totalStudentsCount,
          activeStudents: agg.activeStudentsCount,
          pendingStudents: agg.pendingStudentsCount,
        }
      : null,
    examsAndDrafts: access.canSeeExamsOverview
      ? {
          totalActiveExams: agg.totalActiveExamsCount,
          publishedOrScheduledCount: agg.publishedOrScheduledExamsCount,
          draftCount: agg.draftExamsCount,
          canCreateSmartExam: access.canManageExams,
        }
      : null,
  };
}

/**
 * Builds the deduplicated, role-filtered, priority-ordered "مهام تحتاج تدخلك" queue.
 * Omits zero-count items so the teacher sees only actionable work.
 */
export function buildAttentionTasks(
  agg: SmartDashboardRawAggregates,
  access: SmartDashboardAccess,
  now: Date,
): AttentionTaskItem[] {
  const tasksMap = new Map<string, AttentionTaskItem>();

  const addTask = (task: AttentionTaskItem) => {
    if (task.count <= 0) return;
    if (!tasksMap.has(task.id)) {
      tasksMap.set(task.id, task);
    }
  };

  // 1. Pending Student Approvals (requires approve permission to take action)
  if (access.canApproveStudents && agg.pendingStudentsCount > 0) {
    const priority = computeTaskPriority({
      count: agg.pendingStudentsCount,
      now,
      oldestWaitingAt: agg.oldestPendingStudentAt,
    });
    addTask({
      id: 'pending-students',
      titleAr: 'مراجعة طلبات انضمام الطلاب',
      categoryAr: 'الطلاب والموافقات',
      descriptionAr:
        agg.pendingStudentsCount === 1
          ? 'يوجد طالب واحد بانتظار تفعيل حسابه للدخول إلى المنصة.'
          : `يوجد ${agg.pendingStudentsCount} طلاب بانتظار الموافقة على تسجيلهم وتفعيل حساباتهم.`,
      count: agg.pendingStudentsCount,
      priority,
      priorityLabelAr: PRIORITY_LABELS_AR[priority],
      dueAtIso: agg.oldestPendingStudentAt ? agg.oldestPendingStudentAt.toISOString() : null,
      actionLabelAr: 'مراجعة الطلبات',
      target: { tab: 'students', studentStatusFilter: 'PENDING_APPROVAL' },
    });
  }

  // 2. Homework Submissions Awaiting Grading
  if (access.canSeeHomeworkGrading && agg.homeworkAwaitingGradingCount > 0) {
    const priority = computeTaskPriority({
      count: agg.homeworkAwaitingGradingCount,
      now,
      oldestWaitingAt: agg.oldestPendingHomeworkAt,
    });
    addTask({
      id: 'homework-grading',
      titleAr: 'تصحيح تسليمات الواجبات المعلقة',
      categoryAr: 'الواجبات',
      descriptionAr: `هناك ${agg.homeworkAwaitingGradingCount} تسليمًا بانتظار التصحيح أو نشر الدرجة عبر ${agg.homeworkAssignmentsWithPendingCount} واجب.`,
      count: agg.homeworkAwaitingGradingCount,
      priority,
      priorityLabelAr: PRIORITY_LABELS_AR[priority],
      dueAtIso: agg.oldestPendingHomeworkAt ? agg.oldestPendingHomeworkAt.toISOString() : null,
      actionLabelAr: 'بدء التصحيح',
      target: { tab: 'homework', homeworkStatusFilter: 'PUBLISHED' },
    });
  }

  // 3. Exam Attempts Awaiting Manual Grading
  if (access.canSeeExamGrading && agg.examsAwaitingManualGradingCount > 0) {
    const priority = computeTaskPriority({
      count: agg.examsAwaitingManualGradingCount,
      now,
      oldestWaitingAt: agg.oldestPendingExamAttemptAt,
    });
    addTask({
      id: 'exam-manual-grading',
      titleAr: 'تصحيح الأسئلة المقالية في الامتحانات',
      categoryAr: 'الامتحانات',
      descriptionAr: `هناك ${agg.examsAwaitingManualGradingCount} محاولة امتحان تنتظر التصحيح اليدوي واعتماد الدرجة النهائية.`,
      count: agg.examsAwaitingManualGradingCount,
      priority,
      priorityLabelAr: PRIORITY_LABELS_AR[priority],
      dueAtIso: agg.oldestPendingExamAttemptAt
        ? agg.oldestPendingExamAttemptAt.toISOString()
        : null,
      actionLabelAr: 'مراجعة الإجابات',
      target: { tab: 'exams' },
    });
  }

  // 4. Question Bank Items Pending Review (Reviewers / Super Admin)
  if (access.canSeeQuestionBankPendingReview && agg.questionBankPendingReviewCount > 0) {
    const priority = computeTaskPriority({
      count: agg.questionBankPendingReviewCount,
      now,
      oldestWaitingAt: agg.oldestPendingQuestionAt,
    });
    addTask({
      id: 'question-bank-review',
      titleAr: 'اعتماد أسئلة بنك الأسئلة المرسلة للمراجعة',
      categoryAr: 'بنك الأسئلة',
      descriptionAr: `يوجد ${agg.questionBankPendingReviewCount} سؤالًا بانتظار المراجعة والاعتماد لإتاحتها في الامتحانات والواجبات.`,
      count: agg.questionBankPendingReviewCount,
      priority,
      priorityLabelAr: PRIORITY_LABELS_AR[priority],
      dueAtIso: agg.oldestPendingQuestionAt ? agg.oldestPendingQuestionAt.toISOString() : null,
      actionLabelAr: 'مراجعة الأسئلة',
      target: { tab: 'question_bank', questionBankStatusTab: 'PENDING_REVIEW' },
    });
  }

  // 5. Contributor's Own Returned Questions Needing Correction (TA / Content Manager / Admin)
  if (access.canContributeQuestionBank && agg.myReturnedQuestionsCount > 0) {
    const priority = computeTaskPriority({
      count: agg.myReturnedQuestionsCount,
      now,
      isReturnedForFix: true,
    });
    addTask({
      id: 'question-bank-returned-mine',
      titleAr: 'أسئلة معادة من المراجعة تحتاج تعديلك',
      categoryAr: 'بنك الأسئلة',
      descriptionAr: `تمت إعادة ${agg.myReturnedQuestionsCount} سؤالًا من مساهماتك بملاحظات للتعديل وإعادة الإرسال.`,
      count: agg.myReturnedQuestionsCount,
      priority,
      priorityLabelAr: PRIORITY_LABELS_AR[priority],
      dueAtIso: null,
      actionLabelAr: 'تعديل الأسئلة',
      target: { tab: 'question_bank', questionBankStatusTab: 'RETURNED' },
    });
  }

  // 6. Imminent Upcoming Exams (within 72 hours)
  if (
    access.canSeeExamsOverview &&
    agg.upcomingExams7dCount > 0 &&
    agg.nearestUpcomingExamStartsAt
  ) {
    const hoursUntil =
      (agg.nearestUpcomingExamStartsAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil >= 0 && hoursUntil <= 72) {
      const priority = computeTaskPriority({
        count: agg.upcomingExams7dCount,
        now,
        upcomingDueAt: agg.nearestUpcomingExamStartsAt,
      });
      addTask({
        id: 'upcoming-exam-soon',
        titleAr: 'امتحان قريب يبدأ خلال الساعات القادمة',
        categoryAr: 'جدول الامتحانات',
        descriptionAr: agg.nearestUpcomingExamTitleAr
          ? `أقرب امتحان: «${agg.nearestUpcomingExamTitleAr}» — تأكد من جاهزية الأسئلة والجدولة.`
          : `يوجد ${agg.upcomingExams7dCount} امتحانات قادمة خلال الأسبوع الجاري.`,
        count: agg.upcomingExams7dCount,
        priority,
        priorityLabelAr: PRIORITY_LABELS_AR[priority],
        dueAtIso: agg.nearestUpcomingExamStartsAt.toISOString(),
        actionLabelAr: 'عرض الامتحانات',
        target: { tab: 'exams' },
      });
    }
  }

  // 7. Imminent Homework Deadlines (within 48 hours)
  if (
    access.canSeeHomeworkUpcoming &&
    agg.upcomingHomework7dCount > 0 &&
    agg.nearestUpcomingHomeworkDeadlineAt
  ) {
    const hoursUntil =
      (agg.nearestUpcomingHomeworkDeadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil >= 0 && hoursUntil <= 48) {
      const priority = computeTaskPriority({
        count: agg.upcomingHomework7dCount,
        now,
        upcomingDueAt: agg.nearestUpcomingHomeworkDeadlineAt,
      });
      addTask({
        id: 'upcoming-homework-deadline',
        titleAr: 'موعد تسليم واجب يقترب',
        categoryAr: 'جدول الواجبات',
        descriptionAr: agg.nearestUpcomingHomeworkTitleAr
          ? `أقرب موعد تسليم للواجب «${agg.nearestUpcomingHomeworkTitleAr}».`
          : `يوجد ${agg.upcomingHomework7dCount} واجبات قريبة التسليم خلال 7 أيام.`,
        count: agg.upcomingHomework7dCount,
        priority,
        priorityLabelAr: PRIORITY_LABELS_AR[priority],
        dueAtIso: agg.nearestUpcomingHomeworkDeadlineAt.toISOString(),
        actionLabelAr: 'عرض الواجبات',
        target: { tab: 'homework' },
      });
    }
  }

  // 8. Unpublished Draft Exams (for exam managers only)
  if (access.canManageExams && agg.draftExamsCount > 0) {
    addTask({
      id: 'draft-exams-review',
      titleAr: 'مسودات امتحانات غير منشورة',
      categoryAr: 'الامتحانات',
      descriptionAr: `لديك ${agg.draftExamsCount} مسودة امتحان جاهزة للمراجعة والنشر أو الجدولة للطلاب.`,
      count: agg.draftExamsCount,
      priority: 'NORMAL',
      priorityLabelAr: PRIORITY_LABELS_AR.NORMAL,
      dueAtIso: null,
      actionLabelAr: 'مراجعة المسودات',
      target: { tab: 'exams', examStatusFilter: 'DRAFT' },
    });
  }

  return Array.from(tasksMap.values()).sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    return b.count - a.count;
  });
}

/**
 * Builds role-filtered Quick Actions reusing existing flows (including Smart Exam Generator).
 */
export function buildQuickActions(access: SmartDashboardAccess): QuickActionItem[] {
  const actions: QuickActionItem[] = [];

  if (access.canManageExams) {
    actions.push({
      id: 'wizard-exam',
      labelAr: 'إنشاء امتحان بخطوات سهلة',
      descriptionAr: 'معالج متدرج من 5 خطوات مع حفظ تلقائي للمسودة ومعاينة كاملة',
      iconKey: 'wizard_exam',
      accent: 'primary',
      target: { tab: 'exams', examAction: 'CREATE_WIZARD' },
    });
    actions.push({
      id: 'smart-exam',
      labelAr: 'إنشاء امتحان ذكي',
      descriptionAr: 'توليد امتحان تلقائيًا من بنك الأسئلة حسب التوزيع',
      iconKey: 'smart_exam',
      accent: 'default',
      target: { tab: 'exams', examAction: 'CREATE_SMART' },
    });
    actions.push({
      id: 'create-exam',
      labelAr: 'إنشاء امتحان جديد',
      descriptionAr: 'بناء امتحان يدوي وتحديد الإعدادات والأسئلة',
      iconKey: 'create_exam',
      accent: 'default',
      target: { tab: 'exams', examAction: 'CREATE_MANUAL' },
    });
  }

  if (access.canManageHomework) {
    actions.push({
      id: 'create-homework',
      labelAr: 'إنشاء واجب جديد',
      descriptionAr: 'إضافة واجب وربطه بالمنهج أو بنك الأسئلة',
      iconKey: 'create_homework',
      accent: 'default',
      target: { tab: 'homework', homeworkAction: 'CREATE' },
    });
  }

  if (access.canContributeQuestionBank) {
    actions.push({
      id: 'add-question',
      labelAr: 'إضافة سؤال لبنك الأسئلة',
      descriptionAr: 'إضافة سؤال جديد بالصور ونموذج الإجابة',
      iconKey: 'add_question',
      accent: 'default',
      target: { tab: 'question_bank', questionBankAction: 'CREATE' },
    });
  }

  if (access.canSeeQuestionBankPendingReview) {
    actions.push({
      id: 'review-questions',
      labelAr: 'مراجعة أسئلة البنك',
      descriptionAr: 'اعتماد أو إعادة الأسئلة المرسلة للمراجعة',
      iconKey: 'review_questions',
      accent: 'default',
      target: { tab: 'question_bank', questionBankStatusTab: 'PENDING_REVIEW' },
    });
  }

  if (access.canApproveStudents) {
    actions.push({
      id: 'approve-students',
      labelAr: 'مراجعة طلبات الطلاب',
      descriptionAr: 'قبول أو رفض طلبات التسجيل الجديدة',
      iconKey: 'approve_students',
      accent: 'default',
      target: { tab: 'students', studentStatusFilter: 'PENDING_APPROVAL' },
    });
  }

  if (access.canSeeHomeworkGrading) {
    actions.push({
      id: 'grade-homework',
      labelAr: 'تصحيح الواجبات',
      descriptionAr: 'متابعة تسليمات الطلاب ورصد الدرجات',
      iconKey: 'grade_homework',
      accent: 'default',
      target: { tab: 'homework', homeworkStatusFilter: 'PUBLISHED' },
    });
  }

  if (access.canSeeExamsOverview) {
    actions.push({
      id: 'manage-exams',
      labelAr: 'إدارة الامتحانات',
      descriptionAr: 'استعراض الامتحانات والتقارير والتصحيح اليدوي',
      iconKey: 'manage_exams',
      accent: 'default',
      target: { tab: 'exams' },
    });
  }

  if (access.canSeeTotalStudents) {
    actions.push({
      id: 'manage-students',
      labelAr: 'إدارة الطلاب',
      descriptionAr: 'البحث عن الطلاب ومتابعة حساباتهم وأجهزتهم',
      iconKey: 'manage_students',
      accent: 'default',
      target: { tab: 'students', studentStatusFilter: 'ALL' },
    });
  }

  if (access.canManageStaff) {
    actions.push({
      id: 'manage-staff',
      labelAr: 'إدارة المساعدين',
      descriptionAr: 'إضافة وتعديل حسابات الموظفين وصلاحياتهم',
      iconKey: 'manage_staff',
      accent: 'default',
      target: { tab: 'operations', opsSubTab: 'security' },
    });
  }

  return actions;
}

export interface RawAuditRow {
  id: number;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date | string;
}

interface ActivityRule {
  titleAr: string;
  category: ActivityCategory;
  categoryLabelAr: string;
  isAllowed: (access: SmartDashboardAccess) => boolean;
  target: (access: SmartDashboardAccess) => DashboardNavigationTarget | null;
}

const SAFE_ACTIVITY_RULES: Record<string, ActivityRule> = {
  STUDENT_REGISTERED: {
    titleAr: 'تسجيل طالب جديد بانتظار المراجعة',
    category: 'students',
    categoryLabelAr: 'الطلاب',
    isAllowed: (a) => a.canSeeTotalStudents,
    target: (a) =>
      a.canSeeTotalStudents ? { tab: 'students', studentStatusFilter: 'PENDING_APPROVAL' } : null,
  },
  STUDENT_APPROVED: {
    titleAr: 'الموافقة على حساب طالب وتفعيله',
    category: 'students',
    categoryLabelAr: 'الطلاب',
    isAllowed: (a) => a.canSeeTotalStudents,
    target: (a) => (a.canSeeTotalStudents ? { tab: 'students' } : null),
  },
  STUDENT_ADDED_MANUALLY: {
    titleAr: 'إضافة حساب طالب جديد',
    category: 'students',
    categoryLabelAr: 'الطلاب',
    isAllowed: (a) => a.canSeeTotalStudents,
    target: (a) => (a.canSeeTotalStudents ? { tab: 'students' } : null),
  },
  STUDENT_UPDATED: {
    titleAr: 'تحديث حالة أو بيانات طالب',
    category: 'students',
    categoryLabelAr: 'الطلاب',
    isAllowed: (a) => a.canSeeTotalStudents,
    target: (a) => (a.canSeeTotalStudents ? { tab: 'students' } : null),
  },
  ADDITIONAL_GRADE_REQUESTED: {
    titleAr: 'طلب انضمام طالب لصف دراسي إضافي',
    category: 'students',
    categoryLabelAr: 'الطلاب',
    isAllowed: (a) => a.canSeeTotalStudents,
    target: (a) => (a.canSeeTotalStudents ? { tab: 'students' } : null),
  },
  HOMEWORK_CREATED: {
    titleAr: 'إنشاء واجب دراسي جديد',
    category: 'homework',
    categoryLabelAr: 'الواجبات',
    isAllowed: (a) => a.canSeeHomeworkUpcoming,
    target: (a) => (a.canSeeHomeworkUpcoming ? { tab: 'homework' } : null),
  },
  HOMEWORK_STATUS_CHANGED: {
    titleAr: 'تحديث حالة نشر واجب',
    category: 'homework',
    categoryLabelAr: 'الواجبات',
    isAllowed: (a) => a.canSeeHomeworkUpcoming,
    target: (a) => (a.canSeeHomeworkUpcoming ? { tab: 'homework' } : null),
  },
  HOMEWORK_SUBMITTED: {
    titleAr: 'تسليم واجب جديد من طالب',
    category: 'homework',
    categoryLabelAr: 'الواجبات',
    isAllowed: (a) => a.canSeeHomeworkGrading || a.canManageHomework,
    target: (a) => (a.canSeeHomeworkUpcoming ? { tab: 'homework' } : null),
  },
  HOMEWORK_GRADED: {
    titleAr: 'تصحيح تسليم واجب ورصد الدرجة',
    category: 'homework',
    categoryLabelAr: 'الواجبات',
    isAllowed: (a) => a.canSeeHomeworkGrading || a.canManageHomework,
    target: (a) => (a.canSeeHomeworkUpcoming ? { tab: 'homework' } : null),
  },
  HOMEWORK_RETURNED_FOR_REVISION: {
    titleAr: 'إعادة واجب لطالب للمراجعة والتعديل',
    category: 'homework',
    categoryLabelAr: 'الواجبات',
    isAllowed: (a) => a.canSeeHomeworkGrading || a.canManageHomework,
    target: (a) => (a.canSeeHomeworkUpcoming ? { tab: 'homework' } : null),
  },
  PHASE2_EXAM_CREATED: {
    titleAr: 'إنشاء امتحان جديد',
    category: 'exams',
    categoryLabelAr: 'الامتحانات',
    isAllowed: (a) => a.canSeeExamsOverview,
    target: (a) => (a.canSeeExamsOverview ? { tab: 'exams' } : null),
  },
  EXAM_CREATED: {
    titleAr: 'إنشاء امتحان جديد',
    category: 'exams',
    categoryLabelAr: 'الامتحانات',
    isAllowed: (a) => a.canSeeExamsOverview,
    target: (a) => (a.canSeeExamsOverview ? { tab: 'exams' } : null),
  },
  SMART_EXAM_GENERATED: {
    titleAr: 'توليد امتحان ذكي من بنك الأسئلة',
    category: 'exams',
    categoryLabelAr: 'الامتحانات',
    isAllowed: (a) => a.canSeeExamsOverview,
    target: (a) => (a.canSeeExamsOverview ? { tab: 'exams' } : null),
  },
  PHASE2_ATTEMPT_GRADED: {
    titleAr: 'تصحيح محاولة امتحان ورصد الدرجة',
    category: 'exams',
    categoryLabelAr: 'الامتحانات',
    isAllowed: (a) => a.canSeeExamGrading || a.canManageExams,
    target: (a) => (a.canSeeExamsOverview ? { tab: 'exams' } : null),
  },
  EXAM_QUESTIONS_ADDED_FROM_BANK: {
    titleAr: 'إضافة أسئلة من بنك الأسئلة إلى امتحان',
    category: 'exams',
    categoryLabelAr: 'الامتحانات',
    isAllowed: (a) => a.canSeeExamsOverview,
    target: (a) => (a.canSeeExamsOverview ? { tab: 'exams' } : null),
  },
  QUESTION_BANK_CREATED: {
    titleAr: 'إضافة سؤال جديد إلى بنك الأسئلة',
    category: 'question_bank',
    categoryLabelAr: 'بنك الأسئلة',
    isAllowed: (a) => a.canSeeQuestionBankStats,
    target: (a) => (a.canSeeQuestionBankStats ? { tab: 'question_bank' } : null),
  },
  QUESTION_BANK_BULK_CREATED: {
    titleAr: 'رفع مجموعة أسئلة جديدة لبنك الأسئلة',
    category: 'question_bank',
    categoryLabelAr: 'بنك الأسئلة',
    isAllowed: (a) => a.canSeeQuestionBankStats,
    target: (a) => (a.canSeeQuestionBankStats ? { tab: 'question_bank' } : null),
  },
  QUESTION_BANK_SUBMITTED: {
    titleAr: 'إرسال سؤال للمراجعة والاعتماد',
    category: 'question_bank',
    categoryLabelAr: 'بنك الأسئلة',
    isAllowed: (a) => a.canSeeQuestionBankStats,
    target: (a) =>
      a.canSeeQuestionBankPendingReview
        ? { tab: 'question_bank', questionBankStatusTab: 'PENDING_REVIEW' }
        : a.canSeeQuestionBankStats
          ? { tab: 'question_bank' }
          : null,
  },
  QUESTION_BANK_APPROVED: {
    titleAr: 'اعتماد سؤال في بنك الأسئلة',
    category: 'question_bank',
    categoryLabelAr: 'بنك الأسئلة',
    isAllowed: (a) => a.canSeeQuestionBankStats,
    target: (a) => (a.canSeeQuestionBankStats ? { tab: 'question_bank', questionBankStatusTab: 'APPROVED' } : null),
  },
  QUESTION_BANK_RETURNED: {
    titleAr: 'إعادة سؤال للتعديل والمراجعة',
    category: 'question_bank',
    categoryLabelAr: 'بنك الأسئلة',
    isAllowed: (a) => a.canSeeQuestionBankStats,
    target: (a) => (a.canSeeQuestionBankStats ? { tab: 'question_bank', questionBankStatusTab: 'RETURNED' } : null),
  },
  ORDER_SUBMITTED_FOR_REVIEW: {
    titleAr: 'تسجيل طلب اشتراك جديد بانتظار المراجعة',
    category: 'payments',
    categoryLabelAr: 'المدفوعات',
    isAllowed: (a) => a.canViewPayments,
    target: (a) => (a.canViewPayments ? { tab: 'payments' } : null),
  },
  PAYMENT_VERIFIED_AND_GRANTED: {
    titleAr: 'تأكيد دفعة مالية وتفعيل الاشتراك',
    category: 'payments',
    categoryLabelAr: 'المدفوعات',
    isAllowed: (a) => a.canViewPayments,
    target: (a) => (a.canViewPayments ? { tab: 'payments' } : null),
  },
  STAFF_CREATED: {
    titleAr: 'إضافة عضو فريق إداري جديد',
    category: 'staff',
    categoryLabelAr: 'فريق العمل',
    isAllowed: (a) => a.canManageStaff,
    target: (a) => (a.canManageStaff ? { tab: 'operations', opsSubTab: 'security' } : null),
  },
  STAFF_ROLE_CHANGED: {
    titleAr: 'تحديث دور وظيفي لعضو بالفريق',
    category: 'staff',
    categoryLabelAr: 'فريق العمل',
    isAllowed: (a) => a.canManageStaff,
    target: (a) => (a.canManageStaff ? { tab: 'operations', opsSubTab: 'security' } : null),
  },
};

/**
 * Allow-listed, sanitized activity mapper.
 * - Drops sensitive/security/password/login/unknown actions automatically.
 * - Strictly enforces role-based visibility via `access`.
 * - Never includes raw detailsJson, IP addresses, passwords, tokens, or answer keys.
 */
export function sanitizeActivityEvent(
  row: RawAuditRow,
  access: SmartDashboardAccess,
): RecentActivityItem | null {
  const normalizedAction = String(row.action || '').trim().toUpperCase();
  const rule = SAFE_ACTIVITY_RULES[normalizedAction];
  if (!rule || !rule.isAllowed(access)) {
    return null;
  }

  const parsedDate = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const safeActor = String(row.actorName || 'النظام').trim().slice(0, 80) || 'النظام';

  return {
    id: `audit-${row.id}`,
    titleAr: rule.titleAr,
    subtitleAr: `بواسطة ${safeActor}`,
    category: rule.category,
    categoryLabelAr: rule.categoryLabelAr,
    actorName: safeActor,
    occurredAtIso: parsedDate.toISOString(),
    target: rule.target(access),
  };
}

/**
 * Returns the exact list of audit action strings permitted for this staff role
 * so SQL queries only scan relevant safe events.
 */
export function getAllowedAuditActionsForRole(access: SmartDashboardAccess): string[] {
  return Object.entries(SAFE_ACTIVITY_RULES)
    .filter(([, rule]) => rule.isAllowed(access))
    .map(([action]) => action);
}
