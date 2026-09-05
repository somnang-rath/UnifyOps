import { documentLength, documentText, normalizeDocument } from './documents';

/**
 * A note, as pure data (§20.1, §20.3.1 — slice 17).
 *
 * **A note is one person's thinking; a page is the company's record.** §20.1
 * makes that the governing rule of the whole feature and refuses to merge the
 * two nouns, and everything in this module is the private half of it. In
 * `src/lib` because both sides run it: the composer derives a title as somebody
 * types so the list can show it before the save lands, and the server derives
 * the same title from the same body when it renders the row. One
 * implementation, so the title a person sees while typing is the title they get.
 *
 * **There is no stored title unless somebody sets one** (§20.3.1, §20.4). The
 * display title is the first line, derived. A stored copy of a string the body
 * already holds is a second source of truth for one string, and the two
 * disagree the first time somebody edits their opening line — which, for a note
 * whose whole purpose is to be captured in five seconds and found later, is the
 * one thing that must not happen.
 */

/**
 * The longest a note may be, in graphemes.
 *
 * Counted by grapheme rather than by code point, which is slice 10's rule
 * pointed the same way: `[...text].length` gives a Khmer workspace roughly a
 * third of the field an English one gets, silently, and refuses text that fits
 * — one Khmer syllable is routinely three or four code points (§13).
 *
 * Generous rather than tight, because §20.3.1's `[X]` is emphatic that a failed
 * save keeps the text: a cap somebody can hit by pasting a meeting's worth of
 * notes is a cap that turns "captured in five seconds" into "refused after
 * twenty". Long enough for anything anybody types in one sitting; short enough
 * that a body is still a row rather than a document.
 */
export const MAX_NOTE_LENGTH = 20_000;

/** A title, when somebody sets one rather than letting the first line be it. */
export const MAX_NOTE_TITLE_LENGTH = 120;

/**
 * How much of the first line becomes the display title.
 *
 * Truncated by grapheme with an ellipsis, for the reason every other truncation
 * in this product counts graphemes (§13): slicing by code point cuts a Khmer
 * syllable in half and leaves a lone COENG on screen, which reads as a broken
 * product rather than as a shortened line.
 */
export const NOTE_TITLE_PREVIEW_LENGTH = 80;

export type NoteProblem = 'body_required' | 'body_too_long' | 'title_too_long';

/**
 * The rules a note has to satisfy, in the one place both sides call.
 *
 * Returns the problem rather than throwing, and the problem is an identifier
 * rather than a sentence — §13's rule that "every failure crosses the wire as a
 * message key, never a sentence", because an English string returned from a
 * server action is the one place Khmer silently degrades.
 */
export function validateNote(input: { title: string | null; body: string }): NoteProblem | null {
  const body = normalizeDocument(input.body);
  // §20.3.1 gives a note no title field and no folder, so the body is the whole
  // of what a note is. An empty one is not a note somebody wrote; it is a
  // composer somebody opened and left.
  if (body.length === 0) return 'body_required';
  if (documentLength(body) > MAX_NOTE_LENGTH) return 'body_too_long';

  const title = normalizeNoteTitle(input.title);
  if (title !== null && graphemeLength(title) > MAX_NOTE_TITLE_LENGTH) return 'title_too_long';

  return null;
}

/**
 * A set title, normalised — or null, which is the ordinary case.
 *
 * Null and empty are the same fact and are stored as the same value, because
 * "the title is the empty string" and "there is no title" would be two rows
 * that render identically and sort differently.
 */
export function normalizeNoteTitle(title: string | null | undefined): string | null {
  if (title === null || title === undefined) return null;
  const trimmed = title.replace(/\s+/g, ' ').trim().normalize('NFC');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * What a note is called on screen.
 *
 * A set title wins; otherwise the first line of the body, with its Markdown
 * **read** rather than stripped — the line goes through the parser, so a note
 * beginning `# Standup` is called "Standup" and one beginning `` `git rebase` ``
 * is called "git rebase" rather than carrying its own syntax into the list. A
 * regular expression over the raw text was the alternative and would disagree
 * with the reader the first time somebody wrote a `#` they meant.
 *
 * Only the first line is parsed, not the whole body: a list of fifty notes
 * would otherwise be fifty full parses per render, which is the shape of cost
 * §16 asks about before it is visible.
 */
export function noteTitle(note: { title: string | null; body: string }): string {
  const set = normalizeNoteTitle(note.title);
  if (set !== null) return truncateGraphemes(set, NOTE_TITLE_PREVIEW_LENGTH);

  const first = firstLine(note.body);
  return first.length === 0 ? '' : truncateGraphemes(first, NOTE_TITLE_PREVIEW_LENGTH);
}

/**
 * The rest of the note, for the second line of a list row.
 *
 * The body with its first line removed, flattened to one line so a row's height
 * cannot depend on what somebody typed. Empty when the note is one line long,
 * which is what most notes are — and a row that then shows only a title is the
 * correct rendering of a note that is only a title.
 */
export function notePreview(note: { title: string | null; body: string }): string {
  const body = normalizeDocument(note.body);
  const lines = body.split('\n');
  // With a set title the whole body is preview; without one the first line has
  // already been spent on the title.
  const rest =
    normalizeNoteTitle(note.title) === null ? lines.slice(indexOfFirstLine(lines) + 1) : lines;
  // Joined with newlines so the parser still sees blocks — a second line that
  // starts a list has its bullet read rather than printed — then flattened, so
  // a row's height cannot depend on what somebody typed.
  return documentText(rest.join('\n'))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(body: string): string {
  const lines = normalizeDocument(body).split('\n');
  const index = indexOfFirstLine(lines);
  return index === -1 ? '' : documentText(lines[index] as string).trim();
}

function indexOfFirstLine(lines: readonly string[]): number {
  return lines.findIndex((line) => line.trim().length > 0);
}

/** §13: never `.length`, and never `.slice()` on text a person will read. */
export function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

function truncateGraphemes(value: string, limit: number): string {
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    (segment) => segment.segment,
  );
  if (segments.length <= limit) return value;
  // The ellipsis is a character, not three dots: three dots wrap, and a wrapped
  // ellipsis in a one-line row is the thing that makes a list look broken.
  return `${segments.slice(0, limit).join('').trimEnd()}…`;
}
