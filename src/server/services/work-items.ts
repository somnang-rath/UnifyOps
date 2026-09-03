import 'server-only';

import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import {
  project,
  projectCounter,
  user,
  workItem,
  workItemAssignee,
  workItemLabel,
  workflowState,
  workspaceMember,
} from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { isClosedGroup, type StateGroup } from '@/lib/state-groups';
import { isPriority } from '@/lib/priorities';
import { rankAfter, rankBetween } from '@/lib/rank';
import { todayIn } from '@/lib/workspace-date';
import {
  NONE,
  type WorkItemQuery,
} from '@/lib/work-item-query';
import {
  fetchChangeToken,
  fetchWorkItemGroups,
  type WorkItemGroupPage,
  type WorkItemRow,
} from '@/server/queries/work-items';
import {
  isArchived,
  loadProject,
  projectResource,
  type ProjectProblem,
  type ProjectRow,
} from './project-access';
import { readLabelsByIds, type LabelRow } from './labels';

/**
 * Work items (§14, slice 5).
 *
 * Three rules run through everything here, and each one is somebody else's
 * decision that this module is only carrying out:
 *
 *   * **§10 is asked on every path.** `work_item.create` and `work_item.edit`
 *     are Member-and-above *within the project*, which for a private project
 *     means an explicit membership — so the check needs the project row, and
 *     every mutation loads it before doing anything.
 *
 *   * **An archived project is read-only** (§4): "no new items, no edits, no
 *     state changes, no comments". Enforced here rather than by hiding buttons,
 *     because a stale tab is a button that is still on screen.
 *
 *   * **The list query is never re-implemented.** Everything that reads goes
 *     through `src/server/queries/work-items.ts`, which §19.6 will later hold
 *     the Phase 2 MCP server to as well. What this module adds is hydration —
 *     turning ids into the names and chips a screen draws — and the second
 *     policy pass that `listProjects` established: the SQL is an optimisation
 *     of the policy module, never a second opinion.
 */

export type WorkItemProblem =
  | ProjectProblem
  | 'title_required'
  | 'unknown_state'
  | 'unknown_neighbour'
  | 'unknown_parent'
  | 'too_deep'
  | 'unknown_member'
  | 'unknown_label'
  | 'blocked_reason_required';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: WorkItemProblem };

/** One person, as a list row draws them. */
export type PersonRef = {
  memberId: string;
  userId: string;
  name: string;
};

export type WorkItemView = WorkItemRow & {
  /** `ENG-142` — composed here, because the prefix lives on the project (§9). */
  identifier: string;
};

export type WorkItemGroupView = Omit<WorkItemGroupPage, 'rows'> & {
  rows: WorkItemView[];
};

export type WorkItemListing = {
  groups: WorkItemGroupView[];
  /** Everyone referenced by an `assigneeIds`, so avatars need no second round trip. */
  people: PersonRef[];
  /** Every label referenced, likewise. */
  labels: LabelRow[];
  /** Today in the workspace timezone, so the view's overdue badge uses the same date the filter did. */
  today: string;
};

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * The list query, hydrated.
 *
 * `groupKeys` is supplied by the caller rather than discovered, because a board
 * column that vanishes when it empties is a column nothing can be dragged into
 * — and because the *order* of the groups is the project's, not the data's.
 */
export async function listWorkItems(
  resolved: ResolvedActor,
  query: WorkItemQuery,
  options: {
    groupKeys: readonly string[];
    cursors?: Readonly<Record<string, string | null | undefined>>;
  },
): Promise<WorkItemListing> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const groups = await fetchWorkItemGroups(tx, query, {
      groupKeys: options.groupKeys,
      cursors: options.cursors,
      today,
    });

    // The second pass `listProjects` established. RLS has already made another
    // workspace's rows unreachable; this is §10's own question, asked about the
    // projects the rows came from — a private project a Guest was removed from
    // between the filter being built and the page being drawn is the case it
    // catches. If it ever removes a row, the SQL and the module have drifted,
    // and the module is the one that is right.
    const projectIds = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.projectId)))];
    const visible = await visibleProjects(tx, resolved, projectIds);

    const kept = groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => visible.has(row.projectId)),
    }));

    const keys = new Map([...visible].map(([id, row]) => [id, row.key]));

    const memberIds = [...new Set(kept.flatMap((g) => g.rows.flatMap((r) => r.assigneeIds)))];
    const labelIds = [...new Set(kept.flatMap((g) => g.rows.flatMap((r) => r.labelIds)))];

    const [people, labels] = await Promise.all([
      readPeople(tx, memberIds),
      readLabelsByIds(tx, labelIds),
    ]);

    return {
      groups: kept.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          identifier: `${keys.get(row.projectId) ?? '?'}-${row.number}`,
        })),
      })),
      people,
      labels,
      today,
    };
  });
}

/**
 * The token a board polls (§8, §17-2).
 *
 * No hydration, no policy second pass, no group fan-out — it is one aggregate
 * and it answers exactly one question: *has anything I am looking at moved?*
 * The board only fetches when the answer changes, so this is the call that runs
 * on a timer and the expensive one that does not.
 *
 * RLS still scopes it, so a token cannot report activity in a workspace the
 * caller cannot see. It can report activity in a *private project* they cannot
 * see — the count would move without the rows being readable — which is why the
 * refetch it triggers goes through `listWorkItems` and its §10 pass rather than
 * trusting the token to have been about visible work.
 */
export async function boardChangeToken(
  resolved: ResolvedActor,
  query: WorkItemQuery,
): Promise<string> {
  const today = todayIn(resolved.workspace.timezone);
  return withActor(resolved.context, (tx) => fetchChangeToken(tx, query, { today }));
}

/**
 * One item by its project and number — the `ENG-142` of a URL.
 *
 * Null covers "no such item" and "not visible to you" alike, and the caller
 * turns both into a 404, for the reason `getProjectBySlug` does: telling them
 * apart says what exists.
 */
export async function getWorkItem(
  resolved: ResolvedActor,
  input: { projectSlug: string; number: number },
): Promise<
  | (WorkItemView & {
      description: string | null;
      projectKey: string;
      projectSlug: string;
      stateGroup: StateGroup;
      assignees: PersonRef[];
      labels: LabelRow[];
      canEdit: boolean;
      archived: boolean;
      today: string;
    })
  | null
> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({
        item: workItem,
        projectKey: project.key,
        projectSlug: project.slug,
        projectVisibility: project.visibility,
        projectArchivedAt: project.archivedAt,
        stateGroup: workflowState.group,
      })
      .from(workItem)
      .innerJoin(project, eq(project.id, workItem.projectId))
      .innerJoin(workflowState, eq(workflowState.id, workItem.stateId))
      .where(
        and(
          eq(project.slug, input.projectSlug),
          eq(workItem.number, input.number),
          isNull(workItem.deletedAt),
          isNull(project.deletedAt),
        ),
      )
      .limit(1);

    const found = rows[0];
    if (!found) return null;

    const resource = {
      id: found.item.projectId,
      workspaceId: resolved.workspace.id,
      visibility: found.projectVisibility,
    };
    if (!can(resolved.actor, 'project.view', resource)) return null;

    const [assignees, labels] = await Promise.all([
      readPeople(tx, found.item.assigneeIds),
      readLabelsByIds(tx, found.item.labelIds),
    ]);

    return {
      ...found.item,
      identifier: `${found.projectKey}-${found.item.number}`,
      projectKey: found.projectKey,
      projectSlug: found.projectSlug,
      stateGroup: found.stateGroup,
      assignees,
      labels,
      // An archived project is read-only for everyone including its owner (§4),
      // so the screen has to know both facts separately: may you edit, and is
      // anything editable at all.
      canEdit: can(resolved.actor, 'work_item.edit', resource) && found.projectArchivedAt === null,
      archived: found.projectArchivedAt !== null,
      today,
    };
  });
}

/** The projects among `ids` this actor may actually see, keyed by id. */
async function visibleProjects(
  tx: TenantDb,
  resolved: ResolvedActor,
  ids: readonly string[],
): Promise<Map<string, { key: string }>> {
  if (ids.length === 0) return new Map();

  const rows = await tx
    .select({
      id: project.id,
      key: project.key,
      workspaceId: project.workspaceId,
      visibility: project.visibility,
    })
    .from(project)
    .where(and(inArray(project.id, [...ids]), isNull(project.deletedAt)));

  return new Map(
    rows
      .filter((row) =>
        can(resolved.actor, 'project.view', {
          id: row.id,
          workspaceId: row.workspaceId,
          visibility: row.visibility,
        }),
      )
      .map((row) => [row.id, { key: row.key }]),
  );
}

async function readPeople(tx: TenantDb, memberIds: readonly string[]): Promise<PersonRef[]> {
  if (memberIds.length === 0) return [];

  return tx
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      // An account with no name still has to be nameable in a list, so the
      // address stands in until they fill one in.
      name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(inArray(workspaceMember.id, [...memberIds]))
    .orderBy(asc(user.name));
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

export type CreateWorkItemInput = {
  projectId: string;
  title: string;
  /** §5: "state defaults to the column you created in". Absent means the first state. */
  stateId?: string;
  priority?: string;
  assigneeMemberIds?: readonly string[];
  labelIds?: readonly string[];
  dueDate?: string | null;
  parentId?: string | null;
};

/**
 * Creating an item (§7.2, target: under five seconds).
 *
 * The human identifier is allocated **last-ish** and in one statement: an
 * upsert on the project's counter row, which both creates the counter the first
 * time and increments it every time after, under a row lock held to commit.
 * That lock is what makes `ENG-142` gapless, and §17-11 is explicit that the
 * contention is real and scoped to one project — two projects never wait on
 * each other, which is the property that matters.
 *
 * `root_id` and `depth` are set by the trigger in migration 0008, not here. The
 * value passed below is what the column needs to be non-null before the trigger
 * runs; the trigger overwrites it, and refuses a fourth level.
 */
export async function createWorkItem(
  resolved: ResolvedActor,
  input: CreateWorkItemInput,
): Promise<Ok<{ workItemId: string; number: number }> | Failed> {
  const title = input.title.trim().normalize('NFC');
  if (!title) return { ok: false, problem: 'title_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const target = await loadProject(tx, input.projectId);
    if (!target) return { ok: false, problem: 'not_found' } as const;
    if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'work_item.create', projectResource(target));

    const state = await resolveState(tx, input.projectId, input.stateId);
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    if (input.parentId) {
      const parent = await tx
        .select({ id: workItem.id, depth: workItem.depth })
        .from(workItem)
        .where(
          and(
            eq(workItem.id, input.parentId),
            eq(workItem.projectId, input.projectId),
            isNull(workItem.deletedAt),
          ),
        )
        .limit(1);

      if (parent.length === 0) return { ok: false, problem: 'unknown_parent' } as const;
      // The trigger refuses this too, and would roll the transaction back with
      // a message meant for a developer. Refusing here gives the screen a
      // problem identifier it can translate (§13).
      if ((parent[0]?.depth ?? 0) >= 2) return { ok: false, problem: 'too_deep' } as const;
    }

    const workItemId = uuidv7();

    // Appended to the group it was created in. Jittered, so two people typing
    // into the same column at the same moment do not compute the same key and
    // leave two cards swapping places on every reload (§9).
    const last = await tx
      .select({ rank: workItem.rank })
      .from(workItem)
      .where(
        and(
          eq(workItem.projectId, input.projectId),
          eq(workItem.stateId, state.id),
          isNull(workItem.deletedAt),
        ),
      )
      .orderBy(desc(workItem.rank))
      .limit(1);

    const number = await allocateNumber(tx, resolved.workspace.id, input.projectId);

    await tx.insert(workItem).values({
      id: workItemId,
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      number,
      title,
      stateId: state.id,
      priority: isPriority(input.priority) ? input.priority : 'none',
      parentId: input.parentId ?? null,
      // Overwritten by the hierarchy trigger; present so the column is non-null
      // when the trigger runs.
      rootId: workItemId,
      rank: rankAfter(last[0]?.rank ?? null),
      dueDate: input.dueDate ?? null,
      completedAt: isClosedGroup(state.group) ? new Date() : null,
      createdByMemberId: resolved.memberId,
    });

    const assigneeProblem = await writeAssignees(
      tx,
      resolved,
      workItemId,
      input.assigneeMemberIds ?? [],
    );
    if (assigneeProblem) return { ok: false, problem: assigneeProblem } as const;

    const labelProblem = await writeLabels(tx, resolved, workItemId, input.labelIds ?? []);
    if (labelProblem) return { ok: false, problem: labelProblem } as const;

    uow.emit({
      type: 'work_item.created',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      workItemId,
      number,
      title,
      stateId: state.id,
      parentId: input.parentId ?? null,
      // The people handed this work as it was created. `work_item.assigned`
      // never fires for them — a create writes its assignees and emits one
      // event — so without this the one assignment nobody hears about is the
      // one that comes with the item.
      assigneeIds: [...new Set(input.assigneeMemberIds ?? [])],
    });

    return { ok: true, workItemId, number } as const;
  });
}

/**
 * The next human identifier for a project, gapless.
 *
 * One statement, so there is no read-then-write window for two concurrent
 * creates to both win. `ON CONFLICT DO UPDATE` takes the row lock; the second
 * transaction waits on it and then reads the value the first wrote.
 */
async function allocateNumber(
  tx: TenantDb,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const result = await tx
    .insert(projectCounter)
    .values({ id: uuidv7(), workspaceId, projectId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: projectCounter.projectId,
      set: {
        lastNumber: sql`${projectCounter.lastNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ number: projectCounter.lastNumber });

  return result[0]!.number;
}

async function resolveState(
  tx: TenantDb,
  projectId: string,
  stateId: string | undefined,
): Promise<{ id: string; group: StateGroup } | null> {
  const rows = await tx
    .select({ id: workflowState.id, group: workflowState.group })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.projectId, projectId),
        isNull(workflowState.deletedAt),
        stateId ? eq(workflowState.id, stateId) : undefined,
      ),
    )
    .orderBy(asc(workflowState.position), asc(workflowState.id))
    .limit(1);

  return rows[0] ?? null;
}

/** The fields a plain edit may touch. Assignees, labels, state and blocked have their own calls. */
export type UpdateWorkItemInput = {
  workItemId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
};

export async function updateWorkItem(
  resolved: ResolvedActor,
  input: UpdateWorkItemInput,
): Promise<Ok | Failed> {
  const title = input.title?.trim().normalize('NFC');
  if (title !== undefined && !title) return { ok: false, problem: 'title_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const next = {
      title: title ?? item.title,
      description: input.description === undefined ? item.description : input.description,
      priority: isPriority(input.priority) ? input.priority : item.priority,
      startDate: input.startDate === undefined ? item.startDate : input.startDate,
      dueDate: input.dueDate === undefined ? item.dueDate : input.dueDate,
      estimate: input.estimate === undefined ? item.estimate : input.estimate,
    };

    // Which fields actually moved, so the activity feed slice 7 builds says
    // "changed the due date" rather than "edited the item".
    const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
      (field) => next[field] !== item[field],
    );
    if (fields.length === 0) return { ok: true } as const;

    await tx
      .update(workItem)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.updated',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      fields,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Moving an item to another state — §7.3's one click, and slice 6's drag.
 *
 * `completed_at` is set from the new state's **group**, never its name (§4). A
 * company that renames "Done" to "Shipped" has not changed what completion
 * means, and a company with two completed states must not have one of them
 * silently excluded from slice 11's burndown.
 */
export async function setWorkItemState(
  resolved: ResolvedActor,
  input: { workItemId: string; stateId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    if (item.stateId === input.stateId) return { ok: true } as const;

    const rows = await tx
      .select({ id: workflowState.id, group: workflowState.group })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, input.stateId),
          eq(workflowState.projectId, item.projectId),
          isNull(workflowState.deletedAt),
        ),
      )
      .limit(1);

    const state = rows[0];
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    const closing = isClosedGroup(state.group);

    await tx
      .update(workItem)
      .set({
        stateId: state.id,
        // Re-stamped on entering a closed group and cleared on leaving one. Not
        // preserved across a reopen: the date an item was finished is the date
        // it was *last* finished, which is what a burndown is asking.
        completedAt: closing ? (item.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.state_changed',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      from: item.stateId,
      to: state.id,
      completed: closing,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

export type MoveWorkItemInput = {
  workItemId: string;
  /** The column the card was dropped into. May be the one it already sits in. */
  stateId: string;
  /** The card the drop point sits *below*, or null for the top of the column. */
  previousId: string | null;
  /** The card the drop point sits *above*, or null for the bottom of the column. */
  nextId: string | null;
};

/**
 * A drag, resolved (§7.5, §9).
 *
 * **The client sends neighbour IDs and never a rank.** That is the whole design,
 * and everything awkward below follows from it. A rank computed in the browser
 * is computed against a board that may be seconds stale, and two people
 * dragging onto the same gap would compute the same key; a rank computed here,
 * under a row lock, is computed against what is actually true right now.
 *
 * §9: "A stale drag lands correctly relative to present state — this is what
 * stops boards feeling haunted." So a neighbour that has *moved on* since the
 * drag began is not an error. The rules, in order:
 *
 *   * A neighbour id that names no row in this project is a **bad request** —
 *     that is a client defect or a crafted body, not a race.
 *   * A neighbour that exists but has since left this column is **stale**. The
 *     true neighbour is re-derived from the column as it stands, so the card
 *     lands where the user aimed relative to the cards they can still see.
 *   * `null` is an *intent*, not a missing value: `previousId: null` means "the
 *     top", `nextId: null` means "the bottom". Neither is ever re-derived, or a
 *     card dropped at the end of a column would slide into the middle of it.
 *
 * The lock covers the item and both neighbours in one statement, so two drags
 * touching the same cards serialize rather than interleave — which is what §15's
 * two-browser test asserts.
 */
export async function moveWorkItem(
  resolved: ResolvedActor,
  input: MoveWorkItemInput,
): Promise<Ok<{ rank: string }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const stateRows = await tx
      .select({ id: workflowState.id, group: workflowState.group })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, input.stateId),
          eq(workflowState.projectId, item.projectId),
          isNull(workflowState.deletedAt),
        ),
      )
      .limit(1);

    const state = stateRows[0];
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    // A card is never its own neighbour, whatever the client believed.
    const previousId = input.previousId === input.workItemId ? null : input.previousId;
    const nextId = input.nextId === input.workItemId ? null : input.nextId;

    const wanted = [previousId, nextId].filter((id): id is string => id !== null);

    // One locking read for the item and both neighbours. `FOR UPDATE` is §9's,
    // and it is taken before any rank is read — a lock acquired after the read
    // it was meant to protect is decoration.
    const locked = wanted.length
      ? await tx
          .select({ id: workItem.id, rank: workItem.rank, stateId: workItem.stateId })
          .from(workItem)
          .where(
            and(
              inArray(workItem.id, [...wanted, input.workItemId]),
              eq(workItem.projectId, item.projectId),
              isNull(workItem.deletedAt),
            ),
          )
          .for('update')
      : await tx
          .select({ id: workItem.id, rank: workItem.rank, stateId: workItem.stateId })
          .from(workItem)
          .where(eq(workItem.id, input.workItemId))
          .for('update');

    const byId = new Map(locked.map((row) => [row.id, row]));
    for (const id of wanted) {
      if (!byId.has(id)) return { ok: false, problem: 'unknown_neighbour' } as const;
    }

    /** A neighbour still counts only while it is still in the column being dropped into. */
    const liveRank = (id: string | null): string | null => {
      if (id === null) return null;
      const row = byId.get(id);
      return row && row.stateId === state.id ? row.rank : null;
    };

    const previousRank = liveRank(previousId);

    // `nextId` named a card that has since left the column: re-derive the card
    // that now follows the drop point, so the drag lands relative to what is
    // there. A `nextId` of null is an intent and is never re-derived.
    let nextRank = liveRank(nextId);
    if (nextId !== null && nextRank === null) {
      const successor = await tx
        .select({ rank: workItem.rank })
        .from(workItem)
        .where(
          and(
            eq(workItem.stateId, state.id),
            eq(workItem.projectId, item.projectId),
            isNull(workItem.deletedAt),
            ne(workItem.id, input.workItemId),
            previousRank === null ? undefined : gt(workItem.rank, previousRank),
          ),
        )
        .orderBy(asc(workItem.rank))
        .limit(1);

      nextRank = successor[0]?.rank ?? null;
    }

    // Both neighbours survived but no longer bracket a gap — the column was
    // reordered under the drag. The one above wins, because it is the card the
    // user was aiming beneath.
    if (previousRank !== null && nextRank !== null && previousRank >= nextRank) {
      nextRank = null;
    }

    const rank = rankBetween(previousRank, nextRank);

    const sameState = item.stateId === state.id;
    if (sameState && item.rank === rank) return { ok: true, rank } as const;

    const closing = isClosedGroup(state.group);

    await tx
      .update(workItem)
      .set({
        stateId: state.id,
        rank,
        // The same rule `setWorkItemState` applies, because a drag into a Done
        // column is a completion and slice 11's burndown reads this column.
        completedAt: closing ? (item.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(workItem.id, input.workItemId));

    // Exactly one event per drag. Crossing columns is a state change and
    // already has an event that slice 7 and slice 9 understand; staying inside
    // one is a move and has its own.
    uow.emit(
      sameState
        ? {
            type: 'work_item.moved',
            workspaceId: resolved.workspace.id,
            projectId: item.projectId,
            workItemId: input.workItemId,
            stateId: state.id,
          }
        : {
            type: 'work_item.state_changed',
            workspaceId: resolved.workspace.id,
            projectId: item.projectId,
            workItemId: input.workItemId,
            from: item.stateId,
            to: state.id,
            completed: closing,
            assigneeIds: item.assigneeIds,
          },
    );

    return { ok: true, rank } as const;
  });
}

/**
 * The whole assignee set, not a diff.
 *
 * A set rather than add/remove calls because the UI is a multi-select and the
 * user's intent is "these people" — two calls would mean a window where an item
 * is assigned to nobody, and a notification for it (§4: unassignment notifies
 * the person removed).
 */
export async function setWorkItemAssignees(
  resolved: ResolvedActor,
  input: { workItemId: string; memberIds: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const wanted = [...new Set(input.memberIds)];
    const current = new Set(item.assigneeIds);
    const added = wanted.filter((id) => !current.has(id));
    const removed = item.assigneeIds.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return { ok: true } as const;

    if (removed.length > 0) {
      await tx
        .delete(workItemAssignee)
        .where(
          and(
            eq(workItemAssignee.workItemId, input.workItemId),
            inArray(workItemAssignee.workspaceMemberId, removed),
          ),
        );
    }

    const problem = await writeAssignees(tx, resolved, input.workItemId, added);
    if (problem) return { ok: false, problem } as const;

    uow.emit({
      type: 'work_item.assigned',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      added,
      removed,
    });

    return { ok: true } as const;
  });
}

export async function setWorkItemLabels(
  resolved: ResolvedActor,
  input: { workItemId: string; labelIds: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const wanted = [...new Set(input.labelIds)];
    const current = new Set(item.labelIds);
    const added = wanted.filter((id) => !current.has(id));
    const removed = item.labelIds.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return { ok: true } as const;

    if (removed.length > 0) {
      await tx
        .delete(workItemLabel)
        .where(
          and(
            eq(workItemLabel.workItemId, input.workItemId),
            inArray(workItemLabel.labelId, removed),
          ),
        );
    }

    const problem = await writeLabels(tx, resolved, input.workItemId, added);
    if (problem) return { ok: false, problem } as const;

    uow.emit({
      type: 'work_item.labelled',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      added,
      removed,
    });

    return { ok: true } as const;
  });
}

/**
 * §4: blocked is a flag, not a state — an item can be *In Progress and
 * blocked*. §7.3 makes it one click that notifies the project lead, and the
 * reason is required, because "blocked" with no reason is a card nobody can
 * unblock without asking.
 */
export async function setWorkItemBlocked(
  resolved: ResolvedActor,
  input: { workItemId: string; blocked: boolean; reason?: string | null },
): Promise<Ok | Failed> {
  const reason = input.blocked ? (input.reason ?? '').trim().normalize('NFC') : null;
  if (input.blocked && !reason) return { ok: false, problem: 'blocked_reason_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    if (item.blocked === input.blocked && item.blockedReason === reason) {
      return { ok: true } as const;
    }

    await tx
      .update(workItem)
      .set({ blocked: input.blocked, blockedReason: reason, updatedAt: new Date() })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.blocked_changed',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      blocked: input.blocked,
      reason,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Soft delete — §4's 30-day recovery window, and a different concept from a
 * project's `archived_at`. The number is not released: human identifiers are
 * never reused, so the counter is untouched here on purpose.
 */
export async function deleteWorkItem(
  resolved: ResolvedActor,
  workItemId: string,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const now = new Date();
    await tx
      .update(workItem)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(workItem.id, workItemId));

    // Sub-items go with the parent. Leaving them would put orphaned work in a
    // list with no route to it — §4's "orphaned work" is the thing the state
    // deletion dialog exists to prevent, and the same reasoning applies here.
    await tx
      .update(workItem)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(workItem.parentId, workItemId), isNull(workItem.deletedAt)));

    uow.emit({
      type: 'work_item.deleted',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId,
      number: item.number,
      title: item.title,
    });

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Shared guards                                                             */
/* ------------------------------------------------------------------------- */

type LoadedItem = {
  item: typeof workItem.$inferSelect;
  project: ProjectRow;
};

/**
 * Load the item, then the three refusals in the order they have to be asked:
 * does it exist, may you edit it, and is its project archived.
 *
 * The order matters for the same reason it does in `projects.ts`: telling
 * somebody with no access that a project is archived is one bit more than they
 * are entitled to.
 */
async function guardForWrite(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
): Promise<LoadedItem | Failed> {
  const rows = await tx
    .select()
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const item = rows[0];
  if (!item) return { ok: false, problem: 'not_found' };

  const target = await loadProject(tx, item.projectId);
  if (!target) return { ok: false, problem: 'not_found' };

  assertCan(resolved.actor, 'work_item.edit', projectResource(target));
  if (isArchived(target)) return { ok: false, problem: 'archived' };

  return { item, project: target };
}

/**
 * Inserts assignment rows, after checking every member is real.
 *
 * The composite foreign key already refuses a member from another workspace, so
 * this check is not the tenancy boundary — it is what turns a constraint
 * violation into a problem identifier a screen can translate (§13).
 */
async function writeAssignees(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
  memberIds: readonly string[],
): Promise<WorkItemProblem | null> {
  if (memberIds.length === 0) return null;

  const found = await tx
    .select({ id: workspaceMember.id })
    .from(workspaceMember)
    .where(and(inArray(workspaceMember.id, [...memberIds]), isNull(workspaceMember.deletedAt)));

  if (found.length !== memberIds.length) return 'unknown_member';

  await tx.insert(workItemAssignee).values(
    memberIds.map((memberId) => ({
      id: uuidv7(),
      workspaceId: resolved.workspace.id,
      workItemId,
      workspaceMemberId: memberId,
    })),
  );

  return null;
}

async function writeLabels(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
  labelIds: readonly string[],
): Promise<WorkItemProblem | null> {
  if (labelIds.length === 0) return null;

  const found = await readLabelsByIds(tx, labelIds);
  if (found.length !== labelIds.length) return 'unknown_label';

  await tx.insert(workItemLabel).values(
    labelIds.map((labelId) => ({
      id: uuidv7(),
      workspaceId: resolved.workspace.id,
      workItemId,
      labelId,
    })),
  );

  return null;
}

/* ------------------------------------------------------------------------- */
/* What other services need to ask about work items                          */
/* ------------------------------------------------------------------------- */

/**
 * How many live items a workflow state holds.
 *
 * `workflow-states.ts` calls this to answer §4's "deleting a state holding
 * items requires choosing a migration target" — the guard it left as a TODO
 * because, in slice 4, there was no table to count.
 */
export async function countItemsInState(tx: TenantDb, stateId: string): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(workItem)
    .where(and(eq(workItem.stateId, stateId), isNull(workItem.deletedAt)));

  return rows[0]?.total ?? 0;
}

/** Moves every live item out of one state and into another, for that same rule. */
export async function migrateItemsBetweenStates(
  tx: TenantDb,
  from: string,
  to: string,
): Promise<number> {
  const moved = await tx
    .update(workItem)
    .set({ stateId: to, updatedAt: new Date() })
    .where(and(eq(workItem.stateId, from), isNull(workItem.deletedAt)))
    .returning({ id: workItem.id });

  return moved.length;
}

/** Re-exported so a caller needs one import to build the group list for a query. */
export { NONE };
