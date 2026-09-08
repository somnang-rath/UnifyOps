import { documentText } from '@/lib/documents';
import { MENTION_AT, PAGE_AT } from '@/lib/doc-refs';
import { normalizePageTitle } from '@/lib/wiki';

/**
 * The file format an export writes and an import reads (§21.8 — slice 22).
 *
 * **The whole argument for this feature is one sentence, and it is a sales
 * argument rather than a technical one**: §18-7's pilot customer will ask, in
 * some form, what happens to their handbook if they leave, and *"a folder of
 * Markdown files you can open in any editor"* is a better answer than any
 * feature in §21. A product that is easy to leave is easier to adopt.
 *
 * That sets the standard this module is held to, which is higher than "the
 * bytes round-trip": the files have to be **readable by a person who has never
 * heard of this product**, in a plain text editor, in either script (§21.14's
 * check 4). Everything below follows from that.
 *
 * Pure, and in `src/server` rather than `src/lib` because nothing on the client
 * writes an archive — the placement `sigv4.ts` has, and with no
 * `import 'server-only'` for the same reason: it touches no connection.
 */

/* ------------------------------------------------------------------------- */
/* Front matter                                                              */
/* ------------------------------------------------------------------------- */

/**
 * The keys a page file carries, and the reason the set is closed.
 *
 * §21.8 asks for "a small YAML front-matter block carrying title, owner,
 * verification state and last edited". Two more are here because without them
 * the round trip §21.13 makes this slice's definition of done is not a round
 * trip: `icon` is a page's own property, and `template` is the flag that decides
 * whether an imported file becomes a template or an ordinary page.
 *
 * **`owner` is a name, not an id**, and that is the same decision the body
 * tokens make below. An id is meaningless in a folder somebody opened on their
 * own laptop, and it is meaningless again on import into a different workspace
 * where that member does not exist. What survives is what a person can read and
 * act on: a name they can re-assign in one click.
 */
export type PageFrontMatter = {
  title: string;
  icon?: string | null;
  owner?: string | null;
  verification?: string;
  verified_by?: string | null;
  verified_at?: string | null;
  verification_expires_at?: string | null;
  updated_at?: string;
  template?: boolean;
};

const FENCE = '---';

/**
 * Render a front-matter block.
 *
 * **Every string value is quoted, always**, rather than quoted only when YAML
 * would otherwise misread it. The conditional version needs a list of the cases
 * that force quoting — a leading `#`, a leading `-`, a trailing colon, `yes`,
 * `no`, `on`, `off`, `null`, `~`, anything that looks like a number or a date —
 * and the first one anybody forgets produces a file that parses to the wrong
 * value rather than to an error. A title of `No` is a real title.
 *
 * Booleans are unquoted, because they are the one type here that a reader is
 * meant to read as a type.
 *
 * Null and undefined values are **omitted rather than written as `null`**: a
 * page with no owner should read as a page with no owner line, not as one whose
 * owner is the word null.
 */
export function renderFrontMatter(fields: PageFrontMatter): string {
  const lines: string[] = [FENCE];

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`);
      continue;
    }
    lines.push(`${key}: ${quote(String(value))}`);
  }

  lines.push(FENCE, '');
  return lines.join('\n');
}

function quote(value: string): string {
  // Backslash first, or the escape added for a quote would itself be escaped.
  // Newlines cannot appear in any value this module writes — a title is
  // normalized to one line — so they are folded rather than given a block
  // scalar, which would be a second syntax for a case that does not arise.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
  return `"${escaped}"`;
}

/**
 * Split a file into its front matter and its body.
 *
 * **A file with no front matter is not an error**, and that is the whole reason
 * this is tolerant rather than strict: §21.8 says import "takes Markdown", which
 * is "also the interoperability path *from* the survey's own product" — and a
 * folder of Markdown exported from somewhere else has whatever front matter that
 * product chose, or none. Unknown keys are dropped, a missing block leaves the
 * whole file as the body, and neither case reports a problem.
 *
 * The parser is deliberately a flat `key: value` reader and not YAML. Nested
 * maps, lists, anchors and block scalars are all things a *general* YAML parser
 * has to support and a front-matter reader does not: this module writes a flat
 * map of scalars, and anything richer arriving from elsewhere is dropped rather
 * than half-understood. Writing a YAML subset is the same call `documents.ts`
 * makes against a Markdown library, and for the sharper reason — a full YAML
 * parser is a well-known source of surprising evaluation.
 */
export function parseFrontMatter(text: string): {
  fields: Record<string, string>;
  body: string;
} {
  // A byte-order mark survives a trip through Windows Notepad and would
  // otherwise make the first fence unrecognisable, which reads as "the importer
  // ignored my front matter" with nothing to see in the file.
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!source.startsWith(`${FENCE}\n`)) return { fields: {}, body: source };

  const end = source.indexOf(`\n${FENCE}`, FENCE.length);
  if (end < 0) return { fields: {}, body: source };

  /*
    Offsets into a file's own syntax, not into anybody's text — the fences are
    three ASCII hyphens and the split is between them. §13's grapheme rule is
    about *truncating* user text, and nothing here truncates anything; the title
    inside the block is carried whole. The design-token hook's slicing heuristic
    correctly cannot tell the difference, which `pageSlug` already records.
  */
  const block = source.slice(FENCE.length + 1, end);
  const rest = source.slice(end + 1 + FENCE.length).replace(/^[^\n]*\n?/, '');

  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    fields[key] = unquote(line.slice(separator + 1).trim());
  }

  return { fields, body: rest };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* Paths                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Where a page's file goes, given its slug and its ancestors' slugs.
 *
 * **A page with children is a file *and* a folder beside it** — `handbook.md`
 * next to `handbook/`, rather than `handbook/index.md`. Both conventions exist;
 * this one is chosen because it has no ambiguity to resolve on the way back in.
 * With `index.md` an importer has to decide what a folder containing an
 * `index.md` *and* a page actually called "index" means, and every answer is a
 * rule somebody has to be told. Here a file is a page and a folder is only ever
 * that page's children.
 *
 * Slugs are `[a-z0-9-]` by construction (`slugify`), so no escaping is needed
 * and no title — Khmer or otherwise — can produce a path a filesystem refuses.
 * That is worth stating because it is the property that makes this safe: the
 * *title* is carried in the front matter, where it can be anything.
 */
export function pagePath(slugs: readonly string[]): string {
  return `${slugs.join('/')}.md`;
}

/**
 * A link from one exported file to another, as a relative path.
 *
 * Relative rather than rooted, because the folder somebody unzips has no root:
 * `/handbook.md` means the top of their disk. This is the same reasoning
 * `local-fs.ts` recorded when it made attachment URLs relative — "neither the
 * app's configured base URL nor `request.url` is a reliable origin. A relative
 * URL does not have to be right about one."
 */
export function relativeLink(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  const file = toParts.pop() as string;

  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }

  const up = fromParts.length - shared;
  const segments = [...Array.from({ length: up }, () => '..'), ...toParts.slice(shared), file];
  // A sibling needs a `./` so the link is unambiguously a path rather than
  // something a reader might take for a bare word.
  return up === 0 && toParts.length === shared ? `./${segments.join('/')}` : segments.join('/');
}

/* ------------------------------------------------------------------------- */
/* Tokens, on the way out                                                    */
/* ------------------------------------------------------------------------- */

export type ExportTarget = {
  title: string;
  /** The path of the file this reference points at, or null when it is not in this export. */
  path: string | null;
};

export type TokenContext = {
  /** Member id to display name. */
  members: Record<string, string>;
  /** Page id to what the reference should become. */
  pages: Record<string, ExportTarget>;
  /** The path of the file being written, so links can be made relative to it. */
  from: string;
};

/**
 * Resolve a body's id tokens to text (§21.8).
 *
 * "Tokens resolve to text on the way out — `@[uuid]` becomes the person's name,
 * `#[uuid]` becomes a relative link — because **an id nothing can resolve is not
 * portability**."
 *
 * **The rule this follows is one sentence: the export says what the screen
 * says.** Every fallback below is `document-body.tsx`'s own, transposed from
 * elements to text — an unknown mention is a bare `@` there and here, an
 * unresolved reference is an em dash there and here, and a reference to a
 * deleted page is its title unlinked in both. Inventing kinder fallbacks for the
 * file would make the export disagree with the product about what a document
 * contains, which is the one thing an export must never do.
 *
 * `ENG-142` is left exactly as it is. It is already the text a person reads, it
 * is already what the product prints, and it is the one token that means
 * something outside this folder.
 */
export function resolveTokens(body: string, context: TokenContext): string {
  let out = '';
  let index = 0;

  while (index < body.length) {
    const rest = body.slice(index);
    const character = body[index] as string;

    if (character === '@') {
      const mention = MENTION_AT.exec(rest);
      if (mention) {
        const name = context.members[(mention[1] as string).toLowerCase()] ?? '';
        out += `@${name}`;
        index += mention[0].length;
        continue;
      }
    }

    if (character === '#') {
      const reference = PAGE_AT.exec(rest);
      if (reference) {
        out += renderReference(context, (reference[1] as string).toLowerCase());
        index += reference[0].length;
        continue;
      }
    }

    out += character;
    index += 1;
  }

  return out;
}

function renderReference(context: TokenContext, pageId: string): string {
  const target = context.pages[pageId];
  // The renderer's third outcome: a reference to something that never existed.
  if (!target) return '—';

  // Resolved but outside this export — another space, or a page somebody
  // deleted. Its title is the most useful thing left, and a link into a file
  // that is not in the folder would be a promise the folder cannot keep.
  if (target.path === null) return escapeLinkText(target.title);

  return `[${escapeLinkText(target.title)}](${relativeLink(context.from, target.path)})`;
}

/** A `]` in a title would end the link text early and leave the rest as prose. */
function escapeLinkText(title: string): string {
  return title.replace(/([[\]])/g, '\\$1');
}

/* ------------------------------------------------------------------------- */
/* Titles, on the way in                                                     */
/* ------------------------------------------------------------------------- */

/**
 * What to call an imported file that has no `title` in its front matter.
 *
 * Three sources in order, and the order is what makes a folder of somebody
 * else's Markdown import sensibly: the front matter if it has one (the caller
 * checks that), then a leading heading, then the file's own name.
 *
 * The heading is read **through the parser**, which is `noteTitle`'s rule from
 * slice 17 and matters for the same reason: `# **Standup**` is called *Standup*,
 * not `**Standup**`. Only the first block is examined, so a hundred-page import
 * is not a hundred full parses to fill in a hundred titles.
 */
export function titleFromMarkdown(body: string, fallback: string): string {
  const line = body.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);

  if (heading) {
    /*
      `documentText` on the heading's inline source alone, never on the body:
      it flattens a whole *document*, so handing it the page would return the
      page. This is the one line that needed reading, and reading it through
      the parser is what makes `# **Standup**` a page called *Standup*.
    */
    const text = normalizePageTitle(documentText((heading[1] as string).replace(/\s+#*\s*$/, '')));
    if (text.length > 0) return text;
  }

  return normalizePageTitle(fallback);
}

/**
 * A human title for a file that has neither front matter nor a heading.
 *
 * `day-one.md` becomes *Day one* rather than *day-one*. A slug is a URL, and a
 * URL is not a title — but it is the only thing left, and capitalising the first
 * letter is the smallest change that makes it read as one. Deliberately not
 * title-cased word by word: that is an English typographic convention, and it
 * would be applied to a romanised Khmer slug where it means nothing (§13).
 */
export function titleFromFilename(name: string): string {
  const cleaned = name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
  if (cleaned.length === 0) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
