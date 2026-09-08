import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../tenant';
import {
  comment,
  commentMention,
  project,
  wikiPage,
  wikiSpace,
  workItem,
  workspaceMember,
} from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * Comments on a page, against real Postgres (§21.6 — slice 21).
 *
 * §21.6 widens `comment` the way §20.9 widened `attachment`: two NOT NULLs are
 * dropped and a third subject column is added, and **the CHECK that replaces
 * them refuses more than they did**. That trade is the whole reason this file
 * exists — a nullable column is exactly as correct as the constraint beside it,
 * and a constraint is only as good as the row somebody tried to write.
 *
 * §21.15 names the matching risk: "`comment`'s nullable columns are forgotten in
 * a predicate. The CHECK is the floor and every query names its subject
 * explicitly." The floor is asserted here; the second half is a compile error,
 * because `fetchComments` takes a union rather than two optional ids.
 *
 * What is pinned is what only a database can say — the invariants that hold for
 * a row written by a seed script, a Markdown importer or a Phase 2 MCP tool,
 * which is why 0038 carries them rather than `services/comments.ts`.
 */

let h: TenancyHarness;
let w: SeededWorkspace;
let other: SeededWorkspace;
/**
 * A workspace of its own for the author-link assertion, and the reason is worth
 * knowing before adding another `restrict` test anywhere in this suite.
 *
 * `workspace_member` is the target of several `ON DELETE RESTRICT` foreign keys,
 * and Postgres reports whichever one it reaches first. Run against `w`, whose
 * owner has by then created a work item for another test in this file, the
 * refusal names `work_item_creator_fk` — a true statement about a constraint
 * this test is not about. A member who has done exactly one thing is the only
 * way to assert *which* constraint held.
 */
let quiet: SeededWorkspace;

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'page-comments');
  other = await seedWorkspace(h, 'page-comments-other');
  quiet = await seedWorkspace(h, 'page-comments-author');
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

/** A counter for fixture slugs — `wiki.test.ts`'s note about UUIDv7 applies. */
let seq = 0;
const nextSuffix = () => {
  seq += 1;
  return `c${String(seq).padStart(3, '0')}`;
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
      body: 'Original body.',
    });
  });

  return id;
}

async function makeItem(ws: SeededWorkspace): Promise<string> {
  const id = uuidv7();

  await as(ws, async (tx) => {
    await tx.insert(workItem).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      stateId: ws.stateId,
      rootId: id,
      // The per-project counter is the service's, not the schema's, so a
      // fixture supplies one — `activity.test.ts` and `attachments.test.ts`
      // both do the same.
      number: Math.floor(Math.random() * 1_000_000),
      title: `Item ${nextSuffix()}`,
      createdByMemberId: ws.ownerMemberId,
      rank: 'm',
    });
  });

  return id;
}

/** A page comment, as `postPageComment` writes one. */
async function commentOnPage(ws: SeededWorkspace, pageId: string, body = 'Is this still true?') {
  const id = uuidv7();

  await as(ws, async (tx) => {
    await tx.insert(comment).values({
      id,
      workspaceId: ws.workspaceId,
      projectId: null,
      workItemId: null,
      wikiPageId: pageId,
      authorMemberId: ws.ownerMemberId,
      body,
    });
  });

  return id;
}

/* ------------------------------------------------------------------------- */

describe('the subject union', () => {
  /**
   * §21.6: "the constraint that replaces them refuses more than they did,
   * because it also refuses a row belonging to both."
   *
   * Both directions, because a CHECK written as `<= 1` would pass the first of
   * these and fail the second, and a test that only tried one could not tell the
   * two constraints apart. That is 0032's lesson for `attachment`, which uses
   * `= 1` for its parents and `<= 1` for the outbox — deliberately different,
   * and only distinguishable by trying the empty row.
   */
  it('refuses a comment on both an item and a page', async () => {
    const pageId = await makePage(w, await makeSpace(w));
    const itemId = await makeItem(w);

    const failure = await failureOf(
      as(w, (tx) =>
        tx.insert(comment).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          workItemId: itemId,
          wikiPageId: pageId,
          authorMemberId: w.ownerMemberId,
          body: 'Claiming two conversations at once.',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('comment_one_subject');
  });

  it('refuses a comment on nothing at all — the row the old NOT NULLs refused', async () => {
    const failure = await failureOf(
      as(w, (tx) =>
        tx.insert(comment).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          projectId: null,
          workItemId: null,
          wikiPageId: null,
          authorMemberId: w.ownerMemberId,
          body: 'Attached to nothing.',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('comment_one_subject');
  });

  /**
   * The project is denormalized from the *item* so a §10 check needs no join
   * (slice 8), so it is present exactly when the item is. A page's permission
   * question is asked of its space (§20.5) and a page in the company space has
   * no project at all — so a page-owned row carrying a project id would be a row
   * inviting the wrong check.
   */
  it('refuses a page comment that also names a project', async () => {
    const pageId = await makePage(w, await makeSpace(w));

    const failure = await failureOf(
      as(w, (tx) =>
        tx.insert(comment).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          workItemId: null,
          wikiPageId: pageId,
          authorMemberId: w.ownerMemberId,
          body: 'A project id nobody should read.',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('comment_project_with_item');
  });

  it('refuses an item comment with no project, which is the same rule backwards', async () => {
    const itemId = await makeItem(w);

    const failure = await failureOf(
      as(w, (tx) =>
        tx.insert(comment).values({
          id: uuidv7(),
          workspaceId: w.workspaceId,
          projectId: null,
          workItemId: itemId,
          wikiPageId: null,
          authorMemberId: w.ownerMemberId,
          body: 'An item comment nothing could authorise.',
        }),
      ),
    );

    expect(failure.code).toBe(SQLSTATE.checkViolation);
    expect(failure.message).toContain('comment_project_with_item');
  });

  it('accepts a page comment with both item columns null', async () => {
    const pageId = await makePage(w, await makeSpace(w));
    const commentId = await commentOnPage(w, pageId);

    const [row] = await as(w, (tx) =>
      tx
        .select({
          projectId: comment.projectId,
          workItemId: comment.workItemId,
          wikiPageId: comment.wikiPageId,
        })
        .from(comment)
        .where(eq(comment.id, commentId)),
    );

    expect(row?.wikiPageId).toBe(pageId);
    expect(row?.projectId).toBeNull();
    expect(row?.workItemId).toBeNull();
  });
});

describe('the thread predicate', () => {
  /**
   * The half §21.15 asks a *query* to get right, asserted at the level a query
   * runs at: a predicate on `wiki_page_id` returns one page's thread and not the
   * whole workspace's. A test that only counted rows would pass with the
   * predicate deleted, so this asserts the other page's comment is absent **by
   * id** — `notes.test.ts`'s construction, for the same reason.
   */
  it('returns one page thread and not another page in the same space', async () => {
    const spaceId = await makeSpace(w);
    const [mine, theirs] = [await makePage(w, spaceId), await makePage(w, spaceId)];

    const wanted = await commentOnPage(w, mine, 'On the page being read.');
    const unwanted = await commentOnPage(w, theirs, 'On the page beside it.');

    const rows = await as(w, (tx) =>
      tx.select({ id: comment.id }).from(comment).where(eq(comment.wikiPageId, mine)),
    );

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(wanted);
    expect(ids).not.toContain(unwanted);
  });

  it('keeps another workspace out, which is RLS rather than the predicate', async () => {
    const pageId = await makePage(other, await makeSpace(other));
    const hidden = await commentOnPage(other, pageId, 'Another company entirely.');

    // Asked in *this* workspace's scope for *that* workspace's page. RLS turns
    // the answer into nothing rather than into somebody else's conversation,
    // which is the failure mode §8 chose the boundary for.
    const rows = await as(w, (tx) =>
      tx.select({ id: comment.id }).from(comment).where(eq(comment.wikiPageId, pageId)),
    );

    expect(rows.map((row) => row.id)).not.toContain(hidden);
    expect(rows).toHaveLength(0);
  });
});

describe('what happens to a thread when its page goes', () => {
  /**
   * §20.3.6 gives a page a 30-day window, so a *soft* delete has to leave the
   * conversation intact — a restore that came back to an empty thread would have
   * destroyed something the window promised to keep.
   */
  it('leaves the thread alone when the page is soft-deleted', async () => {
    const pageId = await makePage(w, await makeSpace(w));
    const commentId = await commentOnPage(w, pageId);

    await as(w, (tx) =>
      tx.update(wikiPage).set({ deletedAt: new Date() }).where(eq(wikiPage.id, pageId)),
    );

    const rows = await as(w, (tx) =>
      tx.select({ id: comment.id }).from(comment).where(eq(comment.wikiPageId, pageId)),
    );

    expect(rows.map((row) => row.id)).toEqual([commentId]);
  });

  /**
   * A hard delete takes it, which is `comment_page_fk`'s `cascade` and the same
   * answer `comment_item_fk` gives: a conversation about a row that no longer
   * exists is a thread nobody can open. The opposite call from `note`'s pin,
   * which survives its item because the note is still the person's (§20.4).
   */
  it('takes the thread with it when the page is hard-deleted', async () => {
    const pageId = await makePage(w, await makeSpace(w));
    const commentId = await commentOnPage(w, pageId);

    await as(w, async (tx) => {
      await tx.insert(commentMention).values({
        workspaceId: w.workspaceId,
        commentId,
        workspaceMemberId: w.memberMemberId,
      });
    });

    await as(w, (tx) => tx.delete(wikiPage).where(eq(wikiPage.id, pageId)));

    const [comments, mentions] = [
      await as(w, (tx) => tx.select({ id: comment.id }).from(comment).where(eq(comment.id, commentId))),
      await as(w, (tx) =>
        tx
          .select({ id: commentMention.id })
          .from(commentMention)
          .where(eq(commentMention.commentId, commentId)),
      ),
    ];

    expect(comments).toHaveLength(0);
    // The mention cascades behind the comment, which is the chain slice 8 built
    // and which a second parent must not have broken.
    expect(mentions).toHaveLength(0);
  });

  /**
   * The author link is `restrict` on both subjects, and §7.12 is why: "activity
   * history is preserved and attributed". A page comment is something a person
   * wrote, so offboarding must not be able to delete their half of a
   * conversation — the asymmetry §20.4 draws against a note, which *is*
   * destroyed.
   */
  it('refuses to remove the author of a page comment', async () => {
    const pageId = await makePage(quiet, await makeSpace(quiet));
    await commentOnPage(quiet, pageId);

    const failure = await failureOf(
      as(quiet, (tx) =>
        tx.delete(workspaceMember).where(eq(workspaceMember.id, quiet.ownerMemberId)),
      ),
    );

    // `23001` rather than `23503`, which is the distinction slice 11 recorded for
    // the cycle key and slice 18 met again on a revision: 23503 is *that row does
    // not exist*, 23001 is *that row exists and something still needs it*.
    expect(failure.code).toBe(SQLSTATE.restrictViolation);
    expect(failure.message).toContain('comment_author_fk');
  });
});
