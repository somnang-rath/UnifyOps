import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { label, projectCounter, workItem, workItemAssignee, workItemLabel } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Slice 5's tables, against the guarantees they are supposed to carry.
 *
 * Two of these are §15's standing requirement — a cross-workspace read test per
 * tenant table, asserting zero rows, and a composite-key test asserting a row
 * cannot reference a parent in another workspace. The rest are the trigger
 * layer migration 0008 introduced, which is where the interesting failures live
 * now: the arrays the §9 list query reads are maintained by the database, the
 * sub-item depth cap is enforced by the database, and the human identifier is
 * gapless because of a lock the database takes. None of those are checkable by
 * reading the TypeScript.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'items-a');
  b = await seedWorkspace(h, 'items-b');
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

/** One item in a workspace's seeded project, in its seeded state. */
async function makeItem(
  w: SeededWorkspace,
  overrides: Partial<typeof workItem.$inferInsert> = {},
): Promise<string> {
  const id = (overrides.id as string) ?? uuidv7();

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
        ...overrides,
      });
    },
    h.app,
  );

  return id;
}

describe('cross-workspace reads return nothing (§15)', () => {
  it('hides work items, assignments, labelling and counters', async () => {
    const itemId = await makeItem(a);

    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(label).values({
          id: uuidv7(),
          workspaceId: a.workspaceId,
          name: 'client',
          color: 'lilac',
        });
        await tx.insert(workItemAssignee).values({
          id: uuidv7(),
          workspaceId: a.workspaceId,
          workItemId: itemId,
          workspaceMemberId: a.memberMemberId,
        });
        await tx.insert(projectCounter).values({
          id: uuidv7(),
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          lastNumber: 7,
        });
      },
      h.app,
    );

    // Scoped to B, and deliberately querying with no WHERE at all — the point
    // of RLS over a remembered predicate is that the unscoped query is the one
    // that stays safe.
    const seen = await withActor(
      actorFor(b),
      async (tx) => ({
        items: await tx.select().from(workItem),
        assignees: await tx.select().from(workItemAssignee),
        labels: await tx.select().from(label),
        counters: await tx.select().from(projectCounter),
      }),
      h.app,
    );

    expect(seen.items).toEqual([]);
    expect(seen.assignees).toEqual([]);
    expect(seen.labels).toEqual([]);
    expect(seen.counters).toEqual([]);
  });
});

describe('composite foreign keys', () => {
  it('refuses a work item whose project is in another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) => {
          const id = uuidv7();
          return tx.insert(workItem).values({
            id,
            workspaceId: a.workspaceId,
            projectId: b.projectId,
            number: 1,
            title: 'Smuggled',
            stateId: a.stateId,
            rootId: id,
            rank: 'i',
            createdByMemberId: a.ownerMemberId,
          });
        },
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses a work item that borrows another workspace’s state', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) => {
          const id = uuidv7();
          return tx.insert(workItem).values({
            id,
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            number: 2,
            title: 'Borrowed state',
            stateId: b.stateId,
            rootId: id,
            rank: 'i',
            createdByMemberId: a.ownerMemberId,
          });
        },
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses assigning somebody from another workspace', async () => {
    const itemId = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(workItemAssignee).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            workItemId: itemId,
            workspaceMemberId: b.memberMemberId,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('the denormalized arrays (§9)', () => {
  it('are maintained by the database, not by the caller', async () => {
    // The whole point: a row written outside src/server/services is as correct
    // as one written by it, because nothing in TypeScript maintains this.
    const itemId = await makeItem(a);

    const after = await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(workItemAssignee).values([
          {
            id: uuidv7(),
            workspaceId: a.workspaceId,
            workItemId: itemId,
            workspaceMemberId: a.ownerMemberId,
          },
          {
            id: uuidv7(),
            workspaceId: a.workspaceId,
            workItemId: itemId,
            workspaceMemberId: a.memberMemberId,
          },
        ]);

        return tx.select().from(workItem).where(eq(workItem.id, itemId));
      },
      h.app,
    );

    expect(after[0]?.assigneeIds.slice().sort()).toEqual(
      [a.ownerMemberId, a.memberMemberId].sort(),
    );
  });

  it('shrink again when an assignment is removed', async () => {
    const itemId = await makeItem(a);

    const after = await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(workItemAssignee).values({
          id: uuidv7(),
          workspaceId: a.workspaceId,
          workItemId: itemId,
          workspaceMemberId: a.ownerMemberId,
        });
        await tx
          .delete(workItemAssignee)
          .where(
            and(
              eq(workItemAssignee.workItemId, itemId),
              eq(workItemAssignee.workspaceMemberId, a.ownerMemberId),
            ),
          );

        return tx.select().from(workItem).where(eq(workItem.id, itemId));
      },
      h.app,
    );

    expect(after[0]?.assigneeIds).toEqual([]);
  });

  it('track labels the same way', async () => {
    const itemId = await makeItem(a);
    const labelId = uuidv7();

    const after = await withActor(
      actorFor(a),
      async (tx) => {
        await tx
          .insert(label)
          .values({ id: labelId, workspaceId: a.workspaceId, name: 'design', color: 'chartreuse' });
        await tx.insert(workItemLabel).values({
          id: uuidv7(),
          workspaceId: a.workspaceId,
          workItemId: itemId,
          labelId,
        });

        return tx.select().from(workItem).where(eq(workItem.id, itemId));
      },
      h.app,
    );

    expect(after[0]?.labelIds).toEqual([labelId]);
  });
});

describe('the sub-item hierarchy (§4, §9)', () => {
  it('makes a root item its own root', async () => {
    const id = await makeItem(a);

    const rows = await withActor(
      actorFor(a),
      (tx) => tx.select().from(workItem).where(eq(workItem.id, id)),
      h.app,
    );

    expect(rows[0]?.rootId).toBe(id);
    expect(rows[0]?.depth).toBe(0);
  });

  it('gives a child its parent’s root and the next depth', async () => {
    const parent = await makeItem(a);
    const child = await makeItem(a, { parentId: parent });
    const grandchild = await makeItem(a, { parentId: child });

    const rows = await withActor(
      actorFor(a),
      (tx) =>
        tx
          .select({ id: workItem.id, rootId: workItem.rootId, depth: workItem.depth })
          .from(workItem)
          .where(eq(workItem.rootId, parent)),
      h.app,
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(child)?.depth).toBe(1);
    expect(byId.get(grandchild)?.depth).toBe(2);
    expect(byId.get(grandchild)?.rootId).toBe(parent);
  });

  it('refuses a fourth level', async () => {
    // §4 caps sub-items at three levels. Enforced here rather than only in the
    // service, so an importer or a seed script cannot exceed it either.
    const parent = await makeItem(a);
    const child = await makeItem(a, { parentId: parent });
    const grandchild = await makeItem(a, { parentId: child });

    const failure = await failureOf(makeItem(a, { parentId: grandchild }));
    expect(failure.message).toMatch(/three levels/);
  });

  it('refuses an item that is its own parent', async () => {
    const id = uuidv7();
    const failure = await failureOf(makeItem(a, { id, parentId: id }));
    expect(failure.message).toMatch(/own parent/);
  });

  it('moves a whole subtree when its parent is re-parented', async () => {
    const first = await makeItem(a);
    const second = await makeItem(a);
    const child = await makeItem(a, { parentId: first });
    const grandchild = await makeItem(a, { parentId: child });

    const rows = await withActor(
      actorFor(a),
      async (tx) => {
        await tx.update(workItem).set({ parentId: second }).where(eq(workItem.id, child));

        return tx
          .select({ id: workItem.id, rootId: workItem.rootId, depth: workItem.depth })
          .from(workItem)
          .where(eq(workItem.rootId, second));
      },
      h.app,
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    // The descendant has to follow, or "all descendants of X" — the reason §9
    // chose this shape over a closure table — silently returns the wrong set.
    expect(byId.get(child)?.depth).toBe(1);
    expect(byId.get(grandchild)?.depth).toBe(2);
    expect(byId.get(grandchild)?.rootId).toBe(second);
  });

  it('refuses a move that would nest the subtree too deep', async () => {
    const root = await makeItem(a);
    const child = await makeItem(a, { parentId: root });
    const grandchild = await makeItem(a, { parentId: child });

    const orphanRoot = await makeItem(a);
    const orphanChild = await makeItem(a, { parentId: orphanRoot });

    // Moving a two-level subtree under something already two levels down would
    // make four. The row itself passes the BEFORE check; the AFTER trigger is
    // what catches the descendants.
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) => tx.update(workItem).set({ parentId: grandchild }).where(eq(workItem.id, orphanChild)),
        h.app,
      ),
    );

    expect(failure.message).toMatch(/three levels/);
  });

  it('refuses a cycle', async () => {
    const root = await makeItem(a);
    const child = await makeItem(a, { parentId: root });

    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) => tx.update(workItem).set({ parentId: child }).where(eq(workItem.id, root)),
        h.app,
      ),
    );

    expect(failure.message).toMatch(/descendant/);
  });
});

describe('human identifiers (§9, §17-11)', () => {
  it('are gapless under concurrency, because the upsert takes the row lock', async () => {
    // Twenty allocations at once, through the same single statement the service
    // uses. A read-then-write would hand two callers the same number here; a
    // sequence would leave gaps when one rolls back. Gapless means the results
    // are twenty distinct consecutive integers.
    const allocate = () =>
      withActor(
        actorFor(a),
        async (tx) => {
          const rows = await tx.execute<{ last_number: number }>(sql`
            insert into project_counter (id, workspace_id, project_id, last_number)
            values (${uuidv7()}, ${a.workspaceId}, ${a.projectId}, 1)
            on conflict (project_id) do update set last_number = project_counter.last_number + 1
            returning last_number
          `);
          return rows.rows[0]!.last_number;
        },
        h.app,
      );

    const numbers = (await Promise.all(Array.from({ length: 20 }, allocate))).sort(
      (x, y) => x - y,
    );

    expect(new Set(numbers).size).toBe(20);
    expect(numbers.at(-1)! - numbers[0]!).toBe(19);
  });

  it('refuses a counter pointing at another workspace’s project', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(projectCounter).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            projectId: b.projectId,
            lastNumber: 1,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('view-as refuses every work-item mutation (§7.13)', () => {
  it('will not let a read-only session create one', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        (tx) => {
          const id = uuidv7();
          return tx.insert(workItem).values({
            id,
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            number: 9999,
            title: 'While viewing as somebody else',
            stateId: a.stateId,
            rootId: id,
            rank: 'i',
            createdByMemberId: a.ownerMemberId,
          });
        },
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});
