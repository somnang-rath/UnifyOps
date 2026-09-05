import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { attachment, wikiPage, wikiSpace } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * The abandoned-upload sweeper against real Postgres (§20.9 — slice 18, and
 * slice 9's unfinished business).
 *
 * §20.13's definition of done for slice 18 names it in as many words — "the
 * abandoned-upload sweeper runs" — and running is exactly the part no unit test
 * can show. The sweep's whole design is about *which* connection does what: the
 * cross-workspace read is on the operator role, which is `SELECT`-only at the
 * role level (§18-12), and every delete goes through `withActor` in the
 * uploader's own scope. Both of those are properties of real roles against a
 * real database, and both are silently true of a mock.
 *
 * Pointing the job's environment at the harness is the digest test's pattern
 * from slice 9, and for its reason: "that is what makes this the real code path
 * rather than a rehearsal of it."
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;
let sweepAbandonedUploads: typeof import('@/server/jobs/sweep').sweepAbandonedUploads;
let pageInA: string;
let pageInB: string;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'sweep-a');
  other = await seedWorkspace(h, 'sweep-b');

  process.env.DATABASE_URL = h.urls.app;
  process.env.DATABASE_URL_OPERATOR = h.urls.operator;

  /**
   * No `S3_*`, so `objectStore()` is the local driver and `deleteObject` unlinks
   * a file that is not there — which succeeds, because the port's contract says
   * a delete of a missing object is success. The sweep is at-least-once, so that
   * is the ordinary case rather than a fault, and a test that had to write bytes
   * first would be testing the driver instead of the sweep.
   */
  ({ sweepAbandonedUploads } = await import('@/server/jobs/sweep'));

  pageInA = await seedPage(w);
  pageInB = await seedPage(other);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const as = <T>(ws: SeededWorkspace, fn: Parameters<typeof withActor<T>>[1]) =>
  withActor(
    {
      workspaceId: ws.workspaceId,
      userId: ws.ownerUserId,
      actorUserId: ws.ownerUserId,
      readOnly: false,
    },
    fn,
    h.app,
  );

/**
 * A page to hang the tickets on.
 *
 * §20.9's CHECKs mean an attachment has **exactly one** parent and its
 * `project_id` is present exactly when its `work_item_id` is — so a row with no
 * parent cannot be written at all, which is the constraint working. A page is
 * the cheaper of the two parents to seed here, and it is also the case slice 18
 * added: a screenshot pasted into a page, abandoned before the bytes arrived.
 */
async function seedPage(ws: SeededWorkspace): Promise<string> {
  const spaceId = uuidv7();
  const pageId = uuidv7();

  await as(ws, async (tx) => {
    await tx.insert(wikiSpace).values({
      id: spaceId,
      workspaceId: ws.workspaceId,
      kind: 'project',
      projectId: ws.projectId,
      name: 'Engineering',
      slug: 'engineering',
    });
    await tx.insert(wikiPage).values({
      id: pageId,
      workspaceId: ws.workspaceId,
      spaceId,
      rootId: pageId,
      title: 'Runbook',
      slug: 'runbook',
    });
  });

  return pageId;
}

/** A ticket, aged by writing `created_at` directly — the column the sweep reads. */
async function makeTicket(
  input: { ageHours: number; status?: 'pending' | 'ready' },
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();

  await as(ws, async (tx) => {
    await tx.insert(attachment).values({
      id,
      workspaceId: ws.workspaceId,
      // Page-owned, so `project_id` and `work_item_id` are both null — which is
      // what 0032's two CHECKs require of this branch (§20.9).
      wikiPageId: ws === w ? pageInA : pageInB,
      uploadedByMemberId: ws.ownerMemberId,
      filename: 'abandoned.png',
      contentType: 'image/png',
      sizeBytes: 2048,
      status: input.status ?? 'pending',
      createdAt: new Date(Date.now() - input.ageHours * 60 * 60 * 1000),
    });
  });

  return id;
}

const survives = async (id: string, ws: SeededWorkspace = w): Promise<boolean> => {
  const rows = await as(ws, async (tx) =>
    tx.select({ id: attachment.id }).from(attachment).where(eq(attachment.id, id)),
  );
  return rows.length === 1;
};

describe('the abandoned-upload sweeper', () => {
  it('collects a pending row older than the window', async () => {
    const stale = await makeTicket({ ageHours: 3 });

    const result = await sweepAbandonedUploads();

    expect(result.failed).toBe(0);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await survives(stale)).toBe(false);
  });

  /**
   * The window is an hour, "comfortably longer than the upload URL it was minted
   * with" — after which a `pending` row cannot become `ready` by any path the
   * product offers. A row still inside it may be a 25 MiB file crawling up a
   * phone connection (§2.5-3), and deleting its bytes mid-flight is the one
   * mistake this job must not make.
   */
  it('leaves a pending row that is still inside the window', async () => {
    const fresh = await makeTicket({ ageHours: 0 });

    await sweepAbandonedUploads();

    expect(await survives(fresh)).toBe(true);
  });

  /**
   * **A `ready` file is never touched, whatever its age.** The predicate is the
   * *status*, not the clock: sweeping on age alone would eventually delete
   * somebody's attachments, which is the failure mode that would end this job.
   */
  it('never touches a confirmed file, however old', async () => {
    const old = await makeTicket({ ageHours: 24 * 365, status: 'ready' });

    await sweepAbandonedUploads();

    expect(await survives(old)).toBe(true);
  });

  /**
   * Enumeration crosses workspaces on the operator role; every *write* is scoped
   * to one through `withActor` on the app role. This is slice 9's split, and the
   * assertion is that the sweep really does reach both companies — a job that
   * quietly only collected the first workspace it saw would look identical from
   * inside a single-tenant test.
   */
  it('sweeps every workspace, not just the first', async () => {
    const mine = await makeTicket({ ageHours: 3 });
    const theirs = await makeTicket({ ageHours: 3 }, other);

    await sweepAbandonedUploads();

    expect(await survives(mine)).toBe(false);
    expect(await survives(theirs, other)).toBe(false);
  });

  /**
   * At-least-once, and idempotent by construction: a crash between the object
   * delete and the commit leaves a `pending` row nothing renders, and the next
   * pass collects it. Running twice over the same state has to be a no-op rather
   * than an error.
   */
  it('is safe to run twice', async () => {
    await makeTicket({ ageHours: 3 });

    await sweepAbandonedUploads();
    const second = await sweepAbandonedUploads();

    expect(second.failed).toBe(0);
  });

  /**
   * The row is **really deleted**, not tombstoned — the one place in this product
   * a tenant row is, and it is right here for the reason the row exists at all:
   * "a `pending` attachment is not something a person made, it is a ticket the
   * product issued and nobody used". There is nothing to recover and nobody to
   * show a tombstone to.
   */
  it('hard-deletes rather than soft-deletes', async () => {
    const stale = await makeTicket({ ageHours: 3 });

    await sweepAbandonedUploads();

    const rows = await as(w, async (tx) =>
      tx
        .select({ id: attachment.id })
        .from(attachment)
        .where(and(eq(attachment.id, stale))),
    );
    expect(rows).toHaveLength(0);
  });
});
