import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CreditCard,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Plus,
  Settings,
  Share2,
  X,
} from 'lucide-react';
import { apiRequest, formatDateAr, formatDateTimeAr } from '../lib/api.ts';
import {
  evaluateWeekSummary,
  resolveCurrentCurriculumWeek,
  type EvaluatedCurriculumTask,
} from '../lib/academicPlanEngine.ts';
import {
  goBackInLms,
  parseHashToNavState,
  pushLmsHistoryState,
  type AppNavHistoryState,
} from '../lib/navigationHistory.ts';
import {
  buildStudentAcademicSignals,
  resolveStudentExamStatus,
} from '../lib/studentAcademicSignals.ts';
import type { StudentNavTarget } from '../lib/studentDashboardMetrics.ts';
import type {
  BootstrapResponse,
  MeResponse,
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../types/lms.ts';
import type { VideoProgressUpdatePayload } from './SecureVideoPlayer.tsx';
import { StudentSidebar } from './student/StudentSidebar.tsx';
import { StudentTopBar } from './student/StudentTopBar.tsx';
import { StudentDashboardHome } from './student/StudentDashboardHome.tsx';
import { StudentSectionHeader } from './student/StudentUiPrimitives.tsx';

const loadSecureVideoPlayer = () =>
  import('./SecureVideoPlayer.tsx').then((m) => ({ default: m.SecureVideoPlayer }));
const loadExamRunner = () =>
  import('./ExamRunner.tsx').then((m) => ({ default: m.ExamRunner }));
const loadStudentCurriculumView = () =>
  import('./student/StudentCurriculumView.tsx').then((m) => ({ default: m.StudentCurriculumView }));
const loadStudentCoursesView = () =>
  import('./student/StudentCoursesView.tsx').then((m) => ({ default: m.StudentCoursesView }));
const loadStudentVideoLibraryView = () =>
  import('./student/StudentVideoLibraryView.tsx').then((m) => ({
    default: m.StudentVideoLibraryView,
  }));
const loadStudentPracticeView = () =>
  import('./student/StudentPracticeView.tsx').then((m) => ({ default: m.StudentPracticeView }));
const loadStudentPdfLibraryView = () =>
  import('./student/StudentPdfLibraryView.tsx').then((m) => ({ default: m.StudentPdfLibraryView }));
const loadStudentScheduleView = () =>
  import('./student/StudentScheduleView.tsx').then((m) => ({ default: m.StudentScheduleView }));
const loadStudentExamsHub = () =>
  import('./StudentExamsHub.tsx').then((m) => ({ default: m.StudentExamsHub }));
const loadStudentHomeworkHub = () =>
  import('./StudentHomeworkHub.tsx').then((m) => ({ default: m.StudentHomeworkHub }));
const loadStudentHomeworkModal = () =>
  import('./StudentHomeworkModal.tsx').then((m) => ({ default: m.StudentHomeworkModal }));
const loadStudentResultsPanel = () =>
  import('./StudentResultsPanel.tsx').then((m) => ({ default: m.StudentResultsPanel }));
const loadActiveDevicesPanel = () =>
  import('./ActiveDevicesPanel.tsx').then((m) => ({ default: m.ActiveDevicesPanel }));

const SecureVideoPlayer = lazy(loadSecureVideoPlayer);
const ExamRunner = lazy(loadExamRunner);
const StudentCurriculumView = lazy(loadStudentCurriculumView);
const StudentCoursesView = lazy(loadStudentCoursesView);
const StudentVideoLibraryView = lazy(loadStudentVideoLibraryView);
const StudentPracticeView = lazy(loadStudentPracticeView);
const StudentPdfLibraryView = lazy(loadStudentPdfLibraryView);
const StudentScheduleView = lazy(loadStudentScheduleView);
const StudentExamsHub = lazy(loadStudentExamsHub);
const StudentHomeworkHub = lazy(loadStudentHomeworkHub);
const StudentHomeworkModal = lazy(loadStudentHomeworkModal);
const StudentResultsPanel = lazy(loadStudentResultsPanel);
const ActiveDevicesPanel = lazy(loadActiveDevicesPanel);

const STUDENT_TAB_PRELOADERS: Partial<Record<StudentNavTarget, () => Promise<unknown>>> = {
  curriculum: loadStudentCurriculumView,
  courses: loadStudentCoursesView,
  library: loadStudentVideoLibraryView,
  free: loadStudentVideoLibraryView,
  paid: loadStudentVideoLibraryView,
  practice: loadStudentPracticeView,
  pdfs: loadStudentPdfLibraryView,
  schedule: loadStudentScheduleView,
  exams: loadStudentExamsHub,
  homework: loadStudentHomeworkHub,
  results: loadStudentResultsPanel,
  devices: loadActiveDevicesPanel,
};

const VALID_STUDENT_TABS = new Set<StudentNavTarget>([
  'overview',
  'curriculum',
  'library',
  'free',
  'paid',
  'courses',
  'exams',
  'homework',
  'results',
  'pdfs',
  'schedule',
  'billing',
  'devices',
  'practice',
  'settings',
]);

const StudentTabFallback: React.FC = () => (
  <div className="rounded-2xl border border-[#2D4A8A]/45 bg-[#0A1636]/90 p-10 text-center text-xs font-bold text-slate-300">
    جارٍ تحميل القسم...
  </div>
);

type StudentTab = StudentNavTarget;

interface StudentDashboardProps {
  bootstrap: BootstrapResponse;
  me: MeResponse;
  initialGradeId?: number;
  onRefreshMe: () => Promise<void>;
  onLogout: () => Promise<void>;
  onOpenParentReport: (code: string) => void;
  onOpenAdmin?: () => void;
  onBackHome: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  bootstrap,
  me,
  initialGradeId,
  onRefreshMe,
  onLogout,
  onOpenParentReport,
  onOpenAdmin,
  onBackHome,
}) => {
  const approvedEnrollments = me.enrollments.filter((e) => e.status === 'ACTIVE');
  const [selectedGradeId, setSelectedGradeId] = useState<number>(
    initialGradeId || approvedEnrollments[0]?.gradeId || 0,
  );

  // Restore initial tab & sub-state from URL hash (#student/...)
  const initialNav = useMemo(() => parseHashToNavState(window.location.hash), []);
  const [tab, setTabState] = useState<StudentTab>(() => {
    const t = initialNav?.studentTab as StudentTab | undefined;
    return t && VALID_STUDENT_TABS.has(t) ? t : 'overview';
  });
  const [visitedTabs, setVisitedTabs] = useState<Set<StudentTab>>(() => new Set(['overview', tab]));
  const [examSessionKey, setExamSessionKey] = useState(0);
  const [homeworkSessionKey, setHomeworkSessionKey] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Active sub-views & deep-linked focus state
  const [playingVideo, setPlayingVideo] = useState<StudentVideoItem | null>(null);
  const [activeExamId, setActiveExamId] = useState<number | null>(initialNav?.examId ?? null);
  const [activeHomeworkId, setActiveHomeworkId] = useState<number | null>(
    initialNav?.homeworkId ?? null,
  );
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(
    initialNav?.courseId ?? null,
  );
  const [curriculumWeekId, setCurriculumWeekId] = useState<number | null>(
    initialNav?.curriculumWeekId ?? null,
  );
  const [curriculumFilter, setCurriculumFilter] = useState<'ALL' | 'CURRENT' | 'OVERDUE'>(
    initialNav?.curriculumFilter === 'OVERDUE' ? 'OVERDUE' : 'ALL',
  );
  const [selectedResultExamId, setSelectedResultExamId] = useState<number | null>(null);
  const [selectedPdfLessonId, setSelectedPdfLessonId] = useState<number | null>(null);
  const [selectedScheduleSessionId, setSelectedScheduleSessionId] = useState<number | null>(null);

  // Optimistic manual task review progress overrides
  const [manualReviewOverrides, setManualReviewOverrides] = useState<
    Record<number, { isReviewed: boolean; reviewedAt: string | null }>
  >({});
  const [togglingTaskId, setTogglingTaskId] = useState<number | null>(null);

  // Modals
  const [codeInput, setCodeInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<{
    targetType: 'VIDEO' | 'COURSE' | 'PLAN';
    targetId: number;
    titleAr: string;
    priceEgp: number;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'BANK_TRANSFER' | 'WALLET' | 'PAYMOB' | 'FAWRY'>('WALLET');
  const [couponCode, setCouponCode] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Request additional grade modal
  const [gradeModalOpen, setGradeModalOpen] = useState(false);
  const [reqTrackId, setReqTrackId] = useState<number>(bootstrap.tracks[0]?.id || 0);
  const reqGrades = bootstrap.tracks.find((t) => t.id === reqTrackId)?.grades || [];
  const [reqGradeId, setReqGradeId] = useState<number>(reqGrades[0]?.id || 0);

  // Notifications drawer
  const [notifOpen, setNotifOpen] = useState(false);

  const dataRef = useRef<StudentDashboardData | null>(null);
  dataRef.current = data;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4500);
  }, []);

  // Push unified student navigation state into browser history (#11)
  const syncStudentHistory = useCallback(
    (
      next: {
        studentTab: StudentTab;
        videoId?: number | null;
        courseId?: number | null;
        homeworkId?: number | null;
        examId?: number | null;
        curriculumWeekId?: number | null;
        curriculumFilter?: 'ALL' | 'OVERDUE' | null;
      },
      mode: 'push' | 'replace' = 'push',
    ) => {
      pushLmsHistoryState(
        {
          screen: 'dashboard',
          studentTab: next.studentTab,
          videoId: next.videoId ?? null,
          courseId: next.courseId ?? null,
          homeworkId: next.homeworkId ?? null,
          examId: next.examId ?? null,
          curriculumWeekId: next.curriculumWeekId ?? null,
          curriculumFilter: next.curriculumFilter ?? null,
        },
        mode,
      );
    },
    [],
  );

  const setTab = useCallback(
    (next: StudentTab, pushHistory = true) => {
      setTabState(next);
      setVisitedTabs((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
      if (next !== 'courses') setSelectedCourseId(null);
      if (pushHistory) {
        syncStudentHistory({
          studentTab: next,
          curriculumWeekId: next === 'curriculum' ? curriculumWeekId : null,
          curriculumFilter:
            next === 'curriculum' && curriculumFilter === 'OVERDUE' ? 'OVERDUE' : null,
        });
      }
    },
    [syncStudentHistory, curriculumWeekId, curriculumFilter],
  );

  const openVideoOverlay = useCallback(
    (video: StudentVideoItem, pushHistory = true) => {
      void loadSecureVideoPlayer().catch(() => {});
      setActiveExamId(null);
      setActiveHomeworkId(null);
      setPlayingVideo(video);
      if (pushHistory) {
        syncStudentHistory({ studentTab: tab, videoId: video.id });
      }
    },
    [tab, syncStudentHistory],
  );

  const openExamOverlay = useCallback(
    (examId: number, pushHistory = true) => {
      void loadExamRunner().catch(() => {});
      setPlayingVideo(null);
      setActiveHomeworkId(null);
      setActiveExamId(examId);
      if (pushHistory) {
        syncStudentHistory({ studentTab: tab, examId });
      }
    },
    [tab, syncStudentHistory],
  );

  const openHomeworkOverlay = useCallback(
    (homeworkId: number, pushHistory = true) => {
      void loadStudentHomeworkModal().catch(() => {});
      setPlayingVideo(null);
      setActiveExamId(null);
      setActiveHomeworkId(homeworkId);
      if (pushHistory) {
        syncStudentHistory({ studentTab: tab, homeworkId });
      }
    },
    [tab, syncStudentHistory],
  );

  // Sync browser Back / Forward across tabs & overlays (#11) — never logs out!
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state =
        (event.state as Partial<AppNavHistoryState> | null) ||
        parseHashToNavState(window.location.hash);

      if (!state || state.__lmsGuard || state.screen !== 'dashboard' || state.adminTab) {
        return;
      }

      const targetTab = (state.studentTab as StudentTab) || 'overview';
      const safeTab: StudentTab = VALID_STUDENT_TABS.has(targetTab) ? targetTab : 'overview';
      setTabState(safeTab);
      setVisitedTabs((prev) => (prev.has(safeTab) ? prev : new Set(prev).add(safeTab)));
      setNotifOpen(false);
      setMobileSidebarOpen(false);
      setCheckoutTarget(null);
      setGradeModalOpen(false);

      // Restore overlays cleanly (closing any overlay not present in popped history entry)
      if (state.videoId && dataRef.current) {
        const vid = dataRef.current.videos.find((v) => v.id === state.videoId && v.hasAccess);
        setPlayingVideo(vid || null);
      } else {
        setPlayingVideo(null);
      }

      setActiveExamId(state.examId ?? null);
      setActiveHomeworkId(state.homeworkId ?? null);
      setSelectedCourseId(state.courseId ?? null);
      setCurriculumWeekId(state.curriculumWeekId ?? null);
      setCurriculumFilter(state.curriculumFilter === 'OVERDUE' ? 'OVERDUE' : 'ALL');
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Ensure initial dashboard history entry is normalized once mounted
  useEffect(() => {
    syncStudentHistory(
      {
        studentTab: tab,
        examId: activeExamId,
        homeworkId: activeHomeworkId,
        courseId: selectedCourseId,
        curriculumWeekId,
        curriculumFilter: curriculumFilter === 'OVERDUE' ? 'OVERDUE' : null,
      },
      'replace',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preloadedTabsRef = useRef<Set<StudentTab>>(new Set());
  const preloadTabChunk = useCallback((tabId: StudentTab) => {
    if (preloadedTabsRef.current.has(tabId)) return;
    const loader = STUDENT_TAB_PRELOADERS[tabId];
    if (loader) {
      preloadedTabsRef.current.add(tabId);
      void loader().catch(() => {
        preloadedTabsRef.current.delete(tabId);
      });
    }
  }, []);

  const loadDashboard = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent && !dataRef.current) {
      setLoading(true);
    }
    setError('');
    try {
      const qs = selectedGradeId ? `?gradeId=${selectedGradeId}` : '';
      const res = await apiRequest<StudentDashboardData>(`/api/student/dashboard${qs}`);
      setData(res);
      setManualReviewOverrides({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedGradeId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Academic Plan shared calculations (#6, #7, #8, #9)
  const academicSignals = useMemo(
    () => (data ? buildStudentAcademicSignals(data, manualReviewOverrides) : null),
    [data, manualReviewOverrides],
  );

  const allWeekSummaries = useMemo(() => {
    if (!data?.curriculumPlan || !academicSignals) return [];
    const orderedWeeks = [...data.curriculumPlan.weeks].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.weekNumber - b.weekNumber,
    );
    return orderedWeeks.map((week) => evaluateWeekSummary(week, academicSignals));
  }, [data?.curriculumPlan, academicSignals]);

  const currentWeekSummary = useMemo(() => {
    if (!data?.curriculumPlan || allWeekSummaries.length === 0) return null;
    const currentWeek = resolveCurrentCurriculumWeek(data.curriculumPlan.weeks);
    if (!currentWeek) return allWeekSummaries[0];
    return allWeekSummaries.find((w) => w.week.id === currentWeek.id) || allWeekSummaries[0];
  }, [data?.curriculumPlan, allWeekSummaries]);

  const handleToggleManualReview = useCallback(
    async (taskId: number, isReviewed: boolean) => {
      setTogglingTaskId(taskId);
      const nowIso = new Date().toISOString();
      setManualReviewOverrides((prev) => ({
        ...prev,
        [taskId]: { isReviewed, reviewedAt: isReviewed ? nowIso : null },
      }));
      try {
        await apiRequest(`/api/student/curriculum/tasks/${taskId}/review`, {
          method: 'POST',
          body: JSON.stringify({ isReviewed }),
        });
        showToast(isReviewed ? 'تم تحديد المهمة كمُراجعة بنجاح' : 'تم إلغاء تحديد المراجعة');
      } catch (err) {
        // Revert optimistic update on failure
        setManualReviewOverrides((prev) => {
          const copy = { ...prev };
          delete copy[taskId];
          return copy;
        });
        showToast((err as Error).message || 'تعذر حفظ حالة المراجعة');
      } finally {
        setTogglingTaskId(null);
      }
    },
    [showToast],
  );

  // Centralized Permission-Aware Deep Linker (#2)
  const navigateStudentTarget = useCallback(
    (target: StudentDeepLinkTarget) => {
      setNotifOpen(false);
      setMobileSidebarOpen(false);
      const currentData = dataRef.current;

      if (target.type === 'EXTERNAL_URL') {
        const raw = (target.externalUrl || '').trim();
        if (raw.startsWith('https://')) {
          const anchor = document.createElement('a');
          anchor.href = raw;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.click();
        } else {
          showToast('الرابط الخارجي غير صالح.');
        }
        return;
      }

      if (target.type === 'NOTIFICATIONS') {
        setNotifOpen(true);
        return;
      }

      if (target.type === 'CURRICULUM') {
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        const nextFilter = target.curriculumFilter || 'ALL';
        const nextWeekId = target.weekId ?? null;
        setCurriculumFilter(nextFilter);
        setCurriculumWeekId(nextWeekId);
        setTabState('curriculum');
        setVisitedTabs((prev) => new Set(prev).add('curriculum'));
        syncStudentHistory({
          studentTab: 'curriculum',
          curriculumWeekId: nextWeekId,
          curriculumFilter: nextFilter === 'OVERDUE' ? 'OVERDUE' : null,
        });
        return;
      }

      if (target.type === 'VIDEO') {
        if (target.entityId && currentData) {
          const vid = currentData.videos.find((v) => v.id === target.entityId);
          if (vid) {
            if (vid.hasAccess) {
              openVideoOverlay(vid);
              return;
            }
            setTab('library');
            showToast(vid.lockReasonAr || 'هذه المحاضرة تتطلب تفعيل الاشتراك أو كود التفعيل أولًا.');
            return;
          }
          setTab('library');
          showToast('المحاضرة المطلوبة غير متاحة ضمن هذا الصف حاليًا.');
          return;
        }
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setTab('library');
        return;
      }

      if (target.type === 'HOMEWORK') {
        if (target.entityId) {
          openHomeworkOverlay(target.entityId);
          return;
        }
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setTab('homework');
        return;
      }

      if (target.type === 'EXAM') {
        if (target.entityId && currentData) {
          const ex = currentData.exams.find((e) => e.id === target.entityId);
          if (ex) {
            const st = resolveStudentExamStatus(ex);
            if (st.canStartOrResume) {
              openExamOverlay(ex.id);
              return;
            }
            if (st.code === 'RESULT_PUBLISHED') {
              setSelectedResultExamId(ex.id);
              setTab('results');
              showToast('تم نشر نتيجة هذا الامتحان — جارٍ فتح مراجعة الإجابات.');
              return;
            }
            setTab('exams');
            showToast(
              st.code === 'UPCOMING'
                ? 'هذا الامتحان مجدول ولم يحن موعد فتحه بعد.'
                : st.code === 'EXPIRED'
                  ? 'انتهى موعد إتاحة هذا الامتحان.'
                  : st.code === 'PENDING_GRADING'
                    ? 'تم تسليم الامتحان وهو بانتظار اعتماد الدرجة.'
                    : 'الامتحان مقفل حاليًا — راجع شروط الفتح في صفحة الامتحانات.',
            );
            return;
          }
        }
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setTab('exams');
        return;
      }

      if (target.type === 'COURSE') {
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        const cid = target.entityId ?? null;
        setSelectedCourseId(cid);
        setTabState('courses');
        setVisitedTabs((prev) => new Set(prev).add('courses'));
        syncStudentHistory({ studentTab: 'courses', courseId: cid });
        if (cid && currentData && !currentData.courses.some((c) => c.id === cid)) {
          showToast('تم فتح صفحة الكورسات — الكورس المذكور قد يكون خاصًا بصف آخر.');
        }
        return;
      }

      if (target.type === 'PDF') {
        if (target.entityId && currentData) {
          const attachedVid = currentData.videos.find(
            (v) => v.lessonId === target.entityId && v.hasPdfAttachment && v.hasAccess,
          );
          if (attachedVid) {
            openVideoOverlay(attachedVid);
            return;
          }
        }
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setSelectedPdfLessonId(target.entityId ?? null);
        setTab('pdfs');
        return;
      }

      if (target.type === 'SCHEDULE') {
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setSelectedScheduleSessionId(target.entityId ?? null);
        setTab('schedule');
        return;
      }

      if (target.type === 'RESULTS') {
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        setSelectedResultExamId(target.entityId ?? null);
        setTab('results');
        return;
      }

      const mapTab: Record<string, StudentTab> = {
        BILLING: 'billing',
        DEVICES: 'devices',
        SETTINGS: 'settings',
        PRACTICE: 'practice',
      };
      setPlayingVideo(null);
      setActiveExamId(null);
      setActiveHomeworkId(null);
      setTab(mapTab[target.type] || 'overview');
    },
    [openVideoOverlay, openHomeworkOverlay, openExamOverlay, setTab, syncStudentHistory, showToast],
  );

  const handleOpenCurriculumTask = useCallback(
    (ev: EvaluatedCurriculumTask) => {
      const t = ev.task;
      if (ev.status === 'UPCOMING' && t.taskType === 'EXAM') {
        setTab('exams');
        showToast('هذا الامتحان مجدول ولم يحن موعد فتحه بعد.');
        return;
      }
      if (t.taskType === 'VIDEO') {
        navigateStudentTarget({ type: 'VIDEO', entityId: t.entityId });
      } else if (t.taskType === 'HOMEWORK') {
        navigateStudentTarget({ type: 'HOMEWORK', entityId: t.entityId });
      } else if (t.taskType === 'EXAM') {
        navigateStudentTarget({ type: 'EXAM', entityId: t.entityId });
      } else if (t.taskType === 'PDF') {
        navigateStudentTarget({ type: 'PDF', entityId: t.entityId });
      } else if (t.taskType === 'COURSE') {
        navigateStudentTarget({ type: 'COURSE', entityId: t.entityId });
      } else if (t.taskType === 'LIVE_SESSION') {
        navigateStudentTarget({ type: 'SCHEDULE', entityId: t.entityId });
      } else {
        navigateStudentTarget({ type: 'CURRICULUM', weekId: t.weekId });
      }
    },
    [navigateStudentTarget, setTab, showToast],
  );

  const handleCloseVideoPlayer = useCallback(() => {
    setPlayingVideo(null);
    syncStudentHistory({ studentTab: tab }, 'replace');
    void loadDashboard();
  }, [loadDashboard, syncStudentHistory, tab]);

  const handleVideoProgressUpdated = useCallback((updated?: VideoProgressUpdatePayload) => {
    if (!updated) return;
    setData((prev) => {
      if (!prev) return prev;
      let changed = false;
      const nextVideos = prev.videos.map((v) => {
        if (v.id !== updated.videoId) return v;
        changed = true;
        return {
          ...v,
          progress: {
            ...v.progress,
            lastPositionSec: updated.lastPositionSec,
            watchedSec: updated.watchedSec,
            completionPercent: updated.completionPercent,
            isCompleted: updated.isCompleted,
          },
        };
      });
      if (!changed) return prev;
      const overallProgressPercent =
        nextVideos.length > 0
          ? Math.round(
              nextVideos.reduce((sum, item) => sum + (item.progress.completionPercent || 0), 0) /
                nextVideos.length,
            )
          : 0;
      return {
        ...prev,
        videos: nextVideos,
        overallProgressPercent,
      };
    });
  }, []);

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;
    setRedeeming(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/student/codes/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: codeInput }),
      });
      setCodeInput('');
      showToast(res.message);
      await loadDashboard();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setRedeeming(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutTarget) return;
    setSubmittingOrder(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/student/orders', {
        method: 'POST',
        body: JSON.stringify({
          targetType: checkoutTarget.targetType,
          targetId: checkoutTarget.targetId,
          paymentMethod,
          couponCode: couponCode || undefined,
          receiptNote,
          providerRef,
        }),
      });
      setCheckoutTarget(null);
      setCouponCode('');
      setReceiptNote('');
      setProviderRef('');
      showToast(res.message);
      await loadDashboard();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleRequestAdditionalGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/request-grade', {
        method: 'POST',
        body: JSON.stringify({ trackId: reqTrackId, gradeId: reqGradeId }),
      });
      setGradeModalOpen(false);
      showToast(res.message);
      await onRefreshMe();
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const unreadCount = useMemo(
    () => data?.notifications.filter((n) => !n.isRead).length || 0,
    [data?.notifications],
  );
  const notifOpenRef = useRef(notifOpen);
  notifOpenRef.current = notifOpen;
  const unreadCountRef = useRef(unreadCount);
  unreadCountRef.current = unreadCount;

  const markNotificationsRead = useCallback(() => {
    const willOpen = !notifOpenRef.current;
    notifOpenRef.current = willOpen;
    setNotifOpen(willOpen);
    if (willOpen && unreadCountRef.current > 0) {
      unreadCountRef.current = 0;
      // Optimistically clear badge immediately and sync with server without blocking popover paint
      setData((prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((item) => ({ ...item, isRead: true })),
            }
          : prev,
      );
      void apiRequest('/api/student/notifications/read', { method: 'POST' }).catch(() => {});
    }
  }, []);

  const handleCloseMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const handleOpenMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const handleOpenRequestGrade = useCallback(() => setGradeModalOpen(true), []);
  const handleSelectNavTab = useCallback(
    (next: StudentTab) => {
      setPlayingVideo(null);
      setActiveExamId(null);
      setActiveHomeworkId(null);
      setTab(next);
    },
    [setTab],
  );

  const handleGoBack = useCallback(() => {
    if (mobileSidebarOpen) {
      setMobileSidebarOpen(false);
      return;
    }
    if (notifOpen) {
      setNotifOpen(false);
      return;
    }
    if (checkoutTarget) {
      setCheckoutTarget(null);
      return;
    }
    if (gradeModalOpen) {
      setGradeModalOpen(false);
      return;
    }
    if (playingVideo || activeExamId || activeHomeworkId) {
      goBackInLms(() => {
        setPlayingVideo(null);
        setActiveExamId(null);
        setActiveHomeworkId(null);
        syncStudentHistory({ studentTab: tab }, 'replace');
      });
      return;
    }
    goBackInLms(() => {
      if (tab !== 'overview') {
        setTab('overview');
      } else {
        onBackHome();
      }
    });
  }, [
    mobileSidebarOpen,
    notifOpen,
    checkoutTarget,
    gradeModalOpen,
    playingVideo,
    activeExamId,
    activeHomeworkId,
    tab,
    syncStudentHistory,
    setTab,
    onBackHome,
  ]);

  const handleNotificationClick = (n: StudentDashboardData['notifications'][number]) => {
    setNotifOpen(false);
    const tType = (n.targetType || '').toUpperCase();
    const rawType = (n.type || '').toUpperCase();

    if (tType === 'EXAM' || rawType.includes('EXAM')) {
      navigateStudentTarget({ type: 'EXAM', entityId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'HOMEWORK' || rawType.includes('HOMEWORK')) {
      navigateStudentTarget({ type: 'HOMEWORK', entityId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'VIDEO' || rawType.includes('VIDEO')) {
      navigateStudentTarget({ type: 'VIDEO', entityId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'COURSE' || tType === 'COURSES' || rawType.includes('COURSE')) {
      navigateStudentTarget({ type: 'COURSE', entityId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'CURRICULUM' || rawType.includes('CURRICULUM')) {
      navigateStudentTarget({ type: 'CURRICULUM', weekId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'PDF' || rawType.includes('PDF')) {
      navigateStudentTarget({ type: 'PDF', entityId: n.targetId ?? undefined });
      return;
    }
    if (
      tType === 'PLATFORM_SUBSCRIPTION' ||
      tType === 'ORDER' ||
      rawType.includes('PAYMENT') ||
      rawType.includes('CODE')
    ) {
      navigateStudentTarget({ type: 'BILLING' });
      return;
    }
    if (tType === 'RESULT' || rawType.includes('GRADE')) {
      navigateStudentTarget({ type: 'RESULTS', entityId: n.targetId ?? undefined });
      return;
    }
    if (tType === 'DEVICES' || rawType.includes('DEVICE') || rawType.includes('SECURITY')) {
      navigateStudentTarget({ type: 'DEVICES' });
      return;
    }
    if (tType === 'SCHEDULE' || tType === 'LIVE_SESSION' || rawType.includes('SCHEDULE') || rawType.includes('LIVE')) {
      navigateStudentTarget({ type: 'SCHEDULE', entityId: n.targetId ?? undefined });
      return;
    }
    setTab('overview');
  };

  const isStaff = ['SUPER_ADMIN', 'CONTENT_MANAGER', 'TEACHING_ASSISTANT', 'SUPPORT'].includes(
    me.user.roleSlug,
  );

  const TAB_TITLES: Record<StudentTab, string> = {
    overview: 'الرئيسية',
    curriculum: 'خطة المنهج الدراسي',
    library: 'مكتبة الفيديوهات',
    free: 'الفيديوهات المجانية',
    paid: 'الفيديوهات المدفوعة',
    courses: 'الكورسات',
    exams: 'الامتحانات والتقييمات',
    homework: 'واجباتي',
    results: 'النتائج والتقارير',
    pdfs: 'مكتبة المذكرات (PDF)',
    schedule: 'الجدول والمواعيد المباشرة',
    billing: 'اشتراكي وأكواد التفعيل',
    devices: 'أجهزتي وجلساتي',
    practice: 'بنك الأسئلة والتدريب',
    settings: 'إعدادات الحساب',
  };

  const SHOW_UTILITY_BREADCRUMB =
    tab === 'settings' || tab === 'billing' || tab === 'devices';

  return (
    <div
      className="min-h-screen bg-[#060D21] text-white flex"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 65% 45% at 50% 0%, rgba(37,99,235,0.22), transparent 70%), radial-gradient(ellipse 40% 35% at 10% 85%, rgba(124,58,237,0.16), transparent 65%)',
      }}
    >
      {/* RIGHT DARK SIDEBAR */}
      <StudentSidebar
        platformName={bootstrap.settings.platformName}
        activeTab={tab}
        unreadCount={unreadCount}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={handleCloseMobileSidebar}
        onSelectTab={handleSelectNavTab}
        onPreloadTab={preloadTabChunk}
        onOpenNotifications={markNotificationsRead}
      />

      {/* MAIN AREA (Top Bar + Content Workspace) */}
      <div className="flex-1 min-w-0 flex flex-col">
        <StudentTopBar
          me={me}
          data={data}
          approvedEnrollments={approvedEnrollments}
          selectedGradeId={selectedGradeId}
          unreadCount={unreadCount}
          isStaff={isStaff}
          onOpenMobileMenu={handleOpenMobileSidebar}
          onToggleNotifications={markNotificationsRead}
          onSelectTab={handleSelectNavTab}
          onSelectGrade={setSelectedGradeId}
          onOpenRequestGrade={handleOpenRequestGrade}
          onPlayVideo={openVideoOverlay}
          onOpenExam={openExamOverlay}
          onNavigateTarget={navigateStudentTarget}
          onOpenParentReport={onOpenParentReport}
          onOpenAdmin={onOpenAdmin}
          onGoBack={handleGoBack}
          onBackHome={onBackHome}
          onLogout={onLogout}
        />

        {/* Toast Feedback */}
        {toast && (
          <div
            role="status"
            className="fixed bottom-5 left-5 z-50 max-w-md rounded-xl border border-sky-400/45 bg-[#0B1739] px-4 py-3 text-sm font-bold text-white shadow-2xl"
          >
            {toast}
          </div>
        )}

        {/* Notifications Popover */}
        {notifOpen && data && (
          <div className="fixed left-4 top-16 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#3B5CA8]/50 bg-[#0A1636] p-4 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h3 className="text-sm font-bold text-white">مركز الإشعارات</h3>
              <button type="button" onClick={() => setNotifOpen(false)} aria-label="إغلاق">
                <X className="h-4 w-4 text-slate-300 hover:text-white" />
              </button>
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {data.notifications.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">لا توجد إشعارات جديدة</p>
              ) : (
                data.notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className="w-full rounded-xl border border-white/10 bg-[#112250] p-3 text-right transition-colors hover:border-sky-400/50 hover:bg-[#162C66]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">{n.titleAr}</span>
                      {!n.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />}
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{n.bodyAr}</p>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{formatDateTimeAr(n.createdAt)}</span>
                      <span className="font-semibold text-sky-300">فتح ←</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <main className="flex-1 px-3.5 py-2.5 sm:px-4 sm:py-3 max-w-[1520px] w-full mx-auto">
          {/* Focused Full-Width Stage for Video Player or Exam Runner (Readable Content Surface) */}
          {playingVideo ? (
            <div className="rounded-2xl bg-[#F7F9FC] text-[#0B162C] p-3 sm:p-5 shadow-xl">
              <Suspense fallback={<StudentTabFallback />}>
                <SecureVideoPlayer
                  key={playingVideo.id}
                  videoId={playingVideo.id}
                  lessonId={playingVideo.lessonId}
                  lessonTitleAr={playingVideo.lessonTitleAr}
                  unitTitleAr={playingVideo.unitTitleAr}
                  trackNameAr={data?.activeGrade?.trackNameAr || playingVideo.trackNameAr}
                  gradeNameAr={data?.activeGrade?.nameAr}
                  pdfTitleAr={
                    data?.lessons.find((l) => l.id === playingVideo.lessonId)?.pdfTitleAr ?? null
                  }
                  pdfContentSummary={
                    data?.lessons.find((l) => l.id === playingVideo.lessonId)?.pdfContentSummary ??
                    null
                  }
                  allowComments={
                    data?.lessons.find((l) => l.id === playingVideo.lessonId)?.allowComments ?? true
                  }
                  initialComments={
                    data?.lessons.find((l) => l.id === playingVideo.lessonId)?.comments || []
                  }
                  onClose={handleCloseVideoPlayer}
                  onProgressUpdated={handleVideoProgressUpdated}
                />
              </Suspense>
            </div>
          ) : activeExamId ? (
            <div className="rounded-2xl bg-[#F7F9FC] text-[#0B162C] p-3 sm:p-5 shadow-xl">
              <Suspense fallback={<StudentTabFallback />}>
                <ExamRunner
                  examId={activeExamId}
                  onExit={() => {
                    setActiveExamId(null);
                    setExamSessionKey((k) => k + 1);
                    syncStudentHistory({ studentTab: tab }, 'replace');
                    void loadDashboard();
                  }}
                  onOpenResults={() => {
                    setActiveExamId(null);
                    setExamSessionKey((k) => k + 1);
                    setTab('results');
                    void loadDashboard();
                  }}
                />
              </Suspense>
            </div>
          ) : loading && !data ? (
            <div className="space-y-4">
              <div className="h-36 animate-pulse rounded-2xl border border-white/10 bg-[#0E1E4A]" />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#132557]" />
                ))}
              </div>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-7">
                {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl bg-[#132557]" />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-950/60 p-6 text-sm text-rose-100">
              {error}
            </div>
          ) : data ? (
            <>
              {/* TAB 1: STUDENT DASHBOARD HOME */}
              {tab === 'overview' && (
                <StudentDashboardHome
                  me={me}
                  data={data}
                  allWeekSummaries={allWeekSummaries}
                  currentWeekSummary={currentWeekSummary}
                  togglingTaskId={togglingTaskId}
                  onSelectTab={(next) => setTab(next)}
                  onPreloadTab={preloadTabChunk}
                  onPlayVideo={(v) => navigateStudentTarget({ type: 'VIDEO', entityId: v.id })}
                  onOpenExam={(examId) => navigateStudentTarget({ type: 'EXAM', entityId: examId })}
                  onOpenCurriculumTask={handleOpenCurriculumTask}
                  onToggleManualReview={handleToggleManualReview}
                  onNavigateTarget={navigateStudentTarget}
                />
              )}

              {/* ALL INTERNAL STUDENT SCREENS — HIGH-FIDELITY REDESIGNED PORTAL */}
              <div className={tab === 'overview' ? 'hidden' : 'space-y-4'}>
                {/* Utility Breadcrumb only on Account Utility Screens (Settings / Billing / Devices) */}
                {SHOW_UTILITY_BREADCRUMB && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#2D4A8A]/45 bg-[#0A1636]/90 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <button
                        type="button"
                        onClick={() => setTab('overview')}
                        className="font-bold text-sky-300 hover:text-sky-200 hover:underline"
                      >
                        الرئيسية
                      </button>
                      <span className="text-white/30">/</span>
                      <span className="font-extrabold text-white">{TAB_TITLES[tab]}</span>
                    </div>
                  </div>
                )}

                {/* PAGE 1: CURRICULUM PLAN */}
                {tab === 'curriculum' && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentCurriculumView
                      plan={data.curriculumPlan || null}
                      allWeekSummaries={allWeekSummaries}
                      currentWeekId={currentWeekSummary?.week.id ?? null}
                      initialFilter={curriculumFilter}
                      initialWeekId={curriculumWeekId}
                      togglingTaskId={togglingTaskId}
                      exams={data.exams}
                      videos={data.videos}
                      onToggleManualReview={handleToggleManualReview}
                      onOpenTask={handleOpenCurriculumTask}
                      onNavigateTarget={navigateStudentTarget}
                    />
                  </Suspense>
                )}

                {/* PAGE 6: QUESTION PRACTICE (Student-Safe) */}
                {tab === 'practice' && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentPracticeView
                      data={data}
                      onOpenExam={(id) => navigateStudentTarget({ type: 'EXAM', entityId: id })}
                      onOpenHomework={(id) => openHomeworkOverlay(id)}
                      onNavigateTarget={navigateStudentTarget}
                    />
                  </Suspense>
                )}

                {/* STUDENT ACCOUNT SETTINGS VIEW */}
                {tab === 'settings' && (
                  <div className="space-y-4" data-testid="student-settings-view">
                    <StudentSectionHeader
                      title="إعدادات حساب الطالب"
                      subtitle="إدارة بيانات حسابك والصف الدراسي النشط وتقرير ولي الأمر."
                      icon={<Settings className="h-6 w-6" />}
                    />
                    <div className="rounded-2xl border border-[#2D4A8A]/50 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-6 text-white">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-xl border border-white/12 bg-[#081330]/80 p-4">
                          <div className="text-xs text-slate-400">الاسم الكامل</div>
                          <div className="mt-1 text-sm font-extrabold text-white">
                            {me.user.fullName}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/12 bg-[#081330]/80 p-4">
                          <div className="text-xs text-slate-400">رقم الهاتف / البريد</div>
                          <div className="mt-1 font-mono-num text-sm font-bold text-white" dir="ltr">
                            {me.user.phone || me.user.email || '—'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/12 bg-[#081330]/80 p-4">
                          <div className="text-xs text-slate-400">الصف الدراسي النشط</div>
                          <div className="mt-1 text-sm font-extrabold text-sky-300">
                            {data.activeGrade
                              ? `${data.activeGrade.trackNameAr} — ${data.activeGrade.nameAr}`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      {approvedEnrollments.length > 1 && (
                        <div className="mt-5 max-w-md">
                          <label className="mb-1.5 block text-xs font-bold text-slate-300">
                            تبديل الصف الدراسي المعروض
                          </label>
                          <select
                            aria-label="تبديل الصف الدراسي"
                            value={selectedGradeId}
                            onChange={(e) => setSelectedGradeId(Number(e.target.value))}
                            className="w-full rounded-xl border border-white/15 bg-[#081330] px-3 py-2.5 text-sm font-semibold text-white"
                          >
                            {approvedEnrollments.map((enr) => (
                              <option key={enr.gradeId} value={enr.gradeId}>
                                {enr.trackNameAr} — {enr.gradeNameAr}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="mt-6 flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => setGradeModalOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-4 py-2 text-xs font-extrabold text-white hover:brightness-110"
                        >
                          <Plus className="h-4 w-4" />
                          <span>طلب الانضمام لصف دراسي آخر</span>
                        </button>

                        {data.parentShareCode && (
                          <button
                            type="button"
                            onClick={() => onOpenParentReport(data.parentShareCode!)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15"
                          >
                            <Share2 className="h-4 w-4 text-emerald-300" />
                            <span>فتح تقرير ولي الأمر ({data.parentShareCode})</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setTab('devices')}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15"
                        >
                          <MonitorSmartphone className="h-4 w-4 text-sky-300" />
                          <span>إدارة أجهزتي وجلساتي</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setTab('billing')}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15"
                        >
                          <KeyRound className="h-4 w-4 text-amber-300" />
                          <span>اشتراكي وأكواد التفعيل</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void onLogout()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/30"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>تسجيل الخروج</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* PAGE 3: VIDEO & LESSON LIBRARY (library / free / paid) */}
                {(tab === 'library' || tab === 'free' || tab === 'paid') && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentVideoLibraryView
                      data={data}
                      initialMode={tab}
                      onPlayVideo={(v) => navigateStudentTarget({ type: 'VIDEO', entityId: v.id })}
                      onStartCheckout={(target) => setCheckoutTarget(target)}
                      onNavigateTarget={navigateStudentTarget}
                      onOpenResults={() => setTab('results')}
                      onOpenBilling={() => setTab('billing')}
                    />
                  </Suspense>
                )}

                {/* PAGE 2: COURSES & SUBSCRIPTION PACKAGES */}
                {tab === 'courses' && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentCoursesView
                      data={data}
                      selectedCourseId={selectedCourseId}
                      onPlayVideo={(v) => navigateStudentTarget({ type: 'VIDEO', entityId: v.id })}
                      onStartCheckout={(target) => setCheckoutTarget(target)}
                      onOpenBilling={() => setTab('billing')}
                      onNavigateTarget={navigateStudentTarget}
                    />
                  </Suspense>
                )}

                {/* PAGE 5: EXAMS HUB — keep mounted once visited */}
                {(tab === 'exams' || visitedTabs.has('exams')) && (
                  <div className={tab === 'exams' ? '' : 'hidden'}>
                    <Suspense fallback={<StudentTabFallback />}>
                      <StudentExamsHub
                        key={`exams-${examSessionKey}`}
                        gradeId={selectedGradeId}
                        onOpenExam={(id) => openExamOverlay(id)}
                        onOpenResults={(examId) =>
                          navigateStudentTarget({ type: 'RESULTS', entityId: examId })
                        }
                        onNavigateTarget={navigateStudentTarget}
                      />
                    </Suspense>
                  </div>
                )}

                {/* PAGE 4: HOMEWORK HUB — keep mounted once visited */}
                {(tab === 'homework' || visitedTabs.has('homework')) && (
                  <div className={tab === 'homework' ? '' : 'hidden'}>
                    <Suspense fallback={<StudentTabFallback />}>
                      <StudentHomeworkHub
                        key={`hw-${homeworkSessionKey}`}
                        activeGradeId={data.activeGrade?.id}
                        onOpenHomeworkModal={(id) => openHomeworkOverlay(id)}
                        onHomeworkSubmitted={() => {
                          void loadDashboard();
                        }}
                      />
                    </Suspense>
                  </div>
                )}

                {/* PAGE 9: RESULTS & ACADEMIC REPORTS — keep mounted once visited */}
                {(tab === 'results' || visitedTabs.has('results')) && (
                  <div className={tab === 'results' ? '' : 'hidden'}>
                    <Suspense fallback={<StudentTabFallback />}>
                      <StudentResultsPanel
                        key={`results-${examSessionKey}`}
                        gradeId={selectedGradeId}
                        homeworkItems={data.homeworkSummary?.items || []}
                        homeworkTotalCount={data.homeworkSummary?.totalCount}
                        parentShareCode={data.parentShareCode}
                        activeGradeLabel={
                          data.activeGrade
                            ? `${data.activeGrade.trackNameAr} — ${data.activeGrade.nameAr}`
                            : undefined
                        }
                        initialExamId={selectedResultExamId}
                        onConsumeInitialExam={() => setSelectedResultExamId(null)}
                        onOpenParentReport={onOpenParentReport}
                        onOpenHomework={(id) => openHomeworkOverlay(id)}
                        onOpenCurriculum={() => setTab('curriculum')}
                      />
                    </Suspense>
                  </div>
                )}

                {/* PAGE 7: PDF LIBRARY */}
                {tab === 'pdfs' && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentPdfLibraryView
                      data={data}
                      initialLessonId={selectedPdfLessonId}
                      onConsumeInitialLesson={() => setSelectedPdfLessonId(null)}
                      onPlayVideo={(v) => navigateStudentTarget({ type: 'VIDEO', entityId: v.id })}
                      onOpenBilling={() => setTab('billing')}
                      onOpenCourses={() => setTab('courses')}
                      onNavigateTarget={navigateStudentTarget}
                    />
                  </Suspense>
                )}

                {/* PAGE 8: SCHEDULE & LIVE SESSIONS */}
                {tab === 'schedule' && (
                  <Suspense fallback={<StudentTabFallback />}>
                    <StudentScheduleView
                      data={data}
                      initialSessionId={selectedScheduleSessionId}
                      onConsumeInitialSession={() => setSelectedScheduleSessionId(null)}
                      onNavigateTarget={navigateStudentTarget}
                    />
                  </Suspense>
                )}

                {/* ACTIVATION CODES & BILLING */}
                {tab === 'billing' && (
                  <div className="space-y-5">
                    <StudentSectionHeader
                      title="اشتراكي وأكواد التفعيل"
                      subtitle="فعّل كود السنتر فورًا أو تابع حالة طلبات الاشتراك والمدفوعات."
                      icon={<CreditCard className="h-6 w-6" />}
                    />
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-[#2D4A8A]/50 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-6 text-white">
                        <h2 className="font-display text-lg font-extrabold text-white">
                          تفعيل كود اشتراك أو محاضرة
                        </h2>
                        <p className="mt-1 text-xs sm:text-sm text-slate-300">
                          أدخل كود التفعيل الذي حصلت عليه من السنتر أو المدرس لفتح المحتوى فورًا.
                        </p>
                        <form onSubmit={handleRedeemCode} className="mt-4 space-y-3">
                          <input
                            type="text"
                            dir="ltr"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            placeholder="مثال: PHY-DEMO-2026-KIRC"
                            className="w-full rounded-xl border border-white/15 bg-[#081330] px-4 py-3 text-left font-mono-num text-sm text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={redeeming}
                            className="w-full rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] py-2.5 text-sm font-extrabold text-white hover:brightness-110 disabled:opacity-60"
                          >
                            {redeeming ? 'جارٍ التحقق...' : 'تفعيل الكود الآن'}
                          </button>
                        </form>
                        {bootstrap.demoAccountsEnabled && (
                          <div className="mt-4 rounded-xl border border-white/12 bg-[#081330]/80 p-3 text-xs text-slate-300">
                            كود تجريبي للاختبار:{' '}
                            <button
                              type="button"
                              onClick={() => setCodeInput('PHY-DEMO-2026-KIRC')}
                              className="font-mono-num font-bold text-sky-300 underline"
                            >
                              PHY-DEMO-2026-KIRC
                            </button>{' '}
                            (يفتح محاضرة كيرشوف المتقدمة)
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-[#2D4A8A]/50 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 p-6 text-white">
                        <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-white">
                          <CreditCard className="h-5 w-5 text-sky-300" />
                          <span>سجل طلبات الدفع والاشتراكات</span>
                        </h2>
                        {data.orders.length === 0 ? (
                          <p className="mt-4 text-xs sm:text-sm text-slate-400">
                            لا توجد طلبات دفع مسجلة حتى الآن.
                          </p>
                        ) : (
                          <div className="mt-4 divide-y divide-white/10">
                            {data.orders.map((ord) => (
                              <div
                                key={ord.id}
                                className="flex items-center justify-between gap-3 py-3 text-sm"
                              >
                                <div>
                                  <div className="font-bold text-white">{ord.targetTitleAr}</div>
                                  <div className="font-mono-num text-xs text-slate-400">
                                    {ord.orderNumber} · {formatDateAr(ord.createdAt)}
                                  </div>
                                </div>
                                <div className="text-left shrink-0">
                                  <div className="font-mono-num font-bold text-white">
                                    {ord.finalAmountEgp} ج.م
                                  </div>
                                  <div
                                    className={`text-xs font-bold ${
                                      ord.status === 'PAID'
                                        ? 'text-emerald-300'
                                        : ord.status === 'UNDER_REVIEW'
                                          ? 'text-amber-300'
                                          : 'text-rose-300'
                                    }`}
                                  >
                                    {ord.status === 'PAID'
                                      ? 'تم التأكيد'
                                      : ord.status === 'UNDER_REVIEW'
                                        ? 'بانتظار مراجعة الإيصال'
                                        : 'مرفوض'}
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

                {/* ACTIVE DEVICES & SESSIONS — dark theme */}
                {(tab === 'devices' || visitedTabs.has('devices')) && (
                  <div className={tab === 'devices' ? '' : 'hidden'}>
                    <Suspense fallback={<StudentTabFallback />}>
                      <ActiveDevicesPanel darkTheme onLoggedOutCurrent={onLogout} />
                    </Suspense>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </main>
      </div>

      {/* DIRECT DEEP-LINKED HOMEWORK MODAL (#2, #11, #12) */}
      {activeHomeworkId !== null && (
        <Suspense fallback={null}>
          <StudentHomeworkModal
            assignmentId={activeHomeworkId}
            onClose={() => {
              setActiveHomeworkId(null);
              syncStudentHistory({ studentTab: tab }, 'replace');
            }}
            onSubmitted={() => {
              setHomeworkSessionKey((k) => k + 1);
              void loadDashboard();
            }}
          />
        </Suspense>
      )}

      {/* Checkout / Payment Receipt Modal */}
      {checkoutTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="إتمام طلب الاشتراك"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 text-[#0B162C]"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-[#0B162C]">إتمام طلب الاشتراك</h3>
                <p className="text-xs text-slate-500">{checkoutTarget.titleAr}</p>
              </div>
              <button type="button" onClick={() => setCheckoutTarget(null)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-[#F7F9FC] p-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">القيمة الأساسية</span>
                <span className="font-mono-num text-xl font-extrabold text-[#2563EB]">
                  {checkoutTarget.priceEgp} ج.م
                </span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">
                  وسيلة الدفع في مصر
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'WALLET', label: 'فودافون كاش / محفظة' },
                    { id: 'BANK_TRANSFER', label: 'تحويل بنكي / InstaPay' },
                    { id: 'PAYMOB', label: 'بطاقة بنكية (Paymob)' },
                    { id: 'FAWRY', label: 'دفع فوري (Fawry)' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id as typeof paymentMethod)}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                        paymentMethod === m.id
                          ? 'border-[#2563EB] bg-blue-50 text-[#0B162C]'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {(paymentMethod === 'WALLET' || paymentMethod === 'BANK_TRANSFER') && (
                <div className="rounded-lg border border-slate-200 bg-[#F7F9FC] p-3 text-xs leading-relaxed text-slate-700">
                  <div>
                    <strong>فودافون كاش:</strong>{' '}
                    <span className="font-mono-num" dir="ltr">
                      {bootstrap.settings.paymentConfig.vodafoneCashNumber}
                    </span>
                  </div>
                  <div className="mt-1">
                    <strong>InstaPay:</strong>{' '}
                    <span className="font-mono-num" dir="ltr">
                      {bootstrap.settings.paymentConfig.instaPayHandle}
                    </span>
                  </div>
                  <div className="mt-1">
                    <strong>الحساب البنكي:</strong> {bootstrap.settings.paymentConfig.bankAccountInfo}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  كوبون خصم (اختياري)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="مثال: PHYS20"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left font-mono-num text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  رقم العملية / رقم المحفظة المحوَّل منها
                </label>
                <input
                  type="text"
                  required
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  placeholder="مثال: 010XXXXXXXX أو رقم المرجع"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  ملاحظة الإيصال للمراجعة
                </label>
                <textarea
                  rows={2}
                  value={receiptNote}
                  onChange={(e) => setReceiptNote(e.target.value)}
                  placeholder="وقت التحويل أو اسم صاحب الحساب..."
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                ملاحظة أمان: لا يُفتح المحتوى تلقائيًا بمجرد إرسال الطلب؛ يتم التحقق من العملية من
                السيرفر أو بمراجعة إدارة المنصة ثم تفعيل الاشتراك فورًا.
              </p>

              <button
                type="submit"
                disabled={submittingOrder}
                className="w-full rounded-lg bg-[#2563EB] py-3 text-sm font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {submittingOrder ? 'جارٍ إرسال الطلب...' : 'إرسال طلب الدفع للمراجعة'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Request Additional Grade Modal */}
      {gradeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="طلب الانضمام إلى صف دراسي آخر"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 text-[#0B162C]"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-[#0B162C]">طلب الانضمام إلى صف دراسي آخر</h3>
              <button type="button" onClick={() => setGradeModalOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleRequestAdditionalGrade} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">المسار الدراسي</label>
                <select
                  value={reqTrackId}
                  onChange={(e) => {
                    const tid = Number(e.target.value);
                    setReqTrackId(tid);
                    setReqGradeId(bootstrap.tracks.find((t) => t.id === tid)?.grades[0]?.id || 0);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {bootstrap.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">الصف الدراسي</label>
                <select
                  value={reqGradeId}
                  onChange={(e) => setReqGradeId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {reqGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-500">
                سيتم إرسال طلبك للمدرس ولن يظهر محتوى الصف الجديد إلا بعد الموافقة.
              </p>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#2563EB] py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8]"
              >
                إرسال طلب الانضمام
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
