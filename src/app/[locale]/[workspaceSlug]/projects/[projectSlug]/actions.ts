'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { FormState, RowActionState } from '@/lib/form-state';
import {
  createWorkItem,
  deleteWorkItem,
  setWorkItemAssignees,
  setWorkItemBlocked,
  setWorkItemLabels,
  setWorkItemState,
  updateWorkItem,
  type WorkItemProblem,
} from '@/server/services/work-items';
import { redirect } from '@/i18n/navigation';

/**
 * The work-item server actions.
 *
 * Each one re-resolves the actor from the session and hands the request to the
 * service, which asks §10. A server action is a public endpoint — that only our
 * own forms post to it is a property of our UI, not of the network — so
 * `workspaceSlug` and `workItemId` arriving in a payload are a request, never
 * an authorization. Nothing here decides anything; it translates.
 */

/** Problem identifiers to message keys. Sentences are translated (§13). */
const KEYS: Record<WorkItemProblem, string> = {
  title_required: 'workItems.errors.titleRequired',
  unknown_state: 'workItems.errors.unknownState',
  unknown_parent: 'workItems.errors.unknownParent',
  too_deep: 'workItems.errors.tooDeep',
  unknown_member: 'workItems.errors.unknownMember',
  unknown_label: 'workItems.errors.unknownLabel',
  blocked_reason_required: 'workItems.errors.blockedReasonRequired',
  not_found: 'workItems.errors.notFound',
  archived: 'projects.errors.archived',
  name_required: 'workItems.errors.titleRequired',
  slug_taken: 'projects.errors.slugTaken',
  invalid_slug: 'projects.errors.invalidSlug',
  key_taken: 'projects.errors.keyTaken',
  invalid_key: 'projects.errors.invalidKey',
  no_team: 'projects.errors.noTeam',
};

type Locale = 'en' | 'km';

type Context = {
  workspaceSlug: string;
  projectSlug: string;
  locale: Locale;
};

function localeOf(value: unknown): Locale {
  return value === 'km' ? 'km' : 'en';
}

function contextFrom(formData: FormData): Context & { projectId: string } {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    projectSlug: String(formData.get('projectSlug') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    locale: localeOf(formData.get('locale')),
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

/**
 * The list and the item both change when an item does, and the list is grouped
 * by state — so a state change moves a row between two groups and the page has
 * to be rebuilt, not patched.
 */
function revalidateItem(context: Context, number?: number) {
  revalidatePath(`/${context.locale}/${context.workspaceSlug}/projects/${context.projectSlug}`);
  if (number !== undefined) {
    revalidatePath(
      `/${context.locale}/${context.workspaceSlug}/projects/${context.projectSlug}/${number}`,
    );
  }
}

/** Turns a thrown §10 refusal into the same shape a returned problem takes. */
async function guarded<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // Two different sentences, because "you are in view-as" and "you are not a
      // member of this project" ask the person to do different things (§10).
      return {
        error:
          error.denial === 'read_only'
            ? 'workItems.errors.readOnly'
            : 'workItems.errors.forbidden',
      };
    }
    throw error;
  }
}

/**
 * §7.2: inline `+` at the bottom of a group → type a title → Enter. Created in
 * that group, with defaults, and the input stays focused for the next one.
 *
 * The state comes from the group the person typed into, which is §5's "state
 * defaults to the column you created in" — not from a form field they had to
 * think about.
 */
export async function createWorkItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(async () => {
    const stateId = String(formData.get('stateId') ?? '').trim();

    return createWorkItem(resolved, {
      projectId: context.projectId,
      title: String(formData.get('title') ?? ''),
      stateId: stateId || undefined,
    });
  });

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { fields: { title: KEYS[outcome.problem] } };

  revalidateItem(context);
  return {};
}

export async function setWorkItemStateAction(input: {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  workItemId: string;
  stateId: string;
}): Promise<RowActionState> {
  const context: Context = {
    workspaceSlug: input.workspaceSlug,
    projectSlug: input.projectSlug,
    locale: localeOf(input.locale),
  };
  const resolved = await actorFor(input.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemState(resolved, { workItemId: input.workItemId, stateId: input.stateId }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context);
  return { done: true };
}

export async function updateWorkItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const optionalText = (name: string): string | null | undefined => {
    if (!formData.has(name)) return undefined;
    const value = String(formData.get(name) ?? '').trim();
    return value === '' ? null : value;
  };

  const estimateRaw = optionalText('estimate');
  const estimate =
    estimateRaw === undefined
      ? undefined
      : estimateRaw === null
        ? null
        : Number.isFinite(Number(estimateRaw))
          ? Math.max(0, Math.trunc(Number(estimateRaw)))
          : null;

  const outcome = await guarded(() =>
    updateWorkItem(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      title: formData.has('title') ? String(formData.get('title') ?? '') : undefined,
      description: optionalText('description'),
      priority: formData.has('priority') ? String(formData.get('priority') ?? '') : undefined,
      startDate: optionalText('startDate'),
      dueDate: optionalText('dueDate'),
      estimate,
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) {
    const key = KEYS[outcome.problem];
    return outcome.problem === 'title_required' ? { fields: { title: key } } : { error: key };
  }

  revalidateItem(context, Number(formData.get('number')));
  return {};
}

export async function setAssigneesAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemAssignees(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      // §4: assignment is multiple, so the form posts a set and the service
      // takes a set — never an add followed by a remove, which would leave a
      // window where the item is assigned to nobody.
      memberIds: formData.getAll('memberId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

export async function setLabelsAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemLabels(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      labelIds: formData.getAll('labelId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

/** §7.3: one click, and it notifies the project lead once slice 9 has an inbox. */
export async function setBlockedAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const blocked = formData.get('blocked') === '1';

  const outcome = await guarded(() =>
    setWorkItemBlocked(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      blocked,
      reason: String(formData.get('reason') ?? ''),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

export async function deleteWorkItemAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    deleteWorkItem(resolved, String(formData.get('workItemId') ?? '')),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context);
  // Back to the list: the page the person was on no longer describes anything.
  redirect({
    href: `/${context.workspaceSlug}/projects/${context.projectSlug}`,
    locale: context.locale,
  });
}
