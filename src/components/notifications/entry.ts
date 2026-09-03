import type { NotificationKind } from '@/lib/notification-kinds';

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
  workItemId: string;
  commentId: string | null;
  itemNumber: number;
  itemTitle: string;
  projectKey: string;
  projectSlug: string;
};

export function toEntry(row: {
  id: string;
  kind: NotificationKind;
  eventType: string;
  occurredAt: Date;
  readAt: Date | null;
  actorName: string | null;
  workItemId: string;
  commentId: string | null;
  itemNumber: number;
  itemTitle: string;
  projectKey: string;
  projectSlug: string;
}): InboxEntry {
  return {
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}
