import type { Cell, Sheet, SheetRange } from '@/schemas/workbook';
import { a1ToRC, colA1 } from '@/lib/sheets/a1';
import {
  COL_W,
  PX_PER_IN,
  ROW_H,
  paperPx,
  withPrintDefaults,
  type PrintSetup,
} from './print-types';

/** Fixed band heights (px) reserved at top/bottom when header/footer has content. */
export const HEADER_BAND_PX = 28;
export const FOOTER_BAND_PX = 28;

export interface PrintColumn {
  index: number;
  width: number; // natural px (the page is scaled uniformly via `scale`)
  repeat: boolean;
}
export interface PrintRow {
  index: number;
  height: number; // natural px
  repeat: boolean;
}
export interface PrintPage {
  rows: PrintRow[];
  cols: PrintColumn[];
  pageIndex: number; // 1-based
  totalPages: number;
  /** Uniform scale to apply to the whole page body (fonts + sizes together). */
  scale: number;
}
export interface Pagination {
  pages: PrintPage[];
  scale: number;
  totalPages: number;
  range: SheetRange;
  contentW: number; // printable content box (px), excludes header/footer bands
  contentH: number;
  hasHeader: boolean;
  hasFooter: boolean;
}

function cellHasContent(cell: Cell | undefined): boolean {
  if (!cell) return false;
  if (cell.v != null && cell.v !== '') return true;
  if (cell.f) return true;
  if (cell.img || cell.link) return true;
  if (cell.s?.bg) return true;
  if (cell.b1 || cell.b2 || cell.b3 || cell.b4) return true;
  return false;
}

/** Smallest range [0,0]..[maxR,maxC] covering every non-empty / styled cell. */
export function usedRange(sheet: Sheet): SheetRange {
  let maxR = 0;
  let maxC = 0;
  let any = false;
  for (const [a1, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cellHasContent(cell as Cell)) continue;
    const rc = a1ToRC(a1);
    if (!rc) continue;
    any = true;
    if (rc.r > maxR) maxR = rc.r;
    if (rc.c > maxC) maxC = rc.c;
  }
  if (!any) return { r1: 0, c1: 0, r2: 0, c2: 0 };
  return { r1: 0, c1: 0, r2: maxR, c2: maxC };
}

function colWidth(sheet: Sheet, c: number): number {
  return sheet.colWidths?.[colA1(c)] ?? COL_W;
}
function rowHeight(sheet: Sheet, r: number): number {
  return sheet.rowHeights?.[String(r)] ?? ROW_H;
}

function clampRange(range: SheetRange, sheet: Sheet): SheetRange {
  const maxR = Math.max(0, sheet.rowCount - 1);
  const maxC = Math.max(0, sheet.colCount - 1);
  return {
    r1: Math.max(0, Math.min(range.r1, range.r2)),
    c1: Math.max(0, Math.min(range.c1, range.c2)),
    r2: Math.min(maxR, Math.max(range.r1, range.r2)),
    c2: Math.min(maxC, Math.max(range.c1, range.c2)),
  };
}

/**
 * Compute the page layout for printing `sheet` over `range` with `setup`.
 * The caller resolves `range` (used range, print area, or a selection) first.
 */
export function paginate(
  sheet: Sheet,
  setupIn: PrintSetup | null | undefined,
  rangeIn: SheetRange,
): Pagination {
  const setup = withPrintDefaults(setupIn);
  const range = clampRange(rangeIn, sheet);

  const hiddenRows = new Set(sheet.hiddenRows ?? []);
  const hiddenCols = new Set(sheet.hiddenCols ?? []);

  const hasHeader = !!(
    setup.header.left ||
    setup.header.center ||
    setup.header.right
  );
  const hasFooter = !!(
    setup.footer.left ||
    setup.footer.center ||
    setup.footer.right
  );

  // Printable content box (px), before scaling.
  const paper = paperPx(setup);
  const m = setup.margins;
  let contentW = paper.w - (m.left + m.right) * PX_PER_IN;
  let contentH = paper.h - (m.top + m.bottom) * PX_PER_IN;
  if (hasHeader) contentH -= HEADER_BAND_PX;
  if (hasFooter) contentH -= FOOTER_BAND_PX;
  contentW = Math.max(contentW, 1);
  contentH = Math.max(contentH, 1);

  // Resolve repeat row/col index sets (visible, within the printed range).
  const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

  const repeatRowSet = new Set<number>();
  if (setup.repeatRows) {
    const lo = Math.min(setup.repeatRows.from, setup.repeatRows.to);
    const hi = Math.max(setup.repeatRows.from, setup.repeatRows.to);
    for (let r = lo; r <= hi; r++) {
      if (inRange(r, range.r1, range.r2) && !hiddenRows.has(r))
        repeatRowSet.add(r);
    }
  }
  const repeatColSet = new Set<number>();
  if (setup.repeatCols) {
    const lo = Math.min(setup.repeatCols.from, setup.repeatCols.to);
    const hi = Math.max(setup.repeatCols.from, setup.repeatCols.to);
    for (let c = lo; c <= hi; c++) {
      if (inRange(c, range.c1, range.c2) && !hiddenCols.has(colA1(c)))
        repeatColSet.add(c);
    }
  }

  // Visible body rows / cols (excluding repeats).
  const bodyRows: number[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    if (hiddenRows.has(r) || repeatRowSet.has(r)) continue;
    bodyRows.push(r);
  }
  const bodyCols: number[] = [];
  for (let c = range.c1; c <= range.c2; c++) {
    if (hiddenCols.has(colA1(c)) || repeatColSet.has(c)) continue;
    bodyCols.push(c);
  }
  const repeatRows = [...repeatRowSet].sort((a, b) => a - b);
  const repeatCols = [...repeatColSet].sort((a, b) => a - b);

  // ---- Scaling ----
  const totalBodyW =
    bodyCols.reduce((s, c) => s + colWidth(sheet, c), 0) +
    repeatCols.reduce((s, c) => s + colWidth(sheet, c), 0);
  const totalBodyH =
    bodyRows.reduce((s, r) => s + rowHeight(sheet, r), 0) +
    repeatRows.reduce((s, r) => s + rowHeight(sheet, r), 0);

  let scale = 1;
  if (setup.scaling.mode === 'percent') {
    scale = setup.scaling.percent / 100;
  } else if (setup.scaling.mode === 'fitWidth') {
    const wide = Math.max(1, setup.scaling.fitWide);
    scale = totalBodyW > 0 ? Math.min(1, (wide * contentW) / totalBodyW) : 1;
  } else {
    // fitPage
    const wide = Math.max(1, setup.scaling.fitWide);
    const tall = Math.max(1, setup.scaling.fitTall);
    const ws = totalBodyW > 0 ? (wide * contentW) / totalBodyW : 1;
    const hs = totalBodyH > 0 ? (tall * contentH) / totalBodyH : 1;
    scale = Math.min(1, ws, hs);
  }
  scale = Math.max(0.1, Math.min(scale, 4));

  const sw = (c: number) => colWidth(sheet, c) * scale;
  const sh = (r: number) => rowHeight(sheet, r) * scale;

  const repeatColW = repeatCols.reduce((s, c) => s + sw(c), 0);
  const repeatRowH = repeatRows.reduce((s, r) => s + sh(r), 0);

  const availW = Math.max(contentW - repeatColW, 1);
  const availH = Math.max(contentH - repeatRowH, 1);

  // ---- Break body cols / rows into page bands ----
  const colBands: number[][] = [];
  {
    let band: number[] = [];
    let acc = 0;
    for (const c of bodyCols) {
      const w = sw(c);
      if (band.length > 0 && acc + w > availW) {
        colBands.push(band);
        band = [];
        acc = 0;
      }
      band.push(c);
      acc += w;
    }
    if (band.length > 0) colBands.push(band);
  }
  if (colBands.length === 0) colBands.push([]);

  const rowBands: number[][] = [];
  {
    let band: number[] = [];
    let acc = 0;
    for (const r of bodyRows) {
      const h = sh(r);
      if (band.length > 0 && acc + h > availH) {
        rowBands.push(band);
        band = [];
        acc = 0;
      }
      band.push(r);
      acc += h;
    }
    if (band.length > 0) rowBands.push(band);
  }
  if (rowBands.length === 0) rowBands.push([]);

  // ---- Assemble pages ----
  const totalPages = colBands.length * rowBands.length;
  const pages: PrintPage[] = [];

  // Pages store NATURAL column widths / row heights; the renderer applies
  // `scale` uniformly via a CSS transform so fonts shrink with the cells.
  const cw = (c: number) => colWidth(sheet, c);
  const rh = (r: number) => rowHeight(sheet, r);
  const makePage = (rowBand: number[], colBand: number[]): PrintPage => {
    const cols: PrintColumn[] = [
      ...repeatCols.map((c) => ({ index: c, width: cw(c), repeat: true })),
      ...colBand.map((c) => ({ index: c, width: cw(c), repeat: false })),
    ];
    const rows: PrintRow[] = [
      ...repeatRows.map((r) => ({ index: r, height: rh(r), repeat: true })),
      ...rowBand.map((r) => ({ index: r, height: rh(r), repeat: false })),
    ];
    return { rows, cols, pageIndex: 0, totalPages, scale };
  };

  if (setup.order === 'down') {
    // Down, then over: column-band outer, row-band inner.
    for (const colBand of colBands)
      for (const rowBand of rowBands) pages.push(makePage(rowBand, colBand));
  } else {
    // Over, then down: row-band outer, column-band inner.
    for (const rowBand of rowBands)
      for (const colBand of colBands) pages.push(makePage(rowBand, colBand));
  }
  pages.forEach((p, i) => {
    p.pageIndex = i + 1;
  });

  return {
    pages,
    scale,
    totalPages,
    range,
    contentW,
    contentH,
    hasHeader,
    hasFooter,
  };
}

/**
 * Column / row indices at which a new printed page begins — for the in-grid
 * page-break preview overlay. Excludes the very first band (no break line
 * before the first page).
 */
export function pageBreakIndices(
  sheet: Sheet,
  setup: PrintSetup | null | undefined,
  range: SheetRange,
): { cols: number[]; rows: number[] } {
  const pg = paginate(sheet, setup, range);
  const colStarts = new Set<number>();
  const rowStarts = new Set<number>();
  for (const page of pg.pages) {
    const firstCol = page.cols.find((c) => !c.repeat);
    const firstRow = page.rows.find((r) => !r.repeat);
    if (firstCol) colStarts.add(firstCol.index);
    if (firstRow) rowStarts.add(firstRow.index);
  }
  const cols = [...colStarts].sort((a, b) => a - b).slice(1);
  const rows = [...rowStarts].sort((a, b) => a - b).slice(1);
  return { cols, rows };
}
