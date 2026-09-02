import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { ResolvedActor } from '@/server/auth/context';
import { endAllSessions } from '@/server/auth/session';
import { assertCan } from '@/server/authz/policy';
import type { WorkspaceRole } from '@/server/authz/roles';
import { user as userTable, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import type { ActorContext } from '@/server/db/tenant';

/**
 * Workspace membership: who is here, what role they hold, and removing them.
 *
 * Every read here goes through `withActor`, unlike the identity-side lookups in
 * src/server/auth — the same `app_user` rows, reached the other way. That is the
 * distinction the two connections exist to make: signing in asks "is this
 * person who they say they are", and this asks "who is in this company", and
 * only the second one has a workspace to be scoped to.
 */

export type Member = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  imageUrl: string | null;
  role: WorkspaceRole;
  joinedAt: Date;
};

export async function listMembers(context: ActorContext): Promise<Member[]> {
  return withActor(context, async (tx) =>
    tx
      .select({
        memberId: workspaceMember.id,
        userId: workspaceMember.userId,
        name: userTable.name,
        email: userTable.email,
        imageUrl: userTable.imageUrl,
        role: workspaceMember.role,
        joinedAt: workspaceMember.createdAt,
      })
      .from(workspaceMember)
      .innerJoin(userTable, eq(userTable.id, workspaceMember.userId))
      .where(isNull(workspaceMember.deletedAt))
      .orderBy(userTable.name),
  );
}

export type MemberChangeProblem = 'not_found' | 'last_owner';

export type MemberChangeResult = { ok: true } | { ok: false; problem: MemberChangeProblem };

/**
 * How many owners this workspace would have left without `exceptMemberId`.
 *
 * Counted inside the caller's transaction, so the check and the write see the
 * same state. Doing it as a separate query first would let two admins demote
 * the last two owners at once and leave the workspace unadministrable — §7.12's
 * "removing the last Owner → blocked" has to hold under concurrency or it is
 * decoration.
 */
async function otherOwnerCount(
  tx: Parameters<Parameters<typeof withActor>[1]>[0],
  exceptMemberId: string,
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.role, 'owner'),
        ne(workspaceMember.id, exceptMemberId),
        isNull(workspaceMember.deletedAt),
      ),
    );

  return rows[0]?.count ?? 0;
}

export async function changeMemberRole(
  resolved: ResolvedActor,
  memberId: string,
  role: WorkspaceRole,
): Promise<MemberChangeResult> {
  assertCan(resolved.actor, 'workspace.manage_members');

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ role: workspaceMember.role, userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
      .limit(1);

    const current = rows[0];
    if (!current) return { ok: false, problem: 'not_found' } as const;
    if (current.role === role) return { ok: true } as const;

    if (current.role === 'owner' && (await otherOwnerCount(tx, memberId)) === 0) {
      return { ok: false, problem: 'last_owner' } as const;
    }

    await tx
      .update(workspaceMember)
      .set({ role, updatedAt: new Date() })
      .where(eq(workspaceMember.id, memberId));

    uow.emit({
      type: 'workspace_member.role_changed',
      workspaceId: resolved.workspace.id,
      memberId,
      from: current.role,
      to: role,
    });

    return { ok: true } as const;
  });
}

/**
 * Offboarding (§7.12).
 *
 * A soft delete, not a row removal: "their comments and activity history are
 * preserved and attributed", which a cascading delete would destroy.
 *
 * §7.12 also requires a *choice* about their open work — reassign, or leave
 * unassigned and flag in Needs Attention. Work items do not exist until slice 5,
 * so there is nothing to reassign yet and the choice has nowhere to be made.
 * When they do, it belongs here, before the update below.
 */
export async function removeMember(
  resolved: ResolvedActor,
  memberId: string,
): Promise<MemberChangeResult> {
  assertCan(resolved.actor, 'workspace.manage_members');

  const outcome = await withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ role: workspaceMember.role, userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
      .limit(1);

    const member = rows[0];
    if (!member) return { ok: false, problem: 'not_found' } as const;

    if (member.role === 'owner' && (await otherOwnerCount(tx, memberId)) === 0) {
      return { ok: false, problem: 'last_owner' } as const;
    }

    await tx
      .update(workspaceMember)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaceMember.id, memberId));

    uow.emit({
      type: 'workspace_member.removed',
      workspaceId: resolved.workspace.id,
      memberId,
      userId: member.userId,
    });

    return { ok: true, userId: member.userId } as const;
  });

  if (!outcome.ok) return outcome;

  // Removal has to take effect now, not whenever their cookie happens to
  // expire. This is what a database session buys — with a stateless token there
  // would be no sentence to write here at all.
  //
  // It ends every session the person has, including ones for workspaces they
  // are still a member of. That is a deliberate trade: signing back in is a
  // small cost, and the alternative is a per-workspace session model that
  // exists only to soften this one moment.
  await endAllSessions(outcome.userId);

  return { ok: true };
}
