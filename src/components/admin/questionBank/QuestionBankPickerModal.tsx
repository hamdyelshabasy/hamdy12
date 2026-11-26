import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Eye,
  FileText,
  Filter,
  Image as ImageIcon,
  Search,
  Square,
  X,
} from 'lucide-react';
import { apiRequest } from '../../../lib/api.ts';
import type { AdminCatalogData } from '../AdminContentPanel.tsx';
import { QUESTION_TYPE_LABELS } from '../../../types/exams.ts';
import {
  DIFFICULTY_LABELS,
  type QuestionBankDetail,
  type QuestionBankListItem,
  type QuestionDifficulty,
} from '../../../types/questionBank.ts';

interface QuestionBankPickerModalProps {
  open: boolean;
  mode: 'EXAM' | 'HOMEWORK';
  catalog: AdminCatalogData;
  defaultTrackId?: number | null;
  defaultGradeId?: number | null;
  defaultUnitId?: number | null;
  defaultLessonId?: number | null;
  alreadyLinkedBankIds?: number[];
  onClose: () => void;
  onConfirm: (selectedQuestions: QuestionBankListItem[]) => Promise<void> | void;
}

export const QuestionBankPickerModal: React.FC<QuestionBankPickerModalProps> = ({
  open,
  mode,
  catalog,
  defaultTrackId,
  defaultGradeId,
  defaultUnitId,
  defaultLessonId,
  alreadyLinkedBankIds = [],
  onClose,
  onConfirm,
}) => {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [trackId, setTrackId] = useState<string>(defaultTrackId ? String(defaultTrackId) : '');
  const [gradeId, setGradeId] = useState<string>(defaultGradeId ? String(defaultGradeId) : '');
  const [unitId, setUnitId] = useState<string>(defaultUnitId ? String(defaultUnitId) : '');
  const [lessonId, setLessonId] = useState<string>(defaultLessonId ? String(defaultLessonId) : '');
  const [questionType, setQuestionType] = useState('ALL');
  const [difficulty, setDifficulty] = useState('ALL');
  const [hasImages, setHasImages] = useState(false);
  const [hasModelAnswer, setHasModelAnswer] = useState(false);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<QuestionBankListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Selection persists across pages
  const [selectedMap, setSelectedMap] = useState<Record<number, QuestionBankListItem>>({});
  const [previewQuestion, setPreviewQuestion] = useState<QuestionBankDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTrackId(defaultTrackId ? String(defaultTrackId) : '');
    setGradeId(defaultGradeId ? String(defaultGradeId) : '');
    setUnitId(defaultUnitId ? String(defaultUnitId) : '');
    setLessonId(defaultLessonId ? String(defaultLessonId) : '');
    setSelectedMap({});
    setPreviewQuestion(null);
    setPage(1);
    setError('');
  }, [open, defaultTrackId, defaultGradeId, defaultUnitId, defaultLessonId]);

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

  const loadQuestions = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('approvedOnly', '1');
      qs.set('page', String(page));
      qs.set('pageSize', '20');
      if (search.trim()) qs.set('search', search.trim());
      if (trackId) qs.set('trackId', trackId);
      if (gradeId) qs.set('gradeId', gradeId);
      if (unitId) qs.set('unitId', unitId);
      if (lessonId) qs.set('lessonId', lessonId);
      if (questionType !== 'ALL') qs.set('questionType', questionType);
      if (difficulty !== 'ALL') qs.set('difficulty', difficulty);
      if (hasImages) qs.set('hasImages', '1');
      if (hasModelAnswer) qs.set('hasModelAnswer', '1');

      const res = await apiRequest<{
        items: QuestionBankListItem[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/admin/question-bank?${qs.toString()}`);

      setItems(res.items || []);
      setTotal(res.pagination?.total || 0);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [open, page, search, trackId, gradeId, unitId, lessonId, questionType, difficulty, hasImages, hasModelAnswer]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  if (!open) return null;

  const selectedList = Object.values(selectedMap);
  const totalSuggestedPoints = selectedList.reduce((acc, q) => acc + Number(q.points || 0), 0);

  const toggleSelect = (item: QuestionBankListItem) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item;
      return next;
    });
  };

  const openPreview = async (id: number) => {
    setPreviewLoading(true);
    try {
      const detail = await apiRequest<QuestionBankDetail>(`/api/admin/question-bank/${id}`);
      setPreviewQuestion(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedList.length || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(selectedList);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      data-testid="question-bank-picker-modal"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold">
              {mode === 'EXAM'
                ? 'اختيار أسئلة معتمدة من بنك الأسئلة للامتحان'
                : 'اختيار أسئلة معتمدة من بنك الأسئلة للواجب'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">
              تظهر هنا الأسئلة المعتمدة والجاهزة للاستخدام فقط. يتم أخذ نسخة آمنة لكل سؤال لحماية السجل التاريخي.
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

        {/* Filters */}
        <div className="border-b border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="ابحث بنص السؤال، الكود (QB-...)، الموضوع، أو الوسم..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:outline-none"
              />
            </div>

            <select
              value={trackId}
              onChange={(e) => {
                setTrackId(e.target.value);
                setGradeId('');
                setUnitId('');
                setLessonId('');
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              <option value="">كل المسارات</option>
              {catalog.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </select>

            <select
              value={gradeId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setUnitId('');
                setLessonId('');
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              <option value="">كل الصفوف</option>
              {filteredGrades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>

            <select
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
                setLessonId('');
                setPage(1);
              }}
              disabled={!gradeId}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:opacity-50"
            >
              <option value="">كل الوحدات</option>
              {filteredUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.titleAr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={lessonId}
              onChange={(e) => {
                setLessonId(e.target.value);
                setPage(1);
              }}
              disabled={!unitId}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:opacity-50"
            >
              <option value="">كل الدروس</option>
              {filteredLessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.titleAr}
                </option>
              ))}
            </select>

            <select
              value={questionType}
              onChange={(e) => {
                setQuestionType(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="ALL">كل أنواع الأسئلة</option>
              {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="ALL">كل المستويات</option>
              <option value="EASY">سهل</option>
              <option value="MEDIUM">متوسط</option>
              <option value="HARD">متقدم / صعب</option>
            </select>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <input
                type="checkbox"
                checked={hasImages}
                onChange={(e) => {
                  setHasImages(e.target.checked);
                  setPage(1);
                }}
              />
              <span>بصور فقط</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <input
                type="checkbox"
                checked={hasModelAnswer}
                onChange={(e) => {
                  setHasModelAnswer(e.target.checked);
                  setPage(1);
                }}
              />
              <span>بإجابة نموذجية فقط</span>
            </label>

            <span className="mr-auto font-mono-num text-[11px] font-bold text-slate-500">
              النتائج المعتمدة: {total}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              جارٍ تحميل الأسئلة المعتمدة من بنك الأسئلة...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-xs text-slate-500">
              لا توجد أسئلة معتمدة مطابقة لخيارات البحث الحالية.
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => {
                const isSelected = Boolean(selectedMap[item.id]);
                const alreadyInTarget = alreadyLinkedBankIds.includes(item.id);
                const firstThumb = item.questionImages[0]?.previewUrl || item.imageUrl;

                return (
                  <div
                    key={item.id}
                    data-testid={`picker-question-row-${item.id}`}
                    className={`flex flex-col gap-3 rounded-xl border p-3.5 transition-colors sm:flex-row sm:items-center ${
                      isSelected
                        ? 'border-[#2563EB] bg-blue-50/60'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelect(item)}
                      className="flex flex-1 items-start gap-3 text-right"
                    >
                      <span className="mt-0.5 text-[#2563EB]">
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5" />
                        ) : (
                          <Square className="h-5 w-5 text-slate-400" />
                        )}
                      </span>

                      {firstThumb && (
                        <img
                          src={firstThumb}
                          alt={item.bankCode}
                          className="h-16 w-20 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
                        />
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded bg-[#0B162C] px-1.5 py-0.5 font-mono-num font-bold text-white">
                            {item.bankCode}
                          </span>
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-[#2563EB]">
                            {QUESTION_TYPE_LABELS[item.questionType] || item.questionType}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
                            {DIFFICULTY_LABELS[item.difficulty as QuestionDifficulty] || item.difficulty}
                          </span>
                          <span className="font-mono-num font-bold text-[#0B162C]">
                            {item.points} درجة
                          </span>
                          {item.questionImages.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-slate-600">
                              <ImageIcon className="h-3 w-3" />
                              {item.questionImages.length}
                            </span>
                          )}
                          {item.hasModelAnswer && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold">
                              <FileText className="h-3 w-3" />
                              إجابة نموذجية
                            </span>
                          )}
                          {alreadyInTarget && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
                              مُضاف مسبقًا
                            </span>
                          )}
                        </div>

                        <p className="line-clamp-2 text-xs font-bold text-[#0B162C]">
                          {item.promptAr || (item.topicAr ? `سؤال مصور — ${item.topicAr}` : 'سؤال مصور بدون نص مكتوب')}
                        </p>

                        <div className="text-[11px] text-slate-500">
                          {item.trackNameAr} · {item.gradeNameAr}
                          {item.unitTitleAr ? ` · ${item.unitTitleAr}` : ''}
                          {item.lessonTitleAr ? ` · ${item.lessonTitleAr}` : ''}
                          {item.sourceAr ? ` · المصدر: ${item.sourceAr}` : ''}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void openPreview(item.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                السابق
              </button>
              <span className="font-mono-num text-slate-600">
                صفحة {page} من {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          )}
        </div>

        {/* Inline Preview Drawer */}
        {(previewLoading || previewQuestion) && (
          <div className="border-t border-slate-200 bg-slate-50 p-4 max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-[#0B162C]">
                {previewLoading
                  ? 'جارٍ تحميل المعاينة...'
                  : `معاينة السؤال ${previewQuestion?.bankCode}`}
              </span>
              <button
                type="button"
                onClick={() => setPreviewQuestion(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                إغلاق المعاينة
              </button>
            </div>
            {previewQuestion && (
              <div className="grid gap-4 md:grid-cols-2 text-xs">
                <div className="space-y-2">
                  <div className="font-bold text-[#0B162C]">
                    {previewQuestion.promptAr || 'سؤال مصور'}
                  </div>
                  {previewQuestion.questionImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {previewQuestion.questionImages.map((img) => (
                        <img
                          key={img.storageKey}
                          src={img.previewUrl}
                          alt={img.fileName}
                          className="max-h-32 rounded border border-slate-200 bg-white object-contain"
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
                  <div className="font-bold text-emerald-900">الإجابة النموذجية:</div>
                  {previewQuestion.modelAnswerAr ? (
                    <p className="whitespace-pre-line text-emerald-900">{previewQuestion.modelAnswerAr}</p>
                  ) : (
                    <p className="text-slate-500">لا يوجد نص مكتوب</p>
                  )}
                  {previewQuestion.modelAnswerFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {previewQuestion.modelAnswerFiles.map((f) =>
                        f.mimeType === 'application/pdf' ? (
                          <a
                            key={f.storageKey}
                            href={f.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-bold text-emerald-800"
                          >
                            PDF: {f.fileName}
                          </a>
                        ) : (
                          <img
                            key={f.storageKey}
                            src={f.previewUrl}
                            alt={f.fileName}
                            className="max-h-24 rounded border border-emerald-200 bg-white object-contain"
                          />
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3.5">
          <div className="text-xs text-slate-700">
            تم اختيار{' '}
            <strong className="font-mono-num text-[#2563EB]">{selectedList.length}</strong> سؤال
            {' · '}
            إجمالي الدرجات المقترحة:{' '}
            <strong className="font-mono-num text-[#0B162C]">{totalSuggestedPoints}</strong> درجة
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="button"
              data-testid="confirm-bank-picker-btn"
              disabled={selectedList.length === 0 || submitting}
              onClick={() => void handleConfirm()}
              className="rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {submitting
                ? 'جارٍ الإضافة...'
                : mode === 'EXAM'
                  ? `إضافة (${selectedList.length}) سؤال للامتحان`
                  : `إضافة (${selectedList.length}) سؤال للواجب`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
