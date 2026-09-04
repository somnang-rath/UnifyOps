import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { cycle, project, workItem, workflowState, workspace, workspaceHoliday } from '../schema';
import {
  fetchBurndown,
  fetchCycleTotals,
  fetchCycles,
  fetchOpenCycles,
  fetchWorkingDaysLeft,
} from '@/server/queries/cycles';
import { fetchWorkItemGroups } from '@/server/queries/work-items';
import { withIdealLine } from '@/lib/cycles';
import { NONE, emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import type { StateGroup } from '@/lib/state-groups';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Cycles against real Postgres (§7.6, slice 11).
 *
 * Four things here are only true if a database says so, and every one of them
 * is load-bearing for something drawn on a screen:
 *
 *   * **The three-column foreign key.** An item's cycle must belong to the
 *     item's *project*, not merely to its workspace — the tenant check alone
 *     would let Engineering's item join Marketing's sprint, because both sit in
 *     one company. This is §9's composite-key device pushed one level down, and
 *     nothing in TypeScript enforces it.
 *
 *   * **`ON DELETE RESTRICT`.** Deleting a cycle that still holds work must
 *     fail rather than cascade, so that releasing the items is a step somebody
 *     wrote rather than a consequence they got. It is also why `SET NULL` was
 *     not used: on a composite key it nulls every column, `project_id`
 *     included.
 *
 *   * **The burndown's `completed_at` comparison, in the workspace's zone**
 *     (§17-13). Work finished at 8pm in Phnom Penh is the next day in UTC, and
 *     a chart computed in the wrong zone shows a team finishing the morning
 *     after they did.
 *
 *   * **`is_working_day`, called and not reimplemented.** §9 puts one SQL
 *     function behind working days so "staleness, the reminder digest, and
 *     cycle progress" cannot disagree. Slice 9 was the first caller; this is the
 *     second, and a holiday has to flatten this chart exactly as it moves that
 *     digest.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'cycles-a');
  other = await seedWorkspace(h, 'cycles-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = (ws: SeededWorkspace = w) => ({
  workspaceId: ws.workspaceId,
  userId: ws.ownerUserId,
  actorUserId: ws.ownerUserId,
  readOnly: false,
});

const as = <T>(ws: SeededWorkspace, fn: Parameters<typeof withActor<T>>[1]) =>
  withActor(actor(ws), fn, h.app);

/** Phnom Penh, so "the workspace's day" and UTC are demonstrably different. */
const TZ = 'Asia/Phnom_Penh';

async function makeCycle(
  input: { startDate: string; endDate: string; name?: string; completedAt?: Date | null },
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(cycle).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      name: input.name ?? `Sprint ${id.slice(-6)}`,
      startDate: input.startDate,
      endDate: input.endDate,
      completedAt: input.completedAt ?? null,
    });
  });
  return id;
}

/** A state in a given group, so progress can be asserted against §4's groups. */
async function makeState(group: StateGroup, ws: SeededWorkspace = w): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(workflowState).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      name: `${group}-${id.slice(-6)}`,
      group,
      color: 'ink',
      position: 100,
    });
  });
  return id;
}

async function makeItem(
  input: {
    cycleId?: string | null;
    stateId?: string;
    completedAt?: Date | null;
    estimate?: number | null;
  } = {},
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(workItem).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      number: Math.floor(Math.random() * 1_000_000),
      title: `item ${id.slice(-6)}`,
      stateId: input.stateId ?? ws.stateId,
      rootId: id,
      rank: `a${Math.random().toString(36).slice(2, 8)}`,
      createdByMemberId: ws.ownerMemberId,
      cycleId: input.cycleId ?? null,
      completedAt: input.completedAt ?? null,
      estimate: input.estimate ?? null,
    });
  });
  return id;
}

describe('tenant isolation', () => {
  it('hides another workspace cycles from a deliberately unscoped query', async () => {
    const mine = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' });
    const theirs = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' }, other);

    // This query names no workspace at all — §15's "deliberately unscoped
    // query", which must return nothing rather than somebody else's rows.
    const seen = await as(w, (tx) => tx.select({ id: cycle.id }).from(cycle));

    expect(seen.map((row) => row.id)).toContain(mine);
    expect(seen.map((row) => row.id)).not.toContain(theirs);
  });

  it('refuses an item planned into another workspace cycle', async () => {
    const theirs = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' }, other);
    const mine = await makeItem();

    const failure = await failureOf(
      as(w, (tx) => tx.update(workItem).set({ cycleId: theirs }).where(eq(workItem.id, mine))),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('the three-column foreign key', () => {
  /**
   * The reason `cycle` carries a `(id, project_id, workspace_id)` unique and
   * `work_item` a matching three-column key. Both projects are in one
   * workspace, so the tenant check passes and only the project column refuses.
   */
  it('refuses an item planned into another project cycle in the same workspace', async () => {
    const otherProjectId = uuidv7();

    const cycleInSecond = uuidv7();

    // A second project in the same workspace, with a cycle of its own. Written
    // through `withActor` on the app role rather than the owner handle: every
    // tenant table FORCEs row-level security, so the owner is subject to its
    // own policies too and an unscoped insert is refused — which is itself the
    // guarantee slice 1 built.
    await as(w, async (tx) => {
      await tx.insert(project).values({
        id: otherProjectId,
        workspaceId: w.workspaceId,
        teamId: w.teamId,
        slug: 'second',
        key: 'SEC',
        name: 'Second',
      });
      await tx.insert(cycle).values({
        id: cycleInSecond,
        workspaceId: w.workspaceId,
        projectId: otherProjectId,
        name: 'Second sprint',
        startDate: '2026-09-07',
        endDate: '2026-09-20',
      });
    });

    const itemInFirst = await makeItem();

    const failure = await failureOf(
      as(w, (tx) =>
        tx.update(workItem).set({ cycleId: cycleInSecond }).where(eq(workItem.id, itemInFirst)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  /**
   * `RESTRICT`, not `CASCADE` and not `SET NULL`. Deleting a container must
   * never decide the fate of what is inside it — and `SET NULL` on a composite
   * key would null `project_id` and `workspace_id` along with `cycle_id`.
   */
  it('refuses to hard-delete a cycle that still holds work', async () => {
    const id = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' });
    await makeItem({ cycleId: id });

    const failure = await failureOf(as(w, (tx) => tx.delete(cycle).where(eq(cycle.id, id))));
    // 23001 rather than 23503: the row exists and something still needs it,
    // which is exactly the sentence `RESTRICT` is here to say.
    expect(failure.code).toBe(SQLSTATE.restrictViolation);
  });

  it('allows the delete once the work has been released', async () => {
    const id = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' });
    const itemId = await makeItem({ cycleId: id });

    await as(w, async (tx) => {
      await tx.update(workItem).set({ cycleId: null }).where(eq(workItem.id, itemId));
      await tx.delete(cycle).where(eq(cycle.id, id));
    });

    const left = await as(w, (tx) => tx.select({ id: cycle.id }).from(cycle).where(eq(cycle.id, id)));
    expect(left).toHaveLength(0);
  });
});

describe('the range invariants in migration 0020', () => {
  /**
   * Checked in `validatePeriod` too, and here anyway — the argument slice 5
   * made for `root_id` and slice 10 for the value CHECK: a row written by a
   * seed script or a Phase 2 MCP tool has to be as correct as one the service
   * wrote. A backwards range makes `generate_series` return nothing, so the
   * burndown would draw an empty cycle rather than fail.
   */
  it('refuses a range that ends before it starts', async () => {
    const failure = await failureOf(
      makeCycle({ startDate: '2026-09-20', endDate: '2026-09-07' }),
    );
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('allows a single-day cycle', async () => {
    await expect(makeCycle({ startDate: '2026-09-07', endDate: '2026-09-07' })).resolves.toBeTruthy();
  });

  it('refuses a range longer than the burndown can draw', async () => {
    const failure = await failureOf(makeCycle({ startDate: '2026-01-01', endDate: '2027-01-02' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });
});

describe('progress by state group (§4)', () => {
  it('counts by group, never by state name, and keeps cancelled out of the points', async () => {
    const cycleId = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' });

    // Two different completed states, which is the case §4 is written for: a
    // company with two of them must not have one silently excluded.
    const doneA = await makeState('completed');
    const doneB = await makeState('completed');
    const started = await makeState('started');
    const cancelled = await makeState('cancelled');

    await makeItem({ cycleId, stateId: doneA, estimate: 3 });
    await makeItem({ cycleId, stateId: doneB, estimate: 5 });
    await makeItem({ cycleId, stateId: started, estimate: 2 });
    await makeItem({ cycleId, stateId: cancelled, estimate: 8 });

    const totals = await as(w, (tx) => fetchCycleTotals(tx, cycleId));

    expect(totals.counts.completed).toBe(2);
    expect(totals.counts.started).toBe(1);
    expect(totals.counts.cancelled).toBe(1);
    // 3 + 5 + 2. The cancelled item's 8 points are out of the total for the
    // same reason the item is out of the denominator: abandoned work should
    // neither count for a team nor against it.
    expect(totals.estimate).toEqual({ total: 10, completed: 8 });
  });

  it('ignores a deleted item', async () => {
    const cycleId = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' });
    const kept = await makeItem({ cycleId });
    const gone = await makeItem({ cycleId });

    await as(w, (tx) =>
      tx.update(workItem).set({ deletedAt: new Date() }).where(eq(workItem.id, gone)),
    );

    const totals = await as(w, (tx) => fetchCycleTotals(tx, cycleId));
    expect(totals.counts.unstarted).toBe(1);
    expect(kept).toBeTruthy();
  });
});

describe('the burndown', () => {
  const setZone = (zone: string, ws: SeededWorkspace = w) =>
    h.owner.update(workspace).set({ timezone: zone }).where(eq(workspace.id, ws.workspaceId));

  it('drops an item from the day it was completed, and not before', async () => {
    await setZone(TZ);
    const cycleId = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-09' });

    await makeItem({ cycleId }); // never finished
    await makeItem({ cycleId, completedAt: new Date('2026-09-08T03:00:00Z') }); // 10am local

    const days = await as(w, (tx) =>
      fetchBurndown(tx, {
        cycleId,
        workspaceId: w.workspaceId,
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        timeZone: TZ,
        today: '2026-09-09',
      }),
    );

    expect(days.map((day) => day.remaining)).toEqual([2, 1, 1]);
  });

  /**
   * §17-13, as a chart. 8pm on the 8th in Phnom Penh is 1pm UTC on the 8th —
   * but 11pm local is the *9th* in UTC, and a burndown computed in UTC would
   * show the item still open on the day the person finished it.
   */
  it('decides which day work finished in the workspace zone, not in UTC', async () => {
    await setZone(TZ);
    const cycleId = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-09' });

    // 2026-09-08 23:30 in Phnom Penh is 2026-09-08 16:30 UTC — same day either
    // way. 2026-09-09 00:30 local is 2026-09-08 17:30 UTC, which is not.
    await makeItem({ cycleId, completedAt: new Date('2026-09-08T17:30:00Z') });

    const days = await as(w, (tx) =>
      fetchBurndown(tx, {
        cycleId,
        workspaceId: w.workspaceId,
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        timeZone: TZ,
        today: '2026-09-09',
      }),
    );

    // Still open at the end of the 8th (it was finished after midnight local),
    // gone by the end of the 9th. In UTC the item would have closed on the 8th.
    expect(days.map((day) => day.remaining)).toEqual([1, 1, 0]);
  });

  it('leaves the future null rather than carrying today forward', async () => {
    await setZone(TZ);
    const cycleId = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-11' });
    await makeItem({ cycleId });

    const days = await as(w, (tx) =>
      fetchBurndown(tx, {
        cycleId,
        workspaceId: w.workspaceId,
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        timeZone: TZ,
        today: '2026-09-08',
      }),
    );

    expect(days.map((day) => day.remaining)).toEqual([1, 1, null, null, null]);
  });

  /**
   * §9's whole argument for one SQL function. The default working-days mask is
   * 63 — Monday to Saturday, the market §2.5 describes — so Sunday the 13th is
   * not a working day, and the ideal line has to be flat across it.
   */
  it('marks non-working days from the same function the digest uses', async () => {
    await setZone(TZ);
    // 2026-09-11 is a Friday; the 13th is a Sunday.
    const cycleId = await makeCycle({ startDate: '2026-09-11', endDate: '2026-09-14' });

    const days = await as(w, (tx) =>
      fetchBurndown(tx, {
        cycleId,
        workspaceId: w.workspaceId,
        startDate: '2026-09-11',
        endDate: '2026-09-14',
        timeZone: TZ,
        today: '2026-09-14',
      }),
    );

    expect(days.map((day) => `${day.date}:${day.working}`)).toEqual([
      '2026-09-11:true', // Friday
      '2026-09-12:true', // Saturday — a working day in this market
      '2026-09-13:false', // Sunday
      '2026-09-14:true', // Monday
    ]);
  });

  /**
   * §17-18, as a chart. Khmer New Year is a multi-day closure, and a burndown
   * whose ideal line descends across it tells a team they are a week behind on
   * the morning they come back.
   */
  it('flattens the ideal line across a workspace holiday', async () => {
    await setZone(TZ);
    await as(w, (tx) =>
      tx.insert(workspaceHoliday).values({
        id: uuidv7(),
        workspaceId: w.workspaceId,
        date: '2026-09-16',
        name: 'Pchum Ben',
      }),
    );

    const cycleId = await makeCycle({ startDate: '2026-09-15', endDate: '2026-09-17' });

    const days = await as(w, (tx) =>
      fetchBurndown(tx, {
        cycleId,
        workspaceId: w.workspaceId,
        startDate: '2026-09-15',
        endDate: '2026-09-17',
        timeZone: TZ,
        today: '2026-09-17',
      }),
    );

    expect(days.map((day) => day.working)).toEqual([true, false, true]);

    // And the arithmetic on top of it: two working days, so the line steps down
    // on the 15th, holds across the holiday, and reaches zero on the 17th.
    expect(withIdealLine(days, 4).map((point) => point.ideal)).toEqual([2, 2, 0]);
  });

  it('counts the working days left inclusive of the last day', async () => {
    await setZone(TZ);
    // Friday the 11th through Monday the 14th: Fri, Sat, Mon are working days.
    const left = await as(w, (tx) =>
      fetchWorkingDaysLeft(tx, {
        workspaceId: w.workspaceId,
        today: '2026-09-11',
        endDate: '2026-09-14',
      }),
    );

    expect(left).toBe(3);
  });

  it('reports no days left once the cycle has ended', async () => {
    const left = await as(w, (tx) =>
      fetchWorkingDaysLeft(tx, {
        workspaceId: w.workspaceId,
        today: '2026-09-21',
        endDate: '2026-09-14',
      }),
    );

    expect(left).toBe(0);
  });
});

describe('the cycles list', () => {
  it('counts items and completions per cycle, and keeps an empty cycle in the list', async () => {
    const ws = await seedWorkspace(h, 'cycles-list');
    const done = await makeState('completed', ws);

    const full = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20', name: 'Full' }, ws);
    const empty = await makeCycle({ startDate: '2026-09-21', endDate: '2026-10-04', name: 'Empty' }, ws);

    await makeItem({ cycleId: full, stateId: done }, ws);
    await makeItem({ cycleId: full }, ws);

    const rows = await as(ws, (tx) => fetchCycles(tx, ws.projectId));

    // Newest range first: the cycle a team is in, or about to be in, is what
    // they came to the page for.
    expect(rows.map((row) => row.name)).toEqual(['Empty', 'Full']);
    expect(rows.find((row) => row.id === full)).toMatchObject({ itemCount: 2, completedCount: 1 });
    // §7.6's `[E]` state. A row that vanished when it emptied would be a cycle
    // nobody could add work to.
    expect(rows.find((row) => row.id === empty)).toMatchObject({ itemCount: 0, completedCount: 0 });
  });

  it('offers only cycles work can still be planned into', async () => {
    const ws = await seedWorkspace(h, 'cycles-open');

    const past = await makeCycle({ startDate: '2026-08-01', endDate: '2026-08-14' }, ws);
    const closed = await makeCycle(
      { startDate: '2026-09-07', endDate: '2026-09-20', completedAt: new Date() },
      ws,
    );
    const active = await makeCycle({ startDate: '2026-09-01', endDate: '2026-09-30' }, ws);
    const upcoming = await makeCycle({ startDate: '2026-10-01', endDate: '2026-10-14' }, ws);

    const open = await as(ws, (tx) => fetchOpenCycles(tx, ws.projectId, '2026-09-10'));
    const ids = open.map((row) => row.id);

    expect(ids).toContain(active);
    expect(ids).toContain(upcoming);
    // Planning into either of these would rewrite a burndown somebody has read.
    expect(ids).not.toContain(past);
    expect(ids).not.toContain(closed);
  });
});

describe('the list query branch (§9)', () => {
  const anchored = (cycleIds: string[], projectId: string): WorkItemQuery => ({
    ...emptyQuery(),
    filters: { ...emptyQuery().filters, projectIds: [projectId], cycleIds },
    groupBy: 'cycle',
  });

  it('filters and groups by cycle, with the backlog as a real column', async () => {
    const ws = await seedWorkspace(h, 'cycles-query');
    const sprint = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' }, ws);

    const planned = await makeItem({ cycleId: sprint }, ws);
    const backlog = await makeItem({}, ws);

    const groups = await as(ws, (tx) =>
      fetchWorkItemGroups(tx, anchored([], ws.projectId), {
        groupKeys: [sprint, NONE],
        today: '2026-09-10',
      }),
    );

    const inSprint = groups.find((group) => group.key === sprint);
    const inBacklog = groups.find((group) => group.key === NONE);

    expect(inSprint?.rows.map((row) => row.id)).toEqual([planned]);
    expect(inSprint?.total).toBe(1);
    // The backlog is a column somebody drags out of, not a leftover bucket.
    expect(inBacklog?.rows.map((row) => row.id)).toEqual([backlog]);

    // And the row carries its membership, so a card can say which sprint it is in.
    expect(inSprint?.rows[0]?.cycleId).toBe(sprint);
    expect(inBacklog?.rows[0]?.cycleId).toBeNull();
  });

  /**
   * The `none`-OR-ids shape the assignee and label filters already take. "In
   * this sprint or not planned at all" is what a planning screen shows, and
   * splitting it into two filters returns nothing.
   */
  it('ORs the backlog sentinel with a real cycle rather than intersecting them', async () => {
    const ws = await seedWorkspace(h, 'cycles-or');
    const sprint = await makeCycle({ startDate: '2026-09-07', endDate: '2026-09-20' }, ws);
    const otherSprint = await makeCycle({ startDate: '2026-10-01', endDate: '2026-10-14' }, ws);

    const planned = await makeItem({ cycleId: sprint }, ws);
    const elsewhere = await makeItem({ cycleId: otherSprint }, ws);
    const backlog = await makeItem({}, ws);

    const groups = await as(ws, (tx) =>
      fetchWorkItemGroups(tx, { ...anchored([sprint, NONE], ws.projectId), groupBy: 'none' }, {
        groupKeys: ['all'],
        today: '2026-09-10',
      }),
    );

    const seen = groups[0]?.rows.map((row) => row.id) ?? [];
    expect(seen).toContain(planned);
    expect(seen).toContain(backlog);
    expect(seen).not.toContain(elsewhere);
  });
});
