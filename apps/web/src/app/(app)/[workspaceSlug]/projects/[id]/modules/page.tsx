'use client';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Layers, Plus } from 'lucide-react';
import { EmptyState } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { SkeletonText } from '@/components/ui/skeleton';
import { AddItemsModal } from '@/components/feature/planning/add-items-modal';
import { ModuleCard } from './_components/module-card';
import { ModuleModal } from './_components/module-modal';
import { useProject } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useWorkspaceHref } from '@/hooks/use-workspaces';
import {
  useModuleMutations,
  useModules,
  type FeatureModule,
  type ModuleStatus,
} from '@/hooks/use-modules';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Live work first, then what is queued, then what has stopped. `completed` and
 * `cancelled` sit at the bottom because both only ever accumulate.
 */
const SECTIONS: { status: ModuleStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'planned', label: 'Planned' },
  { status: 'backlog', label: 'Backlog' },
  { status: 'paused', label: 'Paused' },
  { status: 'completed', label: 'Completed' },
  { status: 'cancelled', label: 'Cancelled' },
];

export default function ProjectModulesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const ws = useWorkspaceHref();
  const me = useAuthStore((s) => s.user);
  const { data: project } = useProject(projectId);
  const { data: users = [] } = useUsers();
  const { data: modules = [], isLoading } = useModules({ projectId });
  const { create, update, remove, assign, unassign } =
    useModuleMutations(projectId);

  const [editing, setEditing] = useState<FeatureModule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<FeatureModule | null>(null);
  const [addingTo, setAddingTo] = useState<FeatureModule | null>(null);

  // Same gate as project settings: owner or member. The API enforces it too —
  // this only decides whether the affordance is shown.
  const myId = me?._id ?? me?.id;
  const canWrite = !!(
    myId &&
    project &&
    (project.ownerId === myId || project.members.includes(myId))
  );

  const userMap = useMemo(() => new Map(users.map((u) => [u._id, u])), [users]);

  // Only project people can lead a module — offering the whole instance would
  // let you name someone who cannot even read it.
  const leadCandidates = useMemo(() => {
    if (!project) return [];
    return [project.ownerId, ...project.members]
      .map((uid) => userMap.get(uid))
      .filter(Boolean) as { _id: string; name: string }[];
  }, [project, userMap]);

  const grouped = useMemo(() => {
    const by = new Map<ModuleStatus, FeatureModule[]>();
    for (const m of modules) {
      const list = by.get(m.status) ?? [];
      list.push(m);
      by.set(m.status, list);
    }
    return by;
  }, [modules]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[12.5px] text-text-muted">
          Feature- and goal-shaped groups of work. Modules run in parallel.
        </p>
        {canWrite && modules.length > 0 && (
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            New module
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonText lines={6} />
      ) : modules.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          label="No modules yet"
          hint="Create a module to group the work items that build one feature or goal, each with its own lead and progress."
          action={
            canWrite ? (
              <Button size="sm" variant="primary" onClick={openCreate}>
                <Plus className="w-3.5 h-3.5" />
                New module
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
                  {list.map((mod) => (
                    <ModuleCard
                      key={mod._id}
                      module={mod}
                      lead={mod.leadId ? userMap.get(mod.leadId) : undefined}
                      canWrite={canWrite}
                      hrefFor={(issueId) => ws(`/issues/${issueId}`)}
                      onEdit={() => {
                        setEditing(mod);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeleting(mod)}
                      onAddItems={() => setAddingTo(mod)}
                      onRemoveItem={(issueId) =>
                        unassign.mutate({ id: mod._id, issueId })
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ModuleModal
        open={formOpen}
        module={editing}
        members={leadCandidates}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSave={(body) => {
          const done = editing
            ? update.mutateAsync({ id: editing._id, body })
            : create.mutateAsync(body);
          // Close only on success, so a rejection keeps what the user typed.
          done.then(() => setFormOpen(false)).catch(() => {});
        }}
      />

      {addingTo && (
        <AddItemsModal
          open
          projectId={projectId}
          targetName={addingTo.name}
          backlogFilter={{ moduleId: 'none' }}
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
        title="Delete module?"
        body={
          <>
            <strong>{deleting?.name}</strong> will be deleted. Its work items
            are not deleted — they are released from the module.
          </>
        }
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />
    </div>
  );
}
