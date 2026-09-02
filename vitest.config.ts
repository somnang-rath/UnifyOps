import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: false,
    // Playwright owns e2e/. Vitest must not try to run those specs.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // __tenancy__ needs a real Postgres and is its own command (`pnpm
    // test:tenancy`). Leaving it in the default run would make the fast unit
    // suite depend on Docker, and the usual response to that is to skip it —
    // which is the one suite that must never be quietly green (§16).
    exclude: ['node_modules/**', '.next/**', 'e2e/**', 'src/server/db/__tenancy__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/i18n/messages/**',
        'src/server/db/__tenancy__/**',
      ],
    },
  },
});
