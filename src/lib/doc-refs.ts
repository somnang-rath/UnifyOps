/**
 * The three token formats a document body carries, and the one rule they share
 * (§20.7).
 *
 * "Three token formats live in a body and all three store ids. `@[<uuid>]` is
 * slice 8's mention token, unchanged and parsed by the same `src/lib/mentions.ts`.
 * `#[<uuid>]` is a page cross-reference. `ENG-142` in running text autolinks
 * through the parser slice 14 already wrote. All three resolve to a name at
 * render."
 *
 * That last sentence is the whole module. **A body stores an id and never a
 * name**, for the two reasons `activity.data` and comment mentions already
 * store ids: somebody who renames a page or changes their display name should
 * read correctly in a document written last March, and a name frozen into a row
 * is the one string a Khmer workspace could never fix (§13).
 *
 * In `src/lib` because both sides run it — the composer previews as you type,
 * the server renders the same body on read — which is the rule `mentions.ts`
 * and `work-item-query.ts` already follow.
 *
 * **Why this is a slice-17 module when pages arrive in slice 18.** §20.13 puts
 * 17 first precisely so the token formats are settled before there is a corpus
 * written in them: "getting the body format wrong is the expensive-to-reverse
 * decision here, in the way slice 5's list query was". A page token that is
 * defined now costs a regex; one retrofitted later costs a rewrite of every
 * body ever saved.
 */

import { mentionToken, parseMentionIds } from './mentions';

export { mentionToken, parseMentionIds };

/** A uuid, as it appears inside any of the delimited tokens. */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * `#[<page uuid>]` — a cross-reference to a wiki page.
 *
 * Delimited in exactly the shape `@[…]` already is, and that symmetry is worth
 * more than a prettier syntax: one parser shape, one escaping question, and a
 * person who has seen a mention token can read a page token without being told
 * what it is. A bare `#slug` was the alternative and is refused for the reason
 * a mention stores a member id — a slug is a name, it changes when somebody
 * renames the page, and the reference would rot silently.
 */
const PAGE_TOKEN = new RegExp(String.raw`#\[(${UUID})\]`, 'g');

/**
 * Renders a page id as the token that means it.
 *
 * Written in slice 17 and **first called in slice 18**, which is the one place
 * this module knowingly gets ahead of its callers. The reason is §20.13's:
 * "getting the body format wrong is the expensive-to-reverse decision here", so
 * the format is settled before there is a corpus written in it — and a
 * writer/parser pair defined together cannot disagree, where one added later
 * against existing rows can. The parser half is already load-bearing:
 * `PAGE_AT` runs on every body rendered.
 */
export function pageToken(pageId: string): string {
  return `#[${pageId.toLowerCase()}]`;
}

/**
 * Every page id a body references, de-duplicated, in the order they appear.
 *
 * De-duplicated for the reason `parseMentionIds` is: linking the same page
 * twice in one document is one reference, and slice 18's `wiki_page_link` rows
 * are a set rather than a bag.
 */
export function parsePageIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(PAGE_TOKEN)) {
    const id = match[1];
    if (id) ids.add(id.toLowerCase());
  }
  return [...ids];
}

/** The single-token matchers the inline parser tries at a given position. */
export const MENTION_AT = new RegExp(String.raw`^@\[(${UUID})\]`);
export const PAGE_AT = new RegExp(String.raw`^#\[(${UUID})\]`);

/* ------------------------------------------------------------------------- */
/* `ENG-142` in running text                                                 */
/* ------------------------------------------------------------------------- */

export type ItemRefHit = { start: number; end: number; key: string; number: number };

/**
 * Where a body mentions a work item by its identifier.
 *
 * **Only the separated form autolinks, and that is the one rule here that will
 * look arbitrary later.** `src/lib/search.ts` accepts `ENG142` as well as
 * `ENG-142` when somebody types into the palette, because a person typing an
 * identifier into a search box has said what they mean and the worst case is a
 * lookup that finds nothing. Running prose is the opposite case: `A4` is a
 * paper size, `COVID19` is a word, and a parser that turned either into a link
 * to a work item that may not exist would be wrong in the middle of somebody's
 * sentence with no way to say otherwise. The dash is what the product prints
 * and what anybody pastes, so requiring it costs nothing and removes the whole
 * class of false positives.
 *
 * Boundaries are checked on both sides so `foo-ENG-1` and `ENG-1x` are left
 * alone — a reference is a whole word or it is not a reference.
 *
 * Returns positions rather than nodes because the caller is the inline parser,
 * which has to interleave these with the text around them.
 */
const ITEM_REFERENCE = /([A-Za-z][A-Za-z0-9]{1,4})-(\d{1,9})/g;

export function scanItemReferences(text: string): ItemRefHit[] {
  const hits: ItemRefHit[] = [];

  for (const match of text.matchAll(ITEM_REFERENCE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    const before = start === 0 ? '' : (text[start - 1] as string);
    const after = end >= text.length ? '' : (text[end] as string);
    // A word character or a dash on either side means this is part of something
    // longer — a slug, a hyphenated word, a version string.
    if (before !== '' && /[\p{Letter}\p{Number}\-_]/u.test(before)) continue;
    if (after !== '' && /[\p{Letter}\p{Number}\-_]/u.test(after)) continue;

    const number = Number(match[2]);
    // Item numbers start at 1, exactly as `parseItemReference` requires: `ENG-0`
    // is a typo rather than a row, and linking it would promise a destination
    // that cannot exist.
    if (!Number.isSafeInteger(number) || number < 1) continue;

    hits.push({ start, end, key: (match[1] as string).toUpperCase(), number });
  }

  return hits;
}
