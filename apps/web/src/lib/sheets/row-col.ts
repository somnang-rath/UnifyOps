import { a1Col, a1ToRC, rcToA1 } from './a1';
import type { Cell, Sheet } from '@/schemas/workbook';

type RC = { r: number; c: number };
type RefMap = (rc: RC) => RC | 'REF';

function insertRowMap(atRow: number): RefMap {
  return ({ r, c }) => (r >= atRow ? { r: r + 1, c } : { r, c });
}
function deleteRowMap(atRow: number): RefMap {
  return ({ r, c }) =>
    r === atRow ? 'REF' : r > atRow ? { r: r - 1, c } : { r, c };
}
function insertColMap(atCol: number): RefMap {
  return ({ r, c }) => (c >= atCol ? { r, c: c + 1 } : { r, c });
}
function deleteColMap(atCol: number): RefMap {
  return ({ r, c }) =>
    c === atCol ? 'REF' : c > atCol ? { r, c: c - 1 } : { r, c };
}

/**
 * Transform every cell reference in a formula, including the endpoints
 * of `A1:B5` ranges. Skips refs inside string literals. If a ref hits a
 * deleted row/column, it (or the whole range) collapses to `#REF!`.
 */
export function transformFormulaForRowCol(src: string, map: RefMap): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '"') {
          out += src[i] + src[i + 1];
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < src.length) {
        out += src[i];
        i++;
      }
      continue;
    }
    const prev = i > 0 ? src[i - 1] : '';
    const isWordBoundary = !/[A-Za-z0-9_]/.test(prev);
    if (isWordBoundary) {
      const m = src.slice(i).match(/^([A-Z]+)(\d+)/);
      if (m) {
        const after = src[i + m[0].length] ?? '';
        // Skip if it's followed by '(', meaning it's a function name like LOG10().
        if (after !== '(') {
          const a: RC = { c: a1Col(m[1]), r: parseInt(m[2], 10) - 1 };
          // Range?
          if (after === ':') {
            const next = src
              .slice(i + m[0].length + 1)
              .match(/^([A-Z]+)(\d+)/);
            if (next) {
              const b: RC = {
                c: a1Col(next[1]),
                r: parseInt(next[2], 10) - 1,
              };
              const na = map(a);
              const nb = map(b);
              if (na === 'REF' || nb === 'REF') {
                out += '#REF!';
              } else {
                out += rcToA1(na.r, na.c) + ':' + rcToA1(nb.r, nb.c);
              }
              i += m[0].length + 1 + next[0].length;
              continue;
            }
          }
          // Single ref
          const na = map(a);
          if (na === 'REF') out += '#REF!';
          else out += rcToA1(na.r, na.c);
          i += m[0].length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

function rewriteCells(
  cells: Record<string, Cell>,
  map: RefMap,
  isDelete: boolean,
): Record<string, Cell> {
  const next: Record<string, Cell> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const rc = a1ToRC(key);
    if (!rc) continue;
    const newRC = map(rc);
    if (newRC === 'REF') {
      if (isDelete) continue; // cell sits on deleted row/col → drop it
      continue;
    }
    const newKey = rcToA1(newRC.r, newRC.c);
    if (cell.f) {
      const newF = transformFormulaForRowCol(cell.f, map);
      next[newKey] = { ...cell, f: newF, v: newF };
    } else {
      next[newKey] = cell;
    }
  }
  return next;
}

function rewriteRowHeights(
  rowHeights: Record<string, number>,
  atRow: number,
  delta: 1 | -1,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(rowHeights)) {
    const r = parseInt(k, 10);
    if (delta === -1 && r === atRow) continue;
    const newR =
      delta === 1
        ? r >= atRow
          ? r + 1
          : r
        : r > atRow
          ? r - 1
          : r;
    next[String(newR)] = v;
  }
  return next;
}

function rewriteColWidths(
  colWidths: Record<string, number>,
  atCol: number,
  delta: 1 | -1,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(colWidths)) {
    const c = a1Col(k);
    if (delta === -1 && c === atCol) continue;
    const newC =
      delta === 1
        ? c >= atCol
          ? c + 1
          : c
        : c > atCol
          ? c - 1
          : c;
    const colA1k = colA1FromIndex(newC);
    next[colA1k] = v;
  }
  return next;
}

// Inverse of a1Col → letters (re-used from a1.ts colA1 but inlined to avoid a circular re-import).
function colA1FromIndex(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function insertRow(sheet: Sheet, atRow: number): Sheet {
  const map = insertRowMap(atRow);
  return {
    ...sheet,
    rowCount: sheet.rowCount + 1,
    cells: rewriteCells(sheet.cells ?? {}, map, false),
    rowHeights: rewriteRowHeights(sheet.rowHeights ?? {}, atRow, 1),
  };
}

export function deleteRow(sheet: Sheet, atRow: number): Sheet {
  if (sheet.rowCount <= 1) return sheet;
  const map = deleteRowMap(atRow);
  return {
    ...sheet,
    rowCount: sheet.rowCount - 1,
    cells: rewriteCells(sheet.cells ?? {}, map, true),
    rowHeights: rewriteRowHeights(sheet.rowHeights ?? {}, atRow, -1),
  };
}

export function insertCol(sheet: Sheet, atCol: number): Sheet {
  const map = insertColMap(atCol);
  return {
    ...sheet,
    colCount: sheet.colCount + 1,
    cells: rewriteCells(sheet.cells ?? {}, map, false),
    colWidths: rewriteColWidths(sheet.colWidths ?? {}, atCol, 1),
  };
}

export function deleteCol(sheet: Sheet, atCol: number): Sheet {
  if (sheet.colCount <= 1) return sheet;
  const map = deleteColMap(atCol);
  return {
    ...sheet,
    colCount: sheet.colCount - 1,
    cells: rewriteCells(sheet.cells ?? {}, map, true),
    colWidths: rewriteColWidths(sheet.colWidths ?? {}, atCol, -1),
  };
}
