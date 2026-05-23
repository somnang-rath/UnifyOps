import { rcToA1 } from './a1';
import { shiftFormula } from './fill';
import type { Cell, Sheet } from '@/schemas/workbook';

export interface ClipboardData {
  kind: 'copy' | 'cut';
  // Source range, normalized so r1 <= r2 and c1 <= c2
  source: { r1: number; c1: number; r2: number; c2: number };
  sheetId: string;
  // 2D array of cells (rows × cols), undefined where empty
  cells: (Cell | undefined)[][];
}

/**
 * Build an internal clipboard payload from a sheet selection.
 */
export function buildClipboard(
  sheet: Sheet,
  range: { r1: number; c1: number; r2: number; c2: number },
  kind: 'copy' | 'cut',
): ClipboardData {
  const cells: (Cell | undefined)[][] = [];
  const sheetCells = sheet.cells ?? {};
  for (let r = range.r1; r <= range.r2; r++) {
    const row: (Cell | undefined)[] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      row.push(sheetCells[rcToA1(r, c)]);
    }
    cells.push(row);
  }
  return { kind, source: { ...range }, sheetId: sheet.id, cells };
}

/**
 * Serialize the source range to TSV (one row per line, tab-separated values).
 * Formulas are exported as their literal `=...` text so external apps can paste raw.
 */
export function clipboardToTSV(cb: ClipboardData): string {
  return cb.cells
    .map((row) =>
      row
        .map((cell) => {
          if (!cell) return '';
          if (cell.f) return cell.f;
          if (cell.v == null) return '';
          if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE';
          return String(cell.v);
        })
        .join('\t'),
    )
    .join('\n');
}

/**
 * Apply a paste of `cb` onto `sheet` with top-left at (destR, destC).
 * Returns a map of cell changes (null = clear). For "cut", caller should
 * also clear the source range — this function only writes the paste area.
 *
 * If the destination range is larger than the clipboard and is a tile multiple,
 * the clipboard is tiled. Otherwise the clipboard is pasted once at top-left.
 */
export function applyPaste(
  cb: ClipboardData,
  destR: number,
  destC: number,
  destRange?: { r1: number; c1: number; r2: number; c2: number },
  shiftRefs = true,
): Record<string, Cell | null> {
  const sRows = cb.cells.length;
  const sCols = cb.cells[0]?.length ?? 0;
  const out: Record<string, Cell | null> = {};

  // Effective destination rectangle
  let r1 = destR;
  let c1 = destC;
  let r2 = destR + sRows - 1;
  let c2 = destC + sCols - 1;
  if (destRange) {
    const w = destRange.c2 - destRange.c1 + 1;
    const h = destRange.r2 - destRange.r1 + 1;
    if (w % sCols === 0 && h % sRows === 0 && (w > sCols || h > sRows)) {
      r1 = destRange.r1;
      c1 = destRange.c1;
      r2 = destRange.r2;
      c2 = destRange.c2;
    }
  }

  const dr = destR - cb.source.r1;
  const dc = destC - cb.source.c1;

  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const sr = (r - r1) % sRows;
      const sc = (c - c1) % sCols;
      const src = cb.cells[sr]?.[sc];
      const key = rcToA1(r, c);
      if (!src) {
        out[key] = null;
        continue;
      }
      out[key] = shiftRefs ? shiftCellRefs(src, dr, dc) : { ...src };
    }
  }
  return out;
}

function shiftCellRefs(cell: Cell, dr: number, dc: number): Cell {
  const next: Cell = {};
  if (cell.f) {
    next.f = shiftFormula(cell.f, dr, dc);
  } else if (cell.v !== undefined) {
    next.v = cell.v;
  }
  if (cell.s) next.s = cell.s;
  return next;
}

/**
 * Parse CSV (RFC 4180) text into a 2D cell array.
 * Used when importing a .csv file or a Google Sheets CSV export.
 */
export function parseCSV(text: string): (Cell | undefined)[][] {
  const rows = splitCSVRows(text);
  return rows.map((fields) =>
    fields.map((cell): Cell | undefined => {
      if (cell === '') return undefined;
      if (cell.startsWith('=')) return { f: cell };
      const asNum = Number(cell);
      if (!Number.isNaN(asNum) && Number.isFinite(asNum) && cell.trim() !== '')
        return { v: asNum };
      if (cell.toUpperCase() === 'TRUE') return { v: true };
      if (cell.toUpperCase() === 'FALSE') return { v: false };
      return { v: cell };
    }),
  );
}

function splitCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length > 1 && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  return rows;
}

/**
 * Parse TSV text from an external source into a clipboard-shaped object.
 * Used when the internal clipboard is missing (e.g. paste from Excel).
 */
export function parseTSV(text: string): (Cell | undefined)[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // Drop trailing blank line that arises from a final newline.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) =>
    line.split('\t').map((cell): Cell | undefined => {
      if (cell === '') return undefined;
      if (cell.startsWith('=')) return { f: cell };
      const asNum = Number(cell);
      if (!Number.isNaN(asNum) && Number.isFinite(asNum) && cell.trim() !== '')
        return { v: asNum };
      if (cell.toUpperCase() === 'TRUE') return { v: true };
      if (cell.toUpperCase() === 'FALSE') return { v: false };
      return { v: cell };
    }),
  );
}
