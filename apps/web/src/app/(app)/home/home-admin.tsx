'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  GitMerge,
  Plus,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import type { AuthUser } from '@/schemas/auth';
import type { AdminTeamStat, DashboardOverview } from '@/schemas/dashboard';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { initials, greetingTod } from '@/lib/format';
import { useFormat } from '@prism/i18n';
import { cn } from '@/lib/utils';

// ── System KPI card ───────────────────────────────────────────────────────────

type Tone = 'blue' | 'violet' | 'amber' | 'red' | 'green';

const TONE_BG: Record<Tone, string> = {
  blue:   'bg-[rgba(59,130,246,.1)]  text-blue',
  violet: 'bg-[rgba(139,92,246,.1)]  text-violet',
  amber:  'bg-[rgba(245,158,11,.1)]  text-amber',
  red:    'bg-[rgba(239,68,68,.1)]   text-red',
  green:  'bg-[rgba(16,185,129,.1)]  text-green',
};

const TONE_NUM: Record<Tone, string> = {
  blue:   'text-blue',
  violet: 'text-violet',
  amber:  'text-amber',
  red:    'text-red',
  green:  'text-green',
};

function SystemKpiCard({
  label,
  value,
  Icon,
  tone,
  href,
  danger,
}: {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  href?: string;
  danger?: boolean;
}) {
  const body = (
    <div
      className={cn(
        'group flex flex-col gap-3 p-4 bg-bg-card border rounded-xl transition-all duration-[var(--dur)]',
        danger
          ? 'border-[rgba(239,68,68,.45)] shadow-[0_0_0_3px_rgba(239,68,68,.07)]'
          : 'border-border hover:-translate-y-[2px] hover:shadow-lg hover:border-accent',
        href && 'cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', TONE_BG[tone])}>
          <Icon className="w-[16px] h-[16px]" />
        </div>
        {href && (
          <ArrowRight className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div className="leading-none">
        <div className={cn('text-[30px] font-bold tracking-[-.03em]', TONE_NUM[tone])}>{value}</div>
        <div className="text-[11.5px] text-text-muted mt-1">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// ── Panel wrapper ─────────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  action,
  children,
}: React.PropsWithChildren<{ title: string; subtitle?: string; action?: React.ReactNode }>) {
  return (
    <section className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex flex-col leading-tight min-w-0">
          <h3 className="text-[14px] font-semibold truncate">{title}</h3>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
        {action}
      </header>
      <div className="flex flex-col flex-1">{children}</div>
    </section>
  );
}

// ── Project health row ────────────────────────────────────────────────────────

function ProjectHealthRow({ p }: {
  p: { id: string; name: string; color: string; members: string[]; done: number; total: number; overdue: number };
}) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <Link
      href={`/projects/${p.id}`}
      className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0 hover:bg-bg-hover transition-colors"
    >
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-[10.5px] flex-shrink-0"
        style={{ background: p.color }}
      >
        {initials(p.name)}
      </span>
      <span className="flex-1 text-[13px] font-medium truncate min-w-0">{p.name}</span>
      <span className="hidden sm:block text-[11px] text-text-muted whitespace-nowrap mr-1">
        {p.members.length} member{p.members.length !== 1 ? 's' : ''}
      </span>
      <div className="w-20 h-1.5 bg-border rounded-full overflow-hidden flex-shrink-0">
        <div
          className="h-full rounded-full transition-[width] duration-[600ms]"
          style={{ width: `${pct}%`, background: p.color }}
        />
      </div>
      <span className="text-[11px] text-text-muted w-10 text-right whitespace-nowrap flex-shrink-0">
        {p.done}/{p.total}
      </span>
      {p.overdue > 0 ? (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[rgba(239,68,68,.12)] text-red whitespace-nowrap flex-shrink-0">
          <AlertTriangle className="w-2.5 h-2.5" /> {p.overdue}
        </span>
      ) : (
        <span className="w-[46px] flex-shrink-0" />
      )}
    </Link>
  );
}

// ── Team member row ───────────────────────────────────────────────────────────

function TeamMemberRow({ member }: { member: AdminTeamStat }) {
  const total = member.open + member.done;
  const donePct = total ? Math.round((member.done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border first:border-t-0 hover:bg-bg-hover transition-colors">
      <Avatar name={member.name} src={member.avatar} size="sm" className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">{member.name}</div>
        <div className="flex items-center gap-1.5 mt-1">
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-[600ms] bg-accent opacity-70"
              style={{ width: `${donePct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 text-[11.5px] flex-shrink-0">
        <span className="font-mono text-text-sub">{member.open} open</span>
        {member.overdue > 0 && (
          <span className="font-mono text-red font-semibold">{member.overdue} late</span>
        )}
        {member.done > 0 && (
          <span className="font-mono text-green">{member.done} done</span>
        )}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-10 rounded-lg bg-bg-subtle animate-pulse opacity-60"
          style={{ animationDelay: `${i * 70}ms` }}
        />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <>
      {/* hero */}
      <div className="h-[108px] mb-5 bg-bg-card border border-border rounded-xl animate-pulse opacity-50" />
      {/* kpi strip */}
      <div className="grid gap-3 mb-5 grid-cols-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[90px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50"
            style={{ animationDelay: `${i * 55}ms` }}
          />
        ))}
      </div>
      {/* panels */}
      <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_260px_260px]">
        <div className="h-[380px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" style={{ animationDelay: '80ms' }} />
        <div className="h-[380px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" style={{ animationDelay: '130ms' }} />
        <div className="h-[380px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" style={{ animationDelay: '180ms' }} />
      </div>
      {/* summary row */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[64px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50"
            style={{ animationDelay: `${220 + i * 50}ms` }}
          />
        ))}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  user: AuthUser;
  overview: DashboardOverview | undefined;
  isLoading: boolean;
}

export function AdminDashboard({ user, overview, isLoading }: Props) {
  const router = useRouter();
  const f = useFormat();

  if (isLoading && !overview) return <PageSkeleton />;

  const adminStats  = overview?.adminStats;
  const kpi         = overview?.kpi;
  const approvals   = kpi?.approvals ?? 0;

  const systemOpen    = (overview?.progress.total ?? 0) - (overview?.progress.done ?? 0);
  const teamOverdue   = adminStats?.teamStats.reduce((acc, t) => acc + t.overdue, 0) ?? 0;

  return (
    <>
      {/* ── Admin hero ── */}
      <div className="relative flex items-end justify-between gap-5 flex-wrap mb-5 px-7 py-6 bg-[color-mix(in_srgb,var(--accent)_7%,var(--bg-card))] border border-[color-mix(in_srgb,var(--accent)_20%,var(--border))] rounded-xl overflow-hidden">
        {/* decorative blobs */}
        <div className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full bg-[var(--accent)] opacity-[.05] blur-[56px] pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-[200px] h-[200px] rounded-full bg-[var(--accent)] opacity-[.04] blur-[48px] pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[.07em] border"
              style={{
                background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-card))',
                color: 'var(--accent)',
                borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))',
              }}
            >
              <Shield className="w-3 h-3" /> Admin
            </span>
          </div>
          <h1 className="text-[26px] font-bold tracking-[-.02em] leading-[1.2] mb-1">
            System Overview
          </h1>
          <p className="text-[13px] text-text-sub">
            Good {greetingTod()}, {user.name.split(' ')[0]}
            {adminStats
              ? ` · Managing ${adminStats.totalUsers} user${adminStats.totalUsers !== 1 ? 's' : ''} across ${kpi?.projects ?? 0} project${(kpi?.projects ?? 0) !== 1 ? 's' : ''}`
              : ' · Loading system data…'}
          </p>
        </div>

        <div className="relative z-10 flex flex-col items-end gap-3">
          {/* quick actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/users')}>
              <Users className="w-3.5 h-3.5" /> Users
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/projects?new=1')}>
              <Plus className="w-3.5 h-3.5" /> New project
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/settings')}>
              <Settings className="w-3.5 h-3.5" /> Settings
            </Button>
          </div>
          {/* inline stat chips */}
          <div className="flex flex-wrap gap-2">
            {([
              { label: 'Users',    value: adminStats?.totalUsers ?? '—', icon: '👤',  danger: false },
              { label: 'Projects', value: kpi?.projects         ?? '—', icon: '📁',  danger: false },
              { label: 'Open',     value: systemOpen,                   icon: '📋',  danger: false },
              { label: 'Overdue',  value: teamOverdue,                  icon: '⚠️', danger: teamOverdue > 0 },
            ]).map(({ label, value, icon, danger }) => (
              <span
                key={label}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-semibold border backdrop-blur-sm',
                  danger
                    ? 'bg-[rgba(239,68,68,.12)] text-red border-[rgba(239,68,68,.3)]'
                    : 'bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-card))] text-text-sub border-[color-mix(in_srgb,var(--accent)_20%,var(--border))]',
                )}
              >
                <span className="text-[12px]">{icon}</span>
                <span className="font-mono">{value}</span>
                <span className="text-text-muted font-normal">{label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pending approvals alert ── */}
      {approvals > 0 && (
        <Link
          href="/approvals"
          className="flex items-center gap-3 mb-5 px-5 py-3.5 bg-[rgba(245,158,11,.08)] border border-[rgba(245,158,11,.3)] rounded-xl hover:bg-[rgba(245,158,11,.12)] transition-colors"
        >
          <Bell className="w-4 h-4 text-amber flex-shrink-0" />
          <span className="flex-1 text-[13px] font-medium">
            <strong className="text-amber">{approvals} approval{approvals !== 1 ? 's' : ''}</strong>
            {' '}waiting for review
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber">
            Review now <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      )}

      {/* ── System KPI strip ── */}
      <div className="grid gap-3 mb-5 grid-cols-2 sm:grid-cols-4">
        <SystemKpiCard
          label="Total users"
          value={adminStats?.totalUsers ?? 0}
          Icon={Users}
          tone="blue"
          href="/users"
        />
        <SystemKpiCard
          label="Active projects"
          value={kpi?.projects ?? 0}
          Icon={GitMerge}
          tone="violet"
          href="/projects"
        />
        <SystemKpiCard
          label="Open issues"
          value={systemOpen}
          Icon={Check}
          tone="amber"
        />
        <SystemKpiCard
          label="Team overdue"
          value={teamOverdue}
          Icon={AlertTriangle}
          tone="red"
          danger={teamOverdue > 0}
        />
      </div>

      {/* ── Main content ── */}
      <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_260px_260px]">

        {/* Projects health table */}
        <Panel
          title="Projects health"
          subtitle={`${overview?.projectStats.length ?? 0} projects`}
          action={
            <Link href="/projects" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {isLoading ? (
            <SkeletonRows />
          ) : (overview?.projectStats.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-[12.5px] text-text-muted text-center">No projects yet</p>
          ) : (
            overview!.projectStats.map((p) => <ProjectHealthRow key={p.id} p={p} />)
          )}
        </Panel>

        {/* Team load */}
        <Panel
          title="Team workload"
          subtitle="Tasks assigned per member"
        >
          {isLoading ? (
            <SkeletonRows />
          ) : (adminStats?.teamStats.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-[12.5px] text-text-muted text-center">No assignments yet</p>
          ) : (
            adminStats!.teamStats.map((t) => <TeamMemberRow key={t.id} member={t} />)
          )}
        </Panel>

        {/* Activity — stacks below team on lg, side-by-side on xl */}
        <Panel
          title="Recent activity"
          subtitle="Across all projects"
        >
          {(overview?.activity.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-[12.5px] text-text-muted text-center">No activity yet</p>
          ) : (
            overview!.activity.map((a) => {
              const href =
                a.entityType === 'issue' ? `/issues/${a.entityId}`
                : a.entityType === 'mr'  ? `/approvals/${a.entityId}`
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
                    <div className="text-[10.5px] text-text-muted mt-0.5">{f.relative(a.createdAt)}</div>
                  </div>
                </>
              );
              return href ? (
                <Link key={a._id} href={href} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-border first:border-t-0 hover:bg-bg-hover transition-colors">
                  {inner}
                </Link>
              ) : (
                <div key={a._id} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-border first:border-t-0">
                  {inner}
                </div>
              );
            })
          )}
        </Panel>
      </div>

      {/* ── Summary row ── */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="flex items-center gap-3 px-4 py-3.5 bg-bg-card border border-border rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-[rgba(16,185,129,.1)] flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-green" />
          </div>
          <div className="leading-tight">
            <div className="text-[20px] font-bold tracking-[-.02em] text-green">{overview?.progress.done ?? 0}</div>
            <div className="text-[11px] text-text-muted">Tasks done this week</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 bg-bg-card border border-border rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-[rgba(245,158,11,.1)] flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber" />
          </div>
          <div className="leading-tight">
            <div className="text-[20px] font-bold tracking-[-.02em] text-amber">{overview?.progress.inProgress ?? 0}</div>
            <div className="text-[11px] text-text-muted">In progress system-wide</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 bg-bg-card border border-border rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-[rgba(59,130,246,.1)] flex items-center justify-center flex-shrink-0">
            <GitMerge className="w-4 h-4 text-blue" />
          </div>
          <div className="leading-tight">
            <div className="text-[20px] font-bold tracking-[-.02em] text-blue">{kpi?.approvals ?? 0}</div>
            <div className="text-[11px] text-text-muted">Open approvals</div>
          </div>
        </div>
      </div>
    </>
  );
}
