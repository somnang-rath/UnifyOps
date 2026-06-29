import type { CSSProperties } from 'react';
import type { Cell, CellBorder, CellImage, CellLink, CellStyle } from '@/schemas/workbook';
import { formatComputed, isError } from '@/lib/sheets/formula';

/**
 * Pure presentation logic shared by the grid and the print renderer.
 * Mirrors the visual rules in grid.tsx `renderCell` (fonts, alignment,
 * number formatting, borders) without any interactive/event wiring, so the
 * printed output matches the on-screen grid.
 */

export type CellKind = 'empty' | 'text' | 'link' | 'image' | 'checkbox';

export interface CellPresentation {
  tdStyle: CSSProperties;
  innerStyle: CSSProperties;
  innerClass: string;
  text: string;
  kind: CellKind;
  checked?: boolean;
  link?: CellLink;
  img?: CellImage;
}

export function applyNumberFormat(n: number, nf?: string, dp?: number): string {
  if (!Number.isFinite(n)) return '#DIV/0!';
  if (nf === 'currency') {
    const fraction = dp ?? 2;
    return (
      '$' +
      n.toLocaleString(undefined, {
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      })
    );
  }
  if (nf === 'percent') {
    const fraction = dp ?? 2;
    return (
      (n * 100).toLocaleString(undefined, {
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      }) + '%'
    );
  }
  if (dp != null) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
  }
  return formatComputed(n);
}

export function borderShorthand(border: CellBorder): string {
  const widthMap: Record<string, string> = {
    thin: '1px',
    medium: '2px',
    thick: '3px',
    dashed: '1px',
    dotted: '1px',
  };
  const styleMap: Record<string, string> = {
    thin: 'solid',
    medium: 'solid',
    thick: 'solid',
    dashed: 'dashed',
    dotted: 'dotted',
  };
  return `${widthMap[border.style] ?? '1px'} ${styleMap[border.style] ?? 'solid'} ${border.color}`;
}

export interface PresentationOpts {
  /** Whether this cell is a checkbox (data validation). */
  isCheckbox?: boolean;
  /** Apply the cell's own b1..b4 borders to tdStyle (used by print). */
  applyOwnBorders?: boolean;
}

/**
 * Compute styles + display text for a cell given its evaluated value.
 * `computed` is the formula result when the cell has a formula, else ignored.
 */
export function buildCellPresentation(
  cell: Cell | undefined,
  computed: unknown,
  rowH: number,
  cfStyle?: CellStyle,
  opts: PresentationOpts = {},
): CellPresentation {
  const s: CellStyle | undefined = cfStyle
    ? { ...(cell?.s ?? {}), ...cfStyle }
    : cell?.s;
  const raw = cell?.f ? computed : cell?.v;

  const tdStyle: CSSProperties = { padding: 0 };
  if (s?.bg) tdStyle.backgroundColor = s.bg;
  if (opts.applyOwnBorders) {
    if (cell?.b1) tdStyle.borderTop = borderShorthand(cell.b1);
    if (cell?.b2) tdStyle.borderRight = borderShorthand(cell.b2);
    if (cell?.b3) tdStyle.borderBottom = borderShorthand(cell.b3);
    if (cell?.b4) tdStyle.borderLeft = borderShorthand(cell.b4);
  }

  // Checkbox validation type.
  if (opts.isCheckbox) {
    const checked = raw === true || raw === 'TRUE';
    return {
      tdStyle,
      innerStyle: {
        height: rowH - 1,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      },
      innerClass: 'whitespace-nowrap select-none',
      text: checked ? '☑' : '☐',
      kind: 'checkbox',
      checked,
    };
  }

  let text = '';
  let intrinsicHa: 'left' | 'right' | 'center' = 'left';
  let isErr = false;
  if (raw != null && raw !== '') {
    if (isError(raw)) {
      text = String(raw);
      intrinsicHa = 'right';
      isErr = true;
    } else if (typeof raw === 'number') {
      text = applyNumberFormat(raw, s?.nf, s?.dp);
      intrinsicHa = 'right';
    } else if (typeof raw === 'boolean') {
      text = raw ? 'TRUE' : 'FALSE';
      intrinsicHa = 'center';
    } else {
      text = String(raw);
    }
  }

  const ha = s?.ha ?? intrinsicHa;
  const va = s?.va ?? 'middle';
  const wrap = !!s?.wrap;

  const innerStyle: CSSProperties = {
    height: rowH - 1,
    width: '100%',
    padding: '0 4px',
    overflow: 'hidden',
    display: 'flex',
    alignItems:
      va === 'top' ? 'flex-start' : va === 'bottom' ? 'flex-end' : 'center',
    justifyContent:
      ha === 'right' ? 'flex-end' : ha === 'center' ? 'center' : 'flex-start',
    lineHeight: 1.3,
    fontSize: 12,
    boxSizing: 'border-box',
  };
  if (s?.fs) innerStyle.fontSize = s.fs;
  if (s?.ff) innerStyle.fontFamily = s.ff;
  if (s?.fg) innerStyle.color = s.fg;
  if (s?.b) innerStyle.fontWeight = 600;
  if (s?.i) innerStyle.fontStyle = 'italic';
  if (s?.s || s?.u) {
    const parts: string[] = [];
    if (s.s) parts.push('line-through');
    if (s.u) parts.push('underline');
    innerStyle.textDecoration = parts.join(' ');
  }
  if (isErr && !s?.fg) innerStyle.color = '#d93025';

  const innerClass = wrap
    ? 'whitespace-normal break-words'
    : 'whitespace-nowrap';

  if (cell?.link && text) {
    return { tdStyle, innerStyle, innerClass, text, kind: 'link', link: cell.link };
  }
  if (cell?.img) {
    return {
      tdStyle,
      innerStyle,
      innerClass,
      text,
      kind: text ? 'text' : 'image',
      img: cell.img,
    };
  }
  return {
    tdStyle,
    innerStyle,
    innerClass,
    text,
    kind: text ? 'text' : 'empty',
  };
}
