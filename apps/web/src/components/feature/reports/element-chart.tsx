'use client';
import type { ReportElement, DataWidgetType } from '@/schemas/report';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Wifi } from 'lucide-react';
import type { StoredChartDatasource } from './chart-datasource-panel';

export type ChartType = 'bar' | 'pie' | 'line' | 'bar-line' | 'bar-h';

export interface SeriesItem { name: string; value: number; value2?: number; color?: string }

const MOCK_SERIES: Record<string, SeriesItem[]> = {
  issues_by_status: [
    { name: 'Open',        value: 67, color: '#6366f1' },
    { name: 'In Progress', value: 31, color: '#f59e0b' },
    { name: 'Done',        value: 75, color: '#22c55e' },
    { name: 'Blocked',     value: 8,  color: '#ef4444' },
  ],
  users_by_department: [
    { name: 'Eng',         value: 5,  color: '#6366f1' },
    { name: 'Design',      value: 2,  color: '#ec4899' },
    { name: 'Product',     value: 2,  color: '#f59e0b' },
    { name: 'Marketing',   value: 2,  color: '#22c55e' },
    { name: 'Sales',       value: 1,  color: '#06b6d4' },
  ],
};

const DEFAULT_SERIES: SeriesItem[] = [
  { name: 'Jan', value: 40, color: '#6366f1' },
  { name: 'Feb', value: 55, color: '#6366f1' },
  { name: 'Mar', value: 30, color: '#6366f1' },
  { name: 'Apr', value: 72, color: '#6366f1' },
  { name: 'May', value: 61, color: '#6366f1' },
];

const MOCK_DUAL: SeriesItem[] = [
  { name: '00', value: 0,  value2: 0   },
  { name: '02', value: 1,  value2: 25  },
  { name: '04', value: 0,  value2: 5   },
  { name: '06', value: 4,  value2: 100 },
  { name: '08', value: 6,  value2: 150 },
  { name: '10', value: 12, value2: 280 },
  { name: '12', value: 11, value2: 290 },
  { name: '14', value: 19, value2: 490 },
  { name: '16', value: 7,  value2: 200 },
  { name: '18', value: 5,  value2: 390 },
  { name: '20', value: 7,  value2: 240 },
  { name: '22', value: 2,  value2: 30  },
];

const MOCK_H: SeriesItem[] = [
  { name: 'Category A', value: 46, color: '#6366f1' },
  { name: 'Category B', value: 57, color: '#6366f1' },
  { name: 'Category C', value: 29, color: '#6366f1' },
  { name: 'Category D', value: 74, color: '#6366f1' },
];

const TT_STYLE = {
  fontSize: 10,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,.08)',
};

const AXIS_LABEL_STYLE = { fontSize: 9, fill: '#6b7280', textAnchor: 'middle' as const };

interface Props { element: ReportElement }

function makeChartStyle(p: Record<string, unknown>): React.CSSProperties {
  const sides  = (p.borderSides as string[] | undefined) ?? ['top', 'right', 'bottom', 'left'];
  const bColor = (p.borderColor as string)  ?? '#e5e7eb';
  const bWidth = (p.borderWidth as number)  ?? 1;
  const bStyle = (p.borderStyle as string)  ?? 'solid';
  const bStr   = `${bWidth}px ${bStyle} ${bColor}`;
  return {
    borderRadius:  (p.borderRadius as number) ?? 8,
    borderTop:     sides.includes('top')    ? bStr : 'none',
    borderRight:   sides.includes('right')  ? bStr : 'none',
    borderBottom:  sides.includes('bottom') ? bStr : 'none',
    borderLeft:    sides.includes('left')   ? bStr : 'none',
    background:    (p.background as string) || 'var(--bg-card)',
    boxShadow:     (p.shadow as boolean)    ? '0 4px 6px -1px rgba(0,0,0,.12),0 2px 4px -2px rgba(0,0,0,.08)' : undefined,
    opacity:       p.opacity !== undefined  ? (p.opacity as number) : undefined,
    padding:       `${(p.paddingY as number) ?? 0}px ${(p.paddingX as number) ?? 0}px`,
  };
}

export function ElementChart({ element }: Props) {
  const p = element.props as {
    widgetType?: DataWidgetType;
    chartType?: ChartType;
    title?: string;
    colorScheme?: string;
    dataSource?: StoredChartDatasource;
    seriesData?: SeriesItem[];
    barLabel?: string;
    lineLabel?: string;
    lineColor?: string;
    showGrid?: boolean;
    showLegend?: boolean;
    sortDesc?: boolean;
    showBarValues?: boolean;
    singleColor?: boolean;
    xAxisLabel?: string;
    leftAxisLabel?: string;
    rightAxisLabel?: string;
    // border & appearance (from properties panel)
    borderRadius?: number;
    borderColor?: string;
    borderWidth?: number;
    borderSides?: string[];
    borderStyle?: string;
    background?: string;
    shadow?: boolean;
    opacity?: number;
    paddingX?: number;
    paddingY?: number;
  };

  const chartType: ChartType = p.chartType ?? 'bar';
  // Steel blue default for dual-axis (matches the EV-style chart), indigo for others
  const accent     = p.colorScheme ?? (chartType === 'bar-line' ? '#5b9bd5' : '#6366f1');
  const lineColor  = p.lineColor   ?? '#f59e0b';
  const title      = p.title ?? '';
  const showGrid   = p.showGrid ?? (chartType === 'bar-line');
  const showLegend = p.showLegend ?? (chartType === 'bar-line' || chartType === 'pie');

  const rawSeries: SeriesItem[] =
    p.seriesData?.length
      ? p.seriesData
      : chartType === 'bar-line'
        ? MOCK_DUAL
        : chartType === 'bar-h'
          ? MOCK_H
          : (p.widgetType && MOCK_SERIES[p.widgetType]) ?? DEFAULT_SERIES;

  const series =
    chartType === 'bar-h' && p.sortDesc
      ? [...rawSeries].sort((a, b) => b.value - a.value)
      : rawSeries;

  const hasLive = !!p.dataSource?.url;

  // Shared grid element
  const grid = showGrid
    ? <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
    : null;

  const legendEl = showLegend
    ? <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
    : null;

  // Dynamic margins for bar-line axis labels
  const blMargin = {
    top:    8,
    right:  p.rightAxisLabel ? 56 : 32,
    bottom: p.xAxisLabel     ? 22 : 4,
    left:   p.leftAxisLabel  ? 12 : -20,
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...makeChartStyle(p as Record<string, unknown>) }}>
      {hasLive && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-accent-50 dark:bg-accent-950/30 border-b border-accent-200 dark:border-accent-800 flex-shrink-0">
          <Wifi className="w-2.5 h-2.5 text-accent-600" />
          <span className="text-[9px] text-accent-600 dark:text-accent-400 truncate">{p.dataSource!.url}</span>
        </div>
      )}
      {title && (
        <div className="px-3 pt-2 pb-0 text-xs font-semibold text-text-sub flex-shrink-0">{title}</div>
      )}
      <div className="flex-1 min-h-0 p-1">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' ? (
            <PieChart>
              <Pie data={series} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="65%" paddingAngle={2}>
                {series.map((s, i) => <Cell key={i} fill={s.color ?? accent} />)}
              </Pie>
              <Tooltip contentStyle={TT_STYLE} />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
            </PieChart>

          ) : chartType === 'line' ? (
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Line type="monotone" dataKey="value" stroke={accent} strokeWidth={2}
                dot={{ r: 3, fill: accent, strokeWidth: 0 }} activeDot={{ r: 4 }} />
            </LineChart>

          ) : chartType === 'bar-line' ? (
            <ComposedChart data={series} margin={blMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

              <XAxis
                dataKey="name"
                tick={{ fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                height={p.xAxisLabel ? 36 : 20}
                label={p.xAxisLabel ? {
                  value: p.xAxisLabel,
                  position: 'insideBottom',
                  style: AXIS_LABEL_STYLE,
                } : undefined}
              />

              <YAxis
                yAxisId="left"
                tick={{ fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={p.leftAxisLabel ? 48 : 30}
                label={p.leftAxisLabel ? {
                  value: p.leftAxisLabel,
                  angle: -90,
                  position: 'insideLeft',
                  offset: 12,
                  style: AXIS_LABEL_STYLE,
                } : undefined}
              />

              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={p.rightAxisLabel ? 52 : 36}
                label={p.rightAxisLabel ? {
                  value: p.rightAxisLabel,
                  angle: 90,
                  position: 'insideRight',
                  style: AXIS_LABEL_STYLE,
                } : undefined}
              />

              <Tooltip contentStyle={TT_STYLE} />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />

              <Bar
                yAxisId="left"
                dataKey="value"
                name={p.barLabel ?? 'Count'}
                fill={accent}
                radius={[1, 1, 0, 0]}
                maxBarSize={18}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="value2"
                name={p.lineLabel ?? 'Value'}
                stroke={lineColor}
                strokeWidth={2}
                dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>

          ) : chartType === 'bar-h' ? (
            <BarChart data={series} layout="vertical" margin={{ top: 4, right: p.showBarValues ? 40 : 8, bottom: 4, left: 4 }}>
              {grid}
              <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {series.map((s, i) => <Cell key={i} fill={p.singleColor ? accent : (s.color ?? accent)} />)}
                {p.showBarValues && (
                  <LabelList dataKey="value" position="right" style={{ fontSize: 9, fill: '#6b7280' }} />
                )}
              </Bar>
            </BarChart>

          ) : (
            <BarChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {series.map((s, i) => <Cell key={i} fill={p.singleColor ? accent : (s.color ?? accent)} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
