'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { ItemRowData, RowLabel, RowPerson } from '@/lib/work-item-row';
import { ItemRow } from './item-row';
import type { ItemActionContext, StateOption } from './state-select';

/**
 * One group's rows, and its next keyset page.
 *
 * §9: "keyset cursors only; offset pagination degrades exactly when a workspace
 * becomes valuable". So "load more" sends back the opaque cursor the previous
 * page ended with, and the server resumes from that row rather than counting
 * past forty pages of rows it will throw away.
 *
 * The request goes to `/api/internal/list` — the route §8's layout reserves for
 * exactly this — rather than to a server action, because it is a read. A server
 * action would take a mutation's path through revalidation and re-render the
 * whole page to append ten rows to one column.
 *
 * Paging *per group* is the reason the query is shaped the way it is (§9): a
 * board needs a page per column, not one page overall, so each group carries
 * its own cursor and advancing one does not disturb the others.
 */

export function GroupList({
  context,
  groupKey,
  initialRows,
  initialCursor,
  query,
  states,
  people,
  labels,
  today,
  canEdit,
  hrefPrefix,
}: {
  context: ItemActionContext;
  groupKey: string;
  initialRows: readonly ItemRowData[];
  initialCursor: string | null;
  /** The query string this list was rendered from — the server re-parses it. */
  query: string;
  states: readonly StateOption[];
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  canEdit: boolean;
  /**
   * The project's item path, without the number. A string rather than a
   * function: props cross the server/client boundary as data, and a callback
   * would not survive the trip.
   */
  hrefPrefix: string;
}) {
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Only the pages this component fetched live in state. The first page stays a
   * prop.
   *
   * Seeding `useState` from `initialRows` looks simpler and is wrong: the
   * initial value is read once, at mount, so every later server render — a
   * create, a state change, a filter — would be discarded and the list would
   * freeze at whatever it held when the component first appeared.
   *
   * `seed` is what the server last sent. When it changes, the appended pages
   * are dropped and paging restarts, which is correct rather than merely
   * convenient: the cursor described a position in a list that no longer
   * exists. This is React's documented way to reset state when a prop changes —
   * adjusting during render, not in an effect, so there is no flash of the old
   * rows.
   */
  const seed = `${query}|${initialCursor ?? ''}|${initialRows.map((row) => row.id).join(',')}`;
  const [appended, setAppended] = useState<{
    seed: string;
    rows: ItemRowData[];
    cursor: string | null;
  }>({ seed, rows: [], cursor: initialCursor });

  if (appended.seed !== seed) {
    setAppended({ seed, rows: [], cursor: initialCursor });
  }

  const rows = [...initialRows, ...appended.rows];
  const cursor = appended.cursor;

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
            groupKey,
            cursor,
          }),
        });

        if (!response.ok) {
          setError('workItems.errors.loadMore');
          return;
        }

        const page = (await response.json()) as { rows: ItemRowData[]; nextCursor: string | null };

        // Appended by id rather than by concatenation: a page can overlap the
        // one before it if somebody moved an item between the two requests, and
        // a duplicated row with a duplicated key is a React warning and a
        // confusing list.
        setAppended((current) => {
          const seen = new Set([
            ...initialRows.map((row) => row.id),
            ...current.rows.map((row) => row.id),
          ]);
          return {
            seed: current.seed,
            rows: [...current.rows, ...page.rows.filter((row) => !seen.has(row.id))],
            cursor: page.nextCursor,
          };
        });
      } catch {
        setError('workItems.errors.loadMore');
      }
    });
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((item) => (
          <ItemRow
            key={item.id}
            context={context}
            item={item}
            states={states}
            people={people}
            labels={labels}
            today={today}
            href={`${hrefPrefix}/${item.number}`}
            canEdit={canEdit}
          />
        ))}
      </ul>

      {cursor && (
        <div className="flex flex-col gap-1 px-3 py-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="self-start text-xs text-text-muted underline-offset-2 transition-colors duration-120 hover:text-text hover:underline disabled:opacity-60"
          >
            {pending ? t('feedback.loading') : t('workItems.loadMore')}
          </button>
          {/* §11: plain language, and it says what to do next. */}
          {error && (
            <p role="alert" className="text-2xs text-danger">
              {t(error)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
