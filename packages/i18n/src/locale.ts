/**
 * Locale identity and resolution (ADR 0016 §2.1–§2.3).
 *
 * Deliberately free of React and of Next: the middleware of three apps imports
 * from here, and so does the API-agnostic client code.
 */

/** The supported set. Adding a third is adding a message file, not editing this. */
export const LOCALES = ['en', 'km'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The cookie is the only client-writable store the server can read on the same
 * request, which is why the locale lives in one and not in `localStorage` like
 * theme does (ADR 0016 §2.1). Not `HttpOnly` — the switcher writes it — and not
 * a credential, so no `Secure`-only handling beyond what the deployment sets.
 */
export const LOCALE_COOKIE = 'pr_locale';

/** Request header the middleware puts the resolved locale on, next to `x-nonce`. */
export const LOCALE_HEADER = 'x-locale';

/** One year: a display preference nobody wants to re-pick each session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Narrow anything to a supported locale, falling back to {@link DEFAULT_LOCALE}. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Best supported match for an `Accept-Language` header — the *last* step of the
 * chain in §2.2, never the first: Cambodian users overwhelmingly run
 * English-configured browsers, so trusting this would hide Khmer from the exact
 * audience it exists for.
 *
 * Quality-ordered, prefix-matched (`km-KH` → `km`), and English on no match.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((r) => r.tag && !Number.isNaN(r.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * The resolution chain of ADR 0016 §2.2, in the one place all three apps read
 * it from: cookie → `Accept-Language` → `en`.
 *
 * `User.locale` is not a step here. Middleware has no session — only a refresh
 * cookie — and calling the API from the edge would put a network round trip in
 * front of every request. The record is applied by writing the cookie at login,
 * so by the time a page renders the cookie already carries the answer.
 */
export function resolveLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return localeFromAcceptLanguage(input.acceptLanguage);
}

/**
 * The full BCP 47 tag to hand to `Intl`. We *store* the bare tag (§2.3) because
 * that is the identity; `Intl` wants a region to pick calendars and collation.
 */
export function intlLocale(locale: Locale): string {
  return locale === 'km' ? 'km-KH' : 'en-US';
}

/** Serialize the locale cookie. Shared so the client and the server agree. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
