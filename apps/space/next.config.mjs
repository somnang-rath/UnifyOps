import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content Security Policy for the public Space (docs/plan/01 §3.4).
 *
 * This app renders HTML that users authored elsewhere, to anonymous visitors,
 * with no session of its own. It is the most exposed surface in the product and
 * the least in need of privileges, so the policy is deliberately narrow:
 *
 * - `script-src 'self'` — no inline script, no third-party origins. If stored
 *   XSS ever survives both sanitizer passes, the browser still refuses to run it.
 * - `'unsafe-inline'` on style-src only: Next.js and Tailwind emit inline styles,
 *   and inline CSS is not an execution vector.
 * - `frame-ancestors 'none'` — the Space is never framed, so clickjacking a
 *   published page into some other UI is not possible.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Public Space is mounted under /spaces (see PLANE-CONVERSION-PLAN.md §4.3).
  // A published page therefore resolves at /spaces/<anchor> — matching the link
  // apps/web builds from NEXT_PUBLIC_SPACE_URL (ADR 0002 §5).
  basePath: '/spaces',
  // Shared design system ships as TypeScript source, so Next must compile it.
  transpilePackages: ['@prism/ui'],
  // Never advertise the framework version to anonymous visitors.
  poweredByHeader: false,
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
