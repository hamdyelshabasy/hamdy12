import crypto from 'node:crypto';
import { getHomeworkFileSigningSecret } from '../config/secrets.ts';
import { sanitizeFileName, validateHomeworkFileUpload } from './homework.ts';
import { parseLocalizedNumber } from '../../lib/numerals.ts';
import type { QuestionApprovalStatus, QuestionDifficulty } from '../../types/questionBank.ts';

export const QUESTION_BANK_IMAGE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB per image
export const QUESTION_BANK_PDF_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per model-answer PDF
export const QUESTION_BANK_MAX_QUESTION_IMAGES = 6;
export const QUESTION_BANK_MAX_MODEL_ANSWER_FILES = 6;
export const QUESTION_BANK_MAX_BULK_BATCH = 25;
export const QUESTION_BANK_DEFAULT_PAGE_SIZE = 20;
export const QUESTION_BANK_MAX_PAGE_SIZE = 50;

export const ALLOWED_QUESTION_TYPES = new Set([
  'MCQ',
  'TRUE_FALSE',
  'NUMERIC',
  'SHORT_ANSWER',
  'ESSAY',
  'IMAGE_DIAGRAM',
  'PHYSICS_PROBLEM',
  'FILE_UPLOAD',
]);

export const ALLOWED_DIFFICULTIES = new Set<QuestionDifficulty>(['EASY', 'MEDIUM', 'HARD']);

export const ALLOWED_APPROVAL_STATUSES = new Set<QuestionApprovalStatus>([
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'RETURNED',
  'ARCHIVED',
]);

export type QuestionBankFilePurpose = 'QUESTION_IMAGE' | 'MODEL_ANSWER_FILE';

export interface ValidatedBankFileUpload {
  ok: true;
  detectedMimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  cleanBase64: string;
  sanitizedFileName: string;
  sha256Hash: string;
}

export interface InvalidBankFileUpload {
  ok: false;
  errorAr: string;
}

/**
 * Validates file upload for the Central Question Bank using real magic bytes.
 * - Question images ONLY accept JPG/JPEG/PNG/WEBP up to 3 MB.
 * - Model answer files accept JPG/JPEG/PNG/WEBP (3 MB) or PDF (8 MB).
 * - Computes SHA-256 content hash for non-destructive duplicate detection.
 */
export function validateQuestionBankFileUpload(input: {
  fileName: string;
  declaredMimeType?: string;
  dataBase64: string;
  purpose: QuestionBankFilePurpose;
}): ValidatedBankFileUpload | InvalidBankFileUpload {
  const maxBytes =
    input.purpose === 'QUESTION_IMAGE'
      ? QUESTION_BANK_IMAGE_MAX_BYTES
      : QUESTION_BANK_PDF_MAX_BYTES;

  const baseCheck = validateHomeworkFileUpload({
    fileName: input.fileName,
    declaredMimeType: input.declaredMimeType,
    dataBase64: input.dataBase64,
    maxBytes,
  });

  if (!baseCheck.ok) {
    return baseCheck;
  }

  if (input.purpose === 'QUESTION_IMAGE' && baseCheck.detectedMimeType === 'application/pdf') {
    return {
      ok: false,
      errorAr: 'صور الأسئلة يجب أن تكون بصيغة صورة فقط (JPG أو PNG أو WEBP) وليس PDF.',
    };
  }

  if (
    input.purpose === 'MODEL_ANSWER_FILE' &&
    baseCheck.detectedMimeType !== 'application/pdf' &&
    baseCheck.sizeBytes > QUESTION_BANK_IMAGE_MAX_BYTES
  ) {
    return {
      ok: false,
      errorAr: 'حجم صورة الإجابة النموذجية يجب ألا يتجاوز 3 ميجابايت.',
    };
  }

  const buf = Buffer.from(baseCheck.cleanBase64, 'base64');
  const sha256Hash = crypto.createHash('sha256').update(buf).digest('hex');

  return {
    ok: true,
    detectedMimeType: baseCheck.detectedMimeType,
    sizeBytes: baseCheck.sizeBytes,
    cleanBase64: baseCheck.cleanBase64,
    sanitizedFileName: sanitizeFileName(
      baseCheck.sanitizedFileName,
      baseCheck.detectedMimeType === 'application/pdf' ? 'pdf' : 'jpg',
    ),
    sha256Hash,
  };
}

export function generateQuestionBankStorageKey(): string {
  return `qbf_${crypto.randomBytes(16).toString('hex')}`;
}

export function formatBankCode(questionId: number): string {
  return `QB-${String(Math.max(1, Math.trunc(questionId))).padStart(5, '0')}`;
}

export type BankFileTokenContext = 'bank' | 'exam' | 'homework';
export type BankFileTokenRole = 'question' | 'model_answer';

export interface QuestionBankFileTokenPayload {
  storageKey: string;
  userId: number;
  roleSlug: string;
  context: BankFileTokenContext;
  resourceId?: number | null;
  fileRole: BankFileTokenRole;
  ttlSec?: number;
}

export function signQuestionBankFileToken(
  payload: QuestionBankFileTokenPayload,
  secretOverride?: string,
): string {
  const signingSecret = secretOverride ?? getHomeworkFileSigningSecret();
  const exp = Math.floor(Date.now() / 1000) + (payload.ttlSec ?? 21600); // 6 hours so long exams/homework never break mid-session
  const encoded = Buffer.from(
    JSON.stringify({
      k: payload.storageKey,
      u: payload.userId,
      r: payload.roleSlug,
      c: payload.context,
      i: payload.resourceId ?? null,
      f: payload.fileRole,
      e: exp,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyQuestionBankFileToken(
  token: string,
  secretOverride?: string,
): {
  storageKey: string;
  userId: number;
  roleSlug: string;
  context: BankFileTokenContext;
  resourceId: number | null;
  fileRole: BankFileTokenRole;
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
      c: BankFileTokenContext;
      i: number | null;
      f: BankFileTokenRole;
      e: number;
    };
    if (
      !parsed.k ||
      !parsed.u ||
      !parsed.r ||
      !parsed.c ||
      !parsed.f ||
      !parsed.e ||
      parsed.e < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      storageKey: parsed.k,
      userId: parsed.u,
      roleSlug: parsed.r,
      context: parsed.c,
      resourceId: parsed.i ?? null,
      fileRole: parsed.f,
      exp: parsed.e,
    };
  } catch {
    return null;
  }
}

export function buildSignedQuestionBankFileUrl(payload: QuestionBankFileTokenPayload): string {
  const token = signQuestionBankFileToken(payload);
  return `/api/question-bank/files/${encodeURIComponent(payload.storageKey)}?token=${encodeURIComponent(token)}`;
}

/**
 * Enforces edit permissions for bank questions:
 * - Managers / reviewers (SUPER_ADMIN or question_bank:manage / question_bank:review) can edit any non-archived bank question.
 * - Contributors (e.g., TEACHING_ASSISTANT with question_bank:contribute only) can ONLY edit their OWN questions
 *   while status is DRAFT or RETURNED (never APPROVED, PENDING_REVIEW, ARCHIVED, or another user's question).
 */
export function canStaffEditBankQuestion(input: {
  actorId: number;
  hasManage: boolean;
  hasReview: boolean;
  hasContribute: boolean;
  question: {
    createdById: number | null;
    approvalStatus: string;
    isArchived: boolean;
  };
}): { allowed: boolean; errorAr?: string } {
  if (input.hasManage || input.hasReview) {
    return { allowed: true };
  }
  if (!input.hasContribute) {
    return { allowed: false, errorAr: 'ليس لديك صلاحية لتعديل أسئلة بنك الأسئلة.' };
  }
  if (input.question.isArchived || input.question.approvalStatus === 'ARCHIVED') {
    return { allowed: false, errorAr: 'لا يمكن تعديل سؤال مؤرشف.' };
  }
  if (input.question.createdById !== input.actorId) {
    return { allowed: false, errorAr: 'يمكن لمساعد المدرس تعديل الأسئلة التي أنشأها فقط.' };
  }
  if (input.question.approvalStatus !== 'DRAFT' && input.question.approvalStatus !== 'RETURNED') {
    return {
      allowed: false,
      errorAr:
        'لا يمكن تعديل هذا السؤال بعد إرساله للمراجعة أو اعتماده. يمكن التعديل فقط في حالة «مسودة» أو «مُعاد للتعديل».',
    };
  }
  return { allowed: true };
}

export interface BankQuestionValidationInput {
  questionType: string;
  difficulty: string;
  promptAr: string;
  points: number;
  questionImageCount: number;
  legacyImageUrl?: string | null;
  choices?: Array<{ labelAr: string; isCorrect: boolean }>;
  numericAnswer?: string | number | null;
}

/**
 * Validates Question Bank question payloads.
 * Explicitly supports IMAGE-ONLY questions (promptAr may be empty when at least 1 question image is attached).
 */
export function validateBankQuestionPayload(input: BankQuestionValidationInput): {
  valid: boolean;
  errorAr?: string;
} {
  if (!ALLOWED_QUESTION_TYPES.has(input.questionType)) {
    return { valid: false, errorAr: 'نوع السؤال المختار غير مدعوم.' };
  }
  if (!ALLOWED_DIFFICULTIES.has(input.difficulty as QuestionDifficulty)) {
    return { valid: false, errorAr: 'مستوى الصعوبة غير صالح (سهل / متوسط / صعب).' };
  }
  if (!Number.isFinite(input.points) || input.points <= 0 || input.points > 200) {
    return { valid: false, errorAr: 'الدرجة المقترحة للسؤال يجب أن تكون رقمًا بين 1 و 200.' };
  }

  const hasText = Boolean(input.promptAr && input.promptAr.trim().length > 0);
  const hasImage =
    input.questionImageCount > 0 || Boolean(input.legacyImageUrl && input.legacyImageUrl.trim());

  if (!hasText && !hasImage) {
    return {
      valid: false,
      errorAr: 'يجب إدخال نص السؤال أو إرفاق صورة واحدة على الأقل للسؤال.',
    };
  }

  if (input.questionImageCount > QUESTION_BANK_MAX_QUESTION_IMAGES) {
    return {
      valid: false,
      errorAr: `الحد الأقصى لعدد صور السؤال الواحد هو ${QUESTION_BANK_MAX_QUESTION_IMAGES} صور.`,
    };
  }

  if (input.questionType === 'MCQ' || input.questionType === 'TRUE_FALSE') {
    const validChoices = (input.choices || []).filter((c) => c.labelAr && c.labelAr.trim().length > 0);
    if (validChoices.length < 2) {
      return {
        valid: false,
        errorAr: 'يجب إدخال اختيارين على الأقل لأسئلة الاختيار من متعدد أو الصواب والخطأ.',
      };
    }
    const correctCount = validChoices.filter((c) => c.isCorrect).length;
    if (correctCount < 1) {
      return {
        valid: false,
        errorAr: 'يرجى تحديد الإجابة الصحيحة ضمن الاختيارات.',
      };
    }
  }

  if (
    input.questionType === 'NUMERIC' &&
    input.numericAnswer !== undefined &&
    input.numericAnswer !== null &&
    String(input.numericAnswer).trim() !== ''
  ) {
    const parsedNum = parseLocalizedNumber(input.numericAnswer);
    if (parsedNum === null || !Number.isFinite(parsedNum)) {
      return { valid: false, errorAr: 'الإجابة الرقمية الصحيحة يجب أن تكون رقمًا صالحًا.' };
    }
  }

  return { valid: true };
}

export type ReviewAction = 'SUBMIT' | 'APPROVE' | 'RETURN' | 'ARCHIVE' | 'RESTORE';

export function evaluateStatusTransition(input: {
  currentStatus: string;
  isArchived: boolean;
  action: ReviewAction;
  feedbackAr?: string;
  canReview: boolean;
  isOwnerContributor: boolean;
}): {
  allowed: boolean;
  nextStatus?: QuestionApprovalStatus;
  nextArchived?: boolean;
  errorAr?: string;
} {
  if (input.action === 'SUBMIT') {
    if (!input.canReview && !input.isOwnerContributor) {
      return { allowed: false, errorAr: 'يمكن إرسال المسودات الخاصة بك فقط للمراجعة.' };
    }
    if (input.isArchived) {
      return { allowed: false, errorAr: 'لا يمكن إرسال سؤال مؤرشف للمراجعة.' };
    }
    if (input.currentStatus !== 'DRAFT' && input.currentStatus !== 'RETURNED') {
      return { allowed: false, errorAr: 'هذا السؤال تم إرساله للمراجعة أو اعتماده بالفعل.' };
    }
    return { allowed: true, nextStatus: 'PENDING_REVIEW', nextArchived: false };
  }

  if (!input.canReview) {
    return { allowed: false, errorAr: 'صلاحية مراجعة واعتماد الأسئلة مخصصة للأستاذ فقط.' };
  }

  if (input.action === 'APPROVE') {
    return { allowed: true, nextStatus: 'APPROVED', nextArchived: false };
  }

  if (input.action === 'RETURN') {
    if (!input.feedbackAr || input.feedbackAr.trim().length < 3) {
      return {
        allowed: false,
        errorAr: 'يرجى كتابة ملاحظة واضحة لمساعد المدرس توضح سبب إعادة السؤال للتعديل.',
      };
    }
    return { allowed: true, nextStatus: 'RETURNED', nextArchived: false };
  }

  if (input.action === 'ARCHIVE') {
    return { allowed: true, nextStatus: 'ARCHIVED', nextArchived: true };
  }

  if (input.action === 'RESTORE') {
    return { allowed: true, nextStatus: 'DRAFT', nextArchived: false };
  }

  return { allowed: false, errorAr: 'إجراء المراجعة غير معروف.' };
}

export interface BulkUploadItemInput {
  clientKey?: string;
  questionType?: string;
  difficulty?: string;
  promptAr?: string;
  points?: number;
  topicAr?: string;
  sourceAr?: string;
  teacherNotesAr?: string;
  tags?: string[];
  questionImageKeys: string[];
  modelAnswerAr?: string;
  explanationAr?: string;
  modelAnswerFileKeys?: string[];
  pairingConfirmed?: boolean;
}

/**
 * Validates a bulk TA upload batch.
 * - Enforces max batch size (25 questions per batch).
 * - Ensures every item has at least 1 question image or text.
 * - Enforces explicit manual confirmation whenever model-answer files are paired in bulk.
 */
export function validateBulkBatchInput(items: BulkUploadItemInput[]): {
  valid: boolean;
  errorAr?: string;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, errorAr: 'يرجى إضافة سؤال واحد على الأقل قبل حفظ الدفعة.' };
  }
  if (items.length > QUESTION_BANK_MAX_BULK_BATCH) {
    return {
      valid: false,
      errorAr: `الحد الأقصى للدفعة الواحدة هو ${QUESTION_BANK_MAX_BULK_BATCH} سؤالًا لضمان استقرار الرفع.`,
    };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qImgs = Array.isArray(item.questionImageKeys) ? item.questionImageKeys.filter(Boolean) : [];
    const maFiles = Array.isArray(item.modelAnswerFileKeys) ? item.modelAnswerFileKeys.filter(Boolean) : [];
    const hasText = Boolean(item.promptAr && item.promptAr.trim());

    if (qImgs.length === 0 && !hasText) {
      return {
        valid: false,
        errorAr: `العنصر رقم ${i + 1} لا يحتوي على صورة سؤال أو نص سؤال.`,
      };
    }
    if (qImgs.length > QUESTION_BANK_MAX_QUESTION_IMAGES) {
      return {
        valid: false,
        errorAr: `العنصر رقم ${i + 1} يتجاوز الحد الأقصى لصور السؤال (${QUESTION_BANK_MAX_QUESTION_IMAGES}).`,
      };
    }
    if (maFiles.length > QUESTION_BANK_MAX_MODEL_ANSWER_FILES) {
      return {
        valid: false,
        errorAr: `العنصر رقم ${i + 1} يتجاوز الحد الأقصى لملفات الإجابة النموذجية (${QUESTION_BANK_MAX_MODEL_ANSWER_FILES}).`,
      };
    }
    if (maFiles.length > 0 && item.pairingConfirmed === false) {
      return {
        valid: false,
        errorAr: `يرجى تأكيد ربط ملف الإجابة النموذجية يدويًا للعنصر رقم ${i + 1} قبل الحفظ.`,
      };
    }
  }

  return { valid: true };
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const clean = String(raw || '').trim().slice(0, 40);
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
    if (out.length >= 12) break;
  }
  return out;
}

export function computePagination(rawPage: unknown, rawPageSize: unknown): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const pageNum = Number(rawPage);
  const sizeNum = Number(rawPageSize);
  const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1;
  const pageSize =
    Number.isInteger(sizeNum) && sizeNum > 0
      ? Math.min(sizeNum, QUESTION_BANK_MAX_PAGE_SIZE)
      : QUESTION_BANK_DEFAULT_PAGE_SIZE;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export interface HomeworkChoiceSnapshot {
  id: string;
  labelAr: string;
  imageUrl?: string | null;
  isCorrect: boolean;
  displayOrder: number;
}

export interface HomeworkStructuredAnswerInput {
  questionId: number;
  selectedChoiceId?: string | null;
  textAnswer?: string;
}

export function sanitizeHomeworkChoicesForStudent(
  choicesList: HomeworkChoiceSnapshot[] | null | undefined,
  revealCorrect: boolean,
): Array<{
  id: string;
  labelAr: string;
  imageUrl?: string | null;
  isCorrect?: boolean;
  displayOrder: number;
}> {
  if (!Array.isArray(choicesList) || choicesList.length === 0) return [];
  return [...choicesList]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((c, idx) => ({
      id: String(c.id),
      labelAr: String(c.labelAr || ''),
      imageUrl: c.imageUrl ?? null,
      ...(revealCorrect ? { isCorrect: Boolean(c.isCorrect) } : {}),
      displayOrder: Number.isFinite(c.displayOrder) ? c.displayOrder : idx,
    }));
}

export function validateHomeworkStructuredAnswers(
  questionsList: Array<{
    id: number;
    questionType?: string | null;
    choicesSnapshotJson?: HomeworkChoiceSnapshot[] | null;
  }>,
  answers: HomeworkStructuredAnswerInput[],
): {
  valid: boolean;
  errorAr?: string;
  normalized: Array<{ questionId: number; selectedChoiceId?: string | null; textAnswer?: string }>;
  answeredCount: number;
} {
  const questionById = new Map(questionsList.map((q) => [q.id, q]));
  const deduped = new Map<
    number,
    { questionId: number; selectedChoiceId?: string | null; textAnswer?: string }
  >();

  for (const ans of answers || []) {
    const q = questionById.get(ans.questionId);
    if (!q) {
      return {
        valid: false,
        errorAr: 'إحدى الإجابات المرسلة لا تتطابق مع أسئلة هذا الواجب.',
        normalized: [],
        answeredCount: 0,
      };
    }
    const selectedChoiceId =
      ans.selectedChoiceId !== undefined && ans.selectedChoiceId !== null && String(ans.selectedChoiceId).trim() !== ''
        ? String(ans.selectedChoiceId).trim()
        : null;
    const textAnswer = typeof ans.textAnswer === 'string' ? ans.textAnswer.trim().slice(0, 5000) : '';

    if (selectedChoiceId) {
      const validChoiceIds = new Set((q.choicesSnapshotJson || []).map((c) => String(c.id)));
      if (!validChoiceIds.has(selectedChoiceId)) {
        return {
          valid: false,
          errorAr: 'الاختيار المحدد لأحد الأسئلة غير صالح لهذا الواجب.',
          normalized: [],
          answeredCount: 0,
        };
      }
    }

    if (selectedChoiceId || textAnswer) {
      deduped.set(ans.questionId, {
        questionId: ans.questionId,
        selectedChoiceId,
        textAnswer,
      });
    }
  }

  const normalized = Array.from(deduped.values());
  return {
    valid: true,
    normalized,
    answeredCount: normalized.length,
  };
}

export function buildHomeworkQuestionSnapshot(input: {
  bankQuestion: {
    id: number;
    bankCode: string | null;
    version: number;
    questionType: string;
    promptAr: string;
    modelAnswerAr: string | null;
    explanationAr: string | null;
    points: number;
  };
  questionImages: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    displayOrder: number;
  }>;
  modelAnswerFiles: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    displayOrder: number;
  }>;
  choices?: Array<{
    id: number | string;
    labelAr: string;
    imageUrl?: string | null;
    isCorrect: boolean;
    sortOrder?: number;
    displayOrder?: number;
  }>;
  questionNumber: number;
  customLabelAr?: string;
  customDescriptionAr?: string;
  customMaxGrade?: number;
}) {
  const code = input.bankQuestion.bankCode || formatBankCode(input.bankQuestion.id);
  const defaultLabel = `السؤال ${input.questionNumber} (${code})`;
  const promptTrimmed = (input.bankQuestion.promptAr || '').trim();
  const modelTextParts = [
    (input.bankQuestion.modelAnswerAr || '').trim(),
    (input.bankQuestion.explanationAr || '').trim(),
  ].filter(Boolean);

  const choicesSnapshotJson: HomeworkChoiceSnapshot[] = (input.choices || [])
    .slice()
    .sort((a, b) => (a.displayOrder ?? a.sortOrder ?? 0) - (b.displayOrder ?? b.sortOrder ?? 0))
    .map((c, idx) => ({
      id: String(c.id),
      labelAr: String(c.labelAr || '').trim(),
      imageUrl: c.imageUrl ?? null,
      isCorrect: Boolean(c.isCorrect),
      displayOrder: idx,
    }))
    .filter((c) => c.labelAr.length > 0);

  return {
    bankQuestionId: input.bankQuestion.id,
    bankQuestionVersion: input.bankQuestion.version,
    questionType: input.bankQuestion.questionType,
    labelAr: (input.customLabelAr || '').trim() || defaultLabel,
    descriptionAr:
      (input.customDescriptionAr || '').trim() ||
      (promptTrimmed ? promptTrimmed.slice(0, 280) : 'سؤال مصور من بنك الأسئلة'),
    promptSnapshotAr: promptTrimmed,
    questionImagesJson: input.questionImages.map((img, idx) => ({
      storageKey: img.storageKey,
      fileName: img.fileName,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes,
      displayOrder: idx,
    })),
    choicesSnapshotJson,
    modelAnswerTextSnapshot: modelTextParts.join('\n\n'),
    modelAnswerFilesJson: input.modelAnswerFiles.map((f, idx) => ({
      storageKey: f.storageKey,
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      displayOrder: idx,
    })),
    maxGrade: Number(
      (input.customMaxGrade !== undefined && input.customMaxGrade > 0
        ? input.customMaxGrade
        : input.bankQuestion.points
      ).toFixed(2),
    ),
  };
}
