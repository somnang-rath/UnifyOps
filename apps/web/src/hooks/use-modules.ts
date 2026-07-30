'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Issue } from '@/schemas/issue';

export const MODULE_STATUSES = [
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export interface ModuleProgress {
  total: number;
  completed: number;
  byStatus: Record<string, number>;
}

/**
 * Named `FeatureModule` on the client for the same reason the API calls the
 * entity `ProjectModule` — a bare `Module` collides with too much (ES modules,
 * Nest's decorator) to be a safe name for a domain type.
 */
export interface FeatureModule {
  _id: string;
  name: string;
  description: string;
  projectId: string;
  workspaceId: string;
  ownerId: string;
  leadId: string | null;
  memberIds: string[];
  startDate: string | null;
  targetDate: string | null;
  /** Stored and human-set, unlike a cycle's derived status. */
  status: ModuleStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
  progress: ModuleProgress;
}

export interface SaveModuleBody {
  name: string;
  description?: string;
  leadId?: string | null;
  memberIds?: string[];
  startDate?: string | null;
  targetDate?: string | null;
  status?: ModuleStatus;
}

interface ModuleScope {
  projectId?: string;
  workspaceId?: string;
  status?: ModuleStatus;
}

const modulesService = {
  list: (scope: ModuleScope) =>
    api.get<FeatureModule[]>('/modules', { params: scope }).then((r) => r.data),
  byId: (id: string) =>
    api.get<FeatureModule>(`/modules/${id}`).then((r) => r.data),
  issues: (id: string) =>
    api.get<Issue[]>(`/modules/${id}/issues`).then((r) => r.data),
  create: (b: SaveModuleBody & { projectId: string }) =>
    api.post<FeatureModule>('/modules', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveModuleBody>) =>
    api.patch<FeatureModule>(`/modules/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api
      .delete<{ ok: true; releasedIssues: number }>(`/modules/${id}`)
      .then((r) => r.data),
  assign: (id: string, issueIds: string[]) =>
    api
      .post<{ assigned: number; skipped: string[] }>(`/modules/${id}/issues`, {
        issueIds,
      })
      .then((r) => r.data),
  unassign: (id: string, issueId: string) =>
    api
      .delete<{ ok: true }>(`/modules/${id}/issues/${issueId}`)
      .then((r) => r.data),
};

const msg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message ?? fallback;

export const useModules = (scope: ModuleScope) =>
  useQuery({
    queryKey: ['modules', scope],
    queryFn: () => modulesService.list(scope),
    enabled: !!(scope.projectId || scope.workspaceId),
  });

export const useModule = (id: string | null) =>
  useQuery({
    queryKey: ['modules', 'byId', id],
    queryFn: () => modulesService.byId(id!),
    enabled: !!id,
  });

/** Work items in one module. */
export const useModuleIssues = (id: string | null) =>
  useQuery({
    queryKey: ['modules', 'issues', id],
    queryFn: () => modulesService.issues(id!),
    enabled: !!id,
  });

export function useModuleMutations(projectId: string) {
  const qc = useQueryClient();
  /** Assignment moves `issue.moduleId`, so the issues tree is stale too. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['modules'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
  };

  const create = useMutation({
    mutationFn: (b: SaveModuleBody) => modulesService.create({ ...b, projectId }),
    onSuccess: () => {
      invalidate();
      toast('Module created', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not create module'), 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SaveModuleBody> }) =>
      modulesService.update(id, body),
    onSuccess: () => {
      invalidate();
      toast('Module updated', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not update module'), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => modulesService.remove(id),
    onSuccess: (r) => {
      invalidate();
      toast(
        r.releasedIssues
          ? `Module deleted — ${r.releasedIssues} item(s) released`
          : 'Module deleted',
        'success',
      );
    },
    onError: (e) => toast(msg(e, 'Could not delete module'), 'error'),
  });

  const assign = useMutation({
    mutationFn: ({ id, issueIds }: { id: string; issueIds: string[] }) =>
      modulesService.assign(id, issueIds),
    onSuccess: (r) => {
      invalidate();
      // Partial success is the API contract — report it honestly.
      toast(
        r.skipped.length
          ? `Added ${r.assigned}, skipped ${r.skipped.length} (not in this project)`
          : `Added ${r.assigned} work item(s)`,
        r.skipped.length ? 'info' : 'success',
      );
    },
    onError: (e) => toast(msg(e, 'Could not add work items'), 'error'),
  });

  const unassign = useMutation({
    mutationFn: ({ id, issueId }: { id: string; issueId: string }) =>
      modulesService.unassign(id, issueId),
    onSuccess: invalidate,
    onError: (e) => toast(msg(e, 'Could not remove work item'), 'error'),
  });

  return { create, update, remove, assign, unassign };
}
