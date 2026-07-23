'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { IssueTemplate } from '@prism/types';
import { Badge, EmptyState, ErrorState, Skeleton } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { TemplateModal } from '@/components/feature/template/template-modal';
import { useTemplateMutations, useTemplates } from '@/hooks/use-templates';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { useAuthStore } from '@/stores/auth-store';
import type { Project } from '@/schemas/project';

/**
 * "Issue templates" section in project settings (templates-csv-import spec
 * §2). Lists the project's templates plus workspace-level ones; mutation
 * affordances follow the write gate — project templates: project
 * owner/member; workspace templates: owner-or-author.
 */
export function TemplatesSection({ project }: { project: Project }) {
  const me = useAuthStore((s) => s.user);
  const myId = me?._id ?? me?.id;
  const slug = useParams<{ workspaceSlug?: string }>()?.workspaceSlug ?? null;
  const { data: workspace } = useWorkspaceBySlug(slug);

  const workspaceId = project.workspaceId ?? workspace?.id ?? '';
  const {
    data: templates = [],
    isLoading,
    isError,
    refetch,
  } = useTemplates({
    projectId: project._id,
    workspaceId: workspaceId || undefined,
  });
  const { remove } = useTemplateMutations();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IssueTemplate | null>(null);
  const [deleting, setDeleting] = useState<IssueTemplate | null>(null);

  // Project templates: project owner/member may create/edit/delete.
  const canWriteProject = !!(
    myId &&
    (project.ownerId === myId || project.members.includes(myId))
  );
  // Workspace templates: any workspace member may create; edit/delete is
  // owner-or-author. The API is authoritative — this only hides dead ends.
  const canWriteTemplate = (t: IssueTemplate) =>
    t.projectId !== null
      ? canWriteProject
      : (t.ownerId ?? t.createdBy) === myId || workspace?.owner?.id === myId;

  const summary = (t: IssueTemplate) => {
    const d = t.defaults ?? {};
    const labels = d.labels ?? [];
    const todos = d.todos ?? [];
    const parts = [
      d.type ?? '',
      d.priority ?? '',
      labels.length > 0
        ? `${labels.length} label${labels.length === 1 ? '' : 's'}`
        : '',
      todos.length > 0
        ? `${todos.length} checklist item${todos.length === 1 ? '' : 's'}`
        : '',
      (d.desc ?? '').trim() ? 'has description' : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'no defaults';
  };

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (t: IssueTemplate) => {
    setEditing(t);
    setModalOpen(true);
  };

  const mutating = remove.isPending;

  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">Issue templates</h2>
      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-1.5 px-4 py-3 border-b border-border last:border-b-0"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            message="Could not load templates"
            onRetry={() => refetch()}
          />
        ) : templates.length === 0 ? (
          <EmptyState
            label="No templates yet"
            hint="Templates pre-fill new work items with a description, priority, labels and a checklist."
            action={
              canWriteProject ? (
                <Button size="sm" variant="outline" onClick={openNew}>
                  <Plus className="w-3.5 h-3.5" /> New template
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {templates.map((t) => (
              <div
                key={t._id}
                className="group flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0"
              >
                <span className="text-[13px] font-semibold truncate">
                  {t.name}
                </span>
                {t.projectId === null && (
                  <Badge size="xs" variant="outline">
                    Workspace
                  </Badge>
                )}
                <span className="flex-1 min-w-0 text-[11px] text-text-muted truncate">
                  {summary(t)}
                </span>
                {canWriteTemplate(t) && (
                  <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      disabled={mutating}
                      aria-label={`Edit template ${t.name}`}
                      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text transition-colors disabled:opacity-40 focus:opacity-100"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(t)}
                      disabled={mutating}
                      aria-label={`Delete template ${t.name}`}
                      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-red/10 hover:text-red transition-colors disabled:opacity-40 focus:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
            ))}
            {canWriteProject && (
              <div className="border-t border-border">
                <button
                  type="button"
                  onClick={openNew}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[13px] text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New template
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-text-muted mt-2">
        Templates pre-fill new work items. Workspace templates are available in
        every project.
      </p>

      <TemplateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        template={editing}
        projectId={project._id}
        workspaceId={workspaceId}
        canScopeWorkspace={canWriteProject}
      />

      <Confirm
        open={!!deleting}
        title="Delete template"
        body={
          <>
            Delete <strong>{deleting?.name}</strong> — work items created from
            it are not affected.
          </>
        }
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting._id);
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
