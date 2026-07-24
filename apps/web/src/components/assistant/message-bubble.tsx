'use client';
import { Bot, Check, Loader2, User, Wrench, X } from 'lucide-react';
import { MarkdownView } from '@/components/feature/issue/markdown-view';
import { cn } from '@/lib/utils';
import {
  toolStepLabel,
  type AssistantToolCall,
  type ToolStep,
} from '@/schemas/assistant';

/**
 * Compact chips showing agentic tool activity — either in-flight `ToolStep`s
 * (during streaming) or a persisted `AssistantToolCall` trace on a past turn.
 */
export function ToolChips({
  steps,
}: {
  steps: (ToolStep | AssistantToolCall)[];
}) {
  if (steps.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {steps.map((s, i) => {
        const done = s.ok !== undefined;
        const failed = s.ok === false;
        return (
          <span
            key={'id' in s ? s.id : `${s.name}-${i}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              failed
                ? 'border-red/40 bg-red/10 text-red'
                : 'border-border bg-bg-subtle text-text-muted',
            )}
          >
            {!done ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : failed ? (
              <X className="h-3 w-3" />
            ) : (
              <Check className="h-3 w-3 text-green" />
            )}
            <Wrench className="h-2.5 w-2.5 opacity-60" />
            {toolStepLabel(s.name, done)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * One chat turn. User turns render as plain text; assistant turns render
 * markdown. `pending` shows a spinner while an assistant reply is still empty.
 * `tools` renders the agentic tool trace above the content.
 */
export function MessageBubble({
  role,
  content,
  pending,
  tools,
}: {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  tools?: (ToolStep | AssistantToolCall)[];
}) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-bg-hover text-text-muted'
            : 'bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)]',
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 max-w-[85%]">
        {!isUser && tools && tools.length > 0 && <ToolChips steps={tools} />}
        <div
          className={cn(
            'min-w-0 rounded-lg px-3 py-2 text-[13px]',
            isUser
              ? 'bg-accent text-white'
              : 'bg-bg-subtle text-text border border-border',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words leading-[1.5]">
              {content}
            </p>
          ) : content ? (
            <MarkdownView body={content} />
          ) : pending ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
