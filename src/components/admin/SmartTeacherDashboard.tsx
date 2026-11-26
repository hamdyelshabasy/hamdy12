import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpLeft,
  Atom,
  Bell,
  BookCheck,
  BookOpen,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock,
  GraduationCap,
  KeyRound,
  Library,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../../lib/api.ts';
import { PERMISSIONS, canAccessAdminTab, hasPermission } from '../../lib/permissions.ts';
import { buildAcademicStatTarget } from '../../lib/smartDashboardLinks.ts';
import type { AuthUser } from '../../types/lms.ts';
import type {
  AttentionTaskPriority,
  DashboardNavigationTarget,
  SmartDashboardResponse,
} from '../../types/smartDashboard.ts';
import type { AdminNotificationItem } from '../AdminDashboard.tsx';
import { AdminCard, AdminKpiCard, AdminKpiGrid, AdminStatusBadge } from './AdminUiPrimitives.tsx';

interface SmartTeacherDashboardProps {
  isActive?: boolean;
  currentUser?: AuthUser;
  notifications?: AdminNotificationItem[];
  onNotificationClick?: (n: AdminNotificationItem) => void;
  onNavigate: (target: DashboardNavigationTarget) => void;
  onPendingStudentsSync?: (count: number) => void;
}

const CAIRO_TZ = 'Africa/Cairo';

function formatCairoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TZ,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function formatCairoTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function getPriorityBadgeTone(priority: AttentionTaskPriority): 'rose' | 'amber' | 'slate' {
  if (priority === 'URGENT') return 'rose';
  if (priority === 'SOON') return 'amber';
  return 'slate';
}

export const SmartTeacherDashboard: React.FC<SmartTeacherDashboardProps> = ({
  isActive = true,
  currentUser,
  notifications = [],
  onNotificationClick,
  onNavigate,
  onPendingStudentsSync,
}) => {
  const [data, setData] = useState<SmartDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await apiRequest<SmartDashboardResponse>('/api/admin/smart-dashboard');
        setData(res);
        if (onPendingStudentsSync && res.summary.pendingStudents !== null) {
          onPendingStudentsSync(res.summary.pendingStudents.count);
        }
      } catch (err) {
        setError((err as Error).message || 'تعذر تحميل بيانات لوحة التحكم الذكية.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onPendingStudentsSync],
  );

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  const heroShortcuts = useMemo(() => {
    if (!data) return [];
    const items: Array<{
      id: string;
      label: string;
      icon: React.ReactNode;
      primary?: boolean;
      target: DashboardNavigationTarget;
    }> = [];

    const can = (perm: string) => (currentUser ? hasPermission(currentUser, perm) : false);
    const canTab = (tabId: DashboardNavigationTarget['tab']) =>
      currentUser ? canAccessAdminTab(currentUser, tabId) : true;

    if (can(PERMISSIONS.CONTENT_MANAGE)) {
      items.push({
        id: 'add-video',
        label: 'إضافة درس',
        icon: <Video className="h-4 w-4" />,
        primary: true,
        target: { tab: 'videos', videoAction: 'CREATE' },
      });
    }
    if (data.access.canManageExams) {
      items.push({
        id: 'create-exam',
        label: 'إنشاء امتحان',
        icon: <ClipboardCheck className="h-4 w-4" />,
        primary: items.length === 0,
        target: { tab: 'exams', examAction: 'CREATE_WIZARD' },
      });
    }
    if (data.access.canManageHomework) {
      items.push({
        id: 'create-homework',
        label: 'إضافة واجب',
        icon: <BookCheck className="h-4 w-4" />,
        target: { tab: 'homework', homeworkAction: 'CREATE' },
      });
    }
    if (can(PERMISSIONS.COURSES_MANAGE)) {
      items.push({
        id: 'create-course',
        label: 'إنشاء كورس',
        icon: <BookOpen className="h-4 w-4" />,
        target: { tab: 'courses', courseAction: 'CREATE' },
      });
    }
    if (can(PERMISSIONS.STUDENTS_MANAGE)) {
      items.push({
        id: 'add-student',
        label: 'إضافة طالب',
        icon: <UserPlus className="h-4 w-4" />,
        target: { tab: 'students', studentAction: 'CREATE' },
      });
    }
    if (canTab('announcements')) {
      items.push({
        id: 'add-announcement',
        label: 'إعلان جديد',
        icon: <Megaphone className="h-4 w-4" />,
        target: { tab: 'announcements', announcementAction: 'CREATE' },
      });
    }
    if (can(PERMISSIONS.CODES_MANAGE)) {
      items.push({
        id: 'codes',
        label: 'أكواد التفعيل',
        icon: <KeyRound className="h-4 w-4" />,
        target: { tab: 'codes' },
      });
    }
    if (canTab('curriculum') && items.length < 6) {
      items.push({
        id: 'curriculum',
        label: 'خطة المنهج',
        icon: <Calendar className="h-4 w-4" />,
        target: { tab: 'curriculum' },
      });
    }
    if (items.length === 0 && data.quickActions.length > 0) {
      for (const qa of data.quickActions.slice(0, 4)) {
        items.push({
          id: qa.id,
          label: qa.labelAr,
          icon: <ArrowUpLeft className="h-4 w-4" />,
          primary: qa.accent === 'primary',
          target: qa.target,
        });
      }
    }
    return items.slice(0, 6);
  }, [data, currentUser]);

  const gradeChartData = useMemo(() => {
    if (!data?.academicStats.studentsByGrade) return [];
    return data.academicStats.studentsByGrade.map((item) => ({
      ...item,
      shortName: item.gradeNameAr
        .replace(/^الصف\s+/, '')
        .replace('الأول بكالوريا', '1 بكالوريا')
        .replace('الثاني بكالوريا', '2 بكالوريا')
        .replace('الثالث بكالوريا', '3 بكالوريا')
        .replace('الأول الثانوي الأزهري', '1 أزهري')
        .replace('الثاني الثانوي الأزهري', '2 أزهري')
        .replace('الثالث الثانوي الأزهري', '3 أزهري')
        .replace('الأول الأزهري', '1 أزهري')
        .replace('الثاني الأزهري', '2 أزهري')
        .replace('الثالث الأزهري', '3 أزهري')
        .replace('الأول الثانوي', '1 ث')
        .replace('الثاني الثانوي', '2 ث')
        .replace('الثالث الثانوي', '3 ث'),
    }));
  }, [data?.academicStats.studentsByGrade]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="جاري تحميل لوحة التحكم الذكية">
        <div className="h-40 animate-pulse rounded-2xl bg-[#0D172B]/90" />
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white lg:col-span-4" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white lg:col-span-5" />
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <AdminCard className="p-8 text-center">
        <AlertCircle className="mx-auto h-9 w-9 text-rose-600" />
        <h2 className="mt-3 text-base font-extrabold text-[#0F172A]">
          تعذر تحميل لوحة التحكم الذكية
        </h2>
        <p className="mt-1.5 text-xs text-slate-600">
          {error || 'حدث خطأ غير متوقع أثناء جلب المؤشرات التشغيلية.'}
        </p>
        <button
          type="button"
          onClick={() => void loadDashboard(false)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>إعادة المحاولة</span>
        </button>
      </AdminCard>
    );
  }

  const { summary, academicStats } = data;
  const gradingTotal =
    (summary.homeworkAwaitingGrading?.awaitingCount ?? 0) +
    (summary.examsAwaitingGrading?.awaitingAttemptsCount ?? 0);

  // Build up to 4 primary top KPI cards strictly from authorized real SQL aggregates (zero invented stats)
  const topKpis: Array<{
    id: string;
    label: string;
    value: number;
    subtitle: string;
    tone: 'blue' | 'emerald' | 'amber' | 'purple';
    icon: React.ReactNode;
    target: DashboardNavigationTarget;
  }> = [];

  if (summary.totalStudents !== null) {
    topKpis.push({
      id: 'total-students',
      label: 'إجمالي الطلاب',
      value: summary.totalStudents.totalStudents,
      subtitle:
        academicStats.recentRegistrations30d !== null
          ? `تسجيلات آخر 30 يومًا: ${academicStats.recentRegistrations30d}`
          : 'جميع الحسابات المسجلة',
      tone: 'blue',
      icon: <GraduationCap className="h-5 w-5" />,
      target: { tab: 'students', studentStatusFilter: 'ALL' },
    });
    topKpis.push({
      id: 'active-students',
      label: 'الطلاب النشطون',
      value: summary.totalStudents.activeStudents,
      subtitle:
        academicStats.executiveOverview !== null
          ? `جلسات نشطة الآن: ${academicStats.executiveOverview.onlineNow}`
          : 'حسابات مفعّلة ومعتمدة',
      tone: 'emerald',
      icon: <Users className="h-5 w-5" />,
      target: { tab: 'students', studentStatusFilter: 'ACTIVE' },
    });
  }

  if (summary.pendingStudents !== null) {
    topKpis.push({
      id: 'pending-students',
      label: 'طلبات الانضمام الجديدة',
      value: summary.pendingStudents.count,
      subtitle:
        summary.pendingStudents.count > 0
          ? `تحتاج مراجعة (${summary.pendingStudents.recent7dCount} خلال 7 أيام)`
          : 'لا توجد طلبات معلّقة',
      tone: 'amber',
      icon: <UserCheck className="h-5 w-5" />,
      target: { tab: 'students', studentStatusFilter: 'PENDING_APPROVAL' },
    });
  }

  if (summary.homeworkAwaitingGrading !== null || summary.examsAwaitingGrading !== null) {
    topKpis.push({
      id: 'awaiting-grading',
      label: 'تصحيحات بانتظار المراجعة',
      value: gradingTotal,
      subtitle: `واجبات: ${summary.homeworkAwaitingGrading?.awaitingCount ?? 0} · امتحانات: ${
        summary.examsAwaitingGrading?.awaitingAttemptsCount ?? 0
      }`,
      tone: 'purple',
      icon: <BookCheck className="h-5 w-5" />,
      target:
        (summary.homeworkAwaitingGrading?.awaitingCount ?? 0) >=
        (summary.examsAwaitingGrading?.awaitingAttemptsCount ?? 0)
          ? { tab: 'homework', homeworkStatusFilter: 'PUBLISHED' }
          : { tab: 'exams' },
    });
  } else if (summary.examsAndDrafts !== null) {
    topKpis.push({
      id: 'exams-drafts',
      label: 'الامتحانات النشطة',
      value: summary.examsAndDrafts.totalActiveExams,
      subtitle: `منشور/مجدول: ${summary.examsAndDrafts.publishedOrScheduledCount} · مسودات: ${summary.examsAndDrafts.draftCount}`,
      tone: 'purple',
      icon: <ClipboardCheck className="h-5 w-5" />,
      target: { tab: 'exams' },
    });
  }

  if (topKpis.length < 4 && summary.questionBankPending !== null) {
    topKpis.push({
      id: 'qb-pending',
      label: data.access.canSeeQuestionBankPendingReview
        ? 'أسئلة بانتظار الاعتماد'
        : 'أسئلتي المعادة للتعديل',
      value: data.access.canSeeQuestionBankPendingReview
        ? summary.questionBankPending.pendingReviewCount
        : summary.questionBankPending.myReturnedCount,
      subtitle: 'بنك الأسئلة المركزي',
      tone: 'blue',
      icon: <Library className="h-5 w-5" />,
      target: {
        tab: 'question_bank',
        questionBankStatusTab: data.access.canSeeQuestionBankPendingReview
          ? 'PENDING_REVIEW'
          : 'RETURNED',
      },
    });
  }

  const upcomingRows: Array<{
    id: string;
    kind: 'exam' | 'homework';
    title: string;
    meta: string;
    when: string;
    badge: string;
    target: DashboardNavigationTarget;
  }> = [];

  for (const ex of data.upcoming.exams ?? []) {
    upcomingRows.push({
      id: `exam-${ex.id}`,
      kind: 'exam',
      title: ex.titleAr,
      meta: `${ex.gradeNameAr} · ${ex.durationMin} دقيقة`,
      when: formatCairoShort(ex.startsAtIso),
      badge: ex.publicationStatusLabelAr,
      target: { tab: 'exams' },
    });
  }
  for (const hw of data.upcoming.homework ?? []) {
    upcomingRows.push({
      id: `hw-${hw.id}`,
      kind: 'homework',
      title: hw.titleAr,
      meta: `${hw.gradeNameAr} · ${hw.submittedCount} تسليم`,
      when: formatCairoShort(hw.deadlineIso),
      badge: hw.publicationStatusLabelAr,
      target: { tab: 'homework' },
    });
  }

  return (
    <div className="space-y-5" data-testid="smart-teacher-dashboard">
      {/* 1. Deep Navy Physics Hero Banner (Ref 01) */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-[#0B1528] via-[#102247] to-[#17336D] p-5 text-white shadow-[0_10px_28px_rgba(13,23,43,0.16)] sm:p-6">
        {/* Subtle Decorative Physics Atom Graphic */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-8 top-1/2 -translate-y-1/2 opacity-20"
        >
          <div className="relative flex h-44 w-44 items-center justify-center rounded-full border border-sky-300/30 bg-sky-400/10">
            <div className="h-32 w-32 rounded-full border border-blue-300/30" />
            <Atom className="absolute h-20 w-20 text-sky-300" />
          </div>
        </div>

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-blue-100">
                <ShieldCheck className="h-3.5 w-3.5 text-sky-300" />
                <span>{data.roleNameAr}</span>
                <span className="text-white/30">·</span>
                <span className="font-mono-num">
                  آخر تحديث {formatCairoTimeOnly(data.generatedAtIso)}
                </span>
              </div>
              <h2 className="mt-2.5 font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                مرحباً بك {data.userFullName}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-blue-100/85 sm:text-sm">
                إدارة متكاملة لطلابك، محتواك، امتحاناتك وتقاريرك الأكاديمية من مكان واحد.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              disabled={refreshing}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'جاري التحديث...' : 'تحديث المؤشرات'}</span>
            </button>
          </div>

          {/* Role-Aware Quick Shortcut Buttons */}
          {heroShortcuts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5" data-testid="quick-actions-section">
              {heroShortcuts.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  data-testid={`quick-action-${btn.id}`}
                  onClick={() => onNavigate(btn.target)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all ${
                    btn.primary
                      ? 'bg-[#2563EB] text-white shadow-[0_6px_16px_rgba(37,99,235,0.45)] hover:bg-[#1D4ED8]'
                      : 'bg-white text-[#0F172A] shadow-sm hover:bg-blue-50 hover:text-[#2563EB]'
                  }`}
                >
                  <span className={btn.primary ? 'text-white' : 'text-[#2563EB]'}>{btn.icon}</span>
                  <span>{btn.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. Top 4 Clean Tinted KPI Cards (Strictly Real SQL Aggregates) */}
      {topKpis.length > 0 && (
        <section aria-label="ملخص المؤشرات اليومية">
          <AdminKpiGrid cols={topKpis.length >= 4 ? 4 : topKpis.length === 3 ? 3 : 2}>
            {topKpis.map((kpi) => (
              <AdminKpiCard
                key={kpi.id}
                testId={`summary-card-${kpi.id}`}
                label={kpi.label}
                value={kpi.value.toLocaleString('en-US')}
                subtitle={kpi.subtitle}
                icon={kpi.icon}
                tone={kpi.tone}
                onClick={() => onNavigate(kpi.target)}
              />
            ))}
          </AdminKpiGrid>
        </section>
      )}

      {/* 3. Middle 3-Column Row: Urgent Tasks + Academic Activity Chart + Live Notifications */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Urgent Tasks Queue */}
        <AdminCard padding="none" className="xl:col-span-4" >
          <div
            data-testid="attention-tasks-section"
            className="flex h-full flex-col"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-[#0F172A]">مهام عاجلة</h3>
                  <p className="text-[11px] text-slate-500">مرتّبة تلقائيًا حسب الأولوية</p>
                </div>
              </div>
              <AdminStatusBadge tone={data.attentionTasks.length > 0 ? 'amber' : 'emerald'}>
                <span className="font-mono-num">{data.attentionTasks.length}</span> مهمة
              </AdminStatusBadge>
            </div>

            {data.attentionTasks.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                <div className="mt-2.5 text-sm font-extrabold text-[#0F172A]">
                  لا توجد مهام عاجلة حاليًا
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  جميع الطلبات والتصحيحات ضمن نطاق صلاحياتك مكتملة حاليًا.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.attentionTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    data-testid={`attention-task-${task.id}`}
                    onClick={() => onNavigate(task.target)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-right transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AdminStatusBadge tone={getPriorityBadgeTone(task.priority)}>
                          {task.priorityLabelAr}
                        </AdminStatusBadge>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {task.categoryAr}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs font-extrabold text-[#0F172A]">
                        {task.titleAr}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                        {task.descriptionAr}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="flex h-7 min-w-[28px] items-center justify-center rounded-lg bg-slate-100 px-2 font-mono-num text-xs font-extrabold text-[#0F172A] tabular-nums">
                        {task.count}
                      </span>
                      <ChevronLeft className="h-4 w-4 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </AdminCard>

        {/* Real Academic Statistics & Students Distribution Chart */}
        <AdminCard padding="md" className="xl:col-span-5">
          <div data-testid="academic-stats-section" className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  الإحصائيات الأكاديمية وتوزيع الطلاب
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  بيانات فعلية من سجلات المنصة والصفوف الدراسية
                </p>
              </div>
              {academicStats.recentRegistrations30d !== null && (
                <AdminStatusBadge tone="blue">
                  آخر 30 يومًا: {academicStats.recentRegistrations30d} طالب
                </AdminStatusBadge>
              )}
            </div>

            {/* Real Academic Counter Strip */}
            <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {academicStats.homeworkTotals !== null && (() => {
                const target = buildAcademicStatTarget('homework_submissions', currentUser);
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-[11px] font-semibold leading-snug text-slate-600 transition-colors group-hover:text-[#0F172A]">
                        تسليمات الواجبات
                      </span>
                      {target && (
                        <ArrowUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#2563EB]" />
                      )}
                    </div>
                    <div className="mt-2">
                      <div className="font-mono-num text-xl font-extrabold text-[#0F172A] tabular-nums">
                        {academicStats.homeworkTotals.submittedCount}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        مصحح: {academicStats.homeworkTotals.gradedPublishedCount} · نشط:{' '}
                        {academicStats.homeworkTotals.activeAssignments}
                      </div>
                    </div>
                  </>
                );
                return target ? (
                  <button
                    type="button"
                    data-testid="academic-stat-homework-submissions"
                    aria-label="عرض تسليمات الواجبات"
                    onClick={() => onNavigate(target)}
                    className="group flex cursor-pointer flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-right transition-all hover:border-blue-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 active:scale-[0.98]"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    data-testid="academic-stat-homework-submissions"
                    className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"
                  >
                    {content}
                  </div>
                );
              })()}
              {academicStats.examTotals !== null && (() => {
                const target = buildAcademicStatTarget('exam_attempts', currentUser);
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-[11px] font-semibold leading-snug text-slate-600 transition-colors group-hover:text-[#1D4ED8]">
                        محاولات الامتحانات
                      </span>
                      {target && (
                        <ArrowUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#2563EB]" />
                      )}
                    </div>
                    <div className="mt-2">
                      <div className="font-mono-num text-xl font-extrabold text-[#2563EB] tabular-nums">
                        {academicStats.examTotals.submittedAttempts}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {academicStats.examTotals.averagePublishedScorePercent !== null
                          ? `متوسط الدرجات: ${academicStats.examTotals.averagePublishedScorePercent}%`
                          : `محاولات مصححة: ${academicStats.examTotals.gradedAttempts}`}
                      </div>
                    </div>
                  </>
                );
                return target ? (
                  <button
                    type="button"
                    data-testid="academic-stat-exam-attempts"
                    aria-label="عرض محاولات الامتحانات"
                    onClick={() => onNavigate(target)}
                    className="group flex cursor-pointer flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-right transition-all hover:border-blue-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 active:scale-[0.98]"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    data-testid="academic-stat-exam-attempts"
                    className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"
                  >
                    {content}
                  </div>
                );
              })()}
              {academicStats.questionBankTotals !== null && (() => {
                const target = buildAcademicStatTarget('approved_questions', currentUser);
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-[11px] font-semibold leading-snug text-slate-600 transition-colors group-hover:text-emerald-800">
                        أسئلة معتمدة
                      </span>
                      {target && (
                        <ArrowUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-emerald-600" />
                      )}
                    </div>
                    <div className="mt-2">
                      <div className="font-mono-num text-xl font-extrabold text-emerald-700 tabular-nums">
                        {academicStats.questionBankTotals.approvedCount}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        إجمالي النشط: {academicStats.questionBankTotals.totalActiveCount}
                      </div>
                    </div>
                  </>
                );
                return target ? (
                  <button
                    type="button"
                    data-testid="academic-stat-approved-questions"
                    aria-label="عرض الأسئلة المعتمدة في بنك الأسئلة"
                    onClick={() => onNavigate(target)}
                    className="group flex cursor-pointer flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-right transition-all hover:border-emerald-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 active:scale-[0.98]"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    data-testid="academic-stat-approved-questions"
                    className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"
                  >
                    {content}
                  </div>
                );
              })()}
            </div>

            {/* Grade Distribution BarChart — mounts only while isActive is true to prevent 0x0 Recharts warning */}
            {gradeChartData.length > 0 && (
              <div className="mt-4 flex-1">
                <div className="mb-2 text-xs font-bold text-slate-700">
                  توزيع الطلاب حسب الصفوف الدراسية
                </div>
                <div className="h-52 w-full" dir="ltr">
                  {isActive && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={gradeChartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis
                          dataKey="shortName"
                          minTickGap={6}
                          tick={{ fontSize: 10, fill: '#475569' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          width={34}
                          tick={{ fontSize: 10, fill: '#64748B' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid #E2E8F0',
                            fontSize: 12,
                          }}
                          formatter={(value: unknown) => [`${value} طالب`, 'الطلاب']}
                        />
                        <Bar
                          dataKey="studentsCount"
                          name="الطلاب"
                          fill="#2563EB"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={42}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {/* Executive Financial Strip — SUPER_ADMIN / REPORTS_VIEW only */}
            {academicStats.executiveOverview !== null && (
              <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-slate-100 pt-3.5">
                <div>
                  <div className="text-[11px] text-slate-500">الإيرادات المؤكدة</div>
                  <div className="mt-0.5 font-mono-num text-sm font-extrabold text-emerald-700 tabular-nums">
                    {academicStats.executiveOverview.totalRevenueEgp.toLocaleString('en-US')} ج.م
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">الاشتراكات النشطة</div>
                  <div className="mt-0.5 font-mono-num text-sm font-extrabold text-[#0F172A] tabular-nums">
                    {academicStats.executiveOverview.activeSubscriptions}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">الجلسات النشطة</div>
                  <div className="mt-0.5 font-mono-num text-sm font-extrabold text-[#2563EB] tabular-nums">
                    {academicStats.executiveOverview.onlineNow}
                  </div>
                </div>
              </div>
            )}
          </div>
        </AdminCard>

        {/* Live Actionable Notifications Panel (Ref 01 left card) */}
        <AdminCard padding="none" className="xl:col-span-3">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
                  <Bell className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-extrabold text-[#0F172A]">إشعارات وتنبيهات</h3>
              </div>
              {notifications.filter((n) => !n.isRead).length > 0 && (
                <AdminStatusBadge tone="rose">
                  {notifications.filter((n) => !n.isRead).length} جديد
                </AdminStatusBadge>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
                <Bell className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  لا توجد إشعارات جديدة حاليًا.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.slice(0, 5).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onNotificationClick?.(n)}
                    className={`flex w-full items-start gap-2.5 px-4 py-3 text-right transition-colors hover:bg-slate-50 ${
                      n.isRead ? '' : 'bg-blue-50/35'
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.isRead ? 'bg-slate-300' : 'bg-[#2563EB]'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-[#0F172A]">{n.titleAr}</div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{n.bodyAr}</p>
                      <div className="mt-1 font-mono-num text-[10px] text-slate-400">
                        {formatCairoShort(n.createdAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </AdminCard>
      </section>

      {/* 4. Bottom Row: Recent Platform Activity + Upcoming Exams & Homework (Strictly Real Data) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Recent Platform Activity */}
        <AdminCard
          padding="none"
          className={
            data.upcoming.exams !== null || data.upcoming.homework !== null
              ? 'lg:col-span-7'
              : 'lg:col-span-12'
          }
        >
          <div data-testid="recent-activity-section">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A]">أحدث الأنشطة في المنصة</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  آخر العمليات المسجلة ضمن نطاق صلاحياتك
                </p>
              </div>
              <span className="font-mono-num text-xs font-bold text-slate-400 tabular-nums">
                {data.recentActivity.length}
              </span>
            </div>

            {data.recentActivity.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-slate-500">
                لا توجد نشاطات حديثة مسجلة بعد ضمن نطاق صلاحياتك.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentActivity.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-xs transition-colors hover:bg-slate-50/70"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#0F172A]">{item.titleAr}</div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {item.categoryLabelAr} · {item.subtitleAr}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-mono-num text-[11px] text-slate-400 tabular-nums">
                        {formatCairoShort(item.occurredAtIso)}
                      </span>
                      {item.target && (
                        <button
                          type="button"
                          onClick={() => onNavigate(item.target!)}
                          className="text-[11px] font-bold text-[#2563EB] hover:underline"
                        >
                          فتح القسم
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AdminCard>

        {/* Upcoming Exams & Homework Deadlines (7 Days, Africa/Cairo) */}
        {(data.upcoming.exams !== null || data.upcoming.homework !== null) && (
          <AdminCard padding="none" className="lg:col-span-5">
            <div data-testid="upcoming-7d-section">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-[#7C3AED]">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-extrabold text-[#0F172A]">
                      المواعيد القادمة ({data.upcomingWindowDays} أيام)
                    </h3>
                    <p className="text-[11px] text-slate-500">بتوقيت القاهرة (Africa/Cairo)</p>
                  </div>
                </div>
                {currentUser && canAccessAdminTab(currentUser, 'groups') && (
                  <button
                    type="button"
                    onClick={() => onNavigate({ tab: 'groups' })}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#2563EB] hover:underline"
                  >
                    <span>الجدول</span>
                    <ArrowUpLeft className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {upcomingRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
                  <Clock className="h-7 w-7 text-slate-300" />
                  <p className="mt-2 text-xs text-slate-500">
                    لا توجد امتحانات أو واجبات مجدولة خلال الأيام السبعة القادمة.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 p-4">
                  {upcomingRows.slice(0, 5).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onNavigate(row.target)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-right transition-colors hover:border-blue-200 hover:bg-blue-50/40"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            row.kind === 'exam'
                              ? 'bg-violet-100 text-[#7C3AED]'
                              : 'bg-blue-100 text-[#2563EB]'
                          }`}
                        >
                          {row.kind === 'exam' ? (
                            <ClipboardCheck className="h-4 w-4" />
                          ) : (
                            <BookCheck className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-extrabold text-[#0F172A]">
                            {row.title}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {row.meta}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-left">
                        <AdminStatusBadge tone={row.kind === 'exam' ? 'purple' : 'blue'}>
                          {row.badge}
                        </AdminStatusBadge>
                        <div className="mt-1 font-mono-num text-[10px] font-semibold text-slate-500 tabular-nums">
                          {row.when}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </AdminCard>
        )}
      </section>
    </div>
  );
};
