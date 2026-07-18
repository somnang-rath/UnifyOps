'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * Loading / empty / error states (docs/plan/02-design-system.md §3).
 *
 * These were Phase 0 stubs painted in raw Tailwind greys (`bg-gray-200`,
 * `text-blue-600`), which ignored the theme entirely — they looked wrong in dark
 * mode and did not follow the accent. They are on tokens now.
 */

export interface SkeletonProps {
  /**
   * Number of shimmer bars. Two call shapes exist and both are supported:
   * `<Skeleton rows={4} />` (apps/admin) and `<Skeleton className="h-4 w-24" />`
   * for a single bar shaped by the caller (apps/web).
   */
  rows?: number;
  className?: string;
}

export function Skeleton({ rows, className }: SkeletonProps) {
  // No `rows` means "one bar, sized by className" — the common inline case.
  if (rows === undefined) {
    return (
      <div
        aria-hidden="true"
        className={cn('animate-pulse rounded-sm bg-bg-subtle', className)}
      />
    );
  }

  return (
    <div
      className={cn('space-y-1.5', className)}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-3.5 w-full animate-pulse rounded-sm bg-bg-subtle"
          // Vary the last bar so a block of them reads as text, not a barcode.
          style={i === rows - 1 ? { width: '60%' } : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return <Skeleton rows={lines} className={className} />;
}

/** Empty state — no data yet. */
export function EmptyState({
  label = 'Nothing here yet',
  hint,
  icon,
  action,
  className,
}: {
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <span className="text-text-muted [&_svg]:w-5 [&_svg]:h-5" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-sm text-text-sub">{label}</p>
      {hint && <p className="text-xs text-text-muted max-w-[42ch]">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Error state — the request failed. */
export function ErrorState({
  message = 'Something went wrong',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm text-red">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-accent underline underline-offset-2 hover:text-accent-600"
        >
          Retry
        </button>
      )}
    </div>
  );
}
