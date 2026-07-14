'use client';
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, refreshAuth } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useAssistantStore } from '@/stores/assistant-store';
import { toast } from '@/stores/toast-store';
import type {
  AssistantConfig,
  AssistantConversation,
  AssistantUsage,
  ChatRequest,
  ChatStreamEvent,
  ConversationDetail,
  ToolStep,
} from '@/schemas/assistant';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const keys = {
  config: ['assistant', 'config'] as const,
  usage: ['assistant', 'usage'] as const,
  conversations: ['assistant', 'conversations'] as const,
  conversation: (id: string) => ['assistant', 'conversation', id] as const,
};

// ── Queries ───────────────────────────────────────────────────────────

/** Non-secret assistant settings; drives whether the UI is shown at all. */
export function useAssistantConfig() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: keys.config,
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get<AssistantConfig>('/assistant/config')
        .then((r) => r.data)
        .catch(
          () =>
            ({
              enabled: false,
              provider: 'anthropic',
              model: '',
              allowTools: false,
            }) satisfies AssistantConfig,
        ),
  });
}

/** Remaining per-user rate budget; refetched after each send. */
export function useAssistantUsage(enabled = true) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: keys.usage,
    enabled: enabled && !!user,
    staleTime: 10_000,
    queryFn: () =>
      api.get<AssistantUsage>('/assistant/usage').then((r) => r.data),
  });
}

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: keys.conversations,
    enabled,
    queryFn: () =>
      api
        .get<AssistantConversation[]>('/assistant/conversations')
        .then((r) => r.data),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: keys.conversation(id ?? ''),
    enabled: !!id,
    queryFn: () =>
      api
        .get<ConversationDetail>(`/assistant/conversations/${id}`)
        .then((r) => r.data),
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api
        .patch<AssistantConversation>(`/assistant/conversations/${id}`, { title })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: () => toast('Could not rename conversation', 'error'),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  const { activeConversationId, newConversation } = useAssistantStore();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/assistant/conversations/${id}`).then((r) => r.data),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: keys.conversations });
      if (activeConversationId === id) newConversation();
      toast('Conversation deleted', 'success');
    },
    onError: () => toast('Could not delete conversation', 'error'),
  });
}

// ── SSE streaming ─────────────────────────────────────────────────────

/**
 * POST `/assistant/chat` and yield decoded SSE events. Retries once after a
 * token refresh on 401 (the axios interceptor can't see a raw `fetch`).
 */
async function streamChat(
  req: ChatRequest,
  onEvent: (e: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const run = async (token: string | null): Promise<Response> =>
    fetch(`${API_URL}/assistant/chat`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(req),
    });

  let res = await run(useAuthStore.getState().accessToken);
  if (res.status === 401) {
    const token = await refreshAuth();
    if (token) res = await run(token);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Assistant request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      const payload = JSON.parse(dataLines.join('\n'));
      onEvent({ type: event, ...payload } as ChatStreamEvent);
    }
  }
}

/**
 * Drives one send/stream cycle for the panel and full-page chat. Combines the
 * persisted-message queries with local streaming state so the composer can show
 * the in-flight user turn and the assistant reply as it arrives.
 */
export function useChat() {
  const qc = useQueryClient();
  const { activeConversationId, setActiveConversation, context } =
    useAssistantStore();

  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (message: string, model?: string) => {
      const text = message.trim();
      if (!text || streaming) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStreaming(true);
      setStreamingText('');
      setToolSteps([]);
      setPendingUserMessage(text);

      let convId = activeConversationId;
      try {
        await streamChat(
          {
            message: text,
            ...(convId ? { conversationId: convId } : {}),
            ...(model ? { model } : {}),
            ...(context ? { context } : {}),
          },
          (e) => {
            if (e.type === 'meta') {
              convId = e.conversationId;
              if (!activeConversationId) setActiveConversation(e.conversationId);
            } else if (e.type === 'delta') {
              setStreamingText((prev) => prev + e.text);
            } else if (e.type === 'tool') {
              setToolSteps((prev) => [
                ...prev,
                { id: e.id, name: e.name, input: e.input },
              ]);
            } else if (e.type === 'tool_result') {
              setToolSteps((prev) =>
                prev.map((s) => (s.id === e.id ? { ...s, ok: e.ok } : s)),
              );
            } else if (e.type === 'error') {
              setError(e.message);
            }
          },
          controller.signal,
        );

        // Persisted turns now exist server-side — pull them in, then drop the
        // local streaming copies once the refetch has landed (avoids a flash).
        await qc.invalidateQueries({ queryKey: keys.conversations });
        if (convId) {
          await qc.invalidateQueries({ queryKey: keys.conversation(convId) });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // User pressed Stop — keep whatever streamed so far as context.
          if (convId) {
            await qc.invalidateQueries({ queryKey: keys.conversation(convId) });
          }
        } else {
          setError((err as Error).message || 'Assistant request failed');
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setStreamingText('');
        setToolSteps([]);
        setPendingUserMessage(null);
        qc.invalidateQueries({ queryKey: keys.usage });
      }
    },
    [activeConversationId, context, streaming, qc, setActiveConversation],
  );

  return {
    send,
    stop,
    streaming,
    streamingText,
    toolSteps,
    pendingUserMessage,
    error,
  };
}
