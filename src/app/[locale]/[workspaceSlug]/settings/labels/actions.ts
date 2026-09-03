'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { FormState, RowActionState } from '@/lib/form-state';
import { createLabel, deleteLabel, updateLabel, type LabelProblem } from '@/server/services/labels';

/**
 * Label management — workspace vocabulary, not project vocabulary (§9).
 *
 * The permission is `workspace.settings`, checked in the service: §10's matrix
 * has no label row, and inventing one would put a rule in the code that the
 * table a non-technical owner is shown does not contain. A label is workspace
 * configuration in the same sense a team is, so it takes the same permission.
 * Applying an existing label to an item is `work_item.edit` and lives
 * elsewhere.
 */

const KEYS: Record<LabelProblem, string> = {
  name_required: 'labels.errors.nameRequired',
  name_taken: 'labels.errors.nameTaken',
  not_found: 'labels.errors.notFound',
  in_use: 'labels.errors.inUse',
};

type Context = { workspaceSlug: string; locale: 'en' | 'km' };

function contextFrom(formData: FormData): Context {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    locale: formData.get('locale') === 'km' ? 'km' : 'en',
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

function revalidateLabels({ locale, workspaceSlug }: Context) {
  revalidatePath(`/${locale}/${workspaceSlug}/settings/labels`);
}

export async function createLabelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await createLabel(resolved, {
      name: String(formData.get('name') ?? ''),
      color: String(formData.get('color') ?? '') || undefined,
    });

    if (!result.ok) return { fields: { name: KEYS[result.problem] } };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'labels.errors.forbidden' };
    throw error;
  }

  revalidateLabels(context);
  return {};
}

export async function updateLabelAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await updateLabel(resolved, {
      labelId: String(formData.get('labelId') ?? ''),
      name: String(formData.get('name') ?? ''),
      color: String(formData.get('color') ?? '') || undefined,
    });

    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'labels.errors.forbidden' };
    throw error;
  }

  revalidateLabels(context);
  return { done: true };
}

/**
 * §6's safety rule: "deleting a definition with data requires an explicit
 * choice about the data".
 *
 * The first attempt carries no `detach`, so a label still on items is refused
 * and the screen can ask. Confirming re-submits with it, and the removal from
 * every item it was on is then something a person chose rather than something
 * that happened to them.
 */
export async function deleteLabelAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await deleteLabel(resolved, {
      labelId: String(formData.get('labelId') ?? ''),
      detach: formData.get('detach') === '1',
    });

    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'labels.errors.forbidden' };
    throw error;
  }

  revalidateLabels(context);
  return { done: true };
}
