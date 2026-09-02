import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The tenancy suite. Separate from vitest.config.ts because it needs a real
 * Postgres — Testcontainers by default, or an existing server via
 * TENANCY_SUPERUSER_URL — and the unit suite must stay runnable without one.
 *
 * §16 calls a tenancy leak "the failure that ends the product", so this runs
 * as its own CI job with its own gate rather than as a few extra cases inside
 * `pnpm test`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/server/db/__tenancy__/**/*.test.ts'],
    // Each file provisions its own database, and a container start is slow.
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // Separate databases would be fine in parallel, but a shared Docker daemon
    // pulling four Postgres containers at once is not worth the minute saved.
    fileParallelism: false,
  },
});
