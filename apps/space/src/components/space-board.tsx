import { Badge } from '@prism/ui';
import type { PublicIssue, PublicBoardColumn } from '@/lib/public-api';
import {
  PriorityBadge,
  StatusMark,
  formatDue,
  statusLabel,
  titleCase,
} from './issue-meta';

/**
 * Read-only kanban board for published views/projects (spec publish-to-space
 * §3.3). Server component, zero interactivity — the space CSP forbids inline
 * script anyway. Local to apps/space on purpose: web's board carries auth,
 * drag-and-drop, and full Issue types; sharing it would smuggle edit
 * affordances into public UI.
 */

interface SpaceBoardProps {
  issues: PublicIssue[];
  /** null → 'status'. v1 supported keys: status, priority, type. */
  groupBy: string | null;
  /** Authoritative column order when present (status grouping). */
  columns?: PublicBoardColumn[];
}

interface Column {
  id: string;
  label: string;
  issues: PublicIssue[];
}

const PRIORITY_ORDER = ['urgent', 'critical', 'high', 'medium', 'low', 'none'];
const SUPPORTED_GROUP_KEYS = new Set(['status', 'priority', 'type']);

function buildColumns(
  issues: PublicIssue[],
  groupBy: string,
  columnDefs?: PublicBoardColumn[],
): Column[] {
  const keyOf = (i: PublicIssue): string =>
    groupBy === 'priority' ? i.priority || 'none'
    : groupBy === 'type' ? i.type
    : i.status;

  const buckets = new Map<string, PublicIssue[]>();
  for (const issue of issues) {
    const key = keyOf(issue);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(issue);
    else buckets.set(key, [issue]);
  }

  const columns: Column[] = [];
  const seen = new Set<string>();

  // Provided defs give the authoritative order (status grouping); empty
  // provided columns still render — an empty column is information.
  if (groupBy === 'status' && columnDefs?.length) {
    for (const def of columnDefs) {
      columns.push({ id: def.id, label: def.name, issues: buckets.get(def.id) ?? [] });
      seen.add(def.id);
    }
  } else if (groupBy === 'priority') {
    for (const p of PRIORITY_ORDER) {
      if (buckets.has(p)) {
        columns.push({ id: p, label: titleCase(p), issues: buckets.get(p)! });
        seen.add(p);
      }
    }
  }

  // Anything not covered above, in first-seen order.
  for (const [key, bucket] of buckets) {
    if (seen.has(key)) continue;
    const label =
      groupBy === 'status'
        ? statusLabel(bucket[0], columnDefs)
        : titleCase(key);
    columns.push({ id: key, label, issues: bucket });
  }

  return columns;
}

export function SpaceBoard({ issues, groupBy, columns }: SpaceBoardProps) {
  // Anything unsupported falls back to status (spec §3.3).
  const key = groupBy && SUPPORTED_GROUP_KEYS.has(groupBy) ? groupBy : 'status';
  const cols = buildColumns(issues, key, columns);

  return (
    <section aria-label="Board">
      <div
        // Keyboard users must be able to scroll the column strip (spec §3.7).
        tabIndex={0}
        role="region"
        aria-label="Board columns"
        className="flex gap-4 overflow-x-auto pb-4"
      >
        {cols.map((col) => (
          <section
            key={col.id}
            role="group"
            aria-labelledby={`col-${col.id}`}
            className="w-[280px] shrink-0"
          >
            <h2
              id={`col-${col.id}`}
              className="text-xs font-semibold text-text-sub flex items-center gap-1.5"
            >
              {key === 'status' ? (
                <StatusMark status={col.id} label={col.label} />
              ) : (
                <span className="truncate">{col.label}</span>
              )}
              <span className="text-text-muted tabular-nums">{col.issues.length}</span>
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {col.issues.map((issue, i) => (
                // No public per-issue identity exists (ADR 0012 §5 omits _id);
                // the render is static, so array index is a fine key.
                <li key={i}>
                  <SpaceIssueCard issue={issue} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/** One read-only card. Title is static text — there is no public detail page. */
export function SpaceIssueCard({ issue }: { issue: PublicIssue }) {
  return (
    <div className="bg-bg-card border border-border rounded-md px-3 py-2.5">
      <p className="text-[13px] font-medium leading-snug">{issue.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={issue.priority} />
        {issue.type && (
          <Badge variant="outline" size="xs">
            {titleCase(issue.type)}
          </Badge>
        )}
        {issue.labels.map((label) => (
          <Badge key={label} variant="neutral" size="xs">
            {label}
          </Badge>
        ))}
        {issue.dueDate && (
          <time dateTime={issue.dueDate} className="text-2xs text-text-muted">
            Due {formatDue(issue.dueDate)}
          </time>
        )}
      </div>
    </div>
  );
}
