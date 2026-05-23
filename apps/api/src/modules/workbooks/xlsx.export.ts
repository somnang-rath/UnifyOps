import * as ExcelJS from 'exceljs';

interface Cell {
  v?: string | number | boolean | null;
  f?: string | null;
  s?: {
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
    nf?: string;
    dp?: number;
    wrap?: boolean;
  };
  b1?: { style: string; color: string };
  b2?: { style: string; color: string };
  b3?: { style: string; color: string };
  b4?: { style: string; color: string };
}

interface SheetIn {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
  cells: Record<string, Cell>;
  colWidths?: Record<string, number>;
  rowHeights?: Record<string, number>;
  merges?: Array<{ r1: number; c1: number; r2: number; c2: number }>;
  frozen?: { rows: number; cols: number };
}

interface WorkbookIn {
  name: string;
  sheets: SheetIn[];
}

/**
 * Render a Prism workbook to a binary XLSX buffer. Most of the work is
 * mapping our compact style shape to ExcelJS's style objects.
 */
export async function workbookToXlsxBuffer(wb: WorkbookIn): Promise<Buffer> {
  const out = new ExcelJS.Workbook();
  out.created = new Date();
  out.modified = new Date();

  for (const sheet of wb.sheets ?? []) {
    const ws = out.addWorksheet(sheet.name || 'Sheet');

    // Column widths. ExcelJS measures column width in characters, not pixels.
    // 100px ≈ 14 chars at default font; clamp to reasonable range.
    const cwMap = sheet.colWidths ?? {};
    const colDefs: Array<{ width: number }> = [];
    for (let c = 0; c < (sheet.colCount ?? 26); c++) {
      const a1 = colA1(c);
      const px = cwMap[a1] ?? 100;
      colDefs.push({ width: Math.max(4, Math.min(60, px / 7)) });
    }
    ws.columns = colDefs;

    // Row heights. ExcelJS uses points; 21px ≈ 15.75 pt.
    const rhMap = sheet.rowHeights ?? {};
    for (const [rowStr, px] of Object.entries(rhMap)) {
      const r = Number(rowStr);
      if (!Number.isInteger(r)) continue;
      ws.getRow(r + 1).height = Math.max(6, Math.min(300, px * 0.75));
    }

    // Cells
    for (const [a1, cell] of Object.entries(sheet.cells ?? {})) {
      const rc = parseA1(a1);
      if (!rc) continue;
      const target = ws.getCell(rc.r + 1, rc.c + 1);
      if (cell.f) {
        target.value = { formula: cell.f.slice(1) } as ExcelJS.CellValue;
      } else if (cell.v != null && cell.v !== '') {
        target.value = cell.v as ExcelJS.CellValue;
      }

      // Style
      const s = cell.s;
      if (s) {
        const font: Partial<ExcelJS.Font> = {};
        if (s.b) font.bold = true;
        if (s.i) font.italic = true;
        if (s.s) font.strike = true;
        if (s.u) font.underline = true;
        if (s.fs) font.size = s.fs;
        if (s.ff) font.name = stripQuotes(s.ff.split(',')[0]).trim();
        if (s.fg) font.color = { argb: toArgb(s.fg) };
        if (Object.keys(font).length) target.font = font;

        if (s.bg) {
          target.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: toArgb(s.bg) },
          } as ExcelJS.FillPattern;
        }

        target.alignment = {
          horizontal: s.ha ?? undefined,
          vertical:
            s.va === 'top'
              ? 'top'
              : s.va === 'bottom'
                ? 'bottom'
                : s.va
                  ? 'middle'
                  : undefined,
          wrapText: s.wrap || undefined,
        };

        if (s.nf || s.dp != null) {
          target.numFmt = numFormat(s.nf, s.dp);
        }
      }

      // Borders. Map our b1..b4 onto ExcelJS top/right/bottom/left.
      const borders: Partial<ExcelJS.Borders> = {};
      if (cell.b1) borders.top = toBorder(cell.b1);
      if (cell.b2) borders.right = toBorder(cell.b2);
      if (cell.b3) borders.bottom = toBorder(cell.b3);
      if (cell.b4) borders.left = toBorder(cell.b4);
      if (Object.keys(borders).length) target.border = borders;
    }

    // Merges
    for (const m of sheet.merges ?? []) {
      try {
        ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
      } catch {
        // Overlapping merges throw — skip the offender.
      }
    }

    // Freeze
    if (sheet.frozen && (sheet.frozen.rows > 0 || sheet.frozen.cols > 0)) {
      ws.views = [
        {
          state: 'frozen',
          xSplit: sheet.frozen.cols ?? 0,
          ySplit: sheet.frozen.rows ?? 0,
        },
      ];
    }
  }

  const arr = await out.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

// ---- helpers ----

function colA1(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseA1(a1: string): { r: number; c: number } | null {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (let i = 0; i < m[1].length; i++)
    col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { c: col - 1, r: parseInt(m[2], 10) - 1 };
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}

function toArgb(hex: string): string {
  // Accept #RGB, #RRGGBB, or fall back to opaque black on parse failure.
  const m = hex.match(/^#?([0-9a-f]{3,8})$/i);
  if (!m) return 'FF000000';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (h.length === 6) return 'FF' + h.toUpperCase();
  if (h.length === 8) return h.toUpperCase();
  return 'FF000000';
}

function toBorder(b: { style: string; color: string }): ExcelJS.Border {
  const styleMap: Record<string, ExcelJS.BorderStyle> = {
    thin: 'thin',
    medium: 'medium',
    thick: 'thick',
    dashed: 'dashed',
    dotted: 'dotted',
  };
  return {
    style: styleMap[b.style] ?? 'thin',
    color: { argb: toArgb(b.color || '#000') },
  };
}

function numFormat(nf?: string, dp?: number): string {
  const d = dp ?? 2;
  const decimals = d > 0 ? '.' + '0'.repeat(d) : '';
  if (nf === 'currency') return `"$"#,##0${decimals}`;
  if (nf === 'percent') return `0${decimals}%`;
  return `0${decimals}`;
}
