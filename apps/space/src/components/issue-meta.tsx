import { Badge, StateIcon, type WorkItemState } from '@prism/ui';
import { formatDateShort, type Locale } from '@prism/i18n';
import type { PublicIssue, PublicBoardColumn } from '@/lib/public-api';

/**
 * Shared display helpers for public issue rendering (spec publish-to-space
 * §3.3–3.4). Server-side only, shaped around the stripped PublicIssue payload —
 * nothing here accepts an id, an email, or an edit callback.
 */

/** Core status ids → StateIcon shapes. Custom column ids get no icon. */
const CORE_STATE: Record<string, WorkItemState> = {
  backlog: 'backlog',
  todo: 'unstarted',
  inprogress: 'started',
  review: 'started',
  done: 'completed',
  cancelled: 'cancelled',
};

export function coreState(status: string): WorkItemState | null {
  return CORE_STATE[status] ?? null;
}

/** Display labels for the canonical statuses (matches web's status pills). */
const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  inprogress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Best display label for a status id: payload-provided label → column def →
 * canonical label → the raw id (custom columns are already human-ish).
 */
export function statusLabel(
  issue: PublicIssue,
  columns?: PublicBoardColumn[],
): string {
  if (issue.statusLabel) return issue.statusLabel;
  const col = columns?.find((c) => c.id === issue.status);
  if (col?.name) return col.name;
  return STATUS_LABEL[issue.status] ?? issue.status;
}

/** Capitalize a raw enum-ish id for display ("inprogress" stays mapped above). */
export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const PRIORITY_VARIANT: Record<
  string,
  'danger' | 'warning' | 'accent' | 'neutral'
> = {
  urgent: 'danger',
  critical: 'danger',
  high: 'warning',
  medium: 'accent',
  low: 'neutral',
};

/**
 * Priority as a Badge — variant + text label, never color alone. Renders
 * nothing for 'none'/empty; unknown values degrade to a neutral badge.
 */
export function PriorityBadge({ priority }: { priority: string }) {
  if (!priority || priority === 'none') return null;
  return (
    <Badge variant={PRIORITY_VARIANT[priority] ?? 'neutral'} size="xs">
      {titleCase(priority)}
    </Badge>
  );
}

/** Status shape + label pair used by both board column headers and list rows. */
export function StatusMark({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  const state = coreState(status);
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className ?? ''}`}>
      {state && <StateIcon state={state} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function formatDue(iso: string, locale: Locale): string {
  return formatDateShort(iso, locale);
}
