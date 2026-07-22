'use client';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type {
  ChannelView,
  MessagePage,
  MessageView,
} from '@/schemas/chat';

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const chatKeys = {
  channels: (workspaceId: string, scope: string) =>
    ['chat', 'channels', workspaceId, scope] as const,
  channel: (channelId: string) => ['chat', 'channel', channelId] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
};

// ── Channels ──────────────────────────────────────────────────────

export function useChannels(workspaceId: string | null, scope: 'mine' | 'all' = 'mine') {
  return useQuery({
    queryKey: chatKeys.channels(workspaceId ?? '', scope),
    enabled: !!workspaceId,
    queryFn: () =>
      api
        .get<ChannelView[]>('/chat/channels', {
          params: { workspaceId, scope },
        })
        .then((r) => r.data),
  });
}

export function useChannel(channelId: string | null) {
  return useQuery({
    queryKey: chatKeys.channel(channelId ?? ''),
    enabled: !!channelId,
    queryFn: () =>
      api.get<ChannelView>(`/chat/channels/${channelId}`).then((r) => r.data),
  });
}

export function useCreateChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      topic?: string;
      visibility: 'public' | 'private';
      memberIds?: string[];
    }) =>
      api
        .post<ChannelView>('/chat/channels', { workspaceId, ...input })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'channels', workspaceId] });
    },
  });
}

export function useOpenDm(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api
        .post<ChannelView>('/chat/dm', { workspaceId, userId })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'channels', workspaceId] });
    },
  });
}

export function useJoinChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      api.post<ChannelView>(`/chat/channels/${channelId}/join`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'channels', workspaceId] });
    },
  });
}

// ── Messages ──────────────────────────────────────────────────────

export function useMessages(channelId: string | null) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(channelId ?? ''),
    enabled: !!channelId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api
        .get<MessagePage>(`/chat/channels/${channelId}/messages`, {
          params: { before: pageParam, limit: 50 },
        })
        .then((r) => r.data),
    // Pages come oldest-first; the cursor pages further back in history.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useSendMessage(channelId: string) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (input: { body: string; replyToId?: string }) => {
      const clientId = uuid();
      return api
        .post<MessageView>(`/chat/channels/${channelId}/messages`, {
          ...input,
          clientId,
        })
        .then((r) => ({ ...r.data, clientId }));
    },
    onMutate: async (input) => {
      // Optimistic append. The clientId reconciles this stub with both the POST
      // response and the socket echo, so the message never appears twice.
      await qc.cancelQueries({ queryKey: chatKeys.messages(channelId) });
      const clientId = uuid();
      const optimistic: MessageView = {
        _id: `optimistic-${clientId}`,
        channelId,
        body: input.body,
        kind: 'user',
        source: 'prism',
        clientId,
        author: me
          ? { _id: me.id, name: me.name, avatar: me.avatar }
          : null,
        attachments: [],
        reactions: [],
        mentions: [],
        replyToId: input.replyToId,
        deleted: false,
        createdAt: new Date().toISOString(),
      };
      appendMessage(qc, channelId, optimistic);
      return { clientId };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(channelId) });
    },
  });
}

export function useEditMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      api
        .patch<MessageView>(`/chat/messages/${input.messageId}`, {
          body: input.body,
        })
        .then((r) => r.data),
    onSuccess: (msg) => patchMessage(qc, channelId, msg),
  });
}

export function useDeleteMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.delete(`/chat/messages/${messageId}`).then(() => messageId),
    onSuccess: (messageId) => removeMessage(qc, channelId, messageId),
  });
}

export function useToggleReaction(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      api
        .post<MessageView>(`/chat/messages/${input.messageId}/reactions`, {
          emoji: input.emoji,
        })
        .then((r) => r.data),
    onSuccess: (msg) => patchMessage(qc, channelId, msg),
  });
}

export function useMarkRead(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lastReadMessageId: string) =>
      api
        .post(`/chat/channels/${channelId}/read`, { lastReadMessageId })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['badges'] });
      qc.invalidateQueries({ queryKey: ['chat', 'channels'] });
    },
  });
}

// ── Cache helpers shared with the socket hook ─────────────────────

type QC = ReturnType<typeof useQueryClient>;

export function appendMessage(qc: QC, channelId: string, msg: MessageView) {
  qc.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
    chatKeys.messages(channelId),
    (prev) => {
      if (!prev) return prev;
      const pages = [...prev.pages];
      const last = pages[pages.length - 1];
      if (!last) return prev;
      // Reconcile with an optimistic stub or a duplicate socket echo by clientId
      // or _id, so a message posted here and echoed back never doubles up.
      const dupe = last.items.some(
        (m) =>
          m._id === msg._id ||
          (msg.clientId && m.clientId === msg.clientId),
      );
      if (dupe) {
        pages[pages.length - 1] = {
          ...last,
          items: last.items.map((m) =>
            (msg.clientId && m.clientId === msg.clientId) || m._id === msg._id
              ? msg
              : m,
          ),
        };
        return { ...prev, pages };
      }
      pages[pages.length - 1] = { ...last, items: [...last.items, msg] };
      return { ...prev, pages };
    },
  );
}

export function patchMessage(qc: QC, channelId: string, msg: MessageView) {
  qc.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
    chatKeys.messages(channelId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m._id === msg._id ? msg : m)),
        })),
      };
    },
  );
}

export function removeMessage(qc: QC, channelId: string, messageId: string) {
  qc.setQueryData<{ pages: MessagePage[]; pageParams: unknown[] }>(
    chatKeys.messages(channelId),
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map((p) => ({
          ...p,
          items: p.items.map((m) =>
            m._id === messageId ? { ...m, deleted: true, body: '' } : m,
          ),
        })),
      };
    },
  );
}
