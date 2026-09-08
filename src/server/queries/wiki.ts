import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { TenantDb } from '@/server/db/client';
import {
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
import type { CalendarDate } from '@/lib/workspace-date';

/**
 * Reading the wiki (§20.4, §20.8, §20.11 — slice 18).
 *
 * **Nothing in this file decides a permission.** Every function takes an already
 * resolved space or an already vetted set of space ids, because §20.5 makes the
 * *space* the unit of access and `space-access.ts` is the one module that
 * answers what a person may do with one. A query that re-derived the rule would
 * be a second implementation of §10's composition for the two to drift apart —
 * the trap `listProjectsIn` avoids by being the only implementation of project
 * visibility.
 *
 * That is a different shape from `queries/notes.ts`, and deliberately so. A note
 * is bounded by `owner_member_id` and the predicate has to be *in* every query,
 * because there is no other layer that can apply it. A page is bounded by its
 * space, which is a row the caller has already loaded and asked about — so the
 * bound arrives as an argument rather than as a clause somebody has to remember.
 */

export type SpaceListRow = {
  id: string;
  /** Carried so `withProject` can resolve the space without a second read. */
  workspaceId: string;
  kind: 'company' | 'project';
  projectId: string | null;
  name: string;
  nameKey: string | null;
  slug: string;
  /** So the space list can say "12 pages" without a query per row. */
  pageCount: number;
};

export type PageSummary = {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  slug: string;
  position: number;
  depth: number;
  updatedAt: Date;
};

/**
 * The four columns §21.3 added, in the shape `verificationStatus` reads.
 *
 * Carried as its own type rather than folded into `PageSummary`, because the
 * sidebar deliberately does not fetch them: a tree of a hundred pages is a
 * hundred rows drawn as links, and a badge on each one would be noise on the one
 * surface whose whole job is navigation. The reader, the All-pages view and the
 * digest are the three that ask.
 */
export type PageVerificationColumns = {
  ownerMemberId: string | null;
  ownerName: string | null;
  verifiedAt: Date | null;
  verifiedByMemberId: string | null;
  verifiedByName: string | null;
  /** A `date` column, so the driver hands it back as `YYYY-MM-DD` (§21.3). */
  verificationExpiresAt: CalendarDate | null;
};

export type PageDetail = PageSummary &
  PageVerificationColumns & {
    /** One emoji, or nothing (§21.2 — slice 20). */
    icon: string | null;
    body: string;
    revisionNo: number;
    /** §21.7's flag — slice 22. An ordinary page, hidden from the tree. */
    isTemplate: boolean;
    /** The subtree key 0032's trigger maintains — what a move and a delete read. */
    rootId: string;
    createdAt: Date;
    deletedAt: Date | null;
  };

export type RevisionRow = {
  id: string;
  revisionNo: number;
  title: string;
  body: string;
  authorMemberId: string;
  authorName: string | null;
  createdAt: Date;
};

export type LinkedItem = {
  workItemId: string;
  number: number;
  title: string;
  projectSlug: string;
  projectKey: string;
  /** §10 is asked about the project before any of these reach a screen. */
  projectId: string;
  projectWorkspaceId: string;
  projectVisibility: 'workspace' | 'private';
};

export type LinkedPage = {
  pageId: string;
  title: string;
  slug: string;
  spaceSlug: string;
};

/**
 * How many revisions the history screen shows at once.
 *
 * The history does not page, which is the same call slice 13 made for My Work,
 * slice 14 for search results and slice 17 for the notes list — and it is a
 * softer one here, because a page that has been revised two hundred times has a
 * history whose *oldest* end is the part nobody opens. The compare screen takes
 * two revision numbers directly, so an old revision is still reachable by URL
 * even when the list has stopped naming it.
 */
export const REVISION_PAGE_LIMIT = 200;

/**
 * Every space in the workspace, with a page count.
 *
 * Unfiltered by permission on purpose — the caller passes the rows through
 * `canReadSpace`, which needs each space's project loaded and is not a SQL
 * predicate. A workspace has one company space and one space per project, so
 * this is a handful of rows however large the company is, and filtering in
 * TypeScript costs nothing that filtering in SQL would save. That is the reverse
 * of `listProjects`, which expresses visibility as SQL *and* re-checks — because
 * a 200-project workspace is a list worth bounding and 200 spaces is the same
 * list.
 */
export async function fetchSpaces(tx: TenantDb): Promise<SpaceListRow[]> {
  return tx
    .select({
      id: wikiSpace.id,
      workspaceId: wikiSpace.workspaceId,
      kind: wikiSpace.kind,
      projectId: wikiSpace.projectId,
      name: wikiSpace.name,
      nameKey: wikiSpace.nameKey,
      slug: wikiSpace.slug,
      /**
       * How many live pages the space holds.
       *
       * **Written with an explicit alias and a literal outer reference**, and
       * the version that was here until slice 22 is worth recording because it
       * looked right and was silently, always wrong: the space list has said
       * "No pages" for every space in the product since slice 18 shipped.
       *
       * It interpolated drizzle columns — `${wikiPage.spaceId} = ${wikiSpace.id}`
       * — and **this query has no join**. That is the whole of it: drizzle
       * qualifies a column only when the statement has more than one table in
       * it, so with a single `.from()` both sides arrived as bare `"space_id"`
       * and `"id"`. Inside a subquery over `wiki_page` the inner scope then wins
       * for both, Postgres read the predicate as `wiki_page.space_id =
       * wiki_page.id`, planned it as an uncorrelated InitPlan, and it matched
       * nothing.
       *
       * **The rule is about joins, not about `sql` templates**, and it is worth
       * stating precisely because the imprecise version sends somebody
       * "fixing" a dozen correct queries: an interpolated column in a
       * correlated subquery is safe wherever the outer query joins (drizzle
       * qualifies it) and wherever the inner tables have no column of that name
       * (nothing to shadow it) — and is a trap only where neither holds. Slice
       * 19 met the loud member of this family, `column reference "id" is
       * ambiguous`; this is the quiet one, which returns a plausible number.
       * Naming the outer table literally and aliasing the inner one is correct
       * in every case, which is why it is what this now does.
       */
      pageCount: sql<number>`(
        select count(*)::int from wiki_page p
        where p.space_id = wiki_space.id and p.deleted_at is null
      )`,
    })
    .from(wikiSpace)
    .where(isNull(wikiSpace.deletedAt))
    // The company space first, then projects by name — the company's own
    // handbook is what somebody arriving at `/wiki` is usually looking for, and
    // `kind` sorts 'company' before 'project' alphabetically by luck rather than
    // by design, so the order is stated rather than inherited.
    .orderBy(asc(wikiSpace.kind), asc(wikiSpace.name));
}

/**
 * One space's page tree, without bodies (§20.11's sidebar).
 *
 * **No body column**, which is the point: a tree of a hundred pages is a hundred
 * bodies fetched to draw a list of links. `buildPageTree` in `src/lib/wiki.ts`
 * turns the flat result into the nesting, on whichever side asked.
 */
export async function fetchSpaceTree(tx: TenantDb, spaceId: string): Promise<PageSummary[]> {
  return tx
    .select({
      id: wikiPage.id,
      spaceId: wikiPage.spaceId,
      parentId: wikiPage.parentId,
      title: wikiPage.title,
      slug: wikiPage.slug,
      position: wikiPage.position,
      depth: wikiPage.depth,
      updatedAt: wikiPage.updatedAt,
    })
    .from(wikiPage)
    .where(
      and(
        eq(wikiPage.spaceId, spaceId),
        isNull(wikiPage.deletedAt),
        /*
          §21.7: a template is "hidden from the tree". Filtered here rather than
          in the sidebar, because this function is not only the sidebar — it is
          also what `createPageIn` and `movePage` read to compute a depth and a
          sibling position, and what the parent picker is built from. Filtering
          in the one place means a template cannot be offered as a parent by a
          screen that forgot, which is the same reason `fetchPage`'s
          `includeDeleted` is off by default rather than applied by each caller.
        */
        eq(wikiPage.isTemplate, false),
      ),
    )
    .orderBy(asc(wikiPage.position), asc(wikiPage.title), asc(wikiPage.id));
}

/**
 * A space's templates, by name (§21.7 — slice 22).
 *
 * **No body column, and that is the decision that shaped the picker.** The
 * obvious version fetches the bodies too, so choosing a template can fill the
 * textarea with no round trip — and that is fifty pages of prose in the payload
 * of every "New page" render to use one of them. `MAX_PAGE_BODY_LENGTH` is
 * 200,000 characters, so the worst case is not a rounding error: it is ten
 * megabytes sent to a phone on mobile data (§2.5) to draw four links.
 *
 * So the picker is four links carrying a template *id*, and the chosen body is
 * read once, on the server, by the render that shows it. That also makes
 * `/wiki/{space}/new?template={id}` a URL somebody can send a colleague — "start
 * an incident report" — which is what §5 asks of every other state in the
 * product and which a `<select>` could not have been.
 *
 * The set is small by construction: a company has meeting notes, an incident
 * report, a decision record and a runbook. `TEMPLATE_LIMIT` is what keeps that
 * sentence true if somebody disagrees, and `wiki_page_template_idx` is partial
 * on exactly these rows.
 */
export const TEMPLATE_LIMIT = 50;

export type TemplateRow = { id: string; slug: string; title: string; icon: string | null };

export async function fetchSpaceTemplates(
  tx: TenantDb,
  spaceId: string,
): Promise<TemplateRow[]> {
  return tx
    .select({
      id: wikiPage.id,
      // The reading link needs a slug; the *use* link addresses the template by
      // id, which is the reference that survives a rename — the rule `#[uuid]`
      // and `@[uuid]` already follow.
      slug: wikiPage.slug,
      title: wikiPage.title,
      icon: wikiPage.icon,
    })
    .from(wikiPage)
    .where(
      and(
        eq(wikiPage.spaceId, spaceId),
        isNull(wikiPage.deletedAt),
        eq(wikiPage.isTemplate, true),
      ),
    )
    .orderBy(asc(wikiPage.title), asc(wikiPage.id))
    .limit(TEMPLATE_LIMIT);
}

/**
 * Every live page in a space, with everything an export file has to carry
 * (§21.8 — slice 22).
 *
 * **One query for the whole space, bodies included** — the opposite of
 * `fetchSpaceTree`'s "no body column", and the exception proves that rule rather
 * than breaking it. The tree fetches no bodies because it draws a list of links;
 * an export *is* the bodies. There is no cheaper shape available: every page's
 * text has to cross this boundary exactly once.
 *
 * Templates are included. §21.7 makes a template an ordinary page, and an export
 * that dropped them would be a folder the company could not import back into an
 * empty workspace with the same contents — which is §21.13's definition of done
 * for this slice, word for word.
 *
 * Ordered by the tree's own order, so the archive's files come out in the order
 * the sidebar draws them and a diff of two exports is readable.
 */
export type ExportPageRow = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  icon: string | null;
  body: string;
  isTemplate: boolean;
  updatedAt: Date;
  ownerName: string | null;
  verifiedAt: Date | null;
  verifiedByName: string | null;
  verificationExpiresAt: CalendarDate | null;
};

/**
 * The ceiling on one export.
 *
 * §16's question asked of a feature that reads a whole space at once. A space of
 * two thousand pages is not a wiki anybody is reading, and an export of one is a
 * request that would hold a connection and a few hundred megabytes of heap to
 * build an archive nobody can open. The refusal is named on screen; the number
 * is far above any real space and far below anything that hurts.
 */
export const EXPORT_PAGE_LIMIT = 2_000;

export async function fetchSpaceExport(tx: TenantDb, spaceId: string): Promise<ExportPageRow[]> {
  const owner = alias(workspaceMember, 'owner_member');
  const ownerUser = alias(user, 'owner_user');
  const verifier = alias(workspaceMember, 'verifier_member');
  const verifierUser = alias(user, 'verifier_user');

  return tx
    .select({
      id: wikiPage.id,
      parentId: wikiPage.parentId,
      slug: wikiPage.slug,
      title: wikiPage.title,
      icon: wikiPage.icon,
      body: wikiPage.body,
      isTemplate: wikiPage.isTemplate,
      updatedAt: wikiPage.updatedAt,
      ownerName: ownerUser.name,
      verifiedAt: wikiPage.verifiedAt,
      verifiedByName: verifierUser.name,
      verificationExpiresAt: wikiPage.verificationExpiresAt,
    })
    .from(wikiPage)
    /*
      Left joins on both, and slice 21's finding is why this is stated rather
      than assumed: an inner join on an optional relation is how a page with no
      owner silently disappears from a list that was supposed to hold every page.
      Most pages have neither an owner nor a verifier.
    */
    .leftJoin(owner, eq(owner.id, wikiPage.ownerMemberId))
    .leftJoin(ownerUser, eq(ownerUser.id, owner.userId))
    .leftJoin(verifier, eq(verifier.id, wikiPage.verifiedByMemberId))
    .leftJoin(verifierUser, eq(verifierUser.id, verifier.userId))
    .where(and(eq(wikiPage.spaceId, spaceId), isNull(wikiPage.deletedAt)))
    .orderBy(asc(wikiPage.position), asc(wikiPage.title), asc(wikiPage.id))
    .limit(EXPORT_PAGE_LIMIT + 1);
}

/** One page by its slug within a space — the reader's own lookup. */
export async function fetchPageBySlug(
  tx: TenantDb,
  input: { spaceId: string; slug: string },
): Promise<PageDetail | null> {
  const rows = await tx
    .select(pageColumns)
    .from(wikiPage)
    .where(
      and(
        eq(wikiPage.spaceId, input.spaceId),
        eq(wikiPage.slug, input.slug),
        isNull(wikiPage.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One page by id, deleted or not.
 *
 * `includeDeleted` exists for exactly one caller — restore (§20.3.6) — and is
 * off by default, so the ordinary reads cannot reach a deleted page by
 * forgetting a flag. That is the shape `findItemByReference` uses for §17-17's
 * archived filter, pointed at a soft delete instead.
 */
export async function fetchPage(
  tx: TenantDb,
  pageId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<PageDetail | null> {
  const rows = await tx
    .select(pageColumns)
    .from(wikiPage)
    .where(
      and(
        eq(wikiPage.id, pageId),
        options.includeDeleted === true ? undefined : isNull(wikiPage.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Page titles for the `#[uuid]` tokens a body carries (§20.7).
 *
 * **Resolved at render, never stored** — the rule `activity.data` and comment
 * mentions already follow: "somebody who renames a page should read correctly in
 * a document written last March, and a name frozen into a row is the one string
 * a Khmer workspace could never fix (§13)."
 *
 * A deleted page is deliberately included and marked, because §20.3.6 asks a
 * reference to one to render as "a deleted page" rather than breaking — the same
 * fallback slice 7 chose for an activity line naming a hard-deleted workflow
 * state. Returning nothing for it would make the reference render as the absence
 * slice 17 shipped, which is right for a page that never existed and wrong for
 * one somebody removed last week.
 */
export type PageRef = {
  id: string;
  title: string;
  slug: string;
  spaceSlug: string;
  deleted: boolean;
  /**
   * The opening of the body, for §21.4's hover preview — raw Markdown, trimmed
   * to a bounded prefix here and reduced to reading text by the caller.
   *
   * **Bounded in SQL rather than in TypeScript**, because a page body is capped
   * at 200,000 graphemes and a paragraph mentioning six pages would otherwise
   * pull six whole documents across the wire to show six one-line tooltips. 400
   * code points is far more than the preview shows and enough that the first
   * line survives whatever heading or callout marker opens the body.
   *
   * `left()` counts code points and the preview is cut to graphemes afterwards
   * (§13) — the same division of labour 0036's icon CHECK makes, and for the
   * same reason: this is a cheap bound, not the rule.
   */
  excerpt: string;
};

export async function fetchPageRefs(tx: TenantDb, pageIds: string[]): Promise<PageRef[]> {
  if (pageIds.length === 0) return [];

  return tx
    .select({
      id: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
      deleted: sql<boolean>`${wikiPage.deletedAt} is not null`,
      excerpt: sql<string>`left(${wikiPage.body}, 400)`,
    })
    .from(wikiPage)
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(inArray(wikiPage.id, pageIds));
}

/**
 * **What links here** (§21.4) — the pages whose bodies reference this one.
 *
 * "Automatic bidirectional linking is the cheapest thing in this section and the
 * one that most changes how a wiki feels. It is the difference between a folder
 * tree and a body of knowledge: you write a page about deployment, and the page
 * about onboarding — written by somebody else, six months earlier — starts
 * listing it without anybody maintaining an index."
 *
 * **The reader's own visible spaces are a parameter, not a filter applied
 * afterwards**, and that is `queries/wiki.ts`'s standing shape (§20.5): this
 * module decides no permissions, and every function takes an already-resolved
 * space or an already-vetted set of space ids. It matters more here than
 * anywhere else in the wiki, because a backlink is the one place a page in a
 * space somebody cannot read would otherwise announce its own title — on a page
 * they *can* read. Filtering after a `LIMIT` would do it silently and by
 * returning fewer rows, which is the trap `queries/notes.ts` names for the
 * owner predicate.
 *
 * Soft-deleted referrers are excluded: §20.3.6 gives deletion a 30-day window,
 * and a page in the bin still holds its edges — restoring it should restore the
 * backlink rather than need every referring page re-saved — but it must not be
 * listed as though it were live.
 */
export type Backlink = { id: string; title: string; slug: string; spaceSlug: string; icon: string | null };

export async function fetchBacklinks(
  tx: TenantDb,
  input: { pageId: string; spaceIds: string[]; limit?: number },
): Promise<Backlink[]> {
  if (input.spaceIds.length === 0) return [];

  return tx
    .select({
      id: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
      icon: wikiPage.icon,
    })
    .from(wikiPageRef)
    .innerJoin(wikiPage, eq(wikiPage.id, wikiPageRef.fromPageId))
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(
      and(
        eq(wikiPageRef.toPageId, input.pageId),
        inArray(wikiPage.spaceId, input.spaceIds),
        isNull(wikiPage.deletedAt),
      ),
    )
    .orderBy(wikiPage.title)
    .limit(input.limit ?? BACKLINK_LIMIT);
}

/**
 * How many referring pages one reader is shown.
 *
 * A cap rather than a page, which is slice 13's call for My Work and slice 14's
 * for the search results, stated rather than hidden: keyset paging goes through
 * `/api/internal/list`, which returns work-item rows for one project's context.
 * A page referenced by more than fifty others is a hub, and what somebody wants
 * there is the All-pages view filtered by tag — not page two of a footer.
 */
const BACKLINK_LIMIT = 50;

/**
 * One page's history, newest first (§20.2's "who and when").
 *
 * The author's *display name* is joined here rather than resolved by the screen,
 * because a revision list of forty rows would otherwise be forty lookups — and
 * because the name has to survive the person leaving: `wiki_page_revision`'s
 * author key is `restrict` precisely so a page stays attributed (§20.5), and the
 * left join is what renders somebody whose account is gone rather than whose
 * membership ended.
 */
export async function fetchRevisions(
  tx: TenantDb,
  input: { pageId: string; limit?: number },
): Promise<RevisionRow[]> {
  return tx
    .select({
      id: wikiPageRevision.id,
      revisionNo: wikiPageRevision.revisionNo,
      title: wikiPageRevision.title,
      body: wikiPageRevision.body,
      authorMemberId: wikiPageRevision.authorMemberId,
      authorName: user.name,
      createdAt: wikiPageRevision.createdAt,
    })
    .from(wikiPageRevision)
    .innerJoin(workspaceMember, eq(workspaceMember.id, wikiPageRevision.authorMemberId))
    .leftJoin(user, eq(user.id, workspaceMember.userId))
    .where(eq(wikiPageRevision.pageId, input.pageId))
    .orderBy(desc(wikiPageRevision.revisionNo))
    .limit(input.limit ?? REVISION_PAGE_LIMIT);
}

/** Two specific revisions, for the compare screen. Either may be absent. */
export async function fetchRevisionPair(
  tx: TenantDb,
  input: { pageId: string; from: number; to: number },
): Promise<RevisionRow[]> {
  return tx
    .select({
      id: wikiPageRevision.id,
      revisionNo: wikiPageRevision.revisionNo,
      title: wikiPageRevision.title,
      body: wikiPageRevision.body,
      authorMemberId: wikiPageRevision.authorMemberId,
      authorName: user.name,
      createdAt: wikiPageRevision.createdAt,
    })
    .from(wikiPageRevision)
    .innerJoin(workspaceMember, eq(workspaceMember.id, wikiPageRevision.authorMemberId))
    .leftJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(wikiPageRevision.pageId, input.pageId),
        inArray(wikiPageRevision.revisionNo, [input.from, input.to]),
      ),
    )
    .orderBy(asc(wikiPageRevision.revisionNo));
}

/**
 * The work items a page links to (§20.2).
 *
 * The project columns ride along so §10 can be asked about each one *after* the
 * query — the same construction `queries/notes.ts` uses for a pin, and for the
 * same reason: `can(actor, 'project.view', …)` is a pure function over exactly
 * these fields, so fetching them costs one join and re-deriving visibility in
 * SQL would be a second implementation of §10.
 *
 * This matters more here than it does for a note's pin. A page in the company
 * space is readable by everybody, and it may link to an item in a private
 * project — so the link list is the one place in the wiki where a reader can
 * hold a row they may not follow.
 */
export async function fetchPageLinks(tx: TenantDb, pageId: string): Promise<LinkedItem[]> {
  return tx
    .select({
      workItemId: workItem.id,
      number: workItem.number,
      title: workItem.title,
      projectSlug: project.slug,
      projectKey: project.key,
      projectId: project.id,
      projectWorkspaceId: project.workspaceId,
      projectVisibility: project.visibility,
    })
    .from(wikiPageLink)
    .innerJoin(workItem, eq(workItem.id, wikiPageLink.workItemId))
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(
      and(
        eq(wikiPageLink.pageId, pageId),
        isNull(wikiPageLink.deletedAt),
        isNull(workItem.deletedAt),
      ),
    )
    .orderBy(asc(project.key), asc(workItem.number));
}

/**
 * The other direction: the pages linked from a work item (§20.12's
 * `related-pages.tsx`).
 *
 * "A page links to work items and an item lists its pages — the thing that makes
 * a wiki get read rather than written once" (§20.2). This is the half that does
 * the making.
 *
 * Takes an open transaction, because §20.12 is explicit that it "rides" the one
 * `getWorkItem` already opens: "a second service call is a second transaction on
 * every item-page render — the trap slice 8 hit with `getCommentThread`, slice 9
 * with the unread count, slice 10 with custom fields, slice 13 with §7.4's six
 * lists and slice 14 with the palette's scope."
 *
 * The **caller filters by readable space**, which is why the space id comes back
 * with each row: an item in a project somebody can see may be linked from a page
 * in a project they cannot, and this query has no way to ask §10 about that.
 */
export async function fetchItemPages(
  tx: TenantDb,
  workItemId: string,
): Promise<(LinkedPage & { spaceId: string })[]> {
  return tx
    .select({
      pageId: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceId: wikiSpace.id,
      spaceSlug: wikiSpace.slug,
    })
    .from(wikiPageLink)
    .innerJoin(wikiPage, eq(wikiPage.id, wikiPageLink.pageId))
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(
      and(
        eq(wikiPageLink.workItemId, workItemId),
        isNull(wikiPageLink.deletedAt),
        isNull(wikiPage.deletedAt),
        isNull(wikiSpace.deletedAt),
      ),
    )
    .orderBy(asc(wikiPage.title));
}

/**
 * Every live descendant of a page, itself included.
 *
 * `root_id` is maintained by 0032's trigger for exactly this: §9 chose "an
 * adjacency list plus a trigger-maintained root_id/depth over a closure table,
 * so *all descendants* is one indexed equality rather than a second table with
 * write amplification". Filtered to the subtree in TypeScript rather than by a
 * recursive CTE, because the root's own tree is at most three levels and the
 * index makes the wider read cheap.
 */
export async function fetchSubtree(tx: TenantDb, rootId: string): Promise<PageSummary[]> {
  return tx
    .select({
      id: wikiPage.id,
      spaceId: wikiPage.spaceId,
      parentId: wikiPage.parentId,
      title: wikiPage.title,
      slug: wikiPage.slug,
      position: wikiPage.position,
      depth: wikiPage.depth,
      updatedAt: wikiPage.updatedAt,
    })
    .from(wikiPage)
    .where(and(eq(wikiPage.rootId, rootId), isNull(wikiPage.deletedAt)));
}

/** Deleted pages inside §4's 30-day window, for the recovery screen (§20.3.6). */
export async function fetchDeletedPages(
  tx: TenantDb,
  input: { spaceIds: string[]; since: Date },
): Promise<(PageSummary & { deletedAt: Date })[]> {
  if (input.spaceIds.length === 0) return [];

  const rows = await tx
    .select({
      id: wikiPage.id,
      spaceId: wikiPage.spaceId,
      parentId: wikiPage.parentId,
      title: wikiPage.title,
      slug: wikiPage.slug,
      position: wikiPage.position,
      depth: wikiPage.depth,
      updatedAt: wikiPage.updatedAt,
      deletedAt: wikiPage.deletedAt,
    })
    .from(wikiPage)
    .where(
      and(
        inArray(wikiPage.spaceId, input.spaceIds),
        sql`${wikiPage.deletedAt} is not null`,
        sql`${wikiPage.deletedAt} >= ${input.since}`,
      ),
    )
    .orderBy(desc(wikiPage.deletedAt));

  // `deletedAt` is non-null by the predicate; narrowed by filtering rather than
  // asserted, so a change to the predicate cannot quietly produce a null here.
  return rows.flatMap((row) =>
    row.deletedAt === null ? [] : [{ ...row, deletedAt: row.deletedAt }],
  );
}

const pageColumns = {
  id: wikiPage.id,
  spaceId: wikiPage.spaceId,
  parentId: wikiPage.parentId,
  title: wikiPage.title,
  slug: wikiPage.slug,
  /** One emoji, or nothing (§21.2 — slice 20). Decorative at every call site. */
  icon: wikiPage.icon,
  position: wikiPage.position,
  depth: wikiPage.depth,
  body: wikiPage.body,
  revisionNo: wikiPage.revisionNo,
  /** §21.7's flag — the reader badges it, the editor is unchanged by it. */
  isTemplate: wikiPage.isTemplate,
  rootId: wikiPage.rootId,
  createdAt: wikiPage.createdAt,
  updatedAt: wikiPage.updatedAt,
  deletedAt: wikiPage.deletedAt,

  /**
   * §21.3's four, plus the two display names they resolve to.
   *
   * The names come from correlated subqueries rather than from two more joins,
   * and the reason is that both are *optional* — a page usually has no owner and
   * has never been verified, and two left joins through `workspace_member` to
   * `app_user` for columns that are null on most rows is three extra relations
   * on the hot path of every page render. A scalar subquery is planned as a
   * lookup on the primary key and costs nothing when the id is null.
   *
   * A **name resolved at read**, never stored beside the id — the rule
   * `activity.data`, a comment's mentions and `fetchPageRefs` all follow, for
   * §13's reason: somebody who changes their display name should read correctly
   * in a verification recorded last March.
   *
   * **The subqueries are written with explicit table aliases, not with drizzle
   * column references, and that is a scar rather than a style.** Inside a `sql`
   * template in the *select-fields* position drizzle emits a column
   * **unqualified** — `${'${workspaceMember.id}'}` becomes a bare `"id"` — so a
   * subquery joining `workspace_member` to `user`, both of which have an `id`,
   * fails with `column reference "id" is ambiguous`. Nothing catches it until a
   * page is actually rendered: it typechecks, and the tenancy suite never calls
   * this shape. Aliases make the reference explicit and the ambiguity
   * impossible. The table is `app_user`; `user` is only the drizzle
   * export's name, which is its own small trap.
   */
  ownerMemberId: wikiPage.ownerMemberId,
  ownerName: sql<string | null>`(
    select u.name from workspace_member wm
    join app_user u on u.id = wm.user_id
    where wm.id = ${wikiPage.ownerMemberId}
  )`,
  verifiedAt: wikiPage.verifiedAt,
  verifiedByMemberId: wikiPage.verifiedByMemberId,
  verifiedByName: sql<string | null>`(
    select u.name from workspace_member wm
    join app_user u on u.id = wm.user_id
    where wm.id = ${wikiPage.verifiedByMemberId}
  )`,
  verificationExpiresAt: wikiPage.verificationExpiresAt,
};

/* ------------------------------------------------------------------------- */
/* Ownership and verification (§21.3 — slice 19)                             */
/* ------------------------------------------------------------------------- */

/**
 * A row of the All-pages view (§21.3).
 *
 * "Title, owner, verification state, expiry, last edited, last editor" — the six
 * columns the plan names, and the state is deliberately **not** among them: it
 * is derived by `verificationStatus` from the two date columns and the
 * workspace's today, on whichever side is drawing it. A `status` in this row
 * would be that derivation done a second time, in SQL, for the two to disagree
 * about a page on the morning it expires.
 */
export type SpacePageRow = PageVerificationColumns & {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  depth: number;
  updatedAt: Date;
  /** Who wrote the current revision — a different person from the owner, usually. */
  lastEditorName: string | null;
  labelIds: string[];
  /**
   * §21.7's flag — slice 22.
   *
   * **Templates are listed here though they are hidden from the tree**, and the
   * two are not in tension: the tree is navigation, and this view is governance.
   * A template nobody has owned or read since 2024 is exactly what "find every
   * unowned page" is asked to surface, and it is the page whose staleness
   * propagates — every incident report written from it inherits its headings.
   * The row is badged so the answer to "why is this not in the sidebar" is on
   * screen rather than in a plan.
   */
  isTemplate: boolean;
};

/**
 * How many rows the All-pages view draws at once.
 *
 * **It does not page**, which is slice 13's call for My Work, slice 14's for the
 * search results and slice 17's for the notes list, stated rather than hidden.
 * The same reason holds and one more: this is a *review* surface, and somebody
 * with more than five hundred pages in one space needs the filters — which are
 * right there and which is what they are for — rather than a second page.
 */
export const SPACE_PAGE_LIMIT = 500;

/**
 * Every live page in one space, with its ownership and verification (§21.3).
 *
 * **Not §9's builder, and that is a decision rather than an omission.** §21.3:
 * "that builder emits a counts query and a `LATERAL` per-group page over
 * `work_item`, and §20.8 already established that a page is not a work item and
 * must not pretend to be one." What it *does* borrow is §16's rule — it is
 * anchored by the space, exactly as every other page query is, so there is no
 * shape of this call that scans a workspace.
 *
 * Filtering and sorting happen in the caller rather than here, and that is the
 * cheap direction for a bounded set: the whole space is at most
 * `SPACE_PAGE_LIMIT` rows, the status is a *derived* value no SQL predicate can
 * express without re-deriving it, and a filter written in SQL would be the
 * second implementation §21.3's own "one place" rule exists to prevent.
 */
export async function fetchSpacePages(
  tx: TenantDb,
  spaceId: string,
): Promise<SpacePageRow[]> {
  return tx
    .select({
      id: wikiPage.id,
      parentId: wikiPage.parentId,
      title: wikiPage.title,
      slug: wikiPage.slug,
      depth: wikiPage.depth,
      updatedAt: wikiPage.updatedAt,
      isTemplate: wikiPage.isTemplate,

      // Aliased for the reason `pageColumns` explains: in a select-fields `sql`
      // template drizzle drops the table qualifier, and `"id"` across a join of
      // two tables that both have one is ambiguous at runtime only.
      ownerMemberId: wikiPage.ownerMemberId,
      ownerName: sql<string | null>`(
        select u.name from workspace_member wm
        join app_user u on u.id = wm.user_id
        where wm.id = ${wikiPage.ownerMemberId}
      )`,
      verifiedAt: wikiPage.verifiedAt,
      verifiedByMemberId: wikiPage.verifiedByMemberId,
      verifiedByName: sql<string | null>`(
        select u.name from workspace_member wm
        join app_user u on u.id = wm.user_id
        where wm.id = ${wikiPage.verifiedByMemberId}
      )`,
      verificationExpiresAt: wikiPage.verificationExpiresAt,

      /**
       * The author of the *current* revision, which is "last edited by" and is
       * not the owner. The revision table is the only place that fact lives —
       * `wiki_page` records no editor, deliberately, because the append-only
       * history already does and a denormalized copy would be the one that goes
       * stale after a restore.
       */
      lastEditorName: sql<string | null>`(
        select u.name
        from wiki_page_revision r
        join workspace_member wm on wm.id = r.author_member_id
        left join app_user u on u.id = wm.user_id
        -- The outer row, qualified by table name rather than interpolated: a
        -- drizzle column reference emits a bare id here, and inside a subquery
        -- whose own FROM has three relations that each have one, Postgres
        -- resolves it against the inner tables and calls it ambiguous. Naming
        -- the outer table is the only unambiguous way to correlate.
        where r.page_id = wiki_page.id
          and r.revision_no = wiki_page.revision_no
      )`,

      /**
       * §21.3's tags, as ids only — `LabelChip` resolves the name and the colour
       * from the workspace vocabulary the screen already loaded, which is what
       * keeps a rename from orphaning anything (§7.11) and what keeps the label
       * name out of this row and therefore out of any cache of it.
       */
      labelIds: sql<string[]>`coalesce((
        select array_agg(pl.label_id::text order by l.name)
        from wiki_page_label pl
        join label l on l.id = pl.label_id
        where pl.page_id = wiki_page.id
      ), '{}')`,
    })
    .from(wikiPage)
    .where(and(eq(wikiPage.spaceId, spaceId), isNull(wikiPage.deletedAt)))
    // Most-recently-touched first. A review surface is read top-down by somebody
    // deciding what to look at, and "what moved lately" is the better opening
    // question than alphabetical — which the sortable headers still offer.
    .orderBy(desc(wikiPage.updatedAt), asc(wikiPage.title))
    .limit(SPACE_PAGE_LIMIT);
}

/**
 * The standing count §21.3 puts on the space: how much of it needs review.
 *
 * "The **space** shows a standing count of what is expired or expiring, which is
 * a list somebody chooses to look at rather than a message that arrives." That
 * sentence is the whole justification for this being a separate, tiny query
 * rather than a length taken from the one above: the space *home* renders on
 * every visit to the wiki and must not fetch five hundred rows to put a number
 * in a heading.
 *
 * The horizon is passed in already resolved — the split `VERIFICATION_WARNING_DAYS`
 * describes, and the same one slice 9 made for the digest's horizon and slice 13
 * for staleness's cutoff.
 */
export async function fetchVerificationCounts(
  tx: TenantDb,
  input: { spaceId: string; today: CalendarDate; warnFrom: CalendarDate },
): Promise<{ expired: number; expiring: number; unverified: number; unowned: number }> {
  const rows = await tx
    .select({
      expired: sql<number>`count(*) filter (
        where ${wikiPage.verificationExpiresAt} is not null
          and ${wikiPage.verificationExpiresAt} < ${input.today}::date
      )::int`,
      expiring: sql<number>`count(*) filter (
        where ${wikiPage.verificationExpiresAt} is not null
          and ${wikiPage.verificationExpiresAt} >= ${input.today}::date
          and ${wikiPage.verificationExpiresAt} <= ${input.warnFrom}::date
      )::int`,
      unverified: sql<number>`count(*) filter (where ${wikiPage.verifiedAt} is null)::int`,
      unowned: sql<number>`count(*) filter (where ${wikiPage.ownerMemberId} is null)::int`,
    })
    .from(wikiPage)
    .where(and(eq(wikiPage.spaceId, input.spaceId), isNull(wikiPage.deletedAt)));

  return rows[0] ?? { expired: 0, expiring: 0, unverified: 0, unowned: 0 };
}

/** A page the evening digest has something to say about (§21.3). */
export type ExpiringOwnedPage = {
  pageId: string;
  title: string;
  spaceSlug: string;
  slug: string;
  expiresAt: CalendarDate;
};

/**
 * The pages one person owns that lapse within the horizon (§21.3).
 *
 * Read **as that member**, inside their own `withActor`, exactly as the rest of
 * the digest is — which is what makes "an email cannot describe an item its
 * recipient is not allowed to open" true of pages as well as of work items. RLS
 * scopes it to the workspace and `canReadSpace` is asked by the caller for the
 * handful of spaces that come back, because a page in a private project's space
 * is one this person may own and no longer be able to read.
 *
 * Both ends of the window are closed: **already expired pages are included**,
 * and that is deliberate rather than sloppy. A digest that only warned about the
 * *coming* lapse would go quiet the morning after one happened, which is exactly
 * when the page most needs somebody to look at it — the same failure §17-19
 * records for due dates ("the first time the product mentioned a due date was
 * when the item was already overdue").
 */
export async function fetchExpiringOwnedPages(
  tx: TenantDb,
  input: { memberId: string; horizon: CalendarDate },
): Promise<(ExpiringOwnedPage & { spaceId: string })[]> {
  return tx
    .select({
      pageId: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceId: wikiSpace.id,
      spaceSlug: wikiSpace.slug,
      expiresAt: sql<CalendarDate>`${wikiPage.verificationExpiresAt}`,
    })
    .from(wikiPage)
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(
      and(
        eq(wikiPage.ownerMemberId, input.memberId),
        isNull(wikiPage.deletedAt),
        isNull(wikiSpace.deletedAt),
        sql`${wikiPage.verificationExpiresAt} is not null`,
        sql`${wikiPage.verificationExpiresAt} <= ${input.horizon}::date`,
      ),
    )
    // Soonest first, which puts anything already lapsed at the top.
    .orderBy(asc(wikiPage.verificationExpiresAt), asc(wikiPage.title));
}

/**
 * How many live pages a member owns — §7.12's offboarding dialog (§21.3).
 *
 * "`[!]` the owner leaves the company → §7.12's offboarding dialog counts the
 * pages they own, and the removal nulls the column rather than deleting
 * anything." A **count and never a list**, for the reason the note count beside
 * it is a count: it is a fact somebody may want to act on before the click, and
 * discovering it afterwards is discovering it too late.
 *
 * Written as a `sql` fragment rather than a function, because it rides the
 * member list's existing query as one more correlated subquery — the trap slices
 * 8 through 14 each hit and the answer they each arrived at.
 *
 * **The interpolated outer column is correct here, and slice 22 checked rather
 * than assumed it.** `${memberIdColumn}` looks like `fetchSpaces`'s defect above
 * and is not: drizzle emits a column unqualified only when the statement has a
 * single table, and `listMembers` joins `app_user`, so this reaches Postgres as
 * `"workspace_member"."id"` and the correlation is real. Confirmed with
 * drizzle's own `.toSQL()` on both shapes, and pinned by
 * `__tenancy__/member-counts.test.ts`, which asserts the numbers rather than the
 * SQL — because the numbers are the only thing that would have failed.
 *
 * Keeping the parameter keeps it alias-safe, which a literal `workspace_member`
 * would not be.
 */
export function ownedPageCountFor(memberIdColumn: SQL | AnyColumn): SQL<number> {
  return sql<number>`(
    select count(*)::int from wiki_page p
    where p.owner_member_id = ${memberIdColumn}
      and p.deleted_at is null
  )`;
}

/** The labels applied to one page — the reader's own chips. */
export async function fetchPageLabelIds(tx: TenantDb, pageId: string): Promise<string[]> {
  const rows = await tx
    .select({ labelId: wikiPageLabel.labelId })
    .from(wikiPageLabel)
    .where(eq(wikiPageLabel.pageId, pageId));

  return rows.map((row) => row.labelId);
}
