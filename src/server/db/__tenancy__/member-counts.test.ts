import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { note, wikiPage, wikiPageRevision, wikiSpace } from '../schema';
import { listMembersIn } from '@/server/services/members';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * The three counts on §7.12's offboarding dialog (slice 22).
 *
 * **They had no test at all until this file, and slice 22 went looking because
 * a subquery that looked exactly like them turned out to be broken.**
 * `fetchSpaces`'s page count had been reporting zero for every space in the
 * product since slice 18: it interpolated a drizzle column into a correlated
 * subquery, and because that query has **no join** drizzle emitted the column
 * unqualified — so `wiki_space.id` arrived as a bare `"id"`, bound to
 * `wiki_page.id` inside the subquery, and matched nothing.
 *
 * These three survive that trap, and the reason is worth writing down because
 * the imprecise version of the rule would have sent somebody rewriting a dozen
 * correct queries: **drizzle emits a column unqualified only when the statement
 * has a single table**, and `listMembers` joins `app_user`, so
 * `${workspaceMember.id}` reaches Postgres qualified and the correlation is
 * real. That was confirmed with drizzle's own `.toSQL()` on both shapes, and by
 * reverting the fix and watching these tests still pass.
 *
 * What the file is *for* is the thing that check could not give: these numbers
 * are a decision somebody acts on before a click they cannot undo — §7.12's
 * "notes are destroyed and pages survive, attributed" — and nothing anywhere
 * asserted them. So the property under test is **the number is the right
 * number**, which is the only assertion that would catch this class of defect:
 * a broken correlation returns a plausible value, not an error.
 *
 * It has to be a tenancy test rather than a unit test, because a defect in
 * emitted SQL is invisible to the compiler and to any test with no real
 * Postgres underneath.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'member-counts');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = () => ({
  workspaceId: w.workspaceId,
  userId: w.ownerUserId,
  actorUserId: w.ownerUserId,
  readOnly: false,
});

const as = <T>(fn: Parameters<typeof withActor<T>>[1]) => withActor(actor(), fn, h.app);

describe('the offboarding dialog counts what the member actually has', () => {
  it('counts notes, authored pages and owned pages — none of them zero', async () => {
    const spaceId = uuidv7();
    const pageA = uuidv7();
    const pageB = uuidv7();

    await as(async (tx) => {
      await tx.insert(wikiSpace).values({
        id: spaceId,
        workspaceId: w.workspaceId,
        kind: 'company',
        projectId: null,
        name: 'Company',
        slug: 'company-counts',
      });

      // Two notes, one of them deleted — the count is of live ones, because
      // §7.12's dialog is about what is destroyed by the click being offered.
      for (const [index, deletedAt] of [[0, null], [1, new Date()]] as const) {
        await tx.insert(note).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          ownerMemberId: w.ownerMemberId,
          body: `note ${index}`,
          deletedAt,
        });
      }

      /*
        Two pages, both authored by this member and only one owned by them.
        Those are two different facts and two different columns — "they wrote
        it" and "they are answerable for it" — and a test that made them the
        same number could not tell the two subqueries apart.
      */
      for (const [id, title, owned] of [
        [pageA, 'Leave policy', true],
        [pageB, 'Runbook', false],
      ] as const) {
        await tx.insert(wikiPage).values({
          id,
          workspaceId: w.workspaceId,
          spaceId,
          rootId: id,
          title,
          slug: title.toLowerCase().replace(/\s+/g, '-'),
          ownerMemberId: owned ? w.ownerMemberId : null,
        });

        // Two revisions on one page, so `count(distinct page_id)` is doing the
        // work its comment claims: "they wrote 40 revisions" is a fact about
        // their typing, "they wrote 6 pages" is the fact somebody decides on.
        for (const revisionNo of [1, 2]) {
          await tx.insert(wikiPageRevision).values({
            id: uuidv7(),
            workspaceId: w.workspaceId,
            pageId: id,
            revisionNo,
            title,
            body: `revision ${revisionNo}`,
            authorMemberId: w.ownerMemberId,
          });
        }
      }
    });

    const members = await as(async (tx) => listMembersIn(tx));
    const owner = members.find((row) => row.memberId === w.ownerMemberId);

    expect(owner, 'the seeded owner is in the list').toBeDefined();
    expect(owner?.noteCount).toBe(1);
    expect(owner?.pageCount).toBe(2);
    expect(owner?.ownedPageCount).toBe(1);
  });

  /**
   * The other half, and the one that makes the assertion above mean something.
   *
   * A broken correlated subquery returns the *same* number for every row —
   * usually zero, and always the same. A member with nothing must therefore
   * report zero while the one above reports 1, 2 and 1, or the numbers are not
   * being computed per member at all.
   */
  it('reports zero for a member who has none of them', async () => {
    const second = await seedWorkspace(h, 'member-counts-b');
    const members = await withActor(
      {
        workspaceId: second.workspaceId,
        userId: second.ownerUserId,
        actorUserId: second.ownerUserId,
        readOnly: false,
      },
      async (tx) => listMembersIn(tx),
      h.app,
    );

    // Every member of that workspace, rather than the first — the harness seeds
    // more than one, and the claim is about all of them.
    expect(members.length).toBeGreaterThan(0);
    for (const row of members) {
      expect([row.noteCount, row.pageCount, row.ownedPageCount], row.email).toEqual([0, 0, 0]);
    }
  });
});
