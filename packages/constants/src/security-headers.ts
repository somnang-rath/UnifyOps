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

/**
 * Who is allowed to put this app in a frame.
 *
 * `'none'` is the default and the right answer for an app that never frames
 * itself. `'self'` exists for apps/web, whose split-pane editor renders a
 * sibling route in a same-origin `<iframe>` (`?chrome=0`) — see
 * `apps/web/src/components/editor/pane-content.tsx`. It still refuses every
 * cross-origin framer, which is the clickjacking case that matters.
 */
export type FrameAncestors = "'none'" | "'self'";

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
  /**
   * Extra sources allowed in an `<iframe>`, beyond `'self'`. `frame-src` has no
   * default of its own, so without this it falls back to `default-src 'self'`
   * and every off-origin embed is blocked. Pass origins, `blob:`, etc.
   */
  frameSrc?: string[];
  /** Who may frame this app. Defaults to `'none'`. */
  frameAncestors?: FrameAncestors;
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
 * The origin of a configured URL, or null if it is missing or unparseable.
 *
 * A missing NEXT_PUBLIC_* var must never take the app down at request time, so
 * every caller here drops bad entries rather than throwing.
 */
export function toOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Third-party players the project-overview block editor embeds (`videoEmbedURL`
 * in `projects/[id]/overview/_components/slash-options.ts`). Named here so the
 * policy and the embed builder cannot drift apart silently — a host in one and
 * not the other is an empty box in the page with no error anywhere.
 */
export const EMBED_FRAME_ORIGINS = [
  'https://www.youtube.com',
  'https://player.vimeo.com',
] as const;

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
    const origin = toOrigin(url);
    if (!origin) continue;

    out.add(origin);

    // ws://host ⇄ http://host, wss://host ⇄ https://host.
    const secure = origin.startsWith('https:') || origin.startsWith('wss:');
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
 * - `frame-ancestors` defaults to `'none'`; apps/web passes `'self'` because it
 *   frames its own routes (see {@link FrameAncestors}). Cross-origin framing is
 *   refused either way, so the clickjacking story is unchanged.
 * - `frame-src` is `'self'` plus whatever the app declares. It has no default of
 *   its own and falls back to `default-src`, which is how three same-policy
 *   embeds (the split panes, the API-hosted PDF preview, the video blocks) can
 *   all break from one line nobody wrote about them.
 * - `object-src 'none'`, `base-uri 'self'` — plugin execution and `<base>`
 *   hijacking, both pure downside.
 */
export function buildCsp({
  nonce,
  dev = false,
  connectSrc = [],
  frameSrc = [],
  frameAncestors = "'none'",
}: CspOptions): string {
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
    `frame-src ${["'self'", ...frameSrc].join(' ')}`,
    "media-src 'self' https: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
  ].join('; ');
}

/**
 * The headers that carry no per-request state.
 *
 * `X-Frame-Options` duplicates `frame-ancestors` for anything predating CSP
 * Level 2, which is why this is a function and not a constant: the two must
 * agree. A `DENY` left behind next to `frame-ancestors 'self'` blocks the frame
 * on its own in every browser that still honours it, and the symptom — a pane
 * showing "localhost refused to connect" — points at a dead server rather than
 * at a header.
 */
export function staticSecurityHeaders({
  frameAncestors = "'none'",
}: { frameAncestors?: FrameAncestors } = {}): Readonly<Record<string, string>> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': frameAncestors === "'self'" ? 'SAMEORIGIN' : 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  };
}
