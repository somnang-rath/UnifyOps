import 'server-only';

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { can, type Actor } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import {
  label,
  project,
  user,
  wikiPage,
  wikiPageLabel,
  wikiPageLink,
  wikiPageRef,
  wikiPageRevision,
  wikiSpace,
  workItem,
  workspaceMember,
} from '@/server/db/schema';
import { withActor, type UnitOfWork } from '@/server/db/tenant';
import {
  fetchBacklinks,
  fetchDeletedPages,
  fetchExpiringOwnedPages,
  fetchItemPages,
  fetchPage,
  fetchPageBySlug,
  fetchPageLabelIds,
  fetchPageLinks,
  fetchPageRefs,
  fetchRevisionPair,
  fetchRevisions,
  fetchSpaces,
  fetchSpacePages,
  fetchSpaceTemplates,
  fetchSpaceTree,
  fetchSubtree,
  fetchVerificationCounts,
  type Backlink,
  type LinkedItem,
  type PageDetail,
  type PageRef,
  type PageSummary,
  type RevisionRow,
  type SpacePageRow,
  type TemplateRow,
} from '@/server/queries/wiki';
import { normalizeDocument } from '@/lib/documents';
import { parsePageIds } from '@/lib/doc-refs';
import { parseMentionIds } from '@/lib/mentions';
import { parseItemReference } from '@/lib/search';
import { deriveSlug } from '@/lib/slug';
import {
  checkMove,
  isVerificationDays,
  normalizePageIcon,
  normalizePageTitle,
  pageSlug,
  reorderPositions,
  validatePage,
  verificationExpiry,
  verificationStatus,
  VERIFICATION_HORIZON_DAYS,
  VERIFICATION_WARNING_DAYS,
  type PageProblem,
  type VerificationDays,
  type VerificationStatus,
} from '@/lib/wiki';
import { addDays, todayIn, type CalendarDate } from '@/lib/workspace-date';
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
import { pageCommentThreadIn, type CommentThreadView } from './comments';

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
  | 'mention_not_visible'
  /** A verification period that is not one of `VERIFICATION_DAYS` (§21.3). */
  | 'invalid_period'
  /** An owner id naming nobody in this workspace (§21.3). */
  | 'unknown_member'
  /**
   * §21.7's two halves of "a template is a root page with nothing under it",
   * refused separately because they are two different things to do about it.
   *
   * A page with a parent has to be moved to the top of the space first; a page
   * with children has to lose them first. Telling somebody "that cannot be a
   * template" without saying which would leave them guessing at a rule the
   * product never states — §11's "a refusal names what to do next".
   */
  | 'template_not_root'
  | 'template_has_children';

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
  /**
   * **What links here** (§21.4) — the pages whose bodies reference this one,
   * bounded to the spaces this reader can actually see.
   *
   * Rides `getPage`'s own transaction, which is §20.12's rule and the trap five
   * earlier slices each learned separately — slice 8 with `getCommentThread`,
   * slice 9 with the unread count, slice 10 with the custom fields, slice 13
   * with §7.4's six lists and slice 14 on a keystroke.
   */
  backlinks: Backlink[];
  canWrite: boolean;
  /** §21.3's badge, derived here so the screen cannot derive it differently. */
  verification: VerificationView;
  /** The label ids on this page — `LabelChip` resolves name and colour (§21.3). */
  labelIds: string[];
  /**
   * The people the owner picker may offer, and **empty when this actor cannot
   * write** (§21.3).
   *
   * `getCommentThread`'s call from slice 8, taken for the same reason: the list
   * is only ever rendered inside a control somebody with write access sees, so
   * fetching it for a reader is a query whose result is discarded on every page
   * view in the company space — which is the most-read screen in the wiki.
   */
  members: { id: string; name: string }[];
  /**
   * The page's conversation (§21.6 — slice 21), or **null on the editor**.
   *
   * Rides `getPage`'s own transaction through `pageCommentThreadIn`, which is
   * §20.12's rule and the trap six earlier slices each learned separately —
   * slice 8 with `getCommentThread` itself, on the item page, for exactly this
   * shape of query.
   *
   * Null rather than absent, and asked for rather than assumed: `getPage` serves
   * the reader *and* the editor, and the editor renders no thread. Fetching one
   * there would be three queries on every edit for a value discarded before
   * paint — and it was not a theoretical cost. It lengthened the editor's render
   * enough to break `wiki.spec.ts`'s stale-save test on `mobile-km`, where a
   * `fill` landed before the body arrived and the two texts concatenated. That
   * is the fourth time in this repo that adding queries to a page's loader has
   * exposed a latent race (slice 8's two specs, slice 10's `getWorkItem`, slice
   * 20's `getPage`), and the first where the right answer was to not run them.
   */
  thread: CommentThreadView | null;
};

/**
 * Everything a verification badge needs, resolved once (§21.3 — slice 19).
 *
 * The **status is computed on the server** and handed down, rather than the
 * component computing it from the columns. Both would be calling the same pure
 * function, so this is not about correctness of the arithmetic — it is about
 * `warnFrom`, which only the server can resolve because only the database knows
 * the company's working days and holidays. A client computing its own amber
 * threshold would be the second implementation §9's working-day rule exists to
 * prevent.
 */
export type VerificationView = {
  status: VerificationStatus;
  verifiedAt: Date | null;
  verifiedByName: string | null;
  expiresAt: CalendarDate | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  /** The period the verify control should offer first — the space's default. */
  defaultDays: VerificationDays | null;
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
  input: {
    spaceSlug: string;
    pageSlug: string;
    /**
     * Whether to load the thread at all (§21.6). The editor says no.
     *
     * Not defaulted, so the caller that forgets it does not silently pay for
     * three queries it will not render — and so the one that means "no" says so
     * where somebody reading the route can see it.
     */
    thread: boolean;
    allComments?: boolean;
  },
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
      /**
       * §21.4's "what links here", scoped to the spaces this reader may see —
       * which is the whole of the permission story for a backlink, and why it is
       * resolved here rather than inside the query (§20.5).
       *
       * A backlink is the one place a page in a space somebody cannot read would
       * otherwise announce its own title on a page they can.
       */
      backlinks: await fetchBacklinks(tx, {
        pageId: page.id,
        spaceIds: await readableSpaceIds(tx, resolved),
      }),
      canWrite,
      // Both ride the transaction `getPage` already opened — the rule §20.12
      // states and five earlier slices each learned separately.
      verification: await verificationViewFor(tx, resolved, page, space.id),
      labelIds: await fetchPageLabelIds(tx, page.id),
      members: canWrite ? await assignableMembers(tx) : [],
      thread: input.thread
        ? await pageCommentThreadIn(tx, resolved, {
            pageId: page.id,
            // Handed the space this render already resolved, rather than resolved
            // again from the page id — which would be §20.5's question asked twice
            // about one request, and the second answer is the one that could drift.
            context,
            all: input.allComments,
          })
        : null,
    };
  });
}

/**
 * The people who may be made answerable for a page (§21.3).
 *
 * **Live memberships only**, which is the opposite filter from
 * `hydrateMentions` beside it and deliberately so: that one resolves a name
 * somebody *wrote* in the past and must still render for a colleague who has
 * left (§7.12 keeps writing attributed), while this one is a picker of people
 * who can be given a responsibility — and offering somebody who has been
 * offboarded is offering a choice `setPageOwner` will refuse.
 *
 * Not filtered to those who can *write* in the space. §21.3 makes ownership a
 * claim about accuracy rather than a grant of access, and a Guest contractor
 * who wrote the integration notes is a legitimate answer to "who knows whether
 * this is still true". `canWriteSpace` still governs who may *set* it.
 */
async function assignableMembers(tx: TenantDb): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: workspaceMember.id, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(isNull(workspaceMember.deletedAt))
    .orderBy(user.name);
}

/** The space home: the tree, with no page selected (§20.11). */
export async function getSpace(
  resolved: ResolvedActor,
  spaceSlug: string,
  options: { templateId?: string } = {},
): Promise<{
  space: SpaceView;
  tree: PageSummary[];
  /** §21.7's templates, by name — hidden from `tree`, listed on their own. */
  templates: TemplateRow[];
  /** The body of the template `templateId` names, when it named one. */
  draft: { title: string; body: string } | null;
} | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    /*
      Three reads on the one transaction that is already open, which is the trap
      slice 8 hit with `getCommentThread`, slice 9 with the unread count, slice
      10 with the custom fields, slice 13 with §7.4's six lists and slice 14 on a
      keystroke. `inSequence` is not needed because these are awaited in order —
      a transaction is one client and one socket, and `Promise.all` over a shared
      `tx` never made anything concurrent.
    */
    const tree = await fetchSpaceTree(tx, space.id);
    const templates = await fetchSpaceTemplates(tx, space.id);

    /*
      The chosen template's body, read here rather than shipped with the list —
      see `fetchSpaceTemplates` for the ten-megabyte version of this that was not
      built. A `templateId` naming a page that is not a live template *of this
      space* resolves to no draft rather than to an error: the id is in a URL
      somebody may have kept after the template was deleted, and the honest
      answer to that is the empty create form they asked for, not a 404 on a
      screen whose whole job is to make a page.
    */
    let draft: { title: string; body: string } | null = null;
    if (options.templateId !== undefined) {
      const template = await fetchPage(tx, options.templateId);
      if (template && template.spaceId === space.id && template.isTemplate) {
        draft = { title: template.title, body: template.body };
      }
    }

    return {
      space: toSpaceView(context, tree.length, canWriteSpace(resolved.actor, context)),
      tree,
      templates,
      draft,
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

    // A page created *with* a body — §21.7's templates in slice 22, and an
    // importer in §21.8 — references pages from its first revision. Leaving this
    // to the first save would mean a page whose backlinks appear only once
    // somebody edits it, which is the shape of bug nobody reports because it
    // looks like the feature simply has not noticed yet.
    await syncPageRefs(tx, { workspaceId: resolved.workspace.id, pageId, body });

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
  | Ok<{ revisionNo: number; slug: string; unverified: boolean }>
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
      .set({
        title,
        body,
        slug,
        revisionNo,
        updatedAt: new Date(),

        /**
         * **Editing a verified page clears its verification** (§21.3), and this
         * is the only automatic transition in the feature.
         *
         * "Without it the whole feature is decoration: a badge that survives the
         * edit that invalidated it is worse than no badge, because it is a false
         * claim carrying the product's authority." The writer sees it happen and
         * can re-verify in the same visit if the edit was a typo fix — which is
         * why this is a clear rather than a prompt.
         *
         * All three columns go together, because the CHECK in 0034 requires the
         * pair and an expiry with no verification is a lapse date for an
         * assertion nobody made. Set unconditionally rather than behind an `if`:
         * this is one statement and the write is already happening, so a branch
         * would only add a way for the two paths to differ.
         */
        verifiedAt: null,
        verifiedByMemberId: null,
        verificationExpiresAt: null,
      })
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

    /**
     * The un-verification is audited only when there was one to lose (§21.3).
     *
     * §21.14's first check asks that "the audit log holds both the verification
     * and the un-verification", and the qualifier matters: emitting this on
     * every save of every never-verified page would put a row in the log for the
     * overwhelming majority of edits — which is `wiki_page.updated`'s own reason
     * for not being audited at all, reintroduced through the side door.
     */
    if (page.verifiedAt !== null) {
      uow.emit({
        type: 'wiki_page.unverified',
        workspaceId: resolved.workspace.id,
        spaceId: page.spaceId,
        pageId: page.id,
        title,
        reason: 'edited',
      });
    }

    await syncOutboundLinks(tx, uow, resolved, {
      pageId: page.id,
      body,
      previousBody: page.body,
    });

    await syncPageRefs(tx, {
      workspaceId: resolved.workspace.id,
      pageId: page.id,
      body,
    });

    return { ok: true, revisionNo, slug, unverified: page.verifiedAt !== null } as const;
  });
}

/**
 * The page → page edges this body contains, **rebuilt** (§21.4 — slice 20).
 *
 * §21.13's definition of done for this slice is one sentence and it is this
 * function: "the ref table is *rebuilt* rather than appended to, so removing a
 * sentence removes its edge while an authored `wiki_page_link` survives the same
 * edit — asserted directly, because that distinction is the one §20.0 found the
 * hard way."
 *
 * So it sits directly beneath `syncOutboundLinks`, which does the *opposite*
 * thing to the *other* kind of edge, and reading the two together is the fastest
 * way to understand §21.4:
 *
 *  - `syncOutboundLinks` computes what a revision **added** and inserts those,
 *    because `wiki_page_link` is **authored**: somebody connected a page to a
 *    work item, it has an author, it emitted an event, and an edit to a
 *    paragraph must not undo a connection somebody made on purpose.
 *  - This one computes the body's **whole** set and makes the table equal it,
 *    because `wiki_page_ref` is **derived**: it is a projection of the body, so
 *    a reference that is no longer in the text is no longer a reference.
 *
 * **Delete-then-insert rather than a diff, and that is deliberate.** A diff
 * would be two reads and two writes to save at most a handful of rows on a table
 * whose whole content for one page is the tokens in one body; this is one delete
 * and one insert, in the transaction the save is already in, and it cannot drift
 * from the body because it never consults what was there before. §21.15 asks
 * that the table stay regenerable from the bodies — a function that can only
 * *set* the answer is what makes that true.
 *
 * **A target that does not exist writes nothing**, and the composite foreign key
 * is what enforces it: `parsePageIds` returns whatever uuids somebody typed, and
 * a hand-typed token naming no page would otherwise be an insert that fails and
 * takes the save down with it. Filtering first, in the same transaction, means a
 * body may reference a page that was hard-deleted and still save — it renders as
 * §20.7's absence, which is what slice 17 chose for exactly this case.
 *
 * **No §10 check on the target, and that is not an omission.** A reference is
 * text in a body: refusing to record one would not stop the writer typing it,
 * and the *reader* is filtered — `fetchBacklinks` takes only spaces
 * `readableSpaceIds` has already resolved, and `fetchPageRefs` resolves a title
 * only for pages the reader may see. This is the opposite call from
 * `syncOutboundLinks`, which does ask §10, and the difference is real: linking a
 * work item writes a row into *that item's* panel, where it would tell somebody
 * about an item they cannot see.
 */
async function syncPageRefs(
  tx: TenantDb,
  input: { workspaceId: string; pageId: string; body: string },
): Promise<void> {
  // A page does not link to itself: the token is legal text, and without this
  // the page would appear in its own "what links here" — which reads as a bug in
  // the feature rather than as a quirk of one body. 0036 is the second layer.
  const referenced = parsePageIds(input.body).filter((id) => id !== input.pageId);

  await tx.delete(wikiPageRef).where(eq(wikiPageRef.fromPageId, input.pageId));

  if (referenced.length === 0) return;

  // Which of them are real pages *in this workspace* — RLS has already scoped
  // the rows, so this is the filter that turns a hand-typed uuid into nothing
  // rather than into a foreign-key violation on the writer's save.
  const targets = await tx
    .select({ id: wikiPage.id })
    .from(wikiPage)
    .where(inArray(wikiPage.id, referenced));

  if (targets.length === 0) return;

  await tx.insert(wikiPageRef).values(
    targets.map((target) => ({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      fromPageId: input.pageId,
      toPageId: target.id,
    })),
  );
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
export async function hydrateMentions(tx: TenantDb, bodies: string[]): Promise<Record<string, string>> {
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

/* ------------------------------------------------------------------------- */
/* Ownership and verification (§21.3 — slice 19)                             */
/* ------------------------------------------------------------------------- */

/**
 * The two dates every verification question is answered against.
 *
 * `today` is the **workspace's** (§17-13), and `warnFrom` is the working-day
 * horizon `VERIFICATION_WARNING_DAYS` describes — resolved by
 * `working_days_ahead` in migration 0034, which is the fifth member of §9's
 * working-day family and the only thing that knows this company's calendar.
 *
 * **Asked once per screen, never once per row.** That is slice 13's rule for
 * `stale_before` and it is the reason the function exists rather than a
 * per-row `business_days_between`: the All-pages view draws five hundred rows
 * and would otherwise run five hundred `generate_series` over the holiday table
 * to colour five hundred badges. Resolved once, the comparison is an ordinary
 * date predicate that `wiki_page_owner_idx` serves directly.
 *
 * It is also what keeps two rows of one page from straddling midnight and
 * disagreeing about the same page, which is the property `fetchStaleBefore`
 * exists for.
 */
export type VerificationClock = { today: CalendarDate; warnFrom: CalendarDate };

export async function verificationClock(
  tx: TenantDb,
  resolved: ResolvedActor,
): Promise<VerificationClock> {
  const today = todayIn(resolved.workspace.timezone);

  const rows = await tx.execute<{ warn_from: string | null }>(
    sql`select working_days_ahead(
          ${resolved.workspace.id}::uuid,
          ${today}::date,
          ${VERIFICATION_WARNING_DAYS}
        )::text as warn_from`,
  );

  /**
   * A company whose calendar yields no working day inside 400 days gets `today`
   * as its own horizon, which collapses the amber band to nothing and leaves
   * `verified` and `expired` reading correctly.
   *
   * 0028's `working_days BETWEEN 1 AND 127` makes that unreachable in practice —
   * it is the bound that exists precisely because "a company that works no days
   * at all is the one setting that bricks a workspace". This fallback is what
   * stops the *warning* being the thing that discovers it.
   */
  return { today, warnFrom: rows.rows[0]?.warn_from ?? today };
}

/** The badge one page shows, assembled from the row and the clock. */
async function verificationViewFor(
  tx: TenantDb,
  resolved: ResolvedActor,
  page: PageDetail,
  spaceId: string,
): Promise<VerificationView> {
  const clock = await verificationClock(tx, resolved);

  const spaces = await tx
    .select({ days: wikiSpace.defaultVerificationDays })
    .from(wikiSpace)
    .where(eq(wikiSpace.id, spaceId))
    .limit(1);

  const defaultDays = spaces[0]?.days ?? null;

  return {
    status: verificationStatus(page, clock),
    verifiedAt: page.verifiedAt,
    verifiedByName: page.verifiedByName,
    expiresAt: page.verificationExpiresAt,
    ownerMemberId: page.ownerMemberId,
    ownerName: page.ownerName,
    defaultDays: isVerificationDays(defaultDays) ? defaultDays : null,
  };
}

/**
 * The All-pages view (§21.3), and the screen where this feature stops being
 * present and starts being usable.
 *
 * "Title, owner, verification state, expiry, last edited, last editor —
 * sortable, and filterable to *unverified*, *expiring within 30 days*, *owned by
 * me*, *owned by nobody*."
 *
 * **The status is derived here, once, for every row**, from the same clock and
 * the same pure function the page header uses. Filtering happens over the
 * derived value rather than in SQL, which is not a shortcut: `expiring` is
 * defined by a working-day horizon and `expired` by the workspace's today, and a
 * SQL predicate for either would be `verificationStatus` written a second time
 * in a second language — the drift §21.3 forbids in the sentence that makes the
 * status derived at all.
 */
export type SpacePageView = SpacePageRow & { status: VerificationStatus };

export type PageFilter = 'all' | 'unverified' | 'expiring' | 'mine' | 'unowned';

export async function listSpacePages(
  resolved: ResolvedActor,
  input: { spaceSlug: string; filter?: PageFilter },
): Promise<{
  space: SpaceView;
  pages: SpacePageView[];
  counts: { expired: number; expiring: number; unverified: number; unowned: number };
  clock: VerificationClock;
  labels: { id: string; name: string; color: string }[];
  /** The space's standing review cycle, for the form at the foot of the list. */
  defaultDays: VerificationDays | null;
} | null> {
  return withActor(resolved.context, async (tx) => {
    const space = await loadSpaceBySlug(tx, input.spaceSlug);
    if (!space) return null;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) return null;

    const clock = await verificationClock(tx, resolved);
    const rows = await fetchSpacePages(tx, space.id);

    const defaults = await tx
      .select({ days: wikiSpace.defaultVerificationDays })
      .from(wikiSpace)
      .where(eq(wikiSpace.id, space.id))
      .limit(1);

    const storedDefault = defaults[0]?.days ?? null;

    const withStatus: SpacePageView[] = rows.map((row) => ({
      ...row,
      status: verificationStatus(row, clock),
    }));

    const filter = input.filter ?? 'all';
    const pages = withStatus.filter((row) => {
      switch (filter) {
        case 'unverified':
          return row.status === 'never';
        // §21.3's filter is "expiring within 30 days", which is a **calendar**
        // window and deliberately wider than the amber badge's working-day one —
        // the badge warns the one person who has to act, and this is somebody
        // planning a month of review work. `VERIFICATION_HORIZON_DAYS` carries
        // the contrast.
        case 'expiring':
          return (
            row.verificationExpiresAt !== null &&
            row.verificationExpiresAt <= addDays(clock.today, VERIFICATION_HORIZON_DAYS)
          );
        case 'mine':
          return row.ownerMemberId === resolved.memberId;
        case 'unowned':
          return row.ownerMemberId === null;
        default:
          return true;
      }
    });

    /**
     * The workspace's label vocabulary, so `LabelChip` can resolve a name and a
     * colour for the ids each row carries. One query for the whole screen rather
     * than a join per row — labels are workspace vocabulary (slice 5) and a
     * company has a handful.
     */
    const labels = await tx
      .select({ id: label.id, name: label.name, color: label.color })
      .from(label)
      .where(isNull(label.deletedAt))
      .orderBy(label.name);

    return {
      space: toSpaceView(context, rows.length, canWriteSpace(resolved.actor, context)),
      pages,
      counts: await fetchVerificationCounts(tx, {
        spaceId: space.id,
        today: clock.today,
        warnFrom: clock.warnFrom,
      }),
      clock,
      labels,
      /**
       * Narrowed rather than cast. The column is an ordinary `integer` bounded
       * only by 0034's `BETWEEN 1 AND 3650` — deliberately, so adding a fourth
       * period is not a migration — so a value outside `VERIFICATION_DAYS` is
       * possible and reads here as *no default*, which is the safe answer and
       * the one a picker can represent.
       */
      defaultDays: isVerificationDays(storedDefault) ? storedDefault : null,
    };
  });
}

/**
 * Claim a page, hand it to somebody, or leave it unowned (§21.3).
 *
 * **No §10 row, and none was needed** — §21.3: "Owning, verifying and
 * un-verifying a page are all *writing* in that space, which §20.5's two rows
 * already govern. Assigning somebody else as owner is the same act: a claim on
 * the company's record, made by somebody the matrix already trusts with that
 * record."
 *
 * `null` is an **intent**, not a missing value — the rule `moveWorkItem` wrote
 * for a neighbour id in slice 6 and §7.12's `reassignTo` re-stated in slice 15.
 * "Nobody owns this" is an answer somebody chooses, and it is the state the
 * All-pages view has a filter for.
 */
export async function setPageOwner(
  resolved: ResolvedActor,
  input: { pageId: string; ownerMemberId: string | null },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    if (input.ownerMemberId !== null) {
      const target = await tx
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(
          and(eq(workspaceMember.id, input.ownerMemberId), isNull(workspaceMember.deletedAt)),
        )
        .limit(1);

      // Checked rather than left to the foreign key, for `removeMember`'s
      // reason: what a constraint gives is a 500 where a refusal belongs.
      if (target.length === 0) return { ok: false, problem: 'unknown_member' } as const;
    }

    // Nothing changed — no write, no audit row. An owner reading the log should
    // not find a "changed owner" line for a form somebody opened and saved.
    if (page.ownerMemberId === input.ownerMemberId) return { ok: true } as const;

    await tx
      .update(wikiPage)
      .set({ ownerMemberId: input.ownerMemberId, updatedAt: new Date() })
      .where(eq(wikiPage.id, page.id));

    uow.emit({
      type: 'wiki_page.owner_changed',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId: page.id,
      title: page.title,
      fromMemberId: page.ownerMemberId,
      toMemberId: input.ownerMemberId,
    });

    return { ok: true } as const;
  });
}

/**
 * Assert that a page is accurate (§21.3).
 *
 * **Conditional on the revision the verifier read**, exactly as a save is, and
 * §21.3 asks for it in as many words: "`[X]` verifying a page somebody has
 * edited underneath you → refused with §20.3.3's own message, because verifying
 * a body you did not read is the failure being prevented."
 *
 * That is the sharpest instance of the rule in the product. A stale *save*
 * refuses because merging prose destroys work; a stale *verification* refuses
 * because it would otherwise attach somebody's name, permanently and in the
 * audit log, to words they never saw. The mechanism is the same single
 * statement — `where revision_no = $base`, with `returning` as the proof — and
 * it is the same one because there is no second correct answer.
 *
 * **The period comes from the caller, defaulting to the space's** (§21.3: "One
 * column, applied at page creation and overridable per page"). It is resolved
 * *here*, at verification, rather than copied onto the page when the page was
 * created — a copy taken at creation would be a snapshot that goes stale the
 * moment somebody changes the space default, which is the opposite of "so a
 * policy space does not depend on somebody remembering on every page". See the
 * note in `PLAN.en.md` §21.3 if this ever needs revisiting: a page has no
 * period column of its own, because it has no verification to attach one to
 * until this function runs.
 */
export async function verifyPage(
  resolved: ResolvedActor,
  input: { pageId: string; baseRevision: number; days?: VerificationDays | null },
): Promise<
  | Ok<{ expiresAt: CalendarDate | null }>
  | (Failed & { current?: { title: string; body: string; revisionNo: number } })
> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    /**
     * `undefined` means *take the space's default*; an explicit `null` means
     * *Never*. The distinction is `reassignTo`'s from §7.12 — "`undefined` is
     * not a third answer, because a default here is a screen that silently
     * picked for somebody" — pointed the other way: here the caller genuinely
     * may decline to choose, and the space's standing preference is what a
     * declined choice means.
     */
    let days: VerificationDays | null;
    if (input.days === undefined) {
      const spaces = await tx
        .select({ days: wikiSpace.defaultVerificationDays })
        .from(wikiSpace)
        .where(eq(wikiSpace.id, page.spaceId))
        .limit(1);

      const stored = spaces[0]?.days ?? null;
      days = isVerificationDays(stored) ? stored : null;
    } else {
      if (input.days !== null && !isVerificationDays(input.days)) {
        return { ok: false, problem: 'invalid_period' } as const;
      }
      days = input.days;
    }

    const today = todayIn(resolved.workspace.timezone);
    const expiresAt = verificationExpiry(today, days);

    const updated = await tx
      .update(wikiPage)
      .set({
        verifiedAt: new Date(),
        verifiedByMemberId: resolved.memberId,
        verificationExpiresAt: expiresAt,
        // **`updated_at` is deliberately not touched.** A verification is not an
        // edit: bumping it would reorder the All-pages view's "last edited"
        // column on an act that changed no word, and it would make
        // `wiki_page_live_idx`'s ordering report a review as a revision.
      })
      .where(and(eq(wikiPage.id, page.id), eq(wikiPage.revisionNo, input.baseRevision)))
      .returning({ revisionNo: wikiPage.revisionNo });

    if (updated.length === 0) {
      const current = await fetchPage(tx, page.id);
      return {
        ok: false,
        problem: 'stale',
        current: current
          ? { title: current.title, body: current.body, revisionNo: current.revisionNo }
          : undefined,
      } as const;
    }

    uow.emit({
      type: 'wiki_page.verified',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId: page.id,
      title: page.title,
      revisionNo: page.revisionNo,
      expiresAt,
    });

    return { ok: true, expiresAt } as const;
  });
}

/**
 * Withdraw an assertion (§21.3).
 *
 * Deliberately **not** conditional on a revision, where `verifyPage` is. Saying
 * "I no longer vouch for this" is safe whatever the body has become — if
 * somebody edited it underneath, that edit already cleared the verification and
 * this is a no-op; if they did not, withdrawing is exactly what was meant. A
 * refusal here would ask somebody to re-read a page in order to stop standing
 * behind it, which is backwards.
 */
export async function unverifyPage(
  resolved: ResolvedActor,
  pageId: string,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const page = await fetchPage(tx, pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    if (page.verifiedAt === null) return { ok: true } as const;

    await tx
      .update(wikiPage)
      .set({ verifiedAt: null, verifiedByMemberId: null, verificationExpiresAt: null })
      .where(eq(wikiPage.id, page.id));

    uow.emit({
      type: 'wiki_page.unverified',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId: page.id,
      title: page.title,
      reason: 'cleared',
    });

    return { ok: true } as const;
  });
}

/**
 * The space's standing review cycle (§21.3).
 *
 * `wiki_space.updated` is the event, reused rather than invented: it already
 * means "something about this space changed" and already carries a from/to pair.
 * A `wiki_space.verification_default_changed` would be a thirty-first event type
 * for a fact the existing one describes — and §6-6's lesson about closed sets
 * applies to the registry as much as to notification kinds.
 */
export async function setSpaceVerificationDefault(
  resolved: ResolvedActor,
  input: { spaceId: string; days: VerificationDays | null },
): Promise<Ok | Failed> {
  if (input.days !== null && !isVerificationDays(input.days)) {
    return { ok: false, problem: 'invalid_period' };
  }

  return withActor(resolved.context, async (tx, uow) => {
    const context = await resolveSpace(tx, input.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const before = await tx
      .select({ days: wikiSpace.defaultVerificationDays })
      .from(wikiSpace)
      .where(eq(wikiSpace.id, input.spaceId))
      .limit(1);

    const from = before[0]?.days ?? null;
    if (from === input.days) return { ok: true } as const;

    await tx
      .update(wikiSpace)
      .set({ defaultVerificationDays: input.days, updatedAt: new Date() })
      .where(eq(wikiSpace.id, input.spaceId));

    uow.emit({
      type: 'wiki_space.updated',
      workspaceId: resolved.workspace.id,
      spaceId: input.spaceId,
      // The event's pair is `string`, and these are periods. Rendered rather
      // than stored as numbers because the audit log is read as prose and
      // "never" is the honest word for the absence — the same call
      // `workspace.branding_changed` makes when it records *whether* there is a
      // logo rather than its key.
      from: from === null ? 'never' : `${from}d`,
      to: input.days === null ? 'never' : `${input.days}d`,
    });

    return { ok: true } as const;
  });
}

/**
 * Apply the workspace's labels to a page (§21.3).
 *
 * **Tags are `label`, not a second vocabulary** — the whole justification is on
 * `wiki_page_label` in the schema. Written as a replace rather than an
 * add/remove pair, because the control is a set of checkboxes and a set is what
 * it reports; the delete and the insert are one statement each over a known set,
 * which is `reorderPages`' shape and for the same reason.
 *
 * No event. Tagging is filing, not a change to the company's record — the call
 * `work_item.labelled` already made when it chose activity over notification,
 * taken one step further because a page has no feed to project into (§20.6).
 */
export async function setPageLabels(
  resolved: ResolvedActor,
  input: { pageId: string; labelIds: string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const wanted = [...new Set(input.labelIds)];

    // Only labels that actually exist in this workspace. RLS has already scoped
    // the table, so this is about a stale form naming a deleted label rather
    // than about tenancy — and dropping it silently is right, for the reason
    // `withKnownCustomFilters` drops a filter naming a deleted field.
    const known =
      wanted.length === 0
        ? []
        : (
            await tx
              .select({ id: label.id })
              .from(label)
              .where(and(inArray(label.id, wanted), isNull(label.deletedAt)))
          ).map((row) => row.id);

    await tx.delete(wikiPageLabel).where(eq(wikiPageLabel.pageId, page.id));

    if (known.length > 0) {
      await tx.insert(wikiPageLabel).values(
        known.map((labelId) => ({
          id: uuidv7(),
          workspaceId: resolved.workspace.id,
          pageId: page.id,
          labelId,
        })),
      );
    }

    return { ok: true } as const;
  });
}

/**
 * Release every page a departing member owns (§21.3, §7.12).
 *
 * "`[!]` the owner leaves the company → §7.12's offboarding dialog counts the
 * pages they own, and the removal **nulls the column rather than deleting
 * anything**, so those pages appear under *owned by nobody* the next morning."
 *
 * That asymmetry with `deleteNotesOf` beside it is §20.5's, and it is the point:
 * notes are one person's thinking and go with them; a page is the company's
 * record and stays, unowned and findable, waiting for somebody to claim it.
 *
 * Called from inside `removeMember`'s own transaction, so there is no window in
 * which somebody has been offboarded and still owns forty pages — the same
 * property the reassignment and the note deletion already have.
 *
 * **One event per page, deliberately.** Forty rows in the audit log for one
 * offboarding is the honest record: an owner asking six months later why the
 * leave policy has no owner needs the answer, and a single summary row would
 * name the member without naming the pages.
 */
export async function releasePagesOf(
  tx: TenantDb,
  uow: UnitOfWork,
  workspaceId: string,
  memberId: string,
): Promise<number> {
  const released = await tx
    .update(wikiPage)
    .set({ ownerMemberId: null })
    .where(and(eq(wikiPage.ownerMemberId, memberId), isNull(wikiPage.deletedAt)))
    .returning({ id: wikiPage.id, spaceId: wikiPage.spaceId, title: wikiPage.title });

  for (const page of released) {
    uow.emit({
      type: 'wiki_page.owner_changed',
      workspaceId,
      spaceId: page.spaceId,
      pageId: page.id,
      title: page.title,
      fromMemberId: memberId,
      toMemberId: null,
    });
  }

  return released.length;
}

/**
 * The digest's section (§21.3), read as the member whose digest it is.
 *
 * Exported for `jobs/digest.ts`, which calls it inside the `withActor` it has
 * already opened for that person — so the pages an email names are pages its
 * recipient can actually open, which is the property slice 9 built the whole
 * read-as-that-member arrangement for and which would otherwise have to be
 * re-implemented here and eventually got wrong.
 *
 * **It takes an `Actor` and a member id rather than a `ResolvedActor`**, and the
 * narrowing is deliberate: a `ResolvedActor` carries a `CurrentUser`, an unread
 * count and a view-as state, none of which exist in a worker and none of which
 * this function reads. Asking for the two things it uses lets the digest build
 * exactly those, from the transaction it is already inside, rather than
 * assembling a request-shaped object that would be mostly lies.
 *
 * The space filter is applied *after* the query for `fetchPageLinks`' reason: a
 * page in a private project's space is one this person may own and no longer be
 * able to read, and `canReadSpace` needs the project row loaded, which is not a
 * SQL predicate.
 */
export async function expiringPagesFor(
  tx: TenantDb,
  input: { actor: Actor; memberId: string; horizon: CalendarDate },
): Promise<{ title: string; spaceSlug: string; slug: string; expiresAt: CalendarDate }[]> {
  const rows = await fetchExpiringOwnedPages(tx, {
    memberId: input.memberId,
    horizon: input.horizon,
  });
  if (rows.length === 0) return [];

  const readable = new Map<string, boolean>();
  const out: { title: string; spaceSlug: string; slug: string; expiresAt: CalendarDate }[] = [];

  for (const row of rows) {
    let allowed = readable.get(row.spaceId);
    if (allowed === undefined) {
      const context = await resolveSpace(tx, row.spaceId);
      allowed = context !== null && canReadSpace(input.actor, context);
      readable.set(row.spaceId, allowed);
    }
    if (!allowed) continue;

    out.push({
      title: row.title,
      spaceSlug: row.spaceSlug,
      slug: row.slug,
      expiresAt: row.expiresAt,
    });
  }

  return out;
}

/**
 * Give a page an icon, or take it away (§21.2 — slice 20).
 *
 * **No event, and that is `saved_view`'s call from slice 12 rather than an
 * oversight.** §8's registry is for things that happened to a company's *work*;
 * an icon is furniture on a page, and an entry reading `audit: false, activity:
 * false, notify: false` would be three decisions recorded as "no" for something
 * nobody would ever read back. It is also why this does not touch
 * `revision_no`: an icon is not the body, so changing one must not refuse a save
 * somebody is composing in another tab, and must not clear §21.3's verification
 * — a verified page whose icon changed is still a page somebody read and vouched
 * for.
 *
 * **No §10 row — the fifteenth time that decision has gone the same way**, after
 * labels, attachments, notifications, custom fields, cycles, saved views,
 * availability, search, the holiday calendar, settings, password reset, notes,
 * slice 19's verification and this slice's reference table. Setting an icon is
 * *writing in that space*, which §20.5's two rows already govern.
 *
 * `null` is an **intent**: no icon is a value somebody chooses, not a field left
 * blank — the rule `moveWorkItem` wrote for a neighbour id in slice 6, §7.12's
 * `reassignTo` re-stated in slice 15 and `setPageOwner` re-stated in slice 19.
 */
export async function setPageIcon(
  resolved: ResolvedActor,
  input: { pageId: string; icon: string | null },
): Promise<Ok | Failed> {
  const icon = normalizePageIcon(input.icon);

  return withActor(resolved.context, async (tx) => {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    await tx.update(wikiPage).set({ icon }).where(eq(wikiPage.id, page.id));

    return { ok: true } as const;
  });
}

/**
 * Make a page a template, or stop it being one (§21.7 — slice 22).
 *
 * **"A template is an ordinary page with a flag"**, so this is an update of one
 * boolean and there is deliberately nothing else to it: no copy, no second
 * table, no separate editor, no new §10 row. What the flag buys is that the page
 * leaves the sidebar and starts being offered on the create screen.
 *
 * **Its own action rather than a field on the save**, which is slice 20's call
 * for `setPageIcon` and holds here with more force. Folded into `saveWikiPage`
 * it would ride the conditional update — so flagging a template while a
 * colleague was typing would be refused as a stale save (§20.3.3), a refusal
 * with real weight spent on a filing decision — and it would clear §21.3's
 * verification, which every body save does unconditionally. A verified runbook
 * that somebody has now also marked as a template is still a page somebody read
 * and vouched for. So this touches neither `revision_no` nor the verification
 * columns.
 *
 * **The two refusals are checked here and pinned in the database.** 0040 carries
 * the CHECK that a template has no parent and the trigger that nothing nests
 * under one, for the reason every invariant since 0008 is in the database: a row
 * written by a seed script, §21.8's importer or a Phase 2 MCP tool has to be as
 * correct as one written here. What this adds is the *sentence* — a constraint
 * violation reaching a screen is §7.11's disabled select in its worst form.
 */
export async function setPageTemplate(
  resolved: ResolvedActor,
  input: { pageId: string; isTemplate: boolean },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) =>
    setPageTemplateIn(tx, uow, resolved, input),
  );
}

/**
 * The same, inside a transaction that is already open.
 *
 * Split for `createPageIn`'s reason, and with a caller that makes the split
 * load-bearing rather than tidy: §21.8's importer creates a tree and then flags
 * the files that said they were templates, and those two are one act. They also
 * have to happen **in that order and in one transaction** — flagging a page
 * before its children exist would make every child violate 0040's "nothing nests
 * under a template", which is a trigger and would abort the whole import rather
 * than skip one file.
 */
export async function setPageTemplateIn(
  tx: TenantDb,
  uow: UnitOfWork,
  resolved: ResolvedActor,
  input: { pageId: string; isTemplate: boolean },
): Promise<Ok | Failed> {
  {
    const page = await fetchPage(tx, input.pageId);
    if (!page) return { ok: false, problem: 'not_found' } as const;

    const context = await resolveSpace(tx, page.spaceId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    // Nothing to record and nothing to change. Emitting an audit row for a
    // no-op is how a log fills with afternoons in which nothing happened.
    if (page.isTemplate === input.isTemplate) return { ok: true } as const;

    if (input.isTemplate) {
      if (page.parentId !== null) return { ok: false, problem: 'template_not_root' } as const;

      /*
        The live children only. A page whose children were deleted last week is
        a leaf now, and §20.3.6's 30-day window is a recovery promise rather
        than a claim that those pages are still in the tree — restoring one
        reparents it, which is the moment the rule is re-checked.
      */
      const children = await tx
        .select({ id: wikiPage.id })
        .from(wikiPage)
        .where(and(eq(wikiPage.parentId, page.id), isNull(wikiPage.deletedAt)))
        .limit(1);

      if (children.length > 0) return { ok: false, problem: 'template_has_children' } as const;
    }

    await tx
      .update(wikiPage)
      .set({ isTemplate: input.isTemplate })
      .where(eq(wikiPage.id, page.id));

    uow.emit({
      type: 'wiki_page.template_changed',
      workspaceId: resolved.workspace.id,
      spaceId: page.spaceId,
      pageId: page.id,
      title: page.title,
      isTemplate: input.isTemplate,
    });

    return { ok: true } as const;
  }
}
