'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Plus, Search } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { useIssues } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useDebounce } from '@/hooks/use-debounce';
import { IssueModal } from '@/components/feature/issue/issue-modal';
import { IssueTypeIcon } from '@/components/feature/issue/icons';
import {
  Label,
  PriorityPill,
  StatusPill,
} from '@/components/feature/issue/pills';
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  type Issue,
} from '@/schemas/issue';
import { fmtDateShort, relTime } from '@/lib/format';

type Tab = 'open' | 'closed' | 'all';
const TYPE_OPTS = [
  { value: '', label: 'All types' },
  ...ISSUE_TYPES.map((t) => ({
    value: t,
    label: t[0].toUpperCase() + t.slice(1),
  })),
];
const PRIO_OPTS = [
  { value: '', label: 'Any priority' },
  ...ISSUE_PRIORITIES.map((p) => ({
    value: p,
    label: p[0].toUpperCase() + p.slice(1),
  })),
];

export default function IssuesPage() {
  const router = useRouter();
  const params = useSearchParams();

  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 220);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Issue | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') setCreating(true);
  }, [params]);

  const { data, isLoading } = useIssues({
    status: tab,
    projectId: projectId || undefined,
    type: type || undefined,
    priority: priority || undefined,
    q: debouncedQ || undefined,
  });

  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p._id, p])),
    [projects],
  );
  const userMap = useMemo(
    () => new Map(users.map((u) => [u._id, u])),
    [users],
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Tasks
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Track bugs, tasks, and features
          </p>
        </div>
        <Button variant="grad" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> New task
        </Button>
      </div>

      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'open', label: 'Open', count: data?.totals.open },
            { value: 'closed', label: 'Closed', count: data?.totals.closed },
            { value: 'all', label: 'All', count: data?.totals.all },
          ]}
        />
        <div className="flex-1" />

        <div className="flex items-center gap-2 min-w-[220px] px-3 bg-bg-card border-[1.5px] border-border rounded-sm transition-[border-color,box-shadow] duration-[var(--dur)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]">
          <Search className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="flex-1 border-0 bg-transparent py-2 text-[13px] outline-none placeholder:text-text-muted"
          />
        </div>

        <Select
          inline
          value={projectId}
          onValueChange={setProjectId}
          options={[
            { value: '', label: 'All projects' },
            ...projects.map((p) => ({ value: p._id, label: p.name })),
          ]}
        />
        <Select inline value={type} onValueChange={setType} options={TYPE_OPTS} />
        <Select
          inline
          value={priority}
          onValueChange={setPriority}
          options={PRIO_OPTS}
        />
      </div>

      {isLoading && !data ? (
        <div className="text-text-muted text-[13px]">Loading…</div>
      ) : !data || data.items.length === 0 ? (
        <Empty onCreate={() => setCreating(true)} />
      ) : (
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {data.items.map((i) => {
            const project = i.projectId
              ? projectMap.get(i.projectId)
              : undefined;
            const author = i.authorId
              ? userMap.get(i.authorId)
              : undefined;
            const assignee = i.assigneeId
              ? userMap.get(i.assigneeId)
              : undefined;
            const labels = (i.labels ?? []).slice(0, 3);
            return (
              <Link
                key={i._id}
                href={`/issues/${i._id}`}
                className="flex items-center gap-3.5 px-[18px] py-3.5 border-b border-border last:border-b-0 cursor-pointer transition-colors duration-[var(--dur)] hover:bg-bg-hover"
              >
                <IssueTypeIcon type={i.type} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text mb-[3px] truncate">
                    {i.title}
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-text-muted">
                    <span className="font-mono font-medium">
                      #{i._id.slice(-4)}
                    </span>
                    {project && (
                      <>
                        <Sep />
                        {project.name}
                      </>
                    )}
                    <Sep />
                    opened {relTime(i.createdAt)} by {author?.name ?? '?'}
                    {labels.length > 0 && (
                      <>
                        <Sep />
                        {labels.map((l) => (
                          <Label key={l}>{l}</Label>
                        ))}
                      </>
                    )}
                    {i.dueDate && (
                      <>
                        <Sep />
                        Due {fmtDateShort(i.dueDate)}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusPill status={i.status} />
                  <PriorityPill priority={i.priority} />
                  {assignee && <Avatar name={assignee.name} src={assignee.avatar} size="sm" />}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <IssueModal
        open={creating || !!editing}
        issue={editing}
        defaultProjectId={projectId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          if (params.get('new') === '1') router.replace('/issues');
        }}
      />
    </>
  );
}

const Sep = () => <span className="opacity-40">·</span>;

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16 bg-bg-card border border-border rounded-lg">
      <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)]">
        <AlertCircle className="w-7 h-7 text-accent" />
      </div>
      <h3 className="text-[16px] font-semibold">No tasks found</h3>
      <p className="text-[13px] text-text-muted max-w-[340px]">
        Try adjusting your filters or create a new one.
      </p>
      <Button variant="grad" onClick={onCreate}>
        <Plus className="w-3.5 h-3.5" /> New task
      </Button>
    </div>
  );
}
