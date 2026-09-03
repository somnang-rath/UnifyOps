import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { workItem, workItemAssignee } from '../schema';
import {
  UnanchoredQueryError,
  countWorkItemsByGroup,
  fetchWorkItemGroups,
} from '@/server/queries/work-items';
import { NONE, emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import type { TenantDb } from '../client';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * The §9 list query, against real Postgres.
 *
 * The unit tests cover the DSL — what parses, what the URL round trip
 * preserves, what a cursor means. None of that touches SQL, and the SQL is the
 * half that fails: a `LATERAL` over a VALUES list, a row-comparison keyset, GIN
 * containment on a trigger-maintained array, and a `union all` branch for the
 * empty bucket. Those are only true if a database says so.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'list-query');
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

const TODAY = '2026-09-02';

/** The query a project's List view issues, anchored to the seeded project. */
function projectQuery(overrides: Partial<WorkItemQuery> = {}): WorkItemQuery {
  const base = emptyQuery();
  return {
    ...base,
    ...overrides,
    filters: {
      ...base.filters,
      ...(overrides.filters ?? {}),
      // Last, so the anchor wins over anything an override happened to carry —
      // exactly what the project page does with a pasted `?p=` naming somebody
      // else's project.
      projectIds: [w.projectId],
    },
  };
}

async function makeItems(count: number, overrides: Partial<typeof workItem.$inferInsert> = {}) {
  const ids: string[] = [];

  await withActor(
    actor(),
    async (tx) => {
      for (let i = 0; i < count; i += 1) {
        const id = uuidv7();
        ids.push(id);
        await tx.insert(workItem).values({
          id,
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          number: 1000 + Math.floor(Math.random() * 1_000_000),
          title: `Item ${i}`,
          stateId: w.stateId,
          rootId: id,
          // Ascending, so the default `rank` sort has a defined order to page
          // through and the assertions can name it.
          rank: `a${String(i).padStart(4, '0')}1`,
          createdByMemberId: w.ownerMemberId,
          ...overrides,
        });
      }
    },
    h.app,
  );

  return ids;
}

const run = <T>(fn: (tx: TenantDb) => Promise<T>) => withActor(actor(), fn, h.app);

describe('the invariant (§9, §16)', () => {
  it('refuses a query with no anchor', async () => {
    await expect(
      run((tx) => fetchWorkItemGroups(tx, emptyQuery(), { groupKeys: ['x'], today: TODAY })),
    ).rejects.toBeInstanceOf(UnanchoredQueryError);
  });

  it('refuses the counts query too, not only the page', async () => {
    // Both entry points, because the one somebody calls in a hurry is whichever
    // one they happened to need.
    await expect(
      run((tx) => countWorkItemsByGroup(tx, emptyQuery(), { today: TODAY })),
    ).rejects.toBeInstanceOf(UnanchoredQueryError);
  });
});

describe('grouping and counting', () => {
  it('returns a group for every key asked for, including empty ones', async () => {
    const groups = await run((tx) =>
      fetchWorkItemGroups(tx, projectQuery(), {
        // A state id that exists, and one that has nothing in it: a board
        // column that vanishes when it empties cannot be dragged into.
        groupKeys: [w.stateId, uuidv7()],
        today: TODAY,
      }),
    );

    expect(groups).toHaveLength(2);
    expect(groups[1]?.rows).toEqual([]);
    expect(groups[1]?.total).toBe(0);
  });

  it('counts every matching row, not only the page', async () => {
    await makeItems(5);

    const groups = await run((tx) =>
      fetchWorkItemGroups(tx, projectQuery({ limit: 2 }), {
        groupKeys: [w.stateId],
        today: TODAY,
      }),
    );

    // A header that says 2 because the page held 2 is the small dishonesty
    // people stop trusting.
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[0]?.total).toBeGreaterThanOrEqual(5);
  });
});

describe('keyset paging (§9)', () => {
  it('walks a group without repeating or skipping a row', async () => {
    const fresh = await seedWorkspace(h, `paging-${Date.now().toString(36)}`);
    const scoped = {
      workspaceId: fresh.workspaceId,
      userId: fresh.ownerUserId,
      actorUserId: fresh.ownerUserId,
      readOnly: false,
    };

    await withActor(
      scoped,
      async (tx) => {
        for (let i = 0; i < 12; i += 1) {
          const id = uuidv7();
          await tx.insert(workItem).values({
            id,
            workspaceId: fresh.workspaceId,
            projectId: fresh.projectId,
            number: i + 1,
            title: `Paged ${i}`,
            stateId: fresh.stateId,
            rootId: id,
            rank: `a${String(i).padStart(4, '0')}1`,
            createdByMemberId: fresh.ownerMemberId,
          });
        }
      },
      h.app,
    );

    const query: WorkItemQuery = {
      ...emptyQuery(),
      limit: 5,
      filters: { ...emptyQuery().filters, projectIds: [fresh.projectId] },
    };

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 5; page += 1) {
      const groups: Awaited<ReturnType<typeof fetchWorkItemGroups>> = await withActor(
        scoped,
        (tx) =>
          fetchWorkItemGroups(tx, query, {
            groupKeys: [fresh.stateId],
            cursors: { [fresh.stateId]: cursor },
            today: TODAY,
          }),
        h.app,
      );

      const group = groups[0]!;
      seen.push(...group.rows.map((row) => row.title));
      cursor = group.nextCursor;
      if (!cursor) break;
    }

    // Every row, exactly once, in rank order. Offset pagination would repeat or
    // skip here the moment anything were inserted mid-walk; keyset cannot.
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `Paged ${i}`));
    expect(cursor).toBeNull();
  });
});

describe('the denormalized arrays, as filters (§9)', () => {
  it('finds an item by assignee without joining', async () => {
    const [itemId] = await makeItems(1, { title: 'Assigned to the owner' });

    await run(async (tx) => {
      await tx.insert(workItemAssignee).values({
        id: uuidv7(),
        workspaceId: w.workspaceId,
        workItemId: itemId!,
        workspaceMemberId: w.ownerMemberId,
      });
    });

    const groups = await run((tx) =>
      fetchWorkItemGroups(
        tx,
        projectQuery({ filters: { ...emptyQuery().filters, assignees: [w.ownerMemberId] } }),
        { groupKeys: [w.stateId], today: TODAY },
      ),
    );

    expect(groups[0]?.rows.map((row) => row.title)).toContain('Assigned to the owner');
  });

  it('finds unassigned work through the `none` sentinel', async () => {
    await makeItems(1, { title: 'Nobody owns this' });

    const groups = await run((tx) =>
      fetchWorkItemGroups(
        tx,
        projectQuery({ filters: { ...emptyQuery().filters, assignees: [NONE] } }),
        { groupKeys: [w.stateId], today: TODAY },
      ),
    );

    expect(groups[0]?.rows.map((row) => row.title)).toContain('Nobody owns this');
  });

  it('groups by assignee, with a `none` bucket that is its own union branch', async () => {
    const groups = await run((tx) =>
      fetchWorkItemGroups(tx, projectQuery({ groupBy: 'assignee' }), {
        groupKeys: [w.ownerMemberId, NONE],
        today: TODAY,
      }),
    );

    expect(groups.map((group) => group.key)).toEqual([w.ownerMemberId, NONE]);
    expect(groups[1]!.total).toBeGreaterThan(0);
  });
});

describe('due windows, in the workspace timezone (§4, §17-13)', () => {
  it('separates overdue from due-today from later', async () => {
    await makeItems(1, { title: 'Late', dueDate: '2026-08-30' });
    await makeItems(1, { title: 'Today', dueDate: TODAY });
    await makeItems(1, { title: 'Later', dueDate: '2026-12-01' });

    const titlesFor = async (due: WorkItemQuery['filters']['due']) => {
      const groups = await run((tx) =>
        fetchWorkItemGroups(tx, projectQuery({ filters: { ...emptyQuery().filters, due } }), {
          groupKeys: [w.stateId],
          today: TODAY,
        }),
      );
      return groups[0]!.rows.map((row) => row.title);
    };

    expect(await titlesFor('overdue')).toContain('Late');
    expect(await titlesFor('overdue')).not.toContain('Today');
    expect(await titlesFor('today')).toEqual(['Today']);
    expect(await titlesFor('week')).toContain('Today');
    expect(await titlesFor('week')).not.toContain('Later');
  });
});

describe('sorting', () => {
  it('orders by priority in §12 order, not alphabetically', async () => {
    const fresh = await seedWorkspace(h, `sorting-${Date.now().toString(36)}`);
    const scoped = {
      workspaceId: fresh.workspaceId,
      userId: fresh.ownerUserId,
      actorUserId: fresh.ownerUserId,
      readOnly: false,
    };

    await withActor(
      scoped,
      async (tx) => {
        for (const [i, priority] of (['low', 'urgent', 'none', 'high'] as const).entries()) {
          const id = uuidv7();
          await tx.insert(workItem).values({
            id,
            workspaceId: fresh.workspaceId,
            projectId: fresh.projectId,
            number: i + 1,
            title: priority,
            stateId: fresh.stateId,
            priority,
            rootId: id,
            rank: `a${i}1`,
            createdByMemberId: fresh.ownerMemberId,
          });
        }
      },
      h.app,
    );

    const groups = await withActor(
      scoped,
      (tx) =>
        fetchWorkItemGroups(
          tx,
          {
            ...emptyQuery(),
            sort: 'priority',
            filters: { ...emptyQuery().filters, projectIds: [fresh.projectId] },
          },
          { groupKeys: [fresh.stateId], today: TODAY },
        ),
      h.app,
    );

    // Alphabetically this would be high, low, none, urgent.
    expect(groups[0]?.rows.map((row) => row.title)).toEqual(['urgent', 'high', 'low', 'none']);
  });
});
