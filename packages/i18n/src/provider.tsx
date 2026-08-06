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
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatTime,
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
      time: (v: Date | string | number) => formatTime(v, locale),
      dateTime: (v: Date | string | number) => formatDateTime(v, locale),
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
