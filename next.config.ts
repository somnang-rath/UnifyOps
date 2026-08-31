import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The job worker and the pg pool both want a long-lived process.
  output: 'standalone',
  serverExternalPackages: ['pg'],
  typedRoutes: true,
};

export default withNextIntl(nextConfig);
