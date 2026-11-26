import crypto from 'node:crypto';
import { getHomeworkFileSigningSecret } from '../config/secrets.ts';

export type HomeworkPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'HIDDEN' | 'ARCHIVED';
export type HomeworkScope = 'GRADE' | 'GROUP' | 'STUDENTS' | 'COURSE';
export type HomeworkSubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'SUBMITTED_LATE'
  | 'UNDER_REVIEW'
  | 'RETURNED_FOR_REVISION'
  | 'GRADED';
export type StudentHomeworkDisplayStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'LATE'
  | 'UNDER_REVIEW'
  | 'GRADED'
  | 'RETURNED_FOR_REVISION'
  | 'DEADLINE_PASSED';

export type ModelAnswerVisibilityPolicy =
  | 'HIDDEN'
  | 'AFTER_DEADLINE'
  | 'AFTER_SUBMISSION'
  | 'AFTER_GRADING'
  | 'MANUAL_RELEASE'
  | 'SCHEDULED_RELEASE';

export interface RubricCriterion {
  id: string;
  labelAr: string;
  maxPoints: number;
}

export interface RubricScoreEntry extends RubricCriterion {
  awardedPoints: number;
}

export const ALLOWED_HOMEWORK_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const MAX_HOMEWORK_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const MAX_SUBMISSION_FILES = 8;
export const MAX_ASSIGNMENT_ATTACHMENTS = 6;
export const MAX_MODEL_ANSWER_FILES = 6;

export interface ValidatedUploadFile {
  ok: true;
  detectedMimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  cleanBase64: string;
  sanitizedFileName: string;
}

export interface InvalidUploadFile {
  ok: false;
  errorAr: string;
}

export function sanitizeFileName(rawName: string, fallbackExt: string): string {
  const base = String(rawName || 'file')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  if (!base) return `homework-file.${fallbackExt}`;
  return base;
}

/**
 * Validates actual file magic bytes, size limit, and allowed image/PDF types.
 * Never trusts filename extension or declared MIME string alone.
 */
export function validateHomeworkFileUpload(input: {
  fileName: string;
  declaredMimeType?: string;
  dataBase64: string;
  maxBytes?: number;
}): ValidatedUploadFile | InvalidUploadFile {
  const maxBytes = input.maxBytes ?? MAX_HOMEWORK_FILE_BYTES;
  const raw = String(input.dataBase64 || '').trim();
  if (!raw) {
    return { ok: false, errorAr: 'محتوى الملف المرفوع فارغ.' };
  }

  // Strip optional data URI prefix
  const cleanBase64 = raw.includes(',') && raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
    return { ok: false, errorAr: 'صيغة بيانات الملف المرفوع غير صالحة.' };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(cleanBase64, 'base64');
  } catch {
    return { ok: false, errorAr: 'تعذر قراءة بيانات الملف المرفوع.' };
  }

  if (buf.length === 0) {
    return { ok: false, errorAr: 'الملف المرفوع فارغ (0 بايت).' };
  }
  if (buf.length > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      errorAr: `حجم الملف (${(buf.length / (1024 * 1024)).toFixed(2)} ميجابايت) يتجاوز الحد الأقصى المسموح (${maxMb} ميجابايت).`,
    };
  }

  // Magic-byte inspection
  let detected: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null = null;

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    detected = 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  else if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    detected = 'image/png';
  }
  // WEBP: RIFF....WEBP
  else if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    detected = 'image/webp';
  }
  // PDF: %PDF-
  else if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    detected = 'application/pdf';
  }

  if (!detected) {
    return {
      ok: false,
      errorAr:
        'نوع الملف غير مدعوم أو لا يطابق محتواه الفعلي. الصيغ المسموحة فقط: JPG، JPEG، PNG، WEBP، و PDF.',
    };
  }

  const ext =
    detected === 'application/pdf'
      ? 'pdf'
      : detected === 'image/png'
        ? 'png'
        : detected === 'image/webp'
          ? 'webp'
          : 'jpg';

  return {
    ok: true,
    detectedMimeType: detected,
    sizeBytes: buf.length,
    cleanBase64: buf.toString('base64'),
    sanitizedFileName: sanitizeFileName(input.fileName, ext),
  };
}

export function generateHomeworkStorageKey(): string {
  return `hwf_${crypto.randomBytes(16).toString('hex')}`;
}

export function signHomeworkFileToken(
  payload: {
    storageKey: string;
    userId: number;
    roleSlug: string;
    ttlSec?: number;
  },
  secretOverride?: string,
): string {
  const signingSecret = secretOverride ?? getHomeworkFileSigningSecret();
  const exp = Math.floor(Date.now() / 1000) + (payload.ttlSec ?? 900); // 15 min
  const encoded = Buffer.from(
    JSON.stringify({
      k: payload.storageKey,
      u: payload.userId,
      r: payload.roleSlug,
      e: exp,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyHomeworkFileToken(
  token: string,
  secretOverride?: string,
): {
  storageKey: string;
  userId: number;
  roleSlug: string;
  exp: number;
} | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const signingSecret = secretOverride ?? getHomeworkFileSigningSecret();
    const expected = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      k: string;
      u: number;
      r: string;
      e: number;
    };
    if (!parsed.k || !parsed.u || !parsed.e || parsed.e < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      storageKey: parsed.k,
      userId: parsed.u,
      roleSlug: parsed.r,
      exp: parsed.e,
    };
  } catch {
    return null;
  }
}

/**
 * Validates that grade, unit, lesson, video, and course all belong to compatible academic tracks & grades.
 */
export function validateAcademicCompatibility(input: {
  trackId: number;
  grade: { id: number; trackId: number } | null;
  unit?: { id: number; gradeId: number } | null;
  lesson?: { id: number; unitId: number } | null;
  video?: { id: number; gradeId: number; lessonId: number; trackId?: number | null } | null;
  course?: { id: number; gradeId: number } | null;
}): { valid: boolean; errorAr?: string } {
  if (!input.grade) {
    return { valid: false, errorAr: 'الصف الدراسي المحدد غير موجود.' };
  }
  if (input.grade.trackId !== input.trackId) {
    return { valid: false, errorAr: 'الصف الدراسي المحدد لا ينتمي إلى المسار التعليمي المختار.' };
  }
  if (input.unit && input.unit.gradeId !== input.grade.id) {
    return { valid: false, errorAr: 'الوحدة الدراسية المختارة لا تنتمي إلى الصف الدراسي المحدد.' };
  }
  if (input.lesson && input.unit && input.lesson.unitId !== input.unit.id) {
    return { valid: false, errorAr: 'الدرس المختار لا ينتمي إلى الوحدة الدراسية المحددة.' };
  }
  if (input.video && input.video.gradeId !== input.grade.id) {
    return { valid: false, errorAr: 'الفيديو المرتبط لا ينتمي إلى نفس الصف والمسار الدراسي للواجب.' };
  }
  if (input.course && input.course.gradeId !== input.grade.id) {
    return { valid: false, errorAr: 'الكورس المختار لا ينتمي إلى نفس الصف والمسار الدراسي للواجب.' };
  }
  return { valid: true };
}

export function isAssignmentVisibleNow(
  assignment: { publicationStatus: string; publishedAt: Date | string | null },
  now = new Date(),
): boolean {
  if (assignment.publicationStatus === 'PUBLISHED') {
    if (assignment.publishedAt && new Date(assignment.publishedAt).getTime() > now.getTime()) {
      return false;
    }
    return true;
  }
  if (assignment.publicationStatus === 'SCHEDULED') {
    return Boolean(assignment.publishedAt && new Date(assignment.publishedAt).getTime() <= now.getTime());
  }
  return false;
}

/**
 * Evaluates whether a student is eligible to view and submit a homework assignment.
 * Enforces publication visibility, scope targeting, and underlying video/course authorization.
 */
export function evaluateStudentHomeworkEligibility(input: {
  assignment: {
    gradeId: number;
    courseId: number | null;
    videoId: number | null;
    assignmentScope: string;
    publicationStatus: string;
    publishedAt: Date | string | null;
  };
  studentId: number;
  isStaff: boolean;
  approvedGradeIds: number[];
  studentGroupIds: number[];
  activeCourseIds: number[];
  hasGradeAllEntitlement: boolean;
  targetStudentIds: number[];
  targetGroupIds: number[];
  hasVideoAccess: boolean;
  now?: Date;
}): { eligible: boolean; reasonAr?: string } {
  const now = input.now ?? new Date();
  if (input.isStaff) return { eligible: true };

  if (!isAssignmentVisibleNow(input.assignment, now)) {
    return { eligible: false, reasonAr: 'هذا الواجب غير متاح للطلاب حاليًا.' };
  }

  const scope = input.assignment.assignmentScope;

  if (scope === 'STUDENTS') {
    if (!input.targetStudentIds.includes(input.studentId)) {
      return { eligible: false, reasonAr: 'هذا الواجب مخصص لطلاب محددين فقط.' };
    }
    return { eligible: true };
  }

  if (scope === 'COURSE') {
    if (!input.assignment.courseId) {
      return { eligible: false, reasonAr: 'الواجب غير مرتبط بكورس صالح.' };
    }
    const enrolledInCourse =
      input.activeCourseIds.includes(input.assignment.courseId) || input.hasGradeAllEntitlement;
    if (!enrolledInCourse) {
      return { eligible: false, reasonAr: 'هذا الواجب مخصص للمشتركين في الكورس المرتبط به فقط.' };
    }
    return { eligible: true };
  }

  if (!input.approvedGradeIds.includes(input.assignment.gradeId)) {
    return { eligible: false, reasonAr: 'هذا الواجب يخص صفًا دراسيًا غير معتمد في حسابك.' };
  }

  if (scope === 'GROUP') {
    const inTargetGroup = input.targetGroupIds.some((gid) => input.studentGroupIds.includes(gid));
    if (!inTargetGroup) {
      return { eligible: false, reasonAr: 'هذا الواجب مخصص لمجموعة طلابية محددة.' };
    }
  }

  // If tied to a specific video, do not expose restricted paid video homework to unauthorized students
  if (input.assignment.videoId && !input.hasVideoAccess) {
    return {
      eligible: false,
      reasonAr: 'يرجى فتح صلاحية الفيديو المرتبط أولًا للوصول إلى واجب هذا الدرس.',
    };
  }

  return { eligible: true };
}

/**
 * Evaluates whether a student can submit (or resubmit) a solution using SERVER time only.
 */
export function evaluateSubmissionPermission(input: {
  assignment: {
    deadline: Date | string | null;
    allowLateSubmission: boolean;
    allowResubmission: boolean;
    maximumSubmissions: number;
    allowReopenAfterGrading: boolean;
  };
  existingSubmittedVersions: Array<{
    version: number;
    status: string;
    isGradePublished: boolean;
  }>;
  now?: Date;
}): {
  canSubmit: boolean;
  isLate: boolean;
  nextVersion: number;
  reasonAr?: string;
} {
  const now = input.now ?? new Date();
  const submitted = input.existingSubmittedVersions
    .filter((s) => s.status !== 'DRAFT')
    .sort((a, b) => b.version - a.version);
  const latest = submitted[0] ?? null;
  const submittedCount = submitted.length;
  const maxSubs = Math.max(1, input.assignment.maximumSubmissions || 1);

  const deadlineDate = input.assignment.deadline ? new Date(input.assignment.deadline) : null;
  const isPastDeadline = Boolean(deadlineDate && now.getTime() > deadlineDate.getTime());

  // Teacher explicitly returned homework for revision -> always reopen regardless of cap/deadline
  if (latest && latest.status === 'RETURNED_FOR_REVISION') {
    return {
      canSubmit: true,
      isLate: isPastDeadline,
      nextVersion: latest.version + 1,
    };
  }

  if (submittedCount === 0) {
    if (isPastDeadline && !input.assignment.allowLateSubmission) {
      return {
        canSubmit: false,
        isLate: true,
        nextVersion: 1,
        reasonAr: 'انتهى موعد التسليم المحدد ولا يُسمح بالتسليم المتأخر لهذا الواجب.',
      };
    }
    return {
      canSubmit: true,
      isLate: isPastDeadline,
      nextVersion: 1,
    };
  }

  // Already submitted at least once -> check resubmission settings
  if (latest?.status === 'GRADED' && latest.isGradePublished && !input.assignment.allowReopenAfterGrading) {
    return {
      canSubmit: false,
      isLate: isPastDeadline,
      nextVersion: latest.version + 1,
      reasonAr: 'تم تصحيح هذا الواجب وإغلاقه، ولا يُسمح بإعادة التسليم بعد التصحيح.',
    };
  }

  if (!input.assignment.allowResubmission) {
    return {
      canSubmit: false,
      isLate: isPastDeadline,
      nextVersion: latest.version + 1,
      reasonAr: 'تم تسليم الواجب بالفعل، وإعادة التسليم غير مفعّلة لهذا الواجب.',
    };
  }

  if (submittedCount >= maxSubs) {
    return {
      canSubmit: false,
      isLate: isPastDeadline,
      nextVersion: latest.version + 1,
      reasonAr: `لقد استنفدت الحد الأقصى لعدد محاولات التسليم المسموحة (${maxSubs}).`,
    };
  }

  if (isPastDeadline && !input.assignment.allowLateSubmission) {
    return {
      canSubmit: false,
      isLate: true,
      nextVersion: latest.version + 1,
      reasonAr: 'انتهى موعد التسليم المحدد ولا يمكن إرسال نسخة جديدة بعد الموعد.',
    };
  }

  return {
    canSubmit: true,
    isLate: isPastDeadline,
    nextVersion: latest.version + 1,
  };
}

/**
 * Derives the exact Arabic-ready student display status for an assignment.
 */
export function deriveStudentHomeworkStatus(input: {
  deadline: Date | string | null;
  allowLateSubmission: boolean;
  latestSubmission: {
    status: string;
    isLate: boolean;
    isGradePublished: boolean;
  } | null;
  now?: Date;
}): { code: StudentHomeworkDisplayStatus; labelAr: string } {
  const now = input.now ?? new Date();
  const sub = input.latestSubmission;
  const deadlineDate = input.deadline ? new Date(input.deadline) : null;
  const isPastDeadline = Boolean(deadlineDate && now.getTime() > deadlineDate.getTime());

  if (!sub) {
    if (isPastDeadline) {
      return input.allowLateSubmission
        ? { code: 'LATE', labelAr: 'متأخر' }
        : { code: 'DEADLINE_PASSED', labelAr: 'انتهى الموعد' };
    }
    return { code: 'NOT_STARTED', labelAr: 'لم يبدأ' };
  }

  if (sub.status === 'DRAFT') {
    if (isPastDeadline && !input.allowLateSubmission) {
      return { code: 'DEADLINE_PASSED', labelAr: 'انتهى الموعد' };
    }
    return { code: 'IN_PROGRESS', labelAr: 'قيد الحل' };
  }

  if (sub.status === 'RETURNED_FOR_REVISION') {
    return { code: 'RETURNED_FOR_REVISION', labelAr: 'مطلوب إعادة التسليم' };
  }

  if (sub.status === 'GRADED' && sub.isGradePublished) {
    return { code: 'GRADED', labelAr: 'تم التصحيح' };
  }

  if (sub.status === 'UNDER_REVIEW' || (sub.status === 'GRADED' && !sub.isGradePublished)) {
    return { code: 'UNDER_REVIEW', labelAr: 'قيد التصحيح' };
  }

  if (sub.status === 'SUBMITTED_LATE' || sub.isLate) {
    return { code: 'LATE', labelAr: 'متأخر' };
  }

  return { code: 'SUBMITTED', labelAr: 'تم التسليم' };
}

/**
 * Strict backend evaluation of Model Answer visibility policy.
 * NEVER returns released=true unless the configured server-side rule is satisfied.
 */
export function evaluateModelAnswerRelease(input: {
  policy: ModelAnswerVisibilityPolicy | string;
  releaseAt: Date | string | null;
  manuallyReleased: boolean;
  assignmentDeadline: Date | string | null;
  hasStudentSubmitted: boolean;
  isStudentGradedAndPublished: boolean;
  isStaff: boolean;
  now?: Date;
}): { isReleased: boolean; reasonAr: string; policyLabelAr: string } {
  const now = input.now ?? new Date();
  const policyLabels: Record<string, string> = {
    HIDDEN: 'مخفي عن الطلاب',
    AFTER_DEADLINE: 'يظهر بعد انتهاء موعد التسليم',
    AFTER_SUBMISSION: 'يظهر بعد تسليم الطالب',
    AFTER_GRADING: 'يظهر بعد تصحيح الواجب',
    MANUAL_RELEASE: 'يظهر عند سماح المدرس',
    SCHEDULED_RELEASE: 'يظهر في تاريخ ووقت محدد',
  };
  const policyLabelAr = policyLabels[input.policy] || 'مخفي عن الطلاب';

  if (input.isStaff) {
    return { isReleased: true, reasonAr: 'متاح لمعاينة المدرس', policyLabelAr };
  }

  switch (input.policy) {
    case 'HIDDEN':
      return { isReleased: false, reasonAr: 'نموذج الإجابة غير متاح حاليًا', policyLabelAr };

    case 'AFTER_DEADLINE': {
      if (!input.assignmentDeadline) {
        return { isReleased: false, reasonAr: 'نموذج الإجابة غير متاح حاليًا', policyLabelAr };
      }
      const deadlinePassed = now.getTime() >= new Date(input.assignmentDeadline).getTime();
      return deadlinePassed
        ? { isReleased: true, reasonAr: 'متاح بعد انتهاء موعد التسليم', policyLabelAr }
        : {
            isReleased: false,
            reasonAr: 'نموذج الإجابة غير متاح حاليًا — سيظهر تلقائيًا بعد انتهاء موعد التسليم.',
            policyLabelAr,
          };
    }

    case 'AFTER_SUBMISSION':
      return input.hasStudentSubmitted
        ? { isReleased: true, reasonAr: 'متاح بعد تسليم الحل', policyLabelAr }
        : {
            isReleased: false,
            reasonAr: 'نموذج الإجابة غير متاح حاليًا — سيظهر مباشرة بعد تسليم إجابتك.',
            policyLabelAr,
          };

    case 'AFTER_GRADING':
      return input.isStudentGradedAndPublished
        ? { isReleased: true, reasonAr: 'متاح بعد نشر التصحيح', policyLabelAr }
        : {
            isReleased: false,
            reasonAr: 'نموذج الإجابة غير متاح حاليًا — سيظهر بعد تصحيح الواجب ونشر الدرجة.',
            policyLabelAr,
          };

    case 'MANUAL_RELEASE':
      return input.manuallyReleased
        ? { isReleased: true, reasonAr: 'تم إتاحة نموذج الإجابة بواسطة المدرس', policyLabelAr }
        : {
            isReleased: false,
            reasonAr: 'نموذج الإجابة غير متاح حاليًا — بانتظار إتاحته من قِبل المدرس.',
            policyLabelAr,
          };

    case 'SCHEDULED_RELEASE': {
      if (!input.releaseAt) {
        return { isReleased: false, reasonAr: 'نموذج الإجابة غير متاح حاليًا', policyLabelAr };
      }
      const reached = now.getTime() >= new Date(input.releaseAt).getTime();
      return reached
        ? { isReleased: true, reasonAr: 'متاح وفق موعد النشر المحدد', policyLabelAr }
        : {
            isReleased: false,
            reasonAr: 'نموذج الإجابة غير متاح حاليًا — سيظهر في الموعد المحدد من المدرس.',
            policyLabelAr,
          };
    }

    default:
      return { isReleased: false, reasonAr: 'نموذج الإجابة غير متاح حاليًا', policyLabelAr };
  }
}

/**
 * Validates rubric definitions and teacher grading payloads.
 */
export function validateRubricDefinition(
  maximumGrade: number,
  rubric: RubricCriterion[],
): { valid: boolean; errorAr?: string } {
  if (!Number.isFinite(maximumGrade) || maximumGrade <= 0 || maximumGrade > 1000) {
    return { valid: false, errorAr: 'الدرجة النهائية يجب أن تكون رقمًا أكبر من صفر ولا تتجاوز 1000.' };
  }
  if (!rubric.length) return { valid: true };

  let total = 0;
  for (const item of rubric) {
    if (!item.labelAr || !item.labelAr.trim()) {
      return { valid: false, errorAr: 'كل معيار في جدول التصحيح (Rubric) يجب أن يحتوي على اسم واضح.' };
    }
    if (!Number.isFinite(item.maxPoints) || item.maxPoints <= 0) {
      return { valid: false, errorAr: `درجة المعيار "${item.labelAr}" يجب أن تكون أكبر من صفر.` };
    }
    total += item.maxPoints;
  }

  if (Math.abs(total - maximumGrade) > 0.01) {
    return {
      valid: false,
      errorAr: `مجموع درجات معايير التصحيح (${total}) يجب أن يساوي الدرجة النهائية للواجب (${maximumGrade}).`,
    };
  }

  return { valid: true };
}

export function validateGradingSubmission(input: {
  maximumGrade: number;
  awardedGrade: number | null;
  rubricDefinition: RubricCriterion[];
  rubricScores?: Array<{ id: string; awardedPoints: number }>;
}): { valid: boolean; computedGrade: number | null; normalizedRubric: RubricScoreEntry[]; errorAr?: string } {
  if (input.rubricScores && input.rubricScores.length > 0 && input.rubricDefinition.length > 0) {
    const scoreById = new Map(input.rubricScores.map((r) => [r.id, r.awardedPoints]));
    const normalized: RubricScoreEntry[] = [];
    let sum = 0;

    for (const def of input.rubricDefinition) {
      const awarded = Number(scoreById.get(def.id) ?? 0);
      if (!Number.isFinite(awarded) || awarded < 0 || awarded > def.maxPoints) {
        return {
          valid: false,
          computedGrade: null,
          normalizedRubric: [],
          errorAr: `درجة معيار "${def.labelAr}" يجب أن تكون بين 0 و ${def.maxPoints}.`,
        };
      }
      sum += awarded;
      normalized.push({ ...def, awardedPoints: Number(awarded.toFixed(2)) });
    }

    const finalGrade = Number(sum.toFixed(2));
    if (finalGrade > input.maximumGrade + 0.01) {
      return {
        valid: false,
        computedGrade: null,
        normalizedRubric: [],
        errorAr: `إجمالي الدرجة (${finalGrade}) يتجاوز الدرجة النهائية (${input.maximumGrade}).`,
      };
    }

    return { valid: true, computedGrade: finalGrade, normalizedRubric: normalized };
  }

  if (input.awardedGrade === null || input.awardedGrade === undefined) {
    return { valid: true, computedGrade: null, normalizedRubric: [] };
  }

  const g = Number(input.awardedGrade);
  if (!Number.isFinite(g) || g < 0) {
    return { valid: false, computedGrade: null, normalizedRubric: [], errorAr: 'لا يمكن أن تكون الدرجة سالبة.' };
  }
  if (g > input.maximumGrade) {
    return {
      valid: false,
      computedGrade: null,
      normalizedRubric: [],
      errorAr: `الدرجة المدخلة (${g}) تتجاوز الدرجة النهائية للواجب (${input.maximumGrade}).`,
    };
  }

  return { valid: true, computedGrade: Number(g.toFixed(2)), normalizedRubric: [] };
}

export function computeHomeworkStatistics(input: {
  totalAssignedStudents: number;
  latestSubmissionsByStudent: Array<{
    status: string;
    isLate: boolean;
    isGradePublished: boolean;
    awardedGrade: number | null;
  }>;
}): {
  totalAssigned: number;
  submittedCount: number;
  notSubmittedCount: number;
  lateCount: number;
  awaitingReviewCount: number;
  returnedCount: number;
  gradedCount: number;
  averageGrade: number | null;
  highestGrade: number | null;
  lowestGrade: number | null;
  submissionPercent: number;
} {
  const realSubs = input.latestSubmissionsByStudent.filter((s) => s.status !== 'DRAFT');
  const submittedCount = realSubs.length;
  const totalAssigned = Math.max(input.totalAssignedStudents, submittedCount);
  const notSubmittedCount = Math.max(0, totalAssigned - submittedCount);
  const lateCount = realSubs.filter((s) => s.isLate || s.status === 'SUBMITTED_LATE').length;
  const returnedCount = realSubs.filter((s) => s.status === 'RETURNED_FOR_REVISION').length;
  const gradedSubs = realSubs.filter(
    (s) => s.status === 'GRADED' && s.isGradePublished && s.awardedGrade !== null,
  );
  const gradedCount = gradedSubs.length;
  const awaitingReviewCount = realSubs.filter(
    (s) =>
      s.status === 'SUBMITTED' ||
      s.status === 'SUBMITTED_LATE' ||
      s.status === 'UNDER_REVIEW' ||
      (s.status === 'GRADED' && !s.isGradePublished),
  ).length;

  const gradesList = gradedSubs.map((s) => Number(s.awardedGrade));
  const averageGrade =
    gradesList.length > 0
      ? Number((gradesList.reduce((acc, v) => acc + v, 0) / gradesList.length).toFixed(2))
      : null;
  const highestGrade = gradesList.length > 0 ? Math.max(...gradesList) : null;
  const lowestGrade = gradesList.length > 0 ? Math.min(...gradesList) : null;
  const submissionPercent = totalAssigned > 0 ? Math.round((submittedCount / totalAssigned) * 100) : 0;

  return {
    totalAssigned,
    submittedCount,
    notSubmittedCount,
    lateCount,
    awaitingReviewCount,
    returnedCount,
    gradedCount,
    averageGrade,
    highestGrade,
    lowestGrade,
    submissionPercent,
  };
}

// =========================================================================
// QUESTION-BY-QUESTION GRADING DOMAIN LOGIC
// =========================================================================

export type HomeworkGradingMode = 'DIRECT' | 'RUBRIC' | 'QUESTION_BY_QUESTION';

export interface QuestionDefinitionInput {
  id?: number;
  questionNumber?: number;
  labelAr: string;
  descriptionAr?: string;
  maxGrade: number;
  displayOrder?: number;
}

export interface QuestionGradeInput {
  questionId: number;
  awardedGrade: number;
  teacherComment?: string;
}

export interface ValidatedQuestionGradeItem {
  questionId: number;
  questionNumber: number;
  labelAr: string;
  maxGrade: number;
  awardedGrade: number;
  teacherComment: string;
}

/**
 * Validates assignment-level question breakdown definitions.
 * When questions are configured, their max grades must be positive and their sum MUST equal assignment maximumGrade.
 */
export function validateHomeworkQuestions(
  maximumGrade: number,
  questions: QuestionDefinitionInput[],
): { valid: boolean; totalMax: number; errorAr?: string } {
  if (!Number.isFinite(maximumGrade) || maximumGrade <= 0 || maximumGrade > 1000) {
    return {
      valid: false,
      totalMax: 0,
      errorAr: 'الدرجة النهائية للواجب يجب أن تكون رقمًا أكبر من صفر ولا تتجاوز 1000.',
    };
  }
  if (!questions.length) {
    return { valid: true, totalMax: 0 };
  }
  if (questions.length > 50) {
    return {
      valid: false,
      totalMax: 0,
      errorAr: 'الحد الأقصى لعدد الأسئلة في الواجب الواحد هو 50 سؤالًا.',
    };
  }

  let total = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.labelAr || !q.labelAr.trim()) {
      return {
        valid: false,
        totalMax: 0,
        errorAr: `يرجى إدخال عنوان واضح للسؤال رقم ${i + 1}.`,
      };
    }
    const maxG = Number(q.maxGrade);
    if (!Number.isFinite(maxG) || maxG <= 0 || maxG > 1000) {
      return {
        valid: false,
        totalMax: 0,
        errorAr: `الدرجة العظمى للسؤال "${q.labelAr}" يجب أن تكون أكبر من صفر.`,
      };
    }
    total += maxG;
  }

  const roundedTotal = Number(total.toFixed(2));
  if (Math.abs(roundedTotal - maximumGrade) > 0.01) {
    return {
      valid: false,
      totalMax: roundedTotal,
      errorAr: `مجموع درجات الأسئلة (${roundedTotal}) يجب أن يساوي الدرجة النهائية للواجب (${maximumGrade}).`,
    };
  }

  return { valid: true, totalMax: roundedTotal };
}

/**
 * Protects existing student question grades when a teacher edits question definitions.
 * - Blocks removing any question that already has saved grading records.
 * - Blocks reducing a question's maxGrade below the highest grade already awarded to a student for that question.
 */
export function validateQuestionStructureUpdate(input: {
  existingQuestions: Array<{ id: number; labelAr: string; maxGrade: number }>;
  incomingQuestions: QuestionDefinitionInput[];
  gradedQuestionMaxAwardedMap: Map<number, number>;
}): { valid: boolean; errorAr?: string } {
  const incomingById = new Map<number, QuestionDefinitionInput>();
  for (const q of input.incomingQuestions) {
    if (q.id && Number.isInteger(q.id) && q.id > 0) {
      if (incomingById.has(q.id)) {
        return { valid: false, errorAr: 'يوجد تكرار في معرّفات الأسئلة المرسلة.' };
      }
      incomingById.set(q.id, q);
    }
  }

  for (const existing of input.existingQuestions) {
    const highestAwarded = input.gradedQuestionMaxAwardedMap.get(existing.id);
    const hasGrades = highestAwarded !== undefined;
    const kept = incomingById.get(existing.id);

    if (hasGrades && !kept) {
      return {
        valid: false,
        errorAr: `لا يمكن حذف "${existing.labelAr}" لأن له درجات تصحيح محفوظة بالفعل للطلاب.`,
      };
    }
    if (hasGrades && kept && Number(kept.maxGrade) + 0.001 < highestAwarded) {
      return {
        valid: false,
        errorAr: `لا يمكن تقليل الدرجة العظمى للسؤال "${existing.labelAr}" إلى (${kept.maxGrade}) لأن هناك طالبًا حصل بالفعل على (${highestAwarded}) في هذا السؤال.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates per-question grades, calculates automatic total, and validates optional manual overall override.
 * Never double-counts overall grade and question scores.
 */
export function validateQuestionByQuestionGrading(input: {
  maximumGrade: number;
  questions: Array<{ id: number; questionNumber: number; labelAr: string; maxGrade: number }>;
  questionGrades: QuestionGradeInput[];
  manualFinalGrade?: number | null;
  overrideReason?: string;
}): {
  valid: boolean;
  questionTotalGrade: number;
  finalGrade: number;
  isManualOverride: boolean;
  overrideReason: string;
  normalizedQuestionGrades: ValidatedQuestionGradeItem[];
  errorAr?: string;
} {
  const emptyFail = (errorAr: string) => ({
    valid: false,
    questionTotalGrade: 0,
    finalGrade: 0,
    isManualOverride: false,
    overrideReason: '',
    normalizedQuestionGrades: [],
    errorAr,
  });

  if (!input.questions.length) {
    return emptyFail('يجب تعريف أسئلة الواجب وتوزيع درجاتها أولًا قبل استخدام التصحيح لكل سؤال.');
  }

  // Verify sum of question maximums matches assignment maximum
  const maxSum = Number(
    input.questions.reduce((acc, q) => acc + Number(q.maxGrade), 0).toFixed(2),
  );
  if (Math.abs(maxSum - input.maximumGrade) > 0.01) {
    return emptyFail(
      `مجموع الدرجات العظمى للأسئلة (${maxSum}) لا يساوي الدرجة النهائية للواجب (${input.maximumGrade}). يرجى ضبط توزيع الأسئلة أولًا.`,
    );
  }

  // Reject duplicate or unknown questionIds
  const validQuestionIds = new Set(input.questions.map((q) => q.id));
  const gradeByQuestionId = new Map<number, QuestionGradeInput>();
  for (const entry of input.questionGrades) {
    if (!validQuestionIds.has(entry.questionId)) {
      return emptyFail('تم إرسال درجة لسؤال غير تابع لهذا الواجب.');
    }
    if (gradeByQuestionId.has(entry.questionId)) {
      return emptyFail('تم إرسال أكثر من درجة لنفس السؤال.');
    }
    gradeByQuestionId.set(entry.questionId, entry);
  }

  let sum = 0;
  const normalized: ValidatedQuestionGradeItem[] = [];
  for (const q of input.questions) {
    const entry = gradeByQuestionId.get(q.id);
    const rawScore = entry !== undefined ? Number(entry.awardedGrade) : 0;
    if (!Number.isFinite(rawScore) || rawScore < 0) {
      return emptyFail(`درجة الطالب في "${q.labelAr}" لا يمكن أن تكون سالبة.`);
    }
    if (rawScore > Number(q.maxGrade) + 0.001) {
      return emptyFail(
        `درجة الطالب في "${q.labelAr}" (${rawScore}) تتجاوز الدرجة العظمى للسؤال (${q.maxGrade}).`,
      );
    }
    const roundedScore = Number(rawScore.toFixed(2));
    sum += roundedScore;
    normalized.push({
      questionId: q.id,
      questionNumber: q.questionNumber,
      labelAr: q.labelAr,
      maxGrade: Number(q.maxGrade),
      awardedGrade: roundedScore,
      teacherComment: (entry?.teacherComment || '').trim(),
    });
  }

  const questionTotalGrade = Number(sum.toFixed(2));
  let finalGrade = questionTotalGrade;
  let isManualOverride = false;
  let cleanReason = '';

  if (input.manualFinalGrade !== null && input.manualFinalGrade !== undefined) {
    const manual = Number(input.manualFinalGrade);
    if (!Number.isFinite(manual) || manual < 0) {
      return emptyFail('الدرجة النهائية للواجب لا يمكن أن تكون سالبة.');
    }
    if (manual > input.maximumGrade + 0.001) {
      return emptyFail(
        `الدرجة النهائية للواجب (${manual}) لا يمكن أن تتجاوز الدرجة العظمى (${input.maximumGrade}).`,
      );
    }
    const roundedManual = Number(manual.toFixed(2));
    if (Math.abs(roundedManual - questionTotalGrade) > 0.001) {
      cleanReason = (input.overrideReason || '').trim();
      if (cleanReason.length < 3) {
        return emptyFail(
          'عند تعديل الدرجة النهائية يدويًا لتختلف عن مجموع درجات الأسئلة، يجب كتابة سبب التعديل.',
        );
      }
      finalGrade = roundedManual;
      isManualOverride = true;
    }
  }

  return {
    valid: true,
    questionTotalGrade,
    finalGrade,
    isManualOverride,
    overrideReason: cleanReason,
    normalizedQuestionGrades: normalized,
  };
}

