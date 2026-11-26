import type { AdminExamQuestion } from '../../types/exams.ts';
import type {
  ExamWizardValidationIssue,
  ExamWizardValidationResult,
} from '../../types/examWizard.ts';

export interface ExamWizardDraftStateForValidation {
  titleAr: string;
  gradeId: number;
  durationMin: number;
  totalMarks: number;
  passScorePercent: number;
  maxAttempts: number;
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  assignmentScope: string;
  assignedGroupIds: number[];
  assignedStudentIds: number[];
}

export interface ExamWizardQuestionSummary {
  totalCount: number;
  bankCount: number;
  manualCount: number;
  calculatedMarks: number;
  duplicateBankQuestionIds: number[];
}

/**
 * Summarizes bank vs manual questions, total marks, and duplicate bank links.
 */
export function summarizeWizardQuestions(
  questions: ReadonlyArray<Pick<AdminExamQuestion, 'id' | 'points' | 'sourceBankQuestionId'>>,
): ExamWizardQuestionSummary {
  let bankCount = 0;
  let manualCount = 0;
  let calculatedMarks = 0;
  const seenBankIds = new Set<number>();
  const duplicateSet = new Set<number>();

  for (const q of questions) {
    const pts = Number(q.points);
    if (Number.isFinite(pts) && pts > 0) {
      calculatedMarks += pts;
    }
    if (typeof q.sourceBankQuestionId === 'number' && q.sourceBankQuestionId > 0) {
      bankCount += 1;
      if (seenBankIds.has(q.sourceBankQuestionId)) {
        duplicateSet.add(q.sourceBankQuestionId);
      } else {
        seenBankIds.add(q.sourceBankQuestionId);
      }
    } else {
      manualCount += 1;
    }
  }

  return {
    totalCount: questions.length,
    bankCount,
    manualCount,
    calculatedMarks: Number(calculatedMarks.toFixed(2)),
    duplicateBankQuestionIds: Array.from(duplicateSet),
  };
}

/**
 * Validates Step 1 basic info before advancing or creating a draft.
 */
export function validateExamWizardStep1(input: {
  titleAr: string;
  gradeId: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.titleAr || input.titleAr.trim().length < 3) {
    errors.push('يرجى إدخال عنوان للامتحان لا يقل عن 3 أحرف.');
  }
  if (!Number.isInteger(input.gradeId) || input.gradeId <= 0) {
    errors.push('يرجى اختيار الصف الدراسي المستهدف.');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates Step 3 exam timing, marks, attempts, and targeting settings.
 */
export function validateExamWizardSettings(input: {
  durationMin: number;
  totalMarks: number;
  passScorePercent: number;
  maxAttempts: number;
  startsAt?: string | null;
  endsAt?: string | null;
  assignmentScope: string;
  assignedGroupIds: number[];
  assignedStudentIds: number[];
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Number.isFinite(input.durationMin) || input.durationMin < 1 || input.durationMin > 360) {
    errors.push('مدة الامتحان يجب أن تكون بين دقيقة واحدة و360 دقيقة.');
  }
  if (!Number.isFinite(input.totalMarks) || input.totalMarks < 0) {
    errors.push('الدرجة الكلية للامتحان غير صالحة.');
  }
  if (
    !Number.isFinite(input.passScorePercent) ||
    input.passScorePercent < 1 ||
    input.passScorePercent > 100
  ) {
    errors.push('نسبة النجاح يجب أن تكون بين 1% و100%.');
  }
  if (!Number.isFinite(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 50) {
    errors.push('عدد المحاولات المسموحة يجب أن يكون بين 1 و50.');
  }

  const start = input.startsAt ? new Date(input.startsAt) : null;
  const end = input.endsAt ? new Date(input.endsAt) : null;
  if (start && Number.isNaN(start.getTime())) {
    errors.push('تاريخ بدء الامتحان غير صالح.');
  }
  if (end && Number.isNaN(end.getTime())) {
    errors.push('تاريخ انتهاء الامتحان غير صالح.');
  }
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    if (end.getTime() <= start.getTime()) {
      errors.push('يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء.');
    }
  }

  if (input.assignmentScope === 'GROUP' && input.assignedGroupIds.length === 0) {
    errors.push('يرجى اختيار مجموعة واحدة على الأقل عند تفعيل استهداف المجموعات.');
  }
  if (input.assignmentScope === 'STUDENTS' && input.assignedStudentIds.length === 0) {
    errors.push('يرجى اختيار طالب واحد على الأقل عند تفعيل استهداف طلاب محددين.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Full pre-publish validation checklist shared identically by frontend Preview (Step 4)
 * and backend Publish authorization endpoint.
 */
export function validateExamWizardDraft(
  exam: ExamWizardDraftStateForValidation,
  questions: ReadonlyArray<AdminExamQuestion>,
  options?: { hasUnsavedChanges?: boolean },
): ExamWizardValidationResult {
  const errors: ExamWizardValidationIssue[] = [];
  const warnings: ExamWizardValidationIssue[] = [];
  const summary = summarizeWizardQuestions(questions);

  if (!exam.titleAr || exam.titleAr.trim().length < 3) {
    errors.push({
      code: 'MISSING_TITLE',
      severity: 'error',
      step: 1,
      messageAr: 'عنوان الامتحان مطلوب ويجب أن يكون 3 أحرف على الأقل.',
    });
  }

  if (!Number.isInteger(exam.gradeId) || exam.gradeId <= 0) {
    errors.push({
      code: 'MISSING_GRADE',
      severity: 'error',
      step: 1,
      messageAr: 'يجب تحديد الصف الدراسي المستهدف للامتحان.',
    });
  }

  if (questions.length === 0) {
    errors.push({
      code: 'NO_QUESTIONS',
      severity: 'error',
      step: 2,
      messageAr: 'لا يمكن نشر امتحان فارغ؛ يرجى إضافة سؤال واحد على الأقل.',
    });
  }

  questions.forEach((q, idx) => {
    const qNum = idx + 1;
    const type = String(q.questionType || '').toUpperCase();

    if (type === 'MCQ' || type === 'TRUE_FALSE') {
      const validChoices = (q.choices || []).filter((c) => String(c.labelAr || '').trim().length > 0);
      if (validChoices.length < 2) {
        errors.push({
          code: 'INVALID_CHOICES_COUNT',
          severity: 'error',
          step: 2,
          questionNumber: qNum,
          messageAr: `السؤال رقم ${qNum} يحتاج إلى اختيارين على الأقل.`,
        });
      }
      if (!validChoices.some((c) => Boolean(c.isCorrect))) {
        errors.push({
          code: 'MISSING_CORRECT_CHOICE',
          severity: 'error',
          step: 2,
          questionNumber: qNum,
          messageAr: `السؤال رقم ${qNum} لا يحتوي على إجابة صحيحة محددة.`,
        });
      }
    }

    if (type === 'NUMERIC') {
      const rawNum = String(q.numericAnswer ?? '').trim().replace(',', '.');
      if (!rawNum || Number.isNaN(Number(rawNum))) {
        errors.push({
          code: 'MISSING_NUMERIC_ANSWER',
          severity: 'error',
          step: 2,
          questionNumber: qNum,
          messageAr: `السؤال الرقمي رقم ${qNum} يحتاج إلى قيمة إجابة رقمية صحيحة للتصحيح التلقائي.`,
        });
      }
    }
  });

  if (summary.duplicateBankQuestionIds.length > 0) {
    warnings.push({
      code: 'DUPLICATE_BANK_QUESTIONS',
      severity: 'warning',
      step: 2,
      messageAr: `توجد ${summary.duplicateBankQuestionIds.length} أسئلة مكررة من نفس سؤال بنك الأسئلة داخل هذه المسودة.`,
    });
  }

  if (!Number.isFinite(exam.durationMin) || exam.durationMin < 1 || exam.durationMin > 360) {
    errors.push({
      code: 'INVALID_DURATION',
      severity: 'error',
      step: 3,
      messageAr: 'مدة الامتحان يجب أن تكون بين 1 و360 دقيقة.',
    });
  }

  if (!Number.isFinite(exam.passScorePercent) || exam.passScorePercent < 1 || exam.passScorePercent > 100) {
    errors.push({
      code: 'INVALID_PASS_PERCENT',
      severity: 'error',
      step: 3,
      messageAr: 'نسبة النجاح يجب أن تكون بين 1% و100%.',
    });
  }

  if (!Number.isFinite(exam.maxAttempts) || exam.maxAttempts < 1 || exam.maxAttempts > 50) {
    errors.push({
      code: 'INVALID_MAX_ATTEMPTS',
      severity: 'error',
      step: 3,
      messageAr: 'عدد المحاولات يجب أن يكون بين 1 و50 محاولة.',
    });
  }

  if (questions.length > 0 && summary.calculatedMarks <= 0) {
    errors.push({
      code: 'INVALID_TOTAL_MARKS',
      severity: 'error',
      step: 2,
      messageAr: 'مجموع درجات الأسئلة يجب أن يكون أكبر من صفر.',
    });
  }

  if (
    questions.length > 0 &&
    exam.totalMarks > 0 &&
    Math.abs(exam.totalMarks - summary.calculatedMarks) > 0.01
  ) {
    warnings.push({
      code: 'MARKS_MISMATCH',
      severity: 'warning',
      step: 3,
      messageAr: `الدرجة الكلية المحددة (${exam.totalMarks}) تختلف عن مجموع درجات الأسئلة (${summary.calculatedMarks}). يُنصح بمطابقتها قبل النشر.`,
    });
  }

  const start = exam.startsAt ? new Date(exam.startsAt) : null;
  const end = exam.endsAt ? new Date(exam.endsAt) : null;
  if (
    (start && Number.isNaN(start.getTime())) ||
    (end && Number.isNaN(end.getTime())) ||
    (start && end && end.getTime() <= start.getTime())
  ) {
    errors.push({
      code: 'INVALID_DATE_RANGE',
      severity: 'error',
      step: 3,
      messageAr: 'تأكد من أن موعد انتهاء الامتحان يقع بعد موعد البدء.',
    });
  }

  if (exam.assignmentScope === 'GROUP' && exam.assignedGroupIds.length === 0) {
    errors.push({
      code: 'MISSING_TARGET_GROUPS',
      severity: 'error',
      step: 3,
      messageAr: 'اختر مجموعة دراسية واحدة على الأقل لنطاق استهداف المجموعات.',
    });
  }

  if (exam.assignmentScope === 'STUDENTS' && exam.assignedStudentIds.length === 0) {
    errors.push({
      code: 'MISSING_TARGET_STUDENTS',
      severity: 'error',
      step: 3,
      messageAr: 'اختر طالبًا واحدًا على الأقل لنطاق استهداف الطلاب المحددين.',
    });
  }

  if (options?.hasUnsavedChanges) {
    warnings.push({
      code: 'UNSAVED_CHANGES',
      severity: 'warning',
      step: 4,
      messageAr: 'توجد تغييرات لم تُحفظ بعد في المسودة؛ سيتم حفظها تلقائيًا قبل النشر.',
    });
  }

  return {
    isReadyToPublish: errors.length === 0,
    errors,
    warnings,
    calculatedMarks: summary.calculatedMarks,
    bankQuestionsCount: summary.bankCount,
    manualQuestionsCount: summary.manualCount,
    duplicateBankQuestionIds: summary.duplicateBankQuestionIds,
  };
}

/**
 * Optimistic concurrency check: rejects stale autosave writes when server's updatedAt
 * is newer than the client's expectedUpdatedAt token (allowing 1s tolerance for DB precision).
 */
export function isStaleDraftWrite(
  serverUpdatedAt: Date | string,
  expectedUpdatedAt: string | null | undefined,
): boolean {
  if (!expectedUpdatedAt) return false;
  const serverMs =
    serverUpdatedAt instanceof Date
      ? serverUpdatedAt.getTime()
      : new Date(serverUpdatedAt).getTime();
  const expectedMs = new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(serverMs) || Number.isNaN(expectedMs)) return false;
  return Math.abs(serverMs - expectedMs) > 1000;
}

/**
 * Determines effective publication status when explicitly publishing a draft:
 * future startsAt -> SCHEDULED, otherwise PUBLISHED.
 */
export function resolveEffectivePublishStatus(
  startsAt: Date | null,
  now: Date = new Date(),
): 'PUBLISHED' | 'SCHEDULED' {
  if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > now.getTime()) {
    return 'SCHEDULED';
  }
  return 'PUBLISHED';
}

/**
 * Cross-account draft ownership guard:
 * - SUPER_ADMIN can manage all drafts.
 * - Non-SUPER_ADMIN staff with EXAMS_MANAGE can only access/modify drafts they created.
 */
export function canActorAccessWizardDraft(params: {
  actorRoleSlug: string;
  actorId: number;
  creatorActorId: number | null;
}): boolean {
  if (params.actorRoleSlug === 'SUPER_ADMIN') return true;
  if (params.creatorActorId === null) return false;
  return params.creatorActorId === params.actorId;
}
