'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@prism/ui';
import { Button, IconButton } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/feature/planning/progress-bar';
import { useCycleIssues, type Cycle, type CycleStatus } from '@/hooks/use-cycles';
import { cn } from '@/lib/utils';

const STATUS_BADGE: Record<
  CycleStatus,
  { label: string; variant: 'neutral' | 'accent' | 'success' | 'warning' }
> = {
  draft: { label: 'Draft', variant: 'neutral' },
  upcoming: { label: 'Upcoming', variant: 'warning' },
  current: { label: 'Active', variant: 'accent' },
  completed: { label: 'Completed', variant: 'success' },
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null;

/** Whole days from today to `iso`, floor'd. Negative once the date has passed. */
const daysUntil = (iso: string) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

interface Props {
  cycle: Cycle;
  /** `/[workspaceSlug]` prefix builder, so item links stay workspace-scoped. */
  hrefFor: (issueId: string) => string;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddItems: () => void;
  onRemoveItem: (issueId: string) => void;
}

export function CycleCard({
  cycle,
  hrefFor,
  canWrite,
  onEdit,
  onDelete,
  onAddItems,
  onRemoveItem,
}: Props) {
  const [open, setOpen] = useState(false);
  // Only fetch a cycle's items once it has actually been expanded — a project
  // with twenty sprints would otherwise fire twenty requests on mount.
  const { data: issues = [], isLoading } = useCycleIssues(open ? cycle._id : null);

  const badge = STATUS_BADGE[cycle.status];
  const { total, completed } = cycle.progress;
  const range =
    cycle.startDate && cycle.endDate
      ? `${fmt(cycle.startDate)} – ${fmt(cycle.endDate)}`
      : 'Not scheduled';

  // Only worth saying while the clock is actually running on the cycle.
  const remaining =
    cycle.status === 'current' && cycle.endDate ? daysUntil(cycle.endDate) : null;

  return (
    <div className="border border-border rounded-sm bg-bg overflow-hidden">
      <div className="flex items-start gap-3 p-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${cycle.name}` : `Expand ${cycle.name}`}
          className="mt-0.5 text-text-muted hover:text-text transition-colors"
        >
          <ChevronRight
            className={cn(
              'w-4 h-4 transition-transform duration-[var(--dur)]',
              open && 'rotate-90',
            )}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold truncate">{cycle.name}</h3>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>

          {cycle.description && (
            <p className="text-[12.5px] text-text-muted mt-1 line-clamp-2">
              {cycle.description}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2 text-[11.5px] text-text-muted flex-wrap">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {range}
            </span>
            {remaining !== null && (
              <span>
                {remaining <= 0
                  ? 'Ends today'
                  : `${remaining} day${remaining === 1 ? '' : 's'} left`}
              </span>
            )}
            <span>
              {completed}/{total} done
            </span>
          </div>

          <ProgressBar completed={completed} total={total} className="mt-2" />
        </div>

        {canWrite && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <IconButton onClick={onEdit} aria-label={`Edit ${cycle.name}`}>
              <Pencil className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton onClick={onDelete} aria-label={`Delete ${cycle.name}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-border bg-bg-subtle/40 px-3.5 py-3">
          {isLoading ? (
            <SkeletonText lines={3} />
          ) : issues.length === 0 ? (
            <p className="text-[12.5px] text-text-muted py-2">
              No work items in this cycle yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-px mb-2">
              {issues.map((issue) => (
                <li
                  key={issue._id}
                  className="group flex items-center gap-2.5 px-2 py-1.5 rounded-sm hover:bg-bg-hover"
                >
                  <Link
                    href={hrefFor(issue._id)}
                    className="flex-1 min-w-0 truncate text-[13px] hover:text-accent"
                  >
                    {issue.title}
                  </Link>
                  <span className="text-[11px] text-text-muted capitalize flex-shrink-0">
                    {issue.status}
                  </span>
                  {canWrite && (
                    <IconButton
                      size="xs"
                      onClick={() => onRemoveItem(issue._id)}
                      aria-label={`Remove ${issue.title} from ${cycle.name}`}
                      // Revealed on hover, but always reachable by keyboard —
                      // focus-within on the row would hide it from tab users.
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canWrite && (
            <Button size="sm" variant="ghost" onClick={onAddItems}>
              <Plus className="w-3.5 h-3.5" />
              Add work items
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
