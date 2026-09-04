import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The job worker and the pg pool both want a long-lived process.
  output: 'standalone',
  serverExternalPackages: ['pg'],
  typedRoutes: true,
  // Next 16 blocks cross-origin requests to dev-only assets, and the origin it
  // trusts is the one it was *initialized* with — `localhost`. Opening the same
  // server at `http://127.0.0.1:3000` is a different origin to that check, so
  // every `/_next/static/chunks/*` request and `/_next/hmr` is refused. The
  // page still server-renders, which is what makes this so hard to read from
  // the browser: nothing is broken on screen, there is simply no JavaScript.
  //
  // What that looks like is every client component dead at once — the theme
  // toggle, the locale switcher, the command palette, the upload queue — and
  // every `<form action={…}>` falling back to a native browser POST, which is
  // a full page reload rather than a server action.
  //
  // 127.0.0.1 is listed because the e2e suite and the attachment driver both
  // already assume it (see the storage note in CLAUDE.md). The private ranges
  // cover opening the dev server from a phone on the same network, which is
  // §15-6's 390px pass done on real hardware.
  allowedDevOrigins: ['127.0.0.1', '192.168.*.*', '10.*.*.*', '169.254.*.*'],
};

export default withNextIntl(nextConfig);
