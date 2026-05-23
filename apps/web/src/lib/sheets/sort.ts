import type { Cell, Sheet, SheetRange } from '@/schemas/workbook';
import { rcToA1 } from './a1';

export type SortDir = 'asc' | 'desc';

interface SortOptions {
  /** Column index to sort by (sheet-absolute, not range-relative). */
  byCol: number;
  /** Sort direction. */
  dir: SortDir;
  /** Range to sort. When omitted, the entire used range of the sheet. */
  range?: SheetRange;
  /** Treat the first row as a header that should stay in place. */
  hasHeader?: boolean;
}

/**
 * Sort a range (or the whole sheet's used range) by the values in one column.
 *
 * Behavior choices:
 * - Empty cells sort to the end regardless of direction (Excel/Sheets convention).
 * - Numbers sort numerically; strings sort case-insensitively; numbers come
 *   before strings (Sheets convention).
 * - Errors stay at their position relative to other errors but sort to the
 *   very end of the value list.
 * - Formulas are moved with their row; relative refs are NOT shifted (this
 *   matches Sheets — sort moves the source text, the formula re-evaluates
 *   from its new position). If formulas need to follow sorted data, users
 *   should anchor refs with `$`.
 */
export function sortSheet(sheet: Sheet, opts: SortOptions): Sheet {
  const range = opts.range ?? computeUsedRange(sheet);
  if (!range) return sheet;

  const startRow = opts.hasHeader ? range.r1 + 1 : range.r1;
  if (startRow > range.r2) return sheet;

  // Materialize the rows-to-sort, snapshotting every cell in the range so
  // we can rewrite cleanly even if many keys are sparse.
  const cells = sheet.cells ?? {};
  type RowBundle = {
    sortKey: unknown;
    cells: Record<number, Cell>; // col offset within range -> cell
  };
  const bundles: RowBundle[] = [];
  for (let r = startRow; r <= range.r2; r++) {
    const bundle: RowBundle = { sortKey: undefined, cells: {} };
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = cells[rcToA1(r, c)];
      if (cell) bundle.cells[c - range.c1] = cell;
    }
    const keyCell = bundle.cells[opts.byCol - range.c1];
    bundle.sortKey = keyCell?.f ? keyCell.v : keyCell?.v;
    bundles.push(bundle);
  }

  const sign = opts.dir === 'asc' ? 1 : -1;
  bundles.sort((a, b) => sign * compareValues(a.sortKey, b.sortKey));

  // Write back: clear the old range first, then place sorted bundles starting
  // at startRow. Cells outside the range and the header row (if any) are
  // untouched.
  const nextCells: Record<string, Cell> = { ...cells };
  for (let r = startRow; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      delete nextCells[rcToA1(r, c)];
    }
  }
  bundles.forEach((bundle, i) => {
    const targetRow = startRow + i;
    for (const [offsetStr, cell] of Object.entries(bundle.cells)) {
      const c = range.c1 + Number(offsetStr);
      nextCells[rcToA1(targetRow, c)] = cell;
    }
  });

  return { ...sheet, cells: nextCells };
}

/**
 * Compute the bounding box of all non-empty cells. Returns null if the sheet
 * is empty. Used as the implicit range for "Sort sheet" commands.
 */
export function computeUsedRange(sheet: Sheet): SheetRange | null {
  const cells = sheet.cells ?? {};
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (const key of Object.keys(cells)) {
    const m = key.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    let col = 0;
    for (let i = 0; i < m[1].length; i++)
      col = col * 26 + (m[1].charCodeAt(i) - 64);
    col -= 1;
    const row = parseInt(m[2], 10) - 1;
    if (row < r1) r1 = row;
    if (row > r2) r2 = row;
    if (col < c1) c1 = col;
    if (col > c2) c2 = col;
  }
  if (r1 === Infinity) return null;
  return { r1, c1, r2, c2 };
}

function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empties to end
  if (bEmpty) return -1;

  const aErr = typeof a === 'string' && a.startsWith('#') && a.endsWith('!');
  const bErr = typeof b === 'string' && b.startsWith('#') && b.endsWith('!');
  if (aErr && bErr) return 0;
  if (aErr) return 1;
  if (bErr) return -1;

  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return (a as number) - (b as number);
  // Numbers sort before strings (Google Sheets convention).
  if (aNum) return -1;
  if (bNum) return 1;

  // Booleans: false < true, both sort after numbers but before strings.
  const aBool = typeof a === 'boolean';
  const bBool = typeof b === 'boolean';
  if (aBool && bBool) return Number(a) - Number(b);
  if (aBool) return -1;
  if (bBool) return 1;

  const aStr = String(a).toLocaleLowerCase();
  const bStr = String(b).toLocaleLowerCase();
  return aStr.localeCompare(bStr);
}
