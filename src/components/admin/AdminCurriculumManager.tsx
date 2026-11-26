import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Edit3,
  FileText,
  Film,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  Radio,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import type {
  CurriculumPlanRecord,
  CurriculumTaskType,
  CurriculumWeekStatus,
} from '../../lib/academicPlanEngine.ts';
import {
  AdminCard,
  AdminEmptyState,
  AdminMasterDetail,
  AdminPageHeader,
  AdminStatusBadge,
  type AdminTone,
} from './AdminUiPrimitives.tsx';

interface TrackOption {
  id: number;
  nameAr: string;
}

interface GradeOption {
  id: number;
  trackId: number;
  nameAr: string;
}

interface PlanListRow {
  id: number;
  titleAr: string;
  trackId: number;
  trackNameAr: string;
  gradeId: number;
  gradeNameAr: string;
  academicYearAr: string;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  actualWeeksCount: number;
  totalTasksCount: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
}

interface TeacherAdherenceSummary {
  enrolledStudentsCount: number;
  currentWeekNumber: number | null;
  currentWeekTitleAr: string | null;
  averageWeeklyCompletionPercent: number | null;
  fullyCompletedStudentsCount: number;
  studentsWithPendingRequiredCount: number;
}

interface CatalogResponse {
  units: Array<{ id: number; titleAr: string }>;
  lessons: Array<{ id: number; unitId: number; titleAr: string; hasPdf: boolean; pdfTitleAr: string }>;
  videos: Array<{ id: number; lessonId: number; titleAr: string; durationSec: number }>;
  homeworks: Array<{ id: number; titleAr: string; status: string; deadline: string | null }>;
  exams: Array<{ id: number; titleAr: string; isPublished: boolean; durationMinutes: number; startsAt: string | null; endsAt: string | null }>;
  courses: Array<{ id: number; titleAr: string }>;
  scheduleEvents: Array<{ id: number; titleAr: string; startsAt: string; endsAt: string | null }>;
}

interface AdminCurriculumManagerProps {
  tracks: TrackOption[];
  grades: GradeOption[];
}

const TASK_TYPE_META: Record<CurriculumTaskType, { labelAr: string; tone: AdminTone }> = {
  VIDEO: { labelAr: 'محاضرة فيديو', tone: 'blue' },
  HOMEWORK: { labelAr: 'واجب', tone: 'amber' },
  EXAM: { labelAr: 'امتحان', tone: 'rose' },
  PDF: { labelAr: 'مذكرة / PDF', tone: 'emerald' },
  COURSE: { labelAr: 'كورس', tone: 'purple' },
  LIVE_SESSION: { labelAr: 'حصة مباشرة', tone: 'purple' },
  CUSTOM: { labelAr: 'مهمة مراجعة', tone: 'slate' },
};

const WEEK_STATUS_META: Record<CurriculumWeekStatus, { label: string; tone: AdminTone }> = {
  PLANNED: { label: 'مخطط', tone: 'slate' },
  ACTIVE: { label: 'نشط حاليًا', tone: 'blue' },
  COMPLETED: { label: 'مكتمل', tone: 'emerald' },
  POSTPONED: { label: 'مؤجل', tone: 'amber' },
};

export const AdminCurriculumManager: React.FC<AdminCurriculumManagerProps> = ({
  tracks,
  grades,
}) => {
  const [plans, setPlans] = useState<PlanListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTrackId, setFilterTrackId] = useState<number>(0);
  const [filterGradeId, setFilterGradeId] = useState<number>(0);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [activePlan, setActivePlan] = useState<CurriculumPlanRecord | null>(null);
  const [adherence, setAdherence] = useState<TeacherAdherenceSummary | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Horizontal weekly timeline selection
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [taskCategoryTab, setTaskCategoryTab] = useState<'ALL' | 'CONTENT' | 'HOMEWORK' | 'EXAM'>('ALL');

  // Create plan form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [newTitle, setNewTitle] = useState('');
  const [newTrackId, setNewTrackId] = useState<number>(tracks[0]?.id || 0);
  const [newGradeId, setNewGradeId] = useState<number>(grades[0]?.id || 0);
  const [newYear, setNewYear] = useState('2026 / 2027');
  const [newStartDate, setNewStartDate] = useState(todayIso);
  const [newWeeksCount, setNewWeeksCount] = useState(12);
  const [newDescription, setNewDescription] = useState('');

  // Week editing & task creation state
  const [editingWeekId, setEditingWeekId] = useState<number | null>(null);
  const [weekDraft, setWeekDraft] = useState<{
    titleAr: string;
    startDate: string;
    endDate: string;
    status: CurriculumWeekStatus;
    objectivesAr: string;
    teacherNotesAr: string;
  } | null>(null);

  const [addingTaskOpen, setAddingTaskOpen] = useState(false);
  const [taskType, setTaskType] = useState<CurriculumTaskType>('VIDEO');
  const [taskEntityId, setTaskEntityId] = useState<string>('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskInstructions, setTaskInstructions] = useState('');
  const [taskRequired, setTaskRequired] = useState(true);
  const [taskDueAt, setTaskDueAt] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ plans: PlanListRow[] }>('/api/admin/curriculum');
      setPlans(res.plans || []);
      if (!selectedPlanId && res.plans.length > 0) {
        setSelectedPlanId(res.plans[0].id);
      }
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  const loadPlanDetail = useCallback(async (planId: number) => {
    setDetailLoading(true);
    try {
      const res = await apiRequest<{
        plan: CurriculumPlanRecord;
        adherenceSummary: TeacherAdherenceSummary;
      }>(`/api/admin/curriculum/${planId}`);
      setActivePlan(res.plan);
      setAdherence(res.adherenceSummary);
      const cat = await apiRequest<CatalogResponse>(
        `/api/admin/curriculum/catalog?gradeId=${res.plan.gradeId}`,
      );
      setCatalog(cat);
      setSelectedWeekId((prev) => {
        if (prev && res.plan.weeks.some((w) => w.id === prev)) return prev;
        const activeW = res.plan.weeks.find((w) => w.status === 'ACTIVE');
        return activeW?.id ?? res.plan.weeks[0]?.id ?? null;
      });
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (selectedPlanId) {
      void loadPlanDetail(selectedPlanId);
    } else {
      setActivePlan(null);
      setAdherence(null);
    }
  }, [selectedPlanId, loadPlanDetail]);

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (filterTrackId && p.trackId !== filterTrackId) return false;
      if (filterGradeId && p.gradeId !== filterGradeId) return false;
      return true;
    });
  }, [plans, filterTrackId, filterGradeId]);

  useEffect(() => {
    if (filteredPlans.length > 0 && !filteredPlans.some((p) => p.id === selectedPlanId)) {
      setSelectedPlanId(filteredPlans[0].id);
    }
  }, [filteredPlans, selectedPlanId]);

  const formFilteredGrades = newTrackId
    ? grades.filter((g) => g.trackId === newTrackId)
    : grades;

  const filterGrades = filterTrackId
    ? grades.filter((g) => g.trackId === filterTrackId)
    : grades;

  const selectedWeek = useMemo(() => {
    if (!activePlan) return null;
    return (
      activePlan.weeks.find((w) => w.id === selectedWeekId) ||
      activePlan.weeks[0] ||
      null
    );
  }, [activePlan, selectedWeekId]);

  const planMetrics = useMemo(() => {
    if (!activePlan) return null;
    let videosAndPdfs = 0;
    let homeworks = 0;
    let exams = 0;
    let totalTasks = 0;
    let completedWeeks = 0;
    let activeWeeks = 0;
    for (const w of activePlan.weeks) {
      if (w.status === 'COMPLETED') completedWeeks += 1;
      if (w.status === 'ACTIVE') activeWeeks += 1;
      for (const t of w.tasks) {
        totalTasks += 1;
        if (t.taskType === 'VIDEO' || t.taskType === 'PDF' || t.taskType === 'COURSE') {
          videosAndPdfs += 1;
        } else if (t.taskType === 'HOMEWORK' || t.taskType === 'CUSTOM' || t.taskType === 'LIVE_SESSION') {
          homeworks += 1;
        } else if (t.taskType === 'EXAM') {
          exams += 1;
        }
      }
    }
    const teacherPlanPercent =
      activePlan.weeks.length > 0
        ? Math.round((completedWeeks / activePlan.weeks.length) * 100)
        : 0;
    return {
      totalWeeks: activePlan.weeks.length,
      completedWeeks,
      activeWeeks,
      videosAndPdfs,
      homeworks,
      exams,
      totalTasks,
      teacherPlanPercent,
    };
  }, [activePlan]);

  const filteredWeekTasks = useMemo(() => {
    if (!selectedWeek) return [];
    return selectedWeek.tasks.filter((t) => {
      if (taskCategoryTab === 'ALL') return true;
      if (taskCategoryTab === 'CONTENT') {
        return t.taskType === 'VIDEO' || t.taskType === 'PDF' || t.taskType === 'COURSE';
      }
      if (taskCategoryTab === 'HOMEWORK') {
        return t.taskType === 'HOMEWORK' || t.taskType === 'CUSTOM' || t.taskType === 'LIVE_SESSION';
      }
      return t.taskType === 'EXAM';
    });
  }, [selectedWeek, taskCategoryTab]);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setCreating(true);
    try {
      const res = await apiRequest<{ plan: CurriculumPlanRecord; message: string }>(
        '/api/admin/curriculum',
        {
          method: 'POST',
          body: JSON.stringify({
            titleAr: newTitle.trim(),
            trackId: newTrackId,
            gradeId: newGradeId,
            academicYearAr: newYear.trim(),
            descriptionAr: newDescription.trim(),
            startDate: newStartDate,
            totalWeeks: newWeeksCount,
            status: 'DRAFT',
            autoGenerateWeeks: true,
          }),
        },
      );
      setNotice({ type: 'success', text: res.message });
      setShowCreateForm(false);
      setNewTitle('');
      setNewDescription('');
      await loadPlans();
      setSelectedPlanId(res.plan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleUpdatePlanStatus = async (status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') => {
    if (!activePlan) return;
    setSavingAction(true);
    setNotice(null);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/curriculum/${activePlan.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setNotice({ type: 'success', text: res.message });
      await Promise.all([loadPlans(), loadPlanDetail(activePlan.id)]);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeletePlan = async (id: number) => {
    setSavingAction(true);
    try {
      await apiRequest(`/api/admin/curriculum/${id}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: 'تم حذف خطة المنهج بنجاح' });
      setSelectedPlanId(null);
      await loadPlans();
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleSaveWeek = async (weekId: number) => {
    if (!weekDraft || !activePlan) return;
    setSavingAction(true);
    try {
      await apiRequest(`/api/admin/curriculum/weeks/${weekId}`, {
        method: 'PUT',
        body: JSON.stringify(weekDraft),
      });
      setEditingWeekId(null);
      setWeekDraft(null);
      setNotice({ type: 'success', text: 'تم تحديث بيانات الأسبوع بنجاح' });
      await loadPlanDetail(activePlan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleAddWeek = async () => {
    if (!activePlan) return;
    setSavingAction(true);
    try {
      const lastWeek = activePlan.weeks[activePlan.weeks.length - 1];
      const nextNum = (lastWeek?.weekNumber || 0) + 1;
      const baseDate = lastWeek?.endDate || activePlan.startDate;
      const startDt = new Date(`${baseDate}T00:00:00Z`);
      startDt.setUTCDate(startDt.getUTCDate() + (lastWeek ? 1 : 0));
      const endDt = new Date(startDt);
      endDt.setUTCDate(endDt.getUTCDate() + 6);
      await apiRequest(`/api/admin/curriculum/${activePlan.id}/weeks`, {
        method: 'POST',
        body: JSON.stringify({
          weekNumber: nextNum,
          titleAr: `الأسبوع ${nextNum}`,
          startDate: startDt.toISOString().slice(0, 10),
          endDate: endDt.toISOString().slice(0, 10),
          status: 'PLANNED',
        }),
      });
      setNotice({ type: 'success', text: 'تمت إضافة أسبوع جديد بنجاح' });
      await loadPlanDetail(activePlan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeleteWeek = async (weekId: number) => {
    if (!activePlan) return;
    setSavingAction(true);
    try {
      await apiRequest(`/api/admin/curriculum/weeks/${weekId}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: 'تم حذف الأسبوع من الخطة' });
      await loadPlanDetail(activePlan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleSelectTaskEntity = (val: string) => {
    setTaskEntityId(val);
    const idNum = Number(val);
    if (!catalog || !idNum) return;
    if (taskType === 'VIDEO') {
      const v = catalog.videos.find((x) => x.id === idNum);
      if (v && !taskTitle) setTaskTitle(v.titleAr);
    } else if (taskType === 'HOMEWORK') {
      const h = catalog.homeworks.find((x) => x.id === idNum);
      if (h) {
        if (!taskTitle) setTaskTitle(h.titleAr);
        if (h.deadline && !taskDueAt) setTaskDueAt(h.deadline.slice(0, 16));
      }
    } else if (taskType === 'EXAM') {
      const ex = catalog.exams.find((x) => x.id === idNum);
      if (ex) {
        if (!taskTitle) setTaskTitle(ex.titleAr);
        if (ex.endsAt && !taskDueAt) setTaskDueAt(ex.endsAt.slice(0, 16));
      }
    } else if (taskType === 'PDF') {
      const l = catalog.lessons.find((x) => x.id === idNum);
      if (l && !taskTitle) setTaskTitle(l.pdfTitleAr || l.titleAr);
    } else if (taskType === 'COURSE') {
      const c = catalog.courses.find((x) => x.id === idNum);
      if (c && !taskTitle) setTaskTitle(c.titleAr);
    } else if (taskType === 'LIVE_SESSION') {
      const s = catalog.scheduleEvents.find((x) => x.id === idNum);
      if (s && !taskTitle) setTaskTitle(s.titleAr);
    }
  };

  const handleAddTask = async (weekId: number) => {
    if (!activePlan || !taskTitle.trim()) {
      setNotice({ type: 'error', text: 'يرجى إدخال عنوان المهمة أولاً' });
      return;
    }
    setSavingAction(true);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/curriculum/weeks/${weekId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          taskType,
          entityId: taskEntityId ? Number(taskEntityId) : null,
          titleAr: taskTitle.trim(),
          instructionsAr: taskInstructions.trim(),
          isRequired: taskRequired,
          dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        }),
      });
      setAddingTaskOpen(false);
      setTaskEntityId('');
      setTaskTitle('');
      setTaskInstructions('');
      setTaskDueAt('');
      setTaskRequired(true);
      setNotice({ type: 'success', text: 'تمت إضافة المهمة للأسبوع بنجاح' });
      await loadPlanDetail(activePlan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!activePlan) return;
    setSavingAction(true);
    try {
      await apiRequest(`/api/admin/curriculum/tasks/${taskId}`, { method: 'DELETE' });
      await loadPlanDetail(activePlan.id);
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message });
    } finally {
      setSavingAction(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl" data-testid="admin-curriculum-manager">
      <AdminPageHeader
        title="خطة المنهج الدراسي"
        subtitle="إعداد وتنظيم خطة المنهج الأسبوعية وتوزيع الدروس والأنشطة ومتابعة التزام الطلاب."
        icon={<Calendar className="h-5 w-5" />}
        actions={
          <button
            type="button"
            data-testid="new-curriculum-plan-btn"
            onClick={() => {
              setNewTrackId(tracks[0]?.id || 0);
              const firstG = grades.find((g) => g.trackId === tracks[0]?.id) || grades[0];
              setNewGradeId(firstG?.id || 0);
              setShowCreateForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            <span>{showCreateForm ? 'إغلاق نموذج الإنشاء' : 'خطة جديدة'}</span>
          </button>
        }
      />

      {notice && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-xs font-bold ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="إغلاق التنبيه">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Compact Top Plan Selector Bar */}
      <AdminCard padding="sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-bold text-slate-500">المسار</label>
            <select
              value={filterTrackId}
              onChange={(e) => {
                setFilterTrackId(Number(e.target.value));
                setFilterGradeId(0);
              }}
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold text-slate-700 focus:border-[#2563EB] focus:bg-white focus:outline-none"
            >
              <option value={0}>كل المسارات</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-3">
            <label className="mb-1 block text-[11px] font-bold text-slate-500">الصف الدراسي</label>
            <select
              value={filterGradeId}
              onChange={(e) => setFilterGradeId(Number(e.target.value))}
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold text-slate-700 focus:border-[#2563EB] focus:bg-white focus:outline-none"
            >
              <option value={0}>كل الصفوف</option>
              {filterGrades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-4">
            <label className="mb-1 block text-[11px] font-bold text-slate-500">
              خطة المنهج المحددة ({filteredPlans.length})
            </label>
            <select
              value={selectedPlanId || ''}
              onChange={(e) => setSelectedPlanId(e.target.value ? Number(e.target.value) : null)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
            >
              {filteredPlans.length === 0 ? (
                <option value="">لا توجد خطط محفوظة</option>
              ) : (
                filteredPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titleAr} — {p.gradeNameAr} (
                    {p.status === 'PUBLISHED' ? 'منشورة' : p.status === 'ARCHIVED' ? 'مؤرشفة' : 'مسودة'})
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 lg:col-span-3">
            {activePlan && (
              <>
                {activePlan.status !== 'PUBLISHED' ? (
                  <button
                    type="button"
                    disabled={savingAction}
                    onClick={() => void handleUpdatePlanStatus('PUBLISHED')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>نشر الخطة</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={savingAction}
                    onClick={() => void handleUpdatePlanStatus('DRAFT')}
                    className="h-9 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
                  >
                    إعادة لمسودة
                  </button>
                )}
                <button
                  type="button"
                  disabled={savingAction}
                  onClick={() => void handleDeletePlan(activePlan.id)}
                  title="حذف خطة المنهج"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </AdminCard>

      {/* Create Plan Form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreatePlan}
          className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 text-sm font-extrabold text-[#0F172A]">
            <Sparkles className="h-4 w-4 text-[#2563EB]" />
            <span>إنشاء خطة منهج جديدة مع توليد تلقائي للأسابيع</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">اسم خطة المنهج *</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="مثال: خطة الفيزياء — الصف الثالث الثانوي"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">المسار الدراسي *</label>
              <select
                value={newTrackId}
                onChange={(e) => {
                  const tid = Number(e.target.value);
                  setNewTrackId(tid);
                  const match = grades.find((g) => g.trackId === tid);
                  if (match) setNewGradeId(match.id);
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الصف الدراسي *</label>
              <select
                value={newGradeId}
                onChange={(e) => setNewGradeId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
              >
                {formFilteredGrades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">العام / الفصل الدراسي</label>
              <input
                type="text"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">تاريخ بداية الخطة *</label>
              <input
                type="date"
                required
                value={newStartDate}
                onChange={(e) => setNewStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">عدد الأسابيع الدراسية *</label>
              <input
                type="number"
                min={1}
                max={52}
                required
                value={newWeeksCount}
                onChange={(e) => setNewWeeksCount(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-xs text-[#0F172A]"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">وصف مختصر للخطة</label>
            <textarea
              rows={2}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="أهداف الترم أو المنهج المقرّر للطلاب..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>حفظ وتوليد الأسابيع</span>
            </button>
          </div>
        </form>
      )}

      {/* Main Content */}
      {loading || detailLoading ? (
        <AdminCard className="flex items-center justify-center py-16 text-xs text-slate-500">
          <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#2563EB]" />
          <span>جارٍ تحميل خطة المنهج...</span>
        </AdminCard>
      ) : !activePlan ? (
        <AdminCard>
          <AdminEmptyState
            icon={<Calendar className="h-5 w-5" />}
            title="لا توجد خطة منهج محددة"
            description="أنشئ أول خطة منهج أسبوعية لربط الفيديوهات والواجبات والامتحانات بخطة الطالب."
          />
        </AdminCard>
      ) : (
        <AdminMasterDetail
          mainSpan="8"
          main={
            <div className="space-y-4">
              {/* Horizontal Weekly Timeline Strip */}
              <AdminCard padding="sm">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[#0F172A]">
                    الخط الزمني للأسابيع ({activePlan.weeks.length})
                  </span>
                  <button
                    type="button"
                    disabled={savingAction}
                    onClick={() => void handleAddWeek()}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#2563EB] hover:bg-blue-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة أسبوع</span>
                  </button>
                </div>

                <div className="flex items-stretch gap-2 overflow-x-auto pb-1.5">
                  {activePlan.weeks.map((week) => {
                    const isSelected = selectedWeek?.id === week.id;
                    const stMeta = WEEK_STATUS_META[week.status] || WEEK_STATUS_META.PLANNED;
                    return (
                      <button
                        key={week.id}
                        type="button"
                        onClick={() => {
                          setSelectedWeekId(week.id);
                          setEditingWeekId(null);
                          setAddingTaskOpen(false);
                        }}
                        className={`min-w-[132px] shrink-0 rounded-xl border px-3 py-2.5 text-right transition-all ${
                          isSelected
                            ? 'border-[#2563EB] bg-[#2563EB] text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50/70 text-[#0F172A] hover:border-blue-200 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-extrabold">الأسبوع {week.weekNumber}</span>
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isSelected
                                ? 'bg-white'
                                : stMeta.tone === 'emerald'
                                  ? 'bg-emerald-500'
                                  : stMeta.tone === 'blue'
                                    ? 'bg-[#2563EB]'
                                    : stMeta.tone === 'amber'
                                      ? 'bg-amber-500'
                                      : 'bg-slate-300'
                            }`}
                          />
                        </div>
                        <div
                          className={`mt-1 font-mono-num text-[10px] ${
                            isSelected ? 'text-blue-100' : 'text-slate-500'
                          }`}
                        >
                          {week.startDate}
                        </div>
                        <div
                          className={`mt-1 text-[10px] font-bold ${
                            isSelected ? 'text-white/90' : 'text-slate-600'
                          }`}
                        >
                          {week.tasks.length} مهام · {stMeta.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </AdminCard>

              {/* Selected Week Workspace */}
              {selectedWeek ? (
                <AdminCard padding="none" className="overflow-hidden">
                  {/* Week Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-extrabold text-[#0F172A]">
                          تفاصيل {selectedWeek.titleAr}
                        </h3>
                        <AdminStatusBadge
                          tone={(WEEK_STATUS_META[selectedWeek.status] || WEEK_STATUS_META.PLANNED).tone}
                        >
                          {(WEEK_STATUS_META[selectedWeek.status] || WEEK_STATUS_META.PLANNED).label}
                        </AdminStatusBadge>
                      </div>
                      <p className="mt-1 font-mono-num text-xs text-slate-500">
                        من {selectedWeek.startDate} إلى {selectedWeek.endDate}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingTaskOpen((v) => !v);
                          setTaskType('VIDEO');
                          setTaskEntityId('');
                          setTaskTitle('');
                          setTaskInstructions('');
                          setTaskDueAt('');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>إضافة مهمة</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWeekId(selectedWeek.id);
                          setWeekDraft({
                            titleAr: selectedWeek.titleAr,
                            startDate: selectedWeek.startDate,
                            endDate: selectedWeek.endDate,
                            status: selectedWeek.status,
                            objectivesAr: selectedWeek.objectivesAr || '',
                            teacherNotesAr: selectedWeek.teacherNotesAr || '',
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>تعديل الأسبوع</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteWeek(selectedWeek.id)}
                        className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100"
                        title="حذف الأسبوع"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Week Objectives & Notes */}
                  {(selectedWeek.objectivesAr || selectedWeek.teacherNotesAr) &&
                    editingWeekId !== selectedWeek.id && (
                      <div className="grid gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-xs sm:grid-cols-2">
                        {selectedWeek.objectivesAr && (
                          <div>
                            <span className="font-bold text-slate-500">أهداف الأسبوع: </span>
                            <span className="font-semibold text-[#0F172A]">
                              {selectedWeek.objectivesAr}
                            </span>
                          </div>
                        )}
                        {selectedWeek.teacherNotesAr && (
                          <div className="text-amber-900">
                            <span className="font-bold">ملاحظة الأستاذ: </span>
                            {selectedWeek.teacherNotesAr}
                          </div>
                        )}
                      </div>
                    )}

                  {/* Inline Week Edit Form */}
                  {editingWeekId === selectedWeek.id && weekDraft && (
                    <div className="border-b border-blue-100 bg-blue-50/40 p-5 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            عنوان الأسبوع
                          </label>
                          <input
                            type="text"
                            value={weekDraft.titleAr}
                            onChange={(e) => setWeekDraft({ ...weekDraft, titleAr: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            تاريخ البداية
                          </label>
                          <input
                            type="date"
                            value={weekDraft.startDate}
                            onChange={(e) => setWeekDraft({ ...weekDraft, startDate: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            تاريخ النهاية
                          </label>
                          <input
                            type="date"
                            value={weekDraft.endDate}
                            onChange={(e) => setWeekDraft({ ...weekDraft, endDate: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            حالة الأسبوع (تقدم الأستاذ)
                          </label>
                          <select
                            value={weekDraft.status}
                            onChange={(e) =>
                              setWeekDraft({
                                ...weekDraft,
                                status: e.target.value as CurriculumWeekStatus,
                              })
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          >
                            <option value="PLANNED">مخطط</option>
                            <option value="ACTIVE">نشط حاليًا</option>
                            <option value="COMPLETED">مكتمل</option>
                            <option value="POSTPONED">مؤجل</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            أهداف الأسبوع
                          </label>
                          <input
                            type="text"
                            value={weekDraft.objectivesAr}
                            onChange={(e) =>
                              setWeekDraft({ ...weekDraft, objectivesAr: e.target.value })
                            }
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-700">
                          ملاحظات الأستاذ الظاهرة للطلاب
                        </label>
                        <textarea
                          rows={2}
                          value={weekDraft.teacherNotesAr}
                          onChange={(e) =>
                            setWeekDraft({ ...weekDraft, teacherNotesAr: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWeekId(null);
                            setWeekDraft(null);
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          disabled={savingAction}
                          onClick={() => void handleSaveWeek(selectedWeek.id)}
                          className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white"
                        >
                          حفظ الأسبوع
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Add Task Drawer */}
                  {addingTaskOpen && (
                    <div className="border-b border-blue-100 bg-slate-50/90 p-5 space-y-3">
                      <div className="text-xs font-extrabold text-[#0F172A]">
                        إضافة مهمة جديدة إلى {selectedWeek.titleAr}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            نوع المهمة
                          </label>
                          <select
                            value={taskType}
                            onChange={(e) => {
                              setTaskType(e.target.value as CurriculumTaskType);
                              setTaskEntityId('');
                              setTaskTitle('');
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          >
                            <option value="VIDEO">محاضرة فيديو</option>
                            <option value="HOMEWORK">واجب</option>
                            <option value="EXAM">امتحان</option>
                            <option value="PDF">مذكرة / PDF</option>
                            <option value="COURSE">كورس</option>
                            <option value="LIVE_SESSION">حصة مباشرة / مراجعة</option>
                            <option value="CUSTOM">مهمة مراجعة مخصصة</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            ربط بمحتوى موجود بالمنصة
                          </label>
                          <select
                            value={taskEntityId}
                            onChange={(e) => handleSelectTaskEntity(e.target.value)}
                            disabled={taskType === 'CUSTOM'}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-100"
                          >
                            <option value="">— اختر العنصر المرتبط —</option>
                            {taskType === 'VIDEO' &&
                              catalog?.videos.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.titleAr}
                                </option>
                              ))}
                            {taskType === 'HOMEWORK' &&
                              catalog?.homeworks.map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.titleAr} ({h.status})
                                </option>
                              ))}
                            {taskType === 'EXAM' &&
                              catalog?.exams.map((ex) => (
                                <option key={ex.id} value={ex.id}>
                                  {ex.titleAr} ({ex.durationMinutes} د)
                                </option>
                              ))}
                            {taskType === 'PDF' &&
                              catalog?.lessons
                                .filter((l) => l.hasPdf)
                                .map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.pdfTitleAr || l.titleAr}
                                  </option>
                                ))}
                            {taskType === 'COURSE' &&
                              catalog?.courses.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.titleAr}
                                </option>
                              ))}
                            {taskType === 'LIVE_SESSION' &&
                              catalog?.scheduleEvents.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.titleAr}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            عنوان المهمة الظاهر للطالب *
                          </label>
                          <input
                            type="text"
                            value={taskTitle}
                            onChange={(e) => setTaskTitle(e.target.value)}
                            placeholder="مثال: مشاهدة محاضرة قانون أوم"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            موعد نهائي اختياري
                          </label>
                          <input
                            type="datetime-local"
                            value={taskDueAt}
                            onChange={(e) => setTaskDueAt(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={taskRequired}
                            onChange={(e) => setTaskRequired(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#2563EB]"
                          />
                          <span>مهمة إلزامية (تُحتسب ضمن نسبة الالتزام الأسبوعي)</span>
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAddingTaskOpen(false)}
                            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700"
                          >
                            إلغاء
                          </button>
                          <button
                            type="button"
                            disabled={savingAction}
                            onClick={() => void handleAddTask(selectedWeek.id)}
                            className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white"
                          >
                            إضافة المهمة
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Category Tabs inside Selected Week */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-5 pt-3">
                    {[
                      { id: 'ALL' as const, label: `كل المهام (${selectedWeek.tasks.length})` },
                      {
                        id: 'CONTENT' as const,
                        label: `الفيديوهات والمذكرات (${
                          selectedWeek.tasks.filter(
                            (t) =>
                              t.taskType === 'VIDEO' ||
                              t.taskType === 'PDF' ||
                              t.taskType === 'COURSE',
                          ).length
                        })`,
                      },
                      {
                        id: 'HOMEWORK' as const,
                        label: `الواجبات والأنشطة (${
                          selectedWeek.tasks.filter(
                            (t) =>
                              t.taskType === 'HOMEWORK' ||
                              t.taskType === 'CUSTOM' ||
                              t.taskType === 'LIVE_SESSION',
                          ).length
                        })`,
                      },
                      {
                        id: 'EXAM' as const,
                        label: `الامتحانات (${
                          selectedWeek.tasks.filter((t) => t.taskType === 'EXAM').length
                        })`,
                      },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setTaskCategoryTab(tab.id)}
                        className={`border-b-2 px-3 py-2 text-xs font-bold transition-colors ${
                          taskCategoryTab === tab.id
                            ? 'border-[#2563EB] text-[#2563EB]'
                            : 'border-transparent text-slate-500 hover:text-[#0F172A]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tasks Table */}
                  {filteredWeekTasks.length === 0 ? (
                    <div className="p-6">
                      <AdminEmptyState
                        icon={<Layers className="h-5 w-5" />}
                        title="لا توجد مهام في هذا القسم"
                        description="اضغط «إضافة مهمة» لربط درس فيديو أو مذكرة PDF أو واجب أو امتحان بهذا الأسبوع."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500">
                          <tr>
                            <th className="w-12 px-4 py-3">#</th>
                            <th className="px-4 py-3">عنوان المهمة</th>
                            <th className="px-4 py-3">نوع المحتوى</th>
                            <th className="px-4 py-3">الإلزامية</th>
                            <th className="px-4 py-3 text-left">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredWeekTasks.map((t, idx) => {
                            const meta = TASK_TYPE_META[t.taskType] || TASK_TYPE_META.CUSTOM;
                            return (
                              <tr key={t.id} className="hover:bg-slate-50/70">
                                <td className="px-4 py-3 font-mono-num font-bold text-slate-400">
                                  {idx + 1}
                                </td>
                                <td className="px-4 py-3 font-bold text-[#0F172A]">{t.titleAr}</td>
                                <td className="px-4 py-3">
                                  <AdminStatusBadge tone={meta.tone}>
                                    {t.taskType === 'VIDEO' && <Film className="h-3 w-3" />}
                                    {t.taskType === 'HOMEWORK' && <ClipboardList className="h-3 w-3" />}
                                    {t.taskType === 'EXAM' && <GraduationCap className="h-3 w-3" />}
                                    {t.taskType === 'PDF' && <FileText className="h-3 w-3" />}
                                    {t.taskType === 'COURSE' && <BookOpen className="h-3 w-3" />}
                                    {t.taskType === 'LIVE_SESSION' && <Radio className="h-3 w-3" />}
                                    <span>{meta.labelAr}</span>
                                  </AdminStatusBadge>
                                </td>
                                <td className="px-4 py-3">
                                  <AdminStatusBadge tone={t.isRequired ? 'blue' : 'slate'}>
                                    {t.isRequired ? 'إلزامي' : 'اختياري'}
                                  </AdminStatusBadge>
                                </td>
                                <td className="px-4 py-3 text-left">
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteTask(t.id)}
                                    className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50"
                                    title="حذف المهمة"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </AdminCard>
              ) : null}
            </div>
          }
          detail={
            <div className="space-y-4">
              {/* Plan Summary Card (Teacher Plan Progress) */}
              {planMetrics && (
                <AdminCard className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-extrabold text-[#0F172A]">ملخص الخطة</h3>
                    <AdminStatusBadge
                      tone={
                        activePlan.status === 'PUBLISHED'
                          ? 'emerald'
                          : activePlan.status === 'ARCHIVED'
                            ? 'slate'
                            : 'amber'
                      }
                    >
                      {activePlan.status === 'PUBLISHED'
                        ? 'منشورة'
                        : activePlan.status === 'ARCHIVED'
                          ? 'مؤرشفة'
                          : 'مسودة'}
                    </AdminStatusBadge>
                  </div>

                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">إجمالي الأسابيع</span>
                      <span className="font-mono-num font-extrabold text-[#0F172A]">
                        {planMetrics.totalWeeks} أسبوع
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">الفيديوهات والمذكرات</span>
                      <span className="font-mono-num font-extrabold text-[#0F172A]">
                        {planMetrics.videosAndPdfs}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">الواجبات والأنشطة</span>
                      <span className="font-mono-num font-extrabold text-[#0F172A]">
                        {planMetrics.homeworks}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">الامتحانات المخططة</span>
                      <span className="font-mono-num font-extrabold text-[#0F172A]">
                        {planMetrics.exams}
                      </span>
                    </div>
                  </div>

                  {/* Clearly labeled Teacher Plan Completion */}
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-600">تقدم خطة الأستاذ (أسابيع مكتملة)</span>
                      <span className="font-mono-num font-extrabold text-emerald-700">
                        {planMetrics.teacherPlanPercent}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${planMetrics.teacherPlanPercent}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {planMetrics.completedWeeks} مكتمل من {planMetrics.totalWeeks} أسبوع
                    </div>
                  </div>
                </AdminCard>
              )}

              {/* Student Adherence Card (Clearly Separated from Teacher Plan Progress) */}
              {adherence && (
                <AdminCard className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Users className="h-4 w-4 text-[#2563EB]" />
                    <h3 className="text-sm font-extrabold text-[#0F172A]">التزام الطلاب بالخطة</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <div className="text-[11px] text-slate-500">الطلاب النشطون</div>
                      <div className="mt-1 font-mono-num text-lg font-extrabold text-[#0F172A]">
                        {adherence.enrolledStudentsCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                      <div className="text-[11px] text-emerald-700">متوسط إنجاز الأسبوع</div>
                      <div className="mt-1 font-mono-num text-lg font-extrabold text-emerald-700">
                        {adherence.averageWeeklyCompletionPercent !== null
                          ? `${adherence.averageWeeklyCompletionPercent}%`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">الأسبوع الحالي</span>
                      <span className="font-bold text-[#0F172A]">
                        {adherence.currentWeekTitleAr || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-500">أتمّوا 100% من المهام</span>
                      <span className="font-mono-num font-extrabold text-[#2563EB]">
                        {adherence.fullyCompletedStudentsCount} / {adherence.enrolledStudentsCount}
                      </span>
                    </div>
                  </div>
                </AdminCard>
              )}
            </div>
          }
        />
      )}
    </div>
  );
};
