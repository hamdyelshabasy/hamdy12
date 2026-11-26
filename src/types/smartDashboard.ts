import type { AdminDashboardTabId } from '../lib/permissions.ts';

export type AttentionTaskPriority = 'URGENT' | 'SOON' | 'NORMAL';

export interface DashboardNavigationTarget {
  tab: AdminDashboardTabId;
  studentStatusFilter?: 'ALL' | 'PENDING_APPROVAL' | 'ACTIVE';
  studentAction?: 'NONE' | 'CREATE';
  videoAction?: 'NONE' | 'CREATE';
  courseAction?: 'NONE' | 'CREATE';
  announcementAction?: 'NONE' | 'CREATE';
  questionBankStatusTab?: 'ALL' | 'PENDING_REVIEW' | 'APPROVED' | 'DRAFT' | 'RETURNED' | 'MINE';
  questionBankAction?: 'NONE' | 'CREATE';
  examStatusFilter?: 'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT';
  examAction?: 'NONE' | 'CREATE_MANUAL' | 'CREATE_SMART' | 'CREATE_WIZARD' | 'OPEN_ATTEMPTS';
  homeworkStatusFilter?: 'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT';
  homeworkAction?: 'NONE' | 'CREATE' | 'OPEN_SUBMISSIONS';
  opsSubTab?: 'groups' | 'comms' | 'devices' | 'cms' | 'security';
}

export interface SmartDashboardAccess {
  canSeePendingStudents: boolean;
  canSeeTotalStudents: boolean;
  canApproveStudents: boolean;
  canSeeHomeworkGrading: boolean;
  canSeeHomeworkUpcoming: boolean;
  canManageHomework: boolean;
  canSeeExamGrading: boolean;
  canSeeExamsOverview: boolean;
  canManageExams: boolean;
  canSeeQuestionBankPendingReview: boolean;
  canContributeQuestionBank: boolean;
  canSeeQuestionBankStats: boolean;
  canManageStaff: boolean;
  canViewPayments: boolean;
  canViewReports: boolean;
  canViewAudit: boolean;
}

export interface PendingStudentsSummaryCard {
  count: number;
  recent7dCount: number;
  oldestPendingAt: string | null;
}

export interface HomeworkGradingSummaryCard {
  awaitingCount: number;
  assignmentsWithPendingCount: number;
  oldestSubmissionAt: string | null;
}

export interface ExamGradingSummaryCard {
  awaitingAttemptsCount: number;
  examsWithPendingCount: number;
  oldestAttemptAt: string | null;
}

export interface QuestionBankPendingSummaryCard {
  pendingReviewCount: number;
  myReturnedCount: number;
  oldestPendingAt: string | null;
}

export interface UpcomingExamsSummaryCard {
  within7DaysCount: number;
  publishedCount: number;
  scheduledCount: number;
  nearestStartsAt: string | null;
  nearestExamTitleAr: string | null;
}

export interface UpcomingHomeworkSummaryCard {
  within7DaysCount: number;
  nearestDeadlineAt: string | null;
  nearestHomeworkTitleAr: string | null;
}

export interface TotalStudentsSummaryCard {
  totalStudents: number;
  activeStudents: number;
  pendingStudents: number;
}

export interface ExamsDraftsSummaryCard {
  totalActiveExams: number;
  publishedOrScheduledCount: number;
  draftCount: number;
  canCreateSmartExam: boolean;
}

export interface SmartDashboardSummaryCards {
  pendingStudents: PendingStudentsSummaryCard | null;
  homeworkAwaitingGrading: HomeworkGradingSummaryCard | null;
  examsAwaitingGrading: ExamGradingSummaryCard | null;
  questionBankPending: QuestionBankPendingSummaryCard | null;
  upcomingExams: UpcomingExamsSummaryCard | null;
  upcomingHomework: UpcomingHomeworkSummaryCard | null;
  totalStudents: TotalStudentsSummaryCard | null;
  examsAndDrafts: ExamsDraftsSummaryCard | null;
}

export interface AttentionTaskItem {
  id: string;
  titleAr: string;
  categoryAr: string;
  descriptionAr: string;
  count: number;
  priority: AttentionTaskPriority;
  priorityLabelAr: string;
  dueAtIso: string | null;
  actionLabelAr: string;
  target: DashboardNavigationTarget;
}

export interface QuickActionItem {
  id: string;
  labelAr: string;
  descriptionAr: string;
  iconKey:
    | 'wizard_exam'
    | 'smart_exam'
    | 'create_exam'
    | 'create_homework'
    | 'add_question'
    | 'review_questions'
    | 'approve_students'
    | 'grade_homework'
    | 'manage_exams'
    | 'manage_students'
    | 'manage_staff';
  accent: 'primary' | 'default';
  target: DashboardNavigationTarget;
}

export interface UpcomingExamItem {
  id: number;
  titleAr: string;
  trackNameAr: string;
  gradeNameAr: string;
  startsAtIso: string;
  endsAtIso: string | null;
  publicationStatus: 'PUBLISHED' | 'SCHEDULED';
  publicationStatusLabelAr: string;
  durationMin: number;
}

export interface UpcomingHomeworkItem {
  id: number;
  titleAr: string;
  trackNameAr: string;
  gradeNameAr: string;
  deadlineIso: string;
  publicationStatus: 'PUBLISHED' | 'SCHEDULED';
  publicationStatusLabelAr: string;
  submittedCount: number;
}

export type ActivityCategory = 'students' | 'homework' | 'exams' | 'question_bank' | 'payments' | 'staff' | 'content';

export interface RecentActivityItem {
  id: string;
  titleAr: string;
  subtitleAr: string;
  category: ActivityCategory;
  categoryLabelAr: string;
  actorName: string;
  occurredAtIso: string;
  target: DashboardNavigationTarget | null;
}

export interface GradeDistributionStat {
  gradeId: number;
  gradeNameAr: string;
  trackNameAr: string;
  studentsCount: number;
}

export interface SmartDashboardAcademicStats {
  studentsByGrade: GradeDistributionStat[] | null;
  recentRegistrations30d: number | null;
  homeworkTotals: {
    activeAssignments: number;
    submittedCount: number;
    gradedPublishedCount: number;
    awaitingReviewCount: number;
  } | null;
  examTotals: {
    activeExams: number;
    submittedAttempts: number;
    gradedAttempts: number;
    awaitingManualCount: number;
    averagePublishedScorePercent: number | null;
  } | null;
  questionBankTotals: {
    approvedCount: number;
    pendingReviewCount: number;
    totalActiveCount: number;
  } | null;
  executiveOverview: {
    activeSubscriptions: number;
    onlineNow: number;
    totalRevenueEgp: number;
    pendingRevenueEgp: number;
  } | null;
}

export interface SmartDashboardResponse {
  generatedAtIso: string;
  timezone: 'Africa/Cairo';
  upcomingWindowDays: number;
  roleSlug: string;
  roleNameAr: string;
  userFullName: string;
  access: SmartDashboardAccess;
  summary: SmartDashboardSummaryCards;
  attentionTasks: AttentionTaskItem[];
  quickActions: QuickActionItem[];
  upcoming: {
    exams: UpcomingExamItem[] | null;
    homework: UpcomingHomeworkItem[] | null;
  };
  recentActivity: RecentActivityItem[];
  academicStats: SmartDashboardAcademicStats;
}
