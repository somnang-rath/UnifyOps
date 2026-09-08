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
  experimental: {
    serverActions: {
      // §21.8's import takes a zip of a company's documentation, and a Server
      // Action's request body is capped at 1MB by default. Raised rather than
      // routed around: §21's impact table says "§8's five exceptions stay five",
      // so an upload endpoint for this was not on offer.
      //
      // 6MB sits above `MAX_IMPORT_BYTES` (5 MiB) with room for multipart
      // overhead, which is the point — the refusal a person meets has to be
      // *ours*, a sentence naming the limit on the screen they are standing on,
      // rather than Next's 413, which the form has no way to explain. That is
      // the same division `createUploadTicket` makes when it validates a size
      // the object store would also reject.
      //
      // The cost is real and is the reason this is not larger: the default
      // exists to bound what an unauthenticated POST can make the server parse,
      // and this raises it for *every* action in the product, not only this one.
      bodySizeLimit: '6mb',
    },
  },
};

export default withNextIntl(nextConfig);
