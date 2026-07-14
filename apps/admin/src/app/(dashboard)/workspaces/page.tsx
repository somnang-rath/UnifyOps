'use client';
import { useMemo, useState } from 'react';
import { Button, Skeleton, ErrorState, EmptyState } from '@prism/ui';
import { Trash2, Users, Grid3x3, Search } from 'lucide-react';
import {
  useWorkspaces,
  useCreateWorkspace,
  useDeleteWorkspace,
  type WorkspaceRow,
} from '@/hooks/useInstance';
import { PageHeader, Card, inputCls } from '@/components/ui';
import { WorkspaceDrawer } from './workspace-drawer';

export default function WorkspacesPage() {
  const { data, isLoading, isError, refetch } = useWorkspaces();
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (w) =>
        w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q),
    );
  }, [data, query]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim() });
      setName('');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not create workspace');
    }
  }

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Every workspace on this instance. Create, edit, manage members and projects."
      />

      <div className="space-y-6">
        <Card>
          <form onSubmit={onCreate} className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="text-sm font-medium text-fg-muted">
                New workspace name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Marketing"
                className={inputCls}
              />
            </label>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </Card>

        {isLoading ? (
          <Card>
            <Skeleton rows={4} />
          </Card>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <Card>
            <EmptyState label="No workspaces yet. Create the first one above." />
          </Card>
        ) : (
          <Card>
            <div className="relative mb-2">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workspaces…"
                className={`${inputCls} pl-9`}
              />
            </div>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-subtle">
                No workspaces match “{query}”.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((w) => (
                  <WorkspaceItem
                    key={w.id}
                    w={w}
                    onOpen={() => setOpenId(w.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {openId && (
        <WorkspaceDrawer workspaceId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

function WorkspaceItem({
  w,
  onOpen,
}: {
  w: WorkspaceRow;
  onOpen: () => void;
}) {
  const del = useDeleteWorkspace();
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex items-center gap-3 py-3">
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="h-8 w-8 flex-shrink-0 rounded-lg"
          style={{ backgroundColor: w.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-fg group-hover:text-brand">
              {w.name}
            </span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
              {w.slug}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-fg-subtle">
            <span>{w.owner?.name ?? w.owner?.email ?? 'Unknown owner'}</span>
            <span className="inline-flex items-center gap-1">
              <Users size={12} />
              {w.memberCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Grid3x3 size={12} />
              {w.projectCount}
            </span>
            <span>{new Date(w.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </button>

      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => del.mutate(w.id)}
            disabled={del.isPending}
            className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {del.isPending ? 'Deleting…' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          title="Delete workspace"
          className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 size={16} />
        </button>
      )}
    </li>
  );
}
