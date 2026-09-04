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
import {
  changeMemberRole,
  removeMember,
  setAvailability,
  type AvailabilityChangeProblem,
} from '@/server/services/members';
import { setWorkItemAssignees } from '@/server/services/work-items';

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

  // §7.12's required choice, as it arrives from the dialog. The empty string is
  // "leave unassigned" — an explicit branch of the radio group rather than a
  // missing field, which is why it maps to `null` here and never to a default:
  // §4 says removing a member *requires* choosing, and a form that could submit
  // without an answer would be the product choosing for them.
  const reassignRaw = String(formData.get('reassignTo') ?? '');
  const result = await removeMember(resolved, String(formData.get('memberId') ?? ''), {
    reassignTo: reassignRaw === '' ? null : reassignRaw,
  });

  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);
  // Their work moved, so every list that showed it is stale — including the two
  // cross-project surfaces slice 13 built, which are the screens a manager is
  // most likely to be looking at when they do this.
  revalidatePath(`/${locale}/${workspaceSlug}`);
  revalidatePath(`/${locale}/${workspaceSlug}/team`);

  if (result.ok) return { done: true };
  if (result.problem === 'last_owner') return { error: 'members.lastOwner' };
  if (result.problem === 'unknown_target') return { error: 'members.unknownTarget' };
  return { error: 'auth.errors.unknown' };
}

/**
 * §4's availability flag (§7.4, §17-25).
 *
 * One action for setting and for clearing, because they are the same act
 * pointed two ways — an empty date field is "I'm back". A second
 * `clearAvailabilityAction` would be a second place to forget the event, the
 * audit row and the revalidation.
 *
 * `memberId` arrives in the payload and is a **request, never an
 * authorization**: the service decides whether this actor may set that member's
 * flag (their own always; anybody else's with `workspace.manage_members`), and a
 * crafted payload buys exactly what the session already permits.
 */
export async function setAvailabilityAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const workspaceSlug = String(formData.get('workspaceSlug') ?? '');
  const locale = formData.get('locale') === 'km' ? 'km' : 'en';
  const until = String(formData.get('until') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  const resolved = await actorFor(workspaceSlug);
  const result = await setAvailability(resolved, String(formData.get('memberId') ?? ''), {
    until: until === '' ? null : until,
    reason: reason === '' ? null : reason,
  });

  if (!result.ok) return { error: AVAILABILITY_KEYS[result.problem] };

  // Three screens read the flag, and all three are wrong the moment it changes:
  // the member's own settings page, the member list, and §7.4's workload — which
  // is the one that matters, because its capacity arithmetic is the reason the
  // flag exists at all (§17-25).
  revalidatePath(`/${locale}/${workspaceSlug}/settings/availability`);
  revalidatePath(`/${locale}/${workspaceSlug}/settings/members`);
  revalidatePath(`/${locale}/${workspaceSlug}/team`);
  return { done: true };
}

/**
 * Every refusal as a message key, never a sentence (§13).
 *
 * An English string returned from a server action is the one place a Khmer
 * workspace silently degrades — `src/lib/form-state.ts` says so, and this is a
 * mapped record rather than a switch so a new problem cannot reach a screen
 * without a key.
 */
const AVAILABILITY_KEYS: Record<AvailabilityChangeProblem, string> = {
  not_found: 'availability.errors.notFound',
  forbidden: 'availability.errors.forbidden',
  past_date: 'availability.errors.pastDate',
  too_far: 'availability.errors.tooFar',
  reason_too_long: 'availability.errors.reasonTooLong',
  reason_without_date: 'availability.errors.reasonWithoutDate',
};

/**
 * §7.9's one contextual palette action: "assign to me".
 *
 * Here rather than beside the project's other work-item actions, because the
 * palette that calls it lives in the workspace **layout** and is on every screen
 * — importing a project-scoped module into the shell would put the whole of
 * `projects/[projectSlug]/actions.ts` in the graph of every page in the product.
 *
 * It **adds** rather than replaces. §4 makes assignment multiple, so "assign to
 * me" on an item two colleagues already own means three people, not one — the
 * palette is a shortcut to a thing the assignee control already does, and a
 * shortcut that quietly did something different would be worse than no shortcut.
 * The current assignees ride in from the screen for the same reason
 * `setAssigneesAction` posts a set: an add-then-remove pair would leave a window
 * where the item belongs to nobody.
 *
 * Idempotent, so pressing it twice is not an error worth a sentence — the set
 * already contains you and the service writes the same set back.
 */
export async function assignToMeAction(input: {
  workspaceSlug: string;
  workItemId: string;
  projectSlug: string;
  number: number;
  assigneeIds: string[];
  locale: 'en' | 'km';
}): Promise<{ error?: string }> {
  const resolved = await actorFor(input.workspaceSlug);

  const memberIds = [...new Set([...input.assigneeIds, resolved.memberId])];

  try {
    const outcome = await setWorkItemAssignees(resolved, {
      workItemId: input.workItemId,
      memberIds,
    });
    if (!outcome.ok) return { error: 'workItems.errors.unknownMember' };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        error:
          error.denial === 'read_only'
            ? 'workItems.errors.readOnly'
            : 'workItems.errors.forbidden',
      };
    }
    throw error;
  }

  revalidatePath(`/${input.locale}/${input.workspaceSlug}/projects/${input.projectSlug}`);
  revalidatePath(
    `/${input.locale}/${input.workspaceSlug}/projects/${input.projectSlug}/${input.number}`,
  );
  // Slice 13's cross-project surfaces read the same rows, and an item that just
  // became yours is exactly the thing My Work exists to show.
  revalidatePath(`/${input.locale}/${input.workspaceSlug}`);
  revalidatePath(`/${input.locale}/${input.workspaceSlug}/team`);

  return {};
}
