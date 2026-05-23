'use client';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Check,
  CircleDot,
  Globe,
  Grid3x3,
  Home,
  LayoutGrid,
  Layers,
  Lock,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Confirm } from '@/components/ui/confirm';
import { Avatar } from '@/components/ui/avatar';
import {
  useProjectMutations,
  useProjects,
} from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Project } from '@/schemas/project';
import { ProjectModal } from '@/components/feature/project/project-modal';

type SortKey = 'updated' | 'name' | 'issues';
type ViewMode = 'grid' | 'list';

const VIS_ICO = { private: Lock, internal: Home, public: Globe } as const;
const VIS_CLS = {
  private: 'bg-[rgba(239,68,68,.1)] text-red',
  internal: 'bg-[rgba(245,158,11,.1)] text-amber',
  public: 'bg-[rgba(16,185,129,.1)] text-green',
} as const;

export default function ProjectsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const wantNew = params.get('new') === '1';
  const me = useAuthStore((s) => s.user);

  const { data: projects = [], isLoading } = useProjects();
  const { data: users = [] } = useUsers();
  const { remove } = useProjectMutations();

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setViewRaw] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'grid';
    return (localStorage.getItem('projects-view') as ViewMode) ?? 'grid';
  });
  const setView = (v: ViewMode) => {
    setViewRaw(v);
    localStorage.setItem('projects-view', v);
  };
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(wantNew);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const userMap = useMemo(
    () =>
      new Map(
        users.map((u) => [
          u._id,
          { _id: u._id, name: u.name, email: u.email },
        ]),
      ),
    [users],
  );

  const list = useMemo(() => {
    const needle = q.toLowerCase();
    const filtered = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.desc ?? '').toLowerCase().includes(needle),
    );
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'issues')
        return (b.issueCount ?? 0) - (a.issueCount ?? 0);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [projects, q, sort]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Projects
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Manage your workspace projects
          </p>
        </div>
        <Button variant="grad" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> New project
        </Button>
      </div>

      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <div className="flex items-center gap-2 min-w-[220px] px-3 bg-bg-card border-[1.5px] border-border rounded-sm transition-[border-color,box-shadow] duration-[var(--dur)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]">
          <Search className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 border-0 bg-transparent py-2 text-[13px] outline-none placeholder:text-text-muted"
          />
        </div>

        <Select<SortKey>
          inline
          value={sort}
          onValueChange={setSort}
          options={[
            { value: 'updated', label: 'Recently updated' },
            { value: 'name', label: 'Alphabetical' },
            { value: 'issues', label: 'Most active' },
          ]}
        />

        <div className="inline-flex p-1 bg-bg-subtle border border-border rounded-sm">
          <SegBtn
            active={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </SegBtn>
          <SegBtn
            active={view === 'list'}
            onClick={() => setView('list')}
          >
            <Layers className="w-3.5 h-3.5" />
          </SegBtn>
        </div>
      </div>

      {isLoading ? (
        <div className="text-text-muted text-[13px]">Loading…</div>
      ) : list.length === 0 ? (
        q.trim() ? (
          <NoMatches onClear={() => setQ('')} />
        ) : (
          <Empty onCreate={() => setCreating(true)} />
        )
      ) : (
        <div
          className={cn(
            'grid gap-4',
            view === 'grid'
              ? 'grid-cols-[repeat(auto-fill,minmax(300px,1fr))]'
              : 'grid-cols-1',
          )}
        >
          {list.map((p) => {
            const VisIco = VIS_ICO[p.visibility];
            const pct = p.issueCount
              ? Math.round(((p.doneCount ?? 0) / p.issueCount) * 100)
              : 0;
            const canEdit = me?.id === p.ownerId || me?.role === 'admin';
            const members = p.members
              .map((id) => userMap.get(id))
              .filter(Boolean) as Array<{ _id: string; name: string; avatar?: string }>;
            return (
              <Link
                key={p._id}
                href={`/projects/${p._id}`}
                className={cn(
                  'group relative overflow-hidden bg-bg-card border border-border rounded-lg p-5 cursor-pointer',
                  'transition-all duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)]',
                  'hover:-translate-y-[3px] hover:shadow-lg hover:border-accent',
                  view === 'list' && 'flex items-center gap-5 py-4',
                )}
              >
                <span
                  className={
                    view === 'list'
                      ? 'absolute top-0 left-0 bottom-0 w-[3px] opacity-80'
                      : 'absolute top-0 left-0 right-0 h-[3px] opacity-80'
                  }
                  style={{ background: p.color }}
                />

                <div
                  className={cn(
                    'flex items-start justify-between gap-3',
                    view === 'grid' && 'mb-3',
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white font-bold text-[16px] flex-shrink-0 shadow-[0_4px_12px_rgba(99,102,241,.25)]"
                      style={{ background: p.color }}
                    >
                      {initials(p.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold mb-0.5 truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-text-muted font-mono truncate">
                        {p.namespace}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <div
                      className="flex gap-0.5"
                      onClick={(e) => e.preventDefault()}
                    >
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(p);
                        }}
                        className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleting(p);
                        }}
                        className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-red"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p
                  className={cn(
                    'text-[13px] text-text-sub leading-[1.5] overflow-hidden',
                    view === 'list'
                      ? 'flex-1 line-clamp-1 m-0'
                      : 'mb-3.5 line-clamp-2',
                  )}
                >
                  {p.desc || 'No description'}
                </p>

                {view === 'grid' && (
                  <>
                    <div className="h-[3px] bg-border rounded-[2px] overflow-hidden mb-3">
                      <div
                        className="h-full rounded-[2px] transition-[width] duration-[600ms] ease-[cubic-bezier(.16,1,.3,1)]"
                        style={{
                          width: `${pct}%`,
                          background: p.color,
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap pt-3 border-t border-border text-[12px] text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <CircleDot className="w-3 h-3" />
                        {p.issueCount ?? 0}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        {pct}%
                      </span>
                      <span className="flex items-center ml-auto">
                        {members.slice(0, 4).map((u) => (
                          <Avatar
                            key={u._id}
                            name={u.name}
                            src={u.avatar}
                            size="sm"
                            className="border-2 border-bg-card -ml-2 first:ml-0"
                          />
                        ))}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize',
                          VIS_CLS[p.visibility],
                        )}
                      >
                        <VisIco className="w-2.5 h-2.5" />{' '}
                        {p.visibility}
                      </span>
                    </div>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <ProjectModal
        open={creating || !!editing}
        project={editing}
        memberEmails={
          editing
            ? (editing.members
                .map((id) => userMap.get(id)?.email)
                .filter(Boolean) as string[])
            : []
        }
        onClose={() => {
          setCreating(false);
          setEditing(null);
          if (wantNew) router.replace('/projects');
        }}
      />

      <Confirm
        open={!!deleting}
        title="Delete project"
        body={
          <>
            This will permanently delete{' '}
            <strong>{deleting?.name}</strong> and all of its issues.
          </>
        }
        danger
        onConfirm={() => deleting && remove.mutate(deleting._id)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function SegBtn({
  active,
  children,
  onClick,
}: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'p-1.5 rounded-[4px] text-text-muted transition-all duration-[var(--dur)]',
        'hover:text-text',
        active && 'bg-bg text-text shadow-sm',
      )}
    >
      {children}
    </button>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16">
      <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)]">
        <Grid3x3 className="w-7 h-7 text-accent" />
      </div>
      <h3 className="text-[16px] font-semibold">No projects yet</h3>
      <p className="text-[13px] text-text-muted max-w-[340px]">
        Start your first project to organize your work.
      </p>
      <Button variant="grad" onClick={onCreate}>
        <Plus className="w-3.5 h-3.5" /> Create project
      </Button>
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16">
      <div className="w-14 h-14 rounded-full flex items-center justify-center bg-bg-subtle border border-border">
        <SearchX className="w-7 h-7 text-text-muted" />
      </div>
      <h3 className="text-[16px] font-semibold">No projects match your search</h3>
      <p className="text-[13px] text-text-muted max-w-[340px]">
        Try a different keyword, or clear the filter.
      </p>
      <Button variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}
