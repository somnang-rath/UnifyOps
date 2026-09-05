import { describe, expect, it } from 'vitest';
import { pageToken, parsePageIds, scanItemReferences } from './doc-refs';

const PAGE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('page tokens', () => {
  it('round-trips an id, lower-cased', () => {
    expect(parsePageIds(`see ${pageToken(PAGE.toUpperCase())}`)).toEqual([PAGE]);
  });

  it('de-duplicates, because linking a page twice is one reference', () => {
    expect(parsePageIds(`${pageToken(PAGE)} and again ${pageToken(PAGE)}`)).toEqual([PAGE]);
  });

  it('ignores a hash that is not a token', () => {
    expect(parsePageIds('#[not-a-uuid] #hashtag')).toEqual([]);
  });
});

describe('scanItemReferences', () => {
  it('finds a separated identifier in running text', () => {
    expect(scanItemReferences('blocked by ENG-142 until Friday')).toEqual([
      { start: 11, end: 18, key: 'ENG', number: 142 },
    ]);
  });

  it('upper-cases the key, so a lookup and a stored key cannot disagree', () => {
    expect(scanItemReferences('eng-7')[0]?.key).toBe('ENG');
  });

  it('refuses the joined form, unlike the palette', () => {
    // §20.7: the palette accepts `ENG142` because a person typing into a search
    // box has said what they mean. Running prose is the opposite case — `A4` is
    // a paper size and `COVID19` is a word.
    expect(scanItemReferences('ENG142')).toEqual([]);
  });

  it('leaves a reference that is part of a longer word alone', () => {
    expect(scanItemReferences('foo-ENG-1')).toEqual([]);
    expect(scanItemReferences('ENG-1x')).toEqual([]);
    expect(scanItemReferences('release-2026-09-04')).toEqual([]);
  });

  it('refuses number zero, which is a typo rather than a row', () => {
    expect(scanItemReferences('ENG-0')).toEqual([]);
  });

  it('finds several in one line', () => {
    expect(scanItemReferences('ENG-1 and MKT-22').map((hit) => hit.number)).toEqual([1, 22]);
  });
});
