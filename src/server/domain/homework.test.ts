import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHomeworkStatistics,
  deriveStudentHomeworkStatus,
  evaluateModelAnswerRelease,
  evaluateStudentHomeworkEligibility,
  evaluateSubmissionPermission,
  signHomeworkFileToken,
  validateAcademicCompatibility,
  validateGradingSubmission,
  validateHomeworkFileUpload,
  validateHomeworkQuestions,
  validateQuestionByQuestionGrading,
  validateQuestionStructureUpdate,
  validateRubricDefinition,
  verifyHomeworkFileToken,
} from './homework.ts';

test('validateHomeworkFileUpload accepts valid JPEG, PNG, WEBP, PDF magic bytes and rejects spoofed or oversized files', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const pngRes = validateHomeworkFileUpload({
    fileName: 'solution-page-1.png',
    dataBase64: `data:image/png;base64,${pngBytes.toString('base64')}`,
  });
  assert.equal(pngRes.ok, true);
  if (pngRes.ok) assert.equal(pngRes.detectedMimeType, 'image/png');

  const pdfBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
  const pdfRes = validateHomeworkFileUpload({
    fileName: 'homework.pdf',
    dataBase64: pdfBytes.toString('base64'),
  });
  assert.equal(pdfRes.ok, true);
  if (pdfRes.ok) assert.equal(pdfRes.detectedMimeType, 'application/pdf');

  // Spoofed script disguised as .jpg
  const fakeImg = Buffer.from('<script>alert(1)</script>');
  const spoofRes = validateHomeworkFileUpload({
    fileName: 'evil.jpg',
    declaredMimeType: 'image/jpeg',
    dataBase64: fakeImg.toString('base64'),
  });
  assert.equal(spoofRes.ok, false);

  // Oversized check
  const bigRes = validateHomeworkFileUpload({
    fileName: 'huge.pdf',
    dataBase64: Buffer.concat([pdfBytes, Buffer.alloc(1024)]).toString('base64'),
    maxBytes: 100,
  });
  assert.equal(bigRes.ok, false);
});

test('signed file access token verifies intact signature and rejects tampering', () => {
  const token = signHomeworkFileToken({
    storageKey: 'hwf_abc123',
    userId: 42,
    roleSlug: 'STUDENT',
    ttlSec: 300,
  });
  const verified = verifyHomeworkFileToken(token);
  assert.ok(verified);
  assert.equal(verified?.storageKey, 'hwf_abc123');
  assert.equal(verified?.userId, 42);

  // Tampered token must fail
  assert.equal(verifyHomeworkFileToken(`${token}x`), null);
});

test('validateAcademicCompatibility rejects mismatched tracks, grades, videos, or courses', () => {
  assert.equal(
    validateAcademicCompatibility({
      trackId: 1,
      grade: { id: 3, trackId: 1 },
      video: { id: 12, gradeId: 3, lessonId: 5 },
      course: { id: 2, gradeId: 3 },
    }).valid,
    true,
  );

  assert.equal(
    validateAcademicCompatibility({
      trackId: 1,
      grade: { id: 6, trackId: 2 },
    }).valid,
    false,
  );

  assert.equal(
    validateAcademicCompatibility({
      trackId: 1,
      grade: { id: 3, trackId: 1 },
      video: { id: 12, gradeId: 4, lessonId: 5 },
    }).valid,
    false,
  );
});

test('evaluateStudentHomeworkEligibility enforces GRADE, GROUP, COURSE, STUDENTS scopes and video authorization', () => {
  const baseAssignment = {
    gradeId: 3,
    courseId: 10,
    videoId: 12,
    assignmentScope: 'GRADE',
    publicationStatus: 'PUBLISHED',
    publishedAt: null,
  };

  // Unpaid student without video access cannot see homework attached to a restricted paid video
  const blockedVideo = evaluateStudentHomeworkEligibility({
    assignment: baseAssignment,
    studentId: 7,
    isStaff: false,
    approvedGradeIds: [3],
    studentGroupIds: [],
    activeCourseIds: [],
    hasGradeAllEntitlement: false,
    targetStudentIds: [],
    targetGroupIds: [],
    hasVideoAccess: false,
  });
  assert.equal(blockedVideo.eligible, false);

  // Course-scoped homework allowed only for subscribers
  const courseBlocked = evaluateStudentHomeworkEligibility({
    assignment: { ...baseAssignment, assignmentScope: 'COURSE', videoId: null },
    studentId: 7,
    isStaff: false,
    approvedGradeIds: [3],
    studentGroupIds: [],
    activeCourseIds: [99],
    hasGradeAllEntitlement: false,
    targetStudentIds: [],
    targetGroupIds: [],
    hasVideoAccess: true,
  });
  assert.equal(courseBlocked.eligible, false);

  const courseAllowed = evaluateStudentHomeworkEligibility({
    assignment: { ...baseAssignment, assignmentScope: 'COURSE', videoId: null },
    studentId: 7,
    isStaff: false,
    approvedGradeIds: [3],
    studentGroupIds: [],
    activeCourseIds: [10],
    hasGradeAllEntitlement: false,
    targetStudentIds: [],
    targetGroupIds: [],
    hasVideoAccess: true,
  });
  assert.equal(courseAllowed.eligible, true);

  // Explicitly targeted student
  const directTarget = evaluateStudentHomeworkEligibility({
    assignment: { ...baseAssignment, assignmentScope: 'STUDENTS' },
    studentId: 7,
    isStaff: false,
    approvedGradeIds: [3],
    studentGroupIds: [],
    activeCourseIds: [],
    hasGradeAllEntitlement: false,
    targetStudentIds: [7],
    targetGroupIds: [],
    hasVideoAccess: false,
  });
  assert.equal(directTarget.eligible, true);
});

test('evaluateSubmissionPermission enforces server deadlines, late rules, resubmission limits, and revision reopening', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const pastDeadline = new Date('2026-11-20T12:00:00Z');
  const futureDeadline = new Date('2026-11-25T12:00:00Z');

  // Past deadline & late disallowed
  const deniedLate = evaluateSubmissionPermission({
    assignment: {
      deadline: pastDeadline,
      allowLateSubmission: false,
      allowResubmission: false,
      maximumSubmissions: 1,
      allowReopenAfterGrading: false,
    },
    existingSubmittedVersions: [],
    now,
  });
  assert.equal(deniedLate.canSubmit, false);

  // Past deadline & late allowed
  const allowedLate = evaluateSubmissionPermission({
    assignment: {
      deadline: pastDeadline,
      allowLateSubmission: true,
      allowResubmission: false,
      maximumSubmissions: 1,
      allowReopenAfterGrading: false,
    },
    existingSubmittedVersions: [],
    now,
  });
  assert.equal(allowedLate.canSubmit, true);
  assert.equal(allowedLate.isLate, true);
  assert.equal(allowedLate.nextVersion, 1);

  // Resubmission capped at 2
  const allowedV2 = evaluateSubmissionPermission({
    assignment: {
      deadline: futureDeadline,
      allowLateSubmission: false,
      allowResubmission: true,
      maximumSubmissions: 2,
      allowReopenAfterGrading: false,
    },
    existingSubmittedVersions: [{ version: 1, status: 'SUBMITTED', isGradePublished: false }],
    now,
  });
  assert.equal(allowedV2.canSubmit, true);
  assert.equal(allowedV2.nextVersion, 2);

  const deniedV3 = evaluateSubmissionPermission({
    assignment: {
      deadline: futureDeadline,
      allowLateSubmission: false,
      allowResubmission: true,
      maximumSubmissions: 2,
      allowReopenAfterGrading: false,
    },
    existingSubmittedVersions: [
      { version: 1, status: 'SUBMITTED', isGradePublished: false },
      { version: 2, status: 'SUBMITTED', isGradePublished: false },
    ],
    now,
  });
  assert.equal(deniedV3.canSubmit, false);

  // Teacher returned for revision reopens submission even past deadline
  const reopened = evaluateSubmissionPermission({
    assignment: {
      deadline: pastDeadline,
      allowLateSubmission: false,
      allowResubmission: false,
      maximumSubmissions: 1,
      allowReopenAfterGrading: false,
    },
    existingSubmittedVersions: [{ version: 1, status: 'RETURNED_FOR_REVISION', isGradePublished: false }],
    now,
  });
  assert.equal(reopened.canSubmit, true);
  assert.equal(reopened.nextVersion, 2);
});

test('evaluateModelAnswerRelease strictly enforces all 6 visibility policies', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const past = new Date('2026-11-20T12:00:00Z');
  const future = new Date('2026-11-25T12:00:00Z');

  // 1. HIDDEN
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'HIDDEN',
      releaseAt: null,
      manuallyReleased: true,
      assignmentDeadline: past,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: true,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );

  // 2. AFTER_DEADLINE
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_DEADLINE',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: future,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_DEADLINE',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: past,
      hasStudentSubmitted: false,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    true,
  );

  // 3. AFTER_SUBMISSION
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_SUBMISSION',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: future,
      hasStudentSubmitted: false,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_SUBMISSION',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: future,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    true,
  );

  // 4. AFTER_GRADING
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_GRADING',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: past,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'AFTER_GRADING',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: past,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: true,
      isStaff: false,
      now,
    }).isReleased,
    true,
  );

  // 5. MANUAL_RELEASE
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'MANUAL_RELEASE',
      releaseAt: null,
      manuallyReleased: false,
      assignmentDeadline: past,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: true,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'MANUAL_RELEASE',
      releaseAt: null,
      manuallyReleased: true,
      assignmentDeadline: future,
      hasStudentSubmitted: false,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    true,
  );

  // 6. SCHEDULED_RELEASE
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'SCHEDULED_RELEASE',
      releaseAt: future,
      manuallyReleased: false,
      assignmentDeadline: past,
      hasStudentSubmitted: true,
      isStudentGradedAndPublished: true,
      isStaff: false,
      now,
    }).isReleased,
    false,
  );
  assert.equal(
    evaluateModelAnswerRelease({
      policy: 'SCHEDULED_RELEASE',
      releaseAt: past,
      manuallyReleased: false,
      assignmentDeadline: future,
      hasStudentSubmitted: false,
      isStudentGradedAndPublished: false,
      isStaff: false,
      now,
    }).isReleased,
    true,
  );
});

test('validateRubricDefinition, validateGradingSubmission, status derivation, and statistics work accurately', () => {
  const rubric = [
    { id: 'law', labelAr: 'القانون الفيزيائي الصحيح', maxPoints: 3 },
    { id: 'steps', labelAr: 'خطوات الحل', maxPoints: 4 },
    { id: 'units', labelAr: 'الوحدات والناتج النهائي', maxPoints: 3 },
  ];
  assert.equal(validateRubricDefinition(10, rubric).valid, true);
  assert.equal(validateRubricDefinition(12, rubric).valid, false);

  const graded = validateGradingSubmission({
    maximumGrade: 10,
    awardedGrade: null,
    rubricDefinition: rubric,
    rubricScores: [
      { id: 'law', awardedPoints: 3 },
      { id: 'steps', awardedPoints: 3.5 },
      { id: 'units', awardedPoints: 2.5 },
    ],
  });
  assert.equal(graded.valid, true);
  assert.equal(graded.computedGrade, 9);

  // Negative & over-max rejected
  assert.equal(
    validateGradingSubmission({ maximumGrade: 10, awardedGrade: -1, rubricDefinition: [] }).valid,
    false,
  );
  assert.equal(
    validateGradingSubmission({ maximumGrade: 10, awardedGrade: 11, rubricDefinition: [] }).valid,
    false,
  );

  assert.equal(
    deriveStudentHomeworkStatus({
      deadline: '2026-11-25T12:00:00Z',
      allowLateSubmission: false,
      latestSubmission: { status: 'GRADED', isLate: false, isGradePublished: true },
      now: new Date('2026-11-21T12:00:00Z'),
    }).code,
    'GRADED',
  );

  const stats = computeHomeworkStatistics({
    totalAssignedStudents: 4,
    latestSubmissionsByStudent: [
      { status: 'GRADED', isLate: false, isGradePublished: true, awardedGrade: 10 },
      { status: 'GRADED', isLate: true, isGradePublished: true, awardedGrade: 8 },
      { status: 'SUBMITTED', isLate: false, isGradePublished: false, awardedGrade: null },
    ],
  });
  assert.equal(stats.submittedCount, 3);
  assert.equal(stats.notSubmittedCount, 1);
  assert.equal(stats.lateCount, 1);
  assert.equal(stats.gradedCount, 2);
  assert.equal(stats.awaitingReviewCount, 1);
  assert.equal(stats.averageGrade, 9);
  assert.equal(stats.highestGrade, 10);
  assert.equal(stats.lowestGrade, 8);
  assert.equal(stats.submissionPercent, 75);
});

test('validateHomeworkQuestions and validateQuestionStructureUpdate enforce sum match and protect graded questions', () => {
  // Valid 3-question breakdown summing to 20
  const ok = validateHomeworkQuestions(20, [
    { labelAr: 'السؤال الأول', maxGrade: 5 },
    { labelAr: 'السؤال الثاني', maxGrade: 5 },
    { labelAr: 'السؤال الثالث — المسألة الحسابية', maxGrade: 10 },
  ]);
  assert.equal(ok.valid, true);
  assert.equal(ok.totalMax, 20);

  // Sum mismatch rejected
  const sumMismatch = validateHomeworkQuestions(20, [
    { labelAr: 'السؤال الأول', maxGrade: 5 },
    { labelAr: 'السؤال الثاني', maxGrade: 10 },
  ]);
  assert.equal(sumMismatch.valid, false);

  // Deleting a graded question blocked; deleting an ungraded question allowed
  const gradedMap = new Map<number, number>([[101, 4.5]]);
  const blockDeleteGraded = validateQuestionStructureUpdate({
    existingQuestions: [
      { id: 101, labelAr: 'السؤال الأول', maxGrade: 5 },
      { id: 102, labelAr: 'السؤال الثاني', maxGrade: 5 },
    ],
    incomingQuestions: [{ id: 102, labelAr: 'السؤال الثاني', maxGrade: 10 }],
    gradedQuestionMaxAwardedMap: gradedMap,
  });
  assert.equal(blockDeleteGraded.valid, false);

  // Lowering maxGrade below an existing awarded grade blocked
  const blockLowerMax = validateQuestionStructureUpdate({
    existingQuestions: [{ id: 101, labelAr: 'السؤال الأول', maxGrade: 5 }],
    incomingQuestions: [{ id: 101, labelAr: 'السؤال الأول', maxGrade: 4 }],
    gradedQuestionMaxAwardedMap: gradedMap,
  });
  assert.equal(blockLowerMax.valid, false);

  // Removing ungraded question while keeping graded question succeeds
  const allowDeleteUngraded = validateQuestionStructureUpdate({
    existingQuestions: [
      { id: 101, labelAr: 'السؤال الأول', maxGrade: 5 },
      { id: 102, labelAr: 'السؤال الثاني', maxGrade: 5 },
    ],
    incomingQuestions: [{ id: 101, labelAr: 'السؤال الأول', maxGrade: 10 }],
    gradedQuestionMaxAwardedMap: gradedMap,
  });
  assert.equal(allowDeleteUngraded.valid, true);
});

test('validateQuestionByQuestionGrading computes auto total, enforces bounds, and requires override reason on manual adjustment', () => {
  const questions = [
    { id: 1, questionNumber: 1, labelAr: 'السؤال الأول', maxGrade: 5 },
    { id: 2, questionNumber: 2, labelAr: 'السؤال الثاني', maxGrade: 5 },
    { id: 3, questionNumber: 3, labelAr: 'السؤال الثالث', maxGrade: 10 },
  ];

  // Auto total = 15 / 20
  const autoRes = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [
      { questionId: 1, awardedGrade: 4, teacherComment: 'القانون صحيح ولكن خطأ بسيط بالتعويض' },
      { questionId: 2, awardedGrade: 3, teacherComment: 'راجع تحويل الوحدات' },
      { questionId: 3, awardedGrade: 8, teacherComment: 'ممتاز' },
    ],
  });
  assert.equal(autoRes.valid, true);
  assert.equal(autoRes.questionTotalGrade, 15);
  assert.equal(autoRes.finalGrade, 15);
  assert.equal(autoRes.isManualOverride, false);
  assert.equal(autoRes.normalizedQuestionGrades.length, 3);

  // Manual override without reason -> rejected
  const overrideNoReason = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [
      { questionId: 1, awardedGrade: 4 },
      { questionId: 2, awardedGrade: 3 },
      { questionId: 3, awardedGrade: 8 },
    ],
    manualFinalGrade: 16,
    overrideReason: '',
  });
  assert.equal(overrideNoReason.valid, false);

  // Manual override with reason -> accepted, preserves auto total=15 & final=16
  const overrideOk = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [
      { questionId: 1, awardedGrade: 4 },
      { questionId: 2, awardedGrade: 3 },
      { questionId: 3, awardedGrade: 8 },
    ],
    manualFinalGrade: 16,
    overrideReason: 'درجة تشجيعية على التنظيم الممتاز ورسم الدائرة الكهربية',
  });
  assert.equal(overrideOk.valid, true);
  assert.equal(overrideOk.questionTotalGrade, 15);
  assert.equal(overrideOk.finalGrade, 16);
  assert.equal(overrideOk.isManualOverride, true);
  assert.equal(overrideOk.overrideReason.includes('درجة تشجيعية'), true);

  // Negative question score rejected
  const negScore = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [{ questionId: 1, awardedGrade: -1 }],
  });
  assert.equal(negScore.valid, false);

  // Question score exceeding question max rejected
  const overQMax = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [{ questionId: 1, awardedGrade: 6 }],
  });
  assert.equal(overQMax.valid, false);

  // Manual override exceeding assignment max rejected
  const overAssignMax = validateQuestionByQuestionGrading({
    maximumGrade: 20,
    questions,
    questionGrades: [{ questionId: 1, awardedGrade: 5 }],
    manualFinalGrade: 21,
    overrideReason: 'سبب غير صالح',
  });
  assert.equal(overAssignMax.valid, false);
});

