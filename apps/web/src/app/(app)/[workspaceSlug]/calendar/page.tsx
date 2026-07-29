'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useCalendarIssues, useIssueMutations } from '@/hooks/use-issues';
import { useLayoutParam } from '@/hooks/use-layout-param';
import { useUsers } from '@/hooks/use-users';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import {
  buildCalendarMonth,
  buildCalendarWeek,
  fmtDateShort,
  isoDay,
  monthLabel,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';
import { IssueModal } from '@/components/feature/issue/issue-modal';

const TYPE_META: Record<Issue['type'], { color: string; label: string }> = {
  bug: { color: '#ef4444', label: 'Bug' },
  feature: { color: '#f59e0b', label: 'Feature' },
  task: { color: '#22c55e', label: 'Task' },
  docs: { color: '#3b82f6', label: 'Docs' },
};

const CAL_VIEWS = ['month', 'week'] as const;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayIso = () => isoDay(new Date());

export default function CalendarPage() {
  const me = useAuthStore((s) => s.user)!;
  // Workspace from the URL — the `[workspaceSlug]` layout already resolved
  // this slug (cache-shared query), same pattern as the analytics page.
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const { data: workspace } = useWorkspaceBySlug(slug ?? null);
  const { data: users = [] } = useUsers();
  const issueMut = useIssueMutations();

  // ADR 0011 §4 — `?layout=month|week`, remembered in `prism_cal_view`. The
  // type/assignee filters stay local: only the layout was reserved a param.
  const [view, setView] = useLayoutParam(
    CAL_VIEWS,
    'month',
    'prism_cal_view',
  );
  const [anchor, setAnchor] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState<string>(() =>
    typeof window !== 'undefined'
      ? (localStorage.getItem('prism_cal_type') ?? '')
      : '',
  );
  const [assignee, setAssignee] = useState<string>(() =>
    typeof window !== 'undefined'
      ? (localStorage.getItem('prism_cal_assignee') ?? '')
      : '',
  );
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [dayPopover, setDayPopover] = useState<{
    iso: string;
    left: number;
    top: number;
  } | null>(null);

  const dragId = useRef<string | null>(null);

  useEffect(() => { localStorage.setItem('prism_cal_type', typeFilter); }, [typeFilter]);
  useEffect(() => { localStorage.setItem('prism_cal_assignee', assignee); }, [assignee]);

  const cells = useMemo(
    () =>
      view === 'month'
        ? buildCalendarMonth(anchor.getFullYear(), anchor.getMonth())
        : buildCalendarWeek(anchor),
    [view, anchor],
  );
  const from = cells[0].iso;
  const to = cells[cells.length - 1].iso;

  // ADR 0011 §2: scoped to this workspace's readable projects.
  const { data: allIssues = [] } = useCalendarIssues(from, to, workspace?.id);

  const issues = useMemo(
    () =>
      allIssues.filter((i) => {
        if (typeFilter && i.type !== typeFilter) return false;
        if (assignee === 'me') return i.assigneeId === me.id;
        if (assignee) return i.assigneeId === assignee;
        return true;
      }),
    [allIssues, typeFilter, assignee, me.id],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!i.dueDate) continue;
      const k = i.dueDate.slice(0, 10);
      const arr = map.get(k) ?? [];
      arr.push(i);
      map.set(k, arr);
    }
    // Stable sort: not-done first, then by priority weight
    const w: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const arr of map.values())
      arr.sort(
        (a, b) =>
          Number(a.status === 'done') - Number(b.status === 'done') ||
          (w[a.priority] ?? 9) - (w[b.priority] ?? 9),
      );
    return map;
  }, [issues]);

  // Summary counts for the visible range
  const tIso = todayIso();
  const counts = useMemo(() => {
    let due = 0;
    let overdue = 0;
    let done = 0;
    for (const i of issues) {
      if (!i.dueDate) continue;
      due++;
      if (i.status === 'done') done++;
      else if (i.dueDate.slice(0, 10) < tIso) overdue++;
    }
    return { due, overdue, done };
  }, [issues, tIso]);

  const userMap = useMemo(
    () =>
      new Map(
        users
          .filter((u): u is typeof u & { _id: string } => !!u._id)
          .map((u) => [u._id, u]),
      ),
    [users],
  );

  const step = (delta: number) => {
    const d = new Date(anchor);
    if (view === 'month') d.setMonth(d.getMonth() + delta);
    else d.setDate(d.getDate() + delta * 7);
    setAnchor(d);
  };

  const rangeLabel =
    view === 'month'
      ? monthLabel(anchor)
      : `${fmtDateShort(cells[0].iso)} – ${fmtDateShort(cells[6].iso)}, ${cells[6].date.getFullYear()}`;

  const reschedule = (issueId: string, iso: string) => {
    const issue = allIssues.find((i) => i._id === issueId);
    if (!issue || issue.dueDate?.slice(0, 10) === iso) return;
    issueMut.update.mutate(
      { id: issueId, body: { dueDate: `${iso}T00:00:00.000Z` } },
      {
        onSuccess: () => toast('Moved to ' + fmtDateShort(iso), 'success'),
        onError: () => toast("Couldn't reschedule", 'error'),
      },
    );
  };

  const popoverItems = dayPopover ? (byDate.get(dayPopover.iso) ?? []) : [];

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Calendar
          </h1>
          <p className="text-[13px] text-text-muted mt-1 flex items-center gap-2 flex-wrap">
            <span>
              <strong className="text-text-sub">{counts.due}</strong> due
            </span>
            {counts.overdue > 0 && (
              <span className="text-red font-medium">
                · {counts.overdue} overdue
              </span>
            )}
            {counts.done > 0 && (
              <span className="text-green">· {counts.done} done</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Month / Week segmented toggle */}
          <div className="cal-seg">
            <button
              type="button"
              className={cn('cal-seg-btn', view === 'month' && 'active')}
              onClick={() => setView('month')}
            >
              Month
            </button>
            <button
              type="button"
              className={cn('cal-seg-btn', view === 'week' && 'active')}
              onClick={() => setView('week')}
            >
              Week
            </button>
          </div>

          <Select
            inline
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: '', label: 'All types' },
              ...(Object.keys(TYPE_META) as Issue['type'][]).map((t) => ({
                value: t,
                label: TYPE_META[t].label,
              })),
            ]}
          />
          <Select
            inline
            value={assignee}
            onValueChange={setAssignee}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'me', label: 'My tasks' },
              ...users
                .filter(
                  (u): u is typeof u & { _id: string } =>
                    !!u._id && u._id !== me.id,
                )
                .map((u) => ({ value: u._id, label: u.name })),
            ]}
          />

          <div className="cal-nav">
            <button
              type="button"
              className="cal-nav-btn"
              onClick={() => step(-1)}
              aria-label="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <strong className="cal-nav-label">{rangeLabel}</strong>
            <button
              type="button"
              className="cal-nav-btn"
              onClick={() => step(1)}
              aria-label="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreatingDate(tIso)}
          >
            <Plus className="w-3.5 h-3.5" /> New task
          </Button>
        </div>
      </div>

      {/* Calendar */}
      <div className="cal-wrap">
        <div className="cal-grid cal-head">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={cn('cal-head-cell', (i === 0 || i === 6) && 'weekend')}
            >
              {d}
            </div>
          ))}
        </div>

        <div className={cn('cal-grid cal-body', view === 'week' && 'cal-body-week')}>
          {cells.map((cell, idx) => {
            const items = byDate.get(cell.iso) ?? [];
            const cap = view === 'month' ? 3 : items.length;
            const visible = items.slice(0, cap);
            const more = items.length - visible.length;
            const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
            return (
              <div
                key={`${cell.iso}-${idx}`}
                className={cn(
                  'cal-cell',
                  cell.otherMonth && 'other',
                  cell.today && 'is-today',
                  weekend && 'weekend',
                )}
                onClick={() => setCreatingDate(cell.iso)}
                onDragOver={(e) => {
                  if (!dragId.current) return;
                  e.preventDefault();
                  e.currentTarget.classList.add('drop');
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('drop');
                  const id = e.dataTransfer.getData('text/plain');
                  if (id) reschedule(id, cell.iso);
                  dragId.current = null;
                }}
              >
                <div className="cal-cell-head">
                  <span className={cn('cal-daynum', cell.today && 'today')}>
                    {cell.date.getDate()}
                  </span>
                  {!cell.otherMonth && (
                    <button
                      type="button"
                      className="cal-add-btn"
                      title="New task"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCreatingDate(cell.iso);
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="cal-events">
                  {visible.map((i) => {
                    const meta = TYPE_META[i.type];
                    const done = i.status === 'done';
                    const overdue = !done && i.dueDate!.slice(0, 10) < tIso;
                    return (
                      <a
                        key={i._id}
                        role="button"
                        tabIndex={0}
                        draggable
                        title={`${i.title}${overdue ? ' · overdue' : ''}`}
                        className={cn(
                          'cal-event',
                          done && 'done',
                          overdue && 'overdue',
                        )}
                        style={{ ['--ev' as string]: meta.color } as object}
                        onClick={(e) => {
                          e.stopPropagation();
                          location.assign(`/${slug}/issues/${i._id}`);
                        }}
                        onDragStart={(e) => {
                          dragId.current = i._id;
                          e.stopPropagation();
                          e.dataTransfer.setData('text/plain', i._id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                        }}
                      >
                        <span className="cal-event-dot" />
                        <span className="cal-event-title">{i.title}</span>
                        {i.assigneeId && userMap.get(i.assigneeId) && (
                          <Avatar
                            name={userMap.get(i.assigneeId)!.name}
                            src={userMap.get(i.assigneeId)!.avatar}
                            size="sm"
                            className="cal-event-avatar !w-4 !h-4 !text-[8px]"
                          />
                        )}
                      </a>
                    );
                  })}
                  {more > 0 && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        const left = Math.min(r.left, window.innerWidth - 300);
                        const top = Math.min(r.bottom + 4, window.innerHeight - 320);
                        setDayPopover({ iso: cell.iso, left, top });
                      }}
                    >
                      +{more} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="cal-legend">
        {(Object.keys(TYPE_META) as Issue['type'][]).map((t) => (
          <span key={t} className="cal-legend-item">
            <span
              className="cal-legend-dot"
              style={{ background: TYPE_META[t].color }}
            />
            {TYPE_META[t].label}
          </span>
        ))}
        <span className="cal-legend-item text-text-muted">
          Tip: drag a task to another day to reschedule
        </span>
      </div>

      {/* Day popover */}
      {dayPopover && (
        <>
          <div className="cal-pop-backdrop" onClick={() => setDayPopover(null)} />
          <div
            className="cal-pop"
            style={{ left: dayPopover.left, top: dayPopover.top }}
          >
            <div className="cal-pop-head">
              <strong>
                {new Date(dayPopover.iso + 'T00:00:00').toLocaleDateString(
                  undefined,
                  { weekday: 'long', month: 'short', day: 'numeric' },
                )}
              </strong>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() => setDayPopover(null)}
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="cal-pop-list">
              {popoverItems.map((i) => {
                const meta = TYPE_META[i.type];
                const done = i.status === 'done';
                const overdue = !done && i.dueDate!.slice(0, 10) < tIso;
                return (
                  <a
                    key={i._id}
                    role="button"
                    className={cn('cal-event', done && 'done', overdue && 'overdue')}
                    style={{ ['--ev' as string]: meta.color } as object}
                    onClick={() => location.assign(`/${slug}/issues/${i._id}`)}
                  >
                    <span className="cal-event-dot" />
                    <span className="cal-event-title">{i.title}</span>
                    {i.assigneeId && userMap.get(i.assigneeId) && (
                      <Avatar
                        name={userMap.get(i.assigneeId)!.name}
                        src={userMap.get(i.assigneeId)!.avatar}
                        size="sm"
                        className="cal-event-avatar"
                      />
                    )}
                  </a>
                );
              })}
            </div>
            <button
              type="button"
              className="cal-pop-add"
              onClick={() => {
                setCreatingDate(dayPopover.iso);
                setDayPopover(null);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> New task on this day
            </button>
          </div>
        </>
      )}

      <IssueModal
        open={!!creatingDate}
        defaultStatus="todo"
        issue={
          creatingDate
            ? ({
                _id: '',
                title: '',
                desc: '',
                type: 'task',
                status: 'todo',
                priority: 'medium',
                authorId: '',
                labels: [],
                createdAt: '',
                updatedAt: '',
                dueDate: `${creatingDate}T00:00:00.000Z`,
              } as Issue)
            : null
        }
        onClose={() => setCreatingDate(null)}
      />
    </>
  );
}
