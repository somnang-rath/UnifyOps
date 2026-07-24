'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  MessageSquarePlus,
  Pencil,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { MessageBubble } from '@/components/assistant/message-bubble';
import {
  useAssistantConfig,
  useAssistantUsage,
  useChat,
  useConversation,
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from '@/hooks/use-assistant';
import { useAssistantStore } from '@/stores/assistant-store';
import { relTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUICK_PROMPTS = [
  'Summarize my open tasks',
  'Draft a project update',
  'Explain this codebase area',
  'What should I focus on today?',
];

export default function AssistantPage() {
  const { data: config } = useAssistantConfig();
  const activeConversationId = useAssistantStore((s) => s.activeConversationId);
  const setActiveConversation = useAssistantStore(
    (s) => s.setActiveConversation,
  );
  const newConversation = useAssistantStore((s) => s.newConversation);

  const { data: detail } = useConversation(activeConversationId);
  const { data: usage } = useAssistantUsage(!!config?.enabled);
  const {
    send,
    stop,
    streaming,
    streamingText,
    toolSteps,
    pendingUserMessage,
    error,
  } = useChat();

  const [input, setInput] = useState('');
  const [model, setModel] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const messages = detail?.messages ?? [];
  const isEmpty =
    messages.length === 0 && !pendingUserMessage && !streamingText;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streamingText, pendingUserMessage]);

  if (config && !config.enabled) {
    return (
      <div className="flex h-[calc(100vh-60px)] -my-5 flex-col items-center justify-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-subtle text-text-muted">
          <Bot className="h-7 w-7" />
        </span>
        <p className="mt-4 text-[15px] font-semibold">Assistant is disabled</p>
        <p className="mt-1 max-w-[320px] text-[13px] text-text-muted">
          An instance admin can enable it in God Mode → AI.
        </p>
      </div>
    );
  }

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text, model || undefined);
    setInput('');
  };

  return (
    <div className="h-[calc(100vh-60px)] -my-5 flex bg-bg-card border border-border rounded-lg overflow-hidden">
      {/* ── Sidebar: conversation list ─────────────────────────── */}
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-border md:flex">
        <div className="flex-shrink-0 p-3">
          <button
            type="button"
            onClick={() => {
              newConversation();
              setInput('');
              taRef.current?.focus();
            }}
            className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </button>
        </div>
        <ConversationList
          activeId={activeConversationId}
          onSelect={setActiveConversation}
        />
      </aside>

      {/* ── Main: thread + composer ────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-border px-5 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)]">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight">
              {detail?.conversation.title ?? 'New chat'}
            </p>
            <p className="truncate text-[11px] text-text-muted">
              {config?.model || 'Assistant'}
            </p>
          </div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={config?.model || 'model'}
            title="Override the model for the next message (optional)"
            className="hidden w-52 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-[12px] outline-none focus:border-accent sm:block"
          />
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {isEmpty ? (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)]">
                <Sparkles className="h-7 w-7" />
              </span>
              <p className="mt-4 text-[16px] font-semibold">
                How can I help you today?
              </p>
              <p className="mt-1 text-[13px] text-text-muted">
                Ask anything about your workspace, or start with a prompt.
              </p>
              <div className="mt-5 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setInput(p);
                      taRef.current?.focus();
                    }}
                    className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-left text-[12.5px] text-text-sub transition-colors hover:border-accent hover:text-text"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {messages.map((m) => (
                <MessageBubble
                  key={m._id}
                  role={m.role}
                  content={m.content}
                  tools={m.tools}
                />
              ))}
              {pendingUserMessage && (
                <MessageBubble role="user" content={pendingUserMessage} />
              )}
              {(streaming || streamingText) && (
                <MessageBubble
                  role="assistant"
                  content={streamingText}
                  pending
                  tools={toolSteps}
                />
              )}
            </div>
          )}
          {error && (
            <p className="mx-auto mt-4 max-w-3xl rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
              {error}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-5 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border bg-bg-subtle px-3 py-2 transition-colors focus-within:border-accent">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Message the assistant…"
              className="max-h-48 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-[1.5] outline-none placeholder:text-text-muted"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                title="Stop"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-bg-hover text-text transition-colors hover:bg-border"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim()}
                title="Send"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between px-1 text-[11px] text-text-muted">
            <span>Enter to send · Shift+Enter for a new line</span>
            {usage && (
              <span
                title="Messages remaining this minute"
                className={cn(usage.remaining === 0 && 'text-red')}
              >
                {usage.remaining}/{usage.limit} left
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationList({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: conversations, isLoading } = useConversations();
  const rename = useRenameConversation();
  const del = useDeleteConversation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    const title = draft.trim();
    if (title) rename.mutate({ id, title });
    setEditingId(null);
  };

  if (isLoading) {
    return (
      <p className="px-4 py-3 text-[12px] text-text-muted">Loading history…</p>
    );
  }
  if (!conversations?.length) {
    return (
      <p className="px-4 py-3 text-[12px] text-text-muted">No conversations yet</p>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3">
      {conversations.map((c) => {
        const active = c._id === activeId;
        const editing = c._id === editingId;
        return (
          <div
            key={c._id}
            className={cn(
              'group mb-0.5 flex items-center gap-1 rounded-md px-2 py-2 transition-colors',
              active ? 'bg-accent-50 dark:bg-[rgba(99,102,241,.15)]' : 'hover:bg-bg-hover',
            )}
          >
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(c._id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(c._id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 text-[12.5px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(c._id)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={cn(
                    'block truncate text-[12.5px]',
                    active
                      ? 'font-medium text-accent-700 dark:text-[var(--a-200)]'
                      : 'text-text-sub',
                  )}
                >
                  {c.title}
                </span>
                <span className="block text-[10.5px] text-text-muted">
                  {relTime(c.updatedAt)}
                </span>
              </button>
            )}
            {editing ? (
              <button
                type="button"
                title="Save"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(c._id)}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted hover:text-accent"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            ) : (
              <div className="flex flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  title="Rename"
                  onClick={() => {
                    setEditingId(c._id);
                    setDraft(c.title);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => del.mutate(c._id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
