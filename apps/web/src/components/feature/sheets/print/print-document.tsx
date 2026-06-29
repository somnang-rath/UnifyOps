import React from 'react';
import type { CellStyle, Sheet } from '@/schemas/workbook';
import { colA1, rcToA1 } from '@/lib/sheets/a1';
import { buildCellPresentation } from '@/lib/sheets/cell-style';
import {
  HEADER_BAND_PX,
  FOOTER_BAND_PX,
  type Pagination,
  type PrintPage,
} from '@/lib/sheets/print/paginate';
import {
  expandTokens,
  type HeaderFooterContext,
} from '@/lib/sheets/print/header-footer';
import {
  paperPx,
  withPrintDefaults,
  PX_PER_IN,
  type PrintSetup,
} from '@/lib/sheets/print/print-types';

export interface PrintDocumentProps {
  sheet: Sheet;
  computed: Record<string, unknown>;
  condFmt: Record<string, CellStyle>;
  setup: PrintSetup;
  pagination: Pagination;
  fileName: string;
  /** Base date/time context (formatted) for header/footer tokens. */
  dateStr: string;
  timeStr: string;
}

const HEADINGS_COL_W = 40;
const HEADINGS_ROW_H = 18;

/** Set of A1 keys covered by a checkbox validation rule. */
function checkboxCells(sheet: Sheet): Set<string> {
  const set = new Set<string>();
  for (const v of sheet.validations ?? []) {
    if (v.type !== 'checkbox') continue;
    const { r1, c1, r2, c2 } = v.range;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
        set.add(rcToA1(r, c));
  }
  return set;
}

function HeaderFooterBand({
  setup,
  ctx,
  which,
}: {
  setup: PrintSetup;
  ctx: HeaderFooterContext;
  which: 'header' | 'footer';
}) {
  const hf = which === 'header' ? setup.header : setup.footer;
  const height = which === 'header' ? HEADER_BAND_PX : FOOTER_BAND_PX;
  return (
    <div
      className="sh-print-band"
      style={{
        display: 'flex',
        height,
        fontSize: 9,
        color: '#444',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, textAlign: 'left' }}>
        {expandTokens(hf.left, ctx)}
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        {expandTokens(hf.center, ctx)}
      </div>
      <div style={{ flex: 1, textAlign: 'right' }}>
        {expandTokens(hf.right, ctx)}
      </div>
    </div>
  );
}

function PageTable({
  page,
  sheet,
  computed,
  condFmt,
  setup,
  checkboxes,
}: {
  page: PrintPage;
  sheet: Sheet;
  computed: Record<string, unknown>;
  condFmt: Record<string, CellStyle>;
  setup: PrintSetup;
  checkboxes: Set<string>;
}) {
  const gridBorder = setup.gridlines ? '1px solid #c9c9c9' : 'none';
  const scale = page.scale || 1;
  const naturalW =
    (setup.headings ? HEADINGS_COL_W : 0) +
    page.cols.reduce((s, c) => s + c.width, 0);
  const naturalH =
    (setup.headings ? HEADINGS_ROW_H : 0) +
    page.rows.reduce((s, r) => s + r.height, 0);

  // Merge handling — mirrors grid.tsx: the anchor cell spans rowSpan×colSpan
  // and every other cell inside the merge is omitted from the table. Spans are
  // clipped to the rows/cols actually present on this page (a merge split
  // across a page break renders as partial blocks, like Excel).
  const { mergeSpans, mergeSkips } = React.useMemo(() => {
    const rowOrder = page.rows.map((r) => r.index);
    const colOrder = page.cols.map((c) => c.index);
    const rowHByIdx = new Map(page.rows.map((r) => [r.index, r.height]));
    const spans: Record<
      string,
      { rowSpan: number; colSpan: number; mergedH: number }
    > = {};
    const skips = new Set<string>();
    for (const mg of sheet.merges ?? []) {
      const r1 = Math.min(mg.r1, mg.r2);
      const r2 = Math.max(mg.r1, mg.r2);
      const c1 = Math.min(mg.c1, mg.c2);
      const c2 = Math.max(mg.c1, mg.c2);
      const rowsIn = rowOrder.filter((r) => r >= r1 && r <= r2);
      const colsIn = colOrder.filter((c) => c >= c1 && c <= c2);
      if (rowsIn.length === 0 || colsIn.length === 0) continue;
      const anchor = rcToA1(rowsIn[0], colsIn[0]);
      const mergedH = rowsIn.reduce((s, r) => s + (rowHByIdx.get(r) ?? 0), 0);
      spans[anchor] = {
        rowSpan: rowsIn.length,
        colSpan: colsIn.length,
        mergedH,
      };
      for (const r of rowsIn)
        for (const c of colsIn) {
          const a1 = rcToA1(r, c);
          if (a1 !== anchor) skips.add(a1);
        }
    }
    return { mergeSpans: spans, mergeSkips: skips };
  }, [page.rows, page.cols, sheet.merges]);

  const table = (
    <table
      style={{
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        margin: 0,
      }}
    >
      <colgroup>
        {setup.headings && (
          <col style={{ width: HEADINGS_COL_W }} />
        )}
        {page.cols.map((col) => (
          <col key={`c${col.index}`} style={{ width: col.width }} />
        ))}
      </colgroup>
      <tbody>
        {setup.headings && (
          <tr style={{ height: HEADINGS_ROW_H }}>
            {/* corner */}
            <th
              style={{
                width: HEADINGS_COL_W,
                background: '#f1f3f4',
                border: '1px solid #c9c9c9',
                fontSize: 9,
                fontWeight: 500,
                color: '#5f6368',
              }}
            />
            {page.cols.map((col) => (
              <th
                key={`h${col.index}`}
                style={{
                  background: '#f1f3f4',
                  border: '1px solid #c9c9c9',
                  fontSize: 9,
                  fontWeight: 500,
                  color: '#5f6368',
                  height: HEADINGS_ROW_H,
                }}
              >
                {colA1(col.index)}
              </th>
            ))}
          </tr>
        )}
        {page.rows.map((row) => (
          <tr key={`r${row.index}`} style={{ height: row.height }}>
            {setup.headings && (
              <th
                style={{
                  width: HEADINGS_COL_W,
                  background: '#f1f3f4',
                  border: '1px solid #c9c9c9',
                  fontSize: 9,
                  fontWeight: 500,
                  color: '#5f6368',
                  textAlign: 'center',
                }}
              >
                {row.index + 1}
              </th>
            )}
            {page.cols.map((col) => {
              const a1 = rcToA1(row.index, col.index);
              // Cells covered by a merge (non-anchor) are omitted entirely.
              if (mergeSkips.has(a1)) return null;
              const span = mergeSpans[a1];
              const cell = sheet.cells?.[a1];
              const pres = buildCellPresentation(
                cell,
                computed[a1],
                span ? span.mergedH : row.height,
                condFmt[a1],
                {
                  isCheckbox: checkboxes.has(a1),
                  applyOwnBorders: true,
                },
              );
              // Each side uses the cell's explicit border if present, else the
              // gridline default ('none' when gridlines are off).
              const tdStyle: React.CSSProperties = {
                ...pres.tdStyle,
                borderTop: pres.tdStyle.borderTop ?? gridBorder,
                borderRight: pres.tdStyle.borderRight ?? gridBorder,
                borderBottom: pres.tdStyle.borderBottom ?? gridBorder,
                borderLeft: pres.tdStyle.borderLeft ?? gridBorder,
                overflow: 'hidden',
              };
              let inner: React.ReactNode = pres.text || '';
              if (pres.kind === 'link' && pres.link) {
                inner = (
                  <a
                    href={pres.link.url}
                    style={{ color: '#1a73e8', textDecoration: 'underline' }}
                  >
                    {pres.link.text ?? pres.text}
                  </a>
                );
              } else if (pres.kind === 'image' && pres.img) {
                // eslint-disable-next-line @next/next/no-img-element
                inner = (
                  <img
                    src={pres.img.src}
                    alt={pres.img.alt ?? ''}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                  />
                );
              }
              return (
                <td
                  key={`${a1}`}
                  style={tdStyle}
                  rowSpan={span?.rowSpan}
                  colSpan={span?.colSpan}
                >
                  <div style={pres.innerStyle} className={pres.innerClass}>
                    {inner}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Scale the whole body uniformly so fonts, borders, widths and heights all
  // shrink together (matches Excel's "fit to" behaviour — no text clipping).
  // The outer box carries the SCALED footprint so flex centering is correct.
  return (
    <div
      style={{
        width: naturalW * scale,
        height: naturalH * scale,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: naturalW,
          height: naturalH,
        }}
      >
        {table}
      </div>
    </div>
  );
}

/**
 * Renders the full paginated print document — one `.sh-print-page` per page.
 * Used both inline in the preview modal and serialized into the print iframe.
 */
export function PrintDocument(props: PrintDocumentProps) {
  const setup = withPrintDefaults(props.setup);
  const { pagination, sheet, computed, condFmt, fileName, dateStr, timeStr } =
    props;
  const paper = paperPx(setup);
  const m = setup.margins;
  const checkboxes = React.useMemo(() => checkboxCells(sheet), [sheet]);

  return (
    <>
      {pagination.pages.map((page) => {
        const ctx: HeaderFooterContext = {
          page: page.pageIndex,
          pages: page.totalPages,
          date: dateStr,
          time: timeStr,
          tab: sheet.name,
          file: fileName,
        };
        return (
          <div
            key={page.pageIndex}
            className="sh-print-page"
            style={{
              width: paper.w,
              height: paper.h,
              boxSizing: 'border-box',
              paddingTop: m.top * PX_PER_IN,
              paddingRight: m.right * PX_PER_IN,
              paddingBottom: m.bottom * PX_PER_IN,
              paddingLeft: m.left * PX_PER_IN,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {pagination.hasHeader && (
              <HeaderFooterBand setup={setup} ctx={ctx} which="header" />
            )}
            <div
              style={{
                flex: 1,
                display: 'flex',
                overflow: 'hidden',
                justifyContent: setup.centerH ? 'center' : 'flex-start',
                alignItems: setup.centerV ? 'center' : 'flex-start',
              }}
            >
              <PageTable
                page={page}
                sheet={sheet}
                computed={computed}
                condFmt={condFmt}
                setup={setup}
                checkboxes={checkboxes}
              />
            </div>
            {pagination.hasFooter && (
              <HeaderFooterBand setup={setup} ctx={ctx} which="footer" />
            )}
          </div>
        );
      })}
    </>
  );
}
