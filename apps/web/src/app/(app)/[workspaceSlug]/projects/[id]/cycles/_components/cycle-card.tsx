'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@prism/ui';
import {
  useFormat,
  useLocale,
  useT,
  type Locale,
  type MessageKey,
  type Translator,
} from '@prism/i18n';
import { workingDaysBetween, type WorkingDaysResult } from '@prism/constants';
import { Button, IconButton } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/feature/planning/progress-bar';
import { useCycleIssues, type Cycle, type CycleStatus } from '@/hooks/use-cycles';
import { cn } from '@/lib/utils';

const STATUS_BADGE: Record<
  CycleStatus,
  { labelKey: MessageKey; variant: 'neutral' | 'accent' | 'success' | 'warning' }
> = {
  draft: { labelKey: 'cycles.status.draft', variant: 'neutral' },
  upcoming: { labelKey: 'cycles.status.upcoming', variant: 'warning' },
  current: { labelKey: 'cycles.status.current', variant: 'accent' },
  completed: { labelKey: 'cycles.status.completed', variant: 'success' },
};

/**
 * Tooltip for the capacity chip — the place the *reason* lives.
 *
 * An `unknown` year is the case worth wording carefully: the number shown is
 * not merely unverified, it is knowably too high, and a planner needs to hear
 * that rather than "data missing".
 */
function capacityTitle(
  c: WorkingDaysResult,
  t: Translator,
  locale: Locale,
): string {
  // Holiday names come from the table in the reader's language, not from a
  // message file — they are data, and `km` is the primary spelling.
  const names = c.holidaysLost.map((h) => h[locale]).join(', ');
  const parts = [
    t('capacity.detail', { working: c.workingDays, calendar: c.calendarDays }),
  ];
  if (names) parts.push(t('capacity.detail.holidays', { names }));
  if (c.status === 'unknown') parts.push(t('capacity.detail.unknownYear'));
  if (c.status === 'provisional') parts.push(t('capacity.detail.provisional'));
  return parts.join('. ');
}

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
  const f = useFormat();
  const t = useT();
  const locale = useLocale();
  const fmt = (iso: string | null) => (iso ? f.dateShort(iso) : null);
  const [open, setOpen] = useState(false);
  // Only fetch a cycle's items once it has actually been expanded — a project
  // with twenty sprints would otherwise fire twenty requests on mount.
  const { data: issues = [], isLoading } = useCycleIssues(open ? cycle._id : null);

  const badge = STATUS_BADGE[cycle.status];
  const { total, completed } = cycle.progress;
  const range =
    cycle.startDate && cycle.endDate
      ? `${fmt(cycle.startDate)} – ${fmt(cycle.endDate)}`
      : t('cycles.notScheduled');

  // Only worth saying while the clock is actually running on the cycle.
  const remaining =
    cycle.status === 'current' && cycle.endDate ? daysUntil(cycle.endDate) : null;

  /**
   * Real capacity: weekdays in the cycle, minus Cambodian public holidays
   * (ADR 0016 §2.7). A two-week sprint over Khmer New Year has seven working
   * days, not ten, and a team that plans against ten will miss.
   *
   * `status` is carried through deliberately. When the holiday table has no
   * entry for the year the cycle falls in, `workingDays` is an *over-estimate*,
   * and the honest thing is to say so rather than print a confident number.
   */
  const capacity = useMemo(
    () =>
      cycle.startDate && cycle.endDate
        ? workingDaysBetween(
            cycle.startDate.slice(0, 10),
            cycle.endDate.slice(0, 10),
          )
        : null,
    [cycle.startDate, cycle.endDate],
  );

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
            <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
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
                  ? t('cycles.endsToday')
                  : t('cycles.daysLeft', { count: remaining })}
              </span>
            )}
            <span>{t('cycles.done', { completed, total })}</span>
            {capacity && (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  capacity.status !== 'official' && 'text-amber',
                )}
                title={capacityTitle(capacity, t, locale)}
              >
                <Briefcase className="w-3 h-3" />
                {t('capacity.workingDays', { count: capacity.workingDays })}
                {capacity.status === 'unknown' && ` (${t('capacity.approx')})`}
                {capacity.holidaysLost.length > 0 &&
                  ` · ${t('capacity.holidaysLost', {
                    count: capacity.holidaysLost.length,
                  })}`}
              </span>
            )}
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
              {t('cycles.noItems')}
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
