'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';

interface ApiToken {
  _id: string;
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
}

interface CreatedToken extends ApiToken {
  token: string;
}

interface TwoFASetup {
  secret: string;
  qrDataUrl: string;
}

const svc = {
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    api.post('/users/me/change-password', b).then((r) => r.data),
  clearData: (b: { password: string }) =>
    api.post('/users/me/clear-data', b).then((r) => r.data),
  setup2FA: () =>
    api.post<TwoFASetup>('/users/me/2fa/setup').then((r) => r.data),
  confirm2FA: (code: string) =>
    api.post('/users/me/2fa/confirm', { code }).then((r) => r.data),
  disable2FA: (code: string) =>
    api.post('/users/me/2fa/disable', { code }).then((r) => r.data),
  listTokens: () =>
    api.get<ApiToken[]>('/users/me/api-tokens').then((r) => r.data),
  createToken: (name: string) =>
    api
      .post<CreatedToken>('/users/me/api-tokens', { name })
      .then((r) => r.data),
  revokeToken: (id: string) =>
    api.delete(`/users/me/api-tokens/${id}`).then((r) => r.data),
};

export function useChangePassword() {
  return useMutation({
    mutationFn: svc.changePassword,
    onSuccess: () => toast('Password updated', 'success'),
  });
}

export function useClearData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: svc.clearData,
    onSuccess: () => {
      qc.invalidateQueries();
      toast('All application data has been cleared', 'success');
    },
  });
}

export function useSetup2FA() {
  return useMutation<TwoFASetup, Error>({
    mutationFn: svc.setup2FA,
  });
}

export function useConfirm2FA() {
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: svc.confirm2FA,
    onSuccess: () => {
      if (user) setUser({ ...user, twoFactorEnabled: true });
      toast('Two-factor authentication enabled', 'success');
    },
  });
}

export function useDisable2FA() {
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: svc.disable2FA,
    onSuccess: () => {
      if (user) setUser({ ...user, twoFactorEnabled: false });
      toast('Two-factor authentication disabled', 'success');
    },
  });
}

export function useApiTokens() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['api-tokens'],
    queryFn: svc.listTokens,
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: svc.createToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: svc.revokeToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      toast('Token revoked', 'success');
    },
  });
}
