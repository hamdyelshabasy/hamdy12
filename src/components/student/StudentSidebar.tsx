import React from 'react';
import {
  Award,
  Bell,
  BookCheck,
  BookOpen,
  Calendar,
  ClipboardList,
  CreditCard,
  FileText,
  HelpCircle,
  Home,
  Layers,
  MonitorSmartphone,
  PlaySquare,
  Settings,
  X,
} from 'lucide-react';
import type { StudentNavTarget } from '../../lib/studentDashboardMetrics.ts';

interface StudentSidebarProps {
  platformName: string;
  activeTab: StudentNavTarget;
  unreadCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectTab: (tab: StudentNavTarget) => void;
  onPreloadTab: (tab: StudentNavTarget) => void;
  onOpenNotifications: () => void;
}

const PhysicsAtomLogo: React.FC<{ className?: string }> = ({ className = 'h-8 w-8' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="atomGradA" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38BDF8" />
        <stop offset="1" stopColor="#818CF8" />
      </linearGradient>
    </defs>
    <ellipse cx="20" cy="20" rx="16" ry="6.2" stroke="url(#atomGradA)" strokeWidth="2" transform="rotate(30 20 20)" />
    <ellipse cx="20" cy="20" rx="16" ry="6.2" stroke="url(#atomGradA)" strokeWidth="2" transform="rotate(-30 20 20)" />
    <ellipse cx="20" cy="20" rx="16" ry="6.2" stroke="#60A5FA" strokeWidth="1.8" transform="rotate(90 20 20)" />
    <circle cx="20" cy="20" r="3.4" fill="#38BDF8" />
  </svg>
);

export const StudentSidebar: React.FC<StudentSidebarProps> = React.memo(({
  platformName,
  activeTab,
  unreadCount,
  mobileOpen,
  onCloseMobile,
  onSelectTab,
  onPreloadTab,
  onOpenNotifications,
}) => {
  const primaryItems: Array<{
    id: StudentNavTarget;
    label: string;
    icon: React.ReactNode;
    activeMatch?: StudentNavTarget[];
  }> = [
    { id: 'overview', label: 'الرئيسية', icon: <Home className="h-[18px] w-[18px]" /> },
    { id: 'curriculum', label: 'خطة المنهج', icon: <Layers className="h-[18px] w-[18px]" /> },
    { id: 'courses', label: 'الكورسات', icon: <BookOpen className="h-[18px] w-[18px]" /> },
    {
      id: 'library',
      label: 'الفيديوهات',
      icon: <PlaySquare className="h-[18px] w-[18px]" />,
      activeMatch: ['library', 'free', 'paid'],
    },
    { id: 'homework', label: 'الواجبات', icon: <BookCheck className="h-[18px] w-[18px]" /> },
    { id: 'exams', label: 'الامتحانات', icon: <ClipboardList className="h-[18px] w-[18px]" /> },
    { id: 'practice', label: 'بنك الأسئلة', icon: <HelpCircle className="h-[18px] w-[18px]" /> },
    { id: 'pdfs', label: 'المذكرات', icon: <FileText className="h-[18px] w-[18px]" /> },
    { id: 'schedule', label: 'الجدول والمواعيد', icon: <Calendar className="h-[18px] w-[18px]" /> },
    { id: 'results', label: 'النتائج والتقارير', icon: <Award className="h-[18px] w-[18px]" /> },
  ];

  const handleNavClick = (id: StudentNavTarget) => {
    onSelectTab(id);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#07112B] via-[#091534] to-[#060E24] text-slate-200 border-l border-[#2D4A8A]/35 shadow-[inset_1px_0_0_rgba(96,165,250,0.12)]">
      {/* Brand Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3.5">
        <button
          type="button"
          onClick={() => handleNavClick('overview')}
          className="flex items-center gap-2.5 text-right group min-w-0"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0F214D]/90 border border-[#38BDF8]/30 shadow-[0_0_14px_rgba(56,189,248,0.22)]">
            <PhysicsAtomLogo className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-[15px] font-extrabold leading-tight text-white truncate group-hover:text-sky-300 transition-colors">
              {platformName.includes('الفيزياء') ? 'منصة الفيزياء' : platformName}
            </div>
            <div className="text-[11px] font-medium text-slate-400 truncate">
              للمرحلة الثانوية
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="إغلاق القائمة الجانبية"
          className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main Navigation */}
      <nav
        aria-label="القائمة الرئيسية للطالب"
        className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5"
      >
        {primaryItems.map((item) => {
          const isActive = item.activeMatch
            ? item.activeMatch.includes(activeTab)
            : activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              onMouseEnter={() => onPreloadTab(item.id)}
              onFocus={() => onPreloadTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-bold transition-all duration-150 whitespace-nowrap ${
                isActive
                  ? 'bg-gradient-to-l from-[#1C64F2] via-[#1D82FF] to-[#1FA4FF] text-white shadow-[0_4px_18px_rgba(29,130,255,0.45)] ring-1 ring-sky-300/40'
                  : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-sky-300/80'}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        <div className="my-2.5 border-t border-white/10" />

        {/* Secondary Navigation */}
        <button
          type="button"
          onClick={() => handleNavClick('billing')}
          aria-current={activeTab === 'billing' ? 'page' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all whitespace-nowrap ${
            activeTab === 'billing'
              ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-[0_4px_16px_rgba(29,130,255,0.4)]'
              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          <CreditCard className="h-[17px] w-[17px] text-sky-300/80" />
          <span>اشتراكي</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavClick('devices')}
          onMouseEnter={() => onPreloadTab('devices')}
          onFocus={() => onPreloadTab('devices')}
          aria-current={activeTab === 'devices' ? 'page' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all whitespace-nowrap ${
            activeTab === 'devices'
              ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-[0_4px_16px_rgba(29,130,255,0.4)]'
              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          <MonitorSmartphone className="h-[17px] w-[17px] text-sky-300/80" />
          <span>أجهزتي</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onCloseMobile();
            onOpenNotifications();
          }}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-white transition-all whitespace-nowrap"
        >
          <span className="flex items-center gap-3">
            <Bell className="h-[17px] w-[17px] text-sky-300/80" />
            <span>الإشعارات</span>
          </span>
          {unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 font-mono-num text-[11px] font-bold text-white shadow-sm">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleNavClick('settings')}
          aria-current={activeTab === 'settings' ? 'page' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all whitespace-nowrap ${
            activeTab === 'settings'
              ? 'bg-gradient-to-l from-[#1C64F2] to-[#1FA4FF] text-white shadow-[0_4px_16px_rgba(29,130,255,0.4)]'
              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          <Settings className="h-[17px] w-[17px] text-sky-300/80" />
          <span>الإعدادات</span>
        </button>
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Right Sidebar */}
      <aside className="hidden lg:block lg:w-[220px] xl:w-[228px] shrink-0 sticky top-0 h-screen z-30">
        {sidebarContent}
      </aside>

      {/* Mobile & Tablet Slide-Over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[260px] max-w-[82vw] h-full shadow-2xl">{sidebarContent}</div>
          <button
            type="button"
            aria-label="إغلاق القائمة"
            onClick={onCloseMobile}
            className="flex-1 bg-slate-950/70 backdrop-blur-xs"
          />
        </div>
      )}
    </>
  );
});
