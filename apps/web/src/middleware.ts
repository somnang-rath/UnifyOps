import { NextResponse, type NextRequest } from 'next/server';
import {
  EMBED_FRAME_ORIGINS,
  NONCE_HEADER,
  buildCsp,
  connectOrigins,
  generateNonce,
  staticSecurityHeaders,
  toOrigin,
} from '@prism/constants';
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from '@prism/i18n';

/**
 * Content Security Policy for apps/web (docs/plan/01-security-model.md §3.5).
 *
 * The policy itself is shared with apps/admin and apps/space in
 * `@prism/constants` — see the long-form reasoning there. What is app-specific
 * is the connect-src list: web talks to three hosts that are not its own origin.
 *
 * ## Why middleware and not `headers()` in next.config
 *
 * A nonce must be fresh per request, and per-request means middleware. Web has
 * its own inline pre-paint theme script, and the App Router streams its RSC
 * payload through inline `<script>` tags; both need the nonce. (apps/space
 * originally tried a static config-level policy instead, and the result was a
 * CSP that blocked Next's own scripts so the app never hydrated.)
 *
 * Next picks the nonce up from the *request's* CSP header (it parses it back
 * out) and stamps it onto every script tag it emits; `x-nonce` carries the same
 * value to the root layout for our own inline script.
 *
 * The cost is that reading `headers()` in the root layout opts the app out of
 * static rendering. For a fully authenticated product where every page is
 * per-user anyway, that changes nothing in practice.
 *
 * ## Why this app frames itself
 *
 * Unlike admin and space, web renders `<iframe>`s, and all of them are its own
 * feature surface rather than third-party chrome: the split-pane editor loads a
 * sibling route with `?chrome=0` (same-origin), file/report previews load a PDF
 * from the API origin or a `blob:` URL, and the project-overview block editor
 * embeds YouTube/Vimeo. So `frame-ancestors` is `'self'` and `frame-src` is
 * explicit. Everything off-origin is still refused.
 */
export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const dev = process.env.NODE_ENV !== 'production';
  const apiOrigin = toOrigin(process.env.NEXT_PUBLIC_API_URL);

  const csp = buildCsp({
    nonce,
    dev,
    connectSrc: connectOrigins([
      // REST is proxied same-origin (see next.config rewrites), but the browser
      // still resolves NEXT_PUBLIC_API_URL directly in some code paths.
      process.env.NEXT_PUBLIC_API_URL,
      // Socket.io — notifications + chat. Cannot use the rewrite proxy: a
      // WebSocket upgrade does not survive it.
      process.env.NEXT_PUBLIC_WS_URL,
      // apps/live — Hocuspocus/Yjs collab on :3100, always a direct connection.
      process.env.NEXT_PUBLIC_LIVE_URL,
    ]),
    // Same-origin panes are covered by the `'self'` buildCsp always includes.
    frameSrc: [
      // The PDF preview in reports builds an object URL from a fetched blob.
      'blob:',
      // Storage/overview PDF previews point straight at `GET /files/:id/download`.
      // Empty in dev, where NEXT_PUBLIC_API_URL is the relative `/api/v1` and
      // `'self'` already covers it; it is a real origin wherever the API is not
      // proxied same-origin.
      ...(apiOrigin ? [apiOrigin] : []),
      ...EMBED_FRAME_ORIGINS,
    ],
    // The split-pane editor frames web's own routes; nothing else may frame it.
    frameAncestors: "'self'",
  });

  // Next reads the nonce off the request headers, so both of these matter.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // Locale resolution (ADR 0016 §2.2). The root layout reads this rather than
  // parsing the cookie itself, so the chain lives in exactly one place — and so
  // the server's first HTML is already in the right language.
  requestHeaders.set(
    LOCALE_HEADER,
    resolveLocale({
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    }),
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // Must be built with the same frameAncestors: a stale `X-Frame-Options: DENY`
  // blocks the panes on its own, CSP or no CSP.
  for (const [key, value] of Object.entries(staticSecurityHeaders({ frameAncestors: "'self'" }))) {
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
 * middleware entirely (empty `middleware` in
 * `.next/server/middleware-manifest.json`, no header ever sent). Both failures
 * were found by driving the running app; neither shows up in a typecheck or a
 * build.
 *
 * Excluded: `api/v1/*` (proxied to apps/api, which sets its own headers via
 * helmet) and the immutable static assets, which carry no markup.
 */
export const config = {
  matcher: [
    '/',
    '/((?!api/v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
