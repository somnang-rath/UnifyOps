/**
 * The editor's `/` menu and its formatting shortcuts (§21.5 — slice 20).
 *
 * **The rule this whole module is written against is one sentence**, and §21.15
 * puts it in the code review rather than in a test: *a menu item may only insert
 * text a person could have typed.* "The day one of them cannot, block identity
 * has arrived by the back door" — and block identity is the thing §21.5 refuses
 * at length, because storing it means "the body is no longer the thing a human
 * can read, export and diff".
 *
 * So every entry below is a string of Markdown and a caret position. There is no
 * node, no id, no placeholder object, and nothing that would survive a round
 * trip through a plain text editor differently from how it arrived. What the
 * menu buys is discoverability — §21.5's "the felt experience of a block menu
 * with none of the storage consequences" — and it buys it at the cost of one
 * pure function per gesture.
 *
 * **Pure, and in `src/lib`, because the DOM half is untestable.** This is
 * `shortcuts.ts`'s shape from slice 14: a function over a string and a caret,
 * asserted directly, with the textarea left to the component. A selection API is
 * the one part of an editor that cannot be tested without a browser, so the part
 * that decides *what the text becomes* is kept out of it.
 */

/* ------------------------------------------------------------------------- */
/* The `/` menu                                                              */
/* ------------------------------------------------------------------------- */

/**
 * What the menu can insert.
 *
 * The ids are message keys (`editor.insert.<id>`), so the labels are translated
 * and no English string reaches this module — the rule every closed enum in this
 * product follows (§13). `messages.test.ts` requires a label for every member,
 * which is the gate slice 13 wrote after the `due` grouping shipped with no
 * string and slice 14 restated for `SHORTCUTS` and `PALETTE_ACTIONS`.
 */
export const INSERTIONS = [
  'heading',
  'bulletList',
  'numberedList',
  'todo',
  'quote',
  'callout',
  'toggle',
  'code',
  'table',
  'divider',
] as const;

export type InsertionId = (typeof INSERTIONS)[number];

export type Insertion = {
  id: InsertionId;
  /**
   * The Markdown itself.
   *
   * A block entry opens on its own line, and `applyInsertion` is what guarantees
   * that rather than each string carrying a leading newline — the text here is
   * what the writer would have typed once their caret was in the right place.
   */
  text: string;
  /**
   * Where the caret lands, as an offset into `text`.
   *
   * Almost always the end, which is what makes an insertion feel like typing.
   * The table is the exception: it lands in the first header cell, because a
   * table whose caret sits after the last row asks the writer to navigate back
   * into a grid they did not build.
   */
  caret: number;
};

const FENCE = '```';
const TABLE = ['| | |', '| --- | --- |', '| | |'].join('\n');

const TEXT: Record<InsertionId, { text: string; caret?: number }> = {
  heading: { text: '## ' },
  bulletList: { text: '- ' },
  numberedList: { text: '1. ' },
  todo: { text: '- [ ] ' },
  quote: { text: '> ' },
  // The tone is part of the syntax and `info` is the one that says "read this"
  // without claiming anything is wrong. A writer changes the word; the menu does
  // not need four entries to offer four tones.
  callout: { text: '> [!info] ' },
  toggle: { text: '> [!info]- ' },
  // An open fence *with* a closing one, because a fence somebody has to remember
  // to close is the one insertion that leaves the rest of the document inside
  // it. The caret goes on the empty line between the two.
  code: { text: `${FENCE}\n\n${FENCE}`, caret: FENCE.length + 1 },
  // Two characters into the first header cell: `| ` is where the words go.
  table: { text: TABLE, caret: 2 },
  divider: { text: '---\n' },
};

export function insertionFor(id: InsertionId): Insertion {
  const entry = TEXT[id];
  return { id, text: entry.text, caret: entry.caret ?? entry.text.length };
}

/**
 * The `/…` the caret is currently inside, or nothing.
 *
 * `activeMentionQuery`'s shape, deliberately — one contract for "the token being
 * typed at the caret", so the two pickers in this product behave identically and
 * a reader of one can read the other.
 *
 * **A slash only opens the menu at the start of a line.** That is the difference
 * from `@`, which opens on any word boundary, and it is the whole of what stops
 * this feature ruining ordinary writing: `and/or`, a date, a fraction and a URL
 * all contain slashes mid-line, and a menu that appeared inside them would be
 * §21.5's promise of "the felt experience of a block menu" delivered as an
 * interruption. Every entry inserts a *block*, so the start of a line is also
 * the only place any of them would be correct.
 */
export function activeInsertQuery(
  body: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = body.slice(0, caret);
  const lineStart = upto.lastIndexOf('\n') + 1;

  if (upto[lineStart] !== '/') return null;

  const query = upto.slice(lineStart + 1);
  // Whitespace closes it: `/ ` is somebody who typed a slash and moved on, and a
  // menu that stayed open across a space would swallow the next word's Enter.
  if (/\s/.test(query)) return null;

  return { query, start: lineStart };
}

/** Which entries a typed `/query` still matches, in menu order. */
export function matchInsertions(
  query: string,
  labels: Record<InsertionId, string>,
): InsertionId[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...INSERTIONS];

  return INSERTIONS.filter(
    (id) =>
      // The id is matched as well as the label so `/todo` works in a Khmer
      // workspace, where the label is Khmer and the writer may still be typing
      // the English word they saw in a colleague's screenshot. Matching only the
      // label would make the menu unusable to anybody typing the other language.
      id.toLowerCase().includes(needle) || labels[id].toLowerCase().includes(needle),
  );
}

/**
 * The body with the active `/…` replaced by the entry's Markdown, and where the
 * caret should land afterwards.
 *
 * The insertion replaces the typed `/query` exactly — nothing else on the line is
 * touched, because the menu only opens when the slash is the line's first
 * character and everything after the caret is text the writer put there.
 */
export function applyInsertion(
  body: string,
  caret: number,
  id: InsertionId,
): { body: string; caret: number } {
  const active = activeInsertQuery(body, caret);
  const insertion = insertionFor(id);

  const start = active ? active.start : caret;
  const before = body.slice(0, start);
  const after = body.slice(caret);

  /**
   * A block needs a line of its own, unless it is already at the start of one.
   *
   * Without this the menu writes a heading onto the end of the paragraph above
   * it — the parser is line-oriented, so `Some text## Heading` is one paragraph
   * and the writer watches their heading fail to appear. This is the one place
   * the module adds a character nobody typed, and it adds the character a person
   * would have typed themselves.
   */
  const separator = before.length === 0 || before.endsWith('\n') ? '' : '\n';

  return {
    body: `${before}${separator}${insertion.text}${after}`,
    caret: start + separator.length + insertion.caret,
  };
}

/* ------------------------------------------------------------------------- */
/* Formatting shortcuts                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Wrap the selection in a marker, or unwrap it if it is already wrapped.
 *
 * **Toggling rather than only wrapping**, because a shortcut that can only add is
 * one people press once by accident and then undo by hand. `⌘B` on already-bold
 * text is how anybody expects to un-bold it.
 *
 * With nothing selected it inserts the pair and puts the caret between them,
 * which is what makes `⌘B` usable *before* typing the words rather than only
 * after.
 */
export function wrapSelection(
  body: string,
  start: number,
  end: number,
  marker: string,
): { body: string; start: number; end: number } {
  const selected = body.slice(start, end);

  // Already wrapped *inside* the selection — `**bold**` selected whole.
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return {
      body: body.slice(0, start) + inner + body.slice(end),
      start,
      end: start + inner.length,
    };
  }

  // Already wrapped *outside* it — the writer selected `bold` within `**bold**`.
  const outerStart = start - marker.length;
  if (
    outerStart >= 0 &&
    body.slice(outerStart, start) === marker &&
    body.slice(end, end + marker.length) === marker
  ) {
    return {
      body: body.slice(0, outerStart) + selected + body.slice(end + marker.length),
      start: outerStart,
      end: outerStart + selected.length,
    };
  }

  return {
    body: `${body.slice(0, start)}${marker}${selected}${marker}${body.slice(end)}`,
    start: start + marker.length,
    end: end + marker.length,
  };
}

/**
 * `⌘K` — turn the selection into a link, and leave the caret where the URL goes.
 *
 * The selection becomes the link's *text* and the caret lands in the empty
 * parentheses, because that is the half the writer does not have yet: they
 * selected the words precisely so they would not have to retype them. With
 * nothing selected it writes an empty pair and the caret goes to the text half,
 * which is the other order and the right one — there is nothing to keep.
 */
export function applyLink(
  body: string,
  start: number,
  end: number,
): { body: string; start: number; end: number } {
  const selected = body.slice(start, end);
  const inserted = `[${selected}]()`;
  const next = body.slice(0, start) + inserted + body.slice(end);

  // `[` + text + `](` is `selected.length + 3`; with no selection the caret goes
  // just inside the brackets instead.
  const caret = selected.length === 0 ? start + 1 : start + selected.length + 3;
  return { body: next, start: caret, end: caret };
}
