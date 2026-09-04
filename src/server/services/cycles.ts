import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { cycle, workItem } from '@/server/db/schema';
import { inSequence } from '@/server/db/sequence';
import { withActor } from '@/server/db/tenant';
import {
  fetchBurndown,
  fetchCycle,
  fetchCycles,
  fetchCycleTotals,
  fetchOpenCycles,
  fetchWorkingDaysLeft,
  type CycleRow,
  type CycleSummary,
} from '@/server/queries/cycles';
import {
  cycleStatus,
  isOpen,
  progressFrom,
  validatePeriod,
  withIdealLine,
  burndownStanding,
  type BurndownPoint,
  type CycleProblem,
  type CycleProgress,
  type CycleStatus,
} from '@/lib/cycles';
import { todayIn, type CalendarDate } from '@/lib/workspace-date';
import {
  isArchived,
  loadProject,
  projectResource,
  type ProjectProblem,
  type ProjectRow,
} from './project-access';
import { guardForWrite } from './work-items';

/**
 * Cycles (§7.6, §14 slice 11) — "run a two-week cycle end to end".
 *
 * **Two permissions, and neither of them is new.** This is the fifth time this
 * decision has gone the same way, after labels (slice 5), attachments (slice
 * 8), notifications (slice 9) and custom fields (slice 10), and the argument
 * has not changed: §10 has no cycle row, and inventing one would put a rule in
 * the code that the table a non-technical owner is shown does not contain.
 *
 *   * **Planning a cycle is `project.settings`** — creating it, editing its
 *     dates, closing it, deleting it. §10's row reads "Project settings,
 *     states, custom fields", which is the family a date-bounded container of a
 *     project's work belongs to, and it is already Owner, Admin and Lead: the
 *     people who run a sprint.
 *
 *   * **Putting an item into one is `work_item.edit`**, because membership is a
 *     property of the work item in the same way a priority or a label is. §7.6
 *     is explicit that "membership is per item", and that is not only a data
 *     shape — it is who may change it. Anyone who can edit the work can say
 *     which sprint it is in.
 *
 * That split is the one labels already make, and it is what lets a team plan
 * their own work into a sprint their Lead set up.
 */

export type CycleFailure =
  | ProjectProblem
  | CycleProblem
  // Planning an item into a cycle goes through the work-item guard, so its
  // refusals are this module's refusals too — the same borrowing
  // `custom-fields.ts` does, and by the same route.
  | 'not_found'
  | 'archived'
  | 'name_taken'
  | 'cycle_closed'
  | 'wrong_project';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: CycleFailure };

/** A cycle as a list row: the stored fields, plus what today makes of them. */
export type CycleView = CycleSummary & {
  status: CycleStatus;
  /** True when this range overlaps another cycle's. §7.6: "allowed, warned". */
  overlapping: boolean;
};

/** Everything the cycle detail page draws. */
export type CycleDetail = {
  cycle: CycleRow;
  status: CycleStatus;
  progress: CycleProgress;
  burndown: BurndownPoint[];
  standing: ReturnType<typeof burndownStanding>;
  /** Working days from today through the end, inclusive. Zero once ended. */
  workingDaysLeft: number;
  today: CalendarDate;
  canManage: boolean;
  /** Where §7.6's "move to the next cycle" would move them, or null if nowhere. */
  nextCycle: { id: string; name: string } | null;
};

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Every cycle in a project, with its status and its overlap warning.
 *
 * The overlap check is done here, over the list that has already been fetched,
 * rather than as a SQL `EXISTS` per row: the list is a project's cycles — a
 * handful, or a few dozen after a year — and a quadratic scan over that is free,
 * where a correlated subquery would be one more thing in the query plan for a
 * warning that is not even an error.
 */
export async function listCycles(
  resolved: ResolvedActor,
  projectId: string,
): Promise<CycleView[] | null> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const target = await loadProject(tx, projectId);
    if (!target) return null;
    if (!can(resolved.actor, 'project.view', projectResource(target))) return null;

    const rows = await fetchCycles(tx, projectId);

    return rows.map((row) => ({
      ...row,
      status: cycleStatus(row, today),
      overlapping: rows.some(
        (other) =>
          other.id !== row.id && other.startDate <= row.endDate && row.startDate <= other.endDate,
      ),
    }));
  });
}

/**
 * The cycle detail page, in one transaction.
 *
 * Everything is read inside the one `withActor` the cycle itself was read in —
 * the trap slice 8 hit with `getCommentThread`, slice 9 hit with the unread
 * count and slice 10 hit with custom fields, each time by opening a second
 * transaction for something the first one could have answered. A page drawing a
 * progress bar, a burndown and a list would otherwise be four.
 *
 * It is also correctness, not only latency: a burndown computed against one
 * transaction's items and a progress bar against another's can disagree by an
 * item somebody completed in between, and the two numbers sit an inch apart.
 */
export async function getCycle(
  resolved: ResolvedActor,
  cycleId: string,
): Promise<CycleDetail | null> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const row = await fetchCycle(tx, cycleId);
    if (!row) return null;

    const target = await loadProject(tx, row.projectId);
    if (!target) return null;

    const resource = projectResource(target);
    if (!can(resolved.actor, 'project.view', resource)) return null;

    const [totals, days, workingDaysLeft, open] = await inSequence(
      () => fetchCycleTotals(tx, cycleId),
      () =>
        fetchBurndown(tx, {
          cycleId,
          workspaceId: resolved.workspace.id,
          startDate: row.startDate,
          endDate: row.endDate,
          timeZone: resolved.workspace.timezone,
          today,
        }),
      () =>
        fetchWorkingDaysLeft(tx, {
          workspaceId: resolved.workspace.id,
          today,
          endDate: row.endDate,
        }),
      () => fetchOpenCycles(tx, row.projectId, today),
    );

    const progress = progressFrom(totals.counts, totals.estimate);
    // The scope the ideal line descends from is the work that counts —
    // cancelled items are out of the denominator on the bar, and drawing them
    // into the chart's starting height would leave a line that can never reach
    // zero.
    const burndown = withIdealLine(days, progress.inScope);

    return {
      cycle: row,
      status: cycleStatus(row, today),
      progress,
      burndown,
      standing: burndownStanding(burndown),
      workingDaysLeft,
      today,
      canManage: can(resolved.actor, 'project.settings', resource) && !isArchived(target),
      // §7.6's "move to the next cycle" needs a next cycle to move to. The
      // earliest still-open one that is not this one — offered rather than
      // assumed, so the prompt can say where the work is going.
      nextCycle: open
        .filter((candidate) => candidate.id !== cycleId)
        .map((candidate) => ({ id: candidate.id, name: candidate.name }))[0] ?? null,
    };
  });
}

/**
 * The cycles a picker on an item may offer (§7.6's "add items").
 *
 * Open cycles, plus whichever one the item is in now even if that has closed —
 * a control that could not show its own current value would read as though the
 * item were in no cycle at all, and the first click would silently move it.
 */
export async function listPlannableCycles(
  resolved: ResolvedActor,
  projectId: string,
  currentCycleId: string | null,
): Promise<CycleRow[]> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const open = await fetchOpenCycles(tx, projectId, today);
    if (!currentCycleId || open.some((row) => row.id === currentCycleId)) return open;

    const current = await fetchCycle(tx, currentCycleId);
    return current ? [current, ...open] : open;
  });
}

/* ------------------------------------------------------------------------- */
/* Planning                                                                  */
/* ------------------------------------------------------------------------- */

export type CycleInput = {
  projectId: string;
  name: string;
  goal?: string | null;
  startDate: string;
  endDate: string;
};

export async function createCycle(
  resolved: ResolvedActor,
  input: CycleInput,
): Promise<Ok<{ cycleId: string }> | Failed> {
  const name = input.name.trim().normalize('NFC');
  const problem = validatePeriod({ ...input, name });
  if (problem) return { ok: false, problem };

  const cycleId = uuidv7();

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const target = await loadProject(tx, input.projectId);
      if (!target) return { ok: false, problem: 'not_found' } as const;

      assertCan(resolved.actor, 'project.settings', projectResource(target));
      if (isArchived(target)) return { ok: false, problem: 'archived' } as const;

      await tx.insert(cycle).values({
        id: cycleId,
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        name,
        goal: normalizeGoal(input.goal),
        startDate: input.startDate,
        endDate: input.endDate,
      });

      uow.emit({
        type: 'cycle.created',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        cycleId,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
      });

      return { ok: true, cycleId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

export async function updateCycle(
  resolved: ResolvedActor,
  input: { cycleId: string; name: string; goal?: string | null; startDate: string; endDate: string },
): Promise<Ok | Failed> {
  const name = input.name.trim().normalize('NFC');
  const problem = validatePeriod({ ...input, name });
  if (problem) return { ok: false, problem };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const guard = await guardCycle(tx, resolved, input.cycleId);
      if (!guard.ok) return guard;

      const { row, project } = guard;
      const goal = normalizeGoal(input.goal);
      const datesChanged = row.startDate !== input.startDate || row.endDate !== input.endDate;

      if (row.name === name && row.goal === goal && !datesChanged) return { ok: true } as const;

      await tx
        .update(cycle)
        .set({
          name,
          goal,
          startDate: input.startDate,
          endDate: input.endDate,
          updatedAt: new Date(),
        })
        .where(eq(cycle.id, input.cycleId));

      uow.emit({
        type: 'cycle.updated',
        workspaceId: resolved.workspace.id,
        projectId: project.id,
        cycleId: input.cycleId,
        name,
        previousName: row.name === name ? null : row.name,
        startDate: input.startDate,
        endDate: input.endDate,
        datesChanged,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Delete a cycle, returning everything in it to the backlog.
 *
 * **The items are released first, in the same transaction**, and that is not
 * tidiness: `work_item_cycle_fk` is `ON DELETE RESTRICT`, so a cycle holding
 * work cannot be deleted until it is empty. Restrict rather than a cascade for
 * the reason `work_item_state_fk` uses — deleting a container should never
 * decide the fate of what is in it — and rather than `SET NULL` because a
 * composite key set null nulls *every* column in it, which would take the
 * item's `project_id` and `workspace_id` with it.
 *
 * §6's customization safety rule — "deleting a definition with data requires an
 * explicit choice about the data" — is satisfied by the confirmation naming the
 * count before the click, exactly as deleting a custom field does. There is
 * only one honest answer here, so the screen states it rather than offering it:
 * the work goes back to the backlog, and none of it is lost.
 */
export async function deleteCycle(
  resolved: ResolvedActor,
  cycleId: string,
): Promise<Ok<{ released: number }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardCycle(tx, resolved, cycleId);
    if (!guard.ok) return guard;

    const { row, project } = guard;

    const released = await tx
      .update(workItem)
      .set({ cycleId: null, updatedAt: new Date() })
      .where(and(eq(workItem.cycleId, cycleId), isNull(workItem.deletedAt)))
      .returning({ id: workItem.id });

    // Soft delete, like every other row in this product: `deleted_at` is a
    // 30-day recovery window (§4), and a cycle deleted by mistake on the last
    // afternoon of a sprint is exactly the row somebody wants back.
    await tx
      .update(cycle)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(cycle.id, cycleId));

    uow.emit({
      type: 'cycle.deleted',
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      cycleId,
      name: row.name,
      released: released.length,
    });

    return { ok: true, released: released.length } as const;
  });
}

/** §7.6's three answers to "the cycle ended and these items are still open". */
export const DISPOSITIONS = ['next_cycle', 'backlog', 'leave'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export function isDisposition(value: unknown): value is Disposition {
  return typeof value === 'string' && (DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * Answer §7.6's end-of-cycle prompt.
 *
 * "On end date, incomplete items prompt: move to next cycle, return to backlog,
 * or leave." **The prompt is a decision, never an automatic move** — which is
 * why nothing in this product closes a cycle on a schedule, and why `leave` is
 * a real answer that sets `completed_at` exactly as the other two do. A prompt
 * that reappeared after being dismissed would be a prompt nobody ever finishes.
 *
 * Only **incomplete** items move, and incomplete is read from §4's state
 * *group*: everything not `completed` and not `cancelled`. Cancelled work is
 * not carried into the next sprint — somebody already decided it was not going
 * to happen, and carrying it would put that decision back on the next team.
 */
export async function completeCycle(
  resolved: ResolvedActor,
  input: { cycleId: string; disposition: Disposition; targetCycleId?: string | null },
): Promise<Ok<{ carriedOver: number }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardCycle(tx, resolved, input.cycleId);
    if (!guard.ok) return guard;

    const { row, project } = guard;

    let destination: string | null = null;
    if (input.disposition === 'next_cycle') {
      if (!input.targetCycleId) return { ok: false, problem: 'not_found' } as const;

      const target = await fetchCycle(tx, input.targetCycleId);
      if (!target) return { ok: false, problem: 'not_found' } as const;
      // The composite foreign key would refuse this anyway; refusing here turns
      // a constraint violation into a problem a screen can translate (§13).
      if (target.projectId !== project.id) return { ok: false, problem: 'wrong_project' } as const;
      destination = target.id;
    }

    const moved =
      input.disposition === 'leave'
        ? []
        : await tx
            .update(workItem)
            .set({ cycleId: destination, updatedAt: new Date() })
            .where(
              and(
                eq(workItem.cycleId, input.cycleId),
                isNull(workItem.deletedAt),
                sql`${workItem.stateId} in (
                  select ws.id from workflow_state ws
                  where ws."group" not in ('completed', 'cancelled')
                )`,
              ),
            )
            .returning({ id: workItem.id });

    await tx
      .update(cycle)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(eq(cycle.id, input.cycleId));

    uow.emit({
      type: 'cycle.completed',
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      cycleId: input.cycleId,
      name: row.name,
      disposition: input.disposition,
      carriedOver: moved.length,
    });

    // One event per item, because §7.6 makes membership per item and the item's
    // own feed is where somebody asks why their work moved sprint. None of them
    // notifies — see the registry entry for why a planning move must not.
    for (const item of moved) {
      uow.emit({
        type: 'work_item.cycle_changed',
        workspaceId: resolved.workspace.id,
        projectId: project.id,
        workItemId: item.id,
        from: input.cycleId,
        to: destination,
        assigneeIds: [],
      });
    }

    return { ok: true, carriedOver: moved.length } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Membership                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Put one item into a cycle, move it between cycles, or return it to the
 * backlog (`cycleId: null`).
 *
 * `work_item.edit`, through the same guard every other item mutation uses —
 * membership is a property of the item (§7.6), so the permission is the item's.
 *
 * **A sub-item is not pulled in with its parent**, and nothing here does that:
 * §7.6 is explicit that "membership is per item, never inherited", because
 * carry-over work routinely outlives its parent's cycle and silent inheritance
 * rewrites burndown history the moment a parent moves. Offering to add them is
 * allowed by the plan and is a UI affordance if it is ever built — it would
 * call this function once per item, which is the only shape that keeps the
 * events and the feed honest.
 */
export async function setItemCycle(
  resolved: ResolvedActor,
  input: { workItemId: string; cycleId: string | null },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardForWrite(tx, resolved, input.workItemId);
    if ('ok' in guard) return guard as Failed;

    const { item, project } = guard;
    if (item.cycleId === input.cycleId) return { ok: true } as const;

    if (input.cycleId !== null) {
      const target = await fetchCycle(tx, input.cycleId);
      if (!target) return { ok: false, problem: 'not_found' } as const;
      if (target.projectId !== item.projectId) {
        return { ok: false, problem: 'wrong_project' } as const;
      }
      // Planning into a cycle that has closed would rewrite a burndown somebody
      // has already read, and a retrospective is not a thing you edit after the
      // fact. Taking an item *out* of a closed cycle is refused by the same
      // rule, one branch up: `input.cycleId === null` never reaches here.
      const today = todayIn(resolved.workspace.timezone);
      if (!isOpen(cycleStatus(target, today))) {
        return { ok: false, problem: 'cycle_closed' } as const;
      }
    }

    await tx
      .update(workItem)
      .set({ cycleId: input.cycleId, updatedAt: new Date() })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.cycle_changed',
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      workItemId: input.workItemId,
      from: item.cycleId,
      to: input.cycleId,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Plan several items into a cycle at once — §7.6's "multi-select from backlog".
 *
 * One transaction and one guard per item, rather than one bulk `UPDATE … WHERE
 * id = any(...)`: every item has to be checked against §10 individually, and a
 * bulk statement would either skip that or apply the check to whichever project
 * the first item happened to be in. The events are per item for the same reason
 * they are in `completeCycle` — thirty items moving is thirty things that
 * happened to thirty pieces of work.
 *
 * All or nothing. A partial sprint plan is worse than a refused one: §7.6's
 * picker shows a selection, and a result that silently moved nineteen of twenty
 * leaves somebody to work out which.
 */
export async function planItemsIntoCycle(
  resolved: ResolvedActor,
  input: { cycleId: string; workItemIds: readonly string[] },
): Promise<Ok<{ planned: number }> | Failed> {
  if (input.workItemIds.length === 0) return { ok: true, planned: 0 };

  return withActor(resolved.context, async (tx, uow) => {
    const target = await fetchCycle(tx, input.cycleId);
    if (!target) return { ok: false, problem: 'not_found' } as const;

    const today = todayIn(resolved.workspace.timezone);
    if (!isOpen(cycleStatus(target, today))) return { ok: false, problem: 'cycle_closed' } as const;

    const project = await loadProject(tx, target.projectId);
    if (!project) return { ok: false, problem: 'not_found' } as const;
    assertCan(resolved.actor, 'work_item.edit', projectResource(project));
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;

    const items = await tx
      .select({
        id: workItem.id,
        cycleId: workItem.cycleId,
        projectId: workItem.projectId,
        assigneeIds: workItem.assigneeIds,
      })
      .from(workItem)
      .where(and(inArray(workItem.id, [...input.workItemIds]), isNull(workItem.deletedAt)));

    // An id naming no visible row, or one in another project, is a client
    // defect rather than a race — the picker only ever lists this project's
    // backlog — so it is refused rather than quietly skipped.
    if (items.length !== new Set(input.workItemIds).size) {
      return { ok: false, problem: 'not_found' } as const;
    }
    if (items.some((row) => row.projectId !== target.projectId)) {
      return { ok: false, problem: 'wrong_project' } as const;
    }

    const changing = items.filter((row) => row.cycleId !== input.cycleId);
    if (changing.length === 0) return { ok: true, planned: 0 } as const;

    await tx
      .update(workItem)
      .set({ cycleId: input.cycleId, updatedAt: new Date() })
      .where(inArray(workItem.id, changing.map((row) => row.id)));

    for (const row of changing) {
      uow.emit({
        type: 'work_item.cycle_changed',
        workspaceId: resolved.workspace.id,
        projectId: target.projectId,
        workItemId: row.id,
        from: row.cycleId,
        to: input.cycleId,
        assigneeIds: row.assigneeIds,
      });
    }

    return { ok: true, planned: changing.length } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Shared guards                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Load the cycle, then the three refusals in the order they have to be asked:
 * does it exist, may you manage its project, and is that project archived.
 *
 * The same order `guardForWrite` uses, for the same reason: telling somebody
 * with no access that a project is archived is one bit more than they are
 * entitled to.
 */
async function guardCycle(
  tx: TenantDb,
  resolved: ResolvedActor,
  cycleId: string,
): Promise<{ ok: true; row: CycleRow; project: ProjectRow } | Failed> {
  const row = await fetchCycle(tx, cycleId);
  if (!row) return { ok: false, problem: 'not_found' };

  const project = await loadProject(tx, row.projectId);
  if (!project) return { ok: false, problem: 'not_found' };

  assertCan(resolved.actor, 'project.settings', projectResource(project));
  if (isArchived(project)) return { ok: false, problem: 'archived' };

  return { ok: true, row, project };
}

/** Empty is null, not `''` — the column means "no goal", and one of those says so. */
function normalizeGoal(goal: string | null | undefined): string | null {
  const trimmed = goal?.trim().normalize('NFC');
  return trimmed ? trimmed : null;
}
