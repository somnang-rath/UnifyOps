import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * §15: "Playwright for the slice's primary flow, run in both `en` and `km`."
 * The two locale projects below are what makes that structural rather than a
 * habit — a spec is run twice, and `locale` is a fixture the spec reads.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'en',
      use: { ...devices['Desktop Chrome'], locale: 'en-US' },
    },
    {
      name: 'km',
      use: { ...devices['Desktop Chrome'], locale: 'km-KH' },
    },
    {
      // §15 manual check 6: every v1 screen usable at 390px.
      name: 'mobile-km',
      use: { ...devices['Pixel 7'], locale: 'km-KH' },
    },
  ],

  webServer: {
    // Not `pnpm start`. From slice 3 the flows §15 asks to be tested in a
    // browser are flows through a database, so the server provisions its own
    // Postgres first — roles, grants and migrations from the same module the
    // tenancy harness uses, so the browser drives the same isolation the RLS
    // suite asserts rather than a permissive copy of it.
    //
    // Needs Docker, or TENANCY_SUPERUSER_URL pointing at a server with
    // superuser rights. Same rule and same variable as `pnpm test:tenancy`.
    command: `pnpm build && pnpm exec tsx e2e/support/serve.ts`,
    url: baseURL,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
