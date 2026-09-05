/**
 * Search: what a query *means*, on both sides of the wire (§7.9, §9, §13).
 *
 * §9 settles the mechanism in one line — "`tsvector('simple')` for Latin,
 * `pg_trgm` for Khmer — which has no inter-word spaces, so word-based FTS
 * fails — routed by script detection. `ENG-142` short-circuits" — and this
 * module is that sentence made executable. It emits no SQL; it decides which
 * *shape* of comparison the query wants and hands the builder a parameter.
 *
 * In `src/lib` for the reason `mentions.ts` and `recipients.ts` are: both sides
 * genuinely run it. The command palette decides in the browser whether what has
 * been typed is long enough to send and whether it looks like an item
 * identifier, so it can short-circuit without a round trip; the server decides
 * the same two things again about the same text before it queries. One
 * implementation, so the palette cannot promise a lookup the server will not do.
 *
 * The routing is a **property of the language, not a preference**. A Khmer
 * sentence has no inter-word spaces, so `to_tsvector` sees one enormous token
 * and the only query that can ever match it is that same whole string; a
 * trigram substring match is the one thing that finds a word inside it. Latin
 * goes the other way: a substring match on "cat" finds "communicate", where a
 * lexeme match does not. Neither route is the degraded one — see
 * `MIN_QUERY_LENGTH` for the one place that claim is actually tested.
 */

/**
 * The zero-width characters, and why they are stripped here rather than at write
 * time.
 *
 * §13: "U+200B zero-width spaces preserved in stored text, stripped before
 * indexing." Khmer text is routinely typed and pasted with zero-width spaces
 * marking line-break opportunities — they are invisible, they carry real
 * typographic intent, and destroying them on the way into the database would
 * change what somebody wrote. So the stored title keeps them, and both the index
 * expression and every query strip them: the only arrangement in which a search
 * for ភ្នំពេញ finds a title that happens to have a break opportunity in the
 * middle of it.
 *
 * The database side of this is the `search_text` generated column in migration
 * 0025. The two must apply the *same* transformation, which is why the set is
 * written down once here and the migration's comment points at it.
 */
export const ZERO_WIDTH = /[​‌‍﻿]/g;

/**
 * The floor, in graphemes, below which nothing is searched.
 *
 * **One floor for both routes, and that is a deliberate cost.** Below three
 * characters a `pg_trgm` GIN index cannot help a `LIKE '%ab%'` — there is no
 * whole trigram to look up — so a two-character Khmer query is a scan of the
 * work items in the projects the actor can see, bounded by RLS, by that
 * enumerated project set and by a hard `LIMIT`. Raising the floor to three for
 * the trigram route only would make a Khmer speaker type more before anything
 * happened than an English speaker does, which is precisely §13's "Khmer is
 * never the degraded path" — so the scan is accepted and the floors are equal.
 *
 * Graphemes rather than code points, for the reason every other length in this
 * product counts graphemes: one Khmer syllable is routinely three or four code
 * points, so a code-point floor of two would let a Khmer speaker search half a
 * letter while an English speaker types two whole ones.
 */
export const MIN_QUERY_LENGTH = 2;

/** The longest query the server will look at. A palette input, not a document. */
export const MAX_QUERY_LENGTH = 200;

/** Which comparison this text wants. §9's routing, as a value. */
export type SearchRoute = 'fulltext' | 'trigram';

/**
 * Khmer, including both blocks a real Khmer string uses: the main block
 * (U+1780–U+17FF — letters, the COENG stacker and the diacritics) and Khmer
 * Symbols (U+19E0–U+19FF, the lunar-date signs).
 */
const KHMER = /[ក-៿᧠-᧿]/;

export function hasKhmer(text: string): boolean {
  return KHMER.test(text);
}

/**
 * The route for a query — and **any** Khmer in it chooses trigram.
 *
 * Mixed script is the common case rather than the exotic one: a Khmer title with
 * a client's Latin name in it, or the reverse. The trigram route matches both
 * halves of such a query, because a substring is a substring in any script; the
 * full-text route would tokenise the Khmer half into one lexeme nobody will ever
 * type again. So the more general matcher wins wherever there is any doubt, and
 * the full-text route is the *optimisation* taken when a query is purely Latin
 * and word semantics are therefore available.
 */
export function searchRoute(text: string): SearchRoute {
  return hasKhmer(text) ? 'trigram' : 'fulltext';
}

/**
 * The query as the server should see it: zero-width characters gone, whitespace
 * collapsed, trimmed, capped.
 *
 * Not lowercased. Case folding is the database's job and it does it twice — the
 * `search_text` column is generated `lower(...)` and `to_tsvector` folds its own
 * lexemes — and folding here as well would make a third place that has to agree
 * about Turkish dotless i.
 *
 * The cap counts **graphemes**, like every other length in this product. Sliced
 * by code point it would give a Khmer speaker roughly a third of the query an
 * English speaker gets, and — worse for a search box — could cut a syllable in
 * half and send a lone COENG to the database, which matches nothing and looks
 * like a broken product rather than a truncated query.
 */
export function normalizeQuery(text: string): string {
  const collapsed = text.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
  return graphemes(collapsed).slice(0, MAX_QUERY_LENGTH).join('');
}

/** How many graphemes a query holds (§13: never `.length`). */
export function queryLength(text: string): number {
  return graphemes(text).length;
}

function graphemes(value: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    (segment) => segment.segment,
  );
}

/**
 * Is this worth sending? The palette asks before every keystroke's fetch, and
 * the server asks again about the same text before it queries.
 */
export function isSearchable(text: string): boolean {
  return queryLength(normalizeQuery(text)) >= MIN_QUERY_LENGTH;
}

/**
 * The `to_tsquery('simple', …)` input for a Latin query.
 *
 * Built here rather than by handing raw text to `plainto_tsquery`, for one
 * reason worth the code: **the last term gets `:*`**. A palette that only matches
 * whole words shows nothing until the word is finished, which is the difference
 * between a control that feels alive and one that feels broken — and §7.9 asks
 * for exactly that liveness ("previous results stay visible while typing").
 * `plainto_tsquery` cannot express a prefix.
 *
 * Every term is reduced to letters and digits before it is interpolated, so
 * nothing a person can type becomes tsquery syntax. That is belt to the
 * parameter's braces: the result is still bound as a parameter, so this is not
 * the boundary that stops injection — it is what stops a stray `!` or `<->`
 * turning a search for "bug !important" into a syntax error nobody can read.
 *
 * Terms are ANDed, because two words a person typed are two requirements. Null
 * when nothing survives: a query of pure punctuation is not a query.
 */
export function toTsQuery(text: string): string | null {
  const terms = normalizeQuery(text)
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((term) => term.length > 0);

  if (terms.length === 0) return null;

  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ');
}

/**
 * The `LIKE` pattern for a trigram query, against the lowercased `search_text`
 * column.
 *
 * `LIKE` and not `ILIKE`: the column is generated `lower(...)`, so folding the
 * pattern here makes the comparison case-insensitive without asking Postgres to
 * fold every row at query time — and it is the shape a `gin_trgm_ops` index on
 * that column can actually serve.
 *
 * The three `LIKE` metacharacters are escaped, which is not cosmetic: unescaped,
 * a search for `%` matches every item in the company and a search for `_`
 * matches every item with at least one character in it. Slice 10's custom-field
 * `has` operator learned this the same way — a client called "50% Co".
 */
export function toLikePattern(text: string): string {
  const escaped = normalizeQuery(text)
    .toLowerCase()
    .replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

/**
 * `ENG-142`, parsed — §7.9's short-circuit.
 *
 * "`ENG-142` short-circuits to that item", and §7.9 is emphatic about the one
 * property that makes it worth special-casing at all: a direct identifier lookup
 * "always resolves regardless of either" — archived project or not — because
 * "that is the entire reason identifiers are never reused". So this is not a
 * ranking hint. It is a different question, asked of a unique index, whose
 * answer is a destination rather than a result list.
 *
 * The separator is optional and may be any dash a phone keyboard or a paste from
 * a document produces, because somebody typing `eng142` into a palette means what
 * somebody pasting `ENG–142` means. The key is upper-cased into the alphabet
 * `normalizeProjectKey` guarantees, so a lookup and a stored key cannot disagree
 * about case.
 *
 * Null for anything that is not exactly one identifier: this must never fire on
 * a text query that merely contains a number, or the palette would teleport
 * somebody away from the results they were reading.
 */
export type ItemReference = { key: string; number: number };

/**
 * Two shapes, because dropping the separator costs a guarantee.
 *
 * A key is two to five characters and **may contain digits** after the first
 * (`normalizeProjectKey`'s alphabet, `KEY_MAX_LENGTH` of 5), so `ENG2142`
 * genuinely could be `ENG2-142` or `ENG-2142` and no rule can tell. With the
 * separator present the split is unambiguous and digits in the key are fine;
 * without it, the key half is restricted to letters so there is exactly one way
 * to read the string. A company whose key has a digit in it therefore has to
 * type the dash — which is what they paste anyway, since the dash is what the
 * product prints.
 */
const REFERENCE_SEPARATED = /^([A-Za-z][A-Za-z0-9]{1,4})[\s\-‐-―](\d{1,9})$/;
const REFERENCE_JOINED = /^([A-Za-z]{2,5})(\d{1,9})$/;

export function parseItemReference(text: string): ItemReference | null {
  const normalized = normalizeQuery(text);
  const match = REFERENCE_SEPARATED.exec(normalized) ?? REFERENCE_JOINED.exec(normalized);
  if (match === null) return null;

  const key = match[1] as string;
  const number = Number(match[2]);
  // Item numbers start at 1. `ENG-0` is a typo, not a row, and resolving it to
  // nothing beats a lookup that cannot succeed.
  if (!Number.isSafeInteger(number) || number < 1) return null;

  return { key: key.toUpperCase(), number };
}

/* ------------------------------------------------------------------------- */
/* The palette's sections                                                    */
/* ------------------------------------------------------------------------- */

/**
 * §7.9: "Results in sections: Work items · Projects · People · Actions", and
 * §20.3.5 adds two more — "Work items · **Pages** · **Notes** · Projects ·
 * People · Actions".
 *
 * A frozen ordered list rather than a set of fields, so the palette renders one
 * block per member and `messages.test.ts` can assert a heading exists for each —
 * the rule slice 13 wrote down after the `due` grouping shipped with no label.
 *
 * `notes` arrives in slice 17 and `pages` in slice 18, in that order because
 * §20.13 builds notes first. The order here is §20.3.5's reading order and not
 * the order the sections were built in: §20.3.5 lists "Work items · **Pages** ·
 * **Notes** · Projects · People · Actions", and a person's own note is closer to
 * what they were just doing than a project is.
 */
export const SEARCH_SECTIONS = ['items', 'pages', 'notes', 'projects', 'people', 'actions'] as const;
export type SearchSection = (typeof SEARCH_SECTIONS)[number];

/**
 * How many results a section shows in the palette.
 *
 * Small on purpose. A palette is a way to reach one thing, and §7.9 gives the
 * full list its own screen; fifty rows in a dropdown is a list view with worse
 * ergonomics. "See all results" is a link to that screen.
 */
export const PALETTE_SECTION_LIMIT = 5;

/**
 * The actions section — a closed set, and closed is the point.
 *
 * §7.9 names three ("assign to me", "switch language", "go to My Work") and the
 * rest are the destinations the shell already links to, which is what makes the
 * palette answer §2.4's "not knowing where something lives stops being a
 * problem". Every one of them either navigates or calls a server action that
 * already exists; none is a new capability, so none needs a §10 row — the eighth
 * time that decision has gone this way, after labels, attachments,
 * notifications, custom fields, cycles, saved views and availability.
 *
 * `contextual` marks the ones that need something only the current screen knows.
 * `assignToMe` is the only one, and it is offered exactly when a work item is on
 * screen: a palette that lists an action it cannot perform teaches people to
 * distrust the palette.
 */
export const PALETTE_ACTIONS = [
  'goMyWork',
  'goInbox',
  'goTeam',
  'goProjects',
  'goNotes',
  'goWiki',
  'goSearch',
  /**
   * §20.3.1's capture, and the one action in this list that is not a navigation
   * or a call to something that already exists.
   *
   * It is here rather than on a screen because the target is five seconds from
   * anywhere — "`⌘K` → *New note* → type → `⌘Enter` saves and closes" — and a
   * capture that requires first navigating to the notes screen is a capture
   * nobody uses while they are in the middle of something else, which is the
   * only time anybody needs one.
   *
   * Deliberately **not** contextual. `assignToMe` is offered only when an item
   * is on screen because it cannot act otherwise; a note can be written from
   * anywhere, and the pin an item's presence makes possible is an *addition* to
   * the capture rather than a condition on it (§20.3.1's `[!]`).
   */
  'newNote',
  'newProject',
  'assignToMe',
  'switchLanguage',
  'toggleTheme',
] as const;
export type PaletteAction = (typeof PALETTE_ACTIONS)[number];

export const CONTEXTUAL_ACTIONS: readonly PaletteAction[] = ['assignToMe'];

export function isContextual(action: PaletteAction): boolean {
  return CONTEXTUAL_ACTIONS.includes(action);
}

/**
 * Which actions this screen can offer, in catalogue order.
 *
 * Filtering rather than disabling, for the reason slice 10's settings screen
 * omits the field-kind control rather than greying it out: a disabled row
 * invites somebody to go looking for the permission that would enable it, and
 * there is no permission here — only a page that does or does not have an item
 * on it.
 */
export function availableActions(options: { hasCurrentItem: boolean }): PaletteAction[] {
  return PALETTE_ACTIONS.filter((action) => !isContextual(action) || options.hasCurrentItem);
}

/**
 * Does this action's label match what has been typed?
 *
 * Actions are matched **in the browser against their translated labels**, which
 * is the one search in the product that does not go to the database — and has to
 * be, twice over. The labels live in the message catalogues, so only the client
 * knows what "switch language" is called in Khmer; and an action list of nine
 * entries filtered on the server would put a round trip in front of the fastest
 * result the palette has.
 *
 * Substring on a folded string rather than a fuzzy match: a fuzzy matcher over
 * nine rows is a dependency and a ranking to explain, and it cannot be made to
 * behave the same way in a script with no inter-word spaces.
 */
export function actionMatches(label: string, text: string): boolean {
  const needle = normalizeQuery(text).toLowerCase();
  if (needle.length === 0) return true;
  return normalizeQuery(label).toLowerCase().includes(needle);
}
