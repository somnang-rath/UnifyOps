import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { workflowState } from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';
import {
  STATE_COLORS,
  STATE_GROUPS,
  defaultColorFor,
  type StateColor,
  type StateGroup,
} from '@/lib/state-groups';
import { isArchived, loadProject, projectResource, type ProjectProblem } from './project-access';
import { countItemsInState, migrateItemsBetweenStates } from './work-items';

/**
 * Workflow states — the columns of a board, and §6-3's v1 customization: "add,
 * rename, recolour, reorder, regroup, delete-with-migration".
 *
 * Every function here checks `project.settings`, which §10 gives to Owner,
 * Admin and a project Lead — and to nobody else, including a Guest who has been
 * made Lead. The Guest column of §10 is a cap, not a shorthand.
 */

/**
 * The six states a new project starts with (§7.1: "land on the BOARD, six
 * default states already present").
 *
 * They carry a message key as well as a literal, which is the mechanism §13
 * calls the awkward middle: a Khmer workspace reads the Khmer word for "Done"
 * rather than "Done", and the moment somebody renames the state the key clears
 * and their word wins for good. The group is what the product reasons with; the
 * name is what people read. Renaming "Done" to "Shipped" does not change what
 * completion means.
 */
export const DEFAULT_STATES: readonly {
  name: string;
  nameKey: string;
  group: StateGroup;
  color: StateColor;
}[] = [
  { name: 'Backlog', nameKey: 'defaultState.backlog', group: 'backlog', color: 'ink' },
  { name: 'Todo', nameKey: 'defaultState.todo', group: 'unstarted', color: 'ink' },
  { name: 'In Progress', nameKey: 'defaultState.inProgress', group: 'started', color: 'warning' },
  // Distinguished from In Progress by colour rather than by group: review is
  // work in flight, and counting it as anything else would make every burndown
  // in a team that reviews properly look like a cliff.
  { name: 'In Review', nameKey: 'defaultState.inReview', group: 'started', color: 'sky' },
  { name: 'Done', nameKey: 'defaultState.done', group: 'completed', color: 'success' },
  { name: 'Cancelled', nameKey: 'defaultState.cancelled', group: 'cancelled', color: 'ink' },
];

/** Spacing between seeded positions, so the numbers are not consecutive by accident. */
const POSITION_STEP = 100;

export type WorkflowStateRow = {
  id: string;
  name: string;
  nameKey: string | null;
  group: StateGroup;
  color: StateColor;
  position: number;
};

export type WorkflowStateProblem =
  | ProjectProblem
  | 'name_taken'
  | 'last_state'
  | 'unknown_state'
  /** §4: a state holding items cannot be deleted without saying where they go. */
  | 'state_has_items';

/**
 * A success, carrying whatever the caller needs back — usually nothing, and
 * then it is exactly `{ ok: true }`. Paired with `Failed` so every mutation in
 * this module answers with a discriminated union rather than a thrown string:
 * a refusal a screen has to render is a value, not an exception.
 */
type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: WorkflowStateProblem };

/**
 * Seeds a new project's six states. Called inside `createProject`'s
 * transaction, so a project cannot exist for even one commit without columns.
 */
export async function seedDefaultStates(
  tx: TenantDb,
  input: { workspaceId: string; projectId: string },
): Promise<WorkflowStateRow[]> {
  const rows = DEFAULT_STATES.map((state, index) => ({
    id: uuidv7(),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: state.name,
    nameKey: state.nameKey as string | null,
    group: state.group,
    color: state.color,
    position: index * POSITION_STEP,
  }));

  await tx.insert(workflowState).values(rows);

  return rows.map(({ id, name, nameKey, group, color, position }) => ({
    id,
    name,
    nameKey,
    group,
    color,
    position,
  }));
}

export async function listWorkflowStates(
  context: ActorContext,
  projectId: string,
): Promise<WorkflowStateRow[]> {
  return withActor(context, async (tx) => readWorkflowStates(tx, projectId));
}

export async function readWorkflowStates(tx: TenantDb, projectId: string): Promise<WorkflowStateRow[]> {
  return tx
    .select({
      id: workflowState.id,
      name: workflowState.name,
      nameKey: workflowState.nameKey,
      group: workflowState.group,
      color: workflowState.color,
      position: workflowState.position,
    })
    .from(workflowState)
    .where(and(eq(workflowState.projectId, projectId), isNull(workflowState.deletedAt)))
    // Position, then id: two states that ended up at the same position — through
    // a partial reorder, or a seed and an insert racing — must still come back
    // in a stable order, or the board reshuffles itself between two identical
    // requests.
    .orderBy(asc(workflowState.position), asc(workflowState.id));
}

export async function addWorkflowState(
  resolved: ResolvedActor,
  input: { projectId: string; name: string; group: StateGroup; color?: StateColor },
): Promise<Ok<{ stateId: string }> | Failed> {
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (!STATE_GROUPS.includes(input.group)) return { ok: false, problem: 'unknown_state' };

  const color =
    input.color && STATE_COLORS.includes(input.color) ? input.color : defaultColorFor(input.group);

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const target = await loadProject(tx, input.projectId);
      if (!target) return { ok: false, problem: 'not_found' } as const;
      if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
      assertCan(resolved.actor, 'project.settings', projectResource(target));

      // Appended, not inserted. Guessing a position from the group would put
      // "Ready for QA" between two states the team has already ordered by hand.
      const last = await tx
        .select({ position: workflowState.position })
        .from(workflowState)
        .where(and(eq(workflowState.projectId, input.projectId), isNull(workflowState.deletedAt)))
        .orderBy(sql`${workflowState.position} desc`)
        .limit(1);

      const stateId = uuidv7();
      await tx.insert(workflowState).values({
        id: stateId,
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        name,
        nameKey: null,
        group: input.group,
        color,
        position: (last[0]?.position ?? 0) + POSITION_STEP,
      });

      uow.emit({
        type: 'workflow_state.created',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        stateId,
        name,
        group: input.group,
      });

      return { ok: true, stateId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Rename, recolour and regroup, in one call.
 *
 * One function rather than three because they are one form: a Lead opens the
 * state row, changes what they came to change, and saves. Three endpoints would
 * mean three round trips for one save, and three chances for two of them to
 * land and one not to.
 */
export async function updateWorkflowState(
  resolved: ResolvedActor,
  input: {
    projectId: string;
    stateId: string;
    name?: string;
    group?: StateGroup;
    color?: StateColor;
  },
): Promise<Ok | Failed> {
  const name = input.name?.trim().normalize('NFC');
  if (name !== undefined && !name) return { ok: false, problem: 'name_required' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const target = await loadProject(tx, input.projectId);
      if (!target) return { ok: false, problem: 'not_found' } as const;
      if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
      assertCan(resolved.actor, 'project.settings', projectResource(target));

      const current = (await readWorkflowStates(tx, input.projectId)).find((s) => s.id === input.stateId);
      if (!current) return { ok: false, problem: 'unknown_state' } as const;

      const renamed = name !== undefined && name !== current.name;
      const group = input.group ?? current.group;
      const color = input.color ?? current.color;

      await tx
        .update(workflowState)
        .set({
          name: name ?? current.name,
          // The rename is what clears the key. Recolouring or regrouping a
          // seeded state leaves it translated, because the company has not
          // named it — they have moved it.
          nameKey: renamed ? null : current.nameKey,
          group,
          color,
          updatedAt: new Date(),
        })
        .where(eq(workflowState.id, input.stateId));

      uow.emit({
        type: 'workflow_state.updated',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        stateId: input.stateId,
        name: name ?? current.name,
        group,
        color,
        previousName: renamed ? current.name : null,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Reorders the whole list in one transaction.
 *
 * The caller sends the full order rather than "move state X to index 3",
 * because the two disagree the moment somebody else has already moved
 * something: an index is meaningless against a list that has changed, while a
 * complete order is at worst stale in a way the next load corrects. Work items
 * take the opposite approach for the opposite reason (§9) — a board is dragged
 * by several people at once; a settings list is not.
 */
export async function reorderWorkflowStates(
  resolved: ResolvedActor,
  input: { projectId: string; order: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const target = await loadProject(tx, input.projectId);
    if (!target) return { ok: false, problem: 'not_found' } as const;
    if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'project.settings', projectResource(target));

    const existing = await readWorkflowStates(tx, input.projectId);
    const known = new Set(existing.map((s) => s.id));

    // Every id, exactly once. A partial order would silently leave the states it
    // omits wherever they were, which reads to the person who dragged one as
    // "the change did not save".
    const unique = new Set(input.order);
    if (unique.size !== input.order.length) return { ok: false, problem: 'unknown_state' } as const;
    if (unique.size !== known.size) return { ok: false, problem: 'unknown_state' } as const;
    if (input.order.some((id) => !known.has(id))) {
      return { ok: false, problem: 'unknown_state' } as const;
    }

    for (const [index, stateId] of input.order.entries()) {
      await tx
        .update(workflowState)
        .set({ position: index * POSITION_STEP, updatedAt: new Date() })
        .where(eq(workflowState.id, stateId));
    }

    uow.emit({
      type: 'workflow_state.reordered',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      order: [...input.order],
    });

    return { ok: true } as const;
  });
}

/**
 * Deletes a state, recording where whatever it held was sent (§4).
 *
 * "Deleting a state holding items requires choosing a migration target. The one
 * place we insist on a confirmation dialog, because the alternative is orphaned
 * work." Work items arrive in slice 5; the shape of the decision is here now, so
 * the call site, the dialog and the audit row do not have to be retrofitted
 * around it — `migrateToStateId` is already carried and already logged.
 *
 * A hard delete rather than the soft delete other tables use: a state is a
 * column, not a record of work, and a soft-deleted one would keep its name
 * reserved by `workflow_state_project_name_key` — so a team that deleted
 * "Blocked" by mistake could never create it again.
 *
 * Slice 5 closed the guard this function was left holding open: the items now
 * exist, so a state that holds any is refused unless the caller names where
 * they go, and the move happens inside this same transaction. `work_item`'s
 * foreign key onto the state is `ON DELETE RESTRICT` for the same reason — if
 * this check were ever bypassed, the database refuses rather than orphaning
 * work.
 */
export async function deleteWorkflowState(
  resolved: ResolvedActor,
  input: { projectId: string; stateId: string; migrateToStateId?: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const project = await loadProject(tx, input.projectId);
    if (!project) return { ok: false, problem: 'not_found' } as const;
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'project.settings', projectResource(project));

    const existing = await readWorkflowStates(tx, input.projectId);
    const target = existing.find((s) => s.id === input.stateId);
    if (!target) return { ok: false, problem: 'unknown_state' } as const;

    // A project with no columns is not a project. The last state is refused
    // rather than cascaded, and the message says so.
    if (existing.length <= 1) return { ok: false, problem: 'last_state' } as const;

    const migrateTo = input.migrateToStateId ?? null;
    if (migrateTo !== null && !existing.some((s) => s.id === migrateTo && s.id !== target.id)) {
      return { ok: false, problem: 'unknown_state' } as const;
    }

    // §4: "Deleting a state holding items requires choosing a migration
    // target. The one place we insist on a confirmation dialog, because the
    // alternative is orphaned work." The count is what lets the dialog say how
    // many, which is the number that makes the choice a real one.
    const held = await countItemsInState(tx, input.stateId);
    if (held > 0) {
      if (migrateTo === null) return { ok: false, problem: 'state_has_items' } as const;
      await migrateItemsBetweenStates(tx, input.stateId, migrateTo);
    }

    await tx.delete(workflowState).where(eq(workflowState.id, input.stateId));

    uow.emit({
      type: 'workflow_state.deleted',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      stateId: input.stateId,
      name: target.name,
      migratedToStateId: migrateTo,
    });

    return { ok: true } as const;
  });
}

/** States for several projects at once, so a project list can draw its columns in one query. */
export async function listWorkflowStatesFor(
  context: ActorContext,
  projectIds: readonly string[],
): Promise<Map<string, WorkflowStateRow[]>> {
  if (projectIds.length === 0) return new Map();

  const rows = await withActor(context, async (tx) =>
    tx
      .select({
        projectId: workflowState.projectId,
        id: workflowState.id,
        name: workflowState.name,
        nameKey: workflowState.nameKey,
        group: workflowState.group,
        color: workflowState.color,
        position: workflowState.position,
      })
      .from(workflowState)
      .where(
        and(inArray(workflowState.projectId, [...projectIds]), isNull(workflowState.deletedAt)),
      )
      .orderBy(asc(workflowState.position), asc(workflowState.id)),
  );

  const byProject = new Map<string, WorkflowStateRow[]>();
  for (const row of rows) {
    const { projectId, ...state } = row;
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), state]);
  }
  return byProject;
}
