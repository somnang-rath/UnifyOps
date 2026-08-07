/**
 * Cambodian public holidays — a year-keyed static table (ADR 0016 §2.7).
 *
 * ## Why this is a table and not a computation
 *
 * Cambodia's public holidays are **set annually by sub-decree**. Roughly half
 * of them are fixed Gregorian dates (1 January, 7 January, 9 November …) and
 * the rest follow the Khmer lunar calendar — Visak Bochea, the Royal Ploughing
 * Ceremony, Pchum Ben and the Water Festival all move by two to four weeks
 * between years, and the government occasionally adds or removes days outright.
 * There is no formula that produces next year's list; somebody reads the
 * sub-decree and types it in. So this file needs a human once a year, which is
 * exactly what {@link holidayYearStatus} exists to make visible.
 *
 * ## Why an unknown year must not be treated as "no holidays"
 *
 * A sprint that spans an unmapped year would silently gain back every day off
 * it should have lost, and capacity planning would over-commit the team by up
 * to three weeks a year. Every consumer therefore gets a
 * {@link HolidayYearStatus} alongside the days, and the UI is expected to say
 * "we don't know" rather than quietly imply "there are none".
 *
 * ## Maintaining this file
 *
 * When the sub-decree for a new year is published: add the year, list every
 * day, and set `status: 'official'`. A year marked `'provisional'` has correct
 * fixed dates but lunar dates that have **not** been checked against the
 * sub-decree — usable for rough planning, not for promising a delivery date.
 */

/** ISO `YYYY-MM-DD`, always the local Cambodian day. */
export type HolidayDate = string;

export interface KhmerHoliday {
  date: HolidayDate;
  /** English name, for the `en` locale. */
  en: string;
  /** Khmer name — the primary one for this market. */
  km: string;
  /**
   * Lunar holidays move between years; fixed ones do not. This is what makes a
   * `provisional` year auditable — only the `lunar` entries are in doubt.
   */
  lunar?: boolean;
}

export type HolidayYearStatus =
  /** Every date checked against the published sub-decree. */
  | 'official'
  /** Fixed dates are right; lunar dates are estimates pending the sub-decree. */
  | 'provisional'
  /** The year is not in the table at all. */
  | 'unknown';

interface HolidayYear {
  status: Exclude<HolidayYearStatus, 'unknown'>;
  days: KhmerHoliday[];
}

const FIXED = (date: string, en: string, km: string): KhmerHoliday => ({
  date,
  en,
  km,
});
const LUNAR = (date: string, en: string, km: string): KhmerHoliday => ({
  date,
  en,
  km,
  lunar: true,
});

/**
 * The table. Keyed by Gregorian year.
 *
 * 2026 is `provisional`: its fixed dates are certain, its lunar dates are
 * carried from the usual seasonal window and must be reconciled with the
 * sub-decree before anyone plans a delivery around them.
 */
const KHMER_HOLIDAYS: Record<number, HolidayYear> = {
  2026: {
    status: 'provisional',
    days: [
      FIXED('2026-01-01', 'International New Year Day', 'ចូលឆ្នាំសកល'),
      FIXED('2026-01-07', 'Victory over Genocide Day', 'ទិវាជ័យជម្នះលើរបបប្រល័យពូជសាសន៍'),
      FIXED('2026-03-08', "International Women's Day", 'ទិវានារីអន្តរជាតិ'),
      FIXED('2026-04-14', 'Khmer New Year', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ'),
      FIXED('2026-04-15', 'Khmer New Year', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ'),
      FIXED('2026-04-16', 'Khmer New Year', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ'),
      FIXED('2026-05-01', 'International Labour Day', 'ទិវាពលកម្មអន្តរជាតិ'),
      LUNAR('2026-05-01', 'Visak Bochea Day', 'ពិធីបុណ្យវិសាខបូជា'),
      FIXED('2026-05-14', "King Norodom Sihamoni's Birthday", 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្ម'),
      LUNAR('2026-05-19', 'Royal Ploughing Ceremony', 'ព្រះរាជពិធីច្រត់ព្រះនង្គ័ល'),
      FIXED('2026-06-18', "Queen Mother's Birthday", 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្មព្រះវររាជមាតា'),
      FIXED('2026-09-24', 'Constitution Day', 'ទិវារដ្ឋធម្មនុញ្ញ'),
      LUNAR('2026-10-10', 'Pchum Ben', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ'),
      LUNAR('2026-10-11', 'Pchum Ben', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ'),
      LUNAR('2026-10-12', 'Pchum Ben', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ'),
      FIXED('2026-10-15', 'Commemoration Day of King Father', 'ទិវាប្រារព្ធពិធីរំលឹកព្រះបរមរតនកោដ្ឋ'),
      FIXED('2026-10-29', "King's Coronation Day", 'ព្រះរាជពិធីគ្រងព្រះបរមរាជសម្បត្តិ'),
      FIXED('2026-11-09', 'Independence Day', 'ទិវាបុណ្យឯករាជ្យជាតិ'),
      LUNAR('2026-11-23', 'Water Festival', 'ព្រះរាជពិធីបុណ្យអុំទូក'),
      LUNAR('2026-11-24', 'Water Festival', 'ព្រះរាជពិធីបុណ្យអុំទូក'),
      LUNAR('2026-11-25', 'Water Festival', 'ព្រះរាជពិធីបុណ្យអុំទូក'),
    ],
  },
};

/** Years the table knows anything about. */
export const KNOWN_HOLIDAY_YEARS: number[] = Object.keys(KHMER_HOLIDAYS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * How much to trust this year's list. `'unknown'` means the year is absent —
 * callers must surface that rather than proceed as if there were no holidays.
 */
export function holidayYearStatus(year: number): HolidayYearStatus {
  return KHMER_HOLIDAYS[year]?.status ?? 'unknown';
}

/** Every holiday in one year. Empty for an unknown year — check the status. */
export function khmerHolidaysForYear(year: number): KhmerHoliday[] {
  return KHMER_HOLIDAYS[year]?.days ?? [];
}

/**
 * Holidays falling in `[startIso, endIso]`, inclusive, de-duplicated by date.
 *
 * De-duplication matters: 1 May 2026 is both Labour Day and Visak Bochea, and
 * counting it twice would subtract a day of capacity that does not exist.
 */
export function khmerHolidaysBetween(
  startIso: HolidayDate,
  endIso: HolidayDate,
): KhmerHoliday[] {
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [];

  const seen = new Set<HolidayDate>();
  const out: KhmerHoliday[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const h of khmerHolidaysForYear(y)) {
      if (h.date < startIso || h.date > endIso) continue;
      if (seen.has(h.date)) continue;
      seen.add(h.date);
      out.push(h);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Index for O(1) "is this day a holiday" lookups while rendering a month. */
export function khmerHolidayMap(
  startIso: HolidayDate,
  endIso: HolidayDate,
): Map<HolidayDate, KhmerHoliday> {
  return new Map(khmerHolidaysBetween(startIso, endIso).map((h) => [h.date, h]));
}

/**
 * Cambodia's working week is Monday–Saturday for much of the private sector,
 * but the *displayed* week starts on Sunday and the standard office week is
 * Monday–Friday. Capacity uses Mon–Fri; the calendar grid starts on Sunday
 * (`WEEK_STARTS_ON` in `@prism/i18n`). These are two different questions and
 * conflating them is the bug ADR 0016 §2.7 warns about.
 */
export function isWeekend(iso: HolidayDate): boolean {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return dow === 0 || dow === 6;
}

export interface WorkingDaysResult {
  /** Days that are neither weekend nor public holiday. */
  workingDays: number;
  /** Total calendar days in the range, inclusive. */
  calendarDays: number;
  /** Public holidays that fell on a weekday (i.e. actually cost capacity). */
  holidaysLost: KhmerHoliday[];
  /**
   * The weakest status across every year the range touches. `'unknown'` means
   * `workingDays` is an **over-estimate** and the UI must say so.
   */
  status: HolidayYearStatus;
}

/**
 * Working days between two ISO dates, inclusive, minus Cambodian holidays.
 *
 * Returns the confidence alongside the number on purpose: a caller that only
 * wants the integer has to step over the reason it might be wrong.
 */
export function workingDaysBetween(
  startIso: HolidayDate,
  endIso: HolidayDate,
): WorkingDaysResult {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { workingDays: 0, calendarDays: 0, holidaysLost: [], status: 'unknown' };
  }

  const holidays = khmerHolidayMap(startIso, endIso);
  const holidaysLost: KhmerHoliday[] = [];
  let workingDays = 0;
  let calendarDays = 0;

  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    calendarDays++;
    const iso = `${cur.getFullYear()}-${`${cur.getMonth() + 1}`.padStart(2, '0')}-${`${cur.getDate()}`.padStart(2, '0')}`;
    const dow = cur.getDay();
    if (dow === 0 || dow === 6) continue; // weekend — no holiday to "lose"
    const holiday = holidays.get(iso);
    if (holiday) {
      holidaysLost.push(holiday);
      continue;
    }
    workingDays++;
  }

  // Weakest link across every year touched: one unknown year makes the whole
  // answer an over-estimate, so it cannot be averaged away.
  const rank: Record<HolidayYearStatus, number> = {
    official: 0,
    provisional: 1,
    unknown: 2,
  };
  let status: HolidayYearStatus = 'official';
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const s = holidayYearStatus(y);
    if (rank[s] > rank[status]) status = s;
  }

  return { workingDays, calendarDays, holidaysLost, status };
}
