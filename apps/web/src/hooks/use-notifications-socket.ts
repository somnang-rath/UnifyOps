'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';
import { playPing } from '@/lib/notification-sound';
import type { Notification, NotifResp } from '@/schemas/notification';

function socketOrigin(): string {
  // Prefer the dedicated WS env var; WebSocket upgrades can't go through the
  // Next.js rewrite proxy, so we must point directly at the API server.
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const stripped = raw.replace(/\/api\/v1\/?$/, '');
  return stripped.startsWith('http') ? stripped : 'http://localhost:4000';
}

export function useNotificationsSocket() {
  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  useEffect(() => {
    if (!token || !userId) return;

    let socket: Socket | null = null;

    // Defer connection by one tick so React StrictMode's synchronous
    // mount→unmount→remount cycle can cancel before the WebSocket opens,
    // avoiding the "closed before connection established" console error.
    const timer = setTimeout(() => {
      socket = io(`${socketOrigin()}/ws/notifications`, {
        transports: ['websocket'],
        // Use a function so every reconnect attempt picks up the latest
        // access token (e.g. after a silent HTTP refresh).
        auth: (cb: (data: { token: string }) => void) =>
          cb({ token: useAuthStore.getState().accessToken ?? '' }),
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socket.on('notif:new', (notif: Notification) => {
        if (!notif.read) playPing();
        qc.setQueryData<NotifResp>(['notifications'], (prev) => {
          if (!prev) return { items: [notif], unread: notif.read ? 0 : 1 };
          const existing = prev.items.find((n) => n._id === notif._id);
          const others = prev.items.filter((n) => n._id !== notif._id);
          const wasUnread = existing ? !existing.read : false;
          const isUnread = !notif.read;
          const unread = Math.max(
            0,
            prev.unread - (wasUnread ? 1 : 0) + (isUnread ? 1 : 0),
          );
          return {
            items: [notif, ...others].slice(0, 40),
            unread,
          };
        });
        qc.invalidateQueries({ queryKey: ['badges'] });
      });
    }, 0);

    return () => {
      clearTimeout(timer);
      socket?.disconnect();
    };
  }, [token, userId, qc]);
}
