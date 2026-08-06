/**
 * Runs every E2E suite in sequence against an already-running dev stack
 * (`pnpm dev` + seeded test fixtures — see test-seed.ts).
 *
 * Why not plain `&&`-chaining: login is throttled 5/min/IP (Phase 5, S7) and
 * the security suite deliberately exhausts that budget proving the 429, so
 * back-to-back suites starve each other. A cool-down between suites lets the
 * throttle window reset. Zero dependencies on purpose — like the suites
 * themselves, this must run with nothing installed beyond node + pnpm.
 *
 * Two suites bring their own server rather than using the dev stack:
 *  - notes-collab demands a disposable api on :4012 (never the dev instance),
 *    so this runner boots `node dist/main` with PORT=4012 for it and kills it
 *    after. The dev api's tsc watch keeps dist/ current.
 *  - live's test:limits boots its own live server on :3111 with tiny caps —
 *    it does that itself, so the runner just needs to invoke it in the `live`
 *    workspace instead of `api` (see `filter` on the suite list).
 *
 * Env: E2E_COOLDOWN_MS to override the gap (0 disables, e.g. against an API
 * started with throttling relaxed).
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'apps', 'api');

/**
 * `filter` is the pnpm workspace the script lives in — `api` unless stated.
 *
 * Everything here must be headless and need nothing beyond the dev api plus the
 * E2E fixture. The three browser suites (`web: test:browser-smoke`, `test:csp`,
 * `test:project-tabs`) are deliberately NOT in this list: they need web/admin/
 * space serving as well as Playwright, so folding them in would turn a failure
 * to start a frontend into a failed API run. Run those separately.
 */
const SUITES = [
  { script: 'test:security' },
  { script: 'test:phase7' },
  { script: 'test:phase8' },
  { script: 'test:templates-import' },
  { script: 'test:analytics' },
  { script: 'test:notes-collab', isolatedApiPort: 4012 },
  { script: 'test:oauth' },
  { script: 'test:cross-app' },
  { script: 'test:publish-space' },
  { script: 'test:cycles-modules' },
  // In-process (ts-node + a Nest application context), so it needs no dev API
  // and costs no login — the assistant's tool rules have no HTTP surface to
  // drive on purpose. See the file header.
  { script: 'test:assistant-tools' },
  // Boots its own live server on :3111 with tiny caps; never touches :3100.
  // Needs the dev api for real collab tokens, so it belongs in this chain.
  { script: 'test:limits', filter: 'live' },
];

const COOLDOWN_MS = process.env.E2E_COOLDOWN_MS
  ? Number(process.env.E2E_COOLDOWN_MS)
  : 65_000;

// Pin the suites to 127.0.0.1: `localhost` lets Node's fetch race ::1 vs
// IPv4 (happy eyeballs) and under load that intermittently surfaces as
// "fetch failed" mid-suite. Explicit env still wins.
const SUITE_ENV = {
  API_URL: process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1',
  WEB_URL: process.env.WEB_URL ?? 'http://127.0.0.1:3000',
  ADMIN_URL: process.env.ADMIN_URL ?? 'http://127.0.0.1:3001/god-mode',
  SPACE_URL: process.env.SPACE_URL ?? 'http://127.0.0.1:3002/spaces',
  LIVE_URL: process.env.LIVE_URL ?? 'http://127.0.0.1:3100',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, timeoutMs = 30_000, label = 'isolated api') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(1_000);
  }
  throw new Error(`${label} on :${port} never became healthy`);
}

async function withIsolatedApi(port, fn) {
  console.log(`\n— booting isolated api on :${port} (node dist/main) —`);
  const child = spawn(process.execPath, ['dist/main'], {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(port);
    return await fn();
  } finally {
    child.kill();
  }
}

function runSuite(script, extraEnv = {}, filter = 'api') {
  const res = spawnSync('pnpm', ['--filter', filter, script], {
    stdio: 'inherit',
    shell: true, // pnpm is a .cmd shim on Windows
    env: { ...process.env, ...SUITE_ENV, ...extraEnv },
  });
  return res.status === 0;
}

let failed = null;
for (const [i, suite] of SUITES.entries()) {
  if (i > 0 && COOLDOWN_MS > 0) {
    console.log(`\n— cooling down ${COOLDOWN_MS / 1000}s (login throttle) —\n`);
    await sleep(COOLDOWN_MS);
  }
  // A suite starting against a hiccuping api wastes a whole run — gate on
  // health before each one instead of failing on the first fetch.
  await waitForHealth(4000, 30_000, 'dev api');
  console.log(`\n═══ ${suite.script} (${i + 1}/${SUITES.length}) ═══\n`);
  const ok = suite.isolatedApiPort
    ? await withIsolatedApi(suite.isolatedApiPort, () =>
        // The isolated suite must never touch the dev api (its header says so):
        // point API_URL at the disposable instance, keeping the 127.0.0.1 pin.
        runSuite(
          suite.script,
          { API_URL: `http://127.0.0.1:${suite.isolatedApiPort}/api/v1` },
          suite.filter,
        ),
      )
    : runSuite(suite.script, {}, suite.filter);
  if (!ok) {
    failed = suite.script;
    break;
  }
}

if (failed) {
  console.error(`\n✗ ${failed} failed — aborting the chain.`);
  process.exit(1);
}
console.log(`\n✓ all ${SUITES.length} suites passed.`);
