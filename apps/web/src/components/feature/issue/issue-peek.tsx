'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart2,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderKanban,
  Link2,
  Maximize2,
  MessageSquare,
  Pencil,
  Tag,
  User,
  X,
} from 'lucide-react';
import { Drawer, ErrorState } from '@prism/ui';
import { Avatar } from '@/components/ui/avatar';
import { Button, IconButton } from '@/components/ui/button';
import { IssuePeekSkeleton } from '@/components/ui/skeleton';
import { useIssue, useIssueMutations } from '@/hooks/use-issues';
import { useUsers } from '@/hooks/use-users';
import { useProjects } from '@/hooks/use-projects';
import { IssueTypeIcon } from '@/components/feature/issue/icons';
import { Label, PriorityPill, StatusPill } from '@/components/feature/issue/pills';
import { IssueModal } from '@/components/feature/issue/issue-modal';
import {
  CommentComposer,
  CommentComposerActions,
} from '@/components/feature/issue/comment-composer';
import { MarkdownView } from '@/components/feature/issue/markdown-view';
import { IssueLinks } from '@/components/feature/issue/issue-links';
import {
  CommentThread,
  IssueChecklist,
  SectionLabel,
  SidebarRow,
} from '@/components/feature/issue/detail-sections';
import { relTime, fmtDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';

export interface IssuePeekProps {
  /** From `?peek=` — the list page owns the URL. */
  issueId: string;
  /** Strips `?peek` from the URL. */
  onClose: () => void;
  /** Replaces `?peek` with a sibling id. */
  onNavigate: (id: string) => void;
  /** Neighbors in the list's current sorted/grouped order; null at ends. */
  prevId: string | null;
  nextId: string | null;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Issue Peek panel (docs/plan/specs/issue-peek.md) — Plane-style side overlay
 * opened from the issues list without leaving it. The Drawer is the shell;
 * this component owns the issue data, sections, and mutations. Sections are
 * the same building blocks as the detail page (`detail-sections.tsx`) — one
 * source, never forked.
 */
export function IssuePeek({
  issueId,
  onClose,
  onNavigate,
  prevId,
  nextId,
}: IssuePeekProps) {
  const me = useAuthStore((s) => s.user);
  const titleId = 'issue-peek-title';
  const bodyRef = useRef<HTMLDivElement>(null);

  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // A malformed id (not 24-hex) never even fires the query (spec §4.2).
  const validId = OBJECT_ID.test(issueId);
  const { data: issue, isError, refetch } = useIssue(validId ? issueId : null);
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { comment: addComment } = useIssueMutations();

  const showError = !validId || isError;

  const author = useMemo(
    () => users.find((u) => u._id === issue?.authorId),
    [users, issue?.authorId],
  );
  const assignee = useMemo(
    () => (issue?.assigneeId ? users.find((u) => u._id === issue.assigneeId) : undefined),
    [users, issue?.assigneeId],
  );
  const project = useMemo(
    () => (issue?.projectId ? projects.find((p) => p._id === issue.projectId) : undefined),
    [projects, issue?.projectId],
  );

  const submitComment = () => {
    const body = comment.trim();
    if (!body) return;
    addComment.mutate({ id: issueId, body }, { onSuccess: () => setComment('') });
  };

  const copyLink = async () => {
    // The canonical URL, not the ?peek one — it works from anywhere.
    try {
      await navigator.clipboard.writeText(`${location.origin}/issues/${issueId}`);
    } catch {
      return;
    }
    toast('Link copied', 'success');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const go = (id: string | null) => {
    if (!id) return;
    onNavigate(id);
    // If the pressed nav button just became disabled (hit an end), focus falls
    // to <body> — move it back into the panel so keyboard nav keeps working.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) bodyRef.current?.focus();
    });
  };

  // ArrowUp/ArrowDown and j/k step through siblings — only when the event
  // originates inside the panel and not from a text input (spec §3.3).
  const handleKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.closest('input, textarea, select')) return;
    if ((e.key === 'ArrowDown' || e.key === 'j') && nextId) {
      e.preventDefault();
      go(nextId);
    } else if ((e.key === 'ArrowUp' || e.key === 'k') && prevId) {
      e.preventDefault();
      go(prevId);
    }
  };

  const header = showError ? (
    <>
      <div className="flex-1" />
      <IconButton size="sm" variant="ghost" aria-label="Close peek" onClick={onClose}>
        <X />
      </IconButton>
    </>
  ) : (
    <>
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Previous issue"
        disabled={!prevId || !issue}
        onClick={() => go(prevId)}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Next issue"
        disabled={!nextId || !issue}
        onClick={() => go(nextId)}
      >
        <ChevronDown />
      </IconButton>
      <span className="text-2xs font-mono text-text-muted">#{issueId.slice(-6)}</span>
      <div className="flex-1" />
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Copy link"
        disabled={!issue}
        onClick={copyLink}
      >
        {copied ? <Check className="text-green" /> : <Link2 />}
      </IconButton>
      {issue ? (
        <IconButton size="sm" variant="ghost" aria-label="Open full page" asChild>
          <Link href={`/issues/${issueId}`}>
            <Maximize2 />
          </Link>
        </IconButton>
      ) : (
        <IconButton size="sm" variant="ghost" aria-label="Open full page" disabled>
          <Maximize2 />
        </IconButton>
      )}
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Edit issue"
        disabled={!issue}
        onClick={() => setEditing(true)}
      >
        <Pencil />
      </IconButton>
      <IconButton size="sm" variant="ghost" aria-label="Close peek" onClick={onClose}>
        <X />
      </IconButton>
    </>
  );

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        modal={false}
        disableEscape={editing}
        header={header}
        onKeyDown={handleKeys}
        aria-labelledby={issue ? titleId : undefined}
        aria-label={issue ? undefined : 'Issue'}
      >
        {showError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5">
            <ErrorState
              message="This issue doesn't exist or you don't have access."
              onRetry={validId ? () => refetch() : undefined}
              className="py-0"
            />
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : !issue ? (
          <IssuePeekSkeleton />
        ) : (
          <div ref={bodyRef} tabIndex={-1} className="px-5 py-4 flex flex-col gap-5 outline-none">
            {/* title block */}
            <div className="flex items-start gap-3">
              <IssueTypeIcon type={issue.type} size={28} className="flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-lg font-semibold leading-snug text-text break-words"
                >
                  {issue.title}
                </h2>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-2xs text-text-muted">
                  <StatusPill status={issue.status} />
                  <PriorityPill priority={issue.priority} />
                  <span>
                    opened {relTime(issue.createdAt)} by {author?.name ?? '?'}
                  </span>
                </div>
              </div>
            </div>

            {/* properties — flat rows, no card chrome at this width */}
            <div className="flex flex-col border-y border-border py-1 -mx-2">
              <SidebarRow icon={<Activity className="w-3.5 h-3.5" />} label="Status">
                <StatusPill status={issue.status} />
              </SidebarRow>
              <SidebarRow icon={<BarChart2 className="w-3.5 h-3.5" />} label="Priority">
                <PriorityPill priority={issue.priority} />
              </SidebarRow>
              <SidebarRow icon={<IssueTypeIcon type={issue.type} size={18} />} label="Type">
                <span className="text-[13px] text-text capitalize">{issue.type}</span>
              </SidebarRow>
              <SidebarRow icon={<User className="w-3.5 h-3.5" />} label="Assignee">
                {assignee ? (
                  <div className="flex items-center gap-2">
                    <Avatar name={assignee.name} src={assignee.avatar} size="sm" />
                    <span className="text-[13px] text-text">{assignee.name}</span>
                  </div>
                ) : (
                  <span className="text-[13px] text-text-muted">Unassigned</span>
                )}
              </SidebarRow>
              <SidebarRow icon={<FolderKanban className="w-3.5 h-3.5" />} label="Project">
                {project ? (
                  <Link
                    href={`/projects/${project._id}`}
                    className="text-[13px] text-[var(--a)] hover:underline truncate"
                  >
                    {project.name}
                  </Link>
                ) : (
                  <span className="text-[13px] text-text-muted">None</span>
                )}
              </SidebarRow>
              <SidebarRow icon={<Calendar className="w-3.5 h-3.5" />} label="Due date">
                {issue.dueDate ? (
                  <span className="text-[13px] text-text">{fmtDate(issue.dueDate)}</span>
                ) : (
                  <span className="text-[13px] text-text-muted">Not set</span>
                )}
              </SidebarRow>
              {(issue.labels ?? []).length > 0 && (
                <SidebarRow icon={<Tag className="w-3.5 h-3.5" />} label="Labels">
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {issue.labels.map((l) => (
                      <Label key={l}>{l}</Label>
                    ))}
                  </div>
                </SidebarRow>
              )}
            </div>

            {/* description */}
            <section aria-label="Description">
              <SectionLabel icon={<FileText />}>Description</SectionLabel>
              {issue.desc?.trim() ? (
                <MarkdownView body={issue.desc} users={users} />
              ) : (
                <p className="text-sm text-text-muted italic">No description provided.</p>
              )}
            </section>

            {/* checklist — hidden entirely when empty */}
            <IssueChecklist todos={issue.todos ?? []} variant="section" />

            {/* sub-issues & relations */}
            <IssueLinks issueId={issue._id} />

            {/* comments */}
            <section aria-label="Comments">
              <SectionLabel icon={<MessageSquare />}>
                Comments
                {(issue.comments?.length ?? 0) > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-bg-subtle text-text-muted normal-case tracking-normal">
                    {issue.comments!.length}
                  </span>
                )}
              </SectionLabel>
              <CommentThread comments={issue.comments ?? []} users={users} />
              <CommentComposer
                authorName={me?.name ?? '?'}
                authorAvatar={me?.avatar}
                value={comment}
                onChange={setComment}
                onSubmit={submitComment}
                submitting={addComment.isPending}
                users={users}
              />
              <CommentComposerActions
                onCancel={() => setComment('')}
                onSubmit={submitComment}
                submitting={addComment.isPending}
                disabled={!comment.trim()}
              />
            </section>
          </div>
        )}
      </Drawer>

      {issue && (
        <IssueModal open={editing} issue={issue} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
