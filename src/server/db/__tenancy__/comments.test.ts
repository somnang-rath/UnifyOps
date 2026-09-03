import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { comment, commentMention, workItem } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Comments and mentions, against a real Postgres (§15 — slice 8).
 *
 * `mentions.test.ts` proves the parse is right in JavaScript and
 * `policy.test.ts` proves §10 answers correctly with no database at all. This
 * covers the part only Postgres can answer: that the two new tables are inside
 * the tenancy boundary the same way every other table is, that a view-as
 * session cannot write one, and — the case worth having a test for — that the
 * composite foreign keys make a cross-workspace comment physically impossible
 * rather than merely unwritten by our code.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'comments-a');
  b = await seedWorkspace(h, 'comments-b');
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

async function postAs(
  w: SeededWorkspace,
  workItemId: string,
  body: string,
  mention?: string,
): Promise<string> {
  const id = uuidv7();

  await withActor(
    actorFor(w),
    async (tx) => {
      await tx.insert(comment).values({
        id,
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        workItemId,
        authorMemberId: w.ownerMemberId,
        body,
      });

      if (mention) {
        await tx.insert(commentMention).values({
          workspaceId: w.workspaceId,
          commentId: id,
          workspaceMemberId: mention,
        });
      }
    },
    h.app,
  );

  return id;
}

describe('comment tenancy', () => {
  // §15's per-table requirement, and the one that would matter most here: a
  // thread is the most quotable text in the product.
  it('returns zero rows for another workspace, even with a deliberately unscoped query', async () => {
    const itemA = await makeItem(a);
    await postAs(a, itemA, 'Only workspace A should ever read this');

    const seenFromB = await withActor(
      actorFor(b),
      // No `where` at all. RLS is the only thing standing between this query
      // and every comment in the database, which is the point of asking it.
      async (tx) => tx.select().from(comment),
      h.app,
    );

    expect(seenFromB).toEqual([]);
  });

  it('scopes mentions the same way', async () => {
    const itemA = await makeItem(a);
    await postAs(a, itemA, 'mentioning someone', a.memberMemberId);

    const seenFromB = await withActor(
      actorFor(b),
      async (tx) => tx.select().from(commentMention),
      h.app,
    );

    expect(seenFromB).toEqual([]);
  });

  it('lets the workspace that wrote it read it back', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'visible to A');

    const rows = await withActor(
      actorFor(a),
      async (tx) => tx.select().from(comment).where(eq(comment.id, id)),
      h.app,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('visible to A');
  });
});

describe('the composite foreign keys', () => {
  /**
   * The invariant §9 puts on every tenant table, asked of this one.
   *
   * `workspace_id` is denormalized onto `comment`, so nothing but the composite
   * key stops a row claiming workspace B while hanging off an item in workspace
   * A. This is what makes the isolation structural rather than a property of
   * the code that happens to write it.
   */
  it('refuses a comment whose item belongs to another workspace', async () => {
    const itemA = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(b),
        async (tx) =>
          tx.insert(comment).values({
            id: uuidv7(),
            workspaceId: b.workspaceId,
            projectId: b.projectId,
            // A real item — in the other company.
            workItemId: itemA,
            authorMemberId: b.ownerMemberId,
            body: 'reaching across the boundary',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses a mention of a member in another workspace', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'a comment in A');

    const failure = await failureOf(
      withActor(
        actorFor(a),
        async (tx) =>
          tx.insert(commentMention).values({
            workspaceId: a.workspaceId,
            commentId: id,
            // A real member — of the other company.
            workspaceMemberId: b.ownerMemberId,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('view-as', () => {
  /**
   * §7.13 in the database rather than only in the policy module.
   *
   * `assertCan` refuses first and `uow.emit` refuses after it, but both are
   * TypeScript. This asks the same question of Postgres with both bypassed,
   * because the guarantee that matters is the one that still holds when a
   * mutation is written outside the service layer.
   */
  it('refuses a comment written while read-only', async () => {
    const itemA = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        async (tx) =>
          tx.insert(comment).values({
            id: uuidv7(),
            workspaceId: a.workspaceId,
            projectId: a.projectId,
            workItemId: itemA,
            authorMemberId: a.ownerMemberId,
            body: 'posted while viewing as somebody else',
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('refuses a mention written while read-only', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'a comment in A');

    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        async (tx) =>
          tx.insert(commentMention).values({
            workspaceId: a.workspaceId,
            commentId: id,
            workspaceMemberId: a.memberMemberId,
          }),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  /**
   * The other half, and the one an over-eager copy of `activity`'s policies
   * would break: a comment is *not* append-only. Its author may retract it and
   * §10 lets a Lead remove somebody else's, so UPDATE has to work — just not
   * from a read-only session.
   */
  it('still allows a normal session to soft-delete', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'to be retracted');

    await withActor(
      actorFor(a),
      async (tx) =>
        tx.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, id)),
      h.app,
    );

    const rows = await withActor(
      actorFor(a),
      async (tx) => tx.select().from(comment).where(eq(comment.id, id)),
      h.app,
    );

    expect(rows[0]?.deletedAt).not.toBeNull();
  });

  it('refuses a soft-delete from a read-only session', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'not yours to remove');

    // No error: an UPDATE the policy's USING clause excludes matches no rows
    // rather than failing, which is the RLS behaviour §9 relies on everywhere.
    await withActor(
      actorFor(a, true),
      async (tx) =>
        tx.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, id)),
      h.app,
    );

    const rows = await withActor(
      actorFor(a),
      async (tx) => tx.select().from(comment).where(eq(comment.id, id)),
      h.app,
    );

    expect(rows[0]?.deletedAt).toBeNull();
  });
});

describe('the operator role', () => {
  // §18-12: cross-tenant SELECT and nothing else. The support engineer reading
  // a thread to answer a ticket is the case this role exists for.
  it('reads across workspaces but cannot write', async () => {
    const itemA = await makeItem(a);
    const id = await postAs(a, itemA, 'readable by support');

    const seen = await h.operator.select().from(comment).where(eq(comment.id, id));
    expect(seen).toHaveLength(1);

    const failure = await failureOf(
      h.operator.insert(comment).values({
        id: uuidv7(),
        workspaceId: a.workspaceId,
        projectId: a.projectId,
        workItemId: itemA,
        authorMemberId: a.ownerMemberId,
        body: 'support should never be able to write this',
      }),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});
