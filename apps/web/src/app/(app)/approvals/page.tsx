'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, GitMerge, Plus, Search, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/use-debounce';
import { useMRMutations, useMRs } from '@/hooks/use-mrs';
import { useProjects } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { fmtDate, relTime } from '@/lib/format';
import { BranchChip } from '@/components/feature/mr/branch-chip';
import { MRStatusPill } from '@/components/feature/issue/pills';
import { MRFormSchema, type MergeRequest, type MRFormInput } from '@/schemas/mr';

type Tab = 'open' | 'merged' | 'closed';

const ICO = {
  open: 'bg-[rgba(16,185,129,.12)] text-green',
  merged: 'bg-[rgba(139,92,246,.12)] text-violet',
  closed: 'bg-[rgba(239,68,68,.12)] text-red',
} as const;

export default function ApprovalsPage() {
  const router = useRouter();
  const params = useSearchParams();

  const me = useAuthStore((s) => s.user);
  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();

  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 220);
  const [projectId, setProjectId] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [detail, setDetail] = useState<MergeRequest | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') setCreating(true);
  }, [params]);

  const { data, isLoading } = useMRs({
    status: tab,
    projectId: projectId || undefined,
    q: debouncedQ || undefined,
  });
  const { approve, reject } = useMRMutations();

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
            Approvals
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Review and approve changes
          </p>
        </div>
        <Button variant="grad" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> New approval
        </Button>
      </div>

      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'open', label: 'Open', count: data?.totals.open },
            { value: 'merged', label: 'Merged', count: data?.totals.merged },
            { value: 'closed', label: 'Closed', count: data?.totals.closed },
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
      </div>

      {isLoading && !data ? (
        <div className="text-text-muted text-[13px]">Loading…</div>
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-3 py-16 bg-bg-card border border-border rounded-lg">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)]">
            <GitMerge className="w-7 h-7 text-accent" />
          </div>
          <h3 className="text-[16px] font-semibold">No approvals</h3>
          <p className="text-[13px] text-text-muted max-w-[340px]">
            Submit a change for review to get started.
          </p>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {data.items.map((mr) => {
            const project = mr.projectId
              ? projectMap.get(mr.projectId)
              : undefined;
            const author = mr.authorId
              ? userMap.get(mr.authorId)
              : undefined;
            const reviewer = mr.reviewerId
              ? userMap.get(mr.reviewerId)
              : undefined;
            const canDecide =
              mr.status === 'open' &&
              (!mr.reviewerId || mr.reviewerId === me?.id);
            return (
              <div
                key={mr._id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(mr)}
                className="flex items-center gap-3.5 px-[18px] py-3.5 border-b border-border last:border-b-0 cursor-pointer transition-colors duration-[var(--dur)] hover:bg-bg-hover"
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
                    ICO[mr.status],
                  )}
                >
                  <GitMerge className="w-[15px] h-[15px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text mb-[3px] truncate">
                    {mr.title}
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-text-muted">
                    <span className="font-mono font-medium">
                      #{mr._id.slice(-4)}
                    </span>
                    {project && (
                      <>
                        <Sep />
                        {project.name}
                      </>
                    )}
                    <Sep />
                    <BranchChip name={mr.sourceBranch} />
                    <span>→</span>
                    <BranchChip name={mr.targetBranch} target />
                    <Sep />
                    by {author?.name ?? '?'}
                    <Sep />
                    {relTime(mr.createdAt)}
                  </div>
                </div>
                <div
                  className="flex items-center gap-2 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canDecide ? (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => approve.mutate(mr._id)}
                      >
                        <Check className="w-3 h-3" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => reject.mutate(mr._id)}
                      >
                        <X className="w-3 h-3" /> Decline
                      </Button>
                    </>
                  ) : (
                    <MRStatusPill status={mr.status} />
                  )}
                  {reviewer && (
                    <Avatar name={reviewer.name} src={reviewer.avatar} size="sm" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateMRModal
        open={creating}
        onClose={() => {
          setCreating(false);
          if (params.get('new') === '1') router.replace('/approvals');
        }}
      />

      <DetailMRModal mr={detail} onClose={() => setDetail(null)} />
    </>
  );
}

const Sep = () => <span className="opacity-40">·</span>;

function CreateMRModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();
  const { create } = useMRMutations();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MRFormInput>({
    resolver: zodResolver(MRFormSchema),
    defaultValues: {
      title: '',
      desc: '',
      sourceBranch: '',
      targetBranch: 'main',
      projectId: '',
      reviewerId: '',
    },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    await create.mutateAsync({
      title: v.title,
      desc: v.desc ?? '',
      sourceBranch: v.sourceBranch,
      targetBranch: v.targetBranch || 'main',
      projectId: v.projectId || null,
      reviewerId: v.reviewerId || null,
    });
    onClose();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New approval"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="grad"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            Submit for review
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Title" required error={errors.title?.message}>
          <Input
            autoFocus
            placeholder="Add OAuth provider"
            {...register('title')}
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={4}
            placeholder="What's being approved?"
            {...register('desc')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Reference"
            required
            error={errors.sourceBranch?.message}
            hint="(branch / commit / link)"
          >
            <Input
              placeholder="feature/oauth"
              {...register('sourceBranch')}
            />
          </Field>
          <Field label="Target branch">
            <Input placeholder="main" {...register('targetBranch')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project">
            <Select
              value={watch('projectId') ?? ''}
              onValueChange={(v) =>
                setValue('projectId', v, { shouldDirty: true })
              }
              options={[
                { value: '', label: 'None' },
                ...projects.map((p) => ({
                  value: p._id,
                  label: p.name,
                })),
              ]}
            />
          </Field>
          <Field label="Reviewer">
            <Select
              value={watch('reviewerId') ?? ''}
              onValueChange={(v) =>
                setValue('reviewerId', v, { shouldDirty: true })
              }
              options={[
                { value: '', label: 'None' },
                ...users
                  .filter((u) => u._id !== me?.id)
                  .map((u) => ({ value: u._id, label: u.name })),
              ]}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function DetailMRModal({
  mr,
  onClose,
}: {
  mr: MergeRequest | null;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { approve, reject } = useMRMutations();

  if (!mr) return null;

  const author = users.find((u) => u._id === mr.authorId);
  const reviewer = users.find((u) => u._id === mr.reviewerId);
  const project = projects.find((p) => p._id === mr.projectId);
  const canDecide =
    mr.status === 'open' &&
    (!mr.reviewerId || mr.reviewerId === me?.id);

  return (
    <Modal
      open={!!mr}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(99,102,241,.12)] text-accent flex-shrink-0">
            <GitMerge className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="text-[18px] font-bold tracking-tight">
              {mr.title}
            </h2>
            <p className="text-[12px] text-text-muted font-mono mt-0.5">
              #{mr._id.slice(-4)}
            </p>
          </div>
        </div>
      }
      footer={
        canDecide ? (
          <>
            <Button
              variant="outline"
              onClick={() =>
                reject.mutate(mr._id, { onSuccess: onClose })
              }
            >
              Decline
            </Button>
            <Button
              variant="grad"
              onClick={() =>
                approve.mutate(mr._id, { onSuccess: onClose })
              }
            >
              <Check className="w-3.5 h-3.5" /> Approve
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="grid grid-cols-[1fr_240px] gap-5">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BranchChip name={mr.sourceBranch} />
            <span>→</span>
            <BranchChip name={mr.targetBranch} target />
          </div>
          <div className="text-[14px] leading-[1.6] text-text-sub bg-bg-subtle rounded-[10px] px-4 py-3.5 whitespace-pre-wrap">
            {mr.desc?.trim() || 'No description.'}
          </div>
        </div>

        <aside className="border-l border-border pl-5 flex flex-col">
          <Side label="Status">
            <MRStatusPill status={mr.status} />
          </Side>
          <Side label="Project">{project?.name ?? 'None'}</Side>
          <Side label="Author">
            {author ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={author.name} src={author.avatar} size="sm" />
                {author.name}
              </span>
            ) : (
              '?'
            )}
          </Side>
          <Side label="Reviewer">
            {reviewer ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={reviewer.name} src={reviewer.avatar} size="sm" />
                {reviewer.name}
              </span>
            ) : (
              <span className="text-text-muted">None</span>
            )}
          </Side>
          <Side label="Opened">{fmtDate(mr.createdAt)}</Side>
          {mr.decidedAt && (
            <Side label="Decided">{fmtDate(mr.decidedAt)}</Side>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function Side({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="flex flex-col gap-1.5 py-2.5 border-b border-border first:pt-0 last:pb-0 last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-[.06em] text-text-muted">
        {label}
      </span>
      <div className="text-[13px] text-text">{children}</div>
    </div>
  );
}
