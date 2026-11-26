import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  Save,
  Send,
  XCircle,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../../lib/api.ts';
import {
  ATTEMPT_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
  type AdminExamQuestion,
} from '../../../types/exams.ts';
import { MathFormula } from '../../MathFormula.tsx';

interface AnalyticsResponse {
  exam: {
    id: number;
    titleAr: string;
    examType: string;
    durationMin: number;
    passScorePercent: number;
    totalMarks: number;
  };
  analytics: {
    totalAssignedStudents: number;
    startedCount: number;
    submittedCount: number;
    notStartedCount: number;
    averageScore: number;
    averagePercent: number;
    highestScore: number;
    lowestScore: number;
    passCount: number;
    failCount: number;
    passRate: number;
    failRate: number;
    pendingManualGradingCount: number;
  };
  attempts: Array<{
    id: number;
    examId: number;
    userId: number;
    studentName: string;
    studentPhone: string | null;
    attemptNumber: number;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    autoScore: number;
    manualScore: number;
    totalScore: number;
    maxScore: number;
    percent: number;
    passed: boolean;
    resultPublished: boolean;
    generalFeedback: string;
    pendingManualAnswers: number;
  }>;
}

interface AttemptDetailResponse {
  attempt: {
    id: number;
    attemptNumber: number;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    autoScore: number;
    manualScore: number;
    totalScore: number;
    maxScore: number;
    passed: boolean;
    resultPublished: boolean;
    generalFeedback: string;
    studentName: string;
    studentPhone: string | null;
  };
  exam: {
    id: number;
    titleAr: string;
    passScorePercent: number;
  };
  items: Array<{
    question: AdminExamQuestion;
    answer: {
      id: number;
      selectedChoiceId: number | null;
      textAnswer: string | null;
      numericAnswer: string | null;
      uploadedFileName: string | null;
      uploadedFileData: string | null;
      isCorrect: boolean | null;
      awardedPoints: number;
      needsManualGrading: boolean;
      graderFeedback: string;
    } | null;
  }>;
}

interface AdminExamAnalyticsGradingProps {
  examId: number;
  onBack: () => void;
  onToast: (msg: string) => void;
}

export const AdminExamAnalyticsGrading: React.FC<AdminExamAnalyticsGradingProps> = ({
  examId,
  onBack,
  onToast,
}) => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'GRADED' | 'IN_PROGRESS'>('ALL');
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptDetailResponse | null>(null);
  const [loadingAttempt, setLoadingAttempt] = useState(false);

  // Teacher grading draft state
  const [gradeMap, setGradeMap] = useState<Record<number, { points: number; feedback: string }>>({});
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [publishResult, setPublishResult] = useState(true);
  const [savingGrade, setSavingGrade] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<AnalyticsResponse>(`/api/admin/phase2-exams/${examId}/analytics`);
      setData(res);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [examId, onToast]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const openAttemptDetail = async (attemptId: number) => {
    setLoadingAttempt(true);
    try {
      const res = await apiRequest<AttemptDetailResponse>(
        `/api/admin/phase2-exams/attempts/${attemptId}`,
      );
      setSelectedAttempt(res);
      setGeneralFeedback(res.attempt.generalFeedback || '');
      setPublishResult(true);
      const map: Record<number, { points: number; feedback: string }> = {};
      for (const item of res.items) {
        map[item.question.id] = {
          points: item.answer ? item.answer.awardedPoints : 0,
          feedback: item.answer?.graderFeedback || '',
        };
      }
      setGradeMap(map);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoadingAttempt(false);
    }
  };

  const handleSaveAttemptGrading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttempt) return;
    setSavingGrade(true);
    try {
      const gradesPayload = selectedAttempt.items
        .filter((it) => {
          const isManualType =
            it.answer?.needsManualGrading ||
            ['ESSAY', 'SHORT_ANSWER', 'PHYSICS_PROBLEM', 'FILE_UPLOAD'].includes(
              it.question.questionType,
            ) ||
            (it.question.questionType === 'IMAGE_DIAGRAM' && it.question.choices.length === 0);
          return isManualType || (gradeMap[it.question.id]?.feedback || '').trim().length > 0;
        })
        .map((it) => ({
          questionId: it.question.id,
          awardedPoints: Number(gradeMap[it.question.id]?.points ?? 0),
          graderFeedback: gradeMap[it.question.id]?.feedback || '',
        }));

      await apiRequest(`/api/admin/phase2-exams/attempts/${selectedAttempt.attempt.id}/grade`, {
        method: 'POST',
        body: JSON.stringify({
          grades: gradesPayload,
          generalFeedback,
          publishResult,
        }),
      });
      onToast(
        publishResult
          ? 'تم حفظ التصحيح ونشر النتيجة النهائية للطالب بنجاح'
          : 'تم حفظ التصحيح بنجاح (النتيجة غير منشورة بعد)',
      );
      setSelectedAttempt(null);
      await loadAnalytics();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingGrade(false);
    }
  };

  const handlePublishAll = async () => {
    try {
      const res = await apiRequest<{ publishedCount: number }>(
        `/api/admin/phase2-exams/${examId}/publish-results`,
        { method: 'POST' },
      );
      onToast(
        res.publishedCount > 0
          ? `تم نشر نتائج ${res.publishedCount} محاولة وإشعار الطلاب`
          : 'جميع النتائج منشورة بالفعل',
      );
      await loadAnalytics();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  if (loading || !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        جارٍ تحميل إحصائيات ومحاولات الامتحان...
      </div>
    );
  }

  // Detailed Attempt Grading Screen
  if (selectedAttempt) {
    return (
      <div className="space-y-6" data-testid="admin-attempt-grading-view">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedAttempt(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4" />
              <span>العودة لقائمة المحاولات</span>
            </button>
            <div>
              <div className="text-xs text-slate-500">مراجعة وتصحيح محاولة الطالب</div>
              <h3 className="text-base font-extrabold text-[#0B162C]">
                {selectedAttempt.attempt.studentName} · المحاولة #{selectedAttempt.attempt.attemptNumber}
              </h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="font-mono-num font-bold text-[#0B162C]">
              الدرجة الحالية: {selectedAttempt.attempt.totalScore} / {selectedAttempt.attempt.maxScore}
            </span>
            <span className="text-slate-500">
              {ATTEMPT_STATUS_LABELS[selectedAttempt.attempt.status] || selectedAttempt.attempt.status}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveAttemptGrading} className="space-y-5">
          {selectedAttempt.items.map((item, idx) => {
            const q = item.question;
            const ans = item.answer;
            const entry = gradeMap[q.id] || { points: ans?.awardedPoints ?? 0, feedback: ans?.graderFeedback || '' };
            const isManual =
              Boolean(ans?.needsManualGrading) ||
              ['ESSAY', 'SHORT_ANSWER', 'PHYSICS_PROBLEM', 'FILE_UPLOAD'].includes(q.questionType) ||
              (q.questionType === 'IMAGE_DIAGRAM' && q.choices.length === 0);

            return (
              <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-bold text-[#0B162C]">
                    السؤال {idx + 1} · {QUESTION_TYPE_LABELS[q.questionType] || q.questionType}
                  </span>
                  <span className="font-mono-num font-bold text-[#2563EB]">
                    الدرجة العظمى: {q.points}
                  </span>
                </div>

                <p className="text-sm font-bold text-[#0B162C]">{q.promptAr}</p>
                {q.latexFormula && <MathFormula formula={q.latexFormula} block />}
                {q.imageUrl && (
                  <img
                    src={q.imageUrl}
                    alt="رسم السؤال"
                    referrerPolicy="no-referrer"
                    className="max-h-48 rounded-lg border border-slate-200 object-contain"
                  />
                )}

                {/* Student Answer Display */}
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3.5 text-sm">
                  <div className="text-xs font-bold text-[#2563EB]">إجابة الطالب:</div>
                  {q.choices.length > 0 ? (
                    <div className="mt-1.5 font-semibold text-[#0B162C]">
                      {ans?.selectedChoiceId
                        ? q.choices.find((c) => c.id === ans.selectedChoiceId)?.labelAr || 'اختيار محذوف'
                        : 'لم يجب الطالب على هذا السؤال'}
                    </div>
                  ) : q.questionType === 'NUMERIC' ? (
                    <div className="mt-1.5 font-mono-num font-bold text-[#0B162C]">
                      {ans?.numericAnswer ? `${ans.numericAnswer} ${q.numericUnit || ''}` : 'لم يجب الطالب'}
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-slate-800">
                      {ans?.textAnswer || 'لم يكتب الطالب إجابة نصية'}
                    </p>
                  )}
                  {ans?.uploadedFileName && (
                    <div className="mt-2 text-xs text-slate-600">
                      ملف مرفق: <strong>{ans.uploadedFileName}</strong>
                      {ans.uploadedFileData && ans.uploadedFileData.startsWith('data:image/') && (
                        <img
                          src={ans.uploadedFileData}
                          alt="ورقة حل الطالب"
                          className="mt-2 max-h-64 rounded-lg border border-slate-200 object-contain"
                        />
                      )}
                    </div>
                  )}
                </div>

                {q.modelAnswerAr && (
                  <div className="rounded-lg bg-[#F7F9FC] p-3 text-xs text-slate-700">
                    <strong>الإجابة النموذجية:</strong> {q.modelAnswerAr}
                  </div>
                )}

                {/* Grading Controls */}
                <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      {isManual ? 'الدرجة المستحقة (تصحيح يدوي)' : 'الدرجة (تصحيح تلقائي)'}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={q.points}
                      disabled={!isManual}
                      data-testid={`grade-points-q-${q.id}`}
                      value={entry.points}
                      onChange={(e) =>
                        setGradeMap((prev) => ({
                          ...prev,
                          [q.id]: { ...entry, points: Number(e.target.value) },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-num text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div className="sm:col-span-9">
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      ملاحظة المدرس على هذا السؤال (اختيارية)
                    </label>
                    <input
                      type="text"
                      data-testid={`grade-feedback-q-${q.id}`}
                      value={entry.feedback}
                      onChange={(e) =>
                        setGradeMap((prev) => ({
                          ...prev,
                          [q.id]: { ...entry, feedback: e.target.value },
                        }))
                      }
                      placeholder="اكتب توجيهًا أو ملاحظة للطالب حول خطوات الحل..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* General Exam Feedback & Publish Controls */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label htmlFor="general-feedback" className="mb-1.5 block text-xs font-bold text-[#0B162C]">
                ملاحظة عامة من المدرس على أداء الطالب في الامتحان
              </label>
              <textarea
                id="general-feedback"
                rows={3}
                value={generalFeedback}
                onChange={(e) => setGeneralFeedback(e.target.value)}
                placeholder="مثال: أحسنت في حل مسائل كيرشوف، يرجى مراجعة استنتاج قانون أوم..."
                className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[#0B162C]">
                <input
                  type="checkbox"
                  checked={publishResult}
                  onChange={(e) => setPublishResult(e.target.checked)}
                />
                <span>نشر النتيجة النهائية وإشعار الطالب فور الحفظ</span>
              </label>

              <button
                type="submit"
                disabled={savingGrade}
                data-testid="save-manual-grading-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                <span>{savingGrade ? 'جارٍ حفظ التصحيح...' : 'حفظ التصحيح واعتماد الدرجة'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  const filteredAttempts = data.attempts.filter((a) => {
    if (statusFilter === 'PENDING') {
      return a.pendingManualAnswers > 0 || a.status === 'AWAITING_MANUAL_GRADING' || a.status === 'SUBMITTED';
    }
    if (statusFilter === 'GRADED') return a.status === 'GRADED';
    if (statusFilter === 'IN_PROGRESS') return a.status === 'IN_PROGRESS';
    return true;
  });

  const unpublishedCount = data.attempts.filter(
    (a) => a.status !== 'IN_PROGRESS' && !a.resultPublished,
  ).length;

  return (
    <div className="space-y-6" data-testid="admin-exam-analytics-view">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowRight className="h-4 w-4" />
            <span>العودة للامتحانات</span>
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2563EB]">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>إحصائيات الامتحان والتصحيح اليدوي</span>
            </div>
            <h2 className="text-lg font-extrabold text-[#0B162C]">{data.exam.titleAr}</h2>
          </div>
        </div>

        {unpublishedCount > 0 && (
          <button
            type="button"
            onClick={() => void handlePublishAll()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
          >
            <Send className="h-3.5 w-3.5" />
            <span>نشر جميع النتائج المعلقة ({unpublishedCount})</span>
          </button>
        )}
      </div>

      {/* Real Database Analytics KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">الطلاب المخصص لهم</div>
          <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
            {data.analytics.totalAssignedStudents}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            لم يبدأ: {data.analytics.notStartedCount}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">بدء وتسليم الامتحان</div>
          <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#2563EB]">
            {data.analytics.submittedCount} / {data.analytics.startedCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">سلّموا من إجمالي من بدأ</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">متوسط الدرجات</div>
          <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#0B162C]">
            {data.analytics.averageScore}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            متوسط النسبة: {data.analytics.averagePercent}%
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">أعلى وأقل درجة</div>
          <div className="mt-1 font-mono-num text-2xl font-extrabold text-emerald-700">
            {data.analytics.highestScore}{' '}
            <span className="text-sm font-normal text-slate-400">/ {data.analytics.lowestScore}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            النجاح: {data.analytics.passRate}% · الرسوب: {data.analytics.failRate}%
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">بانتظار التصحيح اليدوي</div>
          <div className="mt-1 font-mono-num text-2xl font-extrabold text-amber-700">
            {data.analytics.pendingManualGradingCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">محاولات بها أسئلة مقالية</div>
        </div>
      </div>

      {/* Filter & Student Attempts Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <h3 className="text-sm font-extrabold text-[#0B162C]">
            محاولات الطلاب ({filteredAttempts.length})
          </h3>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs">
            {[
              { id: 'ALL', label: 'الكل' },
              { id: 'PENDING', label: 'بانتظار التصحيح اليدوي' },
              { id: 'GRADED', label: 'تم التصحيح' },
              { id: 'IN_PROGRESS', label: 'قيد التنفيذ' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id as typeof statusFilter)}
                className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                  statusFilter === f.id
                    ? 'bg-white text-[#0B162C] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B162C]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredAttempts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا توجد محاولات طلاب مطابقة لهذا التصنيف حتى الآن.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-100 bg-[#F7F9FC] text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-bold">الطالب</th>
                  <th className="px-4 py-3 font-bold">المحاولة</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  <th className="px-4 py-3 font-bold">الدرجة</th>
                  <th className="px-4 py-3 font-bold">نشر النتيجة</th>
                  <th className="px-4 py-3 font-bold">التاريخ</th>
                  <th className="px-4 py-3 font-bold">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAttempts.map((att) => (
                  <tr key={att.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#0B162C]">{att.studentName}</div>
                      {att.studentPhone && (
                        <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                          {att.studentPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-num">#{att.attemptNumber}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          att.status === 'GRADED'
                            ? 'text-emerald-700'
                            : att.status === 'IN_PROGRESS'
                              ? 'text-[#2563EB]'
                              : 'text-amber-700'
                        }`}
                      >
                        {att.status === 'GRADED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        <span>{ATTEMPT_STATUS_LABELS[att.status] || att.status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono-num font-bold text-[#0B162C]">
                      {att.totalScore} / {att.maxScore} ({att.percent}%)
                    </td>
                    <td className="px-4 py-3">
                      {att.resultPublished ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> منشورة
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <XCircle className="h-3.5 w-3.5" /> بانتظار الاعتماد
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDateTimeAr(att.submittedAt || att.startedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={loadingAttempt}
                        data-testid={`review-attempt-btn-${att.id}`}
                        onClick={() => void openAttemptDetail(att.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0B162C] px-3 py-1.5 font-bold text-white hover:bg-[#2563EB]"
                      >
                        {att.pendingManualAnswers > 0 ? (
                          <ClipboardCheck className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        <span>{att.pendingManualAnswers > 0 ? 'تصحيح ومراجعة' : 'عرض الإجابات'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
