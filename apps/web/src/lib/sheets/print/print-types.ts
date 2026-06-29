import type { PrintSetup, SheetRange } from '@/schemas/workbook';

export type { PrintSetup } from '@/schemas/workbook';

/** Default column / row sizing — must match the grid (grid.tsx COL_W / ROW_H). */
export const COL_W = 100;
export const ROW_H = 21;

/** CSS pixels per inch at the conventional 96 DPI. */
export const PX_PER_IN = 96;

/** Paper sizes in inches (portrait). */
export const PAPER_SIZES: Record<
  PrintSetup['paper'],
  { w: number; h: number; label: string }
> = {
  A4: { w: 8.27, h: 11.69, label: 'A4' },
  Letter: { w: 8.5, h: 11, label: 'Letter' },
  Legal: { w: 8.5, h: 14, label: 'Legal' },
  A3: { w: 11.69, h: 16.54, label: 'A3' },
};

/** CSS `@page size` keyword for each paper choice (the browser knows these). */
export const PAPER_CSS_NAME: Record<PrintSetup['paper'], string> = {
  A4: 'A4',
  Letter: 'letter',
  Legal: 'legal',
  A3: 'A3',
};

export const MARGIN_PRESETS: Record<
  string,
  { top: number; right: number; bottom: number; left: number; header: number; footer: number }
> = {
  Normal: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7, header: 0.3, footer: 0.3 },
  Wide: { top: 1, right: 1, bottom: 1, left: 1, header: 0.5, footer: 0.5 },
  Narrow: { top: 0.5, right: 0.25, bottom: 0.5, left: 0.25, header: 0.3, footer: 0.3 },
};

export const DEFAULT_PRINT_SETUP: PrintSetup = {
  paper: 'A4',
  orientation: 'portrait',
  margins: { ...MARGIN_PRESETS.Normal },
  scaling: { mode: 'percent', percent: 100, fitWide: 1, fitTall: 1 },
  printArea: null,
  repeatRows: null,
  repeatCols: null,
  gridlines: false,
  headings: false,
  centerH: false,
  centerV: false,
  order: 'down',
  header: { left: '', center: '', right: '' },
  footer: { left: '', center: '', right: '' },
};

/** Fill any missing keys on a (possibly partial / legacy) printSetup. */
export function withPrintDefaults(p?: PrintSetup | null): PrintSetup {
  if (!p) return structuredClonePrint(DEFAULT_PRINT_SETUP);
  return {
    ...DEFAULT_PRINT_SETUP,
    ...p,
    margins: { ...DEFAULT_PRINT_SETUP.margins, ...(p.margins ?? {}) },
    scaling: { ...DEFAULT_PRINT_SETUP.scaling, ...(p.scaling ?? {}) },
    header: { ...DEFAULT_PRINT_SETUP.header, ...(p.header ?? {}) },
    footer: { ...DEFAULT_PRINT_SETUP.footer, ...(p.footer ?? {}) },
  };
}

/** structuredClone is unavailable in older runtimes used by tests — small manual clone. */
function structuredClonePrint(p: PrintSetup): PrintSetup {
  return {
    ...p,
    margins: { ...p.margins },
    scaling: { ...p.scaling },
    printArea: p.printArea ? { ...p.printArea } : null,
    repeatRows: p.repeatRows ? { ...p.repeatRows } : null,
    repeatCols: p.repeatCols ? { ...p.repeatCols } : null,
    header: { ...p.header },
    footer: { ...p.footer },
  };
}

/** Paper dimensions in CSS px, accounting for orientation. */
export function paperPx(setup: PrintSetup): { w: number; h: number } {
  const base = PAPER_SIZES[setup.paper] ?? PAPER_SIZES.A4;
  const w = base.w * PX_PER_IN;
  const h = base.h * PX_PER_IN;
  return setup.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

export type SheetRangeT = SheetRange;
