/**
 * Dates in the company's timezone (§4, §17-13).
 *
 * "Overdue is evaluated in the **workspace** timezone, never the viewer's
 * device — otherwise an item is late for the employee and on time for their
 * manager, and the two disagree about one number in one meeting."
 *
 * That is the whole reason this module exists rather than `new Date()` at each
 * call site. Every question the product answers about a calendar day — is this
 * overdue, is it due today, which bucket does My Work put it in — is asked
 * here, against a timezone that arrives as an argument. There is deliberately
 * no default: a function that falls back to the host's zone is a function that
 * silently works in development and is wrong in production.
 *
 * In `src/lib` because both sides ask: the query builder resolves "today" to
 * filter on, and the list renders an overdue badge from the same rule. One
 * implementation, so the badge and the filter cannot disagree.
 *
 * Dates are `YYYY-MM-DD` strings throughout, matching how `work_item.due_date`
 * is stored and read. A `Date` would carry a time and a zone that neither the
 * column nor the person who picked the date ever meant.
 */

/** `YYYY-MM-DD`. The only date shape that crosses this module's boundary. */
export type CalendarDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is CalendarDate {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/**
 * Whether a string is a timezone this runtime knows.
 *
 * Checked rather than constrained in the schema: the tz database is updated
 * independently of our migrations, so a `CHECK` constraint written today would
 * reject a zone that becomes valid tomorrow, or keep accepting one that is
 * renamed.
 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today, as the company sees it.
 *
 * `en-CA` rather than assembling parts by hand: it is the one widely-supported
 * locale whose short date format *is* `YYYY-MM-DD`, so there is no month/day
 * ordering to get wrong. The digits are Latin by construction here — the
 * `numberingSystem: 'latn'` pin in `src/i18n/request.ts` governs what a *user*
 * reads, and this string is never read by one.
 */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The hour of day, 0–23, as the company sees it.
 *
 * §7.8's digest goes out "per person per evening, in the **workspace**
 * timezone", and an hourly job in UTC has to ask each workspace whether it is
 * evening *there*. `hourCycle: 'h23'` rather than the locale default, because
 * `en-CA` renders midnight as 24 in some runtimes and this is arithmetic, not
 * something anybody reads.
 */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);

  return Number.parseInt(hour, 10);
}

/** `date` plus `days`, in calendar days. Pure string arithmetic through UTC. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The five buckets §7.3 groups My Work by, and the one the List view labels a
 * due date with.
 *
 * `completed` is not a bucket: an item that is finished is not overdue, however
 * late it was. §7.4 exists to show a manager what still needs doing, and a
 * surface that keeps reporting finished-late work is one people learn to
 * ignore.
 */
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

/**
 * The five, in the order §7.3 lists them — which is also the order they matter
 * in, most urgent first.
 *
 * Exported as a frozen list because slice 13's My Work hands them to §9's page
 * query as its group keys, and that query is *given* its groups rather than
 * discovering them (a group that vanishes when it empties is a group nothing can
 * be added to). The SQL that produces these keys is `dueBucketExpression` in the
 * builder, and it mirrors `dueBucket` below one branch at a time.
 */
export const DUE_BUCKETS = ['overdue', 'today', 'week', 'later', 'none'] as const;

export function dueBucket(
  dueDate: CalendarDate | null,
  today: CalendarDate,
  options: { completed?: boolean } = {},
): DueBucket {
  if (!dueDate) return 'none';

  const delta = daysBetween(today, dueDate);
  if (delta < 0) return options.completed ? 'later' : 'overdue';
  if (delta === 0) return 'today';
  if (delta < 7) return 'week';
  return 'later';
}

/** §12: "Overdue → danger text on danger-subtle". This is the question behind it. */
export function isOverdue(
  dueDate: CalendarDate | null,
  today: CalendarDate,
  options: { completed?: boolean } = {},
): boolean {
  return dueBucket(dueDate, today, options) === 'overdue';
}

/* ------------------------------------------------------------------------- */
/* Week start and working days (§6-1, slice 15)                              */
/* ------------------------------------------------------------------------- */

/**
 * Days of the week in **schema order: 0 = Monday through 6 = Sunday.**
 *
 * This is `workspace.working_days`' bit order and `workspace.week_start`'s
 * numbering, and it is deliberately not JavaScript's, where 0 is Sunday. Two
 * numbering schemes is how a calendar ends up one column out of step with the
 * mask that shades its working days — so the conversion happens here, at the
 * boundary, and nowhere else.
 *
 * Closed enum, mapped to messages in code (§13); the *names* come from
 * `Intl.DateTimeFormat` in the reader's locale rather than from a catalogue,
 * because a weekday is one of the few strings a formatter already knows in both
 * scripts.
 */
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export function isWeekDay(value: unknown): value is WeekDay {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/** JavaScript's `getUTCDay` (0 = Sunday) as this module's index (0 = Monday). */
export function weekDayOf(date: CalendarDate): WeekDay {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return ((jsDay + 6) % 7) as WeekDay;
}

/** Whether the company works on this day of the week, per the seven-bit mask. */
export function isWorkingWeekDay(workingDays: number, day: WeekDay): boolean {
  return (workingDays & (1 << day)) !== 0;
}

/** The mask with one day toggled — what the settings form sends back. */
export function toggleWorkingDay(workingDays: number, day: WeekDay, on: boolean): number {
  return on ? workingDays | (1 << day) : workingDays & ~(1 << day);
}

/**
 * The seven days in the order a calendar starting on `weekStart` draws them.
 *
 * One function rather than a `%` at each call site, because slice 12's calendar
 * draws a weekday header row, a leading pad of blank cells and a grid, and all
 * three have to agree about which column Monday is in. They disagree silently:
 * the header says Monday and the cells are Tuesday's, and every date is off by
 * one on a screen that otherwise looks perfectly normal.
 */
export function weekOrder(weekStart: WeekDay): WeekDay[] {
  return WEEK_DAYS.map((offset) => ((weekStart + offset) % 7) as WeekDay);
}

/** How many blank cells precede the first of a month in a grid starting on `weekStart`. */
export function leadingBlanks(firstOfMonth: CalendarDate, weekStart: WeekDay): number {
  return (weekDayOf(firstOfMonth) - weekStart + 7) % 7;
}

/**
 * A company that works no days at all.
 *
 * Refused by the service and by a CHECK in migration 0028, because it is not a
 * preference — it is a workspace where `next_working_day` never terminates and
 * the digest never sends. §6's rule is that no setting can put a workspace in an
 * unrecoverable state, and this is the one setting on the screen that could.
 */
export function hasNoWorkingDays(workingDays: number): boolean {
  return (workingDays & 0b1111111) === 0;
}
