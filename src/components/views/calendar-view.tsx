'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { PriorityIcon } from '@/components/work-item/priority-icon';
import type { ItemRowData } from '@/lib/work-item-row';
import {
  monthDays,
  monthOf,
  shiftMonth,
  toQueryString,
  type WorkItemQuery,
} from '@/lib/work-item-query';
import { leadingBlanks, weekOrder, type WeekDay } from '@/lib/workspace-date';

/**
 * §12's Calendar, and the fourth of §14 slice 12's "all four view types".
 *
 * **A month of due dates, and nothing else.** §4 lists Calendar beside List,
 * Board and Table without saying what it plots, and the answer follows from the
 * rest of the product: a due date is the only date every item can have (a start
 * date is optional and rare, an estimate is not a date at all), and it is the
 * date §7.4 and §7.8 already build the manager's loop and the evening digest
 * around. A calendar plotting anything else would be a second answer to "when
 * is this due".
 *
 * **The grouping is the day, and the builder does it** — `groupBy: 'day'`, one
 * group per calendar date, which is exactly what §9's counts-plus-`LATERAL`
 * pair was built for. A board needs a page per column; a calendar needs a page
 * per cell, which is the same shape of query with 31 groups instead of six. So
 * this view adds no query of its own, and the count in each cell is the day's
 * **real** total rather than the number of chips that fit.
 *
 * **Undated work has no cell, on purpose.** The month filter is a range on
 * `due_date`, so an item with no due date is outside every month rather than in
 * all of them. An "unscheduled" strip would need that predicate to be `or
 * due_date is null`, which would make the month mean "September, plus
 * everything ever" — the List already answers that question honestly with
 * `d=none`.
 *
 * **The week starts wherever §6-1 says it does.** Slice 12 hardcoded Monday,
 * matching `workspace.working_days`, whose seven-bit mask starts there and
 * defaults to 63 — Monday to Saturday, the market §2.5 describes — and left a
 * note that a calendar starting on Sunday while the working week started on
 * Monday would put the two out of step on the one screen that shows both. Slice
 * 15 turns that constant into the setting §6-1 always said it was, and it keeps
 * the constraint: `week_start` uses the **same day numbering as the mask**, 0 =
 * Monday, so the two cannot drift.
 *
 * Three things have to agree about which column Monday is in — the weekday
 * header row, the leading pad of blank cells, and the grid itself — and they
 * disagree silently: the header says Monday over cells holding Tuesday, and
 * every date on the screen is off by one on a page that otherwise looks
 * perfectly normal. So all three read `weekOrder` and `leadingBlanks` from
 * `src/lib/workspace-date.ts` rather than computing a modulo each.
 *
 * The five states (§11): there is no loading state, because the page is server
 * rendered; a month with nothing due renders its grid with empty cells, which
 * *is* the answer and is more useful than a panel saying so; errors cannot
 * arise here because the view fetches nothing itself; and the edge cases are a
 * day with thirty items (the cell scrolls and says its total), a long Khmer
 * title (truncated by the cell, whole on the item page) and a 390px phone
 * (§15-6 — the grid scrolls sideways inside its own container rather than
 * squeezing seven columns into 55px each).
 */

/** What one day's cell holds. */
export type CalendarDay = {
  /** `YYYY-MM-DD`, and the group key the builder returned. */
  date: string;
  /** Every matching item due that day, not just the ones fetched. */
  total: number;
  items: readonly ItemRowData[];
};

export function CalendarView({
  month,
  days,
  query,
  pathname,
  today,
  weekStart,
  hrefPrefix,
}: {
  /**
   * `YYYY-MM`. Always resolved by the page — from the URL if it named one, and
   * otherwise from the workspace's today. The URL is deliberately *not*
   * rewritten to pin it: an unpinned calendar link means "the current month",
   * which is the same bargain the named due windows make.
   */
  month: string;
  days: readonly CalendarDay[];
  /** The query this month was drawn from, for the previous/next links. */
  query: WorkItemQuery;
  /** The project's path, without locale — `Link` adds that. */
  pathname: string;
  /**
   * §6-1's week start, 0 = Monday through 6 = Sunday — the schema's numbering,
   * not JavaScript's. Required rather than defaulted: a default here is a
   * calendar that quietly ignores the setting when a caller forgets to pass it.
   */
  weekStart: WeekDay;
  /** Today in the workspace timezone (§17-13), so "today" is the company's day. */
  today: string;
  hrefPrefix: string;
}) {
  const t = useTranslations();
  const format = useFormatter();

  const byDate = new Map(days.map((day) => [day.date, day]));
  const dates = monthDays(month);
  const first = dates[0] ?? `${month}-01`;

  // How many blank cells precede the first of the month, given where the week
  // starts. The conversion from `getUTCDay`'s 0-is-Sunday to the schema's
  // 0-is-Monday happens once, in `src/lib/workspace-date.ts`, at the boundary —
  // and it reads the date as UTC so the weekday is the one the calendar date
  // names rather than one either side of it in the viewer's zone (the trap
  // `DueDate` documents).
  const leading = leadingBlanks(first, weekStart);
  const weekdays = weekOrder(weekStart);

  const monthLabel = format.dateTime(new Date(`${first}T00:00:00Z`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const monthHref = (value: string) =>
    `${pathname}${toQueryString({ ...query, filters: { ...query.filters, month: value } })}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link
          href={monthHref(shiftMonth(month, -1))}
          aria-label={t('calendar.previousMonth')}
          className="inline-flex size-7 items-center justify-center rounded-xs border border-border text-text-muted transition-colors duration-120 hover:text-text"
        >
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
        </Link>

        {/* `aria-live` because the month changes under a link that stays put:
            without it, a screen-reader user who pressed "next" hears nothing
            move. */}
        <h2 aria-live="polite" className="min-w-40 text-sm font-medium text-text">
          {monthLabel}
        </h2>

        <Link
          href={monthHref(shiftMonth(month, 1))}
          aria-label={t('calendar.nextMonth')}
          className="inline-flex size-7 items-center justify-center rounded-xs border border-border text-text-muted transition-colors duration-120 hover:text-text"
        >
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        </Link>

        <Link
          href={monthHref(monthOf(today))}
          className="ms-2 text-xs text-text-muted underline-offset-2 transition-colors duration-120 hover:text-text hover:underline"
        >
          {t('calendar.thisMonth')}
        </Link>
      </div>

      {/* Its own scroll container, so seven columns keep a usable width on a
          390px phone (§15-6) instead of collapsing to something nobody can read
          — and so the page around them does not move sideways. */}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-7 border-b border-border bg-surface-sunken">
            {weekdays.map((day) => WEEKDAY_REFERENCE[day]).map((reference) => (
              <div
                key={reference}
                className="px-2 py-1.5 text-2xs font-medium text-text-muted"
              >
                {format.dateTime(new Date(`${reference}T00:00:00Z`), {
                  weekday: 'short',
                  timeZone: 'UTC',
                })}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {/* The blanks before the 1st. `aria-hidden`, because they are grid
                filler and announcing six empty cells before every month is
                noise, not information. */}
            {Array.from({ length: leading }, (_, index) => (
              <div
                key={`lead-${index}`}
                aria-hidden
                className="min-h-24 border-b border-e border-border bg-surface-sunken"
              />
            ))}

            {dates.map((date) => {
              const day = byDate.get(date);
              const items = day?.items ?? [];
              const total = day?.total ?? 0;
              const isToday = date === today;

              return (
                <div
                  key={date}
                  className={cn(
                    'flex min-h-24 flex-col gap-1 border-b border-e border-border p-1.5',
                    isToday && 'bg-accent-subtle',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span
                      className={cn(
                        'text-2xs tabular-nums',
                        isToday ? 'font-semibold text-accent' : 'text-text-subtle',
                      )}
                    >
                      {/* The day number, formatted rather than sliced out of the
                          string, so the Khmer locale's pinned Latin digits
                          (§13) come from the one place that decides them. */}
                      {format.dateTime(new Date(`${date}T00:00:00Z`), {
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    {total > 0 && (
                      <span className="text-2xs font-medium tabular-nums text-text-subtle">
                        {total}
                      </span>
                    )}
                  </div>

                  {/* The cell scrolls rather than clipping. A day with thirty
                      items is an ordinary end-of-sprint Friday, and a cell that
                      silently hid twenty of them would be a calendar that lies
                      about the week it is drawing. */}
                  <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`${hrefPrefix}/${item.number}`}
                          title={item.title}
                          className={cn(
                            'flex items-center gap-1 rounded-xs px-1 py-0.5 text-2xs',
                            'transition-colors duration-120 hover:bg-surface-hover',
                            item.completed ? 'text-text-subtle line-through' : 'text-text',
                          )}
                        >
                          <PriorityIcon
                            priority={item.priority}
                            label={t('priority.label', {
                              value: t(`priority.${item.priority}`),
                            })}
                          />
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  {/* Only when the page did not reach the day's total. The
                      destination is the List for the same month, sorted by due
                      date, which is a real screen showing every one of them —
                      not a per-day filter, which the DSL deliberately does not
                      have: "due on exactly this date" is a question only this
                      grid asks, and the grid already answers it. */}
                  {total > items.length && (
                    <Link
                      href={`${pathname}${toQueryString({
                        ...query,
                        view: 'list',
                        groupBy: 'none',
                        sort: 'due',
                        direction: 'asc',
                      })}`}
                      className="text-2xs text-text-muted underline-offset-2 transition-colors duration-120 hover:text-text hover:underline"
                    >
                      {t('calendar.more', { count: total - items.length })}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One week of real dates, **indexed by the schema's day numbering** — 0 =
 * Monday through 6 = Sunday — used only to ask the formatter for weekday names
 * in the reader's locale.
 *
 * Real dates rather than an array of English day names, because the names must
 * come from `Intl` — a hard-coded "Mon" would be the one string on this screen
 * that stayed English in a Khmer workspace (§13). 2024-01-01 was a Monday, which
 * is what makes the index and the numbering line up.
 */
const WEEKDAY_REFERENCE = [
  '2024-01-01',
  '2024-01-02',
  '2024-01-03',
  '2024-01-04',
  '2024-01-05',
  '2024-01-06',
  '2024-01-07',
] as const;
