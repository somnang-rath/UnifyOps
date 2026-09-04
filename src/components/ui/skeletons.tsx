import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@/components/ui/feedback';

/**
 * The two placeholder shapes every screen in the product falls into, so a route
 * that needs §11's loading state has something to reach for rather than a
 * spinner.
 *
 * §11: "Skeletons matching the final layout. Never a full-page spinner, never
 * layout shift on arrival." The second clause is the one that decides the
 * heights here — `h-11` is a list row, `h-8` a control, `h-6` a heading —
 * because a placeholder of the wrong height *is* the layout shift it was added
 * to prevent.
 *
 * Both are wrapped in one `role="status"`. The bars are `aria-hidden`, which is
 * right (they are decoration), and without a region around them a screen reader
 * is told nothing whatever while a page fetches.
 */

/** A heading, a row of controls, and a stack of rows. Most screens. */
export async function PageSkeleton({ rows = 8 }: { rows?: number }) {
  const t = await getTranslations();

  return (
    <div role="status" aria-label={t('feedback.loading')} className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="space-y-1.5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * One thing and its panels: the work item page, and anything else that is a
 * subject with a conversation under it.
 *
 * Two columns above `lg` and one below, matching the page it stands in for —
 * a skeleton that is single-column on a wide screen shifts the whole right-hand
 * side into place when the content lands.
 */
export async function DetailSkeleton() {
  const t = await getTranslations();

  return (
    <div role="status" aria-label={t('feedback.loading')} className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-full max-w-xl" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>

        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
