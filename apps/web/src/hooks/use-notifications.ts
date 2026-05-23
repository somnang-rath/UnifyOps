'use client';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { Notification, NotifResp } from '@/schemas/notification';

interface HistoryPage {
  items: Notification[];
  nextCursor: string | null;
}

const notifService = {
  list: () =>
    api.get<NotifResp>('/notifications').then((r) => r.data),
  history: (cursor?: string, limit = 50) =>
    api
      .get<HistoryPage>('/notifications/history', {
        params: { cursor, limit },
      })
      .then((r) => r.data),
  read: (id: string) =>
    api.patch(`/notifications/${id}/read`).then((r) => r.data),
  unread: (id: string) =>
    api.patch(`/notifications/${id}/unread`).then((r) => r.data),
  readAll: () =>
    api.patch('/notifications/read-all').then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/notifications/${id}`).then((r) => r.data),
  clearRead: () =>
    api.delete('/notifications/read').then((r) => r.data),
};

export const useNotifications = () => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['notifications'],
    queryFn: notifService.list,
    enabled: !!user,
    retry: false,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 30_000),
  });
};

export const useNotificationHistory = () => {
  const user = useAuthStore((s) => s.user);
  return useInfiniteQuery({
    queryKey: ['notifications-history'],
    queryFn: ({ pageParam }) =>
      notifService.history(pageParam as string | undefined, 50),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!user,
  });
};

export function useNotifMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-history'] });
    qc.invalidateQueries({ queryKey: ['badges'] });
  };
  return {
    read: useMutation({ mutationFn: notifService.read, onSuccess: inv }),
    unread: useMutation({ mutationFn: notifService.unread, onSuccess: inv }),
    readAll: useMutation({
      mutationFn: notifService.readAll,
      onSuccess: inv,
    }),
    remove: useMutation({
      mutationFn: notifService.remove,
      onMutate: async (id: string) => {
        await qc.cancelQueries({ queryKey: ['notifications'] });
        const prev = qc.getQueryData<NotifResp>(['notifications']);
        if (prev) {
          const removed = prev.items.find((n) => n._id === id);
          qc.setQueryData<NotifResp>(['notifications'], {
            items: prev.items.filter((n) => n._id !== id),
            unread: Math.max(
              0,
              prev.unread - (removed && !removed.read ? 1 : 0),
            ),
          });
        }
        return { prev };
      },
      onError: (_e, _v, ctx) => {
        if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev);
      },
      onSettled: inv,
    }),
    clearRead: useMutation({
      mutationFn: notifService.clearRead,
      onMutate: async () => {
        await qc.cancelQueries({ queryKey: ['notifications'] });
        const prev = qc.getQueryData<NotifResp>(['notifications']);
        if (prev) {
          qc.setQueryData<NotifResp>(['notifications'], {
            items: prev.items.filter((n) => !n.read),
            unread: prev.unread,
          });
        }
        return { prev };
      },
      onError: (_e, _v, ctx) => {
        if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev);
      },
      onSettled: inv,
    }),
  };
}
