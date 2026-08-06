'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import type { AuthUser } from '@/schemas/auth';
import type { DirectoryUser } from '@/schemas/user';

interface AdminUserPatch {
  name?: string;
  role?: string;
  blocked?: boolean;
}

interface InviteBody {
  name: string;
  email: string;
  role: string;
}

interface InviteResult {
  user: DirectoryUser;
}

const usersService = {
  list: () =>
    api
      .get<DirectoryUser[]>('/users')
      .then((r) => r.data)
      .catch(() => [] as DirectoryUser[]),
  byId: (id: string) =>
    api.get<AuthUser>(`/users/${id}`).then((r) => r.data),
  invite: (b: InviteBody) =>
    api.post<InviteResult>('/admin/users/invite', b).then((r) => r.data),
  updateMe: (
    b: Partial<
      Pick<
        AuthUser,
        | 'name'
        | 'avatar'
        | 'accent'
        | 'theme'
        | 'density'
        | 'locale'
        | 'gender'
        | 'dateOfBirth'
        | 'nationality'
        | 'jobTitle'
        | 'department'
        | 'employmentType'
      >
    >,
  ) => api.patch<AuthUser>('/users/me', b).then((r) => r.data),
  adminUpdate: (id: string, patch: AdminUserPatch) =>
    api.patch<AuthUser>(`/admin/users/${id}`, patch).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/users/${id}`).then((r) => r.data),
};

export const useUsers = () =>
  useQuery({
    queryKey: ['users'],
    queryFn: usersService.list,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: usersService.updateMe,
    onSuccess: (u) => {
      setUser(u);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Profile updated', 'success');
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: usersService.invite,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'], exact: true });
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/admin/users/${id}/resend-invite`).then((r) => r.data),
    onSuccess: () => {
      toast('Invite resent successfully', 'success');
    },
  });
}

export type { InviteResult };

export function useAdminUserMutations() {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['users'], exact: true });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUserPatch }) =>
      usersService.adminUpdate(id, patch),
    onSuccess: (_u, { patch }) => {
      invalidate();
      if (patch.blocked === true) toast('User blocked', 'success');
      else if (patch.blocked === false) toast('User unblocked', 'success');
      else if (patch.role) toast('Role updated', 'success');
    },
  });

  const remove = useMutation({
    mutationFn: usersService.remove,
    onSuccess: () => {
      invalidate();
      toast('User deleted', 'success');
    },
  });

  return { update, remove };
}
