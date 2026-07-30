'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Issue } from '@/schemas/issue';

/** Derived server-side from the dates — never sent by the client. */
export type CycleStatus = 'draft' | 'upcoming' | 'current' | 'completed';

export interface CycleProgress {
  total: number;
  completed: number;
  byStatus: Record<string, number>;
}

export interface Cycle {
  _id: string;
  name: string;
  description: string;
  projectId: string;
  workspaceId: string;
  ownerId: string;
  startDate: string | null;
  endDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  /** Both are computed by the API on every read; neither is stored. */
  status: CycleStatus;
  progress: CycleProgress;
}

export interface SaveCycleBody {
  name: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
}

interface CycleScope {
  projectId?: string;
  workspaceId?: string;
  status?: CycleStatus;
}

const cyclesService = {
  list: (scope: CycleScope) =>
    api.get<Cycle[]>('/cycles', { params: scope }).then((r) => r.data),
  byId: (id: string) => api.get<Cycle>(`/cycles/${id}`).then((r) => r.data),
  issues: (id: string) =>
    api.get<Issue[]>(`/cycles/${id}/issues`).then((r) => r.data),
  create: (b: SaveCycleBody & { projectId: string }) =>
    api.post<Cycle>('/cycles', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveCycleBody>) =>
    api.patch<Cycle>(`/cycles/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api
      .delete<{ ok: true; releasedIssues: number }>(`/cycles/${id}`)
      .then((r) => r.data),
  assign: (id: string, issueIds: string[]) =>
    api
      .post<{ assigned: number; skipped: string[] }>(`/cycles/${id}/issues`, {
        issueIds,
      })
      .then((r) => r.data),
  unassign: (id: string, issueId: string) =>
    api
      .delete<{ ok: true }>(`/cycles/${id}/issues/${issueId}`)
      .then((r) => r.data),
};

const msg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message ?? fallback;

export const useCycles = (scope: CycleScope) =>
  useQuery({
    queryKey: ['cycles', scope],
    queryFn: () => cyclesService.list(scope),
    enabled: !!(scope.projectId || scope.workspaceId),
  });

export const useCycle = (id: string | null) =>
  useQuery({
    queryKey: ['cycles', 'byId', id],
    queryFn: () => cyclesService.byId(id!),
    enabled: !!id,
  });

/** Work items scheduled into one cycle. */
export const useCycleIssues = (id: string | null) =>
  useQuery({
    queryKey: ['cycles', 'issues', id],
    queryFn: () => cyclesService.issues(id!),
    enabled: !!id,
  });

export function useCycleMutations(projectId: string) {
  const qc = useQueryClient();
  /**
   * Assignment moves an issue's `cycleId`, so both trees are stale: `cycles`
   * for the progress rollup, `issues` for the backlog list that filters on it.
   */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cycles'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
  };

  const create = useMutation({
    mutationFn: (b: SaveCycleBody) => cyclesService.create({ ...b, projectId }),
    onSuccess: () => {
      invalidate();
      toast('Cycle created', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not create cycle'), 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SaveCycleBody> }) =>
      cyclesService.update(id, body),
    onSuccess: () => {
      invalidate();
      toast('Cycle updated', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not update cycle'), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => cyclesService.remove(id),
    onSuccess: (r) => {
      invalidate();
      toast(
        r.releasedIssues
          ? `Cycle deleted — ${r.releasedIssues} item(s) returned to the backlog`
          : 'Cycle deleted',
        'success',
      );
    },
    onError: (e) => toast(msg(e, 'Could not delete cycle'), 'error'),
  });

  const assign = useMutation({
    mutationFn: ({ id, issueIds }: { id: string; issueIds: string[] }) =>
      cyclesService.assign(id, issueIds),
    onSuccess: (r) => {
      invalidate();
      // Partial success is the API contract — say so rather than claiming all
      // of them landed.
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
      cyclesService.unassign(id, issueId),
    onSuccess: invalidate,
    onError: (e) => toast(msg(e, 'Could not remove work item'), 'error'),
  });

  return { create, update, remove, assign, unassign };
}
