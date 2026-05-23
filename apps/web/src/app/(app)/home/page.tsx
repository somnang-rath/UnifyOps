'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  Clock,
  Flag,
  GitMerge,
  Grid3x3,
  Plus,
} from 'lucide-react';
import { useDashboard } from '@/hooks/use-dashboard';
import { useIssueMutations } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/feature/issue/pills';
import { initials, greetingTod, fmtDateShort, relTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  DashboardIssue,
  DashboardOverview,
} from '@/schemas/dashboard';

const todayIso = () => new Date().toISOString().slice(0, 10);
const dayOf = (iso: string) => iso.slice(0, 10);

interface KpiCardProps {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  tone: 'violet' | 'red' | 'amber' | 'pink' | 'green' | 'blue';
  href?: string;
  danger?: boolean;
}

const TONE: Record<KpiCardProps['tone'], string> = {
  violet: 'bg-[rgba(139,92,246,.12)] text-violet',
  red: 'bg-[rgba(239,68,68,.12)] text-red',
  amber: 'bg-[rgba(245,158,11,.12)] text-amber',
  pink: 'bg-[rgba(236,72,153,.12)] text-pink',
  green: 'bg-[rgba(16,185,129,.12)] text-green',
  blue: 'bg-[rgba(59,130,246,.12)] text-blue',
};

function KpiCard({ label, value, Icon, tone, href, danger }: KpiCardProps) {
  const body = (
    <div
      className={cn(
        'group flex items-center gap-3 p-4 bg-bg-card border rounded-lg transition-all duration-[var(--dur)]',
        danger
          ? 'border-[rgba(239,68,68,.5)] shadow-[0_0_0_3px_rgba(239,68,68,.06)]'
          : 'border-border hover:-translate-y-[2px] hover:shadow-lg hover:border-accent',
        href && 'cursor-pointer',
      )}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0',
          TONE[tone],
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-[22px] font-bold tracking-[-.02em]">{value}</div>
        <div className="text-[11.5px] text-text-muted">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0">
      <svg
        className="w-full h-full -rotate-90"
        viewBox="0 0 120 120"
        aria-hidden
      >
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth={10}
          className="text-border"
          stroke="currentColor"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="text-accent transition-[stroke-dashoffset] duration-[600ms] ease-[cubic-bezier(.16,1,.3,1)]"
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[26px] font-bold tracking-[-.02em] leading-none">
          {pct}%
        </strong>
        <span className="text-[10.5px] text-text-muted mt-1">Complete</span>
      </div>
    </div>
  );
}

const PRIO_DOT: Record<string, string> = {
  critical: 'bg-red',
  high: 'bg-[#f97316]',
  medium: 'bg-amber',
  low: 'bg-[#94a3b8]',
};

function TaskRow({
  issue,
  projectById,
  onQuickDone,
}: {
  issue: DashboardIssue;
  projectById: Map<
    string,
    { _id: string; name: string; color: string }
  >;
  onQuickDone: (id: string) => void;
}) {
  const proj = projectById.get(issue.projectId);
  const today = todayIso();
  let dueLabel: string | null = null;
  let dueCls = 'text-text-muted bg-bg-subtle border-border';
  if (issue.dueDate) {
    const d = dayOf(issue.dueDate);
    if (d < today) {
      dueLabel = 'Overdue';
      dueCls = 'text-red bg-[rgba(239,68,68,.1)] border-[rgba(239,68,68,.25)]';
    } else if (d === today) {
      dueLabel = 'Today';
      dueCls =
        'text-amber bg-[rgba(245,158,11,.12)] border-[rgba(245,158,11,.25)]';
    } else {
      const daysLeft = Math.round(
        (new Date(d).getTime() - new Date(today).getTime()) / 86_400_000,
      );
      dueLabel = fmtDateShort(issue.dueDate);
      if (daysLeft <= 3) dueCls = 'text-amber bg-bg-subtle border-border';
    }
  }
  return (
    <div className="group flex items-center gap-2.5 px-4 py-2 hover:bg-bg-hover transition-colors">
      <Link
        href={`/issues/${issue._id}`}
        className="flex items-center gap-2.5 flex-1 min-w-0"
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            PRIO_DOT[issue.priority] ?? PRIO_DOT.low,
          )}
          title={issue.priority}
        />
        <span className="text-[13px] truncate flex-1">{issue.title}</span>
        {proj && (
          <span
            className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border whitespace-nowrap"
            style={{
              background: `color-mix(in srgb, ${proj.color} 12%, var(--bg-card))`,
              color: proj.color,
              borderColor: `color-mix(in srgb, ${proj.color} 25%, var(--border))`,
            }}
          >
            {proj.name}
          </span>
        )}
        {dueLabel && (
          <span
            className={cn(
              'inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border whitespace-nowrap',
              dueCls,
            )}
          >
            {dueLabel}
          </span>
        )}
        <StatusPill status={issue.status} />
      </Link>
      <button
        type="button"
        title="Mark done"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onQuickDone(issue._id);
        }}
        className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-green hover:text-white transition-all"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface Bucket {
  label: string;
  dotCls: string;
  items: DashboardIssue[];
}

function bucketMyWork(items: DashboardIssue[]): Bucket[] {
  const today = todayIso();
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekIso = week.toISOString().slice(0, 10);

  const overdue: DashboardIssue[] = [];
  const due: DashboardIssue[] = [];
  const thisWeek: DashboardIssue[] = [];
  const later: DashboardIssue[] = [];

  for (const i of items) {
    const d = i.dueDate ? dayOf(i.dueDate) : null;
    if (!d) {
      later.push(i);
    } else if (d < today) overdue.push(i);
    else if (d === today) due.push(i);
    else if (d <= weekIso) thisWeek.push(i);
    else later.push(i);
  }

  return [
    { label: 'Overdue', dotCls: 'bg-red', items: overdue },
    { label: 'Due today', dotCls: 'bg-amber', items: due },
    { label: 'This week', dotCls: 'bg-blue', items: thisWeek },
    { label: 'Later', dotCls: 'bg-text-muted', items: later },
  ].filter((g) => g.items.length > 0);
}

export default function HomePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user)!;
  const { data, isLoading } = useDashboard();
  const { data: projects = [] } = useProjects();
  const { update: updateIssue } = useIssueMutations();

  const projectById = useMemo(
    () =>
      new Map(
        projects.map((p) => [
          p._id,
          { _id: p._id, name: p.name, color: p.color },
        ]),
      ),
    [projects],
  );

  const overview: DashboardOverview | undefined = data;
  const buckets = useMemo(
    () => bucketMyWork(overview?.myWork ?? []),
    [overview?.myWork],
  );

  const onQuickDone = (id: string) =>
    updateIssue.mutate({ id, body: { status: 'done' } });

  const total = overview?.progress.total ?? 0;
  const done = overview?.progress.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <>
      {/* Hero */}
      <div className="relative flex items-end justify-between gap-5 flex-wrap mb-5 px-7 py-6 bg-grad-soft border border-border-strong rounded-xl overflow-hidden">
        <div className="absolute -top-20 -right-20 w-[280px] h-[280px] rounded-full bg-grad opacity-[.07] blur-[40px] pointer-events-none" />
        <div className="relative z-10">
          <div className="text-[13px] text-text-muted font-medium mb-1">
            Good {greetingTod()}, {user.name.split(' ')[0]}
          </div>
          <h1 className="text-[26px] font-bold tracking-[-.02em] leading-[1.2]">
            Here&apos;s what&apos;s happening today
          </h1>
        </div>
        <div className="relative z-10 flex flex-wrap gap-2">
          <QuickActionButton onClick={() => router.push('/issues?new=1')}>
            <Plus className="w-3.5 h-3.5" /> New task
          </QuickActionButton>
          <QuickActionButton onClick={() => router.push('/my-work')}>
            <CheckSquare className="w-3.5 h-3.5" /> My work
          </QuickActionButton>
          <QuickActionButton onClick={() => router.push('/approvals?new=1')}>
            <GitMerge className="w-3.5 h-3.5" /> New approval
          </QuickActionButton>
          <QuickActionButton onClick={() => router.push('/projects?new=1')}>
            <Grid3x3 className="w-3.5 h-3.5" /> New project
          </QuickActionButton>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid gap-3 mb-5 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <KpiCard
          label="My open tasks"
          value={overview?.kpi.myOpen ?? 0}
          Icon={CheckSquare}
          tone="violet"
          href="/my-work"
        />
        <KpiCard
          label="Overdue"
          value={overview?.kpi.overdue ?? 0}
          Icon={Flag}
          tone="red"
          href="/my-work"
          danger={(overview?.kpi.overdue ?? 0) > 0}
        />
        <KpiCard
          label="Due today"
          value={overview?.kpi.dueToday ?? 0}
          Icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Pending approvals"
          value={overview?.kpi.approvals ?? 0}
          Icon={GitMerge}
          tone="pink"
          href="/approvals"
        />
        <KpiCard
          label="Done this week"
          value={overview?.kpi.doneWeek ?? 0}
          Icon={Check}
          tone="green"
        />
        <KpiCard
          label="Active projects"
          value={overview?.kpi.projects ?? 0}
          Icon={Grid3x3}
          tone="blue"
          href="/projects"
        />
      </div>

      {/* Main grid: My Work + Right column */}
      <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[1fr_320px]">
        <Panel
          title="My work"
          subtitle="Tasks assigned to you"
          action={
            <Link
              href="/my-work"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
            >
              Full view <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {isLoading ? (
            <SkeletonRows />
          ) : buckets.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-[28px] mb-2">🎉</div>
              <strong className="block text-[13px]">All caught up!</strong>
              <p className="text-[12px] text-text-muted mt-1">
                No open tasks assigned to you.
              </p>
            </div>
          ) : (
            buckets.map((b) => (
              <div key={b.label}>
                <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-[.06em] text-text-muted border-t border-border first:border-t-0 bg-bg-subtle">
                  <span className={cn('w-1.5 h-1.5 rounded-full', b.dotCls)} />
                  {b.label}
                  <span className="ml-1 font-mono text-text-muted">
                    {b.items.length}
                  </span>
                </div>
                {b.items.slice(0, 5).map((i) => (
                  <TaskRow
                    key={i._id}
                    issue={i}
                    projectById={projectById}
                    onQuickDone={onQuickDone}
                  />
                ))}
              </div>
            ))
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Upcoming deadlines" subtitle="Next 7 days">
            {(overview?.upcoming.length ?? 0) === 0 ? (
              <p className="px-4 py-5 text-[12.5px] text-text-muted text-center">
                No upcoming deadlines 🎉
              </p>
            ) : (
              overview!.upcoming.map((i) => {
                const proj = projectById.get(i.projectId);
                const day = i.dueDate ? dayOf(i.dueDate) : '';
                const today = todayIso();
                const daysLeft = day
                  ? Math.round(
                      (new Date(day).getTime() -
                        new Date(today).getTime()) /
                        86_400_000,
                    )
                  : 0;
                const chipCls =
                  daysLeft === 0
                    ? 'bg-amber text-white'
                    : daysLeft <= 2
                      ? 'bg-[rgba(245,158,11,.18)] text-amber'
                      : 'bg-bg-subtle text-text-sub border border-border';
                const chipTxt =
                  daysLeft === 0
                    ? 'Today'
                    : daysLeft === 1
                      ? 'Tmrw'
                      : fmtDateShort(i.dueDate!);
                return (
                  <Link
                    key={i._id}
                    href={`/issues/${i._id}`}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-bg-hover transition-colors"
                  >
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap flex-shrink-0',
                        chipCls,
                      )}
                    >
                      {chipTxt}
                    </span>
                    <span className="flex-1 text-[12.5px] truncate">
                      {i.title}
                    </span>
                    {proj && (
                      <span className="text-[10.5px] text-text-muted truncate max-w-[80px]">
                        {proj.name}
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </Panel>

          <Panel title="Progress" subtitle="All tasks">
            <div className="flex items-center gap-5 px-5 py-5">
              <ProgressRing pct={pct} />
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                <ProgressStat
                  label="Done"
                  value={overview?.progress.done ?? 0}
                  dot="bg-green"
                />
                <ProgressStat
                  label="In progress"
                  value={overview?.progress.inProgress ?? 0}
                  dot="bg-amber"
                />
                <ProgressStat
                  label="To do"
                  value={overview?.progress.todo ?? 0}
                  dot="bg-text-muted"
                />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Bottom grid: Activity + Projects */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Panel title="Recent activity">
          {(overview?.activity.length ?? 0) === 0 ? (
            <p className="px-4 py-5 text-[12.5px] text-text-muted text-center">
              No activity yet
            </p>
          ) : (
            overview!.activity.map((a) => {
              const href =
                a.entityType === 'issue'
                  ? `/issues/${a.entityId}`
                  : a.entityType === 'mr'
                    ? `/approvals/${a.entityId}`
                    : null;
              const inner = (
                <>
                  <Avatar name={a.actorName} src={a.actorAvatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] leading-snug">
                      <strong>{a.actorName}</strong>{' '}
                      <span className="text-text-muted">{a.action}</span>{' '}
                      <span className="text-text">{a.title}</span>
                    </div>
                    <div className="text-[10.5px] text-text-muted mt-0.5">
                      {relTime(a.createdAt)}
                    </div>
                  </div>
                </>
              );
              return href ? (
                <Link
                  key={a._id}
                  href={href}
                  className="flex items-start gap-2.5 px-4 py-2.5 border-t border-border first:border-t-0 hover:bg-bg-hover transition-colors"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={a._id}
                  className="flex items-start gap-2.5 px-4 py-2.5 border-t border-border first:border-t-0"
                >
                  {inner}
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          title="Projects"
          action={
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {(overview?.projectStats.length ?? 0) === 0 ? (
            <p className="px-4 py-5 text-[12.5px] text-text-muted text-center">
              No projects yet
            </p>
          ) : (
            overview!.projectStats.map((p) => {
              const pPct = p.total ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0 hover:bg-bg-hover transition-colors"
                >
                  <span
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0"
                    style={{ background: p.color }}
                  >
                    {initials(p.name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {p.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 bg-border rounded-[2px] overflow-hidden">
                        <div
                          className="h-full rounded-[2px] transition-[width] duration-[600ms]"
                          style={{
                            width: `${pPct}%`,
                            background: p.color,
                          }}
                        />
                      </div>
                      <span className="text-[10.5px] text-text-muted whitespace-nowrap">
                        {p.done}/{p.total}
                      </span>
                      {p.overdue > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[rgba(239,68,68,.12)] text-red whitespace-nowrap">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {p.overdue} overdue
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </Panel>
      </div>
    </>
  );
}

function QuickActionButton({
  children,
  onClick,
}: React.PropsWithChildren<{ onClick: () => void }>) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: React.PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}>) {
  return (
    <section className="bg-bg-card border border-border rounded-lg overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex flex-col leading-tight min-w-0">
          <h3 className="text-[14px] font-semibold truncate">{title}</h3>
          {subtitle && (
            <span className="text-[11px] text-text-muted">{subtitle}</span>
          )}
        </div>
        {action}
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function ProgressStat({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('w-2 h-2 rounded-full', dot)} />
      <strong className="font-mono text-[13px] w-7 text-right">{value}</strong>
      <span className="text-[12px] text-text-sub">{label}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-7 rounded-sm bg-bg-subtle animate-pulse opacity-60"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

