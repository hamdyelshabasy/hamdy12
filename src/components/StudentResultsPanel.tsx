import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BookCheck,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  Eye,
  Hourglass,
  Layers,
  MessageSquare,
  Play,
  RefreshCw,
  Share2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import {
  ATTEMPT_STATUS_LABELS,
  EXAM_TYPE_LABELS,
  QUESTION_TYPE_LABELS,
  type StudentMyResultItem,
} from '../types/exams.ts';
import type { StudentDashboardHomeworkItem } from '../types/lms.ts';
import { MathFormula } from './MathFormula.tsx';
import { QuestionImageGallery } from './QuestionImageGallery.tsx';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
  StudentProgressRing,
  StudentRailCard,
  StudentTwoColShell,
} from './student/StudentUiPrimitives.tsx';

interface StudentResultsListResponse {
  myResults: StudentMyResultItem[];
}

interface AttemptReviewDetailResponse {
  resultPublished: boolean;
  message?: string;
  exam: {
    id: number;
    titleAr: string;
    examType: string;
    passScorePercent?: number;
    allowStudentReview?: boolean;
    showCorrectAnswers?: boolean;
    showExplanations?: boolean;
  };
  attempt: {
    id: number;
    attemptNumber?: number;
    status: string;
    startedAt?: string;
    submittedAt: string | null;
    autoScore?: number;
    manualScore?: number;
    totalScore?: number;
    maxScore?: number;
    percent?: number;
    passed?: boolean | null;
    generalFeedback?: string;
    correctCount?: number;
    incorrectCount?: number;
    unansweredCount?: number;
    manualPendingCount?: number;
  };
  review: Array<{
    questionId: number;
    promptAr: string;
    latexFormula: string | null;
    imageUrl: string | null;
    questionType: string;
    points: number;
    awardedPoints: number;
    isCorrect: boolean | null;
    needsManualGrading: boolean;
    selectedChoiceId: number | null;
    textAnswer: string | null;
    numericAnswer: string | null;
    numericUnit: string;
    uploadedFileName: string | null;
    graderFeedback: string;
    correctNumericAnswer: string | null;
    modelAnswerAr: string;
    explanationAr: string;
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
    choices: Array<{
      id: number;
      labelAr: string;
      latexFormula: string | null;
      isCorrect?: boolean;
    }>;
  }>;
}

interface StudentResultsPanelProps {
  gradeId?: number;
  homeworkItems?: StudentDashboardHomeworkItem[];
  homeworkTotalCount?: number;
  parentShareCode?: string | null;
  activeGradeLabel?: string;
  initialExamId?: number | null;
  onConsumeInitialExam?: () => void;
  onOpenParentReport?: (code: string) => void;
  onOpenHomework?: (homeworkId: number) => void;
  onOpenCurriculum?: () => void;
}

type ResultsFilterTab = 'ALL' | 'EXAMS' | 'HOMEWORK';

interface UnifiedResultRow {
  key: string;
  kind: 'EXAM' | 'HOMEWORK';
  titleAr: string;
  subtitleAr: string;
  dateIso: string | null;
  isPublished: boolean;
  isPending: boolean;
  percent: number | null;
  scoreText: string | null;
  passed: boolean | null;
  statusLabel: string;
  feedbackText: string;
  canReview: boolean;
  attemptId?: number;
  homeworkId?: number;
  examItem?: StudentMyResultItem;
}

export const StudentResultsPanel: React.FC<StudentResultsPanelProps> = ({
  gradeId,
  homeworkItems = [],
  homeworkTotalCount,
  parentShareCode = null,
  activeGradeLabel,
  initialExamId = null,
  onConsumeInitialExam,
  onOpenParentReport,
  onOpenHomework,
  onOpenCurriculum,
}) => {
  const [results, setResults] = useState<StudentMyResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterTab, setFilterTab] = useState<ResultsFilterTab>('ALL');

  const [reviewModal, setReviewModal] = useState<AttemptReviewDetailResponse | null>(null);
  const [loadingReviewId, setLoadingReviewId] = useState<number | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = gradeId ? `?gradeId=${gradeId}` : '';
      const res = await apiRequest<StudentResultsListResponse>(`/api/exams/student/list${qs}`);
      setResults(res.myResults || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gradeId]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  // Unified chronological rows from real Exam results + real Submitted/Graded Homework items
  const unifiedRows = useMemo<UnifiedResultRow[]>(() => {
    const rows: UnifiedResultRow[] = [];

    for (const item of results) {
      const awaitingManual =
        !item.resultPublished ||
        item.pendingManualCount > 0 ||
        item.status === 'AWAITING_MANUAL_GRADING';

      rows.push({
        key: `exam-${item.attemptId}`,
        kind: 'EXAM',
        titleAr: item.examTitleAr,
        subtitleAr: `${EXAM_TYPE_LABELS[item.examType] || item.examType} · المحاولة #${item.attemptNumber}`,
        dateIso: item.submittedAt,
        isPublished: item.resultPublished && item.percent !== null,
        isPending: awaitingManual,
        percent: item.resultPublished ? item.percent : null,
        scoreText:
          item.resultPublished && item.studentScore !== null
            ? `${item.studentScore} / ${item.totalMarks}`
            : null,
        passed: item.passed,
        statusLabel: awaitingManual
          ? 'قيد التصحيح'
          : item.passed
            ? 'مكتمل · ناجح'
            : 'مكتمل',
        feedbackText: item.resultPublished
          ? item.generalFeedback ||
            (item.correctCount !== null
              ? `إجابات صحيحة: ${item.correctCount} · خطأ: ${item.incorrectCount ?? 0}`
              : 'النتيجة معتمدة وجاهزة للمراجعة.')
          : ATTEMPT_STATUS_LABELS[item.status] || 'بانتظار اعتماد ونشر الأستاذ',
        canReview: Boolean(item.resultPublished && item.canReview),
        attemptId: item.attemptId,
        examItem: item,
      });
    }

    for (const hw of homeworkItems) {
      if (!hw.submissionStatus) continue;
      const isGraded =
        hw.submissionStatus === 'GRADED' &&
        hw.isGradePublished &&
        hw.awardedGrade !== null &&
        hw.maximumGrade > 0;
      const pct =
        isGraded && hw.awardedGrade !== null
          ? Math.round((hw.awardedGrade / hw.maximumGrade) * 100)
          : null;
      const isRevision = hw.submissionStatus === 'RETURNED_FOR_REVISION';
      const isPending =
        isRevision ||
        hw.submissionStatus === 'SUBMITTED' ||
        hw.submissionStatus === 'UNDER_REVIEW' ||
        (hw.submissionStatus === 'GRADED' && !hw.isGradePublished);

      rows.push({
        key: `hw-${hw.id}`,
        kind: 'HOMEWORK',
        titleAr: hw.titleAr,
        subtitleAr: 'واجب دراسي',
        dateIso: hw.gradedAt || hw.submittedAt || hw.deadline,
        isPublished: isGraded,
        isPending,
        percent: pct,
        scoreText:
          isGraded && hw.awardedGrade !== null
            ? `${hw.awardedGrade} / ${hw.maximumGrade}`
            : null,
        passed: pct !== null ? pct >= 50 : null,
        statusLabel: isGraded
          ? 'مكتمل'
          : isRevision
            ? 'أُعيد للتعديل'
            : 'قيد التصحيح',
        feedbackText: isGraded
          ? `الدرجة المعتمدة: ${hw.awardedGrade} من ${hw.maximumGrade} — اضغط لمراجعة الملاحظات ونموذج الإجابة.`
          : isRevision
            ? 'أعاد الأستاذ الواجب للتعديل — افتح الواجب لمراجعة الملاحظات وإعادة التسليم.'
            : 'تم تسليم الواجب وبانتظار مراجعة واعتماد الأستاذ.',
        canReview: Boolean(onOpenHomework),
        homeworkId: hw.id,
      });
    }

    rows.sort((a, b) => {
      const at = a.dateIso ? new Date(a.dateIso).getTime() : 0;
      const bt = b.dateIso ? new Date(b.dateIso).getTime() : 0;
      return bt - at;
    });
    return rows;
  }, [results, homeworkItems, onOpenHomework]);

  const filteredRows = useMemo(() => {
    if (filterTab === 'EXAMS') return unifiedRows.filter((r) => r.kind === 'EXAM');
    if (filterTab === 'HOMEWORK') return unifiedRows.filter((r) => r.kind === 'HOMEWORK');
    return unifiedRows;
  }, [unifiedRows, filterTab]);

  const stats = useMemo(() => {
    const publishedPercents = unifiedRows
      .filter((r) => r.isPublished && r.percent !== null)
      .map((r) => r.percent as number);

    const avgPercent =
      publishedPercents.length > 0
        ? Math.round(
            publishedPercents.reduce((s, p) => s + p, 0) / publishedPercents.length,
          )
        : 0;

    const examsCompleted = results.length;
    const hwSubmittedCount = homeworkItems.filter((h) => Boolean(h.submissionStatus)).length;
    const hwTotal = homeworkTotalCount ?? homeworkItems.length;
    const pendingCount = unifiedRows.filter((r) => r.isPending).length;
    const passedCount = unifiedRows.filter((r) => r.isPublished && r.passed === true).length;

    return {
      avgPercent,
      publishedCount: publishedPercents.length,
      examsCompleted,
      hwSubmittedCount,
      hwTotal,
      pendingCount,
      passedCount,
    };
  }, [unifiedRows, results.length, homeworkItems, homeworkTotalCount]);

  const handleOpenReview = useCallback(async (attemptId: number) => {
    setLoadingReviewId(attemptId);
    try {
      const detail = await apiRequest<AttemptReviewDetailResponse>(
        `/api/exams/attempts/${attemptId}/result`,
      );
      setReviewModal(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingReviewId(null);
    }
  }, []);

  useEffect(() => {
    if (!initialExamId || loading) return;
    const match = results.find((r) => r.examId === initialExamId);
    if (match) {
      setFilterTab('EXAMS');
      if (match.resultPublished && match.canReview) {
        void handleOpenReview(match.attemptId);
      }
    }
    onConsumeInitialExam?.();
  }, [initialExamId, loading, results, handleOpenReview, onConsumeInitialExam]);

  const rail = (
    <>
      {/* 1. Progress Summary Ring */}
      <StudentRailCard glow="blue">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
          <h2 className="font-display text-sm font-extrabold text-white">ملخص التقدم</h2>
          <BarChart3 className="h-4 w-4 text-sky-300" />
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                الامتحانات <strong className="font-mono-num text-white">{stats.examsCompleted}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <BookCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>
                الواجبات{' '}
                <strong className="font-mono-num text-white">
                  {stats.hwSubmittedCount} / {stats.hwTotal}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-200">
              <Award className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span>
                متوسط الأداء{' '}
                <strong className="font-mono-num text-sky-300">
                  {stats.publishedCount > 0 ? `${stats.avgPercent}%` : '—'}
                </strong>
              </span>
            </div>
          </div>
          <StudentProgressRing percent={stats.avgPercent} size={84} strokeWidth={8} />
        </div>
        {onOpenCurriculum && (
          <button
            type="button"
            onClick={onOpenCurriculum}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#12265E]/80 py-2 text-xs font-bold text-sky-100 hover:bg-[#19337A] transition-colors"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>عرض خطة المنهج</span>
          </button>
        )}
      </StudentRailCard>

      {/* 2. Conditional Achievements Card (ONLY when student has real published passing results) */}
      {stats.passedCount > 0 && (
        <StudentRailCard glow="purple" className="text-center">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10 text-right">
            <h3 className="font-display text-sm font-extrabold text-white">الإنجازات</h3>
            <Trophy className="h-4 w-4 text-amber-300" />
          </div>
          <div className="mx-auto mt-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-violet-500/30 text-amber-300 ring-1 ring-amber-300/45 shadow-[0_0_26px_rgba(251,191,36,0.3)]">
            <Trophy className="h-7 w-7" />
          </div>
          <h4 className="mt-2.5 font-display text-base font-extrabold text-white">
            {stats.avgPercent >= 85
              ? 'طالب متميز'
              : stats.avgPercent >= 70
                ? 'أداء متقدم'
                : 'تقدم مستمر'}
          </h4>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
            اجتزت{' '}
            <strong className="font-mono-num text-emerald-300">{stats.passedCount}</strong> تقييم
            منشور بمتوسط{' '}
            <strong className="font-mono-num text-white">{stats.avgPercent}%</strong>
          </p>
        </StudentRailCard>
      )}

      {/* 3. Parent Report Card */}
      <StudentRailCard glow="blue" className="text-center">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10 text-right">
          <h3 className="font-display text-sm font-extrabold text-white">تقرير ولي الأمر</h3>
          <Users className="h-4 w-4 text-sky-300" />
        </div>
        <div className="mx-auto mt-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/25 to-violet-500/30 text-sky-200 ring-1 ring-sky-400/40">
          <Share2 className="h-6 w-6" />
        </div>
        <p className="mt-2.5 text-xs text-slate-300 leading-relaxed">
          تقرير شامل عن النتائج والمستوى والتقدم في المنهج لمتابعة ولي الأمر.
        </p>
        {parentShareCode && onOpenParentReport ? (
          <>
            <div className="mt-2 inline-block rounded-lg border border-white/15 bg-[#081330] px-2.5 py-1 font-mono-num text-[11px] font-bold text-sky-300">
              {parentShareCode}
            </div>
            <button
              type="button"
              onClick={() => onOpenParentReport(parentShareCode)}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#7C3AED] via-[#2563EB] to-[#0EA5E9] py-2.5 text-xs font-extrabold text-white shadow-lg hover:brightness-110"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>فتح تقرير ولي الأمر</span>
            </button>
          </>
        ) : (
          <p className="mt-2 text-[11px] text-slate-400">
            يمكن الوصول لكود المتابعة من صفحة إعدادات حسابك.
          </p>
        )}
      </StudentRailCard>
    </>
  );

  return (
    <StudentTwoColShell rail={rail} testId="student-results-panel">
      {/* 1. Hero Banner */}
      <StudentPageHero
        title="نتائجي وتقارير الامتحانات"
        subtitle="تابع نتائجك في الامتحانات والواجبات، واطّلع على ملاحظات الأستاذ وتفاصيل التصحيح التلقائي واليدوي."
        icon={<Award className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.results}
        artworkAlt="نتائجي وتقارير الامتحانات"
        chips={[
          ...(activeGradeLabel
            ? [{ icon: <Layers className="h-3.5 w-3.5" />, label: activeGradeLabel }]
            : []),
          {
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />,
            label: `${stats.publishedCount} تقييم منشور`,
          },
        ]}
      />

      {/* 2. Four Rich Gradient KPI Cards matching 11_Results_and_Reports.png */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Blue: متوسط الدرجة */}
        <div className="rounded-2xl border border-sky-400/50 bg-gradient-to-br from-[#0284C7]/90 via-[#1D4ED8]/85 to-[#0C2461]/95 p-4 text-white shadow-[0_10px_24px_rgba(2,132,199,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-sky-100">متوسط الدرجة</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {stats.publishedCount > 0 ? `${stats.avgPercent}%` : '—'}
              </div>
              <div className="mt-1.5 text-[11px] text-sky-100/90">
                من {stats.publishedCount} تقييم منشور
              </div>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
              <Award className="h-5 w-5" />
            </span>
          </div>
        </div>

        {/* Purple: الامتحانات المكتملة */}
        <div className="rounded-2xl border border-violet-400/50 bg-gradient-to-br from-[#6D28D9]/90 via-[#4C1D95]/85 to-[#2E1065]/95 p-4 text-white shadow-[0_10px_24px_rgba(109,40,217,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-violet-100">الامتحانات المكتملة</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {stats.examsCompleted}
              </div>
              <div className="mt-1.5 text-[11px] text-violet-100/90">محاولة مُسلّمة</div>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
              <ClipboardList className="h-5 w-5" />
            </span>
          </div>
        </div>

        {/* Emerald: الواجبات المسلمة */}
        <div className="rounded-2xl border border-emerald-400/50 bg-gradient-to-br from-[#047857]/90 via-[#065F46]/85 to-[#022C22]/95 p-4 text-white shadow-[0_10px_24px_rgba(4,120,87,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-emerald-100">الواجبات المسلّمة</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {stats.hwSubmittedCount}
              </div>
              <div className="mt-1.5 text-[11px] text-emerald-100/90">
                من أصل {stats.hwTotal} واجبًا
              </div>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
              <BookCheck className="h-5 w-5" />
            </span>
          </div>
        </div>

        {/* Amber: بانتظار التصحيح */}
        <div className="rounded-2xl border border-amber-400/50 bg-gradient-to-br from-[#B45309]/90 via-[#92400E]/85 to-[#451A03]/95 p-4 text-white shadow-[0_10px_24px_rgba(180,83,9,0.28)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-amber-100">بانتظار التصحيح</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {stats.pendingCount}
              </div>
              <div className="mt-1.5 text-[11px] text-amber-100/90">امتحانات أو واجبات</div>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25">
              <Hourglass className="h-5 w-5" />
            </span>
          </div>
        </div>
      </div>

      {/* 3. Unified Exam & Homework Results Timeline Container matching 11_Results_and_Reports.png */}
      <section className="rounded-2xl border border-[#2D4A8A]/55 bg-[#0A1638]/92 p-4 sm:p-5 text-white shadow-[0_12px_30px_rgba(2,8,28,0.48)] space-y-4">
        {/* Header + Filter Pills + Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3.5">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-sky-300" />
            <h2 className="font-display text-base font-extrabold text-white">
              نتائج الامتحانات والواجبات
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: `الكل (${unifiedRows.length})` },
                  {
                    id: 'EXAMS',
                    label: `الامتحانات (${unifiedRows.filter((r) => r.kind === 'EXAM').length})`,
                  },
                  {
                    id: 'HOMEWORK',
                    label: `الواجبات (${unifiedRows.filter((r) => r.kind === 'HOMEWORK').length})`,
                  },
                ] as const
              ).map((t) => {
                const active = filterTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilterTab(t.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-all whitespace-nowrap ${
                      active
                        ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-md'
                        : 'border border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void loadResults()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/15"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl border border-white/10 bg-[#0E1E4A]/70"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-950/60 p-5 text-sm text-rose-100">
            {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <StudentEmptyState
            icon={<Award className="h-6 w-6 text-amber-300" />}
            title="لا توجد نتائج مسجلة في هذا التصنيف بعد"
            description="بمجرد تسليم أي امتحان أو واجب ستظهر الدرجة وملاحظات الأستاذ وتفاصيل المراجعة هنا تلقائيًا."
          />
        ) : (
          <div className="relative space-y-3 pr-5">
            {/* Vertical glowing timeline track (Right in RTL) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-4 bottom-4 right-[7px] w-0.5 bg-gradient-to-b from-emerald-400/60 via-sky-400/50 to-amber-400/40"
            />

            {filteredRows.map((row) => {
              const dotColor = row.isPending
                ? 'bg-amber-400 ring-amber-400/35'
                : row.passed === false
                  ? 'bg-rose-400 ring-rose-400/35'
                  : row.kind === 'HOMEWORK'
                    ? 'bg-sky-400 ring-sky-400/35'
                    : 'bg-emerald-400 ring-emerald-400/35';

              return (
                <article
                  key={row.key}
                  data-testid={
                    row.attemptId ? `student-result-card-${row.attemptId}` : `student-hw-result-${row.homeworkId}`
                  }
                  className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-[#2D4A8A]/55 bg-gradient-to-l from-[#102050]/95 to-[#0B173B]/95 p-3.5 sm:p-4 hover:border-sky-400/55 transition-all"
                >
                  {/* Glowing Timeline Dot */}
                  <span
                    aria-hidden="true"
                    className={`absolute top-1/2 -right-[21px] -translate-y-1/2 h-3.5 w-3.5 rounded-full ring-4 ${dotColor}`}
                  />

                  {/* Title & Date */}
                  <div className="flex items-center gap-3 min-w-0 lg:w-[270px] shrink-0">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${
                        row.kind === 'EXAM'
                          ? 'bg-violet-500/20 text-violet-200 ring-violet-400/40'
                          : 'bg-sky-500/20 text-sky-200 ring-sky-400/40'
                      }`}
                    >
                      {row.kind === 'EXAM' ? (
                        <ClipboardList className="h-5 w-5" />
                      ) : (
                        <BookCheck className="h-5 w-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-extrabold text-white truncate">
                        {row.titleAr}
                      </h3>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-300 truncate">
                        <Calendar className="h-3 w-3 text-sky-300 shrink-0" />
                        <span className="truncate">
                          {row.dateIso ? formatDateTimeAr(row.dateIso) : row.subtitleAr}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status + Percentage Pill */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-extrabold ${
                        row.isPending
                          ? 'border-amber-400/45 bg-amber-500/15 text-amber-200'
                          : 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
                      }`}
                    >
                      {row.isPending ? (
                        <Clock className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      <span>{row.statusLabel}</span>
                    </span>

                    <div
                      className={`min-w-[74px] rounded-xl border px-3 py-1.5 text-center font-mono-num ${
                        row.isPending || row.percent === null
                          ? 'border-white/15 bg-white/5 text-slate-300'
                          : row.percent >= 80
                            ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                            : row.percent >= 60
                              ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                              : 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                      }`}
                    >
                      <div className="text-base font-extrabold leading-none">
                        {row.percent !== null ? `${row.percent}%` : '—'}
                      </div>
                      {row.scoreText && (
                        <div className="mt-0.5 text-[9.5px] opacity-85">{row.scoreText}</div>
                      )}
                    </div>
                  </div>

                  {/* Teacher Feedback Box */}
                  <div className="flex-1 min-w-0 rounded-xl border border-white/10 bg-[#081330]/85 px-3 py-2 text-[11.5px]">
                    <div className="flex items-center gap-1 font-bold text-sky-300">
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      <span>ملاحظة المعلم</span>
                    </div>
                    <p className="mt-0.5 text-slate-200 line-clamp-2 leading-relaxed">
                      {row.feedbackText}
                    </p>
                  </div>

                  {/* Action CTA */}
                  <div className="shrink-0">
                    {row.kind === 'EXAM' && row.attemptId ? (
                      row.canReview ? (
                        <button
                          type="button"
                          disabled={loadingReviewId === row.attemptId}
                          onClick={() => void handleOpenReview(row.attemptId!)}
                          className="inline-flex w-full lg:w-auto items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-md hover:brightness-110 disabled:opacity-60"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          <span>
                            {loadingReviewId === row.attemptId
                              ? 'جارٍ التحميل...'
                              : 'مراجعة الإجابات والتفاصيل'}
                          </span>
                        </button>
                      ) : (
                        <span className="inline-flex w-full lg:w-auto items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-xs font-bold text-slate-300">
                          <Hourglass className="h-3.5 w-3.5" />
                          <span>{row.isPending ? 'بانتظار التصحيح' : 'المراجعة مغلقة'}</span>
                        </span>
                      )
                    ) : row.homeworkId && onOpenHomework ? (
                      <button
                        type="button"
                        onClick={() => onOpenHomework(row.homeworkId!)}
                        className="inline-flex w-full lg:w-auto items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white shadow-md hover:brightness-110"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>مراجعة الواجب والتفاصيل</span>
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Answer Review Modal (Preserved Light Surface for High Academic Readability) */}
      {reviewModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 text-[#0B162C]"
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-xs font-semibold text-[#2563EB]">تقرير مراجعة الامتحان</div>
                <h3 className="text-lg font-extrabold text-[#0B162C]">
                  {reviewModal.exam.titleAr}
                </h3>
              </div>
              <button
                type="button"
                aria-label="إغلاق المراجعة"
                onClick={() => setReviewModal(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {!reviewModal.resultPublished ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-900">
                  {reviewModal.message || 'النتيجة بانتظار اعتماد ونشر المدرس.'}
                </div>
              ) : (
                <>
                  {/* Attempt Summary Strip */}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                      <div className="text-[11px] text-slate-500">الدرجة النهائية</div>
                      <div className="mt-1 font-mono-num text-xl font-extrabold text-[#0B162C]">
                        {reviewModal.attempt.totalScore} / {reviewModal.attempt.maxScore}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                      <div className="text-[11px] text-slate-500">النسبة والحالة</div>
                      <div className="mt-1 font-mono-num text-xl font-extrabold text-[#2563EB]">
                        {reviewModal.attempt.percent}% ·{' '}
                        <span
                          className={`text-sm ${
                            reviewModal.attempt.passed ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {reviewModal.attempt.passed ? 'ناجح' : 'راسب'}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                      <div className="text-[11px] text-slate-500">الإجابات الصحيحة / الخطأ</div>
                      <div className="mt-1 font-mono-num text-sm font-bold text-[#0B162C]">
                        <span className="text-emerald-700">
                          {reviewModal.attempt.correctCount ?? 0} صحيح
                        </span>{' '}
                        ·{' '}
                        <span className="text-red-700">
                          {reviewModal.attempt.incorrectCount ?? 0} خطأ
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-3.5">
                      <div className="text-[11px] text-slate-500">توزيع التصحيح</div>
                      <div className="mt-1 font-mono-num text-xs font-semibold text-slate-700">
                        تلقائي: {reviewModal.attempt.autoScore ?? 0} · يدوي:{' '}
                        {reviewModal.attempt.manualScore ?? 0}
                      </div>
                    </div>
                  </div>

                  {reviewModal.attempt.generalFeedback && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs">
                      <div className="font-bold text-[#2563EB]">تعليق الأستاذ العام:</div>
                      <p className="mt-1 leading-relaxed text-[#0B162C]">
                        {reviewModal.attempt.generalFeedback}
                      </p>
                    </div>
                  )}

                  {reviewModal.review.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-600">
                      مراجعة تفاصيل الأسئلة غير مفعّلة لهذا الامتحان من قِبل المدرس.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {reviewModal.review.map((q, idx) => (
                        <div
                          key={q.questionId}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="text-sm font-bold text-[#0B162C]">
                              {idx + 1}. {q.promptAr}
                              <span className="mr-2 text-[11px] font-normal text-slate-400">
                                ({QUESTION_TYPE_LABELS[q.questionType] || q.questionType})
                              </span>
                            </div>
                            <span
                              className={`shrink-0 font-mono-num text-xs font-bold ${
                                q.needsManualGrading
                                  ? 'text-amber-700'
                                  : q.isCorrect
                                    ? 'text-emerald-700'
                                    : 'text-red-700'
                              }`}
                            >
                              {q.needsManualGrading
                                ? 'بانتظار التصحيح اليدوي'
                                : `${q.awardedPoints} / ${q.points}`}
                            </span>
                          </div>

                          {q.latexFormula && <MathFormula formula={q.latexFormula} block />}

                          {((q.imageUrl && q.imageUrl.trim()) ||
                            (q.questionImages && q.questionImages.length > 0)) && (
                            <div
                              data-testid={`result-question-images-${q.questionId}`}
                              className="mt-3"
                            >
                              <QuestionImageGallery
                                images={[
                                  ...(q.imageUrl ? [{ url: q.imageUrl, alt: 'صورة السؤال' }] : []),
                                  ...(q.questionImages || []).map((img, imgIdx) => ({
                                    url: img.previewUrl,
                                    alt: img.fileName || `صورة السؤال ${imgIdx + 1}`,
                                  })),
                                ]}
                              />
                            </div>
                          )}

                          {q.choices.length > 0 && (
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {q.choices.map((ch) => {
                                const isSelected = q.selectedChoiceId === ch.id;
                                const isRight = ch.isCorrect === true;
                                let boxCls = 'border-slate-200 bg-white text-slate-700';
                                if (isRight) {
                                  boxCls =
                                    'border-emerald-400 bg-emerald-50 text-emerald-900 font-semibold';
                                } else if (isSelected && ch.isCorrect === false) {
                                  boxCls = 'border-red-300 bg-red-50 text-red-900';
                                } else if (isSelected) {
                                  boxCls = 'border-[#2563EB] bg-blue-50 text-[#0B162C]';
                                }

                                return (
                                  <div
                                    key={ch.id}
                                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${boxCls}`}
                                  >
                                    <span>
                                      {ch.labelAr}
                                      {isSelected && (
                                        <span className="mr-1.5 text-[10px] font-bold">
                                          (اختيارك)
                                        </span>
                                      )}
                                      {isRight && (
                                        <span className="mr-1.5 text-[10px] font-bold text-emerald-700">
                                          (الإجابة الصحيحة)
                                        </span>
                                      )}
                                    </span>
                                    {ch.latexFormula && <MathFormula formula={ch.latexFormula} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {q.choices.length === 0 && (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs">
                              <span className="font-bold text-slate-600">إجابتك: </span>
                              <span className="text-[#0B162C]">
                                {q.numericAnswer
                                  ? `${q.numericAnswer} ${q.numericUnit || ''}`
                                  : q.textAnswer || q.uploadedFileName || 'لم تتم الإجابة'}
                              </span>
                            </div>
                          )}

                          {q.graderFeedback && (
                            <div className="mt-2.5 rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 text-xs text-[#0B162C]">
                              <strong className="text-[#2563EB]">تعليق المصحح: </strong>
                              {q.graderFeedback}
                            </div>
                          )}

                          {(q.correctNumericAnswer ||
                            q.modelAnswerAr ||
                            q.explanationAr ||
                            (q.modelAnswerFiles && q.modelAnswerFiles.length > 0)) && (
                            <div className="mt-2.5 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                              {q.correctNumericAnswer && (
                                <div>
                                  <strong>الإجابة الرقمية الصحيحة: </strong>
                                  <span className="font-mono-num font-bold text-emerald-700">
                                    {q.correctNumericAnswer} {q.numericUnit || ''}
                                  </span>
                                </div>
                              )}
                              {q.modelAnswerAr && (
                                <div>
                                  <strong>الإجابة النموذجية: </strong>
                                  <span className="whitespace-pre-line">{q.modelAnswerAr}</span>
                                </div>
                              )}
                              {q.explanationAr && (
                                <div>
                                  <strong>التفسير العلمي: </strong>
                                  <span className="whitespace-pre-line">{q.explanationAr}</span>
                                </div>
                              )}
                              {q.modelAnswerFiles && q.modelAnswerFiles.length > 0 && (
                                <div className="pt-1">
                                  <strong className="mb-1.5 block">ملفات وصور الحل النموذجي:</strong>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {q.modelAnswerFiles.map((mf, mIdx) =>
                                      mf.mimeType === 'application/pdf' ? (
                                        <a
                                          key={mf.storageKey || mIdx}
                                          href={mf.previewUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-[#2563EB] hover:bg-blue-50"
                                        >
                                          <span>فتح ملف الحل PDF: {mf.fileName}</span>
                                        </a>
                                      ) : (
                                        <button
                                          key={mf.storageKey || mIdx}
                                          type="button"
                                          onClick={() => setZoomImageUrl(mf.previewUrl)}
                                          className="overflow-hidden rounded-lg border border-slate-200 bg-white p-1 hover:border-[#2563EB]"
                                        >
                                          <img
                                            src={mf.previewUrl}
                                            alt={mf.fileName || `صورة الحل النموذجي ${mIdx + 1}`}
                                            loading="lazy"
                                            className="max-h-48 w-full object-contain"
                                          />
                                        </button>
                                      ),
                                    )}
                                  </div>
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
        </div>
      )}

      {/* Image Lightbox */}
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
    </StudentTwoColShell>
  );
};
