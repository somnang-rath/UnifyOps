'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { fmtDateShort } from '@/lib/format';
import { STATUS_DOT, STATUS_ORDER, type StatusId, type ViewProps } from './shared';

const DAY = 86_400_000;

export function TimelineView({ issues }: ViewProps) {
  const router = useRouter();

  const model = useMemo(() => {
    const rows = issues
      .map((i) => {
        const start = new Date(i.createdAt).getTime();
        const end = i.dueDate
          ? new Date(i.dueDate).getTime()
          : start + DAY;
        return { issue: i, start, end: Math.max(end, start + DAY) };
      })
      .sort((a, b) => a.start - b.start);
    if (rows.length === 0) return null;

    let min = Math.min(...rows.map((r) => r.start));
    let max = Math.max(...rows.map((r) => r.end));
    // Pad the range a little on both sides so bars never touch the edges.
    min -= 2 * DAY;
    max += 2 * DAY;
    const span = Math.max(max - min, 14 * DAY);

    // Month tick marks across the header.
    const ticks: { left: number; label: string }[] = [];
    const d = new Date(min);
    d.setDate(1);
    while (d.getTime() <= max) {
      ticks.push({
        left: ((d.getTime() - min) / span) * 100,
        label: d.toLocaleDateString(undefined, { month: 'short' }),
      });
      d.setMonth(d.getMonth() + 1);
    }

    return { rows, min, span, ticks };
  }, [issues]);

  if (!model) {
    return (
      <p className="text-[13px] text-text-muted py-8 text-center">
        No work items to plot
      </p>
    );
  }

  const { rows, min, span, ticks } = model;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Month header */}
      <div className="relative h-7 border-b border-border bg-bg-subtle">
        {ticks.map((t, idx) => (
          <span
            key={idx}
            className="absolute top-0 h-full flex items-center pl-1 text-[11px] text-text-muted border-l border-border"
            style={{ left: `${t.left}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col">
        {rows.map(({ issue, start, end }) => {
          const left = ((start - min) / span) * 100;
          const width = Math.max(((end - start) / span) * 100, 2);
          const s = (STATUS_ORDER as readonly string[]).includes(issue.status)
            ? (issue.status as StatusId)
            : 'todo';
          return (
            <button
              key={issue._id}
              onClick={() => router.push(`/issues/${issue._id}`)}
              className="relative h-9 border-b border-border last:border-b-0 hover:bg-bg-hover text-left group"
            >
              <div
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 h-5 rounded-full flex items-center px-2 shadow-sm',
                  STATUS_DOT[s],
                )}
                style={{ left: `${left}%`, width: `${width}%`, minWidth: 60 }}
              >
                <span className="text-[11px] text-white font-medium truncate">
                  {issue.title}
                </span>
              </div>
              <span
                className="absolute top-1/2 -translate-y-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100"
                style={{ left: `calc(${left}% + ${width}% + 6px)` }}
              >
                {issue.dueDate ? fmtDateShort(issue.dueDate) : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
