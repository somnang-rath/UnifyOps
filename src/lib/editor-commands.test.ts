import { describe, expect, it } from 'vitest';
import { parseDocument } from './documents';
import {
  activeInsertQuery,
  applyInsertion,
  applyLink,
  insertionFor,
  matchInsertions,
  wrapSelection,
  INSERTIONS,
  type InsertionId,
} from './editor-commands';

/**
 * §21.5's editor, pinned.
 *
 * One group of tests here carries more weight than the rest: **every insertion
 * has to parse back into the block it claims to be**. §21.15 makes "a menu item
 * may only insert text a person could have typed" a code-review rule; this is
 * the half a test can hold, and it is the half that catches the menu and the
 * grammar drifting apart — a `/` entry writing syntax the parser does not know
 * is a writer watching the menu produce literal punctuation.
 */

const LABELS = Object.fromEntries(INSERTIONS.map((id) => [id, id])) as Record<
  InsertionId,
  string
>;

describe('every insertion parses as the block it promises', () => {
  const expected: Record<InsertionId, string> = {
    heading: 'heading',
    bulletList: 'list',
    numberedList: 'list',
    todo: 'list',
    quote: 'quote',
    callout: 'callout',
    toggle: 'callout',
    code: 'code',
    table: 'table',
    divider: 'rule',
  };

  for (const id of INSERTIONS) {
    it(`${id} parses as a ${expected[id]}`, () => {
      const { text } = insertionFor(id);
      // Words after the marker, because a bare `## ` with nothing in it is not
      // a heading anybody would keep — what is asserted is that the *shape* the
      // menu writes is the shape the parser reads.
      const body = id === 'table' || id === 'divider' ? text : `${text}Words`;
      expect(parseDocument(body)[0]?.kind).toBe(expected[id]);
    });
  }

  it('writes a to-do the parser reads as an unticked box', () => {
    const body = `${insertionFor('todo').text}Ship it`;
    const list = parseDocument(body)[0] as Extract<
      ReturnType<typeof parseDocument>[number],
      { kind: 'list' }
    >;
    expect(list.items[0]?.checked).toBe(false);
  });

  it('closes the code fence it opens', () => {
    // A fence somebody has to remember to close is the one insertion that leaves
    // the rest of the document inside it.
    const { text, caret } = insertionFor('code');
    expect(text.startsWith('```')).toBe(true);
    expect(text.endsWith('```')).toBe(true);
    // The caret sits on the empty line between the two fences.
    expect(text.slice(0, caret)).toBe('```\n');
  });
});

describe('activeInsertQuery', () => {
  it('opens at the start of a line', () => {
    expect(activeInsertQuery('/head', 5)).toEqual({ query: 'head', start: 0 });
    expect(activeInsertQuery('one\n/ta', 7)).toEqual({ query: 'ta', start: 4 });
  });

  /**
   * The rule that stops the feature ruining ordinary writing. `and/or`, a date,
   * a fraction and a URL all carry a slash mid-line.
   */
  it('does not open in the middle of a line', () => {
    expect(activeInsertQuery('and/or', 6)).toBeNull();
    expect(activeInsertQuery('see https://x.example', 21)).toBeNull();
    expect(activeInsertQuery('on 3/9', 6)).toBeNull();
  });

  it('closes once a space is typed', () => {
    // Otherwise an open menu swallows the Enter that ends the next word.
    expect(activeInsertQuery('/ something', 11)).toBeNull();
  });
});

describe('matchInsertions', () => {
  it('offers everything for a bare slash', () => {
    expect(matchInsertions('', LABELS)).toEqual([...INSERTIONS]);
  });

  it('narrows on the id as well as the label', () => {
    // A Khmer workspace shows Khmer labels; somebody typing the English word
    // they saw in a colleague's screenshot must still find the entry (§13).
    expect(matchInsertions('tab', LABELS)).toEqual(['table']);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(matchInsertions('zzz', LABELS)).toEqual([]);
  });
});

describe('applyInsertion', () => {
  it('replaces the typed query and leaves the rest of the line alone', () => {
    const result = applyInsertion('/head', 5, 'heading');
    expect(result.body).toBe('## ');
    expect(result.caret).toBe(3);
  });

  it('keeps text that follows the caret', () => {
    const result = applyInsertion('/quo\ntail', 4, 'quote');
    expect(result.body).toBe('> \ntail');
  });

  /**
   * The parser is line-oriented, so a heading appended to a paragraph is one
   * paragraph — and the writer watches their heading fail to appear.
   */
  it('opens a line when the caret is not already at the start of one', () => {
    const result = applyInsertion('Some text', 9, 'heading');
    expect(result.body).toBe('Some text\n## ');
    expect(parseDocument(`${result.body}Title`).map((block) => block.kind)).toEqual([
      'paragraph',
      'heading',
    ]);
  });

  it('does not add a second newline when there is already one', () => {
    expect(applyInsertion('Some text\n', 10, 'heading').body).toBe('Some text\n## ');
  });

  it('puts the caret in the table first header cell', () => {
    const result = applyInsertion('', 0, 'table');
    expect(result.body.slice(0, result.caret)).toBe('| ');
  });
});

describe('wrapSelection', () => {
  it('wraps the selection', () => {
    const result = wrapSelection('make bold now', 5, 9, '**');
    expect(result.body).toBe('make **bold** now');
    // The selection follows the words rather than the markers, so a second
    // press toggles the same text back.
    expect(result.body.slice(result.start, result.end)).toBe('bold');
  });

  it('unwraps when the markers are inside the selection', () => {
    const result = wrapSelection('make **bold** now', 5, 13, '**');
    expect(result.body).toBe('make bold now');
  });

  it('unwraps when the markers are outside it', () => {
    // The common case: the writer double-clicked the word, not the asterisks.
    const result = wrapSelection('make **bold** now', 7, 11, '**');
    expect(result.body).toBe('make bold now');
  });

  it('inserts an empty pair with the caret between them when nothing is selected', () => {
    const result = wrapSelection('', 0, 0, '**');
    expect(result.body).toBe('****');
    expect(result.start).toBe(2);
    expect(result.end).toBe(2);
  });

  it('round-trips through the parser', () => {
    const { body } = wrapSelection('bold', 0, 4, '**');
    expect(parseDocument(body)[0]).toMatchObject({
      content: [{ kind: 'strong', content: [{ kind: 'text', text: 'bold' }] }],
    });
  });
});

describe('applyLink', () => {
  it('keeps the selection as the link text and lands the caret in the URL', () => {
    const result = applyLink('see the handbook', 8, 16);
    expect(result.body).toBe('see the [handbook]()');
    expect(result.start).toBe(result.body.indexOf('()') + 1);
  });

  it('lands the caret in the text half when nothing is selected', () => {
    // There is nothing to keep, so the words are the half still missing.
    const result = applyLink('', 0, 0);
    expect(result.body).toBe('[]()');
    expect(result.start).toBe(1);
  });
});
