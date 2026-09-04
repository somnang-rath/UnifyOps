import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  validateAvailability,
  type Availability,
  type AvailabilityProblem,
} from '@/lib/availability';
import { todayIn } from '@/lib/workspace-date';
import type { ResolvedActor } from '@/server/auth/context';
import { endAllSessions } from '@/server/auth/session';
import { assertCan, can } from '@/server/authz/policy';
import type { WorkspaceRole } from '@/server/authz/roles';
import { user as userTable, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { reassignOpenWorkInTx } from './work-items';
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
} & Availability;

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
        // §4's availability flag rides the member list rather than a query of
        // its own. Workload (§7.4) needs it for every member it draws a column
        // for, and the settings screen needs it for every row — two columns on
        // a list the page was already fetching, against a second round trip on
        // the one screen a manager opens most.
        unavailableUntil: workspaceMember.unavailableUntil,
        unavailableReason: workspaceMember.unavailableReason,
      })
      .from(workspaceMember)
      .innerJoin(userTable, eq(userTable.id, workspaceMember.userId))
      .where(isNull(workspaceMember.deletedAt))
      .orderBy(userTable.name),
  );
}

export type MemberChangeProblem =
  | 'not_found'
  | 'last_owner'
  /** §7.12's dialog offered a person who is no longer a member. */
  | 'unknown_target'
  | 'reassign_to_self';

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
 * Offboarding (§7.12), and slice 15 is where its required choice arrives.
 *
 * A soft delete, not a row removal: "their comments and activity history are
 * preserved and attributed", which a cascading delete would destroy.
 *
 * **`reassignTo` is that choice and it is not optional.** §4: "Removing a
 * member requires choosing what happens to their open work." The caller passes
 * a member id or an explicit `null` — §7.12's other branch, "leave unassigned
 * and flag in Needs Attention", which needs no flag because §7.4's unassigned
 * row is already that surface. `undefined` is not a third answer; the type does
 * not offer one, because a default here is a screen that silently picked for
 * somebody.
 *
 * The reassignment runs **inside the same transaction as the removal**, so
 * there is no window in which somebody has been offboarded and still owns forty
 * items, and a failure leaves neither half applied. It happens before the
 * membership is soft-deleted only because reading their open work is easier
 * while they are still a member; nothing depends on the order beyond that.
 */
export async function removeMember(
  resolved: ResolvedActor,
  memberId: string,
  choice: { reassignTo: string | null },
): Promise<MemberChangeResult> {
  assertCan(resolved.actor, 'workspace.manage_members');

  // Reassigning to the person being removed is the same as leaving the work
  // where it is, which is the one answer §7.12 does not offer.
  if (choice.reassignTo === memberId) {
    return { ok: false, problem: 'reassign_to_self' };
  }

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

    if (choice.reassignTo !== null) {
      const target = await tx
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(
          and(eq(workspaceMember.id, choice.reassignTo), isNull(workspaceMember.deletedAt)),
        )
        .limit(1);

      // Checked rather than left to the foreign key, because the failure a
      // constraint gives is a 500 on the one screen that must not have one:
      // §7.12's dialog is the last thing between a company and somebody's work
      // going nowhere.
      if (target.length === 0) return { ok: false, problem: 'unknown_target' } as const;
    }

    const moved = await reassignOpenWorkInTx(tx, resolved.workspace.id, {
      fromMemberId: memberId,
      toMemberId: choice.reassignTo,
    });

    if (moved.length > 0) {
      uow.emit({
        type: 'workspace_member.work_reassigned',
        workspaceId: resolved.workspace.id,
        fromMemberId: memberId,
        toMemberId: choice.reassignTo,
        items: moved,
      });
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

/* ------------------------------------------------------------------------- */
/* Availability (§4, §7.4, §17-25)                                           */
/* ------------------------------------------------------------------------- */

export type AvailabilityChangeProblem = 'not_found' | 'forbidden' | AvailabilityProblem;

export type AvailabilityChangeResult =
  | { ok: true }
  | { ok: false; problem: AvailabilityChangeProblem };

/**
 * Mark a member unavailable until a date, or bring them back.
 *
 * **Two people may do this and only two: the member themselves, and somebody
 * who can manage members.** That rule is written here rather than as a new §10
 * row, and it is the seventh time this decision has gone the same way — after
 * labels (slice 5), attachments (slice 8), notifications (slice 9), custom
 * fields (slice 10), cycles (slice 11) and saved views (slice 12).
 *
 * The reason is the same each time: §10's matrix is a table a non-technical
 * owner is shown, and adding a row to it claims a permission that has to be
 * explained. Availability needs no explanation, because it is not really a
 * permission question — it is the same shape as the notification preferences
 * slice 9 built, which are your own, plus the member management §4 already puts
 * this next to ("member list, roles, **member availability flag**, view-as").
 * `workspace.manage_members` is the row that already says who may change
 * somebody else's membership, and this is a column on the membership row.
 *
 * Clearing is `until: null`, which is one path rather than a second function —
 * "I'm back early" is the same act as "I'm away until the 20th" pointed the
 * other way, and a separate `clearAvailability` would be a second place for the
 * event and the audit row to be forgotten.
 */
export async function setAvailability(
  resolved: ResolvedActor,
  memberId: string,
  input: { until: string | null; reason: string | null },
): Promise<AvailabilityChangeResult> {
  const isSelf = memberId === resolved.memberId;
  // Asked before the transaction opens, because a refusal should cost nothing.
  // `can` rather than `assertCan`: setting your own is always allowed and
  // throwing on the way to discovering that would be the wrong control flow.
  if (!isSelf && !can(resolved.actor, 'workspace.manage_members')) {
    return { ok: false, problem: 'forbidden' };
  }

  // Today in the **company's** zone (§17-13): "is this date in the past" is a
  // question about the workspace's calendar, and somebody setting leave from an
  // airport in another timezone must get the same answer as their manager.
  const today = todayIn(resolved.workspace.timezone);

  const checked = validateAvailability(input, today);
  if (!checked.ok) return { ok: false, problem: checked.problem };

  const until = input.until;
  const reason = until === null ? null : (input.reason?.trim() || null);

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ until: workspaceMember.unavailableUntil })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
      .limit(1);

    const current = rows[0];
    // Null covers "no such member" and "in another workspace" alike — RLS has
    // already made the second one indistinguishable from the first, which is
    // the point of it.
    if (!current) return { ok: false, problem: 'not_found' } as const;

    await tx
      .update(workspaceMember)
      .set({ unavailableUntil: until, unavailableReason: reason, updatedAt: new Date() })
      .where(eq(workspaceMember.id, memberId));

    // Emitted even when the date has not moved, because the reason may have.
    // The audit row carries the dates only (see the registry entry), so an edit
    // that only changed the wording reads as a no-op change against the same
    // date — which is honest, and cheaper than the alternative of teaching the
    // log a text it deliberately does not keep.
    uow.emit({
      type: 'workspace_member.availability_changed',
      workspaceId: resolved.workspace.id,
      memberId,
      from: current.until,
      to: until,
    });

    return { ok: true } as const;
  });
}
