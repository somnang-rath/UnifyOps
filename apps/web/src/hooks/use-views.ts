'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';

export type ViewLayout =
  | 'list'
  | 'kanban'
  | 'calendar'
  | 'timeline'
  | 'spreadsheet';

export interface SavedView {
  _id: string;
  name: string;
  workspaceId: string;
  projectId: string | null;
  ownerId: string;
  layout: ViewLayout;
  filters: Record<string, unknown>;
  groupBy: string | null;
  sortBy: string;
  displayProperties: string[];
  isShared: boolean;
  position: number;
  // Publish to Space (ADR 0012 §1/§3) — project-scoped views only.
  isPublic?: boolean;
  anchor?: string | null;
  publishedAt?: string | null;
}

/** Response of POST /views/:id/publish (ADR 0012 §3). */
export interface ViewPublishState {
  anchor: string;
  isPublic: boolean;
  publishedAt: string | null;
}

export interface SaveViewBody {
  name: string;
  projectId?: string | null;
  workspaceId?: string;
  layout?: ViewLayout;
  filters?: Record<string, unknown>;
  groupBy?: string | null;
  sortBy?: string;
  displayProperties?: string[];
  isShared?: boolean;
}

interface ViewScope {
  projectId?: string;
  workspaceId?: string;
}

const viewsService = {
  list: (scope: ViewScope) =>
    api.get<SavedView[]>('/views', { params: scope }).then((r) => r.data),
  create: (b: SaveViewBody) =>
    api.post<SavedView>('/views', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveViewBody>) =>
    api.patch<SavedView>(`/views/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/views/${id}`).then((r) => r.data),
  publish: (id: string) =>
    api.post<ViewPublishState>(`/views/${id}/publish`).then((r) => r.data),
  unpublish: (id: string) =>
    api
      .post<{ isPublic: boolean }>(`/views/${id}/unpublish`)
      .then((r) => r.data),
};

/** Saved views for a scope. Pass a projectId for project views, else workspace. */
export const useViews = (scope: ViewScope) =>
  useQuery({
    queryKey: ['views', scope],
    queryFn: () => viewsService.list(scope),
    enabled: !!(scope.projectId || scope.workspaceId),
  });

export function useViewMutations(scope: ViewScope) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['views'] });

  const create = useMutation({
    mutationFn: (b: SaveViewBody) => viewsService.create(b),
    onSuccess: () => {
      invalidate();
      toast('View saved', 'success');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast(e.response?.data?.message ?? 'Could not save view', 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SaveViewBody> }) =>
      viewsService.update(id, body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => viewsService.remove(id),
    onSuccess: () => {
      invalidate();
      toast('View deleted', 'success');
    },
  });

  return { create, update, remove };
}

/**
 * Publish / unpublish a saved view to the public Space (ADR 0012 §3).
 * Mirrors `useWikiPublish`: publish/unpublish mutations that invalidate
 * `['views']` so the chips and the active control pick up the new state.
 * Workspace-level views are rejected server-side (400) — callers gate the UI.
 */
export function useViewPublish() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['views'] });

  return {
    publish: useMutation({
      mutationFn: (id: string) => viewsService.publish(id),
      onSuccess: () => {
        invalidate();
        toast('Published to Space', 'success');
      },
      onError: (e: { response?: { data?: { message?: string } } }) =>
        toast(e.response?.data?.message ?? 'Could not publish view', 'error'),
    }),
    unpublish: useMutation({
      mutationFn: (id: string) => viewsService.unpublish(id),
      onSuccess: () => {
        invalidate();
        toast('Unpublished', 'success');
      },
      onError: () => toast('Could not unpublish view', 'error'),
    }),
  };
}
