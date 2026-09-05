import 'server-only';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import {
  note,
  project,
  user,
  wikiPage,
  wikiSpace,
  workspaceMember,
  workItem,
} from '@/server/db/schema';
import { searchRoute, toLikePattern, toTsQuery } from '@/lib/search';

/**
 * The two questions §7.9 asks that the §9 list query cannot (slice 14).
 *
 * Work items are **not** here, and that absence is the slice's main structural
 * decision. Searching work is one filter on the one builder — `q` in the DSL,
 * one branch in `wherePredicate` — so it inherits the counts query, the keyset
 * cursors, the archived default and §10's per-row re-check rather than becoming
 * a second query with its own opinions about all four. What is left over is
 * people, who are not work items, and a direct `ENG-142` lookup, which is not a
 * search at all: it is a unique-index probe whose answer is a destination.
 *
 * Projects are not here either, for a different reason: `listProjects` already
 * answers "which projects may this person see" as a SQL predicate re-checked
 * through the policy module, and a workspace holds tens of them. Filtering that
 * list in TypeScript is one round trip fewer *and* — the part that matters —
 * cannot drift from §10's visibility rules, which a second predicate written
 * here eventually would. The trigram index on `lower(project.name)` in migration
 * 0026 is there for the day that stops being true, not for today.
 */

export type PersonHit = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  /** Rendered as "left the company" rather than hidden — see below. */
  active: boolean;
};

/**
 * §7.9's People section.
 *
 * Both scripts take the same route, unlike work items, and the asymmetry is
 * deliberate rather than an omission: a name is two or three words, so lexeme
 * matching buys nothing a substring match does not already give, and "sop"
 * finding "Sophea" is the behaviour anybody typing into a palette expects.
 * Matching the email as well is what makes the palette useful the moment
 * somebody pastes an address out of a chat.
 *
 * Both sides are folded — `lower()` on the columns, `toLikePattern` on the
 * needle — rather than `ILIKE`, for the reason the whole slice folds: the same
 * comparison shape everywhere, and the one that an index can serve if this table
 * ever grows enough to need one (0026 explains why it has none today).
 *
 * **Former members are found and marked, not hidden.** Migration 0009 widened
 * `app_user`'s policy precisely so somebody who has left still resolves in the
 * history they wrote (§7.12: "activity history is preserved and attributed"), and
 * a palette that cannot find the person whose comment you are reading is a
 * palette that looks broken. The caller decides what to do with `active`; the
 * one thing it must not do is offer them as an assignee.
 */
export async function findPeople(
  tx: TenantDb,
  text: string,
  limit: number,
): Promise<PersonHit[]> {
  const pattern = toLikePattern(text);

  return tx
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      // An account with no name still has to be nameable in a list, so the
      // address stands in until they fill one in — the same coalesce
      // `readPeople` makes, for the same reason.
      name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
      email: user.email,
      active: sql<boolean>`${workspaceMember.deletedAt} is null`,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        isNull(user.deletedAt),
        sql`(lower(${user.name}) like ${pattern} or lower(${user.email}) like ${pattern})`,
      ),
    )
    // Current members first, then by name. A palette that lists a leaver above
    // the colleague sitting next to you is one people stop trusting; ordering
    // says so without hiding anything.
    .orderBy(sql`${workspaceMember.deletedAt} is not null`, user.name)
    .limit(limit);
}

export type ItemReferenceHit = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectSlug: string;
  projectKey: string;
  projectVisibility: 'workspace' | 'private';
  projectWorkspaceId: string;
  /** True when the project is archived. The lookup still resolves — see below. */
  archived: boolean;
};

/**
 * `ENG-142` — §7.9's short-circuit, as a unique-index probe.
 *
 * "A direct `ENG-142` lookup always resolves regardless of either — that is the
 * entire reason identifiers are never reused." *Either* means an archived project
 * and the include-archived toggle: this query applies neither, because the point
 * of a permanent identifier is that pasting it into a palette gets you to the
 * thing, and a person who typed an exact identifier has already told us which
 * item they mean.
 *
 * What it does **not** bypass is deletion or permission. `deleted_at is null`
 * is applied here — §7.9: "soft-deleted items never appear in search and are
 * reachable only from the 30-day recovery screen" — and the caller re-checks
 * §10 on the project before it hands the answer back, which is why the row
 * carries the three columns `can(..., 'project.view', ...)` needs.
 *
 * The key comparison is case-folded because `parseItemReference` upper-cases and
 * `normalizeProjectKey` guarantees stored keys are upper-case; folding both
 * sides costs nothing and removes the one way those two could ever disagree.
 */
export async function findItemByReference(
  tx: TenantDb,
  key: string,
  number: number,
): Promise<ItemReferenceHit | null> {
  const rows = await tx
    .select({
      id: workItem.id,
      number: workItem.number,
      title: workItem.title,
      projectId: project.id,
      projectSlug: project.slug,
      projectKey: project.key,
      projectVisibility: project.visibility,
      projectWorkspaceId: project.workspaceId,
      archived: sql<boolean>`${project.archivedAt} is not null`,
    })
    .from(workItem)
    .innerJoin(project, eq(project.id, workItem.projectId))
    .where(
      and(
        sql`upper(${project.key}) = ${key}`,
        eq(workItem.number, number),
        isNull(workItem.deletedAt),
        isNull(project.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Notes (§20.8, slice 17)                                                   */
/* ------------------------------------------------------------------------- */

export type NoteHit = {
  id: string;
  title: string | null;
  body: string;
  updatedAt: Date;
};

/**
 * §20.3.5's Notes section — the third corpus, on the same recipe as the first.
 *
 * **Not one query with work items, and not a new recipe either** (§20.8). A note
 * is not a work item, so it cannot ride §9's builder: that builder emits a
 * counts query and a `LATERAL` per-group page over `work_item`, and pretending a
 * note is one would be the first place "what is overdue" got two answers. What
 * it reuses is everything *above* the query — `searchRoute`, `hasKhmer`,
 * `toTsQuery`, `toLikePattern`, `MIN_QUERY_LENGTH` and the two-index recipe from
 * migration 0030, which is migration 0026's recipe applied to a second
 * `search_text` column.
 *
 * **One routing rule, three corpora.** `src/lib/search.ts` stays the only place
 * the Latin/Khmer decision is made: if each corpus detected script its own way,
 * a mixed-script query would find items and miss notes, and the bug report would
 * be a Khmer note nobody could find (§20.8).
 *
 * **The owner predicate is in the query, never a filter applied afterwards**
 * (§20.8). "A `LIMIT` applied before the predicate is a palette that tells
 * somebody how many notes their colleagues have" — and it would do it silently,
 * by returning fewer rows than it found. This is the property
 * `__tenancy__/notes.test.ts` asserts directly.
 *
 * **Ordering is recency**, as it is for items and for the same two reasons
 * (§20.8): `ts_rank` normalises by document length, which is backwards for
 * notes, where the useful one is often the long one — and it cannot rank the
 * trigram route at all, so ranking by it would give the two languages different
 * orderings of one corpus.
 *
 * **Anchored by construction**, so §16's invariant is untouched: a note is
 * bounded by its owner before any text is compared, which is a tighter bound
 * than the enumerated project set the item search leans on.
 */
export async function findNotes(
  tx: TenantDb,
  input: { ownerMemberId: string; text: string; limit: number },
): Promise<NoteHit[]> {
  const route = searchRoute(input.text);
  const tsquery = route === 'fulltext' ? toTsQuery(input.text) : null;

  // A purely-punctuation query reduces to no terms, and a `to_tsquery` of
  // nothing matches nothing — returning early says so without asking Postgres.
  if (route === 'fulltext' && tsquery === null) return [];

  const matches =
    route === 'fulltext'
      ? // The index is on this exact expression (0030); written any other way
        // the planner will not reach for it.
        sql`to_tsvector('simple', ${note.searchText}) @@ to_tsquery('simple', ${tsquery})`
      : // `LIKE` and not `ILIKE`: the column is generated `lower(...)` precisely
        // so a `gin_trgm_ops` index can serve this.
        sql`${note.searchText} like ${toLikePattern(input.text)}`;

  return tx
    .select({
      id: note.id,
      title: note.title,
      body: note.body,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(and(eq(note.ownerMemberId, input.ownerMemberId), isNull(note.deletedAt), matches))
    .orderBy(desc(note.updatedAt), desc(note.id))
    .limit(input.limit);
}


/* ------------------------------------------------------------------------- */
/* Wiki pages (§20.8, slice 18)                                              */
/* ------------------------------------------------------------------------- */

export type PageHit = {
  id: string;
  title: string;
  slug: string;
  spaceSlug: string;
  spaceName: string;
  spaceNameKey: string | null;
  body: string;
  updatedAt: Date;
};

/**
 * §20.3.5's Pages section — the **fourth** corpus, on the same recipe as the
 * other three, and the last one §20 adds.
 *
 * Everything `findNotes` says above applies here unchanged, which is the point:
 * "One routing rule, three corpora. If each corpus detected script its own way,
 * a mixed-script query would find items and miss pages, and the bug report would
 * be a Khmer page nobody could find" (§20.8). `src/lib/search.ts` stays the only
 * place the Latin/Khmer decision is made, and migration 0032's two indexes are
 * 0026's two indexes over a third generated `search_text` column.
 *
 * Two things are specific to a page and worth naming.
 *
 * **The bound is an enumerated set of space ids, and it arrives as an
 * argument.** A note is bounded by its owner, which is one column in the
 * predicate; a page is bounded by its *space*, which is §20.5's unit of access
 * and a question only `space-access.ts` can answer. So the caller resolves the
 * readable spaces first and hands them in — which is exactly what slice 14 did
 * for items, where "an enumerated project set is the `project` anchor". §16's
 * invariant is untouched: "the feature that most looked like it would have to
 * weaken §9's rule is the one that leaned hardest on it."
 *
 * An empty set returns nothing rather than everything, which is the direction a
 * missing bound has to fail in. A Guest with no visible project and no company
 * space reaches exactly this branch.
 *
 * **A deleted page is not searchable, and that is a different rule from an
 * archived item.** §17-17 makes archived items a toggle a person can turn off,
 * because archiving is a state a company chose. A soft-deleted page is inside
 * §4's 30-day recovery window and is not something anybody should find in a
 * palette in the meantime — it is gone, recoverably, from the screen that
 * recovers it. 0032's partial index carries the same predicate.
 */
export async function findPages(
  tx: TenantDb,
  input: { spaceIds: string[]; text: string; limit: number },
): Promise<PageHit[]> {
  if (input.spaceIds.length === 0) return [];

  const route = searchRoute(input.text);
  const tsquery = route === 'fulltext' ? toTsQuery(input.text) : null;

  // A purely-punctuation query reduces to no terms, and a `to_tsquery` of
  // nothing matches nothing — returning early says so without asking Postgres.
  if (route === 'fulltext' && tsquery === null) return [];

  const matches =
    route === 'fulltext'
      ? // The index is on this exact expression (0032); written any other way
        // the planner will not reach for it.
        sql`to_tsvector('simple', ${wikiPage.searchText}) @@ to_tsquery('simple', ${tsquery})`
      : // `LIKE` and not `ILIKE`: the column is generated `lower(...)` precisely
        // so a `gin_trgm_ops` index can serve this.
        sql`${wikiPage.searchText} like ${toLikePattern(input.text)}`;

  return tx
    .select({
      id: wikiPage.id,
      title: wikiPage.title,
      slug: wikiPage.slug,
      spaceSlug: wikiSpace.slug,
      spaceName: wikiSpace.name,
      spaceNameKey: wikiSpace.nameKey,
      body: wikiPage.body,
      updatedAt: wikiPage.updatedAt,
    })
    .from(wikiPage)
    .innerJoin(wikiSpace, eq(wikiSpace.id, wikiPage.spaceId))
    .where(
      and(
        inArray(wikiPage.spaceId, input.spaceIds),
        isNull(wikiPage.deletedAt),
        isNull(wikiSpace.deletedAt),
        matches,
      ),
    )
    // Recency, for the two reasons §20.8 gives and `findNotes` repeats: `ts_rank`
    // normalises by document length — "backwards for a wiki where the definitive
    // page is often the long one" — and it cannot rank the trigram route at all,
    // so ranking by it would give the two languages different orderings of one
    // corpus.
    .orderBy(desc(wikiPage.updatedAt), desc(wikiPage.id))
    .limit(input.limit);
}
