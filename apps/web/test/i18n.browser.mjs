#!/usr/bin/env node
/**
 * Browser E2E for the locale machinery (ADR 0016 §5, items 1–5).
 *
 * Drives a RUNNING dev stack (web :3000, space :3002, api :4000) with headless
 * Chromium. Never builds or starts anything itself.
 *
 *   node apps/web/test/i18n.browser.mjs
 *   # or: pnpm --filter web test:i18n
 *
 * Why a browser suite and not an API one: nothing here has an interesting HTTP
 * surface. `PATCH /users/me { locale }` is one more field on an endpoint that
 * was already covered. What can only be proved in a browser is that the choice
 * *survives the round trip* — cookie written client-side, read by middleware on
 * the next request, applied by a server-rendered root layout, and rendered in a
 * font that actually has Khmer glyphs. Each of those can be individually
 * correct while the feature is broken.
 *
 * §5.6 (a missing Khmer key fails the build) is not here on purpose: it is a
 * typecheck of `packages/i18n`, proved by `pnpm --filter @prism/i18n typecheck`.
 *
 * Env: WEB_URL, SPACE_URL, TEST_EMAIL, TEST_PASSWORD, I18N_TIMEOUT_MS.
 *
 * Note: this signs in twice, so it respects the API's 5/min login throttle with
 * a cool-down in the middle. Space it ~65s from another suite.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'package.json'));
const { chromium } = require('playwright');

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SPACE = (process.env.SPACE_URL ?? 'http://localhost:3002/spaces').replace(/\/$/, '');
const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const TIMEOUT = Number(process.env.I18N_TIMEOUT_MS ?? 60_000);
/** The API allows 5 logins/min; this suite does two. */
const COOLDOWN = Number(process.env.E2E_COOLDOWN_MS ?? 65_000);

/** One Khmer nav label — enough to tell a translated shell from a stale one. */
const KM_HOME = 'ទំព័រដើម';

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

/**
 * Raw HTML, fetched outside the browser on purpose: Playwright's request
 * context keeps its own cookie jar and drops a hand-set `cookie` header, so a
 * "the server ignored the cookie" failure there would mean nothing.
 */
async function rawHtml(url, cookie) {
  const res = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'follow' });
  return res.text();
}

async function login(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="you@example.com"]', EMAIL);
  await page.fill('input[placeholder="Enter your password"]', PASSWORD);
  await page.click('button:has-text("Sign in to UnifyOps")');
  await page.waitForURL(/\/home/, { timeout: TIMEOUT });
}

/** Open Settings → Appearance, where the switcher lives. */
async function openAppearance(page) {
  await page.goto(`${WEB}/settings`, { waitUntil: 'domcontentloaded' });
  await page.click('button:has-text("Appearance")').catch(() => {});
}

async function pickLocale(page, locale) {
  const btn = page.locator(`[data-testid="locale-switcher"] [data-locale="${locale}"]`);
  await btn.waitFor({ state: 'visible', timeout: TIMEOUT });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    btn.click(),
  ]);
  await page.waitForFunction(
    (l) => document.documentElement.lang === l,
    locale,
    { timeout: TIMEOUT },
  );
}

async function run() {
  console.log(`\ni18n browser E2E (ADR 0016 §5) → ${WEB}\n`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /hydrat/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) {
      badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  try {
    await login(page);
    // The boot `POST /auth/refresh` on an anonymous /login is *expected* to be
    // refused. Only what happens after sign-in is this suite's business.
    badResponses.length = 0;
    consoleErrors.length = 0;

    await check('the shell starts in English', async () => {
      const nav = await page.locator('nav, aside').first().innerText();
      if (!/Home/.test(nav)) throw new Error(`no English nav: ${nav.slice(0, 80)}`);
    });

    await check('switching to Khmer re-renders the shell in Khmer', async () => {
      await openAppearance(page);
      await pickLocale(page, 'km');
      await page.waitForSelector(`text=${KM_HOME}`, { timeout: TIMEOUT });
    });

    await check('it survives a full reload — the cookie, not React state', async () => {
      await page.goto(`${WEB}/home`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`text=${KM_HOME}`, { timeout: TIMEOUT });
      const lang = await page.getAttribute('html', 'lang');
      if (lang !== 'km') throw new Error(`html lang is ${lang}`);
      const cookie = (await ctx.cookies()).find((c) => c.name === 'pr_locale');
      if (cookie?.value !== 'km') throw new Error('pr_locale cookie missing or wrong');
    });

    await check('Khmer renders in Kantumruy Pro, not an OS fallback', async () => {
      // The font was loaded by all three layouts long before any of it was
      // reachable: the Tailwind preset's font-sans was Inter-only, and Inter
      // has no Khmer glyphs. Asserting the computed family is the only way to
      // tell "translated" from "translated and unreadable".
      const el = page.locator(`text=${KM_HOME}`).first();
      await el.waitFor({ state: 'visible', timeout: TIMEOUT });
      const font = await el.evaluate((n) => getComputedStyle(n).fontFamily);
      if (!/Kantumruy/i.test(font)) throw new Error(`font-family is ${font}`);
    });

    await check('the server HTML already says lang="km"', async () => {
      const html = await rawHtml(`${WEB}/home`, 'pr_locale=km');
      if (!/<html[^>]*lang="km"/.test(html)) {
        throw new Error('server-rendered <html> is not lang="km"');
      }
    });

    await check('no console errors or hydration warnings during the switch', async () => {
      if (badResponses.length) throw new Error(`bad responses: ${badResponses.join(' | ')}`);
      if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 2).join(' | '));
    });

    await check('apps/space honours the cookie and defaults for anonymous visitors', async () => {
      const anon = await rawHtml(`${SPACE}/`);
      if (!/<html[^>]*lang="en"/.test(anon)) {
        throw new Error('anonymous space is not lang="en"');
      }
      const km = await rawHtml(`${SPACE}/`, 'pr_locale=km');
      if (!/<html[^>]*lang="km"/.test(km)) {
        throw new Error('space ignored the pr_locale cookie');
      }
    });

    console.log(`  … waiting out the login throttle (${Math.round(COOLDOWN / 1000)}s)`);
    await new Promise((r) => setTimeout(r, COOLDOWN));

    await check('a fresh browser with no cookie gets Khmer from User.locale', async () => {
      // The cross-device half of §2.1, and the reason `hydrateLocale` must not
      // reload while the login page is navigating: doing so cancels the
      // navigation and looks exactly like a failed sign-in.
      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      p2.setDefaultTimeout(TIMEOUT);
      p2.setDefaultNavigationTimeout(TIMEOUT);
      try {
        await login(p2);
        await p2.waitForFunction(() => document.documentElement.lang === 'km', null, {
          timeout: TIMEOUT,
        });
        await p2.waitForSelector(`text=${KM_HOME}`, { timeout: TIMEOUT });
      } finally {
        await ctx2.close();
      }
    });

    await check('switching back to English restores the fixture user', async () => {
      // Not politeness: the suite must be re-runnable, and check 1 asserts the
      // shell starts in English.
      await openAppearance(page);
      await pickLocale(page, 'en');
      await page.waitForSelector('text=Home', { timeout: TIMEOUT });
    });
  } catch (err) {
    console.error(`\nSuite crashed: ${String(err.message ?? err).split('\n')[0]}`);
    fail += 1;
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

run();
