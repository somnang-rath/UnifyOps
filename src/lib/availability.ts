/**
 * Availability — one date, one optional reason, and the one comparison that
 * reads them (§4, §9, §17-25).
 *
 * §4 is emphatic about the boundary this module must not cross: "Availability
 * is a flag, not time tracking. A member can be marked *unavailable until* a
 * date, with an optional reason. Workload and Needs Attention read it; nothing
 * else does. It is one date — no hours, no balances, no approval flow — because
 * time tracking is a §3 non-goal and this is the smallest thing that keeps the
 * manager's workload view honest while someone is on leave."
 *
 * So there is deliberately no `LeavePeriod`, no overlap arithmetic and no
 * "who is away next Tuesday". There is a date, and whether it is still ahead of
 * us. Every one of those absent things is one table away, and each of them is
 * how this becomes the feature §3 rules out.
 *
 * In `src/lib` because both sides ask the same question: the workload column
 * draws an "away until" badge in the browser, the server excludes the same
 * person from the capacity arithmetic, and a second implementation of "is this
 * date still in the future" is how the badge and the number come to disagree.
 *
 * `today` is always the **workspace's** today (§17-13). It arrives as an
 * argument and has no default, for the reason `workspace-date.ts` gives: a
 * function that falls back to the host's zone works in development and is wrong
 * in production.
 */

import { type CalendarDate, daysBetween } from './workspace-date';

/**
 * The longest reason we store, in **graphemes** (§13).
 *
 * `[...text].length` counts code points, which gives a Khmer workspace roughly a
 * third of the field an English one gets and refuses text that visibly fits —
 * one Khmer syllable is routinely three or four code points. The database's own
 * cap in migration 0024 is in characters and is deliberately looser, so this is
 * always the limit a person actually meets.
 */
export const MAX_REASON_GRAPHEMES = 120;

/** The furthest ahead a return date may be set. A year is a leave, beyond it is an error. */
export const MAX_UNAVAILABLE_DAYS = 365;

export type Availability = {
  /** The day they are back, `YYYY-MM-DD` in the workspace zone. Null when they are here. */
  unavailableUntil: CalendarDate | null;
  /** Optional, and never a translation key — it is what the person typed (§13). */
  unavailableReason: string | null;
};

/**
 * Away right now?
 *
 * **`until` is the day they are back**, so the comparison is strict: somebody
 * unavailable until the 9th is working on the 9th. That reading is the one the
 * date picker's label has to match — "back on" rather than "away through" — and
 * it is why this is a function rather than an inline `>=` at two call sites
 * that would eventually disagree by a day.
 */
export function isAway(availability: Availability, today: CalendarDate): boolean {
  const { unavailableUntil } = availability;
  return unavailableUntil !== null && daysBetween(today, unavailableUntil) > 0;
}

/**
 * How many calendar days until they are back, or null if they are here.
 *
 * Calendar days rather than working days, unlike staleness — a person on leave
 * is away on Sunday too, and "back in 3 days" is what a manager means. Nothing
 * about availability is arithmetic over the company's calendar; that is
 * `business_days_between`'s territory and this is not it.
 */
export function daysAway(availability: Availability, today: CalendarDate): number | null {
  if (!isAway(availability, today)) return null;
  return daysBetween(today, availability.unavailableUntil as CalendarDate);
}

/**
 * Graphemes, not code points (§13).
 *
 * A local copy, as `cycles.ts` and `saved-views.ts` each keep one: it is a
 * one-line pure helper rather than a rule, and importing it from
 * `custom-fields.ts` would make availability depend on §6-4 for the shape of a
 * `for` loop. The *rule* it enforces is written once, in `custom-fields.ts` —
 * `[...text].length` counts code points, one Khmer syllable is routinely three
 * or four of them, and a cap enforced that way silently refuses text that fits.
 */
function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

export type AvailabilityProblem = 'past_date' | 'too_far' | 'reason_too_long' | 'reason_without_date';

/**
 * Whether this is a change worth storing, and why not if it is not.
 *
 * Pure, and shared by the form and the service exactly as `parseRecipients` is:
 * the form disables its submit against the same rules the service refuses on,
 * so the control cannot promise a save that will not happen.
 *
 * A date in the past is rejected rather than silently cleared. "Unavailable
 * until yesterday" is a typo every time — the person meant a year they did not
 * type — and clearing it would report success for a change nobody made.
 */
export function validateAvailability(
  input: { until: string | null; reason: string | null },
  today: CalendarDate,
): { ok: true } | { ok: false; problem: AvailabilityProblem } {
  const reason = input.reason?.trim() ? input.reason.trim() : null;

  if (input.until === null) {
    // Clearing. A reason with nothing to explain is refused rather than
    // dropped, so the form can say which field is the problem — 0024 has the
    // same rule as a CHECK underneath.
    return reason === null ? { ok: true } : { ok: false, problem: 'reason_without_date' };
  }

  const ahead = daysBetween(today, input.until);
  if (ahead <= 0) return { ok: false, problem: 'past_date' };
  if (ahead > MAX_UNAVAILABLE_DAYS) return { ok: false, problem: 'too_far' };
  if (reason !== null && graphemeLength(reason) > MAX_REASON_GRAPHEMES) {
    return { ok: false, problem: 'reason_too_long' };
  }

  return { ok: true };
}
