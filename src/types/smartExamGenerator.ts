import type { ExamType, QuestionType } from './exams.ts';
import type { QuestionDifficulty } from './questionBank.ts';

export type DistributionMode = 'AUTO' | 'COUNT' | 'PERCENT';

export interface DifficultyDistributionInput {
  mode: DistributionMode;
  easy: number;
  medium: number;
  hard: number;
}

export interface UnitDistributionItem {
  unitId: number;
  value: number;
}

export interface SmartExamBlueprint {
  titleAr?: string;
  examType: ExamType;
  trackId: number;
  gradeId: number;
  unitIds: number[];
  lessonIds: number[];
  questionTypes: QuestionType[];
  totalQuestions: number;
  durationMin: number;
  scoreMode: 'BANK_DEFAULT' | 'TARGET_TOTAL';
  targetTotalScore?: number | null;
  difficultyDistribution: DifficultyDistributionInput;
  unitDistributionMode: DistributionMode;
  unitDistribution: UnitDistributionItem[];
  excludePreviouslyUsed: boolean;
  excludeExamIds?: number[];
  seed?: number;
}

export interface SmartExamShortage {
  code: 'TOTAL' | 'DIFFICULTY' | 'UNIT' | 'COMBINED';
  messageAr: string;
  available: number;
  requested: number;
  difficulty?: QuestionDifficulty;
  unitId?: number;
}

export interface SmartExamAdjustmentSuggestion {
  code:
    | 'REDUCE_TOTAL'
    | 'ADJUST_DIFFICULTY'
    | 'RELAX_EXCLUDE_USED'
    | 'EXPAND_UNITS'
    | 'EXPAND_QUESTION_TYPES'
    | 'AUTO_UNIT_DISTRIBUTION';
  labelAr: string;
  descriptionAr: string;
  patch: Partial<SmartExamBlueprint>;
}

export interface SmartExamPreviewAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  displayOrder: number;
  previewUrl: string;
}

export interface SmartExamPreviewChoice {
  id: number;
  labelAr: string;
  latexFormula?: string | null;
  isCorrect: boolean;
  sortOrder: number;
}

export interface SmartExamPreviewQuestion {
  bankQuestionId: number;
  bankCode: string | null;
  sortOrder: number;
  trackId: number | null;
  gradeId: number | null;
  unitId: number | null;
  unitNameAr: string | null;
  lessonId: number | null;
  lessonNameAr: string | null;
  topicAr: string | null;
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  promptAr: string;
  latexFormula: string | null;
  imageUrl: string | null;
  questionImages: SmartExamPreviewAttachment[];
  points: number;
  defaultBankPoints: number;
  usedPreviously: boolean;
  choices: SmartExamPreviewChoice[];
  hasModelAnswer: boolean;
}

export interface SmartExamDistributionSummary {
  totalQuestions: number;
  totalMarks: number;
  durationMin: number;
  byDifficulty: Record<QuestionDifficulty, number>;
  byUnit: Array<{ unitId: number | null; unitNameAr: string; count: number }>;
  byQuestionType: Record<string, number>;
}

export interface SmartExamReplacementCandidate extends SmartExamPreviewQuestion {
  matchScore: number;
  matchReasonsAr: string[];
}

export interface SmartExamAvailabilityResponse {
  totalEligible: number;
  totalIncludingUsed: number;
  excludedUsedCount: number;
  byDifficulty: Record<QuestionDifficulty, number>;
  byUnit: Array<{ unitId: number | null; count: number }>;
  byQuestionType: Record<string, number>;
}

export interface SmartExamGenerateSuccessResponse {
  ok: true;
  seed: number;
  suggestedTitleAr: string;
  questions: SmartExamPreviewQuestion[];
  summary: SmartExamDistributionSummary;
}

export interface SmartExamGenerateErrorResponse {
  ok: false;
  error: string;
  shortages: SmartExamShortage[];
  suggestions: SmartExamAdjustmentSuggestion[];
  availability: SmartExamAvailabilityResponse;
}

export interface SmartExamSaveDraftPayload {
  titleAr: string;
  descriptionAr?: string;
  instructionsAr?: string;
  trackId: number;
  gradeId: number;
  unitId?: number | null;
  lessonId?: number | null;
  examType: ExamType;
  durationMin: number;
  passScorePercent?: number;
  questions: Array<{
    bankQuestionId: number;
    points: number;
  }>;
}
