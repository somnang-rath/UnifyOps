'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Layers,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Confirm } from '@/components/ui/confirm';
import {
  useBoard,
  useKanbanMutations,
  usePositions,
} from '@/hooks/use-kanban';
import { useIssueMutations, useIssues } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { KB_COLORS, colorHex, type BoardColumn } from '@/schemas/kanban';
import { IssueTypeIcon } from '@/components/feature/issue/icons';
import { IssueModal } from '@/components/feature/issue/issue-modal';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';

// Fallback labels (mirrors app.js `labelFor` cross-role fallback list)
const FALLBACK_LABELS: Record<string, string> = {
  todo: 'Backlog',
  inprogress: 'In progress',
  review: 'In review',
  done: 'Done',
  design: 'In Design',
  ready: 'Ready to Publish',
  discovery: 'Discovery',
};

const newColumnId = () => 'l_' + Math.random().toString(36).slice(2, 8);

interface PopAnchor {
  left: number;
  top: number;
}

type ConfirmAction =
  | {
      kind: 'list-delete';
      listId: string;
      listName: string;
      cardCount: number;
      fallbackName: string;
    }
  | { kind: 'list-clear'; listId: string; listName: string }
  | { kind: 'card-delete'; issueId: string; title: string };

export default function KanbanPage() {
  const me = useAuthStore((s) => s.user)!;
  const router = useRouter();

  const [projectId, setProjectId] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('prism_kb_project') ?? '') : '',
  );
  const [assignee, setAssignee] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('prism_kb_assignee') ?? 'me') : 'me',
  );
  const [labelFilter, setLabelFilter] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('prism_kb_label') ?? '') : '',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [density, setDensity] = useState<'comfy' | 'compact'>(() =>
    typeof window !== 'undefined'
      ? ((localStorage.getItem('prism_kb_density') as 'comfy' | 'compact') ?? 'comfy')
      : 'comfy',
  );
  const [creating, setCreating] = useState<string | null>(null);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bulk select (shift/cmd+click). Stays empty until the user starts selecting.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Active card for keyboard navigation
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const [inlineAddListId, setInlineAddListId] = useState<string | null>(null);
  const [inlineAddText, setInlineAddText] = useState('');

  const [listMenu, setListMenu] = useState<{
    listId: string;
    anchor: PopAnchor;
  } | null>(null);
  const [cardMenu, setCardMenu] = useState<{
    issueId: string;
    anchor: PopAnchor;
  } | null>(null);
  const [addListAnchor, setAddListAnchor] = useState<PopAnchor | null>(null);
  const [addListName, setAddListName] = useState('');
  const [bulkMoveAnchor, setBulkMoveAnchor] = useState<PopAnchor | null>(null);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // Persist filter selections across navigation
  useEffect(() => { localStorage.setItem('prism_kb_project', projectId); }, [projectId]);
  useEffect(() => { localStorage.setItem('prism_kb_assignee', assignee); }, [assignee]);
  useEffect(() => { localStorage.setItem('prism_kb_label', labelFilter); }, [labelFilter]);
  useEffect(() => { localStorage.setItem('prism_kb_density', density); }, [density]);

  // _dragId / _listDragId mirrors of the demo's module-level vars
  const dragIssueId = useRef<string | null>(null);
  const dragListId = useRef<string | null>(null);

  // Snapshot of the data the keyboard handler needs. Updated each render
  // (refs don't trigger re-renders) so the handler is always reading the
  // latest grouping without having to depend on every state slice.
  const navStateRef = useRef<{
    columns: BoardColumn[];
    grouped: Map<string, Issue[]>;
    fallbackId?: string;
    readonly: boolean;
  }>({ columns: [], grouped: new Map(), fallbackId: undefined, readonly: false });

  const viewedUserId =
    assignee && assignee !== 'me' && assignee !== '' ? assignee : me.id;
  const readonly = viewedUserId !== me.id;

  const { data: board } = useBoard(viewedUserId);
  const { data: positions = {} } = usePositions(viewedUserId);
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  // For "My tasks" we DON'T send assigneeId to the server — instead we
  // filter client-side to (mine || unassigned). This way an issue created
  // without an assignee still shows up on your own board.
  const { data: issuesResp } = useIssues({
    status: 'all',
    projectId: projectId || undefined,
    assigneeId: assignee && assignee !== 'me' ? assignee : undefined,
  });

  const { saveColumns, setPosition } = useKanbanMutations();
  const issueMut = useIssueMutations();

  const userMap = useMemo(
    () =>
      new Map(
        users
          .filter((u): u is typeof u & { _id: string } => !!u._id)
          .map((u) => [u._id, u]),
      ),
    [users],
  );
  const viewedUser = userMap.get(viewedUserId) ?? me;
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p._id, p.name])),
    [projects],
  );
  const isAdmin = me.role === 'admin';

  // Raw list (already filtered server-side by project / specific assignee).
  // We layer client-side filters on top so they update instantly.
  const allCards = issuesResp?.items ?? [];
  const cards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCards.filter((i) => {
      // "My tasks" — include mine + unassigned (defense against missing assignee)
      if (assignee === 'me') {
        if (i.assigneeId && i.assigneeId !== me.id) return false;
      }
      if (labelFilter && !(i.labels ?? []).includes(labelFilter)) return false;
      if (q) {
        const hay = (i.title + ' ' + (i.desc ?? '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allCards, assignee, labelFilter, searchQuery, me.id]);

  // Union of labels for the label-filter dropdown
  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of allCards) for (const l of i.labels ?? []) set.add(l);
    return [
      { value: '', label: 'All labels' },
      ...[...set].sort().map((l) => ({ value: l, label: l })),
    ];
  }, [allCards]);

  // Outside-click + Escape closes popovers
  useEffect(() => {
    if (!listMenu && !cardMenu && !addListAnchor && !bulkMoveAnchor) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-kb-popover]')) return;
      if (t.closest('[data-kb-pop-anchor]')) return;
      setListMenu(null);
      setCardMenu(null);
      setAddListAnchor(null);
      setBulkMoveAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setListMenu(null);
        setCardMenu(null);
        setAddListAnchor(null);
        setBulkMoveAnchor(null);
      }
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [listMenu, cardMenu, addListAnchor, bulkMoveAnchor]);

  // Global keyboard shortcuts. Reads latest grouping from navStateRef so the
  // effect doesn't need to re-bind on every render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable);
      const { columns: cols, grouped: g, fallbackId: fb, readonly: ro } =
        navStateRef.current;

      // '/' focuses search even from outside fields
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (inField) return;

      // 'c' opens new-issue modal (board owner only)
      if ((e.key === 'c' || e.key === 'C') && !ro && fb) {
        e.preventDefault();
        setCreating(fb);
        return;
      }

      // Active-card navigation
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Enter' ||
        e.key === 'Delete' ||
        e.key === 'Backspace'
      ) {
        if (!cols.length) return;

        // Build flat list grouped by column for easy navigation
        const colsOpen = cols.filter((c) => !c.collapsed);
        const findCol = (id: string | null) => {
          for (let ci = 0; ci < colsOpen.length; ci++) {
            const items = g.get(colsOpen[ci].id) ?? [];
            const ri = id ? items.findIndex((i) => i._id === id) : -1;
            if (ri >= 0) return { ci, ri, items };
          }
          return null;
        };

        setActiveCardId((current) => {
          // Open a card on Enter
          if (e.key === 'Enter') {
            if (current) {
              e.preventDefault();
              router.push(`/issues/${current}`);
            }
            return current;
          }

          // Delete: confirm bulk if multi-selected, else delete active
          if (e.key === 'Delete' || e.key === 'Backspace') {
            if (ro) return current;
            if (selected.size > 0) {
              e.preventDefault();
              setConfirmAction({
                kind: 'card-delete',
                issueId: '__bulk__',
                title: `${selected.size} cards`,
              });
              return current;
            }
            if (current) {
              const c = (cards as Issue[]).find((x) => x._id === current);
              if (c) {
                e.preventDefault();
                setConfirmAction({
                  kind: 'card-delete',
                  issueId: c._id,
                  title: c.title,
                });
              }
            }
            return current;
          }

          // Bootstrap: if no active card, pick first card of first column
          if (!current) {
            for (const c of colsOpen) {
              const items = g.get(c.id) ?? [];
              if (items[0]) {
                e.preventDefault();
                return items[0]._id;
              }
            }
            return current;
          }

          const at = findCol(current);
          if (!at) return current;
          e.preventDefault();

          if (e.key === 'ArrowUp') {
            return at.ri > 0 ? at.items[at.ri - 1]._id : current;
          }
          if (e.key === 'ArrowDown') {
            return at.ri < at.items.length - 1
              ? at.items[at.ri + 1]._id
              : current;
          }
          if (e.key === 'ArrowLeft') {
            for (let ci = at.ci - 1; ci >= 0; ci--) {
              const items = g.get(colsOpen[ci].id) ?? [];
              if (items.length)
                return items[Math.min(at.ri, items.length - 1)]._id;
            }
            return current;
          }
          // ArrowRight
          for (let ci = at.ci + 1; ci < colsOpen.length; ci++) {
            const items = g.get(colsOpen[ci].id) ?? [];
            if (items.length)
              return items[Math.min(at.ri, items.length - 1)]._id;
          }
          return current;
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router, selected, cards]);

  if (!board) return <div className="h-[60vh]" />;

  const columns = board.columns;
  const validColumns = new Set(columns.map((c) => c.id));
  const fallbackId =
    columns.find((c) => !c.collapsed)?.id ?? columns[0]?.id;
  const columnFor = (i: Issue) => {
    const c = positions[i._id] ?? i.status;
    return validColumns.has(c) ? c : fallbackId;
  };
  const labelFor = (id: string) =>
    columns.find((c) => c.id === id)?.name ?? FALLBACK_LABELS[id] ?? id;

  const grouped = new Map<string, Issue[]>();
  for (const c of columns) grouped.set(c.id, []);
  for (const i of cards) {
    const col = columnFor(i);
    if (col) grouped.get(col)?.push(i);
  }

  // Keep the keyboard handler's view of the world current.
  navStateRef.current = { columns, grouped, fallbackId, readonly };

  const errorMsg = (e: unknown, fallback = 'Something went wrong') =>
    toast(
      (e as any)?.response?.data?.message ||
        (e as any)?.message ||
        fallback,
      'error',
    );

  // ---- Column mutations (persisted via PATCH /kanban/board/me) ----
  const persistColumns = (next: BoardColumn[]) => {
    saveColumns.mutate(next, {
      onError: (e) => errorMsg(e, "Couldn't save board"),
    });
  };

  const updateList = (id: string, patch: Partial<BoardColumn>) => {
    persistColumns(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const moveList = (srcId: string, targetId: string, before: boolean) => {
    if (!srcId || !targetId || srcId === targetId) return;
    const next = [...columns];
    const from = next.findIndex((l) => l.id === srcId);
    if (from < 0) return;
    const [moved] = next.splice(from, 1);
    const to = next.findIndex((l) => l.id === targetId);
    if (to < 0) next.push(moved);
    else next.splice(before ? to : to + 1, 0, moved);
    persistColumns(next);
  };

  const toggleCollapse = (id: string) => {
    const l = columns.find((c) => c.id === id);
    if (!l) return;
    updateList(id, { collapsed: !l.collapsed });
  };

  const duplicateList = (id: string) => {
    const idx = columns.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const src = columns[idx];
    const dup: BoardColumn = {
      id: newColumnId(),
      name: src.name + ' copy',
      color: src.color,
      collapsed: false,
      builtin: false,
    };
    const next = [...columns];
    next.splice(idx + 1, 0, dup);
    persistColumns(next);
    toast('List duplicated', 'success');
  };

  const addList = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    persistColumns([
      ...columns,
      {
        id: newColumnId(),
        name: trimmed,
        color: 'indigo',
        collapsed: false,
        builtin: false,
      },
    ]);
    toast('List added', 'success');
  };

  const deleteList = (id: string) => {
    if (columns.length <= 1) {
      toast('Cannot delete the last list', 'error');
      return;
    }
    persistColumns(columns.filter((c) => c.id !== id));
    toast('List deleted', 'success');
  };

  const clearList = (id: string) => {
    const items = grouped.get(id) ?? [];
    Promise.all(items.map((i) => issueMut.remove.mutateAsync(i._id)))
      .then(() => toast('Cards cleared', 'success'))
      .catch((e) => errorMsg(e, "Couldn't clear all cards"));
  };

  // ---- Card mutations (positions via PATCH /kanban/positions/me) ----
  const moveCardTo = (issueId: string, columnId: string) => {
    setPosition.mutate(
      { issueId, columnId },
      {
        onSuccess: () => toast('Moved to ' + labelFor(columnId), 'success'),
        onError: (e) => errorMsg(e, "Couldn't move card"),
      },
    );
  };

  const clearSelection = () => setSelected(new Set());

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => issueMut.remove.mutateAsync(id)));
      clearSelection();
      toast(`${ids.length} card${ids.length === 1 ? '' : 's'} deleted`, 'success');
    } catch (e) {
      errorMsg(e, "Couldn't delete some cards");
    }
  };

  const bulkMove = async (columnId: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await Promise.all(
        ids.map((id) =>
          setPosition.mutateAsync({ issueId: id, columnId }),
        ),
      );
      clearSelection();
      toast(`${ids.length} moved to ${labelFor(columnId)}`, 'success');
    } catch (e) {
      errorMsg(e, "Couldn't move some cards");
    }
  };

  const assignIssue = (issueId: string, assigneeId: string | null) => {
    const u = assigneeId ? userMap.get(assigneeId) : null;
    issueMut.update.mutate(
      { id: issueId, body: { assigneeId: assigneeId || null } },
      {
        onSuccess: () =>
          toast(u ? `Assigned to ${u.name}` : 'Unassigned', 'success'),
        onError: (e) => errorMsg(e, "Couldn't update assignee"),
      },
    );
  };

  // ---- Checklist on card (PATCH issue.todos; optimistic via useIssueMutations) ----
  const toggleCardTodo = (issue: Issue, todoId: string) => {
    const next = (issue.todos ?? []).map((t) =>
      t.id === todoId ? { ...t, done: !t.done } : t,
    );
    issueMut.update.mutate(
      { id: issue._id, body: { todos: next } },
      { onError: (e) => errorMsg(e, "Couldn't update checklist") },
    );
  };

  const addCardTodo = (issue: Issue, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = [
      ...(issue.todos ?? []),
      { id: Math.random().toString(36).slice(2), text: trimmed, done: false },
    ];
    issueMut.update.mutate(
      { id: issue._id, body: { todos: next } },
      { onError: (e) => errorMsg(e, "Couldn't add checklist item") },
    );
  };

  const duplicateCard = async (issueId: string) => {
    const src = cards.find((c) => c._id === issueId);
    if (!src) return;
    try {
      await issueMut.create.mutateAsync({
        title: src.title + ' (copy)',
        desc: src.desc,
        type: src.type,
        status: src.status,
        priority: src.priority,
        projectId: src.projectId ?? null,
        assigneeId: src.assigneeId ?? null,
        dueDate: src.dueDate ?? null,
        labels: src.labels ?? [],
        todos: (src.todos ?? []).map((t) => ({ ...t, done: false })),
      });
    } catch (e) {
      errorMsg(e, "Couldn't duplicate card");
    }
  };

  const cancelInlineAdd = () => {
    setInlineAddListId(null);
    setInlineAddText('');
  };

  const submitInlineAdd = async (listId: string) => {
    const title = inlineAddText.trim();
    if (!title) {
      cancelInlineAdd();
      return;
    }
    try {
      await issueMut.create.mutateAsync({
        title,
        desc: '',
        type: 'task',
        status: listId,
        priority: 'medium',
        projectId: projectId || null,
        assigneeId: me.id,
        dueDate: null,
        labels: [],
        todos: [],
      });
      toast('Card added', 'success');
      setInlineAddText('');
      setInlineAddListId(null);
    } catch (e) {
      errorMsg(e, "Couldn't add card");
    }
  };

  // ---- Popover positioning (mirrors app.js positionPopover) ----
  const anchorFromButton = (
    e: React.MouseEvent<HTMLButtonElement>,
  ): PopAnchor => {
    const r = e.currentTarget.getBoundingClientRect();
    const pw = 240;
    const ph = 280;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8)
      top = Math.max(8, r.top - ph - 6);
    return { left, top };
  };

  const openConfirm = (a: ConfirmAction) => {
    setListMenu(null);
    setCardMenu(null);
    setConfirmAction(a);
  };

  return (
    <>
      {/* Page head — mirrors .page-head + .kb-owner-pill from demo */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Board
          </h1>
          <p className="text-[13px] mt-1.5">
            <span className="kb-owner-pill">
              <Avatar name={viewedUser.name} src={viewedUser.avatar} size="sm" />
              <span className="kb-owner-name">
                {viewedUser.name}&apos;s board
              </span>
              <span className="kb-owner-sep">·</span>
              <span className="kb-owner-count">
                {columns.length}{' '}
                {columns.length === 1 ? 'list' : 'lists'}
              </span>
            </span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search… (press /)"
            aria-label="Search tasks"
            className="w-[180px]"
          />
          <Select
            inline
            value={labelFilter}
            onValueChange={setLabelFilter}
            options={labelOptions}
          />
          <Select
            inline
            value={assignee}
            onValueChange={setAssignee}
            options={[
              { value: 'me', label: 'My tasks' },
              { value: '', label: 'All tasks' },
              ...users
                .filter(
                  (u): u is typeof u & { _id: string } =>
                    !!u._id && u._id !== me.id,
                )
                .map((u) => ({ value: u._id, label: u.name })),
            ]}
          />
          <Select
            inline
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((p) => ({ value: p._id, label: p.name })),
            ]}
          />
          <Button
            variant="outline"
            title={density === 'comfy' ? 'Switch to compact cards' : 'Switch to comfortable cards'}
            onClick={() =>
              setDensity((d) => (d === 'comfy' ? 'compact' : 'comfy'))
            }
          >
            {density === 'comfy' ? <Rows3 /> : <LayoutGrid />}
            {density === 'comfy' ? 'Compact' : 'Comfortable'}
          </Button>
          {!readonly && (
            <Button
              variant="outline"
              data-kb-pop-anchor
              onClick={(e) => {
                setAddListName('');
                setAddListAnchor(anchorFromButton(e));
              }}
            >
              <Plus />
              Add list
            </Button>
          )}
          {!readonly && (
            <Button
              variant="primary"
              onClick={() => setCreating(fallbackId ?? 'todo')}
            >
              <Plus />
              New task
            </Button>
          )}
        </div>
      </div>

      {/* Admin team-board switcher — jump between members' boards in one click */}
      {isAdmin && users.length > 0 && (
        <div className="kb-team-switch">
          <span className="kb-team-switch-label">Team boards</span>
          <button
            type="button"
            className={cn('kb-team-chip', assignee === 'me' && 'active')}
            onClick={() => setAssignee('me')}
            title="My board"
          >
            <Avatar name={me.name} src={me.avatar} size="sm" />
            <span>My board</span>
          </button>
          {users
            .filter(
              (u): u is typeof u & { _id: string } => !!u._id && u._id !== me.id,
            )
            .map((u) => (
              <button
                key={u._id}
                type="button"
                className={cn('kb-team-chip', assignee === u._id && 'active')}
                onClick={() => setAssignee(u._id)}
                title={`${u.name}'s board`}
              >
                <Avatar name={u.name} src={u.avatar} size="sm" />
                <span>{u.name}</span>
              </button>
            ))}
        </div>
      )}

      {/* Board grid */}
      <div
        className={cn(
          'kb-board',
          readonly && 'kb-readonly',
          density === 'compact' && 'kb-compact',
        )}
      >
        {columns.map((col) => {
          const hex = colorHex(col.color);
          const items = grouped.get(col.id) ?? [];

          if (col.collapsed) {
            return (
              <div
                key={col.id}
                data-list-id={col.id}
                className="kb-col kb-col-collapsed"
                style={{ ['--kb-c' as string]: hex } as any}
                draggable={!readonly}
                onDragStart={(e) => {
                  if (readonly) return;
                  dragListId.current = col.id;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/list', col.id);
                }}
                onDragEnd={() => {
                  dragListId.current = null;
                }}
                title={readonly ? '' : 'Drag to reorder'}
                onClick={() => !readonly && toggleCollapse(col.id)}
              >
                <button
                  type="button"
                  className="kb-col-expand"
                  title="Expand"
                  disabled={readonly}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!readonly) toggleCollapse(col.id);
                  }}
                >
                  <ChevronRight />
                </button>
                <span className="kb-dot" style={{ background: hex }} />
                <div className="kb-col-collapsed-label">
                  <span>{col.name}</span>
                </div>
                <span
                  className="kb-col-n"
                  style={{
                    marginTop: 'auto',
                    ...(col.wipLimit && items.length > col.wipLimit
                      ? { color: '#ef4444', fontWeight: 600 }
                      : null),
                  }}
                  title={
                    col.wipLimit
                      ? `${items.length} of ${col.wipLimit}`
                      : undefined
                  }
                >
                  {items.length}
                  {col.wipLimit ? `/${col.wipLimit}` : ''}
                </span>
              </div>
            );
          }

          return (
            <div
              key={col.id}
              data-list-id={col.id}
              className="kb-col"
              style={{ ['--kb-c' as string]: hex } as any}
              onDragOver={(e) => {
                if (!dragListId.current || readonly) return;
                e.preventDefault();
                const el = e.currentTarget;
                const rect = el.getBoundingClientRect();
                const before = e.clientX - rect.left < rect.width / 2;
                el.classList.toggle('list-drop-before', before);
                el.classList.toggle('list-drop-after', !before);
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove(
                  'list-drop-before',
                  'list-drop-after',
                );
              }}
              onDrop={(e) => {
                if (!dragListId.current || readonly) return;
                e.preventDefault();
                const el = e.currentTarget;
                const before = el.classList.contains('list-drop-before');
                el.classList.remove('list-drop-before', 'list-drop-after');
                moveList(dragListId.current, col.id, before);
                dragListId.current = null;
              }}
            >
              {/* Column head */}
              <div
                className="kb-col-head"
                draggable={!readonly}
                onDragStart={(e) => {
                  if (readonly) return;
                  dragListId.current = col.id;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/list', col.id);
                  e.stopPropagation();
                }}
                onDragEnd={() => {
                  dragListId.current = null;
                }}
                title={readonly ? '' : 'Drag to reorder'}
              >
                <span className="kb-dot" style={{ background: hex }} />
                <h4>{col.name}</h4>
                <span
                  className="kb-col-n"
                  style={
                    col.wipLimit && items.length > col.wipLimit
                      ? { color: '#ef4444', fontWeight: 600 }
                      : undefined
                  }
                  title={
                    col.wipLimit
                      ? `${items.length} of ${col.wipLimit} (WIP limit)`
                      : undefined
                  }
                >
                  {items.length}
                  {col.wipLimit ? `/${col.wipLimit}` : ''}
                </span>
                {!readonly && (
                  <>
                    <button
                      type="button"
                      className="kb-col-add"
                      title="New task"
                      onClick={() => setCreating(col.id)}
                    >
                      <Plus />
                    </button>
                    <button
                      type="button"
                      className="kb-col-menu-btn"
                      title="List options"
                      data-kb-pop-anchor
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardMenu(null);
                        setAddListAnchor(null);
                        setListMenu({
                          listId: col.id,
                          anchor: anchorFromButton(e),
                        });
                      }}
                    >
                      <MoreHorizontal />
                    </button>
                  </>
                )}
              </div>

              {/* Cards drop zone */}
              <KbDropZone
                disabled={readonly}
                cardCount={items.length}
                onDrop={(issueId) => moveCardTo(issueId, col.id)}
              >
                {items.length === 0 ? (
                  <div className="kb-drop-empty">
                    {readonly ? 'No cards' : 'Drop here'}
                  </div>
                ) : (
                  items.map((i) => {
                    const a = i.assigneeId
                      ? userMap.get(i.assigneeId)
                      : null;
                    return (
                      <KbCard
                        key={i._id}
                        issue={i}
                        assignee={a ?? null}
                        projectName={
                          i.projectId ? projectMap.get(i.projectId) : undefined
                        }
                        readonly={readonly}
                        selected={selected.has(i._id)}
                        active={activeCardId === i._id}
                        onToggleTodo={(todoId) => toggleCardTodo(i, todoId)}
                        onAddTodo={(text) => addCardTodo(i, text)}
                        onDragStart={(e) => {
                          if (readonly) {
                            e.preventDefault();
                            return;
                          }
                          dragIssueId.current = i._id;
                          e.dataTransfer.setData('text/plain', i._id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.currentTarget.classList.add('dragging');
                        }}
                        onDragEnd={(e) => {
                          dragIssueId.current = null;
                          e.currentTarget.classList.remove('dragging');
                        }}
                        onMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setListMenu(null);
                          setAddListAnchor(null);
                          setCardMenu({
                            issueId: i._id,
                            anchor: anchorFromButton(e),
                          });
                        }}
                        onClick={(e) => {
                          // Shift/Cmd/Ctrl click → toggle bulk selection
                          // (prevents navigation). Plain click → navigate via Link.
                          if (e.shiftKey || e.metaKey || e.ctrlKey) {
                            e.preventDefault();
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(i._id)) next.delete(i._id);
                              else next.add(i._id);
                              return next;
                            });
                          } else {
                            setActiveCardId(i._id);
                          }
                        }}
                      />
                    );
                  })
                )}
              </KbDropZone>

              {/* Column footer: inline add */}
              {!readonly && (
                <div className="kb-col-foot">
                  {inlineAddListId === col.id ? (
                    <div className="kb-inline-add">
                      <textarea
                        autoFocus
                        rows={2}
                        value={inlineAddText}
                        onChange={(e) => setInlineAddText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            submitInlineAdd(col.id);
                          } else if (e.key === 'Escape') {
                            cancelInlineAdd();
                          }
                        }}
                        placeholder="Type a card title, @mention…"
                      />
                      <div className="kb-inline-actions">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => submitInlineAdd(col.id)}
                        >
                          Add
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={cancelInlineAdd}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="kb-add-card"
                      onClick={() => {
                        setInlineAddListId(col.id);
                        setInlineAddText('');
                      }}
                    >
                      <Plus />
                      <span>Add a card</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-list popover */}
      {addListAnchor && (
        <div
          data-kb-popover
          className="kb-popover"
          style={{ left: addListAnchor.left, top: addListAnchor.top }}
        >
          <div className="kb-pop-section">
            <input
              autoFocus
              className="kb-pop-input"
              maxLength={40}
              placeholder="List name"
              value={addListName}
              onChange={(e) => setAddListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addList(addListName);
                  setAddListAnchor(null);
                } else if (e.key === 'Escape') {
                  setAddListAnchor(null);
                }
              }}
            />
          </div>
          <div className="kb-inline-actions" style={{ padding: '4px 2px 2px' }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                addList(addListName);
                setAddListAnchor(null);
              }}
            >
              Add
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddListAnchor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List options popover */}
      {listMenu &&
        (() => {
          const l = columns.find((c) => c.id === listMenu.listId);
          if (!l) return null;
          return (
            <div
              data-kb-popover
              className="kb-popover"
              style={{ left: listMenu.anchor.left, top: listMenu.anchor.top }}
            >
              <div className="kb-pop-section">
                <input
                  autoFocus
                  className="kb-pop-input"
                  defaultValue={l.name}
                  maxLength={40}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== l.name) {
                      updateList(l.id, { name: v });
                      toast('Renamed', 'success');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && v !== l.name) {
                        updateList(l.id, { name: v });
                        toast('Renamed', 'success');
                      }
                      setListMenu(null);
                    } else if (e.key === 'Escape') {
                      setListMenu(null);
                    }
                  }}
                />
              </div>
              <div className="kb-pop-label">Color</div>
              <div className="kb-pop-colors">
                {KB_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.id}
                    style={{ background: c.hex }}
                    className={cn('kb-swatch', c.id === l.color && 'active')}
                    onClick={() => {
                      updateList(l.id, { color: c.id });
                      setListMenu(null);
                    }}
                  />
                ))}
              </div>
              <div className="kb-pop-label">WIP limit</div>
              <div className="kb-pop-section" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="kb-pop-input"
                  placeholder="No limit"
                  defaultValue={l.wipLimit ?? ''}
                  style={{ width: 90 }}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === '' ? null : Math.max(1, parseInt(raw, 10) || 0);
                    if ((l.wipLimit ?? null) !== next) {
                      updateList(l.id, { wipLimit: next });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                      setListMenu(null);
                    } else if (e.key === 'Escape') {
                      setListMenu(null);
                    }
                  }}
                />
                {l.wipLimit ? (
                  <button
                    type="button"
                    className="kb-pop-item"
                    style={{ padding: '4px 8px' }}
                    onClick={() => updateList(l.id, { wipLimit: null })}
                    title="Remove limit"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="kb-pop-sep" />
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  toggleCollapse(l.id);
                  setListMenu(null);
                }}
              >
                <ChevronRight />
                <span>{l.collapsed ? 'Expand list' : 'Collapse list'}</span>
              </button>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  duplicateList(l.id);
                  setListMenu(null);
                }}
              >
                <Layers />
                <span>Duplicate list</span>
              </button>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() =>
                  openConfirm({
                    kind: 'list-clear',
                    listId: l.id,
                    listName: l.name,
                  })
                }
              >
                <RefreshCw />
                <span>Clear all cards</span>
              </button>
              <div className="kb-pop-sep" />
              <button
                type="button"
                className="kb-pop-item danger"
                onClick={() => {
                  const remaining = columns.filter((c) => c.id !== l.id);
                  const fallback = remaining[0];
                  openConfirm({
                    kind: 'list-delete',
                    listId: l.id,
                    listName: l.name,
                    cardCount: (grouped.get(l.id) ?? []).length,
                    fallbackName: fallback?.name ?? '',
                  });
                }}
              >
                <Trash2 />
                <span>Delete list</span>
              </button>
            </div>
          );
        })()}

      {/* Card options popover */}
      {cardMenu &&
        (() => {
          const issue = cards.find((c) => c._id === cardMenu.issueId);
          if (!issue) return null;
          const currentCol = columnFor(issue);
          const otherCols = columns.filter((c) => c.id !== currentCol);
          return (
            <div
              data-kb-popover
              className="kb-popover"
              style={{
                left: cardMenu.anchor.left,
                top: cardMenu.anchor.top,
                maxHeight: 420,
                overflowY: 'auto',
              }}
            >
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  router.push(`/issues/${issue._id}`);
                }}
              >
                <Eye />
                <span>Open</span>
              </button>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  setCardMenu(null);
                  setEditingIssue(issue);
                }}
              >
                <Pencil />
                <span>Edit</span>
              </button>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  duplicateCard(issue._id);
                  setCardMenu(null);
                }}
              >
                <Copy />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  navigator.clipboard?.writeText(issue.title);
                  toast('Title copied', 'success');
                  setCardMenu(null);
                }}
              >
                <Link2 />
                <span>Copy title</span>
              </button>
              {otherCols.length > 0 && (
                <>
                  <div className="kb-pop-label">Move to</div>
                  {otherCols.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="kb-pop-item"
                      onClick={() => {
                        moveCardTo(issue._id, c.id);
                        setCardMenu(null);
                      }}
                    >
                      <span
                        className="kb-dot"
                        style={{ background: colorHex(c.color) }}
                      />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </>
              )}
              <div className="kb-pop-sep" />
              <div className="kb-pop-label">Assign to</div>
              <button
                type="button"
                className="kb-pop-item"
                onClick={() => {
                  assignIssue(issue._id, null);
                  setCardMenu(null);
                }}
              >
                <span
                  className="kb-dot"
                  style={{ background: 'var(--bg-subtle)' }}
                />
                <span>Unassigned</span>
              </button>
              {users
                .filter(
                  (u): u is typeof u & { _id: string } =>
                    !!u._id && u._id !== issue.assigneeId,
                )
                .slice(0, 8)
                .map((u) => (
                  <button
                    key={u._id}
                    type="button"
                    className="kb-pop-item"
                    onClick={() => {
                      assignIssue(issue._id, u._id);
                      setCardMenu(null);
                    }}
                  >
                    <Avatar name={u.name} src={u.avatar} size="sm" />
                    <span>{u.name}</span>
                  </button>
                ))}
              <div className="kb-pop-sep" />
              <button
                type="button"
                className="kb-pop-item danger"
                onClick={() =>
                  openConfirm({
                    kind: 'card-delete',
                    issueId: issue._id,
                    title: issue.title,
                  })
                }
              >
                <Trash2 />
                <span>Delete</span>
              </button>
            </div>
          );
        })()}

      {/* Bulk action bar — appears when user has shift/cmd-selected cards */}
      {selected.size > 0 && (
        <div
          data-kb-popover
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border)',
            boxShadow: '0 10px 30px rgba(0,0,0,.18)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            data-kb-pop-anchor
            onClick={(e) => {
              setBulkMoveAnchor(anchorFromButton(e));
            }}
          >
            Move to ▾
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              openConfirm({
                kind: 'card-delete',
                issueId: '__bulk__',
                title: `${selected.size} cards`,
              })
            }
          >
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {/* Bulk move-to popover */}
      {bulkMoveAnchor && (
        <div
          data-kb-popover
          className="kb-popover"
          style={{ left: bulkMoveAnchor.left, top: bulkMoveAnchor.top, maxHeight: 320, overflowY: 'auto' }}
        >
          <div className="kb-pop-label">Move {selected.size} to</div>
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              className="kb-pop-item"
              onClick={() => {
                bulkMove(c.id);
                setBulkMoveAnchor(null);
              }}
            >
              <span
                className="kb-dot"
                style={{ background: colorHex(c.color) }}
              />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}

      <IssueModal
        open={!!creating}
        defaultStatus={creating ?? fallbackId ?? 'todo'}
        defaultProjectId={projectId}
        defaultAssigneeId={assignee === 'me' ? me.id : ''}
        statusOptions={columns.map((c) => ({ value: c.id, label: c.name }))}
        onClose={() => setCreating(null)}
      />
      <IssueModal
        open={!!editingIssue}
        issue={editingIssue}
        statusOptions={columns.map((c) => ({ value: c.id, label: c.name }))}
        onClose={() => setEditingIssue(null)}
      />

      <Confirm
        open={!!confirmAction}
        title={
          confirmAction?.kind === 'list-delete'
            ? 'Delete list?'
            : confirmAction?.kind === 'list-clear'
              ? 'Clear all cards?'
              : 'Delete card?'
        }
        danger
        body={
          confirmAction?.kind === 'list-delete'
            ? confirmAction.cardCount
              ? `Delete "${confirmAction.listName}"? ${confirmAction.cardCount} card${
                  confirmAction.cardCount === 1 ? '' : 's'
                } will move to "${confirmAction.fallbackName}" on your board.`
              : `Delete "${confirmAction.listName}"?`
            : confirmAction?.kind === 'list-clear'
              ? `Remove all cards from "${confirmAction.listName}"? This cannot be undone.`
              : confirmAction?.kind === 'card-delete'
                ? `Delete "${confirmAction.title}"? This cannot be undone.`
                : ''
        }
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.kind === 'list-delete')
            deleteList(confirmAction.listId);
          else if (confirmAction.kind === 'list-clear')
            clearList(confirmAction.listId);
          else if (confirmAction.kind === 'card-delete') {
            if (confirmAction.issueId === '__bulk__') bulkDelete();
            else issueMut.remove.mutate(confirmAction.issueId);
          }
        }}
      />
    </>
  );
}

/* ---------- Subcomponents ---------- */

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#dc2626' },
  high: { label: 'High', color: '#ef4444' },
  medium: { label: 'Medium', color: '#f59e0b' },
  low: { label: 'Low', color: '#22c55e' },
};

function KbCard({
  issue: i,
  assignee,
  projectName,
  readonly,
  selected,
  active,
  onToggleTodo,
  onAddTodo,
  onDragStart,
  onDragEnd,
  onMenu,
  onClick,
}: {
  issue: Issue;
  assignee: { name: string; avatar?: string } | null;
  projectName?: string;
  readonly: boolean;
  selected: boolean;
  active: boolean;
  onToggleTodo: (todoId: string) => void;
  onAddTodo: (text: string) => void;
  onDragStart: (e: React.DragEvent<HTMLAnchorElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLAnchorElement>) => void;
  onMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [newItem, setNewItem] = useState('');
  const labels = (i.labels ?? []).slice(0, 2);
  const todos = i.todos ?? [];
  const total = todos.length;
  const doneCount = todos.filter((t) => t.done).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const priority = PRIORITY_META[i.priority] ?? PRIORITY_META.medium;
  // Stop the wrapping <Link> from navigating / the card's select handler
  // from firing when the user interacts with the inline checklist.
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  // Title attribute provides a native tooltip with the description preview.
  const previewBody = (i.desc ?? '').trim().slice(0, 240);
  const tooltipTitle = previewBody ? `${i.title}\n\n${previewBody}` : i.title;
  return (
    <Link
      href={`/issues/${i._id}`}
      data-id={i._id}
      draggable={!readonly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={tooltipTitle}
      className={cn(
        'kb-card',
        `kb-card-${i.priority}`,
        selected && 'kb-card-selected',
        active && 'kb-card-active',
      )}
      style={
        selected
          ? {
              outline: '2px solid var(--a)',
              outlineOffset: '-2px',
              background: 'color-mix(in srgb, var(--a) 8%, var(--bg-card))',
            }
          : active
            ? { outline: '2px solid color-mix(in srgb, var(--a) 60%, transparent)', outlineOffset: '-2px' }
            : undefined
      }
    >
      {!readonly && (
        <button
          type="button"
          className="kb-card-menu-btn"
          title="Card options"
          data-kb-pop-anchor
          onClick={onMenu}
        >
          <MoreHorizontal />
        </button>
      )}
      <div className="kb-card-type">
        <IssueTypeIcon
          type={i.type}
          size={18}
          className="!w-[18px] !h-[18px]"
        />
        <span>{i.type}</span>
        <span
          className="kb-card-priority"
          style={{
            color: priority.color,
            background: `color-mix(in srgb, ${priority.color} 14%, transparent)`,
          }}
          title={`Priority: ${priority.label}`}
        >
          {priority.label}
        </span>
      </div>
      <div className="kb-card-title">{i.title}</div>
      {total > 0 && (
        <div className="kb-card-checklist">
          {/* Summary row — click to expand the tickable list */}
          <button
            type="button"
            className="kb-check-summary"
            aria-expanded={checklistOpen}
            title={checklistOpen ? 'Hide checklist' : 'Show checklist'}
            onClick={(e) => {
              stop(e);
              setChecklistOpen((o) => !o);
            }}
          >
            <CheckSquare
              size={12}
              style={{
                color: pct === 100 ? '#22c55e' : 'var(--text-muted)',
                flexShrink: 0,
              }}
            />
            <div className="kb-check-bar">
              <div
                className="kb-check-bar-fill"
                style={{
                  width: `${pct}%`,
                  background: pct === 100 ? '#22c55e' : 'var(--a)',
                }}
              />
            </div>
            <span className="kb-check-count">
              {doneCount}/{total}
            </span>
            <ChevronDown
              size={12}
              style={{
                flexShrink: 0,
                transition: 'transform .2s',
                transform: checklistOpen ? 'rotate(180deg)' : 'none',
                color: 'var(--text-muted)',
              }}
            />
          </button>

          {/* Expanded list — tick items inline */}
          {checklistOpen && (
            <div className="kb-check-items">
              {todos.map((t) => (
                <label
                  key={t.id}
                  className="kb-check-item"
                  onClick={stop}
                >
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={readonly}
                    onClick={stop}
                    onChange={(e) => {
                      stop(e);
                      if (!readonly) onToggleTodo(t.id);
                    }}
                  />
                  <span className={cn(t.done && 'kb-check-done')}>{t.text}</span>
                </label>
              ))}
              {!readonly && (
                <input
                  type="text"
                  className="kb-check-add"
                  placeholder="+ Add item…"
                  value={newItem}
                  onClick={stop}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      stop(e);
                      onAddTodo(newItem);
                      setNewItem('');
                    } else if (e.key === 'Escape') {
                      stop(e);
                      setNewItem('');
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
      {i.dueDate && (() => {
        const due = new Date(i.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const isOverdue = due < today;
        const isToday = due.getTime() === today.getTime();
        const color = isOverdue
          ? '#ef4444'
          : isToday
            ? '#f59e0b'
            : 'var(--text-muted)';
        const label = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <CalendarDays size={11} style={{ color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color, fontWeight: isOverdue || isToday ? 600 : 400 }}>
              {isOverdue ? 'Overdue · ' : isToday ? 'Today · ' : ''}{label}
            </span>
          </div>
        );
      })()}
      <div className="kb-card-foot">
        <div className="kb-card-labels">
          {projectName && (
            <span className="kb-card-project" title={`Project: ${projectName}`}>
              {projectName}
            </span>
          )}
          {labels.map((l) => (
            <span key={l} className="kb-card-mini-label">
              {l}
            </span>
          ))}
        </div>
        {assignee ? <Avatar name={assignee.name} src={assignee.avatar} size="sm" /> : <span />}
      </div>
    </Link>
  );
}

function KbDropZone({
  disabled,
  cardCount,
  onDrop,
  children,
}: {
  disabled?: boolean;
  cardCount: number;
  onDrop: (issueId: string) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // -1 = none; 0..cardCount = position the indicator would land at.
  // We pick the nearest card-gap based on pointer Y.
  const [dropIndex, setDropIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const computeDropIndex = (clientY: number): number => {
    const root = rootRef.current;
    if (!root) return cardCount;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>(':scope > .kb-card'),
    );
    for (let idx = 0; idx < cards.length; idx++) {
      const r = cards[idx].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return idx;
    }
    return cards.length;
  };

  return (
    <div
      ref={rootRef}
      className={cn('kb-cards', over && 'drag-over')}
      style={{ position: 'relative' }}
      onDragOver={(e) => {
        if (disabled) return;
        if (!e.dataTransfer.types.includes('text/plain')) return;
        e.preventDefault();
        setOver(true);
        setDropIndex(computeDropIndex(e.clientY));
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the root, not when crossing into a child card
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
        setDropIndex(-1);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        setOver(false);
        setDropIndex(-1);
        if (id) onDrop(id);
      }}
    >
      {/* Drop indicator: a 2px line at the boundary of dropIndex */}
      {over && dropIndex >= 0 && (
        <DropIndicator index={dropIndex} rootRef={rootRef} />
      )}
      {children}
    </div>
  );
}

function DropIndicator({
  index,
  rootRef,
}: {
  index: number;
  rootRef: React.RefObject<HTMLDivElement>;
}) {
  // Use a 2px absolutely-positioned line, anchored to the gap above the
  // card at `index`, or below the last card when index === count.
  const root = rootRef.current;
  if (!root) return null;
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>(':scope > .kb-card'),
  );
  const rootRect = root.getBoundingClientRect();
  let top: number;
  if (cards.length === 0) {
    top = 4;
  } else if (index >= cards.length) {
    const last = cards[cards.length - 1].getBoundingClientRect();
    top = last.bottom - rootRect.top + 2;
  } else {
    const r = cards[index].getBoundingClientRect();
    top = r.top - rootRect.top - 3;
  }
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 4,
        right: 4,
        top,
        height: 3,
        borderRadius: 2,
        background: 'var(--a)',
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--a) 30%, transparent)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
