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
  return dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }, 'medium')
    .format(toDate(value));
}

/** Day and month only — lists where the year is implied by context. */
export function formatDateShort(value: DateInput, locale: Locale): string {
  return dateFormat(locale, { day: 'numeric', month: 'short' }, 'short').format(
    toDate(value),
  );
}

export function formatTime(value: DateInput, locale: Locale): string {
  return dateFormat(locale, { hour: '2-digit', minute: '2-digit' }, 'time').format(
    toDate(value),
  );
}

export function formatDateTime(value: DateInput, locale: Locale): string {
  return dateFormat(
    locale,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    'datetime',
  ).format(toDate(value));
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
