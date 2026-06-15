'use client';
import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReportElement, DataWidgetType } from '@/schemas/report';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
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
    centerLabel?: 'none' | 'total' | 'custom' | 'datasource';
    centerDataSource?: unknown;
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
    barHeightScale?: number;
    barRowGap?: number;
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

  // Custom legend items — rendered as HTML outside of <ResponsiveContainer> so we
  // never use recharts' <Legend> class component. In recharts v3.x, Legend.componentDidUpdate
  // dispatches to an internal Redux store on every measurement; if getBoundingClientRect()
  // returns slightly-different sub-pixel values across frames the store cycles indefinitely,
  // producing React's "Maximum update depth exceeded" crash. Rendering our own HTML legend
  // completely removes that code path.
  const customLegendItems: { label: string; color: string }[] =
    chartType === 'bar-line'
      ? [
          { label: (p.barLabel  ?? 'Count') as string, color: accent },
          { label: (p.lineLabel ?? 'Value') as string, color: lineColor },
        ]
      : chartType === 'pie'
        ? series.map((s, i) => ({ label: s.name, color: s.color ?? PIE_PALETTE[i % PIE_PALETTE.length] }))
        : chartType === 'line'
          ? [{ label: (p.barLabel ?? 'Value') as string, color: accent }]
          : series.map((s, i) => ({ label: s.name, color: p.singleColor ? accent : (s.color ?? accent) }));
  const showCustomLegend = showLegend || (chartType === 'pie' && pieLabelPos !== 'outside');

  // bar-h derived values (computed once, used in chartBody)
  // hBarValueW: fixed-width value column — matches the PDF renderer's valueW defaults
  const hBarValueW  = p.showBarValues ? (p.valueRightMargin ?? (p.valueSuffix || p.value2Suffix ? 120 : 72)) : 0;
  const hBarLabelFW = p.boldLabels ? '600' : 'normal';
  const hBarLabelTA = (p.labelAlign === 'left' ? 'left' : p.labelAlign === 'center' ? 'center' : 'right') as React.CSSProperties['textAlign'];
  // Axis max — same "nice round number" algorithm as PDF renderer
  const hRawMax = Math.max(...series.map((s) => s.value), 1);
  const hMag    = Math.pow(10, Math.floor(Math.log10(hRawMax)));
  const hStep   = hMag >= 1 ? hMag : 1;
  const hAxMax  = Math.ceil(hRawMax / hStep) * hStep || 1;
  const hTicks  = [0, 0.25, 0.5, 0.75, 1.0].map((f) => Math.round(hAxMax * f));
  // Derive explicit row/bar pixel heights from element.h so bars scale exactly like the PDF.
  // PDF: rows share element height equally via flex:1, bar = 70% of row height.
  // percentage heights on flex children are unreliable when parent height comes from flex distribution.
  const hTitlePx   = title ? ((p.titleFontSize as number ?? 12) + 16) : 0;
  const hRowGap    = (p.barRowGap as number) ?? 6;
  const hAxisPx    = 18;  // matches PDF's 14px axis row + 4px margin-top
  const hPadPx     = 16;  // matches PDF's padding:8px on all sides (8 top + 8 bottom)
  const hTotalGaps = Math.max(0, series.length - 1) * hRowGap;
  const hAvailH    = Math.max(series.length * 8, element.h - hTitlePx - hPadPx - hAxisPx - hTotalGaps);
  const hRowH      = Math.round(hAvailH / series.length);
  const hBarH      = Math.max(3, Math.round(hRowH * (p.barHeightScale ?? 0.7)));

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
      {/* bar-h: pure CSS layout — explicit pixel heights derived from element.h, mirrors PDF exactly */}
      {chartType === 'bar-h' ? (
        <div className="flex-1 overflow-hidden flex flex-col p-2">
          {/* Data rows — explicit hRowH so sizing is identical to PDF's flex:1 distribution */}
          <div className="flex flex-col" style={{ gap: hRowGap }}>
            {series.map((s, i) => {
              const pct      = Math.min(100, (s.value / hAxMax) * 100);
              const color    = p.singleColor ? accent : (s.color ?? accent);
              const numStr   = s.value.toLocaleString('en-US');
              const suffix   = p.valueSuffix ? ` ${p.valueSuffix}` : '';
              const v2part   = s.value2 !== undefined && p.value2Suffix
                ? ` (${(s.value2 as number).toLocaleString('en-US')} ${p.value2Suffix})` : '';
              const valLabel = `${numStr}${suffix}${v2part}`;
              return (
                <div key={i} style={{ height: hRowH, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Label */}
                  <div style={{ width: lWidth, fontSize: lSize, fontFamily: lFamily || undefined, color: lColor, fontWeight: hBarLabelFW, textAlign: hBarLabelTA, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </div>
                  {/* Bar track + fill — explicit hBarH px, no percentage ambiguity */}
                  {p.showBarTrack ? (
                    <div style={{ flex: 1, height: hBarH, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '0 3px 3px 0' }} />
                    </div>
                  ) : (
                    <div style={{ flex: 1, height: hBarH, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '0 3px 3px 0' }} />
                    </div>
                  )}
                  {/* Value */}
                  {p.showBarValues && (
                    <div style={{ width: hBarValueW, fontSize: vSize, fontFamily: lFamily || undefined, color: vColor, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {valLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* X-axis tick row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 3, height: 16 }}>
            <div style={{ width: lWidth, flexShrink: 0 }} />
            <div style={{ flex: 1, position: 'relative' }}>
              {hTicks.map((t, fi) => {
                // Use maximumFractionDigits:1 (not toFixed) so trailing ".0" is suppressed — matches PDF renderer
                const fmtT = t >= 1_000_000
                  ? `${(t / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
                  : t >= 1_000
                    ? `${(t / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
                    : String(t);
                return (
                  <span key={fi} style={{ position: 'absolute', left: `${Math.round((fi / 4) * 100)}%`, transform: 'translateX(-50%)', fontSize: Math.max(7, lSize - 1), fontFamily: lFamily || undefined, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                    {fmtT}
                  </span>
                );
              })}
            </div>
            {p.showBarValues && <div style={{ width: hBarValueW, flexShrink: 0 }} />}
          </div>
        </div>
      ) : (
      <>
        {/* Custom legend — HTML outside recharts so Legend's Redux dispatch loop never runs */}
        {showCustomLegend && customLegendItems.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', padding: '0 8px 4px', flexShrink: 0 }}>
            {customLegendItems.map((item, idx) => (
              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: lSize, fontFamily: lFamily || undefined }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ color: lColor }}>{item.label}</span>
              </span>
            ))}
          </div>
        )}
      <div className="flex-1 min-h-0 p-1">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
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
            </PieChart>

          ) : chartType === 'line' ? (
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT_STYLE} />
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
              <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {series.map((s, i) => <Cell key={i} fill={p.singleColor ? accent : (s.color ?? accent)} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      </>
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

// Prevent recharts' Legend.componentDidUpdate dispatch loop: chart element props
// are reference-stable across auto-layout passes, so skip re-renders when nothing
// actually changed (recharts dispatches on every render of its connected components).
export const ElementChartMemo = memo(ElementChart);
