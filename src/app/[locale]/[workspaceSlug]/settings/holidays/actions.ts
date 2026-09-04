'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { addHoliday, removeHoliday, seedHolidays } from '@/server/services/holidays';
import type { RowActionState } from '@/lib/form-state';

/**
 * The holiday calendar's three mutations (§6-1, §18-10).
 *
 * All three revalidate the **whole workspace subtree**, not this page. A day
 * added here changes what `is_working_day`, `business_days_between` and
 * `stale_before` return — so Needs Attention, every burndown and every due
 * bucket in the product are stale the moment it is written. Revalidating one
 * settings page and leaving those cached would show somebody a calendar they
 * had just fixed alongside the numbers it was supposed to fix.
 */

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

function revalidateWorkspace(locale: string, workspaceSlug: string) {
  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
}

export async function addHolidayAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  try {
    const result = await addHoliday(await actorFor(workspaceSlug), {
      date: String(formData.get('date') ?? ''),
      name: String(formData.get('name') ?? ''),
    });

    if (!result.ok) return { error: `settings.holidays.errors.${result.problem}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidateWorkspace(locale, workspaceSlug);
  return { done: true };
}

export async function removeHolidayAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  try {
    const result = await removeHoliday(
      await actorFor(workspaceSlug),
      String(formData.get('holidayId') ?? ''),
    );

    if (!result.ok) return { error: `settings.holidays.errors.${result.problem}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidateWorkspace(locale, workspaceSlug);
  return { done: true };
}

export async function seedHolidaysAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';
  const year = Number(formData.get('year') ?? 0);

  try {
    // The service bounds the year to the arithmetic horizon itself, so a
    // crafted payload asking for 2099 writes nothing rather than being refused
    // with an error nobody can act on.
    await seedHolidays(await actorFor(workspaceSlug), [year]);
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidateWorkspace(locale, workspaceSlug);
  return { done: true };
}
