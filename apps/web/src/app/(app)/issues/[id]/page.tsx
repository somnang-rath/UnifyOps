'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart2,
  Calendar,
  CheckSquare,
  ChevronRight,
  Clock,
  FileText,
  FolderKanban,
  MessageSquare,
  Pencil,
  Tag,
  Trash2,
  User,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { useIssue, useIssueMutations } from '@/hooks/use-issues';
import { useAssistantContext } from '@/hooks/use-assistant-context';
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
import { relTime, fmtDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import { IssueDetailSkeleton } from '@/components/ui/skeleton';

export default function IssueDetailPage() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const me = useAuthStore((s) => s.user);

  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { data: issue, isLoading } = useIssue(id);
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { comment: addComment, remove } = useIssueMutations();

  // Ground the assistant on the issue currently open (AI assistant §12).
  useAssistantContext(
    issue
      ? {
          type: 'issue',
          id: issue._id,
          title: issue.title,
          text: issue.desc?.slice(0, 20000),
        }
      : null,
  );

  const submitComment = () => {
    const body = comment.trim();
    if (!body) return;
    addComment.mutate({ id, body }, { onSuccess: () => setComment('') });
  };

  const handleDelete = () => {
    remove.mutate(id, { onSuccess: () => router.push('/issues') });
  };

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

  const doneTodos = (issue?.todos ?? []).filter((t) => t.done).length;
  const totalTodos = (issue?.todos ?? []).length;
  const todoProgress = totalTodos > 0 ? Math.round((doneTodos / totalTodos) * 100) : 0;

  if (isLoading || !issue) return <IssueDetailSkeleton />;

  return (
    <div className="max-w-[1080px] mx-auto animate-fade-in">
      {/* breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12px] text-text-muted mb-5">
        <Link
          href="/issues"
          className="inline-flex items-center gap-1 hover:text-text transition-colors duration-[var(--dur)]"
        >
          <ArrowLeft className="w-3 h-3" />
          Issues
        </Link>
        <ChevronRight className="w-3 h-3 opacity-30" />
        <span className="text-text truncate max-w-[380px] font-medium">{issue.title}</span>
      </nav>

      {/* ── hero header ── */}
      <div className="bg-bg-card border border-border rounded-xl p-5 mb-5">
        <div className="flex items-start gap-4">
          <IssueTypeIcon type={issue.type} size={44} className="flex-shrink-0 mt-0.5" />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h1 className="text-[21px] font-bold tracking-[-0.02em] leading-snug text-text">
                {issue.title}
              </h1>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="outline" size="md" onClick={() => setEditing(true)}>
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button variant="danger" size="md" onClick={() => setConfirming(true)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <StatusPill status={issue.status} />
              <PriorityPill priority={issue.priority} />
              <span className="w-px h-3.5 bg-border" />
              <span className="text-[12px] font-mono text-text-muted">
                #{issue._id.slice(-6)}
              </span>
              <span className="text-[12px] text-text-muted">
                opened {relTime(issue.createdAt)} by{' '}
                <span className="text-text font-medium">{author?.name ?? '?'}</span>
              </span>
              {(issue.labels ?? []).length > 0 && (
                <>
                  <span className="w-px h-3.5 bg-border" />
                  <div className="flex items-center gap-1.5">
                    {issue.labels.map((l) => (
                      <Label key={l}>{l}</Label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── two-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_264px] gap-5 items-start">

        {/* ── LEFT ── */}
        <div className="flex flex-col gap-4">

          {/* description */}
          <Card>
            <CardHeader icon={<FileText />} title="Description" />
            <div className="px-5 py-4">
              {issue.desc?.trim() ? (
                <MarkdownView body={issue.desc} users={users} />
              ) : (
                <p className="text-[13px] text-text-muted italic">No description provided.</p>
              )}
            </div>
          </Card>

          {/* checklist */}
          {totalTodos > 0 && (
            <Card>
              <CardHeader icon={<CheckSquare />} title="Checklist">
                <div className="ml-auto flex items-center gap-2.5">
                  <div className="w-24 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${todoProgress}%`, backgroundColor: 'var(--a)' }}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-text-muted">
                    {doneTodos}/{totalTodos}
                  </span>
                </div>
              </CardHeader>
              <div className="px-4 py-2.5 flex flex-col gap-0.5">
                {(issue.todos ?? []).map((todo) => (
                  <div
                    key={todo.id}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg ${
                      todo.done ? 'opacity-55' : 'hover:bg-bg-hover'
                    } transition-colors`}
                  >
                    <div
                      className={`w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0 border transition-colors ${
                        todo.done
                          ? 'border-[var(--a)] bg-[var(--a)]'
                          : 'border-border bg-bg-input'
                      }`}
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
                      className={`text-[13px] leading-snug ${
                        todo.done ? 'line-through text-text-muted' : 'text-text'
                      }`}
                    >
                      {todo.text}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* sub-issues & relations */}
          <IssueLinks issueId={id} />

          {/* comments */}
          <Card>
            <CardHeader icon={<MessageSquare />} title="Comments">
              {(issue.comments?.length ?? 0) > 0 && (
                <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-subtle text-text-muted">
                  {issue.comments!.length}
                </span>
              )}
            </CardHeader>

            <div className="px-5 py-4">
              {(issue.comments ?? []).length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-center">
                  <MessageSquare className="w-8 h-8 text-border" />
                  <p className="text-[13px] text-text-muted">No comments yet. Be the first!</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 mb-6">
                  {(issue.comments ?? []).map((c, idx) => {
                    const u = users.find((x) => x._id === String(c.authorId));
                    return (
                      <div key={idx} className="flex gap-3 group">
                        <Avatar name={u?.name ?? '?'} src={u?.avatar} size="sm" className="mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="bg-bg-subtle border border-border rounded-xl px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[13px] font-semibold text-text">
                                {u?.name ?? '?'}
                              </span>
                              <span className="text-[11px] text-text-muted">
                                {relTime(c.createdAt as string)}
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
              )}

              {/* composer */}
              <div className="flex gap-3">
                {/* <Avatar name={me?.name ?? '?'} size="sm" className="mt-2 flex-shrink-0" /> */}
                <div className="flex-1 min-w-0">
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
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT sidebar ── */}
        <div className="flex flex-col gap-4">

          {/* Details */}
          <Card>
            <CardHeader icon={<Activity />} title="Details" />
            <div className="p-2">
              <SidebarRow icon={<Activity className="w-3.5 h-3.5" />} label="Status">
                <StatusPill status={issue.status} />
              </SidebarRow>
              <SidebarRow icon={<BarChart2 className="w-3.5 h-3.5" />} label="Priority">
                <PriorityPill priority={issue.priority} />
              </SidebarRow>
              <SidebarRow
                icon={<IssueTypeIcon type={issue.type} size={18} />}
                label="Type"
              >
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
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader icon={<Clock />} title="Timeline" />
            <div className="px-4 py-3.5 flex flex-col gap-3">
              <TimelineItem
                icon={<Clock className="w-3 h-3" />}
                label="Created"
                date={issue.createdAt}
              />
              <TimelineItem
                icon={<Clock className="w-3 h-3" />}
                label="Last updated"
                date={issue.updatedAt}
                last
              />
            </div>
          </Card>
        </div>
      </div>

      <IssueModal open={editing} issue={issue} onClose={() => setEditing(false)} />
      <Confirm
        open={confirming}
        title="Delete issue"
        body={`Are you sure you want to delete "${issue.title}"? This cannot be undone.`}
        danger
        onConfirm={handleDelete}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/* ── shared layout primitives ── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {children}
    </div>
  );
}

function CardHeader({
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

function SidebarRow({
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

function TimelineItem({
  icon,
  label,
  date,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  date: string;
  last?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className="w-5 h-5 rounded-full bg-bg-subtle border border-border flex items-center justify-center text-text-muted">
          {icon}
        </div>
        {!last && <div className="w-px h-3 bg-border" />}
      </div>
      <div className="flex-1 pb-1">
        <div className="text-[11px] font-medium text-text-muted mb-0.5">{label}</div>
        <div className="text-[12px] text-text">{fmtDate(date)}</div>
        <div className="text-[11px] text-text-muted">{relTime(date)}</div>
      </div>
    </div>
  );
}
