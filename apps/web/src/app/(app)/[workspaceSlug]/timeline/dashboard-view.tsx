'use client';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import { Avatar } from '@/components/ui/avatar';
import type { Project } from '@/schemas/project';
import type { ActivityItem, ActivityActor } from '@/hooks/use-activity';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectContributor { actor: ActivityActor; count: number; types: Record<string, number> }

interface ProjectEntry {
  project: Project;
  contributors: ProjectContributor[];
  events: ActivityItem[];
}

interface ProjectStat {
  project: Project;
  events: number;
  activeDays: number;
  firstMs: number | null;
  lastMs: number | null;
  contributors: number;
  issues: number;
  mr: number;
  notes: number;
  other: number;
  open: number;
  done: number;
  total: number;
}

// ─── Palette helpers ──────────────────────────────────────────────────────────

const ACCENT_PALETTE = ['#6366f1','#8b5cf6','#3b82f6','#06b6d4','#10b981','#f59e0b','#ec4899','#f43f5e','#14b8a6','#a855f7'];
const projAccent = (hex?: string) => hex ?? '#6366f1';

// ─── SVG utilities ────────────────────────────────────────────────────────────

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({ title, children, className }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-text-muted">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gantt Timeline (horizontal bars on date axis)
// ─────────────────────────────────────────────────────────────────────────────

function GanttTimeline({ stats }: { stats: ProjectStat[] }) {
  // Was a hardcoded MM/DD/YY — American order, in an app whose market is not.
  const f = useFormat();
  const valid = stats.filter((s) => s.firstMs !== null && s.lastMs !== null);
  if (valid.length === 0) return <EmptyChart label="No timeline data" />;

  const allMs = valid.flatMap((s) => [s.firstMs!, s.lastMs!]);
  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  const spanMs = maxMs - minMs || 86400000;

  const LABEL_W = 110;
  const ROW_H   = 26;
  const BAR_H   = 14;
  const TICK_H  = 22;
  const chartW  = 680;
  const totalH  = TICK_H + valid.length * ROW_H + 8;

  // 5 date ticks
  const ticks = Array.from({ length: 6 }, (_, i) => ({
    ms:  minMs + (i / 5) * spanMs,
    x:   LABEL_W + (i / 5) * chartW,
  }));

  const barX = (ms: number) => LABEL_W + ((ms - minMs) / spanMs) * chartW;
  const barW = (s: ProjectStat) => {
    const w = ((s.lastMs! - s.firstMs!) / spanMs) * chartW;
    return Math.max(w, 6);
  };

  return (
    <svg
      viewBox={`0 0 ${LABEL_W + chartW + 10} ${totalH}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Grid lines */}
      {ticks.map((t, i) => (
        <line key={i} x1={t.x} y1={TICK_H} x2={t.x} y2={totalH}
          stroke="var(--border)" strokeWidth={1} strokeDasharray={i === 0 ? '0' : '3 3'} />
      ))}

      {/* Tick labels */}
      {ticks.map((t, i) => (
        <text key={i} x={t.x} y={TICK_H - 6} textAnchor="middle"
          fontSize={9} fill="var(--text-muted)" fontFamily="monospace">
          {f.dateShort(t.ms)}
        </text>
      ))}

      {/* Project rows */}
      {valid.map((s, i) => {
        const y = TICK_H + i * ROW_H;
        const x = barX(s.firstMs!);
        const w = barW(s);
        const col = projAccent(s.project.color);
        return (
          <g key={s.project._id}>
            {/* Row bg on hover */}
            <rect x={0} y={y} width={LABEL_W + chartW + 10} height={ROW_H}
              fill="transparent" />
            {/* Label */}
            <text x={LABEL_W - 6} y={y + ROW_H / 2 + 4} textAnchor="end"
              fontSize={10} fill="var(--text)" fontWeight={500}
              style={{ fontFamily: 'inherit' }}>
              {s.project.name.length > 14 ? s.project.name.slice(0, 13) + '…' : s.project.name}
            </text>
            {/* Bar background track */}
            <rect x={LABEL_W} y={y + (ROW_H - BAR_H) / 2}
              width={chartW} height={BAR_H} rx={3} fill="var(--bg-subtle)" />
            {/* Activity bar */}
            <rect x={x} y={y + (ROW_H - BAR_H) / 2}
              width={w} height={BAR_H} rx={3} fill={col} opacity={0.85} />
            {/* Event count label */}
            {w > 30 && (
              <text x={x + w / 2} y={y + ROW_H / 2 + 4} textAnchor="middle"
                fontSize={9} fill="#fff" fontWeight={600}>
                {s.events}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Vertical bar chart
// ─────────────────────────────────────────────────────────────────────────────

function VerticalBarChart({
  stats, getValue, getColor, label,
}: {
  stats: ProjectStat[];
  getValue: (s: ProjectStat) => number;
  getColor: (s: ProjectStat) => string;
  label: string;
}) {
  if (stats.length === 0) return <EmptyChart label={label} />;

  const values = stats.map(getValue);
  const maxVal = Math.max(...values, 1);
  const CHART_H = 120;
  const BAR_W   = 22;
  const GAP     = 8;
  const LABEL_H = 28;
  const total   = stats.length * (BAR_W + GAP);

  // Y-axis ticks (3 ticks)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`-30 0 ${total + 40} ${CHART_H + LABEL_H + 10}`}
        width="100%"
        style={{ minWidth: Math.max(total + 10, 180), display: 'block' }}
      >
        {/* Y-axis lines + labels */}
        {yTicks.map((v) => {
          const y = CHART_H - (v / maxVal) * CHART_H;
          return (
            <g key={v}>
              <line x1={0} y1={y} x2={total} y2={y}
                stroke="var(--border)" strokeWidth={1} strokeDasharray={v === 0 ? '0' : '3 3'} />
              <text x={-4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">{v}</text>
            </g>
          );
        })}

        {/* Bars */}
        {stats.map((s, i) => {
          const val = getValue(s);
          const h   = (val / maxVal) * CHART_H;
          const x   = i * (BAR_W + GAP);
          const col = getColor(s);
          const shortName = s.project.name.length > 6 ? s.project.name.slice(0, 5) + '…' : s.project.name;
          return (
            <g key={s.project._id}>
              {/* Bar */}
              <rect x={x} y={CHART_H - h} width={BAR_W} height={h} rx={3} fill={col} opacity={0.85} />
              {/* Value label on bar */}
              {h > 16 && (
                <text x={x + BAR_W / 2} y={CHART_H - h + 11} textAnchor="middle"
                  fontSize={8} fill="#fff" fontWeight={700}>{val}</text>
              )}
              {/* Project name */}
              <text x={x + BAR_W / 2} y={CHART_H + 14} textAnchor="middle"
                fontSize={9} fill="var(--text-muted)" transform={`rotate(-40, ${x + BAR_W / 2}, ${CHART_H + 14})`}>
                {shortName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Donut / Pie chart
// ─────────────────────────────────────────────────────────────────────────────

function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (total === 0) return <EmptyChart label="No data" />;

  const cx = 80, cy = 80, r = 64, ri = 38;
  let angle = -Math.PI / 2;

  const paths = slices.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const sa = angle;
    const ea = angle + sweep;
    angle = ea;

    const cos = Math.cos, sin = Math.sin;
    const x1 = cx + r * cos(sa),  y1 = cy + r * sin(sa);
    const x2 = cx + r * cos(ea),  y2 = cy + r * sin(ea);
    const xi1 = cx + ri * cos(ea), yi1 = cy + ri * sin(ea);
    const xi2 = cx + ri * cos(sa), yi2 = cy + ri * sin(sa);
    const large = sweep > Math.PI ? 1 : 0;

    return {
      ...s,
      pct: Math.round((s.value / total) * 100),
      d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${ri} ${ri} 0 ${large} 0 ${xi2.toFixed(2)} ${yi2.toFixed(2)} Z`,
    };
  });

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Donut SVG */}
      <svg viewBox="0 0 160 160" width={130} height={130} className="shrink-0">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="var(--bg-card)" strokeWidth={2} />
        ))}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={18} fontWeight={700} fill="var(--text)">{total}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="var(--text-muted)">total</text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        {slices.slice(0, 8).map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-text truncate flex-1">{s.label}</span>
            <span className="text-text-muted font-medium tabular-nums shrink-0">{s.value}</span>
          </div>
        ))}
        {slices.length > 8 && (
          <p className="text-[10px] text-text-muted">+{slices.length - 8} more</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Grouped bar chart (multiple series per project)
// ─────────────────────────────────────────────────────────────────────────────

interface Series { label: string; color: string; getValue: (s: ProjectStat) => number }

function GroupedBarChart({ stats, series }: { stats: ProjectStat[]; series: Series[] }) {
  if (stats.length === 0) return <EmptyChart label="No data" />;

  const maxVal = Math.max(...stats.flatMap((s) => series.map((sr) => sr.getValue(s))), 1);
  const CHART_H   = 130;
  const GROUP_W   = series.length * 14 + 6;
  const GAP       = 10;
  const LABEL_H   = 30;
  const BAR_W     = 12;
  const totalW    = stats.length * (GROUP_W + GAP);

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`-28 0 ${totalW + 36} ${CHART_H + LABEL_H}`}
        width="100%"
        style={{ minWidth: Math.max(totalW + 10, 200), display: 'block' }}
      >
        {/* Y-axis */}
        {yTicks.map((v) => {
          const y = CHART_H - (v / maxVal) * CHART_H;
          return (
            <g key={v}>
              <line x1={0} y1={y} x2={totalW} y2={y}
                stroke="var(--border)" strokeWidth={1} strokeDasharray={v === 0 ? '0' : '3 3'} />
              <text x={-4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">{v}</text>
            </g>
          );
        })}

        {/* Groups */}
        {stats.map((s, gi) => {
          const gx   = gi * (GROUP_W + GAP);
          const name = s.project.name.length > 7 ? s.project.name.slice(0, 6) + '…' : s.project.name;
          return (
            <g key={s.project._id}>
              {/* Bars */}
              {series.map((sr, si) => {
                const val = sr.getValue(s);
                const h   = (val / maxVal) * CHART_H;
                const bx  = gx + si * (BAR_W + 2);
                return (
                  <g key={si}>
                    <rect x={bx} y={CHART_H - h} width={BAR_W} height={h} rx={2}
                      fill={sr.color} opacity={0.85} />
                    {h > 14 && (
                      <text x={bx + BAR_W / 2} y={CHART_H - h + 10} textAnchor="middle"
                        fontSize={7.5} fill="#fff" fontWeight={700}>{val}</text>
                    )}
                  </g>
                );
              })}
              {/* Project label */}
              <text x={gx + GROUP_W / 2} y={CHART_H + 14} textAnchor="middle"
                fontSize={9} fill="var(--text-muted)"
                transform={`rotate(-35, ${gx + GROUP_W / 2}, ${CHART_H + 14})`}>
                {name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {series.map((sr, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: sr.color }} />
            <span className="text-text-muted">{sr.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Horizontal bar chart (category totals)
// ─────────────────────────────────────────────────────────────────────────────

function HorizontalBarChart({ rows }: {
  rows: { label: string; value: number; color: string }[];
}) {
  const maxVal = Math.max(...rows.map((r) => r.value), 1);
  const ROW_H  = 32;
  const LABEL_W = 90;
  const CHART_W = 280;
  const totalH  = rows.length * ROW_H;

  return (
    <svg viewBox={`0 0 ${LABEL_W + CHART_W + 40} ${totalH}`} width="100%"
      style={{ display: 'block' }}>
      {rows.map((r, i) => {
        const y = i * ROW_H;
        const w = (r.value / maxVal) * CHART_W;
        return (
          <g key={i}>
            {/* Track */}
            <rect x={LABEL_W} y={y + 8} width={CHART_W} height={ROW_H - 16} rx={3} fill="var(--bg-subtle)" />
            {/* Bar */}
            <rect x={LABEL_W} y={y + 8} width={w} height={ROW_H - 16} rx={3} fill={r.color} opacity={0.85} />
            {/* Label */}
            <text x={LABEL_W - 6} y={y + ROW_H / 2 + 4} textAnchor="end"
              fontSize={10} fill="var(--text-muted)" fontWeight={500}>
              {r.label}
            </text>
            {/* Value */}
            <text x={LABEL_W + w + 6} y={y + ROW_H / 2 + 4}
              fontSize={11} fill="var(--text)" fontWeight={700}>
              {r.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Empty placeholder ────────────────────────────────────────────────────────

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-[12px] text-text-muted">{label}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main DashboardView
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardView({
  projectData,
  untrackedItems,
}: {
  projectData: ProjectEntry[];
  untrackedItems: ActivityItem[];
}) {
  // ── Compute per-project stats ─────────────────────────────────────────────
  const stats = useMemo<ProjectStat[]>(() => {
    return projectData.map(({ project, contributors, events }) => {
      const tsList = events.map((e) => new Date(e.createdAt).getTime());
      const firstMs = tsList.length ? Math.min(...tsList) : null;
      const lastMs  = tsList.length ? Math.max(...tsList) : null;
      const activeDays = firstMs && lastMs
        ? Math.max(1, Math.round((lastMs - firstMs) / 86400000) + 1) : 0;

      const byType = (t: string) => events.filter((e) => e.entityType === t).length;
      const issues = byType('issue');
      const mr     = byType('mr');
      const notes  = byType('note') + byType('wiki');
      const other  = events.length - issues - mr - notes;

      return {
        project,
        events: events.length,
        activeDays,
        firstMs,
        lastMs,
        contributors: contributors.length,
        issues,
        mr,
        notes,
        other,
        open:  Math.max(0, (project.issueCount ?? 0) - (project.doneCount ?? 0)),
        done:  project.doneCount ?? 0,
        total: project.issueCount ?? 0,
      };
    });
  }, [projectData]);

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const sum = (fn: (s: ProjectStat) => number) => stats.reduce((a, s) => a + fn(s), 0);
    return {
      events:  sum((s) => s.events) + untrackedItems.length,
      issues:  sum((s) => s.issues),
      mr:      sum((s) => s.mr),
      notes:   sum((s) => s.notes),
      other:   sum((s) => s.other),
      open:    sum((s) => s.open),
      done:    sum((s) => s.done),
      members: Math.max(...stats.map((s) => s.contributors), 0),
      activeDays: Math.max(...stats.map((s) => s.activeDays), 0),
    };
  }, [stats, untrackedItems]);

  // ── Donut slices ──────────────────────────────────────────────────────────
  const contributorSlices = stats
    .filter((s) => s.events > 0)
    .map((s, i) => ({
      label: s.project.name,
      value: s.events,
      color: projAccent(s.project.color) ?? ACCENT_PALETTE[i % ACCENT_PALETTE.length],
    }));

  // ── Activity-type series ──────────────────────────────────────────────────
  const typeSeries: Series[] = [
    { label: 'Issues', color: '#3b82f6', getValue: (s) => s.issues },
    { label: 'MR',     color: '#8b5cf6', getValue: (s) => s.mr },
    { label: 'Notes',  color: '#10b981', getValue: (s) => s.notes },
    { label: 'Other',  color: '#f59e0b', getValue: (s) => s.other },
  ];

  // ── Issue progress series ─────────────────────────────────────────────────
  const issueSeries: Series[] = [
    { label: 'Open', color: '#f43f5e', getValue: (s) => s.open },
    { label: 'Done', color: '#10b981', getValue: (s) => s.done },
  ];

  // ── Events & actions series ───────────────────────────────────────────────
  const actionSeries: Series[] = [
    { label: 'Events',       color: '#6366f1', getValue: (s) => s.events },
    { label: 'Contributors', color: '#06b6d4', getValue: (s) => s.contributors },
    { label: 'Active Days',  color: '#f59e0b', getValue: (s) => s.activeDays },
  ];

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-text-muted">
        <p className="text-[14px] font-medium">No project data for this period</p>
        <p className="text-[12px]">Switch to a wider date range or check that activity has been recorded</p>
      </div>
    );
  }

  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-5">

      {/* ══ LEFT COLUMN ══════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-5">

        {/* Gantt */}
        <ChartCard title="Activity Timeline & Resources">
          <GanttTimeline stats={stats} />
        </ChartCard>

        {/* Events bar + Contributor pie */}
        <div className="grid grid-cols-2 gap-5">
          <ChartCard title="Events per Project">
            <VerticalBarChart
              stats={stats}
              getValue={(s) => s.events}
              getColor={(s) => projAccent(s.project.color)}
              label="No events"
            />
          </ChartCard>
          <ChartCard title="Contributor Allocation">
            <DonutChart slices={contributorSlices} />
          </ChartCard>
        </div>

        {/* Issue Progress */}
        <ChartCard title="Issue Progress per Project">
          <GroupedBarChart stats={stats} series={issueSeries} />
        </ChartCard>
      </div>

      {/* ══ RIGHT COLUMN ═════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-5">

        {/* Summary stat chips */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Events',   value: totals.events,     color: '#6366f1' },
            { label: 'Open Issues',    value: totals.open,       color: '#f43f5e' },
            { label: 'Done Issues',    value: totals.done,       color: '#10b981' },
            { label: 'Active Projects',value: stats.length,      color: '#06b6d4' },
          ].map((chip) => (
            <div key={chip.label}
              className="bg-bg-card border border-border rounded-xl px-4 py-3.5 shadow-sm"
              style={{ borderTopColor: chip.color, borderTopWidth: 3 }}>
              <p className="text-[26px] font-extrabold tracking-tighter text-text leading-none">{chip.value}</p>
              <p className="text-[11px] text-text-muted mt-1.5">{chip.label}</p>
            </div>
          ))}
        </div>

        {/* Activity by type (grouped bar) */}
        <ChartCard title="Activity by Type — per Project">
          <GroupedBarChart stats={stats} series={typeSeries} />
        </ChartCard>

        {/* Type totals (horizontal bar) */}
        <ChartCard title="Activity Type — Totals">
          <HorizontalBarChart rows={[
            { label: 'Issues', value: totals.issues, color: '#3b82f6' },
            { label: 'MR',     value: totals.mr,     color: '#8b5cf6' },
            { label: 'Notes',  value: totals.notes,  color: '#10b981' },
            { label: 'Other',  value: totals.other,  color: '#f59e0b' },
          ]} />
        </ChartCard>

        {/* Events & contributors per project */}
        <ChartCard title="Events & Contributors — per Project">
          <GroupedBarChart stats={stats} series={actionSeries} />
        </ChartCard>

        {/* Action summary (horizontal bar) */}
        <ChartCard title="Project Summary — Totals">
          <HorizontalBarChart rows={[
            { label: 'Total Events',  value: totals.events,     color: '#6366f1' },
            { label: 'Open Issues',   value: totals.open,       color: '#f43f5e' },
            { label: 'Done Issues',   value: totals.done,       color: '#10b981' },
            { label: 'Issues',        value: totals.issues,     color: '#3b82f6' },
            { label: 'MR Events',     value: totals.mr,         color: '#8b5cf6' },
          ]} />
        </ChartCard>
      </div>
    </div>
  );
}
