/**
 * Khmer public holidays and cycle capacity (ADR 0016 §2.7).
 *
 * Plain TypeScript, no framework, no browser, no database — these are pure
 * functions over a static table, and the interesting cases are all arithmetic.
 * That makes this the cheapest suite in the repo to run and the one most worth
 * running: an off-by-one here silently mis-plans every sprint in the product.
 *
 *   pnpm --filter @prism/constants test
 */
import {
  holidayYearStatus,
  khmerHolidaysBetween,
  khmerHolidayMap,
  workingDaysBetween,
  KNOWN_HOLIDAY_YEARS,
} from '../src/khmer-holidays';

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

function eq<T>(actual: T, expected: T, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: got ${a}, expected ${e}`);
}

console.log('\nKhmer holidays + cycle capacity (ADR 0016 §2.7)\n');

check('the table knows at least one year', () => {
  if (KNOWN_HOLIDAY_YEARS.length === 0) throw new Error('table is empty');
});

check('a two-week sprint over Khmer New Year loses three working days', () => {
  // The motivating case: 14–16 April 2026 are Tue/Wed/Thu, so all three cost
  // capacity. Ten working days become seven, and a team planning against ten
  // is committing to 40% more than it can deliver.
  const c = workingDaysBetween('2026-04-06', '2026-04-17');
  eq(c.calendarDays, 12, 'calendar days');
  eq(c.workingDays, 7, 'working days');
  eq(c.holidaysLost.map((h) => h.date), ['2026-04-14', '2026-04-15', '2026-04-16'], 'lost');
  eq(c.status, 'provisional', 'status');
});

check('a plain fortnight with no holidays is ten working days', () => {
  const c = workingDaysBetween('2026-07-06', '2026-07-17');
  eq(c.workingDays, 10, 'working days');
  eq(c.holidaysLost.length, 0, 'holidays lost');
});

check('two holidays on one date count once', () => {
  // 1 May 2026 is both Labour Day and Visak Bochea. Counting the day twice
  // would subtract capacity that never existed.
  eq(khmerHolidaysBetween('2026-05-01', '2026-05-01').length, 1, 'deduped holidays');
  const c = workingDaysBetween('2026-04-27', '2026-05-08');
  eq(c.holidaysLost.length, 1, 'days lost around 1 May');
});

check('an unmapped year reports unknown rather than "no holidays"', () => {
  // The failure this whole design exists to prevent: silently treating a year
  // with no data as a year with no days off.
  eq(holidayYearStatus(2031), 'unknown', 'status for 2031');
  const c = workingDaysBetween('2031-04-06', '2031-04-17');
  eq(c.status, 'unknown', 'range status');
  eq(c.holidaysLost.length, 0, 'holidays known');
  if (c.workingDays === 0) throw new Error('unknown years should still count weekdays');
});

check('one unknown year poisons a range that spans two years', () => {
  // Weakest link, not an average: half-known is not "mostly right".
  const c = workingDaysBetween('2026-12-28', '2027-01-08');
  eq(c.status, 'unknown', 'status across 2026→2027');
});

check('a holiday falling on a weekend costs nothing', () => {
  // 1 January 2026 is a Thursday, so it costs a day; the assertion that
  // matters is that weekend holidays are never added to `holidaysLost`.
  const all = khmerHolidaysBetween('2026-01-01', '2026-12-31');
  const c = workingDaysBetween('2026-01-01', '2026-12-31');
  const weekendHolidays = all.filter((h) => {
    const d = new Date(`${h.date}T12:00:00`).getDay();
    return d === 0 || d === 6;
  });
  if (weekendHolidays.length === 0) {
    throw new Error('fixture year has no weekend holiday — assertion is vacuous');
  }
  for (const h of weekendHolidays) {
    if (c.holidaysLost.some((l) => l.date === h.date)) {
      throw new Error(`${h.date} is a weekend but was counted as lost`);
    }
  }
});

check('every holiday carries both an English and a Khmer name', () => {
  for (const y of KNOWN_HOLIDAY_YEARS) {
    for (const h of khmerHolidaysBetween(`${y}-01-01`, `${y}-12-31`)) {
      if (!h.en.trim()) throw new Error(`${h.date} has no English name`);
      if (!/[ក-៿]/.test(h.km)) {
        throw new Error(`${h.date} Khmer name is not Khmer script: ${h.km}`);
      }
    }
  }
});

check('every holiday date is inside the year that keys it', () => {
  // A typo'd year in the table would otherwise make a holiday invisible to the
  // range query that only loads the years the range touches.
  for (const y of KNOWN_HOLIDAY_YEARS) {
    for (const h of khmerHolidaysBetween(`${y}-01-01`, `${y}-12-31`)) {
      if (!h.date.startsWith(String(y))) {
        throw new Error(`${h.date} is filed under ${y}`);
      }
    }
  }
});

check('the map index agrees with the list', () => {
  const list = khmerHolidaysBetween('2026-01-01', '2026-12-31');
  const map = khmerHolidayMap('2026-01-01', '2026-12-31');
  eq(map.size, list.length, 'map size');
  for (const h of list) {
    if (map.get(h.date)?.date !== h.date) throw new Error(`${h.date} missing from map`);
  }
});

check('an inverted or malformed range is empty, not negative', () => {
  eq(workingDaysBetween('2026-05-10', '2026-05-01').workingDays, 0, 'inverted range');
  eq(workingDaysBetween('nonsense', '2026-05-01').workingDays, 0, 'malformed range');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
