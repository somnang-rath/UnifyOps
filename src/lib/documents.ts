/**
 * The document body: Markdown in, an allowlisted node tree out (§20.7).
 *
 * §20.7 settles four questions in one sentence — "Markdown, in a `text` column,
 * rendered on the server through an allowlist" — and this module is that
 * sentence made executable. It parses; it does not render markup. The React
 * component that turns these nodes into elements is
 * `src/components/ui/document-body.tsx`, and the split is the point.
 *
 * **Raw HTML is refused, not sanitised, and the refusal is structural.** Nothing
 * here ever produces a string of markup, so there is no `dangerouslySetInnerHTML`
 * anywhere downstream and therefore nothing for a sanitiser to be the last line
 * of defence in front of. A `<script>` somebody types into a body is a `<script>`
 * somebody reads in the body, because the only thing this parser can emit for it
 * is a text node. That is the same refusal `src/lib/attachments.ts` makes for SVG
 * and HTML uploads — documents that can carry script, opened in a browser — and
 * it is stronger here, because a body is served from the app's own origin on
 * every render rather than from a storage host on a click.
 *
 * **The grammar is deliberately small, and small is a decision rather than a
 * stage.** §20.2 asks for "headings, lists, tables, links" and §20.7 refuses a
 * WYSIWYG editor; what a handbook needs is structure, not every corner of
 * CommonMark. Everything not on the list below parses as the text it was, which
 * is the one failure mode a person can see and correct. A dependency was the
 * alternative and is refused for the reason `sigv4.ts` refuses `@aws-sdk` and
 * the burndown refuses a charting library — with one addition specific to this
 * feature: a Markdown library's *extensions* are where the HTML passthrough
 * lives, and the setting that disables it is one upgrade away from being renamed.
 *
 * In `src/lib` because both sides genuinely run it (§20.7): the editor previews
 * as you type, the server renders the same body on read. One implementation, so
 * the preview cannot promise a heading the reader will not show.
 */

import { MENTION_AT, PAGE_AT, scanItemReferences } from './doc-refs';
import { slugify } from './slug';

/* ------------------------------------------------------------------------- */
/* The tree                                                                  */
/* ------------------------------------------------------------------------- */

export type Align = 'left' | 'center' | 'right';

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; content: InlineNode[] }
  | { kind: 'emphasis'; content: InlineNode[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; content: InlineNode[] }
  | { kind: 'image'; src: string; alt: string }
  /** A newline inside a paragraph — see `PARAGRAPH_BREAKS`. */
  | { kind: 'break' }
  /** `@[uuid]` — slice 8's token, resolved to a name at render. */
  | { kind: 'mention'; memberId: string }
  /** `#[uuid]` — a wiki page, resolved to its title at render (§20.7). */
  | { kind: 'pageRef'; pageId: string }
  /** `ENG-142` in running text, autolinked (§20.7). */
  | { kind: 'itemRef'; key: string; number: number };

export type ListItem = {
  content: InlineNode[];
  /** A nested list, or nothing. The only block a list item may contain. */
  children: BlockNode[];
  /**
   * `- [ ]` and `- [x]` — a to-do (§21.5, slice 20).
   *
   * `null` on an ordinary bullet, which is what keeps the two distinguishable:
   * an unticked box is `false` and a list item that is not a to-do at all is
   * neither. The box is rendered `disabled` — this is a document, and a
   * checkbox that submitted something would be a form hiding in a page.
   *
   * It exists because §21.5's `/` menu offers "to-do", and the rule governing
   * that menu is that **a menu item may only insert text a person could have
   * typed**. `- [ ] ` is exactly that; without this rule it would have rendered
   * as a bullet with a literal `[ ]` in it, which is the menu promising
   * something the reader does not get.
   */
  checked: boolean | null;
};

/**
 * The four tones a callout may take (§21.5, slice 20).
 *
 * Deliberately the same four `Alert` has carried since slice 1 rather than a
 * fifth vocabulary — a callout is a body-level Alert, so it inherits the tones,
 * the semantic aliases and the contrast work already done for them. A closed
 * enum, so no translation key ever reaches the database (§13) and an unknown
 * tone parses as the text it was.
 */
export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export type BlockNode =
  /**
   * `anchor` is assigned document-wide by `parseDocument`, never by the block
   * parser — see `assignAnchors`. It is what the table of contents links to and
   * what a heading renders as its own id (§21.5).
   */
  | { kind: 'heading'; level: number; content: InlineNode[]; anchor: string }
  | { kind: 'paragraph'; content: InlineNode[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; children: BlockNode[] }
  /**
   * `> [!warning] Title` — a callout, and with a `-` after the tag a **toggle**
   * (§21.5, slice 20).
   *
   * **One grammar family rather than two, and that is a decision.** §21.2 names
   * "callout and toggle" as two rules; they are built as one syntax with a
   * `folded` flag because a disclosure and a highlighted aside differ only in
   * whether the body starts open. Two syntaxes would be two things to teach, two
   * `/` menu entries that look unrelated, and two ways for a body to say nearly
   * the same thing. The syntax is Obsidian's and GitHub's, which is the one
   * convention that already exists for both — so a body pasted out of either
   * renders here, and a body pasted out of here renders there.
   *
   * It is an *extension of the blockquote*, not a new block delimiter: strip the
   * rule and every callout degrades into the quote it is written as, with its
   * tag as the first line. That is the failure mode a text format should have.
   */
  | {
      kind: 'callout';
      tone: CalloutTone;
      /** The words after the tag, or none — then the renderer names the tone. */
      title: InlineNode[] | null;
      /** `> [!note]-` — starts collapsed, and is a `<details>` on the page. */
      folded: boolean;
      children: BlockNode[];
    }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'rule' }
  | { kind: 'table'; header: InlineNode[][]; align: (Align | null)[]; rows: InlineNode[][][] };

export type DocumentTree = BlockNode[];

/**
 * How deep a list may nest, and how deep any other recursion in this module
 * goes, before further structure is flattened.
 *
 * Three, matching the page tree's own cap (§20.4) and for a related reason: a
 * structure nobody can navigate is not structure. It is also what stops a
 * pathological body — two hundred spaces of indent, or emphasis nested a
 * thousand deep — from recursing that many times on a server render.
 */
export const MAX_DEPTH = 3;

/**
 * A newline inside a paragraph is a **hard break**, not a soft one.
 *
 * CommonMark folds a single newline into a space and asks for two trailing
 * spaces to mean a break. That rule was written for prose typeset into
 * paragraphs; this is a product where people paste addresses, checklists and
 * lines of a meeting into a box. Folding them would silently reflow what
 * somebody typed, and the trailing-space escape is invisible in a monospace
 * textarea and stripped by half the editors that would ever touch the text. So
 * a line break is a line break, and `normalizeDocument` is free to trim
 * trailing whitespace without changing what anybody wrote.
 */
const PARAGRAPH_BREAKS = true;

/* ------------------------------------------------------------------------- */
/* Storing                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * The stored form of a body.
 *
 * NFC for the reason every user-supplied string in this product is normalised
 * before it is stored: Khmer is composed text, and two byte sequences that
 * render identically must compare, index and search identically (§13).
 *
 * Zero-width characters are **kept**. §13 is explicit — "U+200B zero-width
 * spaces preserved in stored text, stripped before indexing" — because they
 * carry real typographic intent in Khmer, marking where a line may break. The
 * stripping happens in the generated `search_text` column and in
 * `normalizeQuery`, which is the arrangement that lets a search for a Khmer word
 * find a body with a break opportunity in the middle of it.
 */
export function normalizeDocument(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim()
    .normalize('NFC');
}

/** How long a body is, in graphemes — never `.length` (§13, §20.7). */
export function documentLength(body: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body)].length;
}

/**
 * The body as plain reading text: syntax and tokens gone, words kept.
 *
 * What a preview line, a search snippet and a derived note title are all built
 * from. It walks the parsed tree rather than stripping characters with a
 * regular expression, so it cannot disagree with what the reader is shown — a
 * `#` inside a code fence stays a `#`, and a heading marker never survives into
 * a title.
 */
export function documentText(body: string): string {
  return blocksToText(parseDocument(body))
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

function blocksToText(blocks: readonly BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          return inlinesToText(block.content);
        case 'list':
          return block.items
            .map((item) =>
              [inlinesToText(item.content), blocksToText(item.children)]
                .filter((part) => part.length > 0)
                .join('\n'),
            )
            .join('\n');
        case 'quote':
          return blocksToText(block.children);
        /**
         * A callout's title is reading text and its tone is not.
         *
         * The tone is a rendering decision the same way a heading level is, and
         * a preview line reading "warning" because somebody used a callout would
         * be the one place this function invented a word nobody wrote — in
         * English, in a Khmer body (§13).
         */
        case 'callout':
          return [block.title ? inlinesToText(block.title) : '', blocksToText(block.children)]
            .filter((part) => part.length > 0)
            .join('\n');
        case 'code':
          return block.text;
        case 'rule':
          return '';
        case 'table':
          return [block.header, ...block.rows]
            .map((row) => row.map(inlinesToText).join(' '))
            .join('\n');
      }
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

function inlinesToText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.text;
        case 'strong':
        case 'emphasis':
        case 'link':
          return inlinesToText(node.content);
        case 'image':
          return node.alt;
        case 'break':
          return '\n';
        case 'itemRef':
          return `${node.key}-${node.number}`;
        // A mention and a page reference are ids, and an id is not reading text.
        // They resolve to a name at render, and a preview that printed a uuid
        // would be worse than one that prints nothing.
        case 'mention':
        case 'pageRef':
          return '';
      }
    })
    .join('');
}

/* ------------------------------------------------------------------------- */
/* Blocks                                                                    */
/* ------------------------------------------------------------------------- */

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\S*)\s*$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$/;

/**
 * `[!warning]- An optional title` — the first line of a callout (§21.5).
 *
 * Matched against a blockquote's first line, after the `>` has been stripped,
 * which is why it carries no `>` of its own. Group 2 is the fold marker and
 * group 3 the title.
 */
const CALLOUT_TAG = /^\[!([A-Za-z]+)\](-?)\s*(.*)$/;

/** `[ ]` or `[x]` at the head of a list item's text — a to-do (§21.5). */
const TASK_MARKER = /^\[([ xX])\]\s+(.*)$/;

function toneOf(tag: string): CalloutTone | null {
  const lower = tag.toLowerCase();
  return (CALLOUT_TONES as readonly string[]).includes(lower) ? (lower as CalloutTone) : null;
}

/**
 * A body, parsed.
 *
 * Line-oriented and single-pass over blocks, then one inline pass per run of
 * text. The order the cases are tried in is the grammar's precedence and is the
 * only thing here that has to be read carefully: a fence wins over everything
 * because its contents are verbatim, and a table is recognised by its *second*
 * line, which is why the header row is only consumed once the divider under it
 * has been seen.
 */
export function parseDocument(body: string): DocumentTree {
  return assignAnchors(parseBlocks(normalizeDocument(body).split('\n'), 0));
}

/* ------------------------------------------------------------------------- */
/* Anchors and the table of contents                                         */
/* ------------------------------------------------------------------------- */

/**
 * Every heading gets an id, and duplicates get a suffix (§21.5).
 *
 * **A post-pass rather than a parser field, because de-duplication is
 * document-wide and `parseBlocks` is recursive.** A counter threaded through the
 * recursion would have to be threaded through quotes, callouts and list items
 * too, and the first branch that forgot it would silently produce two headings
 * with one id — which reads as a table of contents whose second entry jumps to
 * the first.
 *
 * **The failure is named rather than designed around** (§21.5): "renaming a
 * heading breaks a link to it. That is the bargain every Markdown document on
 * earth makes; it is visible and it is recoverable, where the alternative is an
 * id embedded in the body, which is where a text format stops being one."
 *
 * Khmer headings route through `slugify`, whose romanisation is documented as an
 * approximation (slice 3) — an anchor is not a title and does not have to be
 * beautiful. A heading that slugifies to nothing at all (an emoji, a number in a
 * script `slugify` does not romanise) falls back to its position, so every
 * heading is addressable even when its words are not.
 */
function assignAnchors(blocks: BlockNode[]): BlockNode[] {
  const taken = new Map<string, number>();
  let ordinal = 0;

  const walk = (nodes: BlockNode[]): BlockNode[] =>
    nodes.map((block) => {
      switch (block.kind) {
        case 'heading': {
          ordinal += 1;
          const base = slugify(inlinesToText(block.content)) || `section-${ordinal}`;
          const seen = taken.get(base) ?? 0;
          taken.set(base, seen + 1);
          return { ...block, anchor: seen === 0 ? base : `${base}-${seen + 1}` };
        }
        case 'quote':
        case 'callout':
          return { ...block, children: walk(block.children) };
        case 'list':
          return { ...block, items: block.items.map((item) => ({ ...item, children: walk(item.children) })) };
        default:
          return block;
      }
    });

  return walk(blocks);
}

export type TocEntry = { level: number; text: string; anchor: string };

/**
 * The headings of a body, in order, for §21.5's table of contents.
 *
 * **Top-level headings only.** A heading inside a quote or a callout is an
 * aside's own structure rather than the document's, and listing it would put an
 * entry in the contents for a line the reader experiences as part of a
 * paragraph. It still carries an anchor — `assignAnchors` walks everything — so
 * a link written to one by hand resolves; it simply is not offered.
 *
 * Returns text rather than nodes, because a contents entry is a label in a list
 * and not a place emphasis, links or mention chips belong: a `#[uuid]` inside a
 * heading resolves to nothing in `inlinesToText` by design, and a contents that
 * rendered a nested link would be a link inside a link.
 */
export function tableOfContents(body: string): TocEntry[] {
  const entries: TocEntry[] = [];

  for (const block of parseDocument(body)) {
    if (block.kind !== 'heading') continue;
    const text = inlinesToText(block.content).trim();
    if (text.length === 0) continue;
    entries.push({ level: block.level, text, anchor: block.anchor });
  }

  return entries;
}

function parseBlocks(lines: readonly string[], depth: number): BlockNode[] {
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // --- Fenced code ------------------------------------------------------
    // First, and verbatim to the closing fence or the end of the body. An
    // unclosed fence is *not* an error: somebody who is still typing has an
    // unclosed fence, and refusing to render the rest of their document while
    // they finish it is a preview flickering between two shapes.
    const fence = FENCE.exec(line);
    if (fence) {
      const text: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] as string)) {
        text.push(lines[index] as string);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fence[1] || null, text: text.join('\n') });
      continue;
    }

    // --- Thematic break ---------------------------------------------------
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    // --- Heading ----------------------------------------------------------
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        // A trailing run of `#` is closing punctuation in an ATX heading and is
        // not part of the words.
        content: parseInlines((heading[2] as string).replace(/\s+#+\s*$/, '')),
        // Filled by `assignAnchors` once the whole document is parsed, because
        // de-duplication is a document-wide question and this parser is
        // recursive. Never read from here.
        anchor: '',
      });
      index += 1;
      continue;
    }

    // --- Blockquote, and the callout that is written as one -----------------
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] as string)) {
        inner.push(QUOTE.exec(lines[index] as string)?.[1] ?? '');
        index += 1;
      }

      /**
       * `> [!tone]` on the first line makes the quote a callout (§21.5).
       *
       * Checked *after* the quote's lines are gathered and against the first of
       * them, so the tag is recognised in exactly the position the convention
       * puts it and nowhere else. An unrecognised tag — `> [!tip]` — is not an
       * error and not a callout: it stays a quote whose first line reads
       * `[!tip]`, which is the grammar's standing rule that everything not on
       * the list renders as the text it was.
       */
      const tag = CALLOUT_TAG.exec(inner[0] ?? '');
      const tone = tag ? toneOf(tag[1] as string) : null;

      if (tag && tone) {
        const rest = inner.slice(1);
        const title = (tag[3] as string).trim();
        blocks.push({
          kind: 'callout',
          tone,
          title: title.length > 0 ? parseInlines(title) : null,
          folded: tag[2] === '-',
          children: depth >= MAX_DEPTH ? [paragraphOf(rest)] : parseBlocks(rest, depth + 1),
        });
        continue;
      }

      blocks.push({
        kind: 'quote',
        // Recursion is bounded by the same depth budget lists use: a quote
        // inside a quote inside a quote is where a body stops being read.
        children: depth >= MAX_DEPTH ? [paragraphOf(inner)] : parseBlocks(inner, depth + 1),
      });
      continue;
    }

    // --- Table ------------------------------------------------------------
    // Recognised by the divider on the line *after* the header, which is what
    // stops a paragraph containing a pipe from becoming a one-column table.
    const next = lines[index + 1];
    if (line.includes('|') && next !== undefined && next.includes('-') && TABLE_DIVIDER.test(next)) {
      const header = splitRow(line);
      const align = splitRow(next).map(alignmentOf);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] as string).includes('|')) {
        rows.push(splitRow(lines[index] as string));
        index += 1;
      }
      blocks.push({
        kind: 'table',
        header: header.map((cell) => parseInlines(cell)),
        align,
        // Ragged rows are padded and truncated to the header's width rather
        // than refused. A table somebody is halfway through typing has a short
        // row in it, and a preview that collapses at that moment is a preview
        // people stop looking at.
        rows: rows.map((row) => header.map((_, column) => parseInlines(row[column] ?? ''))),
      });
      continue;
    }

    // --- Lists ------------------------------------------------------------
    if (BULLET.test(line) || ORDERED.test(line)) {
      const [list, consumed] = parseList(lines, index, depth);
      blocks.push(list);
      index = consumed;
      continue;
    }

    // --- Paragraph --------------------------------------------------------
    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] as string;
      if (candidate.trim() === '') break;
      // A paragraph ends where any other block begins, so a list written
      // directly under a sentence is a list rather than three more sentences.
      if (
        HEADING.test(candidate) ||
        FENCE.test(candidate) ||
        RULE.test(candidate) ||
        QUOTE.test(candidate) ||
        BULLET.test(candidate) ||
        ORDERED.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(paragraphOf(paragraph));
  }

  return blocks;
}

function paragraphOf(lines: readonly string[]): BlockNode {
  return { kind: 'paragraph', content: parseInlines(lines.join('\n')) };
}

/**
 * One list, and every list nested inside it.
 *
 * Nesting is by indent width, and the rule is deliberately forgiving: anything
 * indented further than the item above it is a child of that item. Requiring
 * exactly two or exactly four spaces is how a list pasted out of another
 * product renders as one flat run of bullets, which is the failure people
 * actually hit.
 *
 * Ordered and unordered lists do not merge: switching marker starts a new list,
 * because a numbered step that follows three bullets is a different thing being
 * said.
 */
function parseList(lines: readonly string[], from: number, depth: number): [BlockNode, number] {
  const first = markerOf(lines[from] as string);
  // Only reached when the caller has already matched a marker.
  if (first === null) return [paragraphOf([lines[from] as string]), from + 1];

  const items: ListItem[] = [];
  let index = from;

  while (index < lines.length) {
    const line = lines[index] as string;
    if (line.trim() === '') break;

    const marker = markerOf(line);
    if (marker === null || marker.ordered !== first.ordered) break;
    if (marker.indent < first.indent) break;

    if (marker.indent > first.indent && items.length > 0 && depth + 1 < MAX_DEPTH) {
      // Deeper than the item that owns it: parse the whole run as a child list
      // and hang it under the previous item.
      const [child, consumed] = parseList(lines, index, depth + 1);
      (items[items.length - 1] as ListItem).children.push(child);
      index = consumed;
      continue;
    }

    // At the same indent, or past the depth cap, or a stray indent with no item
    // above it: the text joins the flat list rather than disappearing.
    //
    // A to-do is a bullet whose text opens with `[ ]` or `[x]` (§21.5). It is
    // recognised here rather than in the marker so that `1. [x] done` is an
    // ordered to-do too — people write checklists both ways, and refusing one of
    // them would be a rule with nothing behind it.
    const task = TASK_MARKER.exec(marker.text);
    items.push({
      content: parseInlines(task ? (task[2] as string) : marker.text),
      children: [],
      checked: task ? (task[1] as string).toLowerCase() === 'x' : null,
    });
    index += 1;
  }

  return [{ kind: 'list', ordered: first.ordered, start: first.start, items }, index];
}

function markerOf(
  line: string,
): { ordered: boolean; indent: number; start: number; text: string } | null {
  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      ordered: true,
      indent: indentWidth(ordered[1] as string),
      start: Number(ordered[2]),
      text: ordered[3] as string,
    };
  }

  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      ordered: false,
      indent: indentWidth(bullet[1] as string),
      start: 1,
      text: bullet[2] as string,
    };
  }

  return null;
}

/** A tab is worth four columns, which is what every editor in this stack draws. */
function indentWidth(prefix: string): number {
  return [...prefix].reduce((width, character) => width + (character === '\t' ? 4 : 1), 0);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function alignmentOf(cell: string): Align | null {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/* ------------------------------------------------------------------------- */
/* Inlines                                                                   */
/* ------------------------------------------------------------------------- */

const CODE_SPAN = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const IMAGE = /^!\[([^\]]*)\]\(\s*([^)\s]*)\s*\)/;
const LINK = /^\[([^\]]*)\]\(\s*([^)\s]*)\s*\)/;
const STRONG = /^\*\*([\s\S]+?)\*\*/;
const EMPHASIS_STAR = /^\*([^\s*][\s\S]*?)\*/;
const EMPHASIS_UNDERSCORE = /^_([^\s_][\s\S]*?)_/;

/**
 * A run of text, parsed into inline nodes.
 *
 * A scanner with an explicit precedence rather than a delimiter stack. The
 * emphasis rules a full CommonMark implementation needs — left-flanking runs,
 * intraword underscores, delimiter matching across nesting — exist to make
 * ambiguous input do the least surprising thing, and every one of them is a
 * place a hand-written parser is subtly wrong. The rule here is one sentence
 * instead: **a delimiter that finds its partner is emphasis, and one that does
 * not is the character it was.** `2 * 3 * 4` stays arithmetic and
 * `snake_case_name` stays a name.
 *
 * `depth` bounds the recursion the way the block parser does. Emphasis inside a
 * link is real; a thousand levels of it is a body crafted to make a render
 * expensive.
 */
export function parseInlines(source: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = [];
  let pending = '';
  let index = 0;

  const flush = () => {
    if (pending.length === 0) return;
    out.push(...autolinkItems(pending));
    pending = '';
  };

  while (index < source.length) {
    const character = source[index] as string;
    const rest = source.slice(index);

    // --- Escapes ----------------------------------------------------------
    // One backslash before punctuation makes it literal, which is the only way
    // to write a `*` next to a word or an `@[` that is not a mention.
    if (character === '\\' && index + 1 < source.length) {
      const escaped = source[index + 1] as string;
      if (/[\\`*_{}[\]()#+\-.!|>~@]/.test(escaped)) {
        pending += escaped;
        index += 2;
        continue;
      }
    }

    // --- Hard break -------------------------------------------------------
    if (character === '\n') {
      flush();
      out.push(PARAGRAPH_BREAKS ? { kind: 'break' } : { kind: 'text', text: ' ' });
      index += 1;
      continue;
    }

    // --- Code span --------------------------------------------------------
    // Before everything else, because its contents are verbatim: a mention
    // token inside backticks is somebody showing you what a mention token looks
    // like, and it must not become one.
    if (character === '`') {
      const code = CODE_SPAN.exec(rest);
      if (code) {
        flush();
        out.push({ kind: 'code', text: (code[2] as string).trim() });
        index += code[0].length;
        continue;
      }
    }

    // --- Tokens -----------------------------------------------------------
    if (character === '@') {
      const mention = MENTION_AT.exec(rest);
      if (mention) {
        flush();
        out.push({ kind: 'mention', memberId: (mention[1] as string).toLowerCase() });
        index += mention[0].length;
        continue;
      }
    }

    if (character === '#') {
      const page = PAGE_AT.exec(rest);
      if (page) {
        flush();
        out.push({ kind: 'pageRef', pageId: (page[1] as string).toLowerCase() });
        index += page[0].length;
        continue;
      }
    }

    // --- Images and links -------------------------------------------------
    if (character === '!') {
      const image = IMAGE.exec(rest);
      if (image) {
        const src = safeHref(image[2] as string);
        flush();
        // An image whose URL is not on the allowlist renders as its alt text
        // rather than as a broken frame — the caption somebody wrote is the
        // most useful thing left when the picture cannot be shown.
        out.push(
          src === null
            ? { kind: 'text', text: image[1] as string }
            : { kind: 'image', src, alt: image[1] as string },
        );
        index += image[0].length;
        continue;
      }
    }

    if (character === '[') {
      const link = LINK.exec(rest);
      if (link) {
        const href = safeHref(link[2] as string);
        flush();
        const content =
          depth >= MAX_DEPTH
            ? ([{ kind: 'text', text: link[1] as string }] as InlineNode[])
            : parseInlines(link[1] as string, depth + 1);
        // A refused scheme renders as the link's own text. Not as the raw
        // source, which would put `javascript:` on screen as though the product
        // were quoting it back approvingly, and not as nothing, which would
        // silently delete a sentence somebody wrote.
        if (href === null) {
          out.push(...content);
        } else {
          out.push({ kind: 'link', href, content });
        }
        index += link[0].length;
        continue;
      }
    }

    // --- Emphasis ---------------------------------------------------------
    if (depth < MAX_DEPTH) {
      if (character === '*') {
        const strong = STRONG.exec(rest);
        if (strong) {
          flush();
          out.push({ kind: 'strong', content: parseInlines(strong[1] as string, depth + 1) });
          index += strong[0].length;
          continue;
        }
        const emphasis = EMPHASIS_STAR.exec(rest);
        if (emphasis) {
          flush();
          out.push({ kind: 'emphasis', content: parseInlines(emphasis[1] as string, depth + 1) });
          index += emphasis[0].length;
          continue;
        }
      }

      if (character === '_') {
        // Intraword underscores are not emphasis, which is the rule that keeps
        // `snake_case_name` and every identifier anybody pastes intact.
        const before = index === 0 ? '' : (source[index - 1] as string);
        if (before === '' || !/[\p{Letter}\p{Number}]/u.test(before)) {
          const emphasis = EMPHASIS_UNDERSCORE.exec(rest);
          if (emphasis) {
            flush();
            out.push({
              kind: 'emphasis',
              content: parseInlines(emphasis[1] as string, depth + 1),
            });
            index += emphasis[0].length;
            continue;
          }
        }
      }
    }

    pending += character;
    index += 1;
  }

  flush();
  return out;
}

/**
 * Plain text, with `ENG-142` turned into references.
 *
 * Applied to text that has already survived every other inline rule, so an
 * identifier inside a code span or inside a link's URL is left alone — which is
 * what `flush` being the only caller guarantees.
 */
function autolinkItems(text: string): InlineNode[] {
  const hits = scanItemReferences(text);
  if (hits.length === 0) return text.length > 0 ? [{ kind: 'text', text }] : [];

  const nodes: InlineNode[] = [];
  let index = 0;

  for (const hit of hits) {
    if (hit.start > index) nodes.push({ kind: 'text', text: text.slice(index, hit.start) });
    nodes.push({ kind: 'itemRef', key: hit.key, number: hit.number });
    index = hit.end;
  }

  if (index < text.length) nodes.push({ kind: 'text', text: text.slice(index) });
  return nodes;
}

/* ------------------------------------------------------------------------- */
/* The URL allowlist                                                         */
/* ------------------------------------------------------------------------- */

/**
 * The schemes a body may link to, and the one shape of relative URL it may use.
 *
 * An allowlist rather than a blocklist, for the reason `src/lib/attachments.ts`
 * keeps an allowlist of upload types: a blocklist is a list of the attacks
 * somebody thought of, and `javascript:`, `data:`, `vbscript:` and the
 * whitespace-and-control-character spellings of each are only the ones already
 * written down.
 *
 * Relative URLs are allowed **only** when they start with a single `/`, which is
 * this product's own origin — the shape slice 8's download route already returns
 * and the shape slice 18's page images will use. `//evil.example` is
 * protocol-relative, a different site wearing a relative URL's clothes, which is
 * why the second character is checked as well as the first.
 */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * Control characters and spaces, which have no business inside a URL.
 *
 * Written as escapes rather than as the characters themselves: a literal
 * control character in a source file is invisible in every diff it ever appears
 * in, including the one that would delete it.
 */
const UNSAFE_IN_URL = /[\u0000-\u0020\u007f]/;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.length === 0) return null;
  // `java\nscript:` is how a naive scheme check is defeated; a URL containing a
  // control character or a space is not one anybody typed.
  if (UNSAFE_IN_URL.test(href)) return null;

  if (href.startsWith('//')) return null;
  if (href.startsWith('/')) return href;
  // A bare fragment addresses this page, which — for a body rendered inside a
  // reader, a preview and a search result — is nothing stable enough to link to.
  if (href.startsWith('#')) return null;

  const colon = href.indexOf(':');
  if (colon === -1) {
    // No scheme and no leading slash: a bare `example.com` or `page.md`.
    // Refused rather than guessed at, because guessing means either inventing
    // `https://` in front of something meant to be relative, or emitting a
    // relative URL that resolves against whichever route is rendering it.
    return null;
  }

  return SAFE_SCHEMES.includes(href.slice(0, colon + 1).toLowerCase()) ? href : null;
}
