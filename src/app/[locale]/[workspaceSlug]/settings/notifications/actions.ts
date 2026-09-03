'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { setNotificationPreference } from '@/server/services/notifications';

/**
 * Saving one row of §6-6's preference grid.
 *
 * One kind per call, matching the screen: every switch is a complete decision,
 * and §11 wants a refused mutation reported in the row that caused it rather
 * than as a form-level error about a checkbox somewhere.
 *
 * Like the inbox, no permission is checked — there is no §10 row for somebody's
 * own settings, and the member id the service writes against is the acting
 * member's own.
 */
export async function saveNotificationPreferenceAction(
  workspaceSlug: string,
  locale: string,
  kind: string,
  channels: string[],
): Promise<boolean> {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');

  const result = await setNotificationPreference(resolved, { kind, channels });
  if (result.ok) revalidatePath(`/${locale}/${workspaceSlug}/settings/notifications`);

  return result.ok;
}
