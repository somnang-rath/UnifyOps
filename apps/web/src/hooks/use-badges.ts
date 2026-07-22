'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { Badges } from '@/schemas/notification';

export const useBadges = () => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['badges'],
    queryFn: () =>
      api
        .get<Badges>('/badges')
        .then((r) => r.data)
        .catch(
          () =>
            ({
              issues: 0,
              mywork: 0,
              approvals: 0,
              notifications: 0,
              chat: 0,
            }) as Badges,
        ),
    enabled: !!user,
    refetchInterval: 30_000,
    placeholderData: {
      issues: 0,
      mywork: 0,
      approvals: 0,
      notifications: 0,
      chat: 0,
    },
  });
};
