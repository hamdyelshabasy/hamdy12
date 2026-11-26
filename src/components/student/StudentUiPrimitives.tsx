import React from 'react';

export const STUDENT_ARTWORK = {
  curriculum: '/assets/student-hero-physics.jpg',
  courses: '/assets/student-hero-physics.jpg',
  videoLibrary: '/src/assets/images/student_banner_schedule_1795551398461.jpg',
  homework: '/src/assets/images/student_banner_exams_hw_1795551398121.jpg',
  exams: '/src/assets/images/student_banner_exams_hw_1795551398121.jpg',
  practice: '/src/assets/images/student_banner_pdf_practice_1795551398159.jpg',
  pdfs: '/src/assets/images/student_banner_pdf_practice_1795551398159.jpg',
  schedule: '/src/assets/images/student_banner_schedule_1795551398461.jpg',
  results: '/src/assets/images/student_banner_results_1795551397158.jpg',
  courseFallbacks: [
    '/src/assets/images/course_electricity_1795161648586.jpg',
    '/src/assets/images/course_mechanics_1795161650057.jpg',
    '/src/assets/images/course_modern_physics_1795161647912.jpg',
    '/src/assets/images/hero_physics_waves_1795161648069.jpg',
  ],
} as const;

export function pickPhysicsArtwork(seed: number): string {
  const list = STUDENT_ARTWORK.courseFallbacks;
  return list[Math.abs(seed) % list.length];
}

interface StudentPageHeroProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  artworkSrc: string;
  artworkAlt: string;
  chips?: Array<{ icon?: React.ReactNode; label: string; dotColor?: string }>;
  iconBgClass?: string;
}

export const StudentPageHero: React.FC<StudentPageHeroProps> = React.memo(({
  title,
  subtitle,
  icon,
  artworkSrc,
  artworkAlt,
  chips = [],
  iconBgClass = 'bg-[#1D4ED8]/35 text-sky-200 ring-1 ring-sky-400/45',
}) => (
  <section className="relative overflow-hidden rounded-2xl border border-[#3B82F6]/45 bg-gradient-to-l from-[#10245E] via-[#1B2168] to-[#0B1742] shadow-[0_12px_32px_rgba(2,8,28,0.52)]">
    {/* Ambient subtle glows */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-16 right-1/4 h-44 w-64 rounded-full bg-sky-500/15 blur-3xl"
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-16 left-1/4 h-44 w-64 rounded-full bg-violet-500/20 blur-3xl"
    />

    <div className="relative grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] items-center gap-3 px-5 py-4 sm:px-6 sm:py-5">
      {/* Right side (RTL): Title, subtitle, metadata chips */}
      <div className="min-w-0 space-y-2.5 z-10">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-[0_0_18px_rgba(56,189,248,0.28)] ${iconBgClass}`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-[26px] font-extrabold tracking-tight text-white leading-snug">
              {title}
            </h1>
            <p className="mt-1 text-xs sm:text-[13px] text-slate-200/90 leading-relaxed max-w-xl">
              {subtitle}
            </p>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {chips.map((chip, idx) => (
              <span
                key={`${chip.label}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B8DEF]/40 bg-[#0A1842]/75 px-3 py-1 text-[11.5px] font-bold text-slate-100 backdrop-blur-xs"
              >
                {chip.dotColor && (
                  <span className={`h-2 w-2 rounded-full shrink-0 ${chip.dotColor}`} />
                )}
                {chip.icon && <span className="text-sky-300 shrink-0">{chip.icon}</span>}
                <span>{chip.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Left side (RTL): Seamlessly blended 3D physics hero artwork */}
      <div className="relative hidden sm:flex items-center justify-center lg:justify-end">
        <div className="relative h-[118px] lg:h-[128px] w-full max-w-[430px] overflow-hidden rounded-xl border border-sky-400/20 bg-[#081234]/70 shadow-[0_0_28px_rgba(56,189,248,0.18)]">
          <img
            src={artworkSrc}
            alt={artworkAlt}
            decoding="async"
            fetchPriority="high"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center scale-[1.03]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-[#142264]/75 via-transparent to-[#0B1742]/55" />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 rounded-xl" />
        </div>
      </div>
    </div>
  </section>
));

interface StudentTwoColShellProps {
  children: React.ReactNode;
  rail: React.ReactNode;
  testId?: string;
}

export const StudentTwoColShell: React.FC<StudentTwoColShellProps> = ({
  children,
  rail,
  testId,
}) => (
  <div
    data-testid={testId}
    className="flex flex-col xl:flex-row gap-3.5 items-start"
  >
    {/* Main column (Right in RTL) */}
    <div className="flex-1 min-w-0 w-full space-y-3.5">{children}</div>
    {/* Companion rail (Left in RTL) */}
    <aside className="w-full xl:w-[272px] shrink-0 space-y-3.5">{rail}</aside>
  </div>
);

interface StudentRailCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: 'blue' | 'purple' | 'none';
}

export const StudentRailCard: React.FC<StudentRailCardProps> = ({
  children,
  className = '',
  glow = 'none',
}) => {
  const glowCls =
    glow === 'purple'
      ? 'border-[#6D28D9]/55 bg-gradient-to-b from-[#1D1A5B]/95 via-[#13184B]/95 to-[#0B1438]/95 shadow-[0_10px_28px_rgba(109,40,217,0.22)]'
      : glow === 'blue'
        ? 'border-[#3B82F6]/50 bg-gradient-to-b from-[#12265E]/95 to-[#0A1538]/95 shadow-[0_10px_28px_rgba(37,99,235,0.2)]'
        : 'border-[#2D4A8A]/50 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 shadow-[0_8px_24px_rgba(2,8,28,0.45)]';
  return (
    <section className={`rounded-2xl border p-4 text-white ${glowCls} ${className}`}>
      {children}
    </section>
  );
};

interface StudentProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  variant?: 'dark' | 'light';
  accent?: 'cyan-violet' | 'emerald-cyan' | 'amber';
}

export const StudentProgressRing: React.FC<StudentProgressRingProps> = React.memo(({
  percent,
  size = 86,
  strokeWidth = 8,
  label,
  variant = 'dark',
  accent = 'cyan-violet',
}) => {
  const safePct = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - safePct / 100);
  const gradId = React.useId();

  const stops =
    accent === 'emerald-cyan'
      ? ['#10B981', '#38BDF8']
      : accent === 'amber'
        ? ['#F59E0B', '#F97316']
        : ['#38BDF8', '#A855F7'];

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={variant === 'dark' ? 'rgba(255,255,255,0.11)' : 'rgba(15,23,42,0.1)'}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className={`font-mono-num font-extrabold ${
            size >= 80 ? 'text-lg' : 'text-sm'
          } ${variant === 'dark' ? 'text-white' : 'text-[#0B162C]'}`}
        >
          {safePct}%
        </span>
        {label && (
          <span
            className={`mt-0.5 text-[9.5px] font-bold ${
              variant === 'dark' ? 'text-slate-300' : 'text-slate-500'
            }`}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
});

interface StudentWhiteCardProps {
  children: React.ReactNode;
  className?: string;
}

export const StudentWhiteCard: React.FC<StudentWhiteCardProps> = ({
  children,
  className = '',
}) => (
  <div
    className={`rounded-2xl border border-white/85 bg-[#F8FAFF] text-[#0B162C] shadow-[0_10px_28px_rgba(2,8,28,0.44)] ${className}`}
  >
    {children}
  </div>
);

interface StudentSectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badgeText?: string;
  actions?: React.ReactNode;
}

export const StudentSectionHeader: React.FC<StudentSectionHeaderProps> = ({
  title,
  subtitle,
  icon,
  badgeText,
  actions,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#3B82F6]/35 bg-gradient-to-l from-[#102359] via-[#15225F] to-[#0B1742] px-5 py-4 text-white shadow-[0_8px_24px_rgba(2,8,28,0.45)]">
    <div className="flex items-center gap-3 min-w-0">
      {icon && (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/35">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl sm:text-2xl font-extrabold text-white truncate">
            {title}
          </h1>
          {badgeText && (
            <span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-2.5 py-0.5 font-mono-num text-xs font-bold text-sky-200">
              {badgeText}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-xs sm:text-sm text-slate-300">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

interface StudentDarkCardProps {
  children: React.ReactNode;
  className?: string;
}

export const StudentDarkCard: React.FC<StudentDarkCardProps> = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl border border-[#2D4A8A]/45 bg-gradient-to-b from-[#0E1E4A]/95 to-[#091432]/95 text-white shadow-[0_8px_24px_rgba(2,8,24,0.42)] ${className}`}
  >
    {children}
  </div>
);

interface StudentEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const StudentEmptyState: React.FC<StudentEmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => (
  <div className="rounded-2xl border border-dashed border-[#3B82F6]/35 bg-[#0A1636]/90 p-9 text-center text-white">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
      {icon}
    </div>
    <h3 className="mt-3 font-display text-base font-extrabold text-white">{title}</h3>
    {description && (
      <p className="mx-auto mt-1.5 max-w-md text-xs sm:text-sm text-slate-300 leading-relaxed">
        {description}
      </p>
    )}
    {(actionLabel || secondaryActionLabel) && (
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="rounded-xl bg-gradient-to-l from-[#1D4ED8] to-[#0EA5E9] px-5 py-2.5 text-xs font-extrabold text-white shadow-md hover:brightness-110"
          >
            {actionLabel}
          </button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold text-white hover:bg-white/15"
          >
            {secondaryActionLabel}
          </button>
        )}
      </div>
    )}
  </div>
);
