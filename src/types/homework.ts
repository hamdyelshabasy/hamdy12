export type HomeworkPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'HIDDEN' | 'ARCHIVED';
export type HomeworkScope = 'GRADE' | 'GROUP' | 'STUDENTS' | 'COURSE';
export type ModelAnswerVisibilityPolicy =
  | 'HIDDEN'
  | 'AFTER_DEADLINE'
  | 'AFTER_SUBMISSION'
  | 'AFTER_GRADING'
  | 'MANUAL_RELEASE'
  | 'SCHEDULED_RELEASE';

export type StudentHomeworkStatusCode =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'LATE'
  | 'UNDER_REVIEW'
  | 'GRADED'
  | 'RETURNED_FOR_REVISION'
  | 'DEADLINE_PASSED';

export type HomeworkGradingMode = 'DIRECT' | 'RUBRIC' | 'QUESTION_BY_QUESTION';

export interface RubricCriterion {
  id: string;
  labelAr: string;
  maxPoints: number;
}

export interface RubricScoreEntry extends RubricCriterion {
  awardedPoints: number;
}

export interface HomeworkQuestionImageRef {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  displayOrder: number;
  previewUrl?: string;
}

export interface HomeworkQuestionChoice {
  id: string;
  labelAr: string;
  imageUrl?: string | null;
  isCorrect?: boolean;
  displayOrder: number;
}

export interface HomeworkStructuredAnswer {
  questionId: number;
  selectedChoiceId?: string | null;
  textAnswer?: string;
}

export interface HomeworkQuestionDefinition {
  id?: number;
  bankQuestionId?: number | null;
  bankQuestionVersion?: number | null;
  questionType?: string | null;
  questionNumber: number;
  labelAr: string;
  descriptionAr: string;
  promptSnapshotAr?: string;
  questionImages?: HomeworkQuestionImageRef[];
  choices?: HomeworkQuestionChoice[];
  modelAnswerTextSnapshot?: string;
  modelAnswerFiles?: HomeworkQuestionImageRef[];
  maxGrade: number;
  displayOrder: number;
  hasGradingRecords?: boolean;
}

export interface QuestionGradeEntry {
  questionId: number;
  questionNumber: number;
  labelAr: string;
  descriptionAr: string;
  maxGrade: number;
  awardedGrade: number;
  teacherComment: string;
}

export interface HomeworkAttachmentItem {
  id?: number;
  attachmentType: 'FILE' | 'GOOGLE_DRIVE_PDF';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey?: string | null;
  driveUrl?: string | null;
  driveFileId?: string | null;
  previewUrl?: string | null;
  viewUrl?: string | null;
  displayOrder: number;
}

export interface HomeworkModelAnswerFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  displayOrder: number;
  previewUrl?: string;
}

export interface AdminModelAnswerConfig {
  id?: number;
  titleAr: string;
  notesAr: string;
  sourceType: 'UPLOADED_FILES' | 'GOOGLE_DRIVE_PDF' | 'MIXED';
  driveUrl: string | null;
  driveFileId: string | null;
  drivePreviewUrl?: string | null;
  driveViewUrl?: string | null;
  files: HomeworkModelAnswerFile[];
  visibilityPolicy: ModelAnswerVisibilityPolicy;
  releaseAt: string | null;
  manuallyReleased: boolean;
  manuallyReleasedAt?: string | null;
}

export interface StudentModelAnswerView {
  exists: boolean;
  isReleased: boolean;
  policyLabelAr: string;
  messageAr: string;
  releaseAt?: string | null;
  titleAr?: string;
  notesAr?: string;
  drivePreviewUrl?: string | null;
  driveViewUrl?: string | null;
  files?: HomeworkModelAnswerFile[];
}

export interface SubmissionFileItem {
  id?: number;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  displayOrder: number;
  previewUrl: string;
}

export interface StudentSubmissionVersion {
  id: number;
  version: number;
  writtenAnswer: string;
  submittedAt: string | null;
  isLate: boolean;
  status: string;
  gradingMode: HomeworkGradingMode;
  awardedGrade: number | null;
  questionTotalGrade: number | null;
  isManualOverride: boolean;
  overrideReason: string;
  rubricScores: RubricScoreEntry[];
  questionGrades: QuestionGradeEntry[];
  teacherFeedback: string;
  revisionInstructions: string;
  isGradePublished: boolean;
  gradedAt: string | null;
  structuredAnswers?: HomeworkStructuredAnswer[];
  files: SubmissionFileItem[];
}

export interface HomeworkStats {
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
}

export interface AdminHomeworkListItem {
  id: number;
  titleAr: string;
  descriptionAr: string;
  instructionsAr: string;
  trackId: number;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  unitId: number | null;
  unitTitleAr: string | null;
  lessonId: number | null;
  lessonTitleAr: string | null;
  videoId: number | null;
  videoTitleAr: string | null;
  courseId: number | null;
  courseTitleAr: string | null;
  maximumGrade: number;
  assignmentScope: HomeworkScope;
  publicationStatus: HomeworkPublicationStatus;
  publishedAt: string | null;
  deadline: string | null;
  allowLateSubmission: boolean;
  allowResubmission: boolean;
  maximumSubmissions: number;
  allowReopenAfterGrading: boolean;
  attachmentsCount: number;
  hasModelAnswer: boolean;
  modelAnswerPolicy: ModelAnswerVisibilityPolicy | null;
  modelAnswerManuallyReleased: boolean;
  stats: HomeworkStats;
  createdAt: string;
  updatedAt: string;
}

export interface AdminHomeworkDetail extends AdminHomeworkListItem {
  rubric: RubricCriterion[];
  questions: HomeworkQuestionDefinition[];
  targetStudentIds: number[];
  targetGroupIds: number[];
  attachments: HomeworkAttachmentItem[];
  modelAnswer: AdminModelAnswerConfig | null;
}

export interface AdminSubmissionRow {
  studentId: number;
  studentName: string;
  studentPhone: string | null;
  trackNameAr: string;
  gradeNameAr: string;
  hasSubmitted: boolean;
  latestSubmissionId: number | null;
  latestVersion: number;
  versionsCount: number;
  attachmentsCount: number;
  submittedAt: string | null;
  isLate: boolean;
  status: string;
  statusLabelAr: string;
  awardedGrade: number | null;
  isGradePublished: boolean;
  teacherFeedback: string;
}

export interface StudentHomeworkCardItem {
  id: number;
  titleAr: string;
  descriptionAr: string;
  trackId: number;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  unitId: number | null;
  unitTitleAr: string | null;
  lessonId: number | null;
  lessonTitleAr: string | null;
  videoId: number | null;
  videoTitleAr: string | null;
  courseId: number | null;
  courseTitleAr: string | null;
  maximumGrade: number;
  deadline: string | null;
  allowLateSubmission: boolean;
  allowResubmission: boolean;
  maximumSubmissions: number;
  statusCode: StudentHomeworkStatusCode;
  statusLabelAr: string;
  canSubmit: boolean;
  canSubmitReasonAr: string | null;
  submittedVersionsCount: number;
  latestSubmittedAt: string | null;
  awardedGrade: number | null;
  percentage: number | null;
  hasModelAnswer: boolean;
  isModelAnswerReleased: boolean;
}

export interface StudentHomeworkDetailResponse {
  serverNow: string;
  assignment: StudentHomeworkCardItem & {
    instructionsAr: string;
    rubric: RubricCriterion[];
    questions: HomeworkQuestionDefinition[];
    allowReopenAfterGrading: boolean;
    attachments: HomeworkAttachmentItem[];
  };
  submissionPermission: {
    canSubmit: boolean;
    isLate: boolean;
    nextVersion: number;
    reasonAr?: string;
  };
  submissions: StudentSubmissionVersion[];
  modelAnswer: StudentModelAnswerView;
}
