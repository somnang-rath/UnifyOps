import { en, type MessageKey } from './messages/en';
import { km } from './messages/km';
import { DEFAULT_LOCALE, intlLocale, type Locale } from './locale';

/** A message either inflects on `{count}` or it does not. */
export type Message = string | { one: string; other: string };

export type TranslateParams = Record<string, string | number>;

export interface Translator {
  (key: MessageKey, params?: TranslateParams): string;
  locale: Locale;
}

const CATALOGS: Record<Locale, Record<string, Message>> = {
  en,
  km,
};

/** `Intl.PluralRules` is not free to construct; one per locale is plenty. */
const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlLocale(locale));
    pluralRules.set(locale, rules);
  }
  return rules;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Build a translator for one locale.
 *
 * Two behaviours worth stating, because both are load-bearing (ADR 0016 §2.3):
 *
 * - a key missing from the locale's catalog falls back to **English**, not to
 *   the key. A half-translated screen is usable; a screen of `nav.home` is not.
 *   (The `km` catalog is typed to make this unreachable at build time — this is
 *   the runtime belt to that braces, for a locale added later or a bad merge.)
 * - plural selection is `Intl.PluralRules`, so Khmer's single form is the
 *   platform's business rather than a hand-written table.
 */
export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const fallback = CATALOGS[DEFAULT_LOCALE];

  const t = (key: MessageKey, params?: TranslateParams): string => {
    const message = catalog[key] ?? fallback[key];
    if (message === undefined) return key;

    if (typeof message === 'string') return interpolate(message, params);

    const count = Number(params?.count ?? 0);
    const form = rulesFor(locale).select(count) === 'one' ? 'one' : 'other';
    return interpolate(message[form], params);
  };

  t.locale = locale;
  return t as Translator;
}

/** Server-side entry point — client components use `useT()` from the provider. */
export function getTranslator(locale: Locale): Translator {
  return createTranslator(locale);
}

export type { MessageKey };
