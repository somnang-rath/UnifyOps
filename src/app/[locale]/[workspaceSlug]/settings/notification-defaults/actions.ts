'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { setWorkspaceNotificationDefault } from '@/server/services/notifications';

/**
 * §6-6's company defaults.
 *
 * One kind per call, exactly like the per-member grid it shares a component
 * with: every switch is a complete decision, and §11 wants a refusal reported
 * in the row that caused it rather than as a form-level error about a checkbox
 * somewhere.
 *
 * Unlike the per-member action this one is behind `workspace.settings`, and the
 * service is where that is asserted — a `false` returned here is what the grid
 * turns into the toast that rolls the switch back.
 */
export async function saveWorkspaceNotificationDefaultAction(
  workspaceSlug: string,
  locale: string,
  kind: string,
  channels: string[],
): Promise<boolean> {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');

  try {
    const result = await setWorkspaceNotificationDefault(resolved, { kind, channels });
    if (result.ok) {
      revalidatePath(`/${locale}/${workspaceSlug}/settings/notification-defaults`);
      // Everybody's own preference screen shows what the default resolves to,
      // so it is stale too.
      revalidatePath(`/${locale}/${workspaceSlug}/settings/notifications`);
    }
    return result.ok;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}
