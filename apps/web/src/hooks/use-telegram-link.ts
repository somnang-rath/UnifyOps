'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TelegramLinkStatus } from '@/schemas/chat';

/**
 * Per-channel Telegram bridge management. The backend for these endpoints lands in
 * Phase B; the query degrades to a "not linked / unavailable" status until then, so
 * the UI renders without erroring.
 */
export function useTelegramStatus(channelId: string | null) {
  return useQuery({
    queryKey: ['chat', 'telegram', channelId],
    enabled: !!channelId,
    retry: false,
    queryFn: () =>
      api
        .get<TelegramLinkStatus>(`/chat/channels/${channelId}/telegram`)
        .then((r) => r.data),
  });
}

export function useLinkTelegram(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ code: string; expiresAt: string; botUsername: string }>(
          `/chat/channels/${channelId}/telegram/link`,
        )
        .then((r) => r.data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['chat', 'telegram', channelId] }),
  });
}

export function useUpdateTelegramLink(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      direction?: 'both' | 'to-telegram' | 'from-telegram';
      active?: boolean;
    }) =>
      api
        .patch(`/chat/channels/${channelId}/telegram`, patch)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'telegram', channelId] });
      qc.invalidateQueries({ queryKey: ['chat', 'channel', channelId] });
    },
  });
}

export function useUnlinkTelegram(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete(`/chat/channels/${channelId}/telegram`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'telegram', channelId] });
      qc.invalidateQueries({ queryKey: ['chat', 'channel', channelId] });
    },
  });
}

// ── Personal Telegram identity (attribution) ──────────────────────

export interface MyTelegramIdentity {
  linked: boolean;
  telegramUsername: string | null;
  telegramName: string | null;
  pendingCode: string | null;
  pendingCodeExpiresAt: string | null;
  botUsername: string | null;
}

export function useMyTelegramIdentity() {
  return useQuery({
    queryKey: ['chat', 'telegram', 'me'],
    retry: false,
    queryFn: () =>
      api.get<MyTelegramIdentity>('/chat/telegram/identity').then((r) => r.data),
  });
}

export function useLinkMyTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ code: string; expiresAt: string; botUsername: string | null }>(
          '/chat/telegram/identity/link',
        )
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'telegram', 'me'] }),
  });
}

export function useUnlinkMyTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/chat/telegram/identity').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'telegram', 'me'] }),
  });
}
