'use client';
import type { ReportElement } from '@/schemas/report';
import { Wifi } from 'lucide-react';

// ── Column definition ─────────────────────────────────────────────────────────

export interface GroupedTableColumn {
  /** Header text. Use \n for a two-line header (second line rendered smaller). */
  label: string;
  /** Which grouping level this column belongs to. */
  level: 'group_no' | 'group' | 'subgroup' | 'detail';
  /** Dot-path into the data object. Empty string = computed (e.g. group_no). */
  field: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  color?: string;
  format?: 'text' | 'number' | 'number_2dp' | 'currency_khr';
}

/** Default column set matching the EV site-performance report table. */
export const GROUPED_TABLE_DEFAULT_COLUMNS: GroupedTableColumn[] = [
  { label: 'ល.រ',                level: 'group_no',  field: '',                     width: 36,  align: 'center' },
  { label: 'ក្រុមហ៊ុន',           level: 'group',     field: 'company_kh',           width: 110, align: 'left',   color: '#1d6bbc', bold: true },
  { label: 'ស្ថានីយ',             level: 'subgroup',  field: 'site_kh',              width: 120, align: 'left' },
  { label: 'ទូទាត់',              level: 'detail',    field: 'id',                   width: 90,  align: 'left' },
  { label: 'អាតុភាព',             level: 'detail',    field: 'rated_power_display',  width: 60,  align: 'center' },
  { label: 'ប្រើប្រាស់',           level: 'detail',    field: 'sessions',             width: 55,  align: 'center', format: 'number' },
  { label: 'ថាមពលសរុប\n(kWh)',    level: 'detail',    field: 'kwh',                  width: 80,  align: 'right',  format: 'number_2dp' },
  { label: 'តម្លៃ (ស្ថូ)\n/kWh',   level: 'detail',    field: 'price',                width: 70,  align: 'right',  format: 'number' },
  { label: 'ចំណូល\n(ស្ថូ)',         level: 'detail',    field: 'revenue',              width: 90,  align: 'right',  bold: true, format: 'currency_khr' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getField(obj: Record<string, unknown>, field: string): unknown {
  if (!field) return '';
  return field.split('.').reduce<unknown>((cur, k) => {
    if (cur != null && typeof cur === 'object' && !Array.isArray(cur))
      return (cur as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

function formatVal(v: unknown, fmt?: string): string {
  if (v == null || v === '') return '';
  const n = parseFloat(String(v).replace(/,/g, ''));
  if (fmt && !isNaN(n)) {
    if (fmt === 'number')       return n.toLocaleString();
    if (fmt === 'number_2dp')   return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (fmt === 'currency_khr') return n.toLocaleString();
  }
  return String(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { element: ReportElement }

export function ElementGroupedTable({ element }: Props) {
  const p = element.props as {
    // data
    dataUrl?:        string;
    dataMethod?:     'GET' | 'POST';
    dataHeaders?:    string;   // JSON string
    dataPath?:       string;   // dot-path to array, e.g. "site_performance"
    groupByField?:   string;   // e.g. "company_kh"
    subGroupField?:  string;   // e.g. "site_kh"
    detailField?:    string;   // e.g. "chargers_detail"
    rawData?:        Record<string, unknown>[];
    columns?:        GroupedTableColumn[];
    // style
    headerBg?:         string;
    headerColor?:      string;
    headerFontSize?:   number;
    headerFontWeight?: string;
    headerPaddingY?:   number;
    fontSize?:         number;
    fontFamily?:       string;
    cellPaddingX?:     number;
    cellPaddingY?:     number;
    borderColor?:      string;
    borderWidth?:      number;
    borderStyle?:      string;
    outerBorder?:      boolean;
    showColBorders?:   boolean;
    showRowBorders?:   boolean;
    stripedRows?:      boolean;
    altRowBg?:         string;
    groupBg?:          string;
    subGroupBg?:       string;
  };

  const rawData    = p.rawData ?? [];
  const groupField = p.groupByField  ?? 'company_kh';
  const sgField    = p.subGroupField ?? 'site_kh';
  const detField   = p.detailField   ?? 'chargers_detail';
  const cols       = p.columns ?? GROUPED_TABLE_DEFAULT_COLUMNS;

  const headerBg = p.headerBg  ?? '#1e3a5f';
  const headerFg = p.headerColor ?? '#ffffff';
  const hFs      = p.headerFontSize ?? 10;
  const hFw      = p.headerFontWeight ?? '600';
  const hPy      = p.headerPaddingY ?? 7;
  const fs       = p.fontSize ?? 10;
  const cellPx   = p.cellPaddingX ?? 8;
  const cellPy   = p.cellPaddingY ?? 5;
  const bClr     = p.borderColor ?? '#d1d5db';
  const bW       = p.borderWidth ?? 1;
  const bSt      = p.borderStyle ?? 'solid';
  const bLine    = `${bW}px ${bSt} ${bClr}`;
  const showColB = p.showColBorders !== false;
  const showRowB = p.showRowBorders !== false;
  const outerB   = p.outerBorder !== false;

  // ── Build grouped structure ─────────────────────────────────────────────────
  type SiteEntry  = { siteRow: Record<string, unknown>; details: Record<string, unknown>[] };
  type GroupEntry = { key: string; firstRow: Record<string, unknown>; sites: SiteEntry[]; totalDetailRows: number };

  const groups: GroupEntry[]         = [];
  const groupIdx = new Map<string, number>();

  for (const siteRow of rawData) {
    const gKey    = String(getField(siteRow, groupField) ?? '');
    const details = (siteRow[detField] as Record<string, unknown>[] | undefined) ?? [];

    if (!groupIdx.has(gKey)) {
      groupIdx.set(gKey, groups.length);
      groups.push({ key: gKey, firstRow: siteRow, sites: [], totalDetailRows: 0 });
    }
    const grp = groups[groupIdx.get(gKey)!];
    grp.sites.push({ siteRow, details });
    grp.totalDetailRows += Math.max(1, details.length);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="w-full h-full overflow-auto"
      style={{
        fontFamily:    p.fontFamily,
        border:        outerB ? bLine : 'none',
        borderRadius:  outerB ? 4 : 0,
        fontSize:      fs,
        lineHeight:    1.3,
      }}
    >
      {/* datasource URL badge */}
      {p.dataUrl && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-accent-50 dark:bg-accent-950/30 border-b border-accent-200 dark:border-accent-800 flex-shrink-0">
          <Wifi className="w-2.5 h-2.5 text-accent-600" />
          <span className="text-[9px] text-accent-600 dark:text-accent-400 truncate">{p.dataUrl}</span>
        </div>
      )}

      <table className="w-full border-collapse" style={{ fontSize: fs, lineHeight: 1.3 }}>
        <colgroup>
          {cols.map((c, ci) => (
            <col key={ci} style={c.width != null ? { width: c.width } : undefined} />
          ))}
        </colgroup>

        {/* ── Header ── */}
        <thead>
          <tr>
            {cols.map((c, ci) => {
              const lines = c.label.split('\n');
              return (
                <th
                  key={ci}
                  style={{
                    background:    headerBg,
                    color:         headerFg,
                    padding:       `${hPy}px ${cellPx}px`,
                    fontSize:      hFs,
                    fontWeight:    hFw,
                    lineHeight:    1.3,
                    textAlign:     (c.align ?? 'center') as 'left' | 'center' | 'right',
                    verticalAlign: 'middle',
                    borderRight:   showColB && ci < cols.length - 1 ? bLine : 'none',
                    borderBottom:  bLine,
                    whiteSpace:    'pre-wrap',
                  }}
                >
                  {lines[0]}
                  {lines[1] && (
                    <><br /><span style={{ fontWeight: 400, opacity: 0.85 }}>{lines[1]}</span></>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody>
          {rawData.length === 0 ? (
            <tr>
              <td
                colSpan={cols.length}
                style={{ padding: '16px 8px', textAlign: 'center', color: '#9ca3af', fontSize: 10 }}
              >
                No data — set a URL and refresh in the properties panel
              </td>
            </tr>
          ) : groups.flatMap((grp, gi) => {
            const isLastGroup = gi === groups.length - 1;
            const groupBottomBorder = !isLastGroup ? bLine : 'none';
            const rows: React.ReactElement[] = [];
            let detRowIdx = 0;

            grp.sites.forEach((site, si) => {
              const siteDetCount = Math.max(1, site.details.length);
              const detailRows   = site.details.length ? site.details : [{}];
              const isLastSite   = si === grp.sites.length - 1;

              detailRows.forEach((detail, di) => {
                const isFirstInGroup  = si === 0 && di === 0;
                const isFirstInSite   = di === 0;
                const isLastInGroup   = isLastSite && di === detailRows.length - 1;
                const isLastInSite    = di === detailRows.length - 1;
                const rowBb = showRowB && !isLastInGroup ? bLine
                            : isLastInGroup              ? groupBottomBorder
                            : 'none';
                const siteRowBb = showRowB && !isLastInSite ? bLine
                                : isLastInGroup             ? groupBottomBorder
                                : showRowB                  ? bLine
                                : 'none';

                const altBg = p.stripedRows && detRowIdx % 2 === 1
                  ? (p.altRowBg ?? '#f9fafb')
                  : undefined;

                const cells: React.ReactElement[] = [];
                let ci = 0;
                for (const col of cols) {
                  const borderRight = showColB && ci < cols.length - 1 ? bLine : 'none';

                  const base: React.CSSProperties = {
                    padding:       `${cellPy}px ${cellPx}px`,
                    lineHeight:    1.3,
                    borderRight,
                    verticalAlign: 'middle',
                    textAlign:     (col.align ?? 'left') as 'left' | 'center' | 'right',
                    fontWeight:    col.bold ? 700 : undefined,
                    color:         col.color ?? undefined,
                  };

                  if (col.level === 'group_no') {
                    if (isFirstInGroup) {
                      cells.push(
                        <td key={ci} rowSpan={grp.totalDetailRows}
                          style={{ ...base, background: p.groupBg ?? 'transparent', borderBottom: groupBottomBorder }}>
                          {gi + 1}
                        </td>
                      );
                    }
                  } else if (col.level === 'group') {
                    if (isFirstInGroup) {
                      cells.push(
                        <td key={ci} rowSpan={grp.totalDetailRows}
                          style={{ ...base, background: p.groupBg ?? 'transparent', borderBottom: groupBottomBorder }}>
                          {formatVal(getField(grp.firstRow, col.field), col.format)}
                        </td>
                      );
                    }
                  } else if (col.level === 'subgroup') {
                    if (isFirstInSite) {
                      cells.push(
                        <td key={ci} rowSpan={siteDetCount}
                          style={{ ...base, background: p.subGroupBg ?? 'transparent', borderBottom: siteRowBb }}>
                          {formatVal(getField(site.siteRow, col.field), col.format)}
                        </td>
                      );
                    }
                  } else {
                    // detail
                    cells.push(
                      <td key={ci} style={{ ...base, borderBottom: rowBb, background: altBg }}>
                        {formatVal(getField(detail as Record<string, unknown>, col.field), col.format)}
                      </td>
                    );
                  }
                  ci++;
                }

                rows.push(
                  <tr key={`${gi}-${si}-${di}`}>
                    {cells}
                  </tr>
                );
                detRowIdx++;
              });
            });

            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
