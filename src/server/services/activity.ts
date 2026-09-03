import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ResolvedActor } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { label, user, workItem, workflowState, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { fetchActivity, type ActivityRow } from '@/server/queries/activity';
import { loadProject, projectResource } from './project-access';

/**
 * The per-item activity feed, hydrated (§4, slice 7).
 *
 * The feed stores ids, and this is where they become names. Two rules decide
 * everything below:
 *
 *   * **Names are resolved at read time, never written into the row.** A state
 *     renamed from "In Review" to "QA" should read as QA everywhere, including
 *     in the line that recorded a move into it three months ago — and a seeded
 *     name has to stay translatable, which a string frozen into `data` never
 *     could be (§13). The cost is that a *hard*-deleted reference resolves to
 *     nothing, and the renderer says so in words rather than showing a uuid.
 *
 *   * **History outlives membership.** Nothing here filters `deleted_at` on the
 *     people, labels or states it looks up. §7.12 keeps a departed member's
 *     activity "preserved and attributed"; a feed that blanked their name the
 *     day they left would be neither.
 */

/** The most recent lines shown by default. Roughly a screen and a half. */
const DEFAULT_LIMIT = 40;

/**
 * What `?activity=all` widens to. Not unbounded: an item somebody has dragged
 * across a board every morning for a year is a page that never finishes
 * rendering, and §11's answer to "50 assignees" applies here too.
 */
const FULL_LIMIT = 500;

export type ActivityFeed = {
  lines: ActivityRow[];
  /** Older entries exist above the window. The page offers to widen it. */
  truncated: boolean;
  /** Referenced workflow states, by id. A missing id is one that was deleted. */
  states: Record<string, { name: string; nameKey: string | null; color: string }>;
  /** Referenced labels, by id. */
  labels: Record<string, { name: string; color: string }>;
  /** Referenced workspace members, by member id. */
  people: Record<string, string>;
};

const idsOf = (rows: ActivityRow[], key: string): string[] => [
  ...new Set(
    rows.flatMap((row) => {
      const value = row.data[key];
      return typeof value === 'string' ? [value] : [];
    }),
  ),
];

async function hydrate(tx: TenantDb, rows: ActivityRow[]): Promise<Omit<ActivityFeed, 'lines' | 'truncated'>> {
  const stateIds = [...new Set([...idsOf(rows, 'from'), ...idsOf(rows, 'to')])];
  const labelIds = idsOf(rows, 'labelId');
  const memberIds = idsOf(rows, 'memberId');

  const [states, labels, people] = await Promise.all([
    stateIds.length === 0
      ? []
      : tx
          .select({
            id: workflowState.id,
            name: workflowState.name,
            nameKey: workflowState.nameKey,
            color: workflowState.color,
          })
          .from(workflowState)
          .where(inArray(workflowState.id, stateIds)),
    labelIds.length === 0
      ? []
      : tx
          .select({ id: label.id, name: label.name, color: label.color })
          .from(label)
          .where(inArray(label.id, labelIds)),
    memberIds.length === 0
      ? []
      : tx
          .select({ id: workspaceMember.id, name: user.name })
          .from(workspaceMember)
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .where(inArray(workspaceMember.id, memberIds)),
  ]);

  return {
    states: Object.fromEntries(
      states.map((s) => [s.id, { name: s.name, nameKey: s.nameKey, color: s.color }]),
    ),
    labels: Object.fromEntries(labels.map((l) => [l.id, { name: l.name, color: l.color }])),
    people: Object.fromEntries(people.map((p) => [p.id, p.name])),
  };
}

/**
 * One item's feed, or null when the item is not visible to this actor.
 *
 * The visibility check is `project.view` and is asked here rather than trusted
 * from the caller, even though every caller so far has already loaded the item
 * through `getWorkItem`. RLS has scoped the rows to the workspace; §10 decides
 * whether *this member* may see this project, and a feed is exactly the surface
 * where forgetting that leaks the contents of a private project one line at a
 * time.
 */
export async function getActivityFeed(
  resolved: ResolvedActor,
  input: { workItemId: string; all?: boolean },
): Promise<ActivityFeed | null> {
  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({ projectId: workItem.projectId })
      .from(workItem)
      .where(and(eq(workItem.id, input.workItemId), isNull(workItem.deletedAt)))
      .limit(1);

    const projectId = rows[0]?.projectId;
    if (!projectId) return null;

    const project = await loadProject(tx, projectId);
    if (!project) return null;
    if (!can(resolved.actor, 'project.view', projectResource(project))) return null;

    const page = await fetchActivity(tx, {
      workItemId: input.workItemId,
      limit: input.all ? FULL_LIMIT : DEFAULT_LIMIT,
    });

    return {
      lines: page.rows,
      truncated: page.truncated,
      ...(await hydrate(tx, page.rows)),
    };
  });
}
