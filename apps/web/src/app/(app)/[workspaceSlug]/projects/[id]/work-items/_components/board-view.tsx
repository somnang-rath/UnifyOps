'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Clock,
  Copy,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { PriorityPill } from '@/components/feature/issue/pills';
import { useIssueMutations } from '@/hooks/use-issues';
import { useBoardMutations, useProject } from '@/hooks/use-projects';
import { Confirm } from '@/components/ui/confirm';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BoardList } from '@/schemas/project';
import type { Issue } from '@/schemas/issue';
import { AssigneeAvatar, dueClass, type ViewProps } from './shared';

/** Fallback columns for a project that has never customised its board. */
const DEFAULT_LISTS: BoardList[] = [
  { id: 'todo', name: 'To do', color: '#94a3b8', wipLimit: null, collapsed: false },
  { id: 'inprogress', name: 'In progress', color: '#f59e0b', wipLimit: null, collapsed: false },
  { id: 'review', name: 'Review', color: '#3b82f6', wipLimit: null, collapsed: false },
  { id: 'done', name: 'Done', color: '#10b981', wipLimit: null, collapsed: false },
];

const LIST_COLORS = [
  '#94a3b8', '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

const genId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'list_' + Math.random().toString(36).slice(2, 10);

export function BoardView({ projectId, issues, userMap }: ViewProps) {
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const { update, create } = useIssueMutations();
  const board = useBoardMutations(projectId);

  const lists = useMemo<BoardList[]>(
    () =>
      project?.boardLists && project.boardLists.length
        ? project.boardLists
        : DEFAULT_LISTS,
    [project?.boardLists],
  );

  // Bucket issues by their list id; any card whose status matches no list falls
  // into the first list so nothing ever disappears from the board.
  const grouped = useMemo(() => {
    const ids = new Set(lists.map((l) => l.id));
    const map = new Map<string, Issue[]>(lists.map((l) => [l.id, []]));
    const fallback = lists[0]?.id;
    for (const i of issues) {
      const key = ids.has(i.status) ? i.status : fallback;
      if (key) map.get(key)!.push(i);
    }
    return map;
  }, [issues, lists]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [addingCard, setAddingCard] = useState<string | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'clear' | 'delete'; list: BoardList } | null
  >(null);

  const commit = (next: BoardList[]) => board.updateBoard.mutate(next);
  const patchList = (id: string, patch: Partial<BoardList>) =>
    commit(lists.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const drop = (listId: string) => {
    if (dragId) {
      const issue = issues.find((i) => i._id === dragId);
      if (issue && issue.status !== listId)
        update.mutate({ id: dragId, body: { status: listId } });
    }
    setDragId(null);
    setOver(null);
  };

  const addCard = (listId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate({
      title: trimmed,
      desc: '',
      type: 'task',
      status: listId,
      priority: 'medium',
      projectId,
      labels: [],
      todos: [],
    });
  };

  const addList = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    commit([
      ...lists,
      { id: genId(), name: trimmed, color: '#94a3b8', wipLimit: null, collapsed: false },
    ]);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 items-start">
      {lists.map((list) => {
        const rows = grouped.get(list.id) ?? [];
        const overLimit = list.wipLimit != null && list.wipLimit > 0 && rows.length > list.wipLimit;

        if (list.collapsed) {
          return (
            <button
              key={list.id}
              onClick={() => patchList(list.id, { collapsed: false })}
              className="flex flex-col items-center gap-3 w-11 flex-shrink-0 rounded-lg border border-border bg-bg-subtle py-3 hover:border-accent"
              title={`Expand ${list.name}`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: list.color }}
              />
              <span className="text-[11px] text-text-muted">{rows.length}</span>
              <span
                className="text-[12px] font-semibold text-text whitespace-nowrap"
                style={{ writingMode: 'vertical-rl' }}
              >
                {list.name}
              </span>
            </button>
          );
        }

        return (
          <div
            key={list.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(list.id);
            }}
            onDrop={() => drop(list.id)}
            className={cn(
              'flex flex-col w-[280px] flex-shrink-0 rounded-lg border transition-colors',
              over === list.id
                ? 'border-accent bg-accent/5'
                : 'border-border bg-bg-subtle',
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: list.color }}
              />
              <span className="text-[12.5px] font-semibold truncate">
                {list.name}
              </span>
              <span
                className={cn(
                  'text-[11px]',
                  overLimit ? 'text-red font-semibold' : 'text-text-muted',
                )}
              >
                {rows.length}
                {list.wipLimit ? `/${list.wipLimit}` : ''}
              </span>
              <button
                onClick={() => setAddingCard(list.id)}
                className="ml-auto w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
                title="Add card"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <ListMenu
                list={list}
                onRename={(name) => patchList(list.id, { name })}
                onColor={(color) => patchList(list.id, { color })}
                onWipLimit={(wipLimit) => patchList(list.id, { wipLimit })}
                onCollapse={() => patchList(list.id, { collapsed: true })}
                onDuplicate={() =>
                  board.duplicateList.mutate({
                    listId: list.id,
                    name: `${list.name} (copy)`,
                  })
                }
                onClear={() => setConfirm({ kind: 'clear', list })}
                onDelete={() => setConfirm({ kind: 'delete', list })}
              />
            </div>

            <div className="flex flex-col gap-2 px-2 pb-2 min-h-[60px]">
              {rows.map((i) => (
                <Card
                  key={i._id}
                  issue={i}
                  userMap={userMap}
                  onDragStart={() => setDragId(i._id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onClick={() => router.push(`/issues/${i._id}`)}
                />
              ))}

              {addingCard === list.id ? (
                <QuickAdd
                  placeholder="Card title…"
                  onSubmit={(title) => addCard(list.id, title)}
                  onClose={() => setAddingCard(null)}
                />
              ) : (
                <button
                  onClick={() => setAddingCard(list.id)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-[12.5px] text-text-muted rounded hover:bg-bg-hover hover:text-text"
                >
                  <Plus className="w-3.5 h-3.5" /> Add a card
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Add list */}
      <div className="w-[280px] flex-shrink-0">
        {addingList ? (
          <div className="rounded-lg border border-accent bg-bg-subtle p-2">
            <QuickAdd
              placeholder="List name…"
              onSubmit={addList}
              onClose={() => setAddingList(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingList(true)}
            className="flex items-center gap-1.5 w-full px-3 py-2.5 text-[12.5px] font-medium text-text-muted rounded-lg border border-dashed border-border hover:border-accent hover:text-text"
          >
            <Plus className="w-3.5 h-3.5" /> Add list
          </button>
        )}
      </div>

      <Confirm
        open={confirm?.kind === 'clear'}
        title="Clear all cards?"
        danger
        body={`Delete every card in "${confirm?.list.name}". This cannot be undone.`}
        onConfirm={() => confirm && board.clearList.mutate(confirm.list.id)}
        onClose={() => setConfirm(null)}
      />
      <Confirm
        open={confirm?.kind === 'delete'}
        title="Delete list?"
        danger
        body={`Delete "${confirm?.list.name}" and all of its cards. This cannot be undone.`}
        onConfirm={() => confirm && board.deleteList.mutate(confirm.list.id)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function ListMenu({
  list,
  onRename,
  onColor,
  onWipLimit,
  onCollapse,
  onDuplicate,
  onClear,
  onDelete,
}: {
  list: BoardList;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  onWipLimit: (wipLimit: number | null) => void;
  onCollapse: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list.name);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_W = 256;
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Anchor the menu's right edge under the button, clamped into the viewport.
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    setPos({ top: r.bottom + 4, left });
    setOpen(true);
  };

  useEffect(() => setName(list.name), [list.name]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !menuRef.current?.contains(t) &&
        !btnRef.current?.contains(t)
      )
        setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== list.name) onRename(trimmed);
    else setName(list.name);
  };

  const close = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
        title="List options"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
            className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-bg shadow-lg p-3 flex flex-col gap-3"
          >
            <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitName();
              }
            }}
            className="w-full px-2.5 py-1.5 text-[13px] rounded-md border border-accent bg-bg-subtle outline-none"
          />

          <div>
            <p className="text-[10.5px] font-semibold tracking-wide text-text-muted mb-1.5">
              COLOR
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LIST_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onColor(c)}
                  style={{ background: c }}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                    list.color === c ? 'border-text' : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-semibold tracking-wide text-text-muted mb-1.5">
              WIP LIMIT
            </p>
            <input
              type="number"
              min={0}
              value={list.wipLimit ?? ''}
              placeholder="No limit"
              onChange={(e) => {
                const v = e.target.value;
                onWipLimit(v === '' ? null : Math.max(0, Number(v)));
              }}
              className="w-full px-2.5 py-1.5 text-[13px] rounded-md border border-border bg-bg-subtle outline-none focus:border-accent"
            />
          </div>

          <div className="h-px bg-border -mx-3" />

            <div className="flex flex-col text-[13px]">
              <MenuItem icon={ChevronRight} label="Collapse list" onClick={close(onCollapse)} />
              <MenuItem icon={Copy} label="Duplicate list" onClick={close(onDuplicate)} />
              <MenuItem icon={RotateCcw} label="Clear all cards" onClick={close(onClear)} />
              <MenuItem icon={Trash2} label="Delete list" danger onClick={close(onDelete)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-bg-hover text-left',
        danger ? 'text-red' : 'text-text',
      )}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function Card({
  issue,
  userMap,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  issue: Issue;
  userMap: ViewProps['userMap'];
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="group bg-bg-card border border-border rounded-md p-2.5 cursor-pointer hover:border-accent hover:shadow-sm transition-all"
    >
      <p className="text-[13px] leading-snug mb-2 line-clamp-3">{issue.title}</p>
      <div className="flex items-center gap-2">
        <PriorityPill priority={issue.priority} />
        {issue.dueDate && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              dueClass(issue.dueDate, issue.status),
            )}
          >
            <Clock className="w-3 h-3" />
            {fmtDateShort(issue.dueDate)}
          </span>
        )}
        <span className="ml-auto">
          <AssigneeAvatar issue={issue} userMap={userMap} />
        </span>
      </div>
    </div>
  );
}

function QuickAdd({
  placeholder,
  onSubmit,
  onClose,
}: {
  placeholder: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const submit = () => {
    if (title.trim()) onSubmit(title);
    setTitle('');
    onClose();
  };
  return (
    <div className="bg-bg-card border border-accent rounded-md p-2">
      <textarea
        autoFocus
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={submit}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-[13px] leading-snug outline-none placeholder:text-text-muted"
      />
    </div>
  );
}
