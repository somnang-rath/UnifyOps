'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { InboxEntry } from './entry';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * The inbox (§7.8).
 *
 * §7.8 asks for the list to be "grouped by item", and it is — but grouped
 * *within* the time order rather than by collapsing the whole list into item
 * buckets. Three comments on one item this morning read as one block this
 * morning; the same item touched again next week is a separate block next week.
 * Bucketing by item outright would move a week-old thread to the top of the
 * list because somebody added a label to it, which is not what an inbox is for.
 *
 * A client component because marking read is optimistic: the row has to dim
 * before the round trip, and §11 wants no toast for a result that is visible on
 * screen. The failure path is where the toast lives, because a row that quietly
 * un-dims explains nothing.
 */

export type { InboxEntry };

type Props = {
  workspaceSlug: string;
  /**
   * The instant "2 hours ago" is measured against, resolved on the server.
   *
   * Passed rather than taken from the browser clock: next-intl's `relativeTime`
   * otherwise falls back to the render environment and says so loudly
   * (`ENVIRONMENT_FALLBACK`), and a value that differs between the server render
   * and the client hydration is a mismatch waiting for a slow page.
   */
  now: string;
  entries: InboxEntry[];
  nextCursor: string | null;
  /** Marks one entry read or unread. Resolves false when the row is gone. */
  onSetRead: (id: string, read: boolean) => Promise<boolean>;
  /** §7.8: acts on every unread row, not the page in front of you. */
  onMarkAllRead: () => Promise<void>;
  /** Fetches the next keyset page. Cursors never enter the URL (§9). */
  onLoadMore: (cursor: string) => Promise<{ entries: InboxEntry[]; nextCursor: string | null }>;
};

export function NotificationList({
  workspaceSlug,
  now,
  entries: initial,
  nextCursor: initialCursor,
  onSetRead,
  onMarkAllRead,
  onLoadMore,
}: Props) {
  const t = useTranslations('inbox');
  const format = useFormatter();
  const toast = useToast();

  /**
   * Appended pages only. The first page stays a prop, the same rule `GroupList`
   * follows for the same reason: seeding state from props looks simpler and
   * silently freezes the list at whatever it held on mount, so a notification
   * that arrived since would appear in the badge and nowhere else.
   */
  const [appended, setAppended] = useState<InboxEntry[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, startLoading] = useTransition();
  const [failedToLoad, setFailedToLoad] = useState(false);

  const entries = [...initial, ...appended];

  const [optimistic, applyOptimistic] = useOptimistic(
    entries,
    (rows: InboxEntry[], change: { id: string | null; read: boolean }) =>
      rows.map((row) =>
        change.id === null || row.id === change.id
          ? { ...row, readAt: change.read ? new Date().toISOString() : null }
          : row,
      ),
  );

  const [, startMutating] = useTransition();

  const setRead = (entry: InboxEntry, read: boolean) => {
    startMutating(async () => {
      applyOptimistic({ id: entry.id, read });
      const ok = await onSetRead(entry.id, read);
      // The row rolls back on its own when the transition settles against
      // unchanged server state; the toast is what explains why (§11).
      if (!ok) toast({ tone: 'danger', message: t('errors.gone') });
    });
  };

  const markAll = () => {
    startMutating(async () => {
      applyOptimistic({ id: null, read: true });
      await onMarkAllRead();
    });
  };

  const loadMore = () => {
    if (!cursor) return;
    setFailedToLoad(false);

    startLoading(async () => {
      try {
        const page = await onLoadMore(cursor);
        setAppended((rows) => [...rows, ...page.entries]);
        setCursor(page.nextCursor);
      } catch {
        // Kept on screen with a retry rather than thrown away: §11's error state
        // says what to do next, and what to do next here is "press it again".
        setFailedToLoad(true);
      }
    });
  };

  const unread = optimistic.filter((entry) => entry.readAt === null).length;

  if (optimistic.length === 0) {
    // §7.8's own words for this state, and it is the "empty is good news" case
    // the five-states rule singles out — a neutral "no results" would read as a
    // failure to somebody who has simply dealt with everything.
    return <EmptyState title={t('empty')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {unread > 0 ? t('unreadCount', { count: unread }) : t('allRead')}
        </p>

        {unread > 0 && (
          <Button type="button" variant="ghost" onClick={markAll}>
            {t('markAllRead')}
          </Button>
        )}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {groupAdjacent(optimistic).map((group) => (
          <li key={`${group.workItemId}-${group.entries[0]?.id}`}>
            <div className="flex flex-col gap-1 px-3 py-3 sm:px-4">
              <Link
                href={itemHref(workspaceSlug, group)}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
              >
                <span className="font-medium text-text-muted tabular-nums">
                  {group.projectKey}-{group.itemNumber}
                </span>
                {/*
                  Clamped rather than sliced: §13 requires grapheme-aware
                  truncation, and CSS line-clamp is the one truncation that is
                  correct in every script by construction.
                */}
                <span className="line-clamp-2 text-text">{group.itemTitle}</span>
              </Link>

              <ul className="space-y-1">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 text-2xs"
                  >
                    <span
                      className={cn(
                        'flex items-center gap-1.5',
                        entry.readAt === null ? 'text-text' : 'text-text-subtle',
                      )}
                    >
                      {entry.readAt === null && (
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                      <span>
                        {t(`kind.${entry.kind}`, { actor: entry.actorName ?? t('someone') })}
                        {' · '}
                        {format.relativeTime(new Date(entry.occurredAt), new Date(now))}
                      </span>
                    </span>

                    <button
                      type="button"
                      onClick={() => setRead(entry, entry.readAt === null)}
                      className="shrink-0 rounded-xs px-1 py-0.5 text-text-subtle transition-colors duration-120 hover:text-text"
                    >
                      {entry.readAt === null ? t('markRead') : t('markUnread')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>

      {failedToLoad && (
        <p role="status" className="text-sm text-danger">
          {t('errors.loadMore')}
        </p>
      )}

      {cursor && (
        <Button type="button" variant="secondary" onClick={loadMore} disabled={loading}>
          {loading ? t('loading') : t('loadMore')}
        </Button>
      )}
    </div>
  );
}

type Group = {
  workItemId: string;
  itemNumber: number;
  itemTitle: string;
  projectKey: string;
  projectSlug: string;
  commentId: string | null;
  entries: InboxEntry[];
};

/**
 * Consecutive entries about the same item become one block.
 *
 * Adjacent only — see the note at the top. The block links to the newest
 * comment among its entries, because that is the one the person has not read
 * and §7.8 wants the click to land on the comment rather than the item.
 */
function groupAdjacent(entries: InboxEntry[]): Group[] {
  const groups: Group[] = [];

  for (const entry of entries) {
    const last = groups.at(-1);

    if (last && last.workItemId === entry.workItemId) {
      last.entries.push(entry);
      last.commentId ??= entry.commentId;
      continue;
    }

    groups.push({
      workItemId: entry.workItemId,
      itemNumber: entry.itemNumber,
      itemTitle: entry.itemTitle,
      projectKey: entry.projectKey,
      projectSlug: entry.projectSlug,
      commentId: entry.commentId,
      entries: [entry],
    });
  }

  return groups;
}

function itemHref(workspaceSlug: string, group: Group): string {
  const path = `/${workspaceSlug}/projects/${group.projectSlug}/${group.itemNumber}`;
  return group.commentId ? `${path}#comment-${group.commentId}` : path;
}
