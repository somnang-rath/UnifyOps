'use client';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCalendarIssues } from '@/hooks/use-issues';
import { buildCalendarMonth, monthLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';
import { IssueModal } from '@/components/feature/issue/issue-modal';

const TYPE_CLS: Record<Issue['type'], string> = {
  bug: 'bg-[rgba(239,68,68,.12)] text-red',
  feature: 'bg-[rgba(245,158,11,.12)] text-amber',
  task: 'bg-[rgba(16,185,129,.12)] text-green',
  docs: 'bg-[rgba(59,130,246,.12)] text-blue',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function CalendarPage() {
  const today = new Date();
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [creatingDate, setCreatingDate] = useState<string | null>(null);

  const cells = useMemo(
    () => buildCalendarMonth(month.getFullYear(), month.getMonth()),
    [month],
  );
  const from = cells[0].iso;
  const to = cells[41].iso;

  const { data: issues = [] } = useCalendarIssues(from, to);

  const byDate = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!i.dueDate) continue;
      const k = i.dueDate.slice(0, 10);
      const arr = map.get(k) ?? [];
      arr.push(i);
      map.set(k, arr);
    }
    return map;
  }, [issues]);

  const stepMonth = (delta: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Calendar
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            See what&apos;s due and plan ahead
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <strong className="min-w-[160px] text-center text-[15px] font-semibold">
            {monthLabel(month)}
          </strong>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stepMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
            }
          >
            Today
          </Button>
          <Button
            variant="grad"
            size="sm"
            onClick={() => setCreatingDate(toIso(today))}
          >
            <Plus className="w-3.5 h-3.5" /> New task
          </Button>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 bg-bg-subtle border-b border-border">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 grid-flow-row auto-rows-[minmax(110px,1fr)]">
          {cells.map((cell, idx) => {
            const items = byDate.get(cell.iso) ?? [];
            const visible = items.slice(0, 3);
            const more = items.length - visible.length;
            const rightEdge = (idx + 1) % 7 === 0;
            return (
              <div
                key={`${cell.iso}-${idx}`}
                onClick={() => setCreatingDate(cell.iso)}
                className={cn(
                  'flex flex-col gap-1 p-2 border-b border-border min-h-[110px] overflow-hidden cursor-pointer transition-colors duration-[var(--dur)]',
                  !rightEdge && 'border-r',
                  cell.otherMonth
                    ? 'bg-bg-subtle opacity-55'
                    : 'hover:bg-bg-hover',
                )}
              >
                <div>
                  <span
                    className={cn(
                      'text-[12px] font-semibold text-text-sub',
                      cell.today &&
                        'inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-white',
                    )}
                  >
                    {cell.date.getDate()}
                  </span>
                </div>
                {visible.map((i) => (
                  <a
                    key={i._id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      location.assign(`/issues/${i._id}`);
                    }}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[11px] font-medium truncate cursor-pointer',
                      TYPE_CLS[i.type] ?? '',
                    )}
                    title={i.title}
                  >
                    {i.title}
                  </a>
                ))}
                {more > 0 && (
                  <div className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-bg-hover text-text-muted truncate">
                    +{more} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <IssueModal
        open={!!creatingDate}
        defaultStatus="todo"
        issue={
          creatingDate
            ? ({
                _id: '',
                title: '',
                desc: '',
                type: 'task',
                status: 'todo',
                priority: 'medium',
                authorId: '',
                labels: [],
                createdAt: '',
                updatedAt: '',
                dueDate: `${creatingDate}T00:00:00.000Z`,
              } as Issue)
            : null
        }
        onClose={() => setCreatingDate(null)}
      />
    </>
  );
}

function toIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
