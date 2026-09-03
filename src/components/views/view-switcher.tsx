'use client';

import { useTranslations } from 'next-intl';
import { Columns3, List } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { toQueryString, VIEWS, type View, type WorkItemQuery } from '@/lib/work-item-query';

/**
 * List | Board, as a segmented control.
 *
 * **Links, not buttons.** §5 makes the view part of the URL, so switching views
 * is navigation and should behave like it: middle-click opens the board in a
 * new tab, the back button returns to the list, and the address bar is
 * shareable at every point. A button calling `router.replace` would break all
 * three to save nothing.
 *
 * The rest of the query rides along untouched, because the href is built by the
 * same `toQueryString` the filter bar writes with — so switching to the board
 * keeps the filter you were looking at, which is the entire point of §5.
 */

const ICONS: Record<View, typeof List> = {
  list: List,
  board: Columns3,
};

export function ViewSwitcher({
  query,
  pathname,
  className,
}: {
  query: WorkItemQuery;
  /** The project's path, without locale — `Link` adds that. */
  pathname: string;
  className?: string;
}) {
  const t = useTranslations();

  return (
    <div
      role="group"
      aria-label={t('view.switch')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-sunken p-0.5',
        className,
      )}
    >
      {VIEWS.map((view) => {
        const Icon = ICONS[view];
        const current = query.view === view;

        return (
          <Link
            key={view}
            href={`${pathname}${toQueryString({ ...query, view })}`}
            // `page` rather than `true`: this is which view of one page is
            // showing, and it is what a screen reader announces as current.
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-xs font-medium',
              'transition-colors duration-120 ease-[var(--ease-out-soft)]',
              current
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
          >
            <Icon size={13} strokeWidth={1.5} aria-hidden />
            {t(`view.${view}`)}
          </Link>
        );
      })}
    </div>
  );
}
