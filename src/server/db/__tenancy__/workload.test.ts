import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { NONE, emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import { DUE_BUCKETS } from '@/lib/workspace-date';
import { OPEN_STATE_GROUPS } from '@/lib/needs-attention';
import {
  countWorkItemsByGroup,
  fetchStaleBefore,
  fetchWorkItemGroups,
} from '@/server/queries/work-items';
import { withActor } from '../tenant';
import {
  workItem,
  workItemAssignee,
  workspace,
  workspaceHoliday,
  workspaceMember,
} from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Slice 13 against a real database (§7.3, §7.4, §17-25).
 *
 * Three things in this slice are SQL, and all three are the kind that pass every
 * unit test and are wrong in production:
 *
 *   1. **`stale_before`** — §9's fourth working-day function. Whether Saturday
 *      counts, whether a holiday cluster is skipped, and which *day* an
 *      `updated_at` fell on are all questions only Postgres and the workspace's
 *      timezone can answer together.
 *   2. **The due-bucket grouping** — §7.3's five buckets as one expression,
 *      mirroring `dueBucket` in `src/lib/workspace-date.ts`. The failure mode of
 *      a hand-written mirror is a group whose header says three and whose body
 *      shows two, and only a database can catch it.
 *   3. **The availability CHECKs** in migration 0024, which exist precisely for
 *      the writers that never go through `setAvailability`.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'workload');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = () => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

/**
 * 2026-09-07 is a Monday. The seeded default working-days mask is 63 —
 * Monday to **Saturday**, the market §2.5 describes rather than a European
 * five-day assumption — so Sunday is the only day off unless a holiday says
 * otherwise.
 */
const MONDAY = '2026-09-07';
const THURSDAY = '2026-09-10';

async function item(input: {
  dueDate?: string | null;
  updatedAt?: Date;
  completed?: boolean;
  blocked?: boolean;
  assignTo?: string | null;
}) {
  const id = uuidv7();

  await withActor(
    actor(),
    async (tx) => {
      await tx.insert(workItem).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        number: Math.floor(Math.random() * 1_000_000),
        title: 'Item',
        stateId: w.stateId,
        rootId: id,
        rank: 'i',
        dueDate: input.dueDate ?? null,
        blocked: input.blocked ?? false,
        completedAt: input.completed ? new Date() : null,
        createdByMemberId: w.ownerMemberId,
      });

      if (input.assignTo) {
        await tx.insert(workItemAssignee).values({
          workspaceId: w.workspaceId,
          workItemId: id,
          workspaceMemberId: input.assignTo,
        });
      }

      // Written last and directly, because `updated_at` is what staleness reads
      // and every insert above has just set it to now.
      if (input.updatedAt) {
        await tx
          .update(workItem)
          .set({ updatedAt: input.updatedAt })
          .where(eq(workItem.id, id));
      }
    },
    h.app,
  );

  return id;
}

async function clearItems() {
  await withActor(
    actor(),
    async (tx) => {
      await tx.delete(workItem).where(eq(workItem.workspaceId, w.workspaceId));
    },
    h.app,
  );
}

async function clearHolidays() {
  await withActor(
    actor(),
    async (tx) => {
      await tx.delete(workspaceHoliday).where(eq(workspaceHoliday.workspaceId, w.workspaceId));
    },
    h.app,
  );
}

/** The open work in one project, as both §7.4 surfaces build it. */
function openWork(overrides: Partial<WorkItemQuery['filters']> = {}): WorkItemQuery {
  const base = emptyQuery();
  return {
    ...base,
    groupBy: 'none',
    filters: {
      ...base.filters,
      projectIds: [w.projectId],
      stateGroups: [...OPEN_STATE_GROUPS],
      parentId: null,
      ...overrides,
    },
  };
}

/* ------------------------------------------------------------------------- */

describe('stale_before (§9, slice 13)', () => {
  afterEach(clearHolidays);

  it('counts back over working days, skipping the day off', async () => {
    /**
     * Monday the 7th, one working day back. Sunday the 6th is not a working day
     * in a Monday–Saturday week, so the cutoff is the end of **Saturday the
     * 5th** — an item touched on Saturday is not stale, one touched on Friday
     * is.
     *
     * §4: "'Stale > N days' counts **working** days from the same §6-1 setting,
     * or every Monday morning flags Friday's work and the surface trains people
     * to ignore it." This assertion is that sentence.
     */
    const cutoff = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, w.workspaceId, MONDAY, 1),
      h.app,
    );

    expect(cutoff).not.toBeNull();
    // Midnight at the start of Sunday the 6th, in Asia/Phnom_Penh (UTC+7).
    expect(cutoff?.toISOString()).toBe('2026-09-05T17:00:00.000Z');
  });

  it('is expressed in the workspace timezone, not the server one', async () => {
    /**
     * §17-13, and the trap slice 11's burndown hit first: `updated_at` is an
     * instant, and which *day* it fell on is a question only a zone answers.
     * Work touched at 8pm in Phnom Penh is the next day in UTC, so a cutoff
     * computed in the server's zone flags work updated this morning.
     */
    await withActor(
      actor(),
      (tx) =>
        tx
          .update(workspace)
          .set({ timezone: 'Pacific/Kiritimati' }) // UTC+14
          .where(eq(workspace.id, w.workspaceId)),
      h.app,
    );

    const shifted = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, w.workspaceId, MONDAY, 1),
      h.app,
    );

    expect(shifted?.toISOString()).toBe('2026-09-05T10:00:00.000Z');

    await withActor(
      actor(),
      (tx) =>
        tx
          .update(workspace)
          .set({ timezone: 'Asia/Phnom_Penh' })
          .where(eq(workspace.id, w.workspaceId)),
      h.app,
    );
  });

  it('skips a multi-day holiday cluster', async () => {
    /**
     * §17-18, which is the whole reason the holiday table exists. Khmer New Year
     * and Pchum Ben are multi-day, lunar-dated closures — "a three-day staleness
     * rule fires on the entire workspace the morning everyone returns" unless
     * the arithmetic knows about them.
     *
     * Closing Thursday through Saturday and asking for one working day back from
     * Monday must reach **Wednesday the 9th**, not Saturday the 5th.
     */
    await withActor(
      actor(),
      (tx) =>
        tx.insert(workspaceHoliday).values(
          ['2026-09-05', '2026-09-04', '2026-09-03'].map((date) => ({
            workspaceId: w.workspaceId,
            date,
            name: 'បុណ្យភ្ជុំបិណ្ឌ',
          })),
        ),
      h.app,
    );

    const cutoff = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, w.workspaceId, MONDAY, 1),
      h.app,
    );

    // Midnight at the start of Thursday the 3rd, local: the day after Wednesday.
    expect(cutoff?.toISOString()).toBe('2026-09-02T17:00:00.000Z');
  });

  it('agrees with business_days_between about the same span', async () => {
    /**
     * §9's point, asserted directly: "staleness, the reminder digest, and cycle
     * progress all call it — three surfaces that must never disagree about
     * whether Friday counted." `stale_before` is a fourth function and would be
     * worth nothing if it could drift from the three, so it is built on
     * `is_working_day` like they are — and this checks the arithmetic lands in
     * the same place from both directions.
     */
    const rows = await withActor(
      actor(),
      (tx) =>
        tx.execute<{ last_stale_day: number; first_fresh_day: number }>(
          sql`with cutoff as (
                select (stale_before(${w.workspaceId}::uuid, ${MONDAY}::date, 3)
                          at time zone 'Asia/Phnom_Penh')::date as day
              )
              select
                business_days_between(${w.workspaceId}::uuid, cutoff.day - 1, ${MONDAY}::date)
                  as last_stale_day,
                business_days_between(${w.workspaceId}::uuid, cutoff.day, ${MONDAY}::date)
                  as first_fresh_day
              from cutoff`,
        ),
      h.app,
    );

    /**
     * The cutoff is an **instant**, and the day before it is the last day on
     * which a touch still leaves an item stale. So the identity that has to hold
     * is: that day is exactly N working days behind today, and the next one is
     * N-1 — the boundary, from both sides, with no arithmetic of our own in
     * between.
     *
     * Half-open is what makes the two differ by one: `business_days_between`
     * counts `[from, to)`, so the last stale day counts itself and the first
     * fresh day does not carry it.
     */
    expect(rows.rows[0]?.last_stale_day).toBe(3);
    expect(rows.rows[0]?.first_fresh_day).toBe(2);
  });

  it('cannot be asked about another company calendar', async () => {
    /**
     * SECURITY INVOKER, like its three siblings: the function reads
     * `workspace_holiday` and `workspace` under the caller's own RLS. Naming
     * another workspace's id returns nothing rather than that company's
     * calendar.
     */
    const other = await seedWorkspace(h, 'workload-other');

    const leaked = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, other.workspaceId, MONDAY, 1),
      h.app,
    );

    expect(leaked).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe("My Work's due buckets (§7.3)", () => {
  afterEach(clearItems);

  it('sorts every item into exactly one of the five', async () => {
    await item({ dueDate: '2026-09-01' }); // overdue
    await item({ dueDate: MONDAY }); // today
    await item({ dueDate: THURSDAY }); // this week
    await item({ dueDate: '2026-12-01' }); // later
    await item({ dueDate: null }); // no date

    const counts = await withActor(
      actor(),
      (tx) =>
        countWorkItemsByGroup(tx, { ...openWork(), groupBy: 'due' }, { today: MONDAY }),
      h.app,
    );

    expect(Object.fromEntries(counts)).toEqual({
      overdue: 1,
      today: 1,
      week: 1,
      later: 1,
      none: 1,
    });
  });

  it('does not keep reporting work that was finished late', async () => {
    /**
     * The one branch of the SQL expression that is not a date comparison, and
     * the one §4 and §7.4 both insist on: "an item finished late is history, not
     * a thing to chase, and leaving it here is how Needs Attention fills with
     * noise."
     *
     * It lands in `later` rather than a sixth bucket, mirroring `dueBucket` in
     * `src/lib/workspace-date.ts` exactly — My Work filters completed work out
     * anyway, so the bucket only has to be somewhere honest for callers that do
     * not.
     */
    await item({ dueDate: '2026-09-01', completed: true });

    const counts = await withActor(
      actor(),
      (tx) =>
        countWorkItemsByGroup(
          tx,
          { ...emptyQuery(), groupBy: 'due', filters: { ...emptyQuery().filters, projectIds: [w.projectId] } },
          { today: MONDAY },
        ),
      h.app,
    );

    expect(counts.get('overdue')).toBeUndefined();
    expect(counts.get('later')).toBe(1);
  });

  it('pages and counts each bucket through the same expression', async () => {
    /**
     * The failure a hand-written mirror produces: a header that says three over
     * a body that shows two. `groupPredicate` compares the *same* expression the
     * counts query groups by, so the two cannot disagree — and this is the
     * assertion that would fail if somebody restated it as five branches.
     */
    await item({ dueDate: '2026-09-01' });
    await item({ dueDate: '2026-08-20' });
    await item({ dueDate: MONDAY });

    const groups = await withActor(
      actor(),
      (tx) =>
        fetchWorkItemGroups(
          tx,
          { ...openWork(), groupBy: 'due' },
          { groupKeys: [...DUE_BUCKETS], today: MONDAY },
        ),
      h.app,
    );

    for (const group of groups) {
      expect(group.rows.length).toBe(group.total);
    }

    expect(groups.find((g) => g.key === 'overdue')?.total).toBe(2);
    expect(groups.find((g) => g.key === 'today')?.total).toBe(1);
    // Every bucket is drawn, including the ones with nothing in them — §9's
    // "supplied rather than discovered".
    expect(groups.map((g) => g.key)).toEqual([...DUE_BUCKETS]);
  });
});

/* ------------------------------------------------------------------------- */

describe("Needs Attention's stale row (§7.4)", () => {
  afterEach(clearItems);

  it('finds work untouched across working days and leaves fresh work alone', async () => {
    await item({ updatedAt: new Date('2026-08-20T03:00:00Z') }); // long untouched
    await item({ updatedAt: new Date('2026-09-06T03:00:00Z') }); // touched Sunday

    const staleBefore = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, w.workspaceId, MONDAY, 3),
      h.app,
    );

    const counts = await withActor(
      actor(),
      (tx) =>
        countWorkItemsByGroup(tx, openWork({ stale: 3 }), { today: MONDAY, staleBefore }),
      h.app,
    );

    expect(counts.get('all')).toBe(1);
  });

  it('never lists work that is already finished', async () => {
    // Open work only, for the reason `overdue` gives: an item finished three
    // weeks ago has not been touched since and is not stale — it is done.
    await item({ updatedAt: new Date('2026-08-20T03:00:00Z'), completed: true });

    const staleBefore = await withActor(
      actor(),
      (tx) => fetchStaleBefore(tx, w.workspaceId, MONDAY, 3),
      h.app,
    );

    const counts = await withActor(
      actor(),
      (tx) =>
        countWorkItemsByGroup(
          tx,
          {
            ...emptyQuery(),
            groupBy: 'none',
            filters: { ...emptyQuery().filters, projectIds: [w.projectId], stale: 3 },
          },
          { today: MONDAY, staleBefore },
        ),
      h.app,
    );

    expect(counts.get('all') ?? 0).toBe(0);
  });

  it('matches nothing when the cutoff cannot be resolved', async () => {
    /**
     * `false` rather than a silent drop, on the principle the custom-field
     * branch already states: a filter that cannot be evaluated must never
     * *widen* a result. A Needs Attention row that quietly listed every open
     * item because the calendar was misconfigured is worse than one that lists
     * nothing.
     */
    await item({ updatedAt: new Date('2026-01-01T03:00:00Z') });

    const counts = await withActor(
      actor(),
      (tx) => countWorkItemsByGroup(tx, openWork({ stale: 3 }), { today: MONDAY, staleBefore: null }),
      h.app,
    );

    expect(counts.get('all') ?? 0).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */

describe('workload by assignee (§7.4)', () => {
  afterEach(clearItems);

  it('draws a column for somebody with nothing assigned, and one for nobody', async () => {
    /**
     * §9's "supplied rather than discovered", where it earns the most. A person
     * with an empty queue is the single most useful column a workload view has —
     * it is either free capacity or, with §17-25's flag, explicitly not — and a
     * grouping that discovered its keys from the rows would draw everybody
     * except them.
     */
    await item({ assignTo: w.ownerMemberId });
    await item({ assignTo: w.ownerMemberId, dueDate: '2026-09-01' });
    await item({ assignTo: null });

    const groupKeys = [w.ownerMemberId, w.memberMemberId, NONE];

    const groups = await withActor(
      actor(),
      (tx) =>
        fetchWorkItemGroups(
          tx,
          { ...openWork(), groupBy: 'assignee' },
          { groupKeys, today: MONDAY },
        ),
      h.app,
    );

    expect(groups.find((g) => g.key === w.ownerMemberId)?.total).toBe(2);
    expect(groups.find((g) => g.key === w.memberMemberId)?.total).toBe(0);
    expect(groups.find((g) => g.key === NONE)?.total).toBe(1);
  });

  it('counts the overdue subset through the same grouping', async () => {
    await item({ assignTo: w.ownerMemberId, dueDate: '2026-09-01' });
    await item({ assignTo: w.ownerMemberId, dueDate: '2026-12-01' });

    const overdue = await withActor(
      actor(),
      (tx) =>
        countWorkItemsByGroup(
          tx,
          { ...openWork({ due: 'overdue' }), groupBy: 'assignee' },
          { today: MONDAY },
        ),
      h.app,
    );

    expect(overdue.get(w.ownerMemberId)).toBe(1);
  });
});

/* ------------------------------------------------------------------------- */

describe('availability (§4, migration 0024)', () => {
  afterEach(async () => {
    await withActor(
      actor(),
      (tx) =>
        tx
          .update(workspaceMember)
          .set({ unavailableUntil: null, unavailableReason: null })
          .where(eq(workspaceMember.workspaceId, w.workspaceId)),
      h.app,
    );
  });

  it('stores a date and an optional reason', async () => {
    await withActor(
      actor(),
      (tx) =>
        tx
          .update(workspaceMember)
          .set({ unavailableUntil: '2026-09-20', unavailableReason: 'ការឈប់សម្រាក' })
          .where(eq(workspaceMember.id, w.memberMemberId)),
      h.app,
    );

    const rows = await withActor(
      actor(),
      (tx) =>
        tx
          .select({
            until: workspaceMember.unavailableUntil,
            reason: workspaceMember.unavailableReason,
          })
          .from(workspaceMember)
          .where(eq(workspaceMember.id, w.memberMemberId)),
      h.app,
    );

    expect(rows[0]).toEqual({ until: '2026-09-20', reason: 'ការឈប់សម្រាក' });
  });

  it('refuses a reason with no date to explain', async () => {
    /**
     * The CHECK in 0024, and the reason it is in the database rather than only
     * in `validateAvailability`: a row written by a seed script, a CSV importer
     * or a Phase 2 MCP tool has to be as correct as one the service wrote. That
     * is the same call slice 5 made for `root_id`, slice 10 for the value CHECK
     * and slice 11 for the cycle period.
     */
    const failure = await failureOf(
      withActor(
        actor(),
        (tx) =>
          tx
            .update(workspaceMember)
            .set({ unavailableReason: 'Leave' })
            .where(eq(workspaceMember.id, w.memberMemberId)),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('availability_pairing');
  });

  it('allows a date with no reason, which is somebody who did not say why', async () => {
    await expect(
      withActor(
        actor(),
        (tx) =>
          tx
            .update(workspaceMember)
            .set({ unavailableUntil: '2026-09-20' })
            .where(eq(workspaceMember.id, w.memberMemberId)),
        h.app,
      ),
    ).resolves.not.toThrow();
  });

  it('caps the reason underneath the service grapheme limit', async () => {
    const failure = await failureOf(
      withActor(
        actor(),
        (tx) =>
          tx
            .update(workspaceMember)
            .set({ unavailableUntil: '2026-09-20', unavailableReason: 'x'.repeat(601) })
            .where(eq(workspaceMember.id, w.memberMemberId)),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('reason_length');
  });

  it('is invisible from another workspace', async () => {
    // RLS, not a `WHERE` clause. Availability is on `workspace_member`, which
    // has carried `tenantPolicies()` since slice 1 — this asserts the columns
    // added in slice 13 inherited that rather than escaping it.
    const other = await seedWorkspace(h, 'workload-away');

    await withActor(
      actor(),
      (tx) =>
        tx
          .update(workspaceMember)
          .set({ unavailableUntil: '2026-09-20' })
          .where(eq(workspaceMember.id, w.memberMemberId)),
      h.app,
    );

    const seen = await withActor(
      {
        workspaceId: other.workspaceId,
        userId: other.ownerUserId,
        actorUserId: other.ownerUserId,
        readOnly: false,
      },
      (tx) =>
        tx
          .select({ id: workspaceMember.id })
          .from(workspaceMember)
          .where(eq(workspaceMember.id, w.memberMemberId)),
      h.app,
    );

    expect(seen).toHaveLength(0);
  });
});
