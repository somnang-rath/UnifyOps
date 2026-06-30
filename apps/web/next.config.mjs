import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit .next/standalone (server.js + minimal node_modules) for the Docker runner.
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    // API_URL is a server-only env var (no NEXT_PUBLIC_ prefix).
    // Requests from the browser to /api/v1/* are proxied here so that
    // cookies are always same-origin and SameSite:Lax works on HTTP.
    const dest = process.env.API_URL ?? 'http://localhost:4000/api/v1';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${dest}/:path*`,
      },
    ];
  },
};

export default nextConfig;
