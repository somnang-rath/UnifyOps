import { Badge } from '@prism/ui';
import type { Locale } from '@prism/i18n';
import type { PublicIssue, PublicBoardColumn } from '@/lib/public-api';
import { PriorityBadge, StatusMark, formatDue, statusLabel } from './issue-meta';

/**
 * Flat read-only list for published views/projects (spec publish-to-space
 * §3.4). Calendar/timeline/spreadsheet layouts degrade to this in v1
 * (ADR 0012 §6). Server component, local to apps/space — see space-board.tsx
 * for why this is not shared with web.
 */

interface SpaceIssueListProps {
  issues: PublicIssue[];
  /** Column defs, used only to resolve display labels for custom statuses. */
  columns?: PublicBoardColumn[];
  /** Resolved by the route; server components have no `useFormat()`. */
  locale: Locale;
}

const MAX_LABELS = 2;

export function SpaceIssueList({ issues, columns, locale }: SpaceIssueListProps) {
  return (
    <ul className="divide-y divide-border border border-border rounded-lg bg-bg-card">
      {issues.map((issue, i) => (
        // No public per-issue identity exists (ADR 0012 §5 omits _id); the
        // render is static, so array index is a fine key.
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <StatusMark
            status={issue.status}
            label={statusLabel(issue, columns)}
            className="text-2xs text-text-muted w-[90px] shrink-0"
          />
          <span className="text-[13px] flex-1 min-w-0 truncate">{issue.title}</span>
          {issue.labels.length > 0 && (
            <span className="hidden sm:flex items-center gap-1">
              {issue.labels.slice(0, MAX_LABELS).map((label) => (
                <Badge key={label} variant="neutral" size="xs">
                  {label}
                </Badge>
              ))}
              {issue.labels.length > MAX_LABELS && (
                <Badge variant="neutral" size="xs">
                  +{issue.labels.length - MAX_LABELS}
                </Badge>
              )}
            </span>
          )}
          <PriorityBadge priority={issue.priority} />
          {issue.dueDate && (
            <time
              dateTime={issue.dueDate}
              className="hidden sm:block text-2xs text-text-muted tabular-nums"
            >
              {formatDue(issue.dueDate, locale)}
            </time>
          )}
        </li>
      ))}
    </ul>
  );
}
