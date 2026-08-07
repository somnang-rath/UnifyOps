#!/usr/bin/env node
/**
 * Browser E2E for the locale machinery (ADR 0016 §5, items 1–5) plus the
 * 3b/3c/3d slices: translated screens, Khmer public holidays, and the
 * formatting seam.
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

/** The Khmer block. Used where the exact wording is ICU's choice, not ours. */
const KHMER = /[ក-៿]/;

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

    // ── 3b: the screens themselves, not just the shell ────────────────────
    await check('3b — the issues screen renders its chrome in Khmer', async () => {
      // `/issues` is the permanent flat shim; it redirects to /<slug>/issues.
      await page.goto(`${WEB}/issues`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: TIMEOUT });
      const h1 = (await page.locator('h1').first().innerText()).trim();
      if (h1 !== 'កិច្ចការ') throw new Error(`h1 is "${h1}", expected Khmer`);
      const ph = await page
        .locator('input[aria-label="ស្វែងរកកិច្ចការ"]')
        .count();
      if (ph === 0) throw new Error('the search box kept its English aria-label');
    });

    await check('3b — the projects screen renders its chrome in Khmer', async () => {
      await page.goto(`${WEB}/projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: TIMEOUT });
      const h1 = (await page.locator('h1').first().innerText()).trim();
      if (h1 !== 'គម្រោង') throw new Error(`h1 is "${h1}", expected Khmer`);
    });

    // ── 3d: the formatter seam, end to end ────────────────────────────────
    await check('3d — a formatted date renders in Khmer, not English', async () => {
      // The calendar's month header is the one date in the product that renders
      // with no fixture data at all, so it is the only locale-dependent date
      // this suite can assert on unconditionally.
      //
      // Asserting on *this element* rather than "Khmer appears on the page"
      // matters: the nav is already Khmer, so a page-wide check passes while
      // every date on it is still English — which is exactly the state this
      // found. Chromium ships no `km` locale data, so `Intl` silently answers
      // in English and `@prism/i18n` has to fall back to its own month names.
      await page.goto(`${WEB}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cal-nav-label', { timeout: TIMEOUT });
      const header = (await page.locator('.cal-nav-label').first().innerText()).trim();
      if (!KHMER.test(header)) {
        throw new Error(`month header is not Khmer: "${header}"`);
      }
    });

    await check('3d — calendar weekday headers are Khmer, not a hardcoded array', async () => {
      // These were `['Sun','Mon',…]` in the source. If they are still Latin
      // while `lang="km"`, `weekdayNames()` is not wired up — which is how the
      // missing Chromium `km` data was found: the wiring was right and the
      // platform answered in English anyway.
      const heads = await page.locator('.cal-head-cell').allInnerTexts();
      if (heads.length !== 7) throw new Error(`${heads.length} weekday cells`);
      if (!heads.every((h) => KHMER.test(h))) {
        throw new Error(`weekday headers are not Khmer: ${heads.join(' ')}`);
      }
    });

    // ── 3c: Khmer public holidays on the calendar ─────────────────────────
    await check('3c — a Khmer public holiday is marked on the calendar', async () => {
      // Step forward month by month rather than hardcoding one: "today" moves,
      // and a test pinned to a month stops proving anything next year.
      let found = false;
      for (let i = 0; i < 14 && !found; i++) {
        if ((await page.locator('.cal-holiday').count()) > 0) {
          found = true;
          break;
        }
        await page.locator('.cal-nav-btn').last().click();
        await page.waitForTimeout(120);
      }
      if (!found) throw new Error('no .cal-holiday found in 14 months of stepping');
      const label = await page.locator('.cal-holiday').first().innerText();
      if (!KHMER.test(label)) {
        throw new Error(`holiday name is not Khmer: ${label}`);
      }
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
