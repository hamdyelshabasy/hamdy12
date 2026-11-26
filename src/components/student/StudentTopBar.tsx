import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  ChevronDown,
  Crown,
  ExternalLink,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  Search,
  Share2,
  Shield,
  X,
} from 'lucide-react';
import type {
  EnrollmentItem,
  MeResponse,
  StudentDashboardData,
  StudentDeepLinkTarget,
  StudentVideoItem,
} from '../../types/lms.ts';
import {
  searchStudentContent,
  type StudentNavTarget,
  type StudentSearchResult,
} from '../../lib/studentDashboardMetrics.ts';

interface StudentTopBarProps {
  me: MeResponse;
  data: StudentDashboardData | null;
  approvedEnrollments: EnrollmentItem[];
  selectedGradeId: number;
  unreadCount: number;
  isStaff: boolean;
  onOpenMobileMenu: () => void;
  onToggleNotifications: () => void;
  onSelectTab: (tab: StudentNavTarget) => void;
  onSelectGrade: (gradeId: number) => void;
  onOpenRequestGrade: () => void;
  onPlayVideo: (video: StudentVideoItem) => void;
  onOpenExam: (examId: number) => void;
  onNavigateTarget: (target: StudentDeepLinkTarget) => void;
  onOpenParentReport: (code: string) => void;
  onOpenAdmin?: () => void;
  onGoBack?: () => void;
  onBackHome: () => void;
  onLogout: () => Promise<void>;
}

export const StudentTopBar: React.FC<StudentTopBarProps> = React.memo(({
  me,
  data,
  approvedEnrollments,
  selectedGradeId,
  unreadCount,
  isStaff,
  onOpenMobileMenu,
  onToggleNotifications,
  onSelectTab,
  onSelectGrade,
  onOpenRequestGrade,
  onPlayVideo,
  onOpenExam,
  onNavigateTarget,
  onOpenParentReport,
  onOpenAdmin,
  onGoBack,
  onBackHome,
  onLogout,
}) => {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const profileBoxRef = useRef<HTMLDivElement>(null);

  const searchResults = useMemo(() => searchStudentContent(data, query), [data, query]);

  // Ctrl+K / Cmd+K shortcut focuses the global search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      } else if (e.key === 'Escape') {
        setSearchFocused(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close popovers on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
      if (profileBoxRef.current && !profileBoxRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const handleSelectResult = (item: StudentSearchResult) => {
    setQuery('');
    setSearchFocused(false);
    if (item.video) {
      onNavigateTarget({ type: 'VIDEO', entityId: item.video.id });
      return;
    }
    if (item.kind === 'EXAM' && (item.examId || item.entityId)) {
      onNavigateTarget({ type: 'EXAM', entityId: item.examId || item.entityId! });
      return;
    }
    if (item.kind === 'HOMEWORK' && item.entityId) {
      onNavigateTarget({ type: 'HOMEWORK', entityId: item.entityId });
      return;
    }
    if (item.kind === 'COURSE' && item.entityId) {
      onNavigateTarget({ type: 'COURSE', entityId: item.entityId });
      return;
    }
    if (item.kind === 'PDF' && item.entityId) {
      onNavigateTarget({ type: 'PDF', entityId: item.entityId });
      return;
    }
    if (item.kind === 'SCHEDULE' && item.entityId) {
      onNavigateTarget({ type: 'SCHEDULE', entityId: item.entityId });
      return;
    }
    onSelectTab(item.targetTab);
  };

  const initials = me.user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');

  const subActive = Boolean(data?.platformSubscription?.isActive);
  const unlockedCount = data?.courses.filter((c) => c.isUnlocked).length || 0;
  const hasPremiumAccess = subActive || unlockedCount > 0;

  return (
    <header className="sticky top-0 z-20 border-b border-[#2D4A8A]/35 bg-[#07112B]/90 backdrop-blur-md">
      <div className="flex h-[54px] items-center justify-between gap-2.5 px-3 sm:px-5">
        {/* Right-side: Mobile Menu Button + Global Search */}
        <div className="flex flex-1 items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="فتح القائمة الجانبية"
            className="lg:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-[#0E1D45] text-slate-200 hover:bg-[#172B5E]"
          >
            <Menu className="h-5 w-5" />
          </button>

          {onGoBack && (
            <button
              type="button"
              data-testid="student-back-btn"
              onClick={onGoBack}
              aria-label="الرجوع للصفحة السابقة"
              title="الرجوع للصفحة السابقة"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-[#0E1D45] px-2.5 text-xs font-bold text-slate-200 transition-colors hover:border-sky-400/50 hover:bg-[#172B5E] hover:text-white"
            >
              <ArrowRight className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">رجوع</span>
            </button>
          )}

          {isStaff && onOpenAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-sky-400/35 bg-[#0E214F] px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-[#16306D] whitespace-nowrap shrink-0"
            >
              <Shield className="h-3.5 w-3.5" />
              <span>لوحة الإدارة</span>
            </button>
          )}

          {/* Working Global Search Bar */}
          <div ref={searchBoxRef} className="relative flex-1 max-w-xl">
            <div className="flex items-center gap-2 rounded-full border border-[#3B5CA8]/50 bg-[#0D1A3D]/95 px-3.5 py-1.5 text-slate-200 focus-within:border-[#38BDF8] focus-within:shadow-[0_0_16px_rgba(56,189,248,0.22)] transition-all">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="ابحث في محتوى المنصة"
                value={query}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchFocused(true);
                }}
                placeholder="ابحث عن درس، كورس، امتحان، أو أي محتوى..."
                className="w-full bg-transparent text-xs sm:text-[13px] text-white placeholder:text-slate-400 focus:outline-none"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="مسح البحث"
                  onClick={() => setQuery('')}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd
                  dir="ltr"
                  className="hidden md:inline-flex shrink-0 items-center rounded-md border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-slate-300"
                >
                  Ctrl + K
                </kbd>
              )}
            </div>

            {searchFocused && query.trim().length > 0 && (
              <div
                role="listbox"
                aria-label="نتائج البحث"
                className="absolute right-0 left-0 top-full mt-2 z-50 max-h-80 overflow-y-auto rounded-2xl border border-[#3B5CA8]/60 bg-[#0A1636] p-2 shadow-2xl"
              >
                {searchResults.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-slate-400">
                    لا توجد نتائج مطابقة لـ «{query}» ضمن محتوى صفك الدراسي.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {searchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectResult(item)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-right hover:bg-white/10 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{item.titleAr}</div>
                          <div className="text-[11px] text-slate-400 truncate">{item.subtitleAr}</div>
                        </div>
                        <span className="shrink-0 rounded-md bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                          {item.kindLabelAr}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Left-side Controls: Quick Code / Notifications / Subscription Pill / Student Profile */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Code Activation shortcut */}
          <button
            type="button"
            onClick={() => onSelectTab('billing')}
            aria-label="تفعيل كود أو اشتراك"
            title="تفعيل كود أو اشتراك"
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-[#0D1C42] text-slate-200 hover:border-sky-400/50 hover:text-white transition-colors"
          >
            <KeyRound className="h-4 w-4" />
          </button>

          {/* Notifications Bell */}
          <button
            type="button"
            aria-label="الإشعارات"
            onClick={onToggleNotifications}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-[#0D1C42] text-slate-200 hover:border-sky-400/50 hover:text-white transition-colors"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono-num text-[10px] font-bold text-white ring-2 ring-[#07112B]">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Real Subscription Status Gold Pill */}
          <button
            type="button"
            onClick={() => onSelectTab('billing')}
            className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-amber-400/55 bg-gradient-to-l from-amber-500/20 via-amber-400/15 to-yellow-500/10 px-3.5 py-1.5 text-xs font-extrabold text-amber-300 hover:border-amber-300 hover:bg-amber-500/25 transition-all whitespace-nowrap"
          >
            <Crown className="h-3.5 w-3.5 text-amber-300" />
            <span>
              {subActive
                ? `اشتراك نشط · ${data?.platformSubscription?.remainingDays}ي`
                : hasPremiumAccess
                  ? 'حساب مفعّل'
                  : 'تفعيل الاشتراك'}
            </span>
          </button>

          {/* Real Student Account Dropdown */}
          <div ref={profileBoxRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((o) => !o)}
              aria-expanded={profileOpen}
              aria-label="قائمة حساب الطالب"
              className="flex items-center gap-2.5 rounded-full border border-[#3B5CA8]/45 bg-[#0D1C42]/95 py-1 pr-2.5 pl-1.5 text-right hover:border-sky-400/60 transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
              <div className="hidden sm:block max-w-[140px]">
                <div className="text-xs font-extrabold text-white truncate leading-tight">
                  {me.user.fullName}
                </div>
                <div className="text-[10.5px] text-slate-300 truncate leading-tight">
                  {data?.activeGrade?.nameAr || 'لوحة الطالب'}
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#38BDF8] via-[#2563EB] to-[#7C3AED] font-display text-xs font-extrabold text-white ring-2 ring-sky-400/40">
                {initials || 'ط'}
              </div>
            </button>

            {profileOpen && (
              <div className="absolute left-0 top-full mt-2 z-50 w-64 rounded-2xl border border-[#3B5CA8]/55 bg-[#0A1636] p-3 text-slate-200 shadow-2xl">
                <div className="border-b border-white/10 pb-2.5">
                  <div className="text-xs font-extrabold text-white">{me.user.fullName}</div>
                  <div className="mt-0.5 text-[11px] text-sky-300">
                    {data?.activeGrade
                      ? `${data.activeGrade.trackNameAr} · ${data.activeGrade.nameAr}`
                      : me.user.roleNameAr}
                  </div>
                </div>

                {approvedEnrollments.length > 1 && (
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-400">
                      تبديل الصف الدراسي
                    </label>
                    <select
                      aria-label="تبديل الصف الدراسي"
                      value={selectedGradeId}
                      onChange={(e) => {
                        onSelectGrade(Number(e.target.value));
                        setProfileOpen(false);
                      }}
                      className="w-full rounded-lg border border-white/15 bg-[#102252] px-2.5 py-1.5 text-xs font-semibold text-white"
                    >
                      {approvedEnrollments.map((enr) => (
                        <option key={enr.gradeId} value={enr.gradeId}>
                          {enr.trackNameAr} — {enr.gradeNameAr}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="mt-2.5 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenRequestGrade();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    <Plus className="h-3.5 w-3.5 text-sky-400" />
                    <span>طلب الانضمام لصف آخر</span>
                  </button>

                  {data?.parentShareCode && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onOpenParentReport(data.parentShareCode!);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                    >
                      <Share2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>تقرير ولي الأمر ({data.parentShareCode})</span>
                    </button>
                  )}

                  {isStaff && onOpenAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onOpenAdmin();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-sky-300 hover:bg-white/10"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      <span>العودة للوحة الإدارة</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onBackHome();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    <span>الصفحة الرئيسية للمنصة</span>
                  </button>

                  <div className="my-1 border-t border-white/10" />

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      void onLogout();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/15"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});
