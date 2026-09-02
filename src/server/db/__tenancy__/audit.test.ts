import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '../tenant';
import { auditRecord, team } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The audit sink (§18-11).
 *
 * Audit rows come from a second sink on the event registry, not from "every
 * mutation writes a row" — so what is *absent* from the log is as much a part
 * of the contract as what is present.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'audit-a');
  b = await seedWorkspace(h, 'audit-b');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const ordinaryActor = (w: SeededWorkspace) => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

describe('writing audit rows', () => {
  it('writes one for an auditable event, in the same transaction', async () => {
    await withActor(
      ordinaryActor(a),
      async (tx, uow) => {
        await tx
          .insert(team)
          .values({ workspaceId: a.workspaceId, slug: 'audited', name: 'Audited' });
        uow.emit({
          type: 'team.created',
          workspaceId: a.workspaceId,
          teamId: a.teamId,
          slug: 'audited',
          name: 'Audited',
        });
      },
      h.app,
    );

    const rows = await h.operator
      .select()
      .from(auditRecord)
      .where(eq(auditRecord.workspaceId, a.workspaceId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('team.created');
    expect(rows[0]?.subjectType).toBe('team');
    expect(rows[0]?.actorUserId).toBe(a.ownerUserId);
    expect(rows[0]?.onBehalfOfUserId).toBeNull();
    expect(rows[0]?.data).toEqual({ slug: 'audited', name: 'Audited' });
  });

  it('writes nothing for an event the registry marks not auditable', async () => {
    await withActor(
      ordinaryActor(b),
      async (_tx, uow) => {
        uow.emit({
          type: 'team.member_added',
          workspaceId: b.workspaceId,
          teamId: b.teamId,
          memberId: b.memberMemberId,
        });
      },
      h.app,
    );

    const rows = await h.operator
      .select()
      .from(auditRecord)
      .where(eq(auditRecord.workspaceId, b.workspaceId));

    expect(rows).toEqual([]);
  });

  /**
   * The flush happens before commit, so a failed mutation leaves no audit row.
   * An audit row that survives a rolled-back change is a lie about what
   * happened.
   */
  it('leaves no row behind when the transaction rolls back', async () => {
    const before = await h.operator.select().from(auditRecord);

    await expect(
      withActor(
        ordinaryActor(a),
        async (_tx, uow) => {
          uow.emit({
            type: 'workspace.renamed',
            workspaceId: a.workspaceId,
            from: 'audit-a Ltd',
            to: 'Renamed',
          });
          throw new Error('mutation failed after the event was emitted');
        },
        h.app,
      ),
    ).rejects.toThrow(/mutation failed/);

    const after = await h.operator.select().from(auditRecord);
    expect(after).toHaveLength(before.length);
  });
});

describe('view-as is visible in the log (§18-11)', () => {
  /**
   * A view-as session refuses mutations, but the session itself is exactly
   * what the log exists to record — so audit_record has no `not read_only`
   * clause on its INSERT policy, unlike every other table.
   */
  it('records both the principal and the member they acted as', async () => {
    await withActor(
      {
        workspaceId: a.workspaceId,
        userId: a.memberUserId,
        actorUserId: a.ownerUserId,
        readOnly: true,
      },
      async (tx) => {
        await tx.insert(auditRecord).values({
          workspaceId: a.workspaceId,
          actorKind: 'member',
          actorUserId: a.ownerUserId,
          onBehalfOfUserId: a.memberUserId,
          action: 'workspace.viewed_as',
          subjectType: 'workspace_member',
          subjectId: a.memberMemberId,
          data: {},
        });
      },
      h.app,
    );

    const rows = await h.operator
      .select()
      .from(auditRecord)
      .where(eq(auditRecord.action, 'workspace.viewed_as'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(a.ownerUserId);
    expect(rows[0]?.onBehalfOfUserId).toBe(a.memberUserId);
  });
});

describe('append-only, at the database', () => {
  it('refuses UPDATE even to the workspace owner', async () => {
    const failure = await failureOf(
      withActor(ordinaryActor(a), (tx) => tx.update(auditRecord).set({ action: 'tampered' }), h.app),
    );

    // The privilege is revoked, so this is refused before any policy is even
    // consulted — one of the two independent layers §18-11 asks for.
    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied/i);
  });

  it('refuses DELETE even to the workspace owner', async () => {
    const failure = await failureOf(
      withActor(ordinaryActor(a), (tx) => tx.delete(auditRecord), h.app),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/permission denied/i);
  });

  it('does not show another workspace its rows', async () => {
    const rows = await withActor(
      ordinaryActor(b),
      (tx) => tx.select().from(auditRecord),
      h.app,
    );

    expect(rows.every((r) => r.workspaceId === b.workspaceId)).toBe(true);
  });

  it('cannot be written into another workspace', async () => {
    const failure = await failureOf(
      withActor(
        ordinaryActor(a),
        (tx) =>
          tx.insert(auditRecord).values({
            workspaceId: b.workspaceId,
            actorKind: 'member',
            actorUserId: a.ownerUserId,
            action: 'forged',
            subjectType: 'workspace',
            subjectId: b.workspaceId,
            data: sql`'{}'::jsonb`,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
    expect(failure.message).toMatch(/row-level security/i);
  });
});
