import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookCheck,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileCheck2,
  Filter,
  Hourglass,
  Layers,
  MessageSquare,
  Play,
  RotateCcw,
  Search,
  Send,
  Star,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import type { StudentHomeworkCardItem } from '../types/homework.ts';
import { StudentHomeworkModal } from './StudentHomeworkModal.tsx';
import {
  STUDENT_ARTWORK,
  StudentEmptyState,
  StudentPageHero,
} from './student/StudentUiPrimitives.tsx';

type StatusTab =
  | 'ALL'
  | 'AVAILABLE'
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'GRADED'
  | 'LATE';

interface StudentHomeworkListResponse {
  serverNow: string;
  counts: Record<StatusTab, number>;
  items: StudentHomeworkCardItem[];
}

interface StudentHomeworkHubProps {
  activeGradeId?: number;
  externalOpenHomeworkId?: number | null;
  onOpenHomeworkModal?: (homeworkId: number) => void;
  onHomeworkSubmitted?: () => void;
}

type BoardColumnKey = 'PENDING' | 'UNDER_REVIEW' | 'SUBMITTED' | 'GRADED';

function classifyBoardColumn(hw: StudentHomeworkCardItem): BoardColumnKey {
  if (hw.statusCode === 'GRADED') return 'GRADED';
  if (hw.statusCode === 'UNDER_REVIEW') return 'UNDER_REVIEW';
  if (hw.statusCode === 'SUBMITTED') return 'SUBMITTED';
  return 'PENDING';
}

function formatDeadlineCountdown(deadline: string | null): string {
  if (!deadline) return 'بدون موعد نهائي محدد';
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return formatDateTimeAr(deadline);
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'انتهى موعد التسليم';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days >= 1) {
    return `متبقي: ${days} ${days === 1 ? 'يوم' : 'أيام'}${remHours > 0 ? ` و ${remHours} ساعة` : ''}`;
  }
  return `متبقي: ${Math.max(1, hours)} ساعة`;
}

export const StudentHomeworkHub: React.FC<StudentHomeworkHubProps> = ({
  activeGradeId,
  externalOpenHomeworkId,
  onOpenHomeworkModal,
  onHomeworkSubmitted,
}) => {
  const [statusTab, setStatusTab] = useState<StatusTab>('ALL');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState(0);
  const [lessonFilter, setLessonFilter] = useState(0);
  const [courseFilter, setCourseFilter] = useState(0);
  const [sortOrder, setSortOrder] = useState<'NEWEST' | 'DEADLINE'>('NEWEST');

  const [rawItems, setRawItems] = useState<StudentHomeworkCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localHomeworkId, setLocalHomeworkId] = useState<number | null>(null);

  const loadHomework = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (activeGradeId) qs.set('gradeId', String(activeGradeId));

      const res = await apiRequest<StudentHomeworkListResponse>(
        `/api/student/homework${qs.toString() ? `?${qs.toString()}` : ''}`,
      );
      setRawItems(res.items || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeGradeId]);

  useEffect(() => {
    void loadHomework();
  }, [loadHomework]);

  const openHomework = useCallback(
    (id: number) => {
      if (onOpenHomeworkModal) {
        onOpenHomeworkModal(id);
      } else {
        setLocalHomeworkId(id);
      }
    },
    [onOpenHomeworkModal],
  );

  useEffect(() => {
    if (externalOpenHomeworkId) {
      openHomework(externalOpenHomeworkId);
    }
  }, [externalOpenHomeworkId, openHomework]);

  const filterOptions = useMemo(() => {
    const units = new Map<number, string>();
    const lessons = new Map<number, string>();
    const courses = new Map<number, string>();
    for (const item of rawItems) {
      if (item.unitId && item.unitTitleAr) units.set(item.unitId, item.unitTitleAr);
      if (item.lessonId && item.lessonTitleAr) lessons.set(item.lessonId, item.lessonTitleAr);
      if (item.courseId && item.courseTitleAr) courses.set(item.courseId, item.courseTitleAr);
    }
    return {
      units: Array.from(units.entries()),
      lessons: Array.from(lessons.entries()),
      courses: Array.from(courses.entries()),
    };
  }, [rawItems]);

  const baseFilteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawItems.filter((item) => {
      if (unitFilter && item.unitId !== unitFilter) return false;
      if (lessonFilter && item.lessonId !== lessonFilter) return false;
      if (courseFilter && item.courseId !== courseFilter) return false;
      if (
        q &&
        !item.titleAr.toLowerCase().includes(q) &&
        !(item.descriptionAr || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [rawItems, search, unitFilter, lessonFilter, courseFilter]);

  const counts = useMemo<Record<StatusTab, number>>(() => {
    const all = baseFilteredItems;
    return {
      ALL: all.length,
      AVAILABLE: all.filter((i) => i.canSubmit).length,
      NOT_SUBMITTED: all.filter(
        (i) =>
          ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED_FOR_REVISION', 'DEADLINE_PASSED'].includes(
            i.statusCode,
          ) ||
          (i.statusCode === 'LATE' && i.submittedVersionsCount === 0),
      ).length,
      SUBMITTED: all.filter((i) => i.submittedVersionsCount > 0).length,
      UNDER_REVIEW: all.filter(
        (i) =>
          ['SUBMITTED', 'UNDER_REVIEW'].includes(i.statusCode) ||
          (i.statusCode === 'LATE' && i.submittedVersionsCount > 0),
      ).length,
      GRADED: all.filter((i) => i.statusCode === 'GRADED').length,
      LATE: all.filter((i) => i.statusCode === 'LATE' || i.statusCode === 'DEADLINE_PASSED').length,
    };
  }, [baseFilteredItems]);

  const allItems = useMemo(() => {
    return baseFilteredItems.filter((i) => {
      switch (statusTab) {
        case 'AVAILABLE':
          return i.canSubmit;
        case 'NOT_SUBMITTED':
          return (
            ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED_FOR_REVISION', 'DEADLINE_PASSED'].includes(
              i.statusCode,
            ) ||
            (i.statusCode === 'LATE' && i.submittedVersionsCount === 0)
          );
        case 'SUBMITTED':
          return i.submittedVersionsCount > 0;
        case 'UNDER_REVIEW':
          return (
            ['SUBMITTED', 'UNDER_REVIEW'].includes(i.statusCode) ||
            (i.statusCode === 'LATE' && i.submittedVersionsCount > 0)
          );
        case 'GRADED':
          return i.statusCode === 'GRADED';
        case 'LATE':
          return i.statusCode === 'LATE' || i.statusCode === 'DEADLINE_PASSED';
        default:
          return true;
      }
    });
  }, [baseFilteredItems, statusTab]);

  const sortedItems = useMemo(() => {
    const copy = [...allItems];
    if (sortOrder === 'DEADLINE') {
      copy.sort((a, b) => {
        const at = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        return at - bt;
      });
    }
    return copy;
  }, [allItems, sortOrder]);

  // Featured priority homework: prefer unsubmitted / available / returned for revision
  const featuredHomework = useMemo(() => {
    return (
      sortedItems.find(
        (hw) => hw.canSubmit && hw.statusCode !== 'GRADED' && hw.statusCode !== 'SUBMITTED',
      ) ||
      sortedItems[0] ||
      null
    );
  }, [sortedItems]);

  const boardColumns = useMemo(() => {
    const map: Record<BoardColumnKey, StudentHomeworkCardItem[]> = {
      PENDING: [],
      UNDER_REVIEW: [],
      SUBMITTED: [],
      GRADED: [],
    };
    for (const item of sortedItems) {
      map[classifyBoardColumn(item)].push(item);
    }
    return map;
  }, [sortedItems]);

  const isUnfilteredBoard =
    statusTab === 'ALL' && !search && !unitFilter && !lessonFilter && !courseFilter;
  const pendingTotal = isUnfilteredBoard
    ? boardColumns.PENDING.length
    : Math.max(
        counts.NOT_SUBMITTED,
        counts.ALL - counts.SUBMITTED - counts.UNDER_REVIEW - counts.GRADED,
      );
  const submittedKpi = isUnfilteredBoard ? boardColumns.SUBMITTED.length : counts.SUBMITTED;
  const underReviewKpi = isUnfilteredBoard ? boardColumns.UNDER_REVIEW.length : counts.UNDER_REVIEW;
  const gradedKpi = isUnfilteredBoard ? boardColumns.GRADED.length : counts.GRADED;

  const resetFilters = () => {
    setStatusTab('ALL');
    setSearch('');
    setUnitFilter(0);
    setLessonFilter(0);
    setCourseFilter(0);
    setSortOrder('NEWEST');
  };

  const renderWhiteHomeworkCard = (hw: StudentHomeworkCardItem) => {
    const col = classifyBoardColumn(hw);
    return (
      <article
        key={hw.id}
        role="button"
        tabIndex={0}
        data-testid={`student-homework-card-${hw.id}`}
        onClick={() => openHomework(hw.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openHomework(hw.id);
          }
        }}
        className="group cursor-pointer rounded-2xl bg-[#F8FAFF] p-3.5 text-[#0B162C] shadow-[0_6px_18px_rgba(2,8,28,0.28)] border border-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(37,99,235,0.25)] space-y-2.5"
      >
        <div>
          <h4 className="font-display text-sm font-extrabold text-[#0B162C] leading-snug group-hover:text-[#1D4ED8] transition-colors">
            {hw.titleAr}
          </h4>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <Layers className="h-3 w-3 text-[#2563EB] shrink-0" />
            <span className="truncate">
              {hw.unitTitleAr || hw.lessonTitleAr || hw.courseTitleAr || hw.gradeNameAr}
            </span>
          </div>
        </div>

        {/* Status-specific inner callout matching 06_Homework.png */}
        {col === 'PENDING' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-rose-500" />
            <span className="truncate">
              {hw.statusCode === 'RETURNED_FOR_REVISION'
                ? 'أُعيد للتعديل — أعد التسليم'
                : formatDeadlineCountdown(hw.deadline)}
            </span>
          </div>
        )}

        {col === 'UNDER_REVIEW' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] space-y-0.5">
            <div className="flex items-center gap-1.5 font-extrabold text-amber-800">
              <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>قيد التصحيح</span>
            </div>
            <div className="text-[10.5px] text-amber-700">جارٍ مراجعة الحل من قِبل الأستاذ</div>
          </div>
        )}

        {col === 'SUBMITTED' && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-extrabold text-sky-800 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span>تم التسليم بنجاح</span>
          </div>
        )}

        {col === 'GRADED' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1 font-extrabold text-emerald-800 font-mono-num">
                <Award className="h-3.5 w-3.5 text-emerald-600" />
                الدرجة: {hw.awardedGrade ?? 0} / {hw.maximumGrade}
              </span>
              {hw.percentage !== null && (
                <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 font-mono-num text-[10px] font-extrabold text-white">
                  {hw.percentage}%
                </span>
              )}
            </div>
            {hw.isModelAnswerReleased && (
              <div className="flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 px-1">
                <MessageSquare className="h-3 w-3" />
                <span>نموذج الإجابة والتصحيح متاحان للمراجعة</span>
              </div>
            )}
          </div>
        )}

        {/* Footer Date + Arrow */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-[10.5px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1 truncate">
            <Calendar className="h-3 w-3 shrink-0 text-slate-400" />
            {hw.deadline ? formatDateTimeAr(hw.deadline) : `${hw.maximumGrade} درجة`}
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[#2563EB] group-hover:bg-[#2563EB] group-hover:text-white transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </span>
        </div>
      </article>
    );
  };

  return (
    <div data-testid="student-homework-hub" className="space-y-4">
      {/* 1. Full-Width Hero Banner */}
      <StudentPageHero
        title="واجباتي والتكليفات"
        subtitle="تابع واجباتك الدراسية، حل أسئلة الاختيار من متعدد، ارفع صور الحل أو ملفات PDF، واطّلع على الدرجات والملاحظات."
        icon={<BookCheck className="h-6 w-6" />}
        artworkSrc={STUDENT_ARTWORK.homework}
        artworkAlt="واجباتي والتكليفات"
        iconBgClass="bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/45"
        chips={[
          { icon: <Layers className="h-3.5 w-3.5" />, label: `إجمالي الواجبات: ${counts.ALL}` },
          { icon: <Send className="h-3.5 w-3.5" />, label: `متاحة للحل: ${counts.AVAILABLE}` },
        ]}
      />

      {/* 2. Four Color-Tinted KPI Cards matching 06_Homework.png */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Violet: المعلقة */}
        <button
          type="button"
          onClick={() => setStatusTab(statusTab === 'NOT_SUBMITTED' ? 'ALL' : 'NOT_SUBMITTED')}
          className={`relative overflow-hidden rounded-2xl border p-4 text-right text-white transition-all ${
            statusTab === 'NOT_SUBMITTED'
              ? 'border-violet-300 ring-2 ring-violet-300/60'
              : 'border-violet-400/45 hover:border-violet-300/75'
          } bg-gradient-to-br from-[#5B21B6]/90 via-[#4C1D95]/85 to-[#2E1065]/95 shadow-[0_10px_24px_rgba(91,33,182,0.28)]`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-violet-100">المعلقة</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {pendingTotal}
              </div>
              <div className="mt-1.5 text-[11px] text-violet-200/90">واجب يحتاج إلى تسليم</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-violet-100 ring-1 ring-white/25">
              <BookCheck className="h-5 w-5" />
            </span>
          </div>
        </button>

        {/* Blue: تم التسليم */}
        <button
          type="button"
          onClick={() => setStatusTab(statusTab === 'SUBMITTED' ? 'ALL' : 'SUBMITTED')}
          className={`relative overflow-hidden rounded-2xl border p-4 text-right text-white transition-all ${
            statusTab === 'SUBMITTED'
              ? 'border-sky-300 ring-2 ring-sky-300/60'
              : 'border-sky-400/45 hover:border-sky-300/75'
          } bg-gradient-to-br from-[#0284C7]/90 via-[#1D4ED8]/85 to-[#0C2461]/95 shadow-[0_10px_24px_rgba(2,132,199,0.28)]`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-sky-100">تم التسليم</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {submittedKpi}
              </div>
              <div className="mt-1.5 text-[11px] text-sky-100/90">واجب مُسلّم</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-sky-100 ring-1 ring-white/25">
              <Send className="h-5 w-5" />
            </span>
          </div>
        </button>

        {/* Amber: قيد التصحيح */}
        <button
          type="button"
          onClick={() => setStatusTab(statusTab === 'UNDER_REVIEW' ? 'ALL' : 'UNDER_REVIEW')}
          className={`relative overflow-hidden rounded-2xl border p-4 text-right text-white transition-all ${
            statusTab === 'UNDER_REVIEW'
              ? 'border-amber-300 ring-2 ring-amber-300/60'
              : 'border-amber-400/45 hover:border-amber-300/75'
          } bg-gradient-to-br from-[#B45309]/90 via-[#92400E]/85 to-[#451A03]/95 shadow-[0_10px_24px_rgba(180,83,9,0.28)]`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-amber-100">قيد التصحيح</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {underReviewKpi}
              </div>
              <div className="mt-1.5 text-[11px] text-amber-100/90">واجب جارٍ مراجعته</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-amber-100 ring-1 ring-white/25">
              <Hourglass className="h-5 w-5" />
            </span>
          </div>
        </button>

        {/* Emerald: المنجزة */}
        <button
          type="button"
          onClick={() => setStatusTab(statusTab === 'GRADED' ? 'ALL' : 'GRADED')}
          className={`relative overflow-hidden rounded-2xl border p-4 text-right text-white transition-all ${
            statusTab === 'GRADED'
              ? 'border-emerald-300 ring-2 ring-emerald-300/60'
              : 'border-emerald-400/45 hover:border-emerald-300/75'
          } bg-gradient-to-br from-[#047857]/90 via-[#065F46]/85 to-[#022C22]/95 shadow-[0_10px_24px_rgba(4,120,87,0.28)]`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-emerald-100">المنجزة</div>
              <div className="mt-1.5 font-mono-num text-3xl font-extrabold leading-none">
                {gradedKpi}
              </div>
              <div className="mt-1.5 text-[11px] text-emerald-100/90">واجب مُصحّح ومكتمل</div>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-emerald-100 ring-1 ring-white/25">
              <CheckCircle2 className="h-5 w-5" />
            </span>
          </div>
        </button>
      </div>

      {/* 3. Horizontal Filter Bar matching 06_Homework.png */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#2D4A8A]/50 bg-[#0A1638]/92 p-3 text-white">
        <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-sky-200 pl-2">
          <Filter className="h-4 w-4 text-sky-300" />
          <span>تصفية الواجبات</span>
        </div>

        <select
          aria-label="تصفية حسب الحالة"
          value={statusTab}
          onChange={(e) => setStatusTab(e.target.value as StatusTab)}
          className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-white/15 bg-[#081330] px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value="ALL">جميع الحالات ({counts.ALL})</option>
          <option value="AVAILABLE">المتاحة ({counts.AVAILABLE})</option>
          <option value="NOT_SUBMITTED">لم يتم التسليم ({counts.NOT_SUBMITTED})</option>
          <option value="SUBMITTED">تم التسليم ({counts.SUBMITTED})</option>
          <option value="UNDER_REVIEW">قيد التصحيح ({counts.UNDER_REVIEW})</option>
          <option value="GRADED">تم التصحيح ({counts.GRADED})</option>
          <option value="LATE">المتأخرة ({counts.LATE})</option>
        </select>

        <select
          aria-label="تصفية حسب الوحدة"
          value={unitFilter}
          onChange={(e) => setUnitFilter(Number(e.target.value))}
          className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-white/15 bg-[#081330] px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value={0}>جميع الوحدات</option>
          {filterOptions.units.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <select
          aria-label="تصفية حسب الدرس أو الكورس"
          value={courseFilter ? `c:${courseFilter}` : lessonFilter ? `l:${lessonFilter}` : '0'}
          onChange={(e) => {
            const val = e.target.value;
            if (val.startsWith('c:')) {
              setCourseFilter(Number(val.slice(2)));
              setLessonFilter(0);
            } else if (val.startsWith('l:')) {
              setLessonFilter(Number(val.slice(2)));
              setCourseFilter(0);
            } else {
              setCourseFilter(0);
              setLessonFilter(0);
            }
          }}
          className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-white/15 bg-[#081330] px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value="0">كل الدروس والكورسات</option>
          {filterOptions.lessons.map(([id, name]) => (
            <option key={`l-${id}`} value={`l:${id}`}>
              الدرس: {name}
            </option>
          ))}
          {filterOptions.courses.map(([id, name]) => (
            <option key={`c-${id}`} value={`c:${id}`}>
              الكورس: {name}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[170px] w-full sm:w-auto">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="ابحث في الواجبات"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بعنوان الواجب..."
            className="w-full rounded-xl border border-white/15 bg-[#081330] py-2 pr-8 pl-3 text-xs text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <select
          aria-label="الترتيب"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as 'NEWEST' | 'DEADLINE')}
          className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-white/15 bg-[#081330] px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
        >
          <option value="NEWEST">الترتيب: الأحدث أولاً</option>
          <option value="DEADLINE">الترتيب: الأقرب موعدًا</option>
        </select>

        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/15"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>إعادة تعيين</span>
        </button>
      </div>

      {/* 4. Featured Priority Homework Banner matching 06_Homework.png */}
      {featuredHomework && !loading && (
        <section className="relative overflow-hidden rounded-2xl border border-[#7C3AED]/55 bg-gradient-to-l from-[#14205B] via-[#2A1B69] to-[#111948] p-4 sm:p-5 text-white shadow-[0_14px_34px_rgba(2,8,28,0.5)]">
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.75fr] gap-4 items-center">
            {/* Right side (RTL): Featured Homework Details */}
            <div className="space-y-2.5 min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40">
                  <BookCheck className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-300/50 bg-violet-500/25 px-2.5 py-0.5 text-[10.5px] font-extrabold text-violet-100">
                      <Star className="h-3 w-3 text-amber-300 fill-amber-300" />
                      {featuredHomework.canSubmit ? 'الواجب التالي للتسليم' : 'أحدث واجب'}
                    </span>
                    <span className="text-xs font-bold text-sky-300 truncate">
                      {featuredHomework.unitTitleAr ||
                        featuredHomework.lessonTitleAr ||
                        featuredHomework.gradeNameAr}
                    </span>
                  </div>
                  <h2 className="mt-0.5 font-display text-lg sm:text-xl font-extrabold text-white truncate">
                    {featuredHomework.titleAr}
                  </h2>
                </div>
              </div>

              {featuredHomework.descriptionAr && (
                <p className="text-xs sm:text-sm text-slate-200/90 line-clamp-2 leading-relaxed">
                  {featuredHomework.descriptionAr}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#091435]/75 px-3 py-1.5 font-bold text-slate-100">
                  <Calendar className="h-3.5 w-3.5 text-sky-300" />
                  {featuredHomework.deadline
                    ? `موعد التسليم: ${formatDateTimeAr(featuredHomework.deadline)}`
                    : 'بدون موعد نهائي محدد'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#091435]/75 px-3 py-1.5 font-mono-num font-bold text-slate-100">
                  <Award className="h-3.5 w-3.5 text-amber-300" />
                  الدرجة الكلية: {featuredHomework.maximumGrade} درجة
                </span>
                {featuredHomework.isModelAnswerReleased && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 font-bold text-emerald-200">
                    <FileCheck2 className="h-3.5 w-3.5" />
                    نموذج الإجابة متاح
                  </span>
                )}
              </div>
            </div>

            {/* Left side (RTL): Physics Accent + Primary Action */}
            <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3">
              <div className="hidden lg:block relative h-24 w-56 overflow-hidden rounded-xl border border-violet-300/30 bg-[#091335]/70">
                <img
                  src={STUDENT_ARTWORK.curriculum}
                  alt="تطبيقات الفيزياء"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-l from-[#1C1C62]/65 via-transparent to-[#111948]/50" />
              </div>

              <button
                type="button"
                onClick={() => openHomework(featuredHomework.id)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1D4ED8] via-[#2563EB] to-[#0EA5E9] px-6 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(37,99,235,0.45)] hover:brightness-110 w-full lg:w-56"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {featuredHomework.statusCode === 'GRADED'
                    ? 'عرض النتيجة والملاحظات'
                    : featuredHomework.canSubmit
                      ? 'فتح الواجب وتسليم الحل'
                      : 'عرض تفاصيل الواجب'}
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 5. All Homework — 4-Column Color-Headered Status Board (or filtered grid) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-white">
            <Layers className="h-4 w-4 text-sky-300" />
            <span>جميع الواجبات</span>
          </h3>
          <span className="font-mono-num text-xs font-bold text-slate-300">
            عرض {sortedItems.length} واجب
          </span>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-56 animate-pulse rounded-2xl border border-white/10 bg-[#0E1E4A]/70"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-950/60 p-5 text-sm text-rose-100">
            {error}
          </div>
        ) : sortedItems.length === 0 ? (
          <StudentEmptyState
            icon={<BookCheck className="h-6 w-6 text-orange-300" />}
            title="لا توجد واجبات في هذا التصنيف حاليًا"
            description="عندما يضيف الأستاذ واجبًا جديدًا لصفك أو كورساتك سيظهر هنا وتحت فيديو الدرس مباشرة."
            actionLabel={statusTab !== 'ALL' ? 'عرض جميع الواجبات' : undefined}
            onAction={statusTab !== 'ALL' ? resetFilters : undefined}
          />
        ) : statusTab === 'ALL' ? (
          /* 4-Column Status Board matching 06_Homework.png */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 items-start">
            {(
              [
                {
                  key: 'PENDING' as const,
                  title: 'المعلقة',
                  headerCls: 'from-[#6D28D9] to-[#4C1D95] border-violet-400/50',
                  shellCls: 'border-violet-400/40 bg-[#1B1345]/85',
                  icon: <BookCheck className="h-4 w-4" />,
                },
                {
                  key: 'UNDER_REVIEW' as const,
                  title: 'قيد التصحيح',
                  headerCls: 'from-[#B45309] to-[#78350F] border-amber-400/50',
                  shellCls: 'border-amber-400/40 bg-[#2A1B0E]/85',
                  icon: <Hourglass className="h-4 w-4" />,
                },
                {
                  key: 'SUBMITTED' as const,
                  title: 'تم التسليم',
                  headerCls: 'from-[#0284C7] to-[#1E40AF] border-sky-400/50',
                  shellCls: 'border-sky-400/40 bg-[#0B204A]/85',
                  icon: <Send className="h-4 w-4" />,
                },
                {
                  key: 'GRADED' as const,
                  title: 'المنجزة',
                  headerCls: 'from-[#047857] to-[#065F46] border-emerald-400/50',
                  shellCls: 'border-emerald-400/40 bg-[#092922]/85',
                  icon: <CheckCircle2 className="h-4 w-4" />,
                },
              ] as const
            ).map((col) => {
              const items = boardColumns[col.key];
              return (
                <section
                  key={col.key}
                  className={`overflow-hidden rounded-2xl border shadow-[0_10px_26px_rgba(2,8,28,0.45)] ${col.shellCls}`}
                >
                  <div
                    className={`flex items-center justify-between gap-2 border-b bg-gradient-to-l px-3.5 py-2.5 text-white ${col.headerCls}`}
                  >
                    <div className="flex items-center gap-2 font-display text-sm font-extrabold">
                      {col.icon}
                      <span>{col.title}</span>
                    </div>
                    <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-white/20 px-2 font-mono-num text-xs font-extrabold">
                      {items.length}
                    </span>
                  </div>

                  <div className="p-2.5 space-y-2.5">
                    {items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/15 bg-black/15 px-3 py-6 text-center text-[11.5px] text-slate-300">
                        لا توجد واجبات هنا
                      </div>
                    ) : (
                      items.map(renderWhiteHomeworkCard)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          /* Filtered Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {sortedItems.map(renderWhiteHomeworkCard)}
          </div>
        )}
      </div>

      {!onOpenHomeworkModal && localHomeworkId !== null && (
        <StudentHomeworkModal
          assignmentId={localHomeworkId}
          onClose={() => setLocalHomeworkId(null)}
          onSubmitted={() => {
            void loadHomework();
            onHomeworkSubmitted?.();
          }}
        />
      )}
    </div>
  );
};
