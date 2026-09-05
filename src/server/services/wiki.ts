import 'server-only';

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import {
  project,
  user,
  wikiPage,
  wikiPageLink,
  wikiPageRevision,
  wikiSpace,
  workItem,
  workspaceMember,
} from '@/server/db/schema';
import { withActor, type UnitOfWork } from '@/server/db/tenant';
import {
  fetchDeletedPages,
  fetchItemPages,
  fetchPage,
  fetchPageBySlug,
  fetchPageLinks,
  fetchPageRefs,
  fetchRevisionPair,
  fetchRevisions,
  fetchSpaces,
  fetchSpaceTree,
  fetchSubtree,
  type LinkedItem,
  type PageDetail,
  type PageRef,
  type PageSummary,
  type RevisionRow,
} from '@/server/queries/wiki';
import { normalizeDocument } from '@/lib/documents';
import { parsePageIds } from '@/lib/doc-refs';
import { parseMentionIds } from '@/lib/mentions';
import { parseItemReference } from '@/lib/search';
import { deriveSlug } from '@/lib/slug';
import {
  checkMove,
  normalizePageTitle,
  pageSlug,
  reorderPositions,
  validatePage,
  type PageProblem,
} from '@/lib/wiki';
import { isArchived, loadProject, projectResource } from './project-access';
import {
  canReadSpace,
  canWriteSpace,
  checkSpaceWrite,
  loadSpaceBySlug,
  resolveSpace,
  withProject,
  type SpaceContext,
} from './space-access';

/**
 * The wiki (§20 — slice 18).
 *
 * **A page is the company's record; a note is one person's thinking** (§20.1).
 * This module is the public half, and the three properties that follow from
 * that are worth having in one place before the functions:
 *
 * **A page's permissions are its space's** (§20.5). Every mutation resolves a
 * `SpaceContext` and asks `space-access.ts`; nothing here re-derives a rule.
 * Per-page ACLs are refused for the reason §6-2 defers per-field permissions —
 * "a per-object ACL is a second permission system that has to be joined into
 * every list query, shown in every UI, and explained to the non-technical owner
 * of §2.3."
 *
 * **A stale save is refused, never merged** (§20.3.3), and this is the rule the
 * board deliberately does *not* follow. §9 asks a stale *drag* to "land
 * correctly relative to present state — this is what stops boards feeling
 * haunted", because a card's position is small and recoverable and re-deriving
 * it is what the human meant anyway. A document body is neither: "last-write-wins
 * on a paragraph somebody spent twenty minutes on destroys work with no trace,
 * and a three-way merge of prose produces a sentence neither person wrote." So
 * `saveWikiPage` updates conditionally on `revision_no` and hands both bodies
 * back when it loses.
 *
 * **Every save is a revision, and the history is append-only** (§20.2, §20.4).
 * Restore writes a *new* revision whose body is an old one; nothing is ever
 * removed, which is what makes §20.15's "the cost of a bad edit has to be
 * visibly one click" true.
 */

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: WikiFailure };

export type WikiFailure =
  | PageProblem
  | 'not_found'
  | 'archived'
  | 'forbidden'
  | 'slug_taken'
  | 'into_descendant'
  | 'unknown_item'
  /** §20.3.3, and the one refusal this feature exists to make well. */
  | 'stale'
  /** A mention naming somebody who cannot read the space (§7.7's rule, applied to a page). */
  | 'mention_not_visible';

export type SpaceView = {
  id: string;
  kind: 'company' | 'project';
  name: string;
  nameKey: string | null;
  slug: string;
  pageCount: number;
  /** Whether this actor may create or edit pages in it (§20.5). */
  canWrite: boolean;
};

export type PageView = {
  page: PageDetail;
  space: SpaceView;
  tree: PageSummary[];
  /** The trail from the space root to this page, for the breadcrumb. */
  ancestors: PageSummary[];
  links: LinkedItem[];
  /** `@[uuid]` → display name, resolved at render and never stored (§20.7). */
  mentioned: Record<string, string>;
  /** `#[uuid]` → title, same rule. */
  pages: PageRef[];
  canWrite: boolean;
};

/* ------------------------------------------------------------------------- */
/* Spaces                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * The spaces this actor may read (§20.11's space list).
 *
 * Filtered in TypeScript after the query, because `canReadSpace` needs each
 * space's project loaded and is not a SQL predicate — and because a workspace
 * has one company space plus one per project, which is a handful of rows. That
 * is the reverse of `listProjects`, which expresses visibility as SQL *and*
 * re-checks in the module, and the reason is scale rather than principle: §10 is
 * still the only authority either way.
 */
export async function listSpaces(resolved: ResolvedActor): Promise<SpaceView[]> {
  return withActor(resolved.context, async (tx) => listSpacesIn(tx, resolved));
}

/**
 * The same, inside a transaction that is already open.
 *
 * Split for the reason `listProjectsIn` was in slice 14 and `createWorkItemIn`
 * in slice 17: the page screens need the space list *and* a page in one
 * transaction, and a second `withActor` would hold two pooled connections for
 * one render — the trap slice 8 hit with `getCommentThread`, slice 9 with the
 * unread count, slice 10 with custom fields, slice 13 with §7.4's six lists and
 * slice 14 with the palette's scope.
 */
export async function listSpacesIn(tx: TenantDb, resolved: ResolvedActor): Promise<SpaceView[]> {
  const rows = await fetchSpaces(tx);
  const out: SpaceView[] = [];

  for (const row of rows) {
    const context = await withProject(tx, row);
    if (!context || !canReadSpace(resolved.actor, context)) continue;

    out.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      nameKey: row.nameKey,
      slug: row.slug,
      pageCount: row.pageCount,
      canWrite: canWriteSpace(resolved.actor, context),
    });
  }

  return out;
}

/** The space ids this actor may read — the anchor the search sections use (§20.8). */
export async function readableSpaceIds(tx: TenantDb, resolved: ResolvedActor): Promise<string[]> {
  return (await listSpacesIn(tx, resolved)).map((space) => space.id);
}

/**
 * The company space, created if it is not there (§20.2).
 *
 * Called at signup beside the seeded workflow states and the seeded holidays,
 * and **idempotently on demand**, which is what makes it safe for a workspace
 * created before slice 18 shipped. §6's governing rule is that "a company that
 * never opens Settings must be completely fine", and the wiki equivalent is that
 * a company that never opened `/wiki` still has one when they do.
 *
 * `nameKey` rather than a literal English name, which is §13's awkward middle
 * and the same call `workflow_state` and `team` make: it renders translated
 * until somebody renames it, and the rename clears the key so their literal wins
 * for good. That is the opposite of the call slice 15 made for a seeded holiday
 * — and correctly, because "Company" has an English default it is right to fall
 * back to, where Khmer New Year does not.
 */
export async function ensureCompanySpace(
  tx: TenantDb,
  uow: UnitOfWork,
  workspaceId: string,
): Promise<string> {
  const existing = await tx
    .select({ id: wikiSpace.id })
    .from(wikiSpace)
    .where(and(eq(wikiSpace.kind, 'company'), isNull(wikiSpace.deletedAt)))
    .limit(1);

  const found = existing[0];
  if (found) return found.id;

  const id = uuidv7();
  const taken = await takenSpaceSlugs(tx);

  await tx.insert(wikiSpace).values({
    id,
    workspaceId,
    kind: 'company',
    projectId: null,
    name: 'Company',
    nameKey: 'wiki.spaces.company',
    slug: deriveSlug('company', taken),
  });

  uow.emit({
    type: 'wiki_space.created',
    workspaceId,
    spaceId: id,
    kind: 'company',
    projectId: null,
    name: 'Company',
  });

  return id;
}

/**
 * A project's space, created with the project (§20.2).
 *
 * Takes the project's own name and carries **no** `nameKey`, because the name it
 * is derived from is already the company's own word — there is nothing to
 * translate and nothing to fall back to.
 */
export async function ensureProjectSpace(
  tx: TenantDb,
  uow: UnitOfWork,
  input: { workspaceId: string; projectId: string; name: string },
): Promise<string> {
  const existing = await tx
    .select({ id: wikiSpace.id })
    .from(wikiSpace)
    .where(and(eq(wikiSpace.projectId, input.projectId), isNull(wikiSpace.deletedAt)))
    .limit(1);

  const found = existing[0];
  if (found) return found.id;

  const id = uuidv7();
  const taken = await takenSpaceSlugs(tx);

  await tx.insert(wikiSpace).values({
    id,
    workspaceId: input.workspaceId,
    kind: 'project',
    projectId: input.projectId,
    name: input.name,
    nameKey: null,
    slug: deriveSlug(input.name, taken),
  });

  uow.emit({
    type: 'wiki_space.created',
    workspaceId: input.workspaceId,
    spaceId: id,
    kind: 'project',
    projectId: input.projectId,
    name: input.name,
  });

  return id;
}

/** Renaming a space clears its seeded key, so the literal wins for good (§13). */
export async function renameSpace(
  resolved: ResolvedActor,
  input: { spaceId: string; name: string },
): Promise<Ok | Failed> {
  const name = input.name.replace(/\s+/g, ' ').trim().normalize('NFC');
  if (name.length === 0) return { ok: false, problem: 'title_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const context = await resolveSpace(tx, input.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    await tx
      .update(wikiSpace)
      .set({ name, nameKey: null, updatedAt: new Date() })
      .where(eq(wikiSpace.id, input.spaceId));

    uow.emit({
      type: 'wiki_space.updated',
      workspaceId: resolved.workspace.id,
      spaceId: input.spaceId,
      from: context.space.name,
      to: name,
    });

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Reading a page                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Everything one page screen needs, in one transaction.
 *
 * The space, the tree, the page, its breadcrumb, its linked items, and the names
 * behind the three token formats its body carries. One `withActor` for all of
 * it, which is §20.12's explicit instruction and the trap five earlier slices
 * hit before it was one.
 */
export async function getPage(
  resolved: ResolvedActor,
  input: { spaceSlug: string; pageSlug: string },
): Promise<PageView | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, input.spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    const page = await fetchPageBySlug(tx, { spaceId: space.id, slug: input.pageSlug });
    if (!page) return null;

    const tree = await fetchSpaceTree(tx, space.id);

    /**
     * The linked items, filtered by §10 *after* the query (§20.4's link table
     * carries no visibility of its own).
     *
     * This is the one place in the wiki where a reader can hold rows they may
     * not follow: a company-space page is readable by everybody and may link to
     * an item in a private project. Dropping them silently is right — a count
     * that said "3 linked items" over a list of one would be telling a reader
     * something about a project they cannot see.
     */
    const canWrite = canWriteSpace(resolved.actor, context);

    const links = (await fetchPageLinks(tx, page.id)).filter((link) =>
      can(resolved.actor, 'project.view', {
        id: link.projectId,
        workspaceId: link.projectWorkspaceId,
        visibility: link.projectVisibility,
      }),
    );

    return {
      page,
      space: toSpaceView(context, tree.length, canWrite),
      tree,
      ancestors: ancestorsOf(tree, page.parentId),
      links,
      mentioned: await hydrateMentions(tx, [page.body]),
      pages: await fetchPageRefs(tx, parsePageIds(page.body)),
      canWrite,
    };
  });
}

/** The space home: the tree, with no page selected (§20.11). */
export async function getSpace(
  resolved: ResolvedActor,
  spaceSlug: string,
): Promise<{ space: SpaceView; tree: PageSummary[] } | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    const tree = await fetchSpaceTree(tx, space.id);
    return {
      space: toSpaceView(context, tree.length, canWriteSpace(resolved.actor, context)),
      tree,
    };
  });
}

/**
 * The pages linked from a work item (§20.12's `related-pages.tsx`).
 *
 * Takes an open transaction, because §20.12 says in as many words that it "rides
 * that transaction" — the one `getWorkItem` already opens.
 *
 * Filtered by readable space, which is the check the query cannot make: an item
 * somebody can see may be linked from a page in a project they cannot.
 */
export async function relatedPagesFor(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
): Promise<{ pageId: string; title: string; slug: string; spaceSlug: string }[]> {
  const rows = await fetchItemPages(tx, workItemId);
  if (rows.length === 0) return [];

  const readable = new Set(await readableSpaceIds(tx, resolved));

  return rows
    .filter((row) => readable.has(row.spaceId))
    .map(({ pageId, title, slug, spaceSlug }) => ({ pageId, title, slug, spaceSlug }));
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

export async function createPage(
  resolved: ResolvedActor,
  input: { spaceId: string; parentId?: string | null; title: string; body?: string },
): Promise<Ok<{ pageId: string; slug: string; spaceSlug: string }> | Failed> {
  return withActor(resolved.context, async (tx, uow) =>
    createPageIn(tx, uow, resolved, input),
  );
}

/**
 * The same, inside a transaction that is already open.
 *
 * Split for the reason `createWorkItemIn` was in slice 17 and `listProjectsIn`
 * in slice 14: promoting a note into a page reads the note, creates the page and
 * records what the note became, and those three are one act that either happened
 * or did not. A second `withActor` would hold two pooled connections for one
 * click and could commit half of it.
 */
export async function createPageIn(
  tx: TenantDb,
  uow: UnitOfWork,
  resolved: ResolvedActor,
  input: { spaceId: string; parentId?: string | null; title: string; body?: string },
): Promise<Ok<{ pageId: string; slug: string; spaceSlug: string }> | Failed> {
  const title = normalizePageTitle(input.title);
  const body = normalizeDocument(input.body ?? '');

  {
    const context = await resolveSpace(tx, input.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const parentId = input.parentId ?? null;
    const tree = await fetchSpaceTree(tx, input.spaceId);

    // The depth a new page would sit at. The trigger in 0032 enforces the cap
    // whatever gets here; this is what lets the editor say so in words rather
    // than surfacing a constraint violation.
    const depth = parentId === null ? 1 : (findPage(tree, parentId)?.depth ?? 0) + 1;
    if (parentId !== null && depth === 1) return { ok: false, problem: 'not_found' } as const;

    const problem = validatePage({ title, body, depth });
    if (problem) return { ok: false, problem } as const;

    const mentioned = parseMentionIds(body);
    const refused = await refusedMentions(tx, context, mentioned);
    if (refused) return refused;

    const pageId = uuidv7();
    const slug = await freeSlug(tx, input.spaceId, pageSlug(title, pageId), null);

    await tx.insert(wikiPage).values({
      id: pageId,
      workspaceId: resolved.workspace.id,
      spaceId: input.spaceId,
      parentId,
      // Overwritten by 0032's trigger, which is the authority. A value is still
      // required because the column is NOT NULL and BEFORE triggers run after
      // the row is formed.
      rootId: pageId,
      depth,
      position: nextPosition(tree, parentId),
      slug,
      title,
      body,
      revisionNo: 1,
    });

    await writeRevision(tx, resolved, { pageId, revisionNo: 1, title, body });

    uow.emit({
      type: 'wiki_page.created',
      workspaceId: resolved.workspace.id,
      spaceId: input.spaceId,
      pageId,
      title,
      mentioned,
    });

    await syncOutboundLinks(tx, uow, resolved, { pageId, body, previousBody: '' });

    return { ok: true, pageId, slug, spaceSlug: context.space.slug } as const;
  }
}

/**
 * A save (§20.3.3), and the one operation this whole feature turns on.
 *
 * **The update is conditional on the revision the writer started from.** If the
 * page has moved on, nothing is written and both bodies come back so the screen
 * can show them side by side. Their words are never discarded and never merged.
 *
 * Two details of the conditional update are load-bearing:
 *
 *   * It is **one statement**, not a read followed by a write. A `SELECT` then
 *     an `UPDATE` has a window between them, and two saves landing in that
 *     window would both pass the check. `where revision_no = $base` closes it,
 *     because the row is locked by the update itself.
 *   * The **new revision row is written after** the page update succeeds, so a
 *     refused save leaves no revision behind. `wiki_page_revision_no_key` would
 *     catch a duplicate anyway, and that is the second layer rather than the
 *     first.
 *
 * `[!]` §20.3.3: the same person in two tabs is refused too, and the message
 * says so plainly rather than blaming a colleague who does not exist — which is
 * why the refusal carries the author of the landed revision rather than assuming
 * it was somebody else.
 */
export async function saveWikiPage(
  resolved: ResolvedActor,
  input: { pageId: string; title: string; body: string; baseRevision: number },
): Promise<
  | Ok<{ revisionNo: number; slug: string }>
  | (Failed & { current?: { title: string; body: string; revisionNo: number } })
> {
  const title = normalizePageTitle(input.title);
  const body = normalizeDocument(input.body);

  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const problem = validatePage({ title, body });
    if (problem) return { ok: false, problem } as const;

    const mentioned = parseMentionIds(body);
    const refused = await refusedMentions(tx, context, mentioned);
    if (refused) return refused;

    const revisionNo = input.baseRevision + 1;
    const slug = await freeSlug(tx, page.spaceId, pageSlug(title, page.id), page.id);

    /**
     * The whole of §20.3.3, in one `where`.
     *
     * `returning` rather than a row count, because the returned row is the proof
     * the update happened *and* the new revision number — asking for it
     * separately would be the second statement this is written to avoid.
     */
    const updated = await tx
      .update(wikiPage)
      .set({ title, body, slug, revisionNo, updatedAt: new Date() })
      .where(and(eq(wikiPage.id, page.id), eq(wikiPage.revisionNo, input.baseRevision)))
      .returning({ revisionNo: wikiPage.revisionNo });

    if (updated.length === 0) {
      // Somebody else saved while this writer was typing. Re-read rather than
      // reusing the row from the top of this function: the point of the screen
      // is to show what actually landed, and that may have landed after we read.
      const current = await fetchPage(tx, page.id);
      return {
        ok: false,
        problem: 'stale',
        current: current
          ? { title: current.title, body: current.body, revisionNo: current.revisionNo }
          : undefined,
      } as const;
    }

    await writeRevision(tx, resolved, { pageId: page.id, revisionNo, title, body });

    /**
     * **Only the mentions this revision newly added** (§20.6).
     *
     * The general §7.8 rule would re-notify everybody named in a handbook page
     * every time somebody fixed a typo in it, which is precisely the failure
     * §7.8 is blunt about — it is how a team learns to filter the product's
     * mail. Computed against the previous body, which is the body we read at the
     * top of this transaction and which the conditional update just proved was
     * current.
     */
    const before = new Set(parseMentionIds(page.body));

    uow.emit({
      type: 'wiki_page.updated',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId: page.id,
      revisionNo,
      mentioned: mentioned.filter((id) => !before.has(id)),
    });

    await syncOutboundLinks(tx, uow, resolved, {
      pageId: page.id,
      body,
      previousBody: page.body,
    });

    return { ok: true, revisionNo, slug } as const;
  });
}

/**
 * Move a page — to a new parent, a new space, or both (§20.2).
 *
 * A cross-space move changes who may read the page (§20.5), so **both** spaces
 * are asked about: the one it is leaving and the one it is joining. That is the
 * one page operation that is a permission change wearing the clothes of a drag,
 * and it is why `wiki_page.moved` carries both space ids into the audit log.
 */
export async function movePage(
  resolved: ResolvedActor,
  input: { pageId: string; toSpaceId?: string; parentId: string | null },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const from = await resolveSpace(tx, page.spaceId);
    if (!from) return { ok: false, problem: 'not_found' } as const;

    const fromRefusal = checkSpaceWrite(resolved.actor, from);
    if (fromRefusal !== null) return { ok: false, problem: fromRefusal } as const;

    const toSpaceId = input.toSpaceId ?? page.spaceId;
    const to =
      toSpaceId === page.spaceId ? from : await resolveSpace(tx, toSpaceId);
    if (!to) return { ok: false, problem: 'not_found' } as const;

    if (to.space.id !== from.space.id) {
      const toRefusal = checkSpaceWrite(resolved.actor, to);
      if (toRefusal !== null) return { ok: false, problem: toRefusal } as const;
    }

    /**
     * The depth and cycle checks, against the *destination* space's tree plus
     * the subtree being moved.
     *
     * `checkMove` in `src/lib/wiki.ts` is pure and answers both; 0032's triggers
     * answer them again underneath, which is what makes a seed script or a Phase
     * 2 MCP tool as correct as this. The two exist for different audiences: the
     * trigger refuses, and this explains.
     */
    const destinationTree = await fetchSpaceTree(tx, toSpaceId);
    const subtree = await fetchSubtree(tx, page.rootId);
    const combined = [...destinationTree, ...subtree.filter((row) => row.spaceId !== toSpaceId)];

    const move = checkMove(combined, page.id, input.parentId);
    if (move === 'into_descendant') return { ok: false, problem: 'into_descendant' } as const;
    if (move === 'too_deep') return { ok: false, problem: 'too_deep' } as const;

    const slug = await freeSlug(tx, toSpaceId, page.slug, page.id);

    await tx
      .update(wikiPage)
      .set({
        spaceId: toSpaceId,
        parentId: input.parentId,
        slug,
        position: nextPosition(destinationTree, input.parentId),
        updatedAt: new Date(),
      })
      .where(eq(wikiPage.id, page.id));

    uow.emit({
      type: 'wiki_page.moved',
      workspaceId: resolved.workspace.id,
      pageId: page.id,
      fromSpaceId: from.space.id,
      toSpaceId,
      fromParentId: page.parentId,
      toParentId: input.parentId,
    });

    return { ok: true } as const;
  });
}

/**
 * Sibling order, rewritten as a block (§20.4).
 *
 * `workflow_state`'s call from slice 4, not the board's from slice 6: fractional
 * ranking exists because several people drag cards on one board at once, and a
 * documentation sidebar reordered by one person is not that.
 *
 * No event. Reordering a sidebar is furniture — the call `saved_view` makes for
 * naming a filter (slice 12) and `workflow_state`'s own reorder already makes.
 */
export async function reorderPages(
  resolved: ResolvedActor,
  input: { spaceId: string; parentId: string | null; orderedIds: string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const context = await resolveSpace(tx, input.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const siblings = (await fetchSpaceTree(tx, input.spaceId)).filter(
      (row) => row.parentId === input.parentId,
    );
    const known = new Set(siblings.map((row) => row.id));

    // Ids the caller sent that are not siblings are dropped rather than
    // refused, and any sibling the caller omitted keeps its place at the end —
    // so a reorder computed against a tree that changed underneath lands
    // sensibly instead of failing. That is §9's "discarding rather than
    // failing", applied to a gesture.
    const ordered = [
      ...input.orderedIds.filter((id) => known.has(id)),
      ...siblings.map((row) => row.id).filter((id) => !input.orderedIds.includes(id)),
    ];

    for (const { id, position } of reorderPositions(ordered)) {
      await tx
        .update(wikiPage)
        .set({ position, updatedAt: new Date() })
        .where(eq(wikiPage.id, id));
    }

    return { ok: true } as const;
  });
}

/**
 * Delete a page, softly, with §4's 30-day window (§20.3.6).
 *
 * **Children are reparented to the deleted page's parent, never deleted with
 * it** — "the rule `deleteCycle` follows and `work_item_state_fk` enforces:
 * deleting a container must never decide the fate of what is inside it."
 * `wiki_page_parent_fk` is `restrict`, which is the second layer.
 *
 * The reparenting happens *before* the delete, so at no point is there a live
 * page whose parent is deleted — which is the state `buildPageTree`'s orphan
 * fallback exists to survive rather than to rely on.
 */
export async function deletePage(
  resolved: ResolvedActor,
  pageId: string,
): Promise<Ok<{ reparented: number }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const children = await tx
      .update(wikiPage)
      .set({ parentId: page.parentId, updatedAt: new Date() })
      .where(and(eq(wikiPage.parentId, pageId), isNull(wikiPage.deletedAt)))
      .returning({ id: wikiPage.id });

    await tx
      .update(wikiPage)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(wikiPage.id, pageId));

    uow.emit({
      type: 'wiki_page.deleted',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId,
      title: page.title,
      reparented: children.length,
    });

    return { ok: true, reparented: children.length } as const;
  });
}

/** The other half of §4's window: bring it back where it was. */
export async function restorePage(
  resolved: ResolvedActor,
  pageId: string,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, pageId, { includeDeleted: true });
    if (!page || page.deletedAt === null) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    /**
     * The parent may itself have been deleted while this page was away, and a
     * restore that re-attached to it would produce a live page under a dead one
     * — the state the delete path is careful never to create. Restoring to the
     * space root instead is the honest answer: the page is back and its place is
     * something somebody can fix in one drag.
     */
    const parent =
      page.parentId === null ? null : await fetchPage(tx, page.parentId);

    await tx
      .update(wikiPage)
      .set({
        deletedAt: null,
        parentId: parent ? page.parentId : null,
        slug: await freeSlug(tx, page.spaceId, page.slug, page.id),
        updatedAt: new Date(),
      })
      .where(eq(wikiPage.id, pageId));

    uow.emit({
      type: 'wiki_page.restored',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId,
      title: page.title,
    });

    return { ok: true } as const;
  });
}

/** Deleted pages still inside the window, for the recovery screen. */
export async function listDeletedPages(resolved: ResolvedActor) {
  return withActor(resolved.context, async (tx) => {
    const spaceIds = await readableSpaceIds(tx, resolved);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return fetchDeletedPages(tx, { spaceIds, since });
  });
}

/* ------------------------------------------------------------------------- */
/* History                                                                   */
/* ------------------------------------------------------------------------- */

export async function getHistory(
  resolved: ResolvedActor,
  input: { spaceSlug: string; pageSlug: string },
): Promise<{ page: PageDetail; space: SpaceView; revisions: RevisionRow[]; canWrite: boolean } | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, input.spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    const page = await fetchPageBySlug(tx, { spaceId: space.id, slug: input.pageSlug });
    if (!page) return null;

    const canWrite = canWriteSpace(resolved.actor, context);

    return {
      page,
      space: toSpaceView(context, 0, canWrite),
      revisions: await fetchRevisions(tx, { pageId: page.id }),
      canWrite,
    };
  });
}

/** Two revisions of one page, for the side-by-side compare (§20.2). */
export async function getCompare(
  resolved: ResolvedActor,
  input: { spaceSlug: string; pageSlug: string; from: number; to: number },
): Promise<{ page: PageDetail; from: RevisionRow | null; to: RevisionRow | null } | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, input.spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    const page = await fetchPageBySlug(tx, { spaceId: space.id, slug: input.pageSlug });
    if (!page) return null;

    const pair = await fetchRevisionPair(tx, { pageId: page.id, from: input.from, to: input.to });

    return {
      page,
      from: pair.find((row) => row.revisionNo === input.from) ?? null,
      to: pair.find((row) => row.revisionNo === input.to) ?? null,
    };
  });
}

/**
 * Restore an old revision (§20.2, §20.4).
 *
 * **It writes a new revision whose body is an old one.** Nothing is removed from
 * the history, which is what makes the history worth having — and what makes
 * §20.15's "the cost of a bad edit has to be visibly one click" literally true:
 * restoring a restore is the same click again.
 *
 * It goes through `saveWikiPage` rather than writing the row itself, so the
 * concurrency rule, the mention diff, the link sync and the slug all behave
 * exactly as they do for a save typed by hand. A second path here would be a
 * second place for §20.3.3 to be got wrong.
 */
export async function restoreRevision(
  resolved: ResolvedActor,
  input: { pageId: string; revisionNo: number; baseRevision: number },
): Promise<Ok<{ revisionNo: number; slug: string }> | Failed> {
  const source = await withActor(resolved.context, async (tx) => {
    const rows = await fetchRevisionPair(tx, {
      pageId: input.pageId,
      from: input.revisionNo,
      to: input.revisionNo,
    });
    return rows[0] ?? null;
  });

  if (!source) return { ok: false, problem: 'not_found' };

  const saved = await saveWikiPage(resolved, {
    pageId: input.pageId,
    title: source.title,
    body: source.body,
    baseRevision: input.baseRevision,
  });

  return saved.ok ? saved : { ok: false, problem: saved.problem };
}

/* ------------------------------------------------------------------------- */
/* Links                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Attach a page to a work item, by the identifier a person typed (§20.2).
 *
 * **Both halves of the question are asked**: writing in the page's space, and
 * `work_item.edit` on the item — because the link appears in *both* places and
 * either one alone would let somebody put a row on a screen they have no say
 * over. §10's `work_item.edit` is the existing row for "change something about
 * this item", and a link is exactly that; no new row was invented, which keeps
 * §20.5's two at two.
 *
 * `parseItemReference` is slice 14's, unchanged, and it deliberately accepts
 * both `ENG-142` and `ENG142` — §7.9's reasoning is that "a person typing an
 * identifier into a search box has said what they mean", and a link field is
 * that same act. This is the *opposite* rule from `scanItemReferences`, which
 * requires the separator because running prose is where `A4` is a paper size;
 * the two live side by side in `doc-refs.ts` with that contrast written down.
 *
 * A malformed identifier and one naming no item both refuse as `unknown_item`.
 * They are different facts, and neither is worth a second message: the field
 * shows an example, so "that is not an item" covers both without telling
 * somebody which keys exist in a company they may not be able to see.
 */
export async function linkPageByIdentifier(
  resolved: ResolvedActor,
  input: { pageId: string; identifier: string },
): Promise<Ok<{ workItemId: string; projectSlug: string }> | Failed> {
  const reference = parseItemReference(input.identifier);
  if (reference === null) return { ok: false, problem: 'unknown_item' };

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({
        id: workItem.id,
        projectId: workItem.projectId,
        projectSlug: project.slug,
        projectWorkspaceId: project.workspaceId,
        visibility: project.visibility,
        archivedAt: project.archivedAt,
      })
      .from(workItem)
      .innerJoin(project, eq(project.id, workItem.projectId))
      .where(
        and(
          eq(project.key, reference.key),
          eq(workItem.number, reference.number),
          isNull(workItem.deletedAt),
          isNull(project.deletedAt),
        ),
      )
      .limit(1);

    const item = rows[0];
    if (!item) return { ok: false, problem: 'unknown_item' } as const;

    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    if (item.archivedAt !== null) return { ok: false, problem: 'archived' } as const;

    // §10 about the *item*, and `unknown_item` rather than `forbidden` when the
    // answer is no: an identifier is guessable, and a refusal that distinguished
    // "no such item" from "not yours" would confirm which project keys and
    // numbers a company has. That is §7.9's own reasoning for the direct lookup.
    if (
      !can(resolved.actor, 'work_item.edit', {
        id: item.projectId,
        workspaceId: item.projectWorkspaceId,
        visibility: item.visibility,
      })
    ) {
      return { ok: false, problem: 'unknown_item' } as const;
    }

    await insertLink(tx, uow, resolved, {
      pageId: input.pageId,
      workItemId: item.id,
      projectId: item.projectId,
    });

    return { ok: true, workItemId: item.id, projectSlug: item.projectSlug } as const;
  });
}

export async function unlinkPageFromItem(
  resolved: ResolvedActor,
  input: { pageId: string; workItemId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const resolvedLink = await resolveLink(tx, resolved, input);
    if ('problem' in resolvedLink) return { ok: false, problem: resolvedLink.problem } as const;

    const removed = await tx
      .delete(wikiPageLink)
      .where(
        and(
          eq(wikiPageLink.pageId, input.pageId),
          eq(wikiPageLink.workItemId, input.workItemId),
        ),
      )
      .returning({ id: wikiPageLink.id });

    if (removed.length === 0) return { ok: true } as const;

    uow.emit({
      type: 'wiki_page.unlinked',
      workspaceId: resolved.workspace.id,
      projectId: resolvedLink.projectId,
      workItemId: input.workItemId,
      pageId: input.pageId,
    });

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Internals                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Every revision row is written here, and it is the only writer.
 *
 * The table takes SELECT and INSERT and nothing else (0032 revokes the rest), so
 * there is no update path to keep consistent — which is what §20.4 means by "a
 * revision that can be edited is not a history".
 */
async function writeRevision(
  tx: TenantDb,
  resolved: ResolvedActor,
  input: { pageId: string; revisionNo: number; title: string; body: string },
): Promise<void> {
  await tx.insert(wikiPageRevision).values({
    id: uuidv7(),
    workspaceId: resolved.workspace.id,
    pageId: input.pageId,
    revisionNo: input.revisionNo,
    title: input.title,
    body: input.body,
    authorMemberId: resolved.memberId,
  });
}

/**
 * `#[uuid]` tokens in a body become `wiki_page_link` rows — no, they do not, and
 * this function is where that decision is written down.
 *
 * A `#[page]` token is a **page-to-page** reference and needs no row: it is
 * resolved at render by `fetchPageRefs`, the way a mention is. `wiki_page_link`
 * is a **page-to-work-item** relation, which is a different edge with a
 * different reader — §20.2's "an item lists its pages".
 *
 * What this *does* sync is the `ENG-142` autolinks in a body, and only in one
 * direction: writing a page that names an item links them, so the item's related
 * panel finds the page. Removing the reference does **not** unlink, because a
 * link somebody made deliberately from the item's own panel should not be undone
 * by an edit to a sentence. Detaching stays an explicit act.
 */
async function syncOutboundLinks(
  tx: TenantDb,
  uow: UnitOfWork,
  resolved: ResolvedActor,
  input: { pageId: string; body: string; previousBody: string },
): Promise<void> {
  const { scanItemReferences } = await import('@/lib/doc-refs');

  const before = new Set(
    scanItemReferences(input.previousBody).map((hit) => `${hit.key}-${hit.number}`),
  );
  const added = scanItemReferences(input.body).filter(
    (hit) => !before.has(`${hit.key}-${hit.number}`),
  );
  if (added.length === 0) return;

  for (const hit of added) {
    const rows = await tx
      .select({
        id: workItem.id,
        projectId: workItem.projectId,
        projectWorkspaceId: project.workspaceId,
        visibility: project.visibility,
      })
      .from(workItem)
      .innerJoin(project, eq(project.id, workItem.projectId))
      .where(
        and(
          eq(project.key, hit.key),
          eq(workItem.number, hit.number),
          isNull(workItem.deletedAt),
        ),
      )
      .limit(1);

    const item = rows[0];
    if (!item) continue;

    // §10 decides, exactly as it does for an explicit link. An identifier typed
    // into a body must not become a link to an item the writer cannot see —
    // which would tell them, through the item's own panel, that it exists.
    if (
      !can(resolved.actor, 'work_item.edit', {
        id: item.projectId,
        workspaceId: item.projectWorkspaceId,
        visibility: item.visibility,
      })
    ) {
      continue;
    }

    await insertLink(tx, uow, resolved, {
      pageId: input.pageId,
      workItemId: item.id,
      projectId: item.projectId,
    });
  }
}

async function insertLink(
  tx: TenantDb,
  uow: UnitOfWork,
  resolved: ResolvedActor,
  input: { pageId: string; workItemId: string; projectId: string },
): Promise<void> {
  // `onConflictDoNothing` against `wiki_page_link_key`, so linking the same
  // page twice is one row (§20.4) and the second attempt is silent rather than
  // an error somebody has to interpret.
  const inserted = await tx
    .insert(wikiPageLink)
    .values({
      id: uuidv7(),
      workspaceId: resolved.workspace.id,
      pageId: input.pageId,
      workItemId: input.workItemId,
      createdByMemberId: resolved.memberId,
    })
    .onConflictDoNothing()
    .returning({ id: wikiPageLink.id });

  if (inserted.length === 0) return;

  uow.emit({
    type: 'wiki_page.linked',
    workspaceId: resolved.workspace.id,
    projectId: input.projectId,
    workItemId: input.workItemId,
    pageId: input.pageId,
  });
}

async function resolveLink(
  tx: TenantDb,
  resolved: ResolvedActor,
  input: { pageId: string; workItemId: string },
): Promise<{ projectId: string } | { problem: WikiFailure }> {
  const page = await fetchPage(tx, input.pageId);
  if (!page) return { problem: 'not_found' };

  const context = await resolveSpace(tx, page.spaceId);
  if (!context) return { problem: 'not_found' };

  const refusal = checkSpaceWrite(resolved.actor, context);
  if (refusal !== null) return { problem: refusal };

  const rows = await tx
    .select({ id: workItem.id, projectId: workItem.projectId })
    .from(workItem)
    .where(and(eq(workItem.id, input.workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const item = rows[0];
  if (!item) return { problem: 'unknown_item' };

  const target = await loadProject(tx, item.projectId);
  if (!target) return { problem: 'unknown_item' };
  if (isArchived(target)) return { problem: 'archived' };
  if (!can(resolved.actor, 'work_item.edit', projectResource(target))) {
    return { problem: 'unknown_item' };
  }

  return { projectId: item.projectId };
}

/**
 * §7.7's mention rule, applied to a page body.
 *
 * "Mentioning somebody who cannot see the project is refused, and the refusal
 * names them." Slice 8 chose refusal over offering to add them, and the same
 * choice holds here with the space in the project's place — a mention that
 * notified somebody about a page they cannot open would be a notification whose
 * click 404s.
 *
 * Asked of the **policy module** about each mentioned member rather than
 * re-deriving visibility, exactly as `comments.ts` does: a second implementation
 * of §10's composition rules is two implementations to drift apart.
 */
async function refusedMentions(
  tx: TenantDb,
  context: SpaceContext,
  mentioned: string[],
): Promise<(Failed & { names: string[] }) | null> {
  if (mentioned.length === 0) return null;

  const people = await tx
    .select({
      memberId: workspaceMember.id,
      role: workspaceMember.role,
      name: user.name,
      email: user.email,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(inArray(workspaceMember.id, mentioned), isNull(workspaceMember.deletedAt)));

  const byId = new Map(people.map((person) => [person.memberId, person]));
  const refused: string[] = [];

  for (const memberId of mentioned) {
    const person = byId.get(memberId);
    if (!person) {
      // A hand-typed token naming nobody. Refused with no name to offer, which
      // degrades the message to a count — slice 8's behaviour exactly.
      refused.push('');
      continue;
    }

    const readable = canReadSpace(
      {
        workspaceId: context.space.workspaceId,
        userId: memberId,
        workspaceRole: person.role,
        // Explicit project memberships are not loaded for the mentioned person,
        // so this is the *implicit* answer §10 composes. That under-approximates
        // for a Guest explicitly added to the project — refusing a mention that
        // would have been allowed. Deliberate: the picker only ever offers
        // people this check passes, so the gap costs a hand-typed token its
        // notification and never costs anybody a name they picked from a list.
        projectRoles: new Map(),
        readOnly: false,
      },
      context,
    );

    if (!readable) refused.push(person.name.trim() || person.email);
  }

  if (refused.length === 0) return null;

  return {
    ok: false,
    problem: 'mention_not_visible',
    names: refused.filter((name) => name.length > 0),
  };
}

/** `@[uuid]` → display name, for the bodies on one screen. */
async function hydrateMentions(tx: TenantDb, bodies: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(bodies.flatMap((body) => parseMentionIds(body)))];
  if (ids.length === 0) return {};

  // No `deleted_at` filter on the membership, for `comments.ts`'s reason: §7.12
  // keeps what somebody wrote attributed, and a page naming a colleague who has
  // since left should read as their name rather than as a uuid.
  const people = await tx
    .select({ memberId: workspaceMember.id, name: user.name, email: user.email })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(inArray(workspaceMember.id, ids));

  return Object.fromEntries(
    people.map((person) => [person.memberId, person.name.trim() || person.email]),
  );
}

/**
 * A slug free within the space, or a numbered variant of it.
 *
 * Per space rather than per workspace (`wiki_page_slug_key`), because a page
 * called "Overview" in three project spaces is three ordinary pages and forcing
 * "overview-2" on the second would be the product being strange about a word.
 */
async function freeSlug(
  tx: TenantDb,
  spaceId: string,
  desired: string,
  exceptPageId: string | null,
): Promise<string> {
  const rows = await tx
    .select({ slug: wikiPage.slug })
    .from(wikiPage)
    .where(
      and(
        eq(wikiPage.spaceId, spaceId),
        exceptPageId === null ? undefined : ne(wikiPage.id, exceptPageId),
      ),
    );

  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(desired)) return desired;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${desired}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  /*
   * A thousand pages with one title in one space. The tail is a uuid — never
   * user text — so `slice` is safe in the one way §13's rule cares about, and
   * the design-token hook's heuristic correctly cannot tell the difference.
   * Unique by construction, so this terminates rather than looping.
   */
  const unique = uuidv7().replace(/-/g, '');
  return `${desired}-${unique.substring(0, 8)}`;
}

async function takenSpaceSlugs(tx: TenantDb): Promise<Set<string>> {
  const rows = await tx.select({ slug: wikiSpace.slug }).from(wikiSpace);
  return new Set(rows.map((row) => row.slug));
}

function nextPosition(tree: readonly PageSummary[], parentId: string | null): number {
  const siblings = tree.filter((row) => row.parentId === parentId);
  return siblings.reduce((max, row) => Math.max(max, row.position + 1), 0);
}

function findPage(tree: readonly PageSummary[], id: string): PageSummary | undefined {
  return tree.find((row) => row.id === id);
}

/** The trail from the space root down to a page's parent, for the breadcrumb. */
function ancestorsOf(tree: readonly PageSummary[], parentId: string | null): PageSummary[] {
  const trail: PageSummary[] = [];
  const seen = new Set<string>();
  let cursor = parentId;

  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const found = findPage(tree, cursor);
    if (!found) break;
    trail.unshift(found);
    cursor = found.parentId;
  }

  return trail;
}

function toSpaceView(
  context: SpaceContext,
  pageCount: number,
  canWrite: boolean,
): SpaceView {
  return {
    id: context.space.id,
    kind: context.space.kind,
    name: context.space.name,
    nameKey: context.space.nameKey,
    slug: context.space.slug,
    pageCount,
    canWrite,
  };
}
