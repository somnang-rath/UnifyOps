/**
 * The mention token, and the three things both sides do with it (§7.7).
 *
 * In `lib` for the reason `recipients.ts` and `slug.ts` are: the composer runs
 * this in the browser to preview chips and to drive the `@` picker as somebody
 * types, and the server runs the *same* parse on submit to decide who was
 * mentioned. One implementation, so the chips a person sees before posting
 * cannot promise a notification the server will not send.
 *
 * **A mention stores a member id, never a name.** This is the same rule the
 * activity feed's `data` follows and it is load-bearing for the same two
 * reasons: a person who changes their display name should read under the new
 * one in a comment written last March, and a name frozen into the body would be
 * the one string in the product that a Khmer workspace could never translate or
 * correct (§13). The body is stored with tokens in it and the names are
 * resolved at render.
 */

/**
 * `@[<member uuid>]`.
 *
 * Delimited rather than bare so the parser never has to guess where an id ends,
 * and so ordinary prose containing an email address or a price is not a
 * mention. A person who types the token by hand has written a mention, which is
 * the honest reading of what they typed.
 */
const TOKEN = /@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g;

/** One piece of a comment body, in reading order. */
export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; memberId: string };

/**
 * Every member id the body mentions, de-duplicated, in the order they appear.
 *
 * De-duplicated because mentioning somebody twice in one comment is one
 * mention: it writes one row, and slice 9 owes them one notification rather
 * than two.
 */
export function parseMentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(TOKEN)) {
    const id = match[1];
    if (id) ids.add(id.toLowerCase());
  }
  return [...ids];
}

/**
 * The body split into text and mentions, for the renderer.
 *
 * Returns segments rather than HTML because the renderer is a React component
 * and the alternative — building a string and injecting it — is how a comment
 * box becomes an XSS hole. Nothing here escapes anything; nothing here needs
 * to, because no consumer ever concatenates these into markup.
 */
export function splitMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let index = 0;

  for (const match of body.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > index) segments.push({ kind: 'text', text: body.slice(index, start) });
    segments.push({ kind: 'mention', memberId: (match[1] ?? '').toLowerCase() });
    index = start + match[0].length;
  }

  if (index < body.length) segments.push({ kind: 'text', text: body.slice(index) });
  return segments;
}

/** Renders a member id as the token that means them. */
export function mentionToken(memberId: string): string {
  return `@[${memberId.toLowerCase()}]`;
}

/**
 * The `@…` the caret is currently sitting in, or null.
 *
 * What opens the picker, and what it filters by. Three rules, each of which is
 * a bug if it is missing:
 *
 *   * The `@` must start a word — otherwise every email address in a comment
 *     opens a member picker halfway through typing it.
 *   * The query stops at whitespace, so a finished sentence does not keep the
 *     picker open over the rest of the paragraph.
 *   * It stops at `]` too, so the caret sitting just after an already-inserted
 *     token does not reopen the picker on the token it just wrote.
 *
 * **The whitespace rule reads differently in Khmer**, which does not put spaces
 * between words: a query there runs to the end of what has been typed rather
 * than to the end of one word. That is correct for the picker — matching is by
 * prefix against a member's name, and a longer prefix simply matches less —
 * but it is why the query is matched against the name rather than tokenised.
 */
export function activeMentionQuery(
  body: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = body.slice(0, caret);

  let at = -1;
  for (let i = upto.length - 1; i >= 0; i -= 1) {
    const char = upto[i] as string;
    if (char === '@') {
      at = i;
      break;
    }
    // Whitespace or a closing bracket ends the candidate before an `@` is
    // found, which means the caret is not inside a mention at all.
    if (/\s/.test(char) || char === ']') return null;
  }

  if (at === -1) return null;

  // `a@b` is an address, not a mention. Only a word boundary opens one.
  const preceding = at === 0 ? '' : (upto[at - 1] as string);
  if (preceding !== '' && !/\s/.test(preceding)) return null;

  return { query: upto.slice(at + 1), start: at };
}

/**
 * The body with the active `@…` replaced by a mention token, and where the
 * caret should land afterwards.
 *
 * The trailing space is deliberate: without it the caret sits immediately after
 * `]` and the next character typed reads as part of the mention to a human even
 * though it is not, which is the small wrongness that makes a composer feel
 * broken.
 */
export function applyMention(
  body: string,
  caret: number,
  memberId: string,
): { body: string; caret: number } {
  const active = activeMentionQuery(body, caret);
  const start = active ? active.start : caret;
  const inserted = `${mentionToken(memberId)} `;

  return {
    body: `${body.slice(0, start)}${inserted}${body.slice(caret)}`,
    caret: start + inserted.length,
  };
}

/**
 * The stored form of what somebody typed.
 *
 * NFC because Khmer is composed text and two byte sequences that render
 * identically must compare and index identically — the same normalisation every
 * other user-supplied string in the product gets before it is stored.
 */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim().normalize('NFC');
}
