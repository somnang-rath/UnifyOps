import type {
  Cell,
  Sheet,
  SheetFilter,
  SheetFilterCriterion,
} from '@/schemas/workbook';
import { computeSheet } from './formula';
import { rcToA1 } from './a1';

/**
 * A row passes the filter iff every column-criterion accepts the value in
 * that row's cell. Each criterion supports a small set of operators that
 * cover common Excel/Sheets filter UX:
 *
 *   - `in`        : value list, used by the value-picker (default UX)
 *   - `text:contains`, `text:notContains`, `text:eq`, `text:starts`, `text:ends`
 *   - `num:gt`, `num:ge`, `num:lt`, `num:le`, `num:eq`, `num:between`
 *   - `blank`     : matches empty/null cells
 *   - `notBlank`  : matches non-empty cells
 *
 * Cells with formulas are evaluated through `computeSheet` so the filter
 * matches the displayed value, not the formula source.
 */
export function computeFilteredOutRows(sheet: Sheet): number[] {
  const filter = sheet.filter;
  if (!filter) return [];

  const { range, criteria } = filter;
  const colKeys = Object.keys(criteria ?? {});
  if (colKeys.length === 0) return [];

  // Pre-compute formula values so the filter sees what the user sees.
  const computed = computeSheet(sheet);
  const out: number[] = [];

  // The first row of the filter range is treated as a header and stays visible.
  for (let r = range.r1 + 1; r <= range.r2; r++) {
    let pass = true;
    for (const colStr of colKeys) {
      const c = Number(colStr);
      if (!Number.isInteger(c)) continue;
      const cell = sheet.cells?.[rcToA1(r, c)];
      const value = readCellValue(cell, rcToA1(r, c), computed);
      const crit = criteria[colStr];
      if (!matches(value, crit)) {
        pass = false;
        break;
      }
    }
    if (!pass) out.push(r);
  }
  return out;
}

function readCellValue(
  cell: Cell | undefined,
  a1: string,
  computed: Record<string, unknown>,
): unknown {
  if (!cell) return null;
  if (cell.f) return computed[a1];
  return cell.v ?? null;
}

function matches(value: unknown, crit: SheetFilterCriterion): boolean {
  const op = crit?.op ?? 'in';

  if (op === 'blank') return value == null || value === '';
  if (op === 'notBlank') return value != null && value !== '';

  if (op === 'in') {
    const list = (crit.value as unknown[] | undefined) ?? [];
    if (list.length === 0) return true;
    // Compare via normalized text so numbers/strings line up with the
    // value-picker UI, which renders one chip per displayed value.
    const target = normalize(value);
    return list.some((v) => normalize(v) === target);
  }

  if (op.startsWith('text:')) {
    const target = String(crit.value ?? '').toLocaleLowerCase();
    const text = value == null ? '' : String(value).toLocaleLowerCase();
    switch (op) {
      case 'text:contains':
        return text.includes(target);
      case 'text:notContains':
        return !text.includes(target);
      case 'text:eq':
        return text === target;
      case 'text:starts':
        return text.startsWith(target);
      case 'text:ends':
        return text.endsWith(target);
    }
  }

  if (op.startsWith('num:')) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return false;
    const target = Number(crit.value);
    switch (op) {
      case 'num:gt':
        return n > target;
      case 'num:ge':
        return n >= target;
      case 'num:lt':
        return n < target;
      case 'num:le':
        return n <= target;
      case 'num:eq':
        return n === target;
      case 'num:between': {
        const [lo, hi] = (crit.value as [number, number] | undefined) ?? [0, 0];
        return n >= Number(lo) && n <= Number(hi);
      }
    }
  }

  return true;
}

function normalize(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/**
 * Distinct values in a column within the filter range — used by the value
 * picker. Returns the visible (computed) values, deduped and sorted.
 */
export function uniqueValuesInColumn(
  sheet: Sheet,
  col: number,
  range: SheetFilter['range'],
): string[] {
  const computed = computeSheet(sheet);
  const seen = new Set<string>();
  for (let r = range.r1 + 1; r <= range.r2; r++) {
    const a1 = rcToA1(r, col);
    const cell = sheet.cells?.[a1];
    const value = readCellValue(cell, a1, computed);
    seen.add(normalize(value));
  }
  return [...seen].sort((a, b) => {
    if (a === '' && b !== '') return 1; // empty last
    if (b === '' && a !== '') return -1;
    return a.localeCompare(b);
  });
}
