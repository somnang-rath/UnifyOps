import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '../tenant';
import { team, teamMember, user, workspace, workspaceMember } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * §14's definition of done for slice 1:
 *
 *   "Workspace B cannot read A's rows even with a deliberately unscoped query."
 *
 * Every query below is deliberately unscoped. Not one has a WHERE clause on
 * workspace_id, because the point is that forgetting it is survivable — a
 * scoped data-access layer fails the moment one query is written outside it,
 * and that query is invisible in review (§9).
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'acme');
  b = await seedWorkspace(h, 'borey');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actorFor = (w: SeededWorkspace) => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

describe('cross-workspace reads', () => {
  it('sees only its own workspace row', async () => {
    const rows = await withActor(actorFor(a), (tx) => tx.select().from(workspace), h.app);

    expect(rows.map((r) => r.id)).toEqual([a.workspaceId]);
  });

  // §15's manual check #2 — pasting workspace B's URL while signed in as A —
  // must produce a 404, and this is the row-level fact the 404 is built on.
  it('cannot fetch another workspace by its id', async () => {
    const rows = await withActor(
      actorFor(a),
      (tx) => tx.select().from(workspace).where(sql`id = ${b.workspaceId}`),
      h.app,
    );

    expect(rows).toEqual([]);
  });

  // One case per tenant table, as §15 requires.
  const tenantTables = [
    { name: 'workspace_member', table: workspaceMember },
    { name: 'team', table: team },
    { name: 'team_member', table: teamMember },
  ] as const;

  for (const { name, table } of tenantTables) {
    it(`${name}: an unscoped select returns zero rows from the other workspace`, async () => {
      const rows = await withActor(actorFor(a), (tx) => tx.select().from(table), h.app);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.workspaceId === a.workspaceId)).toBe(true);
    });
  }

  it('app_user is filtered to people who share the workspace', async () => {
    const rows = await withActor(actorFor(a), (tx) => tx.select().from(user), h.app);

    expect(rows.map((r) => r.id).sort()).toEqual([a.ownerUserId, a.memberUserId].sort());
  });
});

describe('scope leakage', () => {
  /**
   * The transaction-local setting is the reason a pooled connection is safe.
   * Two actors in a row over the same small pool must not see each other's
   * scope — and the second read here is the one that would break if the
   * settings were session-local.
   */
  it('does not carry one actor’s scope into the next', async () => {
    const first = await withActor(actorFor(a), (tx) => tx.select().from(team), h.app);
    const second = await withActor(actorFor(b), (tx) => tx.select().from(team), h.app);

    expect(first.map((r) => r.workspaceId)).toEqual([a.workspaceId]);
    expect(second.map((r) => r.workspaceId)).toEqual([b.workspaceId]);
  });

  it('returns nothing at all outside withActor', async () => {
    // No transaction, no settings — tenancy.workspace_id() is NULL, so every
    // policy predicate is false. "Returns nothing", never another company's
    // data (§9).
    const rows = await h.app.select().from(team);

    expect(rows).toEqual([]);
  });
});

describe('cross-workspace writes', () => {
  it('refuses to insert a row into another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(team).values({ workspaceId: b.workspaceId, slug: 'smuggled', name: 'Smuggled' }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/row-level security/i);
  });

  it('refuses to move a row into another workspace', async () => {
    const failure = await failureOf(
      withActor(actorFor(a), (tx) => tx.update(team).set({ workspaceId: b.workspaceId }), h.app),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/row-level security/i);
  });

  it('cannot delete rows it cannot see', async () => {
    // Its own pair, because this one actually removes rows and the shared
    // fixtures are read by every test above.
    const [x, y] = await Promise.all([
      seedWorkspace(h, 'delete-scope-x'),
      seedWorkspace(h, 'delete-scope-y'),
    ]);

    // An unscoped DELETE — the worst version of the mistake.
    await withActor(actorFor(x), (tx) => tx.delete(teamMember), h.app);

    const survivors = await h.operator.select().from(teamMember);
    expect(survivors.some((r) => r.workspaceId === x.workspaceId)).toBe(false);
    expect(survivors.some((r) => r.workspaceId === y.workspaceId)).toBe(true);
  });

  /**
   * The composite foreign keys are the layer below RLS, and the one that
   * catches the case RLS cannot: this row's own `workspace_id` is A, so every
   * policy is satisfied — it is the *parent* that lives in B. Without
   * `(team_id, workspace_id)` referencing `team(id, workspace_id)` this insert
   * would succeed and quietly cross the boundary.
   */
  it('cannot reference a parent in another workspace, even with a valid workspace_id', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(teamMember).values({
            workspaceId: a.workspaceId,
            teamId: b.teamId,
            workspaceMemberId: a.memberMemberId,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
    expect(failure.message).toMatch(/team_member_team_fk/);
  });
});

describe('view-as is read-only (§7.13)', () => {
  /** An owner of A looking at the product as one of A's ordinary members. */
  const viewingAsMember = () => ({
    workspaceId: a.workspaceId,
    userId: a.memberUserId,
    actorUserId: a.ownerUserId,
    readOnly: true,
  });

  it('still reads, as the target member', async () => {
    const rows = await withActor(viewingAsMember(), (tx) => tx.select().from(team), h.app);

    expect(rows.map((r) => r.workspaceId)).toEqual([a.workspaceId]);
  });

  // The policy module refuses these too (slice 2). This is the layer that
  // still holds when a mutation is written outside it.
  it('refuses every mutation, at the database', async () => {
    const failure = await failureOf(
      withActor(
        viewingAsMember(),
        (tx) => tx.insert(team).values({ workspaceId: a.workspaceId, slug: 'x', name: 'X' }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/row-level security/i);
  });
});
