'use client';
import { createContext, useContext, useMemo } from 'react';
import { createTranslator, type Translator } from './translator';
import {
  DEFAULT_LOCALE,
  localeCookie,
  type Locale,
} from './locale';
import {
  compareNames,
  formatDate,
  formatDateLong,
  formatDateShort,
  formatDateTime,
  formatDateWithWeekday,
  formatMonthShort,
  formatMonthYear,
  formatNumber,
  formatRelativeTime,
  formatTime,
  formatTimeWithSeconds,
  formatWeekdayDay,
  weekdayNames,
} from './format';

/**
 * The locale is *given* to this provider by the server (root layout reads the
 * `x-locale` header the middleware set), never detected here. That is what
 * makes the first server-rendered HTML already correct — a client-side
 * detection would render English and then swap, which is the flash ADR 0016
 * §2.1 rejects `localStorage` to avoid.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `const t = useT()` → `t('nav.home')`. */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}

/**
 * The shape {@link useFormat} returns. Exported because a component sometimes
 * has to hand it to a plain helper — a `groupByDay(items, f)` that formats day
 * headings is still locale-dependent even though it is not a hook.
 */
export type Formatters = ReturnType<typeof useFormat>;

/**
 * Locale-bound formatters, so a component never has to thread the locale into
 * every call site (and never has a reason to reach for `toLocaleDateString`).
 */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      date: (v: Date | string | number) => formatDate(v, locale),
      dateShort: (v: Date | string | number) => formatDateShort(v, locale),
      dateLong: (v: Date | string | number) => formatDateLong(v, locale),
      dateWithWeekday: (v: Date | string | number) =>
        formatDateWithWeekday(v, locale),
      monthYear: (v: Date | string | number) => formatMonthYear(v, locale),
      monthShort: (v: Date | string | number) => formatMonthShort(v, locale),
      weekdayDay: (v: Date | string | number) => formatWeekdayDay(v, locale),
      time: (v: Date | string | number) => formatTime(v, locale),
      timeWithSeconds: (v: Date | string | number) =>
        formatTimeWithSeconds(v, locale),
      dateTime: (v: Date | string | number) => formatDateTime(v, locale),
      relative: (v: Date | string | number) => formatRelativeTime(v, locale),
      weekdays: (w?: 'short' | 'narrow' | 'long') => weekdayNames(locale, w),
      number: (v: number, o?: Intl.NumberFormatOptions) =>
        formatNumber(v, locale, o),
      compareNames: (a: string, b: string) => compareNames(a, b, locale),
    }),
    [locale],
  );
}

/**
 * Persist a locale choice for this browser. The cookie is what the *next*
 * request reads (ADR 0016 §2.1); mirroring it to `User.locale` is the caller's
 * job, because only the app knows whether anyone is signed in.
 *
 * A full reload follows on purpose: every server-rendered string on the page
 * was produced with the old locale, and re-rendering the tree would leave the
 * RSC payload — and `<html lang>` — stale.
 */
export function persistLocale(locale: Locale): void {
  document.cookie = localeCookie(locale);
}
