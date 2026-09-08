import { describe, expect, it } from 'vitest';
import { planImport } from './plan';
import { pagePath, renderFrontMatter } from './markdown';

const encoder = new TextEncoder();

function file(path: string, text = '') {
  return { path, bytes: encoder.encode(text) };
}

/**
 * The importer's planning half (§21.8 — slice 22).
 *
 * This is where §21.13's definition of done for the slice actually lives — "a
 * round trip: export a space, import it into an empty workspace, and the two
 * trees match" — because the tree is derived here and everything after it is one
 * `createPageIn` per node. The tenancy suite proves the pages land; these prove
 * the shape they land in, against the archives a real person will actually hand
 * the product.
 */

describe('planImport', () => {
  it('reads a file as a page and a folder as its children', () => {
    const { pages } = planImport([
      file('handbook.md'),
      file('handbook/onboarding.md'),
      file('handbook/onboarding/day-one.md'),
    ]);

    expect(pages.map((page) => [page.path, page.parentPath])).toEqual([
      ['handbook', null],
      ['handbook/onboarding', 'handbook'],
      ['handbook/onboarding/day-one', 'handbook/onboarding'],
    ]);
  });

  /**
   * Every parent before its children, whatever order the archive listed them in.
   * `createPageIn` needs a parent *id*, and the only way to have one is to have
   * created the parent already — so this ordering is not a nicety, it is what
   * makes the import possible at all.
   */
  it('orders parents before children even when the archive does not', () => {
    const { pages } = planImport([
      file('a/b/c.md'),
      file('a.md'),
      file('a/b.md'),
    ]);

    expect(pages.map((page) => page.path)).toEqual(['a', 'a/b', 'a/b/c']);
  });

  /**
   * A zip from somewhere else may have `Handbook/onboarding.md` and no
   * `Handbook.md`. Dropping the children loses most of the import and
   * flattening them loses the structure — so the folder becomes a page.
   */
  it('invents a page for a folder that has no file of its own', () => {
    const { pages } = planImport([file('runbooks/deploy.md', '# Deploy')]);

    expect(pages.map((page) => [page.path, page.title])).toEqual([
      ['runbooks', 'Runbooks'],
      ['runbooks/deploy', 'Deploy'],
    ]);
    expect(pages[0]?.body).toBe('');
  });

  it('lets a real file win over the placeholder whatever the order', () => {
    const { pages } = planImport([
      file('runbooks/deploy.md'),
      file('runbooks.md', '# The runbooks\n\nAll of them.\n'),
    ]);

    expect(pages[0]?.title).toBe('The runbooks');
    expect(pages[0]?.body).toContain('All of them.');
  });

  /**
   * §20.4 caps a space at three levels. Skipped rather than flattened, because a
   * page silently moved two levels up is a page nobody can find and nobody was
   * told about — §7.10's rule that the result lists what did not land.
   */
  it('skips a file nested deeper than the cap, and keeps the rest', () => {
    const { pages, skipped } = planImport([
      file('a.md'),
      file('a/b/c/d.md'),
    ]);

    expect(pages.map((page) => page.path)).toEqual(['a']);
    // The skip list names the file as the person uploaded it, extension and
    // all — it is the thing they have to go and fix.
    expect(skipped).toEqual([{ path: 'a/b/c/d.md', reason: 'too_deep' }]);
  });

  it('skips a body over the cap by name', () => {
    const { pages, skipped } = planImport([file('big.md', 'x'.repeat(200_001))]);

    expect(pages).toEqual([]);
    expect(skipped[0]?.reason).toBe('body_too_long');
  });

  /**
   * **A wrapping folder becomes a page rather than being guessed away**, and the
   * test states it because the tempting behaviour is the other one.
   *
   * Zipping an unpacked export wraps it in the folder's name, and detecting the
   * single shared top-level directory would remove it — but that shape is
   * indistinguishable from `runbooks/deploy.md`, where the directory is a page
   * with a child. No rule over paths can tell them apart, so neither is guessed
   * at: a wrapper you did not want is a page you can see and delete, where a
   * wrong strip silently moves everything up a level. Slice 15's rule about the
   * holiday calendar, applied to a folder.
   */
  it('makes a page of a wrapping folder rather than guessing it away', () => {
    const { pages } = planImport([
      file('handbook-export/handbook.md'),
      file('handbook-export/handbook/onboarding.md'),
    ]);

    expect(pages.map((page) => page.path)).toEqual([
      'handbook-export',
      'handbook-export/handbook',
      'handbook-export/handbook/onboarding',
    ]);
  });

  it('keeps two top-level folders apart', () => {
    const { pages } = planImport([file('a/one.md'), file('b/two.md')]);
    expect(pages.map((page) => page.path)).toEqual(['a', 'b', 'a/one', 'b/two']);
  });

  it('normalises Windows separators and drops the files nobody asked for', () => {
    const { pages } = planImport([
      file('handbook\\onboarding.md'),
      file('__MACOSX/handbook/._onboarding.md'),
      file('handbook/.DS_Store'),
    ]);

    expect(pages.map((page) => page.path)).toEqual(['handbook', 'handbook/onboarding']);
  });

  /**
   * `..` in an archive path is the classic zip-slip. Nothing here writes to a
   * filesystem, so the harm is different and still real: a path that climbs out
   * of the archive computes a parent that is not in it.
   */
  it('refuses to let a path climb out of the archive', () => {
    const { pages } = planImport([file('../../etc/passwd.md', '# nope')]);
    expect(pages.map((page) => page.path)).toEqual(['etc', 'etc/passwd']);
  });

  describe('titles', () => {
    it('prefers the front matter', () => {
      const { pages } = planImport([
        file('x.md', `${renderFrontMatter({ title: 'Leave policy' })}\n# Something else\n`),
      ]);
      expect(pages[0]?.title).toBe('Leave policy');
    });

    it('falls back to a leading heading, then to the filename', () => {
      expect(planImport([file('x.md', '# From the heading')]).pages[0]?.title).toBe(
        'From the heading',
      );
      expect(planImport([file('day-one.md', 'no heading')]).pages[0]?.title).toBe('Day one');
    });

    it('keeps a Khmer title as itself', () => {
      const { pages } = planImport([
        file('a.md', `${renderFrontMatter({ title: 'គោលការណ៍ឈប់សម្រាក' })}\nfoo`),
      ]);
      expect(pages[0]?.title).toBe('គោលការណ៍ឈប់សម្រាក');
    });
  });

  it('reads the template flag out of the front matter', () => {
    const { pages } = planImport([
      file('incident.md', `${renderFrontMatter({ title: 'Incident', template: true })}\nbody`),
      file('other.md', `${renderFrontMatter({ title: 'Other' })}\nbody`),
    ]);

    expect(pages.map((page) => page.isTemplate)).toEqual([true, false]);
  });

  /**
   * The round trip, at the level this module can prove it: the paths `pagePath`
   * writes are the paths `planImport` reads back into the same tree. The
   * database half — that the pages land, in that shape, in an empty workspace —
   * is `__tenancy__/wiki-transfer.test.ts`.
   */
  it('reads back the tree that pagePath wrote', () => {
    const exported = [
      pagePath(['handbook']),
      pagePath(['handbook', 'onboarding']),
      pagePath(['handbook', 'onboarding', 'day-one']),
      pagePath(['runbooks']),
    ];

    const { pages, skipped } = planImport(exported.map((path) => file(path, '# x')));

    expect(skipped).toEqual([]);
    expect(pages.map((page) => [page.path, page.parentPath])).toEqual([
      ['handbook', null],
      ['runbooks', null],
      ['handbook/onboarding', 'handbook'],
      ['handbook/onboarding/day-one', 'handbook/onboarding'],
    ]);
  });
});
