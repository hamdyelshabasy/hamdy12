import type { StudentDashboardData, StudentExamItem } from '../types/lms.ts';
import type { StudentAcademicSignals } from './academicPlanEngine.ts';

export type StudentExamDisplayStatus =
  | 'AVAILABLE'
  | 'UPCOMING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PENDING_GRADING'
  | 'RESULT_PUBLISHED'
  | 'EXPIRED'
  | 'LOCKED';

/**
 * Single source of truth for classifying a student's exam status cleanly and truthfully.
 * Never marks an expired exam with 0 attempts as completed.
 */
export function resolveStudentExamStatus(
  exam: StudentExamItem,
  nowMs: number = Date.now(),
): {
  code: StudentExamDisplayStatus;
  labelAr: string;
  canStartOrResume: boolean;
} {
  const startsMs = exam.startsAt ? new Date(exam.startsAt).getTime() : null;
  const endsMs = exam.endsAt ? new Date(exam.endsAt).getTime() : null;
  const latest = exam.latestAttempt;

  if (latest?.status === 'IN_PROGRESS') {
    return { code: 'IN_PROGRESS', labelAr: 'قيد الحل', canStartOrResume: true };
  }

  if (latest && latest.status !== 'IN_PROGRESS') {
    if (latest.resultPublished === true) {
      return { code: 'RESULT_PUBLISHED', labelAr: 'النتيجة منشورة', canStartOrResume: false };
    }
    if (latest.status === 'SUBMITTED' || latest.resultPublished === false) {
      return { code: 'PENDING_GRADING', labelAr: 'بانتظار التصحيح', canStartOrResume: false };
    }
    return { code: 'COMPLETED', labelAr: 'مكتمل', canStartOrResume: false };
  }

  if (startsMs !== null && Number.isFinite(startsMs) && startsMs > nowMs) {
    return { code: 'UPCOMING', labelAr: 'قادم', canStartOrResume: false };
  }

  if (endsMs !== null && Number.isFinite(endsMs) && endsMs < nowMs) {
    return { code: 'EXPIRED', labelAr: 'منتهي / مغلق', canStartOrResume: false };
  }

  if (exam.lockedByVideo) {
    return { code: 'LOCKED', labelAr: 'يتطلب مشاهدة الدرس', canStartOrResume: false };
  }

  if (exam.attemptsUsed >= exam.maxAttempts) {
    return { code: 'COMPLETED', labelAr: 'مكتمل', canStartOrResume: false };
  }

  return { code: 'AVAILABLE', labelAr: 'متاح الآن', canStartOrResume: true };
}

export function buildStudentAcademicSignals(
  data: StudentDashboardData,
  manualReviewOverrides?: Record<number, { isReviewed: boolean; reviewedAt: string | null }>,
  nowMs: number = Date.now(),
): StudentAcademicSignals {
  const videosById: StudentAcademicSignals['videosById'] = {};
  for (const v of data.videos) {
    videosById[v.id] = {
      id: v.id,
      titleAr: v.titleAr,
      thumbnailUrl: v.thumbnailUrl,
      unitTitleAr: v.unitTitleAr,
      lessonTitleAr: v.lessonTitleAr,
      durationSec: v.durationSec,
      watchedSeconds: v.progress.watchedSec,
      percentComplete: v.progress.completionPercent,
      isCompleted: v.progress.isCompleted,
      isLocked: !v.hasAccess,
      updatedAt: v.progress.updatedAt,
    };
  }

  const homeworkById: StudentAcademicSignals['homeworkById'] = {};
  for (const hw of data.homeworkSummary?.items || []) {
    const statusCode = hw.submissionStatus || 'NOT_STARTED';
    homeworkById[hw.id] = {
      id: hw.id,
      titleAr: hw.titleAr,
      deadline: hw.deadline,
      statusCode,
      submittedVersionsCount:
        hw.submissionStatus && hw.submissionStatus !== 'DRAFT' ? 1 : 0,
      latestSubmittedAt: hw.submittedAt,
    };
  }

  const examsById: StudentAcademicSignals['examsById'] = {};
  for (const ex of data.exams) {
    const resolved = resolveStudentExamStatus(ex, nowMs);
    examsById[ex.id] = {
      id: ex.id,
      titleAr: ex.titleAr,
      durationMinutes: ex.durationMin,
      startsAt: ex.startsAt ?? null,
      endsAt: ex.endsAt ?? null,
      statusCode: resolved.code,
      attemptsUsed: ex.attemptsUsed,
      hasInProgressAttempt: ex.latestAttempt?.status === 'IN_PROGRESS',
      lastSubmittedAt: ex.latestAttempt?.submittedAt ?? null,
      isAccessible: !ex.lockedByVideo,
    };
  }

  const pdfsById: StudentAcademicSignals['pdfsById'] = {};
  for (const l of data.lessons) {
    pdfsById[l.id] = {
      id: l.id,
      titleAr: l.titleAr,
      pdfTitleAr: l.pdfTitleAr,
      hasPdf: Boolean(l.pdfUrl || l.pdfTitleAr),
      isAccessible: true,
    };
  }

  const coursesById: StudentAcademicSignals['coursesById'] = {};
  for (const c of data.courses) {
    const totalLessons = c.lessonsCount || c.lessons.length;
    const completedLessons =
      totalLessons > 0 ? Math.round((c.progressPercent / 100) * totalLessons) : 0;
    coursesById[c.id] = {
      id: c.id,
      titleAr: c.titleAr,
      completedLessons,
      totalLessons,
      isAccessible: c.isUnlocked || c.hasFreePreview,
    };
  }

  const scheduleById: StudentAcademicSignals['scheduleById'] = {};
  for (const s of data.schedules) {
    const startsMs = new Date(s.scheduledAt).getTime();
    const endsIso = Number.isFinite(startsMs)
      ? new Date(startsMs + (s.durationMin || 60) * 60_000).toISOString()
      : null;
    scheduleById[s.id] = {
      id: s.id,
      titleAr: s.titleAr,
      startsAt: s.scheduledAt,
      endsAt: endsIso,
    };
  }

  return {
    videosById,
    homeworkById,
    examsById,
    pdfsById,
    coursesById,
    scheduleById,
    manualReviewedTaskIds: {
      ...(data.curriculumManualProgress || {}),
      ...(manualReviewOverrides || {}),
    },
  };
}
