'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import {
  appendMessage,
  patchMessage,
  removeMessage,
} from '@/hooks/use-chat';
import type {
  MessageDeleteEvent,
  MessageView,
  TelegramStatusEvent,
  TypingEvent,
  UnreadEvent,
} from '@/schemas/chat';

function socketOrigin(): string {
  // WebSocket upgrades can't traverse the Next.js rewrite proxy, so point at the
  // API host directly — same reasoning as use-notifications-socket.
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const stripped = raw.replace(/\/api\/v1\/?$/, '');
  return stripped.startsWith('http') ? stripped : 'http://localhost:4000';
}

/**
 * One socket for the whole chat surface. Joins/leaves the active channel room as
 * the route changes, and patches the TanStack caches on every server event. Mirrors
 * use-notifications-socket, including the StrictMode-safe deferred connect.
 */
export function useChatSocket(activeChannelId: string | null) {
  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const setSocket = useChatStore((s) => s.setSocket);
  const setTyping = useChatStore((s) => s.setTyping);
  const setConnected = useChatStore((s) => s.setConnected);

  useEffect(() => {
    if (!token || !userId) return;
    let socket: Socket | null = null;

    const timer = setTimeout(() => {
      socket = io(`${socketOrigin()}/ws/chat`, {
        transports: ['websocket'],
        auth: (cb: (d: { token: string }) => void) =>
          cb({ token: useAuthStore.getState().accessToken ?? '' }),
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      setSocket(socket);
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));

      socket.on('chat:message', (msg: MessageView) => {
        appendMessage(qc, msg.channelId, msg);
        qc.invalidateQueries({ queryKey: ['chat', 'channels'] });
      });
      socket.on('chat:message:update', (msg: MessageView) =>
        patchMessage(qc, msg.channelId, msg),
      );
      socket.on('chat:message:delete', (e: MessageDeleteEvent) =>
        removeMessage(qc, e.channelId, e.messageId),
      );
      socket.on('chat:unread', (_e: UnreadEvent) => {
        // The count itself lives in the channel list + badges; just refresh them.
        qc.invalidateQueries({ queryKey: ['chat', 'channels'] });
        qc.invalidateQueries({ queryKey: ['badges'] });
      });
      socket.on('chat:typing', (e: TypingEvent) => setTyping(e));
      socket.on('chat:telegram:status', (e: TelegramStatusEvent) => {
        qc.invalidateQueries({ queryKey: ['chat', 'channel', e.channelId] });
        qc.invalidateQueries({ queryKey: ['chat', 'telegram', e.channelId] });
      });
    }, 0);

    return () => {
      clearTimeout(timer);
      socket?.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token, userId, qc, setSocket, setTyping, setConnected]);

  // Join the active channel room; leave it on change so we only receive rooms we
  // are actually viewing. The server re-authorizes every join. Depends on the
  // socket from the store (not getState) so it re-runs once the deferred connect
  // completes — otherwise the first channel opened on a cold mount never joins.
  const socket = useChatStore((s) => s.socket);
  const connected = useChatStore((s) => s.connected);
  useEffect(() => {
    if (!socket || !connected || !activeChannelId) return;
    socket.emit('chat:join', { channelId: activeChannelId });
    return () => {
      socket.emit('chat:leave', { channelId: activeChannelId });
    };
  }, [socket, connected, activeChannelId]);
}
