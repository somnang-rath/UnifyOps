import { intlLocale, type Locale } from './locale';

/**
 * The one formatting seam (ADR 0016 §2.7). App code calls these instead of
 * `toLocaleDateString`/`toLocaleTimeString` so that switching the language
 * switches the dates too — 79 raw `toLocale*` calls across 39 files is what
 * happens without a seam.
 *
 * **Latin digits, deliberately.** `Intl` gives Khmer Latin numerals by default;
 * `km-u-nu-khmr` would give ០១២៣. We keep Latin: counts, metrics and ids are
 * scanned rather than read, and mixed-script numerals in a dense table cost
 * more than they signal. Revisit on user feedback, never silently.
 */

type DateInput = Date | string | number;

const toDate = (value: DateInput): Date =>
  value instanceof Date ? value : new Date(value);

/* ────────────────────────────────────────────────────────────────────────────
 * Khmer fallback data
 *
 * **Chromium ships no `km` locale data.** `Intl.DateTimeFormat.supportedLocalesOf
 * (['km'])` comes back empty and `new Intl.DateTimeFormat('km-KH')` silently
 * resolves to `en-US`, so every date on a Khmer screen rendered "Aug 6, 2026".
 * Node's full-ICU build *does* have it, which is why nothing caught this until
 * the browser suite asserted on a rendered weekday header — a server-side or
 * unit test would have printed perfect Khmer and proved nothing.
 *
 * ADR 0016 §2.4 assumed "the platform already ships `Intl.DateTimeFormat`". It
 * does; it just does not ship Khmer to the one runtime that matters. Rather
 * than take the `@formatjs` polyfill and its locale bundle — a dependency the
 * ADR deliberately avoided — we carry the twelve month names and seven weekday
 * names ourselves. That is the entire dataset a Gregorian calendar needs, and
 * unlike a polyfill it cannot drift out of sync with the strings beside it.
 *
 * When a runtime *does* have Khmer data we use it and ignore all of this.
 * ──────────────────────────────────────────────────────────────────────────── */

const KM_MONTHS_LONG = [
  'មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា',
  'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ',
];

/** Khmer does not abbreviate month names the way English does. */
const KM_MONTHS_SHORT = KM_MONTHS_LONG;

const KM_WEEKDAYS_LONG = [
  'អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍',
];
const KM_WEEKDAYS_SHORT = ['អា', 'ច', 'អ', 'ព', 'ព្រ', 'សុ', 'ស'];
const KM_WEEKDAYS_NARROW = KM_WEEKDAYS_SHORT;

/**
 * Does this runtime know Khmer at all? Computed once — `supportedLocalesOf` is
 * cheap but not free, and the answer cannot change within a process.
 */
const HAS_KM_DATA = (() => {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(['km']).length > 0;
  } catch {
    return false;
  }
})();

/** True when we must format Khmer ourselves. */
const needsKmFallback = (locale: Locale): boolean =>
  locale === 'km' && !HAS_KM_DATA;

const pad2 = (n: number): string => `${n}`.padStart(2, '0');

/**
 * The shapes the named formatters below need. Khmer writes day-month-year, and
 * per ADR 0016 §2.7 the digits stay Latin.
 */
type KmShape =
  | 'medium'
  | 'short'
  | 'long'
  | 'monthYear'
  | 'monthShort'
  | 'weekdayDay'
  | 'weekdayDate'
  | 'time'
  | 'timeSec'
  | 'datetime';

function formatKm(d: Date, shape: KmShape): string {
  const day = d.getDate();
  const mLong = KM_MONTHS_LONG[d.getMonth()];
  const mShort = KM_MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  const wLong = KM_WEEKDAYS_LONG[d.getDay()];
  const wShort = KM_WEEKDAYS_SHORT[d.getDay()];
  // 24-hour clock: Cambodian UIs overwhelmingly use it, and there is no
  // settled Khmer rendering of AM/PM worth inventing here.
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  switch (shape) {
    case 'medium':      return `${day} ${mShort} ${year}`;
    case 'short':       return `${day} ${mShort}`;
    case 'long':        return `${day} ${mLong} ${year}`;
    case 'monthYear':   return `${mLong} ${year}`;
    case 'monthShort':  return mShort;
    case 'weekdayDay':  return `${wShort} ${day}`;
    case 'weekdayDate': return `${wLong}, ${day} ${mShort}`;
    case 'time':        return time;
    case 'timeSec':     return `${time}:${pad2(d.getSeconds())}`;
    case 'datetime':    return `${day} ${mShort} ${year} ${time}`;
  }
}

/** Cache: `Intl.*Format` construction dominates the cost of using it. */
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
  tag: string,
): Intl.DateTimeFormat {
  const key = `d:${locale}:${tag}`;
  let fmt = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(intlLocale(locale), options);
    cache.set(key, fmt);
  }
  return fmt;
}

/** e.g. `6 Aug 2026` / `៦ សីហា 2026` — the default for anything dated. */
export function formatDate(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'medium');
  return dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }, 'medium')
    .format(d);
}

/** Day and month only — lists where the year is implied by context. */
export function formatDateShort(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'short');
  return dateFormat(locale, { day: 'numeric', month: 'short' }, 'short').format(d);
}

export function formatTime(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'time');
  return dateFormat(locale, { hour: '2-digit', minute: '2-digit' }, 'time').format(d);
}

export function formatDateTime(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'datetime');
  return dateFormat(
    locale,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    'datetime',
  ).format(d);
}

/** `August 2026` / `សីហា 2026` — month pickers and calendar headers. */
export function formatMonthYear(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'monthYear');
  return dateFormat(locale, { month: 'long', year: 'numeric' }, 'monthYear').format(d);
}

/** `Aug` / `សីហា` — axis ticks and dense timeline gutters. */
export function formatMonthShort(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'monthShort');
  return dateFormat(locale, { month: 'short' }, 'monthShort').format(d);
}

/** `6 August 2026` — report headers and print footers, where space is not tight. */
export function formatDateLong(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'long');
  return dateFormat(
    locale,
    { day: 'numeric', month: 'long', year: 'numeric' },
    'long',
  ).format(d);
}

/** `Thu 6` — one column head per day in a week strip. */
export function formatWeekdayDay(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'weekdayDay');
  return dateFormat(locale, { weekday: 'short', day: 'numeric' }, 'weekdayDay').format(d);
}

/** `Thursday, 6 Aug` — day-group headings in an activity feed. */
export function formatDateWithWeekday(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'weekdayDate');
  return dateFormat(
    locale,
    { weekday: 'long', day: 'numeric', month: 'short' },
    'weekdayDate',
  ).format(d);
}

/** Clock precision, for log and run timestamps where the second matters. */
export function formatTimeWithSeconds(value: DateInput, locale: Locale): string {
  const d = toDate(value);
  if (needsKmFallback(locale)) return formatKm(d, 'timeSec');
  return dateFormat(
    locale,
    { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'timeSec',
  ).format(d);
}

/**
 * The seven weekday headers of a calendar grid, starting on the locale's first
 * day — which for both our locales is Sunday ({@link WEEK_STARTS_ON}).
 *
 * Built from a known Sunday rather than from a hardcoded array, so the Khmer
 * names come from ICU rather than from a translation someone has to maintain.
 */
export function weekdayNames(
  locale: Locale,
  width: 'short' | 'narrow' | 'long' = 'short',
): string[] {
  if (needsKmFallback(locale)) {
    return width === 'long'
      ? [...KM_WEEKDAYS_LONG]
      : width === 'narrow'
        ? [...KM_WEEKDAYS_NARROW]
        : [...KM_WEEKDAYS_SHORT];
  }
  const fmt = dateFormat(locale, { weekday: width }, `weekday:${width}`);
  // 2024-01-07 was a Sunday. UTC noon keeps every timezone on the same day.
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2024, 0, 7 + i, 12))),
  );
}

/** Largest unit first; each entry is how many seconds one of it lasts. */
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31557600],
  ['month', 2629800],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * `Intl.RelativeTimeFormat` has the same Khmer gap as `DateTimeFormat` (see the
 * fallback block above), so it needs the same treatment. Khmer marks the past
 * with a trailing មុន and the future with a leading ក្នុងរយៈពេល; there is no
 * inflection to get wrong, which is why seven nouns cover the whole range.
 *
 * Module scope, not function scope: this runs once per row in every list that
 * shows a timestamp.
 */
const KM_RELATIVE_UNITS: Record<string, string> = {
  second: 'វិនាទី',
  minute: 'នាទី',
  hour: 'ម៉ោង',
  day: 'ថ្ងៃ',
  week: 'សប្ដាហ៍',
  month: 'ខែ',
  year: 'ឆ្នាំ',
};

function relativeKm(n: number, unit: Intl.RelativeTimeFormatUnit): string {
  const abs = Math.abs(n);
  if (unit === 'second' && abs < 5) return 'ឥឡូវនេះ';
  const noun = KM_RELATIVE_UNITS[unit] ?? unit;
  return n < 0 ? `${abs} ${noun}មុន` : `ក្នុងរយៈពេល ${abs} ${noun}`;
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/**
 * `5m ago` / `មុន ៥ នាទី`, via `Intl.RelativeTimeFormat`.
 *
 * This replaces a hand-written English ladder (`'just now'`, `` `${n}m ago` ``)
 * that no message file could have fixed: the strings were assembled from
 * arithmetic, so translating them meant a plural table per unit. `Intl` already
 * has that table for every locale, in `narrow` style — which is why the English
 * output stays as terse as the code it replaces.
 */
export function formatRelativeTime(
  value: DateInput,
  locale: Locale,
  now: DateInput = Date.now(),
): string {
  const kmFallback = needsKmFallback(locale);
  const key = `r:${locale}`;
  let fmt = relativeFormats.get(key);
  if (!fmt && !kmFallback) {
    fmt = new Intl.RelativeTimeFormat(intlLocale(locale), {
      numeric: 'auto',
      style: 'narrow',
    });
    relativeFormats.set(key, fmt);
  }

  const emit = (n: number, unit: Intl.RelativeTimeFormatUnit): string =>
    kmFallback ? relativeKm(n, unit) : fmt!.format(n, unit);

  const deltaSeconds = (toDate(value).getTime() - toDate(now).getTime()) / 1000;
  const abs = Math.abs(deltaSeconds);

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds) return emit(Math.round(deltaSeconds / seconds), unit);
  }
  // Under a minute. `numeric: 'auto'` turns 0 into "now" rather than "in 0 sec".
  return emit(0, 'second');
}

/**
 * `2026-08-06` for the *local* day — a grouping key, never display text.
 *
 * It lives beside the formatters because it is the one date operation that must
 * **not** follow the locale, and putting it anywhere else is how the codebase
 * ended up writing `toLocaleDateString('en-CA')` to get an ISO day: a trick that
 * reads like formatting, silently depends on a locale's date order, and lands
 * one lint rule away from being "migrated" into a translated string.
 */
export function dateKey(value: DateInput): string {
  const d = toDate(value);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  const key = `n:${locale}:${JSON.stringify(options)}`;
  let fmt = cache.get(key) as Intl.NumberFormat | undefined;
  if (!fmt) {
    fmt = new Intl.NumberFormat(intlLocale(locale), options);
    cache.set(key, fmt);
  }
  return fmt.format(value);
}

/** Cambodia's week starts on Sunday; the US default agrees, Khmer ICU does too. */
export const WEEK_STARTS_ON = 0;

const collators = new Map<Locale, Intl.Collator>();

/**
 * Sort people's names. Khmer does not sort like Latin text, and every member
 * list, assignee picker and mention menu in the product currently uses a bare
 * `localeCompare` (ADR 0016 §2.7 — trivial to write, easy to forget to use).
 */
export function compareNames(a: string, b: string, locale: Locale): number {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(intlLocale(locale), { sensitivity: 'base' });
    collators.set(locale, collator);
  }
  return collator.compare(a, b);
}
