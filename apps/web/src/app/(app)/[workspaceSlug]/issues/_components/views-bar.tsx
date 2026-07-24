'use client';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Bookmark, Globe, Plus, Users } from 'lucide-react';
import { FilterChip } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Modal } from '@/components/ui/modal';
import { PublishControl } from '@/components/feature/publish/publish-control';
import { useAuthStore } from '@/stores/auth-store';
import { useProjectsInWorkspace } from '@/hooks/use-projects';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import {
  useViewMutations,
  useViewPublish,
  useViews,
  type SavedView,
  type SaveViewBody,
} from '@/hooks/use-views';

// Public Space origin — used to build the shareable link (ADR 0002 §6).
const SPACE_URL = process.env.NEXT_PUBLIC_SPACE_URL ?? '';

/** The page filter state a view snapshots (maps to the API's ViewFiltersSchema). */
export interface ViewSnapshot {
  tab: 'open' | 'closed' | 'all';
  projectId: string;
  type: string;
  priority: string;
  q: string;
  sortBy: string;
  groupBy: string;
}

interface ViewsBarProps {
  snapshot: ViewSnapshot;
  activeViewId: string | null;
  onApply: (view: SavedView) => void;
}

/**
 * Saved-views bar (Phase 7b). Chips for the current workspace's saved views
 * (plus the selected project's, when one is filtered), a Save action that
 * snapshots the current filters/sort/group, and delete on the caller's own
 * views. Applying a view is the parent's job — it owns the filter state.
 *
 * Phase 8 (publish-to-space spec §2.2): when a saved view is active, a
 * PublishControl appears after "Save view" — live for project views the
 * caller can write, disabled with a tooltip for workspace-level views.
 */
export function ViewsBar({ snapshot, activeViewId, onApply }: ViewsBarProps) {
  const me = useAuthStore((s) => s.user);
  const myId = me?._id ?? me?.id;
  // The bar lives under /[workspaceSlug]/issues (Phase 7b) — resolve from the
  // URL, not the persisted selection, so the chips match the list's scope.
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const { data: workspace } = useWorkspaceBySlug(slug ?? null);

  const { data: wsViews = [] } = useViews({
    workspaceId: workspace?.id,
  });
  const { data: projectViews = [] } = useViews({
    projectId: snapshot.projectId || undefined,
  });
  const { create, remove } = useViewMutations({
    workspaceId: workspace?.id,
    projectId: snapshot.projectId || undefined,
  });
  const pub = useViewPublish();
  const { data: projects = [] } = useProjectsInWorkspace(workspace?.id ?? null);

  const views = useMemo(() => {
    const seen = new Set<string>();
    return [...projectViews, ...wsViews].filter((v) => {
      if (seen.has(v._id)) return false;
      seen.add(v._id);
      return true;
    });
  }, [projectViews, wsViews]);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  // Deleting a *published* view gets a Confirm — its public link stops
  // working (the API unpublishes implicitly). Unpublished views delete
  // directly, as before.
  const [deletingView, setDeletingView] = useState<SavedView | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !workspace) return;
    const body: SaveViewBody = {
      name: trimmed,
      // A project filter makes it a project view; otherwise workspace-level.
      projectId: snapshot.projectId || null,
      workspaceId: snapshot.projectId ? undefined : workspace.id,
      layout: 'list',
      filters: {
        status: snapshot.tab,
        ...(snapshot.type ? { type: snapshot.type } : {}),
        ...(snapshot.priority ? { priority: snapshot.priority } : {}),
        ...(snapshot.q ? { q: snapshot.q } : {}),
      },
      groupBy: snapshot.groupBy || null,
      sortBy: snapshot.sortBy,
      isShared: shared,
    };
    create.mutate(body, {
      onSuccess: (v) => {
        setSaving(false);
        setName('');
        setShared(false);
        onApply(v);
      },
    });
  };

  // Publish affordance for the active view (spec §2.2). Workspace-level views
  // are unpublishable in v1 (ADR 0012 §3) → disabled + tooltip; non-members of
  // the view's project see nothing (never offer a 403 — wiki `canPublish`
  // principle).
  const activeView = activeViewId
    ? (views.find((v) => v._id === activeViewId) ?? null)
    : null;
  const activeViewProject = activeView?.projectId
    ? (projects.find((p) => p._id === activeView.projectId) ?? null)
    : null;
  const canPublishActiveView = !!(
    activeView &&
    activeView.projectId &&
    myId &&
    activeViewProject &&
    (activeViewProject.ownerId === myId ||
      activeViewProject.members.includes(myId))
  );
  const showPublish =
    !!activeView && (activeView.projectId === null || canPublishActiveView);

  if (!workspace) return null;

  return (
    <div className="flex items-center gap-1.5 mb-4 flex-wrap">
      <Bookmark className="w-3.5 h-3.5 text-text-muted" aria-hidden />
      {views.length === 0 && (
        <span className="text-[12px] text-text-muted">
          No saved views yet — set filters, then save them as a view.
        </span>
      )}
      {views.map((v) => {
        const active = v._id === activeViewId;
        const mine = v.ownerId === myId;
        return (
          <FilterChip
            key={v._id}
            active={active}
            icon={
              // One icon max in a 26px chip — Globe (published) wins over
              // Users (shared) when both apply (spec §2.2).
              v.isPublic ? (
                <Globe className="w-3 h-3" aria-label="Published view" />
              ) : v.isShared ? (
                <Users className="w-3 h-3" aria-label="Shared view" />
              ) : undefined
            }
            onClick={() => onApply(v)}
            onRemove={
              mine
                ? () =>
                    v.isPublic ? setDeletingView(v) : remove.mutate(v._id)
                : undefined
            }
            removeLabel={`Delete view ${v.name}`}
          >
            {v.name}
          </FilterChip>
        );
      })}
      <button
        type="button"
        onClick={() => setSaving(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] leading-none text-text-muted hover:text-text hover:bg-bg-hover transition-colors duration-[var(--dur)]"
      >
        <Plus className="w-3 h-3" /> Save view
      </button>

      {showPublish && activeView && (
        <>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
          {activeView.projectId === null ? (
            <PublishControl
              published={false}
              anchor={null}
              spaceUrl={SPACE_URL}
              pending={false}
              onPublish={() => {}}
              onUnpublish={() => {}}
              disabled
              disabledReason="Workspace views can't be published yet — publish a project view instead."
            />
          ) : (
            <PublishControl
              published={!!activeView.isPublic}
              anchor={activeView.anchor ?? null}
              spaceUrl={SPACE_URL}
              pending={pub.publish.isPending || pub.unpublish.isPending}
              onPublish={() => pub.publish.mutate(activeView._id)}
              onUnpublish={() => pub.unpublish.mutate(activeView._id)}
            />
          )}
        </>
      )}

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Save view"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || create.isPending}
              onClick={submit}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-text-muted">
            Saves the current filters, sort, and grouping
            {snapshot.projectId
              ? ' as a project view.'
              : ` for everyone’s “${workspace.name}” workspace list.`}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="View name — e.g. “Critical bugs”"
            aria-label="View name"
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Share with the team
          </label>
        </div>
      </Modal>

      <Confirm
        open={!!deletingView}
        title="Delete view"
        body={
          <>
            This will delete <strong>{deletingView?.name}</strong>. This view
            is public — its link will stop working.
          </>
        }
        danger
        onConfirm={() => {
          if (deletingView) remove.mutate(deletingView._id);
        }}
        onClose={() => setDeletingView(null)}
      />
    </div>
  );
}
