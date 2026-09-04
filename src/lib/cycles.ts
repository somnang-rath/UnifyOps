import { isCalendarDate, type CalendarDate } from './workspace-date';
import { STATE_GROUPS, type StateGroup } from './state-groups';

/**
 * Cycles (§7.6, §14 slice 11) — the pure half.
 *
 * In `src/lib` for the reason `work-item-query.ts` and `custom-fields.ts` are:
 * both sides run every function here. The cycle form validates a date range as
 * somebody types it and the service validates the same range on submit; the
 * burndown is drawn in the browser from a series the server computed, and the
 * *ideal* line is arithmetic neither side should own alone.
 *
 * **A cycle's status is derived, never stored**, and that is the decision the
 * rest of this module hangs off. §7.6 says a cycle "becomes active on start
 * date" — a stored status column would need something to flip it, which means a
 * scheduled job per cycle, which means a cycle that silently never starts
 * because the job was down the morning it should have run. Two dates and today
 * answer the question with nothing to go wrong, and `today` is the workspace's
 * (§17-13), never the viewer's device.
 *
 * The one thing that *is* stored is `completedAt`, and it is not the status: it
 * records that somebody answered §7.6's end-of-cycle prompt, which is a
 * different fact from the end date having passed.
 */

/** §7.6's four situations a cycle can be in. Identifiers, never labels (§13). */
export const CYCLE_STATUSES = ['upcoming', 'active', 'ended', 'completed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/**
 * The dates and the one stored flag every status question needs.
 *
 * A structural type rather than the row type, so the settings form can ask
 * about a range that has not been saved yet.
 */
export type CyclePeriod = {
  startDate: CalendarDate;
  endDate: CalendarDate;
  completedAt: Date | null;
};

/**
 * Where a cycle sits today (§7.6).
 *
 *   `upcoming`  — planned, has not started.
 *   `active`    — today is inside the range. The one a project has at most one
 *                 of in the common case, though §7.6 allows overlap.
 *   `ended`     — the end date has passed and nobody has answered the prompt
 *                 about what happens to the work still open in it.
 *   `completed` — the prompt was answered, whatever the answer was. "Leave
 *                 them" is a decision, and a cycle whose prompt keeps
 *                 reappearing after it has been dismissed is a cycle nobody
 *                 finishes.
 *
 * `ended` and `completed` are deliberately different: only one of them puts a
 * decision in front of somebody, and a screen that could not tell them apart
 * would either nag forever or never ask.
 */
export function cycleStatus(cycle: CyclePeriod, today: CalendarDate): CycleStatus {
  if (cycle.completedAt !== null) return 'completed';
  // String comparison is date comparison for `YYYY-MM-DD`, which is the whole
  // reason every date in this product crosses a boundary in that shape.
  if (today < cycle.startDate) return 'upcoming';
  if (today > cycle.endDate) return 'ended';
  return 'active';
}

/** Whether work can still be planned into this cycle. */
export function isOpen(status: CycleStatus): boolean {
  return status === 'upcoming' || status === 'active';
}

/* ------------------------------------------------------------------------- */
/* Validation                                                                */
/* ------------------------------------------------------------------------- */

/** §12/§13: a name is user content, capped by grapheme rather than code point. */
export const MAX_CYCLE_NAME_LENGTH = 60;

/**
 * The longest range a cycle may cover.
 *
 * Not an opinion about how teams should work — §7.6 says "date range" and means
 * it — but a bound on the burndown, which is one row per calendar day. A year
 * of daily points is already more than any chart can draw legibly, and without
 * a cap a typo of `2126` in the end date is a query that returns thirty-six
 * thousand rows.
 */
export const MAX_CYCLE_DAYS = 366;

/** Identifiers, never sentences — the same contract every service problem has. */
export type CycleProblem =
  | 'name_required'
  | 'name_too_long'
  | 'invalid_dates'
  | 'end_before_start'
  | 'too_long';

export type PeriodInput = { name: string; startDate: string; endDate: string };

/**
 * Everything wrong with a proposed cycle, or null.
 *
 * Shared by the form and the service so the preview cannot promise a range the
 * save refuses — the same bargain `parseRecipients` makes between the invite
 * form's chips and the send.
 *
 * Overlap is deliberately **not** checked here. §7.6: "overlapping cycles →
 * allowed, warned". A warning is not a validation failure, and putting it here
 * would make it one.
 */
export function validatePeriod(input: PeriodInput): CycleProblem | null {
  const name = input.name.trim();
  if (!name) return 'name_required';
  if (graphemeLength(name) > MAX_CYCLE_NAME_LENGTH) return 'name_too_long';

  if (!isCalendarDate(input.startDate) || !isCalendarDate(input.endDate)) return 'invalid_dates';
  if (input.endDate < input.startDate) return 'end_before_start';
  if (calendarDaysBetween(input.startDate, input.endDate) + 1 > MAX_CYCLE_DAYS) return 'too_long';

  return null;
}

/**
 * Length in graphemes.
 *
 * `[...text].length` counts code points, which gives a Khmer workspace roughly
 * a third of the field an English one gets and refuses text that fits — one
 * Khmer syllable is routinely three or four code points. §13 makes this rule
 * for truncation; a cap is the same arithmetic pointed the other way.
 */
function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

/**
 * Whole calendar days from `from` to `to`, which may be negative.
 *
 * `Date.UTC` on the parts rather than `new Date(string)`: the latter parses a
 * bare `YYYY-MM-DD` as UTC midnight in some runtimes and local midnight in
 * others, and the difference is one day at either end of the world. Nothing
 * here is a moment in time — these are calendar positions being subtracted.
 */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((utcOf(to) - utcOf(from)) / MS_PER_DAY);
}

function utcOf(date: CalendarDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/**
 * The calendar date `days` after `date`. Used to walk a cycle's range.
 *
 * Assembled from the UTC parts rather than cut out of `toISOString`, so the
 * shape of the result is stated here rather than inherited from a formatter
 * that also carries a time and a zone neither end of this function means.
 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(utcOf(date) + days * 86_400_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/* ------------------------------------------------------------------------- */
/* Progress                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * How a cycle's work is distributed across §4's five state groups.
 *
 * Keyed on the **group**, never on the state, because §4 is explicit: "Progress,
 * burndown, and 'is it done' derive from the group, never the state name." A
 * company that renames "Done" to "Shipped" has not changed what completion
 * means, and a company with two completed states must not have one of them
 * silently excluded.
 */
export type GroupCounts = Record<StateGroup, number>;

export function emptyCounts(): GroupCounts {
  return Object.fromEntries(STATE_GROUPS.map((group) => [group, 0])) as GroupCounts;
}

export type CycleProgress = {
  counts: GroupCounts;
  /** Every item in the cycle, cancelled ones included. */
  total: number;
  /**
   * Items that count toward the bar: everything except cancelled work.
   *
   * Cancelled work leaves the denominator rather than joining the numerator.
   * Counting it as done would let a team hit 100% by abandoning the sprint;
   * counting it as outstanding would leave a cycle permanently short of the end
   * for work somebody deliberately decided not to do. §4 gives `cancelled` its
   * own group precisely so this can be a third answer.
   */
  inScope: number;
  completed: number;
  /** 0–100, rounded. 100 only when nothing in scope is open. */
  percent: number;
  /** Points, when anybody estimated anything. Null when nobody did (§17-9). */
  estimate: { total: number; completed: number } | null;
};

export function progressFrom(
  counts: GroupCounts,
  estimate: { total: number; completed: number } | null = null,
): CycleProgress {
  const total = STATE_GROUPS.reduce((sum, group) => sum + counts[group], 0);
  const inScope = total - counts.cancelled;
  const completed = counts.completed;

  return {
    counts,
    total,
    inScope,
    completed,
    // An empty cycle is 0%, not NaN and not 100%: "add work to this cycle" is
    // §7.6's empty state, and a bar reading complete above it would be absurd.
    percent: inScope === 0 ? 0 : Math.round((completed / inScope) * 100),
    estimate: estimate && estimate.total > 0 ? estimate : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Burndown                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * One day of the chart.
 *
 * Every value is measured at the **end** of the day, in workspace time. That
 * choice is what makes the two lines comparable: an item completed on Tuesday
 * is gone from Tuesday's `remaining`, and the ideal line has likewise burned
 * Tuesday's share by the time Tuesday closes.
 */
export type BurndownPoint = {
  date: CalendarDate;
  /**
   * Items still open at the end of this day, or **null** for a day that has not
   * happened yet.
   *
   * Null rather than the current figure carried forward: a flat line running to
   * the end of the cycle reads as a team that has stopped working, which is the
   * opposite of what a chart on day three of ten should say.
   */
  remaining: number | null;
  /** Where the scope line should be at the end of this day. */
  ideal: number;
  /** False on a weekend or a workspace holiday — the ideal line is flat across it. */
  working: boolean;
};

/**
 * The ideal line, laid over a series that already knows which days the company
 * works.
 *
 * **This is why §9 puts `business_days_between` behind one SQL function.** A
 * two-week cycle in a Monday-to-Saturday market (§2.5, and the 63 default the
 * schema carries) contains twelve working days, not ten and not fourteen — and
 * an ideal line that descends across Sundays tells a team they are behind every
 * Monday morning. Khmer New Year does the same thing for a week (§17-18). The
 * *working* flags come from the database, which is the only place that knows a
 * company's calendar; the arithmetic over them is here, where both sides can
 * run it.
 *
 * A cycle containing no working day at all — a range entirely inside a holiday
 * cluster, which is a mistake somebody should be able to see rather than a
 * division by zero — burns down linearly across its calendar days instead.
 */
export function withIdealLine(
  days: readonly { date: CalendarDate; remaining: number | null; working: boolean }[],
  scope: number,
): BurndownPoint[] {
  const workingTotal = days.filter((day) => day.working).length;
  const divisor = workingTotal > 0 || days.length === 0 ? workingTotal : days.length;
  const countsToward = (day: { working: boolean }) => (workingTotal > 0 ? day.working : true);

  let burned = 0;
  return days.map((day) => {
    if (countsToward(day)) burned += 1;
    return {
      date: day.date,
      remaining: day.remaining,
      working: day.working,
      // Rounded to whole items, because the chart's other line is a count and
      // an ideal of 4.7 items drawn against a real 5 invites a question with no
      // answer.
      ideal: divisor === 0 ? 0 : Math.max(0, Math.round(scope * (1 - burned / divisor))),
    };
  });
}

/**
 * Whether the cycle is behind, ahead, or on the line, today.
 *
 * Compared at the last day that has actually happened, never at the end of the
 * range — comparing today's count against the *final* ideal of zero would
 * report every cycle as behind until its last afternoon.
 */
export function burndownStanding(
  points: readonly BurndownPoint[],
): 'ahead' | 'on_track' | 'behind' | null {
  const latest = [...points].reverse().find((point) => point.remaining !== null);
  if (!latest || latest.remaining === null) return null;

  if (latest.remaining < latest.ideal) return 'ahead';
  if (latest.remaining > latest.ideal) return 'behind';
  return 'on_track';
}
