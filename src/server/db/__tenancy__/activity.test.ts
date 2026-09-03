import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { activity, user, workItem, workspaceMember } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The activity sink (§8, slice 7).
 *
 * `registry.test.ts` proves the projectors decide the right things in
 * JavaScript. This proves the half only a real Postgres can: that the rows land
 * inside the transaction that caused them, that they are scoped to one
 * workspace, that nothing can edit them afterwards, and that a view-as session
 * cannot leave a trail saying somebody did something they did not do — the
 * refusal `uow.emit` makes in TypeScript, asked again of the database with the
 * TypeScript bypassed.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'activity-a');
  b = await seedWorkspace(h, 'activity-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actorFor = (w: SeededWorkspace, readOnly = false) => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly,
});

async function makeItem(w: SeededWorkspace): Promise<string> {
  const id = uuidv7();

  await withActor(
    actorFor(w),
    async (tx) => {
      await tx.insert(workItem).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        number: Math.floor(Math.random() * 1_000_000),
        title: 'A task',
        stateId: w.stateId,
        rootId: id,
        rank: 'i',
        createdByMemberId: w.ownerMemberId,
      });
    },
    h.app,
  );

  return id;
}

/** Read back as the operator, so a scoping bug cannot hide behind the reader. */
const feedOf = (workItemId: string) =>
  h.operator
    .select()
    .from(activity)
    .where(eq(activity.workItemId, workItemId))
    .orderBy(activity.occurredAt, activity.id);

describe('writing activity rows', () => {
  it('writes one per projected line, attributed to the actor', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.updated',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          fields: ['title', 'dueDate'],
        });
      },
      h.app,
    );

    const rows = await feedOf(itemId);

    // Two fields moved, so two lines — §8's "one line per name".
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.data as { field: string }).field)).toEqual(['title', 'dueDate']);
    for (const row of rows) {
      expect(row.action).toBe('work_item.updated');
      expect(row.workspaceId).toBe(a.workspaceId);
      expect(row.projectId).toBe(a.projectId);
      expect(row.actorUserId).toBe(a.ownerUserId);
    }
  });

  /**
   * Every row of one transaction shares `occurred_at` — it is transaction start
   * — so the id is what orders them, and a UUIDv7 orders them the way the
   * projectors emitted. Without this the lines would shuffle between reads, and
   * a feed that reorders itself is a feed nobody trusts.
   */
  it('orders rows written together by id, not by chance', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.assigned',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          added: [a.ownerMemberId, a.memberMemberId],
          removed: [],
        });
      },
      h.app,
    );

    const rows = await feedOf(itemId);

    expect(new Set(rows.map((r) => r.occurredAt.getTime())).size).toBe(1);
    expect(rows.map((r) => (r.data as { memberId: string }).memberId)).toEqual([
      a.ownerMemberId,
      a.memberMemberId,
    ]);
    expect([...rows].sort((x, y) => x.id.localeCompare(y.id)).map((r) => r.id)).toEqual(
      rows.map((r) => r.id),
    );
  });

  it('writes nothing for an event the registry projects to nothing', async () => {
    const itemId = await makeItem(b);

    await withActor(
      actorFor(b),
      async (_tx, uow) => {
        // A reorder within one column. Deliberately absent from both sinks.
        uow.emit({
          type: 'work_item.moved',
          workspaceId: b.workspaceId,
          projectId: b.projectId,
          workItemId: itemId,
          stateId: b.stateId,
        });
      },
      h.app,
    );

    expect(await feedOf(itemId)).toEqual([]);
  });

  /**
   * The flush is inside the transaction, so a mutation that rolls back takes
   * its history with it. A feed line describing an edit that never happened is
   * worse than a missing one: this is the screen somebody opens to work out
   * what went wrong.
   */
  it('rolls back with the mutation that produced it', async () => {
    const itemId = await makeItem(a);

    await expect(
      withActor(
        actorFor(a),
        async (_tx, uow) => {
          uow.emit({
            type: 'work_item.blocked_changed',
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: itemId,
            blocked: true,
            reason: 'waiting on the client',
          });
          throw new Error('the mutation failed after emitting');
        },
        h.app,
      ),
    ).rejects.toThrow('the mutation failed after emitting');

    expect(await feedOf(itemId)).toEqual([]);
  });
});

describe('activity is scoped, append-only, and refuses a view-as session', () => {
  // §15's standing requirement, for the table this slice adds.
  it('returns nothing across a workspace boundary', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.created',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          number: 1,
          title: 'A task',
          stateId: a.stateId,
          parentId: null,
        });
      },
      h.app,
    );

    const seenFromB = await withActor(actorFor(b), (tx) => tx.select().from(activity), h.app);

    expect(seenFromB).toEqual([]);
  });

  it('refuses an update and a delete, even to the workspace that wrote it', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.created',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          number: 2,
          title: 'A task',
          stateId: a.stateId,
          parentId: null,
        });
      },
      h.app,
    );

    const update = await failureOf(
      withActor(
        actorFor(a),
        (tx) => tx.update(activity).set({ action: 'work_item.deleted' }),
        h.app,
      ),
    );
    const remove = await failureOf(withActor(actorFor(a), (tx) => tx.delete(activity), h.app));

    // 0010 revokes the privileges, and the table has no UPDATE or DELETE policy.
    // Either layer alone would produce this; both are present on purpose.
    expect(update.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(remove.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(await feedOf(itemId)).toHaveLength(1);
  });

  /**
   * §7.13. `uow.emit` throws before any of this is reached, which is the layer
   * that gives the refusal a sentence — so the insert here is written by hand,
   * exactly as a mutation written outside the unit of work would be.
   *
   * `audit_record` is the deliberate opposite: a view-as session must still be
   * recorded there. It must not appear here, where it would read as the target
   * member having done something themselves.
   */
  it('refuses an insert from a read-only session', async () => {
    const itemId = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        (tx) =>
          tx.insert(activity).values({
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: itemId,
            actorUserId: a.ownerUserId,
            action: 'work_item.created',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(await feedOf(itemId)).toEqual([]);
  });

  // §9's composite key, for this table: a line of history physically cannot
  // hang off an item in another company.
  it('cannot reference a work item in another workspace', async () => {
    const foreign = await makeItem(b);

    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(activity).values({
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: foreign,
            actorUserId: a.ownerUserId,
            action: 'work_item.created',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

/**
 * §7.12: offboarding preserves activity "and attributes it".
 *
 * `app_user`'s select policy used to require a *live* membership, which made
 * that sentence unimplementable — the moment somebody left, every line they had
 * ever written became the work of nobody. 0009 widened it to anyone who has
 * ever been a member of the workspace. What widened is time, not tenancy, and
 * the two assertions below are the two halves of that claim.
 */
describe('attribution outlives membership', () => {
  it('still names a member who has been removed', async () => {
    const itemId = await makeItem(a);

    await withActor(
      {
        workspaceId: a.workspaceId,
        userId: a.memberUserId,
        actorUserId: a.memberUserId,
        readOnly: false,
      },
      async (_tx, uow) => {
        uow.emit({
          type: 'work_item.created',
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemId,
          number: 3,
          title: 'A task',
          stateId: a.stateId,
          parentId: null,
        });
      },
      h.app,
    );

    await withActor(
      actorFor(a),
      (tx) =>
        tx
          .update(workspaceMember)
          .set({ deletedAt: new Date() })
          .where(eq(workspaceMember.id, a.memberMemberId)),
      h.app,
    );

    const named = await withActor(
      actorFor(a),
      (tx) =>
        tx
          .select({ name: user.name })
          .from(activity)
          .innerJoin(user, eq(user.id, activity.actorUserId))
          .where(eq(activity.workItemId, itemId)),
      h.app,
    );

    expect(named.map((r) => r.name)).toEqual(['activity-a member']);

    // The boundary the policy actually exists for is untouched: workspace B
    // still cannot see the account, past membership or not.
    const fromB = await withActor(
      actorFor(b),
      (tx) => tx.select({ id: user.id }).from(user).where(eq(user.id, a.memberUserId)),
      h.app,
    );

    expect(fromB).toEqual([]);
  });
});
