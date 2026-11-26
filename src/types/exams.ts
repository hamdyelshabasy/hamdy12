export type ExamType =
  | 'LESSON_QUIZ'
  | 'UNIT_EXAM'
  | 'MONTHLY'
  | 'COMPREHENSIVE'
  | 'FINAL_SIMULATION'
  | 'HOMEWORK';

export type ExamPublicationStatus =
  | 'PUBLISHED'
  | 'DRAFT'
  | 'SCHEDULED'
  | 'HIDDEN'
  | 'ARCHIVED';

export type ExamAssignmentScope = 'GRADE' | 'GROUP' | 'STUDENTS';

export type QuestionType =
  | 'MCQ'
  | 'TRUE_FALSE'
  | 'NUMERIC'
  | 'SHORT_ANSWER'
  | 'ESSAY'
  | 'IMAGE_DIAGRAM'
  | 'PHYSICS_PROBLEM'
  | 'FILE_UPLOAD';

export const EXAM_TYPE_LABELS: Record<string, string> = {
  LESSON_QUIZ: 'اختبار درس',
  UNIT_EXAM: 'امتحان وحدة',
  MONTHLY: 'امتحان شهري',
  COMPREHENSIVE: 'امتحان شامل',
  FINAL_SIMULATION: 'امتحان نهائي تجريبي (محاكاة)',
  HOMEWORK: 'واجب تقييمي',
};

export const PUBLICATION_STATUS_LABELS: Record<string, string> = {
  PUBLISHED: 'منشور',
  DRAFT: 'مسودة',
  SCHEDULED: 'مجدول',
  HIDDEN: 'مخفي',
  ARCHIVED: 'مؤرشف',
};

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  MCQ: 'اختيار من متعدد',
  TRUE_FALSE: 'صح وخطأ',
  NUMERIC: 'مسألة فيزيائية رقمية',
  SHORT_ANSWER: 'إجابة قصيرة',
  ESSAY: 'سؤال مقالي / خطوات حل',
  IMAGE_DIAGRAM: 'سؤال مصور / رسم بياني',
  PHYSICS_PROBLEM: 'مسألة خطوات فيزيائية',
  FILE_UPLOAD: 'رفع صورة ورقة الحل',
};

export const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'لم يبدأ',
  IN_PROGRESS: 'قيد التنفيذ',
  SUBMITTED: 'تم التسليم',
  AUTO_SUBMITTED: 'تسليم تلقائي بانتهاء الوقت',
  AWAITING_MANUAL_GRADING: 'بانتظار التصحيح اليدوي',
  GRADED: 'تم التصحيح',
};

export interface AdminExamChoice {
  id?: number;
  labelAr: string;
  latexFormula?: string | null;
  isCorrect: boolean;
  sortOrder?: number;
}

export interface ExamQuestionAttachmentRef {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  displayOrder: number;
  previewUrl: string;
}

export interface AdminExamQuestion {
  linkId?: number;
  id: number;
  sourceBankQuestionId?: number | null;
  sortOrder: number;
  questionType: QuestionType | string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | string;
  promptAr: string;
  latexFormula: string | null;
  imageUrl: string | null;
  questionImages?: ExamQuestionAttachmentRef[];
  modelAnswerFiles?: ExamQuestionAttachmentRef[];
  points: number;
  negativePoints: number;
  numericAnswer: string;
  numericTolerance: string;
  numericUnit: string;
  shortAnswerRules: string[];
  modelAnswerAr: string;
  explanationAr: string;
  unitId: number | null;
  lessonId: number | null;
  choices: AdminExamChoice[];
}

export interface AdminExamListItem {
  id: number;
  trackId: number | null;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  unitId: number | null;
  unitTitleAr: string | null;
  lessonId: number | null;
  lessonTitleAr: string | null;
  courseId: number | null;
  courseTitleAr: string | null;
  requiredVideoId: number | null;
  titleAr: string;
  descriptionAr: string;
  instructionsAr: string;
  examType: ExamType | string;
  durationMin: number;
  totalMarks: number;
  calculatedMarks: number;
  questionCount: number;
  passScorePercent: number;
  startsAt: string | null;
  endsAt: string | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  allowNavigation: boolean;
  allowReviewBeforeSubmit: boolean;
  allowStudentReview: boolean;
  showResultImmediately: boolean;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
  allowNegativeMarking: boolean;
  assignmentScope: ExamAssignmentScope | string;
  publicationStatus: ExamPublicationStatus | string;
  assignedGroupIds: number[];
  assignedStudentIds: number[];
  attemptsCount: number;
  submittedCount: number;
  pendingManualCount: number;
  createdAt: string;
}

export interface StudentPhase2ExamCard {
  id: number;
  gradeId: number;
  unitId: number | null;
  unitTitleAr: string | null;
  lessonId: number | null;
  lessonTitleAr: string | null;
  titleAr: string;
  descriptionAr: string;
  instructionsAr: string;
  examType: string;
  durationMin: number;
  totalMarks: number;
  questionCount: number;
  passScorePercent: number;
  startsAt: string | null;
  endsAt: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  bucket: 'IN_PROGRESS' | 'AVAILABLE' | 'UPCOMING' | 'COMPLETED' | 'LOCKED' | 'HIDDEN';
  canStart: boolean;
  lockReasonAr: string | null;
  inProgressAttemptId: number | null;
  remainingSec: number | null;
  latestAttempt: {
    id: number;
    attemptNumber: number;
    status: string;
    resultPublished: boolean;
    totalScore: number | null;
    maxScore: number;
    passed: boolean | null;
    submittedAt: string | null;
  } | null;
}

export interface StudentMyResultItem {
  attemptId: number;
  examId: number;
  examTitleAr: string;
  examType: string;
  attemptNumber: number;
  submittedAt: string;
  status: string;
  resultPublished: boolean;
  totalMarks: number;
  studentScore: number | null;
  percent: number | null;
  passed: boolean | null;
  passScorePercent: number;
  correctCount: number | null;
  incorrectCount: number | null;
  unansweredCount: number;
  pendingManualCount: number;
  generalFeedback: string;
  canReview: boolean;
  showCorrectAnswers: boolean;
}
