'use server';

import type { WorkspaceFormState } from '@/lib/form-state';
import { readCurrentUser } from '@/server/auth/session';
import { createWorkspace } from '@/server/services/workspaces';
import { redirect } from '@/i18n/navigation';

/**
 * Creating a company (§7.1).
 *
 * The only step between signing up and being in the product, and it asks for a
 * name. §7.1: "No configuration step exists anywhere in this path."
 */

/** Problem identifiers to message keys. Sentences are translated (§13). */
const PROBLEM_KEYS = {
  name_required: 'onboarding.workspace.errors.nameRequired',
  slug_taken: 'onboarding.workspace.errors.slugTaken',
  reserved: 'onboarding.workspace.errors.slugReserved',
  too_short: 'onboarding.workspace.errors.slugTooShort',
  invalid: 'onboarding.workspace.errors.slugInvalid',
} as const;

export async function createWorkspaceAction(
  _previous: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  const user = await readCurrentUser();
  if (!user) redirect({ href: '/sign-in', locale });

  const name = String(formData.get('name') ?? '');
  const slug = String(formData.get('slug') ?? '');

  const result = await createWorkspace({
    ownerUserId: user.id,
    name,
    slug: slug.trim() || undefined,
  });

  if (!result.ok) {
    const key = PROBLEM_KEYS[result.problem];
    // The name problem belongs on the name field and every slug problem on the
    // slug field: §11 asks an error to appear where the fix is.
    return { fields: { [result.problem === 'name_required' ? 'name' : 'slug']: key } };
  }

  // Straight into the workspace's own invite step. §7.1 puts inviting before
  // the first project and makes Skip visually equal to Send — the invitation
  // is offered, never required.
  redirect({ href: `/${result.slug}/invite`, locale });
}
