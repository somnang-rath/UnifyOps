import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { project, savedView } from '../schema';
import { fetchSavedView, fetchSavedViews, countSavedViews } from '@/server/queries/saved-views';
import { MAX_VIEW_QUERY_LENGTH } from '@/lib/saved-views';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Saved views against real Postgres (§4, slice 12).
 *
 * §15 asks for "a cross-workspace read test per tenant table", which is the
 * first block below and the reason this file exists at all. The rest pins the
 * four things that are only true if a database says so:
 *
 *   * **The composite foreign key.** A view's project must be in the view's
 *     workspace — §9's device, and nothing in TypeScript enforces it.
 *
 *   * **The unique on (owner, name).** Two of one person's own views called
 *     "This week" is a picker they cannot use; two *different people's* views
 *     with that name is the ordinary case, and the index has to tell them
 *     apart.
 *
 *   * **The two CHECKs in migration 0022.** They exist because a row written by
 *     a seed script, a CSV importer or a Phase 2 MCP tool has to be as correct
 *     as one the service wrote — so they are asserted with the service bypassed,
 *     which is the only way to assert them at all.
 *
 *   * **The owner predicate.** What stops one person reading another's saved
 *     views is not a §10 rule, it is `owner_member_id` in every query. RLS
 *     cannot help here — both members are in one workspace — so this is the
 *     layer, and it is worth a test that says so.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'views-a');
  other = await seedWorkspace(h, 'views-b');
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

/** Distinct default names, so the unique on (owner, name) is not tripped by accident. */
let sequence = 0;

async function makeView(
  input: {
    name?: string;
    query?: string;
    ownerMemberId?: string;
    projectId?: string | null;
    layout?: unknown;
  } = {},
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(savedView).values({
      id,
      workspaceId: ws.workspaceId,
      ownerMemberId: input.ownerMemberId ?? ws.ownerMemberId,
      projectId: input.projectId === undefined ? ws.projectId : input.projectId,
      name: input.name ?? `View ${(sequence += 1)}`,
      query: input.query ?? 'd=overdue',
      layout: input.layout ?? null,
    });
  });
  return id;
}

describe('cross-workspace reads (§15)', () => {
  it('returns zero rows for another workspace, even with a deliberately unscoped query', async () => {
    const mine = await makeView({ name: 'Mine' });

    const seen = await as(other, async (tx) =>
      // Deliberately unscoped: no `workspace_id` predicate at all. RLS is what
      // makes this empty rather than a leak, which is the whole §16 argument.
      tx.select({ id: savedView.id }).from(savedView),
    );

    expect(seen.map((row) => row.id)).not.toContain(mine);
  });

  it('cannot be read by id from another workspace', async () => {
    const mine = await makeView({ name: 'Also mine' });

    const found = await as(other, (tx) =>
      fetchSavedView(tx, { id: mine, ownerMemberId: other.ownerMemberId }),
    );

    expect(found).toBeNull();
  });
});

describe('one person cannot read another person s views', () => {
  it('scopes the list to the acting member, inside one workspace', async () => {
    // Both members are in the same workspace, so RLS lets both rows through and
    // the owner column is the only thing separating them.
    const ownersView = await makeView({ name: 'Owner view', ownerMemberId: w.ownerMemberId });
    const membersView = await makeView({ name: 'Member view', ownerMemberId: w.memberMemberId });

    const forOwner = await as(w, (tx) =>
      fetchSavedViews(tx, { ownerMemberId: w.ownerMemberId, projectId: w.projectId }),
    );
    const ids = forOwner.map((row) => row.id);

    expect(ids).toContain(ownersView);
    expect(ids).not.toContain(membersView);
  });

  it('refuses to load another member s view by id', async () => {
    const membersView = await makeView({ name: 'Private plan', ownerMemberId: w.memberMemberId });

    const found = await as(w, (tx) =>
      fetchSavedView(tx, { id: membersView, ownerMemberId: w.ownerMemberId }),
    );

    expect(found).toBeNull();
  });
});

describe('the composite foreign key (§9)', () => {
  it('refuses a view whose project belongs to another workspace', async () => {
    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(savedView).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          ownerMemberId: w.ownerMemberId,
          // A real project, in the wrong company. The tenant column alone would
          // not catch this; the two-column key does.
          projectId: other.projectId,
          name: 'Cross-tenant',
          query: '',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('goes with the project when the project is deleted', async () => {
    // `cascade`, unlike the cycle's `restrict`: a view of a deleted project
    // describes nothing, where a cycle still holds work somebody has to decide
    // about.
    const scratch = await seedWorkspace(h, 'views-cascade');
    const id = await makeView({ name: 'Doomed' }, scratch);

    await as(scratch, async (tx) => {
      await tx.delete(project).where(eq(project.id, scratch.projectId));
    });

    const found = await as(scratch, (tx) =>
      fetchSavedView(tx, { id, ownerMemberId: scratch.ownerMemberId }),
    );
    expect(found).toBeNull();
  });
});

describe('the unique on (owner, name)', () => {
  it('refuses one person two views with the same name', async () => {
    await makeView({ name: 'This week' });

    const failure = await failureOf(makeView({ name: 'This week' }));
    expect(failure.code).toBe(SQLSTATE.uniqueViolation);
  });

  it('allows two people the same name', async () => {
    const scratch = await seedWorkspace(h, 'views-names');
    await makeView({ name: 'This week', ownerMemberId: scratch.ownerMemberId }, scratch);

    await expect(
      makeView({ name: 'This week', ownerMemberId: scratch.memberMemberId }, scratch),
    ).resolves.toBeTypeOf('string');
  });
});

describe('the invariants in migration 0022', () => {
  it('refuses a nameless view, whatever wrote it', async () => {
    // The service trims and refuses this; the CHECK is what catches the row a
    // seed script or an importer writes.
    const failure = await failureOf(makeView({ name: '   ' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('saved_view_name_present');
  });

  it('refuses a query longer than the cap the TypeScript side states', async () => {
    const failure = await failureOf(makeView({ query: 'x'.repeat(MAX_VIEW_QUERY_LENGTH + 1) }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('saved_view_query_bounded');
  });

  it('accepts a query exactly at the cap', async () => {
    await expect(makeView({ query: 'x'.repeat(MAX_VIEW_QUERY_LENGTH) })).resolves.toBeTypeOf(
      'string',
    );
  });
});

describe('a view-as session (§7.13)', () => {
  it('may read saved views but may not write one', async () => {
    const readOnlyActor = { ...actor(w), readOnly: true };

    // Reading is fine: view-as is a read-only session, not a blind one.
    await expect(
      withActor(readOnlyActor, (tx) => countSavedViews(tx, w.ownerMemberId), h.app),
    ).resolves.toBeTypeOf('number');

    const failure = await failureOf(
      withActor(
        readOnlyActor,
        async (tx) =>
          tx.insert(savedView).values({
            id: uuidv7(),
            workspaceId: w.workspaceId,
            ownerMemberId: w.ownerMemberId,
            projectId: w.projectId,
            name: 'While viewing as',
            query: '',
          }),
        h.app,
      ),
    );

    // The `not tenancy.is_read_only()` half of every mutation policy. The
    // service refuses first; this is the layer that still holds when a mutation
    // is written outside it.
    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('the stored layout', () => {
  it('round-trips through jsonb and is parsed on the way out', async () => {
    const id = await makeView({
      name: 'With a layout',
      // Deliberately including junk a client should never send: the parser is
      // what keeps a stored blob from reaching the renderer.
      layout: { columns: ['title', 'nonsense', 'state'], widths: { title: 5000 } },
    });

    const found = await as(w, (tx) => fetchSavedView(tx, { id, ownerMemberId: w.ownerMemberId }));

    expect(found?.layout.columns).toEqual(['title', 'state']);
    expect(found?.layout.widths.title).toBe(640);
  });
});
