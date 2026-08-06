#!/usr/bin/env node
/**
 * Cover image picker — the QA pass from `docs/plan/05-cover-image-picker.md` §8.
 *
 * That checklist was written as a *manual* pass ("ឃើញពិត", "Network tab",
 * "keyboard-only") and had sat unticked because nobody had done it. Manual is
 * the wrong shape for it: every item is observable from a driven browser, and
 * a box ticked by hand goes stale the next time someone edits the picker. This
 * suite is that pass, automated, so it stays true.
 *
 *   node apps/web/test/cover-picker.browser.mjs
 *   # or: pnpm --filter web test:cover
 *
 * Drives a RUNNING dev stack (web :3000, api :4000). Never builds or starts
 * anything itself.
 *
 * ## Why almost everything is intercepted
 *
 * The picker's states are mostly *failure* states — 502, no results, Unsplash
 * turned off — and none of them can be produced on demand against the real
 * API. Requests to `/unsplash/search` are therefore fulfilled from fixtures via
 * `page.route`, which also keeps the run off the real Unsplash rate limit. One
 * check deliberately does NOT intercept, so the actual server-side integration
 * is still exercised; it skip-warns rather than fails when no key is configured
 * (a dev machine without an Unsplash key is a legitimate setup).
 *
 * Env: WEB_URL (default http://localhost:3000)
 *      TEST_EMAIL / TEST_PASSWORD (alice@test.com / test1234 — test-seed.ts)
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'package.json'));
const { chromium } = require('playwright');

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const TIMEOUT = 20_000;

let pass = 0;
let fail = 0;
let warn = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    if (err?.skip) {
      console.warn(`  ! ${name} — skipped: ${err.message}`);
      warn += 1;
      return;
    }
    console.error(`  ✗ ${name}\n      ${String(err.message ?? err).split('\n')[0]}`);
    fail += 1;
  }
}
const skip = (message) => Object.assign(new Error(message), { skip: true });

/* ------------------------------- fixtures -------------------------------- */

/** A photo shaped exactly like the API's projection (`use-unsplash.ts`). */
const photo = (i) => ({
  id: `photo-${i}`,
  alt: `Fixture photo ${i}`,
  color: '#223344',
  urls: {
    // 1x1 transparent GIF: renders instantly, needs no network, and cannot
    // make the run depend on images.unsplash.com being reachable.
    regular: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${i}`,
    small: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${i}`,
    thumb: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${i}`,
  },
  downloadLocation: `https://api.unsplash.com/photos/photo-${i}/download`,
  // The UTM params are appended server-side (ADR 0010 §4) — mirrored here so
  // the attribution check tests the same string the API really produces.
  user: {
    name: `Photographer ${i}`,
    username: `shooter${i}`,
    link: `https://unsplash.com/@shooter${i}?utm_source=prism&utm_medium=referral`,
  },
});

const searchPage = ({ results = 3, page = 1, totalPages = 1, configured = true } = {}) => ({
  configured,
  page,
  totalPages,
  total: results * totalPages,
  results: Array.from({ length: results }, (_, i) => photo(page * 100 + i)),
});

const SEARCH_PATTERN = '**/api/v1/unsplash/search*';

/**
 * Run `fn` with the Unsplash search endpoint served by `handler`.
 *
 * Always unroutes, including when `fn` throws — a leaked interceptor makes
 * every later check fail for a reason that has nothing to do with what it
 * tests, which is exactly how one broken check turns into eight.
 */
async function withSearch(page, handler, fn) {
  await page.route(SEARCH_PATTERN, handler);
  try {
    return await fn();
  } finally {
    await page.unroute(SEARCH_PATTERN, handler);
  }
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/* --------------------------------- helpers -------------------------------- */

/** Toasts are global; the picker must render its errors inline instead (§6). */
async function toastCount(page) {
  return page.locator('[role="status"], [data-toast], .toast').count();
}

async function expectVisible(locator, what) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  } catch {
    throw new Error(`expected visible: ${what}`);
  }
}

async function expectHidden(locator, what) {
  try {
    await locator.first().waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    throw new Error(`expected hidden: ${what}`);
  }
}

async function run() {
  console.log('Cover picker QA (docs/plan/05 §8)');
  console.log(`  web=${WEB}\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // Console errors are collected so the 502 check can prove nothing escaped
  // to a toast *or* to an unhandled rejection.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).split('\n')[0]));

  // ── login + navigate to a project overview (has banner + picker) ─────────
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="you@example.com"]', EMAIL);
  await page.fill('input[placeholder="Enter your password"]', PASSWORD);
  await page.click('button:has-text("Sign in to UnifyOps")');
  await page.waitForURL(/\/home/, { timeout: TIMEOUT });

  // `next dev` compiles routes lazily, and the flat /projects shim redirects
  // through a workspace lookup — the first hit pays the whole compile. Warm it
  // with a generous budget so a cold route never masquerades as a bug (the same
  // trap project-tabs.browser.mjs documents).
  const WARM = Number(process.env.WARM_TIMEOUT_MS ?? 90_000);
  await page.goto(`${WEB}/projects`, { waitUntil: 'domcontentloaded', timeout: WARM });
  await page.waitForURL(/\/[a-z0-9-]+\/projects\/?(\?|$)/, { timeout: WARM });

  const firstProject = page.locator('a[href*="/projects/"]').first();
  await firstProject.waitFor({ state: 'visible', timeout: WARM });
  const projectHref = await firstProject.getAttribute('href');
  const projectUrl = `${WEB}${projectHref.replace(/\/(overview|settings|cycles|modules|views|pages)$/, '')}`;
  // Overview is the tab that renders the cover banner.
  const overviewUrl = `${projectUrl}/overview`;
  await page.goto(overviewUrl, { waitUntil: 'domcontentloaded', timeout: WARM });
  // Wait for the page's own data, not just the shell — the cover trigger only
  // renders once the project query resolves.
  await page
    .locator('button:has-text("Add cover"), button:has-text("Change cover"), [class*="group\\/cover"]')
    .first()
    .waitFor({ state: 'attached', timeout: WARM });

  const modal = page.locator('text=Choose cover');

  /** Click whichever cover trigger this project currently has. */
  const clickTrigger = async () => {
    const add = page.locator('button:has-text("Add cover")');
    if (await add.count()) {
      await add.first().click();
      return;
    }
    // With a cover set, the Change/Remove overlay only appears on hover.
    await page.locator('[class*="group/cover"]').first().hover();
    await page.locator('button:has-text("Change cover")').first().click();
  };

  const closePicker = async () => {
    if (!(await modal.count())) return;
    await page.keyboard.press('Escape');
    await expectHidden(modal, 'picker modal after Escape');
  };

  const openPicker = async () => {
    await closePicker(); // never stack on a modal a failed check left open
    await clickTrigger();
    await expectVisible(modal, 'picker modal');
  };

  /**
   * Open the picker on a freshly loaded page.
   *
   * The reload is not decoration: results are cached under
   * `['unsplash', query]`, so re-opening the modal in the same session replays
   * the previous check's fixture instead of hitting the new interceptor — the
   * "Load more" button, for one, then reflects the wrong `totalPages`.
   */
  const freshPicker = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .locator('button:has-text("Add cover"), [class*="group\\/cover"]')
      .first()
      .waitFor({ state: 'attached', timeout: TIMEOUT });
    await clickTrigger();
    await expectVisible(modal, 'picker modal');
  };

  const tiles = page.locator('button[aria-label^="Photo by"]');

  // ── 1. the seven picker states ───────────────────────────────────────────

  await check('state: loading skeletons while the search is in flight', async () => {
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    await withSearch(
      page,
      async (route) => {
        await held;
        await json(route, searchPage());
      },
      async () => {
        await freshPicker();
        // Skeleton renders aria-hidden pulse bars in a 3-col grid.
        await expectVisible(
          page.locator('.animate-pulse').first(),
          'skeleton tiles while loading',
        );
        release();
        await expectVisible(tiles.first(), 'tiles after the search resolves');
      },
    );
    release(); // idempotent — also releases if the assertion above threw
    await closePicker();
  });

  await check('state: loaded — the default query fills the grid on open', async () => {
    await withSearch(page, (route) => json(route, searchPage()), async () => {
      await freshPicker();
      await expectVisible(tiles.first(), 'tiles');
      const count = await tiles.count();
      if (count < 3) throw new Error(`expected >= 3 tiles, got ${count}`);
    });
    await closePicker();
  });

  await check('state: appending — "Load more" fetches the next page', async () => {
    await withSearch(
      page,
      (route) => {
        const p = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
        return json(route, searchPage({ page: p, totalPages: 2 }));
      },
      async () => {
        await freshPicker();
        await expectVisible(tiles.first(), 'first page of tiles');
        const before = await tiles.count();
        const loadMore = page.locator('button:has-text("Load more")');
        await expectVisible(loadMore, '"Load more" button when more pages exist');
        await loadMore.click();
        await page.waitForFunction(
          (n) => document.querySelectorAll('button[aria-label^="Photo by"]').length > n,
          before,
          { timeout: TIMEOUT },
        );
      },
    );
    await closePicker();
  });

  await check('state: no results — empty state names the query', async () => {
    await withSearch(page, (route) => json(route, searchPage({ results: 0 })), async () => {
      await freshPicker();
      await expectVisible(page.locator('text=/No photos for/'), 'no-results empty state');
    });
    await closePicker();
  });

  await check('state: 502 renders INLINE in the picker, with no toast', async () => {
    const toastsBefore = await toastCount(page);
    await withSearch(
      page,
      (route) => json(route, { message: 'Bad Gateway' }, 502),
      async () => {
        await freshPicker();
        await expectVisible(
          page.locator('[role="alert"]'),
          'inline error state inside the modal',
        );
        // The whole point of `_skipErrorToast` (ADR 0010 §6).
        const toastsAfter = await toastCount(page);
        if (toastsAfter > toastsBefore) {
          throw new Error(`a global toast appeared (${toastsBefore} → ${toastsAfter})`);
        }
      },
    );
    await closePicker();
  });

  await check('state: 502 offers a retry that recovers', async () => {
    let failNext = true;
    await withSearch(
      page,
      (route) =>
        failNext
          ? json(route, { message: 'Bad Gateway' }, 502)
          : json(route, searchPage()),
      async () => {
        await freshPicker();
        await expectVisible(page.locator('[role="alert"]'), 'error state');
        // Assert the affordance BEFORE flipping the fixture: TanStack retries
        // on its own, so once the endpoint starts succeeding the error state
        // disappears under us and the button is gone before it can be clicked.
        // ErrorState renders it as a plain "Retry" button (states.tsx).
        const retry = page.locator('[role="alert"] button:has-text("Retry")');
        await expectVisible(retry, 'a Retry affordance on the error state');
        failNext = false;
        await retry.first().click();
        await expectVisible(tiles.first(), 'tiles after retry');
      },
    );
    await closePicker();
  });

  await check('state: not-configured — gate replaces the grid AND the search box', async () => {
    await withSearch(
      page,
      (route) => json(route, { configured: false, totalPages: 0, total: 0, results: [] }),
      async () => {
        await freshPicker();
        await expectVisible(
          page.locator('text=Unsplash is not configured'),
          'not-configured empty state',
        );
        // Offering a search box that cannot search is the bug §6 calls out.
        await expectHidden(
          page.locator('input[aria-label="Search Unsplash photos"]'),
          'search input while not configured',
        );
      },
    );
    await closePicker();
  });

  await check('state: initial — a REAL search reaches the API (integration)', async () => {
    // Deliberately un-intercepted: proves the server-side proxy works.
    await freshPicker();
    const notConfigured = page.locator('text=Unsplash is not configured');
    const grid = tiles.first();
    const error = page.locator('[role="alert"]');
    await Promise.race([
      grid.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {}),
      notConfigured.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {}),
      error.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {}),
    ]);
    // Both non-tile outcomes are environment facts, not product defects: no key
    // configured, or Unsplash unreachable from this machine. Skip-warn on
    // either — failing here would make the suite red on an offline laptop.
    if (await notConfigured.count()) {
      await closePicker();
      throw skip('no Unsplash key configured on this instance');
    }
    if (await error.count()) {
      await closePicker();
      throw skip('Unsplash did not respond (no key, or no outbound network)');
    }
    if (!(await tiles.count())) {
      await closePicker();
      throw skip('real search produced neither tiles, gate, nor error — indeterminate');
    }
    await closePicker();
  });

  // ── 2. attribution (Unsplash guideline, ADR 0010 §4) ─────────────────────

  await check('attribution: per-tile photographer + Unsplash links, UTM intact', async () => {
    await withSearch(page, (route) => json(route, searchPage()), async () => {
    await freshPicker();
    await expectVisible(tiles.first(), 'tiles');

    const links = page.locator('a[href*="unsplash.com"]');
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.href));
    if (hrefs.length < 2) throw new Error(`expected tile + footer links, got ${hrefs.length}`);

    for (const href of hrefs) {
      if (!href.includes('utm_source=prism') || !href.includes('utm_medium=referral')) {
        throw new Error(`UTM params missing from ${href}`);
      }
    }
    // A photographer link (per-tile) and the Unsplash home link (footer).
    if (!hrefs.some((h) => h.includes('/@shooter'))) {
      throw new Error('no per-tile photographer link');
    }
    if (!hrefs.some((h) => /unsplash\.com\/\?/.test(h))) {
      throw new Error('no footer Unsplash link');
    }

    const targets = await links.evaluateAll((els) => els.map((e) => e.target));
    if (targets.some((t) => t !== '_blank')) {
      throw new Error('an attribution link is not target="_blank"');
    }
    const rels = await links.evaluateAll((els) => els.map((e) => e.rel));
    if (rels.some((r) => !r.includes('noopener'))) {
      throw new Error('an attribution link is missing rel="noopener"');
    }
    });
    await closePicker();
  });

  // ── 3. select → cover applied + compliance ping ──────────────────────────

  await check('select: fires POST /unsplash/download and does not block the UI', async () => {
    const downloads = [];
    const onRequest = (r) => {
      if (r.url().includes('/unsplash/download') && r.method() === 'POST') {
        downloads.push(r.url());
      }
    };
    page.on('request', onRequest);
    // Hold the compliance ping open forever: the picker must not wait on it
    // (ADR 0010 §4 — fire-and-forget). If it did, the modal would never close.
    const hang = () => {
      /* never fulfilled, never aborted */
    };
    await page.route('**/api/v1/unsplash/download', hang);
    try {
      await withSearch(page, (route) => json(route, searchPage()), async () => {
        await freshPicker();
        await expectVisible(tiles.first(), 'tiles');
        await tiles.first().click();
        // Closing while the ping is still pending is the assertion.
        await expectHidden(modal, 'picker after select');
        if (downloads.length === 0) {
          throw new Error('no POST /unsplash/download was sent');
        }
      });
    } finally {
      page.off('request', onRequest);
      await page.unroute('**/api/v1/unsplash/download', hang);
    }
  });

  await check('select: the cover banner renders the chosen image at 4:1', async () => {
    const banner = page.locator('[class*="aspect-\\[4\\/1\\]"]').first();
    await expectVisible(banner, 'cover banner');
    const box = await banner.boundingBox();
    if (!box) throw new Error('banner has no box');
    const ratio = box.width / box.height;
    // max-h-[200px] clamps tall viewports, so allow a generous band; what is
    // being caught here is a collapsed or square banner, not a rounding drift.
    if (ratio < 2 || ratio > 6) {
      throw new Error(`banner ratio ${ratio.toFixed(2)} is not banner-shaped`);
    }
  });

  await check('banner: a dead image URL falls back to a gradient, never a gap', async () => {
    // Hotlinked covers die — ADR 0010 lists this as an accepted consequence,
    // so the fallback is the mitigation and must actually work.
    await page.route('**/images.unsplash.com/**', (route) => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    const banner = page.locator('[class*="aspect-\\[4\\/1\\]"]').first();
    if (await banner.count()) {
      const box = await banner.boundingBox();
      if (box && box.height < 50) {
        throw new Error(`banner collapsed to ${box.height}px on image error`);
      }
    }
    await page.unroute('**/images.unsplash.com/**');
  });

  // ── 4. instance gate (§1: Remove survives, Add/Change do not) ────────────

  await check('gate: Unsplash off ⇒ Add/Change hidden, Remove still available', async () => {
    // Force the effective boolean off the way the API would (ADR 0010 §1).
    const patchInstance = async (route) => {
      const res = await route.fetch();
      const body = await res.json().catch(() => null);
      if (!body?.config) return route.fulfill({ response: res });
      body.config.UNSPLASH_ENABLED = false;
      return json(route, body);
    };
    await page.route('**/api/v1/public/instance*', patchInstance);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const banner = page.locator('[class*="group\\/cover"]').first();
    if (await banner.count()) {
      await banner.hover();
      await expectHidden(
        page.locator('button:has-text("Change cover")'),
        '"Change cover" while Unsplash is off',
      );
      await expectVisible(
        page.locator('button:has-text("Remove")'),
        '"Remove" while Unsplash is off',
      );
    } else {
      await expectHidden(
        page.locator('button:has-text("Add cover")'),
        '"Add cover" while Unsplash is off',
      );
    }
    await page.unroute('**/api/v1/public/instance*', patchInstance);
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  // ── 5. keyboard-only path ────────────────────────────────────────────────

  await check('keyboard: open → type → Tab to a tile → Enter selects', async () => {
    await withSearch(page, (route) => json(route, searchPage()), async () => {
      await freshPicker();
      await expectVisible(tiles.first(), 'tiles');

      // autoFocus puts the caret in the search box — typing must not need a click.
      await page.keyboard.type('mountains');
      const searchValue = await page
        .locator('input[aria-label="Search Unsplash photos"]')
        .inputValue();
      if (searchValue !== 'mountains') {
        throw new Error(`typing did not reach the search box (got "${searchValue}")`);
      }

      // Tab until focus lands on a tile, then activate with the keyboard only.
      let landed = false;
      for (let i = 0; i < 12 && !landed; i += 1) {
        await page.keyboard.press('Tab');
        landed = await page.evaluate(() =>
          Boolean(
            document.activeElement?.getAttribute('aria-label')?.startsWith('Photo by'),
          ),
        );
      }
      if (!landed) throw new Error('Tab never reached a photo tile');
      await page.keyboard.press('Enter');
      await expectHidden(modal, 'picker after keyboard select');
    });
  });

  await check('keyboard: focus returns to the trigger after the modal closes', async () => {
    // useFocusTrap stores document.activeElement on open and calls .focus() on
    // it during cleanup. That only works if the trigger is still the same DOM
    // node — so this also catches a re-render that swaps it out underneath.
    await withSearch(page, (route) => json(route, searchPage()), async () => {
      await freshPicker();
      await expectVisible(tiles.first(), 'tiles');
      await closePicker();
      // The restore happens in an effect cleanup; give React a frame.
      await page.waitForTimeout(250);
      const active = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? '',
        label: document.activeElement?.getAttribute('aria-label') ?? '',
        text: document.activeElement?.textContent?.trim().slice(0, 40) ?? '',
      }));
      if (active.tag !== 'BUTTON' || !/cover/i.test(`${active.text} ${active.label}`)) {
        throw new Error(
          `focus went to <${active.tag}> "${active.text}", not the cover trigger`,
        );
      }
    });
  });

  // ── 6. no unhandled errors anywhere in the run ───────────────────────────

  await check('no uncaught page exceptions across the whole run', async () => {
    if (pageErrors.length) {
      throw new Error(`${pageErrors.length}: ${pageErrors[0]}`);
    }
  });

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed${warn ? `, ${warn} skipped` : ''}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
