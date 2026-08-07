'use client';
import { memo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useFormat } from '@prism/i18n';

interface TrendChartProps {
  data: { weekStart: string; created: number; completed: number }[];
}

// Same tooltip recipe as reports' element-chart.tsx — a tiny local const on
// purpose; do not import across features.
const TT_STYLE = {
  fontSize: 10,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,.08)',
};

/**
 * Grouped weekly created-vs-completed bars — the only recharts on the page.
 * Bars, not lines: they stay legible with 1–2 data points.
 *
 * Two recharts v3 gotchas (documented in reports' element-chart.tsx) apply:
 * 1. Never render recharts' `<Legend>` — its componentDidUpdate store dispatch
 *    loops on sub-pixel measurements ("Maximum update depth exceeded"). The
 *    legend below is plain HTML outside `<ResponsiveContainer>`.
 * 2. `isAnimationActive={false}` on every series.
 */
function TrendChartInner({ data }: TrendChartProps) {
  // All-zero trend: pin a floor domain so the chart doesn't collapse onto the
  // axis, and caption it — the zero baseline itself is the information.
  const allZero = data.every((w) => w.created === 0 && w.completed === 0);

  // Bound to the locale, so these have to live inside the component rather than
  // as the module-level consts they used to be.
  const f = useFormat();
  const fmtWeek = (iso: string) => f.dateShort(iso);
  const fmtWeekLong = (label: React.ReactNode) =>
    typeof label === 'string' ? `Week of ${f.dateShort(label)}` : label;

  return (
    <div>
      {/* HTML legend — recharts <Legend> is banned (see gotcha above) */}
      <div className="flex items-center gap-4 px-4 pt-3 text-[11px] text-text-sub">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--a)' }} /> Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} /> Completed
        </span>
      </div>

      <div className="relative">
        <div
          className="h-[280px] px-2 pb-2"
          role="img"
          aria-label={`Created vs completed work items per week, ${data.length} weeks`}
        >
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="weekStart"
                tickFormatter={fmtWeek}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                domain={allZero ? [0, 4] : undefined}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={TT_STYLE}
                labelFormatter={fmtWeekLong}
                cursor={{ fill: 'var(--bg-hover)' }}
              />
              <Bar
                dataKey="created"
                name="Created"
                fill="var(--a)"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Bar
                dataKey="completed"
                name="Completed"
                fill="var(--success)"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {allZero && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[12px] text-text-muted">No activity in this range</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Same memo reasoning as reports' ElementChartMemo: recharts' connected
// components dispatch on every render, so skip re-renders when data is
// reference-stable.
export const TrendChart = memo(TrendChartInner);
