import { describe, expect, it } from 'vitest';
import {
  pagePath,
  parseFrontMatter,
  relativeLink,
  renderFrontMatter,
  resolveTokens,
  titleFromFilename,
  titleFromMarkdown,
} from './markdown';

/**
 * The export/import file format (§21.8 — slice 22).
 *
 * The tests that matter here are the ones about **what a person opening the
 * folder sees**, because that is the standard §21.8 sets: "a folder of Markdown
 * files and their images, which you can open in any editor". The round trip is
 * asserted too, but a round trip that agreed on a format nobody else can read
 * would pass every one of these and fail the only promise the feature makes.
 */

describe('renderFrontMatter', () => {
  it('writes only the fields that have a value', () => {
    const block = renderFrontMatter({ title: 'Leave policy', owner: null, template: false });

    expect(block).toBe('---\ntitle: "Leave policy"\ntemplate: false\n---\n');
    expect(block).not.toContain('owner');
  });

  /**
   * The reason every string is quoted, unconditionally. `No` is a real page
   * title and YAML reads a bare one as the boolean false — so the conditional
   * version needs a list of every such case, and the first one anybody forgets
   * produces a file that parses to the *wrong value* rather than to an error.
   */
  it('quotes a title that YAML would otherwise read as something else', () => {
    expect(renderFrontMatter({ title: 'No' })).toContain('title: "No"');
    expect(renderFrontMatter({ title: '2026-01-01' })).toContain('title: "2026-01-01"');
    expect(renderFrontMatter({ title: '# not a heading' })).toContain('title: "# not a heading"');
  });

  it('escapes quotes and backslashes', () => {
    const block = renderFrontMatter({ title: 'The "C:\\temp" runbook' });
    expect(block).toContain('title: "The \\"C:\\\\temp\\" runbook"');
    expect(parseFrontMatter(block).fields.title).toBe('The "C:\\temp" runbook');
  });

  it('keeps Khmer as itself', () => {
    const block = renderFrontMatter({ title: 'គោលការណ៍ឈប់សម្រាក' });
    expect(parseFrontMatter(block).fields.title).toBe('គោលការណ៍ឈប់សម្រាក');
  });
});

describe('parseFrontMatter', () => {
  it('splits the block from the body', () => {
    const { fields, body } = parseFrontMatter('---\ntitle: "A"\nowner: "Sophea"\n---\n# A\n\nText\n');

    expect(fields).toEqual({ title: 'A', owner: 'Sophea' });
    expect(body).toBe('# A\n\nText\n');
  });

  /**
   * §21.8: import "takes Markdown", which is "also the interoperability path
   * *from* the survey's own product". A file from somewhere else has whatever
   * front matter that product chose, or none, and neither is an error.
   */
  it('treats a file with no front matter as all body', () => {
    expect(parseFrontMatter('# Just a page\n')).toEqual({
      fields: {},
      body: '# Just a page\n',
    });
  });

  it('treats an unterminated block as body rather than swallowing the page', () => {
    const text = '---\ntitle: "A"\nstill going\n';
    expect(parseFrontMatter(text).body).toBe(text);
  });

  it('survives a byte-order mark and CRLF line endings', () => {
    const { fields, body } = parseFrontMatter('\uFEFF---\r\ntitle: "A"\r\n---\r\nText\r\n');
    expect(fields.title).toBe('A');
    expect(body).toBe('Text\n');
  });

  it('drops keys it does not recognise as keys, and keeps unknown ones', () => {
    const { fields } = parseFrontMatter('---\ntitle: "A"\n- a list item\ntags: "x"\n---\nb');
    expect(fields).toEqual({ title: 'A', tags: 'x' });
  });

  it('handles an empty block', () => {
    expect(parseFrontMatter('---\n---\nbody')).toEqual({ fields: {}, body: 'body' });
  });

  it('does not treat a horizontal rule further down as the closing fence', () => {
    const { fields, body } = parseFrontMatter('---\ntitle: "A"\n---\none\n\n---\n\ntwo\n');
    expect(fields.title).toBe('A');
    expect(body).toBe('one\n\n---\n\ntwo\n');
  });
});

describe('pagePath and relativeLink', () => {
  it('puts a page beside the folder holding its children', () => {
    expect(pagePath(['handbook'])).toBe('handbook.md');
    expect(pagePath(['handbook', 'onboarding'])).toBe('handbook/onboarding.md');
  });

  it('links up, down and sideways', () => {
    expect(relativeLink('handbook/onboarding.md', 'handbook.md')).toBe('../handbook.md');
    expect(relativeLink('handbook.md', 'handbook/onboarding.md')).toBe('handbook/onboarding.md');
    expect(relativeLink('handbook/a.md', 'handbook/b.md')).toBe('./b.md');
    expect(relativeLink('a/b/c.md', 'x.md')).toBe('../../x.md');
  });
});

describe('resolveTokens', () => {
  const context = {
    members: { '11111111-1111-4111-8111-111111111111': 'Sophea Chan' },
    pages: {
      '22222222-2222-4222-8222-222222222222': {
        title: 'Onboarding',
        path: 'handbook/onboarding.md',
      },
      '33333333-3333-4333-8333-333333333333': { title: 'Somewhere else', path: null },
    },
    from: 'handbook.md',
  };

  it('turns a mention into a name', () => {
    expect(resolveTokens('Ask @[11111111-1111-4111-8111-111111111111] first.', context)).toBe(
      'Ask @Sophea Chan first.',
    );
  });

  it('turns a reference into a relative link', () => {
    expect(resolveTokens('See #[22222222-2222-4222-8222-222222222222].', context)).toBe(
      'See [Onboarding](handbook/onboarding.md).',
    );
  });

  /**
   * The rule the whole module follows: **the export says what the screen says.**
   * Each of these is `document-body.tsx`'s own fallback, transposed from
   * elements to text — a bare `@` for a member the workspace cannot name, an em
   * dash for a reference to a page that never existed, and a plain title for one
   * that is real but not in this folder.
   */
  it('falls back exactly as the renderer does', () => {
    expect(resolveTokens('@[44444444-4444-4444-8444-444444444444]', context)).toBe('@');
    expect(resolveTokens('#[44444444-4444-4444-8444-444444444444]', context)).toBe('—');
    expect(resolveTokens('#[33333333-3333-4333-8333-333333333333]', context)).toBe(
      'Somewhere else',
    );
  });

  it('leaves an item reference alone, because it is already text', () => {
    expect(resolveTokens('Fixed in ENG-142.', context)).toBe('Fixed in ENG-142.');
  });

  it('leaves an @ or a # that is not a token alone', () => {
    expect(resolveTokens('# Heading, and email@example.com', context)).toBe(
      '# Heading, and email@example.com',
    );
  });

  it('escapes brackets in a title so the link text cannot end early', () => {
    const brackets = {
      ...context,
      pages: { '55555555-5555-4555-8555-555555555555': { title: 'A [draft]', path: 'a.md' } },
    };
    expect(resolveTokens('#[55555555-5555-4555-8555-555555555555]', brackets)).toBe(
      '[A \\[draft\\]](./a.md)',
    );
  });
});

describe('titleFromMarkdown', () => {
  it('reads a leading heading through the parser', () => {
    expect(titleFromMarkdown('# **Standup**\n\nnotes', 'x')).toBe('Standup');
  });

  it('ignores a heading that is not first', () => {
    expect(titleFromMarkdown('Some text\n\n# Later\n', 'Fallback')).toBe('Fallback');
  });

  it('falls back when there is no heading', () => {
    expect(titleFromMarkdown('just a paragraph', 'Day one')).toBe('Day one');
  });

  it('strips a closing run of hashes', () => {
    expect(titleFromMarkdown('## Runbook ##\n', 'x')).toBe('Runbook');
  });
});

describe('titleFromFilename', () => {
  it('reads a slug as a sentence, not as title case', () => {
    expect(titleFromFilename('day-one.md')).toBe('Day one');
    expect(titleFromFilename('incident_report')).toBe('Incident report');
  });

  it('is empty for a name with nothing in it', () => {
    expect(titleFromFilename('.md')).toBe('');
  });
});
