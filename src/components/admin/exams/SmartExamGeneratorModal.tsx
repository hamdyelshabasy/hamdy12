import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Replace,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, getAuthToken, getDeviceFingerprint } from '../../../lib/api.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import {
  EXAM_TYPE_LABELS,
  QUESTION_TYPE_LABELS,
  type ExamType,
  type QuestionType,
} from '../../../types/exams.ts';
import {
  DIFFICULTY_LABELS,
  type QuestionBankListItem,
  type QuestionDifficulty,
} from '../../../types/questionBank.ts';
import type {
  DistributionMode,
  SmartExamAdjustmentSuggestion,
  SmartExamAvailabilityResponse,
  SmartExamBlueprint,
  SmartExamGenerateErrorResponse,
  SmartExamGenerateSuccessResponse,
  SmartExamPreviewQuestion,
  SmartExamReplacementCandidate,
  SmartExamShortage,
} from '../../../types/smartExamGenerator.ts';
import { QuestionBankPickerModal } from '../questionBank/QuestionBankPickerModal.tsx';
import type { SmartExamWizardTransferPayload } from '../../../types/examWizard.ts';

interface SmartExamGeneratorModalProps {
  open: boolean;
  catalog: AdminCatalogData;
  onClose: () => void;
  onDraftSaved: (examId: number, message: string) => Promise<void> | void;
  onToast: (msg: string) => void;
  onTransferSelection?: (payload: SmartExamWizardTransferPayload) => Promise<void> | void;
  transferButtonLabelAr?: string;
  initialTrackId?: number | null;
  initialGradeId?: number | null;
  initialTitleAr?: string;
}

const ALL_QUESTION_TYPES: QuestionType[] = [
  'MCQ',
  'TRUE_FALSE',
  'NUMERIC',
  'SHORT_ANSWER',
  'ESSAY',
  'IMAGE_DIAGRAM',
  'PHYSICS_PROBLEM',
  'FILE_UPLOAD',
];

const DIFFICULTY_BADGE_CLASS: Record<QuestionDifficulty, string> = {
  EASY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  HARD: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const SmartExamGeneratorModal: React.FC<SmartExamGeneratorModalProps> = ({
  open,
  catalog,
  onClose,
  onDraftSaved,
  onToast,
  onTransferSelection,
  transferButtonLabelAr,
  initialTrackId,
  initialGradeId,
  initialTitleAr,
}) => {
  const defaultTrackId = catalog.tracks[0]?.id || 0;
  const defaultGradeId =
    catalog.grades.find((g) => g.trackId === defaultTrackId)?.id || catalog.grades[0]?.id || 0;

  const [step, setStep] = useState<'blueprint' | 'preview'>('blueprint');

  // Blueprint fields
  const [titleAr, setTitleAr] = useState('');
  const [examType, setExamType] = useState<ExamType>('UNIT_EXAM');
  const [trackId, setTrackId] = useState<number>(defaultTrackId);
  const [gradeId, setGradeId] = useState<number>(defaultGradeId);
  const [unitIds, setUnitIds] = useState<number[]>([]);
  const [lessonIds, setLessonIds] = useState<number[]>([]);
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [totalQuestions, setTotalQuestions] = useState<number>(5);
  const [durationMin, setDurationMin] = useState<number>(45);
  const [passScorePercent, setPassScorePercent] = useState<number>(60);
  const [scoreMode, setScoreMode] = useState<'BANK_DEFAULT' | 'TARGET_TOTAL'>('BANK_DEFAULT');
  const [targetTotalScore, setTargetTotalScore] = useState<number>(20);
  const [excludePreviouslyUsed, setExcludePreviouslyUsed] = useState<boolean>(false);

  // Difficulty distribution
  const [diffMode, setDiffMode] = useState<DistributionMode>('AUTO');
  const [diffEasy, setDiffEasy] = useState<number>(2);
  const [diffMedium, setDiffMedium] = useState<number>(2);
  const [diffHard, setDiffHard] = useState<number>(1);

  // Unit distribution
  const [unitDistMode, setUnitDistMode] = useState<DistributionMode>('AUTO');
  const [unitDistValues, setUnitDistValues] = useState<Record<number, number>>({});

  // Live availability & errors
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availability, setAvailability] = useState<SmartExamAvailabilityResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [shortageError, setShortageError] = useState<string>('');
  const [shortages, setShortages] = useState<SmartExamShortage[]>([]);
  const [suggestions, setSuggestions] = useState<SmartExamAdjustmentSuggestion[]>([]);

  // Preview state
  const [draftTitleAr, setDraftTitleAr] = useState('');
  const [draftQuestions, setDraftQuestions] = useState<SmartExamPreviewQuestion[]>([]);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Replacement drawer state
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);
  const [loadingReplacements, setLoadingReplacements] = useState(false);
  const [replacementCandidates, setReplacementCandidates] = useState<SmartExamReplacementCandidate[]>([]);
  const [replacementMessageAr, setReplacementMessageAr] = useState<string | null>(null);

  // Derived catalog lists
  const trackGrades = useMemo(
    () => catalog.grades.filter((g) => !trackId || g.trackId === trackId),
    [catalog.grades, trackId],
  );
  const gradeUnits = useMemo(
    () => catalog.units.filter((u) => u.gradeId === gradeId),
    [catalog.units, gradeId],
  );
  const availableLessons = useMemo(() => {
    const allowedUnitSet = new Set(unitIds.length > 0 ? unitIds : gradeUnits.map((u) => u.id));
    return catalog.lessons.filter((l) => allowedUnitSet.has(l.unitId));
  }, [catalog.lessons, gradeUnits, unitIds]);

  const activeUnitsForDistribution = useMemo(
    () => (unitIds.length > 0 ? gradeUnits.filter((u) => unitIds.includes(u.id)) : gradeUnits),
    [gradeUnits, unitIds],
  );

  // Sync unit distribution defaults when switching mode or active units
  useEffect(() => {
    if (unitDistMode === 'AUTO' || activeUnitsForDistribution.length === 0) return;
    setUnitDistValues((prev) => {
      const next: Record<number, number> = {};
      const existingValid = activeUnitsForDistribution.some((u) => (prev[u.id] || 0) > 0);
      if (existingValid) {
        for (const u of activeUnitsForDistribution) {
          next[u.id] = prev[u.id] ?? 0;
        }
        return next;
      }
      const targetSum = unitDistMode === 'PERCENT' ? 100 : totalQuestions;
      const base = Math.floor(targetSum / activeUnitsForDistribution.length);
      let rem = targetSum - base * activeUnitsForDistribution.length;
      for (const u of activeUnitsForDistribution) {
        next[u.id] = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
      }
      return next;
    });
  }, [unitDistMode, activeUnitsForDistribution, totalQuestions]);

  // Reset modal cleanly when reopened
  useEffect(() => {
    if (!open) return;
    setStep('blueprint');
    setShortageError('');
    setShortages([]);
    setSuggestions([]);
    setConfirmRegenerateOpen(false);
    setReplacingIndex(null);
    setZoomImageUrl(null);
    if (initialTrackId && initialTrackId > 0) {
      setTrackId(initialTrackId);
    }
    if (initialGradeId && initialGradeId > 0) {
      setGradeId(initialGradeId);
    }
    if (initialTitleAr && initialTitleAr.trim()) {
      setTitleAr(initialTitleAr.trim());
    }
  }, [open, initialTrackId, initialGradeId, initialTitleAr]);

  // Fetch live availability whenever scope filters change
  useEffect(() => {
    if (!open || !trackId || !gradeId) return;
    let cancelled = false;
    setLoadingAvailability(true);
    apiRequest<SmartExamAvailabilityResponse>('/api/admin/phase2-exams/smart-generator/availability', {
      method: 'POST',
      body: JSON.stringify({
        trackId,
        gradeId,
        unitIds,
        lessonIds,
        questionTypes,
        excludePreviouslyUsed,
      }),
    })
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingAvailability(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, trackId, gradeId, unitIds, lessonIds, questionTypes, excludePreviouslyUsed]);

  const unitAvailMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of availability?.byUnit || []) {
      if (row.unitId !== null) map.set(row.unitId, row.count);
    }
    return map;
  }, [availability]);

  // Client-side math validation feedback
  const mathValidationError = useMemo(() => {
    if (totalQuestions < 1 || totalQuestions > 100) {
      return 'إجمالي عدد الأسئلة يجب أن يكون بين 1 و 100.';
    }
    if (durationMin < 1 || durationMin > 360) {
      return 'مدة الامتحان يجب أن تكون بين 1 و 360 دقيقة.';
    }
    if (scoreMode === 'TARGET_TOTAL' && targetTotalScore < totalQuestions) {
      return 'الدرجة الكلية المستهدفة يجب أن تكون أكبر من أو تساوي عدد الأسئلة.';
    }
    if (diffMode === 'COUNT') {
      const sum = diffEasy + diffMedium + diffHard;
      if (sum !== totalQuestions) {
        return `مجموع توزيع الصعوبة (${sum}) يجب أن يساوي إجمالي الأسئلة (${totalQuestions}).`;
      }
    } else if (diffMode === 'PERCENT') {
      const sum = diffEasy + diffMedium + diffHard;
      if (Math.abs(sum - 100) > 0.01) {
        return `مجموع نسب الصعوبة (${sum}%) يجب أن يساوي 100%.`;
      }
    }
    if (unitDistMode !== 'AUTO' && activeUnitsForDistribution.length > 0) {
      const sum = activeUnitsForDistribution.reduce((acc, u) => acc + (Number(unitDistValues[u.id]) || 0), 0);
      if (unitDistMode === 'COUNT' && sum !== totalQuestions) {
        return `مجموع توزيع الوحدات (${sum}) يجب أن يساوي إجمالي الأسئلة (${totalQuestions}).`;
      }
      if (unitDistMode === 'PERCENT' && Math.abs(sum - 100) > 0.01) {
        return `مجموع نسب الوحدات (${sum}%) يجب أن يساوي 100%.`;
      }
    }
    return '';
  }, [
    totalQuestions,
    durationMin,
    scoreMode,
    targetTotalScore,
    diffMode,
    diffEasy,
    diffMedium,
    diffHard,
    unitDistMode,
    activeUnitsForDistribution,
    unitDistValues,
  ]);

  const buildBlueprintPayload = useCallback(
    (seedOverride?: number): SmartExamBlueprint => ({
      titleAr: titleAr.trim() || undefined,
      examType,
      trackId,
      gradeId,
      unitIds,
      lessonIds,
      questionTypes,
      totalQuestions,
      durationMin,
      scoreMode,
      targetTotalScore: scoreMode === 'TARGET_TOTAL' ? targetTotalScore : null,
      difficultyDistribution: {
        mode: diffMode,
        easy: diffMode === 'AUTO' ? 0 : diffEasy,
        medium: diffMode === 'AUTO' ? 0 : diffMedium,
        hard: diffMode === 'AUTO' ? 0 : diffHard,
      },
      unitDistributionMode: unitDistMode,
      unitDistribution:
        unitDistMode === 'AUTO'
          ? []
          : activeUnitsForDistribution.map((u) => ({
              unitId: u.id,
              value: Number(unitDistValues[u.id]) || 0,
            })),
      excludePreviouslyUsed,
      seed: seedOverride,
    }),
    [
      titleAr,
      examType,
      trackId,
      gradeId,
      unitIds,
      lessonIds,
      questionTypes,
      totalQuestions,
      durationMin,
      scoreMode,
      targetTotalScore,
      diffMode,
      diffEasy,
      diffMedium,
      diffHard,
      unitDistMode,
      activeUnitsForDistribution,
      unitDistValues,
      excludePreviouslyUsed,
    ],
  );

  const runGeneration = useCallback(
    async (blueprintOverride?: SmartExamBlueprint) => {
      setGenerating(true);
      setShortageError('');
      setShortages([]);
      setSuggestions([]);
      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': getDeviceFingerprint(),
          'X-Proxy-Safe-Errors': '1',
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const payload = blueprintOverride || buildBlueprintPayload(Math.floor(Math.random() * 2000000000) + 1);
        const resp = await fetch('/api/admin/phase2-exams/smart-generator/generate', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = (await resp.json().catch(() => ({}))) as
          | SmartExamGenerateSuccessResponse
          | SmartExamGenerateErrorResponse
          | { error?: string };

        if (!resp.ok) {
          if (resp.status === 422 && 'shortages' in data) {
            setShortageError(data.error);
            setShortages(data.shortages || []);
            setSuggestions(data.suggestions || []);
            if (data.availability) setAvailability(data.availability);
            setStep('blueprint');
            return;
          }
          setShortageError(('error' in data && data.error) || 'تعذر توليد مسودة الامتحان الذكي.');
          return;
        }

        if ('ok' in data && data.ok) {
          setDraftTitleAr(data.suggestedTitleAr);
          setDraftQuestions(data.questions);
          setHasManualEdits(false);
          setConfirmRegenerateOpen(false);
          setReplacingIndex(null);
          setStep('preview');
        }
      } catch (err) {
        setShortageError((err as Error).message || 'حدث خطأ أثناء الاتصال بالخادم.');
      } finally {
        setGenerating(false);
      }
    },
    [buildBlueprintPayload],
  );

  const applySuggestion = (suggestion: SmartExamAdjustmentSuggestion) => {
    const p = suggestion.patch;
    if (typeof p.totalQuestions === 'number') setTotalQuestions(p.totalQuestions);
    if (typeof p.excludePreviouslyUsed === 'boolean') setExcludePreviouslyUsed(p.excludePreviouslyUsed);
    if (Array.isArray(p.questionTypes)) setQuestionTypes(p.questionTypes);
    if (Array.isArray(p.unitIds)) setUnitIds(p.unitIds);
    if (Array.isArray(p.lessonIds)) setLessonIds(p.lessonIds);
    if (p.difficultyDistribution) {
      setDiffMode(p.difficultyDistribution.mode);
      setDiffEasy(p.difficultyDistribution.easy);
      setDiffMedium(p.difficultyDistribution.medium);
      setDiffHard(p.difficultyDistribution.hard);
    }
    if (p.unitDistributionMode) {
      setUnitDistMode(p.unitDistributionMode);
      if (p.unitDistributionMode === 'AUTO') setUnitDistValues({});
    }
    setShortageError('');
    setShortages([]);
    setSuggestions([]);
    onToast(`تم تطبيق التعديل المقترح: ${suggestion.labelAr}`);
  };

  // Live preview distribution summary
  const liveSummary = useMemo(() => {
    const byDifficulty: Record<QuestionDifficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    const byQuestionType: Record<string, number> = {};
    const byUnitMap = new Map<string, { unitId: number | null; unitNameAr: string; count: number }>();
    let totalMarks = 0;

    for (const q of draftQuestions) {
      totalMarks += Math.max(1, Number(q.points) || 1);
      byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
      byQuestionType[q.questionType] = (byQuestionType[q.questionType] || 0) + 1;
      const key = q.unitId === null ? 'null' : String(q.unitId);
      const ex = byUnitMap.get(key);
      if (ex) ex.count += 1;
      else byUnitMap.set(key, { unitId: q.unitId, unitNameAr: q.unitNameAr || 'عام', count: 1 });
    }

    return {
      totalQuestions: draftQuestions.length,
      totalMarks,
      byDifficulty,
      byUnit: Array.from(byUnitMap.values()),
      byQuestionType,
    };
  }, [draftQuestions]);

  // Preview editing actions
  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= draftQuestions.length) return;
    setDraftQuestions((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next.map((item, idx) => ({ ...item, sortOrder: idx + 1 }));
    });
    setHasManualEdits(true);
  };

  const handlePointsChange = (index: number, newPoints: number) => {
    const safePts = Math.max(1, Math.min(200, Math.round(newPoints || 1)));
    setDraftQuestions((prev) =>
      prev.map((q, idx) => (idx === index ? { ...q, points: safePts } : q)),
    );
    setHasManualEdits(true);
  };

  const handleDeleteQuestion = (index: number) => {
    setDraftQuestions((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((item, idx) => ({ ...item, sortOrder: idx + 1 })),
    );
    setHasManualEdits(true);
    if (replacingIndex === index) setReplacingIndex(null);
  };

  const handleOpenReplace = async (index: number) => {
    const target = draftQuestions[index];
    if (!target) return;
    setReplacingIndex(index);
    setLoadingReplacements(true);
    setReplacementCandidates([]);
    setReplacementMessageAr(null);
    try {
      const res = await apiRequest<{
        candidates: SmartExamReplacementCandidate[];
        messageAr: string | null;
      }>('/api/admin/phase2-exams/smart-generator/replacements', {
        method: 'POST',
        body: JSON.stringify({
          targetBankQuestionId: target.bankQuestionId,
          excludeBankQuestionIds: draftQuestions.map((q) => q.bankQuestionId),
          trackId,
          gradeId,
          unitIds,
          questionTypes,
          excludePreviouslyUsed,
        }),
      });
      setReplacementCandidates(res.candidates || []);
      setReplacementMessageAr(res.messageAr || null);
    } catch (err) {
      setReplacementMessageAr((err as Error).message || 'تعذر تحميل البدائل المتاحة.');
    } finally {
      setLoadingReplacements(false);
    }
  };

  const handleConfirmReplacement = (candidate: SmartExamReplacementCandidate) => {
    if (replacingIndex === null) return;
    setDraftQuestions((prev) =>
      prev.map((q, idx) =>
        idx === replacingIndex
          ? {
              ...candidate,
              sortOrder: idx + 1,
              points: q.points, // preserve slot score (teacher can edit if desired)
            }
          : q,
      ),
    );
    setHasManualEdits(true);
    setReplacingIndex(null);
    onToast('تم استبدال السؤال بنجاح مع الحفاظ على باقي أسئلة المسودة.');
  };

  const handleManualAddQuestions = (picked: QuestionBankListItem[]) => {
    const existingIds = new Set(draftQuestions.map((q) => q.bankQuestionId));
    const filtered = picked.filter((item) => {
      if (existingIds.has(item.id)) return false;
      if (item.gradeId !== gradeId) return false;
      return true;
    });
    const skippedWrongGrade = picked.filter((item) => item.gradeId !== gradeId).length;
    if (skippedWrongGrade > 0) {
      onToast(`تم تخطي ${skippedWrongGrade} سؤال لأنها تنتمي لصف دراسي مختلف عن الصف المحدد للامتحان.`);
    }
    if (filtered.length === 0) return;

    const mapped: SmartExamPreviewQuestion[] = filtered.map((item, offset) => ({
      bankQuestionId: item.id,
      bankCode: item.bankCode || null,
      sortOrder: draftQuestions.length + offset + 1,
      trackId: item.trackId,
      gradeId: item.gradeId,
      unitId: item.unitId,
      unitNameAr: item.unitTitleAr || null,
      lessonId: item.lessonId,
      lessonNameAr: item.lessonTitleAr || null,
      topicAr: item.topicAr || null,
      questionType: item.questionType as QuestionType,
      difficulty: item.difficulty as QuestionDifficulty,
      promptAr: item.promptAr || (item.topicAr ? `سؤال مصور — ${item.topicAr}` : 'سؤال مصور من بنك الأسئلة'),
      latexFormula: item.latexFormula || null,
      imageUrl: item.imageUrl || null,
      questionImages: (item.questionImages || []).map((img) => ({
        storageKey: img.storageKey,
        fileName: img.fileName,
        mimeType: img.mimeType,
        sizeBytes: img.sizeBytes,
        displayOrder: img.displayOrder,
        previewUrl: img.previewUrl || '',
      })),
      points: Math.max(1, item.points || 2),
      defaultBankPoints: Math.max(1, item.points || 2),
      usedPreviously: false,
      choices: [],
      hasModelAnswer: item.hasModelAnswer,
    }));

    setDraftQuestions((prev) =>
      [...prev, ...mapped].map((item, idx) => ({ ...item, sortOrder: idx + 1 })),
    );
    setHasManualEdits(true);
    onToast(`تمت إضافة ${mapped.length} سؤال يدويًا إلى مسودة الامتحان.`);
  };

  const handleSaveAsDraft = async () => {
    if (draftQuestions.length === 0) {
      onToast('يجب أن تحتوي المسودة على سؤال واحد على الأقل قبل الحفظ.');
      return;
    }
    if (!onTransferSelection && draftTitleAr.trim().length < 3) {
      onToast('يرجى كتابة عنوان للامتحان لا يقل عن 3 أحرف.');
      return;
    }
    setSavingDraft(true);
    try {
      if (onTransferSelection) {
        await onTransferSelection({
          titleAr: draftTitleAr.trim() || titleAr.trim() || 'امتحان فيزياء',
          trackId,
          gradeId,
          unitIds,
          lessonIds,
          examType,
          durationMin,
          passScorePercent,
          questions: draftQuestions.map((q) => ({
            bankQuestionId: q.bankQuestionId,
            points: Math.max(1, Number(q.points) || 1),
          })),
        });
        onClose();
        return;
      }

      const res = await apiRequest<{
        exam: { id: number; titleAr: string };
        addedCount: number;
        totalMarks: number;
        message: string;
      }>('/api/admin/phase2-exams/smart-generator/save-draft', {
        method: 'POST',
        body: JSON.stringify({
          titleAr: draftTitleAr.trim(),
          trackId,
          gradeId,
          unitId: unitIds.length === 1 ? unitIds[0] : null,
          lessonId: lessonIds.length === 1 ? lessonIds[0] : null,
          examType,
          durationMin,
          passScorePercent,
          questions: draftQuestions.map((q) => ({
            bankQuestionId: q.bankQuestionId,
            points: Math.max(1, Number(q.points) || 1),
          })),
        }),
      });

      await onDraftSaved(res.exam.id, res.message);
      onClose();
    } catch (err) {
      onToast((err as Error).message || 'تعذر حفظ مسودة الامتحان.');
    } finally {
      setSavingDraft(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-exam-modal-title"
      data-testid="smart-exam-generator-modal"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#0B162C] px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2563EB] text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="smart-exam-modal-title" className="text-base font-extrabold">
                إنشاء امتحان ذكي من بنك الأسئلة
              </h2>
              <p className="text-xs text-slate-300">
                توليد مسودة امتحان متوازنة من الأسئلة المعتمدة فقط مع معاينة كاملة وتعديل قبل الحفظ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs font-bold">
              <span
                className={`rounded-lg px-2.5 py-1 ${
                  step === 'blueprint' ? 'bg-[#2563EB] text-white' : 'bg-white/10 text-slate-300'
                }`}
              >
                1. مواصفات الامتحان
              </span>
              <span className="text-slate-500">/</span>
              <span
                className={`rounded-lg px-2.5 py-1 ${
                  step === 'preview' ? 'bg-[#2563EB] text-white' : 'bg-white/10 text-slate-300'
                }`}
              >
                2. معاينة المسودة ({draftQuestions.length})
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق نافذة إنشاء الامتحان الذكي"
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {step === 'blueprint' ? (
            <div className="space-y-6">
              {/* Live Availability Banner */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3"
                data-testid="smart-exam-availability-bar"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B162C]">
                  <Layers className="h-4 w-4 text-[#2563EB]" />
                  <span>الأسئلة المعتمدة المتاحة وفق النطاق الحالي:</span>
                  {loadingAvailability ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB]" />
                  ) : (
                    <span className="rounded-md bg-[#2563EB] px-2 py-0.5 text-white">
                      {availability?.totalEligible ?? 0} سؤال
                    </span>
                  )}
                </div>
                {availability && !loadingAvailability && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      سهل: {availability.byDifficulty.EASY}
                    </span>
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                      متوسط: {availability.byDifficulty.MEDIUM}
                    </span>
                    <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                      صعب: {availability.byDifficulty.HARD}
                    </span>
                    {excludePreviouslyUsed && availability.excludedUsedCount > 0 && (
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                        مستبعد (مستخدم سابقًا): {availability.excludedUsedCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Shortage Diagnostics & Safe Suggestions Panel */}
              {(shortageError || shortages.length > 0) && (
                <div
                  className="rounded-xl border border-rose-300 bg-rose-50 p-4 space-y-3"
                  data-testid="smart-exam-shortage-panel"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                    <div className="space-y-1 text-xs">
                      <p className="font-extrabold text-rose-900">
                        تعذر توليد الامتحان بالقيود الحالية — الأسئلة المعتمدة غير كافية
                      </p>
                      {shortages.length > 0 ? (
                        <ul className="list-disc pr-4 space-y-1 text-rose-800">
                          {shortages.map((s, idx) => (
                            <li key={idx}>{s.messageAr}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-rose-800">{shortageError}</p>
                      )}
                    </div>
                  </div>

                  {suggestions.length > 0 && (
                    <div className="border-t border-rose-200 pt-3">
                      <p className="mb-2 text-[11px] font-extrabold text-rose-900">
                        تعديلات مقترحة آمنة (اضغط لتطبيق التعديل ثم أعد التوليد):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((sug, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => applySuggestion(sug)}
                            title={sug.descriptionAr}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-900 hover:bg-rose-100"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-rose-600" />
                            <span>{sug.labelAr}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 1: Basic Info & Scope */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <label htmlFor="smart-title" className="mb-1 block text-xs font-bold text-slate-700">
                    عنوان الامتحان (اختياري)
                  </label>
                  <input
                    id="smart-title"
                    type="text"
                    value={titleAr}
                    onChange={(e) => setTitleAr(e.target.value)}
                    placeholder="اتركه فارغًا لتوليد عنوان تلقائي مناسب..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="smart-exam-type" className="mb-1 block text-xs font-bold text-slate-700">
                    نوع الامتحان
                  </label>
                  <select
                    id="smart-exam-type"
                    value={examType}
                    onChange={(e) => setExamType(e.target.value as ExamType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((t) => (
                      <option key={t} value={t}>
                        {EXAM_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="smart-duration" className="mb-1 block text-xs font-bold text-slate-700">
                    مدة الامتحان (بالدقائق)
                  </label>
                  <input
                    id="smart-duration"
                    type="number"
                    min={1}
                    max={360}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="smart-track" className="mb-1 block text-xs font-bold text-slate-700">
                    المسار الدراسي
                  </label>
                  <select
                    id="smart-track"
                    value={trackId}
                    onChange={(e) => {
                      const nextTrack = Number(e.target.value);
                      setTrackId(nextTrack);
                      const firstG = catalog.grades.find((g) => g.trackId === nextTrack);
                      setGradeId(firstG?.id || 0);
                      setUnitIds([]);
                      setLessonIds([]);
                      setUnitDistMode('AUTO');
                      setUnitDistValues({});
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {catalog.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="smart-grade" className="mb-1 block text-xs font-bold text-slate-700">
                    الصف الدراسي
                  </label>
                  <select
                    id="smart-grade"
                    value={gradeId}
                    onChange={(e) => {
                      setGradeId(Number(e.target.value));
                      setUnitIds([]);
                      setLessonIds([]);
                      setUnitDistMode('AUTO');
                      setUnitDistValues({});
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    {trackGrades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="smart-total-q" className="mb-1 block text-xs font-bold text-slate-700">
                    إجمالي عدد الأسئلة المطلوب
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="smart-total-q"
                      type="number"
                      min={1}
                      max={100}
                      value={totalQuestions}
                      onChange={(e) => setTotalQuestions(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                    {availability && availability.totalEligible > 0 && availability.totalEligible !== totalQuestions && (
                      <button
                        type="button"
                        onClick={() => setTotalQuestions(Math.min(100, availability.totalEligible))}
                        className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                        title="ضبط العدد على أقصى عدد متاح"
                      >
                        المتاح ({availability.totalEligible})
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="smart-pass-pct" className="mb-1 block text-xs font-bold text-slate-700">
                    نسبة النجاح (%)
                  </label>
                  <input
                    id="smart-pass-pct"
                    type="number"
                    min={1}
                    max={100}
                    value={passScorePercent}
                    onChange={(e) => setPassScorePercent(Math.max(1, Math.min(100, Number(e.target.value) || 60)))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* Section 2: Units & Lessons Multi-Select */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-[#0B162C]">
                      الوحدات المختارة ({unitIds.length === 0 ? 'جميع وحدات الصف' : `${unitIds.length} وحدة`})
                    </span>
                    {unitIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setUnitIds([]);
                          setLessonIds([]);
                        }}
                        className="text-[11px] font-bold text-[#2563EB] hover:underline"
                      >
                        تضمين جميع الوحدات
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {gradeUnits.length === 0 ? (
                      <p className="text-xs text-slate-500">لا توجد وحدات مسجلة لهذا الصف.</p>
                    ) : (
                      gradeUnits.map((u) => {
                        const selected = unitIds.includes(u.id);
                        const availCount = unitAvailMap.get(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              setUnitIds((prev) =>
                                prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id],
                              );
                              setLessonIds([]);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                              selected
                                ? 'border-[#2563EB] bg-[#2563EB] text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300'
                            }`}
                          >
                            {selected && <Check className="h-3.5 w-3.5" />}
                            <span>{u.titleAr}</span>
                            {typeof availCount === 'number' && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {availCount}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {availableLessons.length > 0 && (
                  <div className="border-t border-slate-200 pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-[#0B162C]">
                        الدروس (اختياري — {lessonIds.length === 0 ? 'جميع دروس الوحدات المختارة' : `${lessonIds.length} درس`})
                      </span>
                      {lessonIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLessonIds([])}
                          className="text-[11px] font-bold text-[#2563EB] hover:underline"
                        >
                          مسح تحديد الدروس
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {availableLessons.map((l) => {
                        const selected = lessonIds.includes(l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setLessonIds((prev) =>
                                prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id],
                              )
                            }
                            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                              selected
                                ? 'border-[#0B162C] bg-[#0B162C] text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                            }`}
                          >
                            {selected && <Check className="h-3 w-3" />}
                            <span>{l.titleAr}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Question Types + Scoring + Exclude Used */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#0B162C]">
                      أنواع الأسئلة ({questionTypes.length === 0 ? 'جميع الأنواع' : `${questionTypes.length} نوع`})
                    </span>
                    {questionTypes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuestionTypes([])}
                        className="text-[11px] font-bold text-[#2563EB] hover:underline"
                      >
                        الكل
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_QUESTION_TYPES.map((qt) => {
                      const selected = questionTypes.includes(qt);
                      const count = availability?.byQuestionType?.[qt];
                      return (
                        <button
                          key={qt}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setQuestionTypes((prev) =>
                              prev.includes(qt) ? prev.filter((t) => t !== qt) : [...prev, qt],
                            )
                          }
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                            selected
                              ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{QUESTION_TYPE_LABELS[qt]}</span>
                          {typeof count === 'number' && (
                            <span className="rounded bg-white px-1 text-[10px] text-slate-500">{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <span className="block text-xs font-extrabold text-[#0B162C]">توزيع الدرجات واستبعاد المكرر</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setScoreMode('BANK_DEFAULT')}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                        scoreMode === 'BANK_DEFAULT'
                          ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      درجات الأسئلة من البنك
                    </button>
                    <button
                      type="button"
                      onClick={() => setScoreMode('TARGET_TOTAL')}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                        scoreMode === 'TARGET_TOTAL'
                          ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      تحديد درجة كلية للامتحان
                    </button>
                  </div>

                  {scoreMode === 'TARGET_TOTAL' && (
                    <div>
                      <label htmlFor="smart-target-score" className="mb-1 block text-[11px] font-bold text-slate-600">
                        الدرجة الكلية المستهدفة للامتحان
                      </label>
                      <input
                        id="smart-target-score"
                        type="number"
                        min={totalQuestions}
                        max={5000}
                        value={targetTotalScore}
                        onChange={(e) => setTargetTotalScore(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                      />
                    </div>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={excludePreviouslyUsed}
                      onChange={(e) => setExcludePreviouslyUsed(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                    />
                    <span>استبعاد الأسئلة المستخدمة سابقًا في امتحانات أخرى</span>
                  </label>
                </div>
              </div>

              {/* Section 4: Difficulty Distribution & Optional Unit Distribution */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Difficulty */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-[#0B162C]">توزيع مستويات الصعوبة</span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-bold">
                      {(['AUTO', 'COUNT', 'PERCENT'] as DistributionMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setDiffMode(m);
                            if (m === 'PERCENT') {
                              setDiffEasy(30);
                              setDiffMedium(50);
                              setDiffHard(20);
                            } else if (m === 'COUNT') {
                              const e = Math.max(0, Math.floor(totalQuestions * 0.3));
                              const h = Math.max(0, Math.floor(totalQuestions * 0.2));
                              setDiffEasy(e);
                              setDiffHard(h);
                              setDiffMedium(Math.max(0, totalQuestions - e - h));
                            }
                          }}
                          className={`rounded-md px-2.5 py-1 ${
                            diffMode === m ? 'bg-[#0B162C] text-white' : 'text-slate-600'
                          }`}
                        >
                          {m === 'AUTO' ? 'تلقائي' : m === 'COUNT' ? 'بالعدد' : 'بالنسبة %'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {diffMode === 'AUTO' ? (
                    <p className="text-xs text-slate-500">
                      سيختار النظام الأسئلة تلقائيًا من المستويات المتاحة مع ترتيبها من السهل إلى المتقدم.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label htmlFor="diff-easy" className="mb-1 block text-[11px] font-bold text-emerald-700">
                            سهل ({diffMode === 'PERCENT' ? '%' : 'سؤال'})
                          </label>
                          <input
                            id="diff-easy"
                            type="number"
                            min={0}
                            value={diffEasy}
                            onChange={(e) => setDiffEasy(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs"
                          />
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            المتاح: {availability?.byDifficulty.EASY ?? 0}
                          </p>
                        </div>
                        <div>
                          <label htmlFor="diff-medium" className="mb-1 block text-[11px] font-bold text-amber-700">
                            متوسط ({diffMode === 'PERCENT' ? '%' : 'سؤال'})
                          </label>
                          <input
                            id="diff-medium"
                            type="number"
                            min={0}
                            value={diffMedium}
                            onChange={(e) => setDiffMedium(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs"
                          />
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            المتاح: {availability?.byDifficulty.MEDIUM ?? 0}
                          </p>
                        </div>
                        <div>
                          <label htmlFor="diff-hard" className="mb-1 block text-[11px] font-bold text-rose-700">
                            صعب ({diffMode === 'PERCENT' ? '%' : 'سؤال'})
                          </label>
                          <input
                            id="diff-hard"
                            type="number"
                            min={0}
                            value={diffHard}
                            onChange={(e) => setDiffHard(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs"
                          />
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            المتاح: {availability?.byDifficulty.HARD ?? 0}
                          </p>
                        </div>
                      </div>
                      <p className="text-[11px] font-bold text-slate-600">
                        المجموع الحالي: {diffEasy + diffMedium + diffHard} /{' '}
                        {diffMode === 'PERCENT' ? '100%' : `${totalQuestions} سؤال`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Unit Distribution */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-[#0B162C]">توزيع تغطية الوحدات (اختياري)</span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-bold">
                      {(['AUTO', 'COUNT', 'PERCENT'] as DistributionMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setUnitDistMode(m)}
                          disabled={activeUnitsForDistribution.length === 0}
                          className={`rounded-md px-2.5 py-1 disabled:opacity-50 ${
                            unitDistMode === m ? 'bg-[#0B162C] text-white' : 'text-slate-600'
                          }`}
                        >
                          {m === 'AUTO' ? 'تلقائي' : m === 'COUNT' ? 'بالعدد' : 'بالنسبة %'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {unitDistMode === 'AUTO' ? (
                    <p className="text-xs text-slate-500">
                      سيوزّع النظام الأسئلة تلقائيًا عبر الوحدات المختارة. يمكنك تفعيل التوزيع المخصص لتحديد حصة دقيقة لكل وحدة.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {activeUnitsForDistribution.map((u) => (
                        <div key={u.id} className="flex items-center justify-between gap-3">
                          <label
                            htmlFor={`unit-dist-${u.id}`}
                            className="truncate text-xs font-bold text-slate-700"
                          >
                            {u.titleAr}{' '}
                            <span className="font-normal text-slate-400">
                              (المتاح: {unitAvailMap.get(u.id) ?? 0})
                            </span>
                          </label>
                          <input
                            id={`unit-dist-${u.id}`}
                            type="number"
                            min={0}
                            value={unitDistValues[u.id] ?? 0}
                            onChange={(e) =>
                              setUnitDistValues((prev) => ({
                                ...prev,
                                [u.id]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          />
                        </div>
                      ))}
                      <p className="text-[11px] font-bold text-slate-600">
                        المجموع الحالي:{' '}
                        {activeUnitsForDistribution.reduce((acc, u) => acc + (Number(unitDistValues[u.id]) || 0), 0)}{' '}
                        / {unitDistMode === 'PERCENT' ? '100%' : `${totalQuestions} سؤال`}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {mathValidationError && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                  {mathValidationError}
                </div>
              )}
            </div>
          ) : (
            /* ==================== STEP 2: INTERACTIVE EXAM PREVIEW BEFORE SAVING ==================== */
            <div className="space-y-5" data-testid="smart-exam-preview-step">
              {/* Editable Draft Title + Status */}
              <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="min-w-[260px] flex-1">
                  <label htmlFor="draft-exam-title" className="mb-1 block text-xs font-bold text-slate-700">
                    عنوان مسودة الامتحان
                  </label>
                  <input
                    id="draft-exam-title"
                    type="text"
                    value={draftTitleAr}
                    onChange={(e) => {
                      setDraftTitleAr(e.target.value);
                      setHasManualEdits(true);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#0B162C]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800">
                    سيُحفظ كمسودة غير منشورة (DRAFT)
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700">
                    <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                    <span>{durationMin} دقيقة</span>
                  </span>
                </div>
              </div>

              {/* Distribution Summary Cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-bold text-slate-500">إجمالي الأسئلة والدرجات</p>
                  <p className="mt-1 text-lg font-extrabold text-[#0B162C]">
                    {liveSummary.totalQuestions} سؤال —{' '}
                    <span className="text-[#2563EB]" data-testid="preview-total-marks">
                      {liveSummary.totalMarks} درجة
                    </span>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-bold text-slate-500">توزيع الصعوبة</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      سهل: {liveSummary.byDifficulty.EASY}
                    </span>
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
                      متوسط: {liveSummary.byDifficulty.MEDIUM}
                    </span>
                    <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">
                      صعب: {liveSummary.byDifficulty.HARD}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-bold text-slate-500">تغطية الوحدات</p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-bold">
                    {liveSummary.byUnit.map((u, i) => (
                      <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                        {u.unitNameAr}: {u.count}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-bold text-slate-500">أنواع الأسئلة</p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-bold">
                    {Object.entries(liveSummary.byQuestionType).map(([qt, count]) => (
                      <span key={qt} className="rounded bg-blue-50 px-2 py-0.5 text-[#2563EB]">
                        {QUESTION_TYPE_LABELS[qt as QuestionType] || qt}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('blueprint')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span>تعديل المواصفات</span>
                  </button>

                  <button
                    type="button"
                    data-testid="smart-exam-regenerate-btn"
                    disabled={generating}
                    onClick={() => {
                      if (hasManualEdits) {
                        setConfirmRegenerateOpen(true);
                      } else {
                        runGeneration();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
                    <span>إعادة توليد الامتحان</span>
                  </button>

                  <button
                    type="button"
                    data-testid="smart-exam-add-manual-btn"
                    onClick={() => setManualPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-[#2563EB] hover:bg-blue-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة سؤال يدويًا</span>
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="smart-exam-save-draft-btn"
                  disabled={savingDraft || draftQuestions.length === 0}
                  onClick={handleSaveAsDraft}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>حفظ كمسودة</span>
                </button>
              </div>

              {/* Regenerate Confirmation Banner */}
              {confirmRegenerateOpen && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
                  data-testid="confirm-regenerate-banner"
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      قمت بتعديلات يدوية على المسودة الحالية. هل تؤكد إعادة توليد الامتحان واستبدال التعديلات الحالية؟
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmRegenerateOpen(false)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={() => runGeneration()}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                    >
                      تأكيد إعادة التوليد
                    </button>
                  </div>
                </div>
              )}

              {/* Questions List */}
              {draftQuestions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-700">تم حذف جميع الأسئلة من المسودة.</p>
                  <p className="text-xs text-slate-500">
                    استخدم «إضافة سؤال يدويًا» أو «إعادة توليد الامتحان» لإضافة أسئلة قبل الحفظ.
                  </p>
                </div>
              ) : (
                <div className="space-y-3" data-testid="smart-exam-preview-list">
                  {draftQuestions.map((q, idx) => (
                    <div
                      key={q.bankQuestionId}
                      data-testid={`preview-question-card-${idx}`}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                          <span className="rounded-md bg-[#0B162C] px-2 py-0.5 text-white">
                            سؤال {idx + 1}
                          </span>
                          {q.bankCode && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
                              {q.bankCode}
                            </span>
                          )}
                          <span className={`rounded-md border px-2 py-0.5 ${DIFFICULTY_BADGE_CLASS[q.difficulty]}`}>
                            {DIFFICULTY_LABELS[q.difficulty]}
                          </span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[#2563EB]">
                            {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}
                          </span>
                          {q.unitNameAr && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">
                              {q.unitNameAr}
                              {q.lessonNameAr ? ` ← ${q.lessonNameAr}` : ''}
                            </span>
                          )}
                          {q.usedPreviously && (
                            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                              مستخدم سابقًا
                            </span>
                          )}
                        </div>

                        {/* Question Controls */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700">
                            <span>الدرجة:</span>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              aria-label={`تعديل درجة السؤال ${idx + 1}`}
                              value={q.points}
                              onChange={(e) => handlePointsChange(idx, Number(e.target.value))}
                              className="w-14 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-xs font-extrabold text-[#0B162C]"
                            />
                          </label>

                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveQuestion(idx, -1)}
                            aria-label={`تحريك السؤال ${idx + 1} للأعلى`}
                            title="تغيير الترتيب للأعلى"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={idx === draftQuestions.length - 1}
                            onClick={() => handleMoveQuestion(idx, 1)}
                            aria-label={`تحريك السؤال ${idx + 1} للأسفل`}
                            title="تغيير الترتيب للأسفل"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenReplace(idx)}
                            aria-label={`استبدال السؤال ${idx + 1}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                          >
                            <Replace className="h-3.5 w-3.5" />
                            <span>استبدال السؤال</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(idx)}
                            aria-label={`حذف السؤال ${idx + 1} من الامتحان`}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </div>

                      {/* Prompt & Formula */}
                      <div className="space-y-2">
                        <p className="text-sm font-semibold leading-relaxed text-[#0B162C]">{q.promptAr}</p>
                        {q.latexFormula && (
                          <div
                            dir="ltr"
                            className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs text-slate-800"
                          >
                            {q.latexFormula}
                          </div>
                        )}
                      </div>

                      {/* Signed Question Images */}
                      {(q.questionImages.length > 0 || q.imageUrl) && (
                        <div className="flex flex-wrap gap-2">
                          {q.questionImages.map((img, i) => (
                            <button
                              key={img.storageKey || i}
                              type="button"
                              onClick={() => setZoomImageUrl(img.previewUrl)}
                              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                              aria-label={`تكبير صورة السؤال ${idx + 1}`}
                            >
                              <img
                                src={img.previewUrl}
                                alt={img.fileName || `صورة السؤال ${idx + 1}`}
                                className="h-24 w-36 object-cover transition group-hover:scale-105"
                              />
                              <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] text-white">
                                <ImageIcon className="h-3 w-3" />
                                معاينة
                              </span>
                            </button>
                          ))}
                          {q.questionImages.length === 0 && q.imageUrl && (
                            <button
                              type="button"
                              onClick={() => setZoomImageUrl(q.imageUrl)}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                              aria-label={`تكبير صورة السؤال ${idx + 1}`}
                            >
                              <img src={q.imageUrl} alt="صورة السؤال" className="h-24 w-36 object-cover" />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Choices Preview (MCQ / True-False) */}
                      {q.choices.length > 0 && (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {q.choices.map((c, cIdx) => (
                            <div
                              key={c.id || cIdx}
                              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                c.isCorrect
                                  ? 'border-emerald-300 bg-emerald-50 font-bold text-emerald-900'
                                  : 'border-slate-200 bg-slate-50 text-slate-700'
                              }`}
                            >
                              <span className="font-mono text-[11px]">{cIdx + 1}.</span>
                              <span>{c.labelAr}</span>
                              {c.isCorrect && <FileCheck2 className="mr-auto h-3.5 w-3.5 text-emerald-600" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <p className="text-[11px] text-slate-500">
            ملاحظة: يختار مولّد الامتحان الذكي من الأسئلة «المعتمدة» في بنك الأسئلة فقط، ويحفظ النتيجة كمسودة غير منشورة.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              إغلاق
            </button>

            {step === 'blueprint' ? (
              <button
                type="button"
                data-testid="smart-exam-generate-submit-btn"
                disabled={generating || Boolean(mathValidationError) || !trackId || !gradeId}
                onClick={() => runGeneration()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>توليد مسودة الامتحان</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="smart-exam-save-or-transfer-btn"
                disabled={savingDraft || draftQuestions.length === 0}
                onClick={handleSaveAsDraft}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span>{onTransferSelection ? transferButtonLabelAr || 'إضافة الأسئلة إلى مسودة المعالج' : 'حفظ كمسودة'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Replacement Candidates Sub-Modal */}
      {replacingIndex !== null && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="اختيار سؤال بديل"
          data-testid="smart-exam-replacement-modal"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-extrabold text-[#0B162C]">
                  استبدال السؤال رقم {replacingIndex + 1}
                </h3>
                <p className="text-[11px] text-slate-500">
                  البدائل المعتمدة مرتّبة حسب التطابق في الدرس والوحدة ومستوى الصعوبة ونوع السؤال
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplacingIndex(null)}
                aria-label="إغلاق نافذة استبدال السؤال"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {loadingReplacements ? (
                <div className="flex items-center justify-center py-10 text-xs font-bold text-slate-500">
                  <Loader2 className="ml-2 h-4 w-4 animate-spin text-[#2563EB]" />
                  <span>جارٍ البحث عن أسئلة بديلة مطابقة...</span>
                </div>
              ) : replacementCandidates.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-1.5">
                  <p className="text-xs font-extrabold text-amber-900">
                    {replacementMessageAr || 'لا توجد أسئلة بديلة متاحة حاليًا.'}
                  </p>
                  <p className="text-[11px] text-amber-800">
                    يمكنك استخدام «إضافة سؤال يدويًا» أو إضافة أسئلة معتمدة جديدة إلى بنك الأسئلة.
                  </p>
                </div>
              ) : (
                replacementCandidates.map((cand) => (
                  <div
                    key={cand.bankQuestionId}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 hover:border-blue-300 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                        {cand.bankCode && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
                            {cand.bankCode}
                          </span>
                        )}
                        <span className={`rounded border px-2 py-0.5 ${DIFFICULTY_BADGE_CLASS[cand.difficulty]}`}>
                          {DIFFICULTY_LABELS[cand.difficulty]}
                        </span>
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-[#2563EB]">
                          {QUESTION_TYPE_LABELS[cand.questionType] || cand.questionType}
                        </span>
                        {cand.matchReasonsAr.map((r, i) => (
                          <span key={i} className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
                            {r}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleConfirmReplacement(cand)}
                        className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                      >
                        اختيار كبديل
                      </button>
                    </div>
                    <p className="text-xs font-semibold text-[#0B162C]">{cand.promptAr}</p>
                    {cand.questionImages.length > 0 && (
                      <div className="flex gap-2">
                        {cand.questionImages.map((img, i) => (
                          <img
                            key={i}
                            src={img.previewUrl}
                            alt={img.fileName}
                            className="h-16 w-24 rounded border border-slate-200 object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Question Bank Picker (Reuses existing picker modal!) */}
      <QuestionBankPickerModal
        open={manualPickerOpen}
        mode="EXAM"
        catalog={catalog}
        defaultTrackId={trackId}
        defaultGradeId={gradeId}
        defaultUnitId={unitIds.length === 1 ? unitIds[0] : null}
        defaultLessonId={lessonIds.length === 1 ? lessonIds[0] : null}
        alreadyLinkedBankIds={draftQuestions.map((q) => q.bankQuestionId)}
        onClose={() => setManualPickerOpen(false)}
        onConfirm={(picked) => {
          handleManualAddQuestions(picked);
          setManualPickerOpen(false);
        }}
      />

      {/* Image Zoom Lightbox */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة صورة السؤال"
        >
          <div className="relative max-h-[90vh] max-w-4xl">
            <button
              type="button"
              onClick={() => setZoomImageUrl(null)}
              aria-label="إغلاق معاينة الصورة"
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
