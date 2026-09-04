'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { startViewAs, stopViewAs } from '@/server/services/view-as';
import type { RowActionState } from '@/lib/form-state';

/**
 * §7.13's two acts.
 *
 * They are in their own file rather than in `settings/members/actions.ts`
 * because the **bar** imports the exit action and the bar renders in the
 * workspace layout, on every screen. Importing it from a module that also
 * exports the member-management actions would pull those into every page's
 * client reference graph for no reason.
 *
 * Both redirect to the workspace root rather than revalidating in place, and
 * that is §7.13 read literally: "the app re-renders as that person — their
 * projects, their navigation, their My Work". The page the viewer was on may be
 * a project the target cannot see, and staying there would answer the question
 * with a 404 instead of with the screen.
 */

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

export async function startViewAsAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  try {
    const result = await startViewAs(
      await actorFor(workspaceSlug),
      String(formData.get('memberId') ?? ''),
    );

    if (!result.ok) return { error: `viewAs.errors.${result.problem}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  // Every cached render of this workspace was produced for the viewer, and
  // every one of them is now about to be produced for somebody else.
  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
  redirect({ href: `/${workspaceSlug}`, locale });
}

export async function exitViewAsAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  // No permission check and no failure path: leaving is always allowed, and a
  // viewer whose Admin was revoked mid-session is exactly the person who most
  // needs this button to work. `stopViewAs` clears the cookie whatever else
  // happens.
  await stopViewAs(await actorFor(workspaceSlug));

  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
  redirect({ href: `/${workspaceSlug}/settings/members`, locale });
}
