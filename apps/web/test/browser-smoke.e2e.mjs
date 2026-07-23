#!/usr/bin/env node
/**
 * Browser-level smoke E2E across the three frontends (Phase 4 close-out).
 * Drives a RUNNING `pnpm dev` stack (web :3000, admin :3001, space :3002,
 * api :4000) with headless Chromium. Never builds or starts anything itself.
 *
 *   node apps/web/test/browser-smoke.e2e.mjs
 *   # or: pnpm --filter web test:browser-smoke
 *
 * Checks:
 *   1. Web login (alice) -> authenticated shell renders (sidebar, /home).
 *      1b. Flat /issues shim redirects to /<workspaceSlug>/issues, query intact
 *          (Phase 7b route consolidation, ADR 0011).
 *   2. Admin God Mode login (instance admin) -> /god-mode/general renders.
 *   3. Admin auth settings: flip "Allow new sign-ups" OFF, verify it persists
 *      across reload, verify the web register page is invitation-only in a
 *      fresh (unauthenticated) context, then restore the toggle (try/finally).
 *   4. Space index renders publicly (no session, no auth redirect).
 *   5. Space published page renders if SPACE_ANCHOR is set (skip-warn if not).
 *   6. No uncaught page exceptions anywhere in the run.
 *
 * Env: WEB_URL   (default http://localhost:3000)
 *      ADMIN_URL (default http://localhost:3001/god-mode)
 *      SPACE_URL (default http://localhost:3002/spaces)
 *      TEST_EMAIL / TEST_PASSWORD   (alice@test.com / test1234 — test-seed.ts)
 *      ADMIN_EMAIL / ADMIN_PASSWORD (admin@test.com / test1234 — the instance
 *        admin promoted in apps/api/src/seed/test-seed.ts step 4)
 *      SPACE_ANCHOR    (anchor of a published page; check 5 skips without it)
 *      LOGIN_BACKOFF_MS (default 15000 — auth login throttles at 5/min/IP)
 *
 * Playwright ^1.60 is installed only under apps/web — resolve it from there
 * via createRequire so this script runs from any cwd.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'package.json'));
const { chromium } = require('playwright');

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const ADMIN = (process.env.ADMIN_URL ?? 'http://localhost:3001/god-mode').replace(/\/$/, '');
const SPACE = (process.env.SPACE_URL ?? 'http://localhost:3002/spaces').replace(/\/$/, '');
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@test.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? TEST_PASSWORD;
const SPACE_ANCHOR = process.env.SPACE_ANCHOR ?? '';
// Login throttle is 5/min/IP and this run performs multiple logins — space
// the logins out so throttling never masquerades as a functional failure.
const LOGIN_BACKOFF_MS = Number(process.env.LOGIN_BACKOFF_MS ?? 15000);

const TIMEOUT = 20_000;

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${String(err.message ?? err).split('\n')[0]}`);
    fail += 1;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uncaught exceptions across every page — a dedicated check fails on any. */
const pageErrors = [];
/** Console errors are collected and reported as warnings (not failures). */
const consoleErrors = [];

function watch(page, label) {
  page.on('pageerror', (err) => {
    pageErrors.push(`[${label}] ${String(err.message ?? err).split('\n')[0]}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${label}] ${msg.text().split('\n')[0]}`);
    }
  });
  page.setDefaultTimeout(TIMEOUT);
  return page;
}

async function expectVisible(locator, what) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  } catch {
    throw new Error(`expected visible: ${what}`);
  }
}

async function run() {
  console.log('Browser smoke E2E (web / admin / space)');
  console.log(`  web=${WEB}  admin=${ADMIN}  space=${SPACE}\n`);

  const browser = await chromium.launch({ headless: true });

  // ── 1. Web login (alice) → authenticated shell ─────────────────────────────
  const webCtx = await browser.newContext();
  const web = watch(await webCtx.newPage(), 'web');

  await check('web: login page renders', async () => {
    await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    // apps/web/src/app/(auth)/login/page.tsx
    await expectVisible(web.locator('input[placeholder="you@example.com"]'), 'email input');
  });

  await check('web: alice logs in, app shell renders (no bounce to /login)', async () => {
    await web.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
    await web.fill('input[placeholder="Enter your password"]', TEST_PASSWORD);
    await web.click('button:has-text("Sign in to UnifyOps")');
    await web.waitForURL(/\/home/, { timeout: TIMEOUT });
    // apps/web/src/components/layout/sidebar.tsx — authed sidebar nav.
    await expectVisible(web.locator('aside a[href="/my-work"]'), 'sidebar "My Work" link');
    await expectVisible(web.locator('aside button:has-text("Quick jump")'), 'quick-jump button');
    if (web.url().includes('/login')) throw new Error('redirected back to /login');
  });

  // ── 1b. Phase 7b route consolidation (ADR 0011): flat Tier W shim ──────────
  // Flat /issues is a permanent redirect into the current workspace; the query
  // string must survive verbatim (stored notification links depend on it).
  await check('web: flat /issues redirects to /<workspaceSlug>/issues (query preserved)', async () => {
    await web.goto(`${WEB}/issues?from=smoke`, { waitUntil: 'domcontentloaded' });
    // workspace-redirect.tsx resolves persisted-selection-else-first workspace.
    await web.waitForURL(/\/[a-z0-9-]+\/issues\?from=smoke$/, { timeout: TIMEOUT });
    // apps/web/src/app/(app)/[workspaceSlug]/issues/page.tsx heading.
    await expectVisible(web.locator('h1:has-text("Tasks")'), 'Tasks heading on slugged issues page');
    if (web.url().includes('/login')) throw new Error('bounced to /login');
  });

  // ── 2. Admin God Mode login (instance admin) ───────────────────────────────
  console.log(`  … backing off ${LOGIN_BACKOFF_MS / 1000}s before next login (throttle 5/min/IP)`);
  await sleep(LOGIN_BACKOFF_MS);

  const adminCtx = await browser.newContext();
  const admin = watch(await adminCtx.newPage(), 'admin');

  await check('admin: God Mode login lands on General', async () => {
    // networkidle, not domcontentloaded: clicking before React hydrates is a
    // silent no-op (the form never submits and waitForURL times out).
    await admin.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
    // apps/admin/src/app/login/page.tsx (AuthField/PasswordField placeholders)
    await admin.fill('input[placeholder="you@company.com"]', ADMIN_EMAIL);
    await admin.fill('input[placeholder="••••••••"]', ADMIN_PASSWORD);
    await admin.click('button[type="submit"]:has-text("Sign in")');
    // login/page.tsx router.replace('/general'); dashboard layout verifies
    // /instance/me before rendering — wait for the real page, not "checking".
    await admin.waitForURL(/\/god-mode\/general/, { timeout: TIMEOUT });
    // apps/admin/src/app/(dashboard)/general/page.tsx → PageHeader "General"
    await expectVisible(admin.locator('h1:has-text("General")'), 'General page header');
    // apps/admin/src/app/(dashboard)/layout.tsx nav
    await expectVisible(admin.locator('nav a:has-text("Authentication")'), 'Authentication nav link');
  });

  // ── 3. Sign-up toggle round-trip + web register blocked ────────────────────
  // apps/admin/src/app/(dashboard)/authentication/page.tsx: ENABLE_SIGNUP is
  // the first toggle ("Allow new sign-ups"), rendered by config-form.tsx as
  // <label><input type=checkbox/><span>label</span></label>.
  const signupToggle = () =>
    admin
      .locator('label', { hasText: 'Allow new sign-ups' })
      .locator('input[type="checkbox"]');
  const saveConfig = async () => {
    await admin.click('button[type="submit"]:has-text("Save changes")');
    // config-form.tsx renders an exact "Saved" span on success.
    await expectVisible(admin.getByText('Saved', { exact: true }), '"Saved" confirmation');
  };

  let wasChecked = null; // null = never read, restore is a no-op
  try {
    await check('admin: sign-up toggle OFF persists across reload', async () => {
      await admin.goto(`${ADMIN}/authentication`, { waitUntil: 'domcontentloaded' });
      await expectVisible(signupToggle(), 'sign-up toggle');
      wasChecked = await signupToggle().isChecked();
      if (wasChecked) {
        await signupToggle().setChecked(false);
        await saveConfig();
      } else {
        console.log('      (toggle was already OFF — skipping the flip, still verifying)');
      }
      await admin.reload({ waitUntil: 'domcontentloaded' });
      await expectVisible(signupToggle(), 'sign-up toggle after reload');
      if (await signupToggle().isChecked()) {
        throw new Error('ENABLE_SIGNUP still checked after saving OFF + reload');
      }
    });

    await check('web: register page blocks sign-up (fresh, unauthenticated context)', async () => {
      const freshCtx = await browser.newContext();
      const fresh = watch(await freshCtx.newPage(), 'web-register');
      try {
        await fresh.goto(`${WEB}/register`, { waitUntil: 'domcontentloaded' });
        // apps/web/src/app/(auth)/register/page.tsx — invitation-only notice,
        // no sign-up form at all.
        await expectVisible(fresh.locator('h2:has-text("Invitation only")'), '"Invitation only" heading');
        await expectVisible(
          fresh.getByText('does not allow public sign-ups'),
          'public sign-ups disabled copy',
        );
        const formInputs = await fresh
          .locator('input[type="email"], input[placeholder="you@example.com"]')
          .count();
        if (formInputs > 0) throw new Error('register page unexpectedly renders a sign-up form');
      } finally {
        await freshCtx.close();
      }
    });
  } finally {
    // ALWAYS restore the instance to its original sign-up setting.
    if (wasChecked === true) {
      await check('admin: sign-up toggle restored ON', async () => {
        await admin.goto(`${ADMIN}/authentication`, { waitUntil: 'domcontentloaded' });
        await expectVisible(signupToggle(), 'sign-up toggle (restore)');
        await signupToggle().setChecked(true);
        await saveConfig();
      });
    }
  }

  // ── 4/5. Space — public, no session, no auth redirect ──────────────────────
  const spaceCtx = await browser.newContext(); // fresh: no cookies, no storage
  const space = watch(await spaceCtx.newPage(), 'space');

  await check('space: index renders publicly (no auth redirect)', async () => {
    await space.goto(SPACE, { waitUntil: 'domcontentloaded' });
    // apps/space/src/app/page.tsx
    await expectVisible(space.locator('h1:has-text("Prism Space")'), 'Prism Space heading');
    if (/\/(login|register)/.test(space.url())) throw new Error('redirected to an auth page');
  });

  if (SPACE_ANCHOR) {
    await check(`space: published page "${SPACE_ANCHOR}" renders without a session`, async () => {
      await space.goto(`${SPACE}/${SPACE_ANCHOR}`, { waitUntil: 'domcontentloaded' });
      // apps/space/src/app/[anchor]/page.tsx — SSR article with title + footer.
      await expectVisible(space.locator('article h1'), 'published page title');
      await expectVisible(
        space.locator('footer:has-text("Published with Prism")'),
        'Published with Prism footer',
      );
      if (/\/(login|register)/.test(space.url())) throw new Error('redirected to an auth page');
    });
  } else {
    console.log('  ! space: SPACE_ANCHOR not set — skipping published-page check (set SPACE_ANCHOR=<anchor> to enable)');
  }

  // ── 6. No uncaught exceptions anywhere ─────────────────────────────────────
  await check('no uncaught page exceptions across the run', async () => {
    if (pageErrors.length > 0) {
      throw new Error(`${pageErrors.length} uncaught: ${pageErrors[0]}`);
    }
  });

  await browser.close();

  if (consoleErrors.length > 0) {
    console.log(`\n  ! ${consoleErrors.length} console error(s) observed (warnings, not failures):`);
    for (const line of consoleErrors.slice(0, 10)) console.log(`    - ${line}`);
    if (consoleErrors.length > 10) console.log(`    … and ${consoleErrors.length - 10} more`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
