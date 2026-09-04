import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  PALETTE_ACTIONS,
  actionMatches,
  availableActions,
  hasKhmer,
  isSearchable,
  normalizeQuery,
  parseItemReference,
  queryLength,
  searchRoute,
  toLikePattern,
  toTsQuery,
} from './search';

/** A real Khmer phrase, with the zero-width break opportunities people type. */
const PHNOM_PENH = 'ភ្នំពេញ';

describe('script routing', () => {
  it('sends Latin through full text and Khmer through trigrams', () => {
    expect(searchRoute('login bug')).toBe('fulltext');
    expect(searchRoute(PHNOM_PENH)).toBe('trigram');
  });

  /**
   * The decision worth pinning: **any** Khmer chooses trigram. A mixed query is
   * the common case, not the exotic one, and the full-text route would reduce
   * the Khmer half to one lexeme nobody will type again.
   */
  it('routes a mixed-script query through trigrams', () => {
    expect(searchRoute(`Acme ${PHNOM_PENH}`)).toBe('trigram');
    expect(hasKhmer(`Acme ${PHNOM_PENH}`)).toBe(true);
  });

  it('does not mistake other non-Latin scripts for Khmer', () => {
    expect(hasKhmer('東京')).toBe(false);
    expect(searchRoute('東京')).toBe('fulltext');
  });
});

describe('normalizeQuery', () => {
  // §13: zero-width spaces are preserved in stored text and stripped before
  // indexing, so the query has to be stripped the same way or the two never meet.
  it('strips zero-width characters and collapses whitespace', () => {
    expect(normalizeQuery('ភ្នំ​ពេញ')).toBe(PHNOM_PENH);
    expect(normalizeQuery('  login   bug  ')).toBe('login bug');
    expect(normalizeQuery('a﻿b')).toBe('ab');
  });

  it('does not fold case — the database does that twice already', () => {
    expect(normalizeQuery('Login BUG')).toBe('Login BUG');
  });

  // §13's rule pointed at an input rather than at a truncation: sliced by code
  // point, a Khmer query is cut to roughly a third and can end mid-syllable.
  it('caps length by grapheme, not by code point', () => {
    const long = PHNOM_PENH.repeat(200);
    expect(queryLength(normalizeQuery(long))).toBe(MAX_QUERY_LENGTH);
    // Nothing was cut in half: the result is still whole syllables.
    expect(long.startsWith(normalizeQuery(long))).toBe(true);
  });
});

describe('isSearchable', () => {
  it('needs the same number of graphemes in both scripts', () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
    // One Khmer syllable is several code points and one grapheme, so a floor
    // counted in code points would have let this through and 'a' not.
    expect(isSearchable('ភ្នំ')).toBe(false);
    expect(isSearchable('ភ្នំពេ')).toBe(true);
  });

  it('is false for whitespace and zero-width characters alone', () => {
    expect(isSearchable('   ')).toBe(false);
    expect(isSearchable('​​​')).toBe(false);
  });
});

describe('toTsQuery', () => {
  // The prefix on the last term is what makes the palette feel alive: a search
  // that only matches whole words shows nothing until the word is finished.
  it('ANDs the terms and prefixes the last one', () => {
    expect(toTsQuery('login')).toBe('login:*');
    expect(toTsQuery('login bug')).toBe('login & bug:*');
  });

  it('drops punctuation rather than emitting tsquery syntax', () => {
    expect(toTsQuery('bug !important')).toBe('bug & important:*');
    expect(toTsQuery('a <-> b')).toBe('a & b:*');
    expect(toTsQuery('!!!')).toBeNull();
  });

  it('folds case, because lexemes are folded', () => {
    expect(toTsQuery('Login')).toBe('login:*');
  });
});

describe('toLikePattern', () => {
  // Slice 10 learned this with a client called "50% Co": unescaped, `%` matches
  // every item in the company.
  it('escapes the LIKE metacharacters', () => {
    expect(toLikePattern('50%')).toBe('%50\\%%');
    expect(toLikePattern('a_b')).toBe('%a\\_b%');
    expect(toLikePattern('back\\slash')).toBe('%back\\\\slash%');
  });

  it('folds case, because the column it compares against is generated lower()', () => {
    expect(toLikePattern('Login')).toBe('%login%');
  });

  it('strips zero-width characters so a Khmer title with breaks still matches', () => {
    expect(toLikePattern('ភ្នំ​ពេញ')).toBe(`%${PHNOM_PENH}%`);
  });
});

describe('parseItemReference', () => {
  it('reads an identifier in the shapes people actually type', () => {
    expect(parseItemReference('ENG-142')).toEqual({ key: 'ENG', number: 142 });
    expect(parseItemReference('eng142')).toEqual({ key: 'ENG', number: 142 });
    expect(parseItemReference('  ENG 142 ')).toEqual({ key: 'ENG', number: 142 });
    // An en dash, which is what a paste out of a document produces.
    expect(parseItemReference('ENG–142')).toEqual({ key: 'ENG', number: 142 });
  });

  /**
   * The property that matters more than the parsing: this must not fire on a
   * text query that merely contains a number, or the palette teleports somebody
   * away from results they were reading.
   */
  it('is null for anything that is not exactly one identifier', () => {
    expect(parseItemReference('login bug 142')).toBeNull();
    expect(parseItemReference('ENG-142 crash')).toBeNull();
    expect(parseItemReference('142')).toBeNull();
    expect(parseItemReference('ENG-0')).toBeNull();
    expect(parseItemReference(PHNOM_PENH)).toBeNull();
    // Keys are at most five characters (`KEY_MAX_LENGTH`), so this is a word.
    expect(parseItemReference('release42')).toBeNull();
  });

  /**
   * `ENG2142` is genuinely ambiguous — `ENG2-142` or `ENG-2142` — and no rule
   * can choose. So the joined form reads the key as letters only and resolves
   * it one way, deterministically; a company whose key carries a digit types
   * the dash, which is what the product prints and what they paste anyway.
   */
  it('resolves the joined form one way, and the dash is how you say the other', () => {
    expect(parseItemReference('ENG2-142')).toEqual({ key: 'ENG2', number: 142 });
    expect(parseItemReference('ENG-2142')).toEqual({ key: 'ENG', number: 2142 });
    expect(parseItemReference('ENG2142')).toEqual({ key: 'ENG', number: 2142 });
  });
});

describe('palette actions', () => {
  it('offers the contextual action only where there is an item', () => {
    expect(availableActions({ hasCurrentItem: false })).not.toContain('assignToMe');
    expect(availableActions({ hasCurrentItem: true })).toContain('assignToMe');
    expect(availableActions({ hasCurrentItem: true })).toHaveLength(PALETTE_ACTIONS.length);
  });

  it('keeps catalogue order, so the list does not reshuffle as you type', () => {
    expect(availableActions({ hasCurrentItem: true })).toEqual([...PALETTE_ACTIONS]);
  });

  it('matches an action by its translated label, case-folded', () => {
    expect(actionMatches('Switch language', 'lang')).toBe(true);
    expect(actionMatches('Switch language', 'LANG')).toBe(true);
    expect(actionMatches('ប្ដូរភាសា', 'ភាសា')).toBe(true);
    expect(actionMatches('Switch language', 'assign')).toBe(false);
  });

  it('matches everything on an empty query, so an unfiltered palette lists them all', () => {
    expect(actionMatches('Go to My Work', '')).toBe(true);
  });
});
