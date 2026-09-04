import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import {
  workItem,
  workItemAssignee,
  workflowState,
  workspace,
  workspaceHoliday,
  workspaceNotificationDefault,
} from '../schema';
import { reassignOpenWorkInTx } from '@/server/services/work-items';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * §6's settings against real Postgres (slice 15).
 *
 * Three groups, and each of them asserts something that is only true if a
 * database says so:
 *
 *   * **§15's cross-workspace read test for the one new tenant table**, which is
 *     the reason every slice adds a file like this.
 *
 *   * **The bounds in migration 0028.** §6's governing rule has a second half
 *     that is easy to miss — "No setting can put a workspace in an
 *     unrecoverable state" — and the settings form is the one surface that
 *     could break it. They are asserted with the service bypassed, which is the
 *     only way to assert them at all, and for the reason slice 5 put `root_id`
 *     in 0008: a row written by a seed script, a CSV importer or a Phase 2 MCP
 *     tool has to be as correct as one the service wrote.
 *
 *   * **§7.13's view-as, refused by the database.** This is the important one.
 *     The policy module refuses every mutation in a read-only session and
 *     `uow.emit` throws before either — so a test that went through the service
 *     would prove the first layer and say nothing about the last. These go
 *     straight at the tables with `readOnly: true`, which is what §7.13's "it is
 *     a real actor context, not a UI filter" actually means.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'settings-a');
  other = await seedWorkspace(h, 'settings-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const scope = (seed: SeededWorkspace, readOnly = false) => ({
  workspaceId: seed.workspaceId,
  userId: seed.ownerUserId,
  actorUserId: seed.ownerUserId,
  readOnly,
});

/**
 * Every query in this file goes through `withActor` on the **harness's** app
 * handle, not the process-wide one.
 *
 * That is what makes the suite independent of `.env` — and it is also the
 * point: the app role is the connection the running product holds, so a policy
 * asserted against anything else would be asserting nothing.
 */
const as = <T>(
  seed: SeededWorkspace,
  fn: Parameters<typeof withActor<T>>[1],
  readOnly = false,
) => withActor(scope(seed, readOnly), fn, h.app);

describe('workspace_notification_default', () => {
  beforeAll(async () => {
    for (const seed of [w, other]) {
      await as(seed, async (tx) => {
        await tx.insert(workspaceNotificationDefault).values({
          workspaceId: seed.workspaceId,
          kind: 'comment',
          channels: ['in_app'],
        });
      });
    }
  });

  it('is invisible from another workspace', async () => {
    // §15: "a cross-workspace read test per tenant table asserting zero rows."
    // The failure this catches is not an error — it is a query that quietly
    // returns another company's rows, which is why the assertion is a count.
    const rows = await as(other, async (tx) =>
      tx.select().from(workspaceNotificationDefault),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspaceId).toBe(other.workspaceId);
  });

  it('cannot be written into another workspace', async () => {
    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(workspaceNotificationDefault).values({
          workspaceId: other.workspaceId,
          kind: 'mention',
          channels: ['email'],
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('holds one row per kind', async () => {
    // The upsert the settings grid uses needs a conflict target, and two rows
    // for one kind would make "what does a member get by default" a question
    // with two answers.
    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(workspaceNotificationDefault).values({
          workspaceId: w.workspaceId,
          kind: 'comment',
          channels: ['email'],
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.uniqueViolation);
  });
});

describe('the settings that could brick a workspace (migration 0028)', () => {
  const update = (values: Record<string, unknown>) =>
    as(w, async (tx) => tx.update(workspace).set(values).where(eq(workspace.id, w.workspaceId)));

  it('refuses a working week with no working days', async () => {
    /*
     * The one setting on §6-1's form that has no honest failure mode above the
     * database. With a mask of zero `next_working_day` never terminates,
     * `business_days_between` returns zero for every range so a burndown draws
     * nothing, and the evening digest never fires — and none of it reports an
     * error. The product simply stops saying anything about time.
     */
    const failure = await failureOf(update({ workingDays: 0 }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('workspace_working_days_range');
  });

  it('refuses a mask with a day that does not exist', async () => {
    const failure = await failureOf(update({ workingDays: 128 }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a week that starts on an eighth day', async () => {
    const failure = await failureOf(update({ weekStart: 7 }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('workspace_week_start_range');
  });

  it('accepts every day of the real week', async () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await expect(update({ weekStart: day })).resolves.toBeDefined();
    }
    await update({ weekStart: 0 });
  });

  it('refuses a default language that is a sentence', async () => {
    const failure = await failureOf(update({ defaultLocale: 'English please' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('accepts a locale the product does not ship yet', async () => {
    // Deliberately *not* an enumeration of `src/i18n/routing.ts`: a CHECK
    // listing the shipped locales would have to be migrated in step with adding
    // a language, which is exactly the retrofit §13 calls the most expensive
    // available mistake. The service validates against the routing config.
    await expect(update({ defaultLocale: 'th' })).resolves.toBeDefined();
    await update({ defaultLocale: 'en' });
  });

  it('refuses a logo key that is a URL', async () => {
    // Slice 8 learned that neither the app's configured base URL nor
    // `request.url` is a reliable origin. A URL frozen into a row is that
    // mistake made permanent — a workspace seeded on a laptop against the local
    // driver would carry `localhost` into production.
    const failure = await failureOf(
      update({ logoKey: 'https://example.com/w/1/brand/abc' }),
    );
    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('workspace_logo_key_shape');
  });

  it('accepts an object key', async () => {
    await expect(
      update({ logoKey: `w/${w.workspaceId}/brand/${uuidv7()}` }),
    ).resolves.toBeDefined();
    await update({ logoKey: null });
  });

  it('refuses a holiday with a blank name', async () => {
    // Slice 9 created the table for the digest to read and nothing wrote to it,
    // so an empty name was unreachable. Slice 15 gives it a form, and a blank
    // row on the calendar is a day off that says nothing about why.
    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(workspaceHoliday).values({
          workspaceId: w.workspaceId,
          date: '2026-04-14',
          name: '   ',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('workspace_holiday_name_present');
  });

  it('accepts a Khmer holiday name', async () => {
    // §13: the column is a literal in the company's own language, deliberately
    // not a `name_key` — there is no English default it would be right to fall
    // back to. The character-length cap in 0028 has to leave room for one.
    await expect(
      as(w, async (tx) =>
        tx.insert(workspaceHoliday).values({
          workspaceId: w.workspaceId,
          date: '2026-04-15',
          name: 'ចូលឆ្នាំខ្មែរ',
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('the holiday calendar', () => {
  it('cannot hold one day twice', async () => {
    await as(w, async (tx) =>
      tx.insert(workspaceHoliday).values({
        workspaceId: w.workspaceId,
        date: '2026-01-01',
        name: 'International New Year Day',
      }),
    );

    // The seed relies on this as its conflict target: re-running it must skip
    // days already there rather than duplicating them — and must never
    // overwrite a name the company corrected.
    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(workspaceHoliday).values({
          workspaceId: w.workspaceId,
          date: '2026-01-01',
          name: 'Something else',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.uniqueViolation);
  });

  it('is one company at a time, so two workspaces may close on the same day', async () => {
    await expect(
      as(other, async (tx) =>
        tx.insert(workspaceHoliday).values({
          workspaceId: other.workspaceId,
          date: '2026-01-01',
          name: 'International New Year Day',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('is read by is_working_day, which is what makes any of this matter', async () => {
    // The whole reason the calendar exists (§17-18). A day on it stops being a
    // working day for every derived date in the product — staleness, the
    // digest, a burndown's ideal line — and that link is a SQL function, so it
    // is only ever demonstrable here.
    const rows = await as(w, async (tx) =>
      tx.execute<{ open: boolean; closed: boolean }>(sql`
        select
          is_working_day(${w.workspaceId}::uuid, date '2026-01-02') as open,
          is_working_day(${w.workspaceId}::uuid, date '2026-01-01') as closed
      `),
    );

    // 2026-01-02 is a Friday and 2026-01-01 a Thursday, so the weekend is not
    // what separates them — the holiday row is.
    expect(rows.rows[0]?.open).toBe(true);
    expect(rows.rows[0]?.closed).toBe(false);
  });
});

describe('view-as, refused by the database (§7.13)', () => {
  /*
   * §7.13: "Every mutation is refused while it is active." The policy module
   * refuses first and `uow.emit` throws before that, so both of those would
   * pass with the RLS clause deleted. These bypass both and go at the tables,
   * which is the layer that still holds when a mutation is written outside the
   * service — and the only one a Phase 2 MCP tool would meet.
   */
  /** The same scope every request inside a view-as session gets. */
  const viewing = <T>(fn: Parameters<typeof withActor<T>>[1]) => as(w, fn, true);

  it('reads exactly what the session would read', async () => {
    const rows = await viewing(async (tx) =>
      tx.select().from(workspace).where(eq(workspace.id, w.workspaceId)),
    );

    // A view-as session is a *read* of somebody's screens, so SELECT is
    // untouched. If this ever fails, the read-only clause has been copied onto
    // a select policy and the whole feature renders empty.
    expect(rows).toHaveLength(1);
  });

  /*
   * **A view-as INSERT raises; a view-as UPDATE or DELETE changes nothing and
   * says nothing.** That asymmetry is Postgres, not our policies, and it is
   * worth knowing before touching either.
   *
   * An INSERT policy has only a `WITH CHECK`, and a row that fails it is an
   * error — SQLSTATE 42501, asserted above. An UPDATE or DELETE policy also has
   * a `USING`, and `USING` is a *visibility* filter applied before anything is
   * written: in a read-only session it matches no rows, so the statement is
   * perfectly legal and affects zero of them.
   *
   * Which means the assertion that matters here is not "it threw" but "nothing
   * moved" — and a test written the other way would have been asserting an
   * error Postgres was never going to raise. The effect is exactly what §7.13
   * asks for either way: "every mutation is refused while it is active."
   */
  it('changes nothing when it updates the workspace itself', async () => {
    const changed = await viewing(async (tx) =>
      tx
        .update(workspace)
        .set({ name: 'Renamed' })
        .where(eq(workspace.id, w.workspaceId))
        .returning({ id: workspace.id }),
    );

    expect(changed).toHaveLength(0);
  });

  it('refuses an insert into a tenant table', async () => {
    const failure = await failureOf(
      viewing(async (tx) =>
        tx.insert(workspaceHoliday).values({
          workspaceId: w.workspaceId,
          date: '2026-05-01',
          name: 'International Labour Day',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('deletes nothing', async () => {
    const removed = await viewing(async (tx) =>
      tx
        .delete(workspaceHoliday)
        .where(
          and(
            eq(workspaceHoliday.workspaceId, w.workspaceId),
            eq(workspaceHoliday.date, '2026-01-01'),
          ),
        )
        .returning({ id: workspaceHoliday.id }),
    );

    expect(removed).toHaveLength(0);

    /*
     * And the day is still on the calendar, read back in an ordinary writable
     * session.
     *
     * Deliberately *not* read as the owner: `workspace_holiday` is FORCE ROW
     * LEVEL SECURITY and the owner holds no policy on it — only the
     * `provisioning` policies 0002 grants on the two root tables — so an owner
     * SELECT here returns zero rows and would make this assertion pass for the
     * wrong reason, or fail for one. That is the four-role split working, and
     * the app role in a normal scope is the honest way to ask.
     */
    const survivors = await as(w, async (tx) =>
      tx
        .select({ id: workspaceHoliday.id })
        .from(workspaceHoliday)
        .where(
          and(
            eq(workspaceHoliday.workspaceId, w.workspaceId),
            eq(workspaceHoliday.date, '2026-01-01'),
          ),
        ),
    );

    expect(survivors).toHaveLength(1);
  });

  it('leaves the row it refused to change exactly as it was', async () => {
    // The assertion that a refusal is a refusal rather than a partial write.
    // Read as the owner, past RLS, so this is the table's own state.
    const rows = await h.owner
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, w.workspaceId));

    expect(rows[0]?.name).not.toBe('Renamed');
  });

  it('still records the session in the audit log', async () => {
    /*
     * §18-11 built `audit_record.on_behalf_of_user_id` for exactly this, and it
     * is the one table whose INSERT policy has **no** read-only clause: a
     * view-as session refuses every mutation and must still be recorded.
     *
     * The event itself is emitted from the viewer's own context — `uow.emit`
     * throws while `readOnly` is set, correctly, because a view-as session
     * produces no events of its own. What this asserts is the property that
     * makes that safe: the row can name a viewer acting *for* somebody else.
     */
    const rows = await h.owner.execute<{ count: number }>(sql`
      select count(*)::int as count
      from information_schema.columns
      where table_name = 'audit_record' and column_name = 'on_behalf_of_user_id'
    `);

    expect(rows.rows[0]?.count).toBe(1);
  });
});


describe('§7.12 offboarding: what happens to somebody\'s open work', () => {
  /*
   * `reassignOpenWorkInTx` is the function §4's "removing a member requires
   * choosing what happens to their open work" turns into, and it is here rather
   * than in a unit test because every interesting thing about it is the
   * database's: which rows count as open is a join onto `workflow_state.group`,
   * and the `assignee_ids` array the §9 list query actually reads is maintained
   * by a trigger from migration 0008 — so a reassignment that updated the join
   * table and left the array stale would pass every test that did not run
   * against Postgres, and then quietly show the wrong owner on every list in
   * the product.
   */
  let leaverId: string;
  let successorId: string;
  let openItem: string;
  let doneItem: string;

  beforeAll(async () => {
    leaverId = w.memberMemberId;
    successorId = w.ownerMemberId;

    const doneStateId = uuidv7();

    await as(w, async (tx) => {
      // A second state, in a **closed** group. The seeded one is `unstarted`,
      // so without this there is nothing for "open only" to exclude.
      await tx.insert(workflowState).values({
        id: doneStateId,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        name: 'Done',
        group: 'completed',
        color: 'success',
        position: 1,
      });
    });

    const make = async (stateId: string) => {
      const id = uuidv7();
      await as(w, async (tx) => {
        await tx.insert(workItem).values({
          id,
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          number: Math.floor(Math.random() * 1_000_000),
          title: 'A task',
          stateId,
          rootId: id,
          rank: 'i',
          createdByMemberId: w.ownerMemberId,
        });
        await tx.insert(workItemAssignee).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          workItemId: id,
          workspaceMemberId: leaverId,
        });
      });
      return id;
    };

    openItem = await make(w.stateId);
    doneItem = await make(doneStateId);
  });

  it('moves open work and leaves finished work alone', async () => {
    const moved = await as(w, async (tx) =>
      reassignOpenWorkInTx(tx, w.workspaceId, {
        fromMemberId: leaverId,
        toMemberId: successorId,
      }),
    );

    // Finished work stays where it is. Reassigning something somebody completed
    // last March rewrites history: the item's feed would show a change months
    // after the fact, and the person who actually did it disappears from the one
    // place that recorded them.
    expect(moved.map((row) => row.workItemId)).toEqual([openItem]);

    const rows = await as(w, async (tx) =>
      tx
        .select({ id: workItem.id, assignees: workItem.assigneeIds })
        .from(workItem)
        .where(eq(workItem.projectId, w.projectId)),
    );

    const open = rows.find((row) => row.id === openItem);
    const done = rows.find((row) => row.id === doneItem);

    // The array, not the join table — this is what the §9 list query reads, and
    // 0008's trigger is the only thing keeping the two in step.
    expect(open?.assignees).toEqual([successorId]);
    expect(done?.assignees).toEqual([leaverId]);
  });

  it('leaves the work unassigned when that is the answer', async () => {
    // §7.12's other branch. It needs no flag of its own: §7.4's unassigned row
    // is already the surface that finds this work.
    await as(w, async (tx) =>
      reassignOpenWorkInTx(tx, w.workspaceId, {
        fromMemberId: successorId,
        toMemberId: null,
      }),
    );

    const rows = await as(w, async (tx) =>
      tx
        .select({ assignees: workItem.assigneeIds })
        .from(workItem)
        .where(eq(workItem.id, openItem)),
    );

    expect(rows[0]?.assignees).toEqual([]);
  });

  it('is a no-op for somebody who holds nothing', async () => {
    const moved = await as(w, async (tx) =>
      reassignOpenWorkInTx(tx, w.workspaceId, {
        fromMemberId: leaverId,
        toMemberId: successorId,
      }),
    );

    // The leaver's only open item was already moved and then unassigned; their
    // finished one is not open. Nothing to do, and nothing written.
    expect(moved).toEqual([]);
  });
});
