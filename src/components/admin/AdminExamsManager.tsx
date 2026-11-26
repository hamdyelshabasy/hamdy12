import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Copy,
  Edit3,
  EyeOff,
  FileCheck,
  FileText,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../lib/api.ts';
import {
  PERMISSIONS,
  hasPermission,
  type PermissionSubject,
} from '../../lib/permissions.ts';
import { pickBestExamForAttempts } from '../../lib/smartDashboardLinks.ts';
import {
  EXAM_TYPE_LABELS,
  PUBLICATION_STATUS_LABELS,
  type AdminExamListItem,
  type AdminExamQuestion,
  type ExamAssignmentScope,
  type ExamPublicationStatus,
  type ExamType,
} from '../../types/exams.ts';
import type { AdminCatalogData } from './AdminContentPanel.tsx';
import {
  AdminActionMenu,
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMasterDetail,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
  type AdminActionMenuItem,
  type AdminTone,
} from './AdminUiPrimitives.tsx';
import { AdminExamQuestionBuilder } from './exams/AdminExamQuestionBuilder.tsx';
import { AdminExamAnalyticsGrading } from './exams/AdminExamAnalyticsGrading.tsx';
import { SmartExamGeneratorModal } from './exams/SmartExamGeneratorModal.tsx';
import { ExamCreationWizard } from './exams/ExamCreationWizard.tsx';

interface AdminExamsListResponse {
  exams: AdminExamListItem[];
  groups: Array<{ id: number; gradeId: number; nameAr: string; memberCount: number }>;
  approvedStudents: Array<{ id: number; fullName: string; phone: string | null; gradeId: number }>;
}

interface AdminExamDetailResponse {
  exam: AdminExamListItem;
  calculatedMarks: number;
  questionCount: number;
  distribution: Record<string, number>;
  questions: AdminExamQuestion[];
}

interface AdminExamsManagerProps {
  catalog: AdminCatalogData;
  currentUser?: PermissionSubject | null;
  onToast: (msg: string) => void;
  initialStatusFilter?: 'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT';
  initialAction?: 'NONE' | 'CREATE_MANUAL' | 'CREATE_SMART' | 'CREATE_WIZARD' | 'OPEN_ATTEMPTS';
  navigationNonce?: number;
}

type ExamTabFilter =
  | 'ALL'
  | 'DRAFT'
  | 'PUBLISHED'
  | 'SCHEDULED'
  | 'NEEDS_GRADING'
  | 'ARCHIVED';

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getExamStatusTone(status: string): AdminTone {
  if (status === 'PUBLISHED') return 'emerald';
  if (status === 'SCHEDULED') return 'purple';
  if (status === 'DRAFT') return 'amber';
  return 'slate';
}

export const AdminExamsManager: React.FC<AdminExamsManagerProps> = ({
  catalog,
  currentUser,
  onToast,
  initialStatusFilter,
  initialAction,
  navigationNonce,
}) => {
  const canManageExams = !currentUser || hasPermission(currentUser, PERMISSIONS.EXAMS_MANAGE);
  const [view, setView] = useState<'list' | 'editor' | 'analytics' | 'wizard'>('list');
  const [wizardInitialDraftId, setWizardInitialDraftId] = useState<number | null>(null);
  const [editorSubTab, setEditorSubTab] = useState<'settings' | 'questions'>('settings');
  const [smartGeneratorOpen, setSmartGeneratorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listData, setListData] = useState<AdminExamsListResponse>({
    exams: [],
    groups: [],
    approvedStudents: [],
  });

  // Filters (client-side for instant 0ms switching + accurate KPI counts)
  const [search, setSearch] = useState('');
  const [filterTrackId, setFilterTrackId] = useState(0);
  const [filterGradeId, setFilterGradeId] = useState(0);
  const [filterUnitId, setFilterUnitId] = useState(0);
  const [filterLessonId, setFilterLessonId] = useState(0);
  const [filterExamType, setFilterExamType] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<ExamTabFilter>(
    (initialStatusFilter as ExamTabFilter) || 'ALL',
  );
  const [page, setPage] = useState(1);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);

  // Active Exam Editor state
  const [activeExamId, setActiveExamId] = useState<number | null>(null);
  const [examDetail, setExamDetail] = useState<AdminExamDetailResponse | null>(null);
  const [savingExam, setSavingExam] = useState(false);

  // Analytics exam target
  const [analyticsExamId, setAnalyticsExamId] = useState<number | null>(null);
  const handledAttemptsNonceRef = useRef<number | null>(null);

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<AdminExamListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const defaultTrackId = catalog.tracks[0]?.id || 0;
  const defaultGradeId =
    catalog.grades.find((g) => g.trackId === defaultTrackId)?.id || catalog.grades[0]?.id || 0;

  const [form, setForm] = useState({
    titleAr: '',
    descriptionAr: '',
    instructionsAr:
      'اقرأ كل سؤال بعناية قبل الإجابة. يتم حفظ إجاباتك تلقائيًا أثناء الحل، ويُسلّم الامتحان تلقائيًا فور انتهاء الوقت المحدد.',
    trackId: defaultTrackId,
    gradeId: defaultGradeId,
    unitId: 0,
    lessonId: 0,
    courseId: 0,
    requiredVideoId: 0,
    examType: 'LESSON_QUIZ' as ExamType,
    totalMarks: 20,
    durationMin: 30,
    passScorePercent: 60,
    startsAt: '',
    endsAt: '',
    maxAttempts: 2,
    shuffleQuestions: false,
    shuffleChoices: false,
    allowNavigation: true,
    allowReviewBeforeSubmit: true,
    allowStudentReview: true,
    showResultImmediately: true,
    showCorrectAnswers: true,
    showExplanations: true,
    allowNegativeMarking: false,
    publicationStatus: 'DRAFT' as ExamPublicationStatus,
    assignmentScope: 'GRADE' as ExamAssignmentScope,
    assignedGroupIds: [] as number[],
    assignedStudentIds: [] as number[],
  });

  const loadExamsList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<AdminExamsListResponse>('/api/admin/phase2-exams');
      setListData(res);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadExamsList();
  }, [loadExamsList]);

  const loadExamDetail = useCallback(
    async (examId: number) => {
      try {
        const res = await apiRequest<AdminExamDetailResponse>(`/api/admin/phase2-exams/${examId}`);
        setExamDetail(res);
        const ex = res.exam;
        setForm({
          titleAr: ex.titleAr,
          descriptionAr: ex.descriptionAr || '',
          instructionsAr: ex.instructionsAr || '',
          trackId: ex.trackId || defaultTrackId,
          gradeId: ex.gradeId,
          unitId: ex.unitId || 0,
          lessonId: ex.lessonId || 0,
          courseId: ex.courseId || 0,
          requiredVideoId: ex.requiredVideoId || 0,
          examType: (ex.examType as ExamType) || 'LESSON_QUIZ',
          totalMarks: Number(ex.totalMarks || 0),
          durationMin: ex.durationMin,
          passScorePercent: ex.passScorePercent,
          startsAt: toDateTimeLocal(ex.startsAt),
          endsAt: toDateTimeLocal(ex.endsAt),
          maxAttempts: ex.maxAttempts,
          shuffleQuestions: ex.shuffleQuestions,
          shuffleChoices: ex.shuffleChoices,
          allowNavigation: ex.allowNavigation,
          allowReviewBeforeSubmit: ex.allowReviewBeforeSubmit,
          allowStudentReview: ex.allowStudentReview,
          showResultImmediately: ex.showResultImmediately,
          showCorrectAnswers: ex.showCorrectAnswers,
          showExplanations: ex.showExplanations,
          allowNegativeMarking: ex.allowNegativeMarking,
          publicationStatus: (ex.publicationStatus as ExamPublicationStatus) || 'PUBLISHED',
          assignmentScope: (ex.assignmentScope as ExamAssignmentScope) || 'GRADE',
          assignedGroupIds: ex.assignedGroupIds || [],
          assignedStudentIds: ex.assignedStudentIds || [],
        });
      } catch (err) {
        onToast((err as Error).message);
      }
    },
    [defaultTrackId, onToast],
  );

  const openCreateExam = () => {
    setActiveExamId(null);
    setExamDetail(null);
    setForm({
      titleAr: '',
      descriptionAr: '',
      instructionsAr:
        'اقرأ كل سؤال بعناية قبل الإجابة. يتم حفظ إجاباتك تلقائيًا أثناء الحل، ويُسلّم الامتحان تلقائيًا فور انتهاء الوقت المحدد.',
      trackId: defaultTrackId,
      gradeId: defaultGradeId,
      unitId: 0,
      lessonId: 0,
      courseId: 0,
      requiredVideoId: 0,
      examType: 'LESSON_QUIZ',
      totalMarks: 20,
      durationMin: 30,
      passScorePercent: 60,
      startsAt: '',
      endsAt: '',
      maxAttempts: 2,
      shuffleQuestions: false,
      shuffleChoices: false,
      allowNavigation: true,
      allowReviewBeforeSubmit: true,
      allowStudentReview: true,
      showResultImmediately: true,
      showCorrectAnswers: true,
      showExplanations: true,
      allowNegativeMarking: false,
      publicationStatus: 'DRAFT',
      assignmentScope: 'GRADE',
      assignedGroupIds: [],
      assignedStudentIds: [],
    });
    setEditorSubTab('settings');
    setView('editor');
  };

  useEffect(() => {
    if (initialStatusFilter) {
      setFilterStatus(initialStatusFilter as ExamTabFilter);
      setPage(1);
    }
    if (initialAction === 'CREATE_WIZARD' && canManageExams) {
      setSmartGeneratorOpen(false);
      setWizardInitialDraftId(null);
      setView('wizard');
    } else if (initialAction === 'CREATE_SMART' && canManageExams) {
      setView('list');
      setSmartGeneratorOpen(true);
    } else if (initialAction === 'CREATE_MANUAL' && canManageExams) {
      setSmartGeneratorOpen(false);
      openCreateExam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatusFilter, initialAction, navigationNonce, canManageExams]);

  useEffect(() => {
    if (initialAction !== 'OPEN_ATTEMPTS' || loading) return;
    const nonce = navigationNonce ?? 0;
    if (handledAttemptsNonceRef.current === nonce) return;
    handledAttemptsNonceRef.current = nonce;

    setSmartGeneratorOpen(false);
    const bestId = pickBestExamForAttempts(listData.exams);
    if (bestId !== null) {
      setSelectedExamId(bestId);
      setAnalyticsExamId(bestId);
      setView('analytics');
    } else {
      setAnalyticsExamId(null);
      setView('list');
      setFilterStatus('ALL');
    }
  }, [initialAction, navigationNonce, loading, listData.exams]);

  const openEditExam = async (examId: number, initialTab: 'settings' | 'questions' = 'settings') => {
    setActiveExamId(examId);
    setEditorSubTab(initialTab);
    setView('editor');
    await loadExamDetail(examId);
  };

  const handleSaveExamForm = async (
    e: React.FormEvent,
    overrideStatus?: ExamPublicationStatus,
  ) => {
    e.preventDefault();
    setSavingExam(true);
    try {
      const payload = {
        ...form,
        publicationStatus: overrideStatus || form.publicationStatus,
        trackId: form.trackId || null,
        unitId: form.unitId || null,
        lessonId: form.lessonId || null,
        courseId: form.courseId || null,
        requiredVideoId: form.requiredVideoId || null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      };

      if (activeExamId) {
        await apiRequest(`/api/admin/phase2-exams/${activeExamId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onToast('تم حفظ تعديلات الامتحان بنجاح');
        await loadExamDetail(activeExamId);
        await loadExamsList();
      } else {
        const res = await apiRequest<{ exam: { id: number } }>('/api/admin/phase2-exams', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setActiveExamId(res.exam.id);
        onToast('تم إنشاء الامتحان بنجاح — يمكنك الآن إضافة الأسئلة');
        await loadExamDetail(res.exam.id);
        await loadExamsList();
        setEditorSubTab('questions');
      }
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingExam(false);
    }
  };

  const handleQuickStatus = async (examId: number, status: ExamPublicationStatus) => {
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}`, {
        method: 'PATCH',
        body: JSON.stringify({ publicationStatus: status }),
      });
      onToast(`تم تحديث حالة الامتحان إلى: ${PUBLICATION_STATUS_LABELS[status]}`);
      await loadExamsList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDuplicateExam = async (examId: number) => {
    try {
      await apiRequest(`/api/admin/phase2-exams/${examId}/duplicate`, { method: 'POST' });
      onToast('تم نسخ الامتحان مع جميع أسئلته كمسودة جديدة');
      await loadExamsList();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/admin/phase2-exams/${deleteTarget.id}`, { method: 'DELETE' });
      onToast(`تم حذف الامتحان «${deleteTarget.titleAr}» بنجاح دون التأثير على بقية السجلات`);
      setDeleteTarget(null);
      await loadExamsList();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  // Real KPI & Tab stats
  const examStats = useMemo(() => {
    const all = listData.exams;
    let published = 0;
    let scheduled = 0;
    let draft = 0;
    let archived = 0;
    let pendingManual = 0;
    let examsNeedingGrading = 0;
    for (const ex of all) {
      if (ex.publicationStatus === 'PUBLISHED') published += 1;
      else if (ex.publicationStatus === 'SCHEDULED') scheduled += 1;
      else if (ex.publicationStatus === 'DRAFT') draft += 1;
      else if (ex.publicationStatus === 'ARCHIVED') archived += 1;
      if (ex.pendingManualCount > 0) {
        pendingManual += ex.pendingManualCount;
        examsNeedingGrading += 1;
      }
    }
    return {
      total: all.length,
      published,
      scheduled,
      draft,
      archived,
      pendingManual,
      examsNeedingGrading,
    };
  }, [listData.exams]);

  const filteredExams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listData.exams.filter((ex) => {
      if (filterStatus === 'NEEDS_GRADING' && ex.pendingManualCount <= 0) return false;
      if (
        filterStatus !== 'ALL' &&
        filterStatus !== 'NEEDS_GRADING' &&
        ex.publicationStatus !== filterStatus
      ) {
        return false;
      }
      if (filterTrackId && ex.trackId !== filterTrackId) return false;
      if (filterGradeId && ex.gradeId !== filterGradeId) return false;
      if (filterUnitId && ex.unitId !== filterUnitId) return false;
      if (filterLessonId && ex.lessonId !== filterLessonId) return false;
      if (filterExamType !== 'ALL' && ex.examType !== filterExamType) return false;
      if (q) {
        const hay = `${ex.titleAr} ${ex.gradeNameAr} ${ex.trackNameAr} ${ex.unitTitleAr || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    listData.exams,
    search,
    filterStatus,
    filterTrackId,
    filterGradeId,
    filterUnitId,
    filterLessonId,
    filterExamType,
  ]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredExams.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedExams = useMemo(
    () => filteredExams.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredExams, safePage],
  );

  const selectedExam = useMemo(() => {
    if (selectedExamId != null) {
      const found =
        filteredExams.find((e) => e.id === selectedExamId) ||
        listData.exams.find((e) => e.id === selectedExamId);
      if (found) return found;
    }
    return filteredExams[0] || listData.exams[0] || null;
  }, [selectedExamId, filteredExams, listData.exams]);

  // ==================== STEP-BY-STEP EXAM CREATION WIZARD VIEW ====================
  if (view === 'wizard' && canManageExams) {
    return (
      <ExamCreationWizard
        catalog={catalog}
        groups={listData.groups}
        approvedStudents={listData.approvedStudents}
        initialDraftExamId={wizardInitialDraftId}
        onExit={(shouldRefresh) => {
          setWizardInitialDraftId(null);
          setView('list');
          if (shouldRefresh) {
            void loadExamsList();
          }
        }}
        onToast={onToast}
      />
    );
  }

  // ==================== ANALYTICS & MANUAL GRADING VIEW ====================
  if (view === 'analytics' && analyticsExamId) {
    return (
      <AdminExamAnalyticsGrading
        examId={analyticsExamId}
        onBack={() => {
          setAnalyticsExamId(null);
          setView('list');
          void loadExamsList();
        }}
        onToast={onToast}
      />
    );
  }

  // ==================== CREATE / EDIT EXAM + QUESTION BUILDER VIEW ====================
  if (view === 'editor') {
    const formGrades = catalog.grades.filter((g) => !form.trackId || g.trackId === form.trackId);
    const formUnits = catalog.units.filter((u) => u.gradeId === form.gradeId);
    const formLessons = catalog.lessons.filter((l) =>
      form.unitId ? l.unitId === form.unitId : formUnits.some((u) => u.id === l.unitId),
    );
    const formCourses = catalog.courses.filter((c) => c.gradeId === form.gradeId);
    const formVideos = catalog.videos.filter((v) => v.gradeId === form.gradeId);
    const formGroups = listData.groups.filter((g) => g.gradeId === form.gradeId);
    const formStudents = listData.approvedStudents.filter((s) => s.gradeId === form.gradeId);

    return (
      <div className="space-y-5" data-testid="admin-exam-editor-view">
        {/* Top Editor Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setView('list');
                void loadExamsList();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4" />
              <span>العودة لقائمة الامتحانات</span>
            </button>
            <div>
              <div className="text-xs text-slate-500">
                {activeExamId ? `تعديل الامتحان #${activeExamId}` : 'إنشاء امتحان جديد'}
              </div>
              <h2 className="text-lg font-extrabold text-[#0F172A]">
                {form.titleAr || 'امتحان فيزياء جديد'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => setEditorSubTab('settings')}
              className={`rounded-lg px-4 py-2 font-bold transition-colors ${
                editorSubTab === 'settings'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              1. إعدادات الامتحان والتخصيص
            </button>
            <button
              type="button"
              disabled={!activeExamId}
              data-testid="editor-questions-tab-btn"
              onClick={() => setEditorSubTab('questions')}
              className={`rounded-lg px-4 py-2 font-bold transition-colors disabled:opacity-40 ${
                editorSubTab === 'questions'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              2. الأسئلة والمعاينة ({examDetail?.questionCount || 0})
            </button>
          </div>
        </div>

        {/* Sub-tab 1: Complete 20-field Exam Configuration & Assignment */}
        {editorSubTab === 'settings' && (
          <form
            onSubmit={(e) => void handleSaveExamForm(e)}
            className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            data-testid="exam-settings-form"
          >
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-extrabold text-[#0F172A]">البيانات الأساسية للامتحان</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="ex-title" className="mb-1 block text-xs font-bold text-slate-700">
                    1. عنوان الامتحان *
                  </label>
                  <input
                    id="ex-title"
                    type="text"
                    required
                    value={form.titleAr}
                    onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
                    placeholder="مثال: امتحان الوحدة الأولى — قانون أوم وقانونا كيرشوف"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="ex-type" className="mb-1 block text-xs font-bold text-slate-700">
                    8. نوع الامتحان
                  </label>
                  <select
                    id="ex-type"
                    value={form.examType}
                    onChange={(e) => setForm({ ...form, examType: e.target.value as ExamType })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="LESSON_QUIZ">اختبار درس (Lesson Quiz)</option>
                    <option value="UNIT_EXAM">امتحان وحدة (Unit Examination)</option>
                    <option value="MONTHLY">امتحان شهري (Monthly Examination)</option>
                    <option value="COMPREHENSIVE">امتحان شامل (Comprehensive Examination)</option>
                    <option value="FINAL_SIMULATION">امتحان نهائي تجريبي (Final Mock Exam)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="ex-desc" className="mb-1 block text-xs font-bold text-slate-700">
                    2. وصف الامتحان
                  </label>
                  <textarea
                    id="ex-desc"
                    rows={2}
                    value={form.descriptionAr}
                    onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
                    placeholder="وصف مختصر لما يغطيه الامتحان من قوانين ومسائل..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-inst" className="mb-1 block text-xs font-bold text-slate-700">
                    3. تعليمات الامتحان (تظهر للطالب قبل البدء)
                  </label>
                  <textarea
                    id="ex-inst"
                    rows={2}
                    value={form.instructionsAr}
                    onChange={(e) => setForm({ ...form, instructionsAr: e.target.value })}
                    placeholder="التعليمات والقواعد التي يلتزم بها الطالب قبل بدء الامتحان..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Academic Placement */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-extrabold text-[#0F172A]">المسار الدراسي والربط بالمنهج</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="ex-track" className="mb-1 block text-xs font-bold text-slate-700">
                    4. المسار التعليمي
                  </label>
                  <select
                    id="ex-track"
                    value={form.trackId}
                    onChange={(e) => {
                      const nextTrack = Number(e.target.value);
                      const firstGrade = catalog.grades.find((g) => g.trackId === nextTrack);
                      setForm({
                        ...form,
                        trackId: nextTrack,
                        gradeId: firstGrade?.id || form.gradeId,
                        unitId: 0,
                        lessonId: 0,
                        courseId: 0,
                        assignedGroupIds: [],
                        assignedStudentIds: [],
                      });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {catalog.tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ex-grade" className="mb-1 block text-xs font-bold text-slate-700">
                    5. الصف الدراسي
                  </label>
                  <select
                    id="ex-grade"
                    value={form.gradeId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        gradeId: Number(e.target.value),
                        unitId: 0,
                        lessonId: 0,
                        courseId: 0,
                        assignedGroupIds: [],
                        assignedStudentIds: [],
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {formGrades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ex-unit" className="mb-1 block text-xs font-bold text-slate-700">
                    6. الوحدة الدراسية (اختياري)
                  </label>
                  <select
                    id="ex-unit"
                    value={form.unitId}
                    onChange={(e) => setForm({ ...form, unitId: Number(e.target.value), lessonId: 0 })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value={0}>كل الوحدات / غير محدد</option>
                    {formUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.titleAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ex-lesson" className="mb-1 block text-xs font-bold text-slate-700">
                    7. الدرس المرتبط (اختياري)
                  </label>
                  <select
                    id="ex-lesson"
                    value={form.lessonId}
                    onChange={(e) => setForm({ ...form, lessonId: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value={0}>غير مرتبط بدرس محدد</option>
                    {formLessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.titleAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ex-course" className="mb-1 block text-xs font-bold text-slate-700">
                    ربط بكورس مدفوع (يحترم صلاحيات الاشتراك الحالية — اختياري)
                  </label>
                  <select
                    id="ex-course"
                    value={form.courseId}
                    onChange={(e) => setForm({ ...form, courseId: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value={0}>متاح بدون اشتراط كورس محدد</option>
                    {formCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        للمشتركين في: {c.titleAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ex-video" className="mb-1 block text-xs font-bold text-slate-700">
                    شرط إتمام مشاهدة فيديو مسبق (اختياري)
                  </label>
                  <select
                    id="ex-video"
                    value={form.requiredVideoId}
                    onChange={(e) => setForm({ ...form, requiredVideoId: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value={0}>بدون شرط مشاهدة فيديو</option>
                    {formVideos.map((v) => (
                      <option key={v.id} value={v.id}>
                        يشترط إتمام (70%+): {v.titleAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Grading, Timing & Availability Window */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-extrabold text-[#0F172A]">الدرجات والتوقيت والمحاولات والجدولة</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="ex-marks" className="mb-1 block text-xs font-bold text-slate-700">
                    9. الدرجة الكلية للامتحان
                  </label>
                  <input
                    id="ex-marks"
                    type="number"
                    min={0}
                    step="0.5"
                    value={form.totalMarks}
                    onChange={(e) => setForm({ ...form, totalMarks: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-dur" className="mb-1 block text-xs font-bold text-slate-700">
                    10. مدة الامتحان (بالدقائق)
                  </label>
                  <input
                    id="ex-dur"
                    type="number"
                    min={1}
                    max={360}
                    required
                    value={form.durationMin}
                    onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-pass" className="mb-1 block text-xs font-bold text-slate-700">
                    11. نسبة النجاح (%)
                  </label>
                  <input
                    id="ex-pass"
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={form.passScorePercent}
                    onChange={(e) => setForm({ ...form, passScorePercent: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-attempts" className="mb-1 block text-xs font-bold text-slate-700">
                    14. الحد الأقصى للمحاولات
                  </label>
                  <input
                    id="ex-attempts"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={form.maxAttempts}
                    onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="ex-start" className="mb-1 block text-xs font-bold text-slate-700">
                    12. تاريخ ووقت بدء الإتاحة (اختياري)
                  </label>
                  <input
                    id="ex-start"
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-end" className="mb-1 block text-xs font-bold text-slate-700">
                    13. تاريخ ووقت انتهاء الإتاحة (اختياري)
                  </label>
                  <input
                    id="ex-end"
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ex-status" className="mb-1 block text-xs font-bold text-slate-700">
                    حالة النشر
                  </label>
                  <select
                    id="ex-status"
                    value={form.publicationStatus}
                    onChange={(e) =>
                      setForm({ ...form, publicationStatus: e.target.value as ExamPublicationStatus })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                  >
                    <option value="DRAFT">مسودة (غير مرئي للطلاب)</option>
                    <option value="PUBLISHED">منشور ومتاح للطلاب</option>
                    <option value="SCHEDULED">مجدول حسب موعد البدء</option>
                    <option value="HIDDEN">مخفي</option>
                    <option value="ARCHIVED">مؤرشف</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Behavior & Result Visibility Rules */}
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-extrabold text-[#0F172A]">
                قواعد عرض الأسئلة والنتائج والمراجعة
              </h3>
              <div className="grid gap-3 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.shuffleQuestions}
                    onChange={(e) => setForm({ ...form, shuffleQuestions: e.target.checked })}
                  />
                  <span>15. ترتيب عشوائي للأسئلة لكل محاولة</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.shuffleChoices}
                    onChange={(e) => setForm({ ...form, shuffleChoices: e.target.checked })}
                  />
                  <span>16. ترتيب عشوائي للاختيارات</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.allowNavigation}
                    onChange={(e) => setForm({ ...form, allowNavigation: e.target.checked })}
                  />
                  <span>17. السماح بالتنقل الحر بين الأسئلة</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.allowReviewBeforeSubmit}
                    onChange={(e) => setForm({ ...form, allowReviewBeforeSubmit: e.target.checked })}
                  />
                  <span>18. مراجعة ملخص الإجابات قبل التسليم</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.showCorrectAnswers}
                    onChange={(e) => setForm({ ...form, showCorrectAnswers: e.target.checked })}
                  />
                  <span>19. عرض الإجابات الصحيحة بعد التسليم</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.showResultImmediately}
                    onChange={(e) => setForm({ ...form, showResultImmediately: e.target.checked })}
                  />
                  <span>20. عرض النتيجة فورًا (وإلا بعد اعتماد المدرس)</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.allowStudentReview}
                    onChange={(e) => setForm({ ...form, allowStudentReview: e.target.checked })}
                  />
                  <span>السماح للطالب بمراجعة ورقته في «نتائجي»</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.showExplanations}
                    onChange={(e) => setForm({ ...form, showExplanations: e.target.checked })}
                  />
                  <span>عرض الشرح والتفسير العلمي لكل سؤال</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={form.allowNegativeMarking}
                    onChange={(e) => setForm({ ...form, allowNegativeMarking: e.target.checked })}
                  />
                  <span>تفعيل الدرجات السالبة للإجابات الخاطئة</span>
                </label>
              </div>
            </div>

            {/* Target Audience Assignment */}
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-extrabold text-[#0F172A]">تخصيص الامتحان للطلاب المستهدفين</h3>
              <div className="flex flex-wrap gap-3 text-xs">
                {[
                  { id: 'GRADE', label: 'جميع الطلاب المعتمدين في هذا الصف' },
                  { id: 'GROUP', label: `مجموعة دراسية محددة (${formGroups.length} متاحة)` },
                  { id: 'STUDENTS', label: `طلاب محددون بالاسم (${formStudents.length} طالب معتمد)` },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 font-semibold ${
                      form.assignmentScope === opt.id
                        ? 'border-[#2563EB] bg-blue-50 text-[#0F172A]'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment-scope"
                      checked={form.assignmentScope === opt.id}
                      onChange={() =>
                        setForm({ ...form, assignmentScope: opt.id as ExamAssignmentScope })
                      }
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>

              {form.assignmentScope === 'GROUP' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  {formGroups.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      لا توجد مجموعات دراسية لهذا الصف بعد. يمكنك إنشاؤها من قسم «المجموعات والمواعيد».
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {formGroups.map((g) => {
                        const checked = form.assignedGroupIds.includes(g.id);
                        return (
                          <label
                            key={g.id}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  assignedGroupIds: checked
                                    ? prev.assignedGroupIds.filter((id) => id !== g.id)
                                    : [...prev.assignedGroupIds, g.id],
                                }))
                              }
                            />
                            <span className="font-semibold text-[#0F172A]">{g.nameAr}</span>
                            <span className="text-slate-400">({g.memberCount} طالب)</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {form.assignmentScope === 'STUDENTS' && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  {formStudents.length === 0 ? (
                    <p className="text-xs text-slate-500">لا يوجد طلاب معتمدون في هذا الصف حاليًا.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {formStudents.map((s) => {
                        const checked = form.assignedStudentIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  assignedStudentIds: checked
                                    ? prev.assignedStudentIds.filter((id) => id !== s.id)
                                    : [...prev.assignedStudentIds, s.id],
                                }))
                              }
                            />
                            <span className="font-semibold text-[#0F172A]">{s.fullName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Submit Actions */}
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <button
                type="submit"
                disabled={savingExam}
                data-testid="save-exam-settings-btn"
                className="inline-flex items-center gap-2 rounded-xl bg-[#0D172B] px-6 py-2.5 text-xs font-bold text-white hover:bg-[#2563EB] disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                <span>
                  {savingExam
                    ? 'جارٍ الحفظ...'
                    : activeExamId
                      ? 'حفظ تعديلات الإعدادات'
                      : 'إنشاء الامتحان والانتقال للأسئلة'}
                </span>
              </button>
              {activeExamId && form.publicationStatus !== 'PUBLISHED' && (
                <button
                  type="button"
                  disabled={savingExam}
                  onClick={(e) => void handleSaveExamForm(e as unknown as React.FormEvent, 'PUBLISHED')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>حفظ ونشر للطلاب الآن</span>
                </button>
              )}
            </div>
          </form>
        )}

        {/* Sub-tab 2: Embedded Question Builder */}
        {editorSubTab === 'questions' && activeExamId && examDetail && (
          <AdminExamQuestionBuilder
            catalog={catalog}
            examId={activeExamId}
            examTrackId={examDetail.exam.trackId}
            examGradeId={examDetail.exam.gradeId}
            examUnitId={examDetail.exam.unitId}
            examLessonId={examDetail.exam.lessonId}
            examTitleAr={examDetail.exam.titleAr}
            durationMin={examDetail.exam.durationMin}
            configuredTotalMarks={Number(examDetail.exam.totalMarks || 0)}
            allowNegativeMarking={examDetail.exam.allowNegativeMarking}
            questions={examDetail.questions}
            calculatedMarks={examDetail.calculatedMarks}
            distribution={examDetail.distribution}
            onSyncTotalMarks={async (marks) => {
              await apiRequest(`/api/admin/phase2-exams/${activeExamId}`, {
                method: 'PATCH',
                body: JSON.stringify({ totalMarks: marks }),
              });
              onToast(`تمت مطابقة الدرجة الكلية للامتحان إلى ${marks}`);
              await loadExamDetail(activeExamId);
              await loadExamsList();
            }}
            onReloadExam={async () => {
              await loadExamDetail(activeExamId);
              await loadExamsList();
            }}
            onToast={onToast}
          />
        )}
      </div>
    );
  }

  // ==================== MAIN EXAM MANAGEMENT LIST VIEW (SCREEN 09) ====================
  const filterGrades = catalog.grades.filter((g) => !filterTrackId || g.trackId === filterTrackId);
  const filterUnits = catalog.units.filter((u) => !filterGradeId || u.gradeId === filterGradeId);
  const filterLessons = catalog.lessons.filter((l) => !filterUnitId || l.unitId === filterUnitId);
  const hasFilters = Boolean(
    search.trim() ||
      filterTrackId ||
      filterGradeId ||
      filterUnitId ||
      filterLessonId ||
      filterExamType !== 'ALL' ||
      filterStatus !== 'ALL',
  );

  const resetFilters = () => {
    setSearch('');
    setFilterTrackId(0);
    setFilterGradeId(0);
    setFilterUnitId(0);
    setFilterLessonId(0);
    setFilterExamType('ALL');
    setFilterStatus('ALL');
    setPage(1);
  };

  return (
    <div className="space-y-5" data-testid="admin-exams-manager">
      {/* Header with all 3 preserved creation entry points */}
      <AdminPageHeader
        title="إدارة الامتحانات"
        subtitle="إنشاء الاختبارات ومتابعة المحاولات والتصحيح ونشر النتائج."
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          canManageExams ? (
            <>
              <button
                type="button"
                data-testid="create-new-exam-btn"
                onClick={openCreateExam}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                <span>إنشاء يدوي</span>
              </button>
              <button
                type="button"
                data-testid="smart-exam-generator-btn"
                onClick={() => setSmartGeneratorOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-[#0F172A] shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/50 hover:text-[#2563EB]"
              >
                <Sparkles className="h-4 w-4 text-[#7C3AED]" />
                <span>إنشاء امتحان ذكي</span>
              </button>
              <button
                type="button"
                data-testid="open-exam-wizard-btn"
                onClick={() => {
                  setWizardInitialDraftId(null);
                  setView('wizard');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
              >
                <ClipboardList className="h-4 w-4" />
                <span>إنشاء بخطوات سهلة</span>
              </button>
            </>
          ) : undefined
        }
      />

      {/* 4 Real KPI Cards */}
      <AdminKpiGrid cols={4}>
        <AdminKpiCard
          label="إجمالي الامتحانات"
          value={examStats.total}
          subtitle="جميع الاختبارات"
          tone="blue"
          icon={<FileText className="h-5 w-5" />}
          onClick={() => {
            setFilterStatus('ALL');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="امتحانات متاحة"
          value={examStats.published}
          subtitle="وفق وقت الإتاحة"
          tone="emerald"
          icon={<CheckCircle2 className="h-5 w-5" />}
          onClick={() => {
            setFilterStatus('PUBLISHED');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="امتحانات قادمة"
          value={examStats.scheduled}
          subtitle="مجدولة"
          tone="purple"
          icon={<Calendar className="h-5 w-5" />}
          onClick={() => {
            setFilterStatus('SCHEDULED');
            setPage(1);
          }}
        />
        <AdminKpiCard
          label="بانتظار التصحيح"
          value={examStats.pendingManual}
          subtitle="محاولات تحتاج مراجعة"
          tone="amber"
          icon={<Clock className="h-5 w-5" />}
          onClick={() => {
            setFilterStatus('NEEDS_GRADING');
            setPage(1);
          }}
        />
      </AdminKpiGrid>

      {/* Segmented Status Tabs */}
      <AdminSegmentedTabs
        activeId={filterStatus}
        onChange={(id) => {
          setFilterStatus(id);
          setPage(1);
        }}
        items={[
          { id: 'ALL', label: 'الكل', count: examStats.total },
          { id: 'DRAFT', label: 'المسودات', count: examStats.draft },
          { id: 'PUBLISHED', label: 'المتاحة', count: examStats.published },
          { id: 'SCHEDULED', label: 'القادمة', count: examStats.scheduled },
          { id: 'NEEDS_GRADING', label: 'بانتظار التصحيح', count: examStats.examsNeedingGrading },
          { id: 'ARCHIVED', label: 'الأرشيف', count: examStats.archived },
        ]}
      />

      {/* Filter Bar */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="ابحث بعنوان الامتحان..."
        hasActiveFilters={hasFilters}
        onReset={resetFilters}
      >
        <select
          aria-label="تصفية حسب المسار"
          value={filterTrackId}
          onChange={(e) => {
            setFilterTrackId(Number(e.target.value));
            setFilterGradeId(0);
            setFilterUnitId(0);
            setFilterLessonId(0);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value={0}>كل المسارات</option>
          {catalog.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nameAr}
            </option>
          ))}
        </select>

        <select
          aria-label="تصفية حسب الصف"
          value={filterGradeId}
          onChange={(e) => {
            setFilterGradeId(Number(e.target.value));
            setFilterUnitId(0);
            setFilterLessonId(0);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value={0}>كل الصفوف</option>
          {filterGrades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nameAr}
            </option>
          ))}
        </select>

        {filterGradeId > 0 && filterUnits.length > 0 && (
          <select
            aria-label="تصفية حسب الوحدة"
            value={filterUnitId}
            onChange={(e) => {
              setFilterUnitId(Number(e.target.value));
              setFilterLessonId(0);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
          >
            <option value={0}>كل الوحدات</option>
            {filterUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.titleAr}
              </option>
            ))}
          </select>
        )}

        {filterUnitId > 0 && filterLessons.length > 0 && (
          <select
            aria-label="تصفية حسب الدرس"
            value={filterLessonId}
            onChange={(e) => {
              setFilterLessonId(Number(e.target.value));
              setPage(1);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
          >
            <option value={0}>كل الدروس</option>
            {filterLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.titleAr}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="تصفية حسب نوع الامتحان"
          value={filterExamType}
          onChange={(e) => {
            setFilterExamType(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
        >
          <option value="ALL">كل الأنواع</option>
          <option value="LESSON_QUIZ">اختبار درس</option>
          <option value="UNIT_EXAM">امتحان وحدة</option>
          <option value="MONTHLY">امتحان شهري</option>
          <option value="COMPREHENSIVE">امتحان شامل</option>
          <option value="FINAL_SIMULATION">محاكاة النهائي</option>
        </select>
      </AdminFilterBar>

      {/* Master-Detail: Exams Table (8 cols) + Sticky Selected Exam Card (4 cols) */}
      <AdminMasterDetail
        mainSpan="8"
        main={
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-extrabold text-[#0F172A]">قائمة الامتحانات</h3>
              <span className="font-mono-num text-xs font-semibold text-slate-500">
                {filteredExams.length} امتحان
              </span>
            </div>

            {loading ? (
              <div className="py-16 text-center text-xs text-slate-500">جارٍ تحميل الامتحانات...</div>
            ) : paginatedExams.length === 0 ? (
              <div className="p-6">
                <AdminEmptyState
                  icon={<ClipboardList className="h-5 w-5" />}
                  title="لا توجد امتحانات مطابقة للبحث"
                  description="يمكنك إنشاء امتحان جديد بالمعالج السريع أو بالمولد الذكي من الأزرار أعلاه."
                />
              </div>
            ) : (
              <div className="overflow-x-auto" data-testid="admin-exams-list">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">الامتحان</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">الأسئلة</th>
                      <th className="px-4 py-3">المدة</th>
                      <th className="px-4 py-3">التسليمات</th>
                      <th className="px-4 py-3">التصحيح</th>
                      <th className="px-4 py-3 text-left">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedExams.map((ex) => {
                      const isSelected = selectedExam?.id === ex.id;
                      const menuItems: AdminActionMenuItem[] = [
                        {
                          id: 'questions',
                          label: `إدارة الأسئلة (${ex.questionCount})`,
                          icon: <FileCheck className="h-3.5 w-3.5" />,
                          onClick: () => void openEditExam(ex.id, 'questions'),
                        },
                        {
                          id: 'analytics',
                          label: 'الإحصائيات والتصحيح',
                          icon: <BarChart3 className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setAnalyticsExamId(ex.id);
                            setView('analytics');
                          },
                        },
                        {
                          id: 'edit',
                          label: 'تعديل الإعدادات',
                          icon: <Edit3 className="h-3.5 w-3.5" />,
                          onClick: () => void openEditExam(ex.id, 'settings'),
                        },
                      ];
                      if (canManageExams && ex.publicationStatus === 'DRAFT') {
                        menuItems.push({
                          id: 'resume-wizard',
                          label: 'استئناف بالمعالج السهل',
                          icon: <ClipboardList className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setWizardInitialDraftId(ex.id);
                            setView('wizard');
                          },
                        });
                      }
                      if (canManageExams) {
                        menuItems.push({
                          id: 'duplicate',
                          label: 'نسخ الامتحان كمسودة',
                          icon: <Copy className="h-3.5 w-3.5" />,
                          onClick: () => void handleDuplicateExam(ex.id),
                        });
                        if (ex.publicationStatus !== 'PUBLISHED') {
                          menuItems.push({
                            id: 'publish',
                            label: 'نشر الامتحان للطلاب',
                            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                            tone: 'success',
                            onClick: () => void handleQuickStatus(ex.id, 'PUBLISHED'),
                          });
                        } else {
                          menuItems.push({
                            id: 'hide',
                            label: 'إخفاء عن الطلاب',
                            icon: <EyeOff className="h-3.5 w-3.5" />,
                            onClick: () => void handleQuickStatus(ex.id, 'HIDDEN'),
                          });
                        }
                        if (ex.publicationStatus !== 'ARCHIVED') {
                          menuItems.push({
                            id: 'archive',
                            label: 'أرشفة الامتحان',
                            icon: <Archive className="h-3.5 w-3.5" />,
                            onClick: () => void handleQuickStatus(ex.id, 'ARCHIVED'),
                          });
                        }
                        menuItems.push({
                          id: 'delete',
                          label: 'حذف الامتحان',
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          tone: 'danger',
                          onClick: () => setDeleteTarget(ex),
                        });
                      }

                      return (
                        <tr
                          key={ex.id}
                          data-testid={`admin-exam-row-${ex.id}`}
                          onClick={() => setSelectedExamId(ex.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="px-4 py-3.5 max-w-[230px]">
                            <div className="font-extrabold text-[#0F172A] line-clamp-1">{ex.titleAr}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                              {ex.gradeNameAr} · {ex.trackNameAr}
                              {ex.unitTitleAr ? ` · ${ex.unitTitleAr}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <AdminStatusBadge tone={getExamStatusTone(ex.publicationStatus)}>
                              {PUBLICATION_STATUS_LABELS[ex.publicationStatus] || ex.publicationStatus}
                            </AdminStatusBadge>
                          </td>
                          <td className="px-4 py-3.5 font-mono-num font-bold text-slate-700 whitespace-nowrap">
                            {ex.questionCount} سؤالًا
                          </td>
                          <td className="px-4 py-3.5 font-mono-num text-slate-600 whitespace-nowrap">
                            {ex.durationMin} دقيقة
                          </td>
                          <td className="px-4 py-3.5 font-mono-num font-bold text-[#0F172A] whitespace-nowrap">
                            {ex.submittedCount}
                          </td>
                          <td className="px-4 py-3.5">
                            {ex.pendingManualCount > 0 ? (
                              <AdminStatusBadge tone="amber">
                                {ex.pendingManualCount} للمراجعة
                              </AdminStatusBadge>
                            ) : ex.submittedCount > 0 ? (
                              <AdminStatusBadge tone="emerald">مكتمل</AdminStatusBadge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-left">
                            <div
                              className="inline-flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ex.submittedCount > 0 || ex.publicationStatus === 'PUBLISHED' ? (
                                <button
                                  type="button"
                                  data-testid={`open-analytics-btn-${ex.id}`}
                                  onClick={() => {
                                    setAnalyticsExamId(ex.id);
                                    setView('analytics');
                                  }}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0F172A] hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB]"
                                >
                                  المحاولات
                                </button>
                              ) : canManageExams && ex.publicationStatus === 'DRAFT' ? (
                                <button
                                  type="button"
                                  data-testid={`resume-wizard-btn-${ex.id}`}
                                  onClick={() => {
                                    setWizardInitialDraftId(ex.id);
                                    setView('wizard');
                                  }}
                                  className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                                >
                                  استئناف
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`open-analytics-btn-${ex.id}`}
                                  onClick={() => void openEditExam(ex.id, 'settings')}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  <span>تعديل</span>
                                </button>
                              )}
                              <AdminActionMenu items={menuItems} ariaLabel={`إجراءات ${ex.titleAr}`} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {filteredExams.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs">
                <span className="text-slate-500">
                  عرض <strong className="font-mono-num text-[#0F172A]">{(safePage - 1) * pageSize + 1}</strong>–
                  <strong className="font-mono-num text-[#0F172A]">
                    {Math.min(safePage * pageSize, filteredExams.length)}
                  </strong>{' '}
                  من <strong className="font-mono-num text-[#0F172A]">{filteredExams.length}</strong> امتحان
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>السابق</span>
                  </button>
                  <span className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 font-mono-num font-bold text-white">
                    {safePage}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
                  >
                    <span>التالي</span>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </AdminCard>
        }
        detail={
          selectedExam ? (
            <AdminCard className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-extrabold text-[#0F172A]">الامتحان المحدد</h3>
              </div>

              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#2563EB]">
                  <ClipboardCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-[#0F172A]">{selectedExam.titleAr}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {selectedExam.gradeNameAr} · {EXAM_TYPE_LABELS[selectedExam.examType] || selectedExam.examType}
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">حالة الامتحان</span>
                  <AdminStatusBadge tone={getExamStatusTone(selectedExam.publicationStatus)}>
                    {PUBLICATION_STATUS_LABELS[selectedExam.publicationStatus] ||
                      selectedExam.publicationStatus}
                  </AdminStatusBadge>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">عدد الأسئلة</span>
                  <span className="font-mono-num font-extrabold text-[#0F172A]">
                    {selectedExam.questionCount}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">المدة</span>
                  <span className="font-mono-num font-bold text-[#0F172A]">
                    {selectedExam.durationMin} دقيقة
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">الدرجة النهائية</span>
                  <span className="font-mono-num font-extrabold text-[#0F172A]">
                    {selectedExam.calculatedMarks || selectedExam.totalMarks}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">التسليمات</span>
                  <span className="font-mono-num font-extrabold text-[#0F172A]">
                    {selectedExam.submittedCount}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-500">بانتظار التصحيح</span>
                  <span
                    className={`font-mono-num font-extrabold ${
                      selectedExam.pendingManualCount > 0 ? 'text-amber-700' : 'text-slate-700'
                    }`}
                  >
                    {selectedExam.pendingManualCount}
                  </span>
                </div>
                {selectedExam.startsAt && (
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-500">تاريخ البدء</span>
                    <span className="font-medium text-slate-700">
                      {formatDateTimeAr(selectedExam.startsAt)}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAnalyticsExamId(selectedExam.id);
                    setView('analytics');
                  }}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>فتح المحاولات والتصحيح</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void openEditExam(selectedExam.id, 'questions')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <FileCheck className="h-3.5 w-3.5" />
                    <span>الأسئلة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void openEditExam(selectedExam.id, 'settings')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>تعديل</span>
                  </button>
                </div>
              </div>
            </AdminCard>
          ) : (
            <AdminCard>
              <AdminEmptyState
                icon={<ClipboardCheck className="h-5 w-5" />}
                title="اختر امتحانًا"
                description="اضغط على أي امتحان من الجدول لعرض ملخصه وفتح محاولات الطلاب."
              />
            </AdminCard>
          )
        }
      />

      {/* Safe Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف الامتحان"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-[#0F172A]">تأكيد حذف الامتحان</h3>
            <p className="text-sm text-slate-600">
              هل أنت متأكد من حذف الامتحان <strong>«{deleteTarget.titleAr}»</strong>؟ سيتم حذف هذا الامتحان ومحاولاته فقط دون التأثير على حسابات الطلاب أو الفيديوهات أو الدروس.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deleting}
                data-testid="confirm-delete-exam-btn"
                onClick={() => void handleConfirmDelete()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleting ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Exam Generator Modal */}
      {canManageExams && (
        <SmartExamGeneratorModal
          open={smartGeneratorOpen}
          catalog={catalog}
          onClose={() => setSmartGeneratorOpen(false)}
          onDraftSaved={async (examId, message) => {
            onToast(message);
            await loadExamsList();
            await openEditExam(examId, 'questions');
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
};
