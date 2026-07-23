'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * Filter/group bar (docs/plan/02-design-system.md §3 Tier 3, §4 shell: 34px).
 *
 * A thin toolbar that sits between the topbar and the content. Presentational:
 * pages compose whatever controls they need inside (Tabs, Selects, SearchInput,
 * chips) — the bar only fixes the height, alignment, and rhythm so every list
 * screen reads the same.
 */
export function FilterBar({
  className,
  ...p
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className={cn(
        'flex items-center gap-1.5 flex-wrap min-h-[34px] py-1',
        className,
      )}
      {...p}
    />
  );
}

/** Pushes trailing controls (sort, group-by, display) to the right edge. */
export function FilterSpacer() {
  return <div className="flex-1" aria-hidden="true" />;
}

export interface FilterChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Dimension name, e.g. "Priority". Omit for plain chips (saved views). */
  label?: React.ReactNode;
  /** Applied value, e.g. "Urgent". */
  children: React.ReactNode;
  active?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
  /** Renders a ✕ affordance; a removable chip announces itself as such. */
  onRemove?: () => void;
  /** Accessible name for the ✕ button (default "Remove filter"). */
  removeLabel?: string;
}

/**
 * One applied filter. sm-control height (26px), pill-shaped, with an optional
 * `label:` prefix and a remove ✕ that stays keyboard-reachable (it is its own
 * button, not a hover-only ghost).
 */
export function FilterChip({
  label,
  children,
  active,
  icon,
  onClick,
  onRemove,
  removeLabel = 'Remove filter',
  className,
  ...p
}: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center h-ctl-sm rounded-full border text-xs leading-none overflow-hidden',
        'transition-colors duration-[var(--dur)]',
        active
          ? 'border-accent text-accent-700 dark:text-[var(--a-200)] bg-accent-50 dark:bg-[rgba(99,102,241,.12)]'
          : 'border-border text-text-sub hover:text-text hover:bg-bg-hover',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'inline-flex items-center gap-1.5 h-full pl-2.5',
          onRemove ? 'pr-1.5' : 'pr-2.5',
          !onClick && 'cursor-default',
        )}
        {...p}
      >
        {icon && (
          <span className="flex-shrink-0 flex items-center opacity-70">
            {icon}
          </span>
        )}
        {label && <span className="text-text-muted">{label}:</span>}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="h-full pl-0.5 pr-1.5 inline-flex items-center opacity-50 hover:opacity-100 transition-opacity"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="w-3 h-3"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
