import type { NotificationKind } from '@/lib/notification-kinds';
import type { NotificationRow } from '@/server/queries/notifications';

/**
 * One inbox row as it crosses to the client.
 *
 * Its own module, and not because of taste: a `'use server'` file may export
 * only async functions, so the mapper below cannot live beside the actions that
 * call it — the build fails with an error pointing at the last line of the
 * file. `src/lib/form-state.ts` exists for exactly the same reason.
 *
 * Not a client module either. It has no `'use client'`, so the server actions
 * can import the mapper without dragging a client boundary along, and the list
 * component can import the type.
 */
export type InboxEntry = {
  id: string;
  kind: NotificationKind;
  /** The event type. §13: the row carries the identifier, the renderer owns the sentence. */
  eventType: string;
  /**
   * ISO 8601. A `Date` survives serialisation and is then formatted against
   * whatever locale and zone the browser happens to have — and "2 hours ago" is
   * the one thing on this screen that is genuinely an instant rather than a
   * calendar day, so it is the one that may be relative to the reader (§17-13
   * governs the rest).
   */
  occurredAt: string;
  readAt: string | null;
  /** Null when the account is gone, not merely when the person has left (§7.12). */
  actorName: string | null;
  /**
   * What the row is about (§20.6), carried across as the same discriminated
   * union the query built.
   *
   * Flattening it back into nullable fields at this boundary would put the
   * branch in the component, where a page notification could render an item's
   * number by mistake. The union crosses the wire intact, so the list has to ask
   * which kind it is before it can build a link — which is what stops slice 18's
   * new subject from silently rendering as a broken item link.
   */
  subject: NotificationRow['subject'];
  commentId: string | null;
};

export function toEntry(row: {
  id: string;
  kind: NotificationKind;
  eventType: string;
  occurredAt: Date;
  readAt: Date | null;
  actorName: string | null;
  subject: NotificationRow['subject'];
  commentId: string | null;
}): InboxEntry {
  return {
    id: row.id,
    kind: row.kind,
    eventType: row.eventType,
    actorName: row.actorName,
    subject: row.subject,
    commentId: row.commentId,
    occurredAt: row.occurredAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}
