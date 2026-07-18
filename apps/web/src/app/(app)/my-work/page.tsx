'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { useIssues, useIssueMutations } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { StatusPill } from '@/components/feature/issue/pills';
import { fmtDateShort, today as todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';

type GroupKey =
  | 'overdue'
  | 'today'
  | 'week'
  | 'later'
  | 'nodate'
  | 'done';

const HEAD_TINT: Record<GroupKey, string> = {
  overdue:
    'bg-[color:color-mix(in_srgb,var(--red)_5%,var(--bg-card))] text-red',
  today:
    'bg-[color:color-mix(in_srgb,var(--amber)_5%,var(--bg-card))] text-amber',
  week: '',
  later: '',
  nodate: '',
  done: '',
};

const PRIO_DOT: Record<Issue['priority'], string> = {
  critical: 'bg-red shadow-[0_0_0_2px_rgba(239,68,68,.2)]',
  high: 'bg-[#f97316]',
  medium: 'bg-amber',
  low: 'bg-[#94a3b8]',
};

export default function MyWorkPage() {
  const me = useAuthStore((s) => s.user)!;
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const { update } = useIssueMutations();

  const { data } = useIssues({
    assigneeId: me.id,
    status: 'all',
    projectId: projectId || undefined,
  });
  const { data: projects = [] } = useProjects();
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p._id, p])),
    [projects],
  );

  const t = todayIso();
  const weekLater = addDays(t, 7);

  const groups = useMemo(() => {
    let tasks = (data?.items ?? []) as Issue[];
    if (statusFilter === 'open')
      tasks = tasks.filter((i) => i.status !== 'done');

    const overdue: Issue[] = [];
    const today: Issue[] = [];
    const week: Issue[] = [];
    const later: Issue[] = [];
    const nodate: Issue[] = [];
    const done: Issue[] = [];

    for (const i of tasks) {
      const d = i.dueDate?.slice(0, 10);
      if (i.status === 'done') {
        done.push(i);
        continue;
      }
      if (!d) {
        nodate.push(i);
      } else if (d < t) {
        overdue.push(i);
      } else if (d === t) {
        today.push(i);
      } else if (d <= weekLater) {
        week.push(i);
      } else {
        later.push(i);
      }
    }

    return (
      [
        { key: 'overdue', label: '🔴 Overdue', items: overdue },
        { key: 'today', label: '🟡 Due today', items: today },
        { key: 'week', label: '📅 This week', items: week },
        { key: 'later', label: '📋 Upcoming', items: later },
        { key: 'nodate', label: '📌 No due date', items: nodate },
        {
          key: 'done',
          label: '✅ Completed',
          items: done.slice(0, 10),
        },
      ] as { key: GroupKey; label: string; items: Issue[] }[]
    ).filter((g) => g.items.length > 0);
  }, [data, t, weekLater, statusFilter]);

  const toggle = (key: GroupKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const markDone = (id: string) =>
    update.mutate({ id, body: { status: 'done' } });

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            My Work
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            All tasks assigned to you across every project
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select
            inline
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((p) => ({ value: p._id, label: p.name })),
            ]}
          />
          <Select
            inline
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'open' | 'all')}
            options={[
              { value: 'open', label: 'Open tasks' },
              { value: 'all', label: 'All tasks' },
            ]}
          />
          <Button asChild variant="primary">
            <Link href="/issues?new=1">
              <Plus /> New task
            </Link>
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-lg p-12 text-center">
          <div className="text-[32px] mb-2">🎉</div>
          <strong className="block mb-1">All caught up!</strong>
          <span className="text-text-muted text-[13px]">
            No tasks assigned to you
            {projectId ? ' in this project' : ''}.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <section
                key={g.key}
                className="bg-bg-card border border-border rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border cursor-pointer select-none transition-colors',
                    HEAD_TINT[g.key] || 'bg-bg-subtle',
                    'hover:bg-bg-hover',
                  )}
                >
                  <h4 className="flex-1 text-left text-[13px] font-semibold m-0">
                    {g.label}
                  </h4>
                  <span className="text-[11px] text-text-muted bg-bg-hover px-2 py-0.5 rounded-full">
                    {g.items.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-[var(--dur)]',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                </button>
                {!isCollapsed && (
                  <div>
                    {g.items.map((i) => (
                      <TaskRow
                        key={i._id}
                        issue={i}
                        project={
                          i.projectId
                            ? projectMap.get(i.projectId)
                            : undefined
                        }
                        today={t}
                        onOpen={() => router.push(`/issues/${i._id}`)}
                        onDone={() => markDone(i._id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function TaskRow({
  issue,
  project,
  today,
  onOpen,
  onDone,
}: {
  issue: Issue;
  project?: { name: string; color: string };
  today: string;
  onOpen: () => void;
  onDone: () => void;
}) {
  const d = issue.dueDate?.slice(0, 10);
  let dueCls = '';
  let dueLabel = '';
  if (d) {
    if (d < today) {
      dueCls =
        'bg-[color:color-mix(in_srgb,var(--red)_12%,transparent)] text-red font-semibold';
      dueLabel = 'Overdue';
    } else if (d === today) {
      dueCls =
        'bg-[color:color-mix(in_srgb,var(--amber)_16%,transparent)] text-amber font-semibold';
      dueLabel = 'Today';
    } else {
      const days = Math.round(
        (new Date(d).getTime() - new Date(today).getTime()) / 86_400_000,
      );
      dueCls =
        days <= 3
          ? 'bg-[color:color-mix(in_srgb,var(--amber)_12%,transparent)] text-amber'
          : 'bg-bg-hover text-text-muted';
      dueLabel = fmtDateShort(d);
    }
  }

  return (
    <div
      onClick={onOpen}
      className="group flex items-center gap-[9px] px-[18px] py-[9px] border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-hover transition-colors"
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          PRIO_DOT[issue.priority],
        )}
        title={issue.priority}
      />
      <span className="flex-1 truncate text-[13px] text-text">
        {issue.title}
      </span>
      {project && (
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
          style={{
            background: `color-mix(in srgb, ${project.color} 12%, var(--bg-card))`,
            color: project.color,
          }}
        >
          {project.name}
        </span>
      )}
      {d && (
        <span
          className={cn(
            'text-[11px] px-[7px] py-0.5 rounded-full whitespace-nowrap flex-shrink-0 font-medium',
            dueCls,
          )}
        >
          {dueLabel}
        </span>
      )}
      <StatusPill status={issue.status} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
        title="Mark done"
        disabled={issue.status === 'done'}
        className={cn(
          'w-[22px] h-[22px] rounded-full border-[1.5px] border-border-strong flex items-center justify-center flex-shrink-0 text-text-muted transition-all duration-[var(--dur)] opacity-0 group-hover:opacity-100',
          'hover:border-green hover:text-green hover:bg-[color:color-mix(in_srgb,var(--green)_10%,transparent)]',
          issue.status === 'done' && 'opacity-100 border-green text-green',
        )}
      >
        <Check className="w-3 h-3" />
      </button>
    </div>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
