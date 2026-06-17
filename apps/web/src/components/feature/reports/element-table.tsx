'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Wifi } from 'lucide-react';
import type { ReportElement } from '@/schemas/report';
import type { StoredDatasource } from './data-source-panel';

type FooterCellFn = 'none' | 'sum' | 'count' | 'avg' | 'min' | 'max' | 'custom';

function computeSpans(values: string[]): number[] {
  const spans = new Array(values.length).fill(0);
  let i = 0;
  while (i < values.length) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j++;
    spans[i] = j - i;
    i = j;
  }
  return spans;
}

/**
 * Format a raw cell value according to a column format code.
 * Non-numeric values are returned unchanged.
 * Format codes: 'int' | 'dec1' | 'dec2' | 'dec3' | 'pct'
 */
function fmtNumber(raw: string, fmt: string | undefined): string {
  if (!fmt || fmt === 'none') return raw;
  const n = parseFloat(String(raw).replace(/[,$\s]/g, ''));
  if (isNaN(n)) return raw;
  switch (fmt) {
    case 'int':  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'dec1': return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'dec2': return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'dec3': return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'pct':  return n.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 1 });
    default:     return raw;
  }
}

function computeFooterCell(
  rows: Record<string, string>[],
  col: string,
  cfg: { fn: FooterCellFn; custom?: string; decimals?: number },
): string {
  if (cfg.fn === 'none') return '';
  if (cfg.fn === 'custom') return cfg.custom ?? '';
  if (cfg.fn === 'count') return String(rows.length);
  const nums = rows
    .map(r => parseFloat(String(r[col] ?? '').replace(/[$,%\s]/g, '')))
    .filter(n => !isNaN(n));
  if (!nums.length) return '';
  let v: number;
  switch (cfg.fn) {
    case 'sum': v = nums.reduce((a, b) => a + b, 0); break;
    case 'avg': v = nums.reduce((a, b) => a + b, 0) / nums.length; break;
    case 'min': v = Math.min(...nums); break;
    case 'max': v = Math.max(...nums); break;
    default: return '';
  }
  const dp = cfg.decimals ?? 2;
  return v % 1 === 0
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

interface Props {
  element: ReportElement;
  onAutoPaginate?: () => void;
  onActualFit?: (rowsFit: number) => void;
  onHeightChange?: (h: number) => void;
}

function resolveStatusStyle(value: string, statusColors?: Record<string, string>) {
  const explicit = statusColors?.[value];
  if (explicit) return { bg: explicit, fg: '#fff' };
  const lower = value.toLowerCase();
  if (lower.includes('active') || lower.includes('done') || lower.includes('complete') || lower.includes('success'))
    return { bg: '#84cc16', fg: '#fff' };
  if (lower.includes('dormant') || lower.includes('error') || lower.includes('fail') || lower.includes('inactive') || lower.includes('closed'))
    return { bg: '#ef4444', fg: '#fff' };
  if (lower.includes('pending') || lower.includes('waiting') || lower.includes('connected') || lower.includes('partial'))
    return { bg: '#94a3b8', fg: '#fff' };
  if (lower.includes('progress') || lower.includes('draft') || lower.includes('review'))
    return { bg: '#f59e0b', fg: '#fff' };
  return { bg: '#6b7280', fg: '#fff' };
}

export function ElementTable({ element, onAutoPaginate, onActualFit, onHeightChange }: Props) {
  const p = element.props as {
    columns?: string[];
    rows?: Record<string, string>[];
    startRow?: number;
    endRow?: number;
    isContinuation?: boolean;
    sourceTableId?: string;
    headerBg?: string;
    headerColor?: string;
    headerFontSize?: number;
    headerFontWeight?: string;
    headerTextTransform?: string;
    headerTextAlign?: string;
    headerPaddingY?: number;
    headerBottomBorder?: boolean;
    headerBottomBorderColor?: string;
    headerWrapText?: boolean;
    colSubLabels?: Record<string, string>;
    borderWidth?: number;
    equalRowHeight?: boolean;
    rowHeight?: number;
    stripedRows?: boolean;
    rowBg?: string;
    rowAltBg?: string;
    showTotalRow?: boolean;
    totalRowBg?: string;
    totalRowColor?: string;
    totalRowBold?: boolean;
    fontSize?: number;
    fontFamily?: string;
    cellPaddingX?: number;
    cellPaddingY?: number;
    borderColor?: string;
    borderStyle?: string;
    outerBorder?: boolean;
    showColBorders?: boolean;
    showRowBorders?: boolean;
    colAligns?: Record<string, string>;
    colWidths?: Record<string, number>;
    colBgs?: Record<string, string>;
    showRowNumbers?: boolean;
    rowNumberLabel?: string;
    statusColumns?: string[];
    statusColors?: Record<string, string>;
    dataSource?: StoredDatasource;
    repeatHeader?: boolean;
    autoPageBreak?: boolean;
    autoHeight?: boolean;
    footerRowEnabled?: boolean;
    footerRowBg?: string;
    footerRowColor?: string;
    footerRowBold?: boolean;
    footerRowFontSize?: number;
    footerRowLabel?: string;
    footerCells?: Record<string, { fn: FooterCellFn; custom?: string; decimals?: number }>;
    mergeCols?: string[];
    colFormats?: Record<string, string>;
    colLabels?: Record<string, string>;
    colFontSizes?: Record<string, number>;
    colTextColors?: Record<string, string>;
    colFontFamilies?: Record<string, string>;
  };

  const cols    = p.columns ?? ['Column 1', 'Column 2', 'Column 3'];
  const allRows = p.rows ?? [
    { 'Column 1': 'Cell A1', 'Column 2': 'Cell B1', 'Column 3': 'Cell C1' },
    { 'Column 1': 'Cell A2', 'Column 2': 'Cell B2', 'Column 3': 'Cell C2' },
  ];

  // Row slicing for pagination
  const startRow = Math.max(0, (p.startRow as number) ?? 0);
  const endRow   = p.endRow as number | undefined;
  const rows     = allRows.slice(startRow, endRow);

  // Remaining rows after this element's endRow (or 0 if no endRow)
  const remainingAfterEnd = endRow !== undefined ? Math.max(0, allRows.length - endRow) : 0;

  const headerBg   = p.headerBg ?? 'var(--bg-subtle)';
  const headerFg   = p.headerColor ?? 'var(--text-sub)';
  const borderClr  = p.borderColor ?? 'var(--border)';
  const borderSt   = p.borderStyle ?? 'solid';
  const fs         = p.fontSize ?? 12;
  const hFs        = p.headerFontSize ?? fs;
  const hFw        = p.headerFontWeight ?? '600';
  const hPy        = p.headerPaddingY ?? 8;
  const cellPx     = p.cellPaddingX ?? 12;
  const cellPy     = p.cellPaddingY ?? 6;
  const showColB   = p.showColBorders !== false;
  const showRowB   = p.showRowBorders !== false;
  const outerB     = !!p.outerBorder;
  const statusCols = new Set(p.statusColumns ?? []);

  // Footer row — only shown on the last page (or when not paginated)
  const showFooter = !!(p.footerRowEnabled) && (endRow === undefined || endRow >= allRows.length);

  // Estimate how many rows fit in the element height.
  // Subtract footer row height so overflowCount correctly detects when the footer
  // is covering rows — without this, overflowCount stays 0 and the auto-paginate
  // trigger never fires, leaving autoPageBreak unset and causing the source table
  // to be erroneously auto-resized by the shouldAutoSize effect.
  const fFs       = (p.footerRowFontSize as number) ?? Math.max(9, Math.round(fs * 0.9));
  const footerRowH = showFooter ? (cellPy * 2 + fFs + 2) : 0;
  const urlBarH   = p.dataSource?.url ? 22 : 0;
  const headerH   = hPy * 2 + hFs + 2;
  const rowH      = cellPy * 2 + fs + 2;
  const rowsFit   = Math.max(1, Math.floor((element.h - headerH - urlBarH - footerRowH) / rowH));
  // Overflow = explicit endRow cutoff OR height-based
  const overflowCount = remainingAfterEnd > 0 ? remainingAfterEnd
    : Math.max(0, rows.length - rowsFit);

  // Use auto layout when autoPageBreak is on and no explicit colWidths — lets the
  // browser size each column by its content instead of distributing width equally.
  const hasExplicitColWidths = cols.some(col => p.colWidths?.[col] != null);
  const tableLayout: 'auto' | 'fixed' = (p.autoPageBreak !== false && !hasExplicitColWidths) ? 'auto' : 'fixed';

  // Refs for DOM measurement of actual visible rows (handles multi-line text overflow)
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const theadRef     = useRef<HTMLTableSectionElement>(null);
  const tbodyRef     = useRef<HTMLTableSectionElement>(null);
  const tfootRef     = useRef<HTMLTableSectionElement>(null);

  // Measure actual rows that fit after each layout.
  //
  //  • Overflow (fit < bodyRows.length): rows are being clipped — reduce endRow.
  //  • Underflow (all rows fit + spare space + more rows exist): formula over-estimated
  //    row height so endRow was set too low.  Increase the hint so the layout can pull
  //    more rows onto this page (eliminating the unnecessary continuation page).
  //
  // Guard: only measure after computeAutoLayout has stretched the table (autoOriginalH
  // present on props). Without this guard the effect fires at the original small height
  // right after autoPageBreak is enabled, producing a wrong tiny fit count.
  useLayoutEffect(() => {
    // Guard: block when auto-break is explicitly off, when this is a continuation, or
    // before computeAutoLayout has stretched the element (autoOriginalH not yet set).
    // Previously `!p.autoPageBreak` was used, which also blocked the measurement when
    // autoPageBreak is undefined — but source tables with undefined autoPageBreak are
    // still actively paginated by computeAutoLayout (autoPageBreak !== false is the
    // filter), so we must allow DOM measurement to feed accurate hints back via onActualFit.
    if (!onActualFit || p.isContinuation || p.autoPageBreak === false) return;
    const ep = element.props as Record<string, unknown>;
    if (ep.autoOriginalH === undefined) return; // not yet stretched by computeAutoLayout
    const area  = tableAreaRef.current;
    const thead = theadRef.current;
    const tbody = tbodyRef.current;
    if (!area || !thead || !tbody) return;

    const areaH  = area.clientHeight;
    const theadH = thead.offsetHeight;
    // areaH already excludes the overflow indicator (it is a flex-shrink-0 sibling,
    // so the flex layout reduces the table-area clientHeight by exactly INDICATOR_H).
    // Do NOT subtract 24 again here — that was a double-deduction that caused the
    // underflow estimator to under-count by ~1 row, keeping unnecessary continuation pages.
    //
    // When the footer is rendered (showFooter=true), it occupies space at the bottom of
    // the table that is not available for body rows.  Subtract its measured height so
    // the fit count reflects only visible body rows above the footer.
    const tfootH = showFooter ? (tfootRef.current?.offsetHeight ?? 0) : 0;
    const available = areaH - theadH - tfootH;
    if (available <= 0) return;

    const bodyRows = tbody.rows;
    let cumH = 0;
    let fit  = 0;
    for (let i = 0; i < bodyRows.length; i++) {
      if (cumH + bodyRows[i].offsetHeight > available + 0.5) break;
      cumH += bodyRows[i].offsetHeight;
      fit++;
    }

    if (fit < bodyRows.length) {
      // ── Overflow: too many rows displayed — reduce to actual fit count ──────
      onActualFit(startRow + fit);
    } else if (bodyRows.length > 0 && endRow !== undefined && endRow < allRows.length) {
      // ── Underflow: all shown rows fit AND more rows exist ────────────────────
      // The formula over-estimated row height, so some rows were pushed to a
      // continuation page unnecessarily.  Calculate how many extra rows would
      // fit in the remaining space and expand the hint so computeAutoLayout can
      // absorb them into this page.
      const avgRowH = cumH / bodyRows.length;
      const remaining = available - cumH;
      const extra = Math.floor(remaining / avgRowH);
      if (extra > 0) {
        const newEnd = Math.min(allRows.length, endRow + extra);
        if (newEnd > endRow) {
          onActualFit(newEnd);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, element.h, p.footerRowEnabled]);

  // ── Auto-height: resize element to exactly fit its rendered rows ─────────
  // Fires for:
  //  • autoHeight tables (user setting)
  //  • ALL auto-paginated tables (source + continuation) once computeAutoLayout
  //    has run (autoOriginalH is set).  Shrinks each segment to its exact DOM
  //    content height, eliminating the blank gap between the last row and the
  //    element bottom.  autoLayoutSig uses autoOriginalH (not el.h), so this
  //    never re-triggers auto-layout.
  const prevAutoH = useRef(0);
  const shouldAutoSize =
    p.autoPageBreak !== false &&
    !p.autoHeight &&
    !!(element.props as Record<string, unknown>).autoOriginalH;

  useLayoutEffect(() => {
    if (!(p.autoHeight || shouldAutoSize) || !onHeightChange) return;
    const thead = theadRef.current;
    const tbody = tbodyRef.current;
    if (!thead || !tbody) return;
    const measured = Math.ceil(
      contBadgeH +                            // "Continued from previous page" badge (0 on source)
      (p.dataSource?.url ? 22 : 0) +          // datasource URL badge
      thead.offsetHeight +
      tbody.offsetHeight +
      (tfootRef.current?.offsetHeight ?? 0) + // footer row (0 when hidden)
      (outerB ? 2 : 0) +                      // outer border
      INDICATOR_H,                            // overflow indicator (0 when no overflow)
    );
    // Compare against element.h (not only prevAutoH) so we re-fire if computeAutoLayout
    // or orphan-cleanup restores el.h to a larger value after we already shrank it.
    if (measured > 0 && (Math.abs(measured - element.h) > 1 || Math.abs(measured - prevAutoH.current) > 1)) {
      prevAutoH.current = measured;
      onHeightChange(measured);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoHeight, shouldAutoSize, rows.length, overflowCount, p.fontSize, p.cellPaddingY,
      p.cellPaddingX, p.headerFontSize, p.headerPaddingY, p.showRowNumbers, p.outerBorder,
      p.dataSource?.url, p.isContinuation, showFooter, element.h]);

  // Auto-trigger pagination when overflow is detected and autoPageBreak has never been set.
  // Fires once per data-load cycle; resets whenever the row count changes (API refresh).
  const autoFiredRef = useRef(false);
  const prevRowCountRef = useRef(allRows.length);
  useEffect(() => {
    if (allRows.length !== prevRowCountRef.current) {
      prevRowCountRef.current = allRows.length;
      autoFiredRef.current = false;
    }
  });
  useEffect(() => {
    if (!onAutoPaginate) return;
    if (p.autoPageBreak === false) return;     // user explicitly disabled — respect their choice
    if (p.autoHeight) return;                  // autoHeight takes precedence; no pagination needed
    if (p.endRow !== undefined) return;        // already processed by a previous layout pass
    if (p.isContinuation) return;              // continuation tables are managed by auto-layout
    if (overflowCount <= 0) return;
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    // Small delay so the element fully mounts before triggering the layout update
    const t = setTimeout(() => onAutoPaginate(), 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overflowCount, p.autoPageBreak, p.autoHeight, p.endRow, p.isContinuation]);

  // Continuation pages created: use actual rows/page when pagination has already run
  // (endRow defined), otherwise fall back to formula estimate. This prevents the
  // misleading "N more pages" count when multi-line rows make each row much taller
  // than the formula assumes.
  const rowsPerPage = endRow !== undefined ? Math.max(1, rows.length) : rowsFit;
  const extraPageCount = overflowCount > 0 ? Math.ceil(overflowCount / rowsPerPage) : 0;

  // Merge cells: precompute rowspan maps per merge column (operates on visible rows slice)
  const mergeColsSet = new Set(p.mergeCols ?? []);
  const spanMaps: Record<string, number[]> = {};
  if (mergeColsSet.size > 0) {
    for (const col of mergeColsSet) {
      spanMaps[col] = computeSpans(rows.map((r) => String(r[col] ?? '')));
    }
  }

  // Auto-number with merge: when showRowNumbers + mergeCols are both active,
  // the number column shows group index (1, 2, 3…) keyed off the first merged
  // column, and uses the same rowspan.  Handles continuation pages via offset.
  const primaryMergeCol = p.mergeCols?.length ? p.mergeCols[0] : null;
  const numberSpans = primaryMergeCol ? (spanMaps[primaryMergeCol] ?? null) : null;
  const groupNumbers: number[] = [];
  if (primaryMergeCol && numberSpans) {
    let offset = 0;
    let lastV = '';
    for (let i = 0; i < startRow; i++) {
      const v = String(allRows[i]?.[primaryMergeCol] ?? '');
      if (v !== lastV) { offset++; lastV = v; }
    }
    let g = offset;
    let last = '';
    for (const row of rows) {
      const v = String(row[primaryMergeCol] ?? '');
      if (v !== last) { g++; last = v; }
      groupNumbers.push(g);
    }
  }

  const bw = p.borderWidth ?? 0.1;
  const colBorderRight = (ci: number) =>
    showColB && ci < cols.length - 1 ? `${bw}px ${borderSt} ${borderClr}` : 'none';
  const rowBorderBottom = (ri: number) =>
    showRowB && ri < rows.length - 1 ? `${bw}px ${borderSt} ${borderClr}` : 'none';

  const headerBorderBottom = p.headerBottomBorder
    ? `${bw}px solid ${p.headerBottomBorderColor ?? borderClr}`
    : showRowB ? `${bw}px ${borderSt} ${borderClr}` : 'none';

  const perRowH = p.equalRowHeight && p.rowHeight ? p.rowHeight : 0;

  // Indicator height when shown
  const INDICATOR_H = overflowCount > 0 && onAutoPaginate ? 24 : 0;

  const contBadgeH = p.isContinuation ? 20 : 0;

  return (
    <div
      className={`w-full flex flex-col overflow-hidden${p.autoHeight ? '' : ' h-full'}`}
      style={{
        position: 'relative',
        fontFamily: p.fontFamily,
        border: outerB ? `${bw}px ${borderSt} ${borderClr}` : 'none',
        borderRadius: outerB ? 4 : 0,
      }}
    >
      {/* Continuation badge */}
      {p.isContinuation && (
        <div style={{
          flexShrink: 0,
          padding: '2px 8px',
          background: 'rgba(99,102,241,0.08)',
          borderBottom: '1px dashed #6366f1',
          fontSize: 9,
          color: '#6366f1',
          fontWeight: 600,
        }}>
          ↩ Continued from previous page
        </div>
      )}

      {/* Datasource URL badge */}
      {p.dataSource?.url && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-accent-50 dark:bg-accent-950/30 border-b border-accent-200 dark:border-accent-800 flex-shrink-0">
          <Wifi className="w-2.5 h-2.5 text-accent-600" />
          <span className="text-[9px] text-accent-600 dark:text-accent-400 truncate">
            {p.dataSource.url}
          </span>
        </div>
      )}

      {/* Table area — clips when autoPageBreak is on; unconstrained when autoHeight is on.
          When a footer is shown but rows still overflow (INDICATOR_H > 0), we must still
          clip so the overflow indicator is visible and auto-pagination can trigger. */}
      <div
        ref={tableAreaRef}
        className={p.autoHeight ? '' : (showFooter && INDICATOR_H === 0) ? 'flex-1' : p.autoPageBreak !== false ? 'overflow-hidden flex-1' : 'overflow-auto flex-1'}
        style={{ maxHeight: (!p.autoHeight && INDICATOR_H > 0) ? `calc(100% - ${INDICATOR_H}px)` : undefined }}
      >
        <table className="w-full border-collapse" style={{ fontSize: fs, lineHeight: 1.2, tableLayout }}>
          <colgroup>
            {p.showRowNumbers && <col style={{ width: 36 }} />}
            {cols.map((col) => (
              <col key={col} style={p.colWidths?.[col] != null ? { width: `${p.colWidths![col]}%` } : undefined} />
            ))}
          </colgroup>
          <thead ref={theadRef}>
            <tr>
              {p.showRowNumbers && (
                <th
                  style={{
                    background: headerBg,
                    color: headerFg,
                    padding: `${hPy}px ${cellPx}px`,
                    fontSize: hFs,
                    fontWeight: hFw,
                    lineHeight: 1.2,
                    textTransform: (p.headerTextTransform ?? 'none') as 'none' | 'uppercase' | 'capitalize' | 'lowercase',
                    textAlign: 'center',
                    borderRight: showColB ? `${bw}px ${borderSt} ${borderClr}` : 'none',
                    borderBottom: headerBorderBottom,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.rowNumberLabel ?? '#'}
                </th>
              )}
              {cols.map((col, ci) => (
                <th
                  key={col}
                  style={{
                    background: headerBg,
                    color: headerFg,
                    padding: `${hPy}px ${cellPx}px`,
                    fontSize: hFs,
                    fontWeight: hFw,
                    lineHeight: 1.2,
                    textTransform: (p.headerTextTransform ?? 'none') as 'none' | 'uppercase' | 'capitalize' | 'lowercase',
                    textAlign: (p.headerTextAlign ?? p.colAligns?.[col] ?? 'left') as 'left' | 'center' | 'right',
                    borderRight: colBorderRight(ci),
                    borderBottom: headerBorderBottom,
                    whiteSpace: p.headerWrapText ? 'normal' : 'nowrap',
                    wordBreak: p.headerWrapText ? 'break-word' : 'normal',
                  }}
                >
                  <span>{p.colLabels?.[col] ?? col}</span>
                  {p.colSubLabels?.[col] && (
                    <span style={{ display: 'block', fontSize: '0.75em', fontWeight: 400, opacity: 0.75, lineHeight: 1.2, marginTop: 2 }}>
                      {p.colSubLabels[col]}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {rows.map((row, ri) => {

              const globalRi   = startRow + ri;
              const isTotalRow = !!(p.showTotalRow && globalRi === allRows.length - 1);
              const isStripe   = !!(p.stripedRows && ri % 2 === 1);

              let rowBg = p.rowBg ?? 'transparent';
              if (isTotalRow && p.totalRowBg) rowBg = p.totalRowBg;
              else if (isStripe) rowBg = p.rowAltBg ?? 'color-mix(in srgb, var(--text) 5%, transparent)';

              const rowColor = isTotalRow && p.totalRowColor ? p.totalRowColor : undefined;
              const rowFw    = isTotalRow && p.totalRowBold !== false ? 'bold' : undefined;

              return (
                <tr key={ri} style={{ background: rowBg, color: rowColor, fontWeight: rowFw, ...(perRowH > 0 ? { height: perRowH } : {}) }}>
                  {p.showRowNumbers && (() => {
                    // Merge-aware numbering: when a primary merge column is active,
                    // show group number + apply same rowspan as the primary column.
                    if (numberSpans) {
                      const span = numberSpans[ri] ?? 1;
                      if (span === 0) return null; // covered by merged cell above
                      return (
                        <td
                          key="__rownum"
                          rowSpan={span > 1 ? span : undefined}
                          style={{
                            padding: `${cellPy}px ${cellPx}px`,
                            lineHeight: 1.2,
                            borderRight: showColB ? `${bw}px ${borderSt} ${borderClr}` : 'none',
                            borderBottom: rowBorderBottom(ri + span - 1),
                            textAlign: 'center',
                            fontWeight: 'bold',
                            verticalAlign: 'middle',
                            color: 'var(--text)',
                          }}
                        >
                          {groupNumbers[ri]}
                        </td>
                      );
                    }
                    return (
                      <td
                        key="__rownum"
                        style={{
                          padding: `${cellPy}px ${cellPx}px`,
                          lineHeight: 1.2,
                          borderRight: showColB ? `${bw}px ${borderSt} ${borderClr}` : 'none',
                          borderBottom: rowBorderBottom(ri),
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {globalRi + 1}
                      </td>
                    );
                  })()}
                  {cols.map((col, ci) => {
                    const mergeEnabled = mergeColsSet.has(col);
                    const span         = mergeEnabled ? (spanMaps[col]?.[ri] ?? 1) : 1;

                    // Cell is covered by a merged cell above — skip rendering
                    if (mergeEnabled && span === 0) return null;

                    const rawVal   = row[col] ?? '';
                    const isStatus = statusCols.has(col);
                    const colBg    = p.colBgs?.[col];
                    const align    = (p.colAligns?.[col] ?? 'left') as 'left' | 'center' | 'right';
                    const val      = isStatus ? rawVal : fmtNumber(rawVal, p.colFormats?.[col]);

                    return (
                      <td
                        key={col}
                        rowSpan={span > 1 ? span : undefined}
                        style={{
                          padding: `${cellPy}px ${cellPx}px`,
                          lineHeight: 1.2,
                          borderRight: colBorderRight(ci),
                          // Use last spanned row's border so the line appears at the group edge
                          borderBottom: span > 1 ? rowBorderBottom(ri + span - 1) : rowBorderBottom(ri),
                          textAlign: align,
                          background: colBg || undefined,
                          verticalAlign: 'middle',
                          fontSize: p.colFontSizes?.[col] ?? undefined,
                          color: p.colTextColors?.[col] ?? undefined,
                          fontFamily: p.colFontFamilies?.[col] ?? undefined,
                        }}
                      >
                        {isStatus && val ? (() => {
                          const { bg, fg } = resolveStatusStyle(val, p.statusColors);
                          return (
                            <span style={{
                              display: 'inline-block',
                              background: bg,
                              color: fg,
                              padding: '2px 10px',
                              borderRadius: 4,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              fontSize: '0.9em',
                            }}>
                              {val}
                            </span>
                          );
                        })() : val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* Footer row — inside the same table so column widths always align */}
          {showFooter && (
            <tfoot
              ref={tfootRef}
              style={{ fontFamily: p.fontFamily, fontSize: p.footerRowFontSize ?? Math.max(9, Math.round(fs * 0.9)) }}
            >
              <tr
                style={{
                  background: p.footerRowBg ?? 'var(--bg-subtle)',
                  color: p.footerRowColor ?? 'var(--text)',
                  fontWeight: p.footerRowBold !== false ? 700 : 400,
                  height: perRowH > 0 ? perRowH : undefined,
                }}
              >
                {p.showRowNumbers && (
                  <td
                    style={{
                      padding: `${cellPy}px ${cellPx}px`,
                      lineHeight: 1.2,
                      borderTop: `${bw}px ${borderSt} ${borderClr}`,
                      borderRight: showColB ? `${bw}px ${borderSt} ${borderClr}` : 'none',
                      textAlign: 'center',
                    }}
                  />
                )}
                {cols.map((col, ci) => {
                  const cfg     = p.footerCells?.[col] ?? { fn: 'none' as FooterCellFn };
                  const isFirst = ci === 0;
                  const raw     = cfg.fn === 'none' && isFirst
                    ? (p.footerRowLabel ?? 'Total')
                    : computeFooterCell(allRows, col, cfg);
                  const val   = fmtNumber(raw, p.colFormats?.[col]);
                  const align = (p.colAligns?.[col] ?? 'left') as 'left' | 'center' | 'right';
                  return (
                    <td
                      key={col}
                      style={{
                        padding: `${cellPy}px ${cellPx}px`,
                        lineHeight: 1.2,
                        borderTop: `${bw}px ${borderSt} ${borderClr}`,
                        borderRight: colBorderRight(ci),
                        textAlign: align,
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Overflow indicator — shown only in editor (onAutoPaginate present) */}
      {overflowCount > 0 && onAutoPaginate && (
        <div
          style={{
            flexShrink: 0,
            height: INDICATOR_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '0 10px',
            background: p.autoPageBreak !== false ? 'rgba(99,102,241,0.08)' : 'rgba(245,158,11,0.08)',
            borderTop: p.autoPageBreak !== false ? '1px dashed #6366f1' : '1px dashed #f59e0b',
            fontSize: 10,
          }}
        >
          {p.autoPageBreak !== false ? (
            /* Auto mode: show page breakdown info */
            <>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⚡</span>
                <span>Auto-paginating — {overflowCount} rows → {extraPageCount} more page{extraPageCount !== 1 ? 's' : ''}</span>
              </span>
              <span style={{
                fontSize: 8,
                fontWeight: 600,
                color: '#6366f1',
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 3,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}>
                AUTO
              </span>
            </>
          ) : (
            /* Manual mode: show button */
            <>
              <span style={{ fontSize: 9, color: '#92400e' }}>↓ {overflowCount} rows overflow</span>
              <button
                onClick={(e) => { e.stopPropagation(); onAutoPaginate(); }}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  padding: '2px 8px',
                  fontSize: 9,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }}
              >
                Auto-paginate →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
