'use client';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as RCell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import {
  buildChartModel,
  buildPieModel,
  CHART_PALETTE,
} from '@/lib/sheets/chart-data';
import type { Sheet, SheetChart } from '@/schemas/workbook';

interface Props {
  sheet: Sheet;
  computed: Record<string, unknown>;
  chart: SheetChart;
}

const AXIS = { fontSize: 11, fill: '#5f6368' } as const;

export function ChartView({ sheet, computed, chart }: Props) {
  const model = useMemo(
    () => buildChartModel(sheet, computed, chart),
    [sheet, computed, chart],
  );
  const pieData = useMemo(
    () => (chart.type === 'pie' ? buildPieModel(sheet, computed, chart) : []),
    [sheet, computed, chart],
  );

  if (chart.type === 'pie') {
    if (!pieData.length) return <Empty />;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="75%"
            label={(e: { name?: string }) => e.name ?? ''}
            labelLine={false}
            isAnimationActive={false}
          >
            {pieData.map((_, i) => (
              <RCell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          {chart.legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (model.empty) return <Empty />;

  if (chart.type === 'scatter') {
    // First series is the x-axis, remaining series are plotted against it.
    const xKey = model.series[0]?.key;
    const ySeries = model.series.slice(1);
    if (!xKey || !ySeries.length) return <Empty hint="Scatter needs 2+ columns" />;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={model.series[0]?.name}
            tick={AXIS}
          />
          <YAxis type="number" tick={AXIS} />
          <ZAxis range={[50, 50]} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          {chart.legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {ySeries.map((s, i) => (
            <Scatter
              key={s.key}
              name={s.name}
              data={model.data}
              dataKey={s.key}
              fill={CHART_PALETTE[i % CHART_PALETTE.length]}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={model.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="__cat" tick={AXIS} />
          <YAxis tick={AXIS} />
          <Tooltip />
          {chart.legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {model.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={model.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="__cat" tick={AXIS} />
          <YAxis tick={AXIS} />
          <Tooltip />
          {chart.legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {model.series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId={chart.stacked ? 'a' : undefined}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              fill={CHART_PALETTE[i % CHART_PALETTE.length]}
              fillOpacity={0.25}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // column (vertical) + bar (horizontal)
  const horizontal = chart.type === 'bar';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={model.data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, bottom: 4, left: horizontal ? 4 : -8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS} />
            <YAxis type="category" dataKey="__cat" tick={AXIS} width={70} />
          </>
        ) : (
          <>
            <XAxis dataKey="__cat" tick={AXIS} />
            <YAxis tick={AXIS} />
          </>
        )}
        <Tooltip />
        {chart.legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {model.series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId={chart.stacked ? 'a' : undefined}
            fill={CHART_PALETTE[i % CHART_PALETTE.length]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty({ hint }: { hint?: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-[12px] text-text-muted text-center px-4">
      {hint ?? 'No numeric data in the selected range'}
    </div>
  );
}
