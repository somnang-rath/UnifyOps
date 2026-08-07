#!/usr/bin/env node
/**
 * CSP verification for the authenticated apps (docs/plan/01 §3.5).
 *
 * Drives a RUNNING dev stack (web :3000, admin :3001, space :3002, api :4000,
 * live :3100)
 * with headless Chromium. Never builds or starts anything itself.
 *
 *   node apps/web/test/csp.browser.mjs
 *   # or: pnpm --filter web test:csp
 *
 * A CSP is one of the few things that cannot be verified by reading the header:
 * the header can be perfect and still break the app, or be present and enforce
 * nothing. So this asserts both halves, from the browser's point of view:
 *
 *   POLICY  — the header is served, and the directives that carry the weight
 *             (script-src nonce, object-src, frame-ancestors) are really there.
 *   NONCE   — every <script> in the document carries the per-request nonce, and
 *             the nonce differs between requests (a fixed nonce is no nonce).
 *   SILENCE — zero `securitypolicyviolation` events while actually using the
 *             app: login, navigation, sockets, and the collab editor. This is
 *             the check that fails if the policy is too tight.
 *   TEETH   — an injected inline <script> is refused. This is the check that
 *             fails if the policy is too loose, and it is the entire point.
 *
 * Env: WEB_URL   (default http://localhost:3000)
 *      ADMIN_URL (default http://localhost:3001/god-mode)
 *      SPACE_URL (default http://localhost:3002/spaces)
 *      TEST_EMAIL / TEST_PASSWORD   (alice@test.com / test1234 — test-seed.ts)
 *      ADMIN_EMAIL / ADMIN_PASSWORD (admin@test.com / test1234)
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

/**
 * Every CSP violation the browser reports, across every page.
 *
 * `securitypolicyviolation` is added as an init script so the listener is in
 * place before any document script runs — a violation raised during initial
 * parse would otherwise fire before we could subscribe to it.
 */
const violations = [];

/**
 * React hydration warnings mentioning `nonce`.
 *
 * Browsers hide the nonce content attribute once parsing finishes, so React's
 * hydration compare sees "" and warns unless the tag opts out. Harmless, but it
 * is console noise on every single page load, so it is asserted away.
 */
const nonceWarnings = [];

async function watchCsp(page, label) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (/nonce/i.test(text) && /did not match|hydrat/i.test(text)) {
      nonceWarnings.push(`[${label}] ${text.split('\n')[0].slice(0, 100)}`);
    }
  });
  await page.exposeFunction('__reportCsp', (v) => {
    violations.push({ label, ...v });
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // Serialize eagerly: the event object does not survive the bridge.
      window.__reportCsp?.({
        directive: e.effectiveDirective || e.violatedDirective,
        blocked: String(e.blockedURI ?? '').slice(0, 120),
        sample: String(e.sample ?? '').slice(0, 80),
        source: `${e.sourceFile ?? ''}:${e.lineNumber ?? ''}`,
      });
    });
  });
  page.setDefaultTimeout(TIMEOUT);
  return page;
}

/** Violations seen so far for one label, formatted for an assertion message. */
function violationsFor(label) {
  return violations
    .filter((v) => v.label === label)
    .map((v) => `${v.directive} blocked ${v.blocked || v.sample || '(inline)'}`);
}

async function expectVisible(locator, what) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  } catch {
    throw new Error(`expected visible: ${what}`);
  }
}

/** Parse a CSP header value into { directive: [values] }. */
function parseCsp(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

async function run() {
  console.log('CSP verification (web / admin / space)');
  console.log(`  web=${WEB}  admin=${ADMIN}\n`);

  const browser = await chromium.launch({ headless: true });

  // ── web ────────────────────────────────────────────────────────────────────
  const webCtx = await browser.newContext();
  const web = await watchCsp(await webCtx.newPage(), 'web');

  let webCsp = {};
  let firstNonce = '';

  await check('web: serves a Content-Security-Policy header', async () => {
    const res = await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    const header = (await res.allHeaders())['content-security-policy'];
    if (!header) throw new Error('no Content-Security-Policy response header');
    webCsp = parseCsp(header);
  });

  await check("web: script-src is nonce-based, not 'unsafe-inline'", async () => {
    const scriptSrc = webCsp['script-src'] ?? [];
    const nonce = scriptSrc.find((v) => v.startsWith("'nonce-"));
    if (!nonce) throw new Error(`script-src has no nonce: ${scriptSrc.join(' ')}`);
    if (scriptSrc.includes("'unsafe-inline'")) {
      // A nonce makes browsers ignore 'unsafe-inline', but its presence means
      // the policy was written without understanding that — treat as a defect.
      throw new Error("script-src contains 'unsafe-inline'");
    }
    firstNonce = nonce;
  });

  await check('web: locks down object-src, base-uri and framing', async () => {
    const expected = {
      'object-src': "'none'",
      'base-uri': "'self'",
      // 'self', not 'none': the split-pane editor frames web's own routes.
      // Cross-origin framers are still refused, which is the clickjacking case.
      'frame-ancestors': "'self'",
      'form-action': "'self'",
    };
    for (const [directive, value] of Object.entries(expected)) {
      const actual = (webCsp[directive] ?? []).join(' ');
      if (actual !== value) {
        throw new Error(`${directive} is "${actual}", expected "${value}"`);
      }
    }
  });

  await check('web: X-Frame-Options agrees with frame-ancestors', async () => {
    // The two are independent headers and browsers that honour XFO apply it
    // regardless of the CSP. A leftover DENY here blocks the panes on its own,
    // and the browser renders that as "localhost refused to connect" — a
    // symptom that reads like a dead server, not a header.
    const res = await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    const xfo = (await res.allHeaders())['x-frame-options'];
    if (xfo !== 'SAMEORIGIN') {
      throw new Error(`X-Frame-Options is "${xfo}", expected SAMEORIGIN`);
    }
  });

  await check('web: every <script> in the document carries the nonce', async () => {
    const bad = await web.evaluate(() =>
      [...document.querySelectorAll('script')]
        .filter((s) => !s.nonce && !s.getAttribute('nonce'))
        .map((s) => s.src || `inline:${s.textContent.slice(0, 40)}`),
    );
    if (bad.length) throw new Error(`${bad.length} script(s) without nonce: ${bad[0]}`);
  });

  await check('web: the nonce is per-request, not a constant', async () => {
    const res = await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    const second = parseCsp((await res.allHeaders())['content-security-policy'])['script-src']
      ?.find((v) => v.startsWith("'nonce-"));
    if (!second) throw new Error('second response had no nonce');
    if (second === firstNonce) throw new Error(`nonce repeated across requests: ${second}`);
  });

  // ── the app still works under the policy ───────────────────────────────────
  await check('web: alice logs in and the app shell renders under CSP', async () => {
    await web.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    await web.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
    await web.fill('input[placeholder="Enter your password"]', TEST_PASSWORD);
    await web.click('button:has-text("Sign in to UnifyOps")');
    await web.waitForURL(/\/home/, { timeout: TIMEOUT });
    // Hydration is the thing a broken script-src kills first, and a server-
    // rendered shell looks identical to a hydrated one until you interact.
    await expectVisible(web.locator('aside a[href="/my-work"]'), 'sidebar "My Work" link');
    await expectVisible(web.locator('aside button:has-text("Quick jump")'), 'quick-jump button');
  });

  await check('web: client-side interaction works (hydration survived)', async () => {
    // If hydration were blocked the button would render but do nothing, which
    // is exactly the failure mode a header-only check cannot see.
    await web.click('aside button:has-text("Quick jump")');
    await expectVisible(web.locator('[role="dialog"], [cmdk-root]'), 'command palette');
    await web.keyboard.press('Escape');
  });

  await check('web: theme boot script ran (no FOUC fallback)', async () => {
    // The inline pre-paint script sets data-theme. Blocked ⇒ attribute absent.
    const theme = await web.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (!theme) throw new Error('data-theme not set — the inline theme script was blocked');
  });

  await check('web: a same-origin route loads in an iframe (split panes work)', async () => {
    // The split-pane editor renders any unregistered route as an <iframe> of
    // itself with `?chrome=0`. Under `frame-ancestors 'none'` + XFO DENY the
    // browser refuses that frame and paints its own error page, so the pane
    // reads as "localhost refused to connect" with a perfectly healthy server.
    // Framed by the page itself, exactly as the product does it, and framing
    // the route it is already on: `next dev` compiles lazily, so a cold route
    // here would time out on compilation and read as a framing failure.
    const loaded = await web.evaluate(
      () =>
        new Promise((resolve) => {
          const frame = document.createElement('iframe');
          frame.src = `${location.pathname}?chrome=0`;
          const done = (value) => {
            frame.remove();
            resolve(value);
          };
          frame.onload = () => {
            // A blocked frame still fires load, but commits an error page: no
            // document we can read, and certainly none of Next's scripts.
            try {
              const doc = frame.contentDocument;
              done(!!doc && doc.querySelectorAll('script').length > 0);
            } catch {
              done(false);
            }
          };
          document.body.appendChild(frame);
          setTimeout(() => done(false), 15000);
        }),
    );
    if (!loaded) throw new Error('same-origin iframe did not load — framing is blocked');
  });

  await check('web: notes route loads its collab editor (live WS allowed)', async () => {
    await web.goto(`${WEB}/notes`, { waitUntil: 'domcontentloaded' });
    // Whatever the note state, a blocked ws: connection shows up as a
    // connect-src violation, which the silence check below will catch.
    await web.waitForTimeout(4000);
    const wsViolations = violations.filter(
      (v) => v.label === 'web' && v.directive === 'connect-src',
    );
    if (wsViolations.length) {
      throw new Error(`connect-src blocked: ${wsViolations.map((v) => v.blocked).join(', ')}`);
    }
  });

  // Asserted before the probes below, so it measures only real use. Anything
  // here is the policy blocking the product's own code.
  await check('web: zero CSP violations across the whole session', async () => {
    const seen = violationsFor('web');
    if (seen.length) throw new Error(`${seen.length} violation(s): ${seen.join(' | ')}`);
  });

  // ── the teeth ──────────────────────────────────────────────────────────────
  // An attacker-controlled inline <script> is what a stored XSS in a Tiptap
  // document or an issue description amounts to; the policy must refuse to run
  // it even though it is in the page's own DOM. These two DO raise violations
  // on purpose, which is why they run after the silence check above.
  await check('web: an injected inline <script> is BLOCKED', async () => {
    const executed = await web.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__xss = true;';
      document.body.appendChild(s);
      return window.__xss === true;
    });
    if (executed) throw new Error('inline script executed — the CSP is not enforcing');
  });

  await check('web: an injected off-origin <script src> is BLOCKED', async () => {
    const loaded = await web.evaluate(
      () =>
        new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://example.com/evil.js';
          s.onload = () => resolve(true);
          s.onerror = () => resolve(false);
          document.body.appendChild(s);
          setTimeout(() => resolve(false), 3000);
        }),
    );
    if (loaded) throw new Error('off-origin script loaded');
  });

  // ── admin ──────────────────────────────────────────────────────────────────
  // Logins are throttled at 5/min/IP; space this one out from web's.
  await sleep(LOGIN_BACKOFF_MS);

  const adminCtx = await browser.newContext();
  const admin = await watchCsp(await adminCtx.newPage(), 'admin');

  await check('admin: serves a nonce-based Content-Security-Policy', async () => {
    // networkidle, not domcontentloaded: clicking before React hydrates is a
    // silent no-op (same reason as browser-smoke.e2e.mjs).
    const res = await admin.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
    const csp = parseCsp((await res.allHeaders())['content-security-policy']);
    const scriptSrc = csp['script-src'] ?? [];
    if (!scriptSrc.some((v) => v.startsWith("'nonce-"))) {
      throw new Error(`script-src has no nonce: ${scriptSrc.join(' ')}`);
    }
    if (scriptSrc.includes("'unsafe-inline'")) throw new Error("script-src has 'unsafe-inline'");
    if ((csp['frame-ancestors'] ?? []).join(' ') !== "'none'") {
      throw new Error('frame-ancestors is not none');
    }
  });

  await check('admin: every <script> carries the nonce', async () => {
    const bad = await admin.evaluate(() =>
      [...document.querySelectorAll('script')]
        .filter((s) => !s.nonce && !s.getAttribute('nonce'))
        .map((s) => s.src || `inline:${s.textContent.slice(0, 40)}`),
    );
    if (bad.length) throw new Error(`${bad.length} script(s) without nonce: ${bad[0]}`);
  });

  await check('admin: instance admin logs in and God Mode renders under CSP', async () => {
    // apps/admin/src/app/login/page.tsx (AuthField/PasswordField placeholders)
    await admin.fill('input[placeholder="you@company.com"]', ADMIN_EMAIL);
    await admin.fill('input[placeholder="••••••••"]', ADMIN_PASSWORD);
    await admin.click('button[type="submit"]:has-text("Sign in")');
    await admin.waitForURL(/\/god-mode\/general/, { timeout: TIMEOUT });
    await expectVisible(admin.locator('h1:has-text("General")'), 'General page header');
    await expectVisible(
      admin.locator('nav a:has-text("Authentication")'),
      'Authentication nav link',
    );
  });

  await check('admin: theme boot script ran', async () => {
    const theme = await admin.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (!theme) throw new Error('data-theme not set — the inline theme script was blocked');
  });

  await check('admin: zero CSP violations across the whole session', async () => {
    const seen = violationsFor('admin');
    if (seen.length) throw new Error(`${seen.length} violation(s): ${seen.join(' | ')}`);
  });

  // Teeth, after the silence check — see the web probes above.
  await check('admin: an injected inline <script> is BLOCKED', async () => {
    const executed = await admin.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__xss = true;';
      document.body.appendChild(s);
      return window.__xss === true;
    });
    if (executed) throw new Error('inline script executed — the CSP is not enforcing');
  });

  // ── space ──────────────────────────────────────────────────────────────────
  // Space had a *static* `script-src 'self'` in next.config.mjs and no nonce, so
  // the App Router's own inline RSC scripts were blocked and the Space never
  // hydrated. It server-renders either way, which is why nothing caught it —
  // these checks are the ones that would have.
  const spaceCtx = await browser.newContext();
  const space = await watchCsp(await spaceCtx.newPage(), 'space');

  await check('space: serves a nonce-based Content-Security-Policy', async () => {
    const res = await space.goto(SPACE, { waitUntil: 'domcontentloaded' });
    const csp = parseCsp((await res.allHeaders())['content-security-policy']);
    const scriptSrc = csp['script-src'] ?? [];
    if (!scriptSrc.length) throw new Error('no script-src directive');
    if (!scriptSrc.some((v) => v.startsWith("'nonce-"))) {
      throw new Error(`script-src has no nonce: ${scriptSrc.join(' ')}`);
    }
    if (scriptSrc.includes("'unsafe-inline'")) throw new Error("script-src has 'unsafe-inline'");
  });

  await check('space: exactly one CSP header (no static/middleware double-send)', async () => {
    // Two policies are both enforced, as their intersection — a config-level
    // header left behind would silently re-break what the nonce just fixed.
    const res = await space.goto(SPACE, { waitUntil: 'domcontentloaded' });
    const raw = (await res.headersArray()).filter(
      (h) => h.name.toLowerCase() === 'content-security-policy',
    );
    if (raw.length !== 1) throw new Error(`${raw.length} CSP headers on the response`);
  });

  await check('space: every <script> carries the nonce (hydration is not blocked)', async () => {
    const bad = await space.evaluate(() =>
      [...document.querySelectorAll('script')]
        .filter((s) => !s.nonce && !s.getAttribute('nonce'))
        .map((s) => s.src || `inline:${s.textContent.slice(0, 40)}`),
    );
    if (bad.length) throw new Error(`${bad.length} script(s) without nonce: ${bad[0]}`);
  });

  await check('space: zero CSP violations rendering a public page', async () => {
    const seen = violationsFor('space');
    if (seen.length) throw new Error(`${seen.length} violation(s): ${seen.join(' | ')}`);
  });

  await check('space: an injected inline <script> is BLOCKED', async () => {
    const executed = await space.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__xss = true;';
      document.body.appendChild(s);
      return window.__xss === true;
    });
    if (executed) throw new Error('inline script executed — the CSP is not enforcing');
  });

  await check('no nonce hydration warnings in any app', async () => {
    if (nonceWarnings.length) {
      throw new Error(`${nonceWarnings.length} warning(s): ${nonceWarnings[0]}`);
    }
  });

  await browser.close();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (violations.length) {
    // Includes the deliberate probes at the end of each app's run — those are
    // the policy working. Only violations reported by a failing silence check
    // above indicate a problem.
    console.log('\n  Violations observed (incl. deliberate XSS probes):');
    for (const v of violations) {
      console.log(`    [${v.label}] ${v.directive} ← ${v.blocked || v.sample} ${v.source}`);
    }
  }
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
