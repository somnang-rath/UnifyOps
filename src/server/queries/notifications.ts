import 'server-only';

import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { NotificationKind } from '@/lib/notification-kinds';
import type { TenantDb } from '@/server/db/client';
import { notification, project, user, wikiPage, wikiSpace, workItem } from '@/server/db/schema';

/**
 * Reading one person's inbox (§7.8).
 *
 * Beside `queries/activity.ts` rather than inside the §9 list query, and for
 * the same reason that one is: the list query exists in one piece because the
 * board, My Work and Needs Attention are the same question with different
 * filters. An inbox is not that question — it is one member's rows in time
 * order, and it is keyed on a table work items know nothing about.
 */

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  /** The event type. §13: the renderer owns the sentence, the row owns the identifier. */
  eventType: string;
  data: Record<string, unknown>;
  occurredAt: Date;
  readAt: Date | null;
  actorUserId: string | null;
  /** Null only when the account is gone — not merely when the person has left (§7.12). */
  actorName: string | null;
  /**
  * What this notification is about (§20.6).
  *
  * A discriminated union rather than a nullable pair, so the renderer cannot
  * read an item's number off a page notification — the compiler asks which one
  * it is before it will hand over either. The two branches carry everything
  * needed to build the link, which is what keeps the inbox one query however
  * many kinds of subject there eventually are (§20.16-4).
  */
  subject:
    | {
        kind: 'work_item';
        id: string;
        itemNumber: number;
        itemTitle: string;
        projectKey: string;
        projectSlug: string;
      }
    | { kind: 'wiki_page'; id: string; pageTitle: string; pageSlug: string; spaceSlug: string };
  commentId: string | null;
};

export type InboxPage = {
  rows: NotificationRow[];
  /** Opaque, and never in the URL — a scroll position is not a shareable filter (§9). */
  nextCursor: string | null;
};

/**
 * The unread badge every workspace screen renders.
 *
 * Its own query rather than a field on the page, because the bell is on every
 * screen and the inbox is on one. It rides the partial index on unread rows, so
 * a member who has read everything pays for an empty index scan.
 */
export async function countUnread(tx: TenantDb, memberId: string): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(notification)
    .where(and(eq(notification.recipientMemberId, memberId), isNull(notification.readAt)));

  return row?.total ?? 0;
}

/**
 * One page of the inbox, newest first.
 *
 * Keyset, not offset — §9's rule, and it matters more here than almost anywhere
 * else: an inbox is the one list where new rows arrive *at the end you are
 * reading from*, so an offset page two would show entries page one already did.
 * The cursor is `(occurredAt, id)`, the index's own order, and `id` breaks the
 * tie that a transaction timestamp leaves between rows one event produced.
 */
export async function fetchInbox(
  tx: TenantDb,
  input: { memberId: string; limit: number; cursor?: string | null },
): Promise<InboxPage> {
  const cursor = decodeCursor(input.cursor);

  const rows = await tx
    .select({
      id: notification.id,
      kind: notification.kind,
      eventType: notification.eventType,
      data: notification.data,
      occurredAt: notification.occurredAt,
      readAt: notification.readAt,
      actorUserId: notification.actorUserId,
      actorName: user.name,
      workItemId: notification.workItemId,
      wikiPageId: notification.wikiPageId,
      commentId: notification.commentId,
      itemNumber: workItem.number,
      itemTitle: workItem.title,
      projectKey: project.key,
      projectSlug: project.slug,
      pageTitle: wikiPage.title,
      pageSlug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
    })
    .from(notification)
    .leftJoin(user, eq(user.id, notification.actorUserId))
    /**
     * **Left joins since slice 18, where the item join was inner.**
     *
     * An inner join on `work_item` was correct while every notification was
     * about one; with §20.6's subject union it would silently drop every page
     * mention from the inbox — a notification written, delivered, and invisible.
     * The subject is reconstructed below and a row matching neither branch is
     * discarded there, which is the same protection the inner join gave.
     */
    .leftJoin(workItem, eq(workItem.id, notification.workItemId))
    .leftJoin(project, eq(project.id, workItem.projectId))
    .leftJoin(wikiPage, eq(wikiPage.id, notification.wikiPageId))
    .leftJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(
      and(
        eq(notification.recipientMemberId, input.memberId),
        // The subject's own soft delete, per branch. A notification about
        // something that no longer exists is a dead link, and §7.8's inbox is a
        // list of places to go rather than a history — that is what `activity`
        // and `audit` are. Written as "the row this points at is alive", which
        // is one predicate that stays correct as the union gains members.
        or(isNull(notification.workItemId), isNull(workItem.deletedAt)),
        or(isNull(notification.wikiPageId), isNull(wikiPage.deletedAt)),
        cursor
          ? or(
              lt(notification.occurredAt, cursor.occurredAt),
              and(
                eq(notification.occurredAt, cursor.occurredAt),
                lt(notification.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notification.occurredAt), desc(notification.id))
    // One extra, so "is there more" costs no second query.
    .limit(input.limit + 1);

  const more = rows.length > input.limit;
  const page = more ? rows.slice(0, input.limit) : rows;
  const last = page.at(-1);

  return {
    rows: page.flatMap((row) => {
      const subject = subjectOf(row);
      // A row whose subject resolved to nothing — the parent was deleted
      // between the predicate and the join, or a future union member this build
      // does not know. Dropping it is what the inner join used to do.
      if (subject === null) return [];
      return [
        {
          id: row.id,
          kind: row.kind,
          eventType: row.eventType,
          data: (row.data ?? {}) as Record<string, unknown>,
          occurredAt: row.occurredAt,
          readAt: row.readAt,
          actorUserId: row.actorUserId,
          actorName: row.actorName,
          subject,
          commentId: row.commentId,
        },
      ];
    }),
    nextCursor: more && last ? encodeCursor(last.occurredAt, last.id) : null,
  };
}

/**
 * The ids on one page, for "mark all read" to act on — except that it does not.
 *
 * §7.8: "500 notifications → paginated, **'mark all read' acts on all**". The
 * distinction is the whole point of the edge case: a button that only clears
 * what happens to be on screen leaves a badge showing 450 and no way to reach
 * the rest. The service therefore issues one UPDATE with no id list at all, and
 * this function exists only to say so where somebody would otherwise add one.
 */
export async function markAllRead(tx: TenantDb, memberId: string): Promise<number> {
  const result = await tx
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.recipientMemberId, memberId), isNull(notification.readAt)))
    .returning({ id: notification.id });

  return result.length;
}

/**
 * Mark one entry read or unread (§7.8 asks for both directions).
 *
 * Scoped to the member in the predicate as well as by RLS: the policy answers
 * "is this row in your workspace", and this answers "is it yours". Colleagues
 * share a workspace, and an inbox is the one table where that is not enough.
 */
export async function setNotificationRead(
  tx: TenantDb,
  input: { memberId: string; notificationId: string; read: boolean },
): Promise<boolean> {
  const result = await tx
    .update(notification)
    .set({ readAt: input.read ? new Date() : null })
    .where(
      and(
        eq(notification.id, input.notificationId),
        eq(notification.recipientMemberId, input.memberId),
      ),
    )
    .returning({ id: notification.id });

  return result.length > 0;
}

type Cursor = { occurredAt: Date; id: string };

/**
 * `<epoch-millis>.<uuid>`, opaque to the caller.
 *
 * Not signed, and it does not need to be: forging one moves your own scroll
 * position, and every row it could reach is already yours by the predicate
 * above. §9's cursors are hidden from the URL because they are a scroll
 * position, not because they are a capability.
 */
/**
 * The one place §20.6's subject union is reconstructed from its columns.
 *
 * A single function rather than a branch at each reader, for the reason
 * `effectiveProjectRole` is the only implementation of §10's composition: the
 * mapping from "two nullable columns and their joins" to "which thing is this
 * about" has to have exactly one answer, or the inbox and the email will
 * eventually disagree about a row.
 *
 * Returns null when neither branch resolves — a subject whose parent went away
 * between the predicate and the join, or a union member written by a newer
 * build than this one. Discarding beats rendering a link to nothing.
 */
function subjectOf(row: {
  workItemId: string | null;
  wikiPageId: string | null;
  itemNumber: number | null;
  itemTitle: string | null;
  projectKey: string | null;
  projectSlug: string | null;
  pageTitle: string | null;
  pageSlug: string | null;
  spaceSlug: string | null;
}): NotificationRow['subject'] | null {
  if (
    row.workItemId !== null &&
    row.itemNumber !== null &&
    row.itemTitle !== null &&
    row.projectKey !== null &&
    row.projectSlug !== null
  ) {
    return {
      kind: 'work_item',
      id: row.workItemId,
      itemNumber: row.itemNumber,
      itemTitle: row.itemTitle,
      projectKey: row.projectKey,
      projectSlug: row.projectSlug,
    };
  }

  if (
    row.wikiPageId !== null &&
    row.pageTitle !== null &&
    row.pageSlug !== null &&
    row.spaceSlug !== null
  ) {
    return {
      kind: 'wiki_page',
      id: row.wikiPageId,
      pageTitle: row.pageTitle,
      pageSlug: row.pageSlug,
      spaceSlug: row.spaceSlug,
    };
  }

  return null;
}

function encodeCursor(occurredAt: Date, id: string): string {
  return `${occurredAt.getTime()}.${id}`;
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  const parsed = value ? CURSOR.exec(value) : null;
  if (!parsed) return null;

  const millis = Number.parseInt(parsed[1] as string, 10);
  if (!Number.isFinite(millis)) return null;

  return { occurredAt: new Date(millis), id: parsed[2] as string };
}

/**
 * Matched rather than split on the separator, so a malformed cursor is rejected
 * whole instead of being partially believed — and the shape is stated in one
 * place a reader can check against `encodeCursor`.
 */
const CURSOR = /^(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
