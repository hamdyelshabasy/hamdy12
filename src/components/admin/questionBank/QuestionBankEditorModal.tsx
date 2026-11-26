import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Plus,
  Send,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest } from '../../../lib/api.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import { QUESTION_TYPE_LABELS, type AdminExamChoice } from '../../../types/exams.ts';
import type {
  QuestionBankAttachment,
  QuestionBankDetail,
  QuestionDifficulty,
  UploadedBankFileResponse,
} from '../../../types/questionBank.ts';

interface QuestionBankEditorModalProps {
  open: boolean;
  catalog: AdminCatalogData;
  editingQuestionId: number | null;
  canReview: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

type EditorTab = 'question' | 'model_answer' | 'classification';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف المحدد'));
    reader.readAsDataURL(file);
  });
}

export const QuestionBankEditorModal: React.FC<QuestionBankEditorModalProps> = ({
  open,
  catalog,
  editingQuestionId,
  canReview,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('question');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dupWarning, setDupWarning] = useState('');

  // Tab 1: Question
  const [questionType, setQuestionType] = useState('PHYSICS_PROBLEM');
  const [promptAr, setPromptAr] = useState('');
  const [latexFormula, setLatexFormula] = useState('');
  const [questionImages, setQuestionImages] = useState<QuestionBankAttachment[]>([]);
  const [choices, setChoices] = useState<AdminExamChoice[]>([
    { labelAr: '', isCorrect: true },
    { labelAr: '', isCorrect: false },
    { labelAr: '', isCorrect: false },
    { labelAr: '', isCorrect: false },
  ]);
  const [numericAnswer, setNumericAnswer] = useState('');
  const [numericTolerance, setNumericTolerance] = useState('0.05');
  const [numericUnit, setNumericUnit] = useState('');
  const [shortRulesText, setShortRulesText] = useState('');

  // Tab 2: Model Answer
  const [modelAnswerAr, setModelAnswerAr] = useState('');
  const [explanationAr, setExplanationAr] = useState('');
  const [modelAnswerFiles, setModelAnswerFiles] = useState<QuestionBankAttachment[]>([]);

  // Tab 3: Classification & Settings
  const [trackId, setTrackId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [topicAr, setTopicAr] = useState('');
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>('MEDIUM');
  const [points, setPoints] = useState('2');
  const [sourceAr, setSourceAr] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [teacherNotesAr, setTeacherNotesAr] = useState('');
  const [revisionNoteAr, setRevisionNoteAr] = useState('');
  const [reviewFeedbackBanner, setReviewFeedbackBanner] = useState('');

  useEffect(() => {
    if (!open) return;
    setActiveTab('question');
    setError('');
    setDupWarning('');
    setRevisionNoteAr('');
    setReviewFeedbackBanner('');

    if (!editingQuestionId) {
      const firstGrade = catalog.grades[0];
      setTrackId(firstGrade ? String(firstGrade.trackId) : '');
      setGradeId(firstGrade ? String(firstGrade.id) : '');
      setUnitId('');
      setLessonId('');
      setQuestionType('PHYSICS_PROBLEM');
      setPromptAr('');
      setLatexFormula('');
      setQuestionImages([]);
      setChoices([
        { labelAr: '', isCorrect: true },
        { labelAr: '', isCorrect: false },
        { labelAr: '', isCorrect: false },
        { labelAr: '', isCorrect: false },
      ]);
      setNumericAnswer('');
      setNumericTolerance('0.05');
      setNumericUnit('');
      setShortRulesText('');
      setModelAnswerAr('');
      setExplanationAr('');
      setModelAnswerFiles([]);
      setTopicAr('');
      setDifficulty('MEDIUM');
      setPoints('2');
      setSourceAr('');
      setTagsText('');
      setTeacherNotesAr('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const q = await apiRequest<QuestionBankDetail>(`/api/admin/question-bank/${editingQuestionId}`);
        if (cancelled) return;
        setTrackId(q.trackId ? String(q.trackId) : '');
        setGradeId(String(q.gradeId));
        setUnitId(q.unitId ? String(q.unitId) : '');
        setLessonId(q.lessonId ? String(q.lessonId) : '');
        setQuestionType(q.questionType);
        setPromptAr(q.promptAr || '');
        setLatexFormula(q.latexFormula || '');
        setQuestionImages(q.questionImages || []);
        setChoices(
          q.choices && q.choices.length >= 2
            ? q.choices
            : [
                { labelAr: '', isCorrect: true },
                { labelAr: '', isCorrect: false },
              ],
        );
        setNumericAnswer(q.numericAnswer || '');
        setNumericTolerance(q.numericTolerance || '0.05');
        setNumericUnit(q.numericUnit || '');
        setShortRulesText((q.shortAnswerRules || []).join('\n'));
        setModelAnswerAr(q.modelAnswerAr || '');
        setExplanationAr(q.explanationAr || '');
        setModelAnswerFiles(q.modelAnswerFiles || []);
        setTopicAr(q.topicAr || '');
        setDifficulty((q.difficulty as QuestionDifficulty) || 'MEDIUM');
        setPoints(String(q.points || 2));
        setSourceAr(q.sourceAr || '');
        setTagsText((q.tags || []).join('، '));
        setTeacherNotesAr(q.teacherNotesAr || '');
        setReviewFeedbackBanner(q.reviewFeedbackAr || '');
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, editingQuestionId, catalog.grades]);

  const filteredGrades = useMemo(
    () => (trackId ? catalog.grades.filter((g) => g.trackId === Number(trackId)) : catalog.grades),
    [catalog.grades, trackId],
  );
  const filteredUnits = useMemo(
    () => (gradeId ? catalog.units.filter((u) => u.gradeId === Number(gradeId)) : []),
    [catalog.units, gradeId],
  );
  const filteredLessons = useMemo(
    () => (unitId ? catalog.lessons.filter((l) => l.unitId === Number(unitId)) : []),
    [catalog.lessons, unitId],
  );

  if (!open) return null;

  const handleUploadFiles = async (
    fileList: FileList | null,
    purpose: 'QUESTION_IMAGE' | 'MODEL_ANSWER_FILE',
  ) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const files = Array.from(fileList);
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const uploaded = await apiRequest<UploadedBankFileResponse>(
          '/api/admin/question-bank/files/upload',
          {
            method: 'POST',
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type,
              dataBase64: dataUrl,
              purpose,
            }),
          },
        );
        if (uploaded.duplicateWarning?.isDuplicate) {
          setDupWarning(uploaded.duplicateWarning.messageAr);
        }
        const att: QuestionBankAttachment = {
          attachmentRole:
            purpose === 'QUESTION_IMAGE'
              ? 'QUESTION_IMAGE'
              : uploaded.mimeType === 'application/pdf'
                ? 'MODEL_ANSWER_PDF'
                : 'MODEL_ANSWER_IMAGE',
          storageKey: uploaded.storageKey,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          displayOrder: 0,
          previewUrl: uploaded.previewUrl,
        };
        if (purpose === 'QUESTION_IMAGE') {
          setQuestionImages((prev) => [...prev, { ...att, displayOrder: prev.length }].slice(0, 6));
        } else {
          setModelAnswerFiles((prev) => [...prev, { ...att, displayOrder: prev.length }].slice(0, 6));
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const moveAttachment = (
    list: QuestionBankAttachment[],
    setter: React.Dispatch<React.SetStateAction<QuestionBankAttachment[]>>,
    index: number,
    dir: -1 | 1,
  ) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const copy = [...list];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    setter(copy.map((item, idx) => ({ ...item, displayOrder: idx })));
  };

  const handleSave = async (targetAction: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED') => {
    if (saving) return;
    if (!gradeId) {
      setActiveTab('classification');
      setError('يرجى اختيار الصف الدراسي في تبويب «التصنيف والإعدادات».');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const cleanTags = tagsText
        .split(/[,،\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const cleanShortRules = shortRulesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        trackId: trackId ? Number(trackId) : null,
        gradeId: Number(gradeId),
        unitId: unitId ? Number(unitId) : null,
        lessonId: lessonId ? Number(lessonId) : null,
        topicAr,
        questionType,
        difficulty,
        promptAr,
        latexFormula: latexFormula || null,
        points: Math.max(1, Number(points) || 2),
        numericAnswer: questionType === 'NUMERIC' ? numericAnswer : null,
        numericTolerance: questionType === 'NUMERIC' ? numericTolerance : '0.05',
        numericUnit: questionType === 'NUMERIC' ? numericUnit : '',
        shortAnswerRules: questionType === 'SHORT_ANSWER' ? cleanShortRules : [],
        modelAnswerAr,
        explanationAr,
        sourceAr,
        teacherNotesAr,
        tags: cleanTags,
        choices:
          questionType === 'MCQ' || questionType === 'TRUE_FALSE'
            ? choices.filter((c) => c.labelAr.trim().length > 0)
            : [],
        questionImages: questionImages.map((img, idx) => ({
          storageKey: img.storageKey,
          captionAr: img.captionAr || '',
          displayOrder: idx,
        })),
        modelAnswerFiles: modelAnswerFiles.map((f, idx) => ({
          storageKey: f.storageKey,
          captionAr: f.captionAr || '',
          displayOrder: idx,
        })),
        initialStatus: targetAction,
        submitForReview: targetAction === 'PENDING_REVIEW',
        revisionNoteAr,
      };

      const res = editingQuestionId
        ? await apiRequest<{ message: string }>(`/api/admin/question-bank/${editingQuestionId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiRequest<{ message: string }>('/api/admin/question-bank', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      onSaved(res.message || 'تم حفظ السؤال بنجاح');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      data-testid="question-bank-editor-modal"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold">
              {editingQuestionId ? `تعديل سؤال في بنك الأسئلة (#${editingQuestionId})` : 'إضافة سؤال جديد إلى بنك الأسئلة'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">
              يدعم الأسئلة النصية أو المصوّرة بالكامل مع إجابات نموذجية محمية وتصنيف أكاديمي دقيق.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 3 Clean Editor Tabs */}
        <div className="flex border-b border-slate-200 bg-[#F7F9FC] px-4 pt-2 gap-1">
          {[
            { id: 'question' as const, label: '1. السؤال والصور', icon: <ImageIcon className="h-3.5 w-3.5" /> },
            { id: 'model_answer' as const, label: '2. الإجابة النموذجية', icon: <FileText className="h-3.5 w-3.5" /> },
            { id: 'classification' as const, label: '3. التصنيف والإعدادات', icon: <Tag className="h-3.5 w-3.5" /> },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`qb-editor-tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2.5 text-xs font-bold transition-colors ${
                activeTab === t.id
                  ? 'border-[#2563EB] bg-white text-[#2563EB]'
                  : 'border-transparent text-slate-600 hover:text-[#0B162C]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {reviewFeedbackBanner && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>ملاحظة الأستاذ لإعادة التعديل: </strong>
              {reviewFeedbackBanner}
            </div>
          )}

          {dupWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="flex-1">{dupWarning}</div>
              <button
                type="button"
                onClick={() => setDupWarning('')}
                className="text-amber-700 hover:text-amber-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">جارٍ تحميل بيانات السؤال...</div>
          ) : (
            <>
              {/* TAB 1: QUESTION */}
              {activeTab === 'question' && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">نوع السؤال</label>
                      <select
                        value={questionType}
                        onChange={(e) => {
                          const next = e.target.value;
                          setQuestionType(next);
                          if (next === 'TRUE_FALSE') {
                            setChoices([
                              { labelAr: 'صواب', isCorrect: true },
                              { labelAr: 'خطأ', isCorrect: false },
                            ]);
                          }
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      >
                        {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        معادلة فيزيائية LaTeX (اختياري)
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={latexFormula}
                        onChange={(e) => setLatexFormula(e.target.value)}
                        placeholder="مثال: V = I \cdot R"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      نص السؤال (اختياري في حالة رفع صورة للسؤال)
                    </label>
                    <textarea
                      rows={3}
                      value={promptAr}
                      onChange={(e) => setPromptAr(e.target.value)}
                      placeholder="اكتب نص السؤال أو اتركه فارغًا واكتفِ بصور السؤال..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  {/* Multi-Image Question Uploader */}
                  <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-extrabold text-[#0B162C]">
                          صور السؤال (حتى 6 صور — JPG / PNG / WEBP — حد أقصى 3MB للصورة)
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          يمكنك رفع أكثر من صورة لصفحات المسألة وترتيبها بدقة.
                        </p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{uploading ? 'جارٍ الرفع...' : 'رفع صور السؤال'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          disabled={uploading || questionImages.length >= 6}
                          onChange={(e) => {
                            void handleUploadFiles(e.target.files, 'QUESTION_IMAGE');
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {questionImages.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {questionImages.map((img, idx) => (
                          <div
                            key={img.storageKey}
                            className="rounded-xl border border-slate-200 bg-white p-2 space-y-2"
                          >
                            <img
                              src={img.previewUrl}
                              alt={img.fileName}
                              className="h-36 w-full rounded-lg bg-slate-50 object-contain"
                            />
                            <div className="flex items-center justify-between gap-1 text-[11px]">
                              <span className="truncate font-semibold text-slate-700">
                                {idx + 1}. {img.fileName}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveAttachment(questionImages, setQuestionImages, idx, -1)}
                                  className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === questionImages.length - 1}
                                  onClick={() => moveAttachment(questionImages, setQuestionImages, idx, 1)}
                                  className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setQuestionImages((prev) =>
                                      prev.filter((_, i) => i !== idx).map((x, i) => ({ ...x, displayOrder: i })),
                                    )
                                  }
                                  className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Objective Choices */}
                  {(questionType === 'MCQ' || questionType === 'TRUE_FALSE') && (
                    <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-extrabold text-[#0B162C]">
                          الاختيارات (حدّد الإجابة الصحيحة)
                        </h3>
                        {questionType === 'MCQ' && choices.length < 6 && (
                          <button
                            type="button"
                            onClick={() => setChoices((prev) => [...prev, { labelAr: '', isCorrect: false }])}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Plus className="h-3 w-3" />
                            إضافة اختيار
                          </button>
                        )}
                      </div>
                      {choices.map((ch, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="qb-correct-choice"
                            checked={ch.isCorrect}
                            onChange={() =>
                              setChoices((prev) =>
                                prev.map((c, i) => ({ ...c, isCorrect: i === idx })),
                              )
                            }
                          />
                          <input
                            type="text"
                            value={ch.labelAr}
                            onChange={(e) =>
                              setChoices((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, labelAr: e.target.value } : c)),
                              )
                            }
                            placeholder={`الاختيار ${idx + 1}`}
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                          />
                          {questionType === 'MCQ' && choices.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setChoices((prev) => prev.filter((_, i) => i !== idx))}
                              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {questionType === 'NUMERIC' && (
                    <div className="grid gap-3 sm:grid-cols-3 rounded-xl border border-slate-200 p-4">
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">الإجابة الرقمية</label>
                        <input
                          type="text"
                          dir="ltr"
                          value={numericAnswer}
                          onChange={(e) => setNumericAnswer(e.target.value)}
                          placeholder="12.5"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">هامش الخطأ المسموح</label>
                        <input
                          type="text"
                          dir="ltr"
                          value={numericTolerance}
                          onChange={(e) => setNumericTolerance(e.target.value)}
                          placeholder="0.05"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">وحدة القياس</label>
                        <input
                          type="text"
                          value={numericUnit}
                          onChange={(e) => setNumericUnit(e.target.value)}
                          placeholder="أمبير / أوم / نيوتن"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {questionType === 'SHORT_ANSWER' && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        الكلمات/الإجابات المقبولة تلقائيًا (سطر لكل إجابة)
                      </label>
                      <textarea
                        rows={3}
                        value={shortRulesText}
                        onChange={(e) => setShortRulesText(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: MODEL ANSWER */}
              {activeTab === 'model_answer' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      نص الإجابة النموذجية / خطوات الحل
                    </label>
                    <textarea
                      rows={4}
                      value={modelAnswerAr}
                      onChange={(e) => setModelAnswerAr(e.target.value)}
                      placeholder="اكتب خطوات الحل النموذجية (محمية ولا تظهر للطالب قبل قواعد الإتاحة)..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      التفسير العلمي والملاحظة التعليمية (اختياري)
                    </label>
                    <textarea
                      rows={3}
                      value={explanationAr}
                      onChange={(e) => setExplanationAr(e.target.value)}
                      placeholder="شرح القانون المستخدم أو سبب استبعاد الاختيارات الأخرى..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  {/* Model Answer Images / PDF */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-extrabold text-emerald-950">
                          صور أو PDF الإجابة النموذجية (محمية بالكامل عن الطلاب)
                        </h3>
                        <p className="text-[11px] text-emerald-800">
                          يمكنك رفع صور حل بخط اليد (JPG/PNG/WEBP حتى 3MB) أو ملف PDF (حتى 8MB).
                        </p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{uploading ? 'جارٍ الرفع...' : 'رفع صور / PDF للإجابة'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          multiple
                          disabled={uploading || modelAnswerFiles.length >= 6}
                          onChange={(e) => {
                            void handleUploadFiles(e.target.files, 'MODEL_ANSWER_FILE');
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {modelAnswerFiles.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {modelAnswerFiles.map((f, idx) => (
                          <div
                            key={f.storageKey}
                            className="rounded-xl border border-emerald-200 bg-white p-2 space-y-2"
                          >
                            {f.mimeType === 'application/pdf' ? (
                              <a
                                href={f.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg bg-emerald-50 text-emerald-800"
                              >
                                <FileText className="h-8 w-8" />
                                <span className="text-[11px] font-bold">فتح ملف PDF</span>
                              </a>
                            ) : (
                              <img
                                src={f.previewUrl}
                                alt={f.fileName}
                                className="h-32 w-full rounded-lg bg-slate-50 object-contain"
                              />
                            )}
                            <div className="flex items-center justify-between gap-1 text-[11px]">
                              <span className="truncate font-semibold text-slate-700">
                                {idx + 1}. {f.fileName}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() =>
                                    moveAttachment(modelAnswerFiles, setModelAnswerFiles, idx, -1)
                                  }
                                  className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === modelAnswerFiles.length - 1}
                                  onClick={() =>
                                    moveAttachment(modelAnswerFiles, setModelAnswerFiles, idx, 1)
                                  }
                                  className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModelAnswerFiles((prev) =>
                                      prev.filter((_, i) => i !== idx).map((x, i) => ({ ...x, displayOrder: i })),
                                    )
                                  }
                                  className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: CLASSIFICATION & SETTINGS */}
              {activeTab === 'classification' && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">المسار التعليمي</label>
                      <select
                        value={trackId}
                        onChange={(e) => {
                          setTrackId(e.target.value);
                          setGradeId('');
                          setUnitId('');
                          setLessonId('');
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      >
                        <option value="">اختر المسار</option>
                        {catalog.tracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">الصف الدراسي *</label>
                      <select
                        value={gradeId}
                        onChange={(e) => {
                          const gId = e.target.value;
                          setGradeId(gId);
                          const found = catalog.grades.find((g) => g.id === Number(gId));
                          if (found) setTrackId(String(found.trackId));
                          setUnitId('');
                          setLessonId('');
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      >
                        <option value="">اختر الصف الدراسي</option>
                        {filteredGrades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">الوحدة / الفصل</label>
                      <select
                        value={unitId}
                        onChange={(e) => {
                          setUnitId(e.target.value);
                          setLessonId('');
                        }}
                        disabled={!gradeId}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-50"
                      >
                        <option value="">غير محدد</option>
                        {filteredUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">الدرس</label>
                      <select
                        value={lessonId}
                        onChange={(e) => setLessonId(e.target.value)}
                        disabled={!unitId}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-50"
                      >
                        <option value="">غير محدد</option>
                        {filteredLessons.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.titleAr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">مستوى الصعوبة</label>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      >
                        <option value="EASY">سهل</option>
                        <option value="MEDIUM">متوسط</option>
                        <option value="HARD">متقدم / صعب</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">الدرجة المقترحة</label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={points}
                        onChange={(e) => setPoints(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">الموضوع الفرعي</label>
                      <input
                        type="text"
                        value={topicAr}
                        onChange={(e) => setTopicAr(e.target.value)}
                        placeholder="مثال: قانون أوم للدائرة المغلقة"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">المصدر / المرجع</label>
                      <input
                        type="text"
                        value={sourceAr}
                        onChange={(e) => setSourceAr(e.target.value)}
                        placeholder="مثال: كتاب الامتحان 2026 / امتحان مصر 2024"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        الوسوم (افصل بفاصلة)
                      </label>
                      <input
                        type="text"
                        value={tagsText}
                        onChange={(e) => setTagsText(e.target.value)}
                        placeholder="كيرشوف، مسائل مستويات عليا، رسم بياني"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      ملاحظات داخلية للمدرس والمساعدين (لا تظهر للطلاب)
                    </label>
                    <textarea
                      rows={2}
                      value={teacherNotesAr}
                      onChange={(e) => setTeacherNotesAr(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  {editingQuestionId && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        سبب التعديل (يُحفظ في سجل التعديلات)
                      </label>
                      <input
                        type="text"
                        value={revisionNoteAr}
                        onChange={(e) => setRevisionNoteAr(e.target.value)}
                        placeholder="مثال: تحديث صورة السؤال بدقة أعلى"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            إلغاء
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="qb-save-draft-btn"
              disabled={saving || uploading}
              onClick={() => void handleSave('DRAFT')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#0B162C] hover:bg-slate-50 disabled:opacity-50"
            >
              حفظ كمسودة
            </button>

            {canReview ? (
              <button
                type="button"
                data-testid="qb-save-approve-btn"
                disabled={saving || uploading}
                onClick={() => void handleSave('APPROVED')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>{saving ? 'جارٍ الحفظ...' : 'حفظ واعتماد مباشر'}</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="qb-save-submit-btn"
                disabled={saving || uploading}
                onClick={() => void handleSave('PENDING_REVIEW')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{saving ? 'جارٍ الإرسال...' : 'حفظ وإرسال لمراجعة الأستاذ'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
