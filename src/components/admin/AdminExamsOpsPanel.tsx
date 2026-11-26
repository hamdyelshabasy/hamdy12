import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Atom,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  List,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Table2,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../lib/api.ts';
import { PERMISSIONS, hasAnyPermission, hasPermission } from '../../lib/permissions.ts';
import {
  computeTableScrollMetrics,
  getScheduleRowStaggerMs,
  INITIAL_TABLE_SCROLL_METRICS,
  type TableScrollMetrics,
} from '../../lib/tableScrollMotion.ts';
import type { AuthUser, PlatformSettings } from '../../types/lms.ts';
import { MathFormula } from '../MathFormula.tsx';
import { ActiveDevicesPanel } from '../ActiveDevicesPanel.tsx';
import type { AdminCatalogData } from './AdminContentPanel.tsx';
import { AdminStaffPanel, type StaffMemberItem } from './AdminStaffPanel.tsx';
import {
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMasterDetail,
  AdminPageHeader,
  AdminSegmentedTabs,
  AdminStatusBadge,
} from './AdminUiPrimitives.tsx';

interface ExamsSuiteData {
  exams: Array<{
    id: number;
    gradeId: number;
    titleAr: string;
    examType: string;
    durationMin: number;
    maxAttempts: number;
    passScorePercent: number;
    isPublished: boolean;
  }>;
  questions: Array<{
    id: number;
    gradeId: number;
    questionType: string;
    difficulty: string;
    promptAr: string;
    latexFormula: string | null;
    points: number;
    choices: Array<{ id: number; labelAr: string; isCorrect: boolean }>;
  }>;
  gradingQueue: Array<{
    answerId: number;
    attemptId: number;
    examTitleAr: string;
    studentName: string;
    questionPromptAr: string;
    maxPoints: number;
    modelAnswerAr: string;
    textAnswer: string | null;
    uploadedFileName: string | null;
  }>;
}

interface OperationsData {
  groups: Array<{
    id: number;
    gradeId: number;
    nameAr: string;
    scheduleTextAr: string;
    descriptionAr: string;
    memberCount: number;
  }>;
  schedules: Array<{
    id: number;
    gradeId: number;
    groupId: number | null;
    titleAr: string;
    descriptionAr: string;
    scheduledAt: string;
    durationMin: number;
    sessionType: string;
    liveProvider: string;
    joinUrl: string;
    isPublished: boolean;
  }>;
  comments: Array<{
    id: number;
    authorName: string;
    lessonTitleAr: string;
    bodyAr: string;
    replyAr: string | null;
    status: string;
    createdAt: string;
  }>;
  staff: StaffMemberItem[];
  roles: Array<{ id: number; slug: string; nameAr: string }>;
  auditLogs: Array<{
    id: number;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
}

interface AdminExamsOpsPanelProps {
  section: 'exams' | 'operations';
  activeSection?: 'groups' | 'communications' | 'settings' | 'staff' | 'audit' | 'operations';
  catalog: AdminCatalogData;
  settings: PlatformSettings;
  currentUser: AuthUser;
  onRefreshBootstrap: () => Promise<void>;
  onToast: (msg: string) => void;
  onLogout?: () => Promise<void>;
  onPreviewStudentPortal?: () => void;
  initialOpsSubTab?: 'groups' | 'comms' | 'devices' | 'cms' | 'security';
  navigationNonce?: number;
}

const ROLE_SUMMARY_CARDS: Array<{ slug: string; title: string; badgeTone: 'blue' | 'purple' | 'emerald'; desc: string }> = [
  {
    slug: 'TEACHING_ASSISTANT',
    title: 'مساعد مدرس',
    badgeTone: 'blue',
    desc: 'مراجعة طلبات الطلاب، إضافة أسئلة للمراجعة، تصحيح الامتحانات والواجبات، الرد على تعليقات الطلاب، وإدارة المجموعات.',
  },
  {
    slug: 'CONTENT_MANAGER',
    title: 'مدير محتوى',
    badgeTone: 'purple',
    desc: 'إدارة المسارات والصفوف والدروس والفيديوهات والكورسات والامتحانات وبنك الأسئلة والواجبات وجدولة الحصص المباشرة.',
  },
  {
    slug: 'SUPPORT',
    title: 'دعم فني',
    badgeTone: 'emerald',
    desc: 'عرض بيانات الطلاب للقراءة، إدارة أجهزة وجلسات الطلاب (إنهاء/حظر/فك حظر)، وعرض الطلبات والأكواد للقراءة فقط.',
  },
];

const PROVIDER_META: Record<string, { label: string; tone: 'blue' | 'emerald' | 'rose' | 'slate' }> = {
  ZOOM: { label: 'Zoom', tone: 'blue' },
  GOOGLE_MEET: { label: 'Google Meet', tone: 'emerald' },
  MEET: { label: 'Google Meet', tone: 'emerald' },
  YOUTUBE_UNLISTED: { label: 'YouTube Live', tone: 'rose' },
  YOUTUBE_LIVE: { label: 'YouTube Live', tone: 'rose' },
  CUSTOM: { label: 'رابط مخصص', tone: 'slate' },
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  LIVE: 'حصة مباشرة',
  REVISION: 'ورشة مراجعة',
  RECORDED: 'محاضرة مسجلة',
};

function toDateTimeLocalValue(iso: string | Date): string {
  const dt = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

const CAIRO_WEEKDAY_LABELS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

function getCairoDayName(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      weekday: 'long',
    }).format(new Date(iso));
  } catch {
    return 'أخرى';
  }
}

function getCairoTimeStr(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function getCairoShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export const AdminExamsOpsPanel: React.FC<AdminExamsOpsPanelProps> = ({
  section,
  activeSection,
  catalog,
  settings,
  currentUser,
  onRefreshBootstrap,
  onToast,
  onLogout,
  onPreviewStudentPortal,
  initialOpsSubTab,
  navigationNonce,
}) => {
  const canGroups = hasPermission(currentUser, PERMISSIONS.GROUPS_MANAGE);
  const canSchedules = hasPermission(currentUser, PERMISSIONS.SCHEDULE_MANAGE);
  const canComments = hasPermission(currentUser, PERMISSIONS.COMMENTS_MODERATE);
  const canBroadcast = hasPermission(currentUser, PERMISSIONS.NOTIFICATIONS_SEND);
  const canCms = hasPermission(currentUser, PERMISSIONS.SETTINGS_MANAGE);
  const canStaff = hasPermission(currentUser, PERMISSIONS.STAFF_MANAGE);
  const canBackups = hasPermission(currentUser, PERMISSIONS.BACKUPS_MANAGE);
  const canAudit = hasPermission(currentUser, PERMISSIONS.AUDIT_VIEW);
  const canSecurityTab = hasAnyPermission(currentUser, [
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.BACKUPS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
  ]);

  const visibleOpsSubTabs: Array<{ id: 'groups' | 'comms' | 'devices' | 'cms' | 'security'; label: string }> = [
    ...(canGroups || canSchedules ? [{ id: 'groups' as const, label: 'المجموعات والجدول المباشر' }] : []),
    ...(canComments || canBroadcast ? [{ id: 'comms' as const, label: 'التفاعل وأسئلة الطلاب' }] : []),
    { id: 'devices' as const, label: 'الأجهزة والجلسات النشطة' },
    ...(canCms ? [{ id: 'cms' as const, label: 'إعدادات المنصة والهوية CMS' }] : []),
    ...(canSecurityTab ? [{ id: 'security' as const, label: 'الفريق والنسخ الاحتياطي وسجل التدقيق' }] : []),
  ];

  const [examsData, setExamsData] = useState<ExamsSuiteData | null>(null);
  const [opsData, setOpsData] = useState<OperationsData | null>(null);
  const [examSubTab, setExamSubTab] = useState<'bank' | 'builder' | 'grading'>('bank');
  const [opsSubTab, setOpsSubTab] = useState<'groups' | 'comms' | 'devices' | 'cms' | 'security'>(
    (initialOpsSubTab && visibleOpsSubTabs.some((t) => t.id === initialOpsSubTab)
      ? initialOpsSubTab
      : visibleOpsSubTabs[0]?.id) || 'devices',
  );

  // Screen 13: Groups & Schedule UI state
  const [groupSearch, setGroupSearch] = useState('');
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleGradeFilter, setScheduleGradeFilter] = useState<number>(0);
  const [scheduleViewMode, setScheduleViewMode] = useState<'weekly' | 'list'>('list');
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [openCreateGroup, setOpenCreateGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [openCreateSchedule, setOpenCreateSchedule] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [togglingScheduleId, setTogglingScheduleId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'schedule'; id: number; titleAr: string; subtitle: string }
    | { kind: 'group'; id: number; titleAr: string; subtitle: string }
    | null
  >(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const scheduleFormRef = useRef<HTMLDivElement | null>(null);
  const groupFormRef = useRef<HTMLDivElement | null>(null);
  const scheduleTableScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleScrollRafRef = useRef<number | null>(null);
  const [scheduleScrollState, setScheduleScrollState] = useState<TableScrollMetrics>(
    INITIAL_TABLE_SCROLL_METRICS,
  );

  const updateScheduleScrollState = useCallback(() => {
    const el = scheduleTableScrollRef.current;
    if (!el) return;
    setScheduleScrollState(
      computeTableScrollMetrics({
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }),
    );
  }, []);

  const handleScheduleTableScroll = useCallback(() => {
    if (scheduleScrollRafRef.current !== null) return;
    scheduleScrollRafRef.current = requestAnimationFrame(() => {
      scheduleScrollRafRef.current = null;
      updateScheduleScrollState();
    });
  }, [updateScheduleScrollState]);

  useEffect(() => {
    if (scheduleViewMode !== 'list') return;
    const raf = requestAnimationFrame(updateScheduleScrollState);
    window.addEventListener('resize', updateScheduleScrollState);
    return () => {
      cancelAnimationFrame(raf);
      if (scheduleScrollRafRef.current !== null) {
        cancelAnimationFrame(scheduleScrollRafRef.current);
        scheduleScrollRafRef.current = null;
      }
      window.removeEventListener('resize', updateScheduleScrollState);
    };
  }, [scheduleViewMode, opsData?.schedules.length, scheduleGradeFilter, scheduleSearch, updateScheduleScrollState]);

  const scrollAdminScheduleTable = (direction: 'start' | 'end') => {
    const el = scheduleTableScrollRef.current;
    if (!el) return;
    // In RTL, negative scrollLeft moves toward the left (end columns), positive moves back right (start)
    const delta = direction === 'end' ? -240 : 240;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // Screen 14: Student Questions & Notifications UI state
  const [commentSearch, setCommentSearch] = useState('');
  const [commentStatusFilter, setCommentStatusFilter] = useState<'ALL' | 'UNANSWERED' | 'ANSWERED'>('ALL');
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // Screen 16: Settings UI state
  const [settingsTab, setSettingsTab] = useState<'all' | 'identity' | 'contact' | 'maintenance'>('all');

  // Screen 17: Security (Team / Backup / Audit) UI state
  const defaultSecuritySubTab = useMemo<'staff' | 'audit' | 'backup'>(() => {
    if (activeSection === 'audit' && canAudit) return 'audit';
    if (activeSection === 'staff' && canStaff) return 'staff';
    if (canStaff) return 'staff';
    if (canAudit) return 'audit';
    return 'backup';
  }, [activeSection, canAudit, canStaff]);
  const [securitySubTab, setSecuritySubTab] = useState<'staff' | 'audit' | 'backup'>(defaultSecuritySubTab);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('ALL');
  const [auditPage, setAuditPage] = useState(1);

  useEffect(() => {
    if (activeSection === 'audit' && canAudit) {
      setSecuritySubTab('audit');
    } else if (activeSection === 'staff' && canStaff) {
      setSecuritySubTab('staff');
    }
  }, [activeSection, canAudit, canStaff, navigationNonce]);

  useEffect(() => {
    if (initialOpsSubTab && visibleOpsSubTabs.some((t) => t.id === initialOpsSubTab)) {
      setOpsSubTab(initialOpsSubTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpsSubTab, navigationNonce]);

  const gradeNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of catalog.grades) {
      map.set(g.id, g.nameAr);
    }
    return map;
  }, [catalog.grades]);

  // Question creation form
  const [qForm, setQForm] = useState({
    gradeId: catalog.grades[0]?.id || 0,
    lessonId: catalog.lessons[0]?.id || 0,
    questionType: 'MCQ' as
      | 'MCQ'
      | 'TRUE_FALSE'
      | 'NUMERIC'
      | 'ESSAY'
      | 'PHYSICS_PROBLEM'
      | 'IMAGE_DIAGRAM'
      | 'FILE_UPLOAD',
    difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
    promptAr: '',
    latexFormula: '',
    points: 2,
    numericAnswer: '',
    numericTolerance: '0.05',
    modelAnswerAr: '',
    explanationAr: '',
    choices: [
      { labelAr: '', isCorrect: true },
      { labelAr: '', isCorrect: false },
      { labelAr: '', isCorrect: false },
      { labelAr: '', isCorrect: false },
    ],
  });

  // Exam builder form
  const [exForm, setExForm] = useState({
    gradeId: catalog.grades[0]?.id || 0,
    titleAr: '',
    descriptionAr: '',
    examType: 'LESSON_QUIZ',
    durationMin: 30,
    maxAttempts: 2,
    passScorePercent: 60,
    shuffleQuestions: false,
    shuffleChoices: false,
    requiredVideoId: 0,
    questionIds: [] as number[],
  });

  // Manual grading inputs map
  const [gradeInputs, setGradeInputs] = useState<Record<number, { points: number; feedback: string }>>({});

  // Operations forms
  const [groupForm, setGroupForm] = useState({
    gradeId: catalog.grades[0]?.id || 0,
    nameAr: '',
    scheduleTextAr: '',
    descriptionAr: '',
  });
  const [schedForm, setSchedForm] = useState({
    gradeId: catalog.grades[0]?.id || 0,
    groupId: 0,
    titleAr: '',
    descriptionAr: '',
    scheduledAt: toDateTimeLocalValue(new Date(Date.now() + 86400_000)),
    durationMin: 90,
    sessionType: 'LIVE',
    liveProvider: 'ZOOM',
    joinUrl: '',
    isPublished: true,
  });
  const [replyMap, setReplyMap] = useState<Record<number, string>>({});
  const [broadcastForm, setBroadcastForm] = useState({
    gradeId: 0,
    titleAr: '',
    bodyAr: '',
  });

  // CMS settings draft
  const [cmsDraft, setCmsDraft] = useState<PlatformSettings>(settings);
  const [savingCms, setSavingCms] = useState(false);

  useEffect(() => {
    setCmsDraft(settings);
  }, [settings]);

  const loadData = useCallback(async () => {
    try {
      if (section === 'exams') {
        const res = await apiRequest<ExamsSuiteData>('/api/admin/exams-suite');
        setExamsData(res);
      } else {
        const res = await apiRequest<OperationsData>('/api/admin/operations');
        setOpsData(res);
      }
    } catch (err) {
      onToast((err as Error).message);
    }
  }, [section, onToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payloadChoices =
        qForm.questionType === 'TRUE_FALSE'
          ? [
              { labelAr: 'صواب', isCorrect: qForm.choices[0]?.isCorrect ?? true },
              { labelAr: 'خطأ', isCorrect: !(qForm.choices[0]?.isCorrect ?? true) },
            ]
          : qForm.questionType === 'MCQ' || qForm.questionType === 'IMAGE_DIAGRAM'
            ? qForm.choices.filter((c) => c.labelAr.trim())
            : [];

      await apiRequest('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify({
          gradeId: qForm.gradeId,
          lessonId: qForm.lessonId || null,
          questionType: qForm.questionType,
          difficulty: qForm.difficulty,
          promptAr: qForm.promptAr,
          latexFormula: qForm.latexFormula || null,
          points: qForm.points,
          numericAnswer: qForm.numericAnswer || null,
          numericTolerance: qForm.numericTolerance,
          modelAnswerAr: qForm.modelAnswerAr,
          explanationAr: qForm.explanationAr,
          choices: payloadChoices,
        }),
      });
      setQForm((prev) => ({
        ...prev,
        promptAr: '',
        latexFormula: '',
        numericAnswer: '',
        modelAnswerAr: '',
        explanationAr: '',
        choices: prev.choices.map((c, idx) => ({ labelAr: '', isCorrect: idx === 0 })),
      }));
      onToast('تمت إضافة السؤال إلى بنك الأسئلة');
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/exams', {
        method: 'POST',
        body: JSON.stringify({
          ...exForm,
          requiredVideoId: exForm.requiredVideoId || null,
        }),
      });
      setExForm((prev) => ({ ...prev, titleAr: '', descriptionAr: '', questionIds: [] }));
      onToast('تم إنشاء ونشر الامتحان وإشعار طلاب الصف');
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleGradeAnswer = async (answerId: number, maxPoints: number) => {
    const entry = gradeInputs[answerId] || { points: maxPoints, feedback: 'إجابة ممتازة ومستوفاة' };
    try {
      await apiRequest(`/api/admin/answers/${answerId}/grade`, {
        method: 'POST',
        body: JSON.stringify({
          awardedPoints: Math.min(maxPoints, Math.max(0, entry.points)),
          graderFeedback: entry.feedback,
        }),
      });
      onToast('تم حفظ الدرجة وإشعار الطالب بالنتيجة النهائية');
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCms(true);
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(cmsDraft),
      });
      await onRefreshBootstrap();
      onToast('تم حفظ إعدادات المنصة والهوية بنجاح');
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setSavingCms(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const backup = await apiRequest<Record<string, unknown>>('/api/admin/backup/export');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `physics-lms-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast('تم تنزيل النسخة الاحتياطية الآمنة بنجاح');
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  // ==================== EXAMS SUITE ====================
  if (section === 'exams') {
    const gradeQuestions =
      examsData?.questions.filter((q) => !exForm.gradeId || q.gradeId === exForm.gradeId) || [];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1.5">
          {[
            { id: 'bank', label: `بنك الأسئلة (${examsData?.questions.length || 0})` },
            { id: 'builder', label: `الامتحانات ومنشئ الاختبارات (${examsData?.exams.length || 0})` },
            {
              id: 'grading',
              label: `التصحيح اليدوي للمقالي (${examsData?.gradingQueue.length || 0})`,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setExamSubTab(t.id as 'bank' | 'builder' | 'grading')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                examSubTab === t.id
                  ? 'bg-[#0B162C] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-tab 1: Question Bank */}
        {examSubTab === 'bank' && (
          <div className="space-y-6">
            <form
              onSubmit={handleCreateQuestion}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <h3 className="text-base font-bold text-[#0B162C]">
                إضافة سؤال فيزيائي جديد (يدعم معادلات KaTeX / LaTeX)
              </h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <select
                  value={qForm.gradeId}
                  onChange={(e) => setQForm({ ...qForm, gradeId: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  {catalog.grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  value={qForm.questionType}
                  onChange={(e) =>
                    setQForm({ ...qForm, questionType: e.target.value as typeof qForm.questionType })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  <option value="MCQ">اختيار من متعدد (MCQ)</option>
                  <option value="TRUE_FALSE">صح وخطأ</option>
                  <option value="NUMERIC">مسألة حسابية (إجابة رقمية)</option>
                  <option value="PHYSICS_PROBLEM">مسألة فيزيائية بخطوات</option>
                  <option value="ESSAY">سؤال مقالي</option>
                  <option value="FILE_UPLOAD">رفع ورقة حل</option>
                </select>
                <select
                  value={qForm.difficulty}
                  onChange={(e) =>
                    setQForm({ ...qForm, difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD' })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  <option value="EASY">سهل</option>
                  <option value="MEDIUM">متوسط</option>
                  <option value="HARD">متقدم / تفكير عليا</option>
                </select>
                <input
                  type="number"
                  min={1}
                  value={qForm.points}
                  onChange={(e) => setQForm({ ...qForm, points: Number(e.target.value) })}
                  placeholder="الدرجة"
                  className="rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                />
              </div>

              <textarea
                rows={2}
                required
                value={qForm.promptAr}
                onChange={(e) => setQForm({ ...qForm, promptAr: e.target.value })}
                placeholder="نص السؤال الفيزيائي بالعربية..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    معادلة LaTeX اختيارية (مثال: F = B I L \sin\theta)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={qForm.latexFormula}
                    onChange={(e) => setQForm({ ...qForm, latexFormula: e.target.value })}
                    placeholder="V_B = I(R + r)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3">
                  <div className="text-[11px] text-slate-500">معاينة المعادلة الفورية:</div>
                  <div className="mt-1 min-h-[28px] text-center">
                    {qForm.latexFormula ? (
                      <MathFormula formula={qForm.latexFormula} />
                    ) : (
                      <span className="text-xs text-slate-400">ستظهر المعادلة هنا</span>
                    )}
                  </div>
                </div>
              </div>

              {(qForm.questionType === 'MCQ' || qForm.questionType === 'IMAGE_DIAGRAM') && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    الاختيارات (حدد الاختيار الصحيح):
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {qForm.choices.map((ch, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="correct-choice"
                          checked={ch.isCorrect}
                          onChange={() =>
                            setQForm({
                              ...qForm,
                              choices: qForm.choices.map((item, i) => ({
                                ...item,
                                isCorrect: i === idx,
                              })),
                            })
                          }
                        />
                        <input
                          type="text"
                          value={ch.labelAr}
                          onChange={(e) =>
                            setQForm({
                              ...qForm,
                              choices: qForm.choices.map((item, i) =>
                                i === idx ? { ...item, labelAr: e.target.value } : item,
                              ),
                            })
                          }
                          placeholder={`الاختيار ${idx + 1}`}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {qForm.questionType === 'TRUE_FALSE' && (
                <div className="flex items-center gap-4 text-xs">
                  <span className="font-semibold text-slate-700">الإجابة الصحيحة:</span>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={qForm.choices[0]?.isCorrect}
                      onChange={() =>
                        setQForm({
                          ...qForm,
                          choices: [
                            { labelAr: 'صواب', isCorrect: true },
                            { labelAr: 'خطأ', isCorrect: false },
                          ],
                        })
                      }
                    />
                    صواب
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={!qForm.choices[0]?.isCorrect}
                      onChange={() =>
                        setQForm({
                          ...qForm,
                          choices: [
                            { labelAr: 'صواب', isCorrect: false },
                            { labelAr: 'خطأ', isCorrect: true },
                          ],
                        })
                      }
                    />
                    خطأ
                  </label>
                </div>
              )}

              {(qForm.questionType === 'NUMERIC' || qForm.questionType === 'PHYSICS_PROBLEM') && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    dir="ltr"
                    value={qForm.numericAnswer}
                    onChange={(e) => setQForm({ ...qForm, numericAnswer: e.target.value })}
                    placeholder="الإجابة الرقمية الصحيحة (مثال: 2.5)"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                  <input
                    type="text"
                    dir="ltr"
                    value={qForm.numericTolerance}
                    onChange={(e) => setQForm({ ...qForm, numericTolerance: e.target.value })}
                    placeholder="هامش الخطأ المسموح (مثال: 0.05)"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-xs"
                  />
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={qForm.modelAnswerAr}
                  onChange={(e) => setQForm({ ...qForm, modelAnswerAr: e.target.value })}
                  placeholder="الإجابة النموذجية (للمقالي والمرجع)"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  value={qForm.explanationAr}
                  onChange={(e) => setQForm({ ...qForm, explanationAr: e.target.value })}
                  placeholder="تفسير وشرح الإجابة بعد التسليم"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"
              >
                <Plus className="h-4 w-4" />
                إضافة السؤال للبنك
              </button>
            </form>

            {/* Questions List */}
            <div className="space-y-3">
              {examsData?.questions.map((q) => (
                <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {q.questionType} · {q.difficulty} · {q.points} درجات
                    </span>
                    <span className="font-mono-num">#{q.id}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-[#0B162C]">{q.promptAr}</p>
                  {q.latexFormula && (
                    <div className="mt-2 rounded-lg bg-[#F7F9FC] p-2">
                      <MathFormula formula={q.latexFormula} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sub-tab 2: Exam Builder */}
        {examSubTab === 'builder' && (
          <div className="space-y-6">
            <form
              onSubmit={handleCreateExam}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <h3 className="flex items-center gap-2 text-base font-bold text-[#0B162C]">
                <ClipboardList className="h-4 w-4 text-[#2563EB]" />
                <span>إنشاء امتحان جديد من بنك الأسئلة</span>
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={exForm.gradeId}
                  onChange={(e) =>
                    setExForm({ ...exForm, gradeId: Number(e.target.value), questionIds: [] })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  {catalog.grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={exForm.titleAr}
                  onChange={(e) => setExForm({ ...exForm, titleAr: e.target.value })}
                  placeholder="عنوان الامتحان"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <select
                  value={exForm.examType}
                  onChange={(e) => setExForm({ ...exForm, examType: e.target.value })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  <option value="LESSON_QUIZ">اختبار درس</option>
                  <option value="UNIT_EXAM">امتحان وحدة</option>
                  <option value="MONTHLY">امتحان شهري</option>
                  <option value="FINAL_SIMULATION">محاكاة النهائي</option>
                  <option value="HOMEWORK">واجب منزلي</option>
                </select>
                <input
                  type="number"
                  min={5}
                  value={exForm.durationMin}
                  onChange={(e) => setExForm({ ...exForm, durationMin: Number(e.target.value) })}
                  placeholder="المدة بالدقائق"
                  className="rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                />
                <input
                  type="number"
                  min={1}
                  value={exForm.maxAttempts}
                  onChange={(e) => setExForm({ ...exForm, maxAttempts: Number(e.target.value) })}
                  placeholder="عدد المحاولات"
                  className="rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                />
                <select
                  value={exForm.requiredVideoId}
                  onChange={(e) => setExForm({ ...exForm, requiredVideoId: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                  <option value={0}>بدون شرط مشاهدة فيديو مسبق</option>
                  {catalog.videos
                    .filter((v) => v.gradeId === exForm.gradeId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        يشترط إتمام: {v.titleAr}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={exForm.shuffleQuestions}
                    onChange={(e) => setExForm({ ...exForm, shuffleQuestions: e.target.checked })}
                  />
                  ترتيب عشوائي للأسئلة
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={exForm.shuffleChoices}
                    onChange={(e) => setExForm({ ...exForm, shuffleChoices: e.target.checked })}
                  />
                  ترتيب عشوائي للاختيارات
                </label>
              </div>

              <div>
                <div className="mb-2 text-xs font-bold text-slate-700">
                  اختر أسئلة الامتحان ({exForm.questionIds.length} محدد):
                </div>
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3">
                  {gradeQuestions.map((q) => {
                    const checked = exForm.questionIds.includes(q.id);
                    return (
                      <label
                        key={q.id}
                        className="flex items-start gap-2 rounded p-1.5 text-xs hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setExForm((prev) => ({
                              ...prev,
                              questionIds: checked
                                ? prev.questionIds.filter((id) => id !== q.id)
                                : [...prev.questionIds, q.id],
                            }))
                          }
                          className="mt-0.5"
                        />
                        <span>
                          [{q.questionType}] {q.promptAr} ({q.points} د)
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-[#0B162C] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#2563EB]"
              >
                حفظ ونشر الامتحان
              </button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              {examsData?.exams.map((ex) => (
                <div key={ex.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">
                    {ex.examType} · {ex.durationMin} دقيقة · نجاح {ex.passScorePercent}%
                  </div>
                  <div className="mt-1 text-sm font-bold text-[#0B162C]">{ex.titleAr}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sub-tab 3: Manual Essay Grading Queue */}
        {examSubTab === 'grading' && (
          <div className="space-y-4">
            {!examsData?.gradingQueue.length ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
                لا توجد إجابات مقالية معلّقة للتصحيح حاليًا.
              </div>
            ) : (
              examsData.gradingQueue.map((item) => {
                const draft = gradeInputs[item.answerId] || {
                  points: item.maxPoints,
                  feedback: '',
                };
                return (
                  <div key={item.answerId} className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-bold text-[#0B162C]">
                        الطالب: {item.studentName} · {item.examTitleAr}
                      </span>
                      <span className="font-mono-num">الدرجة العظمى: {item.maxPoints}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-800">{item.questionPromptAr}</p>
                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-slate-800">
                      <div className="text-xs font-bold text-[#2563EB]">إجابة الطالب:</div>
                      <p className="mt-1 whitespace-pre-wrap">{item.textAnswer || '—'}</p>
                      {item.uploadedFileName && (
                        <div className="mt-1 text-xs text-slate-500">ملف مرفق: {item.uploadedFileName}</div>
                      )}
                    </div>
                    {item.modelAnswerAr && (
                      <div className="mt-2 rounded-lg bg-[#F7F9FC] p-3 text-xs text-slate-600">
                        <strong>الإجابة النموذجية:</strong> {item.modelAnswerAr}
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={item.maxPoints}
                        value={draft.points}
                        onChange={(e) =>
                          setGradeInputs((prev) => ({
                            ...prev,
                            [item.answerId]: { ...draft, points: Number(e.target.value) },
                          }))
                        }
                        className="w-28 rounded-lg border border-slate-300 px-3 py-2 font-mono-num text-xs"
                      />
                      <input
                        type="text"
                        value={draft.feedback}
                        onChange={(e) =>
                          setGradeInputs((prev) => ({
                            ...prev,
                            [item.answerId]: { ...draft, feedback: e.target.value },
                          }))
                        }
                        placeholder="ملاحظة المدرس للطالب..."
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void handleGradeAnswer(item.answerId, item.maxPoints)}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        اعتماد الدرجة
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  // ==================== OPERATIONS, CMS & SECURITY (SCREENS 13, 14, 16, 17) ====================
  const isDedicatedSection = Boolean(activeSection && activeSection !== 'operations');
  const resolvedOpsView: 'groups' | 'comms' | 'devices' | 'cms' | 'security' =
    activeSection === 'groups'
      ? 'groups'
      : activeSection === 'communications'
        ? 'comms'
        : activeSection === 'settings'
          ? 'cms'
          : activeSection === 'staff' || activeSection === 'audit'
            ? 'security'
            : opsSubTab;

  // Derived data for Screen 13 (Groups & Schedules)
  const allGroups = opsData?.groups || [];
  const allSchedules = opsData?.schedules || [];
  const totalGroupMembers = allGroups.reduce((acc, g) => acc + (g.memberCount || 0), 0);
  const upcoming7DaysCount = allSchedules.filter((s) => {
    const t = new Date(s.scheduledAt).getTime();
    const now = Date.now();
    return Number.isFinite(t) && t >= now - 3600_000 && t <= now + 7 * 86400_000;
  }).length;

  const filteredGroups = allGroups.filter((g) => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return true;
    const gradeLabel = gradeNameMap.get(g.gradeId) || '';
    return (
      g.nameAr.toLowerCase().includes(q) ||
      g.scheduleTextAr.toLowerCase().includes(q) ||
      gradeLabel.toLowerCase().includes(q)
    );
  });

  const groupNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of allGroups) {
      map.set(g.id, g.nameAr);
    }
    return map;
  }, [allGroups]);

  const filteredSchedules = allSchedules.filter((s) => {
    if (scheduleGradeFilter && s.gradeId !== scheduleGradeFilter) return false;
    const q = scheduleSearch.trim().toLowerCase();
    if (!q) return true;
    const gradeLabel = gradeNameMap.get(s.gradeId) || '';
    const groupLabel = s.groupId ? groupNameMap.get(s.groupId) || '' : '';
    const provLabel = PROVIDER_META[s.liveProvider]?.label || s.liveProvider || '';
    return (
      s.titleAr.toLowerCase().includes(q) ||
      (s.descriptionAr || '').toLowerCase().includes(q) ||
      gradeLabel.toLowerCase().includes(q) ||
      groupLabel.toLowerCase().includes(q) ||
      provLabel.toLowerCase().includes(q)
    );
  });

  const selectedSchedule =
    filteredSchedules.find((s) => s.id === selectedScheduleId) || filteredSchedules[0] || null;

  const schedulesByDay = CAIRO_WEEKDAY_LABELS.map((dayLabel) => ({
    dayLabel,
    items: filteredSchedules.filter((s) => getCairoDayName(s.scheduledAt) === dayLabel),
  }));

  const openNewScheduleForm = () => {
    setOpenCreateGroup(false);
    setEditingGroupId(null);
    setEditingScheduleId(null);
    setSchedForm({
      gradeId: scheduleGradeFilter || catalog.grades[0]?.id || 0,
      groupId: 0,
      titleAr: '',
      descriptionAr: '',
      scheduledAt: toDateTimeLocalValue(new Date(Date.now() + 86400_000)),
      durationMin: 90,
      sessionType: 'LIVE',
      liveProvider: 'ZOOM',
      joinUrl: '',
      isPublished: true,
    });
    setOpenCreateSchedule(true);
    requestAnimationFrame(() => {
      scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openEditScheduleForm = (s: OperationsData['schedules'][number]) => {
    setOpenCreateGroup(false);
    setEditingGroupId(null);
    setEditingScheduleId(s.id);
    setSelectedScheduleId(s.id);
    setSchedForm({
      gradeId: s.gradeId,
      groupId: s.groupId || 0,
      titleAr: s.titleAr,
      descriptionAr: s.descriptionAr || '',
      scheduledAt: toDateTimeLocalValue(s.scheduledAt),
      durationMin: s.durationMin || 90,
      sessionType: s.sessionType || 'LIVE',
      liveProvider: s.liveProvider || 'ZOOM',
      joinUrl: s.joinUrl || '',
      isPublished: s.isPublished !== false,
    });
    setOpenCreateSchedule(true);
    requestAnimationFrame(() => {
      scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleToggleSchedulePublish = async (s: OperationsData['schedules'][number]) => {
    setTogglingScheduleId(s.id);
    try {
      const nextPublished = s.isPublished === false;
      await apiRequest(`/api/admin/schedules/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          gradeId: s.gradeId,
          groupId: s.groupId || null,
          titleAr: s.titleAr,
          descriptionAr: s.descriptionAr || '',
          scheduledAt: s.scheduledAt,
          durationMin: s.durationMin || 90,
          sessionType: s.sessionType || 'LIVE',
          liveProvider: s.liveProvider || 'ZOOM',
          joinUrl: s.joinUrl || '',
          isPublished: nextPublished,
        }),
      });
      onToast(nextPublished ? 'تم نشر الموعد للطلاب بنجاح' : 'تم إخفاء الموعد عن الطلاب (مسودة)');
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setTogglingScheduleId(null);
    }
  };

  const openNewGroupForm = () => {
    setOpenCreateSchedule(false);
    setEditingScheduleId(null);
    setEditingGroupId(null);
    setGroupForm({
      gradeId: scheduleGradeFilter || catalog.grades[0]?.id || 0,
      nameAr: '',
      scheduleTextAr: '',
      descriptionAr: '',
    });
    setOpenCreateGroup(true);
    requestAnimationFrame(() => {
      groupFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openEditGroupForm = (g: OperationsData['groups'][number]) => {
    setOpenCreateSchedule(false);
    setEditingScheduleId(null);
    setEditingGroupId(g.id);
    setGroupForm({
      gradeId: g.gradeId,
      nameAr: g.nameAr,
      scheduleTextAr: g.scheduleTextAr || '',
      descriptionAr: g.descriptionAr || '',
    });
    setOpenCreateGroup(true);
    requestAnimationFrame(() => {
      groupFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingTarget(true);
    try {
      if (deleteTarget.kind === 'schedule') {
        await apiRequest(`/api/admin/schedules/${deleteTarget.id}`, { method: 'DELETE' });
        if (editingScheduleId === deleteTarget.id) {
          setEditingScheduleId(null);
          setOpenCreateSchedule(false);
        }
        if (selectedScheduleId === deleteTarget.id) {
          setSelectedScheduleId(null);
        }
        onToast('تم حذف الموعد من الجدول بنجاح');
      } else {
        await apiRequest(`/api/admin/groups/${deleteTarget.id}`, { method: 'DELETE' });
        if (editingGroupId === deleteTarget.id) {
          setEditingGroupId(null);
          setOpenCreateGroup(false);
        }
        onToast('تم حذف المجموعة الدراسية بنجاح');
      }
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setDeletingTarget(false);
    }
  };

  // Derived data for Screen 14 (Comments & Notifications)
  const allComments = opsData?.comments || [];
  const unansweredCommentsCount = allComments.filter((c) => !c.replyAr).length;
  const answeredCommentsCount = allComments.length - unansweredCommentsCount;
  const filteredComments = allComments.filter((c) => {
    if (commentStatusFilter === 'UNANSWERED' && c.replyAr) return false;
    if (commentStatusFilter === 'ANSWERED' && !c.replyAr) return false;
    const q = commentSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.authorName.toLowerCase().includes(q) ||
      c.lessonTitleAr.toLowerCase().includes(q) ||
      c.bodyAr.toLowerCase().includes(q)
    );
  });
  const selectedComment =
    filteredComments.find((c) => c.id === selectedCommentId) || filteredComments[0] || null;

  // Derived data for Screen 16 (CMS Settings)
  const hasUnsavedCms = JSON.stringify(cmsDraft) !== JSON.stringify(settings);

  // Derived data for Screen 17 (Team, Backups & Audit Logs)
  const allStaff = opsData?.staff || [];
  const activeStaffCount = allStaff.filter((m) => m.status === 'ACTIVE').length;
  const suspendedStaffCount = allStaff.length - activeStaffCount;
  const allAuditLogs = opsData?.auditLogs || [];
  const uniqueAuditActors = Array.from(new Set(allAuditLogs.map((l) => l.actorName).filter(Boolean)));
  const filteredAuditLogs = allAuditLogs.filter((log) => {
    if (auditActorFilter !== 'ALL' && log.actorName !== auditActorFilter) return false;
    const q = auditSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      log.actorName.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.entityType.toLowerCase().includes(q) ||
      String(log.entityId || '').toLowerCase().includes(q)
    );
  });
  const AUDIT_PAGE_SIZE = 15;
  const totalAuditPages = Math.max(1, Math.ceil(filteredAuditLogs.length / AUDIT_PAGE_SIZE));
  const safeAuditPage = Math.min(auditPage, totalAuditPages);
  const pagedAuditLogs = filteredAuditLogs.slice(
    (safeAuditPage - 1) * AUDIT_PAGE_SIZE,
    safeAuditPage * AUDIT_PAGE_SIZE,
  );

  return (
    <div className="space-y-5">
      {/* Legacy sub-tab bar shown only when accessed via generic 'operations' host */}
      {!isDedicatedSection && (
        <AdminSegmentedTabs
          activeId={opsSubTab}
          onChange={setOpsSubTab}
          items={visibleOpsSubTabs.map((t) => ({ id: t.id, label: t.label }))}
        />
      )}

      {/* ==================== SCREEN 13: GROUPS & LIVE SCHEDULE ==================== */}
      {resolvedOpsView === 'groups' && (canGroups || canSchedules) && (
        <div className="space-y-5">
          <AdminPageHeader
            icon={<Calendar className="h-5 w-5" />}
            title="المجموعات والمواعيد"
            subtitle="تنظيم المجموعات الدراسية وجدولة الحصص المباشرة والمواعيد للطلاب بتوقيت القاهرة."
            actions={
              <>
                {canGroups && (
                  <button
                    type="button"
                    onClick={() => {
                      if (openCreateGroup && editingGroupId === null) {
                        setOpenCreateGroup(false);
                      } else {
                        openNewGroupForm();
                      }
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Users className="h-4 w-4 text-[#2563EB]" />
                    <span>+ مجموعة جديدة</span>
                  </button>
                )}
                {canSchedules && (
                  <button
                    type="button"
                    onClick={() => {
                      if (openCreateSchedule && editingScheduleId === null) {
                        setOpenCreateSchedule(false);
                      } else {
                        openNewScheduleForm();
                      }
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>إضافة موعد جديد</span>
                  </button>
                )}
              </>
            }
          />

          <AdminKpiGrid cols={4}>
            <AdminKpiCard
              label="إجمالي المجموعات"
              value={allGroups.length}
              subtitle="مجموعات دراسية مسجّلة"
              icon={<Users className="h-5 w-5" />}
              tone="blue"
            />
            <AdminKpiCard
              label="إجمالي طلاب المجموعات"
              value={totalGroupMembers}
              subtitle="عدد الطلاب المسجلين بالمجموعات"
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="emerald"
            />
            <AdminKpiCard
              label="الحصص المجدولة"
              value={allSchedules.length}
              subtitle="إجمالي المواعيد المباشرة"
              icon={<Video className="h-5 w-5" />}
              tone="purple"
            />
            <AdminKpiCard
              label="حصص خلال 7 أيام"
              value={upcoming7DaysCount}
              subtitle="مواعيد قادمة هذا الأسبوع"
              icon={<Clock className="h-5 w-5" />}
              tone="amber"
            />
          </AdminKpiGrid>

          {/* Collapsible Create / Edit Group Form */}
          {openCreateGroup && canGroups && (
            <div ref={groupFormRef} className="scroll-mt-20">
            <AdminCard
              title={editingGroupId ? 'تعديل بيانات المجموعة الدراسية' : 'إنشاء مجموعة دراسية جديدة'}
              subtitle={editingGroupId ? 'عدّل الاسم أو المواعيد الأسبوعية ثم اضغط حفظ التعديلات' : undefined}
              headerAction={
                <button
                  type="button"
                  aria-label="إغلاق نموذج المجموعة"
                  onClick={() => {
                    setOpenCreateGroup(false);
                    setEditingGroupId(null);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              }
            >
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingGroup(true);
                  try {
                    if (editingGroupId) {
                      await apiRequest(`/api/admin/groups/${editingGroupId}`, {
                        method: 'PUT',
                        body: JSON.stringify(groupForm),
                      });
                      onToast('تم حفظ تعديلات المجموعة الدراسية بنجاح');
                    } else {
                      await apiRequest('/api/admin/groups', {
                        method: 'POST',
                        body: JSON.stringify(groupForm),
                      });
                      onToast('تم إنشاء المجموعة الدراسية بنجاح');
                    }
                    setGroupForm({ ...groupForm, nameAr: '', scheduleTextAr: '', descriptionAr: '' });
                    setEditingGroupId(null);
                    setOpenCreateGroup(false);
                    await loadData();
                  } catch (err) {
                    onToast((err as Error).message);
                  } finally {
                    setSavingGroup(false);
                  }
                }}
                className="grid gap-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-bold text-slate-700">الصف الدراسي</label>
                  <select
                    value={groupForm.gradeId}
                    onChange={(e) => setGroupForm({ ...groupForm, gradeId: Number(e.target.value) })}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    {catalog.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="mb-1 block text-xs font-bold text-slate-700">اسم المجموعة</label>
                  <input
                    type="text"
                    required
                    value={groupForm.nameAr}
                    onChange={(e) => setGroupForm({ ...groupForm, nameAr: e.target.value })}
                    placeholder="مثال: مجموعة المتفوقين أ"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-xs font-bold text-slate-700">المواعيد الأسبوعية</label>
                  <input
                    type="text"
                    value={groupForm.scheduleTextAr}
                    onChange={(e) => setGroupForm({ ...groupForm, scheduleTextAr: e.target.value })}
                    placeholder="الأحد والأربعاء 7 مساءً"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-9">
                  <label className="mb-1 block text-xs font-bold text-slate-700">ملاحظات أو وصف المجموعة (اختياري)</label>
                  <input
                    type="text"
                    value={groupForm.descriptionAr}
                    onChange={(e) => setGroupForm({ ...groupForm, descriptionAr: e.target.value })}
                    placeholder="تفاصيل إضافية عن المجموعة..."
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="flex items-end gap-2 sm:col-span-3">
                  <button
                    type="submit"
                    disabled={savingGroup}
                    className="h-10 flex-1 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                  >
                    {savingGroup ? 'جارٍ الحفظ...' : editingGroupId ? 'حفظ التعديلات' : 'حفظ المجموعة'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenCreateGroup(false);
                      setEditingGroupId(null);
                    }}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </AdminCard>
            </div>
          )}

          {/* Collapsible Create / Edit Live Schedule Form */}
          {openCreateSchedule && canSchedules && (
            <div ref={scheduleFormRef} className="scroll-mt-20">
            <AdminCard
              title={editingScheduleId ? 'تعديل الموعد المجدول' : 'إضافة موعد أو حصة مباشرة جديدة'}
              subtitle={
                editingScheduleId
                  ? 'يمكنك تعديل العنوان أو الصف أو التاريخ والوقت أو رابط البث أو حالة النشر'
                  : 'سيظهر الموعد مباشرة في جدول الطلاب بتوقيت القاهرة فور نشره'
              }
              headerAction={
                <button
                  type="button"
                  aria-label="إغلاق نموذج الموعد"
                  onClick={() => {
                    setOpenCreateSchedule(false);
                    setEditingScheduleId(null);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              }
            >
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingSchedule(true);
                  try {
                    const payload = {
                      gradeId: schedForm.gradeId,
                      groupId: schedForm.groupId || null,
                      titleAr: schedForm.titleAr,
                      descriptionAr: schedForm.descriptionAr,
                      scheduledAt: new Date(schedForm.scheduledAt).toISOString(),
                      durationMin: schedForm.durationMin,
                      sessionType: schedForm.sessionType,
                      liveProvider: schedForm.liveProvider,
                      joinUrl: schedForm.joinUrl,
                      isPublished: schedForm.isPublished,
                    };

                    if (editingScheduleId) {
                      await apiRequest(`/api/admin/schedules/${editingScheduleId}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                      });
                      setSelectedScheduleId(editingScheduleId);
                      onToast('تم حفظ تعديلات الموعد بنجاح');
                    } else {
                      const created = await apiRequest<{ schedule?: { id: number } }>('/api/admin/schedules', {
                        method: 'POST',
                        body: JSON.stringify(payload),
                      });
                      if (created?.schedule?.id) {
                        setSelectedScheduleId(created.schedule.id);
                      }
                      onToast('تمت إضافة الموعد ونشره في الجدول بنجاح');
                    }
                    setEditingScheduleId(null);
                    setOpenCreateSchedule(false);
                    await loadData();
                  } catch (err) {
                    onToast((err as Error).message);
                  } finally {
                    setSavingSchedule(false);
                  }
                }}
                className="grid gap-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-bold text-slate-700">الصف الدراسي</label>
                  <select
                    aria-label="الصف الدراسي للموعد"
                    value={schedForm.gradeId}
                    onChange={(e) => {
                      const nextGrade = Number(e.target.value);
                      setSchedForm({ ...schedForm, gradeId: nextGrade, groupId: 0 });
                    }}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    {catalog.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-bold text-slate-700">المجموعة (اختياري)</label>
                  <select
                    aria-label="المجموعة الدراسية للموعد"
                    value={schedForm.groupId}
                    onChange={(e) => setSchedForm({ ...schedForm, groupId: Number(e.target.value) })}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    <option value={0}>جميع طلاب الصف</option>
                    {allGroups
                      .filter((g) => g.gradeId === schedForm.gradeId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nameAr}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="mb-1 block text-xs font-bold text-slate-700">عنوان الموعد / الحصة</label>
                  <input
                    type="text"
                    required
                    aria-label="عنوان الموعد"
                    value={schedForm.titleAr}
                    onChange={(e) => setSchedForm({ ...schedForm, titleAr: e.target.value })}
                    placeholder="مثال: مراجعة قوانين كيرشوف المباشرة"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">نوع الجلسة</label>
                  <select
                    aria-label="نوع الجلسة"
                    value={schedForm.sessionType}
                    onChange={(e) => setSchedForm({ ...schedForm, sessionType: e.target.value })}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    <option value="LIVE">حصة مباشرة</option>
                    <option value="REVISION">ورشة مراجعة</option>
                    <option value="RECORDED">محاضرة مسجلة</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-bold text-slate-700">التاريخ والوقت</label>
                  <input
                    type="datetime-local"
                    required
                    aria-label="التاريخ والوقت"
                    value={schedForm.scheduledAt}
                    onChange={(e) => setSchedForm({ ...schedForm, scheduledAt: e.target.value })}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">المدة (دقيقة)</label>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    aria-label="المدة بالدقائق"
                    value={schedForm.durationMin}
                    onChange={(e) =>
                      setSchedForm({
                        ...schedForm,
                        durationMin: Math.max(10, Math.min(480, Number(e.target.value) || 60)),
                      })
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono-num text-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">المنصة</label>
                  <select
                    aria-label="منصة البث"
                    value={schedForm.liveProvider}
                    onChange={(e) => setSchedForm({ ...schedForm, liveProvider: e.target.value })}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    <option value="ZOOM">Zoom</option>
                    <option value="GOOGLE_MEET">Google Meet</option>
                    <option value="YOUTUBE_UNLISTED">YouTube Live</option>
                    <option value="CUSTOM">رابط مخصص</option>
                  </select>
                </div>

                <div className="sm:col-span-5">
                  <label className="mb-1 block text-xs font-bold text-slate-700">رابط الانضمام المباشر (اختياري)</label>
                  <input
                    type="url"
                    dir="ltr"
                    aria-label="رابط الانضمام المباشر"
                    value={schedForm.joinUrl}
                    onChange={(e) => setSchedForm({ ...schedForm, joinUrl: e.target.value })}
                    placeholder="https://zoom.us/j/..."
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="mb-1 block text-xs font-bold text-slate-700">وصف أو تعليمات للطلاب (اختياري)</label>
                  <input
                    type="text"
                    aria-label="وصف الموعد"
                    value={schedForm.descriptionAr}
                    onChange={(e) => setSchedForm({ ...schedForm, descriptionAr: e.target.value })}
                    placeholder="مثال: أحضر مذكرة الفصل الثاني والآلة الحاسبة"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div className="flex items-end sm:col-span-3">
                  <label className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-bold text-slate-700">
                    <span>ظاهر للطلاب في الجدول</span>
                    <input
                      type="checkbox"
                      checked={schedForm.isPublished}
                      onChange={(e) => setSchedForm({ ...schedForm, isPublished: e.target.checked })}
                      className="h-4 w-4 accent-[#2563EB]"
                    />
                  </label>
                </div>

                <div className="flex items-end gap-2 sm:col-span-3">
                  <button
                    type="submit"
                    disabled={savingSchedule}
                    className="h-10 flex-1 rounded-xl bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1D4ED8] disabled:opacity-60"
                  >
                    {savingSchedule
                      ? 'جارٍ الحفظ...'
                      : editingScheduleId
                        ? 'حفظ التعديلات'
                        : 'حفظ ونشر الموعد'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenCreateSchedule(false);
                      setEditingScheduleId(null);
                    }}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </AdminCard>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-12">
            {/* Right Column (4 cols): Study Groups List */}
            {canGroups && (
              <div className="min-w-0 lg:col-span-4 space-y-4">
                <AdminCard
                  title="المجموعات الدراسية"
                  subtitle="اختر مجموعة لتصفية جدول حصص صفّها"
                  headerAction={
                    scheduleGradeFilter !== 0 ? (
                      <button
                        type="button"
                        onClick={() => setScheduleGradeFilter(0)}
                        className="text-xs font-bold text-[#2563EB] hover:underline"
                      >
                        عرض الكل
                      </button>
                    ) : undefined
                  }
                >
                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="ابحث باسم المجموعة أو الموعد..."
                      className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/60 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                    />
                  </div>

                  {filteredGroups.length === 0 ? (
                    <AdminEmptyState
                      icon={<Users className="h-5 w-5" />}
                      title="لا توجد مجموعات مطابقة"
                      description="أضف مجموعة دراسية جديدة لتنظيم طلاب كل صف ومواعيدهم."
                    />
                  ) : (
                    <div className="space-y-2.5 max-h-[520px] overflow-y-auto pl-0.5">
                      {filteredGroups.map((g) => {
                        const isGradeSelected = scheduleGradeFilter === g.gradeId;
                        return (
                          <div
                            key={g.id}
                            className={`rounded-xl border p-3.5 transition-colors ${
                              isGradeSelected
                                ? 'border-[#2563EB] bg-blue-50/50'
                                : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setScheduleGradeFilter(isGradeSelected ? 0 : g.gradeId)
                                }
                                className="min-w-0 flex-1 text-right"
                              >
                                <div className="text-sm font-extrabold leading-snug text-[#0F172A]">
                                  {g.nameAr}
                                </div>
                                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                                  {gradeNameMap.get(g.gradeId) || `صف #${g.gradeId}`}
                                </div>
                              </button>
                              <AdminStatusBadge tone="blue">
                                {g.memberCount} طالب
                              </AdminStatusBadge>
                            </div>
                            {g.scheduleTextAr && (
                              <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#2563EB]">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                <span>{g.scheduleTextAr}</span>
                              </div>
                            )}
                            <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2">
                              <button
                                type="button"
                                aria-label={`تعديل المجموعة ${g.nameAr}`}
                                title="تعديل المجموعة"
                                onClick={() => openEditGroupForm(g)}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200/80 bg-white px-2 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-[#2563EB]"
                              >
                                <Pencil className="h-3 w-3" />
                                <span>تعديل</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`حذف المجموعة ${g.nameAr}`}
                                title="حذف المجموعة"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: 'group',
                                    id: g.id,
                                    titleAr: g.nameAr,
                                    subtitle: gradeNameMap.get(g.gradeId) || '',
                                  })
                                }
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-200/80 bg-rose-50/40 px-2 text-[11px] font-bold text-rose-600 hover:bg-rose-100"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>حذف</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </AdminCard>
              </div>
            )}

            {/* Main Column (8 cols or 12 cols): Weekly / List Schedule + Selected Session Detail */}
            {canSchedules && (
              <div className={`min-w-0 ${canGroups ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>
                <AdminCard
                  title="جدول الحصص والمواعيد"
                  subtitle={
                    scheduleGradeFilter
                      ? `مصفّى حسب: ${gradeNameMap.get(scheduleGradeFilter) || ''} (${filteredSchedules.length} موعد)`
                      : `جميع الصفوف الدراسية · بتوقيت القاهرة (${filteredSchedules.length} موعد)`
                  }
                  headerAction={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      <div className="relative w-full sm:w-44">
                        <Search className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          aria-label="ابحث في المواعيد"
                          value={scheduleSearch}
                          onChange={(e) => setScheduleSearch(e.target.value)}
                          placeholder="ابحث في المواعيد..."
                          className="h-9 sm:h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-8 pl-2.5 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                        />
                      </div>
                      <select
                        aria-label="تصفية الجدول حسب الصف"
                        value={scheduleGradeFilter}
                        onChange={(e) => setScheduleGradeFilter(Number(e.target.value))}
                        className="h-9 sm:h-8 min-w-0 flex-1 sm:flex-none max-w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700"
                      >
                        <option value={0}>كل الصفوف</option>
                        {catalog.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nameAr}
                          </option>
                        ))}
                      </select>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                        <button
                          type="button"
                          onClick={() => setScheduleViewMode('list')}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                            scheduleViewMode === 'list'
                              ? 'bg-white text-[#2563EB] shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Table2 className="h-3.5 w-3.5" />
                          <span>جدول</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setScheduleViewMode('weekly')}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                            scheduleViewMode === 'weekly'
                              ? 'bg-white text-[#2563EB] shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Calendar className="h-3.5 w-3.5" />
                          <span>أسبوعي</span>
                        </button>
                      </div>
                    </div>
                  }
                >
                  {filteredSchedules.length === 0 ? (
                    <AdminEmptyState
                      icon={<Calendar className="h-5 w-5" />}
                      title="لا توجد مواعيد مجدولة حاليًا"
                      description="اضغط على «إضافة موعد جديد» لإضافة حصة مباشرة أو موعد مراجعة للطلاب."
                    />
                  ) : scheduleViewMode === 'weekly' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 sm:hidden">
                        <span>اسحب أفقيًا للتنقل بين أيام الأسبوع</span>
                        <span className="font-mono-num tabular-nums">{filteredSchedules.length} موعد</span>
                      </div>
                      <div className="responsive-table-scroll flex snap-x snap-mandatory gap-3 pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
                        {schedulesByDay
                          .filter((col) => col.items.length > 0)
                          .map((col) => (
                            <div
                              key={col.dayLabel}
                              className="w-[82vw] max-w-[300px] shrink-0 snap-start rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 sm:w-auto sm:max-w-none"
                            >
                              <div className="flex items-center justify-between border-b border-slate-200/70 pb-1.5">
                                <span className="text-xs font-extrabold text-[#0F172A]">
                                  {col.dayLabel}
                                </span>
                                <span className="font-mono-num text-[11px] font-bold text-slate-400 tabular-nums">
                                  {col.items.length}
                                </span>
                              </div>
                              <div className="responsive-table-scroll mt-2 max-h-[380px] space-y-2 pl-0.5">
                                {col.items.map((s) => {
                                  const prov = PROVIDER_META[s.liveProvider] || {
                                    label: s.liveProvider,
                                    tone: 'slate' as const,
                                  };
                                  const isActive = selectedSchedule?.id === s.id;
                                  const isHidden = s.isPublished === false;
                                  return (
                                    <div
                                      key={s.id}
                                      className={`rounded-xl border p-2.5 transition-all ${
                                        isActive
                                          ? 'border-[#2563EB] bg-blue-50/70 shadow-xs'
                                          : 'border-slate-200 bg-white hover:border-blue-200'
                                      } ${isHidden ? 'opacity-80' : ''}`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => setSelectedScheduleId(s.id)}
                                        className="w-full text-right"
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-mono-num text-[11px] font-bold text-[#2563EB] tabular-nums">
                                            {getCairoTimeStr(s.scheduledAt)}
                                          </span>
                                          <AdminStatusBadge tone={isHidden ? 'amber' : prov.tone}>
                                            {isHidden ? 'مخفي' : prov.label}
                                          </AdminStatusBadge>
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-xs font-extrabold text-[#0F172A]">
                                          {s.titleAr}
                                        </div>
                                        <div className="mt-1 text-[10px] text-slate-500">
                                          {getCairoShortDate(s.scheduledAt)} ·{' '}
                                          {gradeNameMap.get(s.gradeId) || ''}
                                        </div>
                                      </button>
                                      <div className="mt-2 flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
                                        <button
                                          type="button"
                                          aria-label={`تعديل الموعد ${s.titleAr}`}
                                          onClick={() => openEditScheduleForm(s)}
                                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-[#2563EB]"
                                        >
                                          <Pencil className="h-3 w-3" />
                                          <span>تعديل</span>
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`حذف الموعد ${s.titleAr}`}
                                          onClick={() =>
                                            setDeleteTarget({
                                              kind: 'schedule',
                                              id: s.id,
                                              titleAr: s.titleAr,
                                              subtitle: `${gradeNameMap.get(s.gradeId) || ''} · ${formatDateTimeAr(s.scheduledAt)}`,
                                            })
                                          }
                                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-rose-600 hover:border-rose-300 hover:bg-rose-50"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                          <span>حذف</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Responsive Table Horizontal Scroll Helper Bar */}
                      {scheduleScrollState.hasOverflowX && (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-[11px] text-slate-600">
                          <span className="truncate font-semibold">
                            اسحب الجدول أفقيًا وعموديًا لعرض كافة الأعمدة والإجراءات
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label="تمرير الجدول لليمين"
                              disabled={!scheduleScrollState.canScrollStart}
                              onClick={() => scrollAdminScheduleTable('start')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-transform duration-150 hover:bg-slate-100 active:scale-95 disabled:opacity-35"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="تمرير الجدول لليسار"
                              disabled={!scheduleScrollState.canScrollEnd}
                              onClick={() => scrollAdminScheduleTable('end')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-transform duration-150 hover:bg-slate-100 active:scale-95 disabled:opacity-35"
                            >
                              <ChevronLeft
                                className={`h-4 w-4 ${
                                  !scheduleScrollState.isScrolledX && scheduleScrollState.canScrollEnd
                                    ? 'schedule-scroll-nudge'
                                    : ''
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white">
                        {/* GPU-accelerated horizontal scroll progress hairline */}
                        {scheduleScrollState.hasOverflowX && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute top-0 right-0 left-0 z-40 h-[2.5px] bg-slate-100/80"
                          >
                            <div
                              data-testid="admin-schedule-scroll-progress"
                              style={{
                                transform: `scaleX(${Math.max(0.14, scheduleScrollState.progressX)})`,
                              }}
                              className="schedule-progress-fill h-full w-full bg-gradient-to-l from-[#2563EB] to-[#60A5FA]"
                            />
                          </div>
                        )}

                        {/* Smooth left-edge horizontal scroll fade cue (RTL) */}
                        <div
                          aria-hidden="true"
                          className={`pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-8 bg-gradient-to-r from-white/95 via-white/55 to-transparent transition-opacity duration-200 ${
                            scheduleScrollState.hasMoreEndShadow ? 'opacity-100' : 'opacity-0'
                          }`}
                        />

                        {/* Smooth bottom-edge vertical scroll fade cue */}
                        <div
                          aria-hidden="true"
                          className={`pointer-events-none absolute right-0 bottom-0 left-0 z-30 h-7 bg-gradient-to-t from-white/95 via-white/50 to-transparent transition-opacity duration-200 ${
                            scheduleScrollState.hasMoreBottomShadow ? 'opacity-100' : 'opacity-0'
                          }`}
                        />

                        <div
                          ref={scheduleTableScrollRef}
                          onScroll={handleScheduleTableScroll}
                          tabIndex={0}
                          aria-label="جدول الحصص والمواعيد القابل للتمرير أفقيًا وعموديًا"
                          data-testid="admin-schedule-responsive-table"
                          data-scrolled-x={scheduleScrollState.isScrolledX ? 'true' : 'false'}
                          data-scrolled-y={scheduleScrollState.isScrolledY ? 'true' : 'false'}
                          className="responsive-table-scroll relative max-h-[60vh] sm:max-h-[480px] w-full bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        >
                          <table className="w-full min-w-[780px] border-separate border-spacing-0 text-right text-xs">
                            <thead>
                              <tr
                                className={`text-slate-600 transition-shadow duration-200 ${
                                  scheduleScrollState.isScrolledY
                                    ? 'shadow-[0_6px_14px_-8px_rgba(15,23,42,0.18)]'
                                    : ''
                                }`}
                              >
                                <th
                                  scope="col"
                                  className={`sticky top-0 right-0 z-30 min-w-[140px] max-w-[160px] sm:min-w-[205px] sm:max-w-[245px] border-b border-l border-slate-200 bg-slate-50 px-3 sm:px-3.5 py-3 font-bold whitespace-nowrap transition-shadow duration-200 ${
                                    scheduleScrollState.isScrolledX
                                      ? 'shadow-[-8px_0_16px_-8px_rgba(15,23,42,0.26)]'
                                      : 'shadow-[-3px_0_8px_-6px_rgba(15,23,42,0.12)]'
                                  }`}
                                >
                                  الحصة / الموعد
                                </th>
                                <th
                                  scope="col"
                                  className="sticky top-0 z-20 min-w-[160px] border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                                >
                                  الصف والمجموعة
                                </th>
                                <th
                                  scope="col"
                                  className="sticky top-0 z-20 min-w-[138px] border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                                >
                                  الموعد
                                </th>
                                <th
                                  scope="col"
                                  className="sticky top-0 z-20 min-w-[80px] border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                                >
                                  المدة
                                </th>
                                <th
                                  scope="col"
                                  className="sticky top-0 z-20 min-w-[90px] border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                                >
                                  الحالة
                                </th>
                                <th
                                  scope="col"
                                  className="sticky top-0 z-20 min-w-[195px] border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs px-3.5 py-3 font-bold whitespace-nowrap"
                                >
                                  الإجراءات
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {filteredSchedules.map((s, rowIdx) => {
                                const prov = PROVIDER_META[s.liveProvider] || {
                                  label: s.liveProvider,
                                  tone: 'slate' as const,
                                };
                                const isActive = selectedSchedule?.id === s.id;
                                const isHidden = s.isPublished === false;
                                const stickyCellBg = isActive
                                  ? 'bg-blue-50'
                                  : 'bg-white group-hover:bg-slate-50';
                                return (
                                  <tr
                                    key={s.id}
                                    onClick={() => setSelectedScheduleId(s.id)}
                                    style={{ animationDelay: `${getScheduleRowStaggerMs(rowIdx)}ms` }}
                                    className={`schedule-row-enter group cursor-pointer transition-colors duration-150 ${
                                      isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'
                                    }`}
                                  >
                                    <td
                                      className={`sticky right-0 z-10 min-w-[140px] max-w-[160px] sm:min-w-[205px] sm:max-w-[245px] border-b border-l border-slate-100 px-3 sm:px-3.5 py-3 transition-all duration-200 ${stickyCellBg} ${
                                        scheduleScrollState.isScrolledX
                                          ? 'shadow-[-8px_0_16px_-8px_rgba(15,23,42,0.22)]'
                                          : 'shadow-[-3px_0_8px_-6px_rgba(15,23,42,0.1)]'
                                      }`}
                                    >
                                      <div className="line-clamp-2 font-bold leading-snug text-[#0F172A]">
                                        {s.titleAr}
                                      </div>
                                      <div className="mt-1 text-[10.5px] font-medium text-slate-500">
                                        {SESSION_TYPE_LABELS[s.sessionType] || s.sessionType} · {prov.label}
                                      </div>
                                    </td>
                                    <td className="border-b border-slate-100 px-3.5 py-3 text-slate-700">
                                      <div className="font-semibold leading-snug">
                                        {gradeNameMap.get(s.gradeId) || '—'}
                                      </div>
                                      {s.groupId && groupNameMap.get(s.groupId) && (
                                        <div className="mt-0.5 text-[10.5px] font-bold text-[#2563EB]">
                                          {groupNameMap.get(s.groupId)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border-b border-slate-100 px-3.5 py-3 font-mono-num text-slate-600 whitespace-nowrap tabular-nums">
                                      {formatDateTimeAr(s.scheduledAt)}
                                    </td>
                                    <td className="border-b border-slate-100 px-3.5 py-3 font-mono-num text-slate-700 whitespace-nowrap tabular-nums">
                                      {s.durationMin} د
                                    </td>
                                    <td className="border-b border-slate-100 px-3.5 py-3 whitespace-nowrap">
                                      <AdminStatusBadge tone={isHidden ? 'amber' : 'emerald'}>
                                        {isHidden ? 'مخفي' : 'منشور'}
                                      </AdminStatusBadge>
                                    </td>
                                    <td
                                      className="border-b border-slate-100 px-3.5 py-3 whitespace-nowrap"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          aria-label={`تعديل الموعد ${s.titleAr}`}
                                          onClick={() => openEditScheduleForm(s)}
                                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition-transform duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-[#2563EB] active:scale-95 whitespace-nowrap shrink-0"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                          <span>تعديل</span>
                                        </button>
                                        <button
                                          type="button"
                                          disabled={togglingScheduleId === s.id}
                                          aria-label={isHidden ? `نشر الموعد ${s.titleAr}` : `إخفاء الموعد ${s.titleAr}`}
                                          title={isHidden ? 'إظهار للطلاب' : 'إخفاء عن الطلاب'}
                                          onClick={() => void handleToggleSchedulePublish(s)}
                                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-transform duration-150 hover:bg-slate-100 active:scale-95 disabled:opacity-50 shrink-0"
                                        >
                                          {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`حذف الموعد ${s.titleAr}`}
                                          onClick={() =>
                                            setDeleteTarget({
                                              kind: 'schedule',
                                              id: s.id,
                                              titleAr: s.titleAr,
                                              subtitle: `${gradeNameMap.get(s.gradeId) || ''} · ${formatDateTimeAr(s.scheduledAt)}`,
                                            })
                                          }
                                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 text-[11px] font-bold text-rose-700 transition-transform duration-150 hover:bg-rose-100 active:scale-95 whitespace-nowrap shrink-0"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                          <span>حذف</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </AdminCard>

                {/* Selected Session Detail Card */}
                {selectedSchedule && (
                  <AdminCard
                    title="تفاصيل الموعد المحدد"
                    headerAction={
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AdminStatusBadge tone={selectedSchedule.isPublished === false ? 'amber' : 'emerald'}>
                          {selectedSchedule.isPublished === false ? 'مخفي (مسودة)' : 'منشور للطلاب'}
                        </AdminStatusBadge>
                        <AdminStatusBadge
                          tone={
                            (PROVIDER_META[selectedSchedule.liveProvider] || { tone: 'slate' as const })
                              .tone
                          }
                        >
                          {(PROVIDER_META[selectedSchedule.liveProvider] || {
                            label: selectedSchedule.liveProvider,
                          }).label}
                        </AdminStatusBadge>
                      </div>
                    }
                  >
                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <h4 className="text-sm font-extrabold text-[#0F172A]">
                            {selectedSchedule.titleAr}
                          </h4>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span>{gradeNameMap.get(selectedSchedule.gradeId) || 'كل الصفوف'}</span>
                            {selectedSchedule.groupId && groupNameMap.get(selectedSchedule.groupId) && (
                              <>
                                <span>·</span>
                                <span className="font-bold text-[#2563EB]">
                                  {groupNameMap.get(selectedSchedule.groupId)}
                                </span>
                              </>
                            )}
                            <span>·</span>
                            <span>
                              {SESSION_TYPE_LABELS[selectedSchedule.sessionType] || selectedSchedule.sessionType}
                            </span>
                            <span>·</span>
                            <span>{formatDateTimeAr(selectedSchedule.scheduledAt)}</span>
                            <span>·</span>
                            <span className="font-mono-num">
                              المدة: {selectedSchedule.durationMin} دقيقة
                            </span>
                          </div>
                          {selectedSchedule.descriptionAr && (
                            <p className="pt-1 text-xs text-slate-600 leading-relaxed">
                              {selectedSchedule.descriptionAr}
                            </p>
                          )}
                        </div>

                        {selectedSchedule.joinUrl ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(selectedSchedule.joinUrl).catch(() => undefined);
                                onToast('تم نسخ رابط الحصة المباشرة');
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>نسخ الرابط</span>
                            </button>
                            <a
                              href={selectedSchedule.joinUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 text-xs font-bold text-white hover:bg-[#1D4ED8]"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>فتح رابط البث</span>
                            </a>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">لم يُضَف رابط بث لهذا الموعد بعد</span>
                        )}
                      </div>

                      {/* Full Control Bar: Edit / Toggle Publish / Delete */}
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5">
                        <button
                          type="button"
                          onClick={() => openEditScheduleForm(selectedSchedule)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 text-xs font-bold text-[#2563EB] hover:bg-blue-100/80"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>تعديل الموعد</span>
                        </button>
                        <button
                          type="button"
                          disabled={togglingScheduleId === selectedSchedule.id}
                          onClick={() => void handleToggleSchedulePublish(selectedSchedule)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {selectedSchedule.isPublished === false ? (
                            <>
                              <Eye className="h-3.5 w-3.5 text-emerald-600" />
                              <span>نشر للطلاب</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3.5 w-3.5 text-amber-600" />
                              <span>إخفاء مؤقتًا</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'schedule',
                              id: selectedSchedule.id,
                              titleAr: selectedSchedule.titleAr,
                              subtitle: `${gradeNameMap.get(selectedSchedule.gradeId) || ''} · ${formatDateTimeAr(selectedSchedule.scheduledAt)}`,
                            })
                          }
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>حذف الموعد</span>
                        </button>
                      </div>
                    </div>
                  </AdminCard>
                )}
              </div>
            )}
          </div>

          {/* In-App Delete Confirmation Modal (No browser window.confirm) */}
          {deleteTarget && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-schedule-dialog-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
              onClick={() => {
                if (!deletingTarget) setDeleteTarget(null);
              }}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-200">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      id="delete-schedule-dialog-title"
                      className="font-display text-base font-extrabold text-[#0F172A]"
                    >
                      {deleteTarget.kind === 'schedule'
                        ? 'تأكيد حذف الموعد'
                        : 'تأكيد حذف المجموعة الدراسية'}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      {deleteTarget.kind === 'schedule'
                        ? 'هل أنت متأكد من حذف هذا الموعد نهائيًا من الجدول؟ لن يظهر بعد الآن لدى الطلاب.'
                        : 'هل أنت متأكد من حذف هذه المجموعة الدراسية؟ ستبقى الحصص المجدولة محفوظة للطلاب دون حذفها.'}
                    </p>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                      <div className="text-xs font-extrabold text-[#0F172A]">
                        {deleteTarget.titleAr}
                      </div>
                      {deleteTarget.subtitle && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {deleteTarget.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={deletingTarget}
                    onClick={() => setDeleteTarget(null)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={deletingTarget}
                    onClick={() => void handleConfirmDelete()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{deletingTarget ? 'جارٍ الحذف...' : 'تأكيد الحذف'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== SCREEN 14: STUDENT QUESTIONS & NOTIFICATIONS ==================== */}
      {resolvedOpsView === 'comms' && (canComments || canBroadcast) && (
        <div className="space-y-5">
          <AdminPageHeader
            icon={<MessageSquare className="h-5 w-5" />}
            title="أسئلة الطلاب والإشعارات"
            subtitle="الرد على استفسارات الطلاب على الدروس وإرسال الإشعارات الجماعية المستهدفة للصفوف."
          />

          <AdminKpiGrid cols={3}>
            <AdminKpiCard
              label="إجمالي أسئلة الطلاب"
              value={allComments.length}
              subtitle="تعليقات واستفسارات الدروس"
              icon={<MessageSquare className="h-5 w-5" />}
              tone="blue"
            />
            <AdminKpiCard
              label="بانتظار الرد"
              value={unansweredCommentsCount}
              subtitle="أسئلة تحتاج إلى إجابة المدرس"
              icon={<Clock className="h-5 w-5" />}
              tone="amber"
            />
            <AdminKpiCard
              label="تم الرد عليها"
              value={answeredCommentsCount}
              subtitle="استفسارات مكتملة الإجابة"
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="emerald"
            />
          </AdminKpiGrid>

          <div className="grid gap-5 xl:grid-cols-12">
            {/* Right Column (4 cols): Questions List */}
            {canComments && (
              <div className="min-w-0 xl:col-span-4">
                <AdminCard
                  title="أسئلة وتعليقات الطلاب"
                  subtitle={`${filteredComments.length} سؤال مطابق`}
                  noPadding
                >
                  <div className="space-y-2.5 border-b border-slate-100 p-3.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={commentSearch}
                        onChange={(e) => setCommentSearch(e.target.value)}
                        placeholder="ابحث بالطالب أو الدرس أو نص السؤال..."
                        className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 pr-9 pl-3 text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      {(
                        [
                          { id: 'ALL', label: `الكل (${allComments.length})` },
                          { id: 'UNANSWERED', label: `بانتظار الرد (${unansweredCommentsCount})` },
                          { id: 'ANSWERED', label: `تم الرد (${answeredCommentsCount})` },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setCommentStatusFilter(opt.id)}
                          className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors ${
                            commentStatusFilter === opt.id
                              ? 'bg-[#2563EB] text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="max-h-[540px] divide-y divide-slate-100 overflow-y-auto">
                    {filteredComments.length === 0 ? (
                      <div className="p-6">
                        <AdminEmptyState
                          icon={<MessageSquare className="h-5 w-5" />}
                          title="لا توجد أسئلة مطابقة"
                          description="ستظهر هنا تعليقات واستفسارات الطلاب على الدروس فور إرسالها."
                        />
                      </div>
                    ) : (
                      filteredComments.map((c) => {
                        const isSelected = selectedComment?.id === c.id;
                        const isAnswered = Boolean(c.replyAr);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedCommentId(c.id)}
                            className={`w-full p-3.5 text-right transition-colors ${
                              isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-extrabold text-[#0F172A]">
                                  {c.authorName}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-[#2563EB]">
                                  {c.lessonTitleAr}
                                </div>
                              </div>
                              <AdminStatusBadge tone={isAnswered ? 'emerald' : 'amber'}>
                                {isAnswered ? 'تم الرد' : 'بانتظار الرد'}
                              </AdminStatusBadge>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{c.bodyAr}</p>
                            <div className="mt-1.5 text-[10px] text-slate-400">
                              {formatDateTimeAr(c.createdAt)}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </AdminCard>
              </div>
            )}

            {/* Center Column (5 cols): Selected Question Thread & Reply */}
            {canComments && (
              <div className={`min-w-0 ${canBroadcast ? 'xl:col-span-5' : 'xl:col-span-8'}`}>
                <AdminCard
                  title="تفاصيل السؤال والرد"
                  subtitle="يصل ردّك مباشرة للطالب على نفس الدرس"
                >
                  {!selectedComment ? (
                    <AdminEmptyState
                      icon={<MessageSquare className="h-5 w-5" />}
                      title="اختر سؤالًا لعرضه والرد عليه"
                      description="اختر أي استفسار من القائمة لعرض النص الكامل وإرسال رد المدرس."
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 font-display text-sm font-extrabold text-[#2563EB]">
                            {selectedComment.authorName.trim().charAt(0)}
                          </span>
                          <div>
                            <div className="text-sm font-extrabold text-[#0F172A]">
                              {selectedComment.authorName}
                            </div>
                            <div className="text-xs font-semibold text-slate-500">
                              الدرس: {selectedComment.lessonTitleAr}
                            </div>
                          </div>
                        </div>
                        <AdminStatusBadge tone={selectedComment.replyAr ? 'emerald' : 'amber'} dot>
                          {selectedComment.replyAr ? 'تم الرد' : 'بانتظار الرد'}
                        </AdminStatusBadge>
                      </div>

                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-bold text-slate-600">سؤال الطالب</span>
                          <span>{formatDateTimeAr(selectedComment.createdAt)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#0F172A]">
                          {selectedComment.bodyAr}
                        </p>
                      </div>

                      {selectedComment.replyAr && (
                        <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4">
                          <div className="text-[11px] font-extrabold text-[#2563EB]">
                            الرد المنشور حاليًا
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                            {selectedComment.replyAr}
                          </p>
                        </div>
                      )}

                      <div className="space-y-2.5 pt-1">
                        <label className="block text-xs font-extrabold text-slate-700">
                          {selectedComment.replyAr ? 'تعديل رد المدرس' : 'كتابة رد المدرس'}
                        </label>
                        <textarea
                          rows={4}
                          value={replyMap[selectedComment.id] ?? selectedComment.replyAr ?? ''}
                          onChange={(e) =>
                            setReplyMap({ ...replyMap, [selectedComment.id]: e.target.value })
                          }
                          placeholder="اكتب ردًا واضحًا ومفصلًا للطالب..."
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 focus:border-[#2563EB] focus:outline-none"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={sendingReply}
                            onClick={async () => {
                              const replyText = (
                                replyMap[selectedComment.id] ??
                                selectedComment.replyAr ??
                                ''
                              ).trim();
                              if (!replyText) {
                                onToast('يرجى كتابة نص الرد أولًا');
                                return;
                              }
                              setSendingReply(true);
                              try {
                                await apiRequest(`/api/admin/comments/${selectedComment.id}/reply`, {
                                  method: 'POST',
                                  body: JSON.stringify({ replyAr: replyText }),
                                });
                                onToast('تم حفظ وإرسال الرد على سؤال الطالب بنجاح');
                                await loadData();
                              } catch (err) {
                                onToast((err as Error).message);
                              } finally {
                                setSendingReply(false);
                              }
                            }}
                            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#2563EB] px-5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>{sendingReply ? 'جارٍ الإرسال...' : 'إرسال الرد'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </AdminCard>
              </div>
            )}

            {/* Left Column (3 cols): Broadcast Notification Composer */}
            {canBroadcast && (
              <div className={`min-w-0 ${canComments ? 'xl:col-span-3' : 'xl:col-span-12'}`}>
                <AdminCard
                  title="إرسال إشعار جماعي"
                  subtitle="تنبيه فوري داخل جرس الإشعارات لدى الطلاب"
                >
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSendingBroadcast(true);
                      try {
                        await apiRequest('/api/admin/notifications/broadcast', {
                          method: 'POST',
                          body: JSON.stringify({
                            gradeId: broadcastForm.gradeId || null,
                            titleAr: broadcastForm.titleAr,
                            bodyAr: broadcastForm.bodyAr,
                          }),
                        });
                        setBroadcastForm({ gradeId: 0, titleAr: '', bodyAr: '' });
                        onToast('تم إرسال الإشعار للطلاب المستهدفين بنجاح');
                      } catch (err) {
                        onToast((err as Error).message);
                      } finally {
                        setSendingBroadcast(false);
                      }
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        الفئة المستهدفة
                      </label>
                      <select
                        value={broadcastForm.gradeId}
                        onChange={(e) =>
                          setBroadcastForm({ ...broadcastForm, gradeId: Number(e.target.value) })
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                      >
                        <option value={0}>جميع طلاب المنصة</option>
                        {catalog.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            طلاب {g.nameAr} فقط
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        عنوان الإشعار
                      </label>
                      <input
                        type="text"
                        required
                        value={broadcastForm.titleAr}
                        onChange={(e) =>
                          setBroadcastForm({ ...broadcastForm, titleAr: e.target.value })
                        }
                        placeholder="مثال: موعد الامتحان الأسبوعي"
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        نص التنبيه
                      </label>
                      <textarea
                        rows={4}
                        required
                        value={broadcastForm.bodyAr}
                        onChange={(e) =>
                          setBroadcastForm({ ...broadcastForm, bodyAr: e.target.value })
                        }
                        placeholder="اكتب محتوى التنبيه أو الموعد المهم..."
                        className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] font-semibold text-blue-800">
                      سيصل الإشعار فورًا إلى:{' '}
                      <strong>
                        {broadcastForm.gradeId
                          ? `طلاب ${gradeNameMap.get(broadcastForm.gradeId) || 'الصف المحدد'}`
                          : 'جميع طلاب المنصة'}
                      </strong>
                    </div>

                    <button
                      type="submit"
                      disabled={sendingBroadcast}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white transition-colors hover:bg-[#2563EB] disabled:opacity-60"
                    >
                      <Bell className="h-4 w-4" />
                      <span>{sendingBroadcast ? 'جارٍ الإرسال...' : 'إرسال الإشعار الآن'}</span>
                    </button>
                  </form>
                </AdminCard>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SCREEN 16: PLATFORM SETTINGS & CMS ==================== */}
      {resolvedOpsView === 'cms' && canCms && (
        <form onSubmit={handleSaveSettings} className="space-y-5">
          <AdminPageHeader
            icon={<Settings className="h-5 w-5" />}
            title="إعدادات المنصة"
            subtitle="التحكم في الهوية والصفحة الرئيسية وبيانات التواصل وبوابات الدفع ووضع الصيانة فورًا."
            actions={
              <>
                {hasUnsavedCms && (
                  <>
                    <AdminStatusBadge tone="amber" dot>
                      توجد تعديلات غير محفوظة
                    </AdminStatusBadge>
                    <button
                      type="button"
                      onClick={() => setCmsDraft(settings)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>تراجع</span>
                    </button>
                  </>
                )}
                <button
                  type="submit"
                  disabled={savingCms}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#2563EB] px-5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  <span>{savingCms ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</span>
                </button>
              </>
            }
          />

          <AdminSegmentedTabs
            activeId={settingsTab}
            onChange={setSettingsTab}
            items={[
              { id: 'all', label: 'كل الإعدادات' },
              { id: 'identity', label: 'الهوية والصفحة الرئيسية' },
              { id: 'contact', label: 'التواصل وبوابات الدفع' },
              { id: 'maintenance', label: 'وضع الصيانة' },
            ]}
          />

          <AdminMasterDetail
            main={
              <div className="space-y-5">
                {(settingsTab === 'all' || settingsTab === 'identity') && (
                  <AdminCard
                    title="الهوية والصفحة الرئيسية"
                    subtitle="البيانات التي تظهر للزوار والطلاب في الهيدر والصفحة الرئيسية."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          اسم المنصة
                        </label>
                        <input
                          type="text"
                          value={cmsDraft.platformName}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, platformName: e.target.value })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          اسم المدرس
                        </label>
                        <input
                          type="text"
                          value={cmsDraft.teacherName}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, teacherName: e.target.value })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          عنوان Hero الرئيسي
                        </label>
                        <input
                          type="text"
                          value={cmsDraft.heroHeadline}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, heroHeadline: e.target.value })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          نبذة عن المدرس
                        </label>
                        <textarea
                          rows={3}
                          value={cmsDraft.teacherBio}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, teacherBio: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                    </div>
                  </AdminCard>
                )}

                {(settingsTab === 'all' || settingsTab === 'contact') && (
                  <AdminCard
                    title="التواصل وبوابات الدفع"
                    subtitle="أرقام التواصل والتحويل التي تظهر للطلاب عند طلب الاشتراك."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          هاتف التواصل / الدعم
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          value={cmsDraft.contactPhone}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, contactPhone: e.target.value })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          رقم فودافون كاش
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          value={cmsDraft.paymentConfig.vodafoneCashNumber}
                          onChange={(e) =>
                            setCmsDraft({
                              ...cmsDraft,
                              paymentConfig: {
                                ...cmsDraft.paymentConfig,
                                vodafoneCashNumber: e.target.value,
                              },
                            })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left font-mono-num text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          عنوان InstaPay
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          value={cmsDraft.paymentConfig.instaPayHandle}
                          onChange={(e) =>
                            setCmsDraft({
                              ...cmsDraft,
                              paymentConfig: {
                                ...cmsDraft.paymentConfig,
                                instaPayHandle: e.target.value,
                              },
                            })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-left text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">
                          بيانات الحساب البنكي
                        </label>
                        <input
                          type="text"
                          value={cmsDraft.paymentConfig.bankAccountInfo}
                          onChange={(e) =>
                            setCmsDraft({
                              ...cmsDraft,
                              paymentConfig: {
                                ...cmsDraft.paymentConfig,
                                bankAccountInfo: e.target.value,
                              },
                            })
                          }
                          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                    </div>
                  </AdminCard>
                )}

                {(settingsTab === 'all' || settingsTab === 'maintenance') && (
                  <AdminCard
                    title="وضع الصيانة"
                    subtitle="إغلاق مؤقت للزوار والطلاب مع استمرار عمل لوحة الإدارة."
                  >
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm font-bold text-amber-950">
                        <input
                          type="checkbox"
                          checked={cmsDraft.maintenanceMode}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, maintenanceMode: e.target.checked })
                          }
                          className="mt-1 h-4 w-4 rounded border-amber-400 text-amber-600"
                        />
                        <span>
                          تفعيل وضع الصيانة (يُغلق الموقع مؤقتًا أمام الزوار مع بقاء لوحة الإدارة مفتوحة)
                        </span>
                      </label>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-amber-900">
                          رسالة وضع الصيانة للطلاب
                        </label>
                        <input
                          type="text"
                          value={cmsDraft.maintenanceMessage}
                          onChange={(e) =>
                            setCmsDraft({ ...cmsDraft, maintenanceMessage: e.target.value })
                          }
                          placeholder="نقوم حاليًا بتحديث المنصة، سنعود خلال دقائق..."
                          className="h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-xs focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </AdminCard>
                )}
              </div>
            }
            detail={
              <div className="space-y-4">
                <AdminCard title="معاينة الهوية الحية" subtitle="تحديث فوري قبل الحفظ">
                  <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0D172B] via-[#132347] to-[#1D4ED8] p-4 text-white">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sky-200">
                        <Atom className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-display text-sm font-extrabold">
                          {cmsDraft.platformName || 'اسم المنصة'}
                        </div>
                        <div className="truncate text-[11px] text-sky-200/90">
                          {cmsDraft.teacherName || 'اسم المدرس'}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-bold leading-relaxed text-white/95">
                      {cmsDraft.heroHeadline || 'عنوان الصفحة الرئيسية'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5 text-[11px] text-sky-100">
                      <span className="inline-flex items-center gap-1 font-mono-num" dir="ltr">
                        <Phone className="h-3 w-3" />
                        {cmsDraft.contactPhone || '—'}
                      </span>
                    </div>
                  </div>

                  {onPreviewStudentPortal && (
                    <button
                      type="button"
                      onClick={onPreviewStudentPortal}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5 text-[#2563EB]" />
                      <span>معاينة الصفحة الرئيسية</span>
                    </button>
                  )}
                </AdminCard>

                <AdminCard title="حالة تشغيل المنصة">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">حالة الوصول للطلاب</span>
                      {cmsDraft.maintenanceMode ? (
                        <AdminStatusBadge tone="amber" dot>
                          وضع الصيانة مفعّل
                        </AdminStatusBadge>
                      ) : (
                        <AdminStatusBadge tone="emerald" dot>
                          المنصة متاحة وتعمل
                        </AdminStatusBadge>
                      )}
                    </div>
                    {cmsDraft.maintenanceMode ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <span>
                          {cmsDraft.maintenanceMessage ||
                            'سيظهر للطلاب إشعار الصيانة بمجرد حفظ الإعدادات.'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-xs text-emerald-800">
                        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>جميع بوابات الطلاب والزوار مفتوحة وتعمل بشكل طبيعي.</span>
                      </div>
                    )}
                  </div>
                </AdminCard>
              </div>
            }
          />
        </form>
      )}

      {/* ==================== LEGACY DEVICES FALLBACK ==================== */}
      {resolvedOpsView === 'devices' && (
        <ActiveDevicesPanel
          adminLayout
          onToast={onToast}
          onLoggedOutCurrent={async () => {
            if (onLogout) await onLogout();
          }}
        />
      )}

      {/* ==================== SCREEN 17: TEAM, PERMISSIONS, BACKUP & AUDIT LOGS ==================== */}
      {resolvedOpsView === 'security' && canSecurityTab && (
        <div className="space-y-5">
          <AdminPageHeader
            icon={
              securitySubTab === 'audit' ? (
                <Database className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )
            }
            title={
              securitySubTab === 'audit'
                ? 'النسخ الاحتياطي وسجل التدقيق'
                : securitySubTab === 'backup'
                  ? 'النسخ الاحتياطي الآمن'
                  : 'الفريق والصلاحيات'
            }
            subtitle="إدارة حسابات الفريق والأدوار الوظيفية والنسخ الاحتياطي الآمن ومراجعة سجل التدقيق الإداري."
            actions={
              canBackups ? (
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#2563EB]"
                >
                  <Download className="h-4 w-4" />
                  <span>تصدير نسخة احتياطية JSON</span>
                </button>
              ) : undefined
            }
          />

          <AdminKpiGrid cols={3}>
            <AdminKpiCard
              label="إجمالي أعضاء الفريق"
              value={allStaff.length}
              subtitle="حسابات الإدارة والمساعدين"
              icon={<Shield className="h-5 w-5" />}
              tone="blue"
            />
            <AdminKpiCard
              label="الحسابات النشطة"
              value={activeStaffCount}
              subtitle="حسابات مفعّلة حاليًا"
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="emerald"
            />
            <AdminKpiCard
              label={canStaff ? 'الحسابات الموقوفة' : 'سجلات التدقيق'}
              value={canStaff ? suspendedStaffCount : allAuditLogs.length}
              subtitle={canStaff ? 'حسابات موقوفة مؤقتًا' : 'أحدث العمليات الإدارية المسجّلة'}
              icon={canStaff ? <AlertTriangle className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
              tone={canStaff && suspendedStaffCount > 0 ? 'amber' : 'slate'}
            />
          </AdminKpiGrid>

          <AdminSegmentedTabs
            activeId={securitySubTab}
            onChange={setSecuritySubTab}
            items={[
              ...(canStaff
                ? [{ id: 'staff' as const, label: 'الفريق والصلاحيات', count: allStaff.length }]
                : []),
              ...(canBackups ? [{ id: 'backup' as const, label: 'النسخ الاحتياطي' }] : []),
              ...(canAudit
                ? [{ id: 'audit' as const, label: 'سجل التدقيق', count: allAuditLogs.length }]
                : []),
            ]}
          />

          <AdminMasterDetail
            main={
              <div className="space-y-5">
                {securitySubTab === 'staff' && canStaff && (
                  <>
                    <AdminStaffPanel
                      staff={allStaff}
                      currentUser={currentUser}
                      onRefresh={loadData}
                      onToast={onToast}
                      embedded
                    />

                    {canAudit && allAuditLogs.length > 0 && (
                      <AdminCard
                        title="آخر سجلات التدقيق"
                        headerAction={
                          <button
                            type="button"
                            onClick={() => setSecuritySubTab('audit')}
                            className="text-xs font-bold text-[#2563EB] hover:underline"
                          >
                            عرض السجل الكامل ({allAuditLogs.length})
                          </button>
                        }
                        noPadding
                      >
                        <div className="overflow-x-auto">
                          <table className="w-full text-right text-xs">
                            <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                              <tr>
                                <th className="px-4 py-2.5 font-bold">التوقيت</th>
                                <th className="px-4 py-2.5 font-bold">المسؤول</th>
                                <th className="px-4 py-2.5 font-bold">العملية</th>
                                <th className="px-4 py-2.5 font-bold">الكيان</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {allAuditLogs.slice(0, 6).map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50/60">
                                  <td className="px-4 py-2.5 text-slate-500">
                                    {formatDateTimeAr(log.createdAt)}
                                  </td>
                                  <td className="px-4 py-2.5 font-bold text-[#0F172A]">
                                    {log.actorName}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className="rounded-md bg-blue-50 px-2 py-0.5 font-mono-num text-[11px] font-bold text-[#2563EB]">
                                      {log.action}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-600">
                                    {log.entityType} {log.entityId ? `#${log.entityId}` : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </AdminCard>
                    )}
                  </>
                )}

                {securitySubTab === 'backup' && canBackups && (
                  <AdminCard
                    title="النسخ الاحتياطي الآمن لقاعدة البيانات"
                    subtitle="تصدير فوري لملف JSON منظم مع حماية البيانات السرية"
                  >
                    <div className="space-y-4">
                      <p className="text-xs leading-relaxed text-slate-600">
                        يشمل التصدير بيانات المسارات والصفوف والوحدات والدروس والفيديوهات والكورسات والامتحانات والإعدادات بصيغة JSON، مع استبعاد كلمات المرور وهاشات الأكواد والجلسات تلقائيًا لأغراض الأمان.
                      </p>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-xs text-slate-600 space-y-1.5">
                        <div className="font-bold text-[#0F172A]">ملاحظة أمنية:</div>
                        <p>
                          يُنصح بالاحتفاظ بنسخة احتياطية دورية قبل إجراء أي تعديلات واسعة على المحتوى أو الإعدادات.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleExportBackup}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#2563EB] px-5 text-xs font-bold text-white shadow-sm hover:bg-[#1D4ED8]"
                      >
                        <Download className="h-4 w-4" />
                        <span>تصدير نسخة احتياطية JSON الآن</span>
                      </button>
                    </div>
                  </AdminCard>
                )}

                {securitySubTab === 'audit' && canAudit && (
                  <div className="space-y-4">
                    <AdminFilterBar
                      searchValue={auditSearch}
                      onSearchChange={(v) => {
                        setAuditSearch(v);
                        setAuditPage(1);
                      }}
                      searchPlaceholder="ابحث بالمسؤول أو نوع العملية أو الكيان..."
                      onReset={
                        auditSearch || auditActorFilter !== 'ALL'
                          ? () => {
                              setAuditSearch('');
                              setAuditActorFilter('ALL');
                              setAuditPage(1);
                            }
                          : undefined
                      }
                    >
                      <select
                        aria-label="تصفية حسب المسؤول"
                        value={auditActorFilter}
                        onChange={(e) => {
                          setAuditActorFilter(e.target.value);
                          setAuditPage(1);
                        }}
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                      >
                        <option value="ALL">كل المسؤولين</option>
                        {uniqueAuditActors.map((actor) => (
                          <option key={actor} value={actor}>
                            {actor}
                          </option>
                        ))}
                      </select>
                    </AdminFilterBar>

                    <AdminCard
                      title="سجل التدقيق الأمني والإداري"
                      subtitle={`${filteredAuditLogs.length} عملية مسجّلة`}
                      noPadding
                    >
                      {pagedAuditLogs.length === 0 ? (
                        <div className="p-6">
                          <AdminEmptyState
                            icon={<Database className="h-5 w-5" />}
                            title="لا توجد سجلات مطابقة"
                            description="جرّب تعديل كلمات البحث أو الفلتر لعرض العمليات المسجّلة."
                          />
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-right text-xs">
                              <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                                <tr>
                                  <th className="px-4 py-3 font-bold">التوقيت</th>
                                  <th className="px-4 py-3 font-bold">المسؤول</th>
                                  <th className="px-4 py-3 font-bold">العملية</th>
                                  <th className="px-4 py-3 font-bold">الكيان</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {pagedAuditLogs.map((log) => (
                                  <tr key={log.id} className="hover:bg-slate-50/60">
                                    <td className="px-4 py-2.5 text-slate-500">
                                      {formatDateTimeAr(log.createdAt)}
                                    </td>
                                    <td className="px-4 py-2.5 font-bold text-[#0F172A]">
                                      {log.actorName}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <span className="rounded-md bg-blue-50 px-2 py-0.5 font-mono-num text-[11px] font-bold text-[#2563EB]">
                                        {log.action}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-600">
                                      {log.entityType} {log.entityId ? `#${log.entityId}` : ''}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {totalAuditPages > 1 && (
                            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs">
                              <span className="text-slate-500">
                                صفحة <strong className="font-mono-num">{safeAuditPage}</strong> من{' '}
                                <strong className="font-mono-num">{totalAuditPages}</strong>
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={safeAuditPage <= 1}
                                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                                  className="rounded-lg border border-slate-200 px-3 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  السابق
                                </button>
                                <button
                                  type="button"
                                  disabled={safeAuditPage >= totalAuditPages}
                                  onClick={() =>
                                    setAuditPage((p) => Math.min(totalAuditPages, p + 1))
                                  }
                                  className="rounded-lg border border-slate-200 px-3 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  التالي
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </AdminCard>
                  </div>
                )}
              </div>
            }
            detail={
              <div className="space-y-4">
                <AdminCard title="الأدوار الوظيفية المتاحة" subtitle="ملخص صلاحيات النظام (RBAC)">
                  <div className="space-y-2.5">
                    {ROLE_SUMMARY_CARDS.map((role) => (
                      <div
                        key={role.slug}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 space-y-1.5"
                      >
                        <AdminStatusBadge tone={role.badgeTone}>{role.title}</AdminStatusBadge>
                        <p className="text-[11px] leading-relaxed text-slate-600">{role.desc}</p>
                      </div>
                    ))}
                  </div>
                </AdminCard>

                {canBackups && (
                  <AdminCard title="النسخ الاحتياطي السريع" subtitle="تصدير آمن بصيغة JSON">
                    <p className="text-xs leading-relaxed text-slate-600">
                      تصدير فوري لبيانات المنهج والامتحانات والإعدادات مع استبعاد كلمات المرور والأسرار تلقائيًا.
                    </p>
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] px-3 text-xs font-bold text-white transition-colors hover:bg-[#2563EB]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>تنزيل نسخة احتياطية</span>
                    </button>
                  </AdminCard>
                )}
              </div>
            }
          />
        </div>
      )}
    </div>
  );
};
