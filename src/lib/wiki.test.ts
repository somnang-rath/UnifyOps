import { describe, expect, it } from 'vitest';
import {
  buildPageTree,
  checkMove,
  diffLines,
  diffSummary,
  MAX_PAGE_BODY_LENGTH,
  MAX_PAGE_DEPTH,
  normalizePageTitle,
  pageSlug,
  reorderPositions,
  subtreeHeight,
  subtreeIds,
  validatePage,
  type TreePage,
} from './wiki';

/**
 * The pure half of slice 18.
 *
 * Everything here runs on both sides — the editor derives a slug and counts a
 * body as somebody types, the server derives the same slug and applies the same
 * cap on save — so a disagreement between the two is a bug this file is the
 * cheapest place to catch.
 */

const page = (
  id: string,
  parentId: string | null,
  position = 0,
  title = id,
): TreePage => ({ id, parentId, title, slug: id, position });

describe('validatePage', () => {
  it('requires a title and allows an empty body', () => {
    // The opposite of a note, and deliberately (§20.11): "an empty page reads as
    // empty, not as broken" — a placeholder for next week's writing is a real
    // page, reachable in the sidebar by its title.
    expect(validatePage({ title: 'Leave policy', body: '' })).toBeNull();
    expect(validatePage({ title: '   ', body: 'anything' })).toBe('title_required');
  });

  /**
   * §13, and slice 10's rule pointed the same way: `[...text].length` gives a
   * Khmer workspace roughly a third of the field an English one gets, silently,
   * and refuses text that fits.
   */
  it('counts the body cap by grapheme, not by code point', () => {
    // One Khmer syllable, several code points.
    const syllable = 'ស្រ';
    expect(syllable.length).toBeGreaterThan(1);

    const body = syllable.repeat(MAX_PAGE_BODY_LENGTH);
    expect(body.length).toBeGreaterThan(MAX_PAGE_BODY_LENGTH);
    // At the cap by grapheme, so it is accepted — a code-point count would have
    // refused text that fits.
    expect(validatePage({ title: 'ក', body })).toBeNull();

    expect(validatePage({ title: 'ក', body: syllable.repeat(MAX_PAGE_BODY_LENGTH + 1) })).toBe(
      'body_too_long',
    );
  });

  it('refuses a page below the depth cap only when a depth is offered', () => {
    expect(validatePage({ title: 'x', body: '', depth: MAX_PAGE_DEPTH })).toBeNull();
    expect(validatePage({ title: 'x', body: '', depth: MAX_PAGE_DEPTH + 1 })).toBe('too_deep');
    // No depth given is the create-at-root case, not an implicit zero.
    expect(validatePage({ title: 'x', body: '' })).toBeNull();
  });
});

describe('normalizePageTitle', () => {
  it('collapses whitespace and normalises to NFC', () => {
    expect(normalizePageTitle('  Leave   policy \n')).toBe('Leave policy');
    // Two representations of one Khmer string have to compare equal, or a
    // "duplicate" title is one nobody can see the difference between.
    expect(normalizePageTitle('é').normalize('NFC')).toBe(normalizePageTitle('é'));
  });
});

describe('pageSlug', () => {
  it('derives a slug from the title', () => {
    expect(pageSlug('Leave policy', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('leave-policy');
  });

  /**
   * A title that romanises to nothing still gets a page, because refusing it
   * would be the product declining to store a title it renders perfectly well.
   * The id is unique, so the fallback cannot collide.
   */
  it('falls back to the id when a title romanises to nothing', () => {
    const slug = pageSlug('🎉', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(slug).toBe('page-aaaaaaaa');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('buildPageTree', () => {
  it('nests children under their parents, in sibling order', () => {
    const tree = buildPageTree([
      page('b', null, 1),
      page('a', null, 0),
      page('a2', 'a', 1),
      page('a1', 'a', 0),
    ]);

    expect(tree.map((node) => node.page.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((node) => node.page.id)).toEqual(['a1', 'a2']);
    expect(tree[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.depth).toBe(2);
  });

  /**
   * A page whose parent is missing is promoted rather than dropped.
   *
   * The parent may have been soft-deleted, and a page that vanishes from the
   * sidebar because of somebody else's delete is a page whose author thinks
   * their work is gone. Showing it at the top is wrong about its place and right
   * about its existence, which is the better of the two errors.
   */
  it('promotes an orphan to a root rather than dropping it', () => {
    const tree = buildPageTree([page('child', 'gone')]);
    expect(tree.map((node) => node.page.id)).toEqual(['child']);
  });

  /**
   * Impossible in the database — 0032's trigger refuses a cycle — but this also
   * runs in the browser against whatever the last response happened to contain,
   * so it has to be total for any input rather than only for correct input.
   */
  it('terminates on a cycle instead of recursing for ever', () => {
    const tree = buildPageTree([page('a', 'b'), page('b', 'a')]);
    expect(tree).toEqual([]);
  });

  it('sorts equal positions by title so an import reads alphabetically', () => {
    const tree = buildPageTree([page('z', null, 0, 'Zebra'), page('a', null, 0, 'Apple')]);
    expect(tree.map((node) => node.page.title)).toEqual(['Apple', 'Zebra']);
  });
});

describe('subtreeIds and subtreeHeight', () => {
  const pages = [page('a', null), page('b', 'a'), page('c', 'b'), page('other', null)];

  it('collects a subtree including its root', () => {
    expect(subtreeIds(pages, 'a').sort()).toEqual(['a', 'b', 'c']);
    expect(subtreeIds(pages, 'b').sort()).toEqual(['b', 'c']);
  });

  it('measures how tall a subtree is, counting its root as one', () => {
    expect(subtreeHeight(pages, 'a')).toBe(3);
    expect(subtreeHeight(pages, 'b')).toBe(2);
    expect(subtreeHeight(pages, 'c')).toBe(1);
  });
});

describe('checkMove', () => {
  const pages = [page('a', null), page('b', 'a'), page('c', 'b'), page('other', null)];

  it('allows a move to the root', () => {
    expect(checkMove(pages, 'b', null)).toBeNull();
  });

  it('refuses a move into the page itself or into its own descendant', () => {
    expect(checkMove(pages, 'a', 'a')).toBe('into_descendant');
    expect(checkMove(pages, 'a', 'b')).toBe('into_descendant');
    expect(checkMove(pages, 'a', 'c')).toBe('into_descendant');
  });

  /**
   * The check is against the *height* of what is being moved, not just the page
   * — moving a two-level subtree under a page at depth 2 would put its leaves at
   * depth 4, and §20.4 caps at 3.
   */
  it('refuses a move that would push the subtree past the depth cap', () => {
    // `b` is one level deep with `c` under it: height 2. Under `other` (depth 1)
    // that lands `c` at depth 3, which fits exactly.
    expect(checkMove(pages, 'b', 'other')).toBeNull();
    // `a` has height 3 and would need depths 2, 3 and 4 under `other`.
    expect(checkMove(pages, 'a', 'other')).toBe('too_deep');
  });
});

describe('reorderPositions', () => {
  it('rewrites the block, so no two siblings share a position', () => {
    expect(reorderPositions(['c', 'a', 'b'])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });
});

describe('diffLines', () => {
  it('reports unchanged lines once, with both line numbers', () => {
    const lines = diffLines('one\ntwo', 'one\ntwo');
    expect(lines.map((line) => line.op)).toEqual(['same', 'same']);
    expect(lines[1]).toMatchObject({ before: 2, after: 2 });
  });

  it('reports an insertion as added, with no line number on the old side', () => {
    const lines = diffLines('one\nthree', 'one\ntwo\nthree');
    const added = lines.filter((line) => line.op === 'added');
    expect(added.map((line) => line.text)).toEqual(['two']);
    expect(added[0]?.before).toBeNull();
  });

  /**
   * Removals before additions at the same point, so a changed line reads as the
   * old one struck through above the new one — the order every review tool has
   * trained people to expect.
   */
  it('puts a removal before the addition that replaced it', () => {
    const lines = diffLines('old', 'new');
    expect(lines.map((line) => line.op)).toEqual(['removed', 'added']);
  });

  /**
   * §13: a line is a unit both scripts have. A *word* diff of a script with no
   * inter-word spaces is a diff of one enormous word, which is why the
   * sophisticated version would be the one that degrades in Khmer.
   */
  it('diffs Khmer lines as lines', () => {
    const lines = diffLines('ការងារ\nសួស្ដី', 'ការងារ\nលាហើយ');
    expect(lines.map((line) => line.op)).toEqual(['same', 'removed', 'added']);
  });

  it('summarises what moved', () => {
    expect(diffSummary(diffLines('a\nb\nc', 'a\nx\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });

  /**
   * The LCS matrix is O(n·m), so two bodies at the grapheme cap would be tens of
   * millions of cells built to draw a screen nobody would read. Over the bound
   * the two versions are reported as wholly replaced, which is both true and the
   * only honest thing a compare can say about bodies that far apart.
   */
  it('falls back to a wholesale replacement over the line bound', () => {
    const huge = Array.from({ length: 3_001 }, (_, index) => `line ${index}`).join('\n');
    const lines = diffLines(huge, huge);
    expect(lines.some((line) => line.op === 'same')).toBe(false);
    expect(lines.filter((line) => line.op === 'removed')).toHaveLength(3_001);
    expect(lines.filter((line) => line.op === 'added')).toHaveLength(3_001);
  });
});
