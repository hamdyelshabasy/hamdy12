import type {
  AdminExamListItem,
  AdminExamQuestion,
  ExamAssignmentScope,
  ExamType,
} from './exams.ts';

export type WizardAutosaveStatus = 'IDLE' | 'UNSAVED' | 'SAVING' | 'SAVED' | 'ERROR';

export interface ExamWizardDraftSummary {
  id: number;
  titleAr: string;
  trackId: number | null;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  examType: ExamType | string;
  questionCount: number;
  calculatedMarks: number;
  totalMarks: number;
  durationMin: number;
  updatedAt: string;
  createdAt: string;
}

export interface ExamWizardValidationIssue {
  code:
    | 'MISSING_TITLE'
    | 'MISSING_GRADE'
    | 'NO_QUESTIONS'
    | 'MISSING_CORRECT_CHOICE'
    | 'INVALID_CHOICES_COUNT'
    | 'MISSING_NUMERIC_ANSWER'
    | 'INVALID_TOTAL_MARKS'
    | 'MARKS_MISMATCH'
    | 'INVALID_DATE_RANGE'
    | 'MISSING_TARGET_GROUPS'
    | 'MISSING_TARGET_STUDENTS'
    | 'DUPLICATE_BANK_QUESTIONS'
    | 'UNSAVED_CHANGES'
    | 'INVALID_DURATION'
    | 'INVALID_PASS_PERCENT'
    | 'INVALID_MAX_ATTEMPTS';
  severity: 'error' | 'warning';
  step: 1 | 2 | 3 | 4;
  messageAr: string;
  questionNumber?: number;
}

export interface ExamWizardValidationResult {
  isReadyToPublish: boolean;
  errors: ExamWizardValidationIssue[];
  warnings: ExamWizardValidationIssue[];
  calculatedMarks: number;
  bankQuestionsCount: number;
  manualQuestionsCount: number;
  duplicateBankQuestionIds: number[];
}

export interface ExamWizardDraftPayload {
  clientDraftKey?: string;
  expectedUpdatedAt?: string | null;
  titleAr: string;
  descriptionAr: string;
  instructionsAr: string;
  trackId: number | null;
  gradeId: number;
  unitId: number | null;
  lessonId: number | null;
  courseId: number | null;
  requiredVideoId: number | null;
  examType: ExamType;
  totalMarks: number;
  durationMin: number;
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
  assignmentScope: ExamAssignmentScope;
  assignedGroupIds: number[];
  assignedStudentIds: number[];
}

export interface ExamWizardDraftResponse {
  exam: AdminExamListItem & { updatedAt?: string };
  versionToken: string;
  savedAtIso: string;
  calculatedMarks: number;
  questionCount: number;
  distribution: Record<string, number>;
  questions: AdminExamQuestion[];
}

export interface SmartExamWizardTransferPayload {
  titleAr: string;
  trackId: number;
  gradeId: number;
  unitIds: number[];
  lessonIds: number[];
  examType: ExamType;
  durationMin: number;
  passScorePercent: number;
  questions: Array<{
    bankQuestionId: number;
    points: number;
  }>;
}
