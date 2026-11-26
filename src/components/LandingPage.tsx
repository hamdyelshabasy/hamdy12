import React from 'react';
import {
  Atom,
  ChevronLeft,
  LogIn,
  User,
  UserPlus,
  Users,
} from 'lucide-react';
import type { AuthUser, BootstrapResponse, GradeItem, TrackItem } from '../types/lms.ts';

interface LandingPageProps {
  bootstrap: BootstrapResponse;
  currentUser: AuthUser | null;
  onSelectGrade: (track: TrackItem, grade: GradeItem) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenDashboard: () => void;
  onOpenAdmin: () => void;
  onOpenParentReport: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  bootstrap,
  currentUser,
  onOpenAuth,
  onOpenDashboard,
  onOpenAdmin,
  onOpenParentReport,
}) => {
  const { settings } = bootstrap;

  const isStaff =
    currentUser &&
    ['SUPER_ADMIN', 'CONTENT_MANAGER', 'TEACHING_ASSISTANT', 'SUPPORT'].includes(
      currentUser.roleSlug,
    );

  // Preserve Maintenance mode gate for non-staff visitors
  if (settings.maintenanceMode && !isStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#06122B] px-6 text-center text-white">
        <div className="max-w-lg rounded-2xl border border-white/15 bg-[#0D1D42] p-8 shadow-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-[#2563EB]/20 text-[#60A5FA]">
            <Atom className="h-7 w-7" />
          </div>
          <h1 className="font-display text-2xl font-extrabold">{settings.platformName}</h1>
          <p className="mt-3 text-base text-slate-300">{settings.maintenanceMessage}</p>
          <button
            type="button"
            onClick={() => onOpenAuth('login')}
            className="mt-6 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1D4ED8]"
          >
            دخول إدارة المنصة
          </button>
        </div>
      </div>
    );
  }

  const handlePrimaryAction = () => {
    if (!currentUser) {
      onOpenAuth('login');
    } else if (isStaff) {
      onOpenAdmin();
    } else {
      onOpenDashboard();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#06122B] text-white selection:bg-[#2563EB] selection:text-white">
      {/* Clean White Header: Wordmark (Right) + Primary Action Button (Left), Zero Dead Nav Links */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <div className="font-display text-[15px] sm:text-[21px] font-black tracking-tight text-[#08152E] whitespace-nowrap">
            {settings.platformName || 'منصة الشباسي في الفيزياء'}
          </div>

          <button
            type="button"
            onMouseEnter={() => {
              if (!currentUser) void import('./AuthView.tsx');
            }}
            onFocus={() => {
              if (!currentUser) void import('./AuthView.tsx');
            }}
            onClick={handlePrimaryAction}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1D63ED] px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-bold text-white shadow-[0_4px_14px_rgba(29,99,237,0.32)] hover:bg-[#1552CC] active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
          >
            <User className="h-4 w-4" />
            <span>
              {!currentUser ? 'تسجيل الدخول' : isStaff ? 'لوحة تحكم المدرس' : 'لوحة الطالب'}
            </span>
          </button>
        </div>
      </header>

      {/* Single-Screen Dark Navy Welcome Hero + 3 Action Cards */}
      <main className="relative flex-1 flex items-center overflow-hidden">
        {/* Deep Navy Gradient & Subtle Physics Wave / Prism Decorative Backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 55% at 22% 42%, rgba(37,99,235,0.22), transparent 70%), radial-gradient(ellipse 50% 50% at 78% 28%, rgba(56,189,248,0.12), transparent 68%), linear-gradient(180deg, #06132E 0%, #071738 52%, #050F24 100%)',
          }}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 1440 720"
          fill="none"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-35 object-cover"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Subtle Physics Prism Geometry */}
          <polygon
            points="720,85 570,355 870,355"
            stroke="url(#prismLine)"
            strokeWidth="1.2"
            fill="url(#prismFill)"
          />
          <line x1="870" y1="355" x2="1440" y2="90" stroke="url(#beamLine)" strokeWidth="1.2" />
          <line x1="720" y1="85" x2="645" y2="355" stroke="rgba(96,165,250,0.2)" strokeWidth="1" />
          {/* Gentle Physics Wave Curves */}
          <path
            d="M0 440 C 260 350, 520 510, 780 420 C 1040 330, 1240 460, 1440 380"
            stroke="rgba(59,130,246,0.22)"
            strokeWidth="1.2"
          />
          <path
            d="M0 480 C 280 390, 540 545, 810 455 C 1060 365, 1260 495, 1440 420"
            stroke="rgba(56,189,248,0.15)"
            strokeWidth="1"
          />
          <path
            d="M0 520 C 300 435, 560 580, 840 490 C 1090 400, 1280 530, 1440 460"
            stroke="rgba(59,130,246,0.1)"
            strokeWidth="1"
          />
          {/* Subtle Atomic Orbit Arcs top-right */}
          <circle cx="1160" cy="140" r="145" stroke="rgba(96,165,250,0.08)" strokeWidth="1" />
          <circle cx="1160" cy="140" r="210" stroke="rgba(96,165,250,0.06)" strokeWidth="1" />
          <defs>
            <linearGradient id="prismLine" x1="570" y1="85" x2="870" y2="355" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60A5FA" stopOpacity="0.45" />
              <stop offset="1" stopColor="#38BDF8" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="prismFill" x1="720" y1="85" x2="720" y2="355" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2563EB" stopOpacity="0.14" />
              <stop offset="1" stopColor="#0B1C3D" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="beamLine" x1="870" y1="355" x2="1440" y2="90" gradientUnits="userSpaceOnUse">
              <stop stopColor="#38BDF8" stopOpacity="0.32" />
              <stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {/* Upper Hero Row: Headline (Right in RTL) + Teacher Portrait Card (Left in RTL) */}
          <div className="grid items-center gap-8 lg:grid-cols-12">
            {/* Headline & Subtitle */}
            <div className="lg:col-span-7 text-right">
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[44px] xl:text-[48px] font-black leading-[1.24] tracking-tight text-white">
                اتعلّم الفيزياء بعمق،
                <span className="mt-1.5 block whitespace-normal lg:whitespace-nowrap">
                  <span className="relative inline-block text-[#227BFF]">
                    وتفوّق
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-1.5 right-0 h-1.5 w-16 rounded-full bg-[#227BFF] shadow-[0_0_16px_rgba(34,123,255,0.85)]"
                    />
                  </span>{' '}
                  في امتحانات الثانوية
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-base sm:text-lg font-medium leading-relaxed text-slate-300">
                شرح مبسّط، تدريب فعّال، ومتابعة حقيقية لتحقيق أفضل نتيجة.
              </p>
            </div>

            {/* Real Teacher Portrait Card */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="relative w-full max-w-[380px] aspect-[1/0.94] overflow-hidden rounded-3xl border border-white/25 bg-[#0D1E42] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
                <img
                  src={settings.teacherPhotoUrl}
                  alt={settings.teacherName}
                  fetchPriority="high"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover object-top"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#061126] via-[#061126]/75 to-transparent px-5 pb-4 pt-14">
                  <div className="flex items-stretch gap-3">
                    <span
                      aria-hidden="true"
                      className="w-1 shrink-0 rounded-full bg-[#227BFF] shadow-[0_0_12px_rgba(34,123,255,0.8)]"
                    />
                    <div className="text-right">
                      <div className="font-display text-lg font-extrabold text-white leading-snug">
                        {settings.teacherName || 'أستاذ / حمدي الشباسي'}
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-slate-300">
                        {settings.teacherTitle || 'أستاذ الفيزياء للمرحلة الثانوية'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Lower Action Row: 3 Prominent Horizontal Interactive Cards */}
          <section
            aria-label="خيارات الدخول والمتابعة"
            className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-5"
          >
            {/* Card 1 (Right in RTL): تسجيل الدخول */}
            <button
              type="button"
              data-testid="landing-card-login"
              onClick={handlePrimaryAction}
              onMouseEnter={() => {
                if (!currentUser) void import('./AuthView.tsx');
              }}
              className="group flex flex-col items-center justify-between rounded-2xl border border-[#3B5CA8]/45 bg-[#0A1838]/75 p-6 text-center backdrop-blur-md shadow-[0_12px_32px_rgba(2,8,24,0.45)] transition-all duration-200 hover:-translate-y-1 hover:border-[#38BDF8]/65 hover:bg-[#0E214B]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <div className="flex flex-col items-center">
                <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-[#274073]/80 text-white ring-1 ring-white/15 shadow-inner transition-transform group-hover:scale-105">
                  <LogIn className="h-6 w-6 text-sky-200" />
                </div>
                <h2 className="mt-4 font-display text-xl font-extrabold text-white">
                  {!currentUser ? 'تسجيل الدخول' : isStaff ? 'لوحة المدرس' : 'لوحة الطالب'}
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-300">
                  {!currentUser
                    ? 'ادخل إلى حسابك وواصل التعلم.'
                    : 'أنت مسجّل الدخول بالفعل — افتح لوحتك مباشرة.'}
                </p>
              </div>
              <div className="mt-5 inline-flex w-full max-w-[210px] items-center justify-center gap-2 rounded-xl border border-white/45 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-white transition-all group-hover:border-sky-300 group-hover:bg-white/10">
                <span>{!currentUser ? 'تسجيل الدخول' : 'فتح اللوحة'}</span>
                <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </button>

            {/* Card 2 (Center): إنشاء حساب جديد — Primary Blue CTA */}
            <button
              type="button"
              data-testid="landing-card-register"
              onClick={() => onOpenAuth('register')}
              onMouseEnter={() => void import('./AuthView.tsx')}
              className="group flex flex-col items-center justify-between rounded-2xl border border-[#3B82F6]/55 bg-[#0B1C42]/85 p-6 text-center backdrop-blur-md shadow-[0_14px_36px_rgba(29,99,237,0.22)] transition-all duration-200 hover:-translate-y-1 hover:border-[#60A5FA] hover:bg-[#0F2556]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <div className="flex flex-col items-center">
                <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-[#27468C]/90 text-white ring-1 ring-sky-300/25 shadow-inner transition-transform group-hover:scale-105">
                  <UserPlus className="h-6 w-6 text-sky-200" />
                </div>
                <h2 className="mt-4 font-display text-xl font-extrabold text-white">
                  إنشاء حساب جديد
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-300">
                  انضم للمنصة وابدأ رحلة التفوق.
                </p>
              </div>
              <div className="mt-5 inline-flex w-full max-w-[210px] items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#1C64F2] via-[#2076FF] to-[#288CFF] px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_6px_20px_rgba(32,118,255,0.45)] transition-all group-hover:brightness-110">
                <span>إنشاء الحساب الآن</span>
                <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </button>

            {/* Card 3 (Left in RTL): متابعة ولي الأمر */}
            <button
              type="button"
              data-testid="landing-card-parent"
              onClick={onOpenParentReport}
              onMouseEnter={() => void import('./ParentReportView.tsx')}
              className="group flex flex-col items-center justify-between rounded-2xl border border-[#3B5CA8]/45 bg-[#0A1838]/75 p-6 text-center backdrop-blur-md shadow-[0_12px_32px_rgba(2,8,24,0.45)] transition-all duration-200 hover:-translate-y-1 hover:border-[#818CF8]/65 hover:bg-[#0E214B]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <div className="flex flex-col items-center">
                <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-[#3A4785]/80 text-white ring-1 ring-white/15 shadow-inner transition-transform group-hover:scale-105">
                  <Users className="h-6 w-6 text-indigo-200" />
                </div>
                <h2 className="mt-4 font-display text-xl font-extrabold text-white">
                  متابعة ولي الأمر
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-300">
                  تابع أداء ونتائج ابنك بسهولة.
                </p>
              </div>
              <div className="mt-5 inline-flex w-full max-w-[210px] items-center justify-center gap-2 rounded-xl border border-white/45 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-white transition-all group-hover:border-indigo-300 group-hover:bg-white/10">
                <span>متابعة الآن</span>
                <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </button>
          </section>
        </div>
      </main>
    </div>
  );
};
