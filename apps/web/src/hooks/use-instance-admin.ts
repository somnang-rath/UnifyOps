'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Whether the current user is an instance admin (server-wide God Mode access).
 * Distinct from the workspace `role === 'admin'`.
 */
export function useIsInstanceAdmin() {
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: ['instance', 'me'],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get<{ isInstanceAdmin: boolean }>('/instance/me')
        .then((r) => r.data.isInstanceAdmin)
        .catch(() => false),
  });
  return !!data;
}
