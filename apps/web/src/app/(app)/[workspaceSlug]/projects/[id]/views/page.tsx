'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CircleDashed,
  Globe,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge, EmptyState } from '@prism/ui';
import { Button, IconButton } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { SkeletonText } from '@/components/ui/skeleton';
import { PublishControl } from '@/components/feature/publish/publish-control';
import { ViewModal } from './_components/view-modal';
import { useProject } from '@/hooks/use-projects';
import { useWorkspaceHref } from '@/hooks/use-workspaces';
import {
  useViewMutations,
  useViewPublish,
  useViews,
  type SavedView,
} from '@/hooks/use-views';
import { useAuthStore } from '@/stores/auth-store';

// Public Space origin — used to build the shareable link (ADR 0002 §6).
const SPACE_URL = process.env.NEXT_PUBLIC_SPACE_URL ?? '';

const LAYOUT_LABEL: Record<string, string> = {
  list: 'List',
  kanban: 'Board',
  calendar: 'Calendar',
  timeline: 'Timeline',
  spreadsheet: 'Table',
};

/**
 * One-line summary of what a view actually selects, so the list is readable
 * without opening each one. `filters` may be absent — Mongoose `minimize`
 * drops an empty `{}` at save time.
 */
function summarise(view: SavedView): string {
  const f = (view.filters ?? {}) as Record<string, string | undefined>;
  const parts = [
    LAYOUT_LABEL[view.layout] ?? view.layout,
    f.status && f.status !== 'all' ? f.status : null,
    f.type ?? null,
    f.priority ? `${f.priority} priority` : null,
    view.groupBy ? `grouped by ${view.groupBy}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export default function ProjectViewsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const ws = useWorkspaceHref();
  const me = useAuthStore((s) => s.user);
  const { data: project } = useProject(projectId);
  const { data: views = [], isLoading } = useViews({ projectId });
  const { create, update, remove } = useViewMutations({ projectId });
  const pub = useViewPublish();

  const [editing, setEditing] = useState<SavedView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<SavedView | null>(null);

  const myId = me?._id ?? me?.id;
  // Creating a project view is a write to the project (API: assertProjectWritable).
  const canWrite = !!(
    myId &&
    project &&
    (project.ownerId === myId || project.members.includes(myId))
  );
  // Editing and deleting stay owner-only, matching ViewsService — sharing a
  // view does not hand editing to its readers.
  const isMine = (v: SavedView) => v.ownerId === myId;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[12.5px] text-text-muted">
          Saved slices of this project&apos;s work items.
        </p>
        {canWrite && views.length > 0 && (
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            New view
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonText lines={5} />
      ) : views.length === 0 ? (
        <EmptyState
          icon={<CircleDashed />}
          label="No views yet"
          hint="Save a combination of filters, grouping and layout so the team can jump straight to a slice of work."
          action={
            canWrite ? (
              <Button size="sm" variant="primary" onClick={openCreate}>
                <Plus className="w-3.5 h-3.5" />
                New view
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {views.map((view) => (
            <div
              key={view._id}
              className="flex items-center gap-3 border border-border rounded-sm bg-bg px-3.5 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Deep-links the view into the work-items list (?view=). */}
                  <Link
                    href={`${ws('/issues')}?view=${view._id}&project=${projectId}`}
                    className="text-[14px] font-semibold truncate hover:text-accent"
                  >
                    {view.name}
                  </Link>
                  {view.isPublic ? (
                    <Badge variant="success">
                      <Globe /> Published
                    </Badge>
                  ) : view.isShared ? (
                    <Badge variant="neutral">
                      <Users /> Shared
                    </Badge>
                  ) : (
                    <Badge variant="outline">Private</Badge>
                  )}
                </div>
                <p className="text-[11.5px] text-text-muted mt-1 capitalize">
                  {summarise(view)}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Publishing is a project-level act, so it follows the project
                    write gate rather than view ownership (ADR 0012 §3). */}
                {canWrite && (
                  <PublishControl
                    published={!!view.isPublic}
                    anchor={view.anchor ?? null}
                    spaceUrl={SPACE_URL}
                    pending={pub.publish.isPending || pub.unpublish.isPending}
                    onPublish={() => pub.publish.mutate(view._id)}
                    onUnpublish={() => pub.unpublish.mutate(view._id)}
                  />
                )}
                {isMine(view) && (
                  <>
                    <IconButton
                      onClick={() => {
                        setEditing(view);
                        setFormOpen(true);
                      }}
                      aria-label={`Edit view ${view.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton
                      onClick={() => setDeleting(view)}
                      aria-label={`Delete view ${view.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ViewModal
        open={formOpen}
        view={editing}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSave={(body) => {
          const done = editing
            ? update.mutateAsync({ id: editing._id, body })
            : create.mutateAsync({ ...body, projectId });
          done.then(() => setFormOpen(false)).catch(() => {});
        }}
      />

      <Confirm
        open={!!deleting}
        danger
        title="Delete view?"
        body={
          <>
            <strong>{deleting?.name}</strong> will be deleted.
            {deleting?.isPublic
              ? ' This view is published — its public link will stop working.'
              : ' Work items are not affected.'}
          </>
        }
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />
    </div>
  );
}
