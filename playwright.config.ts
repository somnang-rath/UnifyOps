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
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
