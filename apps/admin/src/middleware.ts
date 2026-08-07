import { NextResponse, type NextRequest } from 'next/server';
import {
  NONCE_HEADER,
  buildCsp,
  connectOrigins,
  generateNonce,
  staticSecurityHeaders,
} from '@prism/constants';
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from '@prism/i18n';

/**
 * Content Security Policy for apps/admin — God Mode (docs/plan/01 §3.5).
 *
 * Same mechanism as apps/web (see the notes in `apps/web/src/middleware.ts` and
 * in `@prism/constants/security-headers`); the policy body is shared so the
 * three apps cannot drift. Two differences worth stating:
 *
 * - The connect-src list is shorter. Admin is REST-only — no chat socket, no
 *   collab editor — so it never reaches apps/live.
 * - The stakes are higher. This app holds an `aud=admin` token that can act on
 *   the whole instance, and it is the app where a script injected into an
 *   admin's session would be worth the most.
 * - Framing stays fully denied. apps/web relaxed `frame-ancestors` to `'self'`
 *   for its split-pane editor; God Mode has no such surface and renders no
 *   iframes at all, so it keeps the defaults on both directives.
 *
 * `basePath: '/god-mode'` does not appear in the matcher: `nextUrl.pathname` is
 * already basePath-stripped when middleware runs. It does mean the app's
 * landing page arrives here as `/` — see the note on the matcher below.
 */
export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const dev = process.env.NODE_ENV !== 'production';

  const csp = buildCsp({
    nonce,
    dev,
    connectSrc: connectOrigins([process.env.NEXT_PUBLIC_API_URL]),
  });

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
 * character. So the exclusion pattern alone never matches the bare root — and
 * under this app's basePath that root is `/god-mode`, the page an admin lands
 * on. It shipped with no CSP at all until `'/'` was listed explicitly.
 *
 * Keep this a plain array of string literals. Next statically analyses `config`
 * at build time and a form it cannot parse is not an error — it drops the
 * middleware entirely (empty `middleware` in
 * `.next/server/middleware-manifest.json`, no header ever sent). Both failures
 * were found by driving the running app; neither shows up in a typecheck or a
 * build.
 */
export const config = {
  matcher: [
    '/',
    '/((?!api/v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
