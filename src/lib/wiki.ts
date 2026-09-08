import { documentLength, normalizeDocument } from './documents';
import { slugify } from './slug';
import { addDays, type CalendarDate } from './workspace-date';

/**
 * A wiki page and its space, as pure data (§20.4, §20.12 — slice 18).
 *
 * **A page is the company's record; a note is one person's thinking** (§20.1).
 * This module is the public half, and the separation from `notes.ts` is
 * structural rather than stylistic: the two nouns share `documents.ts` and
 * nothing else, because a merged shape makes every query carry an owner clause
 * that one query will eventually forget.
 *
 * In `src/lib` for the reason `notes.ts` and `work-item-query.ts` are: both
 * sides run it. The editor derives a slug and counts a body as somebody types;
 * the server derives the same slug and applies the same cap on save. One
 * implementation, so a preview cannot promise something the save refuses.
 *
 * Nothing here touches a connection, a clock or a request — the same purity
 * `policy.ts` keeps, and for the same payoff: the depth cap, the ordering and
 * the compare are unit-testable with no HTTP and no Postgres.
 */

/* ------------------------------------------------------------------------- */
/* Shape                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The two kinds of space, and there is no third (§20.2).
 *
 * "One **company space** per workspace, seeded at signup; one space per
 * project, created with the project. No other kind." An enum rather than a
 * boolean, because §20.16 leaves open "whether the company space is one space
 * or several" and records that "the migration from one to several is a `kind`
 * value plus a parent" — which a boolean would have made a migration over every
 * row instead.
 */
export const SPACE_KINDS = ['company', 'project'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

/**
 * How deep a page tree goes (§20.4).
 *
 * Three, "because a tree deeper than three is a tree nobody navigates — and the
 * space is effectively the fourth level, which is what makes three enough".
 *
 * The number is here and enforced in the database (migration 0032), the same
 * pair `work_item`'s three-level cap has had since 0008: a row written by a
 * seed script, a Markdown importer or a Phase 2 MCP tool has to be as correct
 * as one the service wrote. This constant is what the *editor* uses to stop
 * offering a parent that would exceed it, which is a better experience than a
 * refusal, and never what makes the rule true.
 */
export const MAX_PAGE_DEPTH = 3;

/**
 * The longest a page body may be, in graphemes.
 *
 * §20.7: "The body is capped and the cap counts graphemes. `[...text].length`,
 * never `.length` — slice 10's rule, and the arithmetic that silently gives a
 * Khmer workspace a third of the field an English one gets when it is
 * forgotten."
 *
 * Ten times a note's cap, because the nouns are different sizes: a note is
 * captured in five seconds and a handbook page is written over an afternoon.
 * Large enough for any policy document anybody writes in one sitting; small
 * enough that a body is still a row and a revision is still kilobytes, which is
 * what makes §20.4's "a revision holds the whole body, not a diff" affordable.
 */
export const MAX_PAGE_BODY_LENGTH = 200_000;

/** A page title. Longer than a note's, because a page title is a navigation label people scan. */
export const MAX_PAGE_TITLE_LENGTH = 200;

/** A space name, on the same scale as a project's. */
export const MAX_SPACE_NAME_LENGTH = 80;

export type PageProblem = 'title_required' | 'title_too_long' | 'body_too_long' | 'too_deep';

/**
 * The rules a page has to satisfy, in the one place both sides call.
 *
 * Returns the problem rather than throwing, and the problem is an identifier
 * rather than a sentence — §13's rule that "every failure crosses the wire as a
 * message key, never a sentence", because an English string returned from a
 * server action is the one place Khmer silently degrades.
 *
 * **An empty body is allowed and an empty title is not**, which is the opposite
 * of a note. §20.11 says an empty page "reads as empty, not as broken": a page
 * created as a placeholder for something somebody will write next week is a
 * real thing a wiki holds, and it is reachable in the sidebar by its title. A
 * note has no title field at all, so its body is the whole of it.
 */
export function validatePage(input: {
  title: string;
  body: string;
  /** The depth the page would sit at, 1-based. A root page is 1. */
  depth?: number;
}): PageProblem | null {
  const title = normalizePageTitle(input.title);
  if (title.length === 0) return 'title_required';
  if (graphemeLength(title) > MAX_PAGE_TITLE_LENGTH) return 'title_too_long';

  if (documentLength(normalizeDocument(input.body)) > MAX_PAGE_BODY_LENGTH) return 'body_too_long';

  if (input.depth !== undefined && input.depth > MAX_PAGE_DEPTH) return 'too_deep';

  return null;
}

/** Whitespace collapsed and NFC-normalised — a title is one line by construction. */
export function normalizePageTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().normalize('NFC');
}

/**
 * A page's slug, derived from its title.
 *
 * `slugify` is slice 3's, unchanged, which is what makes a Khmer page title
 * produce the same romanisation a Khmer workspace name does — and carries the
 * same documented approximation (`slug.ts`: a faithful Khmer romanisation needs
 * syllable segmentation). §7.1 makes a workspace slug editable for that reason;
 * a page slug is not, and does not need to be, because of the fallback below.
 *
 * **A title that romanises to nothing gets a slug from its id, not an error.**
 * A page titled with an emoji, or with punctuation alone, is a page somebody
 * meant to create — refusing it would be the product declining to store a title
 * it is perfectly able to render. The id is already unique, so the fallback
 * cannot collide, and the URL stays a URL.
 */
export function pageSlug(title: string, id: string): string {
  const derived = slugify(title);
  if (derived.length > 0) return derived;
  // A uuid, never user text — `slice` is safe here in the one way the §13 rule
  // cares about, and the design-token hook's heuristic correctly cannot tell.
  return `page-${id.replace(/-/g, '').slice(0, 8)}`;
}

/* ------------------------------------------------------------------------- */
/* The sidebar tree                                                          */
/* ------------------------------------------------------------------------- */

/**
 * A page as the sidebar needs it — the row, without its body.
 *
 * Deliberately not the full row: a tree of a hundred pages is a hundred bodies
 * fetched to draw a list of links, which is the shape of cost §16 asks about
 * before it is visible.
 */
export type TreePage = {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  position: number;
};

export type TreeNode<T extends TreePage = TreePage> = {
  page: T;
  depth: number;
  children: TreeNode<T>[];
};

/**
 * The sidebar tree, built from a flat list in one pass.
 *
 * The query returns rows ordered by `(parent_id, position)`; this turns them
 * into the nesting §20.11 renders as "a nested list of links with
 * `aria-current`, not a custom widget".
 *
 * **A page whose parent is missing is promoted to a root rather than dropped.**
 * The parent may have been soft-deleted (§20.3.6 reparents children, but a
 * filtered query can still hand us an orphan), and a page that vanishes from
 * the sidebar because of somebody else's delete is a page whose author thinks
 * their work is gone. Showing it at the top is wrong about its place and right
 * about its existence, which is the better of the two errors.
 *
 * Cycles are impossible in the database — `depth` is maintained there and capped
 * — but a `seen` set costs one allocation and makes this function total for any
 * input, which matters because it also runs in the browser against whatever the
 * last response happened to contain.
 */
export function buildPageTree<T extends TreePage>(pages: readonly T[]): TreeNode<T>[] {
  const byId = new Map<string, T>(pages.map((page) => [page.id, page]));
  const children = new Map<string | null, T[]>();

  for (const page of pages) {
    // An orphan is a root, per the note above.
    const key = page.parentId !== null && byId.has(page.parentId) ? page.parentId : null;
    const bucket = children.get(key);
    if (bucket) bucket.push(page);
    else children.set(key, [page]);
  }

  for (const bucket of children.values()) bucket.sort(comparePages);

  const seen = new Set<string>();

  const build = (parentId: string | null, depth: number): TreeNode<T>[] =>
    (children.get(parentId) ?? []).flatMap((page) => {
      if (seen.has(page.id)) return [];
      seen.add(page.id);
      return [{ page, depth, children: depth >= MAX_PAGE_DEPTH ? [] : build(page.id, depth + 1) }];
    });

  return build(null, 1);
}

/**
 * Sibling order: `position`, then title, then id.
 *
 * The title tiebreak is what makes a freshly imported space — every row written
 * with `position` 0 — read alphabetically rather than in insertion order, and
 * the id tiebreak makes the sort total so two renders of one list cannot
 * disagree. `localeCompare` with no locale argument, because the caller's
 * locale is the reader's and a Khmer sidebar should sort in Khmer.
 */
function comparePages(a: TreePage, b: TreePage): number {
  if (a.position !== b.position) return a.position - b.position;
  const byTitle = a.title.localeCompare(b.title);
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
}

/**
 * Every page in a subtree, including its root.
 *
 * Used by the move guard — a page cannot be moved under its own descendant —
 * and by the depth check, which has to know how tall the subtree being moved is
 * before it can say whether it fits.
 */
export function subtreeIds<T extends TreePage>(pages: readonly T[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const bucket = children.get(page.parentId);
    if (bucket) bucket.push(page.id);
    else children.set(page.parentId, [page.id]);
  }

  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }

  return out;
}

/**
 * How tall the subtree rooted at a page is, counting the page itself as 1.
 *
 * The other half of the move check: moving a two-level subtree under a page at
 * depth 2 would put its leaves at depth 4, and §20.4 caps at 3. Answered from
 * the flat list rather than by a recursive query, because the caller already
 * has the space's pages in hand for the sidebar.
 */
export function subtreeHeight<T extends TreePage>(pages: readonly T[], rootId: string): number {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const depthOf = new Map<string, number>();

  const resolve = (id: string): number => {
    const cached = depthOf.get(id);
    if (cached !== undefined) return cached;
    // Guard against a malformed list before recursing into it.
    depthOf.set(id, 1);
    const page = byId.get(id);
    const parentId = page?.parentId ?? null;
    const depth = parentId !== null && byId.has(parentId) ? resolve(parentId) + 1 : 1;
    depthOf.set(id, depth);
    return depth;
  };

  const rootDepth = resolve(rootId);
  const ids = new Set(subtreeIds(pages, rootId));

  let height = 1;
  for (const id of ids) height = Math.max(height, resolve(id) - rootDepth + 1);
  return height;
}

/**
 * Whether a page may be moved under a proposed parent, and why not if not.
 *
 * Three refusals, and each is a different kind of wrong:
 *
 * - **Into itself or a descendant** — the move that detaches a subtree from the
 *   tree entirely. The database's `root_id`/`depth` trigger would refuse it too,
 *   but a cycle is the one shape whose refusal a person has to be told about in
 *   words, because from the sidebar it looks like an ordinary drag.
 * - **Past the depth cap** — checked against the *height* of what is being
 *   moved, not just the page, per `subtreeHeight` above.
 * - **Across spaces** — a page's space is what answers §20.5's permission
 *   question, so a move between them is a change of who may read it. §20.2 lists
 *   "move" among a page's operations and the space list is where a person picks
 *   the destination; this function answers the within-space question only, and
 *   the service asks §10 about both spaces for a cross-space move.
 */
export type MoveRefusal = 'into_descendant' | 'too_deep';

export function checkMove<T extends TreePage>(
  pages: readonly T[],
  pageId: string,
  parentId: string | null,
): MoveRefusal | null {
  if (parentId === null) return null;
  if (parentId === pageId) return 'into_descendant';

  if (subtreeIds(pages, pageId).includes(parentId)) return 'into_descendant';

  const byId = new Map(pages.map((page) => [page.id, page]));
  let depth = 1;
  let cursor = byId.get(parentId)?.parentId ?? null;
  const guard = new Set<string>([parentId]);
  while (cursor !== null && byId.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }

  return depth + subtreeHeight(pages, pageId) > MAX_PAGE_DEPTH ? 'too_deep' : null;
}

/**
 * Sibling positions rewritten as a block (§20.4).
 *
 * "Sidebar order is an integer `position` rewritten as a block, not a
 * fractional index. This is `workflow_state`'s call (slice 4), not the board's
 * (slice 6), and for the same reason: fractional ranking exists because several
 * people drag cards on one board at once, and a documentation sidebar reordered
 * by one person is not that. `rank.ts` stays a work-item concern."
 *
 * Takes the ids in their new order and returns every one of them with its new
 * position, so the write is one statement over a known set rather than a
 * read-modify-write per row.
 */
export function reorderPositions(orderedIds: readonly string[]): { id: string; position: number }[] {
  return orderedIds.map((id, index) => ({ id, position: index }));
}

/* ------------------------------------------------------------------------- */
/* Revision compare                                                          */
/* ------------------------------------------------------------------------- */

export type DiffOp = 'same' | 'added' | 'removed';

export type DiffLine = {
  op: DiffOp;
  text: string;
  /** 1-based line number in the older body, or null for an added line. */
  before: number | null;
  /** 1-based line number in the newer body, or null for a removed line. */
  after: number | null;
};

/**
 * A line-by-line comparison of two bodies (§20.2's "side-by-side compare").
 *
 * **Lines rather than words, and no third-party diff.** The same bargain
 * `sigv4.ts` makes against `@aws-sdk` and the burndown makes against a charting
 * library — with an argument specific to this one: a word-level diff of prose
 * in a script with no inter-word spaces is a diff of one enormous word (§13),
 * so the sophisticated version is the one that degrades in Khmer. A line is a
 * unit both scripts have, and `documents.ts` already made a newline meaningful
 * by treating it as a hard break, so a line here is a line the reader saw.
 *
 * The algorithm is the standard LCS over lines, computed on a matrix. It is
 * O(n·m) in time and space, which is why it is bounded below — a page at the
 * grapheme cap is a few thousand lines, and two of those would be a matrix of
 * tens of millions of cells built to render a screen nobody would read.
 * Over the bound the two versions are reported as wholly replaced, which is
 * both true and the only honest thing a compare can say about bodies that far
 * apart.
 */
export const MAX_DIFF_LINES = 3_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = normalizeDocument(before).split('\n');
  const b = normalizeDocument(after).split('\n');

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      ...a.map((text, index) => ({ op: 'removed' as const, text, before: index + 1, after: null })),
      ...b.map((text, index) => ({ op: 'added' as const, text, before: null, after: index + 1 })),
    ];
  }

  // lcs[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[];
      const next = lcs[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] as string, before: i + 1, after: j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    // Removals before additions at the same point, so a changed line reads as
    // the old one struck through above the new one rather than the other way
    // round — which is the order every review tool has trained people to expect.
    const down = (lcs[i + 1] as number[])[j] as number;
    const right = (lcs[i] as number[])[j + 1] as number;
    if (down >= right) {
      out.push({ op: 'removed', text: a[i] as string, before: i + 1, after: null });
      i += 1;
    } else {
      out.push({ op: 'added', text: b[j] as string, before: null, after: j + 1 });
      j += 1;
    }
  }

  while (i < a.length) {
    out.push({ op: 'removed', text: a[i] as string, before: i + 1, after: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ op: 'added', text: b[j] as string, before: null, after: j + 1 });
    j += 1;
  }

  return out;
}

/** How many lines a diff added and removed — the summary a revision row shows. */
export function diffSummary(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === 'added') added += 1;
    else if (line.op === 'removed') removed += 1;
  }
  return { added, removed };
}

/** §13: never `.length`, and never `.slice()` on text a person will read. */
export function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

/* ------------------------------------------------------------------------- */
/* The page icon (§21.2 — slice 20)                                          */
/* ------------------------------------------------------------------------- */

/**
 * One emoji, or nothing.
 *
 * **The grapheme is the unit, and that is the whole of this function.** A flag
 * is two code points, a skin-toned emoji three or four, and a profession emoji
 * with a zero-width joiner in it more still — all of which a person sees as one
 * character and types with one keystroke. `[...value].length` would refuse every
 * one of them while accepting four Latin letters, which is §13's arithmetic
 * pointed exactly the wrong way: the rule slice 10 wrote down when a length cap
 * gave a Khmer workspace a third of the field an English one got.
 *
 * **Truncates rather than refuses**, unlike every other cap in the wiki. A title
 * over its cap is a refusal because the writer's words are the point and
 * silently cutting them loses meaning; an icon is decoration, and somebody who
 * pastes "🎉🎉" meant the first one. Two graphemes is not a mistake worth a form
 * error and a round trip.
 *
 * Empty and whitespace-only both become `null`, which is how the picker's clear
 * button is expressed — there is no separate "remove" path, because *no icon* is
 * a value rather than the absence of one.
 *
 * In `src/lib` because both sides run it: the picker previews what will be
 * stored as somebody types, the service normalises the same input on submit.
 * One implementation, so the preview cannot promise an icon the save will crop.
 */
export function normalizePageIcon(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim().normalize('NFC');
  if (trimmed.length === 0) return null;

  const [first] = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)];
  const icon = first?.segment ?? '';

  // 0036's floor, restated where the value is produced rather than only where it
  // lands: a "grapheme" can in principle be an unbounded run of joined code
  // points, and the CHECK would refuse it — as a constraint violation on
  // somebody's save rather than as a quiet crop.
  return icon.length > 0 && icon.length <= 16 && !/\s/.test(icon) ? icon : null;
}

/* ------------------------------------------------------------------------- */
/* Ownership and verification (§21.3 — slice 19)                             */
/* ------------------------------------------------------------------------- */

/**
 * How long a verification lasts, chosen from a closed set (§21.3).
 *
 * "Never · 90 days · 180 days · 365 days. A date picker invites a company to
 * build a review calendar in a field, and §6's rule is that a company which
 * never opens a setting must be completely fine."
 *
 * **The set maps to messages in code and never reaches the database** — §13's
 * closed-enum rule, the same one `STATE_GROUPS`, `CYCLE_STATUSES` and
 * `DUE_WINDOWS` follow. What is stored is the *resolved date*, which is why
 * `verificationExpiry` below is the only place the number becomes one.
 *
 * `null` is *Never*, and it is a member of the set rather than the absence of a
 * choice — a page with no review cycle is the right answer for most pages, and
 * §21.3 requires it to stay the default.
 */
export const VERIFICATION_DAYS = [90, 180, 365] as const;
export type VerificationDays = (typeof VERIFICATION_DAYS)[number];

export function isVerificationDays(value: unknown): value is VerificationDays {
  return VERIFICATION_DAYS.includes(value as VerificationDays);
}

/**
 * How much warning a page gets before its verification lapses, in **working**
 * days (§21.3).
 *
 * Working rather than calendar, for the reason staleness is (§9): the number is
 * lead time to *act*, and nobody rewrites a policy on Sunday. Seven of them is
 * §21.13's "turn amber a week before it lapses" in the unit the product already
 * measures every other deadline in.
 *
 * The resolution happens in SQL — `working_days_ahead` in migration 0034, the
 * fifth member of §9's working-day family and built on `is_working_day` exactly
 * as `stale_before` is. **This constant is the `N`; the resolved date is a
 * fetch option**, which is the split slice 9 made for the digest's horizon and
 * slice 13 made for staleness, and for the same reason: "seven working days"
 * means the same thing next Tuesday and the date it resolves to does not.
 */
export const VERIFICATION_WARNING_DAYS = 7;

/**
 * How far ahead the All-pages view's *expiring* filter looks, in calendar days
 * (§21.3: "filterable to … *expiring within 30 days*").
 *
 * Calendar rather than working, and the contrast with the constant above is
 * deliberate: the badge is a warning aimed at the one person who has to act, so
 * it counts the days they could act on; this is a **filter somebody types into a
 * list** to plan a month's review work, and a month is a calendar month in every
 * head that has ever planned one.
 */
export const VERIFICATION_HORIZON_DAYS = 30;

/**
 * Where a page's verification stands (§21.3). Identifiers, never labels (§13).
 *
 *   `never`    — nobody has ever asserted this page is accurate. The state
 *                every page starts in, and not a fault: §21.3's `[E]` reads it
 *                as "nothing here has been reviewed yet".
 *   `verified` — asserted, and either has no review cycle or is comfortably
 *                inside one.
 *   `expiring` — asserted, with a review cycle that lapses within
 *                `VERIFICATION_WARNING_DAYS` working days. The amber one.
 *   `expired`  — the assertion has lapsed. The page is not *wrong*; nobody has
 *                said it is right recently enough, which is the honest claim
 *                and the only one the data supports.
 */
export const VERIFICATION_STATUSES = ['never', 'verified', 'expiring', 'expired'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The three columns every verification question reads.
 *
 * A structural type rather than the row type, so the page header can ask about
 * a verification the editor has not saved yet — the same reason `CyclePeriod`
 * is structural.
 */
export type PageVerification = {
  verifiedAt: Date | null;
  verificationExpiresAt: CalendarDate | null;
};

/**
 * **Derived from two columns and today, exactly as `cycleStatus` is** (§21.3).
 *
 * "A stored status needs a job to flip it, a repair after the job was down, and
 * a missed repair is a page that reads as verified forever. There is no such job
 * and there must not be one." That is slice 11's argument for a cycle and slice
 * 13's for availability, and it is stronger here than in either: a cycle that
 * reads as active a day late is a cosmetic error, and a page that reads as
 * verified for a year after it lapsed is the product vouching for a document
 * nobody has read.
 *
 * `today` is the **workspace's** (§17-13), never the viewer's device — the same
 * rule that decides what "overdue" means, applied to the same kind of shared
 * claim. Two people in two timezones must not disagree about whether the leave
 * policy is current.
 *
 * `warnFrom` is the resolved working-day horizon described on
 * `VERIFICATION_WARNING_DAYS`, and it is **optional**: with no horizon in hand a
 * page still reads as verified or expired correctly, and only the amber middle
 * collapses into `verified`. That matters because this function runs on both
 * sides, and a client that has not been handed a horizon should degrade to a
 * true statement rather than to a guess.
 */
export function verificationStatus(
  page: PageVerification,
  input: { today: CalendarDate; warnFrom?: CalendarDate | null },
): VerificationStatus {
  if (page.verifiedAt === null) return 'never';
  // No review cycle: verified is a standing fact until somebody edits the page,
  // which is the transition `saveWikiPage` performs rather than this function.
  if (page.verificationExpiresAt === null) return 'verified';

  // String comparison is date comparison for `YYYY-MM-DD`, which is the whole
  // reason every date in this product crosses a boundary in that shape.
  if (page.verificationExpiresAt < input.today) return 'expired';

  const warnFrom = input.warnFrom ?? null;
  if (warnFrom !== null && page.verificationExpiresAt <= warnFrom) return 'expiring';

  return 'verified';
}

/** Whether a status is one somebody is being asked to do something about. */
export function needsReview(status: VerificationStatus): boolean {
  return status === 'expiring' || status === 'expired';
}

/**
 * The date a verification made today would lapse on, or null for *Never*.
 *
 * **The one place the closed set becomes a stored value** (§21.3: "what is
 * stored is the resolved date"). Storing the *number* instead would make every
 * reader compute the date from a `verified_at` it also had to fetch, and the
 * first screen to forget the arithmetic would draw a badge that never expires.
 *
 * Calendar days, not working ones: a review cycle is "revisit this in six
 * months", which is a phrase about the calendar. The working-day arithmetic is
 * on the *warning*, which is about somebody's week.
 */
export function verificationExpiry(
  from: CalendarDate,
  days: VerificationDays | null,
): CalendarDate | null {
  return days === null ? null : addDays(from, days);
}

/* ------------------------------------------------------------------------- */
/* Templates, export and import (§21.7, §21.8 — slice 22)                    */
/* ------------------------------------------------------------------------- */

/**
 * The ceiling on one import upload.
 *
 * **In `src/lib` because both sides run it**, which is this directory's whole
 * rule: the panel names the limit before somebody spends a minute uploading, and
 * `importSpace` enforces it on the bytes. One number, so the sentence on screen
 * cannot promise something the server refuses.
 *
 * It sits *under* `next.config.ts`'s `serverActions.bodySizeLimit` on purpose —
 * see the comment there. The refusal a person meets has to be ours, with words
 * on it, rather than Next's 413.
 *
 * 5 MiB is a few thousand pages of Markdown. It is five times smaller than
 * slice 8's attachment cap because prose is not a photograph, and §2.5's market
 * is a phone where data costs money.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** How many files one import may carry. A folder, not a filesystem. */
export const MAX_IMPORT_FILES = 500;
