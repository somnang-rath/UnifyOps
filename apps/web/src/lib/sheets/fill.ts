import { a1Col, normalizeRange, rcToA1 } from './a1';
import type { Cell, Sheet } from '@/schemas/workbook';

export type FillDir = 'up' | 'down' | 'left' | 'right';

export function detectFillDir(
  source: { r1: number; c1: number; r2: number; c2: number },
  target: { r1: number; c1: number; r2: number; c2: number },
): FillDir | null {
  if (target.r2 > source.r2) return 'down';
  if (target.r1 < source.r1) return 'up';
  if (target.c2 > source.c2) return 'right';
  if (target.c1 < source.c1) return 'left';
  return null;
}

/**
 * Shift relative cell references in a formula by (dr, dc), skipping
 * over string literals so `="A1 cost"` won't be mangled.
 */
export function shiftFormula(src: string, dr: number, dc: number): string {
  if (dr === 0 && dc === 0) return src;
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
    // Match cell ref like "A1" or "AB12" — only when not preceded by a word char
    const prev = i > 0 ? src[i - 1] : '';
    const isWordBoundary = !/[A-Za-z0-9_]/.test(prev);
    if (isWordBoundary) {
      const m = src.slice(i).match(/^([A-Z]+)(\d+)/);
      if (m) {
        // Skip if followed by `(` (function call like LOG10()) or by digits/letters that would make it not a ref
        const next = src[i + m[0].length] ?? '';
        if (next !== '(') {
          const col = a1Col(m[1]);
          const row = parseInt(m[2], 10) - 1;
          const newCol = col + dc;
          const newRow = row + dr;
          if (newCol < 0 || newRow < 0) {
            out += '#REF!';
          } else {
            out += rcToA1(newRow, newCol);
          }
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

/**
 * Produce the cell changes needed to fill `target` from `source`.
 * The output map's null values represent cells that should be cleared.
 */
export function applyFill(
  sheet: Sheet,
  source: { r1: number; c1: number; r2: number; c2: number },
  target: { r1: number; c1: number; r2: number; c2: number },
): Record<string, Cell | null> {
  const out: Record<string, Cell | null> = {};
  const dir = detectFillDir(source, target);
  if (!dir) return out;

  const cells = sheet.cells ?? {};
  // Vertical fill (down/up): each source column becomes the template.
  if (dir === 'down' || dir === 'up') {
    const sRows = source.r2 - source.r1 + 1;
    const cStart = Math.max(source.c1, target.c1);
    const cEnd = Math.min(source.c2, target.c2);
    for (let c = cStart; c <= cEnd; c++) {
      const sourceValues: (Cell | undefined)[] = [];
      for (let r = source.r1; r <= source.r2; r++) {
        sourceValues.push(cells[rcToA1(r, c)]);
      }
      if (dir === 'down') {
        for (let r = source.r2 + 1; r <= target.r2; r++) {
          const stepFromSource = r - source.r1; // distance from top of source
          const cell = pickFillCell(sourceValues, stepFromSource, sRows, 1, 0);
          out[rcToA1(r, c)] = cell;
        }
      } else {
        for (let r = source.r1 - 1; r >= target.r1; r--) {
          // distance below (negative direction)
          const stepFromSource = r - source.r1;
          const cell = pickFillCell(sourceValues, stepFromSource, sRows, 1, 0);
          out[rcToA1(r, c)] = cell;
        }
      }
    }
    return out;
  }

  // Horizontal fill (left/right): each source row is the template.
  const sCols = source.c2 - source.c1 + 1;
  const rStart = Math.max(source.r1, target.r1);
  const rEnd = Math.min(source.r2, target.r2);
  for (let r = rStart; r <= rEnd; r++) {
    const sourceValues: (Cell | undefined)[] = [];
    for (let c = source.c1; c <= source.c2; c++) {
      sourceValues.push(cells[rcToA1(r, c)]);
    }
    if (dir === 'right') {
      for (let c = source.c2 + 1; c <= target.c2; c++) {
        const stepFromSource = c - source.c1;
        const cell = pickFillCell(sourceValues, stepFromSource, sCols, 0, 1);
        out[rcToA1(r, c)] = cell;
      }
    } else {
      for (let c = source.c1 - 1; c >= target.c1; c--) {
        const stepFromSource = c - source.c1;
        const cell = pickFillCell(sourceValues, stepFromSource, sCols, 0, 1);
        out[rcToA1(r, c)] = cell;
      }
    }
  }
  return out;
}

/**
 * Compute the cell at `stepFromSource` (0-indexed offset from source start)
 * by either extending a numeric series, shifting a formula, or cycling.
 */
function pickFillCell(
  sourceValues: (Cell | undefined)[],
  stepFromSource: number,
  sourceLen: number,
  axisDr: 0 | 1,
  axisDc: 0 | 1,
): Cell | null {
  // Empty source → empty target
  if (sourceValues.every((c) => !c || (c.v == null && !c.f))) return null;

  const sourceIndex =
    ((stepFromSource % sourceLen) + sourceLen) % sourceLen;
  const src = sourceValues[sourceIndex];

  // If the source position has a formula, shift it.
  if (src?.f) {
    const totalOffset = stepFromSource - sourceIndex; // multiple of sourceLen
    return {
      f: shiftFormula(src.f, totalOffset * axisDr, totalOffset * axisDc),
      ...(src.s ? { s: src.s } : {}),
    };
  }

  // Numeric series: only if every source cell has a number value.
  const allNumeric = sourceValues.every(
    (c) => c && typeof c.v === 'number',
  );
  if (allNumeric && sourceLen >= 2) {
    const first = sourceValues[0]!.v as number;
    const last = sourceValues[sourceLen - 1]!.v as number;
    const step = (last - first) / (sourceLen - 1);
    const value = first + step * stepFromSource;
    return { v: roundForDisplay(value), ...(src?.s ? { s: src.s } : {}) };
  }

  // Otherwise cycle: just copy source[sourceIndex].
  if (!src) return null;
  return {
    ...(src.v != null ? { v: src.v } : {}),
    ...(src.s ? { s: src.s } : {}),
  };
}

function roundForDisplay(n: number): number {
  // Avoid floating drift like 0.1 + 0.2 = 0.30000000000000004
  return Math.round(n * 1e10) / 1e10;
}

export function isCellEmpty(c: Cell | null | undefined): boolean {
  if (!c) return true;
  if (c.f) return false;
  if (c.v != null && c.v !== '') return false;
  if (c.s && Object.keys(c.s).length > 0) return false;
  return true;
}

// Re-export so importers don't reach into a1.ts
export { normalizeRange };
