'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { StatePill } from '@/components/ui/state-pill';
import { BoardCard } from '@/components/work-item/board-card';
import { InlineCreate } from '@/components/work-item/inline-create';
import type { StateOption } from '@/components/work-item/state-select';
import type { ItemRowData, RowLabel, RowPerson } from '@/lib/work-item-row';
import { useBoardSync } from './use-board-sync';

/**
 * §14 slice 6's board: "Drag between columns; concurrent drags from two
 * browsers land correctly."
 *
 * §11's five states, in one place, because a view that ships with only the
 * happy path is not done:
 *
 *   `[L]` Server-rendered, so the board has no loading state of its own. The
 *         one asynchronous thing is a drag, and its feedback is the card
 *         already being where it was dropped.
 *   `[E]` An empty column keeps its header and its input — §7.1: "the focused
 *         input **is** the empty state". A column that vanishes when it empties
 *         is a column nothing can be dragged into.
 *   `[S]` Optimistic (§7.5): the card moves before the server answers, because
 *         the result is on screen and §11 reserves toasts for when it is not.
 *   `[X]` A refused drag animates back and says why, in a toast — the one case
 *         slice 5 had no toast for, because the reason is nowhere on screen.
 *   `[!]` 30 columns scroll horizontally with the headers in place; two people
 *         dragging the same card converge, because neither of them sent a rank.
 *
 * **The client never computes a rank** (§9). On drop it sends the ids of the
 * cards either side of the gap, and the server reads those two rows under
 * `FOR UPDATE` and computes the key. That is the whole reason a stale drag
 * lands correctly instead of making the board feel haunted — and it is why the
 * optimistic state here is only ever an *order*, never a rank.
 */

export type BoardColumn = {
  /** The workflow state's id — the column, and the drop target's id. */
  key: string;
  state: StateOption;
  /** The group's real total, not the page's length (§9). */
  total: number;
  items: ItemRowData[];
};

export function BoardView({
  context,
  columns: serverColumns,
  people,
  labels,
  today,
  projectId,
  query,
  token,
  canCreate,
  canEdit,
  focusFirstComposer = false,
}: {
  context: { workspaceSlug: string; projectSlug: string; locale: string };
  columns: BoardColumn[];
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  projectId: string;
  /** The page's query string, so the poll's token covers what is on screen. */
  query: string;
  token: string;
  canCreate: boolean;
  canEdit: boolean;
  /**
   * §7.1's last line: a project created a moment ago lands here with "add your
   * first task" already focused. Only the first column takes it — the six
   * default states are drawn in order and the first is where work starts.
   */
  focusFirstComposer?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();

  /**
   * The board's order lives in state because a drag rearranges it before the
   * server has answered — but it is *reset* whenever the server sends something
   * different, which is the lesson `GroupList` records: state seeded from props
   * and never reconciled freezes the view at whatever it held on mount, and a
   * card someone else moved never arrives.
   *
   * The seed is derived from the props rather than passed in, so there is no
   * second thing to keep in step.
   */
  const seed = serverColumns.map((c) => `${c.key}:${c.items.map((i) => i.id).join(',')}`).join('|');
  const [rendered, setRendered] = useState({ seed, columns: serverColumns });
  if (rendered.seed !== seed) setRendered({ seed, columns: serverColumns });

  const columns = rendered.columns;

  const revalidate = useBoardSync({
    workspaceSlug: context.workspaceSlug,
    query,
    token,
    onChanged: () => router.refresh(),
  });

  // A pointer needs to travel 6px before a drag starts, so a click on a card's
  // link is still a click and not a one-pixel drag that swallows it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [dragging, setDragging] = useState<string | null>(null);

  const columnOf = useCallback(
    (list: BoardColumn[], itemId: string) => list.find((c) => c.items.some((i) => i.id === itemId)),
    [],
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id));
  }

  /**
   * Cross-column movement happens here rather than on drop, so the card is
   * visibly inside the column it is hovering and the columns resize as it
   * travels. `dnd-kit` gives no vertical position within a column it has never
   * been in otherwise, and the card would jump on release.
   */
  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    setRendered((current) => {
      const from = columnOf(current.columns, activeId);
      // `overId` is either a card (hovering mid-column) or a column (hovering
      // its empty space), so both are tried.
      const to =
        columnOf(current.columns, overId) ?? current.columns.find((c) => c.key === overId);

      if (!from || !to || from.key === to.key) return current;

      const item = from.items.find((i) => i.id === activeId);
      if (!item) return current;

      const overIndex = to.items.findIndex((i) => i.id === overId);
      const insertAt = overIndex === -1 ? to.items.length : overIndex;

      return {
        ...current,
        columns: current.columns.map((column) => {
          if (column.key === from.key) {
            return { ...column, items: column.items.filter((i) => i.id !== activeId) };
          }
          if (column.key === to.key) {
            const items = [...column.items];
            items.splice(insertAt, 0, item);
            return { ...column, items };
          }
          return column;
        }),
      };
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Everything below is computed against one snapshot, so the request and the
    // rollback describe the same board.
    const before = rendered.columns;

    const target =
      columnOf(before, overId) ?? before.find((column) => column.key === overId);
    if (!target) return;

    const source = columnOf(before, activeId);
    if (!source) return;

    const item = source.items.find((i) => i.id === activeId);
    if (!item) return;

    const withoutItem = target.items.filter((i) => i.id !== activeId);
    const overIndex = target.items.findIndex((i) => i.id === overId);
    const insertAt =
      overId === target.key || overIndex === -1
        ? withoutItem.length
        : withoutItem.findIndex((i) => i.id === overId) === -1
          ? withoutItem.length
          : withoutItem.findIndex((i) => i.id === overId);

    const next = [...withoutItem];
    next.splice(insertAt, 0, item);

    const position = next.findIndex((i) => i.id === activeId);
    // The two ids either side of the gap. `null` means an edge, and the server
    // reads it as an intent — "the top" and "the bottom" — never as missing.
    const previousId = position > 0 ? (next[position - 1]?.id ?? null) : null;
    const nextId = position < next.length - 1 ? (next[position + 1]?.id ?? null) : null;

    const settled = before.map((column) =>
      column.key === target.key
        ? { ...column, items: next, total: column.total + (source.key === target.key ? 0 : 1) }
        : column.key === source.key
          ? {
              ...column,
              items: column.items.filter((i) => i.id !== activeId),
              total: Math.max(0, column.total - 1),
            }
          : column,
    );

    setRendered({
      seed: settled.map((c) => `${c.key}:${c.items.map((i) => i.id).join(',')}`).join('|'),
      columns: settled,
    });

    try {
      const response = await fetch('/api/internal/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceSlug: context.workspaceSlug,
          workItemId: activeId,
          stateId: target.key,
          previousId,
          nextId,
        }),
      });

      if (!response.ok) {
        const problem = ((await response.json().catch(() => null)) as { error?: string } | null)
          ?.error;
        throw new Error(problem ?? 'moveRefused');
      }

      // Own mutation: reset the poll's backoff so anything else that changed
      // while this drag was in flight arrives promptly (§8).
      revalidate();
    } catch (error) {
      // §7.5: "card animates back with a toast explaining why". The board goes
      // back to the snapshot the drag started from, which is the honest thing
      // to show — the server never accepted the move.
      setRendered({
        seed: before.map((c) => `${c.key}:${c.items.map((i) => i.id).join(',')}`).join('|'),
        columns: before,
      });

      toast({
        tone: 'danger',
        message: t('board.moveFailed', {
          identifier: item.identifier,
          reason: reasonFor(error, t),
        }),
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => t('board.pickedUp', { identifier: labelOf(columns, active.id) }),
          onDragOver: ({ active, over }) =>
            over
              ? t('board.movedTo', {
                  identifier: labelOf(columns, active.id),
                  name: columnNameOf(columns, over.id),
                  position: positionOf(columns, active.id) + 1,
                  count: countOf(columns, active.id),
                })
              : '',
          onDragEnd: ({ active, over }) =>
            over
              ? t('board.dropped', {
                  identifier: labelOf(columns, active.id),
                  name: columnNameOf(columns, over.id),
                })
              : '',
          onDragCancel: ({ active }) =>
            t('board.cancelled', { identifier: labelOf(columns, active.id) }),
        },
      }}
    >
      {/* §7.4's edge case: "30-person team → columns virtualize and scroll
          horizontally". Virtualization is not needed at six columns; the
          horizontal scroll is, and it belongs to this container so the page
          body never scrolls sideways. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        {columns.map((column, index) => (
          <Column
            key={column.key}
            column={column}
            context={context}
            projectId={projectId}
            people={people}
            labels={labels}
            today={today}
            canCreate={canCreate}
            canEdit={canEdit}
            focusComposer={focusFirstComposer && index === 0}
            isDragging={dragging !== null}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  column,
  context,
  projectId,
  people,
  labels,
  today,
  canCreate,
  canEdit,
  focusComposer,
  isDragging,
}: {
  column: BoardColumn;
  context: { workspaceSlug: string; projectSlug: string; locale: string };
  projectId: string;
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  canCreate: boolean;
  canEdit: boolean;
  focusComposer: boolean;
  isDragging: boolean;
}) {
  const t = useTranslations();
  // The column itself is a drop target, so an empty one can still be dropped
  // into — the case a card-only target silently fails.
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <section
      aria-label={t('board.columnLabel', { name: column.state.name, count: column.total })}
      className="flex w-72 shrink-0 flex-col gap-2"
    >
      {/* The count is the group's real total, not the page's length (§9) — a
          header that says 12 because the page held 12 is a small dishonesty
          people stop trusting. */}
      <header className="flex items-center gap-2 px-0.5">
        <StatePill name={column.state.name} color={column.state.color} count={column.total} />
      </header>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-2 rounded-md border p-2 transition-colors duration-120 ${
          isOver && isDragging
            ? 'border-accent-ring bg-accent-subtle'
            : 'border-border bg-surface-sunken'
        }`}
      >
        <SortableContext
          items={column.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2">
            {column.items.map((item) => (
              <BoardCard
                key={item.id}
                item={item}
                people={people}
                labels={labels}
                today={today}
                href={`/${context.workspaceSlug}/projects/${context.projectSlug}/${item.number}`}
                canDrag={canEdit}
              />
            ))}
          </ul>
        </SortableContext>

        {column.items.length === 0 && !canCreate && (
          <p className="px-1 py-2 text-xs text-text-subtle">{t('board.empty')}</p>
        )}

        {canCreate && (
          <InlineCreate
            workspaceSlug={context.workspaceSlug}
            projectSlug={context.projectSlug}
            projectId={projectId}
            stateId={column.key}
            locale={context.locale}
            autoFocus={focusComposer}
          />
        )}
      </div>
    </section>
  );
}

/* --- announcement helpers ------------------------------------------------- */

function labelOf(columns: readonly BoardColumn[], id: string | number): string {
  const wanted = String(id);
  for (const column of columns) {
    const found = column.items.find((item) => item.id === wanted);
    if (found) return found.identifier;
  }
  return wanted;
}

function columnNameOf(columns: readonly BoardColumn[], id: string | number): string {
  const wanted = String(id);
  const byKey = columns.find((column) => column.key === wanted);
  if (byKey) return byKey.state.name;
  const holding = columns.find((column) => column.items.some((item) => item.id === wanted));
  return holding?.state.name ?? '';
}

function positionOf(columns: readonly BoardColumn[], id: string | number): number {
  const wanted = String(id);
  for (const column of columns) {
    const index = column.items.findIndex((item) => item.id === wanted);
    if (index !== -1) return index;
  }
  return 0;
}

function countOf(columns: readonly BoardColumn[], id: string | number): number {
  const wanted = String(id);
  const holding = columns.find((column) => column.items.some((item) => item.id === wanted));
  return holding?.items.length ?? 0;
}

/** A problem identifier from the server becomes a translated sentence (§13). */
function reasonFor(error: unknown, t: ReturnType<typeof useTranslations>): string {
  const code = error instanceof Error ? error.message : 'moveRefused';
  const keys: Record<string, string> = {
    unknown_neighbour: 'workItems.errors.unknownNeighbour',
    unknown_state: 'workItems.errors.unknownState',
    not_found: 'workItems.errors.notFound',
    archived: 'projects.errors.archived',
    read_only: 'workItems.errors.readOnly',
    forbidden: 'workItems.errors.forbidden',
  };
  return t(keys[code] ?? 'workItems.errors.moveRefused');
}
