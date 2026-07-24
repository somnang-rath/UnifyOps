'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  BarChart3,
  Calendar,
  LayoutGrid,
  List,
  Plus,
  Table,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIssues } from '@/hooks/use-issues';
import { useUsers } from '@/hooks/use-users';
import { cn } from '@/lib/utils';
import { ListView } from './_components/list-view';
import { BoardView } from './_components/board-view';
import { TableView } from './_components/table-view';
import { CalendarView } from './_components/calendar-view';
import { TimelineView } from './_components/timeline-view';
import type { ViewProps } from './_components/shared';

type ViewId = 'list' | 'board' | 'calendar' | 'table' | 'timeline';

const VIEWS: { id: ViewId; label: string; Icon: typeof List }[] = [
  { id: 'list', label: 'List', Icon: List },
  { id: 'board', label: 'Board', Icon: LayoutGrid },
  { id: 'calendar', label: 'Calendar', Icon: Calendar },
  { id: 'table', label: 'Table', Icon: Table },
  { id: 'timeline', label: 'Timeline', Icon: BarChart3 },
];

const RENDER: Record<ViewId, (p: ViewProps) => React.ReactNode> = {
  list: (p) => <ListView {...p} />,
  board: (p) => <BoardView {...p} />,
  calendar: (p) => <CalendarView {...p} />,
  table: (p) => <TableView {...p} />,
  timeline: (p) => <TimelineView {...p} />,
};

export default function WorkItemsPage() {
  const { id: projectId, workspaceSlug } = useParams<{
    id: string;
    workspaceSlug: string;
  }>();
  const { data: issuesResp, isLoading } = useIssues({
    projectId,
    status: 'all',
  });
  const { data: users = [] } = useUsers();

  const [view, setViewRaw] = useState<ViewId>(() => {
    if (typeof window === 'undefined') return 'list';
    return (localStorage.getItem('wi-view') as ViewId) ?? 'list';
  });
  const setView = (v: ViewId) => {
    setViewRaw(v);
    localStorage.setItem('wi-view', v);
  };

  const issues = issuesResp?.items ?? [];
  const userMap = useMemo(() => new Map(users.map((u) => [u._id, u])), [users]);

  const viewProps: ViewProps = { projectId, issues, userMap };

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {/* View switcher */}
        <div className="inline-flex p-1 bg-bg-subtle border border-border rounded-sm">
          {VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[4px] text-[12.5px] font-medium transition-all',
                view === id
                  ? 'bg-bg text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted">
            {issues.length} item{issues.length === 1 ? '' : 's'}
          </span>
          <Button asChild variant="primary">
            <Link href={`/${workspaceSlug}/issues?new=1&project=${projectId}`}>
              <Plus /> Add work item
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-text-muted py-8 text-center">Loading…</p>
      ) : (
        RENDER[view](viewProps)
      )}
    </div>
  );
}
