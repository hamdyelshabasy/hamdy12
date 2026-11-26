import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileUp,
  Flag,
  HelpCircle,
  ListChecks,
  Save,
  Send,
  ShieldCheck,
  WifiOff,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import { EXAM_TYPE_LABELS, QUESTION_TYPE_LABELS } from '../types/exams.ts';
import { MathFormula } from './MathFormula.tsx';
import { QuestionImageGallery } from './QuestionImageGallery.tsx';

interface ExamBriefResponse {
  exam: {
    id: number;
    titleAr: string;
    descriptionAr: string;
    instructionsAr: string;
    examType: string;
    durationMin: number;
    totalMarks: number;
    questionCount: number;
    passScorePercent: number;
    maxAttempts: number;
    attemptsUsed: number;
    remainingAttempts: number;
    startsAt: string | null;
    endsAt: string | null;
    allowNavigation: boolean;
    allowReviewBeforeSubmit: boolean;
    allowNegativeMarking: boolean;
    showResultImmediately: boolean;
    shuffleQuestions: boolean;
    shuffleChoices: boolean;
  };
  canStart: boolean;
  reasonAr: string | null;
  inProgressAttemptId: number | null;
}

interface ExamQuestionItem {
  id: number;
  questionType: string;
  difficulty: string;
  promptAr: string;
  latexFormula: string | null;
  imageUrl: string | null;
  questionImages?: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    displayOrder: number;
    previewUrl: string;
  }>;
  points: number;
  negativePoints: number;
  numericUnit: string;
  choices: Array<{ id: number; labelAr: string; latexFormula: string | null }>;
  savedAnswer: {
    selectedChoiceId: number | null;
    textAnswer: string | null;
    numericAnswer: string | null;
    uploadedFileName: string | null;
  } | null;
}

interface StartExamResponse {
  attempt: {
    id: number;
    attemptNumber: number;
    startedAt: string;
    expiresAt: string;
    flaggedQuestions: number[];
  };
  exam: {
    id: number;
    titleAr: string;
    descriptionAr: string;
    instructionsAr: string;
    durationMin: number;
    passScorePercent: number;
    allowNavigation: boolean;
    allowReviewBeforeSubmit: boolean;
    allowNegativeMarking: boolean;
    showResultImmediately: boolean;
    showCorrectAnswers: boolean;
  };
  serverNow: string;
  expiresAt: string;
  remainingSec: number;
  questions: ExamQuestionItem[];
}

interface SubmitExamResponse {
  attempt?: {
    id: number;
    status: string;
  };
  summary: {
    autoScore: number | null;
    maxScore: number;
    hasManualQuestions: boolean;
    percent: number | null;
    passed: boolean | null;
    correctCount?: number | null;
    incorrectCount?: number | null;
    unansweredCount?: number;
    manualPendingCount?: number;
    lessonAnalytics: Array<{
      lessonId: number;
      lessonTitleAr: string;
      earnedPoints: number;
      possiblePoints: number;
      percent: number;
      level: 'STRONG' | 'AVERAGE' | 'NEEDS_WORK';
    }>;
  };
  resultPublished: boolean;
  showResultImmediately: boolean;
  showCorrectAnswers: boolean;
  allowStudentReview?: boolean;
  review: Array<{
    questionId: number;
    promptAr: string;
    latexFormula: string | null;
    imageUrl?: string | null;
    questionImages?: Array<{
      storageKey: string;
      fileName: string;
      mimeType: string;
      previewUrl: string;
    }>;
    modelAnswerFiles?: Array<{
      storageKey: string;
      fileName: string;
      mimeType: string;
      previewUrl: string;
    }>;
    questionType: string;
    points: number;
    awardedPoints: number;
    isCorrect: boolean | null;
    needsManualGrading: boolean;
    selectedChoiceId?: number | null;
    textAnswer?: string | null;
    numericAnswer?: string | null;
    numericUnit?: string;
    correctNumericAnswer?: string | null;
    modelAnswerAr: string;
    explanationAr: string;
    choices?: Array<{
      id: number;
      labelAr: string;
      latexFormula: string | null;
      isCorrect: boolean;
    }>;
  }>;
}

interface StudentAnswerDraft {
  selectedChoiceId?: number | null;
  textAnswer?: string;
  numericAnswer?: string;
  uploadedFileName?: string;
  uploadedFileData?: string;
}

interface ExamRunnerProps {
  examId: number;
  onExit: () => void;
  onOpenResults?: () => void;
}

function isQuestionAnswered(draft?: StudentAnswerDraft): boolean {
  if (!draft) return false;
  return Boolean(
    draft.selectedChoiceId ||
      (draft.textAnswer && draft.textAnswer.trim().length > 0) ||
      (draft.numericAnswer && draft.numericAnswer.trim().length > 0) ||
      draft.uploadedFileName,
  );
}

export const ExamRunner: React.FC<ExamRunnerProps> = ({ examId, onExit, onOpenResults }) => {
  const [stage, setStage] = useState<'BRIEF' | 'TAKING' | 'SUBMITTED'>('BRIEF');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  // Stage 1: Brief
  const [brief, setBrief] = useState<ExamBriefResponse | null>(null);
  const [confirmedInstructions, setConfirmedInstructions] = useState(false);

  // Stage 2: Active Attempt
  const [examData, setExamData] = useState<StartExamResponse | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [answers, setAnswers] = useState<Record<number, StudentAnswerDraft>>({});
  const [flaggedIds, setFlaggedIds] = useState<number[]>([]);
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'OFFLINE'>('IDLE');
  const [submitting, setSubmitting] = useState(false);
  const [autoSubmittedNotice, setAutoSubmittedNotice] = useState(false);

  // Modals inside player
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Stage 3: Submitted Result
  const [result, setResult] = useState<SubmitExamResponse | null>(null);

  // Refs for server-authoritative timing & debounced autosave
  const serverOffsetMsRef = useRef(0);
  const expiresAtMsRef = useRef(0);
  const answersRef = useRef<Record<number, StudentAnswerDraft>>({});
  const flaggedRef = useRef<number[]>([]);
  const debounceTimersRef = useRef<Record<number, number>>({});
  const dirtyQueueRef = useRef<Set<number>>(new Set());
  const autoSubmitTriggeredRef = useRef(false);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    flaggedRef.current = flaggedIds;
  }, [flaggedIds]);

  // Step 1: Load Exam Instruction Brief
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await apiRequest<ExamBriefResponse>(`/api/exams/${examId}/brief`);
        if (!active) return;
        setBrief(res);
        setConfirmedInstructions(Boolean(res.inProgressAttemptId));
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [examId]);

  const handleStartExam = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      const res = await apiRequest<StartExamResponse>(`/api/exams/${examId}/start`, {
        method: 'POST',
      });
      setExamData(res);

      // Sync server clock offset so local clock tampering cannot extend timer
      const serverNowMs = Date.parse(res.serverNow);
      const expiresAtMs = Date.parse(res.expiresAt || res.attempt.expiresAt);
      if (!Number.isNaN(serverNowMs) && !Number.isNaN(expiresAtMs)) {
        serverOffsetMsRef.current = Date.now() - serverNowMs;
        expiresAtMsRef.current = expiresAtMs;
        const computedRem = Math.max(
          0,
          Math.floor((expiresAtMs - (Date.now() - serverOffsetMsRef.current)) / 1000),
        );
        setRemainingSec(computedRem);
      } else {
        setRemainingSec(res.remainingSec);
      }

      const initialAns: Record<number, StudentAnswerDraft> = {};
      for (const q of res.questions) {
        if (q.savedAnswer) {
          initialAns[q.id] = {
            selectedChoiceId: q.savedAnswer.selectedChoiceId,
            textAnswer: q.savedAnswer.textAnswer || '',
            numericAnswer: q.savedAnswer.numericAnswer || '',
            uploadedFileName: q.savedAnswer.uploadedFileName || '',
          };
        }
      }
      setAnswers(initialAns);
      answersRef.current = initialAns;

      const initialFlags = Array.isArray(res.attempt.flaggedQuestions)
        ? res.attempt.flaggedQuestions
        : [];
      setFlaggedIds(initialFlags);
      flaggedRef.current = initialFlags;

      setCurrentIdx(0);
      autoSubmitTriggeredRef.current = false;
      setStage('TAKING');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const handleSubmit = useCallback(
    async (isAuto = false) => {
      if (!examData || submitting || result) return;
      setSubmitting(true);
      setConfirmSubmitOpen(false);
      setReviewModalOpen(false);

      // Clear any pending debounce timers
      Object.values(debounceTimersRef.current).forEach((t) => window.clearTimeout(t));
      debounceTimersRef.current = {};

      try {
        const payload = Object.entries(answersRef.current).map(([qId, a]) => ({
          questionId: Number(qId),
          ...a,
        }));
        const res = await apiRequest<SubmitExamResponse>(
          `/api/exams/attempts/${examData.attempt.id}/submit`,
          {
            method: 'POST',
            body: JSON.stringify({
              autoSubmitted: isAuto,
              answers: payload,
              flaggedQuestions: flaggedRef.current,
            }),
          },
        );
        if (isAuto) setAutoSubmittedNotice(true);
        setResult(res);
        setStage('SUBMITTED');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [examData, submitting, result],
  );

  // Server-authoritative countdown timer
  useEffect(() => {
    if (stage !== 'TAKING' || !examData || result) return;

    const tick = () => {
      let nextSec: number;
      if (expiresAtMsRef.current > 0) {
        const estimatedServerNow = Date.now() - serverOffsetMsRef.current;
        nextSec = Math.max(0, Math.floor((expiresAtMsRef.current - estimatedServerNow) / 1000));
      } else {
        nextSec = Math.max(0, remainingSec - 1);
      }
      setRemainingSec(nextSec);

      if (nextSec <= 0 && !autoSubmitTriggeredRef.current) {
        autoSubmitTriggeredRef.current = true;
        void handleSubmit(true);
      }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [stage, examData, result, handleSubmit]);

  const sendAutosave = useCallback(
    async (questionId?: number, overrideDraft?: StudentAnswerDraft, overrideFlags?: number[]) => {
      if (!examData || stage !== 'TAKING') return;
      setSaveState('SAVING');
      try {
        const draft = questionId ? overrideDraft || answersRef.current[questionId] || {} : undefined;
        const body: Record<string, unknown> = {
          flaggedQuestions: overrideFlags ?? flaggedRef.current,
        };
        if (questionId && draft) {
          body.questionId = questionId;
          body.selectedChoiceId = draft.selectedChoiceId ?? null;
          body.textAnswer = draft.textAnswer ?? null;
          body.numericAnswer = draft.numericAnswer ?? null;
          body.uploadedFileName = draft.uploadedFileName ?? null;
          body.uploadedFileData = draft.uploadedFileData ?? null;
        }

        const res = await apiRequest<{
          saved: boolean;
          serverNow?: string;
          remainingSec?: number;
        }>(`/api/exams/attempts/${examData.attempt.id}/autosave`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (questionId) dirtyQueueRef.current.delete(questionId);
        if (res.serverNow) {
          const sNow = Date.parse(res.serverNow);
          if (!Number.isNaN(sNow)) {
            serverOffsetMsRef.current = Date.now() - sNow;
          }
        }
        setSaveState('SAVED');
      } catch (err) {
        const msg = (err as Error).message || '';
        // If server rejected because time expired or already submitted, refresh submitted result cleanly
        if (msg.includes('انتهى وقت') || msg.includes('تسليم')) {
          setAutoSubmittedNotice(true);
          try {
            const r = await apiRequest<any>(`/api/exams/attempts/${examData.attempt.id}/result`);
            setResult({
              attempt: r.attempt,
              summary: {
                autoScore: r.attempt?.totalScore ?? null,
                maxScore: r.attempt?.maxScore ?? 0,
                hasManualQuestions: (r.attempt?.manualPendingCount ?? 0) > 0,
                percent: r.attempt?.percent ?? null,
                passed: r.attempt?.passed ?? null,
                correctCount: r.attempt?.correctCount ?? null,
                incorrectCount: r.attempt?.incorrectCount ?? null,
                unansweredCount: r.attempt?.unansweredCount ?? 0,
                lessonAnalytics: [],
              },
              resultPublished: Boolean(r.resultPublished),
              showResultImmediately: Boolean(r.resultPublished),
              showCorrectAnswers: Boolean(r.exam?.showCorrectAnswers && r.resultPublished),
              allowStudentReview: Boolean(r.exam?.allowStudentReview),
              review: Array.isArray(r.review) ? r.review : [],
            });
            setStage('SUBMITTED');
          } catch {
            setError(msg);
          }
          return;
        }
        if (questionId) dirtyQueueRef.current.add(questionId);
        setSaveState('OFFLINE');
      }
    },
    [examData, stage],
  );

  // Automatic retry on browser reconnect
  useEffect(() => {
    if (stage !== 'TAKING') return;
    const handleOnline = () => {
      const pending = Array.from(dirtyQueueRef.current);
      for (const qId of pending) {
        void sendAutosave(qId);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [stage, sendAutosave]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimersRef.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const updateAnswer = (
    questionId: number,
    patch: StudentAnswerDraft,
    immediate: boolean,
  ) => {
    const merged: StudentAnswerDraft = {
      ...(answersRef.current[questionId] || {}),
      ...patch,
    };
    answersRef.current = { ...answersRef.current, [questionId]: merged };
    setAnswers((prev) => ({ ...prev, [questionId]: merged }));

    if (debounceTimersRef.current[questionId]) {
      window.clearTimeout(debounceTimersRef.current[questionId]);
    }

    if (immediate) {
      void sendAutosave(questionId, merged);
    } else {
      setSaveState('SAVING');
      debounceTimersRef.current[questionId] = window.setTimeout(() => {
        void sendAutosave(questionId, answersRef.current[questionId]);
      }, 700);
    }
  };

  const toggleFlagQuestion = (questionId: number) => {
    const next = flaggedRef.current.includes(questionId)
      ? flaggedRef.current.filter((id) => id !== questionId)
      : [...flaggedRef.current, questionId];
    flaggedRef.current = next;
    setFlaggedIds(next);
    void sendAutosave(undefined, undefined, next);
  };

  const flushCurrentAndNavigate = (targetIndex: number) => {
    if (!examData) return;
    if (targetIndex < 0 || targetIndex >= examData.questions.length) return;
    if (!examData.exam.allowNavigation && targetIndex < currentIdx) return;

    const currentQ = examData.questions[currentIdx];
    if (currentQ && debounceTimersRef.current[currentQ.id]) {
      window.clearTimeout(debounceTimersRef.current[currentQ.id]);
      delete debounceTimersRef.current[currentQ.id];
      void sendAutosave(currentQ.id, answersRef.current[currentQ.id]);
    }
    setCurrentIdx(targetIndex);
  };

  const handleFileUpload = (questionId: number, file: File | null) => {
    if (!file) return;
    if (file.size > 1.8 * 1024 * 1024) {
      setError('حجم الملف المرفوع يجب ألا يتجاوز 1.8 ميجابايت.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateAnswer(
        questionId,
        {
          uploadedFileName: file.name,
          uploadedFileData: String(reader.result || ''),
        },
        true,
      );
    };
    reader.readAsDataURL(file);
  };

  const stats = useMemo(() => {
    const qs = examData?.questions || [];
    let answered = 0;
    for (const q of qs) {
      if (isQuestionAnswered(answers[q.id])) answered += 1;
    }
    return {
      total: qs.length,
      answered,
      unanswered: Math.max(0, qs.length - answered),
      flagged: flaggedIds.length,
    };
  }, [examData, answers, flaggedIds]);

  const formatTimer = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
        جارٍ تحميل بيانات وتعليمات الامتحان...
      </div>
    );
  }

  if (error && !brief && !examData) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-bold text-red-800">{error}</p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-lg bg-[#0B162C] px-5 py-2 text-sm font-semibold text-white"
        >
          العودة إلى قائمة الامتحانات
        </button>
      </div>
    );
  }

  // =========================================================================
  // STAGE 1: INSTRUCTION & CONFIRMATION SCREEN
  // =========================================================================
  if (stage === 'BRIEF' && brief) {
    const ex = brief.exam;
    const isResuming = Boolean(brief.inProgressAttemptId);

    return (
      <div className="mx-auto max-w-3xl space-y-5" data-testid="exam-brief-screen">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-[#0B162C]"
        >
          <ArrowRight className="h-4 w-4" />
          <span>العودة إلى الامتحانات</span>
        </button>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-[#0B162C] p-6 text-white">
            <div className="text-xs font-semibold text-[#93C5FD]">
              {EXAM_TYPE_LABELS[ex.examType] || ex.examType}
            </div>
            <h1 className="mt-1 text-2xl font-extrabold">{ex.titleAr}</h1>
            {ex.descriptionAr && (
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{ex.descriptionAr}</p>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Key Exam Metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                <div className="text-[11px] text-slate-500">مدة الامتحان</div>
                <div className="mt-1 font-mono-num text-lg font-extrabold text-[#0B162C]">
                  {ex.durationMin} دقيقة
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                <div className="text-[11px] text-slate-500">عدد الأسئلة</div>
                <div className="mt-1 font-mono-num text-lg font-extrabold text-[#0B162C]">
                  {ex.questionCount} سؤال
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                <div className="text-[11px] text-slate-500">الدرجة الكلية</div>
                <div className="mt-1 font-mono-num text-lg font-extrabold text-[#2563EB]">
                  {ex.totalMarks} درجة
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                <div className="text-[11px] text-slate-500">المحاولات المتبقية</div>
                <div className="mt-1 font-mono-num text-lg font-extrabold text-[#0B162C]">
                  {ex.remainingAttempts} / {ex.maxAttempts}
                </div>
              </div>
            </div>

            {/* Teacher Custom Instructions */}
            {ex.instructionsAr && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div className="text-xs font-bold text-[#2563EB]">تعليمات الأستاذ قبل البدء:</div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-[#0B162C]">
                  {ex.instructionsAr}
                </p>
              </div>
            )}

            {/* System Rules */}
            <div className="space-y-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#0B162C]">
                <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
                <span>قواعد وضوابط الامتحان</span>
              </h2>
              <ul className="space-y-2 text-xs leading-relaxed text-slate-700">
                <li>
                  • يبدأ العداد التنازلي المرتبط بالخادم فور الضغط على «بدء الامتحان»، ويتم التسليم
                  التلقائي بمجرد انتهاء الوقت.
                </li>
                <li>
                  • يتم حفظ إجاباتك تلقائيًا مع كل سؤال؛ وفي حالة انقطاع الإنترنت أو إعادة تحميل
                  الصفحة يمكنك استئناف نفس المحاولة دون فقدان إجاباتك.
                </li>
                <li>
                  • نسبة النجاح المطلوبة لاجتياز هذا الامتحان هي{' '}
                  <strong className="font-mono-num">{ex.passScorePercent}%</strong>.
                </li>
                <li>
                  •{' '}
                  {ex.allowNavigation
                    ? 'يمكنك التنقل بحرية بين الأسئلة وتحديد أسئلة للمراجعة قبل التسليم.'
                    : 'التنقل الخطي مفعّل: يجب حل كل سؤال والانتقال للتالي دون الرجوع للأسئلة السابقة.'}
                </li>
                {ex.allowNegativeMarking && (
                  <li className="font-bold text-amber-800">
                    • تنبيه: نظام الخصم على الإجابات الخاطئة مفعّل في بعض أسئلة هذا الامتحان.
                  </li>
                )}
                <li>
                  •{' '}
                  {ex.showResultImmediately
                    ? 'تظهر نتيجة الأسئلة الموضوعية فور التسليم.'
                    : 'تظهر النتيجة النهائية بعد مراجعة واعتماد المدرس في قسم «نتائجي».'}
                </li>
                {ex.endsAt && (
                  <li>• آخر موعد متاح لتسليم الامتحان: {formatDateTimeAr(ex.endsAt)}.</li>
                )}
              </ul>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                {error}
              </div>
            )}

            {!brief.canStart ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                {brief.reasonAr || 'هذا الامتحان غير متاح للبدء حاليًا.'}
              </div>
            ) : (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                {!isResuming && (
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs font-semibold text-[#0B162C]">
                    <input
                      type="checkbox"
                      checked={confirmedInstructions}
                      onChange={(e) => setConfirmedInstructions(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>
                      أقر بأنني قرأت تعليمات وضوابط الامتحان وأنا مستعد لبدء المحاولة الآن.
                    </span>
                  </label>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onExit}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-start-exam-btn"
                    disabled={starting || (!isResuming && !confirmedInstructions)}
                    onClick={() => void handleStartExam()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      {starting
                        ? 'جارٍ تجهيز الأسئلة...'
                        : isResuming
                          ? 'استئناف المحاولة المفتوحة'
                          : 'تأكيد وبدء الامتحان الآن'}
                    </span>
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // STAGE 3: SUBMITTED RESULT SCREEN (STRICTLY RESPECTS VISIBILITY SETTINGS)
  // =========================================================================
  if (stage === 'SUBMITTED' && result && examData) {
    return (
      <div className="mx-auto max-w-4xl space-y-6" data-testid="exam-submitted-screen">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <div className="text-xs font-semibold text-[#2563EB]">
                {autoSubmittedNotice ? 'تم التسليم التلقائي بانتهاء الوقت' : 'تم تسليم الامتحان بنجاح'}
              </div>
              <h2 className="mt-1 text-2xl font-extrabold text-[#0B162C]">
                {examData.exam.titleAr}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenResults && (
                <button
                  type="button"
                  onClick={onOpenResults}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8]"
                >
                  <Award className="h-4 w-4" />
                  <span>عرض في نتائجي</span>
                </button>
              )}
              <button
                type="button"
                onClick={onExit}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B162C] hover:bg-slate-50"
              >
                العودة للامتحانات
              </button>
            </div>
          </div>

          {!result.showResultImmediately || !result.resultPublished ? (
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/70 p-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-[#2563EB]" />
              <h3 className="mt-3 text-lg font-extrabold text-[#0B162C]">
                تم استلام وتسجيل إجاباتك بنجاح
              </h3>
              <p className="mt-1.5 text-sm text-slate-600">
                {result.summary.hasManualQuestions
                  ? 'يحتوي الامتحان على أسئلة مقالية/يدوية سيقوم الأستاذ بتصحيحها ثم نشر الدرجة النهائية في قسم «نتائجي».'
                  : 'تم حفظ محاولتك، وستظهر الدرجة والتفاصيل في قسم «نتائجي» فور اعتماد ونشر المدرس.'}
              </p>
              {result.showResultImmediately && result.summary.autoScore !== null && (
                <div className="mt-4 inline-block rounded-lg border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-[#0B162C]">
                  درجة الأسئلة المصححة تلقائيًا حتى الآن:{' '}
                  <span className="font-mono-num text-[#2563EB]">
                    {result.summary.autoScore} / {result.summary.maxScore}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-5">
                  <div className="text-xs text-slate-500">الدرجة المحققة</div>
                  <div className="mt-1 font-mono-num text-3xl font-extrabold text-[#0B162C]">
                    {result.summary.autoScore} / {result.summary.maxScore}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-5">
                  <div className="text-xs text-slate-500">النسبة المئوية</div>
                  <div className="mt-1 font-mono-num text-3xl font-extrabold text-[#2563EB]">
                    {result.summary.percent}%
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-5">
                  <div className="text-xs text-slate-500">نتيجة الاجتياز</div>
                  <div
                    className={`mt-2 text-base font-extrabold ${
                      result.summary.passed ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {result.summary.passed
                      ? 'ناجح ومجتاز للامتحان'
                      : 'لم تصل لنسبة النجاح — راجع الدروس'}
                  </div>
                </div>
              </div>

              {(result.summary.correctCount !== undefined ||
                result.summary.unansweredCount !== undefined) && (
                <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold">
                  <span className="text-emerald-700 font-mono-num">
                    صحيح: {result.summary.correctCount ?? 0}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-red-700 font-mono-num">
                    خطأ: {result.summary.incorrectCount ?? 0}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-600 font-mono-num">
                    بدون إجابة: {result.summary.unansweredCount ?? 0}
                  </span>
                </div>
              )}

              {/* Lesson Analytics */}
              {result.summary.lessonAnalytics.length > 0 && (
                <div className="mt-7">
                  <h3 className="text-sm font-extrabold text-[#0B162C]">
                    تحليل الأداء ونقاط القوة والضعف حسب الدرس
                  </h3>
                  <div className="mt-3 space-y-2.5">
                    {result.summary.lessonAnalytics.map((item) => (
                      <div key={item.lessonId} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-[#0B162C]">{item.lessonTitleAr}</span>
                          <span className="font-mono-num font-bold">
                            {item.percent}% ·{' '}
                            {item.level === 'STRONG'
                              ? 'نقطة قوة'
                              : item.level === 'AVERAGE'
                                ? 'مستوى جيد'
                                : 'يحتاج مراجعة'}
                          </span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            style={{ width: `${item.percent}%` }}
                            className={`h-full rounded-full ${
                              item.level === 'STRONG'
                                ? 'bg-emerald-600'
                                : item.level === 'AVERAGE'
                                  ? 'bg-[#2563EB]'
                                  : 'bg-amber-600'
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed Answer Review (only if allowed by teacher) */}
              {result.showCorrectAnswers && result.review.length > 0 && (
                <div className="mt-7 space-y-3.5">
                  <h3 className="text-sm font-extrabold text-[#0B162C]">
                    مراجعة الإجابات والحل النموذجي
                  </h3>
                  {result.review.map((r, idx) => (
                    <div key={r.questionId} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-bold text-[#0B162C]">
                          {idx + 1}. {r.promptAr}
                        </div>
                        <div className="shrink-0 font-mono-num text-xs font-bold">
                          {r.needsManualGrading ? (
                            <span className="text-amber-700">قيد التصحيح اليدوي</span>
                          ) : r.isCorrect ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              {r.awardedPoints}/{r.points}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-700">
                              <XCircle className="h-4 w-4" />
                              {r.awardedPoints}/{r.points}
                            </span>
                          )}
                        </div>
                      </div>
                      {r.latexFormula && <MathFormula formula={r.latexFormula} block />}
                      {((r.imageUrl && r.imageUrl.trim()) ||
                        (r.questionImages && r.questionImages.length > 0)) && (
                        <div className="mt-3">
                          <QuestionImageGallery
                            variant="compact"
                            images={[
                              ...(r.imageUrl ? [{ url: r.imageUrl, alt: 'صورة السؤال' }] : []),
                              ...(r.questionImages || []).map((img, iIdx) => ({
                                url: img.previewUrl,
                                alt: img.fileName || `صورة السؤال ${iIdx + 1}`,
                              })),
                            ]}
                          />
                        </div>
                      )}
                      {(r.correctNumericAnswer ||
                        r.modelAnswerAr ||
                        r.explanationAr ||
                        (r.modelAnswerFiles && r.modelAnswerFiles.length > 0)) && (
                        <div className="mt-3 space-y-2 rounded-lg bg-[#F7F9FC] p-3 text-xs text-slate-700">
                          {r.correctNumericAnswer && (
                            <div>
                              <strong>الإجابة الرقمية الصحيحة: </strong>
                              <span className="font-mono-num font-bold text-emerald-700">
                                {r.correctNumericAnswer} {r.numericUnit || ''}
                              </span>
                            </div>
                          )}
                          {r.modelAnswerAr && (
                            <div>
                              <strong>الإجابة النموذجية: </strong>
                              <span className="whitespace-pre-line">{r.modelAnswerAr}</span>
                            </div>
                          )}
                          {r.explanationAr && (
                            <div>
                              <strong>التفسير العلمي: </strong>
                              <span className="whitespace-pre-line">{r.explanationAr}</span>
                            </div>
                          )}
                          {r.modelAnswerFiles && r.modelAnswerFiles.length > 0 && (
                            <div className="pt-1 space-y-2">
                              <strong className="block">صور/ملفات الحل النموذجي:</strong>
                              <div className="flex flex-wrap gap-2">
                                {r.modelAnswerFiles
                                  .filter((mf) => mf.mimeType === 'application/pdf')
                                  .map((mf) => (
                                    <a
                                      key={mf.storageKey}
                                      href={mf.previewUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-bold text-[#2563EB] hover:bg-blue-50"
                                    >
                                      <span>فتح PDF: {mf.fileName}</span>
                                    </a>
                                  ))}
                              </div>
                              <QuestionImageGallery
                                variant="answer"
                                images={r.modelAnswerFiles
                                  .filter((mf) => mf.mimeType !== 'application/pdf')
                                  .map((mf) => ({
                                    url: mf.previewUrl,
                                    alt: mf.fileName,
                                  }))}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // STAGE 2: ACTIVE EXAM PLAYER (SINGLE-QUESTION FOCUS + NAVIGATOR + TIMER)
  // =========================================================================
  if (!examData) return null;
  const activeQuestion = examData.questions[currentIdx];
  const activeDraft = activeQuestion ? answers[activeQuestion.id] || {} : {};
  const isFlagged = activeQuestion ? flaggedIds.includes(activeQuestion.id) : false;
  const canGoPrev = examData.exam.allowNavigation && currentIdx > 0;
  const isLastQuestion = currentIdx === examData.questions.length - 1;

  return (
    <div className="space-y-5" data-testid="exam-player-stage">
      {/* Sticky Exam Player Top Bar */}
      <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onExit}
            title="الخروج مؤقتًا (سيستمر المؤقت)"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold text-[#0B162C] sm:text-base">
              {examData.exam.titleAr}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="font-mono-num">
                السؤال {currentIdx + 1} من {examData.questions.length}
              </span>
              <span>·</span>
              <span className="font-mono-num">تمت الإجابة: {stats.answered}</span>
              {saveState === 'SAVING' && (
                <>
                  <span>·</span>
                  <span className="text-[#2563EB] font-semibold">جارٍ الحفظ...</span>
                </>
              )}
              {saveState === 'SAVED' && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <Save className="h-3 w-3" />
                    تم الحفظ التلقائي
                  </span>
                </>
              )}
              {saveState === 'OFFLINE' && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                    <WifiOff className="h-3 w-3" />
                    بانتظار عودة الاتصال
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            data-testid="exam-timer"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono-num text-sm font-extrabold ${
              remainingSec <= 180
                ? 'border-red-300 bg-red-50 text-red-700'
                : 'border-slate-200 bg-[#F7F9FC] text-[#0B162C]'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>{formatTimer(remainingSec)}</span>
          </div>

          {examData.exam.allowReviewBeforeSubmit && (
            <button
              type="button"
              onClick={() => setReviewModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-50"
            >
              <ListChecks className="h-4 w-4" />
              <span>مراجعة</span>
            </button>
          )}

          <button
            type="button"
            data-testid="open-submit-modal-btn"
            disabled={submitting}
            onClick={() =>
              examData.exam.allowReviewBeforeSubmit
                ? setReviewModalOpen(true)
                : setConfirmSubmitOpen(true)
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            <Send className="h-3.5 w-3.5" />
            <span>تسليم الامتحان</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Main Responsive Split: Active Question + Navigation Sidebar */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Question Card */}
        <div className="lg:col-span-8 space-y-4">
          {activeQuestion && (
            <div
              key={activeQuestion.id}
              data-testid={`active-question-${activeQuestion.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-600">
                  <span className="rounded bg-[#0B162C] px-2 py-0.5 font-mono-num font-bold text-white">
                    سؤال {currentIdx + 1}
                  </span>
                  <span className="font-semibold text-[#2563EB]">
                    {QUESTION_TYPE_LABELS[activeQuestion.questionType] || activeQuestion.questionType}
                  </span>
                  <span>·</span>
                  <span className="font-mono-num font-bold text-[#0B162C]">
                    {activeQuestion.points} درجة
                  </span>
                  {activeQuestion.negativePoints > 0 && (
                    <span className="font-mono-num text-amber-700">
                      (خصم خطأ: -{activeQuestion.negativePoints})
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  data-testid="flag-question-btn"
                  onClick={() => toggleFlagQuestion(activeQuestion.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                    isFlagged
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>{isFlagged ? 'مُحدد للمراجعة' : 'تحديد للمراجعة'}</span>
                </button>
              </div>

              <p className="mt-4 whitespace-pre-line text-base font-bold leading-relaxed text-[#0B162C] sm:text-lg">
                {activeQuestion.promptAr}
              </p>

              {activeQuestion.latexFormula && (
                <div className="my-4 rounded-xl border border-slate-100 bg-[#F7F9FC] p-3">
                  <MathFormula formula={activeQuestion.latexFormula} block />
                </div>
              )}

              {((activeQuestion.imageUrl && activeQuestion.imageUrl.trim()) ||
                (activeQuestion.questionImages && activeQuestion.questionImages.length > 0)) && (
                <div className="mt-4">
                  <QuestionImageGallery
                    images={[
                      ...(activeQuestion.imageUrl
                        ? [{ url: activeQuestion.imageUrl, alt: 'رسم توضيحي للسؤال' }]
                        : []),
                      ...(activeQuestion.questionImages || []).map((img, imgIdx) => ({
                        url: img.previewUrl,
                        alt: `صورة السؤال ${imgIdx + 1}`,
                      })),
                    ]}
                  />
                </div>
              )}

              {/* Answer Input Area */}
              {(activeQuestion.questionType === 'MCQ' ||
                activeQuestion.questionType === 'TRUE_FALSE' ||
                activeQuestion.choices.length > 0) && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {activeQuestion.choices.map((ch, cIdx) => {
                    const selected = activeDraft.selectedChoiceId === ch.id;
                    const letter = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'][cIdx] || String(cIdx + 1);
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        data-testid={`choice-btn-${ch.id}`}
                        onClick={() =>
                          updateAnswer(activeQuestion.id, { selectedChoiceId: ch.id }, true)
                        }
                        className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-right text-sm font-semibold transition-colors ${
                          selected
                            ? 'border-[#2563EB] bg-blue-50 text-[#0B162C] ring-1 ring-[#2563EB]'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                              selected
                                ? 'bg-[#2563EB] text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {letter}
                          </span>
                          <span>{ch.labelAr}</span>
                        </span>
                        {ch.latexFormula && <MathFormula formula={ch.latexFormula} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {activeQuestion.questionType === 'NUMERIC' && (
                <div className="mt-5 max-w-sm">
                  <label
                    htmlFor={`num-input-${activeQuestion.id}`}
                    className="mb-1.5 block text-xs font-bold text-slate-700"
                  >
                    أدخل الناتج الرقمي النهائي
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`num-input-${activeQuestion.id}`}
                      data-testid="numeric-answer-input"
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={activeDraft.numericAnswer || ''}
                      onChange={(e) =>
                        updateAnswer(activeQuestion.id, { numericAnswer: e.target.value }, false)
                      }
                      placeholder="مثال: 12.5 أو ١٢٫٥"
                      className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                    {activeQuestion.numericUnit && (
                      <span className="rounded-lg border border-slate-200 bg-[#F7F9FC] px-3 py-2.5 text-xs font-bold text-[#0B162C]">
                        {activeQuestion.numericUnit}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    يمكنك الكتابة بالأرقام الإنجليزية أو العربية (مثل 12.5 أو ١٢٫٥)
                  </p>
                </div>
              )}

              {(activeQuestion.questionType === 'SHORT_ANSWER' ||
                (activeQuestion.questionType === 'IMAGE_DIAGRAM' &&
                  activeQuestion.choices.length === 0)) && (
                <div className="mt-5">
                  <label
                    htmlFor={`short-input-${activeQuestion.id}`}
                    className="mb-1.5 block text-xs font-bold text-slate-700"
                  >
                    أدخل إجابتك المختصرة
                  </label>
                  <input
                    id={`short-input-${activeQuestion.id}`}
                    data-testid="short-answer-input"
                    type="text"
                    value={activeDraft.textAnswer || ''}
                    onChange={(e) =>
                      updateAnswer(activeQuestion.id, { textAnswer: e.target.value }, false)
                    }
                    placeholder="اكتب الإجابة المختصرة هنا..."
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {(activeQuestion.questionType === 'ESSAY' ||
                activeQuestion.questionType === 'PHYSICS_PROBLEM') && (
                <div className="mt-5">
                  <label
                    htmlFor={`essay-input-${activeQuestion.id}`}
                    className="mb-1.5 block text-xs font-bold text-slate-700"
                  >
                    اكتب خطوات الحل والشرح العلمي بالتفصيل (يُصحح يدويًا بواسطة الأستاذ)
                  </label>
                  <textarea
                    id={`essay-input-${activeQuestion.id}`}
                    data-testid="essay-answer-input"
                    rows={5}
                    value={activeDraft.textAnswer || ''}
                    onChange={(e) =>
                      updateAnswer(activeQuestion.id, { textAnswer: e.target.value }, false)
                    }
                    placeholder="اكتب المعطيات والقانون المستخدم والتعويض والنتيجة..."
                    className="w-full rounded-lg border border-slate-300 p-3.5 text-sm leading-relaxed focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}

              {activeQuestion.questionType === 'FILE_UPLOAD' && (
                <div className="mt-5">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-[#F7F9FC] px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                    <FileUp className="h-4 w-4 text-[#2563EB]" />
                    <span>{activeDraft.uploadedFileName || 'ارفع صورة ورقة الحل (حد أقصى 1.8MB)'}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => handleFileUpload(activeQuestion.id, e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Previous / Next Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={() => flushCurrentAndNavigate(currentIdx - 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
              <span>السؤال السابق</span>
            </button>

            <div className="text-xs text-slate-500">
              {!examData.exam.allowNavigation && 'التنقل الخطي مفعّل'}
            </div>

            {!isLastQuestion ? (
              <button
                type="button"
                data-testid="next-question-btn"
                onClick={() => flushCurrentAndNavigate(currentIdx + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B162C] px-5 py-2 text-xs font-bold text-white hover:bg-[#2563EB]"
              >
                <span>السؤال التالي</span>
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  examData.exam.allowReviewBeforeSubmit
                    ? setReviewModalOpen(true)
                    : setConfirmSubmitOpen(true)
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
              >
                <Send className="h-3.5 w-3.5" />
                <span>مراجعة وتسليم الامتحان</span>
              </button>
            )}
          </div>
        </div>

        {/* Question Navigation Panel */}
        <aside className="lg:col-span-4">
          <div className="sticky top-36 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#0B162C]">لوحة التنقل بين الأسئلة</h3>
              <span className="font-mono-num text-xs font-bold text-[#2563EB]">
                {stats.answered}/{stats.total}
              </span>
            </div>

            {/* Numbered Grid */}
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 lg:grid-cols-5">
              {examData.questions.map((q, idx) => {
                const answered = isQuestionAnswered(answers[q.id]);
                const flagged = flaggedIds.includes(q.id);
                const isCurrent = idx === currentIdx;
                const lockedBackward = !examData.exam.allowNavigation && idx !== currentIdx;

                let btnCls = 'border-slate-200 bg-slate-50 text-slate-600';
                if (isCurrent) {
                  btnCls = 'border-[#2563EB] bg-[#2563EB] text-white ring-2 ring-blue-200';
                } else if (flagged) {
                  btnCls = 'border-amber-300 bg-amber-50 text-amber-900';
                } else if (answered) {
                  btnCls = 'border-emerald-300 bg-emerald-50 text-emerald-800';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    disabled={lockedBackward}
                    onClick={() => flushCurrentAndNavigate(idx)}
                    aria-label={`الانتقال إلى السؤال ${idx + 1}`}
                    className={`relative flex h-10 items-center justify-center rounded-lg border font-mono-num text-xs font-bold transition-colors ${btnCls} ${
                      lockedBackward ? 'cursor-not-allowed opacity-50' : 'hover:border-[#2563EB]'
                    }`}
                  >
                    {idx + 1}
                    {flagged && !isCurrent && (
                      <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-[#2563EB]" />
                <span>السؤال الحالي</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-emerald-400 bg-emerald-100" />
                <span>تمت الإجابة ({stats.answered})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-amber-400 bg-amber-100" />
                <span>للمراجعة ({stats.flagged})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-slate-300 bg-slate-100" />
                <span>بدون إجابة ({stats.unanswered})</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Review Before Submit Modal */}
      {reviewModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-[#0B162C]">مراجعة حالة الأسئلة قبل التسليم</h3>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setReviewModalOpen(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="font-mono-num text-xl font-extrabold text-emerald-700">
                  {stats.answered}
                </div>
                <div className="text-[11px] font-semibold text-emerald-800">تمت الإجابة</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="font-mono-num text-xl font-extrabold text-slate-700">
                  {stats.unanswered}
                </div>
                <div className="text-[11px] font-semibold text-slate-600">بدون إجابة</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="font-mono-num text-xl font-extrabold text-amber-800">
                  {stats.flagged}
                </div>
                <div className="text-[11px] font-semibold text-amber-800">محدد للمراجعة</div>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {examData.questions.map((q, idx) => {
                const answered = isQuestionAnswered(answers[q.id]);
                const flagged = flaggedIds.includes(q.id);
                return (
                  <button
                    key={q.id}
                    type="button"
                    disabled={!examData.exam.allowNavigation}
                    onClick={() => {
                      setReviewModalOpen(false);
                      flushCurrentAndNavigate(idx);
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-right text-xs hover:bg-slate-50 disabled:cursor-default"
                  >
                    <span className="truncate font-semibold text-[#0B162C]">
                      {idx + 1}. {q.promptAr}
                    </span>
                    <span className="shrink-0 mr-2 font-bold">
                      {flagged ? (
                        <span className="text-amber-700">للمراجعة</span>
                      ) : answered ? (
                        <span className="text-emerald-700">مُجاب</span>
                      ) : (
                        <span className="text-red-600">غير مُجاب</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                متابعة الحل
              </button>
              <button
                type="button"
                data-testid="proceed-to-confirm-submit-btn"
                onClick={() => {
                  setReviewModalOpen(false);
                  setConfirmSubmitOpen(true);
                }}
                className="rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
              >
                الانتقال لتأكيد التسليم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Confirmation Dialog */}
      {confirmSubmitOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                {stats.unanswered > 0 ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <HelpCircle className="h-5 w-5 text-[#2563EB]" />
                )}
              </div>
              <div>
                <h3 className="text-base font-extrabold text-[#0B162C]">تأكيد التسليم النهائي</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  بمجرد التأكيد لن تتمكن من تعديل إجابات هذه المحاولة.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5 text-xs space-y-1 text-slate-700">
              <div>
                • الأسئلة المُجاب عنها: <strong className="font-mono-num">{stats.answered}</strong> من{' '}
                <strong className="font-mono-num">{stats.total}</strong>
              </div>
              {stats.unanswered > 0 && (
                <div className="font-bold text-amber-800">
                  • تنبيه: يوجد {stats.unanswered} سؤال بدون إجابة!
                </div>
              )}
              {stats.flagged > 0 && (
                <div className="text-amber-700">
                  • يوجد {stats.flagged} سؤال محدد للمراجعة.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmSubmitOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                تراجع
              </button>
              <button
                type="button"
                data-testid="final-confirm-submit-btn"
                disabled={submitting}
                onClick={() => void handleSubmit(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{submitting ? 'جارٍ التسليم...' : 'تأكيد التسليم النهائي'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Lightbox */}
      {zoomImageUrl && (
        <div
          onClick={() => setZoomImageUrl(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4"
        >
          <img
            src={zoomImageUrl}
            alt="تكبير الرسم"
            referrerPolicy="no-referrer"
            className="max-h-[88vh] max-w-[92vw] rounded-xl bg-white object-contain p-2"
          />
        </div>
      )}
    </div>
  );
};
