'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Automation } from '@/schemas/automation';

interface SaveBody {
  name: string;
  trigger: string;
  condition?: Record<string, unknown>;
  action?: Record<string, unknown>;
  enabled?: boolean;
}

const svc = {
  list: () => api.get<Automation[]>('/automations').then((r) => r.data),
  create: (b: SaveBody) =>
    api.post<Automation>('/automations', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody> & { enabled?: boolean }) =>
    api.patch<Automation>(`/automations/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/automations/${id}`).then((r) => r.data),
};

export const useAutomations = () =>
  useQuery({
    queryKey: ['automations'],
    queryFn: svc.list,
    placeholderData: (prev) => prev,
  });

export function useAutomationMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ['automations'] });

  return {
    create: useMutation({
      mutationFn: svc.create,
      onSuccess: () => {
        inv();
        toast('Automation created', 'success');
      },
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
