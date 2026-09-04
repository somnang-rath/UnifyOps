import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import type { ResolvedActor } from '@/server/auth/context';
import { clearViewAs, setViewAs } from '@/server/auth/view-as';
import { assertCan } from '@/server/authz/policy';
import { workspaceMember } from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';

/**
 * Starting and ending §7.13's view-as.
 *
 * The mode itself is `resolveActorContext` plus one cookie; this is the pair of
 * deliberate acts at its edges, and the reason they are a service rather than
 * two lines in an action is the log. §7.13: "Starting a session is logged
 * against the viewer: this is a permission an owner holds openly, not a back
 * door." §18-11 built `audit_record.on_behalf_of_user_id` for exactly this, and
 * an unlogged view-as would make that column decoration.
 *
 * **Both halves run as the viewer, never from inside the session.** `uow.emit`
 * refuses while `readOnly` is set — correctly, because a view-as session must
 * produce no events of its own — so `stopViewAs` builds the viewer's own
 * context rather than using the one the request resolved. That is not a
 * workaround: the person who ended the session is the viewer, and a log saying
 * the *target* ended it would be false.
 */

export type ViewAsProblem = 'not_found' | 'self' | 'already_viewing';

export type ViewAsResult = { ok: true } | { ok: false; problem: ViewAsProblem };

/**
 * The viewer's real context, whether or not a session is currently active.
 *
 * `resolved.context` is the *acting* context, which during a session is the
 * target's and is read-only. Everything in this file has to write as the viewer,
 * so it rebuilds the one thing it can always trust: `actorUserId`, which stays
 * the viewer in both modes by construction.
 */
function viewerContext(resolved: ResolvedActor): ActorContext {
  return {
    workspaceId: resolved.workspace.id,
    userId: resolved.context.actorUserId,
    actorUserId: resolved.context.actorUserId,
    readOnly: false,
  };
}

/**
 * Begin viewing as a member (§7.13).
 *
 * Owner and Admin only, which `workspace.view_as_member` already says (§10).
 * The permission is asked of the **viewer's** actor, not the resolved one — a
 * session already in progress resolves to the target, who may be a Member, and
 * asking them would refuse a switch the owner is entitled to make. It is also
 * why nesting is refused outright rather than allowed to switch targets: "view
 * as Sophea, from inside viewing as Dara" has no meaning §7.13 defines, and the
 * bar has one Exit rather than a stack.
 */
export async function startViewAs(
  resolved: ResolvedActor,
  memberId: string,
): Promise<ViewAsResult> {
  if (resolved.viewAs) return { ok: false, problem: 'already_viewing' };

  assertCan(resolved.actor, 'workspace.view_as_member');

  // Viewing as yourself is the screen you are already on. Refused rather than
  // silently ignored, so the button that offered it can be fixed.
  if (memberId === resolved.memberId) return { ok: false, problem: 'self' };

  const context = viewerContext(resolved);

  const outcome = await withActor(context, async (tx, uow) => {
    const rows = await tx
      .select({ userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
      .limit(1);

    const target = rows[0];
    // Null covers "no such member" and "another workspace's" alike — RLS has
    // already made the second indistinguishable from the first.
    if (!target) return { ok: false, problem: 'not_found' } as const;

    uow.emit({
      type: 'workspace.view_as_started',
      workspaceId: resolved.workspace.id,
      targetMemberId: memberId,
      targetUserId: target.userId,
    });

    return { ok: true } as const;
  });

  if (!outcome.ok) return outcome;

  // The cookie goes last, so a refused or failed start leaves no session behind.
  await setViewAs({ workspaceId: resolved.workspace.id, memberId });

  return { ok: true };
}

/**
 * Exit (§7.13).
 *
 * **The cookie is cleared whatever else happens**, including when the target has
 * since been removed — that is §7.13's "the member is removed mid-session →
 * view-as ends with an explanation, not a 404", and a session nobody can leave
 * because the person they were viewing has gone would be the worst reading of
 * it. No permission check either: leaving is always allowed, and a viewer whose
 * Admin was revoked mid-session is exactly the person who most needs the button
 * to work.
 */
export async function stopViewAs(resolved: ResolvedActor): Promise<{ ok: true }> {
  const target = resolved.viewAs;

  await clearViewAs();

  if (target) {
    await withActor(viewerContext(resolved), async (_tx, uow) => {
      uow.emit({
        type: 'workspace.view_as_ended',
        workspaceId: resolved.workspace.id,
        targetMemberId: target.memberId,
        targetUserId: target.userId,
      });
    });
  }

  return { ok: true };
}
