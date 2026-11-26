import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_BANK_MAX_BULK_BATCH,
  buildHomeworkQuestionSnapshot,
  canStaffEditBankQuestion,
  computePagination,
  evaluateStatusTransition,
  formatBankCode,
  normalizeTags,
  signQuestionBankFileToken,
  validateBankQuestionPayload,
  validateBulkBatchInput,
  validateQuestionBankFileUpload,
  verifyQuestionBankFileToken,
} from './questionBank.ts';

// Minimal valid 1x1 PNG binary
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// Minimal valid PDF header
const VALID_PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64');

test('validateQuestionBankFileUpload accepts valid PNG for QUESTION_IMAGE and computes SHA-256', () => {
  const res = validateQuestionBankFileUpload({
    fileName: 'physics_q1.png',
    declaredMimeType: 'image/png',
    dataBase64: `data:image/png;base64,${VALID_PNG_BASE64}`,
    purpose: 'QUESTION_IMAGE',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.detectedMimeType, 'image/png');
    assert.equal(res.sha256Hash.length, 64);
    assert.equal(res.sanitizedFileName, 'physics_q1.png');
  }
});

test('validateQuestionBankFileUpload rejects PDF for QUESTION_IMAGE but allows PDF for MODEL_ANSWER_FILE', () => {
  const rejected = validateQuestionBankFileUpload({
    fileName: 'question.pdf',
    dataBase64: VALID_PDF_BASE64,
    purpose: 'QUESTION_IMAGE',
  });
  assert.equal(rejected.ok, false);

  const accepted = validateQuestionBankFileUpload({
    fileName: 'model_answer.pdf',
    dataBase64: VALID_PDF_BASE64,
    purpose: 'MODEL_ANSWER_FILE',
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.detectedMimeType, 'application/pdf');
  }
});

test('validateQuestionBankFileUpload rejects spoofed executable disguised as .png', () => {
  const fakePng = Buffer.from('#!/bin/bash\nrm -rf /').toString('base64');
  const res = validateQuestionBankFileUpload({
    fileName: 'evil.png',
    declaredMimeType: 'image/png',
    dataBase64: fakePng,
    purpose: 'QUESTION_IMAGE',
  });
  assert.equal(res.ok, false);
});

test('signQuestionBankFileToken and verifyQuestionBankFileToken enforce signature and expiry', () => {
  const secret = 'test-signing-secret-1234567890';
  const token = signQuestionBankFileToken(
    {
      storageKey: 'qbf_abc123',
      userId: 42,
      roleSlug: 'STUDENT',
      context: 'homework',
      resourceId: 9,
      fileRole: 'question',
      ttlSec: 300,
    },
    secret,
  );

  const decoded = verifyQuestionBankFileToken(token, secret);
  assert.ok(decoded);
  assert.equal(decoded.storageKey, 'qbf_abc123');
  assert.equal(decoded.userId, 42);
  assert.equal(decoded.context, 'homework');
  assert.equal(decoded.resourceId, 9);
  assert.equal(decoded.fileRole, 'question');

  // Tampered token fails
  assert.equal(verifyQuestionBankFileToken(`${token}x`, secret), null);
  // Wrong secret fails
  assert.equal(verifyQuestionBankFileToken(token, 'wrong-secret'), null);
  // Expired token fails
  const expired = signQuestionBankFileToken(
    {
      storageKey: 'qbf_abc123',
      userId: 42,
      roleSlug: 'STUDENT',
      context: 'bank',
      fileRole: 'model_answer',
      ttlSec: -10,
    },
    secret,
  );
  assert.equal(verifyQuestionBankFileToken(expired, secret), null);
});

test('validateBankQuestionPayload supports image-only questions without written text', () => {
  const imageOnly = validateBankQuestionPayload({
    questionType: 'IMAGE_DIAGRAM',
    difficulty: 'MEDIUM',
    promptAr: '',
    points: 4,
    questionImageCount: 1,
  });
  assert.equal(imageOnly.valid, true);

  const neitherTextNorImage = validateBankQuestionPayload({
    questionType: 'PHYSICS_PROBLEM',
    difficulty: 'HARD',
    promptAr: '   ',
    points: 5,
    questionImageCount: 0,
  });
  assert.equal(neitherTextNorImage.valid, false);
});

test('validateBankQuestionPayload validates MCQ choices and correct answer', () => {
  const missingCorrect = validateBankQuestionPayload({
    questionType: 'MCQ',
    difficulty: 'EASY',
    promptAr: 'ما وحدة قياس شدة التيار؟',
    points: 2,
    questionImageCount: 0,
    choices: [
      { labelAr: 'الأمبير', isCorrect: false },
      { labelAr: 'الفولت', isCorrect: false },
    ],
  });
  assert.equal(missingCorrect.valid, false);

  const validMcq = validateBankQuestionPayload({
    questionType: 'MCQ',
    difficulty: 'EASY',
    promptAr: 'ما وحدة قياس شدة التيار؟',
    points: 2,
    questionImageCount: 0,
    choices: [
      { labelAr: 'الأمبير', isCorrect: true },
      { labelAr: 'الفولت', isCorrect: false },
    ],
  });
  assert.equal(validMcq.valid, true);
});

test('canStaffEditBankQuestion restricts Teaching Assistant to own DRAFT/RETURNED questions only', () => {
  // Own DRAFT -> allowed
  assert.equal(
    canStaffEditBankQuestion({
      actorId: 10,
      hasManage: false,
      hasReview: false,
      hasContribute: true,
      question: { createdById: 10, approvalStatus: 'DRAFT', isArchived: false },
    }).allowed,
    true,
  );
  // Own RETURNED -> allowed
  assert.equal(
    canStaffEditBankQuestion({
      actorId: 10,
      hasManage: false,
      hasReview: false,
      hasContribute: true,
      question: { createdById: 10, approvalStatus: 'RETURNED', isArchived: false },
    }).allowed,
    true,
  );
  // Own APPROVED -> denied for TA
  assert.equal(
    canStaffEditBankQuestion({
      actorId: 10,
      hasManage: false,
      hasReview: false,
      hasContribute: true,
      question: { createdById: 10, approvalStatus: 'APPROVED', isArchived: false },
    }).allowed,
    false,
  );
  // Someone else's DRAFT -> denied for TA
  assert.equal(
    canStaffEditBankQuestion({
      actorId: 10,
      hasManage: false,
      hasReview: false,
      hasContribute: true,
      question: { createdById: 99, approvalStatus: 'DRAFT', isArchived: false },
    }).allowed,
    false,
  );
  // Reviewer / Super Admin -> allowed
  assert.equal(
    canStaffEditBankQuestion({
      actorId: 1,
      hasManage: true,
      hasReview: true,
      hasContribute: true,
      question: { createdById: 10, approvalStatus: 'APPROVED', isArchived: false },
    }).allowed,
    true,
  );
});

test('evaluateStatusTransition enforces TA submit-only and reviewer feedback on RETURN', () => {
  // TA cannot approve
  const taApprove = evaluateStatusTransition({
    currentStatus: 'PENDING_REVIEW',
    isArchived: false,
    action: 'APPROVE',
    canReview: false,
    isOwnerContributor: true,
  });
  assert.equal(taApprove.allowed, false);

  // TA can submit own DRAFT
  const taSubmit = evaluateStatusTransition({
    currentStatus: 'DRAFT',
    isArchived: false,
    action: 'SUBMIT',
    canReview: false,
    isOwnerContributor: true,
  });
  assert.equal(taSubmit.allowed, true);
  assert.equal(taSubmit.nextStatus, 'PENDING_REVIEW');

  // Reviewer returning without feedback fails
  const returnEmpty = evaluateStatusTransition({
    currentStatus: 'PENDING_REVIEW',
    isArchived: false,
    action: 'RETURN',
    feedbackAr: '',
    canReview: true,
    isOwnerContributor: false,
  });
  assert.equal(returnEmpty.allowed, false);

  // Reviewer returning with feedback succeeds
  const returnOk = evaluateStatusTransition({
    currentStatus: 'PENDING_REVIEW',
    isArchived: false,
    action: 'RETURN',
    feedbackAr: 'الصورة غير واضحة يرجى إعادة التصوير',
    canReview: true,
    isOwnerContributor: false,
  });
  assert.equal(returnOk.allowed, true);
  assert.equal(returnOk.nextStatus, 'RETURNED');
});

test('validateBulkBatchInput enforces batch limits and explicit pairing confirmation', () => {
  const tooMany = Array.from({ length: QUESTION_BANK_MAX_BULK_BATCH + 1 }, () => ({
    questionImageKeys: ['qbf_1'],
  }));
  assert.equal(validateBulkBatchInput(tooMany).valid, false);

  const unconfirmedPair = validateBulkBatchInput([
    {
      questionImageKeys: ['qbf_q1'],
      modelAnswerFileKeys: ['qbf_a1'],
      pairingConfirmed: false,
    },
  ]);
  assert.equal(unconfirmedPair.valid, false);

  const groupedPagesConfirmed = validateBulkBatchInput([
    {
      questionImageKeys: ['qbf_page1', 'qbf_page2'],
      modelAnswerFileKeys: ['qbf_ans1'],
      pairingConfirmed: true,
    },
  ]);
  assert.equal(groupedPagesConfirmed.valid, true);
});

test('buildHomeworkQuestionSnapshot builds immutable snapshot with images and model answers', () => {
  const snap = buildHomeworkQuestionSnapshot({
    bankQuestion: {
      id: 17,
      bankCode: formatBankCode(17),
      version: 3,
      questionType: 'PHYSICS_PROBLEM',
      promptAr: 'احسب شدة التيار المار في الدائرة الموضحة.',
      modelAnswerAr: 'I = V / R = 12 / 4 = 3 A',
      explanationAr: 'بتطبيق قانون أوم مباشرة.',
      points: 5,
    },
    questionImages: [
      {
        storageKey: 'qbf_img1',
        fileName: 'circuit.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        displayOrder: 0,
      },
    ],
    modelAnswerFiles: [
      {
        storageKey: 'qbf_ans1',
        fileName: 'solution.png',
        mimeType: 'image/png',
        sizeBytes: 3072,
        displayOrder: 0,
      },
    ],
    questionNumber: 1,
    customMaxGrade: 10,
  });

  assert.equal(snap.bankQuestionId, 17);
  assert.equal(snap.bankQuestionVersion, 3);
  assert.equal(snap.maxGrade, 10);
  assert.equal(snap.labelAr, 'السؤال 1 (QB-00017)');
  assert.equal(snap.questionImagesJson.length, 1);
  assert.equal(snap.modelAnswerFilesJson.length, 1);
  assert.ok(snap.modelAnswerTextSnapshot.includes('I = V / R'));
});

test('computePagination and normalizeTags enforce safe bounds and deduplication', () => {
  assert.deepEqual(computePagination('2', '100'), { page: 2, pageSize: 50, offset: 50 });
  assert.deepEqual(computePagination(-1, 'abc'), { page: 1, pageSize: 20, offset: 0 });
  assert.deepEqual(normalizeTags([' أوم ', 'أوم', 'كيرشوف', '']), ['أوم', 'كيرشوف']);
});
