import { canAccessAdminTab, type PermissionSubject } from './permissions.ts';
import type { DashboardNavigationTarget } from '../types/smartDashboard.ts';

export type AcademicStatLinkKind =
  | 'homework_submissions'
  | 'exam_attempts'
  | 'approved_questions';

export interface HomeworkSubmissionCandidate {
  id: number;
  stats: {
    submittedCount: number;
    awaitingReviewCount: number;
    gradedCount?: number;
  };
}

export interface ExamAttemptCandidate {
  id: number;
  attemptsCount: number;
  submittedCount: number;
  pendingManualCount: number;
}

/**
 * Resolves the navigation target for an academic statistics card inside
 * the Smart Teacher Dashboard while strictly respecting role permissions.
 */
export function buildAcademicStatTarget(
  kind: AcademicStatLinkKind,
  user: PermissionSubject | null | undefined,
): DashboardNavigationTarget | null {
  if (!user) return null;

  if (kind === 'homework_submissions') {
    if (!canAccessAdminTab(user, 'homework')) return null;
    return {
      tab: 'homework',
      homeworkStatusFilter: 'ALL',
      homeworkAction: 'OPEN_SUBMISSIONS',
    };
  }

  if (kind === 'exam_attempts') {
    if (!canAccessAdminTab(user, 'exams')) return null;
    return {
      tab: 'exams',
      examStatusFilter: 'ALL',
      examAction: 'OPEN_ATTEMPTS',
    };
  }

  if (kind === 'approved_questions') {
    if (!canAccessAdminTab(user, 'question_bank')) return null;
    return {
      tab: 'question_bank',
      questionBankStatusTab: 'APPROVED',
      questionBankAction: 'NONE',
    };
  }

  return null;
}

/**
 * Picks the most relevant homework assignment to open directly when navigating
 * to Homework Submissions:
 *  1. Assignment with the most submissions awaiting review (> 0)
 *  2. Otherwise, assignment with the most total submissions (> 0)
 *  3. Otherwise null (caller stays on the homework overview list)
 */
export function pickBestHomeworkForSubmissions(
  items: readonly HomeworkSubmissionCandidate[],
): number | null {
  if (!items.length) return null;

  const awaiting = items
    .filter((item) => item.stats.awaitingReviewCount > 0)
    .sort((a, b) => {
      if (b.stats.awaitingReviewCount !== a.stats.awaitingReviewCount) {
        return b.stats.awaitingReviewCount - a.stats.awaitingReviewCount;
      }
      return b.stats.submittedCount - a.stats.submittedCount;
    });
  if (awaiting.length > 0) return awaiting[0].id;

  const submitted = items
    .filter((item) => item.stats.submittedCount > 0)
    .sort((a, b) => b.stats.submittedCount - a.stats.submittedCount);
  if (submitted.length > 0) return submitted[0].id;

  return null;
}

/**
 * Picks the most relevant exam to open directly when navigating to Exam Attempts:
 *  1. Exam with the most attempts pending manual grading (> 0)
 *  2. Otherwise, exam with the most submitted attempts (> 0)
 *  3. Otherwise, exam with the most started attempts (> 0)
 *  4. Otherwise null (caller stays on the exams overview list)
 */
export function pickBestExamForAttempts(
  exams: readonly ExamAttemptCandidate[],
): number | null {
  if (!exams.length) return null;

  const pendingManual = exams
    .filter((ex) => ex.pendingManualCount > 0)
    .sort((a, b) => {
      if (b.pendingManualCount !== a.pendingManualCount) {
        return b.pendingManualCount - a.pendingManualCount;
      }
      return b.submittedCount - a.submittedCount;
    });
  if (pendingManual.length > 0) return pendingManual[0].id;

  const submitted = exams
    .filter((ex) => ex.submittedCount > 0)
    .sort((a, b) => b.submittedCount - a.submittedCount);
  if (submitted.length > 0) return submitted[0].id;

  const started = exams
    .filter((ex) => ex.attemptsCount > 0)
    .sort((a, b) => b.attemptsCount - a.attemptsCount);
  if (started.length > 0) return started[0].id;

  return null;
}
