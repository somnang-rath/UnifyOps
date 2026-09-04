import 'server-only';

import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  horizonYears,
  moveableCalendarFor,
  seedRowsFor,
  yearsWithoutHolidays,
  type MoveableHoliday,
} from '@/lib/holidays';
import { isCalendarDate, todayIn, type CalendarDate } from '@/lib/workspace-date';
import type { Locale } from '@/i18n/routing';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { isUniqueViolation } from '@/server/db/errors';
import { workspaceHoliday } from '@/server/db/schema';
import { withActor, type UnitOfWork } from '@/server/db/tenant';
import type { TenantDb } from '@/server/db/client';

/**
 * The holiday calendar (§6-1, §17-18) — and the operational answer to §18-10,
 * which CLAUDE.md has recorded as open and load-bearing since slice 9 created
 * the table this writes to.
 *
 * Slice 9 built `workspace_holiday` and the three SQL functions that read it,
 * and named the question it could not answer: where the first year of rows
 * comes from. §18-10's recommendation is implemented literally here, including
 * the part that is a refusal — see `src/lib/holidays.ts` for the shape of the
 * seed and why the moveable holidays are named but never dated.
 *
 * **Everything about time in this product reads these rows.** `is_working_day`,
 * `next_working_day`, `business_days_between` and `stale_before` all consult
 * them, so a day added here changes what is stale, what is due soon, where a
 * burndown's ideal line flattens, and which evening the digest goes out — for
 * everybody, retroactively. That is why the whole file is `workspace.settings`
 * and why every change is audited.
 */

export type Holiday = {
  id: string;
  date: CalendarDate;
  name: string;
};

export type HolidayCalendar = {
  holidays: Holiday[];
  /**
   * Years inside the product's own arithmetic horizon that have no rows at all
   * — §18-10's "surface a warning in Settings when the calendar runs out".
   */
  emptyYears: number[];
  /**
   * The closures we know exist and refuse to date (§18-10: "never silently
   * guess a date the workspace has not confirmed").
   *
   * Named on the screen rather than left out of it, because the failure this
   * prevents is not an empty calendar — it is a calendar that *looks* complete.
   * A company that sees "Khmer New Year — three days in mid-April — not set"
   * adds it; one that sees ten fixed holidays and no mention of it assumes we
   * have it covered.
   */
  moveable: readonly MoveableHoliday[];
};

/**
 * The calendar, from the start of this year to the end of the horizon.
 *
 * Bounded rather than "every row", because a workspace three years old has
 * three years of history nobody is going to edit, and the screen exists to fix
 * what is coming rather than to browse what happened. The SQL functions read
 * whatever range they are asked about, so nothing here restricts them.
 */
export async function getHolidayCalendar(resolved: ResolvedActor): Promise<HolidayCalendar> {
  const today = todayIn(resolved.workspace.timezone);
  const years = horizonYears(today);
  const from = `${years[0]}-01-01`;
  const to = `${years[years.length - 1]}-12-31`;

  const holidays = await withActor(resolved.context, async (tx) =>
    tx
      .select({
        id: workspaceHoliday.id,
        date: workspaceHoliday.date,
        name: workspaceHoliday.name,
      })
      .from(workspaceHoliday)
      .where(
        and(
          isNull(workspaceHoliday.deletedAt),
          gte(workspaceHoliday.date, from),
          lte(workspaceHoliday.date, to),
        ),
      )
      .orderBy(asc(workspaceHoliday.date)),
  );

  return {
    holidays,
    emptyYears: yearsWithoutHolidays(
      today,
      holidays.map((holiday) => holiday.date),
    ),
    moveable: moveableCalendarFor(resolved.workspace.timezone),
  };
}

export type HolidayProblem =
  | 'date_required'
  | 'name_required'
  | 'name_too_long'
  | 'duplicate'
  | 'not_found';

export type HolidayResult = { ok: true } | { ok: false; problem: HolidayProblem };

/**
 * A name is a line on a calendar cell, not a document.
 *
 * Counted in **graphemes**, never code points (§13): `[...text].length` gives a
 * Khmer workspace roughly a third of the field an English one gets, silently,
 * because one Khmer syllable is routinely three or four code points. The same
 * arithmetic the truncation rule uses, pointed the other way.
 */
const NAME_MAX_GRAPHEMES = 80;

function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

export async function addHoliday(
  resolved: ResolvedActor,
  input: { date: string; name: string },
): Promise<HolidayResult> {
  assertCan(resolved.actor, 'workspace.settings');

  if (!isCalendarDate(input.date)) return { ok: false, problem: 'date_required' };

  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (graphemeLength(name) > NAME_MAX_GRAPHEMES) return { ok: false, problem: 'name_too_long' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      await tx.insert(workspaceHoliday).values({
        id: uuidv7(),
        workspaceId: resolved.workspace.id,
        date: input.date,
        name,
      });

      uow.emit({
        type: 'workspace.holidays_changed',
        workspaceId: resolved.workspace.id,
        added: 1,
        removed: 0,
        years: [Number(input.date.split('-')[0])],
      });

      return { ok: true } as const;
    });
  } catch (error) {
    // `workspace_holiday_date_key`: one row per day. A company cannot close
    // twice on the same date, and the constraint is the authority rather than a
    // `SELECT` first — between the two of them somebody else can add it.
    if (isUniqueViolation(error)) return { ok: false, problem: 'duplicate' };
    throw error;
  }
}

/**
 * Remove a day off.
 *
 * A **hard** delete, which is the exception in this schema and deserves its
 * reason: `workspace_holiday_date_key` is a unique index on `(workspace_id,
 * date)` and does not exclude soft-deleted rows, so a tombstone would keep the
 * day reserved for ever — a company that deleted 15 April by mistake could
 * never add it back. That is the same trade `deleteWorkflowState` makes for
 * `workflow_state_project_name_key`, and it goes the same way.
 *
 * Nothing references a holiday: the SQL functions read the rows by date, and no
 * row anywhere points at one. There is no history to preserve, unlike a comment
 * or an activity line — the audit event is the record that it went.
 */
export async function removeHoliday(
  resolved: ResolvedActor,
  holidayId: string,
): Promise<HolidayResult> {
  assertCan(resolved.actor, 'workspace.settings');

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ date: workspaceHoliday.date })
      .from(workspaceHoliday)
      .where(eq(workspaceHoliday.id, holidayId))
      .limit(1);

    const found = rows[0];
    // Null covers "no such row" and "another workspace's" alike — RLS has
    // already made the second indistinguishable from the first.
    if (!found) return { ok: false, problem: 'not_found' } as const;

    await tx.delete(workspaceHoliday).where(eq(workspaceHoliday.id, holidayId));

    uow.emit({
      type: 'workspace.holidays_changed',
      workspaceId: resolved.workspace.id,
      added: 0,
      removed: 1,
      years: [Number(found.date.split('-')[0])],
    });

    return { ok: true } as const;
  });
}

/**
 * Write the fixed-date seed for a set of years, skipping days already there.
 *
 * Shared by signup and by the Settings button, which is the whole reason it
 * takes a transaction rather than a `ResolvedActor`: §18-10 asks for the seed at
 * signup *and* for a way to extend it when the calendar runs out, and two
 * implementations of one calendar is how the two disagree about a date.
 *
 * `onConflictDoNothing` rather than an upsert, because a company that edited a
 * seeded row — renamed it, moved it because the sub-decree moved it — has made
 * a decision, and re-running the seed must not undo it. That is §6's
 * reversibility rule read the other way: our default may never overwrite their
 * override.
 *
 * Returns how many rows it actually wrote, so the caller can say so and so a
 * seed that added nothing emits no event.
 */
export async function seedHolidaysInTx(
  tx: TenantDb,
  uow: UnitOfWork,
  options: {
    workspaceId: string;
    timezone: string;
    locale: Locale;
    years: readonly number[];
  },
): Promise<number> {
  const values = options.years.flatMap((year) =>
    seedRowsFor(options.timezone, year, options.locale).map((row) => ({
      id: uuidv7(),
      workspaceId: options.workspaceId,
      date: row.date,
      name: row.name,
    })),
  );

  // A workspace outside a zone whose calendar we hold gets nothing, and is told
  // so on the screen. Guessing another country's holidays is the same silent
  // guess §18-10 rules out, one country further away.
  if (values.length === 0) return 0;

  const written = await tx
    .insert(workspaceHoliday)
    .values(values)
    .onConflictDoNothing({
      target: [workspaceHoliday.workspaceId, workspaceHoliday.date],
    })
    .returning({ date: workspaceHoliday.date });

  if (written.length > 0) {
    uow.emit({
      type: 'workspace.holidays_changed',
      workspaceId: options.workspaceId,
      added: written.length,
      removed: 0,
      years: [...new Set(written.map((row) => Number(row.date.split('-')[0])))],
    });
  }

  return written.length;
}

export type SeedResult = { ok: true; added: number };

/** §18-10's "seed the current and next year", offered again from Settings. */
export async function seedHolidays(
  resolved: ResolvedActor,
  years: readonly number[],
): Promise<SeedResult> {
  assertCan(resolved.actor, 'workspace.settings');

  const today = todayIn(resolved.workspace.timezone);
  // Only years the product's own arithmetic reaches. A button that could write
  // 2031 is a button somebody presses eleven times.
  const allowed = new Set(horizonYears(today));
  const wanted = years.filter((year) => allowed.has(year));
  if (wanted.length === 0) return { ok: true, added: 0 };

  const added = await withActor(resolved.context, async (tx, uow) =>
    seedHolidaysInTx(tx, uow, {
      workspaceId: resolved.workspace.id,
      timezone: resolved.workspace.timezone,
      // The company's language, not the reader's: the row is a literal that
      // every member will see, and a calendar half in English because an
      // English-speaking admin pressed the button is exactly the §13 failure
      // that a `name_key` exists to avoid elsewhere — and cannot, here, because
      // a holiday has no default name we own (see the column comment).
      locale: resolved.workspace.defaultLocale,
      years: wanted,
    }),
  );

  return { ok: true, added };
}

/** Days off inside a range, for a caller that already has a transaction open. */
export async function readHolidaysIn(
  tx: TenantDb,
  range: { from: CalendarDate; to: CalendarDate },
): Promise<CalendarDate[]> {
  const rows = await tx
    .select({ date: workspaceHoliday.date })
    .from(workspaceHoliday)
    .where(
      and(
        isNull(workspaceHoliday.deletedAt),
        gte(workspaceHoliday.date, range.from),
        lte(workspaceHoliday.date, range.to),
      ),
    );

  return rows.map((row) => row.date);
}

/** Used by the settings screen to say what a seed would add before the click. */
export async function holidayDatesIn(
  resolved: ResolvedActor,
  dates: readonly CalendarDate[],
): Promise<Set<CalendarDate>> {
  if (dates.length === 0) return new Set();

  const rows = await withActor(resolved.context, async (tx) =>
    tx
      .select({ date: workspaceHoliday.date })
      .from(workspaceHoliday)
      .where(and(isNull(workspaceHoliday.deletedAt), inArray(workspaceHoliday.date, [...dates]))),
  );

  return new Set(rows.map((row) => row.date));
}
