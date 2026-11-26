import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  FilePlus2,
  Image as ImageIcon,
  Library,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../../lib/api.ts';
import {
  EXAM_TYPE_LABELS,
  QUESTION_TYPE_LABELS,
  type AdminExamQuestion,
  type ExamAssignmentScope,
  type ExamType,
} from '../../../types/exams.ts';
import { DIFFICULTY_LABELS, type QuestionBankListItem, type QuestionDifficulty } from '../../../types/questionBank.ts';
import type {
  ExamWizardDraftPayload,
  ExamWizardDraftResponse,
  ExamWizardDraftSummary,
  SmartExamWizardTransferPayload,
  WizardAutosaveStatus,
} from '../../../types/examWizard.ts';
import {
  summarizeWizardQuestions,
  validateExamWizardDraft,
  validateExamWizardSettings,
  validateExamWizardStep1,
} from '../../../server/domain/examWizard.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import { QuestionBankPickerModal } from '../questionBank/QuestionBankPickerModal.tsx';
import { SmartExamGeneratorModal } from './SmartExamGeneratorModal.tsx';
import { AdminExamQuestionBuilder } from './AdminExamQuestionBuilder.tsx';
import { MathFormula } from '../../MathFormula.tsx';

// Only a lightweight numeric draft pointer is stored in sessionStorage — NEVER unpublished questions or answer keys.
const WIZARD_DRAFT_POINTER_KEY = 'physics_lms_exam_wizard_draft_id';

interface ExamCreationWizardProps {
  catalog: AdminCatalogData;
  groups: Array<{ id: number; gradeId: number; nameAr: string; memberCount: number }>;
  approvedStudents: Array<{ id: number; fullName: string; phone: string | null; gradeId: number }>;
  initialDraftExamId?: number | null;
  onExit: (refreshList?: boolean) => void;
  onToast: (msg: string) => void;
}

interface WizardFormState {
  titleAr: string;
  descriptionAr: string;
  instructionsAr: string;
  trackId: number;
  gradeId: number;
  unitId: number;
  lessonId: number;
  courseId: number;
  requiredVideoId: number;
  examType: ExamType;
  totalMarks: number;
  durationMin: number;
  passScorePercent: number;
  startsAt: string;
  endsAt: string;
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

const WIZARD_STEPS: Array<{ step: 1 | 2 | 3 | 4 | 5; labelAr: string; shortAr: string }> = [
  { step: 1, labelAr: 'بيانات الامتحان', shortAr: 'البيانات' },
  { step: 2, labelAr: 'اختيار الأسئلة', shortAr: 'الأسئلة' },
  { step: 3, labelAr: 'إعدادات الامتحان', shortAr: 'الإعدادات' },
  { step: 4, labelAr: 'معاينة الامتحان', shortAr: 'المعاينة' },
  { step: 5, labelAr: 'حفظ الامتحان', shortAr: 'الحفظ' },
];

const DEFAULT_INSTRUCTIONS_AR =
  'اقرأ كل سؤال بعناية قبل الإجابة. يتم حفظ إجاباتك تلقائيًا أثناء الحل، ويُسلّم الامتحان تلقائيًا فور انتهاء الوقت المحدد.';

function generateClientDraftKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wiz-${crypto.randomUUID()}`;
  }
  return `wiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCairoShortTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function createInitialForm(catalog: AdminCatalogData): WizardFormState {
  const defaultTrackId = catalog.tracks[0]?.id || 0;
  const defaultGradeId =
    catalog.grades.find((g) => g.trackId === defaultTrackId)?.id || catalog.grades[0]?.id || 0;
  return {
    titleAr: '',
    descriptionAr: '',
    instructionsAr: DEFAULT_INSTRUCTIONS_AR,
    trackId: defaultTrackId,
    gradeId: defaultGradeId,
    unitId: 0,
    lessonId: 0,
    courseId: 0,
    requiredVideoId: 0,
    examType: 'LESSON_QUIZ',
    totalMarks: 0,
    durationMin: 30,
    passScorePercent: 60,
    startsAt: '',
    endsAt: '',
    maxAttempts: 2,
    shuffleQuestions: false,
    shuffleChoices: false,
    allowNavigation: true,
    allowReviewBeforeSubmit: true,
    allowStudentReview: true,
    showResultImmediately: true,
    showCorrectAnswers: true,
    showExplanations: true,
    allowNegativeMarking: false,
    assignmentScope: 'GRADE',
    assignedGroupIds: [],
    assignedStudentIds: [],
  };
}

function readStoredDraftPointer(): number | null {
  try {
    const raw = sessionStorage.getItem(WIZARD_DRAFT_POINTER_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredDraftPointer(examId: number | null) {
  try {
    if (examId && examId > 0) {
      sessionStorage.setItem(WIZARD_DRAFT_POINTER_KEY, String(examId));
    } else {
      sessionStorage.removeItem(WIZARD_DRAFT_POINTER_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export const ExamCreationWizard: React.FC<ExamCreationWizardProps> = ({
  catalog,
  groups,
  approvedStudents,
  initialDraftExamId,
  onExit,
  onToast,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [form, setForm] = useState<WizardFormState>(() => createInitialForm(catalog));
  const [draftExamId, setDraftExamId] = useState<number | null>(initialDraftExamId ?? null);
  const [versionToken, setVersionToken] = useState<string | null>(null);
  const [questions, setQuestions] = useState<AdminExamQuestion[]>([]);
  const [distribution, setDistribution] = useState<Record<string, number>>({});
  const [autosaveStatus, setAutosaveStatus] = useState<WizardAutosaveStatus>('IDLE');
  const [lastSavedAtIso, setLastSavedAtIso] = useState<string | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string>('');
  const [conflictDetected, setConflictDetected] = useState(false);

  // Resumable drafts recovery
  const [resumableDrafts, setResumableDrafts] = useState<ExamWizardDraftSummary[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [resumingDraftId, setResumingDraftId] = useState<number | null>(null);
  const [recoveryCandidateId, setRecoveryCandidateId] = useState<number | null>(null);

  // Step 2 modals & inline states
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [smartGenOpen, setSmartGenOpen] = useState(false);
  const [manualBuilderOpen, setManualBuilderOpen] = useState(false);
  const [busyQuestionOp, setBusyQuestionOp] = useState(false);
  const [pointsDraftMap, setPointsDraftMap] = useState<Record<number, string>>({});
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Step 4 preview tab (Student View default vs Teacher-only Answer Key review)
  const [previewMode, setPreviewMode] = useState<'student' | 'teacher_key'>('student');

  // Step 5 explicit publish confirmation & leave guard modals
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [syncMarksOnPublish, setSyncMarksOnPublish] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // Refs for stable autosave serialization & idempotency
  const clientDraftKeyRef = useRef<string>(generateClientDraftKey());
  const isHydratingRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(false);
  const savingInFlightRef = useRef<boolean>(false);
  const pendingResaveRef = useRef<boolean>(false);
  const formRef = useRef<WizardFormState>(form);
  const draftExamIdRef = useRef<number | null>(draftExamId);
  const versionTokenRef = useRef<string | null>(versionToken);

  formRef.current = form;
  draftExamIdRef.current = draftExamId;
  versionTokenRef.current = versionToken;

  const hydrateFromDraftResponse = useCallback(
    (res: ExamWizardDraftResponse, showNotice?: boolean) => {
      isHydratingRef.current = true;
      const ex = res.exam;
      const defaultTrack = catalog.tracks[0]?.id || 0;
      const nextForm: WizardFormState = {
        titleAr: ex.titleAr,
        descriptionAr: ex.descriptionAr || '',
        instructionsAr: ex.instructionsAr || DEFAULT_INSTRUCTIONS_AR,
        trackId: ex.trackId || defaultTrack,
        gradeId: ex.gradeId,
        unitId: ex.unitId || 0,
        lessonId: ex.lessonId || 0,
        courseId: ex.courseId || 0,
        requiredVideoId: ex.requiredVideoId || 0,
        examType: (ex.examType as ExamType) || 'LESSON_QUIZ',
        totalMarks: Number(ex.totalMarks || 0),
        durationMin: ex.durationMin,
        passScorePercent: ex.passScorePercent,
        startsAt: toDateTimeLocal(ex.startsAt),
        endsAt: toDateTimeLocal(ex.endsAt),
        maxAttempts: ex.maxAttempts,
        shuffleQuestions: ex.shuffleQuestions,
        shuffleChoices: ex.shuffleChoices,
        allowNavigation: ex.allowNavigation,
        allowReviewBeforeSubmit: ex.allowReviewBeforeSubmit,
        allowStudentReview: ex.allowStudentReview,
        showResultImmediately: ex.showResultImmediately,
        showCorrectAnswers: ex.showCorrectAnswers,
        showExplanations: ex.showExplanations,
        allowNegativeMarking: ex.allowNegativeMarking,
        assignmentScope: (ex.assignmentScope as ExamAssignmentScope) || 'GRADE',
        assignedGroupIds: ex.assignedGroupIds || [],
        assignedStudentIds: ex.assignedStudentIds || [],
      };
      setForm(nextForm);
      setDraftExamId(ex.id);
      setVersionToken(res.versionToken);
      setQuestions(res.questions || []);
      setDistribution(res.distribution || {});
      setLastSavedAtIso(res.savedAtIso);
      setAutosaveStatus('SAVED');
      setSaveErrorMsg('');
      setConflictDetected(false);
      dirtyRef.current = false;
      writeStoredDraftPointer(ex.id);

      const ptsMap: Record<number, string> = {};
      for (const q of res.questions || []) {
        ptsMap[q.id] = String(q.points);
      }
      setPointsDraftMap(ptsMap);

      if (showNotice) {
        onToast(`تم استئناف المسودة «${ex.titleAr}» بنجاح.`);
      }
      window.setTimeout(() => {
        isHydratingRef.current = false;
      }, 60);
    },
    [catalog.tracks, onToast],
  );

  const loadDraftById = useCallback(
    async (examId: number, showNotice = false): Promise<boolean> => {
      setResumingDraftId(examId);
      try {
        const res = await apiRequest<ExamWizardDraftResponse>(
          `/api/admin/phase2-exams/wizard/draft/${examId}`,
        );
        hydrateFromDraftResponse(res, showNotice);
        setRecoveryCandidateId(null);
        return true;
      } catch (err) {
        if (readStoredDraftPointer() === examId) {
          writeStoredDraftPointer(null);
        }
        onToast((err as Error).message || 'تعذر تحميل المسودة.');
        return false;
      } finally {
        setResumingDraftId(null);
      }
    },
    [hydrateFromDraftResponse, onToast],
  );

  // Refresh only questions + versionToken after question mutations via existing endpoints
  const refreshDraftQuestions = useCallback(
    async (examId: number) => {
      const res = await apiRequest<ExamWizardDraftResponse>(
        `/api/admin/phase2-exams/wizard/draft/${examId}`,
      );
      setQuestions(res.questions || []);
      setDistribution(res.distribution || {});
      setVersionToken(res.versionToken);
      setLastSavedAtIso(res.savedAtIso);
      const ptsMap: Record<number, string> = {};
      for (const q of res.questions || []) {
        ptsMap[q.id] = String(q.points);
      }
      setPointsDraftMap(ptsMap);
      // If totalMarks is still 0, gently sync it to calculatedMarks without marking dirty conflict
      if (formRef.current.totalMarks <= 0 && res.calculatedMarks > 0) {
        setForm((prev) => ({ ...prev, totalMarks: res.calculatedMarks }));
        dirtyRef.current = true;
      }
    },
    [],
  );

  // Initial load: fetch resumable drafts + handle initialDraftExamId or sessionStorage draft recovery
  useEffect(() => {
    let cancelled = false;
    setLoadingDrafts(true);
    apiRequest<{ drafts: ExamWizardDraftSummary[] }>('/api/admin/phase2-exams/wizard/drafts')
      .then(async (res) => {
        if (cancelled) return;
        const drafts = res.drafts || [];
        setResumableDrafts(drafts);

        if (initialDraftExamId && initialDraftExamId > 0) {
          await loadDraftById(initialDraftExamId, false);
          return;
        }

        const storedPointer = readStoredDraftPointer();
        if (storedPointer && drafts.some((d) => d.id === storedPointer)) {
          setRecoveryCandidateId(storedPointer);
        } else if (storedPointer) {
          writeStoredDraftPointer(null);
        }
      })
      .catch(() => {
        if (!cancelled) setResumableDrafts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDrafts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialDraftExamId, loadDraftById]);

  const buildDraftPayload = useCallback((f: WizardFormState): ExamWizardDraftPayload => {
    return {
      clientDraftKey: clientDraftKeyRef.current,
      expectedUpdatedAt: versionTokenRef.current,
      titleAr: f.titleAr.trim(),
      descriptionAr: f.descriptionAr,
      instructionsAr: f.instructionsAr,
      trackId: f.trackId || null,
      gradeId: f.gradeId,
      unitId: f.unitId || null,
      lessonId: f.lessonId || null,
      courseId: f.courseId || null,
      requiredVideoId: f.requiredVideoId || null,
      examType: f.examType,
      totalMarks: Number.isFinite(f.totalMarks) ? Math.max(0, f.totalMarks) : 0,
      durationMin: Number.isFinite(f.durationMin) ? Math.max(1, Math.min(360, f.durationMin)) : 30,
      passScorePercent: Number.isFinite(f.passScorePercent)
        ? Math.max(1, Math.min(100, f.passScorePercent))
        : 60,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      maxAttempts: Number.isFinite(f.maxAttempts) ? Math.max(1, Math.min(50, f.maxAttempts)) : 2,
      shuffleQuestions: f.shuffleQuestions,
      shuffleChoices: f.shuffleChoices,
      allowNavigation: f.allowNavigation,
      allowReviewBeforeSubmit: f.allowReviewBeforeSubmit,
      allowStudentReview: f.allowStudentReview,
      showResultImmediately: f.showResultImmediately,
      showCorrectAnswers: f.showCorrectAnswers,
      showExplanations: f.showExplanations,
      allowNegativeMarking: f.allowNegativeMarking,
      assignmentScope: f.assignmentScope,
      assignedGroupIds: f.assignedGroupIds,
      assignedStudentIds: f.assignedStudentIds,
    };
  }, []);

  // Serialized server-backed draft save (create idempotently on first save, PUT with optimistic concurrency thereafter)
  const persistDraftNow = useCallback(
    async (options?: { silent?: boolean }): Promise<number | null> => {
      const currentForm = formRef.current;
      const step1Check = validateExamWizardStep1({
        titleAr: currentForm.titleAr,
        gradeId: currentForm.gradeId,
      });
      if (!step1Check.valid) {
        if (!options?.silent) {
          onToast(step1Check.errors[0]);
        }
        return null;
      }

      // Check date range before sending autosave
      if (currentForm.startsAt && currentForm.endsAt) {
        const s = new Date(currentForm.startsAt).getTime();
        const e = new Date(currentForm.endsAt).getTime();
        if (!Number.isNaN(s) && !Number.isNaN(e) && e <= s) {
          if (!options?.silent) {
            onToast('يجب أن يكون موعد انتهاء الامتحان بعد موعد البدء.');
          }
          return null;
        }
      }

      if (savingInFlightRef.current) {
        pendingResaveRef.current = true;
        return draftExamIdRef.current;
      }

      savingInFlightRef.current = true;
      setAutosaveStatus('SAVING');
      setSaveErrorMsg('');

      try {
        const payload = buildDraftPayload(currentForm);
        const existingId = draftExamIdRef.current;
        let res: ExamWizardDraftResponse;

        if (!existingId) {
          res = await apiRequest<ExamWizardDraftResponse>('/api/admin/phase2-exams/wizard/draft', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setDraftExamId(res.exam.id);
          draftExamIdRef.current = res.exam.id;
          writeStoredDraftPointer(res.exam.id);
        } else {
          res = await apiRequest<ExamWizardDraftResponse>(
            `/api/admin/phase2-exams/wizard/draft/${existingId}`,
            {
              method: 'PUT',
              body: JSON.stringify(payload),
            },
          );
        }

        setVersionToken(res.versionToken);
        versionTokenRef.current = res.versionToken;
        setLastSavedAtIso(res.savedAtIso);
        setConflictDetected(false);
        dirtyRef.current = false;
        setAutosaveStatus('SAVED');

        return res.exam.id;
      } catch (err) {
        const msg = (err as Error).message || 'تعذر حفظ المسودة.';
        setAutosaveStatus('ERROR');
        setSaveErrorMsg(msg);
        if (msg.includes('جلسة أخرى') || msg.includes('نافذة')) {
          setConflictDetected(true);
        }
        if (!options?.silent) {
          onToast(msg);
        }
        return null;
      } finally {
        savingInFlightRef.current = false;
        if (pendingResaveRef.current) {
          pendingResaveRef.current = false;
          void persistDraftNow({ silent: true });
        }
      }
    },
    [buildDraftPayload, onToast],
  );

  // Debounced autosave whenever form changes (only once title >= 3 chars & gradeId selected)
  useEffect(() => {
    if (isHydratingRef.current || conflictDetected) return;
    const step1Check = validateExamWizardStep1({
      titleAr: form.titleAr,
      gradeId: form.gradeId,
    });
    if (!step1Check.valid) return;
    if (!dirtyRef.current) return;

    setAutosaveStatus((prev) => (prev === 'SAVING' ? prev : 'UNSAVED'));
    const timer = window.setTimeout(() => {
      if (dirtyRef.current && !conflictDetected) {
        void persistDraftNow({ silent: true });
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [form, conflictDetected, persistDraftNow]);

  // Warn before closing/reloading browser tab if unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || autosaveStatus === 'UNSAVED' || autosaveStatus === 'ERROR') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autosaveStatus]);

  const updateForm = <K extends keyof WizardFormState>(patch: Partial<WizardFormState>) => {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, ...patch }));
  };

  // Derived catalog filters
  const formGrades = useMemo(
    () => catalog.grades.filter((g) => !form.trackId || g.trackId === form.trackId),
    [catalog.grades, form.trackId],
  );
  const formUnits = useMemo(
    () => catalog.units.filter((u) => u.gradeId === form.gradeId),
    [catalog.units, form.gradeId],
  );
  const formLessons = useMemo(
    () =>
      catalog.lessons.filter((l) =>
        form.unitId ? l.unitId === form.unitId : formUnits.some((u) => u.id === l.unitId),
      ),
    [catalog.lessons, form.unitId, formUnits],
  );
  const formCourses = useMemo(
    () => catalog.courses.filter((c) => c.gradeId === form.gradeId),
    [catalog.courses, form.gradeId],
  );
  const formVideos = useMemo(
    () => catalog.videos.filter((v) => v.gradeId === form.gradeId),
    [catalog.videos, form.gradeId],
  );
  const formGroups = useMemo(
    () => groups.filter((g) => g.gradeId === form.gradeId),
    [groups, form.gradeId],
  );
  const formStudents = useMemo(
    () => approvedStudents.filter((s) => s.gradeId === form.gradeId),
    [approvedStudents, form.gradeId],
  );

  // Live summaries & shared validation
  const questionSummary = useMemo(() => summarizeWizardQuestions(questions), [questions]);
  const step1Validation = useMemo(
    () => validateExamWizardStep1({ titleAr: form.titleAr, gradeId: form.gradeId }),
    [form.titleAr, form.gradeId],
  );
  const step3Validation = useMemo(
    () =>
      validateExamWizardSettings({
        durationMin: form.durationMin,
        totalMarks: form.totalMarks,
        passScorePercent: form.passScorePercent,
        maxAttempts: form.maxAttempts,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        assignmentScope: form.assignmentScope,
        assignedGroupIds: form.assignedGroupIds,
        assignedStudentIds: form.assignedStudentIds,
      }),
    [form],
  );

  const fullValidation = useMemo(
    () =>
      validateExamWizardDraft(
        {
          titleAr: form.titleAr,
          gradeId: form.gradeId,
          durationMin: form.durationMin,
          totalMarks: form.totalMarks,
          passScorePercent: form.passScorePercent,
          maxAttempts: form.maxAttempts,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          assignmentScope: form.assignmentScope,
          assignedGroupIds: form.assignedGroupIds,
          assignedStudentIds: form.assignedStudentIds,
        },
        questions,
        { hasUnsavedChanges: dirtyRef.current || autosaveStatus === 'UNSAVED' },
      ),
    [form, questions, autosaveStatus],
  );

  const selectedTrackName =
    catalog.tracks.find((t) => t.id === form.trackId)?.nameAr || '—';
  const selectedGradeName =
    catalog.grades.find((g) => g.id === form.gradeId)?.nameAr || '—';
  const selectedUnitName =
    catalog.units.find((u) => u.id === form.unitId)?.titleAr || 'كل الوحدات';
  const selectedLessonName =
    catalog.lessons.find((l) => l.id === form.lessonId)?.titleAr || 'غير محدد';

  // Step navigation with automatic server draft creation / flush
  const handleGoToStep = async (targetStep: 1 | 2 | 3 | 4 | 5) => {
    if (targetStep > 1 && !step1Validation.valid) {
      onToast(step1Validation.errors[0]);
      setStep(1);
      return;
    }
    if (targetStep > 1 && !draftExamIdRef.current) {
      const createdId = await persistDraftNow();
      if (!createdId) return;
    } else if (dirtyRef.current && !conflictDetected) {
      await persistDraftNow({ silent: true });
    }
    setStep(targetStep);
  };

  // Ensure draft exists before any question action
  const ensureDraftExamId = async (): Promise<number | null> => {
    if (draftExamIdRef.current) return draftExamIdRef.current;
    return await persistDraftNow();
  };

  // Option A: Add approved questions from Central Question Bank
  const handleAddFromBank = async (selected: QuestionBankListItem[]) => {
    if (selected.length === 0) return;
    const examId = await ensureDraftExamId();
    if (!examId) return;

    setBusyQuestionOp(true);
    try {
      const res = await apiRequest<{ message: string; calculatedMarks: number }>(
        `/api/admin/phase2-exams/${examId}/questions/from-bank`,
        {
          method: 'POST',
          body: JSON.stringify({
            items: selected.map((q) => ({
              bankQuestionId: q.id,
              pointsOverride: Math.max(1, Number(q.points) || 2),
            })),
          }),
        },
      );
      await refreshDraftQuestions(examId);
      onToast(res.message);
    } catch (err) {
      onToast((err as Error).message || 'تعذر إضافة الأسئلة من بنك الأسئلة.');
    } finally {
      setBusyQuestionOp(false);
    }
  };

  // Option B: Transfer generated questions from Smart Exam Generator into this wizard draft
  const handleSmartGeneratorTransfer = async (payload: SmartExamWizardTransferPayload) => {
    const examId = await ensureDraftExamId();
    if (!examId || payload.questions.length === 0) return;

    setBusyQuestionOp(true);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/phase2-exams/${examId}/questions/from-bank`,
        {
          method: 'POST',
          body: JSON.stringify({
            items: payload.questions.map((q) => ({
              bankQuestionId: q.bankQuestionId,
              pointsOverride: Math.max(1, Number(q.points) || 1),
            })),
          }),
        },
      );
      await refreshDraftQuestions(examId);
      onToast(`تم نقل ${payload.questions.length} سؤال من المولّد الذكي إلى مسودة الامتحان بنجاح.`);
      if (!res.message) {
        // no-op
      }
    } catch (err) {
      onToast((err as Error).message || 'تعذر نقل أسئلة المولّد الذكي إلى المسودة.');
    } finally {
      setBusyQuestionOp(false);
    }
  };

  // Question reorder
  const handleReorderQuestion = async (index: number, direction: -1 | 1) => {
    const examId = draftExamIdRef.current;
    if (!examId) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= questions.length) return;

    const reordered = [...questions];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, moved);

    setBusyQuestionOp(true);
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/questions/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedQuestionIds: reordered.map((q) => q.id) }),
      });
      await refreshDraftQuestions(examId);
    } catch (err) {
      onToast((err as Error).message || 'تعذر إعادة ترتيب الأسئلة.');
    } finally {
      setBusyQuestionOp(false);
    }
  };

  // Update exam-specific marks for a single question (never mutates master bank question)
  const handleCommitQuestionPoints = async (questionId: number) => {
    const examId = draftExamIdRef.current;
    if (!examId) return;
    const raw = Number(pointsDraftMap[questionId]);
    if (!Number.isFinite(raw) || raw < 1 || raw > 200) {
      const current = questions.find((q) => q.id === questionId);
      setPointsDraftMap((prev) => ({ ...prev, [questionId]: String(current?.points || 1) }));
      return;
    }
    const rounded = Math.round(raw);
    const current = questions.find((q) => q.id === questionId);
    if (current && current.points === rounded) return;

    setBusyQuestionOp(true);
    try {
      const res = await apiRequest<ExamWizardDraftResponse>(
        `/api/admin/phase2-exams/wizard/draft/${examId}/questions/${questionId}/points`,
        {
          method: 'PATCH',
          body: JSON.stringify({ points: rounded }),
        },
      );
      setQuestions(res.questions || []);
      setVersionToken(res.versionToken);
      setLastSavedAtIso(res.savedAtIso);
      setAutosaveStatus('SAVED');
      onToast('تم تحديث درجة السؤال في هذا الامتحان فقط دون تعديل بنك الأسئلة.');
    } catch (err) {
      onToast((err as Error).message || 'تعذر تحديث درجة السؤال.');
    } finally {
      setBusyQuestionOp(false);
    }
  };

  // Remove question from draft ONLY (never deletes master bank question)
  const handleRemoveQuestionFromDraft = async (questionId: number) => {
    const examId = draftExamIdRef.current;
    if (!examId) return;
    setBusyQuestionOp(true);
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/questions/${questionId}`, {
        method: 'DELETE',
      });
      await refreshDraftQuestions(examId);
      onToast('تمت إزالة السؤال من مسودة الامتحان (يبقى السؤال الأصلي محفوظًا في بنك الأسئلة).');
    } catch (err) {
      onToast((err as Error).message || 'تعذر إزالة السؤال من المسودة.');
    } finally {
      setBusyQuestionOp(false);
    }
  };

  // Step 5: Save as Draft and Exit cleanly
  const handleSaveDraftAndExit = async () => {
    const savedId = await persistDraftNow();
    if (!savedId) return;
    writeStoredDraftPointer(null);
    onToast('تم حفظ الامتحان كمسودة غير منشورة بنجاح. يمكنك استئنافه أو نشره في أي وقت.');
    onExit(true);
  };

  // Step 5: Explicit Authorized Publish (only after confirmation modal!)
  const handleConfirmPublish = async () => {
    setPublishing(true);
    try {
      // Flush any pending unsaved changes first so server DB matches what the teacher reviewed
      let examId = draftExamIdRef.current;
      if (!examId || dirtyRef.current) {
        examId = await persistDraftNow();
      }
      if (!examId) {
        setPublishing(false);
        return;
      }

      const res = await apiRequest<{
        exam: { id: number; publicationStatus: string };
        publishedStatus: 'PUBLISHED' | 'SCHEDULED';
        message: string;
      }>(`/api/admin/phase2-exams/wizard/draft/${examId}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          confirmPublish: true,
          expectedUpdatedAt: versionTokenRef.current,
          syncTotalMarksToCalculated: syncMarksOnPublish,
        }),
      });

      writeStoredDraftPointer(null);
      dirtyRef.current = false;
      setPublishConfirmOpen(false);
      onToast(res.message);
      onExit(true);
    } catch (err) {
      onToast((err as Error).message || 'تعذر نشر الامتحان.');
    } finally {
      setPublishing(false);
    }
  };

  const handleRequestExit = () => {
    if (dirtyRef.current || autosaveStatus === 'UNSAVED' || autosaveStatus === 'ERROR') {
      setLeaveConfirmOpen(true);
    } else {
      onExit(Boolean(draftExamId));
    }
  };

  const linkedBankIds = useMemo(
    () =>
      questions
        .map((q) => q.sourceBankQuestionId)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    [questions],
  );

  const willBeScheduled = useMemo(() => {
    if (!form.startsAt) return false;
    const d = new Date(form.startsAt);
    return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
  }, [form.startsAt]);

  const recoveryDraftSummary = useMemo(
    () => resumableDrafts.find((d) => d.id === recoveryCandidateId) || null,
    [resumableDrafts, recoveryCandidateId],
  );

  const marksMismatch =
    questions.length > 0 &&
    form.totalMarks > 0 &&
    Math.abs(form.totalMarks - questionSummary.calculatedMarks) > 0.01;

  return (
    <div className="space-y-5" data-testid="exam-creation-wizard">
      {/* Top Wizard Header Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              data-testid="wizard-exit-btn"
              onClick={handleRequestExit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shrink-0"
            >
              <ArrowRight className="h-4 w-4" />
              <span>العودة للامتحانات</span>
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-500">
                إنشاء امتحان بخطوات سهلة {draftExamId ? `· مسودة #${draftExamId}` : '· مسودة جديدة'}
              </div>
              <h2 className="truncate text-base sm:text-lg font-extrabold text-[#0B162C]">
                {form.titleAr.trim() || 'امتحان فيزياء جديد'}
              </h2>
            </div>
          </div>

          {/* Server Autosave Indicator */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="wizard-autosave-status"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${
                autosaveStatus === 'SAVING'
                  ? 'border-blue-200 bg-blue-50 text-[#2563EB]'
                  : autosaveStatus === 'SAVED'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : autosaveStatus === 'ERROR'
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : autosaveStatus === 'UNSAVED'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {autosaveStatus === 'SAVING' && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              )}
              {autosaveStatus === 'SAVED' && (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    تم حفظ المسودة
                    {lastSavedAtIso ? ` (${formatCairoShortTime(lastSavedAtIso)})` : ''}
                  </span>
                </>
              )}
              {autosaveStatus === 'UNSAVED' && (
                <>
                  <Clock className="h-3.5 w-3.5" />
                  <span>توجد تغييرات غير محفوظة</span>
                </>
              )}
              {autosaveStatus === 'ERROR' && (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>تعذر الحفظ — إعادة المحاولة</span>
                </>
              )}
              {autosaveStatus === 'IDLE' && (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>حفظ تلقائي للمسودة مفعّل</span>
                </>
              )}
            </div>

            {(autosaveStatus === 'UNSAVED' || autosaveStatus === 'ERROR') && (
              <button
                type="button"
                data-testid="wizard-retry-save-btn"
                onClick={() => void persistDraftNow()}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0B162C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2563EB]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{autosaveStatus === 'ERROR' ? 'إعادة المحاولة' : 'حفظ الآن'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Stale Concurrency Conflict Alert */}
        {conflictDetected && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900"
          >
            <div className="flex items-center gap-2 font-bold">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
              <span>
                {saveErrorMsg ||
                  'تم تحديث هذه المسودة من نافذة أو جلسة أخرى. أعد تحميل أحدث نسخة حتى لا تضيع تعديلاتك.'}
              </span>
            </div>
            {draftExamId && (
              <button
                type="button"
                onClick={() => void loadDraftById(draftExamId, true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>إعادة تحميل أحدث نسخة</span>
              </button>
            )}
          </div>
        )}

        {/* Session Recovery Prompt (after page refresh, backed strictly by server DB) */}
        {!draftExamId && recoveryDraftSummary && (
          <div
            data-testid="wizard-recovery-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-xs"
          >
            <div className="space-y-0.5">
              <div className="font-extrabold text-[#0B162C]">
                استعادة آخر مسودة امتحان محفوظة على الخادم
              </div>
              <div className="text-slate-600">
                «{recoveryDraftSummary.titleAr}» · {recoveryDraftSummary.gradeNameAr} ·{' '}
                <span className="font-mono-num font-bold">{recoveryDraftSummary.questionCount}</span> سؤال
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="wizard-recover-draft-btn"
                disabled={resumingDraftId === recoveryDraftSummary.id}
                onClick={() => void loadDraftById(recoveryDraftSummary.id, true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
              >
                {resumingDraftId === recoveryDraftSummary.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                <span>استئناف المسودة</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  writeStoredDraftPointer(null);
                  setRecoveryCandidateId(null);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                بدء مسودة جديدة
              </button>
            </div>
          </div>
        )}

        {/* 5-Step Progress Indicator */}
        <nav
          aria-label="خطوات إنشاء الامتحان"
          data-testid="exam-wizard-stepper"
          className="grid grid-cols-5 gap-1.5 sm:gap-2 pt-1"
        >
          {WIZARD_STEPS.map((item) => {
            const isActive = step === item.step;
            const isCompleted = step > item.step && (item.step !== 2 || questions.length > 0);
            return (
              <button
                key={item.step}
                type="button"
                data-testid={`wizard-step-btn-${item.step}`}
                onClick={() => void handleGoToStep(item.step)}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors ${
                  isActive
                    ? 'border-[#2563EB] bg-[#2563EB] text-white'
                    : isCompleted
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-50'
                      : 'border-slate-200 bg-[#F7F9FC] text-slate-600 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono-num text-[11px] font-extrabold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : isCompleted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : item.step}
                </span>
                <span className="hidden md:inline text-xs font-bold truncate">{item.labelAr}</span>
                <span className="md:hidden text-[11px] font-bold truncate">{item.shortAr}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Resumable Drafts Quick Strip (only shown on Step 1 before a draft is created) */}
      {step === 1 && !draftExamId && !loadingDrafts && resumableDrafts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-[#0B162C]">
              مسودات امتحانات محفوظة سابقًا ({resumableDrafts.length})
            </h3>
            <span className="text-[11px] text-slate-500">
              يمكنك استئناف أي مسودة بدل البدء من الصفر
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {resumableDrafts.slice(0, 3).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-[#F7F9FC] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-[#0B162C]">{d.titleAr}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {d.gradeNameAr} · <span className="font-mono-num">{d.questionCount}</span> سؤال
                  </div>
                </div>
                <button
                  type="button"
                  disabled={resumingDraftId === d.id}
                  onClick={() => void loadDraftById(d.id, true)}
                  className="shrink-0 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-50"
                >
                  {resumingDraftId === d.id ? '...' : 'استئناف'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== STEP 1: بيانات الامتحان ==================== */}
      {step === 1 && (
        <div className="grid gap-5 lg:grid-cols-3" data-testid="wizard-step-1-panel">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
            <div>
              <h3 className="text-base font-extrabold text-[#0B162C]">
                الخطوة 1: بيانات الامتحان الأساسية
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                حدّد عنوان الامتحان ومكانه في المنهج الدراسي — يتم حفظ المسودة تلقائيًا على الخادم فور إكمال العنوان والصف.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="wiz-title" className="mb-1 block text-xs font-bold text-slate-700">
                  عنوان الامتحان *
                </label>
                <input
                  id="wiz-title"
                  data-testid="wizard-title-input"
                  type="text"
                  value={form.titleAr}
                  onChange={(e) => updateForm({ titleAr: e.target.value })}
                  placeholder="مثال: اختبار الوحدة الأولى — التيار الكهربي وقانون أوم"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-[#2563EB] focus:outline-none"
                />
                {form.titleAr.length > 0 && form.titleAr.trim().length < 3 && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600">
                    يجب أن لا يقل عنوان الامتحان عن 3 أحرف.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="wiz-track" className="mb-1 block text-xs font-bold text-slate-700">
                  المسار التعليمي *
                </label>
                <select
                  id="wiz-track"
                  data-testid="wizard-track-select"
                  value={form.trackId}
                  onChange={(e) => {
                    const nextTrack = Number(e.target.value);
                    const firstGrade = catalog.grades.find((g) => g.trackId === nextTrack);
                    updateForm({
                      trackId: nextTrack,
                      gradeId: firstGrade?.id || form.gradeId,
                      unitId: 0,
                      lessonId: 0,
                      courseId: 0,
                      requiredVideoId: 0,
                      assignedGroupIds: [],
                      assignedStudentIds: [],
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold"
                >
                  {catalog.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wiz-grade" className="mb-1 block text-xs font-bold text-slate-700">
                  الصف الدراسي *
                </label>
                <select
                  id="wiz-grade"
                  data-testid="wizard-grade-select"
                  value={form.gradeId}
                  onChange={(e) =>
                    updateForm({
                      gradeId: Number(e.target.value),
                      unitId: 0,
                      lessonId: 0,
                      courseId: 0,
                      requiredVideoId: 0,
                      assignedGroupIds: [],
                      assignedStudentIds: [],
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold"
                >
                  {formGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wiz-unit" className="mb-1 block text-xs font-bold text-slate-700">
                  الوحدة الدراسية (اختياري)
                </label>
                <select
                  id="wiz-unit"
                  value={form.unitId}
                  onChange={(e) => updateForm({ unitId: Number(e.target.value), lessonId: 0 })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs"
                >
                  <option value={0}>كل الوحدات / غير محدد</option>
                  {formUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.titleAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wiz-lesson" className="mb-1 block text-xs font-bold text-slate-700">
                  الدرس المرتبط (اختياري)
                </label>
                <select
                  id="wiz-lesson"
                  value={form.lessonId}
                  onChange={(e) => updateForm({ lessonId: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs"
                >
                  <option value={0}>غير مرتبط بدرس محدد</option>
                  {formLessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.titleAr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="wiz-type" className="mb-1 block text-xs font-bold text-slate-700">
                  نوع الامتحان *
                </label>
                <select
                  id="wiz-type"
                  data-testid="wizard-exam-type-select"
                  value={form.examType}
                  onChange={(e) => updateForm({ examType: e.target.value as ExamType })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold"
                >
                  <option value="LESSON_QUIZ">اختبار درس (Lesson Quiz)</option>
                  <option value="UNIT_EXAM">امتحان وحدة (Unit Examination)</option>
                  <option value="MONTHLY">امتحان شهري (Monthly Examination)</option>
                  <option value="COMPREHENSIVE">امتحان شامل (Comprehensive Examination)</option>
                  <option value="FINAL_SIMULATION">امتحان نهائي تجريبي (Final Mock Exam)</option>
                </select>
              </div>

              <div>
                <label htmlFor="wiz-desc" className="mb-1 block text-xs font-bold text-slate-700">
                  وصف مختصر للامتحان (اختياري)
                </label>
                <textarea
                  id="wiz-desc"
                  rows={3}
                  value={form.descriptionAr}
                  onChange={(e) => updateForm({ descriptionAr: e.target.value })}
                  placeholder="مثال: يشمل مسائل قانون أوم وتوصيل المقاومات على التوالي والتوازي..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="wiz-inst" className="mb-1 block text-xs font-bold text-slate-700">
                  تعليمات الامتحان للطلاب (اختياري)
                </label>
                <textarea
                  id="wiz-inst"
                  rows={3}
                  value={form.instructionsAr}
                  onChange={(e) => updateForm({ instructionsAr: e.target.value })}
                  placeholder="التعليمات التي يراها الطالب قبل بدء الامتحان..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Compact Step 1 Summary Card */}
          <aside className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 h-fit">
            <h4 className="text-sm font-extrabold text-[#0B162C]">ملخص الامتحان السريع</h4>
            <dl className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">المسار</dt>
                <dd className="font-bold text-[#0B162C]">{selectedTrackName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">الصف الدراسي</dt>
                <dd className="font-bold text-[#0B162C]">{selectedGradeName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">الوحدة</dt>
                <dd className="font-semibold text-slate-700 truncate max-w-[160px]">{selectedUnitName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">الدرس</dt>
                <dd className="font-semibold text-slate-700 truncate max-w-[160px]">{selectedLessonName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">نوع الامتحان</dt>
                <dd className="font-bold text-[#2563EB]">{EXAM_TYPE_LABELS[form.examType]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">حالة النشر الحالية</dt>
                <dd className="font-bold text-amber-700">مسودة غير منشورة</dd>
              </div>
            </dl>
            <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-[11px] leading-relaxed text-slate-600">
              لن يظهر هذا الامتحان للطلاب مطلقًا أثناء الإعداد؛ لا يتم النشر إلا بعد مراجعتك وتأكيدك الصريح في الخطوة الخامسة.
            </div>
          </aside>
        </div>
      )}

      {/* ==================== STEP 2: اختيار الأسئلة ==================== */}
      {step === 2 && (
        <div className="space-y-5" data-testid="wizard-step-2-panel">
          {/* 3 Clear Question Source Options */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-[#0B162C]">
                  الخطوة 2: اختيار وبناء أسئلة الامتحان
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  اختر الأسئلة من بنك الأسئلة المعتمد، أو ولّدها بالمولّد الذكي، أو أضف أسئلة يدويًا — ويمكنك الدمج بين جميع الطرق في نفس الامتحان.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num text-slate-700">
                <span>
                  الأسئلة: <strong className="text-[#0B162C]">{questions.length}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  من البنك: <strong className="text-[#2563EB]">{questionSummary.bankCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  يدوية: <strong className="text-slate-800">{questionSummary.manualCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  مجموع الدرجات:{' '}
                  <strong className="text-emerald-700">{questionSummary.calculatedMarks}</strong>
                </span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <button
                type="button"
                data-testid="wizard-open-bank-picker-btn"
                disabled={busyQuestionOp}
                onClick={() => setBankPickerOpen(true)}
                className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-right transition-colors hover:border-[#2563EB] hover:bg-blue-50 disabled:opacity-60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] text-white">
                  <Library className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-extrabold text-[#0B162C]">اختيار من بنك الأسئلة</div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    استعرض الأسئلة المعتمدة حسب الوحدة والصعوبة وأضف نسخة مستقلة مع صورها واختياراتها.
                  </p>
                </div>
              </button>

              <button
                type="button"
                data-testid="wizard-open-smart-gen-btn"
                disabled={busyQuestionOp}
                onClick={() => setSmartGenOpen(true)}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 text-right transition-colors hover:border-[#0B162C] hover:bg-slate-100 disabled:opacity-60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0B162C] text-sky-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-extrabold text-[#0B162C]">توليد امتحان ذكي</div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    اختر التوزيع والدرجات في المولّد الذكي ثم انقل الأسئلة المختارة مباشرة إلى هذه المسودة.
                  </p>
                </div>
              </button>

              <button
                type="button"
                data-testid="wizard-toggle-manual-builder-btn"
                disabled={busyQuestionOp}
                onClick={() => setManualBuilderOpen((prev) => !prev)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-right transition-colors disabled:opacity-60 ${
                  manualBuilderOpen
                    ? 'border-[#2563EB] bg-blue-50/70'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#0B162C]">
                  <FilePlus2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-extrabold text-[#0B162C]">
                    {manualBuilderOpen ? 'إخفاء محرر الأسئلة اليدوي' : 'إضافة أسئلة يدويًا'}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    أضف أو عدّل أسئلة اختيار من متعدد أو معادلات LaTeX أو مسائل فيزيائية مباشرة داخل المسودة.
                  </p>
                </div>
              </button>
            </div>

            {marksMismatch && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    الدرجة الكلية المضبوطة ({form.totalMarks}) تختلف عن مجموع درجات الأسئلة الحالية (
                    {questionSummary.calculatedMarks}).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => updateForm({ totalMarks: questionSummary.calculatedMarks })}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-800"
                >
                  مطابقة الدرجة الكلية ({questionSummary.calculatedMarks})
                </button>
              </div>
            )}

            {questionSummary.duplicateBankQuestionIds.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  تنبيه: توجد {questionSummary.duplicateBankQuestionIds.length} أسئلة مكررة من نفس سؤال بنك الأسئلة في هذه المسودة. يمكنك مراجعتها وإزالة المكرر أدناه.
                </span>
              </div>
            )}
          </div>

          {/* Embedded Manual Question Builder (reuses existing AdminExamQuestionBuilder!) */}
          {manualBuilderOpen && draftExamId && (
            <div className="rounded-xl border border-blue-200 bg-white p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="text-sm font-extrabold text-[#0B162C]">
                  محرر الأسئلة اليدوي الكامل (يدعم 8 أنواع ومعادلات LaTeX والرسومات)
                </div>
                <button
                  type="button"
                  onClick={() => setManualBuilderOpen(false)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  طيّ المحرر
                </button>
              </div>
              <AdminExamQuestionBuilder
                catalog={catalog}
                examId={draftExamId}
                examTrackId={form.trackId || null}
                examGradeId={form.gradeId}
                examUnitId={form.unitId || null}
                examLessonId={form.lessonId || null}
                examTitleAr={form.titleAr || 'مسودة امتحان'}
                durationMin={form.durationMin}
                configuredTotalMarks={form.totalMarks}
                allowNegativeMarking={form.allowNegativeMarking}
                questions={questions}
                calculatedMarks={questionSummary.calculatedMarks}
                distribution={distribution}
                onSyncTotalMarks={async (marks) => {
                  updateForm({ totalMarks: marks });
                  onToast(`تم تحديث الدرجة الكلية إلى ${marks}.`);
                }}
                onReloadExam={async () => {
                  await refreshDraftQuestions(draftExamId);
                }}
                onToast={onToast}
              />
            </div>
          )}

          {/* Ordered Draft Questions List */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-extrabold text-[#0B162C]">
                أسئلة المسودة الحالية ({questions.length})
              </h4>
              {busyQuestionOp && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#2563EB]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  جارٍ التحديث...
                </span>
              )}
            </div>

            {questions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-[#F7F9FC] p-10 text-center space-y-2">
                <BookOpen className="mx-auto h-9 w-9 text-slate-300" />
                <p className="text-sm font-bold text-[#0B162C]">لم تُضف أي أسئلة إلى هذه المسودة بعد</p>
                <p className="text-xs text-slate-500">
                  استخدم أحد الخيارات الثلاثة بالأعلى لاختيار أسئلة من بنك الأسئلة أو توليدها ذكيًا أو إضافتها يدويًا.
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="wizard-questions-list">
                {questions.map((q, idx) => {
                  const isFromBank = Boolean(q.sourceBankQuestionId);
                  const isDuplicateBank =
                    isFromBank &&
                    questionSummary.duplicateBankQuestionIds.includes(q.sourceBankQuestionId!);

                  return (
                    <div
                      key={q.id}
                      data-testid={`wizard-question-item-${idx + 1}`}
                      className={`rounded-xl border p-4 space-y-3 ${
                        isDuplicateBank
                          ? 'border-amber-300 bg-amber-50/30'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono-num font-extrabold text-[#0B162C]">
                            سؤال {idx + 1}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span
                            className={`font-bold ${
                              isFromBank ? 'text-[#2563EB]' : 'text-slate-700'
                            }`}
                          >
                            {isFromBank ? 'من بنك الأسئلة' : 'سؤال يدوي'}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="text-slate-600">
                            {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="text-slate-500">
                            {DIFFICULTY_LABELS[q.difficulty as QuestionDifficulty] || q.difficulty}
                          </span>
                          {isDuplicateBank && (
                            <span className="font-bold text-amber-700">· مكرر من البنك</span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                            <span>الدرجة:</span>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              data-testid={`wizard-q-points-${q.id}`}
                              value={pointsDraftMap[q.id] ?? String(q.points)}
                              onChange={(e) =>
                                setPointsDraftMap((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              onBlur={() => void handleCommitQuestionPoints(q.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleCommitQuestionPoints(q.id);
                                }
                              }}
                              className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono-num text-xs font-bold text-[#0B162C]"
                            />
                          </label>

                          <button
                            type="button"
                            disabled={idx === 0 || busyQuestionOp}
                            aria-label={`نقل السؤال ${idx + 1} لأعلى`}
                            onClick={() => void handleReorderQuestion(idx, -1)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === questions.length - 1 || busyQuestionOp}
                            aria-label={`نقل السؤال ${idx + 1} لأسفل`}
                            onClick={() => void handleReorderQuestion(idx, 1)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busyQuestionOp}
                            data-testid={`wizard-remove-q-${q.id}`}
                            aria-label={`إزالة السؤال ${idx + 1} من المسودة`}
                            onClick={() => void handleRemoveQuestionFromDraft(q.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>إزالة</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-semibold leading-relaxed text-[#0B162C]">
                          {q.promptAr}
                        </p>
                        {q.latexFormula && (
                          <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] px-3 py-2">
                            <MathFormula formula={q.latexFormula} />
                          </div>
                        )}
                      </div>

                      {/* Images Preview */}
                      {((q.questionImages && q.questionImages.length > 0) || q.imageUrl) && (
                        <div className="flex flex-wrap gap-2">
                          {(q.questionImages || []).map((img, i) => (
                            <button
                              key={img.storageKey || i}
                              type="button"
                              onClick={() => setZoomImageUrl(img.previewUrl || null)}
                              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <img
                                src={img.previewUrl}
                                alt={img.fileName || `صورة السؤال ${idx + 1}`}
                                className="h-20 w-32 object-cover"
                              />
                              <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-white">
                                <ImageIcon className="h-3 w-3" />
                                معاينة
                              </span>
                            </button>
                          ))}
                          {(!q.questionImages || q.questionImages.length === 0) && q.imageUrl && (
                            <button
                              type="button"
                              onClick={() => setZoomImageUrl(q.imageUrl || null)}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <img
                                src={q.imageUrl}
                                alt={`صورة السؤال ${idx + 1}`}
                                className="h-20 w-32 object-cover"
                              />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Choices Summary */}
                      {q.choices && q.choices.length > 0 && (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {q.choices.map((c, cIdx) => (
                            <div
                              key={c.id || cIdx}
                              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                c.isCorrect
                                  ? 'border-emerald-300 bg-emerald-50 font-bold text-emerald-900'
                                  : 'border-slate-200 bg-[#F7F9FC] text-slate-700'
                              }`}
                            >
                              <span className="font-mono-num text-[11px]">{cIdx + 1}.</span>
                              <span>{c.labelAr}</span>
                              {c.isCorrect && <FileCheck2 className="mr-auto h-3.5 w-3.5 text-emerald-600" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== STEP 3: إعدادات الامتحان ==================== */}
      {step === 3 && (
        <div
          className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6"
          data-testid="wizard-step-3-panel"
        >
          <div>
            <h3 className="text-base font-extrabold text-[#0B162C]">
              الخطوة 3: إعدادات الامتحان والجدولة والاستهداف
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              اضبط المدة والدرجات والمحاولات والطلاب المستهدفين وقواعد العرض — تُحفظ جميع الإعدادات تلقائيًا في المسودة.
            </p>
          </div>

          {!step3Validation.valid && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 space-y-1">
              {step3Validation.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 font-bold">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}

          {/* Duration, Marks, Pass Score, Attempts */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="wiz-dur" className="mb-1 block text-xs font-bold text-slate-700">
                مدة الامتحان (بالدقائق) *
              </label>
              <input
                id="wiz-dur"
                data-testid="wizard-duration-input"
                type="number"
                min={1}
                max={360}
                value={form.durationMin}
                onChange={(e) => updateForm({ durationMin: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs font-bold"
              />
              <p className="mt-1 text-[11px] text-slate-500">من دقيقة واحدة حتى 360 دقيقة.</p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="wiz-marks" className="text-xs font-bold text-slate-700">
                  الدرجة الكلية
                </label>
                {questionSummary.calculatedMarks > 0 && (
                  <button
                    type="button"
                    onClick={() => updateForm({ totalMarks: questionSummary.calculatedMarks })}
                    className="text-[11px] font-bold text-[#2563EB] hover:underline"
                  >
                    مطابقة ({questionSummary.calculatedMarks})
                  </button>
                )}
              </div>
              <input
                id="wiz-marks"
                type="number"
                min={0}
                step="0.5"
                value={form.totalMarks}
                onChange={(e) => updateForm({ totalMarks: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs font-bold"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                مجموع الأسئلة الحالي: <strong className="font-mono-num">{questionSummary.calculatedMarks}</strong>
              </p>
            </div>

            <div>
              <label htmlFor="wiz-pass" className="mb-1 block text-xs font-bold text-slate-700">
                نسبة النجاح (%) *
              </label>
              <input
                id="wiz-pass"
                type="number"
                min={1}
                max={100}
                value={form.passScorePercent}
                onChange={(e) => updateForm({ passScorePercent: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs font-bold"
              />
              <p className="mt-1 text-[11px] text-slate-500">الحد الأدنى لاعتبار الطالب ناجحًا.</p>
            </div>

            <div>
              <label htmlFor="wiz-attempts" className="mb-1 block text-xs font-bold text-slate-700">
                الحد الأقصى للمحاولات *
              </label>
              <input
                id="wiz-attempts"
                type="number"
                min={1}
                max={50}
                value={form.maxAttempts}
                onChange={(e) => updateForm({ maxAttempts: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs font-bold"
              />
              <p className="mt-1 text-[11px] text-slate-500">عدد المرات المسموح بها لكل طالب.</p>
            </div>
          </div>

          {/* Schedule Window */}
          <div className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <div>
              <label htmlFor="wiz-start" className="mb-1 block text-xs font-bold text-slate-700">
                تاريخ ووقت بدء الإتاحة (اختياري)
              </label>
              <input
                id="wiz-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => updateForm({ startsAt: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                إذا حددت موعدًا مستقبليًا فسيُجدول الامتحان تلقائيًا عند النشر.
              </p>
            </div>
            <div>
              <label htmlFor="wiz-end" className="mb-1 block text-xs font-bold text-slate-700">
                تاريخ ووقت انتهاء الإتاحة (اختياري)
              </label>
              <input
                id="wiz-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => updateForm({ endsAt: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                اتركه فارغًا ليبقى الامتحان متاحًا بدون موعد إغلاق.
              </p>
            </div>
          </div>

          {/* Prerequisites (Course & Video) */}
          <div className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <div>
              <label htmlFor="wiz-course" className="mb-1 block text-xs font-bold text-slate-700">
                ربط بكورس مدفوع (اختياري)
              </label>
              <select
                id="wiz-course"
                value={form.courseId}
                onChange={(e) => updateForm({ courseId: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value={0}>متاح بدون اشتراط كورس محدد</option>
                {formCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    للمشتركين في: {c.titleAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="wiz-video" className="mb-1 block text-xs font-bold text-slate-700">
                شرط إتمام مشاهدة فيديو مسبق (اختياري)
              </label>
              <select
                id="wiz-video"
                value={form.requiredVideoId}
                onChange={(e) => updateForm({ requiredVideoId: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value={0}>بدون شرط مشاهدة فيديو</option>
                {formVideos.map((v) => (
                  <option key={v.id} value={v.id}>
                    يشترط إتمام (70%+): {v.titleAr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Audience Scope */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <h4 className="text-sm font-extrabold text-[#0B162C]">الطلاب المستهدفون</h4>
            <div className="flex flex-wrap gap-3 text-xs">
              {[
                { id: 'GRADE', label: `جميع طلاب الصف (${selectedGradeName})` },
                { id: 'GROUP', label: `مجموعات محددة (${formGroups.length} متاحة)` },
                { id: 'STUDENTS', label: `طلاب محددون بالاسم (${formStudents.length} معتمد)` },
              ].map((opt) => (
                <label
                  key={opt.id}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 font-semibold ${
                    form.assignmentScope === opt.id
                      ? 'border-[#2563EB] bg-blue-50 text-[#0B162C]'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="wiz-scope"
                    checked={form.assignmentScope === opt.id}
                    onChange={() =>
                      updateForm({ assignmentScope: opt.id as ExamAssignmentScope })
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {form.assignmentScope === 'GROUP' && (
              <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                {formGroups.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    لا توجد مجموعات دراسية لهذا الصف بعد.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {formGroups.map((g) => {
                      const checked = form.assignedGroupIds.includes(g.id);
                      return (
                        <label
                          key={g.id}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              updateForm({
                                assignedGroupIds: checked
                                  ? form.assignedGroupIds.filter((id) => id !== g.id)
                                  : [...form.assignedGroupIds, g.id],
                              })
                            }
                          />
                          <span className="font-semibold text-[#0B162C]">{g.nameAr}</span>
                          <span className="text-slate-400">({g.memberCount})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {form.assignmentScope === 'STUDENTS' && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                {formStudents.length === 0 ? (
                  <p className="text-xs text-slate-500">لا يوجد طلاب معتمدون في هذا الصف حاليًا.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {formStudents.map((s) => {
                      const checked = form.assignedStudentIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              updateForm({
                                assignedStudentIds: checked
                                  ? form.assignedStudentIds.filter((id) => id !== s.id)
                                  : [...form.assignedStudentIds, s.id],
                              })
                            }
                          />
                          <span className="font-semibold text-[#0B162C]">{s.fullName}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Behavior & Result Visibility Rules */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <h4 className="text-sm font-extrabold text-[#0B162C]">
              سلوك الامتحان وعرض النتيجة والمراجعة
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs text-slate-700">
              {[
                {
                  key: 'shuffleQuestions' as const,
                  label: 'ترتيب عشوائي للأسئلة',
                  hint: 'يعرض الأسئلة بترتيب مختلف لكل طالب.',
                },
                {
                  key: 'shuffleChoices' as const,
                  label: 'ترتيب عشوائي للاختيارات',
                  hint: 'يعيد ترتيب خيارات أسئلة الاختيار من متعدد.',
                },
                {
                  key: 'allowNavigation' as const,
                  label: 'السماح بالتنقل الحر بين الأسئلة',
                  hint: 'يمكن للطالب الرجوع للأسئلة السابقة قبل التسليم.',
                },
                {
                  key: 'allowReviewBeforeSubmit' as const,
                  label: 'مراجعة ملخص الإجابات قبل التسليم',
                  hint: 'يعرض قائمة بالأسئلة المجابة وغير المجابة.',
                },
                {
                  key: 'showResultImmediately' as const,
                  label: 'عرض النتيجة فورًا بعد التسليم',
                  hint: 'أو إخفاؤها حتى يعتمدها المدرس.',
                },
                {
                  key: 'showCorrectAnswers' as const,
                  label: 'عرض الإجابات الصحيحة بعد التسليم',
                  hint: 'يمكّن الطالب من معرفة الإجابة الصحيحة في المراجعة.',
                },
                {
                  key: 'showExplanations' as const,
                  label: 'عرض الشرح والتفسير العلمي',
                  hint: 'يظهر شرح كل سؤال بعد التسليم والمراجعة.',
                },
                {
                  key: 'allowStudentReview' as const,
                  label: 'السماح بمراجعة الورقة في «نتائجي»',
                  hint: 'يحفظ للطالب إمكانية استعراض ورقة امتحانه لاحقًا.',
                },
                {
                  key: 'allowNegativeMarking' as const,
                  label: 'تفعيل الدرجات السالبة',
                  hint: 'خصم درجات إضافية عند الإجابات الخاطئة إذا كانت محددة بالسؤال.',
                },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-[#F7F9FC]"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form[opt.key]}
                    onChange={(e) => updateForm({ [opt.key]: e.target.checked })}
                  />
                  <span>
                    <span className="block font-bold text-[#0B162C]">{opt.label}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 4: معاينة الامتحان ==================== */}
      {step === 4 && (
        <div className="space-y-5" data-testid="wizard-step-4-panel">
          {/* Validation Checklist Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-[#0B162C]">
                فحص جاهزية الامتحان قبل الحفظ أو النشر
              </h3>
              {fullValidation.isReadyToPublish ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  جاهز للنشر بدون أخطاء
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-rose-700">
                  <AlertCircle className="h-4 w-4" />
                  توجد {fullValidation.errors.length} ملاحظات تمنع النشر حاليًا
                </span>
              )}
            </div>

            {fullValidation.errors.length > 0 && (
              <div className="space-y-1.5">
                {fullValidation.errors.map((issue, idx) => (
                  <div
                    key={`${issue.code}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900"
                  >
                    <span className="font-semibold">{issue.messageAr}</span>
                    <button
                      type="button"
                      onClick={() => void handleGoToStep(issue.step)}
                      className="rounded-md bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 border border-rose-200 hover:bg-rose-100"
                    >
                      تعديل في الخطوة {issue.step}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fullValidation.warnings.length > 0 && (
              <div className="space-y-1.5">
                {fullValidation.warnings.map((issue, idx) => (
                  <div
                    key={`${issue.code}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    <span className="font-medium">{issue.messageAr}</span>
                    {issue.code === 'MARKS_MISMATCH' && (
                      <button
                        type="button"
                        onClick={() => updateForm({ totalMarks: questionSummary.calculatedMarks })}
                        className="rounded-md bg-amber-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-800"
                      >
                        مطابقة الآن
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview Mode Toggle: Student View (zero answer keys) vs Teacher-Only Answer Key Review */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#F7F9FC] px-5 py-3.5">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#0B162C]">
                <Eye className="h-4 w-4 text-[#2563EB]" />
                <span>معاينة ورقة الامتحان</span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
                <button
                  type="button"
                  data-testid="wizard-preview-student-tab"
                  onClick={() => setPreviewMode('student')}
                  className={`rounded-md px-3 py-1.5 font-bold transition-colors ${
                    previewMode === 'student'
                      ? 'bg-[#0B162C] text-white'
                      : 'text-slate-600 hover:text-[#0B162C]'
                  }`}
                >
                  معاينة الطالب (بدون إجابات)
                </button>
                <button
                  type="button"
                  data-testid="wizard-preview-teacher-tab"
                  onClick={() => setPreviewMode('teacher_key')}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-bold transition-colors ${
                    previewMode === 'teacher_key'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-600 hover:text-[#0B162C]'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span>مراجعة نموذج الإجابة (للمدرس فقط)</span>
                </button>
              </div>
            </div>

            {/* Exam Paper Header (exactly as student sees it) */}
            <div className="border-b border-slate-200 bg-[#0B162C] px-6 py-5 text-white space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span>{selectedTrackName}</span>
                <span aria-hidden="true">·</span>
                <span>{selectedGradeName}</span>
                <span aria-hidden="true">·</span>
                <span>{EXAM_TYPE_LABELS[form.examType]}</span>
              </div>
              <h3 className="text-lg font-extrabold">{form.titleAr || 'امتحان فيزياء'}</h3>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-200 font-mono-num">
                <span>عدد الأسئلة: {questions.length}</span>
                <span>الدرجة الكلية: {form.totalMarks || questionSummary.calculatedMarks}</span>
                <span>المدة: {form.durationMin} دقيقة</span>
                <span>درجة النجاح: {form.passScorePercent}%</span>
              </div>
              {form.instructionsAr.trim() && (
                <div className="mt-3 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs leading-relaxed text-slate-200">
                  <strong className="text-white">تعليمات الامتحان: </strong>
                  {form.instructionsAr}
                </div>
              )}
            </div>

            {/* Questions Body */}
            <div
              className="p-5 sm:p-6 space-y-4"
              data-testid={
                previewMode === 'student'
                  ? 'wizard-student-preview-panel'
                  : 'wizard-teacher-key-panel'
              }
            >
              {previewMode === 'teacher_key' && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-[#0B162C]">
                  عرض خاص بالمدرس فقط — تظهر هنا الإجابات الصحيحة والتفسيرات للمراجعة ولا تظهر للطلاب أثناء الامتحان.
                </div>
              )}

              {questions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-[#F7F9FC] p-10 text-center text-xs text-slate-500">
                  لا توجد أسئلة للمعاينة بعد. ارجع إلى الخطوة 2 لإضافة الأسئلة.
                </div>
              ) : (
                questions.map((q, idx) => (
                  <article
                    key={q.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-extrabold text-[#0B162C]">
                        السؤال {idx + 1} · {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}
                      </span>
                      <span className="font-mono-num font-bold text-[#2563EB]">
                        {q.points} {q.points === 1 ? 'درجة' : 'درجات'}
                      </span>
                    </div>

                    <p className="text-sm font-semibold leading-relaxed text-[#0B162C]">
                      {q.promptAr}
                    </p>

                    {q.latexFormula && (
                      <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] px-3.5 py-2.5">
                        <MathFormula formula={q.latexFormula} />
                      </div>
                    )}

                    {/* Question Images */}
                    {((q.questionImages && q.questionImages.length > 0) || q.imageUrl) && (
                      <div className="flex flex-wrap gap-3">
                        {(q.questionImages || []).map((img, i) => (
                          <img
                            key={img.storageKey || i}
                            src={img.previewUrl}
                            alt={img.fileName || `شكل السؤال ${idx + 1}`}
                            className="max-h-56 rounded-lg border border-slate-200 bg-white object-contain"
                          />
                        ))}
                        {(!q.questionImages || q.questionImages.length === 0) && q.imageUrl && (
                          <img
                            src={q.imageUrl}
                            alt={`شكل السؤال ${idx + 1}`}
                            className="max-h-56 rounded-lg border border-slate-200 bg-white object-contain"
                          />
                        )}
                      </div>
                    )}

                    {/* Choices Layout: Strictly neutral in student preview; highlighted ONLY in teacher_key mode */}
                    {q.choices && q.choices.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {q.choices.map((c, cIdx) => {
                          const highlightCorrect = previewMode === 'teacher_key' && c.isCorrect;
                          return (
                            <div
                              key={c.id || cIdx}
                              className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
                                highlightCorrect
                                  ? 'border-emerald-400 bg-emerald-50 font-bold text-emerald-950'
                                  : 'border-slate-200 bg-[#F7F9FC] text-slate-800'
                              }`}
                            >
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-mono-num ${
                                  highlightCorrect
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-slate-300 bg-white text-slate-600'
                                }`}
                              >
                                {cIdx + 1}
                              </span>
                              <span className="flex-1">{c.labelAr}</span>
                              {highlightCorrect && (
                                <span className="text-[11px] font-extrabold text-emerald-700">
                                  إجابة صحيحة
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Non-choice student input preview */}
                    {(!q.choices || q.choices.length === 0) && (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-[#F7F9FC] px-3.5 py-2.5 text-xs text-slate-500">
                        {q.questionType === 'NUMERIC'
                          ? `حقل إجابة رقمية${q.numericUnit ? ` (الوحدة: ${q.numericUnit})` : ''}`
                          : q.questionType === 'FILE_UPLOAD'
                            ? 'منطقة رفع صورة خطوات الحل للطالب'
                            : 'مربع كتابة إجابة الطالب'}
                      </div>
                    )}

                    {/* Teacher-only Answer Key & Explanation Block (NEVER rendered in student preview mode) */}
                    {previewMode === 'teacher_key' && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs space-y-1.5">
                        {q.questionType === 'NUMERIC' && q.numericAnswer && (
                          <div>
                            <strong className="text-emerald-900">الإجابة الرقمية الصحيحة: </strong>
                            <span className="font-mono-num font-bold text-emerald-800">
                              {q.numericAnswer} {q.numericUnit} (± {q.numericTolerance || '0.05'})
                            </span>
                          </div>
                        )}
                        {q.modelAnswerAr && (
                          <div>
                            <strong className="text-emerald-900">الإجابة النموذجية: </strong>
                            <span className="text-slate-700">{q.modelAnswerAr}</span>
                          </div>
                        )}
                        {q.explanationAr && (
                          <div>
                            <strong className="text-emerald-900">التفسير العلمي: </strong>
                            <span className="text-slate-700">{q.explanationAr}</span>
                          </div>
                        )}
                        {q.modelAnswerFiles && q.modelAnswerFiles.length > 0 && (
                          <div className="text-[11px] font-semibold text-emerald-800">
                            مرفقات نموذج الإجابة: {q.modelAnswerFiles.length} ملف
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 5: حفظ الامتحان ==================== */}
      {step === 5 && (
        <div className="space-y-5" data-testid="wizard-step-5-panel">
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
            <div>
              <h3 className="text-base font-extrabold text-[#0B162C]">
                الخطوة 5: المراجعة النهائية وحفظ أو نشر الامتحان
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                اختر «حفظ كمسودة» لإبقاء الامتحان غير مرئي للطلاب، أو «نشر الامتحان» لإتاحته بعد التأكيد الصريح.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                <div className="text-[11px] font-semibold text-slate-500">عنوان الامتحان</div>
                <div className="mt-1 text-sm font-extrabold text-[#0B162C] truncate">{form.titleAr || '—'}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {selectedTrackName} · {selectedGradeName}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                <div className="text-[11px] font-semibold text-slate-500">عدد الأسئلة ومصادرها</div>
                <div className="mt-1 font-mono-num text-xl font-extrabold text-[#0B162C]">
                  {questions.length}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {questionSummary.bankCount} من البنك · {questionSummary.manualCount} يدوي
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                <div className="text-[11px] font-semibold text-slate-500">الدرجة والمدة</div>
                <div className="mt-1 font-mono-num text-xl font-extrabold text-[#2563EB]">
                  {form.totalMarks || questionSummary.calculatedMarks} درجة
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {form.durationMin} دقيقة · النجاح {form.passScorePercent}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4">
                <div className="text-[11px] font-semibold text-slate-500">الاستهداف والجدولة</div>
                <div className="mt-1 text-sm font-extrabold text-[#0B162C]">
                  {form.assignmentScope === 'GRADE'
                    ? 'جميع طلاب الصف'
                    : form.assignmentScope === 'GROUP'
                      ? `${form.assignedGroupIds.length} مجموعة محددة`
                      : `${form.assignedStudentIds.length} طالب محدد`}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {form.startsAt ? `يبدأ: ${formatDateTimeAr(new Date(form.startsAt).toISOString())}` : 'إتاحة فورية عند النشر'}
                </div>
              </div>
            </div>

            {!fullValidation.isReadyToPublish && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-rose-900">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                  <span>يجب استكمال الملاحظات التالية قبل النشر (يمكنك الحفظ كمسودة الآن):</span>
                </div>
                <ul className="space-y-1 text-xs text-rose-800">
                  {fullValidation.errors.map((err, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span>• {err.messageAr}</span>
                      <button
                        type="button"
                        onClick={() => void handleGoToStep(err.step)}
                        className="font-bold text-rose-700 underline"
                      >
                        الخطوة {err.step}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Explicit Final Actions */}
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-5 flex flex-col justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-extrabold text-[#0B162C]">حفظ كمسودة غير منشورة</div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    يحفظ الامتحان مع جميع أسئلته وإعداداته كمسودة مخفية عن الطلاب لتعود إليه لاحقًا من المعالج أو قائمة الامتحانات.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="wizard-save-draft-btn"
                  disabled={!step1Validation.valid || autosaveStatus === 'SAVING'}
                  onClick={() => void handleSaveDraftAndExit()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-extrabold text-[#0B162C] hover:bg-slate-100 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>حفظ كمسودة</span>
                </button>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 flex flex-col justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-extrabold text-[#0B162C]">
                    {willBeScheduled ? 'جدولة ونشر الامتحان' : 'نشر الامتحان للطلاب'}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {willBeScheduled
                      ? 'سيُحفظ الامتحان بحالة «مجدول» ويظهر للطلاب تلقائيًا عند حلول موعد البدء بعد تأكيدك.'
                      : 'سيصبح الامتحان «منشورًا» ومتاحًا فورًا للطلاب المستهدفين بعد تأكيدك الصريح.'}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="wizard-open-publish-confirm-btn"
                  disabled={!fullValidation.isReadyToPublish || publishing}
                  onClick={() => setPublishConfirmOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>{willBeScheduled ? 'جدولة الامتحان' : 'نشر الامتحان'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Wizard Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <button
          type="button"
          data-testid="wizard-prev-step-btn"
          disabled={step === 1}
          onClick={() => void handleGoToStep(Math.max(1, step - 1) as 1 | 2 | 3 | 4 | 5)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowRight className="h-4 w-4" />
          <span>الخطوة السابقة</span>
        </button>

        <div className="text-xs font-semibold text-slate-500 font-mono-num">
          خطوة {step} من 5
        </div>

        {step < 5 ? (
          <button
            type="button"
            data-testid="wizard-next-step-btn"
            onClick={() => void handleGoToStep((step + 1) as 1 | 2 | 3 | 4 | 5)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#2563EB]"
          >
            <span>التالي: {WIZARD_STEPS[step]?.labelAr}</span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSaveDraftAndExit()}
            disabled={!step1Validation.valid}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-50 disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            <span>حفظ المسودة والإنهاء</span>
          </button>
        )}
      </div>

      {/* Reused Central Question Bank Picker Modal */}
      <QuestionBankPickerModal
        open={bankPickerOpen}
        mode="EXAM"
        catalog={catalog}
        defaultTrackId={form.trackId || null}
        defaultGradeId={form.gradeId}
        defaultUnitId={form.unitId || null}
        defaultLessonId={form.lessonId || null}
        alreadyLinkedBankIds={linkedBankIds}
        onClose={() => setBankPickerOpen(false)}
        onConfirm={(picked) => {
          setBankPickerOpen(false);
          void handleAddFromBank(picked);
        }}
      />

      {/* Reused Smart Exam Generator Modal in Transfer Mode */}
      <SmartExamGeneratorModal
        open={smartGenOpen}
        catalog={catalog}
        initialTrackId={form.trackId || null}
        initialGradeId={form.gradeId}
        initialTitleAr={form.titleAr}
        transferButtonLabelAr="نقل الأسئلة المختارة إلى مسودة المعالج"
        onClose={() => setSmartGenOpen(false)}
        onDraftSaved={() => {}}
        onTransferSelection={handleSmartGeneratorTransfer}
        onToast={onToast}
      />

      {/* Explicit Publish Confirmation Dialog */}
      {publishConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد نشر الامتحان"
          data-testid="wizard-publish-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#0B162C]">
                {willBeScheduled ? 'تأكيد جدولة الامتحان' : 'تأكيد نشر الامتحان للطلاب'}
              </h3>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setPublishConfirmOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              أنت على وشك {willBeScheduled ? 'جدولة' : 'نشر'} الامتحان{' '}
              <strong className="text-[#0B162C]">«{form.titleAr}»</strong> بواقع{' '}
              <strong className="font-mono-num">{questions.length}</strong> سؤال وبمجموع{' '}
              <strong className="font-mono-num">{questionSummary.calculatedMarks}</strong> درجة.
            </p>

            {marksMismatch && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={syncMarksOnPublish}
                  onChange={(e) => setSyncMarksOnPublish(e.target.checked)}
                />
                <span>
                  مطابقة الدرجة الكلية للامتحان تلقائيًا مع مجموع الأسئلة ({questionSummary.calculatedMarks}) عند النشر.
                </span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={publishing}
                onClick={() => setPublishConfirmOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                تراجع
              </button>
              <button
                type="button"
                data-testid="wizard-confirm-publish-btn"
                disabled={publishing}
                onClick={() => void handleConfirmPublish()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span>{publishing ? 'جارٍ النشر...' : willBeScheduled ? 'تأكيد الجدولة' : 'تأكيد النشر الآن'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Leave Confirmation Dialog */}
      {leaveConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تغييرات غير محفوظة"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-[#0B162C]">توجد تغييرات غير محفوظة</h3>
            <p className="text-xs leading-relaxed text-slate-600">
              لم يُستكمل حفظ آخر تعديلاتك في المسودة بعد. هل تود حفظ المسودة قبل الخروج أم المتابعة؟
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLeaveConfirmOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                البقاء في المعالج
              </button>
              <button
                type="button"
                onClick={() => {
                  dirtyRef.current = false;
                  setLeaveConfirmOpen(false);
                  onExit(Boolean(draftExamId));
                }}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
              >
                الخروج بدون حفظ
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = await persistDraftNow();
                  if (id) {
                    setLeaveConfirmOpen(false);
                    onExit(true);
                  }
                }}
                className="rounded-lg bg-[#0B162C] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#2563EB]"
              >
                حفظ المسودة والخروج
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Lightbox */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة صورة السؤال"
        >
          <div className="relative max-h-[90vh] max-w-4xl">
            <button
              type="button"
              onClick={() => setZoomImageUrl(null)}
              className="absolute -top-10 left-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25"
            >
              إغلاق ✕
            </button>
            <img
              src={zoomImageUrl}
              alt="معاينة صورة السؤال"
              className="max-h-[85vh] max-w-full rounded-xl border border-white/20 bg-white object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
