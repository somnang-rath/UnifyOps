'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/feedback';
import { VIEWS, type View } from '@/lib/work-item-query';

/**
 * §11's loading state for a project's work, shaped like the view that is
 * actually arriving.
 *
 * §7.1 asks for "`[L]` skeleton board with state columns already drawn", and a
 * `loading.tsx` cannot honour that on its own: it is handed no params, so it
 * cannot know whether the board, the List, the Table or the Calendar is on the
 * way — and a placeholder shaped like the wrong one is layout shift wearing a
 * skeleton's clothes, which is the exact thing §11 forbids.
 *
 * So the shape is read from the URL on the client. A `loading.tsx` *is* a
 * Suspense fallback, which is the boundary `useSearchParams` requires, and the
 * URL has already changed to the destination by the time this renders. One
 * client component, no page refactor, and the shape is right in all four
 * views.
 *
 * The six board columns are the six default states (§4). A brand-new project
 * has exactly those, which is the moment §7.1 is describing; a project that has
 * since gained a seventh column shifts by one column-width, and that is a far
 * smaller lie than drawing rows where columns are coming.
 */
export function ViewSkeleton() {
  const t = useTranslations();
  const params = useSearchParams();

  // `view`, and `list` when it is absent — the same two facts `parseWorkItemQuery`
  // states. Read directly rather than through the parser because the parser wants
  // a `ParamBag` and this side has a `URLSearchParams`; the fallback is the DSL's
  // own default and `VIEWS` is imported rather than re-listed, so a fifth view
  // cannot be added without this file seeing it.
  const raw = params.get('view') ?? 'list';
  const view: View = (VIEWS as readonly string[]).includes(raw) ? (raw as View) : 'list';

  return (
    <div role="status" aria-label={t('feedback.loading')} className="space-y-4">
      {/* The chrome every view shares, at the heights the real controls use:
          the project heading, its tab row, the saved-views bar and the filter
          bar. It is most of what a person sees jump when a placeholder guesses
          wrong, and it is identical in all four views. */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <div className="flex gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      {view === 'board' ? <BoardShape /> : view === 'table' ? <TableShape /> :
        view === 'calendar' ? <CalendarShape /> : <ListShape />}
    </div>
  );
}

function BoardShape() {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 pb-2 sm:-mx-6 sm:px-6">
      {Array.from({ length: 6 }, (_, column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <div className="flex min-h-24 flex-col gap-2 rounded-md border border-border bg-surface-sunken p-2">
            {Array.from({ length: 3 - (column % 2) }, (_, card) => (
              <Skeleton key={card} className="h-20 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListShape() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }, (_, group) => (
        <div key={group} className="space-y-1.5">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 4 }, (_, row) => (
            <Skeleton key={row} className="h-11 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

function TableShape() {
  return (
    <div className="space-y-px overflow-hidden rounded-md border border-border">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 12 }, (_, row) => (
        <Skeleton key={row} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CalendarShape() {
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
      {Array.from({ length: 35 }, (_, cell) => (
        <Skeleton key={cell} className="h-20 rounded-none sm:h-24" />
      ))}
    </div>
  );
}
