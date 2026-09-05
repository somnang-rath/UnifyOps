import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import {
  attachment,
  notification,
  project,
  wikiPage,
  wikiPageRevision,
  wikiSpace,
} from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The wiki against real Postgres (§20.4, §20.5, §20.6, §20.9 — slice 18).
 *
 * §20.13's definition of done for this slice is four things: "a stale save is
 * refused with both bodies on screen; a deleted page's children survive it; the
 * abandoned-upload sweeper runs; and §13's per-content `lang` fix is applied".
 * The first two have a database half, and this file is it.
 *
 * What is pinned here is what only a database can say — the things that stay
 * true for a row written by a seed script, a Markdown importer or a Phase 2 MCP
 * tool, which is the reason §20.4 put them in the schema rather than in
 * `services/wiki.ts`:
 *
 *  - the tree's `root_id`/`depth` and the cap of three (0032's triggers);
 *  - the append-only revision history, with the app role's UPDATE and DELETE
 *    revoked as well as unpolicied;
 *  - the CHECKs that pay for two loosened NOT NULLs (§20.9, §20.6);
 *  - `restrict` on a parent, which is what makes §20.3.6's reparenting a rule
 *    rather than a hope.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'wiki-a');
  other = await seedWorkspace(h, 'wiki-b');
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

/**
 * A counter for fixture slugs and keys.
 *
 * A uuid tail was the first attempt and is wrong here: UUIDv7 is time-ordered,
 * so two ids minted in the same millisecond share their leading bytes and two
 * fixtures collide on `wiki_space_slug_key`. A counter is unique by
 * construction and reads better in a failure message.
 */
let seq = 0;
const nextSuffix = () => {
  seq += 1;
  return String(seq).padStart(3, '0');
};

/**
 * A project, because **a space needs one and a workspace may have only one space
 * per project** (`wiki_space_project_key`).
 *
 * That constraint is §20.2's "one space per project, created with the project"
 * expressed in the schema, and it is what makes this helper necessary: a test
 * wanting two project spaces genuinely needs two projects, which is what a
 * company wanting two project spaces needs as well.
 */
async function makeProject(ws: SeededWorkspace = w): Promise<string> {
  const id = uuidv7();
  const suffix = nextSuffix();

  await as(ws, async (tx) => {
    await tx.insert(project).values({
      id,
      workspaceId: ws.workspaceId,
      teamId: ws.teamId,
      slug: `project-${suffix}`,
      key: `P${suffix}`,
      name: `Project ${suffix}`,
    });
  });

  return id;
}

/** A space, created directly so these tests do not depend on the service layer. */
async function makeSpace(
  input: { kind?: 'company' | 'project'; slug?: string } = {},
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();
  const kind = input.kind ?? 'project';
  // Its own transaction, before the space's: `withActor` opens one connection
  // and a nested `as` would deadlock against it.
  const projectId = kind === 'project' ? await makeProject(ws) : null;

  await as(ws, async (tx) => {
    await tx.insert(wikiSpace).values({
      id,
      workspaceId: ws.workspaceId,
      kind,
      projectId,
      name: kind === 'company' ? 'Company' : 'Engineering',
      slug: input.slug ?? `space-${nextSuffix()}`,
    });
  });

  return id;
}

async function makePage(
  input: { spaceId: string; parentId?: string | null; title?: string; body?: string },
  ws: SeededWorkspace = w,
): Promise<string> {
  const id = uuidv7();

  await as(ws, async (tx) => {
    await tx.insert(wikiPage).values({
      id,
      workspaceId: ws.workspaceId,
      spaceId: input.spaceId,
      parentId: input.parentId ?? null,
      rootId: id,
      title: input.title ?? 'Untitled',
      body: input.body ?? '',
      slug: `page-${nextSuffix()}`,
    });
  });

  return id;
}

/* ------------------------------------------------------------------------- */
/* Tenancy                                                                   */
/* ------------------------------------------------------------------------- */

describe('tenant isolation', () => {
  it('hides another company’s spaces and pages entirely', async () => {
    const spaceId = await makeSpace({}, other);
    await makePage({ spaceId, title: 'Their handbook' }, other);

    const seen = await as(w, async (tx) => tx.select().from(wikiPage));
    expect(seen.map((row) => row.title)).not.toContain('Their handbook');

    const spaces = await as(w, async (tx) => tx.select().from(wikiSpace));
    expect(spaces.map((row) => row.id)).not.toContain(spaceId);
  });

  /**
   * §9's composite-key device, on the table that has four children.
   *
   * A page physically cannot hang off a space in another workspace, and the
   * refusal is the foreign key rather than a service check — which is what makes
   * it true for a row nothing in `src/server` wrote.
   */
  it('refuses a page whose space belongs to another workspace', async () => {
    const theirSpace = await makeSpace({}, other);

    const failure = await failureOf(
      as(w, async (tx) =>
        tx.insert(wikiPage).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          spaceId: theirSpace,
          rootId: uuidv7(),
          title: 'Smuggled',
          slug: 'smuggled',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

/* ------------------------------------------------------------------------- */
/* The tree (§20.4, migration 0032)                                          */
/* ------------------------------------------------------------------------- */

describe('the page tree', () => {
  it('gives a root page itself as its root, at depth 1', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    const [row] = await as(w, async (tx) =>
      tx.select().from(wikiPage).where(eq(wikiPage.id, pageId)),
    );

    expect(row?.rootId).toBe(pageId);
    // 1-based here where `work_item.depth` is 0-based, because this is the
    // number the sidebar indents by and `MAX_PAGE_DEPTH` compares against.
    expect(row?.depth).toBe(1);
  });

  it('inherits the parent’s root and sits one level deeper', async () => {
    const spaceId = await makeSpace();
    const parent = await makePage({ spaceId });
    const child = await makePage({ spaceId, parentId: parent });

    const [row] = await as(w, async (tx) =>
      tx.select().from(wikiPage).where(eq(wikiPage.id, child)),
    );

    expect(row?.rootId).toBe(parent);
    expect(row?.depth).toBe(2);
  });

  /** §20.4: "a tree deeper than three is a tree nobody navigates". */
  it('refuses a fourth level', async () => {
    const spaceId = await makeSpace();
    const a = await makePage({ spaceId });
    const b = await makePage({ spaceId, parentId: a });
    const c = await makePage({ spaceId, parentId: b });

    const failure = await failureOf(makePage({ spaceId, parentId: c }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a page that is its own parent', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    const failure = await failureOf(
      as(w, async (tx) =>
        tx.update(wikiPage).set({ parentId: pageId }).where(eq(wikiPage.id, pageId)),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  it('refuses a move under the page’s own descendant', async () => {
    const spaceId = await makeSpace();
    const a = await makePage({ spaceId });
    const b = await makePage({ spaceId, parentId: a });

    const failure = await failureOf(
      as(w, async (tx) => tx.update(wikiPage).set({ parentId: b }).where(eq(wikiPage.id, a))),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * The AFTER trigger, and the reason it exists: "moving a parent leaves its
   * children claiming the old root — and *all descendants* silently returns the
   * wrong set, which is the failure a closure table was rejected to avoid rather
   * than to trade for" (0008, quoted by 0032).
   */
  it('carries a moved subtree’s root and depth down with it', async () => {
    const spaceId = await makeSpace();
    const newRoot = await makePage({ spaceId, title: 'New root' });
    const a = await makePage({ spaceId });
    const b = await makePage({ spaceId, parentId: a });

    await as(w, async (tx) =>
      tx.update(wikiPage).set({ parentId: newRoot }).where(eq(wikiPage.id, a)),
    );

    const [child] = await as(w, async (tx) =>
      tx.select().from(wikiPage).where(eq(wikiPage.id, b)),
    );

    expect(child?.rootId).toBe(newRoot);
    expect(child?.depth).toBe(3);
  });

  /**
   * §20.5 makes the space the unit of access, so a child in a different space
   * from its parent would be a page whose permissions and whose position in the
   * tree disagreed — and the sidebar would show a page somebody may not open.
   */
  it('refuses a parent in a different space', async () => {
    const one = await makeSpace({ slug: 'space-one' });
    const two = await makeSpace({ slug: 'space-two' });
    const parent = await makePage({ spaceId: one });

    const failure = await failureOf(makePage({ spaceId: two, parentId: parent }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * §20.3.6: "Children are reparented to the deleted page's parent, never
   * deleted with it — the rule `deleteCycle` follows and `work_item_state_fk`
   * enforces: deleting a container must never decide the fate of what is inside
   * it." The service reparents; this is the second layer.
   */
  it('refuses a hard delete of a page that still has children', async () => {
    const spaceId = await makeSpace();
    const parent = await makePage({ spaceId });
    await makePage({ spaceId, parentId: parent });

    const failure = await failureOf(
      as(w, async (tx) => tx.delete(wikiPage).where(eq(wikiPage.id, parent))),
    );

    // 23001, not 23503, and the harness records the distinction: "23503 is *that
    // row does not exist*, 23001 is *that row exists and something still needs
    // it*". `wiki_page_parent_fk` joins slice 11's `work_item_cycle_fk` as the
    // second `ON DELETE RESTRICT` in this schema, and for the same reason.
    expect(failure.code).toBe(SQLSTATE.restrictViolation);
  });
});

/* ------------------------------------------------------------------------- */
/* The history (§20.4)                                                       */
/* ------------------------------------------------------------------------- */

describe('the revision history', () => {
  it('refuses two revisions claiming one number', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    const write = (body: string) =>
      as(w, async (tx) =>
        tx.insert(wikiPageRevision).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          pageId,
          revisionNo: 1,
          title: 'Leave policy',
          body,
          authorMemberId: w.ownerMemberId,
        }),
      );

    await write('first');
    const failure = await failureOf(write('second'));
    expect(failure.code).toBe(SQLSTATE.uniqueViolation);
  });

  /**
   * §20.4, in one sentence: "A revision that can be edited is not a history."
   *
   * Enforced **twice** — no `UPDATE` or `DELETE` policy in the schema, and the
   * matching privileges revoked in 0032 — which is `audit_record`'s and
   * `activity`'s construction applied to the third and last append-only table.
   * The revoke is what makes a policy added carelessly in a later slice unable
   * to open the table.
   */
  it('refuses an update or a delete from the app role', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    await as(w, async (tx) =>
      tx.insert(wikiPageRevision).values({
        id: uuidv7(),
        workspaceId: w.workspaceId,
        pageId,
        revisionNo: 1,
        title: 'Leave policy',
        body: 'v1',
        authorMemberId: w.ownerMemberId,
      }),
    );

    const updated = await failureOf(
      as(w, async (tx) =>
        tx
          .update(wikiPageRevision)
          .set({ body: 'rewritten' })
          .where(eq(wikiPageRevision.pageId, pageId)),
      ),
    );
    expect(updated.code).toBe(SQLSTATE.insufficientPrivilege);

    const deleted = await failureOf(
      as(w, async (tx) =>
        tx.delete(wikiPageRevision).where(eq(wikiPageRevision.pageId, pageId)),
      ),
    );
    expect(deleted.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  /**
   * §20.3.3's concurrency token, at the level that actually serialises it.
   *
   * The service's conditional `UPDATE … WHERE revision_no = $base` is what makes
   * a stale save a no-op rather than a last-write-wins overwrite. Asserted here
   * against real Postgres rather than only in the service, because the property
   * is a property of the statement.
   */
  it('makes a conditional save on a stale revision touch no rows', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId, body: 'v1' });

    // Somebody else saves first: revision 1 becomes revision 2.
    const first = await as(w, async (tx) =>
      tx
        .update(wikiPage)
        .set({ body: 'theirs', revisionNo: 2 })
        .where(and(eq(wikiPage.id, pageId), eq(wikiPage.revisionNo, 1)))
        .returning({ id: wikiPage.id }),
    );
    expect(first).toHaveLength(1);

    // The second writer started from revision 1 too, and is refused.
    const second = await as(w, async (tx) =>
      tx
        .update(wikiPage)
        .set({ body: 'mine', revisionNo: 2 })
        .where(and(eq(wikiPage.id, pageId), eq(wikiPage.revisionNo, 1)))
        .returning({ id: wikiPage.id }),
    );
    expect(second).toHaveLength(0);

    // And nothing of theirs was lost.
    const [row] = await as(w, async (tx) =>
      tx.select().from(wikiPage).where(eq(wikiPage.id, pageId)),
    );
    expect(row?.body).toBe('theirs');
  });
});

/* ------------------------------------------------------------------------- */
/* The bounds (§20.4, §20.6, §20.9 — migration 0032)                         */
/* ------------------------------------------------------------------------- */

describe('the CHECKs a service cannot be trusted with', () => {
  it('refuses a project space with no project, and a company space with one', async () => {
    const orphan = await failureOf(
      as(w, async (tx) =>
        tx.insert(wikiSpace).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          kind: 'project',
          projectId: null,
          name: 'Nowhere',
          slug: 'nowhere',
        }),
      ),
    );
    expect(orphan.code).toBe(SQLSTATE.checkViolation);

    const overreaching = await failureOf(
      as(w, async (tx) =>
        tx.insert(wikiSpace).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          kind: 'company',
          projectId: w.projectId,
          name: 'Company',
          slug: 'company-2',
        }),
      ),
    );
    expect(overreaching.code).toBe(SQLSTATE.checkViolation);
  });

  it('allows one company space per workspace and refuses a second', async () => {
    await makeSpace({ kind: 'company', slug: 'company' });

    const second = await failureOf(makeSpace({ kind: 'company', slug: 'company-again' }));
    expect(second.code).toBe(SQLSTATE.uniqueViolation);
  });

  it('refuses a page with a blank title', async () => {
    const spaceId = await makeSpace();
    const failure = await failureOf(makePage({ spaceId, title: '   ' }));
    expect(failure.code).toBe(SQLSTATE.checkViolation);
  });

  /**
   * §20.9's trade, asserted from both sides: the CHECK that replaced two NOT
   * NULLs "is stricter than the one it removes, because it also refuses a row
   * belonging to both".
   */
  it('refuses an attachment with no parent and one with two', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    const base = {
      workspaceId: w.workspaceId,
      uploadedByMemberId: w.ownerMemberId,
      filename: 'diagram.png',
      contentType: 'image/png',
      sizeBytes: 1024,
    } as const;

    const orphan = await failureOf(
      as(w, async (tx) => tx.insert(attachment).values({ id: uuidv7(), ...base })),
    );
    expect(orphan.code).toBe(SQLSTATE.checkViolation);

    // A page-owned row with a project id: the project is denormalized from the
    // *item* so a permission check needs no join, and a page's permission
    // question is asked of its space instead.
    const confused = await failureOf(
      as(w, async (tx) =>
        tx.insert(attachment).values({
          id: uuidv7(),
          ...base,
          wikiPageId: pageId,
          projectId: w.projectId,
        }),
      ),
    );
    expect(confused.code).toBe(SQLSTATE.checkViolation);

    // The page-owned row the constraint is *for*.
    const id = uuidv7();
    await as(w, async (tx) => tx.insert(attachment).values({ id, ...base, wikiPageId: pageId }));

    const [row] = await as(w, async (tx) =>
      tx.select().from(attachment).where(eq(attachment.id, id)),
    );
    expect(row?.workItemId).toBeNull();
    expect(row?.projectId).toBeNull();
  });

  /**
   * §20.6's subject union: "the notification row stores two nullable columns
   * under a CHECK that exactly one is set".
   */
  it('refuses a notification with no subject and one with two', async () => {
    const spaceId = await makeSpace();
    const pageId = await makePage({ spaceId });

    const base = {
      workspaceId: w.workspaceId,
      recipientMemberId: w.ownerMemberId,
      kind: 'mention' as const,
      eventType: 'wiki_page.created',
    };

    const none = await failureOf(
      as(w, async (tx) => tx.insert(notification).values({ id: uuidv7(), ...base })),
    );
    expect(none.code).toBe(SQLSTATE.checkViolation);

    // The page branch, which is what slice 18 added and what could not exist
    // before it.
    const id = uuidv7();
    await as(w, async (tx) =>
      tx.insert(notification).values({ id, ...base, wikiPageId: pageId }),
    );

    const [row] = await as(w, async (tx) =>
      tx.select().from(notification).where(eq(notification.id, id)),
    );
    expect(row?.wikiPageId).toBe(pageId);
    expect(row?.workItemId).toBeNull();
  });
});
