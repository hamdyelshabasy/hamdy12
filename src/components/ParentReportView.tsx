import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, FileText, Search, ShieldCheck, UserCheck } from 'lucide-react';
import { apiRequest, formatDateAr } from '../lib/api.ts';

interface ParentReportResponse {
  student: {
    fullName: string;
    status: string;
    trackNameAr: string;
    gradeNameAr: string;
    lastLoginAt: string | null;
  };
  summary: {
    watchedVideosCount: number;
    completedVideosCount: number;
    avgCompletionPercent: number;
    examsTakenCount: number;
    avgExamPercent: number;
  };
  watchHistory: Array<{
    videoTitleAr: string;
    completionPercent: number;
    isCompleted: boolean;
    updatedAt: string;
  }>;
  examResults: Array<{
    examTitleAr: string;
    examType: string;
    totalScore: number;
    maxScore: number;
    passed: boolean;
    status: string;
    submittedAt: string | null;
  }>;
  academicAdherence?: {
    hasPlan: boolean;
    planTitleAr: string | null;
    currentWeekTitleAr: string | null;
    weeklyCompletionPercent: number;
    onTimeAdherencePercent: number | null;
    completedTasksCount: number;
    overdueRequiredCount: number;
    encouragementAr: string;
  } | null;
}

interface ParentReportViewProps {
  initialCode?: string;
  onBack: () => void;
}

export const ParentReportView: React.FC<ParentReportViewProps> = ({ initialCode = '', onBack }) => {
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ParentReportResponse | null>(null);

  const fetchReportByCode = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) {
      setError('يرجى إدخال كود متابعة ولي الأمر');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<ParentReportResponse>(
        `/api/public/parent-report/${encodeURIComponent(trimmed)}`,
      );
      setReport(data);
    } catch (err) {
      setReport(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCode(initialCode);
    if (initialCode.trim()) {
      void fetchReportByCode(initialCode);
    }
  }, [initialCode, fetchReportByCode]);

  const handleFetch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await fetchReportByCode(code);
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] py-10 px-4 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex min-h-[40px] items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 hover:text-[#0B162C]"
        >
          <ArrowRight className="h-4 w-4" />
          <span>العودة إلى المنصة</span>
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-6">
            <div className="flex items-center gap-2 text-xs font-medium text-[#2563EB]">
              <ShieldCheck className="h-4 w-4" />
              <span>بوابة متابعة ولي الأمر المحمية</span>
            </div>
            <h1 className="text-2xl font-bold text-[#0B162C]">تقرير الأداء الدراسي للطالب</h1>
            <p className="text-sm text-slate-600">
              أدخل كود المتابعة الخاص بولي الأمر (الموجود في لوحة الطالب) للاطلاع على نسب المشاهدة ونتائج الامتحانات بخصوصية تامة.
            </p>
          </div>

          <form onSubmit={handleFetch} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="parent-code-input" className="sr-only">
                كود ولي الأمر
              </label>
              <input
                id="parent-code-input"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="مثال: PAR-YOUSSEF-2026"
                dir="ltr"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-left font-mono-num text-sm text-[#0B162C] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Search className="h-4 w-4" />
              <span>{loading ? 'جارٍ البحث...' : 'عرض التقرير'}</span>
            </button>
          </form>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {report && (
            <div className="mt-8 space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#0B162C]">{report.student.fullName}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {report.student.trackNameAr} · {report.student.gradeNameAr} · آخر دخول:{' '}
                    {formatDateAr(report.student.lastLoginAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <UserCheck className="h-4 w-4" />
                  <span>{report.student.status === 'ACTIVE' ? 'حساب نشط ومعتمد' : 'قيد المراجعة'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                  <div className="text-xs text-slate-500">متوسط إتمام المشاهدة</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-[#0B162C]">
                    {report.summary.avgCompletionPercent}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                  <div className="text-xs text-slate-500">دروس مكتملة</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-[#0B162C]">
                    {report.summary.completedVideosCount} / {report.summary.watchedVideosCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                  <div className="text-xs text-slate-500">امتحانات منجزة</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-[#0B162C]">
                    {report.summary.examsTakenCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-4">
                  <div className="text-xs text-slate-500">متوسط الدرجات</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-[#2563EB]">
                    {report.summary.avgExamPercent}%
                  </div>
                </div>
              </div>

              {report.academicAdherence?.hasPlan && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-[#2563EB]">
                        الالتزام الدراسي بخطة المنهج
                      </div>
                      <h3 className="text-sm font-extrabold text-[#0B162C]">
                        {report.academicAdherence.planTitleAr}
                        {report.academicAdherence.currentWeekTitleAr
                          ? ` · ${report.academicAdherence.currentWeekTitleAr}`
                          : ''}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="rounded-lg bg-white border border-blue-200 px-3 py-1.5 font-bold text-[#0B162C]">
                        إنجاز الأسبوع:{' '}
                        <strong className="font-mono-num text-[#2563EB]">
                          {report.academicAdherence.weeklyCompletionPercent}%
                        </strong>
                      </span>
                      {report.academicAdherence.onTimeAdherencePercent !== null && (
                        <span className="rounded-lg bg-white border border-emerald-200 px-3 py-1.5 font-bold text-emerald-800">
                          الالتزام بالمواعيد:{' '}
                          <strong className="font-mono-num">
                            {report.academicAdherence.onTimeAdherencePercent}%
                          </strong>
                        </span>
                      )}
                      {report.academicAdherence.overdueRequiredCount > 0 && (
                        <span className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-1.5 font-bold text-rose-700">
                          مهام متأخرة:{' '}
                          <strong className="font-mono-num">
                            {report.academicAdherence.overdueRequiredCount}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    {report.academicAdherence.encouragementAr}
                  </p>
                </div>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-[#0B162C]">
                    <CheckCircle2 className="h-4 w-4 text-[#2563EB]" />
                    <span>سجل مشاهدة المحاضرات</span>
                  </h3>
                  {report.watchHistory.length === 0 ? (
                    <p className="text-sm text-slate-500">لا توجد مشاهدات مسجلة بعد.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {report.watchHistory.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                          <span className="font-medium text-slate-800">{item.videoTitleAr}</span>
                          <span className="font-mono-num text-xs font-semibold text-[#2563EB] shrink-0">
                            {item.completionPercent}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-[#0B162C]">
                    <FileText className="h-4 w-4 text-[#2563EB]" />
                    <span>نتائج الامتحانات</span>
                  </h3>
                  {report.examResults.length === 0 ? (
                    <p className="text-sm text-slate-500">لم يؤدِ الطالب أي امتحان حتى الآن.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {report.examResults.map((ex, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                          <div>
                            <div className="font-medium text-slate-800">{ex.examTitleAr}</div>
                            <div className="text-xs text-slate-500">{formatDateAr(ex.submittedAt)}</div>
                          </div>
                          <div className="text-left shrink-0">
                            <div className="font-mono-num text-sm font-bold text-[#0B162C]">
                              {ex.totalScore} / {ex.maxScore}
                            </div>
                            <div
                              className={`text-xs font-medium ${ex.passed ? 'text-emerald-700' : 'text-amber-700'}`}
                            >
                              {ex.status === 'SUBMITTED' ? 'بانتظار تصحيح المقالي' : ex.passed ? 'ناجح' : 'يحتاج مراجعة'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
