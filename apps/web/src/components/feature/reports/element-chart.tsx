'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReportElement, DataWidgetType } from '@/schemas/report';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
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
import { Maximize2, Wifi, X } from 'lucide-react';
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

function pieLabelText(
  name: string, value: number, percent: number,
  type = 'name-percent',
): string {
  const pct = `${(percent * 100).toFixed(0)}%`;
  if (type === 'name')         return name;
  if (type === 'percent')      return pct;
  if (type === 'value')        return String(value);
  if (type === 'name-value')   return `${name}: ${value}`;
  return `${name} ${pct}`; // name-percent (default)
}

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
    background:    (p.background as string) || 'var(--bg-card)', // 'transparent' is truthy, passes through
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
    showBarTrack?: boolean;
    labelFontFamily?: string;
    labelFontSize?: number;
    labelWidth?: number;
    labelColor?: string;
    labelAlign?: 'left' | 'center' | 'right';
    valueFontSize?: number;
    valueColor?: string;
    titleAlign?: 'left' | 'center' | 'right';
    titleFontSize?: number;
    titleColor?: string;
    xAxisLabel?: string;
    leftAxisLabel?: string;
    rightAxisLabel?: string;
    // Pie-specific
    pieStyle?: 'solid' | 'donut';
    innerRadius?: number;
    centerLabel?: 'none' | 'total' | 'custom';
    centerText?: string;
    centerFontSize?: number;
    centerColor?: string;
    pieLabel?: 'none' | 'outside' | 'inside';
    labelContent?: 'name' | 'percent' | 'value' | 'name-percent' | 'name-value';
    labelLine?: boolean;
    paddingAngle?: number;
    labelNameSuffix?: string;
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
    barRowHeight?: number;
    valueSuffix?: string;
    value2Suffix?: string;
    boldLabels?: boolean;
    valueRightMargin?: number;
  };

  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  const chartType: ChartType = p.chartType ?? 'bar';
  // Steel blue default for dual-axis (matches the EV-style chart), indigo for others
  const accent     = p.colorScheme ?? (chartType === 'bar-line' ? '#5b9bd5' : '#6366f1');
  const lineColor  = p.lineColor   ?? '#f59e0b';
  const title      = p.title ?? '';
  const showGrid   = p.showGrid ?? (chartType === 'bar-line');
  const showLegend = p.showLegend ?? (chartType === 'bar-line' || chartType === 'pie');

  // Shared typography (used by bar-h, bar-line, and pie)
  const lSize   = p.labelFontSize  ?? 9;
  const vSize   = p.valueFontSize  ?? 9;
  const lColor  = p.labelColor     ?? '#6b7280';
  const vColor  = p.valueColor     ?? '#6b7280';
  const lFamily = p.labelFontFamily ?? undefined;
  const lWidth  = p.labelWidth     ?? 80;
  const lAnchor = p.labelAlign === 'left' ? 'start'
                : p.labelAlign === 'center' ? 'middle'
                : 'end';

  // Outside label renderer — two tspan lines for name+value/percent combos
  const renderOutsideLabel = (props: object) => {
    const { cx, cy, midAngle, outerRadius, name, value, percent } = props as {
      cx: number; cy: number; midAngle: number; outerRadius: number;
      name: string; value: number; percent: number;
    };
    if (percent < 0.02) return null;
    const RADIAN  = Math.PI / 180;
    const radius  = (outerRadius as number) + 22;
    const x       = (cx as number) + radius * Math.cos(-(midAngle as number) * RADIAN);
    const y       = (cy as number) + radius * Math.sin(-(midAngle as number) * RADIAN);
    const anchor  = x > (cx as number) ? 'start' : 'end';
    const suffix  = (p.labelNameSuffix as string) ?? '';
    const nameT   = suffix ? `${name}${suffix}` : name;
    const pct     = `${(percent * 100).toFixed(0)}%`;
    const lineH   = lSize * 1.3;

    // Two-line: name on top, value/percent on bottom
    if (labelContentT === 'name-percent' || labelContentT === 'name-value') {
      const line2 = labelContentT === 'name-percent' ? pct : String(value);
      return (
        <text x={x} y={y - lineH / 2} textAnchor={anchor}
          style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor}>
          <tspan x={x} dy="0">{nameT}</tspan>
          <tspan x={x} dy={lineH}>{line2}</tspan>
        </text>
      );
    }

    // Single line
    const content = labelContentT === 'percent' ? pct
                  : labelContentT === 'value'   ? String(value)
                  : nameT;
    return (
      <text x={x} y={y} textAnchor={anchor} dominantBaseline="central"
        style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor}>
        {content}
      </text>
    );
  };

  // Inside label renderer
  const renderInsideLabel = (props: object) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, name, value, percent } = props as {
      cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number;
      name: string; value: number; percent: number;
    };
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const radius = (innerRadius as number) + ((outerRadius as number) - (innerRadius as number)) * 0.5;
    const x = (cx as number) + radius * Math.cos(-(midAngle as number) * RADIAN);
    const y = (cy as number) + radius * Math.sin(-(midAngle as number) * RADIAN);
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
        style={{ fontFamily: lFamily }} fontSize={lSize} fill="#ffffff" fontWeight="600">
        {pieLabelText(name, value, percent, labelContentT)}
      </text>
    );
  };

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

  // Pie-specific derived values (must be after `series`)
  const PIE_PALETTE   = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6','#f97316','#64748b'];
  const pieLabelPos   = (p.pieLabel    ?? 'outside') as string;
  const labelContentT = (p.labelContent ?? 'name-percent') as string;
  const showLabelLine = p.labelLine !== false && pieLabelPos === 'outside';
  const pieInnerR     = p.pieStyle === 'donut' ? `${p.innerRadius ?? 35}%` : 0;
  const pieOuterR     = p.pieStyle === 'donut' ? '55%' : '65%';
  const padAngle      = p.paddingAngle ?? 2;
  const pieTotal      = series.reduce((acc, s) => acc + s.value, 0);
  let pieCenterValue  = '';
  if (p.pieStyle === 'donut' && p.centerLabel && p.centerLabel !== 'none') {
    pieCenterValue = p.centerLabel === 'total' ? String(pieTotal) : (p.centerText ?? '');
  }

  const hasLive = !!p.dataSource?.url;

  // Shared grid element
  const grid = showGrid
    ? <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
    : null;

  const legendEl = showLegend
    ? <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
    : null;

  // bar-h derived values (computed once, used in chartBody)
  const hBarRMargin = p.showBarValues ? (p.valueRightMargin ?? (p.valueSuffix || p.value2Suffix ? 160 : 48)) : 8;
  const hBarLabelFW = p.boldLabels ? '600' : 'normal';

  // Dynamic margins for bar-line axis labels
  const blMargin = {
    top:    8,
    right:  p.rightAxisLabel ? 56 : 32,
    bottom: p.xAxisLabel     ? 22 : 4,
    left:   p.leftAxisLabel  ? 12 : -20,
  };

  const chartBody = (
    <>
      {hasLive && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-accent-50 dark:bg-accent-950/30 border-b border-accent-200 dark:border-accent-800 flex-shrink-0">
          <Wifi className="w-2.5 h-2.5 text-accent-600" />
          <span className="text-[9px] text-accent-600 dark:text-accent-400 truncate">{p.dataSource!.url}</span>
        </div>
      )}
      {title && (
        <div
          className="px-3 pt-2 pb-0 font-semibold text-text-sub flex-shrink-0"
          style={{
            fontFamily:  lFamily || undefined,
            fontSize:    p.titleFontSize  ?? 12,
            color:       p.titleColor     ?? undefined,
            textAlign:   p.titleAlign     ?? 'left',
          }}
        >
          {title}
        </div>
      )}
      {/* bar-h: scrollable container sized to fit all rows */}
      {chartType === 'bar-h' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-1">
          <ResponsiveContainer width="100%" height={Math.max(series.length * (p.barRowHeight ?? 26) + 24, 120)}>
            <BarChart data={series} layout="vertical" margin={{ top: 4, right: hBarRMargin, bottom: 4, left: 4 }}>
              {grid}
              <XAxis
                type="number"
                tick={(props: object) => {
                  const { x, y, payload } = props as { x: number; y: number; payload: { value: number } };
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy="0.71em" style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor} textAnchor="middle">
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={(props: object) => {
                  const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy="0.355em" style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor} textAnchor={lAnchor} fontWeight={hBarLabelFW}>
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                axisLine={false}
                tickLine={false}
                width={lWidth}
              />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Bar
                dataKey="value"
                radius={[0, 3, 3, 0]}
                background={p.showBarTrack ? { fill: '#e5e7eb', radius: 3 } : false}
                isAnimationActive={false}
              >
                {series.map((s, i) => <Cell key={i} fill={p.singleColor ? accent : (s.color ?? accent)} />)}
                {p.showBarValues && (
                  <LabelList
                    dataKey="value"
                    position="right"
                    content={(lProps: object) => {
                      const { x, y, width, height, value, index } = lProps as {
                        x: number; y: number; width: number; height: number; value: number; index: number;
                      };
                      const entry = series[index];
                      const numStr = typeof value === 'number' ? value.toLocaleString() : String(value);
                      const suffix = p.valueSuffix ? ` ${p.valueSuffix}` : '';
                      const v2     = entry?.value2;
                      const v2part = v2 !== undefined && p.value2Suffix
                        ? ` (${v2.toLocaleString()} ${p.value2Suffix})`
                        : '';
                      const label = `${numStr}${suffix}${v2part}`;
                      return (
                        <text
                          x={x + width + 5}
                          y={y + height / 2}
                          dy="0.355em"
                          style={{ fontFamily: lFamily }}
                          fontSize={vSize}
                          fill={vColor}
                          textAnchor="start"
                        >
                          {label}
                        </text>
                      );
                    }}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
      <div className="flex-1 min-h-0 p-1">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={series}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                outerRadius={pieOuterR}
                innerRadius={pieInnerR}
                paddingAngle={padAngle}
                label={pieLabelPos === 'outside' ? renderOutsideLabel : pieLabelPos === 'inside' ? renderInsideLabel : false}
                labelLine={showLabelLine ? { stroke: '#9ca3af', strokeWidth: 1 } : false}
                isAnimationActive={false}
              >
                {series.map((s, i) => <Cell key={i} fill={s.color ?? PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                {pieCenterValue && (
                  <Label
                    content={(props: object) => {
                      const { viewBox } = props as { viewBox: { cx: number; cy: number } };
                      return (
                        <text x={viewBox.cx} y={viewBox.cy}
                          textAnchor="middle" dominantBaseline="central"
                          style={{ fontFamily: lFamily }}
                          fontSize={p.centerFontSize ?? 24}
                          fill={p.centerColor ?? '#111111'}
                          fontWeight="700"
                        >
                          {pieCenterValue}
                        </text>
                      );
                    }}
                  />
                )}
              </Pie>
              <Tooltip contentStyle={TT_STYLE} />
              {(p.showLegend || pieLabelPos !== 'outside') && (
                <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: lSize, fontFamily: lFamily || undefined }} />
              )}
            </PieChart>

          ) : chartType === 'line' ? (
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Line type="monotone" dataKey="value" stroke={accent} strokeWidth={2}
                dot={{ r: 3, fill: accent, strokeWidth: 0 }} activeDot={{ r: 4 }}
                isAnimationActive={false} />
            </LineChart>

          ) : chartType === 'bar-line' ? (
            <ComposedChart data={series} margin={blMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

              {/* Custom tick renderers so CSS-variable font-family values work in SVG */}
              <XAxis
                dataKey="name"
                tick={(props: object) => {
                  const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy="0.71em" style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor} textAnchor="middle">
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                axisLine={false}
                tickLine={false}
                height={p.xAxisLabel ? 36 : 20}
                label={p.xAxisLabel ? {
                  value: p.xAxisLabel,
                  position: 'insideBottom',
                  style: { ...AXIS_LABEL_STYLE, fontSize: lSize, fill: lColor, fontFamily: lFamily || undefined },
                } : undefined}
              />

              <YAxis
                yAxisId="left"
                tick={(props: object) => {
                  const { x, y, payload } = props as { x: number; y: number; payload: { value: number } };
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy="0.355em" style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor} textAnchor="end">
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                axisLine={false}
                tickLine={false}
                width={p.leftAxisLabel ? 48 : 30}
                label={p.leftAxisLabel ? {
                  value: p.leftAxisLabel,
                  angle: -90,
                  position: 'insideLeft',
                  offset: 12,
                  style: { ...AXIS_LABEL_STYLE, fontSize: lSize, fill: lColor, fontFamily: lFamily || undefined },
                } : undefined}
              />

              <YAxis
                yAxisId="right"
                orientation="right"
                tick={(props: object) => {
                  const { x, y, payload } = props as { x: number; y: number; payload: { value: number } };
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy="0.355em" style={{ fontFamily: lFamily }} fontSize={lSize} fill={lColor} textAnchor="start">
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                axisLine={false}
                tickLine={false}
                width={p.rightAxisLabel ? 52 : 36}
                label={p.rightAxisLabel ? {
                  value: p.rightAxisLabel,
                  angle: 90,
                  position: 'insideRight',
                  style: { ...AXIS_LABEL_STYLE, fontSize: lSize, fill: lColor, fontFamily: lFamily || undefined },
                } : undefined}
              />

              <Tooltip contentStyle={TT_STYLE} />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: lSize, fontFamily: lFamily || undefined }} verticalAlign="top" />

              <Bar
                yAxisId="left"
                dataKey="value"
                name={p.barLabel ?? 'Count'}
                fill={accent}
                radius={[1, 1, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
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
                isAnimationActive={false}
              />
            </ComposedChart>

          ) : (
            <BarChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT_STYLE} />
              {legendEl}
              <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {series.map((s, i) => <Cell key={i} fill={p.singleColor ? accent : (s.color ?? accent)} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      )}
    </>
  );

  return (
    <>
      <div
        className="group relative"
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...makeChartStyle(p as Record<string, unknown>) }}
      >
        {chartBody}

        {/* Expand button — visible on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60 z-10"
          title="ពង្រីកទំហំ (Expand chart)"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>

      {/* Fullscreen modal */}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[600] flex flex-col bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={(e) => e.target === e.currentTarget && setExpanded(false)}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-3 bg-bg-card border-b border-border flex-shrink-0">
            <span className="font-semibold text-sm text-text truncate">{title || 'Chart'}</span>
            <button
              onClick={() => setExpanded(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Chart area — fills remaining space */}
          <div
            className="flex-1 min-h-0 p-6 flex flex-col"
            style={{ ...makeChartStyle(p as Record<string, unknown>), borderRadius: 0, border: 'none' }}
          >
            {chartBody}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
