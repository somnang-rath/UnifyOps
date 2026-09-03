import 'server-only';

import { desc, eq } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { activity, user } from '@/server/db/schema';

/**
 * Reading one work item's activity feed (§4, §8 — slice 7).
 *
 * Deliberately not routed through `src/server/queries/work-items.ts`. That
 * module is the §9 list query, and the whole reason it exists in one piece is
 * that the board, the list, My Work, Needs Attention and the Phase 2 MCP server
 * are the *same* question with different filters. A feed is not that question:
 * it is one item, in time order, with no grouping and no facets. Folding it in
 * would add a branch to the hottest builder in the product to serve a query
 * that never needs any of it.
 */

export type ActivityRow = {
  id: string;
  occurredAt: Date;
  /** The event type. The renderer owns the sentence (§13). */
  action: string;
  data: Record<string, unknown>;
  actorUserId: string | null;
  /**
   * Null when the account itself is gone. Not when the person merely left the
   * company: `app_user`'s select policy reaches anyone who has *ever* been a
   * member of this workspace, which is what makes §7.12's "preserved and
   * attributed" true.
   */
  actorName: string | null;
};

export type ActivityPage = {
  /** Oldest first — a history reads forwards, even though it is fetched backwards. */
  rows: ActivityRow[];
  /** True when older entries exist above the window. */
  truncated: boolean;
};

/**
 * The most recent `limit` entries, returned oldest-first.
 *
 * Fetched newest-first because that is the end anybody cares about and the end
 * the index is ordered for, then reversed — a feed truncated from the *top*
 * hides what just happened, which is the opposite of useful.
 *
 * `occurred_at` alone does not order the rows: it is transaction start, so
 * every line one mutation produced shares it. The id breaks the tie, and a
 * UUIDv7 breaks it in the order the projectors emitted rather than at random.
 */
export async function fetchActivity(
  tx: TenantDb,
  input: { workItemId: string; limit: number },
): Promise<ActivityPage> {
  const rows = await tx
    .select({
      id: activity.id,
      occurredAt: activity.occurredAt,
      action: activity.action,
      data: activity.data,
      actorUserId: activity.actorUserId,
      actorName: user.name,
    })
    .from(activity)
    .leftJoin(user, eq(user.id, activity.actorUserId))
    .where(eq(activity.workItemId, input.workItemId))
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    // One more than asked for, so "is there anything older" is answered without
    // a second count over a table that only ever grows.
    .limit(input.limit + 1);

  const truncated = rows.length > input.limit;
  const page = truncated ? rows.slice(0, input.limit) : rows;

  return {
    rows: page
      .map((row) => ({
        ...row,
        data: (row.data ?? {}) as Record<string, unknown>,
      }))
      .reverse(),
    truncated,
  };
}
