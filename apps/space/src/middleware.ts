import { NextResponse, type NextRequest } from 'next/server';
import {
  NONCE_HEADER,
  buildCsp,
  connectOrigins,
  generateNonce,
  staticSecurityHeaders,
} from '@prism/constants';
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from '@prism/i18n';
import { PUBLIC_API_URL } from '@/lib/api-url';

/**
 * Content Security Policy for apps/space (docs/plan/01 §3.4).
 *
 * ## Why this replaced the static policy in `next.config.mjs`
 *
 * That policy declared `script-src 'self'` with no nonce — which reads as the
 * strictest of the three apps and was in fact the most broken. The App Router
 * streams its RSC payload through inline `<script>` tags, so every one of them
 * was blocked: the Space server-rendered fine and then **never hydrated**.
 * Nothing caught it because a read-only page looks identical either way until
 * you interact with it; the browser-smoke run surfaced it only as console
 * noise ("Executing inline script violates ... 'script-src 'self''").
 *
 * So the header was simultaneously breaking the app and, because a real
 * attacker's inline script would have been blocked alongside Next's own, doing
 * its job by accident. A per-request nonce keeps the protection and lets the
 * framework work — the same mechanism apps/web and apps/admin use, with the
 * policy itself shared in `@prism/constants` so the three cannot drift.
 *
 * ## What is different here
 *
 * `connect-src` names exactly one extra origin, and only because of the intake
 * form (`/intake/[anchor]`). Every *read* in this app is server-rendered — the
 * Node process fetches the API and the browser never does. The intake **submit**
 * is the one exception, and it goes direct on purpose: the endpoint is
 * throttled per IP, so relaying it through this server would collapse every
 * anonymous visitor into a single bucket and let one submitter lock the form
 * for everyone. Nothing else here should be added to this list.
 */
export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const dev = process.env.NODE_ENV !== 'production';

  const csp = buildCsp({
    nonce,
    dev,
    connectSrc: connectOrigins([PUBLIC_API_URL]),
  });

  // Next reads the nonce back off the request's own CSP header and stamps it
  // onto the script tags it emits.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // Locale resolution (ADR 0016 §2.2) — the chain itself lives in @prism/i18n
  // so the three apps cannot drift. The root layout reads this header.
  requestHeaders.set(
    LOCALE_HEADER,
    resolveLocale({
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    }),
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // Defaults on purpose: published content is exactly what must not be framed
  // into someone else's page, and space renders no iframes of its own.
  for (const [key, value] of Object.entries(staticSecurityHeaders())) {
    response.headers.set(key, value);
  }

  return response;
}

/*
 * Two entries on purpose.
 *
 * The `(...)` in the second is an *unnamed parameter* to path-to-regexp, not a
 * plain regex group, and an unnamed parameter must match at least one
 * character. So the exclusion pattern alone never matches the bare root — which
 * under a basePath is the app's own landing page (`/god-mode`, `/spaces`). That
 * page then silently ships with no CSP at all. `'/'` is listed explicitly to
 * cover it.
 *
 * Keep this a plain array of string literals. Next statically analyses `config`
 * at build time and a form it cannot parse is not an error — it drops the
 * middleware entirely (empty `middleware` in `.next/server/middleware-manifest.json`,
 * no header ever sent). Both failures were found by driving the running app,
 * and neither shows up in a typecheck or a build.
 */
export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
