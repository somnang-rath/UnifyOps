import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_COLUMNS,
  MAX_COLUMN_WIDTH,
  MAX_VIEW_NAME_LENGTH,
  MAX_VIEWS_PER_MEMBER,
  MIN_COLUMN_WIDTH,
  clampWidth,
  customColumn,
  defaultTableLayout,
  defaultWidthOf,
  isTableColumn,
  nameLength,
  parseTableLayout,
  resolveColumns,
  sameQuery,
  validateSavedView,
} from './saved-views';

/**
 * §15 asks for unit tests on the pure logic. Four things here carry weight
 * elsewhere in the product and are pinned accordingly: the grapheme cap (§13 —
 * the same arithmetic that would silently give a Khmer workspace a third of the
 * field), the layout parser's tolerance of rows an older build wrote (§9's
 * "discarding rather than failing", applied to stored data rather than to a
 * URL), the width clamp, and query equivalence — which decides whether the
 * saved view somebody is looking at highlights itself.
 */

const field = '018f8f4a-0000-7000-8000-000000000001';

describe('table columns', () => {
  it('accepts the built-in columns and one custom field', () => {
    expect(isTableColumn('title')).toBe(true);
    expect(isTableColumn('estimate')).toBe(true);
    expect(isTableColumn(customColumn(field))).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTableColumn('description')).toBe(false);
    expect(isTableColumn('custom:')).toBe(false);
    expect(isTableColumn('')).toBe(false);
  });

  it('gives every default column a width', () => {
    for (const column of DEFAULT_TABLE_COLUMNS) {
      expect(defaultWidthOf(column)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    }
    // A custom field has no per-kind default; one width suits all seven.
    expect(defaultWidthOf(customColumn(field))).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });
});

describe('column widths', () => {
  it('clamps to the bounds rather than refusing', () => {
    // A width arrives from a drag: the wrong values are a slip of the wrist,
    // not an attack, and not worth an error message.
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(200)).toBe(200);
  });

  it('rounds a fractional pixel and survives a browser reporting nonsense', () => {
    expect(clampWidth(200.6)).toBe(201);
    expect(clampWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(MIN_COLUMN_WIDTH);
  });
});

describe('parsing a stored layout', () => {
  it('falls back to the defaults when there is nothing stored', () => {
    expect(parseTableLayout(null)).toEqual(defaultTableLayout());
    expect(parseTableLayout(undefined)).toEqual(defaultTableLayout());
    expect(parseTableLayout('not an object')).toEqual(defaultTableLayout());
  });

  it('drops columns and widths it does not recognise', () => {
    const parsed = parseTableLayout({
      columns: ['title', 'nonsense', 'state', 42],
      widths: { title: 300, nonsense: 200, state: 'wide' },
    });

    expect(parsed.columns).toEqual(['title', 'state']);
    expect(parsed.widths).toEqual({ title: 300 });
  });

  it('de-duplicates a column listed twice', () => {
    expect(parseTableLayout({ columns: ['title', 'title', 'state'] }).columns).toEqual([
      'title',
      'state',
    ]);
  });

  it('clamps a stored width that is out of bounds', () => {
    expect(parseTableLayout({ columns: ['title'], widths: { title: 5000 } }).widths.title).toBe(
      MAX_COLUMN_WIDTH,
    );
  });

  it('never yields a table with no columns', () => {
    // A screen with no columns is a screen with no way to get its columns back.
    const parsed = parseTableLayout({ columns: ['nonsense'], widths: { title: 300 } });
    expect(parsed.columns).toEqual([...DEFAULT_TABLE_COLUMNS]);
    expect(parsed.widths).toEqual({ title: 300 });
  });
});

describe('resolving columns against a project', () => {
  it('keeps a custom column whose field still exists', () => {
    const layout = { columns: ['title', customColumn(field)], widths: {} };
    expect(resolveColumns(layout, [field])).toEqual(['title', customColumn(field)]);
  });

  it('drops a custom column whose field was deleted', () => {
    const layout = { columns: ['title', customColumn(field)], widths: {} };
    expect(resolveColumns(layout, [])).toEqual(['title']);
  });

  it('falls back to the defaults if nothing survives', () => {
    const layout = { columns: [customColumn(field)], widths: {} };
    expect(resolveColumns(layout, [])).toEqual([...DEFAULT_TABLE_COLUMNS]);
  });
});

describe('validating a saved view', () => {
  it('requires a name that is not only whitespace', () => {
    expect(validateSavedView({ name: '', query: '' })).toBe('name_required');
    expect(validateSavedView({ name: '   ', query: '' })).toBe('name_required');
  });

  it('accepts an ordinary name and query', () => {
    expect(validateSavedView({ name: 'Overdue, mine', query: 'd=overdue' })).toBeNull();
  });

  /**
   * §13, and the defect slice 10 found in its own field names: `[...text].length`
   * counts code points, and one Khmer syllable is routinely three or four of
   * them — so a code-point cap silently gives a Khmer workspace roughly a third
   * of the field an English one gets, and refuses names that fit.
   */
  it('counts the name by grapheme, not by code point', () => {
    const khmer = 'ការងារហួសកំណត់';
    expect(nameLength(khmer)).toBeLessThan([...khmer].length);
    expect(validateSavedView({ name: khmer, query: '' })).toBeNull();
  });

  it('refuses a name past the cap, measured the same way', () => {
    const long = 'a'.repeat(MAX_VIEW_NAME_LENGTH + 1);
    expect(validateSavedView({ name: long, query: '' })).toBe('name_too_long');
    expect(validateSavedView({ name: 'a'.repeat(MAX_VIEW_NAME_LENGTH), query: '' })).toBeNull();
  });

  it('refuses a query too long to store', () => {
    expect(validateSavedView({ name: 'View', query: 'x'.repeat(5000) })).toBe('query_too_long');
  });

  it('refuses one view past the limit', () => {
    expect(
      validateSavedView({ name: 'View', query: '', existingCount: MAX_VIEWS_PER_MEMBER }),
    ).toBe('too_many');
    expect(
      validateSavedView({ name: 'View', query: '', existingCount: MAX_VIEWS_PER_MEMBER - 1 }),
    ).toBeNull();
  });
});

describe('recognising the query on screen', () => {
  it('ignores parameter order', () => {
    // Both are produced by the same serialiser, but one may have been stored by
    // a build that emitted them in a different order — and a saved view that
    // quietly stops highlighting itself is a bug nobody would think to look for.
    expect(sameQuery('d=overdue&by=state', 'by=state&d=overdue')).toBe(true);
  });

  it('ignores a leading question mark', () => {
    expect(sameQuery('?d=overdue', 'd=overdue')).toBe(true);
  });

  it('still tells two different queries apart', () => {
    expect(sameQuery('d=overdue', 'd=today')).toBe(false);
    expect(sameQuery('d=overdue', 'd=overdue&view=table')).toBe(false);
  });

  it('treats the empty query and the empty string as the same view', () => {
    expect(sameQuery('', '?')).toBe(true);
  });

  it('does not confuse two values of one repeated parameter', () => {
    // `cf` is the one repeated parameter (§6-4), and sorting has to keep both.
    expect(sameQuery('cf=a&cf=b', 'cf=b&cf=a')).toBe(true);
    expect(sameQuery('cf=a&cf=b', 'cf=a')).toBe(false);
  });
});
