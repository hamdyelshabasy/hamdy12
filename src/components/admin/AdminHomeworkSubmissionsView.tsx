import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  ListOrdered,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../lib/api.ts';
import type {
  AdminSubmissionRow,
  HomeworkGradingMode,
  HomeworkQuestionDefinition,
  HomeworkStats,
  RubricCriterion,
  StudentSubmissionVersion,
} from '../../types/homework.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';
import { StudentFullProfileDrawer } from './StudentFullProfileDrawer.tsx';

const ARABIC_QUESTION_ORDINALS = [
  'السؤال الأول',
  'السؤال الثاني',
  'السؤال الثالث',
  'السؤال الرابع',
  'السؤال الخامس',
  'السؤال السادس',
  'السؤال السابع',
  'السؤال الثامن',
  'السؤال التاسع',
  'السؤال العاشر',
];

function getDefaultArabicQuestionLabel(index: number): string {
  return ARABIC_QUESTION_ORDINALS[index] || `السؤال ${index + 1}`;
}

interface SubmissionsListResponse {
  assignment: {
    id: number;
    titleAr: string;
    maximumGrade: number;
    rubric: RubricCriterion[];
    questions: HomeworkQuestionDefinition[];
    deadline: string | null;
  };
  stats: HomeworkStats;
  rows: AdminSubmissionRow[];
}

interface StudentVersionsResponse {
  assignment: {
    id: number;
    titleAr: string;
    maximumGrade: number;
    rubric: RubricCriterion[];
    questions: HomeworkQuestionDefinition[];
    deadline: string | null;
  };
  student: {
    id: number;
    fullName: string;
    phone: string | null;
    email: string | null;
  };
  versions: StudentSubmissionVersion[];
}

interface AdminHomeworkSubmissionsViewProps {
  assignmentId: number;
  catalog: AdminCatalogData;
  onBack: () => void;
  onToast: (msg: string) => void;
}

const SUBMISSION_FILTERS = [
  { id: 'ALL', label: 'الكل' },
  { id: 'NOT_SUBMITTED', label: 'لم يسلّم' },
  { id: 'SUBMITTED', label: 'تم التسليم' },
  { id: 'LATE', label: 'متأخر' },
  { id: 'AWAITING_REVIEW', label: 'بانتظار التصحيح' },
  { id: 'GRADED', label: 'تم التصحيح' },
  { id: 'RETURNED', label: 'أُعيد للتعديل' },
];

export const AdminHomeworkSubmissionsView: React.FC<AdminHomeworkSubmissionsViewProps> = ({
  assignmentId,
  catalog,
  onBack,
  onToast,
}) => {
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<SubmissionsListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Student Profile Drawer integration (reusing existing upgraded profile system)
  const [profileStudentId, setProfileStudentId] = useState<number | null>(null);

  // Grading modal state
  const [gradingData, setGradingData] = useState<StudentVersionsResponse | null>(null);
  const [gradingLoading, setGradingLoading] = useState(false);
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [gradingMode, setGradingMode] = useState<HomeworkGradingMode>('DIRECT');
  const [gradeInput, setGradeInput] = useState<string>('');
  const [rubricInputs, setRubricInputs] = useState<Record<string, number>>({});
  const [questionInputs, setQuestionInputs] = useState<
    Record<number, { awardedGrade: string; teacherComment: string }>
  >({});
  const [useManualOverride, setUseManualOverride] = useState(false);
  const [manualFinalGradeInput, setManualFinalGradeInput] = useState('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [revisionInput, setRevisionInput] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  // Inline assignment-level question structure editor (usable directly from grading screen)
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [draftQuestions, setDraftQuestions] = useState<HomeworkQuestionDefinition[]>([]);
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState('');

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filter !== 'ALL') qs.set('filter', filter);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiRequest<SubmissionsListResponse>(
        `/api/admin/homework/${assignmentId}/submissions${qs.toString() ? `?${qs.toString()}` : ''}`,
      );
      setData(res);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, filter, search, onToast]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  const hydrateGradingForm = (
    ver: StudentSubmissionVersion | undefined,
    rubricDef: RubricCriterion[],
    questionsDef: HomeworkQuestionDefinition[],
  ) => {
    setSelectedPageIdx(0);
    setGradeError('');
    setQuestionsError('');
    setEditingQuestions(false);
    setDraftQuestions(questionsDef.map((q) => ({ ...q })));

    if (!ver) return;
    setGradeInput(ver.awardedGrade !== null ? String(ver.awardedGrade) : '');
    setFeedbackInput(ver.teacherFeedback || '');
    setRevisionInput(ver.revisionInstructions || '');

    const rMap: Record<string, number> = {};
    for (const def of rubricDef) {
      const existing = ver.rubricScores.find((r) => r.id === def.id);
      rMap[def.id] = existing ? existing.awardedPoints : 0;
    }
    setRubricInputs(rMap);

    const qMap: Record<number, { awardedGrade: string; teacherComment: string }> = {};
    for (const q of questionsDef) {
      if (!q.id) continue;
      const existing = (ver.questionGrades || []).find((g) => g.questionId === q.id);
      qMap[q.id] = {
        awardedGrade: existing !== undefined ? String(existing.awardedGrade) : '',
        teacherComment: existing?.teacherComment || '',
      };
    }
    setQuestionInputs(qMap);

    setUseManualOverride(Boolean(ver.isManualOverride));
    setManualFinalGradeInput(
      ver.isManualOverride && ver.awardedGrade !== null ? String(ver.awardedGrade) : '',
    );
    setOverrideReasonInput(ver.overrideReason || '');

    // Smart initial mode selection without discarding saved data
    const hasSavedGrade =
      ver.awardedGrade !== null ||
      (ver.questionGrades || []).length > 0 ||
      (ver.rubricScores || []).length > 0;

    if (hasSavedGrade) {
      if (ver.gradingMode === 'QUESTION_BY_QUESTION' && questionsDef.length > 0) {
        setGradingMode('QUESTION_BY_QUESTION');
      } else if (ver.gradingMode === 'RUBRIC' && rubricDef.length > 0) {
        setGradingMode('RUBRIC');
      } else if (ver.gradingMode === 'DIRECT') {
        setGradingMode('DIRECT');
      } else if (questionsDef.length > 0) {
        setGradingMode('QUESTION_BY_QUESTION');
      } else {
        setGradingMode('DIRECT');
      }
    } else if (questionsDef.length > 0) {
      setGradingMode('QUESTION_BY_QUESTION');
    } else if (rubricDef.length > 0) {
      setGradingMode('RUBRIC');
    } else {
      setGradingMode('DIRECT');
    }
  };

  const openGradingModal = async (studentId: number, preserveVersionIdx = 0) => {
    setGradingLoading(true);
    try {
      const res = await apiRequest<StudentVersionsResponse>(
        `/api/admin/homework/${assignmentId}/submissions/${studentId}`,
      );
      setGradingData(res);
      const safeIdx = Math.min(preserveVersionIdx, Math.max(0, res.versions.length - 1));
      setSelectedVersionIdx(safeIdx);
      hydrateGradingForm(
        res.versions[safeIdx],
        res.assignment.rubric || [],
        res.assignment.questions || [],
      );
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setGradingLoading(false);
    }
  };

  const activeVersion = gradingData?.versions[selectedVersionIdx];
  const rubricDef = gradingData?.assignment.rubric || [];
  const questionsDef = gradingData?.assignment.questions || [];
  const assignmentMax = gradingData?.assignment.maximumGrade || 0;
  const hasRubric = rubricDef.length > 0;
  const rubricTotal = Number(
    rubricDef.reduce((s, r) => s + (Number(rubricInputs[r.id]) || 0), 0).toFixed(2),
  );
  const questionTotal = Number(
    questionsDef
      .reduce((s, q) => {
        if (!q.id) return s;
        const raw = questionInputs[q.id]?.awardedGrade;
        const val = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
        return s + (Number.isFinite(val) ? val : 0);
      }, 0)
      .toFixed(2),
  );
  const effectiveQuestionFinalGrade =
    useManualOverride && manualFinalGradeInput.trim() !== ''
      ? Number(Number(manualFinalGradeInput).toFixed(2))
      : questionTotal;

  const draftQuestionsSum = Number(
    draftQuestions.reduce((s, q) => s + (Number(q.maxGrade) || 0), 0).toFixed(2),
  );

  const openInlineQuestionsEditor = () => {
    setQuestionsError('');
    if (questionsDef.length > 0) {
      setDraftQuestions(questionsDef.map((q) => ({ ...q })));
    } else {
      const total = assignmentMax > 0 ? assignmentMax : 10;
      const q1 = Number((Math.floor((total / 3) * 2) / 2).toFixed(2)) || 1;
      const q2 = q1;
      const q3 = Number((total - q1 - q2).toFixed(2));
      const split = q3 > 0 ? [q1, q2, q3] : [total];
      setDraftQuestions(
        split.map((mg, idx) => ({
          questionNumber: idx + 1,
          labelAr: getDefaultArabicQuestionLabel(idx),
          descriptionAr: '',
          maxGrade: mg,
          displayOrder: idx,
        })),
      );
    }
    setEditingQuestions(true);
  };

  const handleSaveInlineQuestions = async () => {
    if (!gradingData) return;
    setQuestionsError('');
    if (draftQuestions.length === 0) {
      setQuestionsError('يرجى إضافة سؤال واحد على الأقل.');
      return;
    }
    for (let i = 0; i < draftQuestions.length; i++) {
      if (!draftQuestions[i].labelAr.trim()) {
        setQuestionsError(`يرجى إدخال عنوان واضح للسؤال رقم ${i + 1}.`);
        return;
      }
      if (!Number.isFinite(Number(draftQuestions[i].maxGrade)) || Number(draftQuestions[i].maxGrade) <= 0) {
        setQuestionsError(`الدرجة العظمى للسؤال "${draftQuestions[i].labelAr}" يجب أن تكون أكبر من صفر.`);
        return;
      }
    }
    if (Math.abs(draftQuestionsSum - assignmentMax) > 0.01) {
      setQuestionsError(
        `مجموع درجات الأسئلة (${draftQuestionsSum}) يجب أن يساوي الدرجة النهائية للواجب (${assignmentMax}).`,
      );
      return;
    }

    setSavingQuestions(true);
    try {
      const res = await apiRequest<{
        maximumGrade: number;
        questions: HomeworkQuestionDefinition[];
        message: string;
      }>(`/api/admin/homework/${assignmentId}/questions`, {
        method: 'PUT',
        body: JSON.stringify({
          questions: draftQuestions.map((q, idx) => ({
            ...(q.id ? { id: q.id } : {}),
            questionNumber: idx + 1,
            labelAr: q.labelAr.trim(),
            descriptionAr: (q.descriptionAr || '').trim(),
            maxGrade: Number(q.maxGrade),
            displayOrder: idx,
          })),
        }),
      });
      onToast(res.message);
      setEditingQuestions(false);
      // Update gradingData assignment questions while preserving any already typed values
      setGradingData((prev) =>
        prev
          ? {
              ...prev,
              assignment: {
                ...prev.assignment,
                maximumGrade: res.maximumGrade,
                questions: res.questions,
              },
            }
          : prev,
      );
      setQuestionInputs((prev) => {
        const next = { ...prev };
        for (const q of res.questions) {
          if (q.id && !next[q.id]) {
            next[q.id] = { awardedGrade: '', teacherComment: '' };
          }
        }
        return next;
      });
      setGradingMode('QUESTION_BY_QUESTION');
      await loadSubmissions();
    } catch (err) {
      setQuestionsError((err as Error).message);
    } finally {
      setSavingQuestions(false);
    }
  };

  const handleGradeAction = async (action: 'SAVE_DRAFT' | 'PUBLISH_GRADE' | 'RETURN_FOR_REVISION') => {
    if (!activeVersion || !gradingData) return;
    setGradeError('');

    if (action !== 'RETURN_FOR_REVISION' && gradingMode === 'QUESTION_BY_QUESTION') {
      if (questionsDef.length === 0) {
        setGradeError('يرجى تعريف أسئلة الواجب وتوزيع درجاتها أولًا قبل التصحيح لكل سؤال.');
        return;
      }
      for (const q of questionsDef) {
        if (!q.id) continue;
        const entry = questionInputs[q.id];
        const raw = entry?.awardedGrade ?? '';
        if (action === 'PUBLISH_GRADE' && raw.trim() === '') {
          setGradeError(`يرجى إدخال درجة الطالب في "${q.labelAr}" قبل نشر النتيجة.`);
          return;
        }
        const val = raw.trim() === '' ? 0 : Number(raw);
        if (!Number.isFinite(val) || val < 0) {
          setGradeError(`درجة "${q.labelAr}" لا يمكن أن تكون سالبة.`);
          return;
        }
        if (val > q.maxGrade + 0.001) {
          setGradeError(`درجة "${q.labelAr}" (${val}) تتجاوز الدرجة العظمى (${q.maxGrade}).`);
          return;
        }
      }
      if (useManualOverride) {
        if (manualFinalGradeInput.trim() === '') {
          setGradeError('يرجى إدخال الدرجة النهائية المعدّلة يدويًا أو إلغاء التعديل اليدوي.');
          return;
        }
        const manualVal = Number(manualFinalGradeInput);
        if (!Number.isFinite(manualVal) || manualVal < 0 || manualVal > assignmentMax + 0.001) {
          setGradeError(`الدرجة النهائية يجب أن تكون بين 0 و ${assignmentMax}.`);
          return;
        }
        if (Math.abs(manualVal - questionTotal) > 0.001 && overrideReasonInput.trim().length < 3) {
          setGradeError('يرجى كتابة سبب تعديل الدرجة النهائية يدويًا.');
          return;
        }
      }
    }

    setSavingGrade(true);
    try {
      const payload =
        action === 'RETURN_FOR_REVISION'
          ? {
              action,
              teacherFeedback: feedbackInput,
              revisionInstructions: revisionInput,
            }
          : gradingMode === 'QUESTION_BY_QUESTION'
            ? {
                action,
                gradingMode: 'QUESTION_BY_QUESTION' as const,
                questionGrades: questionsDef
                  .filter((q): q is HomeworkQuestionDefinition & { id: number } => Boolean(q.id))
                  .map((q) => {
                    const entry = questionInputs[q.id];
                    const raw = entry?.awardedGrade ?? '';
                    return {
                      questionId: q.id,
                      awardedGrade: raw.trim() === '' ? 0 : Number(raw),
                      teacherComment: entry?.teacherComment || '',
                    };
                  }),
                manualFinalGrade:
                  useManualOverride && manualFinalGradeInput.trim() !== ''
                    ? Number(manualFinalGradeInput)
                    : null,
                overrideReason: useManualOverride ? overrideReasonInput.trim() : '',
                teacherFeedback: feedbackInput,
                revisionInstructions: revisionInput,
              }
            : gradingMode === 'RUBRIC'
              ? {
                  action,
                  gradingMode: 'RUBRIC' as const,
                  awardedGrade: rubricTotal,
                  rubricScores: rubricDef.map((r) => ({
                    id: r.id,
                    awardedPoints: Number(rubricInputs[r.id]) || 0,
                  })),
                  teacherFeedback: feedbackInput,
                  revisionInstructions: revisionInput,
                }
              : {
                  action,
                  gradingMode: 'DIRECT' as const,
                  awardedGrade: gradeInput.trim() === '' ? null : Number(gradeInput),
                  rubricScores: [],
                  teacherFeedback: feedbackInput,
                  revisionInstructions: revisionInput,
                };

      const res = await apiRequest<{ message: string }>(
        `/api/admin/homework/submissions/${activeVersion.id}/grade`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      onToast(res.message);
      await loadSubmissions();
      await openGradingModal(gradingData.student.id, selectedVersionIdx);
    } catch (err) {
      const msg = (err as Error).message;
      setGradeError(msg);
      onToast(msg);
    } finally {
      setSavingGrade(false);
    }
  };

  return (
    <div data-testid="admin-homework-submissions-view" className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowRight className="h-4 w-4" />
            <span>العودة للواجبات</span>
          </button>
          <div>
            <div className="text-[11px] font-bold text-[#2563EB]">مراجعة التسليمات والتصحيح والإحصاءات</div>
            <h2 className="text-base font-extrabold text-[#0B162C]">
              {data?.assignment.titleAr || 'تحميل الواجب...'}
            </h2>
          </div>
        </div>
        {data && (
          <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] px-3.5 py-2 text-xs font-bold text-[#0B162C]">
            الدرجة النهائية: <span className="font-mono-num text-[#2563EB]">{data.assignment.maximumGrade}</span>
          </div>
        )}
      </div>

      {/* Teacher Statistics Dashboard */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">نسبة التسليم</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#2563EB]">
              {data.stats.submissionPercent}%
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              سلّم {data.stats.submittedCount} من {data.stats.totalAssigned} طالب
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">لم يسلّم / متأخر</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-amber-700">
              {data.stats.notSubmittedCount} <span className="text-sm font-normal text-slate-400">/ {data.stats.lateCount}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-600">غير مسلّم / تسليم متأخر</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">بانتظار التصحيح</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-indigo-700">
              {data.stats.awaitingReviewCount}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              تم التصحيح: {data.stats.gradedCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">متوسط الدرجات</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-emerald-700">
              {data.stats.averageGrade !== null ? data.stats.averageGrade : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              من أصل {data.assignment.maximumGrade}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">أعلى / أدنى درجة</div>
            <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
              {data.stats.highestGrade !== null ? data.stats.highestGrade : '—'}
              <span className="text-sm font-normal text-slate-400">
                {' '}
                / {data.stats.lowestGrade !== null ? data.stats.lowestGrade : '—'}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-600">بين التسليمات المصححة</div>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SUBMISSION_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  filter === f.id
                    ? 'bg-[#0B162C] text-white'
                    : 'border border-slate-200 bg-[#F7F9FC] text-slate-700 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الطالب أو الهاتف..."
              className="w-full rounded-lg border border-slate-300 py-1.5 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:outline-none"
            />
          </div>
        </div>

        {/* Submissions Table */}
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">جارٍ تحميل التسليمات...</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            لا توجد تسليمات مطابقة للتصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
                  <th className="px-3 py-2.5 font-bold">الطالب</th>
                  <th className="px-3 py-2.5 font-bold">المسار والصف</th>
                  <th className="px-3 py-2.5 font-bold">وقت التسليم</th>
                  <th className="px-3 py-2.5 font-bold">النسخة / المرفقات</th>
                  <th className="px-3 py-2.5 font-bold">الحالة</th>
                  <th className="px-3 py-2.5 font-bold">الدرجة</th>
                  <th className="px-3 py-2.5 font-bold">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row) => (
                  <tr key={row.studentId} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setProfileStudentId(row.studentId)}
                        className="inline-flex items-center gap-1.5 font-bold text-[#2563EB] hover:underline"
                      >
                        <User className="h-3.5 w-3.5" />
                        <span>{row.studentName}</span>
                      </button>
                      {row.studentPhone && (
                        <div className="font-mono-num text-[11px] text-slate-400" dir="ltr">
                          {row.studentPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <div>{row.trackNameAr}</div>
                      <div className="text-[11px] text-slate-400">{row.gradeNameAr}</div>
                    </td>
                    <td className="px-3 py-3">
                      {row.submittedAt ? (
                        <div>
                          <div className="text-slate-700">{formatDateTimeAr(row.submittedAt)}</div>
                          {row.isLate && (
                            <span className="inline-block rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                              متأخر
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono-num text-slate-700">
                      {row.hasSubmitted ? (
                        <span>
                          v{row.latestVersion} ({row.versionsCount} نسخة) · {row.attachmentsCount} ملف
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                          row.status === 'GRADED' && row.isGradePublished
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : row.status === 'RETURNED_FOR_REVISION'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : row.hasSubmitted
                                ? 'border-blue-200 bg-blue-50 text-[#2563EB]'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.statusLabelAr}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono-num font-bold text-[#0B162C]">
                      {row.awardedGrade !== null
                        ? `${row.awardedGrade} / ${data.assignment.maximumGrade}`
                        : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {row.hasSubmitted ? (
                        <button
                          type="button"
                          onClick={() => void openGradingModal(row.studentId)}
                          className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                        >
                          {row.status === 'GRADED' && row.isGradePublished ? 'عرض / تعديل التصحيح' : 'مراجعة وتصحيح'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setProfileStudentId(row.studentId)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          ملف الطالب
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GRADING MODAL */}
      {(gradingLoading || gradingData) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تصحيح تسليم الواجب"
          data-testid="admin-homework-grading-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5"
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
              <div>
                <h3 className="text-base font-extrabold">
                  تصحيح واجب الطالب: {gradingData?.student.fullName || '...'}
                </h3>
                <p className="text-[11px] text-slate-300">
                  {gradingData?.assignment.titleAr} · الدرجة النهائية:{' '}
                  {gradingData?.assignment.maximumGrade}
                </p>
              </div>
              <button
                type="button"
                aria-label="إغلاق نافذة التصحيح"
                onClick={() => {
                  setGradingData(null);
                  setGradingLoading(false);
                }}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {gradingLoading || !gradingData ? (
              <div className="flex flex-1 items-center justify-center p-12 text-sm text-slate-500">
                <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#2563EB]" />
                <span>جارٍ تحميل تسليم الطالب وملفاته...</span>
              </div>
            ) : (
              <div className="grid flex-1 overflow-y-auto lg:grid-cols-12">
                {/* Right Column: Solution Viewer + Version Switcher */}
                <div className="border-b border-slate-200 p-5 lg:col-span-7 lg:border-b-0 lg:border-l space-y-4">
                  {/* Version Selector */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {gradingData.versions.map((v, idx) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSelectedVersionIdx(idx);
                            hydrateGradingForm(v, rubricDef, questionsDef);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                            idx === selectedVersionIdx
                              ? 'bg-[#0B162C] text-white'
                              : 'border border-slate-200 bg-[#F7F9FC] text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          النسخة #{v.version} {v.isLate ? '(متأخر)' : ''}
                        </button>
                      ))}
                    </div>
                    {activeVersion?.submittedAt && (
                      <span className="text-[11px] text-slate-500">
                        تاريخ التسليم: {formatDateTimeAr(activeVersion.submittedAt)}
                      </span>
                    )}
                  </div>

                  {/* Structured / MCQ Answers */}
                  {activeVersion?.structuredAnswers && activeVersion.structuredAnswers.length > 0 && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-2">
                      <div className="text-xs font-extrabold text-[#0B162C]">
                        إجابات الطالب على الأسئلة الموضوعية ({activeVersion.structuredAnswers.length}):
                      </div>
                      <div className="space-y-1.5">
                        {activeVersion.structuredAnswers.map((sa) => {
                          const qDef = gradingData.assignment.questions.find(
                            (q) => q.id === sa.questionId,
                          );
                          const chosen = qDef?.choices?.find(
                            (c) => c.id === sa.selectedChoiceId,
                          );
                          const correctChoice = qDef?.choices?.find((c) => c.isCorrect);
                          return (
                            <div
                              key={sa.questionId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                            >
                              <span className="font-bold text-[#0B162C]">
                                س{qDef?.questionNumber ?? sa.questionId}: {qDef?.labelAr || 'سؤال'}
                              </span>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-md px-2 py-0.5 font-bold ${
                                    chosen
                                      ? chosen.isCorrect
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'
                                      : 'bg-blue-50 text-[#2563EB]'
                                  }`}
                                >
                                  إجابة الطالب: {chosen ? chosen.labelAr : sa.textAnswer || '—'}
                                </span>
                                {correctChoice && chosen && !chosen.isCorrect && (
                                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                                    الصحيحة: {correctChoice.labelAr}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Written Answer */}
                  {activeVersion?.writtenAnswer && (
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-1">
                      <div className="text-xs font-extrabold text-[#0B162C]">الإجابة النصية للطالب:</div>
                      <p className="whitespace-pre-line text-xs leading-relaxed text-slate-800">
                        {activeVersion.writtenAnswer}
                      </p>
                    </div>
                  )}

                  {/* Solution Files Viewer with Page Switcher */}
                  {activeVersion && activeVersion.files.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-[#F7F9FC] px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={selectedPageIdx === 0}
                            onClick={() => setSelectedPageIdx((i) => Math.max(0, i - 1))}
                            className="rounded border border-slate-300 bg-white p-1 disabled:opacity-40"
                            aria-label="الصفحة السابقة"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <span className="font-mono-num font-bold text-[#0B162C]">
                            صفحة {selectedPageIdx + 1} من {activeVersion.files.length}
                          </span>
                          <button
                            type="button"
                            disabled={selectedPageIdx >= activeVersion.files.length - 1}
                            onClick={() =>
                              setSelectedPageIdx((i) => Math.min(activeVersion.files.length - 1, i + 1))
                            }
                            className="rounded border border-slate-300 bg-white p-1 disabled:opacity-40"
                            aria-label="الصفحة التالية"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                        </div>

                        {activeVersion.files[selectedPageIdx] && (
                          <a
                            href={activeVersion.files[selectedPageIdx].previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-[#2563EB] hover:underline"
                          >
                            <span>فتح بالحجم الكامل</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      {(() => {
                        const currentFile = activeVersion.files[selectedPageIdx];
                        if (!currentFile) return null;
                        if (currentFile.mimeType === 'application/pdf') {
                          return (
                            <iframe
                              title={currentFile.fileName}
                              src={currentFile.previewUrl}
                              className="h-[520px] w-full rounded-xl border border-slate-200 bg-white"
                            />
                          );
                        }
                        return (
                          <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-900/5 p-3">
                            <img
                              src={currentFile.previewUrl}
                              alt={currentFile.fileName}
                              className="max-h-[520px] rounded-lg object-contain"
                            />
                          </div>
                        );
                      })()}

                      {/* Thumbnail strip */}
                      {activeVersion.files.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {activeVersion.files.map((f, idx) => (
                            <button
                              key={f.storageKey}
                              type="button"
                              onClick={() => setSelectedPageIdx(idx)}
                              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                                idx === selectedPageIdx
                                  ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                                  : 'border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              <span>
                                {idx + 1}. {f.fileName.slice(0, 18)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-8 text-center text-xs text-slate-500">
                      لا توجد ملفات مرفقة في هذه النسخة (إجابة نصية فقط).
                    </div>
                  )}
                </div>

                {/* Left Column: Grading Controls */}
                <div className="p-5 lg:col-span-5 space-y-4 bg-[#F7F9FC]/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-sm font-extrabold text-[#0B162C]">
                      <Award className="h-4 w-4 text-[#2563EB]" />
                      <span>تقييم وتصحيح النسخة #{activeVersion?.version}</span>
                    </h4>
                    <div className="flex items-center gap-1.5">
                      {activeVersion?.isGradePublished ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>منشورة للطالب</span>
                        </span>
                      ) : activeVersion?.awardedGrade !== null ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          <Save className="h-3 w-3" />
                          <span>مسودة محفوظة</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* 3 Grading Mode Selector (Preserves Direct, Rubric, and Question-by-Question) */}
                  <div
                    role="tablist"
                    aria-label="طريقة تصحيح الواجب"
                    className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5"
                  >
                    {(
                      [
                        { id: 'QUESTION_BY_QUESTION' as const, label: 'تصحيح كل سؤال' },
                        { id: 'DIRECT' as const, label: 'درجة إجمالية' },
                        { id: 'RUBRIC' as const, label: 'معايير التقييم' },
                      ] as const
                    ).map((modeTab) => {
                      const active = gradingMode === modeTab.id;
                      return (
                        <button
                          key={modeTab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          data-testid={`grading-mode-${modeTab.id.toLowerCase()}`}
                          onClick={() => {
                            setGradeError('');
                            setGradingMode(modeTab.id);
                          }}
                          className={`rounded-lg px-2 py-2 text-[11px] font-extrabold transition-colors ${
                            active
                              ? 'bg-[#0B162C] text-white shadow-sm'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {modeTab.label}
                        </button>
                      );
                    })}
                  </div>

                  {gradeError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{gradeError}</span>
                    </div>
                  )}

                  {/* MODE 3: QUESTION-BY-QUESTION GRADING */}
                  {gradingMode === 'QUESTION_BY_QUESTION' && (
                    <div
                      data-testid="question-by-question-grading-section"
                      className="space-y-3 rounded-xl border border-blue-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-1.5">
                          <ListOrdered className="h-4 w-4 text-[#2563EB]" />
                          <span className="text-xs font-extrabold text-[#0B162C]">
                            تصحيح الأسئلة بالتفصيل
                          </span>
                        </div>
                        <button
                          type="button"
                          data-testid="configure-questions-inline-btn"
                          onClick={() =>
                            editingQuestions
                              ? setEditingQuestions(false)
                              : openInlineQuestionsEditor()
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>
                            {editingQuestions
                              ? 'إغلاق الإعداد'
                              : questionsDef.length > 0
                                ? 'تعديل توزيع الأسئلة'
                                : 'إعداد أسئلة الواجب'}
                          </span>
                        </button>
                      </div>

                      {/* Inline Assignment-Level Question Breakdown Editor */}
                      {(editingQuestions || questionsDef.length === 0) && (
                        <div
                          data-testid="inline-question-config-panel"
                          className="rounded-xl border border-blue-200 bg-[#F7F9FC] p-3 space-y-2.5"
                        >
                          <div className="text-[11px] font-bold text-[#0B162C]">
                            {questionsDef.length === 0
                              ? 'لم يتم تحديد أسئلة هذا الواجب بعد. أضف الأسئلة والدرجة العظمى لكل سؤال (تُحفظ للواجب بالكامل لجميع الطلاب):'
                              : 'تعديل توزيع درجات الأسئلة للواجب:'}
                          </div>

                          {questionsError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-800">
                              {questionsError}
                            </div>
                          )}

                          {draftQuestions.length === 0 ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={openInlineQuestionsEditor}
                                className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#1D4ED8]"
                              >
                                إنشاء 3 أسئلة افتراضية تلقائيًا
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuestions(true);
                                  setDraftQuestions([
                                    {
                                      questionNumber: 1,
                                      labelAr: getDefaultArabicQuestionLabel(0),
                                      descriptionAr: '',
                                      maxGrade: assignmentMax || 10,
                                      displayOrder: 0,
                                    },
                                  ]);
                                }}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                              >
                                + إضافة سؤال يدويًا
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {draftQuestions.map((dq, idx) => (
                                <div
                                  key={dq.id ?? `draft-q-${idx}`}
                                  className="rounded-lg border border-slate-200 bg-white p-2 space-y-1.5"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#0B162C] font-mono-num text-[10px] font-bold text-white">
                                      {idx + 1}
                                    </span>
                                    <input
                                      type="text"
                                      value={dq.labelAr}
                                      onChange={(e) =>
                                        setDraftQuestions((prev) =>
                                          prev.map((it, i) =>
                                            i === idx ? { ...it, labelAr: e.target.value } : it,
                                          ),
                                        )
                                      }
                                      placeholder={getDefaultArabicQuestionLabel(idx)}
                                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold"
                                    />
                                    <input
                                      type="number"
                                      min={0.5}
                                      step="0.5"
                                      value={dq.maxGrade}
                                      onChange={(e) =>
                                        setDraftQuestions((prev) =>
                                          prev.map((it, i) =>
                                            i === idx
                                              ? { ...it, maxGrade: Number(e.target.value) }
                                              : it,
                                          ),
                                        )
                                      }
                                      aria-label={`الدرجة العظمى للسؤال ${idx + 1}`}
                                      className="w-16 rounded border border-slate-300 px-1.5 py-1 font-mono-num text-[11px] font-bold text-center"
                                    />
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() =>
                                        setDraftQuestions((prev) => {
                                          if (idx === 0) return prev;
                                          const next = [...prev];
                                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                          return next;
                                        })
                                      }
                                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                                      aria-label="لأعلى"
                                    >
                                      <ArrowUp className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === draftQuestions.length - 1}
                                      onClick={() =>
                                        setDraftQuestions((prev) => {
                                          if (idx >= prev.length - 1) return prev;
                                          const next = [...prev];
                                          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                                          return next;
                                        })
                                      }
                                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                                      aria-label="لأسفل"
                                    >
                                      <ArrowDown className="h-3 w-3" />
                                    </button>
                                    {dq.hasGradingRecords ? (
                                      <span
                                        title="سؤال يحتوي على درجات محفوظة"
                                        className="rounded border border-amber-200 bg-amber-50 p-1 text-amber-700"
                                      >
                                        <Lock className="h-3 w-3" />
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDraftQuestions((prev) =>
                                            prev.filter((_, i) => i !== idx),
                                          )
                                        }
                                        className="rounded border border-red-200 bg-red-50 p-1 text-red-700"
                                        aria-label="حذف السؤال"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    value={dq.descriptionAr || ''}
                                    onChange={(e) =>
                                      setDraftQuestions((prev) =>
                                        prev.map((it, i) =>
                                          i === idx ? { ...it, descriptionAr: e.target.value } : it,
                                        ),
                                      )
                                    }
                                    placeholder="وصف مختصر (اختياري)"
                                    className="w-full rounded border border-slate-200 bg-[#F7F9FC] px-2 py-1 text-[10px]"
                                  />
                                </div>
                              ))}

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftQuestions((prev) => [
                                      ...prev,
                                      {
                                        questionNumber: prev.length + 1,
                                        labelAr: getDefaultArabicQuestionLabel(prev.length),
                                        descriptionAr: '',
                                        maxGrade: Math.max(
                                          1,
                                          Number((assignmentMax - draftQuestionsSum).toFixed(2)),
                                        ),
                                        displayOrder: prev.length,
                                      },
                                    ])
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  <Plus className="h-3 w-3" />
                                  <span>إضافة سؤال</span>
                                </button>
                                <span
                                  className={`font-mono-num text-[11px] font-extrabold ${
                                    Math.abs(draftQuestionsSum - assignmentMax) <= 0.01
                                      ? 'text-emerald-700'
                                      : 'text-red-700'
                                  }`}
                                >
                                  المجموع: {draftQuestionsSum} / {assignmentMax}
                                </span>
                              </div>

                              <button
                                type="button"
                                disabled={savingQuestions}
                                onClick={() => void handleSaveInlineQuestions()}
                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                              >
                                {savingQuestions ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="h-3.5 w-3.5" />
                                )}
                                <span>حفظ توزيع الأسئلة للواجب</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Compact Per-Question Grading Cards */}
                      {questionsDef.length > 0 && !editingQuestions && (
                        <div className="space-y-2.5">
                          {questionsDef.map((q) => {
                            if (!q.id) return null;
                            const input = questionInputs[q.id] || {
                              awardedGrade: '',
                              teacherComment: '',
                            };
                            const numVal =
                              input.awardedGrade.trim() === '' ? null : Number(input.awardedGrade);
                            const isInvalid =
                              numVal !== null &&
                              (!Number.isFinite(numVal) || numVal < 0 || numVal > q.maxGrade + 0.001);
                            const hasSaved = (activeVersion?.questionGrades || []).some(
                              (g) => g.questionId === q.id,
                            );

                            return (
                              <div
                                key={q.id}
                                data-testid={`question-grade-card-${q.questionNumber}`}
                                className={`rounded-xl border p-3 space-y-2 ${
                                  isInvalid
                                    ? 'border-red-300 bg-red-50/40'
                                    : 'border-slate-200 bg-[#F7F9FC]/70'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#0B162C] px-1.5 font-mono-num text-[10px] font-bold text-white">
                                        س{q.questionNumber}
                                      </span>
                                      <span className="text-xs font-extrabold text-[#0B162C]">
                                        {q.labelAr}
                                      </span>
                                      {hasSaved && (
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                          محفوظ
                                        </span>
                                      )}
                                    </div>
                                    {q.descriptionAr && (
                                      <p className="mt-0.5 text-[11px] text-slate-500">
                                        {q.descriptionAr}
                                      </p>
                                    )}
                                    {q.questionImages && q.questionImages.length > 0 && (
                                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {q.questionImages.map((img, iIdx) => (
                                          <a
                                            key={img.storageKey || iIdx}
                                            href={img.previewUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block overflow-hidden rounded border border-slate-200 bg-white p-0.5 hover:border-[#2563EB]"
                                            title="فتح صورة السؤال"
                                          >
                                            <img
                                              src={img.previewUrl}
                                              alt={img.fileName || `صورة ${iIdx + 1}`}
                                              className="h-14 w-16 object-contain"
                                            />
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                    {(q.modelAnswerTextSnapshot ||
                                      (q.modelAnswerFiles && q.modelAnswerFiles.length > 0)) && (
                                      <details className="mt-1.5 rounded border border-emerald-200 bg-emerald-50/50 px-2 py-1 text-[11px]">
                                        <summary className="cursor-pointer font-bold text-emerald-800">
                                          عرض مرجع الإجابة النموذجية للمدرس
                                        </summary>
                                        <div className="mt-1.5 space-y-1.5">
                                          {q.modelAnswerTextSnapshot && (
                                            <p className="whitespace-pre-line text-slate-700">
                                              {q.modelAnswerTextSnapshot}
                                            </p>
                                          )}
                                          {q.modelAnswerFiles && q.modelAnswerFiles.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                              {q.modelAnswerFiles.map((maf, mIdx) => (
                                                <a
                                                  key={maf.storageKey || mIdx}
                                                  href={maf.previewUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-white px-2 py-1 font-semibold text-emerald-800 hover:bg-emerald-100"
                                                >
                                                  <FileText className="h-3 w-3" />
                                                  <span className="max-w-[140px] truncate">{maf.fileName}</span>
                                                </a>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </details>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <input
                                      type="number"
                                      min={0}
                                      max={q.maxGrade}
                                      step="0.5"
                                      aria-label={`درجة ${q.labelAr}`}
                                      data-testid={`q-grade-input-${q.questionNumber}`}
                                      value={input.awardedGrade}
                                      onChange={(e) =>
                                        setQuestionInputs((prev) => ({
                                          ...prev,
                                          [q.id!]: {
                                            awardedGrade: e.target.value,
                                            teacherComment: prev[q.id!]?.teacherComment || '',
                                          },
                                        }))
                                      }
                                      placeholder="0"
                                      className={`w-16 rounded-lg border px-2 py-1 font-mono-num text-xs font-extrabold text-center focus:outline-none ${
                                        isInvalid
                                          ? 'border-red-400 bg-white text-red-700'
                                          : 'border-slate-300 bg-white text-[#0B162C] focus:border-[#2563EB]'
                                      }`}
                                    />
                                    <span className="font-mono-num text-xs font-bold text-slate-500">
                                      / {q.maxGrade}
                                    </span>
                                  </div>
                                </div>

                                {isInvalid && (
                                  <div className="text-[11px] font-semibold text-red-700">
                                    الدرجة يجب أن تكون بين 0 و {q.maxGrade}.
                                  </div>
                                )}

                                <textarea
                                  rows={2}
                                  aria-label={`ملاحظة المدرس على ${q.labelAr}`}
                                  data-testid={`q-comment-input-${q.questionNumber}`}
                                  value={input.teacherComment}
                                  onChange={(e) =>
                                    setQuestionInputs((prev) => ({
                                      ...prev,
                                      [q.id!]: {
                                        awardedGrade: prev[q.id!]?.awardedGrade ?? '',
                                        teacherComment: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="ملاحظة المدرس على هذا السؤال (اختياري)..."
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] focus:border-[#2563EB] focus:outline-none"
                                />
                              </div>
                            );
                          })}

                          {/* Auto-Calculated Question Total + Optional Manual Overall Adjustment */}
                          <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-700">مجموع درجات الأسئلة:</span>
                              <span
                                data-testid="question-total-display"
                                className="font-mono-num text-sm font-extrabold text-[#0B162C]"
                              >
                                {questionTotal} / {assignmentMax}
                              </span>
                            </div>

                            <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                              <span className="font-extrabold text-[#0B162C]">
                                الدرجة النهائية للواجب:
                              </span>
                              <div className="flex items-center gap-1.5">
                                {useManualOverride &&
                                  manualFinalGradeInput.trim() !== '' &&
                                  Math.abs(effectiveQuestionFinalGrade - questionTotal) > 0.001 && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                      تعديل يدوي
                                    </span>
                                  )}
                                <span
                                  data-testid="final-homework-grade-display"
                                  className="font-mono-num text-base font-extrabold text-[#2563EB]"
                                >
                                  {effectiveQuestionFinalGrade} / {assignmentMax}
                                </span>
                              </div>
                            </div>

                            <label className="flex cursor-pointer items-center gap-2 border-t border-slate-200 pt-2 text-[11px] font-bold text-slate-700">
                              <input
                                type="checkbox"
                                data-testid="manual-override-toggle"
                                checked={useManualOverride}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setUseManualOverride(checked);
                                  if (checked && !manualFinalGradeInput) {
                                    setManualFinalGradeInput(String(questionTotal));
                                  }
                                }}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB]"
                              />
                              <span>تعديل الدرجة النهائية يدويًا (مع الاحتفاظ بدرجات الأسئلة كما هي)</span>
                            </label>

                            {useManualOverride && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    htmlFor="manual-final-grade-input"
                                    className="text-[11px] font-extrabold text-amber-950"
                                  >
                                    الدرجة النهائية المعتمدة (0 إلى {assignmentMax}):
                                  </label>
                                  <input
                                    id="manual-final-grade-input"
                                    data-testid="manual-final-grade-input"
                                    type="number"
                                    min={0}
                                    max={assignmentMax}
                                    step="0.5"
                                    value={manualFinalGradeInput}
                                    onChange={(e) => setManualFinalGradeInput(e.target.value)}
                                    className="w-20 rounded-lg border border-amber-300 bg-white px-2 py-1 font-mono-num text-xs font-extrabold text-center"
                                  />
                                </div>
                                <div>
                                  <label
                                    htmlFor="manual-override-reason-input"
                                    className="block text-[11px] font-bold text-amber-950"
                                  >
                                    سبب تعديل الدرجة النهائية *
                                  </label>
                                  <textarea
                                    id="manual-override-reason-input"
                                    data-testid="manual-override-reason-input"
                                    rows={2}
                                    value={overrideReasonInput}
                                    onChange={(e) => setOverrideReasonInput(e.target.value)}
                                    placeholder="مثال: منح درجة تشجيعية لترتيب خطوات الإثبات والرسم البياني..."
                                    className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] focus:border-amber-500 focus:outline-none"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MODE 2: RUBRIC GRADING (Preserved intact) */}
                  {gradingMode === 'RUBRIC' && (
                    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-extrabold text-[#0B162C]">التصحيح بمعايير التقييم:</div>
                      {hasRubric ? (
                        <>
                          {rubricDef.map((crit) => (
                            <div
                              key={crit.id}
                              className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                            >
                              <label htmlFor={`rubric-${crit.id}`} className="text-xs text-slate-700">
                                {crit.labelAr}{' '}
                                <span className="font-mono-num text-[11px] text-slate-400">
                                  (الحد: {crit.maxPoints})
                                </span>
                              </label>
                              <input
                                id={`rubric-${crit.id}`}
                                type="number"
                                min={0}
                                max={crit.maxPoints}
                                step="0.5"
                                value={rubricInputs[crit.id] ?? 0}
                                onChange={(e) =>
                                  setRubricInputs((prev) => ({
                                    ...prev,
                                    [crit.id]: Number(e.target.value),
                                  }))
                                }
                                className="w-20 rounded-lg border border-slate-300 px-2.5 py-1 font-mono-num text-xs text-center"
                              />
                            </div>
                          ))}
                          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs font-extrabold">
                            <span>المجموع المحسوب تلقائيًا:</span>
                            <span className="font-mono-num text-base text-[#2563EB]">
                              {rubricTotal} / {assignmentMax}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">
                          لم يتم تعريف معايير التقييم (Rubric) لهذا الواجب. يمكنك استخدام «تصحيح كل سؤال» أو «درجة إجمالية».
                        </p>
                      )}
                    </div>
                  )}

                  {/* MODE 1: DIRECT OVERALL GRADE (Preserved intact) */}
                  {gradingMode === 'DIRECT' && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <label htmlFor="admin-grade-input" className="block text-xs font-bold text-[#0B162C]">
                        الدرجة الإجمالية المستحقة (من 0 إلى {assignmentMax})
                      </label>
                      <input
                        id="admin-grade-input"
                        type="number"
                        min={0}
                        max={assignmentMax}
                        step="0.5"
                        value={gradeInput}
                        onChange={(e) => setGradeInput(e.target.value)}
                        placeholder={`مثال: ${assignmentMax}`}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-sm font-bold focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  )}

                  {/* General Teacher Feedback (Separate from Individual Question Comments) */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div>
                      <label htmlFor="admin-hw-feedback" className="block text-xs font-bold text-[#0B162C]">
                        التعليق العام على الواجب
                      </label>
                      <textarea
                        id="admin-hw-feedback"
                        rows={3}
                        value={feedbackInput}
                        onChange={(e) => setFeedbackInput(e.target.value)}
                        placeholder="ممتاز في كتابة القانون والتعويض، استمر بهذا المستوى الرائع..."
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="admin-hw-rev-note" className="block text-xs font-bold text-amber-800">
                        تعليمات إعادة التسليم (عند اختيار إعادة للطالب للتعديل)
                      </label>
                      <textarea
                        id="admin-hw-rev-note"
                        rows={2}
                        value={revisionInput}
                        onChange={(e) => setRevisionInput(e.target.value)}
                        placeholder="يرجى إعادة تصوير الصفحة الثانية بوضوح وإعادة حل المسألة رقم 3..."
                        className="mt-1.5 w-full rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      data-testid="publish-homework-grade-btn"
                      disabled={savingGrade}
                      onClick={() => void handleGradeAction('PUBLISH_GRADE')}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>اعتماد ونشر الدرجة النهائية للطالب</span>
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={savingGrade}
                        onClick={() => void handleGradeAction('SAVE_DRAFT')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>حفظ كمسودة</span>
                      </button>
                      <button
                        type="button"
                        disabled={savingGrade}
                        onClick={() => void handleGradeAction('RETURN_FOR_REVISION')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>إعادة للتعديل</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reused Upgraded Student Full Profile Drawer */}
      {profileStudentId !== null && (
        <StudentFullProfileDrawer
          studentId={profileStudentId}
          tracks={catalog.tracks}
          grades={catalog.grades}
          videos={catalog.videos}
          onClose={() => setProfileStudentId(null)}
          onUpdated={loadSubmissions}
          onRequestDelete={() =>
            onToast('لأرشفة أو حذف حساب الطالب بأمان، يرجى استخدام قسم «الطلاب والموافقات والصلاحيات».')
          }
          onToast={onToast}
        />
      )}
    </div>
  );
};
