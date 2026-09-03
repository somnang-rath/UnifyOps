'use client';

import { useFormatter } from 'next-intl';
import { cn } from '@/lib/cn';
import { dueBucket, type CalendarDate } from '@/lib/workspace-date';

/**
 * A due date, and whether it is a problem.
 *
 * §12: "Overdue → danger text on danger-subtle". §4 and §17-13: the comparison
 * is against **today in the workspace timezone**, which arrives as a prop
 * rather than being read from the browser — that is the entire point of the
 * finding. A device-local `new Date()` here would make the badge disagree with
 * the filter that produced the list, on the one screen where the two are side
 * by side.
 *
 * A client component only because `useFormatter` needs the locale at render;
 * the date itself is decided on the server.
 */

export function DueDate({
  date,
  today,
  completed,
  className,
}: {
  date: CalendarDate | null;
  /** Today, in the workspace timezone. Resolved once per request on the server. */
  today: CalendarDate;
  completed?: boolean;
  className?: string;
}) {
  const format = useFormatter();
  if (!date) return null;

  const bucket = dueBucket(date, today, { completed });

  // Parsed as UTC midnight and formatted with the workspace's own zone, so the
  // string a person reads is the day that was stored — not a day either side of
  // it, which is what `new Date('2026-09-02')` gives a browser west of GMT.
  const value = new Date(`${date}T00:00:00Z`);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 text-2xs tabular-nums',
        bucket === 'overdue'
          ? 'bg-danger-subtle text-danger'
          : bucket === 'today'
            ? 'bg-warning-subtle text-text'
            : 'text-text-subtle',
        className,
      )}
    >
      {format.dateTime(value, { day: 'numeric', month: 'short', timeZone: 'UTC' })}
    </span>
  );
}
