import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { note, workItem, workspaceMember } from '../schema';
import { countNotes, fetchNote, fetchNotes } from '@/server/queries/notes';
import { findNotes } from '@/server/queries/search';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Notes against real Postgres (§20.1, §20.5 — slice 17).
 *
 * §20.13's definition of done for this slice is one sentence: "a note is
 * unreachable by anyone but its owner, asserted directly". This file is that
 * assertion, and the word *directly* is the whole of why it exists.
 *
 * **RLS cannot help here, and that is not a gap — it is the shape of the
 * problem.** Every other tenant table in this suite is protected by a policy:
 * ask for another company's rows and Postgres returns nothing. A note has to be
 * hidden from a *colleague in the same company*, so the policy passes and the
 * only thing standing between two members is `owner_member_id` in the query's
 * predicate. §20.1 refuses to merge notes and pages into one table for exactly
 * this reason — "the first query written that forgets the second half shows a
 * colleague somebody's private notes".
 *
 * So the tests below are written the way `saved-views.test.ts` writes its owner
 * tests and then one step further: they seed a **second member's** rows in the
 * **same workspace** and assert those rows are absent by id. A test that only
 * counted what came back would still pass with the predicate deleted, because
 * the count would simply be larger — which is the failure this file has to be
 * able to see.
 *
 * The rest pins what only a database can say: the two CHECKs in migration 0030,
 * the `SET NULL` on a pin, and the cascade that carries a departing member's
 * notes out with them.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'notes-a');
  other = await seedWorkspace(h, 'notes-b');
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

async function makeNote(
  input: { body?: string; title?: string | null; ownerMemberId?: string; workItemId?: string } = {},
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(note).values({
      id,
      workspaceId: ws.workspaceId,
      ownerMemberId: input.ownerMemberId ?? ws.ownerMemberId,
      title: input.title ?? null,
      body: input.body ?? 'a thought',
      workItemId: input.workItemId ?? null,
    });
  });
  return id;
}

async function makeItem(ws: SeededWorkspace = w): Promise<string> {
  const id = uuidv7();
  await as(ws, async (tx) => {
    await tx.insert(workItem).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      number: Math.floor(Math.random() * 1_000_000) + 1,
      title: 'Something to pin to',
      stateId: ws.stateId,
      rootId: id,
      rank: 'm',
      createdByMemberId: ws.ownerMemberId,
    });
  });
  return id;
}

describe('cross-workspace reads (§15)', () => {
  it('returns zero rows for another workspace, even with a deliberately unscoped query', async () => {
    const mine = await makeNote({ body: 'company A only' });

    const seen = await as(other, async (tx) =>
      // No `workspace_id` predicate at all. RLS is what makes this empty rather
      // than a leak.
      tx.select({ id: note.id }).from(note),
    );

    expect(seen.map((row) => row.id)).not.toContain(mine);
  });

  it('cannot be read by id from another workspace', async () => {
    const mine = await makeNote({ body: 'still company A only' });

    const found = await as(other, (tx) =>
      fetchNote(tx, { id: mine, ownerMemberId: other.ownerMemberId }),
    );

    expect(found).toBeNull();
  });
});

/**
 * The block §20.13 asks for by name.
 *
 * Two members, one workspace, one RLS policy that lets both rows through.
 */
describe('one colleague cannot read another s notes (§20.5)', () => {
  it('scopes the list to the acting member', async () => {
    const mine = await makeNote({ body: 'mine', ownerMemberId: w.ownerMemberId });
    const theirs = await makeNote({ body: 'theirs', ownerMemberId: w.memberMemberId });

    const rows = await as(w, (tx) => fetchNotes(tx, { ownerMemberId: w.ownerMemberId }));
    const ids = rows.map((row) => row.id);

    expect(ids).toContain(mine);
    // The assertion that matters. Absent *by id*, not merely a smaller number:
    // a count would still pass with the owner predicate removed.
    expect(ids).not.toContain(theirs);
  });

  it('refuses to load another member s note by id', async () => {
    const theirs = await makeNote({ body: 'a private thought', ownerMemberId: w.memberMemberId });

    const found = await as(w, (tx) => fetchNote(tx, { id: theirs, ownerMemberId: w.ownerMemberId }));

    expect(found).toBeNull();
  });

  it('counts only the acting member s notes', async () => {
    const scratch = await seedWorkspace(h, 'notes-count');
    await makeNote({ ownerMemberId: scratch.ownerMemberId }, scratch);
    await makeNote({ ownerMemberId: scratch.memberMemberId }, scratch);
    await makeNote({ ownerMemberId: scratch.memberMemberId }, scratch);

    const mine = await as(scratch, (tx) => countNotes(tx, scratch.ownerMemberId));
    expect(mine).toBe(1);
  });

  it('does not find another member s note through search (§20.8)', async () => {
    // The one that would leak silently: a `LIMIT` applied before the owner
    // predicate is "a palette that tells somebody how many notes their
    // colleagues have".
    const scratch = await seedWorkspace(h, 'notes-search');
    const theirs = await makeNote(
      { body: 'quarterly renegotiation plan', ownerMemberId: scratch.memberMemberId },
      scratch,
    );
    const mine = await makeNote(
      { body: 'quarterly review notes', ownerMemberId: scratch.ownerMemberId },
      scratch,
    );

    const hits = await as(scratch, (tx) =>
      findNotes(tx, { ownerMemberId: scratch.ownerMemberId, text: 'quarterly', limit: 20 }),
    );
    const ids = hits.map((hit) => hit.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('finds a Khmer note by a two-grapheme substring, on the trigram route (§13)', async () => {
    // §20.14's check 3, on the corpus this slice adds: Khmer has no inter-word
    // spaces, so the trigram index is the only thing that finds a word inside a
    // sentence. Two graphemes is the floor for both scripts, deliberately —
    // "Khmer is never the degraded path".
    const scratch = await seedWorkspace(h, 'notes-khmer');
    const id = await makeNote({ body: 'ការប្រជុំនៅភ្នំពេញ' }, scratch);

    const hits = await as(scratch, (tx) =>
      findNotes(tx, { ownerMemberId: scratch.ownerMemberId, text: 'ភ្នំ', limit: 20 }),
    );

    expect(hits.map((hit) => hit.id)).toContain(id);
  });
});

describe('the invariants in migration 0030', () => {
  it('refuses an empty body, whatever wrote it', async () => {
    // The service refuses this; the CHECK is what catches the row a seed script
    // or an importer writes.
    const failure = await failureOf(makeNote({ body: '   ' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a body past the ceiling', async () => {
    const failure = await failureOf(makeNote({ body: 'x'.repeat(80_001) }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });
});

describe('the pin (§20.4)', () => {
  it('survives the item being deleted, as null', async () => {
    // `SET NULL`, not `RESTRICT`: a note whose item was deleted is still the
    // person's note. That is the opposite of slice 11's cycle key, and the
    // single-column key is what makes it safe here.
    const scratch = await seedWorkspace(h, 'notes-pin');
    const itemId = await makeItem(scratch);
    const id = await makeNote({ workItemId: itemId }, scratch);

    await as(scratch, async (tx) => {
      await tx.delete(workItem).where(eq(workItem.id, itemId));
    });

    const found = await as(scratch, (tx) =>
      fetchNote(tx, { id, ownerMemberId: scratch.ownerMemberId }),
    );

    expect(found).not.toBeNull();
    expect(found?.pin).toBeNull();
  });
});

describe('offboarding (§20.5)', () => {
  it('takes a departing member s notes with the membership row', async () => {
    // The asymmetry §20.5 states: a page is the company's record and survives; a
    // note is one person's thinking and does not. `removeMember` soft-deletes
    // both the membership and the notes, and this asserts the constraint
    // underneath — the day a membership row is really removed, nothing of
    // theirs is left behind for somebody to find.
    const scratch = await seedWorkspace(h, 'notes-offboard');
    const theirs = await makeNote({ ownerMemberId: scratch.memberMemberId }, scratch);

    await as(scratch, async (tx) => {
      // Through the app role rather than the owner: `workspace_member` FORCEs
      // RLS and the owner's `provisioning` policies do not cover a delete, so an
      // owner-side `DELETE` removes nothing and the test would pass by
      // asserting that nothing happened.
      await tx.delete(workspaceMember).where(eq(workspaceMember.id, scratch.memberMemberId));
    });

    const rows = await as(scratch, (tx) => tx.select({ id: note.id }).from(note));
    expect(rows.map((row) => row.id)).not.toContain(theirs);
  });
});
