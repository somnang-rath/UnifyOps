import type { Issue } from '@/schemas/issue';
import type { DirectoryUser } from '@/schemas/user';
import { Avatar } from '@/components/ui/avatar';

/** The four canonical work-item statuses, in board/list order. */
export const STATUS_ORDER = ['todo', 'inprogress', 'review', 'done'] as const;
export type StatusId = (typeof STATUS_ORDER)[number];

export const STATUS_LABEL: Record<StatusId, string> = {
  todo: 'To do',
  inprogress: 'In progress',
  review: 'Review',
  done: 'Done',
};

export const STATUS_DOT: Record<StatusId, string> = {
  todo: 'bg-text-muted',
  inprogress: 'bg-amber',
  review: 'bg-blue',
  done: 'bg-green',
};

export type UserMap = Map<string, DirectoryUser>;

export interface ViewProps {
  projectId: string;
  issues: Issue[];
  userMap: UserMap;
}

/** Group issues by status, preserving STATUS_ORDER. Unknown statuses bucket into `todo`. */
export function groupByStatus(issues: Issue[]): Record<StatusId, Issue[]> {
  const groups: Record<StatusId, Issue[]> = {
    todo: [],
    inprogress: [],
    review: [],
    done: [],
  };
  for (const i of issues) {
    const s = (STATUS_ORDER as readonly string[]).includes(i.status)
      ? (i.status as StatusId)
      : 'todo';
    groups[s].push(i);
  }
  return groups;
}

export function AssigneeAvatar({
  issue,
  userMap,
}: {
  issue: Issue;
  userMap: UserMap;
}) {
  const u = issue.assigneeId ? userMap.get(issue.assigneeId) : null;
  if (!u) return null;
  return <Avatar name={u.name} src={u.avatar} size="sm" />;
}

/** Colour + overdue awareness for a due date relative to status. */
export function dueClass(dueDate: string | undefined, status: string): string {
  if (!dueDate) return 'text-text-muted';
  const overdue = new Date(dueDate) < new Date() && status !== 'done';
  return overdue ? 'text-red' : 'text-text-muted';
}
