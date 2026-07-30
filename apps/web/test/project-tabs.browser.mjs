#!/usr/bin/env node
/**
 * Browser E2E for the four project sub-navigation tabs that replaced their
 * `ComingSoon` placeholders: Cycles, Modules, Views and Pages.
 *
 * Drives a RUNNING dev stack (web :3000, api :4000) with headless Chromium.
 * Never builds or starts anything itself. The API-level rules are covered by
 * apps/api/test/cycles-modules.e2e.mjs — this proves the screens actually
 * render and round-trip through the real UI, which a typecheck cannot.
 *
 *   node apps/web/test/project-tabs.browser.mjs
 *   # or: pnpm --filter web test:project-tabs
 *
 * Env: WEB_URL, TEST_EMAIL, TEST_PASSWORD (alice@test.com / test1234).
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
/**
 * Generous on purpose. This drives `next dev`, which compiles each route
 * lazily on its first request — a cold `/[slug]/projects/[id]/views` can take
 * well over 20s, and that shows up as whichever checks happen to run first
 * failing differently on every run.
 */
const TIMEOUT = Number(process.env.TAB_TIMEOUT_MS ?? 45_000);

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

const pageErrors = [];
const expectVisible = async (locator, what) => {
  await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {
    throw new Error(`not visible: ${what}`);
  });
};

/** Unique per run so re-runs never collide on a name. */
const stamp = Date.now().toString().slice(-6);

async function run() {
  console.log(`Project tabs browser E2E → ${WEB}\n`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${e.message}`));
  // Applies to click/fill/goto too, not just the explicit waits — a cold dev
  // route makes any of them slow, not only the ones with an explicit timeout.
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  try {
    await check('login → app shell', async () => {
      await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('input[placeholder="you@example.com"]', EMAIL);
      await page.fill('input[placeholder="Enter your password"]', PASSWORD);
      await page.click('button:has-text("Sign in to UnifyOps")');
      await page.waitForURL(/\/home/, { timeout: TIMEOUT });
    });

    // Navigate to a project the user can WRITE — the tabs' create affordances
    // are gated on owner-or-member, so a read-only project would render an
    // empty state with no button and every check below would misreport.
    let projectUrl = '';
    await check('open a writable project', async () => {
      // Login lands on the flat `/home`, so the slug is NOT in that URL. The
      // flat `/projects` shim redirects into the current workspace (ADR 0011),
      // which is what actually resolves it.
      await page.goto(`${WEB}/projects`, { waitUntil: 'networkidle' });
      await page.waitForURL(/\/[a-z0-9-]+\/projects$/, { timeout: TIMEOUT });
      const slug = new URL(page.url()).pathname.split('/')[1];

      // "Website Redesign" is alice's own project in the E2E fixture — pick it
      // by name rather than taking the first card, which may be a project she
      // can only read (every mutation below would then be correctly refused).
      const link = page
        .locator(`a[href^="/${slug}/projects/"]:has-text("Website Redesign")`)
        .first();
      await expectVisible(link, 'the Website Redesign project card');
      const href = await link.getAttribute('href');
      // Build the tab URLs from the href: clicking lands on a child route
      // whose suffix varies, so slicing the resulting URL is fragile.
      projectUrl = `${WEB}${href}`;

      // `domcontentloaded`, not `networkidle`: the app shell holds open a
      // notifications socket, so the network never actually goes idle here.
      await page.goto(`${projectUrl}/overview`, { waitUntil: 'domcontentloaded' });
      await expectVisible(page.locator('nav a:has-text("Cycles")'), 'Cycles tab');
    });

    // Warm every route once before asserting on any of it. Without this the
    // first check to touch a cold route pays the whole dev-server compile and
    // times out, and *which* check that is moves around between runs.
    await check('warm up the four tab routes', async () => {
      for (const tab of ['cycles', 'modules', 'views', 'pages']) {
        await page.goto(`${projectUrl}/${tab}`, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUT,
        });
      }
    });

    // ── Cycles ────────────────────────────────────────────────────
    const cycleName = `Smoke cycle ${stamp}`;
    await check('Cycles tab renders (not "Coming soon")', async () => {
      await page.goto(`${projectUrl}/cycles`, { waitUntil: 'networkidle' });
      if (await page.locator('text=Coming soon').count()) {
        throw new Error('still the ComingSoon placeholder');
      }
      await expectVisible(
        page.locator('text=A project runs one scheduled cycle at a time'),
        'cycles page intro',
      );
    });

    await check('create a cycle → it appears with a progress bar', async () => {
      await page.click('button:has-text("New cycle")');
      await expectVisible(page.locator('text=New cycle'), 'cycle modal');
      await page.fill('input[placeholder="Sprint 12"]', cycleName);
      await page.click('button:has-text("Create cycle")');
      await expectVisible(page.locator(`text=${cycleName}`), 'the new cycle');
      // Drafts have no dates, so it must land under the Drafts section.
      await expectVisible(page.locator('h2:has-text("Drafts")'), 'Drafts section');
      await expectVisible(
        page.locator('[role="progressbar"]').first(),
        'progress bar',
      );
    });

    await check('expand the cycle → empty item list + Add work items', async () => {
      await page.click(`button[aria-label="Expand ${cycleName}"]`);
      await expectVisible(
        page.locator('text=No work items in this cycle yet'),
        'empty item list',
      );
      await expectVisible(
        page.locator('button:has-text("Add work items")'),
        'add-items button',
      );
    });

    await check('Add work items dialog lists the unscheduled backlog', async () => {
      await page.click('button:has-text("Add work items")');
      await expectVisible(
        page.locator(`text=Add work items to ${cycleName}`),
        'add-items modal',
      );
      // Either real backlog rows or the honest empty state — both prove the
      // `cycleId=none` query resolved rather than erroring. Wait for one of
      // them: the list renders a skeleton first, so counting immediately after
      // the dialog opens always sees zero of both.
      const rows = page.locator('label:has(input[type="checkbox"])');
      const empty = page.locator('text=Nothing to add');
      await Promise.race([
        rows.first().waitFor({ state: 'visible', timeout: TIMEOUT }),
        empty.first().waitFor({ state: 'visible', timeout: TIMEOUT }),
      ]).catch(() => {
        throw new Error('neither backlog rows nor an empty state');
      });
      // Close via the button — Escape races the dialog's own focus trap, and a
      // still-open overlay swallows the delete click in the next check.
      await page.click('button:has-text("Cancel")');
      await page
        .locator(`text=Add work items to ${cycleName}`)
        .waitFor({ state: 'detached', timeout: TIMEOUT });
    });

    await check('delete the cycle', async () => {
      await page.click(`button[aria-label="Delete ${cycleName}"]`);
      await expectVisible(page.locator('text=Delete cycle?'), 'confirm dialog');
      await page.click('button:has-text("Delete")');
      await page
        .locator(`text=${cycleName}`)
        .waitFor({ state: 'detached', timeout: TIMEOUT });
    });

    // ── Modules ───────────────────────────────────────────────────
    const moduleName = `Smoke module ${stamp}`;
    await check('Modules tab renders (not "Coming soon")', async () => {
      await page.goto(`${projectUrl}/modules`, { waitUntil: 'networkidle' });
      if (await page.locator('text=Coming soon').count()) {
        throw new Error('still the ComingSoon placeholder');
      }
      await expectVisible(
        page.locator('text=Modules run in parallel'),
        'modules page intro',
      );
    });

    await check('create a module with a status → lands in that section', async () => {
      await page.click('button:has-text("New module")');
      await expectVisible(page.locator('text=New module'), 'module modal');
      await page.fill('input[placeholder="Billing v2"]', moduleName);
      await page.click('button:has-text("Create module")');
      await expectVisible(page.locator(`text=${moduleName}`), 'the new module');
      // Default status is `backlog`.
      await expectVisible(page.locator('h2:has-text("Backlog")'), 'Backlog section');
    });

    await check('delete the module', async () => {
      await page.click(`button[aria-label="Delete ${moduleName}"]`);
      await expectVisible(page.locator('text=Delete module?'), 'confirm dialog');
      await page.click('button:has-text("Delete")');
      await page
        .locator(`text=${moduleName}`)
        .waitFor({ state: 'detached', timeout: TIMEOUT });
    });

    // ── Views ─────────────────────────────────────────────────────
    const viewName = `Smoke view ${stamp}`;
    await check('Views tab renders (not "Coming soon")', async () => {
      await page.goto(`${projectUrl}/views`, { waitUntil: 'networkidle' });
      if (await page.locator('text=Coming soon').count()) {
        throw new Error('still the ComingSoon placeholder');
      }
      await expectVisible(
        page.locator("text=Saved slices of this project"),
        'views page intro',
      );
    });

    await check('create a view → summary line renders', async () => {
      await page.click('button:has-text("New view")');
      await expectVisible(page.locator('text=New view'), 'view modal');
      await page.fill('input[placeholder="Critical bugs"]', viewName);
      await page.click('button:has-text("Create view")');
      await expectVisible(page.locator(`text=${viewName}`), 'the new view');
      await expectVisible(page.locator('text=Private'), 'private badge');
    });

    await check('?view= deep link applies the view on the issues list', async () => {
      await page.click(`a:has-text("${viewName}")`);
      await page.waitForURL(/\/issues\?view=[a-f0-9]{24}/, { timeout: TIMEOUT });
      await expectVisible(page.locator('h1:has-text("Tasks")'), 'issues page');
      // The saved view's chip must come up active, proving applyView ran from
      // the URL rather than the page loading with default filters.
      await expectVisible(
        page.locator(`button:has-text("${viewName}")`),
        'the view chip on the issues list',
      );
    });

    await check('delete the view', async () => {
      await page.goto(`${projectUrl}/views`, { waitUntil: 'networkidle' });
      await page.click(`button[aria-label="Delete view ${viewName}"]`);
      await expectVisible(page.locator('text=Delete view?'), 'confirm dialog');
      await page.click('button:has-text("Delete")');
      await page
        .locator(`text=${viewName}`)
        .waitFor({ state: 'detached', timeout: TIMEOUT });
    });

    // ── Pages ─────────────────────────────────────────────────────
    await check('Pages tab renders (not "Coming soon")', async () => {
      await page.goto(`${projectUrl}/pages`, { waitUntil: 'networkidle' });
      if (await page.locator('text=Coming soon').count()) {
        throw new Error('still the ComingSoon placeholder');
      }
      await expectVisible(
        page.locator('input[placeholder="Search pages…"]'),
        'page search box',
      );
    });

    await check('create a page → hands off to the wiki editor via ?project=&page=', async () => {
      await page.click('button:has-text("New page")');
      await page.waitForURL(/\/wiki\?project=[a-f0-9]{24}&page=[a-f0-9]{24}/, {
        timeout: TIMEOUT,
      });
      // The editor must open on THAT page, not whatever localStorage had.
      // The title is an <input>, so assert on its value — `text=` never
      // matches a placeholder or an input's value. And *wait* for it: the
      // header renders empty while `GET /wiki/:id` is still in flight, so
      // reading the value immediately always sees "".
      const title = page.locator('input[placeholder="Untitled page"]').first();
      await expectVisible(title, 'the wiki title input');
      await page
        .waitForFunction(
          () =>
            document.querySelector('input[placeholder="Untitled page"]')?.value
              ?.length > 0,
          undefined,
          { timeout: TIMEOUT },
        )
        .catch(() => {
          throw new Error('the editor never loaded the linked page');
        });
      const value = await title.inputValue();
      if (value !== 'Untitled page') {
        throw new Error(`editor opened on the wrong page: "${value}"`);
      }
    });

    await check('the new page is listed back on the Pages tab', async () => {
      await page.goto(`${projectUrl}/pages`, { waitUntil: 'networkidle' });
      await expectVisible(
        page.locator('text=Untitled page').first(),
        'the page in the project index',
      );
      // Clean up: remove the page we just made.
      await page.click('button[aria-label="Delete page Untitled page"]');
      await expectVisible(page.locator('text=Delete page?'), 'confirm dialog');
      await page.click('button:has-text("Delete")');
    });

    await check('no uncaught page exceptions during the run', async () => {
      if (pageErrors.length) {
        throw new Error(`${pageErrors.length}: ${pageErrors[0]}`);
      }
    });
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
