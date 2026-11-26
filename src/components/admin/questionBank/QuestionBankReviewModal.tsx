import React, { useEffect, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Clock,
  FileText,
  History,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../../lib/api.ts';
import { QUESTION_TYPE_LABELS } from '../../../types/exams.ts';
import {
  APPROVAL_STATUS_LABELS,
  DIFFICULTY_LABELS,
  type QuestionBankDetail,
  type QuestionDifficulty,
} from '../../../types/questionBank.ts';

interface QuestionBankReviewModalProps {
  questionId: number | null;
  canReview: boolean;
  currentUserId: number;
  onClose: () => void;
  onUpdated: (message: string) => void;
}

export const QuestionBankReviewModal: React.FC<QuestionBankReviewModalProps> = ({
  questionId,
  canReview,
  currentUserId,
  onClose,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<QuestionBankDetail | null>(null);
  const [feedbackAr, setFeedbackAr] = useState('');
  const [error, setError] = useState('');
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!questionId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setFeedbackAr('');
    (async () => {
      try {
        const res = await apiRequest<QuestionBankDetail>(`/api/admin/question-bank/${questionId}`);
        if (!cancelled) {
          setDetail(res);
          setFeedbackAr(res.reviewFeedbackAr || '');
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (!questionId) return null;

  const runAction = async (action: 'SUBMIT' | 'APPROVE' | 'RETURN' | 'ARCHIVE' | 'RESTORE') => {
    if (submitting || !detail) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/question-bank/${detail.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ action, feedbackAr }),
        },
      );
      onUpdated(res.message);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canContributorSubmit =
    detail &&
    detail.createdById === currentUserId &&
    !detail.isArchived &&
    (detail.approvalStatus === 'DRAFT' || detail.approvalStatus === 'RETURNED');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      data-testid="question-bank-review-modal"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B162C] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold">
              {detail ? `معاينة ومراجعة السؤال ${detail.bankCode}` : 'معاينة السؤال'}
            </h2>
            {detail && (
              <p className="mt-0.5 text-xs text-slate-300">
                {detail.trackNameAr} · {detail.gradeNameAr}
                {detail.unitTitleAr ? ` · ${detail.unitTitleAr}` : ''}
                {detail.lessonTitleAr ? ` · ${detail.lessonTitleAr}` : ''}
              </p>
            )}
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

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {loading || !detail ? (
            <div className="py-12 text-center text-xs text-slate-500">جارٍ تحميل التفاصيل...</div>
          ) : (
            <>
              {/* Metadata Bar */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-[#0B162C] px-2.5 py-1 font-mono-num font-bold text-white">
                  {detail.bankCode} (إصدار {detail.version})
                </span>
                <span className="rounded-md bg-blue-50 px-2.5 py-1 font-bold text-[#2563EB]">
                  {QUESTION_TYPE_LABELS[detail.questionType] || detail.questionType}
                </span>
                <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                  {DIFFICULTY_LABELS[detail.difficulty as QuestionDifficulty] || detail.difficulty}
                </span>
                <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono-num font-bold text-[#0B162C]">
                  {detail.points} درجة
                </span>
                <span className="rounded-md bg-amber-50 px-2.5 py-1 font-bold text-amber-800">
                  الحالة: {APPROVAL_STATUS_LABELS[detail.approvalStatus] || detail.approvalStatus}
                </span>
                <span className="mr-auto text-[11px] text-slate-500">
                  الاستخدام: {detail.examsUsageCount} امتحان · {detail.homeworkUsageCount} واجب · بواسطة:{' '}
                  <strong>{detail.createdByName}</strong>
                </span>
              </div>

              {/* Side-by-Side Question + Model Answer */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 space-y-3">
                  <h3 className="text-xs font-extrabold text-[#0B162C]">السؤال</h3>
                  {detail.promptAr ? (
                    <p className="whitespace-pre-line text-sm font-bold text-[#0B162C]">
                      {detail.promptAr}
                    </p>
                  ) : (
                    <p className="text-xs italic text-slate-500">سؤال مصوّر بدون نص مكتوب</p>
                  )}

                  {detail.questionImages.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detail.questionImages.map((img, idx) => (
                        <button
                          key={img.storageKey}
                          type="button"
                          onClick={() => setZoomUrl(img.previewUrl || null)}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white p-1"
                        >
                          <img
                            src={img.previewUrl}
                            alt={`صورة السؤال ${idx + 1}`}
                            className="max-h-56 w-full object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {detail.choices.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      <div className="text-[11px] font-bold text-slate-500">الاختيارات:</div>
                      {detail.choices.map((c, idx) => (
                        <div
                          key={idx}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            c.isCorrect
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          {idx + 1}. {c.labelAr} {c.isCorrect ? '✓ (الإجابة الصحيحة)' : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {detail.numericAnswer && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
                      الإجابة الرقمية: {detail.numericAnswer} {detail.numericUnit} (±{detail.numericTolerance})
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 space-y-3">
                  <h3 className="text-xs font-extrabold text-emerald-950">الإجابة النموذجية والشرح</h3>
                  {detail.modelAnswerAr ? (
                    <p className="whitespace-pre-line text-xs leading-relaxed text-emerald-950">
                      {detail.modelAnswerAr}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">لا يوجد نص إجابة نموذجية مكتوب.</p>
                  )}

                  {detail.explanationAr && (
                    <div className="rounded-lg bg-white/80 p-2.5 text-xs text-slate-700">
                      <strong>التفسير العلمي: </strong>
                      {detail.explanationAr}
                    </div>
                  )}

                  {detail.modelAnswerFiles.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detail.modelAnswerFiles.map((f) =>
                        f.mimeType === 'application/pdf' ? (
                          <a
                            key={f.storageKey}
                            href={f.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white p-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                          >
                            <FileText className="h-4 w-4" />
                            <span>فتح PDF: {f.fileName}</span>
                          </a>
                        ) : (
                          <button
                            key={f.storageKey}
                            type="button"
                            onClick={() => setZoomUrl(f.previewUrl || null)}
                            className="overflow-hidden rounded-lg border border-emerald-200 bg-white p-1"
                          >
                            <img
                              src={f.previewUrl}
                              alt={f.fileName}
                              className="max-h-56 w-full object-contain"
                            />
                          </button>
                        ),
                      )}
                    </div>
                  )}

                  {detail.teacherNotesAr && (
                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600">
                      <strong>ملاحظات داخلية: </strong>
                      {detail.teacherNotesAr}
                    </div>
                  )}
                </div>
              </div>

              {/* Teacher Review Decision Controls */}
              {canReview && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <h3 className="text-xs font-extrabold text-[#0B162C]">قرار مراجعة الأستاذ</h3>
                  <textarea
                    rows={2}
                    value={feedbackAr}
                    onChange={(e) => setFeedbackAr(e.target.value)}
                    placeholder="ملاحظة لمساعد المدرس (إلزامية عند اختيار «إعادة للتعديل» فقط)..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="review-approve-btn"
                      disabled={submitting}
                      onClick={() => void runAction('APPROVE')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>اعتماد السؤال</span>
                    </button>

                    <button
                      type="button"
                      data-testid="review-return-btn"
                      disabled={submitting}
                      onClick={() => void runAction('RETURN')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>إعادة للتعديل بملاحظة</span>
                    </button>

                    {!detail.isArchived ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void runAction('ARCHIVE')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Archive className="h-4 w-4" />
                        <span>أرشفة السؤال</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void runAction('RESTORE')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-bold text-[#2563EB]"
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span>استعادة من الأرشيف</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {canContributorSubmit && !canReview && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void runAction('SUBMIT')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                  >
                    <Send className="h-4 w-4" />
                    <span>إرسال السؤال لمراجعة الأستاذ</span>
                  </button>
                </div>
              )}

              {/* Revision History */}
              {detail.revisions.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-[#0B162C]">
                    <History className="h-4 w-4 text-[#2563EB]" />
                    <span>سجل التعديلات والمراجعة ({detail.revisions.length})</span>
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {detail.revisions.map((rev) => (
                      <div key={rev.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <span className="font-bold text-[#0B162C]">{rev.changedByName}</span>
                          <span className="mx-1.5 text-slate-400">·</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                            {rev.action} (v{rev.version})
                          </span>
                          {rev.noteAr && <span className="mr-2 text-slate-600">{rev.noteAr}</span>}
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="h-3 w-3" />
                          {formatDateTimeAr(rev.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Zoom Lightbox */}
      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4"
        >
          <img
            src={zoomUrl}
            alt="تكبير الصورة"
            className="max-h-[90vh] max-w-[92vw] rounded-xl bg-white object-contain"
          />
        </div>
      )}
    </div>
  );
};
