'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronDown, ChevronRight, Clock, Plus } from 'lucide-react';
import { PriorityPill } from '@/components/feature/issue/pills';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  AssigneeAvatar,
  dueClass,
  groupByStatus,
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_ORDER,
  type StatusId,
  type ViewProps,
} from './shared';

export function ListView({ projectId, issues, userMap }: ViewProps) {
  // This view only renders under /[workspaceSlug]/projects/[id] — issue links
  // stay inside the workspace instead of bouncing through the flat shim.
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const groups = groupByStatus(issues);
  const [collapsed, setCollapsed] = useState<Set<StatusId>>(new Set());

  const toggle = (s: StatusId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      {STATUS_ORDER.map((s) => {
        const rows = groups[s];
        const isCollapsed = collapsed.has(s);
        return (
          <section key={s}>
            <button
              onClick={() => toggle(s)}
              className="w-full flex items-center gap-2 px-1 py-1.5 text-left group"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
              )}
              <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[s])} />
              <span className="text-[13px] font-semibold">
                {STATUS_LABEL[s]}
              </span>
              <span className="text-[12px] text-text-muted">{rows.length}</span>
              <Link
                href={`/${slug}/issues?new=1&project=${projectId}&status=${s}`}
                onClick={(e) => e.stopPropagation()}
                className="ml-auto opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text transition-opacity"
                title="New work item"
              >
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </button>

            {!isCollapsed && (
              <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
                {rows.length === 0 ? (
                  <p className="px-4 py-3 text-[12.5px] text-text-muted">
                    No work items
                  </p>
                ) : (
                  rows.map((i) => (
                    <Link
                      key={i._id}
                      href={`/${slug}/issues/${i._id}`}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-bg-hover transition-colors"
                    >
                      <span className="flex-1 truncate text-[13px]">
                        {i.title}
                      </span>
                      {i.dueDate && (
                        <span
                          className={cn(
                            'flex items-center gap-1 text-[11px]',
                            dueClass(i.dueDate, i.status),
                          )}
                        >
                          <Clock className="w-3 h-3" />
                          {fmtDateShort(i.dueDate)}
                        </span>
                      )}
                      <PriorityPill priority={i.priority} />
                      <AssigneeAvatar issue={i} userMap={userMap} />
                    </Link>
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
