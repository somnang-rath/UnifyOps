'use client';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, RefreshCcw } from 'lucide-react';
import { EmptyState } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { SkeletonText } from '@/components/ui/skeleton';
import { AddItemsModal } from '@/components/feature/planning/add-items-modal';
import { CycleCard } from './_components/cycle-card';
import { CycleModal } from './_components/cycle-modal';
import { useProject } from '@/hooks/use-projects';
import { useWorkspaceHref } from '@/hooks/use-workspaces';
import {
  useCycleMutations,
  useCycles,
  type Cycle,
  type CycleStatus,
} from '@/hooks/use-cycles';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Section order is deliberate: what the team is doing now, then what's next,
 * then unscheduled ideas, and history last — `completed` only ever grows, so
 * anywhere else it would push the live cycle off-screen as the project ages.
 */
const SECTIONS: { status: CycleStatus; label: string }[] = [
  { status: 'current', label: 'Active' },
  { status: 'upcoming', label: 'Upcoming' },
  { status: 'draft', label: 'Drafts' },
  { status: 'completed', label: 'Completed' },
];

export default function ProjectCyclesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const ws = useWorkspaceHref();
  const me = useAuthStore((s) => s.user);
  const { data: project } = useProject(projectId);
  const { data: cycles = [], isLoading } = useCycles({ projectId });
  const { create, update, remove, assign, unassign } =
    useCycleMutations(projectId);

  const [editing, setEditing] = useState<Cycle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Cycle | null>(null);
  const [addingTo, setAddingTo] = useState<Cycle | null>(null);

  // Same gate as project settings: owner or member. The API enforces it too —
  // this only decides whether the affordance is shown.
  const myId = me?._id ?? me?.id;
  const canWrite = !!(
    myId &&
    project &&
    (project.ownerId === myId || project.members.includes(myId))
  );

  const grouped = useMemo(() => {
    const by = new Map<CycleStatus, Cycle[]>();
    for (const c of cycles) {
      const list = by.get(c.status) ?? [];
      list.push(c);
      by.set(c.status, list);
    }
    return by;
  }, [cycles]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[12.5px] text-text-muted">
          Time-boxed sprints. A project runs one scheduled cycle at a time.
        </p>
        {canWrite && cycles.length > 0 && (
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            New cycle
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonText lines={6} />
      ) : cycles.length === 0 ? (
        <EmptyState
          icon={<RefreshCcw />}
          label="No cycles yet"
          hint="Create a cycle to time-box a set of work items and track progress against a start and end date."
          action={
            canWrite ? (
              <Button size="sm" variant="primary" onClick={openCreate}>
                <Plus className="w-3.5 h-3.5" />
                New cycle
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {SECTIONS.map(({ status, label }) => {
            const list = grouped.get(status) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={status}>
                <h2 className="text-[11px] uppercase tracking-wide font-semibold text-text-muted mb-2">
                  {label}
                  <span className="ml-1.5 font-normal">{list.length}</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {list.map((cycle) => (
                    <CycleCard
                      key={cycle._id}
                      cycle={cycle}
                      canWrite={canWrite}
                      hrefFor={(issueId) => ws(`/issues/${issueId}`)}
                      onEdit={() => {
                        setEditing(cycle);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeleting(cycle)}
                      onAddItems={() => setAddingTo(cycle)}
                      onRemoveItem={(issueId) =>
                        unassign.mutate({ id: cycle._id, issueId })
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <CycleModal
        open={formOpen}
        cycle={editing}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSave={(body) => {
          const done = editing
            ? update.mutateAsync({ id: editing._id, body })
            : create.mutateAsync(body);
          // Close only on success: a date-overlap rejection must leave the form
          // up with what the user typed, not discard it behind a toast.
          done.then(() => setFormOpen(false)).catch(() => {});
        }}
      />

      {addingTo && (
        <AddItemsModal
          open
          projectId={projectId}
          targetName={addingTo.name}
          backlogFilter={{ cycleId: 'none' }}
          saving={assign.isPending}
          onClose={() => setAddingTo(null)}
          onAdd={(issueIds) =>
            assign
              .mutateAsync({ id: addingTo._id, issueIds })
              .then(() => setAddingTo(null))
              .catch(() => {})
          }
        />
      )}

      <Confirm
        open={!!deleting}
        danger
        title="Delete cycle?"
        body={
          <>
            <strong>{deleting?.name}</strong> will be deleted. Its work items
            are not deleted — they return to the unscheduled backlog.
          </>
        }
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />
    </div>
  );
}
