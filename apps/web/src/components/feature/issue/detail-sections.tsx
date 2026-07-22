'use client';
import { CheckSquare, MessageSquare } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { MarkdownView } from '@/components/feature/issue/markdown-view';
import { relTime } from '@/lib/format';
import { cn } from '@prism/ui/cn';
import type { Issue, IssueTodo } from '@/schemas/issue';
import type { DirectoryUser } from '@/schemas/user';

/**
 * Section building blocks shared by the issue detail page
 * (`app/(app)/issues/[id]/page.tsx`) and the Issue Peek panel
 * (`issue-peek.tsx`). Extracted from the detail page so both surfaces render
 * from one source — never fork these (issue-peek spec §2.2).
 */

export function CardHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-text-muted">
      {icon}
      <span className="text-[11.5px] font-semibold text-text-muted uppercase tracking-wider">
        {title}
      </span>
      {children}
    </div>
  );
}

/** The `CardHeader` typography without the card border — for flat sections
 *  inside the peek, where the drawer itself is the card. */
export function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-text-muted">
      {icon}
      <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
        {children}
      </span>
    </div>
  );
}

export function SidebarRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover transition-colors duration-[var(--dur)]">
      <div className="w-[18px] h-[18px] flex items-center justify-center text-text-muted mt-px flex-shrink-0">
        {icon}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none">
          {label}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
      </div>
    </div>
  );
}

function ChecklistProgress({ done, total }: { done: number; total: number }) {
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="ml-auto flex items-center gap-2.5">
      <div className="w-24 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, backgroundColor: 'var(--a)' }}
        />
      </div>
      <span className="text-[11px] font-mono text-text-muted">
        {done}/{total}
      </span>
    </div>
  );
}

function ChecklistItems({ todos }: { todos: IssueTodo[] }) {
  return (
    <>
      {todos.map((todo) => (
        <div
          key={todo.id}
          className={cn(
            'flex items-center gap-3 px-2 py-2 rounded-lg transition-colors',
            todo.done ? 'opacity-55' : 'hover:bg-bg-hover',
          )}
        >
          <div
            className={cn(
              'w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0 border transition-colors',
              todo.done
                ? 'border-[var(--a)] bg-[var(--a)]'
                : 'border-border bg-bg-input',
            )}
          >
            {todo.done && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2 5l2.5 2.5L8 3"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <span
            className={cn(
              'text-[13px] leading-snug',
              todo.done ? 'line-through text-text-muted' : 'text-text',
            )}
          >
            {todo.text}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Checklist with progress bar. `variant="card"` is the detail-page chrome;
 * `variant="section"` is the flat peek chrome — same rows either way.
 * Renders nothing when there are no todos.
 */
export function IssueChecklist({
  todos,
  variant = 'card',
}: {
  todos: IssueTodo[];
  variant?: 'card' | 'section';
}) {
  const total = todos.length;
  if (total === 0) return null;
  const done = todos.filter((t) => t.done).length;

  if (variant === 'section') {
    return (
      <section aria-label="Checklist">
        <div className="flex items-center">
          <SectionLabel icon={<CheckSquare />}>Checklist</SectionLabel>
          <div className="mb-2 flex-1">
            <ChecklistProgress done={done} total={total} />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <ChecklistItems todos={todos} />
        </div>
      </section>
    );
  }

  return (
    <Card>
      <CardHeader icon={<CheckSquare />} title="Checklist">
        <ChecklistProgress done={done} total={total} />
      </CardHeader>
      <div className="px-4 py-2.5 flex flex-col gap-0.5">
        <ChecklistItems todos={todos} />
      </div>
    </Card>
  );
}

/** Comment list incl. the empty state; the composer stays with the caller. */
export function CommentThread({
  comments,
  users,
}: {
  comments: NonNullable<Issue['comments']>;
  users: DirectoryUser[];
}) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 gap-2 text-center">
        <MessageSquare className="w-8 h-8 text-border" />
        <p className="text-[13px] text-text-muted">No comments yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 mb-6">
      {comments.map((c, idx) => {
        const u = users.find((x) => x._id === String(c.authorId));
        return (
          <div key={idx} className="flex gap-3 group">
            <Avatar
              name={u?.name ?? '?'}
              src={u?.avatar}
              size="sm"
              className="mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="bg-bg-subtle border border-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-text">
                    {u?.name ?? '?'}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {relTime(c.createdAt)}
                  </span>
                </div>
                <div className="text-[13px]">
                  <MarkdownView body={c.body} users={users} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
