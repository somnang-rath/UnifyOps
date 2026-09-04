import { describe, expect, it } from 'vitest';
import {
  CALENDAR_HORIZON_YEARS,
  KH_FIXED_HOLIDAYS,
  KH_MOVEABLE_HOLIDAYS,
  horizonYears,
  moveableCalendarFor,
  seedCalendarFor,
  seedRowsFor,
  yearsWithoutHolidays,
} from './holidays';

/**
 * §18-10's answer, pinned.
 *
 * The tests worth having here are the ones about what the seed **refuses** to
 * do: every other property of a table of constants is a restatement of the
 * table. A regression that mattered would be somebody adding Khmer New Year to
 * the fixed list "because it is basically always the 14th", and the first two
 * cases below are what would catch it.
 */
describe('the holiday seed', () => {
  it('never dates a moveable holiday', () => {
    // The five closures §17-18 names are the ones that move. If one of them
    // appears in the fixed list, the calendar starts guessing — which is the
    // one thing §18-10 rules out by name.
    const fixedKeys = new Set(KH_FIXED_HOLIDAYS.map((holiday) => holiday.key));
    for (const moveable of KH_MOVEABLE_HOLIDAYS) {
      expect(fixedKeys.has(moveable.key), moveable.key).toBe(false);
    }
  });

  it('names Khmer New Year, Pchum Ben and Water Festival as needing a date', () => {
    // Not dating them is only honest if the screen still says they exist.
    const keys = KH_MOVEABLE_HOLIDAYS.map((holiday) => holiday.key);
    expect(keys).toContain('kh.khmer_new_year');
    expect(keys).toContain('kh.pchum_ben');
    expect(keys).toContain('kh.water_festival');
  });

  it('offers nothing for a country whose calendar we do not hold', () => {
    // A workspace in another zone is seeded with nothing and told so on the
    // screen. Guessing another country's holidays is the same silent guess one
    // country further away.
    expect(seedCalendarFor('Europe/Berlin')).toEqual([]);
    expect(moveableCalendarFor('Europe/Berlin')).toEqual([]);
    expect(seedRowsFor('Europe/Berlin', 2026, 'en')).toEqual([]);
  });

  it('writes the name in the language it is asked for', () => {
    // The row is a literal, not a `name_key` (§13) — so the language is chosen
    // once, at the moment of writing, from the *company's* setting.
    const en = seedRowsFor('Asia/Phnom_Penh', 2026, 'en');
    const km = seedRowsFor('Asia/Phnom_Penh', 2026, 'km');

    expect(en).toHaveLength(KH_FIXED_HOLIDAYS.length);
    expect(km).toHaveLength(KH_FIXED_HOLIDAYS.length);
    expect(en[0]?.name).not.toEqual(km[0]?.name);
  });

  it('pads dates to YYYY-MM-DD', () => {
    // `is_working_day` compares these against a `date` column; `2026-1-1` is
    // not a date Postgres would accept from an array literal.
    for (const row of seedRowsFor('Asia/Phnom_Penh', 2026, 'en')) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('seeds 1 January and 9 November', () => {
    const dates = seedRowsFor('Asia/Phnom_Penh', 2027, 'en').map((row) => row.date);
    expect(dates).toContain('2027-01-01');
    expect(dates).toContain('2027-11-09');
  });
});

describe('the calendar horizon', () => {
  it('covers this year and next', () => {
    expect(horizonYears('2026-09-04')).toEqual([2026, 2027]);
    expect(horizonYears('2026-09-04')).toHaveLength(CALENDAR_HORIZON_YEARS);
  });

  it('warns about a year with no rows at all', () => {
    // §18-10: "surface a warning in Settings when the calendar runs out."
    expect(yearsWithoutHolidays('2026-09-04', ['2026-01-01'])).toEqual([2027]);
  });

  it('does not warn about a year that is merely incomplete', () => {
    // Emptiness, not completeness. A company that keeps four days off a year is
    // not wrong, and a product that nags them about the other seventeen is one
    // they stop reading.
    expect(yearsWithoutHolidays('2026-09-04', ['2026-01-01', '2027-04-14'])).toEqual([]);
  });

  it('warns about both years when nothing is set', () => {
    expect(yearsWithoutHolidays('2026-09-04', [])).toEqual([2026, 2027]);
  });

  it('ignores rows outside the horizon', () => {
    // History does not answer for the future: a workspace three years old has
    // three years of rows nobody is going to edit.
    expect(yearsWithoutHolidays('2026-09-04', ['2024-01-01', '2025-01-01'])).toEqual([
      2026, 2027,
    ]);
  });
});
