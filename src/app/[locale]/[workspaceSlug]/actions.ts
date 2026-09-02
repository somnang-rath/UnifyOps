'use server';

import { revalidatePath } from 'next/cache';
import { ForbiddenError } from '@/server/authz/policy';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@/server/authz/roles';
import { resolveActorContext } from '@/server/auth/context';
import type { InviteFormState, RowActionState } from '@/lib/form-state';
import {
  inviteMany,
  resendInvitation,
  revokeInvitation,
} from '@/server/services/invitations';
import { changeMemberRole, removeMember } from '@/server/services/members';

/**
 * The workspace-scoped server actions: inviting, and managing who is here.
 *
 * Each one re-resolves the actor from the session rather than trusting anything
 * in the form. A server action is a public endpoint — the fact that only our
 * own form posts to it is a property of our UI, not of the network — so
 * `workspaceSlug` arriving in the payload is a request, never an authorization.
 */

function roleOf(value: FormDataEntryValue | null): WorkspaceRole {
  const role = String(value ?? 'member');
  return (WORKSPACE_ROLES as readonly string[]).includes(role)
    ? (role as WorkspaceRole)
    : 'member';
}

/**
 * Resolves the actor for a workspace, or throws.
 *
 * Null covers "no such workspace" and "not a member" alike — the caller cannot
 * tell them apart, and neither can an attacker probing for company slugs.
 */
async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

export async function inviteAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';
  const raw = String(formData.get('emails') ?? '');

  if (!raw.trim()) return { error: 'invite.form.empty' };

  const resolved = await actorFor(workspaceSlug);

  try {
    const result = await inviteMany({
      resolved,
      raw,
      role: roleOf(formData.get('role')),
      teamIds: formData.getAll('teamIds').map(String),
      locale,
    });

    revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);

    return {
      counts: result.counts,
      failed: result.results.filter((r) => r.outcome === 'failed').map((r) => r.email),
      invalid: result.results.filter((r) => r.outcome === 'invalid').map((r) => r.email),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'auth.errors.unknown' };
    throw error;
  }
}

export async function resendInvitationAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';
  const invitationId = String(formData.get('invitationId') ?? '');

  const resolved = await actorFor(workspaceSlug);
  const result = await resendInvitation(resolved, invitationId, locale);

  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);

  if (!result) return { error: 'auth.errors.unknown' };
  return result.outcome === 'sent' ? { done: true } : { error: 'members.notDelivered' };
}

export async function revokeInvitationAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  const resolved = await actorFor(workspaceSlug);
  await revokeInvitation(resolved, String(formData.get('invitationId') ?? ''));

  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);
  return { done: true };
}

export async function changeRoleAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  const resolved = await actorFor(workspaceSlug);
  const result = await changeMemberRole(
    resolved,
    String(formData.get('memberId') ?? ''),
    roleOf(formData.get('role')),
  );

  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);

  if (result.ok) return { done: true };
  // §7.12: "removing the last Owner → blocked, with a clear reason." The same
  // rule catches demoting them, which is the same act with a smaller word.
  return { error: result.problem === 'last_owner' ? 'members.lastOwner' : 'auth.errors.unknown' };
}

export async function removeMemberAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';

  const resolved = await actorFor(workspaceSlug);
  const result = await removeMember(resolved, String(formData.get('memberId') ?? ''));

  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);

  if (result.ok) return { done: true };
  return { error: result.problem === 'last_owner' ? 'members.lastOwner' : 'auth.errors.unknown' };
}
