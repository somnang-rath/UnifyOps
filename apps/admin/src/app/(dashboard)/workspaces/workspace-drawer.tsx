'use client';
import { useEffect, useState } from 'react';
import { Button, Skeleton, ErrorState } from '@prism/ui';
import { X, Plus, Minus, UserPlus } from 'lucide-react';
import {
  useWorkspaceDetail,
  useAvailableProjects,
  useUpdateWorkspace,
  useAddMember,
  useRemoveMember,
  useAssignProject,
  useUnassignProject,
} from '@/hooks/useInstance';
import { inputCls } from '@/components/ui';

/** Mirrors the API's SLUG regex in apps/api workspaces/dto/workspace.dto.ts. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function WorkspaceDrawer({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useWorkspaceDetail(workspaceId);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface shadow-card">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">
            {data ? data.name : 'Workspace'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-6 p-5">
          {isLoading ? (
            <Skeleton rows={6} />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : (
            <>
              <EditSection
                id={data.id}
                name={data.name}
                slug={data.slug}
                color={data.color}
              />
              <MembersSection id={data.id} members={data.members} />
              <ProjectsSection id={data.id} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function EditSection({
  id,
  name,
  slug,
  color,
}: {
  id: string;
  name: string;
  slug: string;
  color: string;
}) {
  const update = useUpdateWorkspace();
  const [form, setForm] = useState({ name, slug, color });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({ name, slug, color });
  }, [name, slug, color]);

  const dirty =
    form.name !== name || form.slug !== slug || form.color !== color;

  // Mirrors the API's SLUG regex (workspaces/dto/workspace.dto.ts) so a bad slug
  // is caught here instead of coming back as a server 400.
  const slugErr = !form.slug.trim()
    ? 'Slug is required'
    : !SLUG_RE.test(form.slug)
      ? 'Lowercase letters, numbers and single hyphens only'
      : null;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (slugErr) return;
    setErr(null);
    setSaved(false);
    try {
      await update.mutateAsync({ id, patch: form });
      setSaved(true);
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Could not save');
    }
  }

  return (
    <Section title="Details">
      <form onSubmit={onSave} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">Slug</span>
          <input
            value={form.slug}
            onChange={(e) =>
              setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))
            }
            className={`${inputCls} font-mono`}
            aria-invalid={!!slugErr}
            aria-describedby="slug-help"
          />
          <span id="slug-help" className="block text-[11px]">
            {slugErr ? (
              <span className="text-red-600 dark:text-red-400">{slugErr}</span>
            ) : (
              <span className="text-fg-muted">
                Identifies the workspace in URLs — renaming it breaks existing
                links.
              </span>
            )}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
            className="h-9 w-12 cursor-pointer rounded border border-line bg-surface"
          />
          <span className="text-xs text-fg-muted">Accent color</span>
        </label>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={!dirty || !!slugErr || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Saved
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function MembersSection({
  id,
  members,
}: {
  id: string;
  members: { id: string; name?: string; email?: string }[];
}) {
  const add = useAddMember();
  const remove = useRemoveMember();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await add.mutateAsync({ id, email: email.trim() });
      setEmail('');
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Could not add member');
    }
  }

  return (
    <Section title={`Members · ${members.length}`}>
      <ul className="space-y-1">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-fg">
              {m.name ?? m.email}
              {m.name && (
                <span className="ml-2 text-xs text-fg-subtle">{m.email}</span>
              )}
            </span>
            <button
              onClick={() => remove.mutate({ id, userId: m.id })}
              disabled={remove.isPending}
              title="Remove member"
              className="rounded p-1 text-fg-subtle hover:text-red-600 dark:hover:text-red-400"
            >
              <Minus size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={onAdd} className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add member by email"
          className={inputCls}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!email.trim() || add.isPending}
        >
          <UserPlus size={14} />
        </Button>
      </form>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </Section>
  );
}

function ProjectsSection({ id }: { id: string }) {
  const { data, isLoading } = useAvailableProjects(id);
  const assign = useAssignProject();
  const unassign = useUnassignProject();

  if (isLoading) return <Skeleton rows={3} />;
  const projects = data ?? [];
  const inWs = projects.filter((p) => p.assigned);
  const available = projects.filter((p) => !p.assigned);

  return (
    <Section title={`Projects · ${inWs.length}`}>
      <ul className="space-y-1">
        {inWs.length === 0 && (
          <li className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-subtle">
            No projects in this workspace yet.
          </li>
        )}
        {inWs.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
          >
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
            <button
              onClick={() => unassign.mutate({ id, projectId: p.id })}
              disabled={unassign.isPending}
              title="Remove from workspace"
              className="rounded p-1 text-fg-subtle hover:text-red-600 dark:hover:text-red-400"
            >
              <Minus size={14} />
            </button>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <>
          <p className="pt-1 text-[11px] font-medium text-fg-subtle">
            Unassigned — click to add
          </p>
          <ul className="space-y-1">
            {available.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm"
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {p.name}
                </span>
                <button
                  onClick={() => assign.mutate({ id, projectId: p.id })}
                  disabled={assign.isPending}
                  title="Add to workspace"
                  className="rounded p-1 text-fg-subtle hover:text-brand"
                >
                  <Plus size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
