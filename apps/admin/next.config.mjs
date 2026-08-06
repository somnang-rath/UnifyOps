import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // God Mode lives under /god-mode (see PLANE-CONVERSION-PLAN.md §4.2).
  basePath: '/god-mode',
  // Compile the shared TS-source packages.
  transpilePackages: ['@prism/ui', '@prism/services', '@prism/types', '@prism/constants', '@prism/i18n'],
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    // Proxy API calls same-origin so the refresh cookie (SameSite:Lax) works.
    const dest = process.env.API_URL ?? 'http://localhost:4000/api/v1';
    // basePath:false so the proxy matches at the origin root (/api/v1/*), which
    // is where the API client calls. Otherwise Next auto-prefixes it with
    // basePath (/god-mode/api/v1/*) and every API request from the UI 404s.
    return [{ source: '/api/v1/:path*', destination: `${dest}/:path*`, basePath: false }];
  },
};

export default nextConfig;
