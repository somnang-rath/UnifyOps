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
  verificationExpiry,
  verificationStatus,
  VERIFICATION_DAYS,
  type TreePage,
  normalizePageIcon,
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

/**
 * §21.3's derived state — the rule slice 11 wrote for a cycle, applied to a
 * page.
 *
 * "A stored status needs a job to flip it, a repair after the job was down, and
 * a missed repair is a page that reads as verified forever." These tests are
 * what make the absence of that job safe: the function is total over the two
 * columns and the two dates, so there is no state it cannot name.
 */
describe('verificationStatus', () => {
  const verifiedOn = new Date('2026-03-01T10:00:00Z');

  it('is never for a page nobody has vouched for', () => {
    expect(
      verificationStatus(
        { verifiedAt: null, verificationExpiresAt: null },
        { today: '2026-09-05', warnFrom: '2026-09-14' },
      ),
    ).toBe('never');
  });

  /**
   * The default, and §21.3 requires it to stay one: "Null means *no review
   * cycle*, which is right for most pages and must stay the default." A page
   * verified once with no cycle is a standing claim until somebody edits it —
   * which is `saveWikiPage`'s transition, not this function's.
   */
  it('is verified indefinitely when there is no review cycle', () => {
    expect(
      verificationStatus(
        { verifiedAt: verifiedOn, verificationExpiresAt: null },
        { today: '2030-01-01', warnFrom: '2030-01-09' },
      ),
    ).toBe('verified');
  });

  it('is verified while the expiry is beyond the warning horizon', () => {
    expect(
      verificationStatus(
        { verifiedAt: verifiedOn, verificationExpiresAt: '2026-12-01' },
        { today: '2026-09-05', warnFrom: '2026-09-14' },
      ),
    ).toBe('verified');
  });

  it('turns amber once the expiry is inside the horizon', () => {
    expect(
      verificationStatus(
        { verifiedAt: verifiedOn, verificationExpiresAt: '2026-09-10' },
        { today: '2026-09-05', warnFrom: '2026-09-14' },
      ),
    ).toBe('expiring');
  });

  /** The boundary in both directions, because off-by-one here is a badge that
      never turns amber or one that turns amber a day early, and neither is
      visible without an assertion. */
  it('includes both ends of the horizon', () => {
    const at = (expires: string) =>
      verificationStatus(
        { verifiedAt: verifiedOn, verificationExpiresAt: expires },
        { today: '2026-09-05', warnFrom: '2026-09-14' },
      );

    expect(at('2026-09-05')).toBe('expiring');
    expect(at('2026-09-14')).toBe('expiring');
    expect(at('2026-09-15')).toBe('verified');
    expect(at('2026-09-04')).toBe('expired');
  });

  it('is expired the day after the expiry', () => {
    expect(
      verificationStatus(
        { verifiedAt: verifiedOn, verificationExpiresAt: '2026-09-04' },
        { today: '2026-09-05', warnFrom: '2026-09-14' },
      ),
    ).toBe('expired');
  });

  /**
   * The client may not have a horizon — only the database knows the company's
   * working days (§9). Without one the amber middle collapses into `verified`,
   * which is a true statement rather than a guess, and `expired` still reads
   * correctly because it needs no horizon at all.
   */
  it('degrades to a true statement with no horizon', () => {
    const page = { verifiedAt: verifiedOn, verificationExpiresAt: '2026-09-10' };
    expect(verificationStatus(page, { today: '2026-09-05' })).toBe('verified');
    expect(verificationStatus(page, { today: '2026-09-05', warnFrom: null })).toBe('verified');
    expect(verificationStatus(page, { today: '2026-11-01' })).toBe('expired');
  });
});

describe('verificationExpiry', () => {
  /** §21.3: "what is stored is the resolved date". */
  it('resolves each offered period to a date', () => {
    expect(verificationExpiry('2026-09-05', 90)).toBe('2026-12-04');
    expect(verificationExpiry('2026-09-05', 180)).toBe('2027-03-04');
    expect(verificationExpiry('2026-09-05', 365)).toBe('2027-09-05');
  });

  it('resolves Never to no date at all', () => {
    expect(verificationExpiry('2026-09-05', null)).toBeNull();
  });

  /**
   * Every member of the closed set resolves, which is what stops a period being
   * added to `VERIFICATION_DAYS` without anybody checking it produces a date.
   */
  it('resolves every member of the closed set', () => {
    for (const days of VERIFICATION_DAYS) {
      expect(verificationExpiry('2026-09-05', days)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('normalizePageIcon (§21.2 — slice 20)', () => {
  /**
   * **The grapheme is the unit, and this is the test that says so.** A flag is
   * two code points, a skin-toned emoji three or four, and a joined one more
   * still — all of which a person sees as one character and types with one
   * keystroke. Counting code points would refuse every one of them while
   * accepting four Latin letters, which is §13's arithmetic pointed exactly the
   * wrong way.
   */
  it('accepts a multi-code-point emoji as one icon', () => {
    for (const icon of ['\ud83c\uddf0\ud83c\udded', '\ud83d\udc4d\ud83c\udffd', '\ud83d\udcd8']) {
      expect(normalizePageIcon(icon)).toBe(icon);
      expect([...icon].length).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * Truncates rather than refuses, unlike every other cap in the wiki: an icon
   * is decoration, and somebody who pastes two emoji meant the first one.
   */
  it('keeps the first grapheme when given several', () => {
    expect(normalizePageIcon('\ud83c\udf89\ud83c\udf8a')).toBe('\ud83c\udf89');
  });

  it('reads empty, blank and absent as no icon at all', () => {
    // *No icon* is a value somebody chooses, not a field left blank — the rule
    // `moveWorkItem` wrote for a neighbour id and `setPageOwner` restated.
    expect(normalizePageIcon('')).toBeNull();
    expect(normalizePageIcon('   ')).toBeNull();
    expect(normalizePageIcon(null)).toBeNull();
    expect(normalizePageIcon(undefined)).toBeNull();
  });

  it('normalises to NFC, so two spellings of one character are one string', () => {
    expect(normalizePageIcon('e\u0301')).toBe('\u00e9');
  });

  it('takes one letter, because the field is not policed for being an emoji', () => {
    // Refusing non-emoji would mean shipping an emoji table and keeping it in
    // step with Unicode — for a decorative field where the worst case is a page
    // whose icon is the letter its owner chose.
    expect(normalizePageIcon('A')).toBe('A');
  });
});
