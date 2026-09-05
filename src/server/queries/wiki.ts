import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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

export type PageDetail = PageSummary & {
  body: string;
  revisionNo: number;
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
      pageCount: sql<number>`(
        select count(*)::int from ${wikiPage}
        where ${wikiPage.spaceId} = ${wikiSpace.id} and ${wikiPage.deletedAt} is null
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
    .where(and(eq(wikiPage.spaceId, spaceId), isNull(wikiPage.deletedAt)))
    .orderBy(asc(wikiPage.position), asc(wikiPage.title), asc(wikiPage.id));
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
export type PageRef = { id: string; title: string; slug: string; spaceSlug: string; deleted: boolean };

export async function fetchPageRefs(tx: TenantDb, pageIds: string[]): Promise<PageRef[]> {
  if (pageIds.length === 0) return [];

  return tx
    .select({
      id: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
      deleted: sql<boolean>`${wikiPage.deletedAt} is not null`,
    })
    .from(wikiPage)
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(inArray(wikiPage.id, pageIds));
}

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
  position: wikiPage.position,
  depth: wikiPage.depth,
  body: wikiPage.body,
  revisionNo: wikiPage.revisionNo,
  rootId: wikiPage.rootId,
  createdAt: wikiPage.createdAt,
  updatedAt: wikiPage.updatedAt,
  deletedAt: wikiPage.deletedAt,
};
