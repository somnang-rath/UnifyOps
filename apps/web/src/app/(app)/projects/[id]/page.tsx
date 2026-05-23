'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock,
  Globe,
  Lock,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useProject, useProjectMutations } from '@/hooks/use-projects';
import { useIssues } from '@/hooks/use-issues';
import { useUsers } from '@/hooks/use-users';
import { useActivity } from '@/hooks/use-activity';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { StatusPill, PriorityPill } from '@/components/feature/issue/pills';
import { initials, fmtDateShort, fmtDate, relTime } from '@/lib/format';
import { ProjectDetailSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Tab = 'issues' | 'activity' | 'members';

export default function ProjectDetailPage() {
  const id = useParams<{ id: string }>().id;
  const [tab, setTab] = useState<Tab>('issues');
  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const me = useAuthStore((s) => s.user);
  const { data: project, isLoading } = useProject(id);
  const { data: issuesResp } = useIssues({ projectId: id, status: 'all' });
  const { data: users = [] } = useUsers();
  const { data: activity = [] } = useActivity({ projectId: id, limit: 30 });
  const { update } = useProjectMutations();

  if (isLoading || !project) return <ProjectDetailSkeleton />;

  const issues = issuesResp?.items ?? [];
  const userMap = new Map(users.map((u) => [u._id, u]));

  const isOwner = !!me && (me.id === project.ownerId || me.role === 'admin');

  const toEmails = (ids: string[]) =>
    ids.map((mid) => userMap.get(mid)?.email).filter(Boolean) as string[];

  const addMember = async (userId: string) => {
    const u = userMap.get(userId);
    if (!u) return;
    const emails = toEmails(project.members);
    if (emails.includes(u.email)) return;
    setSaving(true);
    try {
      await update.mutateAsync({ id: project._id, body: { memberEmails: [...emails, u.email] } });
    } finally {
      setSaving(false);
      setAddOpen(false);
      setMemberSearch('');
    }
  };

  const removeMember = async (memberId: string) => {
    const u = userMap.get(memberId);
    if (!u) return;
    const emails = toEmails(project.members).filter((e) => e !== u.email);
    setSaving(true);
    try {
      await update.mutateAsync({ id: project._id, body: { memberEmails: emails } });
    } finally {
      setSaving(false);
    }
  };

  const memberSet = new Set([project.ownerId, ...project.members]);
  const suggestions = users.filter((u) => {
    if (memberSet.has(u._id)) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const openCount = issues.filter((i) => i.status !== 'done').length;
  const doneCount = issues.filter((i) => i.status === 'done').length;
  const overdueCount = issues.filter(
    (i) =>
      i.status !== 'done' &&
      i.dueDate &&
      new Date(i.dueDate) < new Date(),
  ).length;
  const pct = issues.length ? Math.round((doneCount / issues.length) * 100) : 0;

  const visibilityIcon =
    project.visibility === 'public' ? (
      <Globe className="w-3.5 h-3.5" />
    ) : project.visibility === 'internal' ? (
      <Users className="w-3.5 h-3.5" />
    ) : (
      <Lock className="w-3.5 h-3.5" />
    );

  return (
    <>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All projects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-12 h-12 rounded-[12px] flex items-center justify-center text-white font-bold text-[18px] flex-shrink-0 shadow-[0_4px_12px_rgba(99,102,241,.25)]"
            style={{ background: project.color }}
          >
            {initials(project.name)}
          </div>
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
              {project.name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[12px] text-text-muted font-mono">
                {project.namespace}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-text-muted capitalize px-1.5 py-0.5 bg-bg-subtle border border-border rounded-full">
                {visibilityIcon}
                {project.visibility}
              </span>
            </div>
          </div>
        </div>
        <Link
          href={`/issues?new=1&project=${project._id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-white rounded-sm bg-grad shadow-a transition-all duration-[var(--dur)] hover:-translate-y-px"
        >
          <Plus className="w-3.5 h-3.5" /> New task
        </Link>
      </div>

      {project.desc && (
        <div className="bg-bg-subtle rounded-[10px] px-4 py-3.5 text-[14px] leading-[1.6] text-text-sub mb-5">
          {project.desc}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Open"
          value={openCount}
          icon={<CircleDot className="w-4 h-4" />}
          tone="blue"
        />
        <KpiCard
          label="Done"
          value={doneCount}
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="green"
        />
        <KpiCard
          label="Overdue"
          value={overdueCount}
          icon={<AlertTriangle className="w-4 h-4" />}
          tone={overdueCount > 0 ? 'red' : 'muted'}
        />
        <KpiCard
          label="Members"
          value={project.members.length}
          icon={<Users className="w-4 h-4" />}
          tone="violet"
        />
      </div>

      {/* Progress bar */}
      <div className="bg-bg-card border border-border rounded-lg px-4 py-3 mb-5">
        <div className="flex items-center justify-between text-[12px] text-text-muted mb-1.5">
          <span>Progress</span>
          <span className="font-semibold text-text">{pct}%</span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${pct}%`, background: project.color }}
          />
        </div>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted">
          <span>{doneCount} done</span>
          <span>·</span>
          <span>{openCount} open</span>
          <span>·</span>
          <span>{issues.length} total</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4">
        <Tabs
          items={[
            { value: 'issues', label: 'Issues', count: issues.length },
            { value: 'activity', label: 'Activity', count: activity.length },
            { value: 'members', label: 'Members', count: project.members.length },
          ]}
          value={tab}
          onChange={(k) => setTab(k as Tab)}
        />
      </div>

      {tab === 'issues' && (
        <section className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {issues.length === 0 ? (
            <p className="px-5 py-10 text-center text-text-muted text-[13px]">
              No issues yet —{' '}
              <Link
                href={`/issues?new=1&project=${project._id}`}
                className="text-accent hover:underline"
              >
                create one
              </Link>
            </p>
          ) : (
            issues.map((i) => {
              const a = i.assigneeId ? userMap.get(i.assigneeId) : null;
              return (
                <Link
                  key={i._id}
                  href={`/issues/${i._id}`}
                  className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-b-0 hover:bg-bg-hover transition-colors"
                >
                  <span className="flex-1 truncate text-[13px]">{i.title}</span>
                  {i.dueDate && (
                    <span
                      className={cn(
                        'flex items-center gap-1 text-[11px]',
                        new Date(i.dueDate) < new Date() && i.status !== 'done'
                          ? 'text-red'
                          : 'text-text-muted',
                      )}
                    >
                      <Clock className="w-3 h-3" />
                      {fmtDateShort(i.dueDate)}
                    </span>
                  )}
                  <PriorityPill priority={i.priority} />
                  <StatusPill status={i.status} />
                  {a && <Avatar name={a.name} src={a.avatar} size="sm" />}
                </Link>
              );
            })
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {activity.length === 0 ? (
            <p className="px-5 py-10 text-center text-text-muted text-[13px]">
              No activity yet
            </p>
          ) : (
            activity.map((a) => {
              const actor = a.actorId;
              const href =
                a.entityType === 'issue'
                  ? `/issues/${a.entityId}`
                  : a.entityType === 'mr'
                    ? `/approvals/${a.entityId}`
                    : null;
              const inner = (
                <div className="flex items-start gap-3 px-5 py-3 border-b border-border last:border-b-0">
                  <Avatar
                    name={actor?.name ?? 'Unknown'}
                    src={actor?.avatar}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] leading-snug">
                      <strong>{actor?.name ?? 'Someone'}</strong>{' '}
                      <span className="text-text-muted">{a.action}</span>{' '}
                      <span className="font-medium">{a.title}</span>
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {relTime(a.createdAt)}
                    </div>
                  </div>
                </div>
              );
              return href ? (
                <Link key={a._id} href={href} className="block hover:bg-bg-hover transition-colors">
                  {inner}
                </Link>
              ) : (
                <div key={a._id}>{inner}</div>
              );
            })
          )}
        </section>
      )}

      {tab === 'members' && (
        <section className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {/* Owner row */}
          {(() => {
            const owner = userMap.get(project.ownerId);
            return owner ? (
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
                <Avatar name={owner.name} src={owner.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{owner.name}</div>
                  <div className="text-[11px] text-text-muted">{owner.email}</div>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  Owner
                </span>
              </div>
            ) : null;
          })()}

          {project.members.length === 0 && !addOpen && (
            <p className="px-5 py-8 text-center text-text-muted text-[13px]">
              No additional members
            </p>
          )}

          {project.members.map((memberId) => {
            const u = userMap.get(memberId);
            if (!u) return null;
            return (
              <div
                key={memberId}
                className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-b-0"
              >
                <Avatar name={u.name} src={u.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{u.name}</div>
                  <div className="text-[11px] text-text-muted">{u.email}</div>
                </div>
                <span className="text-[11px] text-text-muted capitalize mr-2">
                  {u.role}
                </span>
                {isOwner && (
                  <button
                    onClick={() => removeMember(memberId)}
                    disabled={saving}
                    title="Remove member"
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-red/10 hover:text-red transition-colors disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add member row */}
          {isOwner && (
            <div className="border-t border-border">
              {addOpen ? (
                <div className="p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-3 bg-bg-input border border-border rounded-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)] transition-[border-color,box-shadow] duration-[var(--dur)]">
                    <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    <input
                      ref={searchRef}
                      autoFocus
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="flex-1 py-2 text-[13px] bg-transparent outline-none placeholder:text-text-muted"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setAddOpen(false); setMemberSearch(''); }
                      }}
                    />
                    <button
                      onClick={() => { setAddOpen(false); setMemberSearch(''); }}
                      className="text-text-muted hover:text-text"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {suggestions.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-text-muted">
                      {memberSearch.trim() ? 'No users match' : 'All workspace users are already members'}
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto">
                      {suggestions.map((u) => (
                        <li key={u._id}>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => addMember(u._id)}
                            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-sm text-left hover:bg-bg-hover transition-colors disabled:opacity-40"
                          >
                            <Avatar name={u.name} src={u.avatar} size="sm" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium truncate">{u.name}</div>
                              <div className="text-[11px] text-text-muted truncate">{u.email}</div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setAddOpen(true)}
                  className="w-full flex items-center gap-2 px-5 py-3 text-[13px] text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add member
                </button>
              )}
            </div>
          )}

          <div className="px-5 py-3 border-t border-border">
            <div className="text-[11px] text-text-muted">
              Created {fmtDate(project.createdAt)}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

type Tone = 'blue' | 'green' | 'red' | 'violet' | 'muted';
const TONE_CLS: Record<Tone, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/10 text-red-500',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  muted: 'bg-bg-subtle text-text-muted',
};

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: Tone;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 bg-bg-card border border-border rounded-lg">
      <div className={cn('w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0', TONE_CLS[tone])}>
        {icon}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-[20px] font-bold tracking-[-.02em]">{value}</div>
        <div className="text-[11px] text-text-muted">{label}</div>
      </div>
    </div>
  );
}

