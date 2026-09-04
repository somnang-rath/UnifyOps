'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { updateBranding } from '@/server/services/workspace-settings';
import type { RowActionState } from '@/lib/form-state';

/**
 * §6-7's two writes.
 *
 * Both revalidate the workspace **layout**, not this page: the accent is an
 * attribute on the shell and the logo is in the header, so every screen in the
 * product is stale the moment either changes. The upload's own confirm step
 * goes through the route handler instead (`api/internal/upload/logo`), because
 * what the browser needs there is a value before anything on screen changes.
 */

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

export async function saveAccentAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  // The empty string is "use the product's default", which is a real answer and
  // is stored as null — not the same fact as choosing Navy, which happens to
  // look identical. See the column comment on `workspace.accent`.
  const raw = String(formData.get('accent') ?? '');

  try {
    const result = await updateBranding(await actorFor(workspaceSlug), {
      accent: raw === '' ? null : raw,
    });

    if (!result.ok) return { error: `settings.branding.errors.${result.problem}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
  return { done: true };
}

export async function clearLogoAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  try {
    // The bytes outlive the row, exactly as a deleted attachment's do (slice 8):
    // a clear that called Cloudflare inside the request would fail whenever
    // Cloudflare had a bad minute, and removing a logo somebody should not have
    // uploaded is the one moment that must not depend on a third party.
    await updateBranding(await actorFor(workspaceSlug), { logoKey: null });
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
  return { done: true };
}
