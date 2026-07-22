'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Plus, Search } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { InputWithIcon } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { useIssues } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useDebounce } from '@/hooks/use-debounce';
import { IssueModal } from '@/components/feature/issue/issue-modal';
import { IssuePeek } from '@/components/feature/issue/issue-peek';
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
import { ViewsBar } from './_components/views-bar';
import type { SavedView } from '@/hooks/use-views';

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
const SORT_OPTS = [
  { value: 'created:desc', label: 'Newest' },
  { value: 'created:asc', label: 'Oldest' },
  { value: 'priority:desc', label: 'Priority' },
  { value: 'dueDate:asc', label: 'Due date' },
];
const GROUP_OPTS = [
  { value: '', label: 'No grouping' },
  { value: 'status', label: 'Group: status' },
  { value: 'priority', label: 'Group: priority' },
  { value: 'project', label: 'Group: project' },
  { value: 'assignee', label: 'Group: assignee' },
];
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export default function IssuesPage() {
  const router = useRouter();
  const params = useSearchParams();

  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 220);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [sortBy, setSortBy] = useState('created:desc');
  const [groupBy, setGroupBy] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Issue | null>(null);

  // Any manual filter change means we've drifted from the applied saved view.
  const touched =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setActiveViewId(null);
      set(v);
    };

  const applyView = (v: SavedView) => {
    const f = v.filters as {
      status?: string;
      type?: string;
      priority?: string;
      q?: string;
    };
    const t = f.status;
    setTab(t === 'open' || t === 'closed' || t === 'all' ? t : 'open');
    setType(f.type ?? '');
    setPriority(f.priority ?? '');
    setQ(f.q ?? '');
    setProjectId(v.projectId ?? '');
    setSortBy(v.sortBy || 'created:desc');
    setGroupBy(v.groupBy ?? '');
    setActiveViewId(v._id);
  };

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

  // Sort client-side — the list endpoint returns newest-first; the other
  // orders are presentation concerns layered on top.
  const sortedItems = useMemo(() => {
    const items = [...(data?.items ?? [])];
    switch (sortBy) {
      case 'created:asc':
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'priority:desc':
        items.sort(
          (a, b) =>
            (PRIORITY_ORDER[a.priority] ?? 9) -
            (PRIORITY_ORDER[b.priority] ?? 9),
        );
        break;
      case 'dueDate:asc':
        // Undated issues sink to the bottom.
        items.sort((a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
        );
        break;
      default:
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return items;
  }, [data?.items, sortBy]);

  // ── Issue Peek (?peek=<id>) — the list page owns the URL and the ordering;
  // IssuePeek owns rendering and mutations (docs/plan/specs/issue-peek.md §3).
  const peekId = params.get('peek');

  const closePeek = () => {
    // replace, not push — closing must not create a history entry, and it must
    // work identically for a pasted deep link (never router.back()).
    const next = new URLSearchParams(params);
    next.delete('peek');
    const qs = next.toString();
    router.replace(qs ? `/issues?${qs}` : '/issues', { scroll: false });
  };

  const navigatePeek = (id: string) => {
    // replace — stepping through ten issues must not require ten Backs.
    const next = new URLSearchParams(params);
    next.set('peek', id);
    router.replace(`/issues?${next.toString()}`, { scroll: false });
  };

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const label = (i: Issue): string => {
      switch (groupBy) {
        case 'status':
          return i.status;
        case 'priority':
          return i.priority;
        case 'project':
          return i.projectId
            ? (projectMap.get(i.projectId)?.name ?? 'Unknown project')
            : 'No project';
        case 'assignee':
          return i.assigneeId
            ? (userMap.get(i.assigneeId)?.name ?? 'Unknown')
            : 'Unassigned';
        default:
          return 'All';
      }
    };
    const m = new Map<string, Issue[]>();
    for (const i of sortedItems) {
      const k = label(i);
      const arr = m.get(k);
      if (arr) arr.push(i);
      else m.set(k, [i]);
    }
    const entries = [...m.entries()];
    if (groupBy === 'priority')
      entries.sort(
        ([a], [b]) => (PRIORITY_ORDER[a] ?? 9) - (PRIORITY_ORDER[b] ?? 9),
      );
    return entries;
  }, [groupBy, sortedItems, projectMap, userMap]);

  // Peek prev/next follow whatever sort/group the user currently sees.
  const { peekPrevId, peekNextId } = useMemo(() => {
    if (!peekId) return { peekPrevId: null, peekNextId: null };
    const flat = grouped ? grouped.flatMap(([, items]) => items) : sortedItems;
    const idx = flat.findIndex((i) => i._id === peekId);
    return {
      peekPrevId: idx > 0 ? flat[idx - 1]._id : null,
      peekNextId: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1]._id : null,
    };
  }, [peekId, grouped, sortedItems]);

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
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> New task
        </Button>
      </div>

      <ViewsBar
        snapshot={{ tab, projectId, type, priority, q, sortBy, groupBy }}
        activeViewId={activeViewId}
        onApply={applyView}
      />

      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <Tabs<Tab>
          value={tab}
          onChange={touched(setTab)}
          items={[
            { value: 'open', label: 'Open', count: data?.totals.open },
            { value: 'closed', label: 'Closed', count: data?.totals.closed },
            { value: 'all', label: 'All', count: data?.totals.all },
          ]}
        />
        <div className="flex-1" />

        <InputWithIcon
          icon={<Search />}
          value={q}
          onChange={(e) => touched(setQ)(e.target.value)}
          placeholder="Search…"
          aria-label="Search tasks"
          className="w-[220px]"
        />

        <Select
          inline
          value={projectId}
          onValueChange={touched(setProjectId)}
          options={[
            { value: '', label: 'All projects' },
            ...projects.map((p) => ({ value: p._id, label: p.name })),
          ]}
        />
        <Select
          inline
          value={type}
          onValueChange={touched(setType)}
          options={TYPE_OPTS}
        />
        <Select
          inline
          value={priority}
          onValueChange={touched(setPriority)}
          options={PRIO_OPTS}
        />
        <Select
          inline
          value={sortBy}
          onValueChange={touched(setSortBy)}
          options={SORT_OPTS}
          aria-label="Sort"
        />
        <Select
          inline
          value={groupBy}
          onValueChange={touched(setGroupBy)}
          options={GROUP_OPTS}
          aria-label="Group"
        />
      </div>

      {isLoading && !data ? (
        <div className="text-text-muted text-[13px]">Loading…</div>
      ) : !data || data.items.length === 0 ? (
        <Empty onCreate={() => setCreating(true)} />
      ) : grouped ? (
        <div className="flex flex-col gap-4">
          {grouped.map(([label, items]) => (
            <section key={label}>
              <h2 className="flex items-baseline gap-2 mb-1.5 px-0.5 text-[12px] font-semibold uppercase tracking-wide text-text-muted">
                {label}
                <span className="font-normal normal-case tracking-normal opacity-70">
                  {items.length}
                </span>
              </h2>
              <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
                {items.map((i) => renderRow(i))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {sortedItems.map((i) => renderRow(i))}
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

      {peekId && (
        <IssuePeek
          issueId={peekId}
          onClose={closePeek}
          onNavigate={navigatePeek}
          prevId={peekPrevId}
          nextId={peekNextId}
        />
      )}
    </>
  );

  function renderRow(i: Issue) {
    const project = i.projectId ? projectMap.get(i.projectId) : undefined;
    const author = i.authorId ? userMap.get(i.authorId) : undefined;
    const assignee = i.assigneeId ? userMap.get(i.assigneeId) : undefined;
    const labels = (i.labels ?? []).slice(0, 3);
    return (
              <Link
                key={i._id}
                href={`/issues/${i._id}`}
                // Plain left click opens the peek; modified clicks and
                // middle-click keep the real link behavior (spec §3.1).
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
                    return;
                  e.preventDefault();
                  const next = new URLSearchParams(params);
                  next.set('peek', i._id);
                  // push → browser Back closes the peek
                  router.push(`/issues?${next.toString()}`, { scroll: false });
                }}
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
  }
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
      <Button variant="primary" onClick={onCreate}>
        <Plus className="w-3.5 h-3.5" /> New task
      </Button>
    </div>
  );
}
