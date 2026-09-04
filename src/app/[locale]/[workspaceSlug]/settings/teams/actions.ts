'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  removeTeamMember,
  renameTeam,
} from '@/server/services/teams';
import type { RowActionState } from '@/lib/form-state';

/**
 * §6-5's five mutations.
 *
 * All of them are `workspace.settings` inside the service — §10's row reads
 * "Workspace settings, branding, teams" and covers the lot, so **no §10 row was
 * invented, the eleventh time that decision has gone the same way**.
 *
 * Every one revalidates the workspace layout rather than this page: a team's
 * name appears on the project list and in §7.4's team scope, and a membership
 * change moves who a project is visible to.
 */

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

async function run(
  formData: FormData,
  work: (resolved: Awaited<ReturnType<typeof actorFor>>) => Promise<{
    ok: boolean;
    problem?: string;
  }>,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  try {
    const result = await work(await actorFor(workspaceSlug));
    if (!result.ok) return { error: `settings.teams.errors.${result.problem}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'settings.errors.forbidden' };
    throw error;
  }

  revalidatePath(`/${locale}/${workspaceSlug}`, 'layout');
  return { done: true };
}

export async function createTeamAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return run(formData, (resolved) =>
    createTeam(resolved, { name: String(formData.get('name') ?? '') }),
  );
}

export async function renameTeamAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return run(formData, (resolved) =>
    renameTeam(
      resolved,
      String(formData.get('teamId') ?? ''),
      String(formData.get('name') ?? ''),
    ),
  );
}

export async function deleteTeamAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return run(formData, (resolved) => deleteTeam(resolved, String(formData.get('teamId') ?? '')));
}

export async function addTeamMemberAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return run(formData, (resolved) =>
    addTeamMember(
      resolved,
      String(formData.get('teamId') ?? ''),
      String(formData.get('memberId') ?? ''),
    ),
  );
}

export async function removeTeamMemberAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return run(formData, (resolved) =>
    removeTeamMember(
      resolved,
      String(formData.get('teamId') ?? ''),
      String(formData.get('memberId') ?? ''),
    ),
  );
}
