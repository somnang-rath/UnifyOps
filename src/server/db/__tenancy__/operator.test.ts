import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { team, workspace } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The platform operator (§18-12).
 *
 * A separate role behind its own auth boundary, with cross-tenant READ and
 * nothing else. Anything that must act inside a workspace goes through an
 * invited account plus view-as — which §18-11 has made auditable.
 *
 * The shape this suite exists to rule out is the alternative that was
 * rejected: a bypass policy keyed to a session variable. That would put the
 * escape hatch on the connection the app already holds, one SET away from any
 * bug that can influence session state.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'op-a');
  b = await seedWorkspace(h, 'op-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('the operator role', () => {
  it('reads across every workspace without setting any tenancy variable', async () => {
    const rows = await h.operator.select().from(workspace);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.workspaceId);
    expect(ids).toContain(b.workspaceId);
  });

  it('cannot insert', async () => {
    const failure = await failureOf(
      h.operator.insert(team).values({ workspaceId: a.workspaceId, slug: 'op', name: 'Op' }),
    );

    // Refused by the grant system, not by a policy — the operator holds SELECT
    // and nothing else, so there is no write to filter.
    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied/i);
  });

  it('cannot update', async () => {
    const failure = await failureOf(h.operator.update(workspace).set({ name: 'Renamed' }));

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied/i);
  });

  it('cannot delete', async () => {
    const failure = await failureOf(h.operator.delete(team));

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied/i);
  });
});

describe('the app role has no cross-tenant escape hatch', () => {
  /**
   * The rejected design, written out as a test: if scope could be widened by
   * a session variable, this is the shape the bug would take — a stray
   * `set_config` on the connection the app already holds.
   */
  it('cannot widen its scope by setting a variable', async () => {
    const rows = await h.app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('unifyops.workspace_id', ${a.workspaceId}, true)`);
      await tx.execute(sql`select set_config('unifyops.bypass', 'on', true)`);
      await tx.execute(sql`select set_config('unifyops.operator', 'on', true)`);
      return tx.select().from(workspace);
    });

    // Scoped to A and no wider, whatever else was set alongside it.
    expect(rows.map((r) => r.id)).toEqual([a.workspaceId]);
  });

  it('cannot become the operator', async () => {
    const failure = await failureOf(
      h.app.transaction((tx) => tx.execute(sql`set local role unifyops_operator`)),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied to set role|must be (a )?member/i);
  });
});
