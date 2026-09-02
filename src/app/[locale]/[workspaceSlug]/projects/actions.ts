'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError } from '@/server/authz/policy';
import { resolveActorContext } from '@/server/auth/context';
import type { FormState, RowActionState } from '@/lib/form-state';
import { PROJECT_ROLES, type ProjectRole } from '@/server/authz/roles';
import { STATE_COLORS, STATE_GROUPS, type StateColor, type StateGroup } from '@/lib/state-groups';
import type { ProjectProblem } from '@/server/services/project-access';
import {
  addProjectMember,
  changeProjectMemberRole,
  createProject,
  removeProjectMember,
  setProjectArchived,
} from '@/server/services/projects';
import {
  addWorkflowState,
  deleteWorkflowState,
  listWorkflowStates,
  reorderWorkflowStates,
  updateWorkflowState,
  type WorkflowStateProblem,
} from '@/server/services/workflow-states';
import { redirect } from '@/i18n/navigation';

/**
 * The project-scoped server actions.
 *
 * Each one re-resolves the actor from the session rather than trusting anything
 * in the form. A server action is a public endpoint — that only our own form
 * posts to it is a property of our UI, not of the network — so `workspaceSlug`
 * and `projectId` arriving in the payload are a request, never an
 * authorization. §10 is checked inside the service, on every one of these.
 */

/** Problem identifiers to message keys. Sentences are translated (§13). */
const PROJECT_KEYS: Record<ProjectProblem, string> = {
  name_required: 'projects.errors.nameRequired',
  slug_taken: 'projects.errors.slugTaken',
  key_taken: 'projects.errors.keyTaken',
  invalid_slug: 'projects.errors.invalidSlug',
  invalid_key: 'projects.errors.invalidKey',
  no_team: 'projects.errors.noTeam',
  not_found: 'projects.errors.notFound',
  archived: 'projects.errors.archived',
};

const STATE_KEYS: Record<WorkflowStateProblem, string> = {
  ...PROJECT_KEYS,
  name_required: 'states.errors.nameRequired',
  name_taken: 'states.errors.nameTaken',
  last_state: 'states.errors.lastState',
  unknown_state: 'states.errors.unknownState',
};

/** Which field a project problem belongs on, so §11's error lands where the fix is. */
const PROJECT_FIELDS: Partial<Record<ProjectProblem, string>> = {
  name_required: 'name',
  slug_taken: 'slug',
  invalid_slug: 'slug',
  key_taken: 'key',
  invalid_key: 'key',
};

type Context = {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  locale: 'en' | 'km';
};

function contextFrom(formData: FormData): Context {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    projectSlug: String(formData.get('projectSlug') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    locale: formData.get('locale') === 'km' ? 'km' : 'en',
  };
}

/**
 * Resolves the actor for a workspace, or throws.
 *
 * Null covers "no such workspace" and "not a member" alike — the caller cannot
 * tell them apart, and neither can somebody probing for company slugs.
 */
async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

function groupOf(value: FormDataEntryValue | null): StateGroup {
  const group = String(value ?? 'unstarted');
  return (STATE_GROUPS as readonly string[]).includes(group)
    ? (group as StateGroup)
    : 'unstarted';
}

function projectRoleOf(value: FormDataEntryValue | null): ProjectRole {
  const role = String(value ?? 'member');
  return (PROJECT_ROLES as readonly string[]).includes(role) ? (role as ProjectRole) : 'member';
}

function colorOf(value: FormDataEntryValue | null): StateColor | undefined {
  const color = String(value ?? '');
  return (STATE_COLORS as readonly string[]).includes(color) ? (color as StateColor) : undefined;
}

export async function createProjectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { workspaceSlug, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  let result;
  try {
    result = await createProject(resolved, {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? '').trim() || undefined,
      key: String(formData.get('key') ?? '').trim() || undefined,
      teamId: String(formData.get('teamId') ?? '').trim() || undefined,
      visibility: formData.get('visibility') === 'private' ? 'private' : 'workspace',
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  if (!result.ok) {
    const key = PROJECT_KEYS[result.problem];
    const field = PROJECT_FIELDS[result.problem];
    return field ? { fields: { [field]: key } } : { error: key };
  }

  revalidatePath(`/${locale}/${workspaceSlug}/projects`);

  // §7.1 lands the person on the board, with the six default states already
  // drawn. Not on a settings screen, and not back on the list they came from.
  redirect({ href: `/${workspaceSlug}/projects/${result.slug}`, locale });
}

export async function addStateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await addWorkflowState(resolved, {
      projectId,
      name: String(formData.get('name') ?? ''),
      group: groupOf(formData.get('group')),
      color: colorOf(formData.get('color')),
    });

    if (!result.ok) return { error: STATE_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return {};
}

export async function updateStateAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await updateWorkflowState(resolved, {
      projectId,
      stateId: String(formData.get('stateId') ?? ''),
      name: String(formData.get('name') ?? ''),
      group: groupOf(formData.get('group')),
      color: colorOf(formData.get('color')),
    });

    if (!result.ok) return { error: STATE_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}

export async function deleteStateAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await deleteWorkflowState(resolved, {
      projectId,
      stateId: String(formData.get('stateId') ?? ''),
      migrateToStateId: String(formData.get('migrateToStateId') ?? '').trim() || undefined,
    });

    if (!result.ok) return { error: STATE_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}

/**
 * One step earlier or later in the order.
 *
 * The buttons name a direction, but what goes to the service is the complete
 * new order — the same payload a drag would send, computed against the list as
 * it is right now. So two Leads pressing "move earlier" at the same moment
 * produce two orders, not an index arithmetic race.
 */
export async function moveStateAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const stateId = String(formData.get('stateId') ?? '');
  const delta = formData.get('direction') === 'up' ? -1 : 1;

  const resolved = await actorFor(workspaceSlug);

  try {
    const states = await listWorkflowStates(resolved.context, projectId);
    const order = states.map((s) => s.id);
    const from = order.indexOf(stateId);
    const to = from + delta;

    if (from === -1) return { error: 'states.errors.unknownState' };
    // Already at the end it was asked to move towards. The buttons are disabled
    // there, so this is a stale form rather than a mistake worth a message.
    if (to < 0 || to >= order.length) return { done: true };

    const reordered = [...order];
    const [moved] = reordered.splice(from, 1);
    if (moved) reordered.splice(to, 0, moved);

    const result = await reorderWorkflowStates(resolved, { projectId, order: reordered });
    if (!result.ok) return { error: STATE_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}

export async function archiveProjectAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const archived = formData.get('archived') === 'true';

  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await setProjectArchived(resolved, projectId, archived);
    if (!result.ok) return { error: PROJECT_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  revalidatePath(`/${locale}/${workspaceSlug}/projects`);
  return { done: true };
}

/** The board and its settings screen both change whenever a state does. */
function revalidateProject(locale: string, workspaceSlug: string, projectSlug: string): void {
  revalidatePath(`/${locale}/${workspaceSlug}/projects/${projectSlug}`);
  revalidatePath(`/${locale}/${workspaceSlug}/projects/${projectSlug}/settings`);
}

/**
 * Project membership (§10) — the three actions a private project needs to be
 * usable at all.
 *
 * Explicit membership is the only way a Guest reaches a project, and the only
 * way anyone reaches a private one, so all three are audited (see the event
 * registry) unlike team composition, which is not.
 */
export async function addProjectMemberAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await addProjectMember(resolved, {
      projectId,
      memberId: String(formData.get('memberId') ?? ''),
      role: projectRoleOf(formData.get('role')),
    });

    if (!result.ok) return { error: PROJECT_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}

export async function changeProjectRoleAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await changeProjectMemberRole(resolved, {
      projectId,
      memberId: String(formData.get('memberId') ?? ''),
      role: projectRoleOf(formData.get('role')),
    });

    if (!result.ok) return { error: PROJECT_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}

export async function removeProjectMemberAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const { workspaceSlug, projectSlug, projectId, locale } = contextFrom(formData);
  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await removeProjectMember(resolved, {
      projectId,
      memberId: String(formData.get('memberId') ?? ''),
    });

    if (!result.ok) return { error: PROJECT_KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'projects.errors.forbidden' };
    throw error;
  }

  revalidateProject(locale, workspaceSlug, projectSlug);
  return { done: true };
}
