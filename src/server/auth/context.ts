import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import type { Actor } from '@/server/authz/policy';
import { withIdentity } from '@/server/db/identity';
import { projectMember, workspace as workspaceTable, workspaceMember } from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';
import type { ProjectRole, WorkspaceRole } from '@/server/authz/roles';
import { readCurrentUser } from './session';
import type { CurrentUser } from './session';

/**
 * Resolving who is acting, once per request, into the two shapes the rest of
 * the server takes.
 *
 * They are deliberately separate objects: `ActorContext` is what the database
 * needs (§9 — the transaction-local tenancy variables), `Actor` is what the
 * policy module needs (§10 — the permission matrix). Same person, two
 * questions: *whose data is this* and *may they do this*. Collapsing them into
 * one type is how a codebase ends up answering the second question with the
 * first one's information.
 *
 * View-as (§7.13, slice 15) is the case that proves they are separate. It makes
 * `userId` the target member in both while `actorUserId` stays the viewer, and
 * sets `readOnly` on both. The seam is already here; the UI that drives it is
 * not.
 */

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
};

/**
 * Every workspace this user belongs to.
 *
 * The one query in the product that spans workspaces on purpose, which is why
 * it runs on the identity connection: no single tenant scope can answer it, and
 * the `identity_select_own` policy narrows it to this user's own membership rows
 * — so it cannot become a way to read who else is in them.
 */
export const listMyWorkspaces = cache(
  async (userId: string): Promise<WorkspaceSummary[]> =>
    withIdentity(
      async (tx) =>
        tx
          .select({
            id: workspaceTable.id,
            slug: workspaceTable.slug,
            name: workspaceTable.name,
            role: workspaceMember.role,
          })
          .from(workspaceMember)
          .innerJoin(workspaceTable, eq(workspaceTable.id, workspaceMember.workspaceId))
          .where(and(eq(workspaceMember.userId, userId), isNull(workspaceMember.deletedAt)))
          .orderBy(workspaceTable.name),
      { userId },
    ),
);

/**
 * This member's explicit project roles, keyed by project id (slice 4).
 *
 * On the app connection rather than the identity one, and that is not an
 * oversight: `project_member` is tenant data — it says what a company is doing
 * and who is doing it — and the handshake role is granted nothing on it by
 * name, so it cannot read it at all. By the time this runs the workspace is
 * known and `withActor` is the right tool.
 *
 * One extra query per request, deduplicated by `resolveActorContext` being
 * `cache`d, and it is what makes §10 answerable at all: without the map, every
 * project would resolve to whatever the workspace role implies and an explicit
 * Lead would be indistinguishable from a Member.
 */
async function loadProjectRoles(
  context: ActorContext,
  memberId: string,
): Promise<ReadonlyMap<string, ProjectRole>> {
  const rows = await withActor(context, async (tx) =>
    tx
      .select({ projectId: projectMember.projectId, role: projectMember.role })
      .from(projectMember)
      .where(
        and(eq(projectMember.workspaceMemberId, memberId), isNull(projectMember.deletedAt)),
      ),
  );

  return new Map(rows.map((row) => [row.projectId, row.role]));
}

export type ResolvedActor = {
  user: CurrentUser;
  workspace: WorkspaceSummary;
  memberId: string;
  /** For `withActor` — the database's question. */
  context: ActorContext;
  /** For `can` / `assertCan` — the policy module's question. */
  actor: Actor;
};

/**
 * The membership behind a workspace URL, or null.
 *
 * Null covers both "no such workspace" and "not a member of it", and the caller
 * turns both into the same 404. That is deliberate: distinguishing them tells
 * an outsider which company slugs exist, and §15 asks a pasted URL from another
 * workspace to 404 rather than to show an empty page.
 */
export const resolveActorContext = cache(
  async (workspaceSlug: string): Promise<ResolvedActor | null> => {
    const user = await readCurrentUser();
    if (!user) return null;

    const found = await withIdentity(
      async (tx) => {
        const rows = await tx
          .select({
            workspaceId: workspaceTable.id,
            slug: workspaceTable.slug,
            name: workspaceTable.name,
            memberId: workspaceMember.id,
            role: workspaceMember.role,
          })
          .from(workspaceMember)
          .innerJoin(workspaceTable, eq(workspaceTable.id, workspaceMember.workspaceId))
          .where(
            and(
              eq(workspaceMember.userId, user.id),
              eq(workspaceTable.slug, workspaceSlug),
              isNull(workspaceMember.deletedAt),
              isNull(workspaceTable.deletedAt),
            ),
          )
          .limit(1);

        return rows[0] ?? null;
      },
      { userId: user.id },
    );

    if (!found) return null;

    // Slice 15 flips these two from a view-as cookie. Until then a session is
    // always the person it says it is, and always able to write.
    const readOnly = false;
    const actingAsUserId = user.id;

    const context: ActorContext = {
      workspaceId: found.workspaceId,
      userId: actingAsUserId,
      actorUserId: user.id,
      readOnly,
    };

    return {
      user,
      workspace: {
        id: found.workspaceId,
        slug: found.slug,
        name: found.name,
        role: found.role,
      },
      memberId: found.memberId,
      context,
      actor: {
        workspaceId: found.workspaceId,
        userId: actingAsUserId,
        workspaceRole: found.role,
        // Explicit project memberships only. §10 composition derives the
        // implicit roles from this — Owner and Admin are Leads everywhere, a
        // workspace-visible project grants Members a Viewer, Guests get nothing
        // — and none of that is ever written into this map.
        projectRoles: await loadProjectRoles(context, found.memberId),
        readOnly,
      },
    };
  },
);
