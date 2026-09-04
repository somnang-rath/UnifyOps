import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { isUniqueViolation } from '@/server/db/errors';
import { team, teamMember, user as appUser, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import type { ActorContext } from '@/server/db/tenant';
import { deriveSlug, slugify, slugProblem } from '@/lib/slug';

/**
 * Teams (§10: "Workspace settings, branding, teams" — Owner and Admin).
 *
 * A team is not a permission boundary; it is who owns projects (§9). Membership
 * of one grants nothing on its own, which is why every function here checks
 * `workspace.settings` rather than inventing a team-level role.
 */

export type TeamSummary = {
  id: string;
  slug: string;
  name: string;
  /** Set while this is the team seeded with the workspace, so it renders translated (§13). */
  nameKey: string | null;
  memberCount: number;
};

export async function listTeams(context: ActorContext): Promise<TeamSummary[]> {
  return withActor(context, async (tx) =>
    tx
      .select({
        id: team.id,
        slug: team.slug,
        name: team.name,
        nameKey: team.nameKey,
        // A correlated count rather than a group-by join: the join would drop
        // teams with no members, and an empty team is exactly the one somebody
        // needs to find in order to fix it.
        memberCount: sql<number>`(
          select count(*)::int from team_member tm
          where tm.team_id = ${team.id} and tm.deleted_at is null
        )`,
      })
      .from(team)
      .where(isNull(team.deletedAt))
      .orderBy(team.name),
  );
}

export type TeamProblem = 'name_required' | 'slug_taken' | 'invalid_slug' | 'not_found';

export async function createTeam(
  resolved: ResolvedActor,
  input: { name: string; slug?: string },
): Promise<{ ok: true; teamId: string; slug: string } | { ok: false; problem: TeamProblem }> {
  assertCan(resolved.actor, 'workspace.settings');

  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };

  // A slug the user typed is validated as typed; one we derive is allowed to
  // fall back, because `deriveSlug` always returns something usable and a team
  // called "🚀" should not be a spelling test either.
  const requested = input.slug?.trim();
  const slug = requested ? slugify(requested) : deriveSlug(name);
  if (slugProblem(slug)) return { ok: false, problem: 'invalid_slug' };

  const teamId = uuidv7();

  try {
    await withActor(resolved.context, async (tx, uow) => {
      await tx.insert(team).values({ id: teamId, workspaceId: resolved.workspace.id, slug, name });
      uow.emit({
        type: 'team.created',
        workspaceId: resolved.workspace.id,
        teamId,
        slug,
        name,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'slug_taken' };
    throw error;
  }

  return { ok: true, teamId, slug };
}

export async function renameTeam(
  resolved: ResolvedActor,
  teamId: string,
  name: string,
): Promise<{ ok: true } | { ok: false; problem: TeamProblem }> {
  assertCan(resolved.actor, 'workspace.settings');

  const next = name.trim().normalize('NFC');
  if (!next) return { ok: false, problem: 'name_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ name: team.name })
      .from(team)
      .where(and(eq(team.id, teamId), isNull(team.deletedAt)))
      .limit(1);

    const current = rows[0];
    if (!current) return { ok: false, problem: 'not_found' } as const;
    if (current.name === next) return { ok: true } as const;

    // The slug is deliberately not re-derived. It is in every link that has
    // already been shared, and a rename is a display change — §9's rule that
    // human identifiers are never reused applies to the same instinct.
    await tx.update(team).set({ name: next, updatedAt: new Date() }).where(eq(team.id, teamId));

    uow.emit({
      type: 'team.renamed',
      workspaceId: resolved.workspace.id,
      teamId,
      from: current.name,
      to: next,
    });

    return { ok: true } as const;
  });
}

/** Soft delete, so projects that referenced the team keep their history (§9). */
export async function deleteTeam(
  resolved: ResolvedActor,
  teamId: string,
): Promise<{ ok: true } | { ok: false; problem: TeamProblem }> {
  assertCan(resolved.actor, 'workspace.settings');

  return withActor(resolved.context, async (tx, uow) => {
    const deleted = await tx
      .update(team)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(team.id, teamId), isNull(team.deletedAt)))
      .returning({ name: team.name });

    const row = deleted[0];
    if (!row) return { ok: false, problem: 'not_found' } as const;

    uow.emit({
      type: 'team.deleted',
      workspaceId: resolved.workspace.id,
      teamId,
      name: row.name,
    });

    return { ok: true } as const;
  });
}

export async function addTeamMember(
  resolved: ResolvedActor,
  teamId: string,
  memberId: string,
): Promise<{ ok: true } | { ok: false; problem: TeamProblem }> {
  assertCan(resolved.actor, 'workspace.settings');

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const exists = await tx
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.id, memberId), isNull(workspaceMember.deletedAt)))
        .limit(1);

      if (exists.length === 0) return { ok: false, problem: 'not_found' } as const;

      await tx.insert(teamMember).values({
        workspaceId: resolved.workspace.id,
        teamId,
        workspaceMemberId: memberId,
      });

      uow.emit({ type: 'team.member_added', workspaceId: resolved.workspace.id, teamId, memberId });

      return { ok: true } as const;
    });
  } catch (error) {
    // Already on the team. Idempotent rather than an error: the caller asked
    // for a state, and the state is what they asked for.
    if (isUniqueViolation(error)) return { ok: true };
    throw error;
  }
}

export async function removeTeamMember(
  resolved: ResolvedActor,
  teamId: string,
  memberId: string,
): Promise<{ ok: true }> {
  assertCan(resolved.actor, 'workspace.settings');

  await withActor(resolved.context, async (tx, uow) => {
    const deleted = await tx
      .delete(teamMember)
      .where(
        and(eq(teamMember.teamId, teamId), eq(teamMember.workspaceMemberId, memberId)),
      )
      .returning({ id: teamMember.id });

    if (deleted.length > 0) {
      uow.emit({
        type: 'team.member_removed',
        workspaceId: resolved.workspace.id,
        teamId,
        memberId,
      });
    }
  });

  return { ok: true };
}

/**
 * Every team membership in the workspace, with the person's name.
 *
 * **One query for the whole screen, not one per team.** §6-5's settings page
 * draws a team and its people, and asking per team is the trap slice 8 hit with
 * `getCommentThread`, slice 9 with the unread count, slice 10 with custom
 * fields, slice 13 with §7.4's six lists and slice 14 with the palette's
 * project scope — the sixth time, and the answer is theirs: ask once, group in
 * TypeScript.
 *
 * A workspace has a handful of teams and tens of members, so this is tens of
 * rows. If it ever became hundreds the page would need paging, which is a
 * different screen rather than a different query.
 */
export type TeamMembership = {
  teamId: string;
  memberId: string;
  name: string;
};

export async function listTeamMembers(context: ActorContext): Promise<TeamMembership[]> {
  return withActor(context, async (tx) =>
    tx
      .select({
        teamId: teamMember.teamId,
        memberId: teamMember.workspaceMemberId,
        name: appUser.name,
      })
      .from(teamMember)
      .innerJoin(workspaceMember, eq(workspaceMember.id, teamMember.workspaceMemberId))
      .innerJoin(appUser, eq(appUser.id, workspaceMember.userId))
      .where(and(isNull(teamMember.deletedAt), isNull(workspaceMember.deletedAt)))
      .orderBy(appUser.name),
  );
}
