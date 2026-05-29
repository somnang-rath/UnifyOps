'use client';
import type { ReportElement, DataWidgetType } from '@/schemas/report';
import { DATA_WIDGET_CATALOG } from '@/schemas/report';
import type { StoredWidgetDatasource } from './widget-datasource-panel';
import { BarChart2, Code2, TrendingDown, TrendingUp, Wifi } from 'lucide-react';
import type { CSSProperties } from 'react';
import { runScript } from '@/lib/reports/script-runner';
import { useLiveWidgetData } from './widget-data-context';

// Compute all container-level visual styles from widget props
function makeWidgetStyle(
  p: Record<string, unknown>,
  defaults: { borderColor?: string; background?: string } = {},
): CSSProperties {
  const sides   = (p.borderSides as string[] | undefined) ?? ['top', 'right', 'bottom', 'left'];
  const color   = (p.borderColor as string | undefined) ?? defaults.borderColor ?? 'var(--border)';
  const width   = (p.borderWidth as number | undefined) ?? 1;
  const radius  = (p.borderRadius as number | undefined) ?? 8;
  const bStyle  = (p.borderStyle as string | undefined) ?? 'solid';
  const bStr    = `${width}px ${bStyle} ${color}`;

  const style: CSSProperties = {
    borderRadius: radius,
    borderTop:    sides.includes('top')    ? bStr : 'none',
    borderRight:  sides.includes('right')  ? bStr : 'none',
    borderBottom: sides.includes('bottom') ? bStr : 'none',
    borderLeft:   sides.includes('left')   ? bStr : 'none',
  };

  // Background — explicit prop wins, then default passed in, then nothing (keep class)
  if (p.background)          style.background = p.background as string;
  else if (defaults.background) style.background = defaults.background;

  if (p.shadow)              style.boxShadow = '0 4px 6px -1px rgba(0,0,0,.12),0 2px 4px -2px rgba(0,0,0,.08)';
  if (p.opacity !== undefined) style.opacity  = p.opacity as number;

  return style;
}

// Padding for the main content area (replaces hard-coded p-3, default 12 px)
function contentPad(p: Record<string, unknown>, def = 12): CSSProperties {
  const px = (p.paddingX as number | undefined) ?? def;
  const py = (p.paddingY as number | undefined) ?? def;
  return { padding: `${py}px ${px}px` };
}

interface MockEntry {
  value?: number | string;
  label?: string;
  trend?: number;
  trendLabel?: string;
  series?: { name: string; value: number; color?: string }[];
  rows?: Record<string, string | number>[];
  columns?: string[];
}

const MOCK: Record<DataWidgetType, MockEntry> = {
  issues_total:       { value: 142, label: 'Total Issues',    trend: +12, trendLabel: 'vs last month' },
  issues_open:        { value: 67,  label: 'Open Issues',     trend: -5,  trendLabel: 'vs last month' },
  issues_done:        { value: 75,  label: 'Completed',       trend: +18, trendLabel: 'vs last month' },
  issues_overdue:     { value: 8,   label: 'Overdue',         trend: +2,  trendLabel: 'vs last week' },
  issues_by_status: {
    label: 'Issues by Status',
    series: [
      { name: 'Open',        value: 67, color: '#6366f1' },
      { name: 'In Progress', value: 31, color: '#f59e0b' },
      { name: 'Done',        value: 75, color: '#22c55e' },
      { name: 'Blocked',     value: 8,  color: '#ef4444' },
    ],
  },
  issues_table: {
    label: 'Recent Issues',
    columns: ['Title', 'Status', 'Assignee'],
    rows: [
      { Title: 'Fix login bug',     Status: 'In Progress', Assignee: 'Alice' },
      { Title: 'Update dashboard',  Status: 'Open',        Assignee: 'Bob' },
      { Title: 'API tuning',        Status: 'Done',        Assignee: 'Carol' },
    ],
  },
  projects_total: { value: 5,  label: 'Active Projects', trend: +1, trendLabel: 'this quarter' },
  projects_list: {
    label: 'Project Progress',
    rows: [
      { Name: 'Prism Platform', Progress: 72 },
      { Name: 'Mobile App',     Progress: 45 },
      { Name: 'API Overhaul',   Progress: 90 },
    ],
    columns: ['Name', 'Progress'],
  },
  users_total: { value: 12, label: 'Team Members', trend: +2, trendLabel: 'this month' },
  users_by_department: {
    label: 'Team by Department',
    series: [
      { name: 'Engineering', value: 5, color: '#6366f1' },
      { name: 'Design',      value: 2, color: '#ec4899' },
      { name: 'Product',     value: 2, color: '#f59e0b' },
      { name: 'Marketing',   value: 2, color: '#22c55e' },
      { name: 'Sales',       value: 1, color: '#06b6d4' },
    ],
  },
  date_label: {
    value: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    label: 'Report Period',
  },
};

type LiveSeries = { name: string; value: number; color?: string };

interface Props { element: ReportElement }

export function ElementDataWidget({ element }: Props) {
  const liveData = useLiveWidgetData();
  const p = element.props as {
    widgetType?: DataWidgetType;
    title?: string;
    colorScheme?: string;
    dataSource?: StoredWidgetDatasource;
    kpiValue?: number | string;
    kpiLabel?: string;
    kpiTrend?: number;
    kpiTrendLabel?: string;
    seriesData?: LiveSeries[];
    // border
    borderRadius?: number;
    borderColor?: string;
    borderWidth?: number;
    borderSides?: string[];
    borderStyle?: string;
    // appearance
    background?: string;
    shadow?: boolean;
    opacity?: number;
    paddingX?: number;
    paddingY?: number;
    // script
    scriptEnabled?: boolean;
    customScript?: string;
  };

  const widgetType = p.widgetType;
  const hasLiveDatasource = !!p.dataSource?.url;
  const hasScript = !!(p.scriptEnabled && p.customScript);

  const evalScript = (value: unknown, data: unknown = null, rows: unknown[] = []) =>
    hasScript
      ? runScript(p.customScript!, { value, data, rows, id: element.id, type: element.type, props: element.props })
      : null;

  // ── Live KPI card from API datasource ───────────────────────────────────────
  if (hasLiveDatasource && p.dataSource!.widgetMode === 'kpi' && p.kpiValue !== undefined) {
    const accent = p.colorScheme ?? '#6366f1';
    const scriptVal = evalScript(p.kpiValue, p.dataSource);
    const displayVal = scriptVal ?? p.kpiValue;
    return (
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        style={makeWidgetStyle(p, {
          borderColor: `color-mix(in srgb, ${accent} 25%, var(--border))`,
          background:  `color-mix(in srgb, ${accent} 8%, var(--bg-card))`,
        })}
      >
        <div className="flex items-center gap-1 px-2 py-0.5 border-b flex-shrink-0"
          style={{ borderColor: `color-mix(in srgb, ${accent} 20%, var(--border))` }}>
          <Wifi className="w-2.5 h-2.5" style={{ color: accent }} />
          <span className="text-[9px] truncate" style={{ color: accent }}>{p.dataSource!.url}</span>
          {hasScript && <Code2 className="w-2.5 h-2.5 ml-auto text-violet-400 flex-shrink-0" />}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1" style={contentPad(p)}>
          <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {p.kpiLabel ?? p.title ?? p.dataSource!.valueKey}
          </div>
          <div className="font-bold leading-none"
            style={{ fontSize: 'clamp(28px, 4vw, 52px)', color: scriptVal?.startsWith('[Script Error') ? '#ef4444' : accent }}>
            {displayVal}
          </div>
        </div>
      </div>
    );
  }

  // ── Live series bars from API datasource ────────────────────────────────────
  if (hasLiveDatasource && p.dataSource!.widgetMode === 'series' && p.seriesData?.length) {
    const accent = p.colorScheme ?? '#6366f1';
    const live   = p.seriesData;
    const total  = live.reduce((s, d) => s + d.value, 0);
    const title  = p.title ?? p.dataSource!.valueKey;
    return (
      <div className="w-full h-full overflow-hidden flex flex-col"
        style={makeWidgetStyle(p, { background: 'var(--bg-card)' })}>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-accent-50 dark:bg-accent-950/30 border-b border-accent-200 dark:border-accent-800 flex-shrink-0">
          <Wifi className="w-2.5 h-2.5 text-accent-600" />
          <span className="text-[9px] text-accent-600 dark:text-accent-400 truncate">{p.dataSource!.url}</span>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col" style={contentPad(p)}>
          {title && <div className="text-xs font-semibold text-text-sub mb-2">{title}</div>}
          <div className="flex flex-col gap-2 overflow-hidden">
            {live.map((s) => {
              const pct = total ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-sub truncate">{s.name}</span>
                    <span className="text-text-muted font-mono flex-shrink-0 ml-2">
                      {s.value} <span className="opacity-60">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-bg-subtle rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color ?? accent }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── User-defined standalone KPI (no widgetType, no API) ─────────────────────
  if (!widgetType) {
    const accent = p.colorScheme ?? '#6366f1';
    const val = p.kpiValue;
    const label = p.kpiLabel;
    const trend = p.kpiTrend;
    const trendLabel = p.kpiTrendLabel;
    const scriptVal = hasScript ? evalScript(val, null, []) : null;
    const displayVal = scriptVal ?? (val !== undefined ? String(val) : undefined);

    if (displayVal === undefined && !label) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-bg-subtle border border-dashed border-border rounded-lg text-text-muted gap-2">
          <div className="w-10 h-10 rounded-xl bg-bg-card border border-border flex items-center justify-center">
            <BarChart2 className="w-5 h-5 opacity-40" />
          </div>
          <span className="text-xs text-center px-3 leading-relaxed">Set a value in the<br/>properties panel</span>
        </div>
      );
    }

    const isPositive = (trend ?? 0) >= 0;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;
    const trendColor = isPositive ? '#22c55e' : '#ef4444';

    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-1"
        style={{
          ...makeWidgetStyle(p, {
            borderColor: `color-mix(in srgb, ${accent} 25%, var(--border))`,
            background:  `color-mix(in srgb, ${accent} 8%, var(--bg-card))`,
          }),
          ...contentPad(p),
        }}
      >
        {label && (
          <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider text-center flex items-center gap-1">
            {label}
            {hasScript && <Code2 className="w-2.5 h-2.5 text-violet-400" />}
          </div>
        )}
        {displayVal !== undefined && (
          <div
            className="font-bold leading-none"
            style={{
              fontSize: 'clamp(28px, 4vw, 52px)',
              color: scriptVal?.startsWith('[Script Error') ? '#ef4444' : accent,
            }}
          >
            {displayVal}
          </div>
        )}
        {trend !== undefined && !scriptVal && (
          <div className="flex items-center gap-1 mt-0.5" style={{ color: trendColor }}>
            <TrendIcon className="w-3 h-3" />
            <span className="text-[10px] font-semibold">
              {isPositive ? '+' : ''}{trend}{trendLabel ? ` ${trendLabel}` : ''}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Real data from context (canvas editor fetches on mount) ─────────────────
  const liveEntry = widgetType ? (liveData?.[widgetType] as typeof MOCK[typeof widgetType] | undefined) : undefined;
  // If live data is not yet available fall back to MOCK so canvas always renders
  const data    = liveEntry ?? MOCK[widgetType!];
  const catalog = DATA_WIDGET_CATALOG.find((c) => c.type === widgetType);
  const title   = p.title || catalog?.label || '';
  const accent  = p.colorScheme ?? '#6366f1';
  const isLive  = !!liveEntry;

  // ── Project progress bars ────────────────────────────────────────────────
  if (widgetType === 'projects_list') {
    return (
      <div className="w-full h-full overflow-hidden flex flex-col gap-1"
        style={{ ...makeWidgetStyle(p, { background: 'var(--bg-card)' }), ...contentPad(p) }}>
        {title && <div className="text-xs font-semibold text-text-sub mb-1">{title}</div>}
        <div className="flex flex-col gap-2.5 overflow-hidden">
          {(data.rows ?? []).map((row, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-sub font-medium">{row['Name']}</span>
                <span className="text-text-muted">{row['Progress']}%</span>
              </div>
              <div className="h-2 bg-bg-subtle rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${row['Progress']}%`, background: accent }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Issues table ─────────────────────────────────────────────────────────
  if (data.rows && data.columns) {
    const cols = data.columns;
    return (
      <div className="w-full h-full overflow-hidden flex flex-col"
        style={makeWidgetStyle(p, { background: 'var(--bg-card)' })}>
        {title && (
          <div className="px-3 pt-2.5 pb-1 text-xs font-semibold text-text-sub border-b border-border">
            {title}
          </div>
        )}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-bg-subtle">
                {cols.map((c) => (
                  <th key={c} className="px-3 py-1.5 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data.rows ?? []).map((row, i) => (
                <tr key={i} className="hover:bg-bg-hover">
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-1.5 text-text-sub">{String(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Series breakdown bars ────────────────────────────────────────────────
  if (data.series) {
    const total = data.series.reduce((s, d) => s + d.value, 0);
    return (
      <div className="w-full h-full overflow-hidden flex flex-col"
        style={{ ...makeWidgetStyle(p, { background: 'var(--bg-card)' }), ...contentPad(p) }}>
        {title && <div className="text-xs font-semibold text-text-sub mb-2">{title}</div>}
        <div className="flex flex-col gap-2 overflow-hidden">
          {data.series.map((s) => {
            const pct = total ? Math.round((s.value / total) * 100) : 0;
            return (
              <div key={s.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-sub">{s.name}</span>
                  <span className="text-text-muted font-mono">{s.value} <span className="opacity-60">({pct}%)</span></span>
                </div>
                <div className="h-2 bg-bg-subtle rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color ?? accent }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Big number KPI card ──────────────────────────────────────────────────
  const isPositive = (data.trend ?? 0) >= 0;
  const TrendIcon  = isPositive ? TrendingUp : TrendingDown;
  const trendColor = isPositive ? '#22c55e' : '#ef4444';
  const scriptVal  = evalScript(data.value, data);
  const displayVal = scriptVal ?? data.value;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1 relative"
      style={{
        ...makeWidgetStyle(p, {
          borderColor: `color-mix(in srgb, ${accent} 25%, var(--border))`,
          background:  `color-mix(in srgb, ${accent} 8%, var(--bg-card))`,
        }),
        ...contentPad(p),
      }}
    >
      {/* Live data badge */}
      {isLive && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-green-500/10 border border-green-500/20 rounded px-1 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[8px] font-semibold text-green-600 dark:text-green-400">Live</span>
        </div>
      )}
      <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
        {title || data.label}
        {hasScript && <Code2 className="w-2.5 h-2.5 text-violet-400" />}
      </div>
      <div className="font-bold leading-none"
        style={{ fontSize: 'clamp(28px, 4vw, 52px)', color: scriptVal?.startsWith('[Script Error') ? '#ef4444' : accent }}>
        {displayVal}
      </div>
      {data.trend !== undefined && !scriptVal && !isLive && (
        <div className="flex items-center gap-1 mt-0.5" style={{ color: trendColor }}>
          <TrendIcon className="w-3 h-3" />
          <span className="text-[10px] font-semibold">
            {isPositive ? '+' : ''}{data.trend} {data.trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}
