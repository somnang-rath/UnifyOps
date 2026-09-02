import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The small surfaces every §11 view owes the user: a form-level message, a
 * status pill, and an empty state.
 *
 * §11 requires all five states of every view — loading, empty, success, error,
 * edge. These are the shared pieces of three of them, kept together so a screen
 * cannot quietly ship with only the happy path by having nothing to reach for.
 */

type Tone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONES: Record<Tone, string> = {
  info: 'border-border bg-surface-sunken text-text',
  success: 'border-success bg-success-subtle text-text',
  warning: 'border-warning bg-warning-subtle text-text',
  danger: 'border-danger bg-danger-subtle text-text',
};

export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Errors are announced; the rest are read when reached. `alert` on an
      // informational banner is the fastest way to make a screen reader
      // exhausting to use.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-sm border px-3 py-2 text-sm', ALERT_TONES[tone], className)}
    >
      {children}
    </div>
  );
}

const BADGE_TONES: Record<Tone, string> = {
  info: 'border-border bg-surface-sunken text-text-muted',
  success: 'border-success bg-success-subtle text-text',
  warning: 'border-warning bg-warning-subtle text-text',
  danger: 'border-danger bg-danger-subtle text-text',
};

export function Badge({
  tone = 'info',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-1.5 py-0.5 text-2xs font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * §11's empty state: says what the surface is for and offers the one action
 * that fills it. Never a shrug.
 */
export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
      <p className="max-w-sm text-sm text-text-muted">{title}</p>
      {action}
    </div>
  );
}

/** A loading placeholder with the shape of the thing it is standing in for. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-xs bg-surface-sunken', className)}
    />
  );
}
