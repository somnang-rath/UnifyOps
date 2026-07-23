'use client';
import { useParams, useRouter } from 'next/navigation';
import { PriorityPill, StatusPill } from '@/components/feature/issue/pills';
import { Avatar } from '@/components/ui/avatar';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dueClass, type ViewProps } from './shared';

export function TableView({ issues, userMap }: ViewProps) {
  const router = useRouter();
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;

  if (issues.length === 0) {
    return (
      <p className="text-[13px] text-text-muted py-8 text-center">
        No work items yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="bg-bg-subtle text-text-muted text-[11px] uppercase tracking-wide">
            <Th className="text-left w-[45%]">Title</Th>
            <Th className="text-left">Status</Th>
            <Th className="text-left">Priority</Th>
            <Th className="text-left">Assignee</Th>
            <Th className="text-left">Due</Th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => {
            const a = i.assigneeId ? userMap.get(i.assigneeId) : null;
            return (
              <tr
                key={i._id}
                onClick={() => router.push(`/${slug}/issues/${i._id}`)}
                className="border-t border-border hover:bg-bg-hover cursor-pointer"
              >
                <td className="px-3 py-2.5 truncate max-w-0">{i.title}</td>
                <td className="px-3 py-2.5">
                  <StatusPill status={i.status} />
                </td>
                <td className="px-3 py-2.5">
                  <PriorityPill priority={i.priority} />
                </td>
                <td className="px-3 py-2.5">
                  {a ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={a.name} src={a.avatar} size="sm" />
                      <span className="truncate">{a.name}</span>
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 whitespace-nowrap',
                    dueClass(i.dueDate, i.status),
                  )}
                >
                  {i.dueDate ? fmtDateShort(i.dueDate) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={cn('px-3 py-2 font-semibold', className)}>{children}</th>;
}
