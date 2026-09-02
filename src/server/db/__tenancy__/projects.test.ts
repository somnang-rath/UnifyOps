import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { project, projectMember, workflowState } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Slice 4's tables, against the two guarantees §9 makes about every tenant
 * table: RLS hides another workspace's rows, and the composite foreign keys
 * mean a cross-workspace row cannot be written in the first place.
 *
 * The second one is the interesting half here. `project` is the first table
 * whose parent is itself a tenant table with two children — a project points at
 * a team, and a workflow state and a project member each point at the project —
 * so this is where a missing composite key would first let a row from workspace
 * A hang off a parent in workspace B.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'projects-a');
  b = await seedWorkspace(h, 'projects-b');
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

describe('composite foreign keys', () => {
  it('refuses a project whose team is in another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(project).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            // A real team id — just not one of A's.
            teamId: b.teamId,
            slug: 'stolen',
            key: 'STL',
            name: 'Borrowed team',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses a workflow state whose project is in another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(workflowState).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            projectId: b.projectId,
            name: 'Smuggled',
            group: 'started',
            color: 'warning',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses a project member from another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(projectMember).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workspaceMemberId: b.ownerMemberId,
            role: 'lead',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('cross-workspace reads', () => {
  // §15 asks for one unscoped-read case per tenant table; isolation.test.ts now
  // covers all three. This is the sharper version: the id is known, and it still
  // comes back empty rather than as a row.
  it('cannot fetch another workspace project by its id', async () => {
    const rows = await withActor(
      actorFor(a),
      (tx) => tx.select().from(project).where(sql`id = ${b.projectId}`),
      h.app,
    );

    expect(rows).toEqual([]);
  });

  it('cannot update another workspace project', async () => {
    const updated = await withActor(
      actorFor(a),
      (tx) =>
        tx
          .update(project)
          .set({ name: 'Renamed by A' })
          .where(sql`id = ${b.projectId}`)
          .returning({ id: project.id }),
      h.app,
    );

    // Not an error — the row is simply not visible to the UPDATE, which is the
    // failure mode §9 wants: "returns nothing" rather than "returns someone
    // else's data".
    expect(updated).toEqual([]);

    const [row] = await withActor(
      actorFor(b),
      (tx) => tx.select({ name: project.name }).from(project).where(sql`id = ${b.projectId}`),
      h.app,
    );
    expect(row?.name).not.toBe('Renamed by A');
  });
});

describe('view-as is refused by the database, not only by the policy module', () => {
  it('refuses to create a project in a read-only session', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        (tx) =>
          tx.insert(project).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            teamId: a.teamId,
            slug: 'while-viewing',
            key: 'VW',
            name: 'Created during view-as',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  // An UPDATE refused by RLS does not raise: the policy's USING clause simply
  // matches no rows, so the statement succeeds having changed nothing. Only the
  // INSERT above raises, because a WITH CHECK violation is an error rather than
  // an invisible row. Both are enforcement — but a test that expects the wrong
  // one of the two passes for the wrong reason, or fails while the database is
  // doing exactly what it should.
  it('changes nothing when a read-only session updates a workflow state', async () => {
    const updated = await withActor(
      actorFor(a, true),
      (tx) =>
        tx
          .update(workflowState)
          .set({ name: 'Renamed during view-as' })
          .where(sql`id = ${a.stateId}`)
          .returning({ id: workflowState.id }),
      h.app,
    );

    expect(updated).toEqual([]);

    const [row] = await withActor(
      actorFor(a),
      (tx) =>
        tx.select({ name: workflowState.name }).from(workflowState).where(sql`id = ${a.stateId}`),
      h.app,
    );
    expect(row?.name).toBe('Todo');
  });

  it('refuses to delete a workflow state in a read-only session', async () => {
    const deleted = await withActor(
      actorFor(a, true),
      (tx) =>
        tx.delete(workflowState).where(sql`id = ${a.stateId}`).returning({ id: workflowState.id }),
      h.app,
    );

    expect(deleted).toEqual([]);
  });

  it('still allows reading, which is the whole point of view-as', async () => {
    const rows = await withActor(
      actorFor(a, true),
      (tx) => tx.select({ id: workflowState.id }).from(workflowState),
      h.app,
    );

    expect(rows.map((r) => r.id)).toEqual([a.stateId]);
  });
});
