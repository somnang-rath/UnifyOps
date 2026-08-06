/**
 * Security headers for the authenticated Next.js apps (web :3000, admin :3001).
 *
 * docs/plan/01-security-model.md §3.5. `apps/api` gets its headers from helmet
 * and `apps/space` declares a static policy in its `next.config.mjs` — those two
 * are fine as they are. Web and admin are the ones that render user-authored
 * content (Tiptap documents, markdown, issue descriptions) *inside* a session
 * that can act on the user's behalf, so they are where a CSP is worth the most
 * and where, until now, there was none at all.
 *
 * Shared rather than copy-pasted into two middlewares: a policy that drifts
 * between apps is a policy nobody can reason about (architecture rules §Shared
 * packages). It lives here, in the one package with no runtime dependencies, so
 * the Edge runtime can import it.
 *
 * ## Why nonces
 *
 * `script-src 'self'` alone does not work for the App Router: Next streams the
 * RSC payload through inline `<script>` tags, and both apps have their own
 * inline theme-boot script that must run before first paint to avoid a flash.
 * The alternative to a nonce is `'unsafe-inline'`, which allows exactly the
 * injected `<script>` this policy exists to stop — i.e. it would be a header
 * that looks like a CSP without being one. So: a fresh nonce per request,
 * handed to Next through the request's own CSP header, and to our inline script
 * through `x-nonce`.
 */

/** Request header carrying the per-request nonce from middleware to the layout. */
export const NONCE_HEADER = 'x-nonce';

export interface CspOptions {
  /** Per-request nonce, base64. Generate with {@link generateNonce}. */
  nonce: string;
  /**
   * Relax the policy for `next dev`. Webpack's HMR client evals module code and
   * opens a WebSocket back to the dev server; neither survives the production
   * policy, and neither exists in a production build.
   */
  dev?: boolean;
  /**
   * Extra origins the app talks to over fetch/WebSocket — the API host and the
   * live server, which are NOT same-origin (the API is proxied same-origin for
   * REST, but Socket.io and Hocuspocus connect to their hosts directly).
   * Values may be full URLs; only the origin is used. See {@link connectOrigins}.
   */
  connectSrc?: string[];
}

/**
 * A cryptographically random nonce.
 *
 * `crypto` is a global in both the Edge and Node runtimes, so this works in
 * middleware without an import.
 */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Expand configured URLs into the origins a browser will actually be asked to
 * reach, in both their http(s) and ws(s) forms.
 *
 * Socket.io is the reason for the pairing: it opens an HTTP long-poll to the
 * API origin first and only then upgrades to a WebSocket on the same host, so
 * allowing just one of the two schemes breaks it in a way that looks like a
 * server outage rather than a policy error.
 *
 * Invalid or empty entries are dropped rather than thrown on — a missing
 * NEXT_PUBLIC_* var must not take the whole app down at request time.
 */
export function connectOrigins(urls: (string | undefined)[]): string[] {
  const out = new Set<string>();

  for (const url of urls) {
    if (!url) continue;
    let origin: string;
    let protocol: string;
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      protocol = parsed.protocol;
    } catch {
      continue;
    }

    out.add(origin);

    // ws://host ⇄ http://host, wss://host ⇄ https://host.
    const secure = protocol === 'https:' || protocol === 'wss:';
    const host = origin.replace(/^[a-z]+:\/\//, '');
    out.add(`${secure ? 'https' : 'http'}://${host}`);
    out.add(`${secure ? 'wss' : 'ws'}://${host}`);
  }

  return [...out];
}

/**
 * Build the Content-Security-Policy header value.
 *
 * Directive notes, since the reasoning is not recoverable from the string:
 *
 * - `script-src` is nonce + `'self'`. No `'strict-dynamic'`: Next 14 loads its
 *   chunks from `/_next/static/**`, which `'self'` already covers, and
 *   `'strict-dynamic'` would drop that fallback for every browser that honours
 *   it — a bigger behavioural change than it buys us here.
 * - `style-src` keeps `'unsafe-inline'`. Tailwind and `next/font` emit inline
 *   `<style>`, and CSS is not an execution vector; this matches apps/space.
 * - `img-src https:` because covers (Unsplash, ADR 0010) and avatars are
 *   arbitrary remote URLs. `blob:` covers client-side previews before upload.
 * - `font-src 'self'` is enough: `next/font/google` self-hosts at build time,
 *   so nothing is fetched from fonts.gstatic.com at runtime.
 * - `frame-ancestors 'none'` — neither app is ever meant to be framed, which
 *   is also what makes clickjacking a session-holding UI a non-issue.
 * - `object-src 'none'`, `base-uri 'self'` — plugin execution and `<base>`
 *   hijacking, both pure downside.
 */
export function buildCsp({ nonce, dev = false, connectSrc = [] }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // React Refresh and webpack's dev module runtime both eval. Dev only —
    // a production build contains no eval'd module code.
    ...(dev ? ["'unsafe-eval'"] : []),
  ];

  const connect = [
    "'self'",
    ...connectSrc,
    // The HMR socket. `'self'` is specified to cover ws: on the same origin but
    // is not reliable across browsers, and this costs nothing outside dev.
    ...(dev ? ['ws://localhost:*', 'wss://localhost:*'] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self' https: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * The headers that carry no per-request state, so they read the same on every
 * response. `X-Frame-Options` duplicates `frame-ancestors` for the sake of
 * anything that predates CSP Level 2.
 */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};
