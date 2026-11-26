import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  Image as ImageIcon,
  Library,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../../../lib/api.ts';
import {
  QUESTION_TYPE_LABELS,
  type AdminExamChoice,
  type AdminExamQuestion,
  type QuestionType,
} from '../../../types/exams.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import type { QuestionBankListItem } from '../../../types/questionBank.ts';
import { QuestionBankPickerModal } from '../questionBank/QuestionBankPickerModal.tsx';
import { MathFormula } from '../../MathFormula.tsx';

const LATEX_SNIPPETS: Array<{ label: string; snippet: string }> = [
  { label: 'كسر', snippet: '\\frac{a}{b}' },
  { label: 'جذر', snippet: '\\sqrt{x}' },
  { label: 'أس', snippet: 'x^{2}' },
  { label: 'دليل سفلي', snippet: 'V_{B}' },
  { label: 'متجه', snippet: '\\vec{F}' },
  { label: 'أوم Ω', snippet: '\\Omega' },
  { label: 'زاوية θ', snippet: '\\theta' },
  { label: 'دلتا Δ', snippet: '\\Delta' },
  { label: 'باي π', snippet: '\\pi' },
  { label: 'أس عشري', snippet: '\\times 10^{-6}' },
];

interface AdminExamQuestionBuilderProps {
  catalog?: AdminCatalogData;
  examId: number;
  examTrackId?: number | null;
  examGradeId?: number | null;
  examUnitId?: number | null;
  examLessonId?: number | null;
  examTitleAr: string;
  durationMin: number;
  configuredTotalMarks: number;
  allowNegativeMarking: boolean;
  questions: AdminExamQuestion[];
  calculatedMarks: number;
  distribution: Record<string, number>;
  onSyncTotalMarks: (marks: number) => Promise<void>;
  onReloadExam: () => Promise<void>;
  onToast: (msg: string) => void;
}

interface QuestionDraft {
  questionType: QuestionType;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  promptAr: string;
  latexFormula: string;
  imageUrl: string;
  points: number;
  negativePoints: number;
  numericAnswer: string;
  numericTolerance: string;
  numericUnit: string;
  shortAnswerRulesText: string;
  modelAnswerAr: string;
  explanationAr: string;
  choices: AdminExamChoice[];
}

function createEmptyDraft(): QuestionDraft {
  return {
    questionType: 'MCQ',
    difficulty: 'MEDIUM',
    promptAr: '',
    latexFormula: '',
    imageUrl: '',
    points: 2,
    negativePoints: 0,
    numericAnswer: '',
    numericTolerance: '0.05',
    numericUnit: '',
    shortAnswerRulesText: '',
    modelAnswerAr: '',
    explanationAr: '',
    choices: [
      { labelAr: '', latexFormula: '', isCorrect: true },
      { labelAr: '', latexFormula: '', isCorrect: false },
      { labelAr: '', latexFormula: '', isCorrect: false },
      { labelAr: '', latexFormula: '', isCorrect: false },
    ],
  };
}

export const AdminExamQuestionBuilder: React.FC<AdminExamQuestionBuilderProps> = ({
  catalog,
  examId,
  examTrackId,
  examGradeId,
  examUnitId,
  examLessonId,
  examTitleAr,
  durationMin,
  configuredTotalMarks,
  allowNegativeMarking,
  questions,
  calculatedMarks,
  distribution,
  onSyncTotalMarks,
  onReloadExam,
  onToast,
}) => {
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [draft, setDraft] = useState<QuestionDraft>(createEmptyDraft());
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showSinglePreview, setShowSinglePreview] = useState(false);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);

  const handleAddFromBank = async (selected: QuestionBankListItem[]) => {
    if (!selected.length) return;
    const res = await apiRequest<{ message: string }>(
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
    onToast(res.message);
    await onReloadExam();
  };

  const linkedBankIds = questions
    .map((q) => q.sourceBankQuestionId)
    .filter((id): id is number => typeof id === 'number' && id > 0);

  const marksMismatch =
    configuredTotalMarks > 0 && Math.abs(calculatedMarks - configuredTotalMarks) > 0.01;

  const handleTypeChange = (nextType: QuestionType) => {
    setDraft((prev) => {
      if (nextType === 'TRUE_FALSE') {
        return {
          ...prev,
          questionType: nextType,
          choices: [
            { labelAr: 'صواب', latexFormula: '', isCorrect: true },
            { labelAr: 'خطأ', latexFormula: '', isCorrect: false },
          ],
        };
      }
      if (nextType === 'MCQ' || nextType === 'IMAGE_DIAGRAM') {
        const hasEnough = prev.choices.length >= 2 && prev.choices[0]?.labelAr !== 'صواب';
        return {
          ...prev,
          questionType: nextType,
          choices: hasEnough
            ? prev.choices
            : [
                { labelAr: '', latexFormula: '', isCorrect: true },
                { labelAr: '', latexFormula: '', isCorrect: false },
                { labelAr: '', latexFormula: '', isCorrect: false },
                { labelAr: '', latexFormula: '', isCorrect: false },
              ],
        };
      }
      return { ...prev, questionType: nextType };
    });
  };

  const handleImageFileChange = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('يرجى اختيار ملف صورة صالح (PNG / JPG / WebP)');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      onToast('حجم الصورة يجب ألا يتجاوز 2 ميجابايت');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((prev) => ({ ...prev, imageUrl: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  };

  const startEditQuestion = (q: AdminExamQuestion) => {
    setEditingQuestionId(q.id);
    setDraft({
      questionType: (q.questionType as QuestionType) || 'MCQ',
      difficulty: (q.difficulty as 'EASY' | 'MEDIUM' | 'HARD') || 'MEDIUM',
      promptAr: q.promptAr,
      latexFormula: q.latexFormula || '',
      imageUrl: q.imageUrl || '',
      points: q.points,
      negativePoints: q.negativePoints || 0,
      numericAnswer: q.numericAnswer || '',
      numericTolerance: q.numericTolerance || '0.05',
      numericUnit: q.numericUnit || '',
      shortAnswerRulesText: (q.shortAnswerRules || []).join('، '),
      modelAnswerAr: q.modelAnswerAr || '',
      explanationAr: q.explanationAr || '',
      choices:
        q.choices.length > 0
          ? q.choices.map((c) => ({
              labelAr: c.labelAr,
              latexFormula: c.latexFormula || '',
              isCorrect: c.isCorrect,
            }))
          : [
              { labelAr: '', latexFormula: '', isCorrect: true },
              { labelAr: '', latexFormula: '', isCorrect: false },
              { labelAr: '', latexFormula: '', isCorrect: false },
              { labelAr: '', latexFormula: '', isCorrect: false },
            ],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const needsChoices =
        draft.questionType === 'MCQ' ||
        draft.questionType === 'TRUE_FALSE' ||
        (draft.questionType === 'IMAGE_DIAGRAM' && draft.choices.some((c) => c.labelAr.trim().length > 0));

      const preparedChoices = needsChoices
        ? draft.choices
            .filter((c) => c.labelAr.trim().length > 0)
            .map((c) => ({
              labelAr: c.labelAr.trim(),
              latexFormula: c.latexFormula?.trim() || null,
              isCorrect: c.isCorrect,
            }))
        : [];

      const shortRules =
        draft.questionType === 'SHORT_ANSWER'
          ? draft.shortAnswerRulesText
              .split(/[,،\n]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      const payload = {
        questionType: draft.questionType,
        difficulty: draft.difficulty,
        promptAr: draft.promptAr.trim(),
        latexFormula: draft.latexFormula.trim() || null,
        imageUrl: draft.imageUrl.trim() || null,
        points: Number(draft.points) || 1,
        negativePoints: allowNegativeMarking ? Number(draft.negativePoints) || 0 : 0,
        numericAnswer: draft.questionType === 'NUMERIC' ? draft.numericAnswer.trim() : null,
        numericTolerance: draft.numericTolerance.trim() || '0.05',
        numericUnit: draft.numericUnit.trim(),
        shortAnswerRules: shortRules,
        modelAnswerAr: draft.modelAnswerAr.trim(),
        explanationAr: draft.explanationAr.trim(),
        choices: preparedChoices,
      };

      if (editingQuestionId) {
        await apiRequest(`/api/admin/phase2-exams/${examId}/questions/${editingQuestionId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onToast('تم تحديث السؤال بنجاح');
      } else {
        await apiRequest(`/api/admin/phase2-exams/${examId}/questions`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('تمت إضافة السؤال إلى الامتحان بنجاح');
      }

      setEditingQuestionId(null);
      setDraft(createEmptyDraft());
      await onReloadExam();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicateQuestion = async (questionId: number) => {
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/questions/${questionId}/duplicate`, {
        method: 'POST',
      });
      onToast('تم نسخ السؤال بنجاح');
      await onReloadExam();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDeleteQuestion = async (questionId: number) => {
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/questions/${questionId}`, {
        method: 'DELETE',
      });
      if (editingQuestionId === questionId) {
        setEditingQuestionId(null);
        setDraft(createEmptyDraft());
      }
      onToast('تم حذف السؤال من الامتحان');
      await onReloadExam();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleMoveQuestion = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    const reordered = [...questions];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, moved);
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/questions/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedQuestionIds: reordered.map((q) => q.id) }),
      });
      await onReloadExam();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  return (
    <div className="space-y-6" data-testid="exam-question-builder">
      {/* Live Exam Statistics Strip */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">عدد الأسئلة</div>
              <div className="mt-0.5 font-mono-num text-xl font-extrabold text-[#0B162C]">
                {questions.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">مجموع درجات الأسئلة</div>
              <div
                className={`mt-0.5 font-mono-num text-xl font-extrabold ${
                  marksMismatch ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {calculatedMarks}
                {configuredTotalMarks > 0 && (
                  <span className="text-xs font-normal text-slate-500">
                    {' '}
                    / {configuredTotalMarks} المحددة
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">مدة الامتحان</div>
              <div className="mt-0.5 font-mono-num text-xl font-extrabold text-[#0B162C]">
                {durationMin} <span className="text-xs font-normal text-slate-500">دقيقة</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">توزيع الأنواع</div>
              <div className="mt-1 text-xs font-medium text-slate-700">
                {Object.keys(distribution).length === 0
                  ? 'لا توجد أسئلة بعد'
                  : Object.entries(distribution)
                      .map(([k, v]) => `${QUESTION_TYPE_LABELS[k] || k} (${v})`)
                      .join(' · ')}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {catalog && (
              <button
                type="button"
                data-testid="add-exam-from-bank-btn"
                onClick={() => setBankPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
              >
                <Library className="h-4 w-4" />
                <span>إضافة أسئلة من بنك الأسئلة</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={questions.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-50 disabled:opacity-50"
            >
              <Eye className="h-4 w-4 text-[#2563EB]" />
              <span>معاينة الامتحان بالكامل</span>
            </button>
          </div>
        </div>

        {/* Marks Mismatch Warning */}
        {marksMismatch && (
          <div
            data-testid="marks-mismatch-warning"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900"
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                تنبيه: مجموع درجات الأسئلة ({calculatedMarks}) لا يطابق الدرجة الكلية المحددة للامتحان ({configuredTotalMarks}).
              </span>
            </div>
            <button
              type="button"
              onClick={() => void onSyncTotalMarks(calculatedMarks)}
              className="rounded-lg bg-amber-700 px-3 py-1.5 font-bold text-white hover:bg-amber-800"
            >
              تحديث الدرجة الكلية إلى {calculatedMarks}
            </button>
          </div>
        )}
      </div>

      {/* Add / Edit Question Form */}
      <form
        onSubmit={handleSaveQuestion}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
        data-testid="question-editor-form"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <h3 className="text-base font-extrabold text-[#0B162C]">
            {editingQuestionId ? `تعديل السؤال #${editingQuestionId}` : 'إضافة سؤال جديد إلى هذا الامتحان'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSinglePreview((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{showSinglePreview ? 'إخفاء معاينة السؤال' : 'معاينة السؤال'}</span>
            </button>
            {editingQuestionId && (
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionId(null);
                  setDraft(createEmptyDraft());
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                إلغاء التعديل
              </button>
            )}
          </div>
        </div>

        {/* Row 1: Type, Difficulty, Marks, Negative Marks */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="q-type" className="mb-1 block text-xs font-bold text-slate-700">
              نوع السؤال
            </label>
            <select
              id="q-type"
              value={draft.questionType}
              onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
            >
              <option value="MCQ">اختيار من متعدد (MCQ)</option>
              <option value="TRUE_FALSE">صح وخطأ</option>
              <option value="NUMERIC">مسألة فيزيائية رقمية (مع هامش خطأ)</option>
              <option value="SHORT_ANSWER">إجابة قصيرة</option>
              <option value="ESSAY">سؤال مقالي / خطوات حل</option>
              <option value="IMAGE_DIAGRAM">سؤال مصور / رسم بياني</option>
            </select>
          </div>

          <div>
            <label htmlFor="q-diff" className="mb-1 block text-xs font-bold text-slate-700">
              مستوى الصعوبة
            </label>
            <select
              id="q-diff"
              value={draft.difficulty}
              onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD' })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
            >
              <option value="EASY">سهل</option>
              <option value="MEDIUM">متوسط</option>
              <option value="HARD">متقدم / تفكير عليا</option>
            </select>
          </div>

          <div>
            <label htmlFor="q-points" className="mb-1 block text-xs font-bold text-slate-700">
              درجة السؤال
            </label>
            <input
              id="q-points"
              type="number"
              min={1}
              max={100}
              required
              value={draft.points}
              onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
            />
          </div>

          {allowNegativeMarking && (
            <div>
              <label htmlFor="q-neg" className="mb-1 block text-xs font-bold text-red-700">
                خصم الإجابة الخاطئة (درجة سالبة)
              </label>
              <input
                id="q-neg"
                type="number"
                step="0.25"
                min={0}
                max={20}
                value={draft.negativePoints}
                onChange={(e) => setDraft({ ...draft, negativePoints: Number(e.target.value) })}
                className="w-full rounded-lg border border-red-200 px-3 py-2 font-mono-num text-xs"
              />
            </div>
          )}
        </div>

        {/* Question Text */}
        <div>
          <label htmlFor="q-prompt" className="mb-1 block text-xs font-bold text-slate-700">
            نص السؤال الفيزيائي
          </label>
          <textarea
            id="q-prompt"
            rows={3}
            required
            value={draft.promptAr}
            onChange={(e) => setDraft({ ...draft, promptAr: e.target.value })}
            placeholder="اكتب نص السؤال بوضوح..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-relaxed focus:border-[#2563EB] focus:outline-none"
          />
        </div>

        {/* Mathematical Formula Editor (KaTeX / LaTeX) */}
        <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="q-latex" className="text-xs font-bold text-[#0B162C]">
              معادلة رياضية / فيزيائية (LaTeX — اختيارية)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LATEX_SNIPPETS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      latexFormula: prev.latexFormula
                        ? `${prev.latexFormula} ${item.snippet}`
                        : item.snippet,
                    }))
                  }
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#2563EB] hover:text-[#2563EB]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <input
              id="q-latex"
              type="text"
              dir="ltr"
              value={draft.latexFormula}
              onChange={(e) => setDraft({ ...draft, latexFormula: e.target.value })}
              placeholder="مثال: V_{B} = I(R + r) \\quad \\text{أو} \\quad F = B I L \\sin\\theta"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left font-mono text-xs"
            />
            <div className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2">
              {draft.latexFormula.trim() ? (
                <MathFormula formula={draft.latexFormula} />
              ) : (
                <span className="text-xs text-slate-400">معاينة المعادلة الفورية (KaTeX)</span>
              )}
            </div>
          </div>
        </div>

        {/* Diagram / Image Attachment */}
        <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B162C]">
              <ImageIcon className="h-4 w-4 text-[#2563EB]" />
              <span>صورة أو رسم بياني فيزيائي (اختياري)</span>
            </span>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-[#0B162C] hover:bg-slate-50">
                رفع صورة من الجهاز
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => handleImageFileChange(e.target.files?.[0] || null)}
                />
              </label>
              {draft.imageUrl && (
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, imageUrl: '' }))}
                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  إزالة الصورة
                </button>
              )}
            </div>
          </div>
          <input
            type="text"
            dir="ltr"
            value={draft.imageUrl.startsWith('data:') ? 'تم رفع صورة من الجهاز بنجاح (جاهزة للحفظ)' : draft.imageUrl}
            onChange={(e) => {
              if (!draft.imageUrl.startsWith('data:')) {
                setDraft({ ...draft, imageUrl: e.target.value });
              }
            }}
            readOnly={draft.imageUrl.startsWith('data:')}
            placeholder="أو الصق رابط صورة مباشر https://..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs"
          />
          {draft.imageUrl && (
            <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-2">
              <img
                src={draft.imageUrl}
                alt="معاينة رسم السؤال"
                referrerPolicy="no-referrer"
                className="max-h-48 rounded object-contain"
              />
            </div>
          )}
        </div>

        {/* Dynamic Answer Configuration by Question Type */}
        {(draft.questionType === 'MCQ' || draft.questionType === 'IMAGE_DIAGRAM') && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0B162C]">
                الاختيارات (حدد الاختيار الصحيح
                {draft.questionType === 'IMAGE_DIAGRAM' ? ' — أو اتركها فارغة لجعله سؤالًا مقاليًا مصورًا' : ''})
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    choices: [...prev.choices, { labelAr: '', latexFormula: '', isCorrect: false }],
                  }))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة اختيار
              </button>
            </div>

            <div className="space-y-2.5">
              {draft.choices.map((ch, idx) => (
                <div
                  key={idx}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border p-2.5 ${
                    ch.isCorrect ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 shrink-0">
                    <input
                      type="radio"
                      name="correct-choice-editor"
                      checked={ch.isCorrect}
                      onChange={() =>
                        setDraft((prev) => ({
                          ...prev,
                          choices: prev.choices.map((item, i) => ({
                            ...item,
                            isCorrect: i === idx,
                          })),
                        }))
                      }
                    />
                    <span>صحيح</span>
                  </label>
                  <input
                    type="text"
                    value={ch.labelAr}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        choices: prev.choices.map((item, i) =>
                          i === idx ? { ...item, labelAr: e.target.value } : item,
                        ),
                      }))
                    }
                    placeholder={`نص الاختيار ${idx + 1}`}
                    className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    dir="ltr"
                    value={ch.latexFormula || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        choices: prev.choices.map((item, i) =>
                          i === idx ? { ...item, latexFormula: e.target.value } : item,
                        ),
                      }))
                    }
                    placeholder="LaTeX اختياري"
                    className="w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left font-mono text-xs"
                  />
                  {draft.choices.length > 2 && (
                    <button
                      type="button"
                      aria-label={`حذف الاختيار ${idx + 1}`}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          choices: prev.choices.filter((_, i) => i !== idx),
                        }))
                      }
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {draft.questionType === 'TRUE_FALSE' && (
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-[#F7F9FC] p-4 text-xs">
            <span className="font-bold text-[#0B162C]">الإجابة الصحيحة (تصحيح تلقائي):</span>
            <label className="inline-flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="tf-answer"
                checked={draft.choices[0]?.isCorrect}
                onChange={() =>
                  setDraft((prev) => ({
                    ...prev,
                    choices: [
                      { labelAr: 'صواب', latexFormula: '', isCorrect: true },
                      { labelAr: 'خطأ', latexFormula: '', isCorrect: false },
                    ],
                  }))
                }
              />
              صواب
            </label>
            <label className="inline-flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="tf-answer"
                checked={!draft.choices[0]?.isCorrect}
                onChange={() =>
                  setDraft((prev) => ({
                    ...prev,
                    choices: [
                      { labelAr: 'صواب', latexFormula: '', isCorrect: false },
                      { labelAr: 'خطأ', latexFormula: '', isCorrect: true },
                    ],
                  }))
                }
              />
              خطأ
            </label>
          </div>
        )}

        {draft.questionType === 'NUMERIC' && (
          <div className="grid gap-4 rounded-lg border border-slate-200 bg-[#F7F9FC] p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="q-num-ans" className="mb-1 block text-xs font-bold text-[#0B162C]">
                الإجابة الرقمية الصحيحة
              </label>
              <input
                id="q-num-ans"
                type="text"
                dir="ltr"
                required
                value={draft.numericAnswer}
                onChange={(e) => setDraft({ ...draft, numericAnswer: e.target.value })}
                placeholder="مثال: 50 أو 2.5"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left font-mono-num text-xs"
              />
            </div>
            <div>
              <label htmlFor="q-num-unit" className="mb-1 block text-xs font-bold text-[#0B162C]">
                وحدة القياس (اختيارية)
              </label>
              <input
                id="q-num-unit"
                type="text"
                value={draft.numericUnit}
                onChange={(e) => setDraft({ ...draft, numericUnit: e.target.value })}
                placeholder="مثال: أمبير (A) أو أوم (Ω) أو وات (W)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label htmlFor="q-num-tol" className="mb-1 block text-xs font-bold text-[#0B162C]">
                هامش الخطأ المقبول (±)
              </label>
              <input
                id="q-num-tol"
                type="text"
                dir="ltr"
                value={draft.numericTolerance}
                onChange={(e) => setDraft({ ...draft, numericTolerance: e.target.value })}
                placeholder="0.05"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left font-mono-num text-xs"
              />
            </div>
          </div>
        )}

        {draft.questionType === 'SHORT_ANSWER' && (
          <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4 space-y-2">
            <label htmlFor="q-short-rules" className="block text-xs font-bold text-[#0B162C]">
              قاعدة التصحيح التلقائي الاختيارية (اتركها فارغة للتصحيح اليدوي بواسطة المدرس)
            </label>
            <input
              id="q-short-rules"
              type="text"
              value={draft.shortAnswerRulesText}
              onChange={(e) => setDraft({ ...draft, shortAnswerRulesText: e.target.value })}
              placeholder="مثال: الأمبير، أمبير، A (افصل الإجابات المقبولة بفاصلة للتصحيح التلقائي فقط)"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            />
          </div>
        )}

        {/* Model Answer & Explanation */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="q-model" className="mb-1 block text-xs font-bold text-slate-700">
              الإجابة النموذجية (مرجع للتصحيح والمراجعة)
            </label>
            <textarea
              id="q-model"
              rows={2}
              value={draft.modelAnswerAr}
              onChange={(e) => setDraft({ ...draft, modelAnswerAr: e.target.value })}
              placeholder="الإجابة النموذجية أو خطوات الحل الأساسية..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="q-expl" className="mb-1 block text-xs font-bold text-slate-700">
              تفسير الإجابة الصحيحة (يظهر للطالب بعد التسليم عند التفعيل)
            </label>
            <textarea
              id="q-expl"
              rows={2}
              value={draft.explanationAr}
              onChange={(e) => setDraft({ ...draft, explanationAr: e.target.value })}
              placeholder="اشرح سبب صحة الإجابة أو القانون المستخدم..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
        </div>

        {/* Single Question Live Preview */}
        {showSinglePreview && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 space-y-3">
            <div className="text-xs font-bold text-[#2563EB]">معاينة شكل السؤال كما سيراه الطالب</div>
            <p className="text-sm font-bold text-[#0B162C]">{draft.promptAr || 'نص السؤال...'}</p>
            {draft.latexFormula && <MathFormula formula={draft.latexFormula} block />}
            {draft.imageUrl && (
              <img
                src={draft.imageUrl}
                alt="رسم السؤال"
                referrerPolicy="no-referrer"
                className="max-h-56 rounded-lg border border-slate-200 bg-white object-contain"
              />
            )}
            {(draft.questionType === 'MCQ' || draft.questionType === 'TRUE_FALSE') && (
              <div className="grid gap-2 sm:grid-cols-2">
                {draft.choices.filter((c) => c.labelAr.trim()).map((c, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <span>{c.labelAr}</span>
                    {c.latexFormula && <MathFormula formula={c.latexFormula} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            data-testid="save-question-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {editingQuestionId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            <span>
              {saving
                ? 'جارٍ الحفظ...'
                : editingQuestionId
                  ? 'حفظ تعديلات السؤال'
                  : 'إضافة السؤال إلى الامتحان'}
            </span>
          </button>
        </div>
      </form>

      {/* Existing Questions in This Exam */}
      <div className="space-y-3" data-testid="exam-questions-list">
        <h3 className="text-sm font-extrabold text-[#0B162C]">
          أسئلة الامتحان الحالية ({questions.length})
        </h3>
        {questions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            لم تتم إضافة أسئلة لهذا الامتحان بعد. استخدم النموذج أعلاه لإضافة أول سؤال.
          </div>
        ) : (
          questions.map((q, idx) => (
            <div
              key={q.id}
              data-testid={`exam-question-card-${q.id}`}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono-num font-bold text-[#0B162C]">س{idx + 1}</span>
                    <span aria-hidden="true">·</span>
                    <span>{QUESTION_TYPE_LABELS[q.questionType] || q.questionType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num font-bold text-[#2563EB]">{q.points} درجة</span>
                    {q.sourceBankQuestionId && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB] border border-blue-200">
                          من بنك الأسئلة
                        </span>
                      </>
                    )}
                    {allowNegativeMarking && q.negativePoints > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num text-red-700">خصم -{q.negativePoints}</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm font-bold text-[#0B162C]">
                    {q.promptAr.trim() ? q.promptAr : 'سؤال مصور (من بنك الأسئلة)'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    aria-label={`تحريك السؤال ${idx + 1} لأعلى`}
                    onClick={() => void handleMoveQuestion(idx, -1)}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === questions.length - 1}
                    aria-label={`تحريك السؤال ${idx + 1} لأسفل`}
                    onClick={() => void handleMoveQuestion(idx, 1)}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditQuestion(q)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>تعديل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDuplicateQuestion(q.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>نسخ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteQuestion(q.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>

              {q.latexFormula && <MathFormula formula={q.latexFormula} block />}

              {q.imageUrl && (
                <img
                  src={q.imageUrl}
                  alt="رسم توضيحي للسؤال"
                  referrerPolicy="no-referrer"
                  className="max-h-48 rounded-lg border border-slate-200 object-contain"
                />
              )}

              {q.questionImages && q.questionImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.questionImages.map((img, iIdx) => (
                    <img
                      key={img.storageKey || iIdx}
                      src={img.previewUrl}
                      alt={img.fileName || `صورة ${iIdx + 1}`}
                      className="max-h-48 rounded-lg border border-slate-200 bg-slate-50 object-contain"
                    />
                  ))}
                </div>
              )}

              {q.choices.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {q.choices.map((ch) => (
                    <div
                      key={ch.id || ch.labelAr}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                        ch.isCorrect
                          ? 'border-emerald-300 bg-emerald-50 font-bold text-emerald-900'
                          : 'border-slate-200 bg-[#F7F9FC] text-slate-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {ch.isCorrect && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                        <span>{ch.labelAr}</span>
                      </span>
                      {ch.latexFormula && <MathFormula formula={ch.latexFormula} />}
                    </div>
                  ))}
                </div>
              )}

              {q.questionType === 'NUMERIC' && (
                <div className="rounded-lg bg-[#F7F9FC] px-3 py-2 text-xs text-slate-700">
                  <strong>الناتج الصحيح:</strong>{' '}
                  <span className="font-mono-num font-bold">{q.numericAnswer}</span>{' '}
                  {q.numericUnit && <span>{q.numericUnit}</span>}{' '}
                  <span className="text-slate-500">(هامش الخطأ المسموح: ±{q.numericTolerance})</span>
                </div>
              )}

              {q.explanationAr && (
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <strong>التفسير:</strong> {q.explanationAr}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Full Exam Preview Modal */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الامتحان قبل النشر"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-xs font-semibold text-[#2563EB]">معاينة الامتحان قبل النشر</div>
                <h3 className="text-base font-extrabold text-[#0B162C]">{examTitleAr}</h3>
              </div>
              <button
                type="button"
                aria-label="إغلاق المعاينة"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div className="flex flex-wrap gap-4 rounded-xl bg-[#F7F9FC] p-4 text-xs text-slate-700">
                <span>عدد الأسئلة: <strong>{questions.length}</strong></span>
                <span>إجمالي الدرجات: <strong>{calculatedMarks}</strong></span>
                <span>المدة: <strong>{durationMin} دقيقة</strong></span>
              </div>
              {questions.map((q, idx) => (
                <div key={q.id} className="rounded-xl border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>السؤال {idx + 1} · {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}</span>
                    <span className="font-mono-num font-bold text-[#0B162C]">{q.points} درجات</span>
                  </div>
                  <p className="text-sm font-bold text-[#0B162C]">{q.promptAr}</p>
                  {q.latexFormula && <MathFormula formula={q.latexFormula} block />}
                  {q.imageUrl && (
                    <img
                      src={q.imageUrl}
                      alt="رسم السؤال"
                      referrerPolicy="no-referrer"
                      className="max-h-56 rounded-lg border border-slate-200 object-contain"
                    />
                  )}
                  {q.questionImages && q.questionImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {q.questionImages.map((img, iIdx) => (
                        <img
                          key={img.storageKey || iIdx}
                          src={img.previewUrl}
                          alt={img.fileName || `صورة ${iIdx + 1}`}
                          className="max-h-56 rounded-lg border border-slate-200 object-contain"
                        />
                      ))}
                    </div>
                  )}
                  {q.choices.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {q.choices.map((ch, cIdx) => (
                        <div key={cIdx} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                          {ch.labelAr}
                          {ch.latexFormula && <MathFormula formula={ch.latexFormula} />}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.questionType === 'NUMERIC' && (
                    <div className="text-xs text-slate-500">
                      حقل إدخال رقمي {q.numericUnit ? `(الوحدة: ${q.numericUnit})` : ''}
                    </div>
                  )}
                  {(q.questionType === 'ESSAY' || q.questionType === 'SHORT_ANSWER') && (
                    <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-400">
                      مساحة كتابة إجابة الطالب...
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {catalog && (
        <QuestionBankPickerModal
          open={bankPickerOpen}
          mode="EXAM"
          catalog={catalog}
          defaultTrackId={examTrackId}
          defaultGradeId={examGradeId}
          defaultUnitId={examUnitId}
          defaultLessonId={examLessonId}
          alreadyLinkedBankIds={linkedBankIds}
          onClose={() => setBankPickerOpen(false)}
          onConfirm={handleAddFromBank}
        />
      )}
    </div>
  );
};
