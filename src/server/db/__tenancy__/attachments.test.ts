import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { attachment, comment, workItem } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Attachments, against a real Postgres (§15 — slice 8).
 *
 * `attachments.test.ts` in `src/lib` proves the rules are right in JavaScript
 * and `sigv4.test.ts` proves a signed URL matches AWS's own worked example.
 * This covers what only Postgres can answer: that a file is inside the tenancy
 * boundary the same way every other row is, that a view-as session cannot add
 * or remove one, that the composite keys make a cross-workspace file physically
 * impossible — and that the two check constraints 0014 adds hold against a
 * writer that is not our service.
 *
 * That last part is the point of putting them in the database at all. §16's
 * standing worry is a row written by a seed script, an importer or a Phase 2
 * MCP tool; those never call `createUploadTicket`, and a `ready` row with no
 * bytes behind it is a broken image on somebody's item page.
 */

let h: TenancyHarness;
let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  a = await seedWorkspace(h, 'attachments-a');
  b = await seedWorkspace(h, 'attachments-b');
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

/** The row `createUploadTicket` writes, without going through the service. */
function pendingValues(w: SeededWorkspace, workItemId: string, overrides = {}) {
  return {
    id: uuidv7(),
    workspaceId: w.workspaceId,
    projectId: w.projectId,
    workItemId,
    uploadedByMemberId: w.ownerMemberId,
    filename: 'contract.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    ...overrides,
  };
}

async function attachTo(w: SeededWorkspace, workItemId: string, overrides = {}): Promise<string> {
  const values = pendingValues(w, workItemId, overrides);

  await withActor(
    actorFor(w),
    async (tx) => {
      await tx.insert(attachment).values(values);
    },
    h.app,
  );

  return values.id;
}

describe('attachment tenancy', () => {
  it('returns zero rows for another workspace, even with a deliberately unscoped query', async () => {
    const itemA = await makeItem(a);
    await attachTo(a, itemA);

    const seenFromB = await withActor(
      actorFor(b),
      // No `where` at all. RLS is the only thing between this query and every
      // file in the database, which is the point of asking it this way.
      async (tx) => tx.select().from(attachment),
      h.app,
    );

    expect(seenFromB).toEqual([]);
  });

  it('lets the workspace that uploaded it read it back', async () => {
    const itemA = await makeItem(a);
    const id = await attachTo(a, itemA);

    const rows = await withActor(
      actorFor(a),
      async (tx) => tx.select().from(attachment).where(eq(attachment.id, id)),
      h.app,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.filename).toBe('contract.pdf');
    // The default the whole two-step upload depends on: a row is not a file
    // until something says the bytes arrived.
    expect(rows[0]?.status).toBe('pending');
  });
});

describe('the composite foreign keys', () => {
  /**
   * `workspace_id` is denormalized onto `attachment`, so nothing but the
   * composite key stops a row claiming workspace B while hanging off an item in
   * workspace A. Structural isolation rather than a property of the code that
   * happens to write it (§9).
   */
  it('refuses a file whose item belongs to another workspace', async () => {
    const itemA = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(b),
        async (tx) => tx.insert(attachment).values(pendingValues(b, itemA)),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  it('refuses a file linked to a comment in another workspace', async () => {
    const itemA = await makeItem(a);
    const commentId = uuidv7();

    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(comment).values({
          id: commentId,
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemA,
          authorMemberId: a.ownerMemberId,
          body: 'see attached',
        });
      },
      h.app,
    );

    const itemB = await makeItem(b);

    const failure = await failureOf(
      withActor(
        actorFor(b),
        async (tx) =>
          tx.insert(attachment).values(
            pendingValues(b, itemB, { commentId, status: 'ready' as const }),
          ),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('view-as', () => {
  /**
   * §7.13, enforced at the database as well as in the policy module. The
   * service refuses first; this is the layer that still holds when a mutation
   * is written outside it.
   */
  it('refuses to add a file while read-only', async () => {
    const itemA = await makeItem(a);

    const failure = await failureOf(
      withActor(
        actorFor(a, true),
        async (tx) => tx.insert(attachment).values(pendingValues(a, itemA)),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('refuses to remove one while read-only', async () => {
    const itemA = await makeItem(a);
    const id = await attachTo(a, itemA);

    await withActor(
      actorFor(a, true),
      async (tx) =>
        tx.update(attachment).set({ deletedAt: new Date() }).where(eq(attachment.id, id)),
      h.app,
    );

    const rows = await withActor(
      actorFor(a),
      async (tx) => tx.select().from(attachment).where(eq(attachment.id, id)),
      h.app,
    );

    // The UPDATE matched nothing rather than failing: the policy's USING clause
    // makes the row invisible to the write, which is the same outcome by a
    // different route.
    expect(rows[0]?.deletedAt).toBeNull();
  });
});

describe('the check constraints 0014 adds', () => {
  /**
   * Written for a caller that is not our service, because that is the caller
   * §16 worries about: a `pending` row that already names a comment would be a
   * file half-linked to a conversation, and linking is meant to happen in the
   * same statement that makes it ready.
   */
  it('refuses a pending row that already names a comment', async () => {
    const itemA = await makeItem(a);
    const commentId = uuidv7();

    await withActor(
      actorFor(a),
      async (tx) => {
        await tx.insert(comment).values({
          id: commentId,
          workspaceId: a.workspaceId,
          projectId: a.projectId,
          workItemId: itemA,
          authorMemberId: a.ownerMemberId,
          body: 'a real comment',
        });
      },
      h.app,
    );

    const failure = await failureOf(
      withActor(
        actorFor(a),
        async (tx) => tx.insert(attachment).values(pendingValues(a, itemA, { commentId })),
        h.app,
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a size the product would never have signed for', async () => {
    const itemA = await makeItem(a);

    const tooBig = await failureOf(
      withActor(
        actorFor(a),
        async (tx) =>
          tx.insert(attachment).values(pendingValues(a, itemA, { sizeBytes: 26_214_401 })),
        h.app,
      ),
    );
    expect(tooBig.code).toBe(SQLSTATE.checkViolation);

    const empty = await failureOf(
      withActor(
        actorFor(a),
        async (tx) => tx.insert(attachment).values(pendingValues(a, itemA, { sizeBytes: 0 })),
        h.app,
      ),
    );
    expect(empty.code).toBe(SQLSTATE.checkViolation);
  });
});

describe('the operator role', () => {
  // §18-12: cross-tenant SELECT and nothing else. Support answering "did the
  // customer's file actually upload" is exactly what this role is for.
  it('reads across workspaces but cannot write', async () => {
    const itemA = await makeItem(a);
    const id = await attachTo(a, itemA);

    const seen = await h.operator.select().from(attachment).where(eq(attachment.id, id));
    expect(seen).toHaveLength(1);

    const failure = await failureOf(
      h.operator.insert(attachment).values(pendingValues(a, itemA)),
    );

    expect(failure.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});
