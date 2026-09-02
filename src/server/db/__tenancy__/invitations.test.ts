import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { hashToken, mint, LIFETIME } from '@/server/auth/tokens';
import { withActor } from '../tenant';
import { auditRecord, invitation, invitationTeam, workspaceMember } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Slice 3's tenancy surface.
 *
 * Invitations are the first tenant table with a deliberate hole in it: the
 * identity role can SELECT across workspaces, because exchanging a token for
 * the workspace it names happens before the invitee belongs to anything. This
 * file exists to pin the shape of that hole — that it is SELECT, that it is the
 * identity role only, and that nothing else about tenancy moved to accommodate
 * it.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'acme-inv');
  b = await seedWorkspace(h, 'borey-inv');
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

async function inviteInto(
  w: SeededWorkspace,
  email: string,
): Promise<{ id: string; token: string }> {
  const id = uuidv7();
  const { token, tokenHash, expiresAt } = mint(LIFETIME.invitation);

  await withActor(
    actorFor(w),
    async (tx, uow) => {
      await tx.insert(invitation).values({
        id,
        workspaceId: w.workspaceId,
        email,
        role: 'member',
        tokenHash,
        expiresAt,
        invitedByMemberId: w.ownerMemberId,
      });

      // Emitted, not skipped: the audit assertion at the bottom of this file is
      // only worth anything if the fixture goes through the same unit of work
      // the service does.
      uow.emit({
        type: 'invitation.sent',
        workspaceId: w.workspaceId,
        invitationId: id,
        email,
        role: 'member',
      });
    },
    h.app,
  );

  return { id, token };
}

describe('invitations are ordinary tenant data', () => {
  it('are invisible to another workspace, even unscoped', async () => {
    await inviteInto(a, 'outsider@example.com');

    // No WHERE clause on workspace_id. Forgetting it has to be survivable.
    const rows = await withActor(actorFor(b), (tx) => tx.select().from(invitation), h.app);

    expect(rows).toEqual([]);
  });

  it('cannot be written into another workspace', async () => {
    const failure = await failureOf(
      withActor(
        actorFor(a),
        async (tx) => {
          const { tokenHash, expiresAt } = mint(LIFETIME.invitation);
          return tx.insert(invitation).values({
            id: uuidv7(),
            // Naming B's workspace while scoped to A: the WITH CHECK predicate
            // is what refuses this, not a validation we remembered to write.
            workspaceId: b.workspaceId,
            email: 'smuggled@example.com',
            role: 'member',
            tokenHash,
            expiresAt,
            invitedByMemberId: b.ownerMemberId,
          });
        },
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('cannot be attached to a team in another workspace', async () => {
    const { id } = await inviteInto(a, 'teams@example.com');

    // The composite foreign key, not RLS: a row physically cannot reference a
    // parent in another workspace (§9).
    const failure = await failureOf(
      withActor(
        actorFor(a),
        (tx) =>
          tx.insert(invitationTeam).values({
            workspaceId: a.workspaceId,
            invitationId: id,
            teamId: b.teamId,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses to be created while view-as is active', async () => {
    // §7.13: "Every mutation is refused while it is active." Enforced at the
    // database as well as in the policy module, so a mutation written outside
    // the policy module still cannot land.
    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        async (tx) => {
          const { tokenHash, expiresAt } = mint(LIFETIME.invitation);
          return tx.insert(invitation).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            email: 'readonly@example.com',
            role: 'member',
            tokenHash,
            expiresAt,
            invitedByMemberId: a.ownerMemberId,
          });
        },
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('the identity role and the invitation token', () => {
  it('can find an invitation by its token hash, across workspaces', async () => {
    // The one deliberate cross-tenant read in the product. Without it there is
    // no way to answer "which workspace is this link for?" before the invitee
    // is a member of anything.
    const { id, token } = await inviteInto(b, 'invitee@example.com');

    const found = await h.identity
      .select({ id: invitation.id, workspaceId: invitation.workspaceId })
      .from(invitation)
      .where(eq(invitation.tokenHash, hashToken(token)));

    expect(found).toEqual([{ id, workspaceId: b.workspaceId }]);
  });

  it('stores the hash and never the token', async () => {
    const { token } = await inviteInto(a, 'hashed@example.com');

    const rows = await h.owner.execute<{ count: number }>(
      sql`select count(*)::int as count from invitation where token_hash = ${token}`,
    );

    // A dump of this table must not be a pile of working invitation links.
    expect(rows.rows[0]?.count).toBe(0);
  });

  it('cannot create, alter or delete an invitation', async () => {
    const { id } = await inviteInto(a, 'immutable@example.com');

    const update = await failureOf(
      h.identity.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, id)),
    );
    expect(update.code).toBe(SQLSTATE.insufficientPrivilege);

    const remove = await failureOf(h.identity.delete(invitation).where(eq(invitation.id, id)));
    expect(remove.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('accepting an invitation', () => {
  it('lets the invitee open a scope the token named, and join', async () => {
    // The invitee is not a member yet, so the scope is authorized by the token
    // rather than by an existing membership — and everything inside it is an
    // ordinary tenant write that RLS is satisfied by.
    const newUserId = uuidv7();
    await h.owner.execute(
      sql`insert into app_user (id, email, name) values (${newUserId}, 'joiner@example.com', 'Joiner')`,
    );

    const { id } = await inviteInto(a, 'joiner@example.com');
    const memberId = uuidv7();

    await withActor(
      { workspaceId: a.workspaceId, userId: newUserId, actorUserId: newUserId, readOnly: false },
      async (tx) => {
        await tx.insert(workspaceMember).values({
          id: memberId,
          workspaceId: a.workspaceId,
          userId: newUserId,
          role: 'member',
        });
        await tx
          .update(invitation)
          .set({ status: 'accepted', acceptedByUserId: newUserId, acceptedAt: new Date() })
          .where(eq(invitation.id, id));
      },
      h.app,
    );

    const rows = await withActor(
      { workspaceId: a.workspaceId, userId: newUserId, actorUserId: newUserId, readOnly: false },
      (tx) => tx.select({ status: invitation.status }).from(invitation).where(eq(invitation.id, id)),
      h.app,
    );

    expect(rows[0]?.status).toBe('accepted');
  });

  it('leaves an audit trail of who was invited, and in what role', async () => {
    // §18-11: the log exists so an owner can reconstruct how someone got
    // access, so the invitation half of that story has to be in it.
    //
    // Read through the operator, not the owner. FORCE ROW LEVEL SECURITY makes
    // the owner subject to policies too, and no tenant table gives it one — so
    // the owner connection reads zero rows here, which is 0002 working rather
    // than a missing row.
    const rows = await h.operator
      .select({ action: auditRecord.action, data: auditRecord.data })
      .from(auditRecord)
      .where(
        and(eq(auditRecord.workspaceId, a.workspaceId), eq(auditRecord.action, 'invitation.sent')),
      );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.data).toHaveProperty('email');
    expect(rows[0]?.data).toHaveProperty('role');
  });
});
