/**
 * The public-holiday seed, and the answer to §18-10.
 *
 * §17-18 is the finding: everything the product says about time — stale, due
 * soon, cycle progress, the evening digest — is arithmetic over working days,
 * and in this market those days are interrupted by multi-day closures. Slice 9
 * built `workspace_holiday` and the three SQL functions that read it; slice 15
 * is where the first year of rows comes from, which is the question §18-10 left
 * open and CLAUDE.md records as load-bearing.
 *
 * **The answer implements §18-10's recommendation literally, including the half
 * that is a refusal.** Cambodian public holidays are set by sub-decree each
 * year and several of them move, so:
 *
 * - the **fixed-date** holidays are seeded for the current and next year, at
 *   signup and on demand from Settings;
 * - the **moveable** ones are named but never dated. A guessed date is worse
 *   than an absent one: absent, a company adds it; guessed, the product is
 *   confidently wrong about the fortnight of Khmer New Year and nobody looks,
 *   because the calendar appears to be filled in;
 * - Settings warns when the calendar **runs out** — when a year the product's
 *   own arithmetic will reach has no rows at all.
 *
 * Every seeded row is an ordinary editable row afterwards. Nothing here is a
 * default the company cannot delete, which is §6's governing rule.
 *
 * In `src/lib` because both sides read it: the settings screen lists what is
 * missing as the user watches, and the service writes the same rows.
 */

import type { CalendarDate } from './workspace-date';

/**
 * A holiday the calendar can state without asking anybody.
 *
 * Names are carried in both languages because the row that gets written is a
 * literal, not a `name_key` — the schema is explicit that a holiday arrives
 * named in the company's own language and that there is no English default it
 * would be right to fall back to (§13). So the seed picks the name to write
 * from the workspace's default language at the moment it writes it, and after
 * that the company owns the string.
 */
export type SeedHoliday = {
  /** Stable across years and languages; the seed uses it to avoid duplicates. */
  key: string;
  month: number;
  day: number;
  name: { en: string; km: string };
};

/**
 * A closure that exists every year and whose date does not.
 *
 * Listed, never dated. Khmer New Year is determined astronomically and starts
 * on 13 or 14 April depending on the year; Visak Bochea, Royal Ploughing, Pchum
 * Ben and Water Festival follow the lunar calendar. Writing "probably the 14th"
 * into a company's calendar is exactly the silent guess §18-10 rules out.
 */
export type MoveableHoliday = {
  key: string;
  /** Roughly when in the year to look, so the prompt is useful rather than cryptic. */
  around: { en: string; km: string };
  name: { en: string; km: string };
};

/**
 * Cambodia's fixed-date public holidays, as they stand after the 2020
 * sub-decree that shortened the list.
 *
 * Keyed to `Asia/Phnom_Penh` rather than to a country column, because there is
 * no country column and inventing one would be a second thing to keep in step
 * with the timezone that already answers this question for every other date in
 * the product. A workspace in another zone is seeded with nothing and told so,
 * which is honest — we do not have that country's calendar.
 */
export const KH_FIXED_HOLIDAYS: readonly SeedHoliday[] = [
  {
    key: 'kh.new_year_intl',
    month: 1,
    day: 1,
    name: { en: 'International New Year Day', km: 'ចូលឆ្នាំសកល' },
  },
  {
    key: 'kh.victory',
    month: 1,
    day: 7,
    name: { en: 'Victory over Genocide Day', km: 'ទិវាជ័យជម្នះលើរបបប្រល័យពូជសាសន៍' },
  },
  {
    key: 'kh.womens_day',
    month: 3,
    day: 8,
    name: { en: 'International Women’s Day', km: 'ទិវានារីអន្តរជាតិ' },
  },
  {
    key: 'kh.labour_day',
    month: 5,
    day: 1,
    name: { en: 'International Labour Day', km: 'ទិវាពលកម្មអន្តរជាតិ' },
  },
  {
    key: 'kh.king_birthday',
    month: 5,
    day: 14,
    name: { en: 'King Norodom Sihamoni’s Birthday', km: 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្មព្រះមហាក្សត្រ' },
  },
  {
    key: 'kh.queen_mother_birthday',
    month: 6,
    day: 18,
    name: {
      en: 'King’s Mother’s Birthday',
      km: 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្មសម្តេចព្រះមហាក្សត្រី',
    },
  },
  {
    key: 'kh.constitution',
    month: 9,
    day: 24,
    name: { en: 'Constitution Day', km: 'ទិវាប្រកាសរដ្ឋធម្មនុញ្ញ' },
  },
  {
    key: 'kh.king_father',
    month: 10,
    day: 15,
    name: { en: 'Commemoration Day of King Father', km: 'ទិវាប្រារព្ធពិធីរំលឹកព្រះបរមរតនកោដ្ឋ' },
  },
  {
    key: 'kh.coronation',
    month: 10,
    day: 29,
    name: { en: 'King’s Coronation Day', km: 'ព្រះរាជពិធីគ្រងព្រះបរមរាជសម្បត្តិ' },
  },
  {
    key: 'kh.independence',
    month: 11,
    day: 9,
    name: { en: 'Independence Day', km: 'ទិវាបុណ្យឯករាជ្យជាតិ' },
  },
] as const;

/** The ones the company has to date itself, every year, for ever. */
export const KH_MOVEABLE_HOLIDAYS: readonly MoveableHoliday[] = [
  {
    key: 'kh.khmer_new_year',
    around: { en: 'mid-April, three days', km: 'ពាក់កណ្តាលខែមេសា បីថ្ងៃ' },
    name: { en: 'Khmer New Year', km: 'ចូលឆ្នាំខ្មែរ' },
  },
  {
    key: 'kh.visak_bochea',
    around: { en: 'April or May', km: 'ខែមេសា ឬ ឧសភា' },
    name: { en: 'Visak Bochea Day', km: 'ពិធីបុណ្យវិសាខបូជា' },
  },
  {
    key: 'kh.royal_ploughing',
    around: { en: 'May', km: 'ខែឧសភា' },
    name: { en: 'Royal Ploughing Ceremony', km: 'ព្រះរាជពិធីច្រត់ព្រះនង្គ័ល' },
  },
  {
    key: 'kh.pchum_ben',
    around: { en: 'September or October, three days', km: 'ខែកញ្ញា ឬ តុលា បីថ្ងៃ' },
    name: { en: 'Pchum Ben', km: 'ពិធីបុណ្យភ្ជុំបិណ្ឌ' },
  },
  {
    key: 'kh.water_festival',
    around: { en: 'November, three days', km: 'ខែវិច្ឆិកា បីថ្ងៃ' },
    name: { en: 'Water Festival', km: 'ព្រះរាជពិធីបុណ្យអុំទូក' },
  },
] as const;

/**
 * The zones whose calendar we hold. A map rather than a constant so that adding
 * a second country later is a row, not a rewrite of the lookup below.
 */
const SEEDED_ZONES: Record<string, readonly SeedHoliday[]> = {
  'Asia/Phnom_Penh': KH_FIXED_HOLIDAYS,
};

/** Whether we have a calendar to offer this workspace at all. */
export function seedCalendarFor(timeZone: string): readonly SeedHoliday[] {
  return SEEDED_ZONES[timeZone] ?? [];
}

export function moveableCalendarFor(timeZone: string): readonly MoveableHoliday[] {
  return timeZone === 'Asia/Phnom_Penh' ? KH_MOVEABLE_HOLIDAYS : [];
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * The rows a year's seed would write, in the language given.
 *
 * Pure, so the screen can show exactly what the button is about to do — §7.11's
 * rule that a bulk action names its consequence before the click applies to an
 * additive one as well as to a destructive one.
 */
export function seedRowsFor(
  timeZone: string,
  year: number,
  locale: 'en' | 'km',
): { date: CalendarDate; name: string }[] {
  return seedCalendarFor(timeZone).map((holiday) => ({
    date: `${year}-${pad(holiday.month)}-${pad(holiday.day)}`,
    name: holiday.name[locale],
  }));
}

/**
 * How far ahead the product's own arithmetic reaches, in years.
 *
 * `business_days_between` is called by cycle progress over a cycle that may end
 * next year, and the digest asks about the next working day — so "this year and
 * next" is the horizon, and a calendar that stops at the end of this year is
 * already short. One constant, so the warning and the seed button cannot
 * disagree about which years matter.
 */
export const CALENDAR_HORIZON_YEARS = 2;

/** The year of a `YYYY-MM-DD`. Split rather than sliced: this is a field of a
 * machine-readable date, never text anybody reads, so §13's grapheme rule does
 * not apply and saying so with `split` keeps the two cases distinguishable. */
function yearOf(date: CalendarDate): number {
  return Number(date.split('-')[0]);
}

export function horizonYears(today: CalendarDate): number[] {
  const year = yearOf(today);
  return Array.from({ length: CALENDAR_HORIZON_YEARS }, (_, index) => year + index);
}

/**
 * Which years inside the horizon have no rows at all (§18-10's "warn when the
 * calendar runs out").
 *
 * Emptiness, not completeness: a company that keeps four days off a year is not
 * wrong, and a product that nags them about the other seventeen is one they stop
 * reading. What is worth saying out loud is a year the arithmetic will reach and
 * about which the calendar knows nothing.
 */
export function yearsWithoutHolidays(
  today: CalendarDate,
  dates: readonly CalendarDate[],
): number[] {
  const covered = new Set(dates.map(yearOf));
  return horizonYears(today).filter((year) => !covered.has(year));
}
