import { colA1, rcToA1 } from './a1';
import type { Sheet, SheetChart } from '@/schemas/workbook';

export interface ChartSeries {
  /** Stable key used in the recharts data objects. */
  key: string;
  /** Human label shown in legend / tooltip. */
  name: string;
}

export interface ChartModel {
  /** One row per category. Each has `__cat` plus one entry per series key. */
  data: Array<Record<string, string | number | null>>;
  series: ChartSeries[];
  /** True when no numeric data could be extracted from the range. */
  empty: boolean;
}

/** Default palette — Google-Sheets-ish, colour-blind friendly enough for demos. */
export const CHART_PALETTE = [
  '#4285f4',
  '#ea4335',
  '#fbbc04',
  '#34a853',
  '#ff6d01',
  '#46bdc6',
  '#7e57c2',
  '#ec407a',
  '#9e9d24',
  '#26a69a',
];

function rawValue(
  sheet: Sheet,
  computed: Record<string, unknown>,
  r: number,
  c: number,
): string | number | null {
  const key = rcToA1(r, c);
  const comp = computed[key];
  if (comp !== undefined && comp !== null) {
    if (typeof comp === 'number' || typeof comp === 'string') return comp;
    if (typeof comp === 'boolean') return comp ? 1 : 0;
  }
  const cell = sheet.cells?.[key];
  const v = cell?.v;
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as string | number;
}

function asNumber(v: string | number | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return v.trim?.() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Turn a chart's source range into recharts-friendly rows + series metadata.
 * Layout follows the familiar spreadsheet convention: optional header row =
 * series names, optional header column = category (x-axis) labels.
 */
export function buildChartModel(
  sheet: Sheet,
  computed: Record<string, unknown>,
  chart: SheetChart,
): ChartModel {
  const { r1, c1, r2, c2 } = chart.range;
  const dataR1 = chart.headerRow ? r1 + 1 : r1;
  const dataC1 = chart.headerCol ? c1 + 1 : c1;

  if (dataR1 > r2 || dataC1 > c2) {
    return { data: [], series: [], empty: true };
  }

  // Series come from the data columns (one series per column).
  const series: ChartSeries[] = [];
  for (let c = dataC1; c <= c2; c++) {
    const name = chart.headerRow
      ? String(rawValue(sheet, computed, r1, c) ?? colA1(c))
      : colA1(c);
    series.push({ key: `s${c}`, name });
  }

  const data: ChartModel['data'] = [];
  let hasNumber = false;
  for (let r = dataR1; r <= r2; r++) {
    const cat = chart.headerCol
      ? String(rawValue(sheet, computed, r, c1) ?? r + 1)
      : String(r + 1);
    const row: Record<string, string | number | null> = { __cat: cat };
    for (let c = dataC1; c <= c2; c++) {
      const num = asNumber(rawValue(sheet, computed, r, c));
      row[`s${c}`] = num;
      if (num !== null) hasNumber = true;
    }
    data.push(row);
  }

  return { data, series, empty: !hasNumber };
}

/**
 * Pie charts use a single series (the first data column) and the category
 * labels as slice names.
 */
export function buildPieModel(
  sheet: Sheet,
  computed: Record<string, unknown>,
  chart: SheetChart,
): Array<{ name: string; value: number }> {
  const model = buildChartModel(sheet, computed, chart);
  const firstSeries = model.series[0];
  if (!firstSeries) return [];
  return model.data
    .map((row) => ({
      name: String(row.__cat ?? ''),
      value: typeof row[firstSeries.key] === 'number'
        ? (row[firstSeries.key] as number)
        : 0,
    }))
    .filter((d) => d.value !== 0 || d.name !== '');
}

/** A short label like "A1:D8" for the chart's source range. */
export function rangeLabel(chart: SheetChart): string {
  const { r1, c1, r2, c2 } = chart.range;
  return `${rcToA1(r1, c1)}:${rcToA1(r2, c2)}`;
}
