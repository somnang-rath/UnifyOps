'use client';
import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Inbox, Pencil, Plus } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton, Switch } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Confirm } from '@/components/ui/confirm';
import { PublicLinkRow } from '@/components/feature/publish/public-link-row';
import {
  useIntakeForms,
  useIntakeMutations,
  useIntakeSubmissions,
  type IntakeForm,
  type IntakeStatus,
  type IntakeSubmission,
  type TriageBody,
} from '@/hooks/use-intake';
import { useProject, useProjectsInWorkspace } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { FormModal } from './_components/form-modal';
import { SubmissionCard } from './_components/submission-card';
import { TriageModal } from './_components/triage-modal';

// Public Space origin — the intake form lives there (ADR 0002 §6).
const SPACE_URL = process.env.NEXT_PUBLIC_SPACE_URL ?? '';

const TABS: { key: IntakeStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'all', label: 'All' },
];

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-[var(--ctl-sm)] w-44 rounded-lg" />
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[240px_1fr]">
        <div className="h-[220px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" />
        <div className="h-[420px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" />
      </div>
    </div>
  );
}

export default function IntakePage() {
  const router = useRouter();
  const params = useSearchParams();
  // URL over store, exactly as every other Tier W route (ADR 0011).
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const { data: workspace } = useWorkspaceBySlug(slug ?? null);
  const { data: projects } = useProjectsInWorkspace(workspace?.id ?? null);

  // A project id that isn't in this workspace's list falls back to the first
  // project — the same self-healing the analytics screen does after a switch.
  const rawProject = params.get('project') ?? '';
  const projectId =
    projects && projects.length
      ? projects.some((p) => p._id === rawProject)
        ? rawProject
        : projects[0]._id
      : '';

  const {
    data: forms,
    isError: formsError,
    isLoading: formsLoading,
    refetch: refetchForms,
  } = useIntakeForms(projectId || null);

  const rawForm = params.get('form') ?? '';
  const form: IntakeForm | null =
    forms && forms.length
      ? (forms.find((f) => f._id === rawForm) ?? forms[0])
      : null;

  const {
    data: submissions,
    isError: subsError,
    isFetching: subsFetching,
    refetch: refetchSubs,
  } = useIntakeSubmissions(form?._id ?? null);

  const rawStatus = params.get('status') ?? '';
  const status = (TABS.find((t) => t.key === rawStatus)?.key ??
    'pending') as IntakeStatus | 'all';

  const { createForm, updateForm, triage, suggest } =
    useIntakeMutations(projectId || null);

  // Only project members may own a work item, so the assignee picker is the
  // project's roster — not the whole directory.
  const { data: project } = useProject(projectId || null);
  const { data: users = [] } = useUsers();
  const assignables = useMemo(() => {
    if (!project) return [];
    const ids = new Set([project.ownerId, ...(project.members ?? [])]);
    return users
      .filter((u) => !!u._id && ids.has(u._id))
      .map((u) => ({ id: u._id as string, name: u.name }));
  }, [project, users]);
  const nameOf = (id: string | null) =>
    (id && assignables.find((a) => a.id === id)?.name) || undefined;

  const [editingForm, setEditingForm] = useState<IntakeForm | null | undefined>(
    undefined,
  );
  const [triaging, setTriaging] = useState<IntakeSubmission | null>(null);
  const [declining, setDeclining] = useState<IntakeSubmission | null>(null);

  const setParam = (key: 'project' | 'form' | 'status', value: string) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    // Changing project invalidates the selected form; changing the form
    // shouldn't reset the status tab.
    if (key === 'project') next.delete('form');
    const base = `/${slug}/intake`;
    router.replace(next.size ? `${base}?${next}` : base, { scroll: false });
  };

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, declined: 0, all: 0 };
    for (const s of submissions ?? []) {
      c[s.status] += 1;
      c.all += 1;
    }
    return c;
  }, [submissions]);

  const visible = (submissions ?? []).filter(
    (s) => status === 'all' || s.status === status,
  );

  const busy = triage.isPending || suggest.isPending;
  const publicUrl =
    form?.anchor && SPACE_URL ? `${SPACE_URL}/spaces/intake/${form.anchor}` : '';

  const doTriage = (sub: IntakeSubmission, body: TriageBody) => {
    triage.mutate(
      { id: sub._id, formId: sub.formId, body },
      { onSuccess: () => setTriaging(null) },
    );
  };

  if (!projects) return <PageSkeleton />;

  if (!projects.length) {
    return (
      <EmptyState
        icon={<Inbox />}
        label="No projects in this workspace yet"
        hint="Intake forms collect requests into a project, so create one first."
        action={
          <Button size="sm" onClick={() => router.push(`/${slug}/projects`)}>
            Go to projects
          </Button>
        }
        className="py-20 bg-bg-card border border-border rounded-xl"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h1 className="text-[20px] font-bold tracking-[-.02em]">Intake</h1>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            Requests from outside {workspace?.name ?? 'your workspace'}, waiting
            to become work items
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={projectId}
            onValueChange={(v) => setParam('project', v)}
            options={projects.map((p) => ({ value: p._id, label: p.name }))}
            size="sm"
            className="w-full sm:w-44"
            aria-label="Project"
          />
          <Button size="sm" variant="primary" onClick={() => setEditingForm(null)}>
            <Plus className="w-3.5 h-3.5" /> New form
          </Button>
        </div>
      </div>

      {formsError ? (
        <ErrorState
          message="Couldn't load this project's intake forms."
          onRetry={() => refetchForms()}
          className="py-20 bg-bg-card border border-border rounded-xl"
        />
      ) : formsLoading ? (
        <PageSkeleton />
      ) : !forms?.length ? (
        <EmptyState
          icon={<Inbox />}
          label="No intake form here yet"
          hint="An intake form gives people without an account a way to file a request into this project."
          action={
            <Button size="sm" variant="primary" onClick={() => setEditingForm(null)}>
              <Plus className="w-3.5 h-3.5" /> New form
            </Button>
          }
          className="py-20 bg-bg-card border border-border rounded-xl"
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[240px_1fr] items-start">
          {/* Forms rail */}
          <nav
            aria-label="Intake forms"
            className="bg-bg-card border border-border rounded-xl p-1.5 flex flex-col gap-0.5"
          >
            {forms.map((f) => (
              <button
                key={f._id}
                type="button"
                onClick={() => setParam('form', f._id)}
                aria-current={f._id === form?._id ? 'true' : undefined}
                className={cn(
                  'text-left px-2.5 py-2 rounded-lg transition-colors',
                  f._id === form?._id
                    ? 'bg-bg-hover text-text'
                    : 'text-text-sub hover:bg-bg-hover',
                )}
              >
                <span className="block text-[13px] font-medium truncate">
                  {f.title}
                </span>
                <span className="block text-[11px] text-text-muted mt-0.5">
                  {f.isOpen ? (f.anchor ? 'Open' : 'Open · unpublished') : 'Closed'}
                </span>
              </button>
            ))}
          </nav>

          {/* Queue */}
          <div className="flex flex-col gap-3 min-w-0">
            {form && (
              <div className="bg-bg-card border border-border rounded-xl px-4 py-3.5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold">{form.title}</h2>
                    {form.description && (
                      <p className="text-[12px] text-text-muted mt-0.5">
                        {form.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-2 text-[12px] text-text-sub">
                      Accepting
                      <Switch
                        checked={form.isOpen}
                        onCheckedChange={(v) =>
                          updateForm.mutate({ id: form._id, body: { isOpen: v } })
                        }
                        disabled={updateForm.isPending}
                        aria-label="Accepting submissions"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingForm(form)}
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </div>
                </div>

                {form.anchor ? (
                  publicUrl ? (
                    <PublicLinkRow url={publicUrl} />
                  ) : (
                    <p className="text-[12px] text-text-muted">
                      Published as <code>{form.anchor}</code> — set{' '}
                      <code>NEXT_PUBLIC_SPACE_URL</code> to show the shareable
                      link.
                    </p>
                  )
                ) : (
                  <p className="text-[12px] text-text-muted">
                    Not published — give this form a public link in Edit to let
                    people outside the workspace submit to it.
                  </p>
                )}
              </div>
            )}

            {/* Status tabs */}
            <div className="flex items-center gap-1" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={status === t.key}
                  onClick={() => setParam('status', t.key === 'pending' ? '' : t.key)}
                  className={cn(
                    'px-2.5 h-ctl-sm rounded-lg text-xs font-medium transition-colors',
                    status === t.key
                      ? 'bg-bg-hover text-text'
                      : 'text-text-muted hover:text-text hover:bg-bg-hover',
                  )}
                >
                  {t.label}
                  <span className="ml-1.5 text-text-muted">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            {subsError ? (
              <ErrorState
                message="Couldn't load this queue."
                onRetry={() => refetchSubs()}
                className="py-16 bg-bg-card border border-border rounded-xl"
              />
            ) : !visible.length ? (
              <EmptyState
                icon={<Inbox />}
                label={
                  status === 'pending'
                    ? 'Nothing waiting'
                    : `No ${status === 'all' ? '' : status} submissions`
                }
                hint={
                  status === 'pending'
                    ? 'New requests land here the moment someone submits the public form.'
                    : undefined
                }
                className="py-16 bg-bg-card border border-border rounded-xl"
              />
            ) : (
              <div
                className={cn(
                  'flex flex-col gap-2.5 transition-opacity',
                  subsFetching && 'opacity-60',
                )}
              >
                {visible.map((s) => (
                  <SubmissionCard
                    key={s._id}
                    sub={s}
                    assigneeName={nameOf(s.suggestion?.assigneeId ?? null)}
                    workspaceSlug={slug}
                    busy={busy}
                    // Bare accept: the API applies the stored suggestion, so
                    // this is the one-click path for a proposal already read
                    // on the card.
                    onAccept={() => doTriage(s, { action: 'accept' })}
                    onEdit={() => setTriaging(s)}
                    onDecline={() => setDeclining(s)}
                    onSuggest={() =>
                      suggest.mutate({ id: s._id, formId: s.formId })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <FormModal
        open={editingForm !== undefined}
        form={editingForm}
        saving={createForm.isPending || updateForm.isPending}
        onClose={() => setEditingForm(undefined)}
        onSubmit={(body) => {
          const done = { onSuccess: () => setEditingForm(undefined) };
          if (editingForm) {
            updateForm.mutate({ id: editingForm._id, body }, done);
          } else {
            createForm.mutate(body, done);
          }
        }}
      />

      <TriageModal
        open={!!triaging}
        submission={triaging}
        assignables={assignables}
        saving={triage.isPending}
        onClose={() => setTriaging(null)}
        onAccept={(body) => triaging && doTriage(triaging, body)}
      />

      <Confirm
        open={!!declining}
        title="Decline request"
        body="Decline this request? It stays in the queue as declined, and no work item is created."
        // Not `danger`: that variant labels its button "Delete", and declining
        // deletes nothing — the submission stays, it just never becomes work.
        onConfirm={() => {
          if (declining) doTriage(declining, { action: 'decline' });
          setDeclining(null);
        }}
        onClose={() => setDeclining(null)}
      />
    </div>
  );
}
