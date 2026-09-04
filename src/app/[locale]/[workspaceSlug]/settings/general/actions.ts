'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { updateWorkspaceSettings } from '@/server/services/workspace-settings';
import { IDLE, type FormState } from '@/lib/form-state';

/**
 * §6-1's save.
 *
 * Every failure crosses the wire as a **message key**, never a sentence
 * (`src/lib/form-state.ts`): an English string returned from a server action is
 * the one place Khmer silently degrades (§13).
 *
 * The interesting part is the end. Changing the slug changes the URL of every
 * page in the workspace, **including this one** — so a plain `revalidatePath`
 * would rebuild a route that no longer exists and leave the person looking at a
 * 404 they caused by saving a form correctly. The redirect is the save's last
 * step, and it is why the service returns the slug it wrote rather than a
 * boolean.
 */
export async function saveCompanySettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) return { error: 'auth.errors.unknown' };

  let result;
  try {
    result = await updateWorkspaceSettings(resolved, {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      weekStart: Number(formData.get('weekStart') ?? 0),
      workingDays: Number(formData.get('workingDays') ?? 0),
      defaultLocale: String(formData.get('defaultLocale') ?? 'en'),
    });
  } catch (error) {
    // §10 refused. A Member who reached this action by other means gets the
    // reason rather than a stack trace.
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  if (!result.ok) return problemState(result.problem);

  // Everything under the workspace reads the name, the zone or the week, so the
  // whole subtree is stale rather than this one page.
  revalidatePath(`/${locale}/${result.slug}`, 'layout');

  if (result.slug !== workspaceSlug) {
    redirect({ href: `/${result.slug}/settings/general`, locale });
  }

  return IDLE;
}

/**
 * A problem identifier becomes a field key or a form key.
 *
 * Field-level where the person can see which control caused it, form-level
 * where they cannot — §11's rule that a refusal is reported where it happened.
 */
function problemState(problem: string): FormState {
  switch (problem) {
    case 'name_required':
      return { fields: { name: 'settings.errors.nameRequired' } };
    case 'slug_taken':
      return { fields: { slug: 'settings.errors.slugTaken' } };
    // `SlugProblem`'s three members, shared with onboarding's field — one
    // implementation of the rule (`src/lib/slug.ts`), so the two screens cannot
    // refuse different things.
    case 'too_short':
      return { fields: { slug: 'onboarding.workspace.errors.slugTooShort' } };
    case 'reserved':
      return { fields: { slug: 'onboarding.workspace.errors.slugReserved' } };
    case 'invalid':
      return { fields: { slug: 'onboarding.workspace.errors.slugInvalid' } };
    case 'invalid_timezone':
      return { fields: { timezone: 'settings.errors.invalidTimezone' } };
    case 'no_working_days':
      return { fields: { workingDays: 'settings.errors.noWorkingDays' } };
    case 'invalid_week_start':
    case 'invalid_locale':
      return { error: 'auth.errors.unknown' };
    default:
      return { error: 'auth.errors.unknown' };
  }
}
