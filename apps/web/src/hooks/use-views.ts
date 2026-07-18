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
