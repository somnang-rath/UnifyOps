'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Ban } from 'lucide-react';
import { AvatarGroup } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { DueDate } from '@/components/work-item/due-date';
import { LabelChip } from '@/components/work-item/label-chip';
import { PriorityIcon } from '@/components/work-item/priority-icon';
import { StateSelect } from '@/components/work-item/state-select';
import type { ItemActionContext, StateOption } from '@/components/work-item/state-select';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { customFieldIdOf, type CustomFieldKind } from '@/lib/custom-fields';
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  NUMERIC_COLUMNS,
  clampWidth,
  defaultWidthOf,
} from '@/lib/saved-views';
import type {
  ItemRowData,
  RowCustomValue,
  RowCustomValues,
  RowLabel,
  RowPerson,
} from '@/lib/work-item-row';
import { saveTableLayoutAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * §12's Table, and the third of §14 slice 12's "all four view types".
 *
 * The spec is short and every clause of it is load-bearing: "36px rows, sticky
 * header, 1px separators, no zebra, right-aligned numerics, column widths
 * persisted per saved view. Scrolls inside its own container."
 *
 *   * **No zebra** and 1px separators, because a table of forty columns of
 *     mixed content is already busy; striping adds a second visual rhythm that
 *     competes with the one the data has.
 *   * **Right-aligned numerics** so digits line up at the decimal — with
 *     `tabular-nums`, without which a proportional font makes a column of
 *     numbers ragged even when it is aligned.
 *   * **Its own scroll container**, so the page header and the filter bar stay
 *     put and the sticky header has something to be sticky *inside*. A table
 *     that scrolls the page cannot have a header that stays.
 *
 * **The table forces `groupBy: 'none'`**, exactly as the board forces `state`,
 * and the grouping control is hidden rather than disabled. §4 attaches
 * "(grouped)" to the List and to nothing else, and §12 draws one scrolling
 * table with one sticky header — a grouped table would need a header per group,
 * which is a different component pretending to be this one. Grouping is what
 * the List and the board are for, and the URL keeps whatever grouping was set
 * so switching back restores it.
 *
 * **Custom fields are columns here**, which is the last unbuilt word of §14
 * slice 10's outcome line — "define a field; it appears in create, detail,
 * filter, group, **table**". Their values arrive with the page rather than per
 * row: `listWorkItems` fetches them in one query when this view asks, which is
 * the N+1 a table of custom fields is the obvious place to write by accident.
 *
 * A client component, and for the same reason `GroupList` is one: rows that
 * arrive from `/api/internal/list` have to render through exactly the same code
 * as the ones the server rendered, or a table looks different above and below
 * the fold. Column resizing needs a client anyway.
 */

/**
 * A custom field, as a column.
 *
 * Structurally identical to the filter bar's `FilterField` and deliberately
 * assignable to it, so the page builds this list once and hands the same array
 * to both — a table column and a filter control describing different shapes of
 * the same field is how the two come to disagree about what a field's options
 * are.
 */
export type TableField = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: { id: string; name: string }[];
};

export function TableView({
  context,
  initialRows,
  initialCursor,
  initialCustomValues,
  query,
  columns,
  widths: storedWidths,
  states,
  people,
  labels,
  cycles,
  fields,
  today,
  hrefPrefix,
  canEdit,
  savedViewId,
}: {
  context: ItemActionContext;
  initialRows: readonly ItemRowData[];
  initialCursor: string | null;
  /** Values for the first page, by item id then field id. */
  initialCustomValues: Record<string, RowCustomValues>;
  /** The query string this table was rendered from — the server re-parses it. */
  query: string;
  /** Resolved column identifiers, in display order. */
  columns: readonly string[];
  widths: Readonly<Record<string, number>>;
  states: readonly StateOption[];
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  cycles: readonly { id: string; name: string }[];
  fields: readonly TableField[];
  today: string;
  hrefPrefix: string;
  canEdit: boolean;
  /**
   * The saved view a resize should be remembered in, or null.
   *
   * §12 says widths are persisted "per saved view", so with no view selected a
   * drag lives in component state for as long as the page does — which is what
   * an unsaved change should do. The alternative, a per-member default layout,
   * is a second thing to keep in step with the first for a preference nobody
   * asked for.
   */
  savedViewId: string | null;
}) {
  const t = useTranslations();
  const format = useFormatter();

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Paging state, reset when the server sends a different first page.
   *
   * The same construction `GroupList` uses, and for the same reason it spells
   * out there: seeding `useState` from props reads once at mount and freezes
   * the list at whatever it held then. `seed` is what the server last sent;
   * when it changes the appended pages are dropped, because the cursor
   * described a position in a list that no longer exists.
   */
  const seed = `${query}|${initialCursor ?? ''}|${initialRows.map((row) => row.id).join(',')}`;
  const [appended, setAppended] = useState<{
    seed: string;
    rows: ItemRowData[];
    values: Record<string, RowCustomValues>;
    cursor: string | null;
  }>({ seed, rows: [], values: {}, cursor: initialCursor });

  if (appended.seed !== seed) {
    setAppended({ seed, rows: [], values: {}, cursor: initialCursor });
  }

  const rows = [...initialRows, ...appended.rows];
  const cursor = appended.cursor;
  const values = { ...initialCustomValues, ...appended.values };

  /**
   * Widths, live.
   *
   * Seeded from the saved view and then owned here, which is the one place this
   * component deliberately does what `GroupList` refuses to: a width is a
   * *direct manipulation*, and a drag that snapped back on the next server
   * render would be unusable. The `savedViewId` in the seed key is what makes
   * switching saved views pick up the new view's widths.
   */
  const widthSeed = `${savedViewId ?? ''}|${JSON.stringify(storedWidths)}`;
  const [widths, setWidths] = useState<{ seed: string; value: Record<string, number> }>({
    seed: widthSeed,
    value: { ...storedWidths },
  });
  if (widths.seed !== widthSeed) {
    setWidths({ seed: widthSeed, value: { ...storedWidths } });
  }

  const widthOf = (column: string) => widths.value[column] ?? defaultWidthOf(column);

  /**
   * Writes the layout back to the saved view, if there is one.
   *
   * Fire-and-forget: a width that failed to save is a column that is the wrong
   * size next time, which is not worth an alert over the table somebody is
   * reading. The refusals that matter here — the view was deleted in another
   * tab — leave the drag working for this page, which is the honest outcome.
   */
  const persist = useCallback(
    (next: Record<string, number>) => {
      if (!savedViewId) return;
      void saveTableLayoutAction({
        workspaceSlug: context.workspaceSlug,
        viewId: savedViewId,
        layout: { columns: [...columns], widths: next },
      });
    },
    [savedViewId, context.workspaceSlug, columns],
  );

  /** The drag in progress: which column, where it started, and how wide it was. */
  const drag = useRef<{ column: string; startX: number; startWidth: number } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, column: string) {
    event.preventDefault();
    drag.current = { column, startX: event.clientX, startWidth: widthOf(column) };
    // Capture, so a pointer that leaves the 4px handle mid-drag keeps sending
    // events here rather than to whatever it passed over.
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    // The delta is signed and the table is LTR in both locales, so no direction
    // flip is needed here — Khmer is a left-to-right script (§13).
    const next = clampWidth(current.startWidth + (event.clientX - current.startX));
    setWidths((state) => ({ seed: state.seed, value: { ...state.value, [current.column]: next } }));
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    persist(widths.value);
  }

  /**
   * §11's baseline is "keyboard-operable throughout", and a resize handle is
   * not exempt because it happens to be a drag. Arrow keys move one step, Home
   * and End go to the bounds — the same contract §12 gives every other control
   * that has a range.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, column: string) {
    const STEP = 16;
    const current = widthOf(column);

    const next =
      event.key === 'ArrowLeft'
        ? current - STEP
        : event.key === 'ArrowRight'
          ? current + STEP
          : event.key === 'Home'
            ? MIN_COLUMN_WIDTH
            : event.key === 'End'
              ? MAX_COLUMN_WIDTH
              : null;

    if (next === null) return;
    event.preventDefault();

    const clamped = clampWidth(next);
    const value = { ...widths.value, [column]: clamped };
    setWidths((state) => ({ seed: state.seed, value }));
    persist(value);
  }

  function loadMore() {
    if (!cursor) return;

    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/internal/list', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceSlug: context.workspaceSlug,
            query,
            // The table is always one group, because it forces `by=none`.
            groupKey: 'all',
            cursor,
            withCustomValues: fields.length > 0,
          }),
        });

        if (!response.ok) {
          setError('workItems.errors.loadMore');
          return;
        }

        const page = (await response.json()) as {
          rows: ItemRowData[];
          nextCursor: string | null;
          customValues?: Record<string, RowCustomValues>;
        };

        setAppended((current) => {
          // De-duplicated by id: a page can overlap the one before it if
          // somebody edited an item between the two requests, and a duplicated
          // key is a React warning and a confusing table.
          const seen = new Set([
            ...initialRows.map((row) => row.id),
            ...current.rows.map((row) => row.id),
          ]);
          return {
            seed: current.seed,
            rows: [...current.rows, ...page.rows.filter((row) => !seen.has(row.id))],
            values: { ...current.values, ...(page.customValues ?? {}) },
            cursor: page.nextCursor,
          };
        });
      } catch {
        setError('workItems.errors.loadMore');
      }
    });
  }

  const byMember = new Map(people.map((person) => [person.memberId, person]));
  const byLabel = new Map(labels.map((row) => [row.id, row]));
  const byCycle = new Map(cycles.map((row) => [row.id, row.name]));
  const byField = new Map(fields.map((field) => [field.id, field]));

  if (rows.length === 0) {
    return <EmptyState title={t('workItems.empty')} />;
  }

  return (
    <div className="space-y-2">
      {/* §12: "scrolls inside its own container". The sticky header below is
          sticky relative to this box, so the page's own scroll is untouched and
          a 200-column table (§11's edge case) scrolls sideways here rather than
          dragging the whole layout with it. */}
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border bg-surface">
        <table
          className="w-full border-collapse text-sm"
          // Fixed, so a `<col>` width is honoured rather than treated as a hint
          // the browser may overrule when a cell holds a long Khmer title with
          // no break opportunities in it.
          style={{ tableLayout: 'fixed' }}
        >
          <caption className="sr-only">{t('view.table')}</caption>

          <colgroup>
            {columns.map((column) => (
              <col key={column} style={{ width: `${widthOf(column)}px` }} />
            ))}
          </colgroup>

          <thead>
            <tr className="sticky top-0 z-10 bg-surface-sunken">
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    'relative h-9 border-b border-border px-3 text-xs font-medium text-text-muted',
                    isNumeric(column, byField) ? 'text-end' : 'text-start',
                  )}
                >
                  <span className="block truncate">{headingOf(column, byField, t)}</span>

                  {/* The resize handle. A button so it is focusable and
                      announced; `separator` because that is what it is between
                      two columns, and the value it carries is the width a
                      screen reader can then read back. */}
                  <button
                    type="button"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('table.resize', { column: headingOf(column, byField, t) })}
                    aria-valuenow={widthOf(column)}
                    aria-valuemin={MIN_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    onPointerDown={(event) => onPointerDown(event, column)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onKeyDown={(event) => onKeyDown(event, column)}
                    className={cn(
                      'absolute inset-y-0 end-0 w-1 cursor-col-resize touch-none',
                      'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    )}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((item) => (
              <tr
                key={item.id}
                // 36px rows and a 1px separator, and no zebra (§12).
                className="h-9 border-b border-border transition-colors duration-120 hover:bg-surface-hover"
              >
                {columns.map((column) => (
                  <td
                    key={column}
                    className={cn(
                      'overflow-hidden px-3 align-middle',
                      isNumeric(column, byField) ? 'text-end tabular-nums' : 'text-start',
                    )}
                  >
                    <Cell
                      column={column}
                      item={item}
                      context={context}
                      states={states}
                      byMember={byMember}
                      byLabel={byLabel}
                      byCycle={byCycle}
                      byField={byField}
                      customValues={values[item.id]}
                      today={today}
                      hrefPrefix={hrefPrefix}
                      canEdit={canEdit}
                      format={format}
                      t={t}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="self-start text-xs text-text-muted underline-offset-2 transition-colors duration-120 hover:text-text hover:underline disabled:opacity-60"
          >
            {pending ? t('feedback.loading') : t('workItems.loadMore')}
          </button>
          {/* §11: the error lands where it was caused, in plain language. */}
          {error && (
            <p role="alert" className="text-2xs text-danger">
              {t(error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Cells                                                                     */
/* ------------------------------------------------------------------------- */

type Translate = ReturnType<typeof useTranslations>;
type Format = ReturnType<typeof useFormatter>;

/** §12's "right-aligned numerics", including a custom field whose kind is a number. */
function isNumeric(column: string, byField: Map<string, TableField>): boolean {
  if (NUMERIC_COLUMNS.has(column)) return true;
  const fieldId = customFieldIdOf(column);
  return fieldId !== null && byField.get(fieldId)?.kind === 'number';
}

function headingOf(column: string, byField: Map<string, TableField>, t: Translate): string {
  const fieldId = customFieldIdOf(column);
  // A custom column's heading is the company's own word for it and is never
  // translated (§13) — the same rule a label's name and a cycle's follow.
  if (fieldId !== null) return byField.get(fieldId)?.name ?? '';
  return t(`table.columns.${column}`);
}

function Cell({
  column,
  item,
  context,
  states,
  byMember,
  byLabel,
  byCycle,
  byField,
  customValues,
  today,
  hrefPrefix,
  canEdit,
  format,
  t,
}: {
  column: string;
  item: ItemRowData;
  context: ItemActionContext;
  states: readonly StateOption[];
  byMember: Map<string, RowPerson>;
  byLabel: Map<string, RowLabel>;
  byCycle: Map<string, string>;
  byField: Map<string, TableField>;
  customValues: RowCustomValues | undefined;
  today: string;
  hrefPrefix: string;
  canEdit: boolean;
  format: Format;
  t: Translate;
}) {
  const fieldId = customFieldIdOf(column);
  if (fieldId !== null) {
    const field = byField.get(fieldId);
    if (!field) return null;
    return (
      <CustomCell
        field={field}
        value={customValues?.[fieldId]}
        byMember={byMember}
        format={format}
      />
    );
  }

  switch (column) {
    case 'identifier':
      return (
        <span className="block truncate text-2xs font-medium text-text-subtle">
          {item.identifier}
        </span>
      );

    case 'title':
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {item.blocked && (
            <Ban
              size={12}
              strokeWidth={1.5}
              aria-label={t('workItems.blocked')}
              className="shrink-0 text-danger"
            />
          )}
          <Link
            href={`${hrefPrefix}/${item.number}`}
            // One line rather than the card's two: a table row is 36px, and a
            // title that wraps would make one row twice the height of its
            // neighbours. `title` carries the whole thing for the mouse, and
            // the item page carries it for everyone else.
            title={item.title}
            className="block truncate font-medium text-text transition-colors duration-120 hover:text-accent"
          >
            {item.title}
          </Link>
        </span>
      );

    case 'state':
      return (
        <StateSelect
          context={context}
          itemLabel={item.identifier}
          workItemId={item.id}
          stateId={item.stateId}
          states={states}
          disabled={!canEdit}
        />
      );

    case 'assignees': {
      const assignees = item.assigneeIds
        .map((id) => byMember.get(id))
        .filter((person): person is RowPerson => person !== undefined);
      return (
        <AvatarGroup
          people={assignees.map((person) => ({ id: person.memberId, name: person.name }))}
          size="sm"
        />
      );
    }

    case 'priority':
      return (
        <span className="flex items-center gap-1.5">
          <PriorityIcon
            priority={item.priority}
            label={t('priority.label', { value: t(`priority.${item.priority}`) })}
          />
          <span className="truncate text-xs text-text-muted">{t(`priority.${item.priority}`)}</span>
        </span>
      );

    case 'due':
      return <DueDate date={item.dueDate} today={today} completed={item.completed} />;

    case 'labels': {
      const chips = item.labelIds
        .map((id) => byLabel.get(id))
        .filter((row): row is RowLabel => row !== undefined);
      return (
        <span className="flex flex-nowrap items-center gap-1 overflow-hidden">
          {chips.map((chip) => (
            <LabelChip key={chip.id} name={chip.name} color={chip.color} />
          ))}
        </span>
      );
    }

    case 'estimate':
      // §17-9 hides estimates by default, so an empty cell is the ordinary case
      // and an em dash would be noise on every row of most workspaces.
      return item.estimate === null ? null : <span>{item.estimate}</span>;

    case 'cycle':
      return (
        <span className="block truncate text-xs text-text-muted">
          {item.cycleId === null ? '' : (byCycle.get(item.cycleId) ?? '')}
        </span>
      );

    case 'updated':
      return (
        <span className="block truncate text-xs tabular-nums text-text-subtle">
          {format.dateTime(new Date(item.updatedAt), { day: 'numeric', month: 'short' })}
        </span>
      );

    default:
      return null;
  }
}

/**
 * A custom field's value in a cell (§6-4).
 *
 * Read-only, unlike the item page's panel. §7.11 puts editing a value on the
 * item, and a table cell that silently became an editor would be a second
 * implementation of every kind's control — seven of them — for a screen whose
 * job is comparing rows. `work_item.edit` still governs the value; this is the
 * surface that shows it.
 */
function CustomCell({
  field,
  value,
  byMember,
  format,
}: {
  field: TableField;
  value: RowCustomValue | undefined;
  byMember: Map<string, RowPerson>;
  format: Format;
}) {
  // No row means nothing filled in, which is the *only* meaning it has (§9: "a
  // row exists only where there is a value"). An empty cell rather than a dash,
  // for the reason the estimate column gives.
  if (!value) return null;

  switch (field.kind) {
    case 'text':
      return (
        <span className="block truncate" title={value.text ?? undefined}>
          {value.text}
        </span>
      );

    case 'number':
      // The digits as stored. Slice 10 keeps `numeric` out of a JavaScript
      // float, so this is the string the person typed and not a rounding of it.
      return <span>{value.number}</span>;

    case 'date':
      return value.date === null ? null : (
        <span className="block truncate tabular-nums">
          {/* UTC in and UTC out, so a calendar date is the day it was stored —
              the trap `DueDate` documents, and the same answer. */}
          {format.dateTime(new Date(`${value.date}T00:00:00Z`), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </span>
      );

    case 'checkbox':
      // A ticked box is a row; an unticked one is the absence of a row and was
      // caught above. `aria-hidden` on the glyph with the state in text beside
      // it would be two things to read; the character is the content.
      return <span aria-hidden>{value.checkbox ? '✓' : ''}</span>;

    case 'user': {
      const person = value.memberId === null ? undefined : byMember.get(value.memberId);
      return <span className="block truncate">{person?.name ?? ''}</span>;
    }

    case 'select':
    case 'multi_select': {
      // Option **ids** resolved to names at render — §7.11's promise that a
      // rename preserves values, which is only true because the value never
      // stored the word.
      const names = (value.optionIds ?? [])
        .map((id) => field.options.find((option) => option.id === id)?.name)
        .filter((name): name is string => name !== undefined);
      return (
        <span className="block truncate" title={names.join(', ')}>
          {names.join(', ')}
        </span>
      );
    }

    default:
      return null;
  }
}
