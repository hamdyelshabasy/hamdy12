import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Atom,
  Bell,
  BookCheck,
  BookOpen,
  Calendar,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  Database,
  Eye,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Library,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  MonitorSmartphone,
  Search,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../lib/api.ts';
import {
  goBackInLms,
  parseHashToNavState,
  pushLmsHistoryState,
  type AppNavHistoryState,
} from '../lib/navigationHistory.ts';
import {
  PERMISSIONS,
  canAccessAdminTab,
  hasAnyPermission,
  type AdminDashboardTabId,
} from '../lib/permissions.ts';
import type { BootstrapResponse, MeResponse } from '../types/lms.ts';
import type { DashboardNavigationTarget } from '../types/smartDashboard.ts';
import type { AdminCatalogData } from './admin/AdminContentPanel.tsx';

const SmartTeacherDashboard = lazy(() =>
  import('./admin/SmartTeacherDashboard.tsx').then((m) => ({ default: m.SmartTeacherDashboard })),
);
const AdminStudentsPanel = lazy(() =>
  import('./admin/AdminStudentsPanel.tsx').then((m) => ({ default: m.AdminStudentsPanel })),
);
const AdminContentPanel = lazy(() =>
  import('./admin/AdminContentPanel.tsx').then((m) => ({ default: m.AdminContentPanel })),
);
const AdminVideosPanel = lazy(() =>
  import('./admin/AdminVideosPanel.tsx').then((m) => ({ default: m.AdminVideosPanel })),
);
const AdminCodesPaymentsPanel = lazy(() =>
  import('./admin/AdminCodesPaymentsPanel.tsx').then((m) => ({
    default: m.AdminCodesPaymentsPanel,
  })),
);
const AdminExamsOpsPanel = lazy(() =>
  import('./admin/AdminExamsOpsPanel.tsx').then((m) => ({ default: m.AdminExamsOpsPanel })),
);
const AdminExamsManager = lazy(() =>
  import('./admin/AdminExamsManager.tsx').then((m) => ({ default: m.AdminExamsManager })),
);
const AdminHomeworkManager = lazy(() =>
  import('./admin/AdminHomeworkManager.tsx').then((m) => ({ default: m.AdminHomeworkManager })),
);
const AdminQuestionBankPanel = lazy(() =>
  import('./admin/questionBank/AdminQuestionBankPanel.tsx').then((m) => ({
    default: m.AdminQuestionBankPanel,
  })),
);
const AdminCurriculumManager = lazy(() =>
  import('./admin/AdminCurriculumManager.tsx').then((m) => ({ default: m.AdminCurriculumManager })),
);
const AdminAnnouncementsManager = lazy(() =>
  import('./admin/AdminAnnouncementsManager.tsx').then((m) => ({
    default: m.AdminAnnouncementsManager,
  })),
);
const ActiveDevicesPanel = lazy(() =>
  import('./ActiveDevicesPanel.tsx').then((m) => ({ default: m.ActiveDevicesPanel })),
);

export interface AdminNotificationItem {
  id: number;
  titleAr: string;
  bodyAr: string;
  type: string;
  isRead: boolean;
  targetType?: string | null;
  targetId?: number | null;
  createdAt: string;
}

const TabLoadingFallback: React.FC = () => (
  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#2563EB]" />
    <p className="mt-3 text-xs font-semibold text-slate-500">جارٍ تحميل القسم...</p>
  </div>
);

type AdminTab = AdminDashboardTabId;

interface AdminDashboardProps {
  bootstrap: BootstrapResponse;
  me: MeResponse;
  onRefreshBootstrap: () => Promise<void>;
  onOpenStudentPreview: () => void;
  onBackHome: () => void;
  onLogout: () => Promise<void>;
}

interface NavItemDef {
  id: AdminTab;
  label: string;
  keywords: string;
  icon: React.ReactNode;
}

interface NavGroupDef {
  id: string;
  title: string;
  items: NavItemDef[];
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    id: 'general',
    title: 'نظرة عامة',
    items: [
      {
        id: 'overview',
        label: 'لوحة التحكم الذكية',
        keywords: 'الرئيسية الداشبورد احصائيات مهام dashboard',
        icon: <LayoutDashboard className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'academic',
    title: 'الإدارة الأكاديمية',
    items: [
      {
        id: 'students',
        label: 'إدارة الطلاب والموافقات',
        keywords: 'الطلاب طلبات التسجيل الصلاحيات ارشيف students',
        icon: <Users className="h-4 w-4" />,
      },
      {
        id: 'tracks',
        label: 'المسارات والصفوف',
        keywords: 'بكالوريا ازهري صفوف دراسية tracks grades',
        icon: <GraduationCap className="h-4 w-4" />,
      },
      {
        id: 'groups',
        label: 'المجموعات والمواعيد',
        keywords: 'المجموعات الجدول الحصص المباشرة لايف groups schedule',
        icon: <UsersRound className="h-4 w-4" />,
      },
      {
        id: 'curriculum',
        label: 'خطة المنهج',
        keywords: 'المنهج الاسبوعي الخطة الدراسية curriculum',
        icon: <Calendar className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'content',
    title: 'المحتوى والتقييم',
    items: [
      {
        id: 'videos',
        label: 'إدارة الفيديوهات',
        keywords: 'دروس محاضرات فيديو مذكرات pdf videos',
        icon: <Video className="h-4 w-4" />,
      },
      {
        id: 'courses',
        label: 'الكورسات والكوبونات',
        keywords: 'دورات باقات خصم كوبون courses coupons',
        icon: <BookOpen className="h-4 w-4" />,
      },
      {
        id: 'question_bank',
        label: 'بنك الأسئلة',
        keywords: 'اسئلة مراجعة اعتماد question bank',
        icon: <Library className="h-4 w-4" />,
      },
      {
        id: 'exams',
        label: 'إدارة الامتحانات',
        keywords: 'امتحان اختبار تقييم تصحيح exams',
        icon: <ClipboardCheck className="h-4 w-4" />,
      },
      {
        id: 'homework',
        label: 'الواجبات والتصحيح',
        keywords: 'واجب تكليف تسليمات تصحيح homework',
        icon: <BookCheck className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'finance',
    title: 'الإدارة المالية',
    items: [
      {
        id: 'codes',
        label: 'أكواد التفعيل',
        keywords: 'كود اشتراك تفعيل دفعة codes',
        icon: <KeyRound className="h-4 w-4" />,
      },
      {
        id: 'payments',
        label: 'المدفوعات والطلبات',
        keywords: 'فودافون انستاباي تحويل ايصال دفع payments',
        icon: <CreditCard className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'comms',
    title: 'التواصل والمتابعة',
    items: [
      {
        id: 'announcements',
        label: 'إدارة الإعلانات',
        keywords: 'اعلان تنبيه بانر announcements',
        icon: <Megaphone className="h-4 w-4" />,
      },
      {
        id: 'communications',
        label: 'أسئلة الطلاب والإشعارات',
        keywords: 'تعليقات استفسارات رسائل اشعارات comments',
        icon: <MessageSquare className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'system',
    title: 'إدارة النظام',
    items: [
      {
        id: 'staff',
        label: 'الفريق والصلاحيات',
        keywords: 'مساعدين موظفين ادوار صلاحيات staff',
        icon: <ShieldCheck className="h-4 w-4" />,
      },
      {
        id: 'devices',
        label: 'الأجهزة والجلسات',
        keywords: 'جلسات نشطة تسجيل دخول اجهزة devices',
        icon: <MonitorSmartphone className="h-4 w-4" />,
      },
      {
        id: 'settings',
        label: 'إعدادات المنصة',
        keywords: 'الهوية الصيانة تواصل cms settings',
        icon: <Settings className="h-4 w-4" />,
      },
      {
        id: 'audit',
        label: 'النسخ الاحتياطي وسجل التدقيق',
        keywords: 'نسخة احتياطية تدقيق امان backup audit',
        icon: <Database className="h-4 w-4" />,
      },
    ],
  },
];

const ALL_NAV_ITEMS: NavItemDef[] = NAV_GROUPS.flatMap((g) => g.items);

const OPS_HOSTED_TABS = new Set<AdminTab>([
  'groups',
  'communications',
  'settings',
  'staff',
  'audit',
  'operations',
]);

function mapTabToOpsSubTab(
  tabId: AdminTab,
  fallback?: 'groups' | 'comms' | 'devices' | 'cms' | 'security',
): 'groups' | 'comms' | 'devices' | 'cms' | 'security' | undefined {
  switch (tabId) {
    case 'groups':
      return 'groups';
    case 'communications':
      return 'comms';
    case 'settings':
      return 'cms';
    case 'staff':
    case 'audit':
      return 'security';
    case 'operations':
      return fallback;
    default:
      return undefined;
  }
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  bootstrap,
  me,
  onRefreshBootstrap,
  onOpenStudentPreview,
  onBackHome,
  onLogout,
}) => {
  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((item) => canAccessAdminTab(me.user, item.id)),
      })).filter((g) => g.items.length > 0),
    [me.user],
  );

  const visibleNavItems = useMemo(
    () => visibleGroups.flatMap((g) => g.items),
    [visibleGroups],
  );

  const defaultTab: AdminTab = visibleNavItems[0]?.id ?? 'overview';
  const canViewStudents = hasAnyPermission(me.user, [
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.STUDENTS_APPROVE,
    PERMISSIONS.STUDENTS_MANAGE,
  ]);

  const [tab, setTab] = useState<AdminTab>(defaultTab);
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set([defaultTab]));
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingStudentsBadge, setPendingStudentsBadge] = useState(0);
  const [navIntent, setNavIntent] = useState<{
    target: DashboardNavigationTarget | null;
    nonce: number;
  }>({ target: null, nonce: 0 });
  const [catalog, setCatalog] = useState<AdminCatalogData | null>(null);
  const [toast, setToast] = useState('');
  const [adminNotifs, setAdminNotifs] = useState<AdminNotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const resolveIncomingTab = useCallback(
    (rawTab: AdminTab, opsSubTab?: DashboardNavigationTarget['opsSubTab']): AdminTab => {
      if (rawTab === 'operations') {
        if (opsSubTab === 'groups' && canAccessAdminTab(me.user, 'groups')) return 'groups';
        if (opsSubTab === 'comms' && canAccessAdminTab(me.user, 'communications')) {
          return 'communications';
        }
        if (opsSubTab === 'devices' && canAccessAdminTab(me.user, 'devices')) return 'devices';
        if (opsSubTab === 'cms' && canAccessAdminTab(me.user, 'settings')) return 'settings';
        if (opsSubTab === 'security') {
          if (canAccessAdminTab(me.user, 'staff')) return 'staff';
          if (canAccessAdminTab(me.user, 'audit')) return 'audit';
        }
        // Fallback to first accessible dedicated operations tab
        const fallbacks: AdminTab[] = ['groups', 'communications', 'settings', 'staff', 'audit', 'devices'];
        const first = fallbacks.find((t) => canAccessAdminTab(me.user, t));
        if (first) return first;
      }
      return rawTab;
    },
    [me.user],
  );

  const selectTab = useCallback((nextTab: AdminTab, opts?: { skipHistory?: boolean }) => {
    setVisitedTabs((prev) => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
    setTab(nextTab);
    if (!opts?.skipHistory) {
      pushLmsHistoryState({ screen: 'dashboard', adminTab: nextTab }, 'push');
    }
  }, []);

  useEffect(() => {
    const initialParsed = parseHashToNavState(window.location.hash);
    if (initialParsed?.adminTab) {
      const candidate = resolveIncomingTab(initialParsed.adminTab as AdminTab);
      if (canAccessAdminTab(me.user, candidate)) {
        selectTab(candidate, { skipHistory: true });
        pushLmsHistoryState({ screen: 'dashboard', adminTab: candidate }, 'replace');
      } else {
        pushLmsHistoryState({ screen: 'dashboard', adminTab: defaultTab }, 'replace');
      }
    } else {
      pushLmsHistoryState({ screen: 'dashboard', adminTab: defaultTab }, 'replace');
    }
    const onPopState = (ev: PopStateEvent) => {
      setSidebarOpen(false);
      setNotifOpen(false);
      setSearchFocused(false);
      const st = ev.state as AppNavHistoryState | null;
      if (st?.__lmsGuard) return;
      const rawCandidate = st?.adminTab || parseHashToNavState(window.location.hash)?.adminTab;
      if (rawCandidate) {
        const candidate = resolveIncomingTab(rawCandidate as AdminTab);
        if (canAccessAdminTab(me.user, candidate)) {
          selectTab(candidate, { skipHistory: true });
        }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoBack = useCallback(() => {
    if (sidebarOpen) {
      setSidebarOpen(false);
      return;
    }
    if (notifOpen) {
      setNotifOpen(false);
      return;
    }
    goBackInLms(() => {
      if (tab !== defaultTab) {
        selectTab(defaultTab);
      } else {
        onBackHome();
      }
    });
  }, [sidebarOpen, notifOpen, tab, defaultTab, selectTab, onBackHome]);

  useEffect(() => {
    if (!canAccessAdminTab(me.user, tab) && visibleNavItems.length > 0) {
      selectTab(visibleNavItems[0].id);
    }
  }, [me.user, tab, visibleNavItems, selectTab]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4500);
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const cat = await apiRequest<AdminCatalogData>('/api/admin/catalog');
      setCatalog(cat);
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [showToast]);

  const loadAdminNotifications = useCallback(async () => {
    try {
      const res = await apiRequest<{ notifications: AdminNotificationItem[] }>(
        '/api/admin/notifications',
      );
      setAdminNotifs(res.notifications || []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadAdminNotifications();
  }, [loadCatalog, loadAdminNotifications]);

  const navigateFromDashboard = useCallback(
    (target: DashboardNavigationTarget) => {
      const resolvedTab = resolveIncomingTab(target.tab, target.opsSubTab);
      if (!canAccessAdminTab(me.user, resolvedTab)) {
        showToast('ليس لديك صلاحية للوصول إلى هذا القسم.');
        return;
      }
      setNavIntent((prev) => ({ target: { ...target, tab: resolvedTab }, nonce: prev.nonce + 1 }));
      selectTab(resolvedTab);
      setSidebarOpen(false);
    },
    [me.user, resolveIncomingTab, showToast, selectTab],
  );

  const handleAdminNotificationClick = useCallback(
    async (n: AdminNotificationItem) => {
      setNotifOpen(false);
      if (!n.isRead) {
        setAdminNotifs((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)),
        );
        apiRequest('/api/admin/notifications/read', {
          method: 'POST',
          body: JSON.stringify({ id: n.id }),
        }).catch(() => undefined);
      }

      const t = String(n.targetType || '').toUpperCase();
      if (t === 'HOMEWORK') {
        navigateFromDashboard({ tab: 'homework' });
      } else if (
        t === 'EXAM' ||
        t === 'EXAM_RESULT' ||
        n.type === 'NEW_EXAM' ||
        n.type === 'EXAM_RESULT'
      ) {
        navigateFromDashboard({ tab: 'exams' });
      } else if (t === 'QUESTION_BANK') {
        navigateFromDashboard({ tab: 'question_bank', questionBankStatusTab: 'PENDING_REVIEW' });
      } else if (t === 'STUDENT' || t === 'STUDENTS') {
        navigateFromDashboard({ tab: 'students', studentStatusFilter: 'PENDING_APPROVAL' });
      } else if (t === 'COURSE' || t === 'COURSES') {
        navigateFromDashboard({ tab: 'courses' });
      } else if (t === 'PAYMENT' || t === 'ORDER') {
        navigateFromDashboard({ tab: 'payments' });
      } else if (t === 'DEVICES') {
        navigateFromDashboard({ tab: 'devices' });
      } else {
        showToast(`${n.titleAr}: ${n.bodyAr}`);
      }
    },
    [navigateFromDashboard, showToast],
  );

  const unreadNotifCount = useMemo(
    () => adminNotifs.filter((n) => !n.isRead).length,
    [adminNotifs],
  );

  const searchResults = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return [];
    return visibleNavItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
    );
  }, [quickSearch, visibleNavItems]);

  const currentTabLabel =
    ALL_NAV_ITEMS.find((i) => i.id === tab)?.label ||
    (tab === 'operations' ? 'التشغيل والإعدادات' : 'لوحة التحكم الذكية');
  const hasCurrentTabAccess = canAccessAdminTab(me.user, tab);

  const hasVisitedOpsHost = useMemo(
    () => Array.from(visitedTabs).some((t) => OPS_HOSTED_TABS.has(t)),
    [visitedTabs],
  );
  const isOpsHostActive = OPS_HOSTED_TABS.has(tab);

  const userInitial = (me.user.fullName || 'م').trim().charAt(0);

  return (
    <div className="min-h-screen bg-[#F5F7FB] text-[#0F172A]">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {/* Fixed RTL Right Sidebar — Unified #0D172B */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 flex w-64 max-w-[82vw] flex-col border-l border-slate-800/80 bg-[#0D172B] text-white transition-[transform,visibility] duration-200 lg:visible lg:pointer-events-auto lg:translate-x-0 ${
          sidebarOpen ? 'visible pointer-events-auto translate-x-0' : 'invisible pointer-events-none translate-x-full'
        }`}
      >
        {/* Brand Block */}
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <button
            type="button"
            onClick={onBackHome}
            className="flex min-w-0 items-center gap-2.5 text-right"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white shadow-sm">
              <Atom className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-extrabold text-white">
                {bootstrap.settings.platformName}
              </div>
              <div className="truncate text-[10px] font-medium text-slate-400">
                لوحة الإدارة والتحكم
              </div>
            </div>
          </button>
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={() => setSidebarOpen(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Staff Profile Chip */}
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/25 font-display text-xs font-extrabold text-blue-200 ring-1 ring-blue-400/30">
              {userInitial}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-extrabold text-white">{me.user.fullName}</div>
              <div className="truncate text-[11px] text-slate-400">{me.user.roleNameAr}</div>
            </div>
          </div>
        </div>

        {/* 6 Collapsible Navigation Groups */}
        <nav
          aria-label="أقسام لوحة الإدارة"
          className="flex-1 space-y-3 overflow-y-auto px-3 py-3.5"
        >
          {visibleGroups.map((group) => {
            const isCollapsed = Boolean(collapsedGroups[group.id]);
            const hasActiveChild = group.items.some((item) => item.id === tab);
            return (
              <div key={group.id} className="space-y-1">
                {group.id !== 'general' && (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                    }
                    className="flex min-h-[34px] w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold tracking-wide text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                  >
                    <span>{group.title}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        isCollapsed && !hasActiveChild ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                )}

                {(!isCollapsed || hasActiveChild) && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = tab === item.id;
                      const showPendingDot =
                        item.id === 'students' && canViewStudents && pendingStudentsBadge > 0;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            selectTab(item.id);
                            setSidebarOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-right text-xs font-semibold transition-all ${
                            active
                              ? 'bg-[#2563EB] text-white shadow-[0_4px_12px_rgba(37,99,235,0.35)]'
                              : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={
                                active ? 'text-white' : 'text-slate-400 group-hover:text-white'
                              }
                            >
                              {item.icon}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </span>
                          {showPendingDot && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-extrabold tabular-nums ${
                                active
                                  ? 'bg-white/20 text-white'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {pendingStudentsBadge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="space-y-1.5 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onOpenStudentPreview}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Eye className="h-4 w-4 text-blue-300" />
            <span>معاينة بوابة الطالب</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-200"
          >
            <LogOut className="h-4 w-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area — Full Balanced Width */}
      <div className="lg:pr-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-7">
          {/* Right side (RTL start): Hamburger + Back Button + Breadcrumb */}
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              aria-label="فتح القائمة"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              data-testid="admin-back-btn"
              onClick={handleGoBack}
              aria-label="الرجوع للصفحة السابقة"
              title="الرجوع للصفحة السابقة"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition-colors hover:border-[#2563EB]/40 hover:bg-blue-50/70 hover:text-[#2563EB]"
            >
              <ArrowRight className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">رجوع</span>
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <button
                  type="button"
                  onClick={() => selectTab('overview')}
                  className="shrink-0 hover:text-[#2563EB]"
                >
                  لوحة الإدارة
                </button>
                <span>/</span>
                <span className="truncate font-semibold text-slate-600">{currentTabLabel}</span>
              </div>
              <h1 className="truncate font-display text-sm font-extrabold text-[#0F172A] sm:text-base">
                {currentTabLabel}
              </h1>
            </div>
          </div>

          {/* Center: Quick Authorized Section Search */}
          <div ref={searchRef} className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={quickSearch}
              onFocus={() => setSearchFocused(true)}
              onChange={(e) => {
                setQuickSearch(e.target.value);
                setSearchFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchFocused(false);
                } else if (e.key === 'Enter' && searchResults.length > 0) {
                  selectTab(searchResults[0].id);
                  setQuickSearch('');
                  setSearchFocused(false);
                }
              }}
              placeholder="انتقال سريع بين أقسام الإدارة..."
              aria-label="انتقال سريع بين أقسام الإدارة"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/80 pr-9 pl-3 text-xs font-medium text-[#0F172A] placeholder:text-slate-400 transition-colors focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
            />
            {searchFocused && quickSearch.trim().length > 0 && (
              <div className="absolute right-0 left-0 top-10 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                {searchResults.length === 0 ? (
                  <div className="px-3 py-2.5 text-center text-xs text-slate-500">
                    لا يوجد قسم مطابق في نطاق صلاحياتك
                  </div>
                ) : (
                  searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        selectTab(item.id);
                        setQuickSearch('');
                        setSearchFocused(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-right text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-[#2563EB]"
                    >
                      <span className="text-[#2563EB]">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Left side (RTL end): Pending badge + Active Devices + Notifications + User */}
          <div className="flex shrink-0 items-center gap-2">
            {canViewStudents && pendingStudentsBadge > 0 && (
              <button
                type="button"
                onClick={() =>
                  navigateFromDashboard({
                    tab: 'students',
                    studentStatusFilter: 'PENDING_APPROVAL',
                  })
                }
                className="hidden items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100 xl:inline-flex"
              >
                <span>طلبات معلّقة:</span>
                <span className="font-mono-num font-extrabold tabular-nums">
                  {pendingStudentsBadge}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => selectTab('devices')}
              title="الأجهزة والجلسات النشطة"
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                tab === 'devices'
                  ? 'border-blue-200 bg-blue-50 text-[#2563EB]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <MonitorSmartphone className="h-4 w-4 text-[#2563EB]" />
              <span className="hidden sm:inline">الأجهزة النشطة</span>
            </button>

            {/* Actionable Staff Notifications Bell */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                aria-label="الإشعارات"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 font-mono-num text-[10px] font-bold text-white">
                    {unreadNotifCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute left-0 top-11 z-50 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-extrabold text-[#0F172A]">
                      إشعارات لوحة الإدارة
                    </span>
                    {unreadNotifCount > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          setAdminNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
                          await apiRequest('/api/admin/notifications/read', {
                            method: 'POST',
                            body: JSON.stringify({}),
                          }).catch(() => undefined);
                        }}
                        className="text-[11px] font-bold text-[#2563EB] hover:underline"
                      >
                        تحديد الكل كمقروء
                      </button>
                    )}
                  </div>
                  <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                    {adminNotifs.length === 0 ? (
                      <p className="py-5 text-center text-xs text-slate-500">
                        لا توجد إشعارات جديدة حاليًا.
                      </p>
                    ) : (
                      adminNotifs.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => void handleAdminNotificationClick(n)}
                          className={`w-full rounded-xl border p-2.5 text-right transition-colors ${
                            n.isRead
                              ? 'border-slate-100 bg-white hover:bg-slate-50'
                              : 'border-blue-100 bg-blue-50/50 hover:bg-blue-50'
                          }`}
                        >
                          <div className="text-xs font-bold text-[#0F172A]">{n.titleAr}</div>
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
                            {n.bodyAr}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {formatDateTimeAr(n.createdAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onBackHome}
              title="العودة إلى الصفحة الرئيسية للمنصة"
              className="hidden h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 sm:inline-flex"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 font-display text-[11px] font-extrabold text-[#2563EB]">
                {userInitial}
              </span>
              <span className="hidden max-w-[160px] truncate xl:inline">{me.user.fullName}</span>
            </button>
          </div>
        </header>

        {toast && (
          <div
            role="status"
            className="fixed bottom-5 left-5 z-50 max-w-md rounded-xl border border-slate-800 bg-[#0D172B] px-4 py-3 text-sm font-medium text-white shadow-xl"
          >
            {toast}
          </div>
        )}

        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-7">
          {!hasCurrentTabAccess && (
            <div className="rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
              <h2 className="text-base font-extrabold text-[#0F172A]">ليس لديك صلاحية</h2>
              <p className="mt-2 text-xs text-slate-600">
                دورك الوظيفي الحالي ({me.user.roleNameAr}) لا يسمح بالوصول إلى هذا القسم. تواصل مع
                المدير العام إذا كنت بحاجة إلى صلاحية إضافية.
              </p>
            </div>
          )}

          {/* Overview stays cached once visited; chart renders only while isActive=true */}
          {canAccessAdminTab(me.user, 'overview') && visitedTabs.has('overview') && (
            <div className={tab === 'overview' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <SmartTeacherDashboard
                  isActive={tab === 'overview'}
                  currentUser={me.user}
                  notifications={adminNotifs}
                  onNotificationClick={handleAdminNotificationClick}
                  onNavigate={navigateFromDashboard}
                  onPendingStudentsSync={setPendingStudentsBadge}
                />
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'students') && visitedTabs.has('students') && (
            <div className={tab === 'students' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminStudentsPanel
                    tracks={catalog.tracks}
                    grades={catalog.grades}
                    videos={catalog.videos}
                    courses={catalog.courses}
                    currentUser={me.user}
                    onToast={showToast}
                    initialStatusFilter={
                      navIntent.target?.tab === 'students'
                        ? navIntent.target.studentStatusFilter
                        : undefined
                    }
                    initialAction={
                      navIntent.target?.tab === 'students'
                        ? navIntent.target.studentAction
                        : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'videos') && visitedTabs.has('videos') && (
            <div className={tab === 'videos' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminVideosPanel
                    catalog={catalog}
                    currentUser={me.user}
                    onReload={async () => {
                      await loadCatalog();
                      await onRefreshBootstrap();
                    }}
                    onToast={showToast}
                    initialAction={
                      navIntent.target?.tab === 'videos' ? navIntent.target.videoAction : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'tracks') && visitedTabs.has('tracks') && (
            <div className={tab === 'tracks' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminContentPanel
                    section="tracks"
                    catalog={catalog}
                    currentUser={me.user}
                    onReload={async () => {
                      await loadCatalog();
                      await onRefreshBootstrap();
                    }}
                    onToast={showToast}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'courses') && visitedTabs.has('courses') && (
            <div className={tab === 'courses' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminContentPanel
                    section="courses"
                    catalog={catalog}
                    currentUser={me.user}
                    onReload={async () => {
                      await loadCatalog();
                      await onRefreshBootstrap();
                    }}
                    onToast={showToast}
                    initialAction={
                      navIntent.target?.tab === 'courses'
                        ? navIntent.target.courseAction
                        : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'codes') && visitedTabs.has('codes') && (
            <div className={tab === 'codes' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminCodesPaymentsPanel
                    section="codes"
                    catalog={catalog}
                    currentUser={me.user}
                    onToast={showToast}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'payments') && visitedTabs.has('payments') && (
            <div className={tab === 'payments' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminCodesPaymentsPanel
                    section="payments"
                    catalog={catalog}
                    currentUser={me.user}
                    onToast={showToast}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'question_bank') && visitedTabs.has('question_bank') && (
            <div className={tab === 'question_bank' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminQuestionBankPanel
                    catalog={catalog}
                    currentUser={me.user}
                    onToast={showToast}
                    initialStatusTab={
                      navIntent.target?.tab === 'question_bank'
                        ? navIntent.target.questionBankStatusTab
                        : undefined
                    }
                    initialAction={
                      navIntent.target?.tab === 'question_bank'
                        ? navIntent.target.questionBankAction
                        : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'exams') && visitedTabs.has('exams') && (
            <div className={tab === 'exams' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminExamsManager
                    catalog={catalog}
                    currentUser={me.user}
                    onToast={showToast}
                    initialStatusFilter={
                      navIntent.target?.tab === 'exams'
                        ? navIntent.target.examStatusFilter
                        : undefined
                    }
                    initialAction={
                      navIntent.target?.tab === 'exams' ? navIntent.target.examAction : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'homework') && visitedTabs.has('homework') && (
            <div className={tab === 'homework' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminHomeworkManager
                    catalog={catalog}
                    currentUser={me.user}
                    onToast={showToast}
                    initialStatusFilter={
                      navIntent.target?.tab === 'homework'
                        ? navIntent.target.homeworkStatusFilter
                        : undefined
                    }
                    initialAction={
                      navIntent.target?.tab === 'homework'
                        ? navIntent.target.homeworkAction
                        : undefined
                    }
                    navigationNonce={navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'curriculum') && visitedTabs.has('curriculum') && (
            <div className={tab === 'curriculum' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <AdminCurriculumManager
                  tracks={bootstrap.tracks.map((t) => ({ id: t.id, nameAr: t.nameAr }))}
                  grades={bootstrap.tracks.flatMap((t) =>
                    t.grades.map((g) => ({ id: g.id, trackId: t.id, nameAr: g.nameAr })),
                  )}
                />
              </Suspense>
            </div>
          )}

          {canAccessAdminTab(me.user, 'announcements') && visitedTabs.has('announcements') && (
            <div className={tab === 'announcements' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <AdminAnnouncementsManager
                  tracks={bootstrap.tracks.map((t) => ({ id: t.id, nameAr: t.nameAr }))}
                  grades={bootstrap.tracks.flatMap((t) =>
                    t.grades.map((g) => ({ id: g.id, trackId: t.id, nameAr: g.nameAr })),
                  )}
                  groups={[]}
                  initialAction={
                    navIntent.target?.tab === 'announcements'
                      ? navIntent.target.announcementAction
                      : undefined
                  }
                  navigationNonce={navIntent.nonce}
                />
              </Suspense>
            </div>
          )}

          {/* Dedicated Active Devices & Sessions Screen (accessible to all active staff) */}
          {canAccessAdminTab(me.user, 'devices') && visitedTabs.has('devices') && (
            <div className={tab === 'devices' ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <ActiveDevicesPanel adminLayout onLoggedOutCurrent={onLogout} onToast={showToast} />
              </Suspense>
            </div>
          )}

          {/* Dedicated System / Operations Workspaces: Groups, Communications, Settings, Staff, Audit */}
          {hasVisitedOpsHost && (
            <div className={isOpsHostActive ? '' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                {catalog ? (
                  <AdminExamsOpsPanel
                    section="operations"
                    activeSection={
                      tab === 'groups' ||
                      tab === 'communications' ||
                      tab === 'settings' ||
                      tab === 'staff' ||
                      tab === 'audit'
                        ? tab
                        : tab === 'operations'
                          ? 'operations'
                          : 'groups'
                    }
                    catalog={catalog}
                    settings={bootstrap.settings}
                    currentUser={me.user}
                    onRefreshBootstrap={onRefreshBootstrap}
                    onToast={showToast}
                    onLogout={onLogout}
                    onPreviewStudentPortal={onBackHome}
                    initialOpsSubTab={mapTabToOpsSubTab(
                      tab,
                      navIntent.target?.opsSubTab,
                    )}
                    navigationNonce={isOpsHostActive ? navIntent.nonce + tab.length * 1000 : navIntent.nonce}
                  />
                ) : (
                  <TabLoadingFallback />
                )}
              </Suspense>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
