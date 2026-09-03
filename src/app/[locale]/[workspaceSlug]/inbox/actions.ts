'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { toEntry } from '@/components/notifications/entry';
import type { InboxEntry } from '@/components/notifications/entry';
import {
  getInbox,
  markInboxRead,
  markNotificationRead,
} from '@/server/services/notifications';

/**
 * The inbox's three mutations and its one extra read (§7.8).
 *
 * No permission is checked here and none is checked in the service, which is
 * deliberate and is the same call slice 5 made for labels: §10's matrix has no
 * notification row, and inventing one would put a rule in the code that the
 * table a non-technical owner is shown does not contain. What stops one person
 * reaching another's inbox is not a role — it is that every query is keyed on
 * the acting member's own id, underneath RLS that has already scoped the rows
 * to the workspace.
 */

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

/**
 * Mark one entry read or unread.
 *
 * Returns a boolean rather than a `FormState`, because this is not a form: the
 * caller is an optimistic click that needs to know only whether to roll back.
 * `false` means the row is gone or was never theirs, and the list says so in a
 * toast — §11 wants a refused mutation explained where it happened, and a row
 * that silently un-dims explains nothing.
 */
export async function setNotificationReadAction(
  workspaceSlug: string,
  notificationId: string,
  read: boolean,
): Promise<boolean> {
  const resolved = await actorFor(workspaceSlug);
  const result = await markNotificationRead(resolved, { notificationId, read });

  // The badge in the header is rendered by the workspace layout, so the whole
  // subtree has to revalidate for a click here to move the number up there.
  if (result.ok) revalidatePath('/[locale]/[workspaceSlug]', 'layout');

  return result.ok;
}

/** §7.8: acts on every unread row, not the page in front of you. */
export async function markInboxReadAction(workspaceSlug: string): Promise<void> {
  const resolved = await actorFor(workspaceSlug);
  await markInboxRead(resolved);
  revalidatePath('/[locale]/[workspaceSlug]', 'layout');
}

/**
 * The next keyset page.
 *
 * A server action rather than a route handler: §8 grants five Route Handler
 * exceptions and this is none of them — it is not the list query, not a drag,
 * not an upload. The cursor rides in the action's arguments, which is exactly
 * where §9 wants it: "a filter is a description worth sharing; a cursor is one
 * person's scroll position."
 */
export async function loadMoreInboxAction(
  workspaceSlug: string,
  cursor: string,
): Promise<{ entries: InboxEntry[]; nextCursor: string | null }> {
  const resolved = await actorFor(workspaceSlug);
  const page = await getInbox(resolved, { cursor });

  return { entries: page.rows.map(toEntry), nextCursor: page.nextCursor };
}
