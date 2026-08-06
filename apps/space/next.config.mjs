import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Security headers moved to `src/middleware.ts` (2026-07-31).
 *
 * The policy that lived here declared `script-src 'self'` with no nonce, which
 * blocked the App Router's own inline RSC scripts — the Space server-rendered
 * and then never hydrated. A CSP with a nonce cannot be expressed as a static
 * config value (the nonce must be fresh per request), so all of these headers
 * now come from the middleware, which shares its policy with web and admin via
 * `@prism/constants`. Do not re-add a `headers()` CSP here: two sources would
 * both be sent, and the browser enforces the intersection.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Public Space is mounted under /spaces (see PLANE-CONVERSION-PLAN.md §4.3).
  // A published page therefore resolves at /spaces/<anchor> — matching the link
  // apps/web builds from NEXT_PUBLIC_SPACE_URL (ADR 0002 §5).
  basePath: '/spaces',
  // Shared packages ship as TypeScript source, so Next must compile them.
  transpilePackages: ['@prism/constants', '@prism/i18n', '@prism/types', '@prism/ui'],
  // Never advertise the framework version to anonymous visitors.
  poweredByHeader: false,
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};

export default nextConfig;
