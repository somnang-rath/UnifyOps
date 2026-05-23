'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { colA1, normalizeRange, rcToA1 } from '@/lib/sheets/a1';
import { formatComputed, isError } from '@/lib/sheets/formula';
import { isValueValid } from '@/lib/sheets/validation';
import type {
  Cell,
  Sheet,
  SheetValidationRule,
} from '@/schemas/workbook';
import { cn } from '@/lib/utils';
import { FormulaAutocomplete, filterFunctions, getActiveToken } from './formula-autocomplete';

const COL_W = 100;
const ROW_H = 21;
const HEADER_W = 46;
const HEADER_H = 22;
const COL_W_MIN = 40;
const COL_W_MAX = 800;
const ROW_H_MIN = 18;
const ROW_H_MAX = 400;

type Dir = 'up' | 'down' | 'left' | 'right' | null;

interface EditingState {
  r: number;
  c: number;
  value: string;
  source: 'cell' | 'formula-bar';
}

interface FilterChip {
  col: number;
  active: boolean;
}

interface Props {
  sheet: Sheet;
  computed: Record<string, unknown>;
  sel: { sr: number; sc: number; er: number; ec: number };
  active: { r: number; c: number };
  editing: EditingState | null;
  draggingSel: boolean;
  focusKey: number;
  fillTarget: { r1: number; c1: number; r2: number; c2: number } | null;
  copyMarquee: { r1: number; c1: number; r2: number; c2: number } | null;
  formulaPointMarquee?: { r1: number; c1: number; r2: number; c2: number } | null;
  filteredOutRows?: number[];
  condFmtStyles?: Record<string, import('@/schemas/workbook').CellStyle>;
  commentedCells?: Set<string>;
  filterChips?: FilterChip[];
  filterRow?: number | null;
  filterRangeOutline?: { r1: number; c1: number; r2: number; c2: number } | null;
  onMouseDownCell: (r: number, c: number, shift: boolean) => void;
  onMouseOverCell: (r: number, c: number) => void;
  onMouseUp: () => void;
  onDoubleClick: (r: number, c: number) => void;
  onKeyDown: (ev: React.KeyboardEvent) => void;
  onEditChange: (v: string) => void;
  onEditCommit: (dir: Dir) => void;
  onEditCancel: () => void;
  onFillStart: () => void;
  onColResize: (cols: number[], width: number) => void;
  onRowResize: (rows: number[], height: number) => void;
  onSelectAll: () => void;
  onColHeaderClick: (c: number, shift: boolean) => void;
  onRowHeaderClick: (r: number, shift: boolean) => void;
  onColHeaderContextMenu: (c: number, x: number, y: number) => void;
  onRowHeaderContextMenu: (r: number, x: number, y: number) => void;
  onCellContextMenu: (r: number, c: number, x: number, y: number) => void;
  onFilterChipClick?: (col: number, x: number, y: number) => void;
  validationFor?: (r: number, c: number) => SheetValidationRule | null;
  onCheckboxToggle?: (r: number, c: number) => void;
  onListOpen?: (
    r: number,
    c: number,
    values: string[],
    current: string | null,
    x: number,
    y: number,
  ) => void;
}

export function Grid({
  sheet,
  computed,
  sel,
  active,
  editing,
  focusKey,
  fillTarget,
  copyMarquee,
  formulaPointMarquee,
  filteredOutRows,
  condFmtStyles,
  commentedCells,
  filterChips,
  filterRow,
  filterRangeOutline,
  onMouseDownCell,
  onMouseOverCell,
  onMouseUp,
  onDoubleClick,
  onKeyDown,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onFillStart,
  onColResize,
  onRowResize,
  onSelectAll,
  onColHeaderClick,
  onRowHeaderClick,
  onColHeaderContextMenu,
  onRowHeaderContextMenu,
  onCellContextMenu,
  onFilterChipClick,
  validationFor,
  onCheckboxToggle,
  onListOpen,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);

  const [acToken, setAcToken] = useState('');
  const [acPos, setAcPos] = useState<{ top: number; left: number } | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const [acMounted, setAcMounted] = useState(false);

  useEffect(() => { setAcMounted(true); }, []);

  useEffect(() => {
    if (!editing) { setAcToken(''); setAcPos(null); }
  }, [editing]);

  const dismissAc = useCallback(() => {
    setAcToken('');
    setAcPos(null);
  }, []);

  const updateAc = useCallback((el: HTMLInputElement) => {
    const cursor = el.selectionStart ?? el.value.length;
    const token = getActiveToken(el.value, cursor);
    if (token && filterFunctions(token).length > 0) {
      const rect = el.getBoundingClientRect();
      setAcToken(token);
      setAcPos({ top: rect.bottom + 2, left: rect.left });
      setAcIndex(0);
    } else {
      setAcToken('');
      setAcPos(null);
    }
  }, []);

  const acceptAc = useCallback((name: string) => {
    const el = editorRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, cursor);
    const after = el.value.slice(cursor);
    const replaced = before.replace(/[A-Za-z_][A-Za-z0-9_.]*$/, name + '(');
    const newVal = replaced + after;
    el.value = newVal;
    onEditChange(newVal);
    const newCursor = replaced.length;
    requestAnimationFrame(() => el.setSelectionRange(newCursor, newCursor));
    setAcToken('');
    setAcPos(null);
  }, [onEditChange]);

  const [resizingCol, setResizingCol] = useState<{
    col: number;
    cols: number[];
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const [resizingRow, setResizingRow] = useState<{
    row: number;
    rows: number[];
    startY: number;
    startHeight: number;
    currentHeight: number;
  } | null>(null);

  // Track the live drag value in a ref so onUp can read the final value
  // without depending on stale state — avoids re-attaching document listeners
  // on every mousemove (which caused missed events in React 18).
  const colDragWidthRef = useRef<number>(0);
  const rowDragHeightRef = useRef<number>(0);

  useEffect(() => {
    if (!editing) wrapRef.current?.focus();
  }, [focusKey, editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editing?.r, editing?.c]);

  // Sync inline editor when formula-bar injections change editing.value
  // (the editor is uncontrolled so defaultValue alone won't update it).
  useEffect(() => {
    const el = editorRef.current;
    if (!el || document.activeElement === el) return;
    if (editing && el.value !== editing.value) el.value = editing.value;
  }, [editing?.value]);

  const rows = sheet.rowCount;
  const cols = sheet.colCount;
  const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
  // Whole-column selection: spans all rows for the selected columns.
  const selIsWholeCol = range.r1 === 0 && range.r2 === rows - 1;
  // Whole-row selection: spans all columns for the selected rows.
  const selIsWholeRow = range.c1 === 0 && range.c2 === cols - 1;
  const showGridlines = sheet.gridlines !== false;
  const cellBorderClass = showGridlines
    ? 'border-b border-r border-[#e1e3e6]'
    : 'border-b border-r border-transparent';
  const frozenRows = sheet.frozen?.rows ?? 0;
  const frozenCols = sheet.frozen?.cols ?? 0;

  // Pre-index merges: anchor cells render with rowSpan/colSpan, and
  // every other cell inside the merge is skipped from the table entirely.
  const mergeIndex = useMemo(() => {
    const anchors: Record<string, { rowSpan: number; colSpan: number }> = {};
    const skips = new Set<string>();
    for (const m of sheet.merges ?? []) {
      const rowSpan = m.r2 - m.r1 + 1;
      const colSpan = m.c2 - m.c1 + 1;
      anchors[rcToA1(m.r1, m.c1)] = { rowSpan, colSpan };
      for (let rr = m.r1; rr <= m.r2; rr++) {
        for (let cc = m.c1; cc <= m.c2; cc++) {
          if (rr === m.r1 && cc === m.c1) continue;
          skips.add(rcToA1(rr, cc));
        }
      }
    }
    return { anchors, skips };
  }, [sheet.merges]);

  const hiddenRowSet = useMemo(() => {
    const set = new Set(sheet.hiddenRows ?? []);
    for (const r of filteredOutRows ?? []) set.add(r);
    return set;
  }, [sheet.hiddenRows, filteredOutRows]);
  const hiddenColSet = useMemo(
    () => new Set(sheet.hiddenCols ?? []),
    [sheet.hiddenCols],
  );

  // Per-column widths and per-row heights, with sensible defaults.
  // Hidden rows/cols collapse to width/height 0; this keeps overlay offsets
  // (selection rectangle, fill handle, etc.) aligned without filtering the
  // table itself, which would invalidate row/col indices used everywhere.
  const colWidths = useMemo(() => {
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) {
      if (hiddenColSet.has(colA1(c))) widths.push(0);
      else widths.push(sheet.colWidths?.[colA1(c)] ?? COL_W);
    }
    return widths;
  }, [sheet.colWidths, cols, hiddenColSet]);

  const rowHeights = useMemo(() => {
    const heights: number[] = [];
    for (let r = 0; r < rows; r++) {
      if (hiddenRowSet.has(r)) heights.push(0);
      else heights.push(sheet.rowHeights?.[String(r)] ?? ROW_H);
    }
    return heights;
  }, [sheet.rowHeights, rows, hiddenRowSet]);

  // Cumulative offsets so we can position overlays + ghost lines.
  // colOffsets[c] = left-edge of column c (in px), colOffsets[cols] = total table width.
  const colOffsets = useMemo(() => {
    const out: number[] = [HEADER_W];
    for (let i = 0; i < colWidths.length; i++)
      out.push(out[i] + colWidths[i]);
    return out;
  }, [colWidths]);

  const rowOffsets = useMemo(() => {
    const out: number[] = [HEADER_H];
    for (let i = 0; i < rowHeights.length; i++)
      out.push(out[i] + rowHeights[i]);
    return out;
  }, [rowHeights]);

  const colHeaders = useMemo(
    () => Array.from({ length: cols }, (_, c) => colA1(c)),
    [cols],
  );

  const totalW = colOffsets[cols];
  const totalH = rowOffsets[rows];

  // If (r, c) is inside a merge, return the merge bounds; else null.
  const mergeAt = (r: number, c: number) => {
    for (const m of sheet.merges ?? []) {
      if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
    }
    return null;
  };

  // Overlay coords (relative to inner table). A merge containing the active
  // cell or the selection range expands the overlay to the merge bounds so
  // the ring/outline wraps the whole merged area instead of just the anchor.
  const activeMerge = mergeAt(active.r, active.c);
  const activeR1 = activeMerge ? activeMerge.r1 : active.r;
  const activeC1 = activeMerge ? activeMerge.c1 : active.c;
  const activeR2 = activeMerge ? activeMerge.r2 : active.r;
  const activeC2 = activeMerge ? activeMerge.c2 : active.c;
  const activeStyle = {
    top: rowOffsets[activeR1],
    left: colOffsets[activeC1],
    width: colOffsets[activeC2 + 1] - colOffsets[activeC1],
    height: rowOffsets[activeR2 + 1] - rowOffsets[activeR1],
  };

  // Selection range follows the user's actual selection 1:1 — we do NOT
  // auto-expand it to cover merges. (Clicking a row header should select
  // exactly that row, even when a merge crosses into the next row.)
  const selR1 = range.r1;
  const selC1 = range.c1;
  const selR2 = range.r2;
  const selC2 = range.c2;
  const selStyle = {
    top: rowOffsets[selR1],
    left: colOffsets[selC1],
    width: colOffsets[selC2 + 1] - colOffsets[selC1],
    height: rowOffsets[selR2 + 1] - rowOffsets[selR1],
  };

  const editorStyle = editing
    ? (() => {
        const em = mergeAt(editing.r, editing.c);
        const r1 = em ? em.r1 : editing.r;
        const c1 = em ? em.c1 : editing.c;
        const r2 = em ? em.r2 : editing.r;
        const c2 = em ? em.c2 : editing.c;
        return {
          top: rowOffsets[r1],
          left: colOffsets[c1],
          width: colOffsets[c2 + 1] - colOffsets[c1],
          height: rowOffsets[r2 + 1] - rowOffsets[r1],
        };
      })()
    : null;

  // Single-cell selection: skip the range outline so it doesn't overlap the
  // active-cell ring. A merge counts as "single" iff the active ring already
  // covers the same area (i.e. selection is just the merge anchor).
  const isRangeSingle =
    selR1 === selR2 &&
    selC1 === selC2 &&
    selR1 === activeR1 &&
    selC1 === activeC1 &&
    selR2 === activeR2 &&
    selC2 === activeC2;

  const fillHandleStyle = {
    top: rowOffsets[selR2 + 1] - 4,
    left: colOffsets[selC2 + 1] - 4,
  };

  const fillPreviewStyle = fillTarget
    ? {
        top: rowOffsets[fillTarget.r1],
        left: colOffsets[fillTarget.c1],
        width: colOffsets[fillTarget.c2 + 1] - colOffsets[fillTarget.c1],
        height: rowOffsets[fillTarget.r2 + 1] - rowOffsets[fillTarget.r1],
      }
    : null;

  const marqueeStyle = copyMarquee
    ? {
        top: rowOffsets[copyMarquee.r1],
        left: colOffsets[copyMarquee.c1],
        width: colOffsets[copyMarquee.c2 + 1] - colOffsets[copyMarquee.c1],
        height: rowOffsets[copyMarquee.r2 + 1] - rowOffsets[copyMarquee.r1],
      }
    : null;

  const fpmStyle = formulaPointMarquee
    ? {
        top: rowOffsets[formulaPointMarquee.r1],
        left: colOffsets[formulaPointMarquee.c1],
        width: colOffsets[formulaPointMarquee.c2 + 1] - colOffsets[formulaPointMarquee.c1],
        height: rowOffsets[formulaPointMarquee.r2 + 1] - rowOffsets[formulaPointMarquee.r1],
      }
    : null;

  // Resize ghost line position
  const colGhostX = resizingCol
    ? colOffsets[resizingCol.col] + resizingCol.currentWidth
    : null;
  const rowGhostY = resizingRow
    ? rowOffsets[resizingRow.row] + resizingRow.currentHeight
    : null;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      className="sh-grid-wrap flex-1 overflow-auto bg-white relative outline-none focus:outline-none select-none"
      style={{ fontFamily: 'var(--font-khmer), "Kantumruy Pro", system-ui, sans-serif' }}
    >
      <div
        className="relative"
        style={{ width: totalW, height: totalH }}
      >
        <table
          className="border-separate border-spacing-0"
          style={{ tableLayout: 'fixed' }}
        >
          <colgroup>
            <col style={{ width: HEADER_W }} />
            {colWidths.map((w, c) => (
              <col key={c} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: HEADER_H }}>
              <th
                onClick={onSelectAll}
                className={cn(
                  'sticky top-0 left-0 z-30 border-b border-r border-[#c0c0c0] cursor-pointer select-none',
                  range.r1 === 0 && range.r2 === rows - 1 && range.c1 === 0 && range.c2 === cols - 1
                    ? 'bg-[#c8d8fb]'
                    : 'bg-[#f8f9fa] hover:bg-[#e8f0fe]',
                )}
                title="Select all (Ctrl+A)"
              />
              {colHeaders.map((label, c) => (
                <th
                  key={c}
                  onClick={(ev) => {
                    if (ev.button !== 0) return;
                    onColHeaderClick(c, ev.shiftKey);
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    onColHeaderContextMenu(c, ev.clientX, ev.clientY);
                  }}
                  className={cn(
                    'sticky top-0 z-20 bg-[#f8f9fa] border-b border-r border-[#c0c0c0]',
                    'text-[11px] font-normal text-[#5f6368] select-none cursor-pointer p-0',
                    c >= range.c1 &&
                      c <= range.c2 &&
                      'bg-[#e8f0fe] text-[#1a73e8]',
                  )}
                >
                  {/* Inner relative wrapper so the resize handle has a reliable
                      containing block even if sticky <th> has browser quirks. */}
                  <div
                    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {label}
                    <div
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        const inMulti =
                          range.c1 !== range.c2 &&
                          c >= range.c1 &&
                          c <= range.c2;
                        const target: number[] = inMulti
                          ? Array.from(
                              { length: range.c2 - range.c1 + 1 },
                              (_, i) => range.c1 + i,
                            )
                          : [c];
                        const startX = ev.clientX;
                        const startWidth = colWidths[c];
                        colDragWidthRef.current = startWidth;
                        setResizingCol({ col: c, cols: target, startX, startWidth, currentWidth: startWidth });
                        // Attach listeners immediately — avoids the useEffect
                        // timing gap where mousemove/mouseup could fire before
                        // the effect runs in React 18 concurrent mode.
                        const onMove = (moveEv: MouseEvent) => {
                          const w = clamp(startWidth + (moveEv.clientX - startX), COL_W_MIN, COL_W_MAX);
                          colDragWidthRef.current = w;
                          setResizingCol((cur) => (cur ? { ...cur, currentWidth: w } : cur));
                        };
                        const onUp = () => {
                          document.removeEventListener('mousemove', onMove);
                          document.removeEventListener('mouseup', onUp);
                          const finalW = colDragWidthRef.current;
                          setResizingCol(null);
                          if (finalW !== startWidth) onColResize(target, finalW);
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      }}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        const canvas = document.createElement('canvas');
                        const ctx2d = canvas.getContext('2d');
                        let maxW = 40;
                        if (ctx2d) {
                          for (let rr = 0; rr < rows; rr++) {
                            const cell = sheet.cells?.[rcToA1(rr, c)];
                            if (!cell) continue;
                            const raw = cell.f ? computed[rcToA1(rr, c)] : cell.v;
                            if (raw == null || raw === '') continue;
                            const text = String(raw);
                            const fs = cell.s?.fs ?? 12;
                            const fw = cell.s?.b ? 600 : 400;
                            const ff = cell.s?.ff ?? 'sans-serif';
                            ctx2d.font = `${fw} ${fs}px ${ff}`;
                            const w = ctx2d.measureText(text).width + 16;
                            if (w > maxW) maxW = w;
                          }
                        }
                        const target = clamp(Math.ceil(maxW), COL_W_MIN, COL_W_MAX);
                        const affectedCols =
                          range.c1 !== range.c2 && c >= range.c1 && c <= range.c2
                            ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i)
                            : [c];
                        onColResize(affectedCols, target);
                      }}
                      className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize hover:bg-[#1a73e8]/40"
                      title="Drag to resize, double-click to auto-fit"
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r} style={{ height: rowHeights[r] }}>
                <th
                  onClick={(ev) => {
                    if (ev.button !== 0) return;
                    onRowHeaderClick(r, ev.shiftKey);
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    onRowHeaderContextMenu(r, ev.clientX, ev.clientY);
                  }}
                  className={cn(
                    'sticky left-0 z-10 bg-[#f8f9fa] border-b border-r border-[#c0c0c0]',
                    'text-[11px] font-normal text-[#5f6368] select-none text-center cursor-pointer p-0',
                    r >= range.r1 &&
                      r <= range.r2 &&
                      'bg-[#e8f0fe] text-[#1a73e8]',
                  )}
                >
                  {/* Inner relative wrapper — same reason as column header. */}
                  <div
                    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {r + 1}
                    <div
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        const inMulti =
                          range.r1 !== range.r2 &&
                          r >= range.r1 &&
                          r <= range.r2;
                        const target: number[] = inMulti
                          ? Array.from(
                              { length: range.r2 - range.r1 + 1 },
                              (_, i) => range.r1 + i,
                            )
                          : [r];
                        const startY = ev.clientY;
                        const startHeight = rowHeights[r];
                        rowDragHeightRef.current = startHeight;
                        setResizingRow({ row: r, rows: target, startY, startHeight, currentHeight: startHeight });
                        const onMove = (moveEv: MouseEvent) => {
                          const h = clamp(startHeight + (moveEv.clientY - startY), ROW_H_MIN, ROW_H_MAX);
                          rowDragHeightRef.current = h;
                          setResizingRow((cur) => (cur ? { ...cur, currentHeight: h } : cur));
                        };
                        const onUp = () => {
                          document.removeEventListener('mousemove', onMove);
                          document.removeEventListener('mouseup', onUp);
                          const finalH = rowDragHeightRef.current;
                          setResizingRow(null);
                          if (finalH !== startHeight) onRowResize(target, finalH);
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      }}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        if (rowHeights[r] !== ROW_H) onRowResize([r], ROW_H);
                      }}
                      className="absolute bottom-0 left-0 right-0 h-[5px] cursor-row-resize hover:bg-[#1a73e8]/40"
                      title="Drag to resize, double-click to reset"
                    />
                  </div>
                </th>
                {Array.from({ length: cols }, (_, c) => {
                  const a1 = rcToA1(r, c);
                  // Non-anchor merged cells: omit the <td> entirely.
                  if (mergeIndex.skips.has(a1)) return null;
                  const anchorSpan = mergeIndex.anchors[a1];
                  const cell = sheet.cells?.[a1];
                  const cfStyle = condFmtStyles?.[a1];
                  const rule = validationFor?.(r, c) ?? null;
                  const raw = cell?.f ? computed?.[a1] : cell?.v;
                  const valid = isValueValid(rule, raw);
                  // Excel-style overflow: only cells that actually paint a
                  // foreground (text/number/image) need bg-white. Empty cells
                  // stay transparent so a previous cell's long text can
                  // visually flow through them.
                  const hasContent =
                    (raw != null && raw !== '') || !!cell?.img;
                  // For merged anchors, expand the inner box to the full
                  // merged height so vertical alignment works across the span.
                  const effectiveRowH = anchorSpan
                    ? rowHeights
                        .slice(r, r + anchorSpan.rowSpan)
                        .reduce((a, b) => a + b, 0)
                    : rowHeights[r];
                  const { tdStyle, innerStyle, innerClass, value } =
                    renderCell(
                      cell,
                      computed?.[a1],
                      effectiveRowH,
                      cfStyle,
                      rule,
                    );
                  // Per-cell borders. Each shared edge is owned by exactly
                  // one cell so adjacent customizations don't double up:
                  //   - right edge: drawn by the cell at (r, c) using b2,
                  //     falling back to the right-neighbor's b4 if only the
                  //     neighbor declared its left side.
                  //   - bottom edge: drawn by (r, c) using b3, falling back
                  //     to the below-neighbor's b1.
                  //   - top/left edges: only drawn on the first row / first
                  //     column, since interior edges are already covered by
                  //     the previous row/column's bottom/right.
                  const rightSpan = anchorSpan?.colSpan ?? 1;
                  const bottomSpan = anchorSpan?.rowSpan ?? 1;
                  const cellRight = sheet.cells?.[rcToA1(r, c + rightSpan)];
                  const cellBelow = sheet.cells?.[rcToA1(r + bottomSpan, c)];
                  const effRight = cell?.b2 ?? cellRight?.b4;
                  const effBottom = cell?.b3 ?? cellBelow?.b1;
                  if (effRight) {
                    tdStyle.borderRight = borderShorthand(effRight);
                  }
                  if (effBottom) {
                    tdStyle.borderBottom = borderShorthand(effBottom);
                  }
                  if (r === 0 && cell?.b1) {
                    tdStyle.borderTop = borderShorthand(cell.b1);
                  }
                  if (c === 0 && cell?.b4) {
                    tdStyle.borderLeft = borderShorthand(cell.b4);
                  }
                  // Frozen rows / cols: stick to the top/left edge while the
                  // user scrolls. The intersection cells need both axes set
                  // and a higher z-index so they paint over the row/col-only
                  // sticky cells when both axes scroll past.
                  const stickyRow = r < frozenRows;
                  const stickyCol = c < frozenCols;
                  if (stickyRow || stickyCol) {
                    tdStyle.position = 'sticky';
                    if (stickyRow) tdStyle.top = rowOffsets[r];
                    if (stickyCol) tdStyle.left = colOffsets[c];
                    tdStyle.zIndex = stickyRow && stickyCol ? 5 : stickyRow ? 4 : 3;
                    if (!tdStyle.backgroundColor) tdStyle.backgroundColor = '#fff';
                  }
                  // Freeze divider: thicker border on the edge between frozen
                  // and unfrozen panes.
                  if (r === frozenRows - 1)
                    tdStyle.borderBottom = '2px solid #1a73e8';
                  if (c === frozenCols - 1)
                    tdStyle.borderRight = '2px solid #1a73e8';
                  return (
                    <td
                      key={c}
                      data-cell-a1={a1}
                      rowSpan={anchorSpan?.rowSpan}
                      colSpan={anchorSpan?.colSpan}
                      onMouseDown={(ev) => {
                        if (ev.button !== 0) return;
                        // Checkbox cells: clicking inside the cell toggles
                        // the value rather than starting a selection drag.
                        if (rule?.type === 'checkbox' && onCheckboxToggle) {
                          ev.preventDefault();
                          ev.stopPropagation();
                          onCheckboxToggle(r, c);
                          return;
                        }
                        onMouseDownCell(r, c, ev.shiftKey);
                      }}
                      onMouseOver={() => onMouseOverCell(r, c)}
                      onDoubleClick={() => onDoubleClick(r, c)}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        onCellContextMenu(r, c, ev.clientX, ev.clientY);
                      }}
                      className={cn(
                        cellBorderClass,
                        'cursor-cell relative',
                        // Whole-col/row selection: tint cells in the selected band.
                        selIsWholeCol && c >= range.c1 && c <= range.c2 && !hasContent && 'bg-[#e8f0fe]/60',
                        selIsWholeRow && r >= range.r1 && r <= range.r2 && !hasContent && 'bg-[#e8f0fe]/60',
                        hasContent && 'bg-white',
                      )}
                      style={tdStyle}
                    >
                      <div className={innerClass} style={innerStyle}>
                        {value}
                      </div>
                      {/* Validation: red marker on invalid cells */}
                      {!valid && (
                        <span
                          aria-hidden
                          className="absolute top-0 right-0 w-0 h-0"
                          style={{
                            borderLeft: '6px solid transparent',
                            borderTop: '6px solid #d93025',
                          }}
                          title="Invalid value"
                        />
                      )}
                      {/* Comment marker: small yellow triangle in opposite corner */}
                      {commentedCells?.has(a1) && (
                        <span
                          aria-hidden
                          className="absolute top-0 left-0 w-0 h-0"
                          style={{
                            borderRight: '6px solid transparent',
                            borderTop: '6px solid #f9ab00',
                          }}
                          title="Has comments"
                        />
                      )}
                      {/* Note marker: small black triangle bottom-right */}
                      {cell?.note && (
                        <span
                          aria-hidden
                          className="absolute bottom-0 right-0 w-0 h-0"
                          style={{
                            borderLeft: '6px solid transparent',
                            borderBottom: '6px solid #5f6368',
                          }}
                          title={cell.note}
                        />
                      )}
                      {/* Validation: list dropdown arrow */}
                      {rule?.type === 'list' && (
                        <button
                          type="button"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                          }}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const rect = (
                              ev.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            onListOpen?.(
                              r,
                              c,
                              rule.values ?? [],
                              raw == null ? null : String(raw),
                              rect.left,
                              rect.bottom,
                            );
                          }}
                          title="Open list"
                          className="absolute right-0 top-0 bottom-0 w-[16px] inline-flex items-center justify-center text-text-muted hover:bg-bg-hover"
                        >
                          <DropdownArrow />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Range outline */}
        {!isRangeSingle && (
          <div
            className="absolute pointer-events-none border-2 border-[#1a73e8] bg-[rgba(26,115,232,0.08)]"
            style={{ ...selStyle, zIndex: 5 }}
          />
        )}

        {/* Active cell ring */}
        {!editing && (
          <div
            className="absolute pointer-events-none border-2 border-[#1a73e8]"
            style={{ ...activeStyle, zIndex: 6 }}
          />
        )}

        {/* Fill preview during drag */}
        {fillPreviewStyle && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-[#1a73e8] bg-[rgba(26,115,232,0.04)]"
            style={{ ...fillPreviewStyle, zIndex: 7 }}
          />
        )}

        {/* Copy marquee (marching ants) */}
        {marqueeStyle && (
          <div
            className="absolute pointer-events-none sh-marquee"
            style={{ ...marqueeStyle, zIndex: 4 }}
          />
        )}

        {/* Formula point marquee — orange dashed border while pointing at a range */}
        {fpmStyle && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-[#e67c00] bg-[rgba(230,124,0,0.06)]"
            style={{ ...fpmStyle, zIndex: 8 }}
          />
        )}

        {/* Fill handle */}
        {!editing && (
          <div
            onMouseDown={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onFillStart();
            }}
            className="absolute w-[8px] h-[8px] bg-[#1a73e8] border border-white rounded-full cursor-crosshair"
            style={{ ...fillHandleStyle, zIndex: 8 }}
            title="Drag to fill"
          />
        )}

        {/* Resize ghost lines */}
        {colGhostX !== null && (
          <div
            className="absolute top-0 w-px bg-[#1a73e8] pointer-events-none"
            style={{ left: colGhostX, height: totalH, zIndex: 50 }}
          />
        )}
        {rowGhostY !== null && (
          <div
            className="absolute left-0 h-px bg-[#1a73e8] pointer-events-none"
            style={{ top: rowGhostY, width: totalW, zIndex: 50 }}
          />
        )}

        {/* Filter range outline */}
        {filterRangeOutline && (
          <div
            className="absolute pointer-events-none border-2 border-[#188038]"
            style={{
              top: rowOffsets[filterRangeOutline.r1],
              left: colOffsets[filterRangeOutline.c1],
              width:
                colOffsets[filterRangeOutline.c2 + 1] -
                colOffsets[filterRangeOutline.c1],
              height:
                rowOffsets[filterRangeOutline.r2 + 1] -
                rowOffsets[filterRangeOutline.r1],
              zIndex: 3,
            }}
          />
        )}

        {/* Filter chips on header row */}
        {filterRow != null &&
          (filterChips ?? []).map((chip) => {
            const r = filterRow;
            const cellRight = colOffsets[chip.col + 1];
            const cellBottom = rowOffsets[r + 1];
            return (
              <button
                key={chip.col}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  onFilterChipClick?.(chip.col, rect.left, rect.bottom);
                }}
                title="Filter & sort"
                className={cn(
                  'absolute inline-flex items-center justify-center w-[18px] h-[18px] rounded-sm border border-[#188038]',
                  chip.active
                    ? 'bg-[#188038] text-white'
                    : 'bg-white text-[#188038] hover:bg-[#e6f4ea]',
                )}
                style={{
                  top: cellBottom - 19,
                  left: cellRight - 19,
                  zIndex: 9,
                }}
              >
                <FunnelIcon />
              </button>
            );
          })}

        {/* Cell editor */}
        {acMounted && acToken && acPos && createPortal(
          <FormulaAutocomplete
            token={acToken}
            position={acPos}
            onSelect={acceptAc}
            onDismiss={dismissAc}
            activeIndex={acIndex}
            setActiveIndex={setAcIndex}
          />,
          document.body,
        )}

        {editing && editorStyle && (
          <input
            ref={editorRef}
            defaultValue={editing.value}
            onChange={(e) => {
              onEditChange(e.target.value);
              updateAc(e.target);
            }}
            onKeyDown={(e) => {
              const hasAc = acToken && filterFunctions(acToken).length > 0;
              if (hasAc && e.key === 'ArrowDown') {
                e.preventDefault();
                setAcIndex((i) => Math.min(i + 1, filterFunctions(acToken).length - 1));
                return;
              }
              if (hasAc && e.key === 'ArrowUp') {
                e.preventDefault();
                setAcIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (hasAc && (e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
                const matches = filterFunctions(acToken);
                if (matches[acIndex]) {
                  e.preventDefault();
                  acceptAc(matches[acIndex].name);
                  return;
                }
              }
              if (hasAc && e.key === 'Escape') {
                e.preventDefault();
                dismissAc();
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditCommit(e.shiftKey ? 'up' : 'down');
              } else if (e.key === 'Tab') {
                e.preventDefault();
                onEditCommit(e.shiftKey ? 'left' : 'right');
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onEditCancel();
              } else {
                e.stopPropagation();
              }
            }}
            onBlur={() => { setTimeout(dismissAc, 150); onEditCommit(null); }}
            className="absolute border-2 border-[#1a73e8] bg-white outline-none px-1 text-[12px] z-10 font-sans"
            style={editorStyle}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function CheckboxGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border-2',
        checked
          ? 'bg-[#1a73e8] border-[#1a73e8] text-white'
          : 'bg-white border-[#80868b]',
      )}
      aria-hidden
    >
      {checked && (
        <svg
          viewBox="0 0 16 16"
          className="w-2.5 h-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8l3 3 7-7" />
        </svg>
      )}
    </span>
  );
}

function DropdownArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4z" />
    </svg>
  );
}

function renderCell(
  cell: Cell | undefined,
  computed: unknown,
  rowH: number,
  cfStyle?: import('@/schemas/workbook').CellStyle,
  validationRule?: SheetValidationRule | null,
): {
  tdStyle: React.CSSProperties;
  innerStyle: React.CSSProperties;
  innerClass: string;
  value: React.ReactNode;
} {
  // Conditional formatting layers on top of the user-applied style.
  // Numbered keys (nf, dp, ff, fs, etc.) only matter when set by the user,
  // so the merge order is: rule style overrides equivalent keys in cell.s.
  const s = cfStyle
    ? { ...(cell?.s ?? {}), ...cfStyle }
    : cell?.s;
  const raw = cell?.f ? computed : cell?.v;

  // Checkbox validation type: render the value as a checkbox glyph centered
  // in the cell. The actual toggle is wired at the <td> level.
  if (validationRule?.type === 'checkbox') {
    const checked = raw === true || raw === 'TRUE';
    const tdStyle: React.CSSProperties = { padding: 0 };
    if (s?.bg) tdStyle.backgroundColor = s.bg;
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
      value: <CheckboxGlyph checked={checked} />,
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

  // td handles only background — padding moves to the inner div so we can
  // clip overflow with an explicitly sized container. Tables don't clip
  // their cell content reliably, but a child div with overflow:hidden does.
  const tdStyle: React.CSSProperties = { padding: 0 };
  if (s?.bg) tdStyle.backgroundColor = s.bg;

  const ha = s?.ha ?? intrinsicHa;
  const va = s?.va ?? 'middle';
  const wrap = !!s?.wrap;

  const innerStyle: React.CSSProperties = {
    height: rowH - 1, // 1px reserved for the bottom border
    width: '100%',
    padding: '0 4px',
    // Non-wrap cells let long text flow visually beyond the cell. Adjacent
    // cells with content keep their own bg, so the overflow is naturally
    // hidden when it reaches the next filled cell. Wrap mode still clips
    // vertically so the text doesn't spill past the row height.
    overflow: wrap ? 'hidden' : 'visible',
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

  // Wrap non-wrap text in an inline-block + flex-shrink:0 span so flex won't
  // squeeze it back into the cell. Without this, anonymous text in a flex
  // container with width:100% is treated as a shrinkable flex item and the
  // browser may keep it inside the cell instead of overflowing — making the
  // Excel-style overflow inconsistent across cells.
  const wrapNode = (node: React.ReactNode): React.ReactNode =>
    wrap ? node : (
      <span
        style={{
          display: 'inline-block',
          flexShrink: 0,
          maxWidth: 'none',
        }}
      >
        {node}
      </span>
    );

  // Hyperlink: wrap the text in an anchor. Open in a new tab to avoid
  // navigating away from the unsaved workbook.
  if (cell?.link && text) {
    return {
      tdStyle,
      innerStyle,
      innerClass,
      value: wrapNode(
        <a
          href={cell.link.url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="text-[#1a73e8] hover:underline"
        >
          {cell.link.text ?? text}
        </a>,
      ),
    };
  }

  // Image cells render the picture inside the same flex container so it
  // honors alignment/cropping like text would. Images aren't wrapped in the
  // overflow span — they should clip at the cell boundary.
  if (cell?.img) {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cell.img.src}
        alt={cell.img.alt ?? ''}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          userSelect: 'none',
        }}
      />
    );
    return {
      tdStyle,
      innerStyle,
      innerClass,
      value: text ? wrapNode(text) : img,
    };
  }

  return { tdStyle, innerStyle, innerClass, value: text ? wrapNode(text) : null };
}

function applyNumberFormat(n: number, nf?: string, dp?: number): string {
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

function borderShorthand(border: { style: string; color: string }): string {
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
