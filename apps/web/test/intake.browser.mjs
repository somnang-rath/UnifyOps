#!/usr/bin/env node
/**
 * Browser E2E for intake: the triage queue in apps/web and the public request
 * form in apps/space.
 *
 * Drives a RUNNING dev stack (web :3000, space :3002, api :4000) with headless
 * Chromium. Never builds or starts anything itself.
 *
 * The endpoint rules are already covered by `apps/api/test/integrations.e2e.mjs`
 * (Phase 8), so this suite is deliberately not another API test. What only a
 * browser can prove is the part that has bitten this repo before: the public
 * form posts **from the browser, cross-origin**, so it needs the API's CORS
 * allowlist to include :3002 *and* the space CSP's `connect-src` to name the
 * API origin. Get either wrong and the page still renders perfectly — the
 * submit just silently never lands. A second, anonymous browser context is used
 * for that half so no session cookie can mask the failure.
 *
 *   node apps/web/test/intake.browser.mjs
 *   # or: pnpm --filter web test:intake
 *
 * Env: WEB_URL, SPACE_URL, TEST_EMAIL, TEST_PASSWORD (alice@test.com/test1234).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'package.json'));
const { chromium } = require('playwright');

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SPACE = (process.env.SPACE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
/** Same reasoning as project-tabs: `next dev` compiles each route lazily. */
const TIMEOUT = Number(process.env.INTAKE_TIMEOUT_MS ?? 45_000);

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
const cspViolations = [];
const expectVisible = async (locator, what) => {
  await locator
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT })
    .catch(() => {
      throw new Error(`not visible: ${what}`);
    });
};

/** Unique per run so re-runs never collide on an anchor (it is unique-indexed). */
const stamp = Date.now().toString(36);
const FORM_TITLE = `QA intake ${stamp}`;
/** Deliberately shares no substring with FORM_TITLE — the rail is matched by text. */
const DRAFT_TITLE = `QA draft ${stamp}`;
const ANCHOR = `qa-intake-${stamp}`;
const REQUEST_TITLE = `Login button does nothing ${stamp}`;
const SECOND_TITLE = `Please add CSV export ${stamp}`;

async function run() {
  console.log(`Intake browser E2E → web ${WEB} · space ${SPACE}\n`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  let intakeUrl = '';

  try {
    await check('login → app shell', async () => {
      await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('input[placeholder="you@example.com"]', EMAIL);
      await page.fill('input[placeholder="Enter your password"]', PASSWORD);
      await page.click('button:has-text("Sign in to UnifyOps")');
      await page.waitForURL(/\/home/, { timeout: TIMEOUT });
    });

    await check('the sidebar carries a workspace-scoped Intake item', async () => {
      const link = page.locator('a[href$="/intake"]').first();
      await expectVisible(link, 'the Intake nav item');
      // The sidebar builds Tier W hrefs from the *resolved* slug, and `/home`
      // does not carry one — so the href is the bare path until the workspaces
      // query settles. Wait for it to become scoped rather than asserting on
      // whichever of the two states this render happened to catch.
      await page
        .waitForFunction(
          () =>
            !!document.querySelector('a[href$="/intake"]') &&
            /^\/[a-z0-9-]+\/intake$/.test(
              document.querySelector('a[href$="/intake"]').getAttribute('href'),
            ),
          undefined,
          { timeout: TIMEOUT },
        )
        .catch(() => {
          throw new Error('the Intake nav item never became workspace-scoped');
        });
    });

    // Reached through the flat shim, which is the URL the nav item points at
    // before the workspace resolves — so this also proves the shim redirects.
    await check('the flat /intake shim lands on the workspace route', async () => {
      await page.goto(`${WEB}/intake`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/[a-z0-9-]+\/intake(\?|$)/, { timeout: TIMEOUT });
      intakeUrl = page.url();
      await expectVisible(page.locator('h1:has-text("Intake")'), 'the page heading');
    });

    // alice owns "Website Redesign" in the fixture. The project select must be
    // pointed at a project she can WRITE — creating a form is a project write,
    // so a readable-only project would 403 every mutation below (the same trap
    // that made views-relations flake, project.md 2026-08-06).
    await check('select a writable project', async () => {
      await page.click('button[aria-label="Project"]');
      await page.click('[role="option"]:has-text("Website Redesign")');
      await page.waitForURL(/[?&]project=/, { timeout: TIMEOUT });
    });

    await check('create an intake form, published under an anchor', async () => {
      await page.click('button:has-text("New form")');
      await expectVisible(page.locator('text=New intake form'), 'the create modal');
      await page.fill('input[placeholder="Bug reports"]', FORM_TITLE);
      await page.fill(
        'textarea[placeholder^="Tell us what went wrong"]',
        'Report anything broken here.',
      );
      // The title auto-slugs into the anchor; overwrite it with our stamped one.
      await page.fill('input[placeholder="bug-reports"]', ANCHOR);
      await page.click('button:has-text("Create form")');
      await expectVisible(
        page.locator(`nav[aria-label="Intake forms"] button:has-text("${FORM_TITLE}")`),
        'the new form in the rail',
      );
    });

    await check('the shareable public link points at the Space', async () => {
      await page.click(`nav[aria-label="Intake forms"] button:has-text("${FORM_TITLE}")`);
      const link = page.locator(`input[value$="/spaces/intake/${ANCHOR}"]`).first();
      await expectVisible(link, 'the public link row');
    });

    // The create and update schemas treat `anchor` differently — update takes
    // null to unpublish, create rejects an explicit null — so a form made
    // without a public link exercises a genuinely different request body.
    await check('a form can be created unpublished', async () => {
      await page.click('button:has-text("New form")');
      await page.fill('input[placeholder="Bug reports"]', DRAFT_TITLE);
      await page.fill('input[placeholder="bug-reports"]', '');
      await page.click('button:has-text("Create form")');
      await page.click(
        `nav[aria-label="Intake forms"] button:has-text("${DRAFT_TITLE}")`,
      );
      await expectVisible(page.locator('text=Not published'), 'the unpublished notice');
    });

    await check('an empty queue says so', async () => {
      await page.click(`nav[aria-label="Intake forms"] button:has-text("${FORM_TITLE}")`);
      await expectVisible(page.locator('text=Nothing waiting'), 'the empty queue');
    });

    // ── the public half, in a context with no session at all ──────────
    const anon = await browser.newContext();
    const pub = await anon.newPage();
    pub.setDefaultTimeout(TIMEOUT);
    pub.setDefaultNavigationTimeout(TIMEOUT);
    pub.on('pageerror', (e) => pageErrors.push(`[space] ${e.message}`));
    // A blocked fetch surfaces here and nowhere else — the form would just
    // show a generic network error, which looks like the API being down.
    pub.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|violates the following/i.test(t)) {
        cspViolations.push(t);
      }
    });

    try {
      await check('the public form renders for an anonymous visitor', async () => {
        await pub.goto(`${SPACE}/spaces/intake/${ANCHOR}`, {
          waitUntil: 'networkidle',
        });
        await expectVisible(pub.locator(`h1:has-text("${FORM_TITLE}")`), 'the form title');
        await expectVisible(
          pub.locator('text=Report anything broken here.'),
          'the form description',
        );
      });

      await check('an unknown anchor is a 404, not an empty form', async () => {
        const res = await pub.goto(`${SPACE}/spaces/intake/no-such-form-${stamp}`, {
          waitUntil: 'domcontentloaded',
        });
        if (res.status() !== 404) throw new Error(`status ${res.status()}`);
      });

      await check('submitting reaches the API cross-origin (CORS + CSP)', async () => {
        // `networkidle`, not `domcontentloaded`: the fields are controlled
        // React inputs, so text typed into the server-rendered HTML before
        // hydration is wiped when React takes over — and the submit button,
        // disabled until the title has a value, then never enables. Space is
        // the one app where waiting for idle is safe (no sockets, no polling).
        await pub.goto(`${SPACE}/spaces/intake/${ANCHOR}`, {
          waitUntil: 'networkidle',
        });
        await pub.fill('#intake-title', REQUEST_TITLE);
        await pub.fill('#intake-description', 'Tapping Sign in on iOS does nothing.');
        await pub.fill('#intake-email', 'stranger@example.com');
        await pub.click('button:has-text("Send request")');
        await expectVisible(pub.locator('text=Thank you'), 'the confirmation');
      });

      await check('a second request, so the queue has more than one row', async () => {
        await pub.click('button:has-text("Submit another")');
        await pub.fill('#intake-title', SECOND_TITLE);
        await pub.click('button:has-text("Send request")');
        await expectVisible(pub.locator('text=Thank you'), 'the confirmation');
      });

      await check('no CSP violation was logged on the public form', async () => {
        if (cspViolations.length) {
          throw new Error(`${cspViolations.length}: ${cspViolations[0]}`);
        }
      });
    } finally {
      await anon.close();
    }

    // ── back to the queue ─────────────────────────────────────────────
    await check('both requests appear in the pending queue', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expectVisible(page.locator(`text=${REQUEST_TITLE}`), 'the first request');
      await expectVisible(page.locator(`text=${SECOND_TITLE}`), 'the second request');
    });

    await check('the submitter’s email is shown to the triager', async () => {
      await expectVisible(
        page.locator('a[href="mailto:stranger@example.com"]'),
        'the submitter contact',
      );
    });

    await check('accept with edits creates a work item', async () => {
      const card = page.locator('article', { hasText: REQUEST_TITLE }).first();
      await card.locator('button:has-text("Edit & accept")').click();
      await expectVisible(page.locator('text=Accept request'), 'the triage modal');
      await page.fill('input[placeholder="bug, mobile"]', 'bug, mobile');
      await page.click('button:has-text("Create work item")');
      // Pending is the default tab and an accepted row leaves it, so the link
      // to the new work item is on the Accepted tab, not where we just were.
      await page.click('button[role="tab"]:has-text("Accepted")');
      await expectVisible(
        page.locator('a:has-text("View the work item")'),
        'the link to the created issue',
      );
    });

    await check('the created work item opens and carries the intake label', async () => {
      await page.click('a:has-text("View the work item")');
      await page.waitForURL(/\/issues\/[a-f0-9]{24}$/, { timeout: TIMEOUT });
      await expectVisible(page.locator(`text=${REQUEST_TITLE}`), 'the issue title');
      await expectVisible(page.locator('text=intake').first(), 'the intake label');
    });

    await check('declining leaves the request in the queue, without an issue', async () => {
      await page.goto(intakeUrl, { waitUntil: 'domcontentloaded' });
      await page.click('button[aria-label="Project"]');
      await page.click('[role="option"]:has-text("Website Redesign")');
      await page.click(`nav[aria-label="Intake forms"] button:has-text("${FORM_TITLE}")`);
      await expectVisible(page.locator(`text=${SECOND_TITLE}`), 'the pending request');
      const card = page.locator('article', { hasText: SECOND_TITLE }).first();
      await card.locator('button:has-text("Decline")').click();
      await expectVisible(page.locator('text=Decline request'), 'the confirm dialog');
      await page.locator('button:has-text("Confirm")').click();
      // Pending is the default tab, so a declined row must drop out of it.
      await page
        .locator(`article:has-text("${SECOND_TITLE}")`)
        .waitFor({ state: 'detached', timeout: TIMEOUT })
        .catch(() => {
          throw new Error('the declined request is still in the pending queue');
        });
    });

    await check('the status tabs are URL state, and find both rows again', async () => {
      await page.click('button[role="tab"]:has-text("Declined")');
      await page.waitForURL(/[?&]status=declined/, { timeout: TIMEOUT });
      await expectVisible(page.locator(`text=${SECOND_TITLE}`), 'the declined request');
      await page.click('button[role="tab"]:has-text("Accepted")');
      await expectVisible(page.locator(`text=${REQUEST_TITLE}`), 'the accepted request');
    });

    await check('closing the form takes the public page down', async () => {
      await page.click('button[aria-label="Accepting submissions"]');
      const anon2 = await browser.newContext();
      try {
        const res = await anon2
          .newPage()
          .then((p) =>
            p.goto(`${SPACE}/spaces/intake/${ANCHOR}`, { waitUntil: 'domcontentloaded' }),
          );
        if (res.status() !== 404) throw new Error(`status ${res.status()}`);
      } finally {
        await anon2.close();
      }
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
