'use client';
import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, CheckCircle2, CircleDot, Flag, Plus } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { KpiCard } from '@/components/feature/dashboard/kpi-card';
import { Panel } from '@/components/feature/dashboard/panel';
import {
  PRIORITY_COLOR,
  STATUS,
  STATUS_COLOR,
} from '@/components/feature/issue/pills';
import {
  DEFAULT_ANALYTICS_RANGE,
  useWorkspaceAnalytics,
  type AnalyticsRange,
  type WorkspaceAnalytics,
} from '@/hooks/use-analytics';
import { useProjectsInWorkspace } from '@/hooks/use-projects';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { DistributionList, type DistributionRow } from './_components/distribution-list';
import { RangeToggle } from './_components/range-toggle';
import { TrendChart } from './_components/trend-chart';

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  '4w': 'Last 4 weeks',
  '12w': 'Last 12 weeks',
  '24w': 'Last 24 weeks',
};

/** Pill-map order for state rows — regardless of API ordering. */
const STATE_ORDER = Object.keys(STATUS);

/** Fixed order critical → high → medium → low — regardless of API ordering. */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const orderIdx = (order: string[], key: string) => {
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
};

function buildStateRows(byState: WorkspaceAnalytics['byState']): DistributionRow[] {
  return [...byState]
    .sort((a, b) => orderIdx(STATE_ORDER, a.key) - orderIdx(STATE_ORDER, b.key))
    .map((r) => ({
      key: r.key,
      label: STATUS[r.key]?.label ?? r.key,
      count: r.count,
      color: STATUS_COLOR[r.key] ?? 'var(--a)',
    }));
}

function buildPriorityRows(byPriority: WorkspaceAnalytics['byPriority']): DistributionRow[] {
  return [...byPriority]
    .sort((a, b) => (PRIORITY_ORDER[a.key] ?? 4) - (PRIORITY_ORDER[b.key] ?? 4))
    .map((r) => ({
      key: r.key,
      label: r.key.charAt(0).toUpperCase() + r.key.slice(1),
      count: r.count,
      color: PRIORITY_COLOR[r.key] ?? 'var(--a)',
    }));
}

function buildAssigneeRows(byAssignee: WorkspaceAnalytics['byAssignee']): DistributionRow[] {
  const named = byAssignee
    .filter((r) => r.key !== 'unassigned')
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      key: r.key,
      label: r.name,
      count: r.count,
      avatar: { name: r.name, src: r.avatar },
    }));
  const unassigned = byAssignee.find((r) => r.key === 'unassigned');
  return unassigned
    ? [...named, { key: 'unassigned', label: 'Unassigned', count: unassigned.count, muted: true }]
    : named;
}

/** Mirrors the real layout so nothing jumps (same technique as home's PageSkeleton). */
function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-[var(--ctl-sm)] w-44 rounded-lg" />
          <Skeleton className="h-[var(--ctl-sm)] w-32 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[90px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50"
            style={{ animationDelay: `${i * 55}ms` }}
          />
        ))}
      </div>
      <div className="h-[340px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[240px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { current: workspace } = useCurrentWorkspace();
  const { data: projects } = useProjectsInWorkspace(workspace?.id ?? null);

  // URL-first filters — the URL is the state; no component-state mirrors.
  const rawRange = params.get('range');
  const range: AnalyticsRange =
    rawRange === '4w' || rawRange === '12w' || rawRange === '24w'
      ? rawRange
      : DEFAULT_ANALYTICS_RANGE;
  // A project id not in the current workspace's list coerces to All projects
  // (also self-heals after a workspace switch leaves a stale id in the URL).
  // While the project list is still loading, trust the URL to avoid a
  // one-render all-projects query that immediately refetches.
  const rawProject = params.get('project') ?? '';
  const projectId = !rawProject
    ? ''
    : !projects
      ? rawProject
      : projects.some((p) => p._id === rawProject)
        ? rawProject
        : '';

  const setParam = (key: 'project' | 'range', value: string, def: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === def) next.delete(key);
    else next.set(key, value);
    router.replace(next.size ? `/analytics?${next}` : '/analytics', { scroll: false });
  };

  const { data, isError, isFetching, refetch } = useWorkspaceAnalytics({
    workspaceId: workspace?.id ?? null,
    projectId: projectId || undefined,
    range,
  });

  const stateRows = useMemo(() => (data ? buildStateRows(data.byState) : []), [data]);
  const priorityRows = useMemo(() => (data ? buildPriorityRows(data.byPriority) : []), [data]);
  const assigneeRows = useMemo(() => (data ? buildAssigneeRows(data.byAssignee) : []), [data]);

  const isEmpty =
    !!data &&
    data.totals.open + data.totals.completed + data.totals.overdue === 0 &&
    data.trend.every((w) => w.created === 0 && w.completed === 0);

  // First load only (no workspace resolved yet, or the query hasn't returned).
  // Filter changes keep the previous data on screen and dim instead.
  if (!data && !isError) return <PageSkeleton />;

  const projectOpts = [
    { value: '', label: 'All projects' },
    ...(projects ?? []).map((p) => ({ value: p._id, label: p.name })),
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h1 className="text-[20px] font-bold tracking-[-.02em]">Analytics</h1>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            Work-item activity across {workspace?.name ?? 'your workspace'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={projectId}
            onValueChange={(v) => setParam('project', v, '')}
            options={projectOpts}
            size="sm"
            className="w-full sm:w-44"
            aria-label="Filter by project"
          />
          <RangeToggle value={range} onChange={(r) => setParam('range', r, DEFAULT_ANALYTICS_RANGE)} />
        </div>
      </div>

      {isError ? (
        <ErrorState
          message="Couldn't load analytics."
          onRetry={() => refetch()}
          className="py-20 bg-bg-card border border-border rounded-xl"
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<BarChart3 />}
          label={projectId ? 'No work items in this project yet' : 'No work items yet'}
          hint="Analytics will appear once work items are created in this workspace."
          action={
            <Button size="sm" onClick={() => router.push('/issues?new=1')}>
              <Plus className="w-3.5 h-3.5" /> New task
            </Button>
          }
          className="py-20 bg-bg-card border border-border rounded-xl"
        />
      ) : (
        <div
          className={cn(
            'flex flex-col gap-5 transition-opacity',
            isFetching && 'opacity-60',
          )}
        >
          {/* KPI strip — static in v1: the issues list URL doesn't encode
              tab/overdue filters yet, so no deep links. */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <KpiCard label="Open" value={data!.totals.open} Icon={CircleDot} tone="violet" />
            <KpiCard label="Completed" value={data!.totals.completed} Icon={CheckCircle2} tone="green" />
            <KpiCard
              label="Overdue"
              value={data!.totals.overdue}
              Icon={Flag}
              tone="red"
              danger={data!.totals.overdue > 0}
            />
          </div>

          {/* Trend */}
          <Panel title="Created vs completed" subtitle={RANGE_LABEL[range]}>
            <TrendChart data={data!.trend} />
          </Panel>

          {/* Breakdowns */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="By state">
              <DistributionList rows={stateRows} />
            </Panel>
            <Panel title="By priority">
              <DistributionList rows={priorityRows} />
            </Panel>
            <Panel title="By assignee">
              <DistributionList rows={assigneeRows} maxRows={8} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
