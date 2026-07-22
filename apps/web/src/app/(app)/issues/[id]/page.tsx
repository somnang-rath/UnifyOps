'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart2,
  Calendar,
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
import { Card } from '@/components/ui/card';
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
import {
  CardHeader,
  CommentThread,
  IssueChecklist,
  SidebarRow,
} from '@/components/feature/issue/detail-sections';
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
          <IssueChecklist todos={issue.todos ?? []} />

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
              <CommentThread comments={issue.comments ?? []} users={users} />

              {/* composer */}
              <div className="flex gap-3">
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
