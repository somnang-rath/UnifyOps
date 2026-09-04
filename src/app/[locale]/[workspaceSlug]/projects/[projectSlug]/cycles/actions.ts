'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { FormState, RowActionState } from '@/lib/form-state';
import {
  completeCycle,
  createCycle,
  deleteCycle,
  isDisposition,
  planItemsIntoCycle,
  setItemCycle,
  type CycleFailure,
} from '@/server/services/cycles';
import { redirect } from '@/i18n/navigation';

/**
 * The cycle server actions (§7.6, slice 11).
 *
 * Each one re-resolves the actor from the session and hands the request to the
 * service, which asks §10. A server action is a public endpoint — that only our
 * own forms post to it is a property of our UI, not of the network — so a
 * `cycleId` arriving in a payload is a request, never an authorization.
 * Nothing here decides anything; it translates.
 */

/** Problem identifiers to message keys. Sentences are translated (§13). */
const KEYS: Record<CycleFailure, string> = {
  name_required: 'cycles.errors.nameRequired',
  name_too_long: 'cycles.errors.nameTooLong',
  name_taken: 'cycles.errors.nameTaken',
  invalid_dates: 'cycles.errors.invalidDates',
  end_before_start: 'cycles.errors.endBeforeStart',
  too_long: 'cycles.errors.tooLong',
  cycle_closed: 'cycles.errors.closed',
  wrong_project: 'cycles.errors.wrongProject',
  not_found: 'cycles.errors.notFound',
  archived: 'projects.errors.archived',
  // Reached through `ProjectProblem`, which this module inherits wholesale
  // rather than narrowing — a narrower union here would be a second list to
  // keep in step with the service's.
  slug_taken: 'projects.errors.slugTaken',
  invalid_slug: 'projects.errors.invalidSlug',
  key_taken: 'projects.errors.keyTaken',
  invalid_key: 'projects.errors.invalidKey',
  no_team: 'projects.errors.noTeam',
};

type Context = {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  locale: string;
};

function contextFrom(formData: FormData): Context {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    projectSlug: String(formData.get('projectSlug') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    locale: formData.get('locale') === 'km' ? 'km' : 'en',
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

/**
 * A cycle change moves work, so it invalidates more than the cycle's own page:
 * the project list groups by cycle, and an item's detail panel names the one it
 * is in.
 */
function revalidateCycles(ctx: Context, cycleId?: string): void {
  const base = `/${ctx.locale}/${ctx.workspaceSlug}/projects/${ctx.projectSlug}`;
  revalidatePath(base);
  revalidatePath(`${base}/cycles`);
  if (cycleId) revalidatePath(`${base}/cycles/${cycleId}`);
}

/** Turns a thrown §10 refusal into the same shape a returned problem takes. */
function forbidden(error: unknown): FormState {
  if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
  throw error;
}

export async function createCycleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = contextFrom(formData);
  const resolved = await actorFor(ctx.workspaceSlug);

  let cycleId: string;
  try {
    const result = await createCycle(resolved, {
      projectId: ctx.projectId,
      name: String(formData.get('name') ?? ''),
      goal: String(formData.get('goal') ?? ''),
      startDate: String(formData.get('startDate') ?? ''),
      endDate: String(formData.get('endDate') ?? ''),
    });

    if (!result.ok) return { error: KEYS[result.problem] };
    cycleId = result.cycleId;
  } catch (error) {
    return forbidden(error);
  }

  revalidateCycles(ctx, cycleId);
  // Straight to the cycle that was just planned, because §7.6's next step is
  // "add items" and that is where the picker is.
  redirect({
    href: `/${ctx.workspaceSlug}/projects/${ctx.projectSlug}/cycles/${cycleId}`,
    locale: ctx.locale,
  });
}

export async function deleteCycleAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const ctx = contextFrom(formData);
  const resolved = await actorFor(ctx.workspaceSlug);

  try {
    const result = await deleteCycle(resolved, String(formData.get('cycleId') ?? ''));
    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    return forbidden(error);
  }

  revalidateCycles(ctx);
  redirect({
    href: `/${ctx.workspaceSlug}/projects/${ctx.projectSlug}/cycles`,
    locale: ctx.locale,
  });
}

/**
 * §7.6's end-of-cycle prompt: "move to next cycle, return to backlog, or
 * leave".
 *
 * A form rather than three buttons calling three actions, because it is one
 * decision with three answers — and because "move to next cycle" needs to say
 * *which*, which is a second control on the same form.
 */
export async function completeCycleAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const ctx = contextFrom(formData);
  const resolved = await actorFor(ctx.workspaceSlug);
  const cycleId = String(formData.get('cycleId') ?? '');

  const raw = formData.get('disposition');
  // An unrecognised answer is "leave", which is the one that moves nothing. A
  // hand-posted form must never be able to relocate a sprint's worth of work by
  // sending a word nobody recognises.
  const disposition = isDisposition(raw) ? raw : 'leave';

  try {
    const result = await completeCycle(resolved, {
      cycleId,
      disposition,
      targetCycleId: String(formData.get('targetCycleId') ?? '') || null,
    });

    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    return forbidden(error);
  }

  revalidateCycles(ctx, cycleId);
  return { done: true };
}

/**
 * Plan one item into a cycle, or return it to the backlog.
 *
 * Called from the item detail panel, where `work_item.edit` is the permission —
 * so a Member can put their own work into their team's sprint without being
 * able to create or close one.
 */
export async function setItemCycleAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const ctx = contextFrom(formData);
  const resolved = await actorFor(ctx.workspaceSlug);
  const raw = String(formData.get('cycleId') ?? '');

  try {
    const result = await setItemCycle(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      // The empty option is the backlog, which is a destination and not a
      // missing value — so it round-trips as null rather than as ''.
      cycleId: raw || null,
    });

    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    return forbidden(error);
  }

  revalidateCycles(ctx, raw || undefined);
  revalidatePath(
    `/${ctx.locale}/${ctx.workspaceSlug}/projects/${ctx.projectSlug}/${String(
      formData.get('number') ?? '',
    )}`,
  );
  return { done: true };
}

/** §7.6's "add items (multi-select from backlog)". */
export async function planItemsAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const ctx = contextFrom(formData);
  const resolved = await actorFor(ctx.workspaceSlug);
  const cycleId = String(formData.get('cycleId') ?? '');

  try {
    const result = await planItemsIntoCycle(resolved, {
      cycleId,
      // `getAll`, because the picker is a list of checkboxes sharing one name.
      workItemIds: formData.getAll('workItemIds').map(String).filter(Boolean),
    });

    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    return forbidden(error);
  }

  revalidateCycles(ctx, cycleId);
  return { done: true };
}
