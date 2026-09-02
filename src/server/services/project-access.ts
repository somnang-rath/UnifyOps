import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import type { ProjectResource } from '@/server/authz/policy';
import { project } from '@/server/db/schema';

/**
 * The two questions every project mutation asks before it does anything, in one
 * place.
 *
 * *Which project is this, and may this person change it* is §10, answered by
 * the policy module. *Is the project archived* is §4, and is not a permission
 * at all — an archived project is read-only for everybody including its owner,
 * "no new items, no edits, no state changes, no comments", until it is
 * unarchived. Two different refusals with two different sentences, so they are
 * two different values here rather than one boolean.
 *
 * Its own module because both `projects.ts` and `workflow-states.ts` need it,
 * and importing one from the other would put a cycle between the service that
 * creates a project and the service that fills it with columns.
 */

export type ProjectRow = {
  id: string;
  workspaceId: string;
  slug: string;
  key: string;
  name: string;
  teamId: string;
  visibility: 'workspace' | 'private';
  archivedAt: Date | null;
};

/** Identifiers, not sentences (§13). */
export type ProjectProblem =
  | 'not_found'
  | 'archived'
  | 'name_required'
  | 'slug_taken'
  | 'invalid_slug'
  | 'key_taken'
  | 'invalid_key'
  | 'no_team';

/**
 * The project a mutation names, or null.
 *
 * Null covers "no such project" and "in another workspace" alike — RLS has
 * already made the second one indistinguishable from the first, which is the
 * property §15 turns into a 404 rather than an empty page.
 */
export async function loadProject(tx: TenantDb, projectId: string): Promise<ProjectRow | null> {
  const rows = await tx
    .select({
      id: project.id,
      workspaceId: project.workspaceId,
      slug: project.slug,
      key: project.key,
      name: project.name,
      teamId: project.teamId,
      visibility: project.visibility,
      archivedAt: project.archivedAt,
    })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/** What the policy module needs to know about a project. Nothing more reaches it. */
export function projectResource(row: ProjectRow): ProjectResource {
  return { id: row.id, workspaceId: row.workspaceId, visibility: row.visibility };
}

/**
 * True when the project is archived and therefore refuses every change.
 *
 * Unarchiving is the one exception and is not routed through here — otherwise
 * §4's "one click" to bring a project back would be the one click the rule
 * forbids.
 */
export function isArchived(row: ProjectRow): boolean {
  return row.archivedAt !== null;
}
