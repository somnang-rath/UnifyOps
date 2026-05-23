'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Role } from '@/schemas/role';

interface CreateRoleInput {
  key: string;
  name: string;
  color?: string;
}
interface UpdateRoleInput {
  key: string;
  patch: { name?: string; color?: string };
}

const rolesService = {
  list: () =>
    api
      .get<Role[]>('/roles')
      .then((r) => r.data)
      .catch(() => [] as Role[]),
  create: (b: CreateRoleInput) =>
    api.post<Role>('/roles', b).then((r) => r.data),
  update: ({ key, patch }: UpdateRoleInput) =>
    api.patch<Role>(`/roles/${key}`, patch).then((r) => r.data),
  remove: (key: string) =>
    api.delete(`/roles/${key}`).then((r) => r.data),
};

export const useRoles = () =>
  useQuery({
    queryKey: ['roles'],
    queryFn: rolesService.list,
    staleTime: 60_000,
  });

export function useRoleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['roles'] });

  const create = useMutation({
    mutationFn: rolesService.create,
    onSuccess: () => {
      invalidate();
      toast('Role created', 'success');
    },
  });

  const update = useMutation({
    mutationFn: rolesService.update,
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Role updated', 'success');
    },
  });

  const remove = useMutation({
    mutationFn: rolesService.remove,
    onSuccess: () => {
      invalidate();
      toast('Role deleted', 'success');
    },
  });

  return { create, update, remove };
}
