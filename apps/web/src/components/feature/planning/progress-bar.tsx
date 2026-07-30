import { cn } from '@/lib/utils';

interface Props {
  completed: number;
  total: number;
  className?: string;
}

/**
 * Completion bar for a cycle or module.
 *
 * Exposed as a real `progressbar` with `aria-valuetext` rather than a bare
 * `<div>`: the percentage is the only thing the bar communicates visually, and
 * "3 of 8 done" is what a screen-reader user actually needs — the raw number
 * `37` is meaningless without the counts beside it.
 */
export function ProgressBar({ completed, total, className }: Props) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const done = total > 0 && completed === total;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${completed} of ${total} work items done`}
      className={cn(
        'h-1.5 w-full rounded-full bg-bg-subtle border border-border overflow-hidden',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[var(--dur)]',
          done ? 'bg-green' : 'bg-accent',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
