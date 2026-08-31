import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'km'] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  km: 'ភាសាខ្មែរ',
};

export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  // Always prefix so the locale is unambiguous in every URL, shareable, and
  // cacheable. No implicit "default locale has no prefix" special case.
  localePrefix: 'always',
});
