import { describe, expect, it } from 'vitest';
import {
  documentLength,
  documentText,
  normalizeDocument,
  parseDocument,
  parseInlines,
  safeHref,
  tableOfContents,
  type BlockNode,
  type InlineNode,
} from './documents';

/**
 * The body format (§20.7), pinned.
 *
 * §20.13 puts slice 17 before slice 18 for one reason — "getting the body
 * format wrong is the expensive-to-reverse decision here, in the way slice 5's
 * list query was" — so this file is the place that decision is written down as
 * behaviour rather than as prose. Two groups of tests carry more weight than
 * the rest: the ones that assert markup **stays text**, because that is the
 * whole of the XSS story, and the ones that assert an unmatched delimiter is
 * the character it was, because that is what stops a parser from silently
 * eating somebody's sentence.
 */

const MENTION = '11111111-2222-3333-4444-555555555555';
const PAGE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function inlinesOf(markdown: string): InlineNode[] {
  const blocks = parseDocument(markdown);
  const first = blocks[0] as BlockNode;
  return first.kind === 'paragraph' || first.kind === 'heading' ? first.content : [];
}

describe('normalizeDocument', () => {
  it('normalises line endings and trims trailing space per line', () => {
    expect(normalizeDocument('a  \r\nb\t\r\n')).toBe('a\nb');
  });

  it('keeps zero-width characters, which carry Khmer line-break intent', () => {
    // §13: "U+200B zero-width spaces preserved in stored text, stripped before
    // indexing." The stripping is the generated column's job, not this one's.
    const body = 'ភ្នំ​ពេញ';
    expect(normalizeDocument(body)).toContain('​');
  });

  it('composes to NFC so two spellings of one word are one string', () => {
    expect(normalizeDocument('é')).toBe('é');
  });
});

describe('documentLength', () => {
  it('counts graphemes, not code points', () => {
    // One Khmer syllable, four code points. Counted the other way a Khmer
    // workspace gets a third of the field an English one does (§13).
    const syllable = 'ស្រ្តី';
    expect(documentLength(syllable)).toBeLessThan([...syllable].length);
  });
});

describe('blocks', () => {
  it('parses headings, and closing hashes are punctuation', () => {
    expect(parseDocument('## Handbook ##')).toEqual([
      {
        kind: 'heading',
        level: 2,
        anchor: 'handbook',
        content: [{ kind: 'text', text: 'Handbook' }],
      },
    ]);
  });

  it('parses a fenced code block verbatim, tokens and all', () => {
    const blocks = parseDocument(['```sql', 'select * from work_item', '```'].join('\n'));
    expect(blocks).toEqual([
      { kind: 'code', language: 'sql', text: 'select * from work_item' },
    ]);
  });

  it('renders an unclosed fence rather than refusing the document', () => {
    // Somebody who is still typing has an unclosed fence.
    const blocks = parseDocument('```\nhalf a thought');
    expect(blocks).toEqual([{ kind: 'code', language: null, text: 'half a thought' }]);
  });

  it('starts a list where a paragraph was, without a blank line between them', () => {
    const blocks = parseDocument('Steps:\n- one\n- two');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list']);
  });

  it('nests a list by indent, however wide the indent is', () => {
    const blocks = parseDocument('- one\n   - deeper\n- two');
    const list = blocks[0] as Extract<BlockNode, { kind: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.children).toHaveLength(1);
  });

  it('does not merge an ordered list into an unordered one', () => {
    const blocks = parseDocument('- one\n1. two');
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'list']);
  });

  it('parses a table only when a divider follows the header', () => {
    const table = parseDocument('| a | b |\n| --- | ---: |\n| 1 | 2 |');
    expect(table[0]?.kind).toBe('table');
    // A sentence with a pipe in it is a sentence.
    expect(parseDocument('costs 5 | 6 dollars')[0]?.kind).toBe('paragraph');
  });

  it('pads a ragged table row to the header rather than collapsing', () => {
    const blocks = parseDocument('| a | b |\n| --- | --- |\n| 1 |');
    const table = blocks[0] as Extract<BlockNode, { kind: 'table' }>;
    expect(table.rows[0]).toHaveLength(2);
  });
});

describe('inlines', () => {
  it('treats a newline inside a paragraph as a hard break', () => {
    expect(inlinesOf('one\ntwo')).toEqual([
      { kind: 'text', text: 'one' },
      { kind: 'break' },
      { kind: 'text', text: 'two' },
    ]);
  });

  it('leaves an unmatched delimiter as the character it was', () => {
    expect(inlinesOf('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }]);
  });

  it('leaves intraword underscores alone', () => {
    expect(inlinesOf('snake_case_name')).toEqual([{ kind: 'text', text: 'snake_case_name' }]);
  });

  it('parses strong and emphasis', () => {
    expect(inlinesOf('**bold** and *soft*')).toEqual([
      { kind: 'strong', content: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'emphasis', content: [{ kind: 'text', text: 'soft' }] },
    ]);
  });

  it('keeps a code span verbatim, so a token inside it stays a token', () => {
    // Somebody explaining what a mention looks like must not perform one.
    expect(inlinesOf(`\`@[${MENTION}]\``)).toEqual([
      { kind: 'code', text: `@[${MENTION}]` },
    ]);
  });

  it('parses the three token formats §20.7 defines', () => {
    expect(inlinesOf(`@[${MENTION}] see #[${PAGE}] and ENG-142`)).toEqual([
      { kind: 'mention', memberId: MENTION },
      { kind: 'text', text: ' see ' },
      { kind: 'pageRef', pageId: PAGE },
      { kind: 'text', text: ' and ' },
      { kind: 'itemRef', key: 'ENG', number: 142 },
    ]);
  });

  it('honours a backslash escape, which is the only way to write a literal marker', () => {
    expect(inlinesOf('\\*not emphasis\\*')).toEqual([{ kind: 'text', text: '*not emphasis*' }]);
  });
});

describe('the allowlist', () => {
  it('refuses raw HTML by having nothing to emit for it', () => {
    // The whole XSS story: this parser cannot produce markup, so a script tag
    // is text in a text node and stays text everywhere downstream.
    const nodes = inlinesOf('<script>alert(1)</script>');
    expect(nodes).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }]);
  });

  it('accepts http, https, mailto and same-origin relative URLs', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref('/acme/projects/eng')).toBe('/acme/projects/eng');
  });

  it('refuses every scheme that can execute, however it is spelled', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('vbscript:msgbox')).toBeNull();
  });

  it('refuses a protocol-relative URL, which is another site in relative clothes', () => {
    expect(safeHref('//evil.example/x')).toBeNull();
  });

  it('renders a refused link as its own text rather than deleting the sentence', () => {
    expect(inlinesOf('[click me](javascript:alert)')).toEqual([
      { kind: 'text', text: 'click me' },
    ]);
  });

  it('renders a refused image as its alt text', () => {
    expect(inlinesOf('![a diagram](data:image/svg+xml,<svg/>)')).toEqual([
      { kind: 'text', text: 'a diagram' },
    ]);
  });
});

describe('documentText', () => {
  it('reads the words and drops the syntax', () => {
    const body = ['# Title', '', 'Some **bold** text.', '', '- one', '- two'].join('\n');
    expect(documentText(body)).toBe('Title\nSome bold text.\none\ntwo');
  });

  it('prints an item reference and not a uuid', () => {
    // A mention and a page reference are ids; a preview showing one would be
    // worse than a preview showing nothing.
    expect(documentText(`@[${MENTION}] fix ENG-7`)).toBe('fix ENG-7');
  });

  it('keeps a hash that is inside a code fence', () => {
    expect(documentText('```\n# not a heading\n```')).toBe('# not a heading');
  });
});

describe('depth', () => {
  it('does not recurse without bound on a crafted body', () => {
    const deep = `${'*'.repeat(200)}x${'*'.repeat(200)}`;
    expect(() => parseInlines(deep)).not.toThrow();
  });

  it('flattens indentation past the cap rather than nesting forever', () => {
    const body = ['- a', '  - b', '    - c', '      - d'].join('\n');
    expect(() => parseDocument(body)).not.toThrow();
  });
});

/* ------------------------------------------------------------------------- */
/* Slice 20 — the grammar §21.5 adds                                         */
/* ------------------------------------------------------------------------- */

describe('callouts and toggles (§21.5)', () => {
  it('reads a tagged blockquote as a callout, with its title', () => {
    const blocks = parseDocument('> [!warning] Read this first\n> The API changed.');
    expect(blocks).toHaveLength(1);
    const callout = blocks[0] as Extract<BlockNode, { kind: 'callout' }>;
    expect(callout.kind).toBe('callout');
    expect(callout.tone).toBe('warning');
    expect(callout.folded).toBe(false);
    expect(callout.title).toEqual([{ kind: 'text', text: 'Read this first' }]);
    expect(callout.children).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'The API changed.' }] },
    ]);
  });

  it('a trailing dash makes it a toggle, and the title survives', () => {
    const callout = parseDocument('> [!info]- Details\n> Hidden until asked for.')[0];
    expect(callout).toMatchObject({ kind: 'callout', tone: 'info', folded: true });
  });

  it('takes no title, and does not invent one', () => {
    // The renderer names the tone from the catalogue when it has to. The parser
    // must not, or a Khmer body would carry an English word (§13).
    expect(parseDocument('> [!danger]\n> Do not.')[0]).toMatchObject({ title: null });
  });

  /**
   * The grammar's standing rule, applied to the newest member of it: everything
   * not on the list renders as the text it was. An unknown tone is not an error
   * and not a silently-dropped line — it is the quote somebody typed.
   */
  it('leaves an unrecognised tag as an ordinary quote', () => {
    const block = parseDocument('> [!tip] Try this')[0] as Extract<BlockNode, { kind: 'quote' }>;
    expect(block.kind).toBe('quote');
    expect(block.children).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '[!tip] Try this' }] },
    ]);
  });

  it('is case-insensitive about the tone, because people type [!NOTE]', () => {
    expect(parseDocument('> [!Warning] x')[0]).toMatchObject({ tone: 'warning' });
  });

  it('only reads the tag on the first line', () => {
    // Otherwise a quote of somebody else's document turns into a callout
    // halfway down, which is the body reinterpreting text nobody marked up.
    const block = parseDocument('> Ordinary.\n> [!danger] not a tag here')[0];
    expect(block).toMatchObject({ kind: 'quote' });
  });
});

describe('to-dos (§21.5)', () => {
  it('reads `- [ ]` and `- [x]`, and keeps the text', () => {
    const list = parseDocument('- [ ] open\n- [x] done')[0] as Extract<
      BlockNode,
      { kind: 'list' }
    >;
    expect(list.items.map((item) => item.checked)).toEqual([false, true]);
    expect(list.items[0]?.content).toEqual([{ kind: 'text', text: 'open' }]);
  });

  it('distinguishes an unticked box from a bullet that is not a to-do', () => {
    // `false` and `null` are different facts, and the renderer draws them
    // differently: one is an empty checkbox, the other has no checkbox at all.
    const list = parseDocument('- [ ] a\n- b')[0] as Extract<BlockNode, { kind: 'list' }>;
    expect(list.items.map((item) => item.checked)).toEqual([false, null]);
  });

  it('reads an ordered to-do too', () => {
    const list = parseDocument('1. [x] shipped')[0] as Extract<BlockNode, { kind: 'list' }>;
    expect(list.items[0]?.checked).toBe(true);
  });
});

describe('heading anchors and the table of contents (§21.5)', () => {
  it('gives every heading an anchor derived from its words', () => {
    expect(tableOfContents('# Release process\n## Rollback')).toEqual([
      { level: 1, text: 'Release process', anchor: 'release-process' },
      { level: 2, text: 'Rollback', anchor: 'rollback' },
    ]);
  });

  /**
   * The one property the whole feature rests on: two headings with one id is a
   * contents list whose second entry jumps to the first.
   */
  it('de-duplicates repeated headings with a suffix', () => {
    expect(tableOfContents('## Notes\n## Notes\n## Notes').map((e) => e.anchor)).toEqual([
      'notes',
      'notes-2',
      'notes-3',
    ]);
  });

  it('falls back to a position when the words slugify to nothing', () => {
    // Every heading has to be addressable even when its text is not romanisable
    // — an anchor is not a title and does not have to be beautiful (§21.5).
    const [entry] = tableOfContents('# 🎉');
    expect(entry?.anchor).toMatch(/^section-\d+$/);
  });

  it('lists only the document own headings, not an aside structure', () => {
    // A heading inside a callout is that aside's structure. It still carries an
    // anchor, so a hand-written link to it resolves; it is simply not offered.
    expect(tableOfContents('# Real\n> [!info] x\n> ## Inside')).toEqual([
      { level: 1, text: 'Real', anchor: 'real' },
    ]);
  });

  it('resolves a Khmer heading through slugify rather than dropping it', () => {
    const [entry] = tableOfContents('# ភ្នំពេញ');
    expect(entry?.text).toBe('ភ្នំពេញ');
    expect(entry?.anchor.length).toBeGreaterThan(0);
  });
});
