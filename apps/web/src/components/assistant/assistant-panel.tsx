'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  History,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { MessageBubble } from '@/components/assistant/message-bubble';
import { PendingActionCard } from '@/components/assistant/pending-action-card';
import {
  useAssistantConfig,
  useAssistantUsage,
  useChat,
  useConversation,
  useConversations,
  useDeleteConversation,
} from '@/hooks/use-assistant';
import { useAssistantStore } from '@/stores/assistant-store';
import { cn } from '@/lib/utils';

const QUICK_PROMPTS = [
  'Summarize this',
  'Draft a reply',
  'Explain simply',
  'Find related tasks',
];

export function AssistantPanel() {
  const { data: config } = useAssistantConfig();
  const open = useAssistantStore((s) => s.open);
  const closePanel = useAssistantStore((s) => s.closePanel);
  const newConversation = useAssistantStore((s) => s.newConversation);
  const setActiveConversation = useAssistantStore(
    (s) => s.setActiveConversation,
  );
  const activeConversationId = useAssistantStore((s) => s.activeConversationId);

  const { data: detail } = useConversation(open ? activeConversationId : null);
  const { data: usage } = useAssistantUsage(open && !!config?.enabled);
  const {
    send,
    stop,
    streaming,
    streamingText,
    toolSteps,
    pendingActions,
    dismissPendingAction,
    pendingUserMessage,
    error,
  } = useChat();

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const messages = detail?.messages ?? [];
  const isEmpty =
    messages.length === 0 && !pendingUserMessage && !streamingText;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePanel]);

  // Auto-scroll to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streamingText, pendingUserMessage, open]);

  if (!open || !config?.enabled) return null;

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput('');
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] animate-fade-in"
        onClick={closePanel}
      />
      <aside
        role="dialog"
        aria-label="AI Assistant"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col',
          'border-l border-border bg-bg shadow-2xl animate-toast-in',
        )}
      >
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)]">
            <Bot className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold leading-tight truncate">
              {detail?.conversation.title ?? 'AI Assistant'}
            </p>
            <p className="text-[11px] text-text-muted truncate">
              {config.model || 'Assistant'}
            </p>
          </div>
          <HeaderButton
            title="New chat"
            onClick={() => {
              newConversation();
              setHistoryOpen(false);
            }}
          >
            <Plus className="h-4 w-4" />
          </HeaderButton>
          <div className="relative">
            <HeaderButton
              title="History"
              onClick={() => setHistoryOpen((v) => !v)}
              active={historyOpen}
            >
              <History className="h-4 w-4" />
            </HeaderButton>
            {historyOpen && (
              <HistoryMenu
                onSelect={(id) => {
                  setActiveConversation(id);
                  setHistoryOpen(false);
                }}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
          <HeaderButton title="Close" onClick={closePanel}>
            <X className="h-4 w-4" />
          </HeaderButton>
        </header>

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <EmptyState
              onPick={(p) => {
                setInput(p);
                taRef.current?.focus();
              }}
            />
          ) : (
            <div className="flex flex-col gap-4">
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
              {/* Tier C proposals (ADR 0015 §2.2). Rendered after the reply so
                  the user reads what the assistant said before deciding. */}
              {pendingActions.map((action, i) => (
                <PendingActionCard
                  key={`${action.kind}-${i}`}
                  action={action}
                  onDone={() => dismissPendingAction(i)}
                />
              ))}
            </div>
          )}
          {error && (
            <p className="mt-3 rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
              {error}
            </p>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-3 py-3">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-bg-subtle px-2 py-1.5 focus-within:border-accent transition-colors">
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
              placeholder="Ask the assistant…"
              className="flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-[1.5] outline-none placeholder:text-text-muted max-h-40"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                title="Stop"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-bg-hover text-text hover:bg-border transition-colors"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim()}
                title="Send"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-text-muted">
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
      </aside>
    </>
  );
}

function HeaderButton({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text',
        active && 'bg-bg-hover text-text',
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)]">
        <Bot className="h-6 w-6" />
      </span>
      <p className="mt-3 text-[14px] font-semibold">How can I help?</p>
      <p className="mt-1 max-w-[240px] text-[12px] text-text-muted">
        Ask about your projects, tasks, or wiki — or pick a starter below.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-full border border-border bg-bg-subtle px-3 py-1.5 text-[12px] text-text-sub transition-colors hover:border-accent hover:text-text"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryMenu({
  onSelect,
  onClose,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { data: conversations, isLoading } = useConversations();
  const del = useDeleteConversation();

  useEffect(() => {
    const onDocClick = () => onClose();
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-9 z-10 w-64 overflow-hidden rounded-lg border border-border bg-bg shadow-xl"
    >
      <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Conversations
      </p>
      <div className="max-h-72 overflow-y-auto py-1">
        {isLoading ? (
          <p className="px-3 py-2 text-[12px] text-text-muted">Loading…</p>
        ) : !conversations?.length ? (
          <p className="px-3 py-2 text-[12px] text-text-muted">No history yet</p>
        ) : (
          conversations.map((c) => (
            <div
              key={c._id}
              className="group flex items-center gap-2 px-2 py-1.5 hover:bg-bg-hover"
            >
              <button
                type="button"
                onClick={() => onSelect(c._id)}
                className="flex-1 min-w-0 text-left text-[12.5px] text-text-sub hover:text-text"
              >
                <span className="block truncate">{c.title}</span>
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => del.mutate(c._id)}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
