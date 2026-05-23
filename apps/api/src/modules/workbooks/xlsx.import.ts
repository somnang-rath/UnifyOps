import * as ExcelJS from 'exceljs';

// ---- public types (mirror frontend Cell) ----

export interface ImportedCellStyle {
  b?: boolean;
  i?: boolean;
  s?: boolean;
  u?: boolean;
  fs?: number;
  ff?: string;
  fg?: string;
  bg?: string;
  ha?: 'left' | 'center' | 'right';
  va?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  nf?: string;
}

export interface ImportedCell {
  v?: string | number | boolean | null;
  f?: string;
  s?: ImportedCellStyle;
  b1?: { style: string; color: string };
  b2?: { style: string; color: string };
  b3?: { style: string; color: string };
  b4?: { style: string; color: string };
}

export interface ImportedSheet {
  name: string;
  rows: number;
  cols: number;
  cells: (ImportedCell | null)[][];
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: Array<{ r1: number; c1: number; r2: number; c2: number }>;
}

// ---- main export ----

/**
 * Parse an XLSX buffer into an array of sheets, each with cells and styles
 * in Prism's compact Cell format.
 */
export async function xlsxBufferToSheets(
  buffer: Buffer,
): Promise<ImportedSheet[]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const result: ImportedSheet[] = [];

  wb.eachSheet((ws) => {
    const colWidths: Record<string, number> = {};
    const rowHeights: Record<string, number> = {};
    let maxRow = 0;
    let maxCol = 0;

    // Build a sparse map of A1 → cell first, then convert to 2D array
    const sparse: Record<string, ImportedCell> = {};

    // Column widths (ExcelJS units ≈ char-width; 1 char ≈ 7px)
    ws.columns.forEach((col, i) => {
      if (col.width && col.width > 0) {
        colWidths[colLetter(i)] = Math.round(col.width * 7);
      }
    });

    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const r = rowNum - 1;
      if (r > maxRow) maxRow = r;
      if (row.height) rowHeights[String(r)] = Math.round(row.height / 0.75);

      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const c = colNum - 1;
        if (c > maxCol) maxCol = c;

        const out: ImportedCell = {};
        readValue(cell, out);
        readStyle(cell, out);

        if (hasContent(out)) {
          sparse[a1Key(r, c)] = out;
        }
      });
    });

    // Merges
    const merges: ImportedSheet['merges'] = [];
    const model = (ws as any).model;
    if (Array.isArray(model?.merges)) {
      for (const m of model.merges as string[]) {
        const parsed = parseA1Range(m);
        if (parsed) merges.push(parsed);
      }
    }

    // Convert sparse map to 2D array
    const rows = maxRow + 1;
    const cols = maxCol + 1;
    const grid: (ImportedCell | null)[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(null),
    );
    for (const [key, cell] of Object.entries(sparse)) {
      const rc = parseA1Key(key);
      if (rc && rc.r < rows && rc.c < cols) grid[rc.r][rc.c] = cell;
    }

    result.push({ name: ws.name, rows, cols, cells: grid, colWidths, rowHeights, merges });
  });

  return result;
}

// ---- value extraction ----

function readValue(cell: ExcelJS.Cell, out: ImportedCell) {
  const cv = cell.value;
  if (cv === null || cv === undefined) return;

  if (isFormulaValue(cv)) {
    out.f = '=' + cv.formula;
    const res = (cv as any).result;
    if (res !== undefined && res !== null && !(typeof res === 'object')) {
      out.v = res;
    }
    return;
  }
  if (isSharedFormulaValue(cv)) {
    out.f = '=' + cv.sharedFormula;
    return;
  }
  if (isRichText(cv)) {
    out.v = cv.richText.map((rt) => rt.text).join('');
    return;
  }
  if (cv instanceof Date) {
    out.v = cv.toISOString().split('T')[0];
    return;
  }
  if (typeof cv === 'object' && 'hyperlink' in cv) {
    out.v = (cv as any).text ?? (cv as any).hyperlink;
    return;
  }
  out.v = cv as string | number | boolean;
}

// ---- style extraction ----

function readStyle(cell: ExcelJS.Cell, out: ImportedCell) {
  const s: ImportedCellStyle = {};

  const font = cell.font;
  if (font) {
    if (font.bold) s.b = true;
    if (font.italic) s.i = true;
    if ((font as any).strike) s.s = true;
    if (font.underline) s.u = true;
    if (font.size) s.fs = font.size;
    if (font.name) s.ff = font.name;
    if ((font.color as any)?.argb) {
      const hex = argbToHex((font.color as any).argb);
      if (hex && hex !== '#000000') s.fg = hex;
    }
  }

  const fill = cell.fill as any;
  if (
    fill?.type === 'pattern' &&
    fill.pattern !== 'none' &&
    fill.fgColor?.argb
  ) {
    const hex = argbToHex(fill.fgColor.argb);
    if (hex && hex !== '#ffffff') s.bg = hex;
  }

  const align = cell.alignment;
  if (align) {
    if (align.horizontal === 'left' || align.horizontal === 'center' || align.horizontal === 'right') {
      s.ha = align.horizontal;
    }
    if (align.vertical === 'top') s.va = 'top';
    else if (align.vertical === 'bottom') s.va = 'bottom';
    else if (align.vertical === 'middle') s.va = 'middle';
    if (align.wrapText) s.wrap = true;
  }

  const border = cell.border as Partial<Record<string, ExcelJS.Border>>;
  if (border) {
    if (border.top) out.b1 = fromBorder(border.top);
    if (border.right) out.b2 = fromBorder(border.right);
    if (border.bottom) out.b3 = fromBorder(border.bottom);
    if (border.left) out.b4 = fromBorder(border.left);
  }

  if (Object.keys(s).length) out.s = s;
}

// ---- helpers ----

function hasContent(cell: ImportedCell): boolean {
  return (
    cell.v !== undefined ||
    !!cell.f ||
    !!cell.s ||
    !!cell.b1 || !!cell.b2 || !!cell.b3 || !!cell.b4
  );
}

function colLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function a1Key(r: number, c: number): string {
  return colLetter(c) + (r + 1);
}

function parseA1Key(key: string): { r: number; c: number } | null {
  const m = key.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (let i = 0; i < m[1].length; i++)
    col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { c: col - 1, r: parseInt(m[2], 10) - 1 };
}

function parseA1Range(
  range: string,
): { r1: number; c1: number; r2: number; c2: number } | null {
  const parts = range.split(':');
  if (parts.length !== 2) return null;
  const a = parseA1Key(parts[0]);
  const b = parseA1Key(parts[1]);
  if (!a || !b) return null;
  return { r1: a.r, c1: a.c, r2: b.r, c2: b.c };
}

function argbToHex(argb: string): string | null {
  if (!argb || argb.length < 6) return null;
  // Strip alpha channel; ARGB → #RRGGBB
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return '#' + hex.toLowerCase();
}

function fromBorder(b: ExcelJS.Border): { style: string; color: string } {
  const styleMap: Record<string, string> = {
    thin: 'thin', medium: 'medium', thick: 'thick',
    dashed: 'dashed', dotted: 'dotted',
    double: 'medium', hair: 'thin', mediumDashed: 'medium',
    dashDot: 'dashed', mediumDashDot: 'dashed',
    dashDotDot: 'dotted', mediumDashDotDot: 'dotted', slantDashDot: 'dashed',
  };
  const color = (b.color as any)?.argb
    ? (argbToHex((b.color as any).argb) ?? '#000000')
    : '#000000';
  return { style: styleMap[b.style ?? 'thin'] ?? 'thin', color };
}

// ExcelJS type guards
function isFormulaValue(v: unknown): v is ExcelJS.CellFormulaValue {
  return typeof v === 'object' && v !== null && 'formula' in v;
}
function isSharedFormulaValue(v: unknown): v is ExcelJS.CellSharedFormulaValue {
  return typeof v === 'object' && v !== null && 'sharedFormula' in v;
}
function isRichText(v: unknown): v is ExcelJS.CellRichTextValue {
  return typeof v === 'object' && v !== null && 'richText' in v;
}
