import * as React from 'react';
import { cn } from './cn';

/** Loading skeleton — render `rows` shimmer bars. */
export function Skeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      ))}
    </div>
  );
}

/** Empty state — no data yet. */
export function EmptyState({
  label = 'Nothing here yet',
  action,
}: {
  label?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-gray-500">
      <p className="text-sm">{label}</p>
      {action}
    </div>
  );
}

/** Error state — request failed. */
export function ErrorState({
  message = 'Something went wrong',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-blue-600 underline underline-offset-2 hover:text-blue-700"
        >
          Retry
        </button>
      )}
    </div>
  );
}
