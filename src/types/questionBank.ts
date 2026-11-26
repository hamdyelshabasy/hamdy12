import type { AdminExamChoice, QuestionType } from './exams.ts';

export type QuestionApprovalStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'RETURNED'
  | 'ARCHIVED';

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type QuestionAttachmentRole =
  | 'QUESTION_IMAGE'
  | 'MODEL_ANSWER_IMAGE'
  | 'MODEL_ANSWER_PDF';

export const APPROVAL_STATUS_LABELS: Record<QuestionApprovalStatus, string> = {
  DRAFT: 'مسودة',
  PENDING_REVIEW: 'بانتظار مراجعة الأستاذ',
  APPROVED: 'معتمد وجاهز للاستخدام',
  RETURNED: 'مُعاد للتعديل',
  ARCHIVED: 'مؤرشف',
};

export const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  EASY: 'سهل',
  MEDIUM: 'متوسط',
  HARD: 'متقدم / صعب',
};

export interface QuestionBankAttachment {
  id?: number;
  attachmentRole: QuestionAttachmentRole;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  captionAr?: string;
  displayOrder: number;
  previewUrl?: string;
}

export interface QuestionBankRevisionItem {
  id: number;
  version: number;
  changedById: number | null;
  changedByName: string;
  action: string;
  noteAr: string;
  createdAt: string;
}

export interface QuestionBankListItem {
  id: number;
  bankCode: string;
  trackId: number | null;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  unitId: number | null;
  unitTitleAr: string | null;
  lessonId: number | null;
  lessonTitleAr: string | null;
  topicAr: string;
  questionType: QuestionType | string;
  difficulty: QuestionDifficulty | string;
  promptAr: string;
  latexFormula: string | null;
  imageUrl: string | null;
  points: number;
  sourceAr: string;
  tags: string[];
  approvalStatus: QuestionApprovalStatus;
  reviewFeedbackAr: string;
  isArchived: boolean;
  version: number;
  createdById: number | null;
  createdByName: string;
  reviewedById: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  questionImages: QuestionBankAttachment[];
  modelAnswerFilesCount: number;
  hasModelAnswerText: boolean;
  hasModelAnswer: boolean;
  examsUsageCount: number;
  homeworkUsageCount: number;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBankDetail extends QuestionBankListItem {
  negativePoints: number;
  numericAnswer: string;
  numericTolerance: string;
  numericUnit: string;
  shortAnswerRules: string[];
  modelAnswerAr: string;
  explanationAr: string;
  teacherNotesAr: string;
  choices: AdminExamChoice[];
  modelAnswerFiles: QuestionBankAttachment[];
  revisions: QuestionBankRevisionItem[];
}

export interface QuestionBankStats {
  total: number;
  draft: number;
  pendingReview: number;
  approved: number;
  returned: number;
  archived: number;
  withImages: number;
  withModelAnswer: number;
  myContributions: number;
}

export interface UploadedBankFileResponse {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  previewUrl: string;
  duplicateWarning: {
    isDuplicate: boolean;
    matchCount: number;
    sampleQuestionIds: number[];
    messageAr: string;
  } | null;
}
