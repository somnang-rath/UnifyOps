'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { CalendarOff } from 'lucide-react';
import { BoardCard } from '@/components/work-item/board-card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { ItemRowData, RowLabel, RowPerson } from '@/lib/work-item-row';
import { NONE } from '@/lib/work-item-query';

/**
 * §7.4's workload: one column per person, availability-aware (§17-25).
 *
 * "My Work → Team switcher → group by ASSIGNEE, each column headed by person +
 * open count + overdue count → drag a card between people to reassign (notifies
 * both)."
 *
 * **A drag here means something different from a drag on the board**, and that
 * is the one thing to understand before changing this file. §7.5's drag changes
 * a *state* and computes a rank; this one changes an *assignee* and computes
 * nothing. They go to different endpoints on purpose — see
 * `api/internal/reassign` — because a single gesture that meant two things
 * depending on where it landed is the sort of ambiguity §7.5's own contract was
 * written to avoid.
 *
 * **Reassigning onto somebody unavailable is warned, never blocked** (§7.4):
 * "the manager knows things the flag does not." So an away member's column is
 * a legal drop target with a visible badge, and the drop raises a toast naming
 * who is away and until when — a sentence, not a refusal.
 *
 * §11's five states:
 *
 *   `[L]` No client fetch; the page is server-rendered and a drag is optimistic.
 *   `[E]` A person with nothing assigned keeps their column — that is the most
 *         useful cell on this screen, because it is either free capacity or, if
 *         they are away, explicitly not.
 *   `[S]` The card moves before the server answers, and there is no success
 *         toast: the result is on screen (§11).
 *   `[X]` §7.5's rule, borrowed: the card animates back and a toast says why,
 *         because a refused *drag* leaves nothing on screen to explain itself.
 *   `[!]` §7.4's own edge case — "30-person team → columns virtualize and scroll
 *         horizontally; header stays" — is a horizontal scroll on this
 *         container, so the page body never scrolls sideways. Virtualization is
 *         not needed at thirty columns of twenty cards and would cost the
 *         keyboard path dnd-kit gives for free.
 */

export type WorkloadPerson = {
  /** A member id, or the `none` sentinel for the unassigned column. */
  key: string;
  name: string;
  open: number;
  overdue: number;
  /** §4's flag. Null when they are here — or when the column is `none`. */
  unavailableUntil: string | null;
  unavailableReason: string | null;
  away: boolean;
  items: ItemRowData[];
};

export function WorkloadView({
  workspaceSlug,
  columns: serverColumns,
  people,
  labels,
  today,
  projectSlugs,
  canEdit,
}: {
  workspaceSlug: string;
  columns: readonly WorkloadPerson[];
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  /** Project slug by project id, so a card can link to its own item page. */
  projectSlugs: Readonly<Record<string, string>>;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();

  /**
   * The server's columns are the truth; this holds the optimistic copy between
   * a drop and the refresh that confirms it.
   *
   * The seed is derived from the props rather than passed in, exactly as
   * `BoardView` does it — so a card somebody else moved arrives on the next
   * render instead of being frozen out by state that was seeded once on mount.
   * That bug is the one slice 5's `GroupList` comment describes, and it is
   * silent: the count moves and the card does not.
   */
  const seed = serverColumns.map((c) => `${c.key}:${c.items.map((i) => i.id).join(',')}`).join('|');
  const [rendered, setRendered] = useState({ seed, columns: [...serverColumns] });
  if (rendered.seed !== seed) setRendered({ seed, columns: [...serverColumns] });

  const columns = rendered.columns;

  // Six pixels before a drag starts, so a click on a card's link stays a click.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [dragging, setDragging] = useState<string | null>(null);

  const columnOf = useCallback(
    (list: readonly WorkloadPerson[], itemId: string) =>
      list.find((column) => column.items.some((item) => item.id === itemId)),
    [],
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id));
  }

  /**
   * Moved on hover rather than on drop, so the card is visibly inside the
   * column it is over and the columns resize as it travels. Without it dnd-kit
   * has no position inside a column the card has never been in, and the card
   * jumps on release.
   */
  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    setRendered((current) => {
      const from = columnOf(current.columns, activeId);
      const to =
        columnOf(current.columns, overId) ?? current.columns.find((c) => c.key === overId);
      if (!from || !to || from.key === to.key) return current;

      const item = from.items.find((i) => i.id === activeId);
      if (!item) return current;

      return {
        ...current,
        columns: current.columns.map((column) => {
          if (column.key === from.key) {
            return { ...column, items: column.items.filter((i) => i.id !== activeId) };
          }
          if (column.key === to.key) return { ...column, items: [item, ...column.items] };
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

    /**
     * **Two snapshots, and which question each answers.**
     *
     * `onDragOver` has already moved the card into whichever column it is over,
     * so *where it ended up* is a question about the optimistic state — and
     * `over.id` is by then usually a **card** in the destination rather than the
     * destination itself, because `closestCorners` prefers the sortable it is
     * nearest. Resolving that id against the server snapshot would find the card
     * still in the column it started in, decide the drag was a no-op, and send
     * nothing: a drop that visibly worked and silently did not.
     *
     * Where it *came from*, and what to roll back to, are questions about the
     * server's state — the only thing the drag has not already changed.
     */
    const target =
      columnOf(rendered.columns, activeId) ??
      rendered.columns.find((column) => column.key === overId);
    const source = columnOf(serverColumns, activeId);
    const before = serverColumns;

    if (!target || !source || target.key === source.key) {
      setRendered({ seed, columns: [...before] });
      return;
    }

    const item = source.items.find((i) => i.id === activeId);
    if (!item) return;

    // §4: "assignment is multiple." A drag names exactly one owner, and the
    // unassigned column names none — which is a real destination (§7.12's
    // offboarding leaves work there deliberately), not a missing value.
    const memberIds = target.key === NONE ? [] : [target.key];

    const settled = before.map((column) =>
      column.key === target.key
        ? { ...column, items: [item, ...column.items], open: column.open + 1 }
        : column.key === source.key
          ? {
              ...column,
              items: column.items.filter((i) => i.id !== activeId),
              open: Math.max(0, column.open - 1),
            }
          : column,
    );

    setRendered({
      seed: settled.map((c) => `${c.key}:${c.items.map((i) => i.id).join(',')}`).join('|'),
      columns: settled,
    });

    try {
      const response = await fetch('/api/internal/reassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceSlug, workItemId: activeId, memberIds }),
      });

      if (!response.ok) {
        const problem = ((await response.json().catch(() => null)) as { error?: string } | null)
          ?.error;
        throw new Error(problem ?? 'forbidden');
      }

      /**
       * §7.4: "Reassigning onto someone unavailable is **warned, never
       * blocked** — the manager knows things the flag does not."
       *
       * So this is raised *after* the write succeeded, and it names the date
       * rather than asking a question. A confirmation dialog would be the
       * blocking version wearing a politer word, and it would fire on the
       * common case of a manager filling somebody's queue for the week they
       * come back.
       */
      if (target.away && target.unavailableUntil) {
        toast({
          tone: 'warning',
          message: t('workload.reassignedToAway', {
            name: target.name,
            date: target.unavailableUntil,
          }),
        });
      }

      // The counts, the overdue split and the capacity line are all server
      // arithmetic, and the drop has just changed every one of them.
      router.refresh();
    } catch (error) {
      // §7.5's rule, which applies to any drag: the card goes back and a toast
      // says why, because nothing else on screen can.
      setRendered({ seed, columns: [...before] });

      toast({
        tone: 'danger',
        message: t('workload.reassignFailed', {
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
          onDragStart: ({ active }) =>
            t('workload.pickedUp', { identifier: identifierOf(columns, active.id) }),
          onDragOver: ({ active, over }) =>
            over
              ? t('workload.movedTo', {
                  identifier: identifierOf(columns, active.id),
                  name: nameOf(columns, over.id),
                })
              : '',
          onDragEnd: ({ active, over }) =>
            over
              ? t('workload.dropped', {
                  identifier: identifierOf(columns, active.id),
                  name: nameOf(columns, over.id),
                })
              : '',
          onDragCancel: ({ active }) =>
            t('workload.cancelled', { identifier: identifierOf(columns, active.id) }),
        },
      }}
    >
      {/*
        `data-print="stack"` is §7.4's edge case, handed to the print stylesheet:
        "printing a board with 30 columns → the print layout is the grouped list,
        never the board." An attribute rather than a `print:` utility because
        what the rule has to change is this container *and* the width of every
        child section, which is one CSS rule and would otherwise be a class on
        every column.
      */}
      <div
        data-print="stack"
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6"
      >
        {columns.map((column) => (
          <PersonColumn
            key={column.key}
            column={column}
            workspaceSlug={workspaceSlug}
            people={people}
            labels={labels}
            today={today}
            projectSlugs={projectSlugs}
            canEdit={canEdit}
            isDragging={dragging !== null}
          />
        ))}
      </div>
    </DndContext>
  );
}

function PersonColumn({
  column,
  workspaceSlug,
  people,
  labels,
  today,
  projectSlugs,
  canEdit,
  isDragging,
}: {
  column: WorkloadPerson;
  workspaceSlug: string;
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  projectSlugs: Readonly<Record<string, string>>;
  canEdit: boolean;
  isDragging: boolean;
}) {
  const t = useTranslations();
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  const name = column.key === NONE ? t('workItems.filters.unassigned') : column.name;

  return (
    <section
      aria-label={name}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-md border bg-surface',
        // §11 asks the drop target to be visible while a drag is in flight;
        // without it a card released a pixel outside the column silently goes
        // back and reads as a bug.
        isOver && isDragging ? 'border-accent' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-sm font-medium text-text">{name}</span>

        {/* §7.4: "each column headed by person + open count + overdue count." */}
        <span className="text-2xs font-medium tabular-nums text-text-subtle">{column.open}</span>
        {column.overdue > 0 && (
          <span className="rounded-xs bg-danger-subtle px-1.5 py-0.5 text-2xs font-medium tabular-nums text-danger">
            {t('workload.overdueCount', { count: column.overdue })}
          </span>
        )}

        {/*
          §17-25, on the screen: "A member marked unavailable until a date is
          shown with those dates on their column and is excluded from 'who has
          capacity' arithmetic." The badge is the first half; `getWorkload` is
          the second, and the second is the one that would otherwise be
          confidently wrong.
        */}
        {column.away && column.unavailableUntil && (
          <span
            className="ms-auto inline-flex items-center gap-1 rounded-xs border border-border bg-surface px-1.5 py-0.5 text-2xs text-text-muted"
            title={column.unavailableReason ?? undefined}
          >
            <CalendarOff size={12} strokeWidth={1.5} aria-hidden />
            {t('availability.awayUntil', { date: column.unavailableUntil })}
          </span>
        )}
      </header>

      <SortableContext
        items={column.items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={setNodeRef} className="flex min-h-16 flex-1 flex-col gap-2 p-2">
          {column.items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              people={people}
              labels={labels}
              today={today}
              href={`/${workspaceSlug}/projects/${projectSlugs[item.projectId] ?? ''}/${item.number}`}
              canDrag={canEdit}
            />
          ))}

          {column.items.length === 0 && (
            <li className="px-1 py-2 text-xs text-text-subtle">
              {column.away ? t('workload.emptyAway') : t('workload.emptyFree')}
            </li>
          )}
        </ul>
      </SortableContext>

      {column.items.length < column.open && (
        <p className="border-t border-border px-3 py-2 text-2xs text-text-subtle">
          {t('dashboards.showingOf', { shown: column.items.length, total: column.open })}
        </p>
      )}
    </section>
  );
}

function identifierOf(columns: readonly WorkloadPerson[], id: string | number): string {
  for (const column of columns) {
    const item = column.items.find((candidate) => candidate.id === String(id));
    if (item) return item.identifier;
  }
  return String(id);
}

function nameOf(columns: readonly WorkloadPerson[], id: string | number): string {
  const direct = columns.find((column) => column.key === String(id));
  if (direct) return direct.name;
  for (const column of columns) {
    if (column.items.some((item) => item.id === String(id))) return column.name;
  }
  return '';
}

/**
 * A problem identifier from the server, or a generic failure.
 *
 * The server never sends a sentence (§13); it sends a key, and the reader's own
 * language turns it into one. An unknown key falls back rather than rendering
 * `MISSING_MESSAGE` into a toast — the defect slice 10 found in the due filter,
 * which next-intl swallows into the server log where nobody sees it.
 */
function reasonFor(error: unknown, t: ReturnType<typeof useTranslations>): string {
  const key = error instanceof Error ? error.message : '';
  const known = ['not_found', 'forbidden', 'read_only', 'archived', 'unknown_member'];
  return known.includes(key) ? t(`workload.problem.${key}`) : t('workload.problem.forbidden');
}
