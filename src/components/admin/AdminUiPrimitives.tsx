import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, RotateCcw, Search } from 'lucide-react';

export type AdminTone = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'slate';

const KPI_TONE_STYLES: Record<
  AdminTone,
  {
    card: string;
    iconBox: string;
    value: string;
  }
> = {
  blue: {
    card: 'border-blue-100/90 bg-gradient-to-l from-blue-50/70 via-white to-white',
    iconBox: 'bg-blue-50 text-[#2563EB] border-blue-100',
    value: 'text-[#2563EB]',
  },
  emerald: {
    card: 'border-emerald-100/90 bg-gradient-to-l from-emerald-50/70 via-white to-white',
    iconBox: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    value: 'text-emerald-700',
  },
  amber: {
    card: 'border-amber-100/90 bg-gradient-to-l from-amber-50/75 via-white to-white',
    iconBox: 'bg-amber-50 text-amber-600 border-amber-100',
    value: 'text-amber-700',
  },
  rose: {
    card: 'border-rose-100/90 bg-gradient-to-l from-rose-50/70 via-white to-white',
    iconBox: 'bg-rose-50 text-rose-600 border-rose-100',
    value: 'text-rose-700',
  },
  purple: {
    card: 'border-violet-100/90 bg-gradient-to-l from-violet-50/75 via-white to-white',
    iconBox: 'bg-violet-50 text-[#7C3AED] border-violet-100',
    value: 'text-[#7C3AED]',
  },
  slate: {
    card: 'border-slate-200/80 bg-white',
    iconBox: 'bg-slate-100 text-slate-600 border-slate-200/70',
    value: 'text-[#0F172A]',
  },
};

const BADGE_TONE_STYLES: Record<AdminTone, string> = {
  blue: 'border-blue-200/80 bg-blue-50 text-[#1D4ED8]',
  emerald: 'border-emerald-200/80 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200/80 bg-amber-50 text-amber-800',
  rose: 'border-rose-200/80 bg-rose-50 text-rose-700',
  purple: 'border-violet-200/80 bg-violet-50 text-[#6D28D9]',
  slate: 'border-slate-200/80 bg-slate-100 text-slate-700',
};

export interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = React.memo(
  ({ title, subtitle, icon, actions }) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50/80 text-[#2563EB]">
              {icon}
            </span>
          )}
          <h2 className="font-display text-xl font-extrabold tracking-tight text-[#0F172A] sm:text-2xl">
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-[13px]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  ),
);
AdminPageHeader.displayName = 'AdminPageHeader';

export interface AdminKpiCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  icon: React.ReactNode;
  tone?: AdminTone;
  onClick?: () => void;
  testId?: string;
}

export const AdminKpiCard: React.FC<AdminKpiCardProps> = React.memo(
  ({ label, value, subtitle, icon, tone = 'blue', onClick, testId }) => {
    const styles = KPI_TONE_STYLES[tone];
    const interactive = Boolean(onClick);
    const Tag = interactive ? 'button' : 'div';
    return (
      <Tag
        type={interactive ? 'button' : undefined}
        onClick={onClick}
        data-testid={testId}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-right shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all ${styles.card} ${
          interactive
            ? 'cursor-pointer hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)] focus:outline-none focus:ring-2 focus:ring-blue-500/30'
            : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-slate-600">{label}</div>
          <div
            className={`mt-1.5 font-mono-num text-2xl font-extrabold leading-none tabular-nums sm:text-[28px] ${styles.value}`}
          >
            {value}
          </div>
          {subtitle && (
            <div className="mt-1.5 truncate text-[11px] font-medium text-slate-500">{subtitle}</div>
          )}
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${styles.iconBox}`}
        >
          {icon}
        </span>
      </Tag>
    );
  },
);
AdminKpiCard.displayName = 'AdminKpiCard';

export const AdminKpiGrid: React.FC<{
  children: React.ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}> = React.memo(({ children, cols = 4, className = '' }) => {
  const gridCls =
    cols === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : cols === 3
        ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';
  return <div className={`grid gap-3.5 ${gridCls} ${className}`}>{children}</div>;
});
AdminKpiGrid.displayName = 'AdminKpiGrid';

export interface SegmentedTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export function AdminSegmentedTabs<T extends string = string>({
  items,
  activeId,
  onChange,
  rightSlot,
}: {
  items: Array<SegmentedTabItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-1" role="tablist">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                active
                  ? 'bg-blue-50 text-[#2563EB] ring-1 ring-inset ring-blue-200/80'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]'
              }`}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono-num text-[11px] font-extrabold tabular-nums ${
                    active ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {rightSlot && <div className="flex flex-wrap items-center gap-2">{rightSlot}</div>}
    </div>
  );
}

export interface AdminFilterBarProps {
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  rightSlot?: React.ReactNode;
}

export const AdminFilterBar: React.FC<AdminFilterBarProps> = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ابحث هنا...',
  children,
  onReset,
  hasActiveFilters = false,
  rightSlot,
}) => (
  <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
    {typeof searchValue === 'string' && onSearchChange && (
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 pr-9 pl-3 text-xs font-medium text-[#0F172A] placeholder:text-slate-400 transition-colors focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
        />
      </div>
    )}
    {children}
    {onReset && (
      <button
        type="button"
        onClick={onReset}
        disabled={!hasActiveFilters}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>إعادة ضبط</span>
      </button>
    )}
    {rightSlot && <div className="mr-auto flex flex-wrap items-center gap-2">{rightSlot}</div>}
  </div>
);

export const AdminStatusBadge: React.FC<{
  children: React.ReactNode;
  tone?: AdminTone;
  dot?: boolean;
  className?: string;
}> = React.memo(({ children, tone = 'slate', dot = false, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${BADGE_TONE_STYLES[tone]} ${className}`}
  >
    {dot && (
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          tone === 'emerald'
            ? 'bg-emerald-500'
            : tone === 'amber'
              ? 'bg-amber-500'
              : tone === 'rose'
                ? 'bg-rose-500'
                : tone === 'blue'
                  ? 'bg-[#2563EB]'
                  : tone === 'purple'
                    ? 'bg-[#7C3AED]'
                    : 'bg-slate-400'
        }`}
      />
    )}
    {children}
  </span>
));
AdminStatusBadge.displayName = 'AdminStatusBadge';

export const AdminCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}> = React.memo(({ children, className = '', padding = 'md', title, subtitle, headerAction, noPadding = false }) => {
  const effectivePadding = noPadding ? 'none' : padding;
  const padCls =
    effectivePadding === 'none'
      ? ''
      : effectivePadding === 'sm'
        ? 'p-3.5'
        : effectivePadding === 'lg'
          ? 'p-5 sm:p-6'
          : 'p-4 sm:p-5';
  const hasHeader = Boolean(title || subtitle || headerAction);
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${hasHeader ? '' : padCls} ${className}`}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-extrabold text-[#0F172A]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[11px] font-medium text-slate-500">{subtitle}</p>}
          </div>
          {headerAction && <div className="min-w-0 max-w-full shrink-0">{headerAction}</div>}
        </div>
      )}
      {hasHeader ? <div className={padCls}>{children}</div> : children}
    </div>
  );
});
AdminCard.displayName = 'AdminCard';

export const AdminMasterDetail: React.FC<{
  main: React.ReactNode;
  detail: React.ReactNode;
  mainSpan?: '8' | '7' | '9';
  className?: string;
}> = ({ main, detail, mainSpan = '8', className = '' }) => {
  const mainCol =
    mainSpan === '7'
      ? 'xl:col-span-7'
      : mainSpan === '9'
        ? 'xl:col-span-9'
        : 'xl:col-span-8';
  const sideCol =
    mainSpan === '7'
      ? 'xl:col-span-5'
      : mainSpan === '9'
        ? 'xl:col-span-3'
        : 'xl:col-span-4';
  return (
    <div className={`grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start ${className}`}>
      <div className={`min-w-0 ${mainCol}`}>{main}</div>
      <div className={`min-w-0 xl:sticky xl:top-20 ${sideCol}`}>{detail}</div>
    </div>
  );
};

export const AdminEmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = React.memo(({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-12 text-center">
    {icon && (
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400">
        {icon}
      </div>
    )}
    <div className="text-sm font-extrabold text-[#0F172A]">{title}</div>
    {description && (
      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
));
AdminEmptyState.displayName = 'AdminEmptyState';

export interface AdminActionMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'success';
  disabled?: boolean;
}

export const AdminActionMenu: React.FC<{
  items: AdminActionMenuItem[];
  ariaLabel?: string;
}> = ({ items, ariaLabel = 'المزيد من الإجراءات' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-[#0F172A]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-9 z-40 min-w-[170px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right text-xs font-semibold transition-colors disabled:opacity-45 ${
                item.tone === 'danger'
                  ? 'text-rose-700 hover:bg-rose-50'
                  : item.tone === 'success'
                    ? 'text-emerald-700 hover:bg-emerald-50'
                    : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
