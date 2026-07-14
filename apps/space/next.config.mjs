import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Public Space is mounted under /spaces (see PLANE-CONVERSION-PLAN.md §4.3).
  // A published page therefore resolves at /spaces/<anchor> — matching the link
  // apps/web builds from NEXT_PUBLIC_SPACE_URL (ADR 0002 §5).
  basePath: '/spaces',
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};

export default nextConfig;
