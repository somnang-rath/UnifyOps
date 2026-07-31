'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import type { Automation } from '@/schemas/automation';

interface SaveBody {
  name: string;
  trigger: string;
  condition?: Record<string, unknown>;
  action?: Record<string, unknown>;
  enabled?: boolean;
}

/** Create needs a home workspace; the API rejects a rule without one. */
type CreateBody = SaveBody & { workspaceId: string };

const svc = {
  list: (workspaceId: string) =>
    api
      .get<Automation[]>('/automations', { params: { workspaceId } })
      .then((r) => r.data),
  create: (b: CreateBody) =>
    api.post<Automation>('/automations', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody> & { enabled?: boolean }) =>
    api.patch<Automation>(`/automations/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/automations/${id}`).then((r) => r.data),
};

/**
 * Rules of the current workspace. `/automations` is a flat route (ADR 0011
 * Tier G), so the workspace comes from the store-backed selection rather than
 * the URL. The id is part of the query key — switching workspaces must show a
 * different list, not a cached one.
 */
export const useAutomations = () => {
  const { current } = useCurrentWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: ['automations', workspaceId],
    queryFn: () => svc.list(workspaceId!),
    enabled: !!workspaceId,
    placeholderData: (prev) => prev,
  });
};

export function useAutomationMutations() {
  const qc = useQueryClient();
  const { current } = useCurrentWorkspace();
  const inv = () => qc.invalidateQueries({ queryKey: ['automations'] });

  return {
    create: useMutation({
      mutationFn: (b: SaveBody) => {
        if (!current?.id) {
          throw new Error('Pick a workspace before creating an automation');
        }
        return svc.create({ ...b, workspaceId: current.id });
      },
      onSuccess: () => {
        inv();
        toast('Automation created', 'success');
      },
      onError: (e: Error) => toast(e.message, 'error'),
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<SaveBody> & { enabled?: boolean } }) =>
        svc.update(id, body),
      onSuccess: () => inv(),
    }),
    remove: useMutation({
      mutationFn: svc.remove,
      onSuccess: () => {
        inv();
        toast('Automation deleted', 'success');
      },
    }),
  };
}
