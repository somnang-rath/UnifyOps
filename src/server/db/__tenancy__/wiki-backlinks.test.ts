import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import { project, wikiPage, wikiPageRef, wikiSpace } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The derived reference table against real Postgres (§21.4 — slice 20).
 *
 * §21.13's definition of done for this slice is one sentence: "the ref table is
 * *rebuilt* rather than appended to, so removing a sentence removes its edge
 * while an authored `wiki_page_link` survives the same edit — **asserted
 * directly**, because that distinction is the one §20.0 found the hard way."
 *
 * The service half of that is `wiki.spec.ts` and `syncPageRefs`. What is here is
 * what only a database can say:
 *
 *  - the edge is **one row, not a bag**, so a page referenced from three
 *    paragraphs is listed once;
 *  - a page cannot reference **itself**, so it never appears in its own "what
 *    links here";
 *  - the edge is scoped by workspace on **both** sides, so a reference cannot
 *    cross a tenant boundary even though both ends are `wiki_page`;
 *  - a **soft**-deleted page keeps its edges, which is what makes §20.3.6's
 *    restore restore the backlinks with it rather than needing every referring
 *    page re-saved.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'wiki-refs');
  other = await seedWorkspace(h, 'wiki-refs-other');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const actor = (ws: SeededWorkspace) => ({
  workspaceId: ws.workspaceId,
  userId: ws.ownerUserId,
  actorUserId: ws.ownerUserId,
  readOnly: false,
});

const as = <T>(ws: SeededWorkspace, fn: Parameters<typeof withActor<T>>[1]) =>
  withActor(actor(ws), fn, h.app);

let seq = 0;
const nextSuffix = () => {
  seq += 1;
  return `r${String(seq).padStart(3, '0')}`;
};

async function makeSpace(ws: SeededWorkspace): Promise<string> {
  const id = uuidv7();
  const projectId = uuidv7();
  const suffix = nextSuffix();

  // Its own transaction, before the space's: `withActor` opens one connection
  // and a nested `as` would deadlock against it.
  await as(ws, async (tx) => {
    await tx.insert(project).values({
      id: projectId,
      workspaceId: ws.workspaceId,
      teamId: ws.teamId,
      slug: `proj-${suffix}`,
      key: suffix.toUpperCase(),
      name: `Project ${suffix}`,
    });
  });

  await as(ws, async (tx) => {
    await tx.insert(wikiSpace).values({
      id,
      workspaceId: ws.workspaceId,
      kind: 'project',
      projectId,
      name: `Space ${suffix}`,
      slug: `space-${suffix}`,
    });
  });

  return id;
}

async function makePage(ws: SeededWorkspace, spaceId: string): Promise<string> {
  const id = uuidv7();
  const suffix = nextSuffix();

  await as(ws, async (tx) => {
    await tx.insert(wikiPage).values({
      id,
      workspaceId: ws.workspaceId,
      spaceId,
      rootId: id,
      title: `Page ${suffix}`,
      slug: `page-${suffix}`,
      body: 'Body.',
    });
  });

  return id;
}

function link(ws: SeededWorkspace, from: string, to: string) {
  return as(ws, (tx) =>
    tx.insert(wikiPageRef).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      fromPageId: from,
      toPageId: to,
    }),
  );
}

/* ------------------------------------------------------------------------- */

describe('the derived edge', () => {
  it('is one row per pair, however often a body mentions it', async () => {
    // `parsePageIds` de-duplicates within a body for the matching reason; this
    // is the second layer, and what makes "what links here" list a page once.
    const space = await makeSpace(w);
    const from = await makePage(w, space);
    const to = await makePage(w, space);

    await link(w, from, to);
    const failure = await failureOf(link(w, from, to));
    expect(failure?.code).toBe(SQLSTATE.uniqueViolation);
  });

  /**
   * A page referencing itself is legal text — `#[its own id]` parses like any
   * other token — and without the CHECK it would appear in its own backlinks,
   * which reads as a bug in the feature rather than as a quirk of one body.
   */
  it('refuses a page that points at itself', async () => {
    const space = await makeSpace(w);
    const page = await makePage(w, space);

    const failure = await failureOf(link(w, page, page));
    expect(failure?.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * Both ends are `wiki_page`, so the tenant column alone would not stop an edge
   * between two companies — the composite keys are what do, which is §9's device
   * applied to a table whose two foreign keys point at the same relation.
   */
  it('cannot span two workspaces', async () => {
    const from = await makePage(w, await makeSpace(w));
    const stranger = await makePage(other, await makeSpace(other));

    const failure = await failureOf(link(w, from, stranger));
    expect(failure?.code).toBe(SQLSTATE.foreignKeyViolation);
  });

  /**
   * §20.3.6 gives deletion a 30-day window, and §21.4 asks a deleted page's
   * references to "render as 'a deleted page'" rather than vanish. Both need the
   * row to survive the soft delete — and a restore then restores the backlink
   * without every referring page having to be re-saved.
   */
  it('survives a soft delete on either end', async () => {
    const space = await makeSpace(w);
    const from = await makePage(w, space);
    const to = await makePage(w, space);
    await link(w, from, to);

    await as(w, (tx) =>
      tx.update(wikiPage).set({ deletedAt: new Date() }).where(eq(wikiPage.id, to)),
    );

    const rows = await as(w, (tx) =>
      tx.select().from(wikiPageRef).where(eq(wikiPageRef.fromPageId, from)),
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * The other half of the pair above: a **hard** delete takes the edge, because
   * an edge to a page that no longer exists is not a record of anything. This is
   * `wiki_page_link`'s call, and the opposite of `note`'s pin — which survives
   * its item because the note is still the person's.
   */
  it('goes with a hard delete', async () => {
    const space = await makeSpace(w);
    const from = await makePage(w, space);
    const to = await makePage(w, space);
    await link(w, from, to);

    await as(w, (tx) => tx.delete(wikiPage).where(eq(wikiPage.id, to)));

    const rows = await as(w, (tx) =>
      tx.select().from(wikiPageRef).where(eq(wikiPageRef.fromPageId, from)),
    );
    expect(rows).toEqual([]);
  });

  /**
   * RLS, on a table whose rows name nothing but two ids. A neighbour's edges are
   * not merely filtered from a list — they are unreachable, which is the
   * difference between "returns another company's data" and "returns nothing".
   */
  it('is invisible from another workspace', async () => {
    const space = await makeSpace(w);
    const from = await makePage(w, space);
    const to = await makePage(w, space);
    await link(w, from, to);

    const rows = await as(other, (tx) =>
      tx.select().from(wikiPageRef).where(eq(wikiPageRef.fromPageId, from)),
    );
    expect(rows).toEqual([]);
  });
});

describe('the page icon', () => {
  const setIcon = (pageId: string, icon: string) =>
    as(w, (tx) => tx.update(wikiPage).set({ icon }).where(eq(wikiPage.id, pageId)));

  /**
   * 0036's CHECK is a **floor**, not the rule — Postgres has no grapheme
   * segmentation, so the database refuses what is obviously not an icon and
   * `normalizePageIcon` refuses what only a segmenter can see.
   */
  it('accepts a multi-code-point emoji, which is one grapheme', async () => {
    const page = await makePage(w, await makeSpace(w));
    // A flag is two code points and a skin-toned emoji three or four. Counting
    // code points would refuse every one of them (§13).
    await expect(setIcon(page, '🇰🇭')).resolves.toBeDefined();
  });

  it('refuses whitespace and a pasted sentence', async () => {
    const page = await makePage(w, await makeSpace(w));

    expect((await failureOf(setIcon(page, ' ')))?.code).toBe(SQLSTATE.checkViolation);
    expect((await failureOf(setIcon(page, 'a sentence, pasted')))?.code).toBe(
      SQLSTATE.checkViolation,
    );
  });
});
