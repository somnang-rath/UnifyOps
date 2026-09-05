import 'server-only';

import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can, effectiveProjectRole } from '@/server/authz/policy';
import type { ProjectRole } from '@/server/authz/roles';
import type { TenantDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { project, projectMember, team, user, workspaceMember } from '@/server/db/schema';
import { inSequence } from '@/server/db/sequence';
import { withActor, type ActorContext } from '@/server/db/tenant';
import { deriveProjectKey, normalizeProjectKey, projectKeyProblem } from '@/lib/project-key';
import { deriveSlug, slugify, slugProblem } from '@/lib/slug';
import { fetchCustomFields, type CustomFieldDefinition } from '@/server/queries/custom-fields';
import { fetchOpenCycles } from '@/server/queries/cycles';
import { fetchSavedViews, type SavedViewRow } from '@/server/queries/saved-views';
import { todayIn } from '@/lib/workspace-date';
import {
  isArchived,
  loadProject,
  projectResource,
  type ProjectProblem,
  type ProjectRow,
} from './project-access';
import {
  readWorkflowStates,
  seedDefaultStates,
  type WorkflowStateRow,
} from './workflow-states';
import { DEFAULT_TEAM } from './workspaces';
import { ensureProjectSpace } from './wiki';

/**
 * Projects (§14, slice 4) — the unit work items live in.
 *
 * Two boundaries meet here and they are not the same one. RLS answers *whose
 * data is this*: nothing below can see another workspace's project no matter
 * how the query is written. The policy module answers *may this person see this
 * one*, which is a question about visibility and project membership inside a
 * workspace this person is already in (§10).
 *
 * The list query below expresses the second boundary in SQL, because fetching
 * every project in a 200-project workspace to filter five of them in TypeScript
 * is how a list view stops being usable. So the same rule exists in two forms —
 * and to keep them from drifting, every row the SQL returns is checked again
 * through `can(actor, 'project.view')` before it is handed back. The SQL is an
 * optimisation of the policy module, never a second opinion.
 */

export type ProjectSummary = {
  id: string;
  slug: string;
  key: string;
  name: string;
  visibility: 'workspace' | 'private';
  archivedAt: Date | null;
  teamId: string;
  teamName: string;
  teamNameKey: string | null;
  /** What this actor may do here, composed by §10 — never read from a row. */
  role: ProjectRole | null;
};

export type ProjectDetail = ProjectSummary & {
  description: string | null;
  states: WorkflowStateRow[];
  /** §6-4's definitions, in display order — what the filter bar and group-by draw from. */
  customFields: CustomFieldDefinition[];
  /**
   * §7.6's cycles that work can still be planned into, earliest first.
   *
   * Open ones only, and that is what makes this cheap enough to load on every
   * project render: a project accumulates a cycle a fortnight, and this is
   * always the two or three a team is actually working in. The cycles *page*
   * loads the full history, because that is the page that shows it.
   */
  cycles: { id: string; name: string }[];
  /**
   * The acting member's own saved views for this project (§4, slice 12).
   *
   * Loaded here rather than by a service of its own, which is the same call
   * slice 10 made for custom fields and slice 11 for cycles: a second
   * `withActor` on every project render is the trap slice 8 hit with
   * `getCommentThread` and slice 9 with the unread count. It is one index scan
   * on `(owner_member_id, project_id)` returning a handful of rows — a person
   * keeps a few bookmarks, not a table of them, and `MAX_VIEWS_PER_MEMBER`
   * bounds even the pathological case.
   *
   * Personal by construction: the predicate carries the acting member's id, so
   * this is never anybody else's list. §4 puts sharing in the should-haves.
   */
  savedViews: SavedViewRow[];
  canEditSettings: boolean;
};

export type CreateProjectInput = {
  name: string;
  /** Optional; derived from the name when absent (§7.1). */
  slug?: string;
  /** Optional; derived from the name when absent — the `ENG` of `ENG-142`. */
  key?: string;
  teamId?: string;
  visibility?: 'workspace' | 'private';
};

/**
 * A success, carrying whatever the caller needs back — usually nothing, and
 * then it is exactly `{ ok: true }`. Paired with `Failed` so every mutation in
 * this module answers with a discriminated union rather than a thrown string:
 * a refusal a screen has to render is a value, not an exception.
 */
type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: ProjectProblem };

/**
 * The visibility half of §10, as a SQL predicate.
 *
 * Owner and Admin are implicit Leads everywhere, so nothing is filtered for
 * them. A Member sees workspace-visible projects plus any they were added to. A
 * Guest sees only what they were explicitly added to — that single line is what
 * makes Guest safe to hand a contractor, so it is expressed here as the absence
 * of any implicit branch rather than as a narrower one.
 */
function visibleTo(resolved: ResolvedActor) {
  const explicit = sql`exists (
    select 1 from project_member pm
    where pm.project_id = ${project.id}
      and pm.workspace_member_id = ${resolved.memberId}
      and pm.deleted_at is null
  )`;

  switch (resolved.workspace.role) {
    case 'owner':
    case 'admin':
      return undefined;
    case 'member':
      return or(eq(project.visibility, 'workspace'), explicit);
    case 'guest':
      return explicit;
  }
}

export async function listProjects(
  resolved: ResolvedActor,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectSummary[]> {
  return withActor(resolved.context, async (tx) => listProjectsIn(tx, resolved, options));
}

/**
 * The same list, inside a transaction the caller already opened.
 *
 * Split out in slice 14 for §7.9's palette, which runs on a keystroke and asks
 * four questions at once: resolving the visible projects in its own `withActor`
 * would have put a second round trip in front of every character typed. This is
 * the trap slice 8 hit with `getCommentThread` and slice 13 with §7.4's six
 * lists, and the answer is theirs — ask inside the transaction that is open.
 *
 * `listProjects` above is now a one-line wrapper, so there is still exactly one
 * implementation of §10's visibility and the two cannot drift.
 */
export async function listProjectsIn(
  tx: TenantDb,
  resolved: ResolvedActor,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectSummary[]> {
  const rows = await (
    tx
      .select({
        id: project.id,
        slug: project.slug,
        key: project.key,
        name: project.name,
        visibility: project.visibility,
        archivedAt: project.archivedAt,
        teamId: project.teamId,
        teamName: team.name,
        teamNameKey: team.nameKey,
      })
      .from(project)
      .innerJoin(team, eq(team.id, project.teamId))
      .where(
        and(
          isNull(project.deletedAt),
          // §9: archived is a default filter in the query builder, not a view
          // that hides rows — four screens have to be able to see them.
          options.includeArchived ? undefined : isNull(project.archivedAt),
          visibleTo(resolved),
        ),
      )
      .orderBy(asc(project.name))
  );

  return rows
    .map((row) => ({
      ...row,
      role: effectiveProjectRole(resolved.actor, {
        id: row.id,
        workspaceId: resolved.workspace.id,
        visibility: row.visibility,
      }),
    }))
    // The second pass described at the top of this file. If it ever removes a
    // row, the predicate above and the policy module disagree — and the policy
    // module is the one that is right.
    .filter((row) =>
      can(resolved.actor, 'project.view', {
        id: row.id,
        workspaceId: resolved.workspace.id,
        visibility: row.visibility,
      }),
    );
}

/**
 * One project by its slug, or null.
 *
 * Null covers "no such project" and "not visible to you" alike, and the caller
 * turns both into a 404 — the same rule the workspace layout applies one level
 * up, for the same reason: distinguishing them tells someone what exists.
 */
export async function getProjectBySlug(
  resolved: ResolvedActor,
  slug: string,
): Promise<ProjectDetail | null> {
  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({
        id: project.id,
        slug: project.slug,
        key: project.key,
        name: project.name,
        description: project.description,
        visibility: project.visibility,
        archivedAt: project.archivedAt,
        teamId: project.teamId,
        teamName: team.name,
        teamNameKey: team.nameKey,
      })
      .from(project)
      .innerJoin(team, eq(team.id, project.teamId))
      .where(and(eq(project.slug, slug), isNull(project.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const resource = {
      id: row.id,
      workspaceId: resolved.workspace.id,
      visibility: row.visibility,
    };
    if (!can(resolved.actor, 'project.view', resource)) return null;

    // Read inside the same transaction the project was read in, so a board
    // cannot render one request's project against another's columns — and, from
    // slice 10, the same for its custom fields: the filter bar draws a control
    // per field and the group-by list offers one entry per groupable field, so
    // a screen holding one request's fields against another's rows would offer
    // a filter for something that is not there.
    const [states, customFields, cycles, savedViews] = await inSequence(
      () => readWorkflowStates(tx, row.id),
      () => fetchCustomFields(tx, row.id),
      // Slice 11, on the same argument: the filter bar draws a control per open
      // cycle and the item panel offers one, so a screen holding one request's
      // cycles against another's rows would offer to plan work into a sprint
      // that has since closed.
      () => fetchOpenCycles(tx, row.id, todayIn(resolved.workspace.timezone)),
      // Slice 12, in the same transaction and for the same reason. A saved view
      // is a query string this render may be *displaying*, so the bar has to be
      // drawn against the same request that produced the rows.
      () => fetchSavedViews(tx, { ownerMemberId: resolved.memberId, projectId: row.id }),
    );

    return {
      ...row,
      states,
      customFields,
      cycles: cycles.map((cycle) => ({ id: cycle.id, name: cycle.name })),
      savedViews,
      role: effectiveProjectRole(resolved.actor, resource),
      canEditSettings: can(resolved.actor, 'project.settings', resource),
    };
  });
}

/**
 * Creating a project (§7.1) — the last step before the board.
 *
 * One transaction: the project, its creator's explicit Lead membership, and its
 * six default states. A project that exists for even one commit without columns
 * would render as a board with nothing to put a card in, and the person looking
 * at it would reasonably conclude the product is broken.
 *
 * The Lead row is a real membership, not a pre-baked implicit role: whoever
 * creates a project leads it, and if they are later demoted from Admin they keep
 * that. §10's implicit roles are still composed in `effectiveProjectRole` and
 * never written to a row.
 */
export async function createProject(
  resolved: ResolvedActor,
  input: CreateProjectInput,
): Promise<Ok<{ projectId: string; slug: string; key: string }> | Failed> {
  assertCan(resolved.actor, 'project.create');

  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };

  const visibility = input.visibility === 'private' ? 'private' : 'workspace';
  const projectId = uuidv7();

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const teamId = await resolveTeam(tx, resolved, input.teamId);
      if (!teamId) return { ok: false, problem: 'no_team' } as const;

      const existing = await tx
        .select({ slug: project.slug, key: project.key })
        .from(project)
        .where(isNull(project.deletedAt));

      const takenSlugs = new Set(existing.map((r) => r.slug));
      const takenKeys = new Set(existing.map((r) => r.key));

      // A value the user typed is validated as typed and never silently
      // rewritten — they are looking at the field. One we derive is allowed to
      // fall back, because creating a project must not be a spelling test.
      const requestedSlug = input.slug?.trim();
      const slug = requestedSlug ? slugify(requestedSlug) : deriveSlug(name, takenSlugs);
      if (slugProblem(slug)) return { ok: false, problem: 'invalid_slug' } as const;

      const requestedKey = input.key?.trim();
      const key = requestedKey ? normalizeProjectKey(requestedKey) : deriveProjectKey(name, takenKeys);
      if (projectKeyProblem(key)) return { ok: false, problem: 'invalid_key' } as const;

      await tx.insert(project).values({
        id: projectId,
        workspaceId: resolved.workspace.id,
        teamId,
        slug,
        key,
        name,
        visibility,
      });

      await tx.insert(projectMember).values({
        workspaceId: resolved.workspace.id,
        projectId,
        workspaceMemberId: resolved.memberId,
        role: 'lead',
      });

      await seedDefaultStates(tx, { workspaceId: resolved.workspace.id, projectId });

      /**
       * §20.2's per-project space, created with the project.
       *
       * It takes the project's own name and carries **no** `nameKey`, unlike the
       * company space and unlike the seeded workflow states beside it: the name
       * it is derived from is already the company's own word, so there is
       * nothing to translate and nothing to fall back to.
       *
       * Created eagerly rather than on first use, because §20.5 makes the space
       * the unit of access and a space that appears the moment somebody writes
       * in it is a permission boundary that appears then too. A project's
       * documentation being reachable and empty is the state §20.11 asks for.
       */
      await ensureProjectSpace(tx, uow, {
        workspaceId: resolved.workspace.id,
        projectId,
        name,
      });

      uow.emit({
        type: 'project.created',
        workspaceId: resolved.workspace.id,
        projectId,
        teamId,
        slug,
        key,
        name,
        visibility,
      });
      uow.emit({
        type: 'project.member_added',
        workspaceId: resolved.workspace.id,
        projectId,
        memberId: resolved.memberId,
        role: 'lead',
      });

      return { ok: true, projectId, slug, key } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Both uniques are on (workspace_id, …) and the message names the
      // constraint, so the field that actually collided is the one that gets
      // the error — telling someone their slug is taken when their key was is
      // worse than saying nothing.
      const message = String(error);
      return {
        ok: false,
        problem: message.includes('project_workspace_key_key') ? 'key_taken' : 'slug_taken',
      };
    }
    throw error;
  }
}

/**
 * The team a project belongs to.
 *
 * A caller may name one; when they do not, the workspace's own default team is
 * used, and if that has been renamed or deleted, the oldest surviving team is.
 * Only if a workspace has no teams at all — possible, because deleting a team is
 * allowed and soft — does this fail, and it fails with a message rather than a
 * foreign-key error.
 */
async function resolveTeam(
  tx: TenantDb,
  resolved: ResolvedActor,
  requested: string | undefined,
): Promise<string | null> {
  if (requested) {
    const rows = await tx
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, requested), isNull(team.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  const preferred = await tx
    .select({ id: team.id, slug: team.slug })
    .from(team)
    .where(isNull(team.deletedAt))
    .orderBy(asc(team.createdAt));

  return (
    preferred.find((t) => t.slug === DEFAULT_TEAM.slug)?.id ?? preferred[0]?.id ?? null
  );
}

export async function renameProject(
  resolved: ResolvedActor,
  projectId: string,
  name: string,
): Promise<Ok | Failed> {
  const next = name.trim().normalize('NFC');
  if (!next) return { ok: false, problem: 'name_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const current = await guardForWrite(tx, resolved, projectId);
    if ('problem' in current) return current;

    if (current.row.name === next) return { ok: true } as const;

    // The slug is deliberately not re-derived, and neither is the key: both are
    // in links and identifiers that have already been shared. A rename is a
    // display change.
    await tx
      .update(project)
      .set({ name: next, updatedAt: new Date() })
      .where(eq(project.id, projectId));

    uow.emit({
      type: 'project.renamed',
      workspaceId: resolved.workspace.id,
      projectId,
      from: current.row.name,
      to: next,
    });

    return { ok: true } as const;
  });
}

export async function setProjectVisibility(
  resolved: ResolvedActor,
  projectId: string,
  visibility: 'workspace' | 'private',
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const current = await guardForWrite(tx, resolved, projectId);
    if ('problem' in current) return current;

    if (current.row.visibility === visibility) return { ok: true } as const;

    await tx
      .update(project)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(project.id, projectId));

    uow.emit({
      type: 'project.visibility_changed',
      workspaceId: resolved.workspace.id,
      projectId,
      from: current.row.visibility,
      to: visibility,
    });

    return { ok: true } as const;
  });
}

/**
 * Archiving, and its inverse (§4).
 *
 * Archived is user-facing and reversible; `deleted_at` is a recovery window and
 * a different concept. Unarchiving deliberately does not go through the
 * archived guard — otherwise the one click that brings a project back would be
 * the one click an archived project refuses.
 */
export async function setProjectArchived(
  resolved: ResolvedActor,
  projectId: string,
  archived: boolean,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const row = await loadProject(tx, projectId);
    if (!row) return { ok: false, problem: 'not_found' } as const;
    assertCan(resolved.actor, 'project.settings', projectResource(row));

    if (isArchived(row) === archived) return { ok: true } as const;

    await tx
      .update(project)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(project.id, projectId));

    uow.emit({
      type: archived ? 'project.archived' : 'project.unarchived',
      workspaceId: resolved.workspace.id,
      projectId,
      name: row.name,
    });

    return { ok: true } as const;
  });
}

export type ProjectMemberRow = {
  memberId: string;
  userId: string;
  name: string;
  role: ProjectRole;
};

export async function listProjectMembers(
  context: ActorContext,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  return withActor(context, async (tx) =>
    tx
      .select({
        memberId: projectMember.workspaceMemberId,
        userId: workspaceMember.userId,
        // An account that has not filled in a name still has to be pickable
        // from a list, so the address stands in until they do.
        name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
        role: projectMember.role,
      })
      .from(projectMember)
      .innerJoin(workspaceMember, eq(workspaceMember.id, projectMember.workspaceMemberId))
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(and(eq(projectMember.projectId, projectId), isNull(projectMember.deletedAt)))
      .orderBy(asc(projectMember.role), asc(user.name)),
  );
}

export async function addProjectMember(
  resolved: ResolvedActor,
  input: { projectId: string; memberId: string; role: ProjectRole },
): Promise<Ok | Failed> {
  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const current = await guardForWrite(tx, resolved, input.projectId);
      if ('problem' in current) return current;

      const exists = await tx
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.id, input.memberId), isNull(workspaceMember.deletedAt)))
        .limit(1);
      if (exists.length === 0) return { ok: false, problem: 'not_found' } as const;

      await tx.insert(projectMember).values({
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        workspaceMemberId: input.memberId,
        role: input.role,
      });

      uow.emit({
        type: 'project.member_added',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        memberId: input.memberId,
        role: input.role,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    // Already a member. The caller asked for a state and the state holds; a
    // role change is `changeProjectMemberRole`, which says what it does.
    if (isUniqueViolation(error)) return { ok: true };
    throw error;
  }
}

export async function changeProjectMemberRole(
  resolved: ResolvedActor,
  input: { projectId: string; memberId: string; role: ProjectRole },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const current = await guardForWrite(tx, resolved, input.projectId);
    if ('problem' in current) return current;

    // `returning` gives back the row after the update, so the previous role has
    // to be read first — and an audit row that says only what a role became is
    // half the sentence somebody needs six months later (§18-11).
    const before = await tx
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, input.projectId),
          eq(projectMember.workspaceMemberId, input.memberId),
          isNull(projectMember.deletedAt),
        ),
      )
      .limit(1);

    const previous = before[0]?.role;
    if (!previous) return { ok: false, problem: 'not_found' } as const;
    if (previous === input.role) return { ok: true } as const;

    await tx
      .update(projectMember)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(projectMember.projectId, input.projectId),
          eq(projectMember.workspaceMemberId, input.memberId),
          isNull(projectMember.deletedAt),
        ),
      );

    uow.emit({
      type: 'project.member_role_changed',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      memberId: input.memberId,
      from: previous,
      to: input.role,
    });

    return { ok: true } as const;
  });
}

export async function removeProjectMember(
  resolved: ResolvedActor,
  input: { projectId: string; memberId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const current = await guardForWrite(tx, resolved, input.projectId);
    if ('problem' in current) return current;

    const removed = await tx
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, input.projectId),
          eq(projectMember.workspaceMemberId, input.memberId),
        ),
      )
      .returning({ id: projectMember.id });

    if (removed.length > 0) {
      uow.emit({
        type: 'project.member_removed',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        memberId: input.memberId,
      });
    }

    return { ok: true } as const;
  });
}

/**
 * Load, then the two refusals in the order they have to be asked: does it exist
 * and may you change it, then is it archived. Reversing them would tell someone
 * with no access that the project is archived, which is one bit more than they
 * are entitled to.
 */
async function guardForWrite(
  tx: TenantDb,
  resolved: ResolvedActor,
  projectId: string,
): Promise<{ row: ProjectRow } | Failed> {
  const row = await loadProject(tx, projectId);
  if (!row) return { ok: false, problem: 'not_found' };
  assertCan(resolved.actor, 'project.settings', projectResource(row));
  if (isArchived(row)) return { ok: false, problem: 'archived' };
  return { row };
}
