import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  applyMention,
  mentionToken,
  normalizeBody,
  parseMentionIds,
  splitMentions,
} from './mentions';

const SOPHEA = '0192a4c1-1111-7000-8000-000000000001';
const DARA = '0192a4c1-2222-7000-8000-000000000002';

describe('parseMentionIds', () => {
  it('finds every mention in reading order', () => {
    expect(parseMentionIds(`ping @[${SOPHEA}] and @[${DARA}]`)).toEqual([SOPHEA, DARA]);
  });

  it('counts a person mentioned twice once', () => {
    // One comment owes one notification, not one per token (§7.8).
    expect(parseMentionIds(`@[${SOPHEA}] see also @[${SOPHEA}]`)).toEqual([SOPHEA]);
  });

  it('ignores an email address and a bare @', () => {
    expect(parseMentionIds('mail dara@example.com or just @ someone')).toEqual([]);
  });

  it('ignores a token that is not a uuid', () => {
    expect(parseMentionIds('@[not-an-id] @[123]')).toEqual([]);
  });

  it('finds nothing in an empty body', () => {
    expect(parseMentionIds('')).toEqual([]);
  });
});

describe('splitMentions', () => {
  it('splits text around a mention', () => {
    expect(splitMentions(`hi @[${SOPHEA}] there`)).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', memberId: SOPHEA },
      { kind: 'text', text: ' there' },
    ]);
  });

  it('handles a body that is only a mention', () => {
    expect(splitMentions(`@[${DARA}]`)).toEqual([{ kind: 'mention', memberId: DARA }]);
  });

  it('keeps Khmer text intact around a mention', () => {
    const segments = splitMentions(`សួស្ដី @[${SOPHEA}] សូមពិនិត្យ`);
    expect(segments[0]).toEqual({ kind: 'text', text: 'សួស្ដី ' });
    expect(segments[2]).toEqual({ kind: 'text', text: ' សូមពិនិត្យ' });
  });

  it('returns one text segment when nothing is mentioned', () => {
    expect(splitMentions('plain comment')).toEqual([{ kind: 'text', text: 'plain comment' }]);
  });
});

describe('activeMentionQuery', () => {
  it('opens on an @ at the start of a word', () => {
    expect(activeMentionQuery('hello @so', 9)).toEqual({ query: 'so', start: 6 });
  });

  it('opens on an @ at the very start of the body', () => {
    expect(activeMentionQuery('@da', 3)).toEqual({ query: 'da', start: 0 });
  });

  it('does not open inside an email address', () => {
    expect(activeMentionQuery('dara@example', 12)).toBeNull();
  });

  it('closes once a space is typed', () => {
    expect(activeMentionQuery('@sophea is here', 15)).toBeNull();
  });

  it('does not reopen just after an inserted token', () => {
    const body = `@[${SOPHEA}]`;
    expect(activeMentionQuery(body, body.length)).toBeNull();
  });

  it('runs to the end of typed Khmer, which has no word spaces', () => {
    // Documented behaviour, not an accident: matching is by prefix against the
    // member's name, so a longer query simply matches fewer people.
    const body = '@សុភា';
    expect(activeMentionQuery(body, body.length)).toEqual({ query: 'សុភា', start: 0 });
  });
});

describe('applyMention', () => {
  it('replaces the query with a token and a trailing space', () => {
    const result = applyMention('hello @so', 9, SOPHEA);
    expect(result.body).toBe(`hello ${mentionToken(SOPHEA)} `);
    expect(result.caret).toBe(result.body.length);
  });

  it('keeps the text after the caret', () => {
    const result = applyMention('hi @so please look', 6, DARA);
    expect(result.body).toBe(`hi ${mentionToken(DARA)}  please look`);
  });

  it('inserts at the caret when no query is open', () => {
    const result = applyMention('hello ', 6, SOPHEA);
    expect(result.body).toBe(`hello ${mentionToken(SOPHEA)} `);
  });

  it('round-trips through the parser', () => {
    const { body } = applyMention('@so', 3, SOPHEA);
    expect(parseMentionIds(body)).toEqual([SOPHEA]);
  });
});

describe('normalizeBody', () => {
  it('trims, and normalises CRLF to LF', () => {
    expect(normalizeBody('  one\r\ntwo  ')).toBe('one\ntwo');
  });

  it('composes Khmer to NFC', () => {
    const decomposed = 'សុភា'.normalize('NFD');
    expect(normalizeBody(decomposed)).toBe('សុភា'.normalize('NFC'));
  });

  it('leaves interior blank lines alone', () => {
    expect(normalizeBody('one\n\ntwo')).toBe('one\n\ntwo');
  });
});
