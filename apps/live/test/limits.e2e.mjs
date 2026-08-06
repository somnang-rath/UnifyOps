#!/usr/bin/env node
/**
 * apps/live abuse limits — docs/plan/01-security-model.md §3.3.
 *
 * Boots its OWN live server on :3111 with deliberately tiny limits, so the
 * caps can be tripped in seconds instead of by opening 500 sockets. Never
 * touches the :3100 dev instance. Needs a running dev api on :4000 with the
 * E2E fixture (test-seed.ts) for real collab tokens.
 *
 *   node apps/live/test/limits.e2e.mjs
 *   # or: pnpm --filter live test:limits
 *
 * What is actually being proven, and why each needs a live server rather than
 * a unit test:
 *
 *   1. GLOBAL CAP   — refused at HTTP upgrade, before Hocuspocus allocates
 *                     anything. Exercised with raw sockets because the point
 *                     is that it holds against clients that never authenticate.
 *   2. maxPayload   — enforced by `ws` itself: an oversized frame closes the
 *                     socket with 1009 rather than being buffered. Only
 *                     observable at the protocol level.
 *   3. PER-DOC CAP  — counts *established* connections, so it needs genuinely
 *                     authenticated clients and real collab tokens. This is the
 *                     limit that stops one authenticated user pinning a
 *                     document's memory from a script.
 *
 * Env: API_URL  (default http://127.0.0.1:4000/api/v1)
 *      LIVE_TEST_PORT (default 3111)
 *      TEST_EMAIL / TEST_PASSWORD (alice@test.com / test1234)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = path.join(__dirname, '..');
const ROOT = path.join(LIVE_DIR, '..', '..');

// Resolve ws + the hocuspocus provider out of the workspace (provider lives in
// packages/editor, not here — this is a test, not a live dependency).
const require = createRequire(path.join(LIVE_DIR, 'package.json'));
const WebSocket = require('ws');
const providerRequire = createRequire(path.join(ROOT, 'packages', 'editor', 'package.json'));
const { HocuspocusProvider } = providerRequire('@hocuspocus/provider');
const Y = providerRequire('yjs');

/*
 * Deliberately no .env loading here. The spawned server runs with cwd=apps/live
 * and does `import 'dotenv/config'` itself, so it picks up apps/live/.env (its
 * secrets, INTERNAL_API_URL, …) exactly as `pnpm dev:live` would. Loading the
 * repo's .env files into *this* process instead imports the Docker values —
 * API_URL=http://api:4000 — and the suite then tries to resolve a compose
 * hostname that does not exist outside the network.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const PORT = Number(process.env.LIVE_TEST_PORT ?? 3111);
const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const ORIGIN = 'http://localhost:3000';

// Small enough to trip quickly, large enough that nothing trips by accident.
const MAX_CONNECTIONS = 4;
const MAX_PER_DOC = 2;
const MAX_PAYLOAD = 64 * 1024;

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

async function api(method, pathname, { body, token } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Raw upgrade attempt. Resolves the HTTP status when the server refuses it. */
function rawConnect(documentName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/${documentName}`, {
      headers: { origin: ORIGIN },
    });
    const done = (result) => {
      ws.removeAllListeners();
      resolve({ ...result, ws });
    };
    ws.on('open', () => done({ ok: true }));
    ws.on('unexpected-response', (_req, res) => done({ ok: false, status: res.statusCode }));
    ws.on('error', (err) => {
      // A 503 arrives as unexpected-response; a hard socket error is a failure.
      if (!/unexpected server response/i.test(String(err.message))) reject(err);
    });
    setTimeout(() => reject(new Error('upgrade timed out')), 10_000);
  });
}

/**
 * Start a live server on PORT with the tiny limits above.
 *
 * Runs the compiled `dist/index.js` rather than the TS source — same choice as
 * scripts/e2e-full.mjs makes for the disposable api, and it keeps the suite
 * free of a tsx resolution dance. Builds first if dist is stale/absent.
 */
function startLive() {
  const entry = path.join(LIVE_DIR, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    console.log('  (building apps/live — dist/ not present)');
    const built = spawnSync('pnpm', ['--filter', 'live', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (built.status !== 0) throw new Error('pnpm --filter live build failed');
  }

  const child = spawn(
    process.execPath,
    [entry],
    {
      cwd: LIVE_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        LIVE_PORT: String(PORT),
        LIVE_MAX_CONNECTIONS: String(MAX_CONNECTIONS),
        LIVE_MAX_CONNECTIONS_PER_DOC: String(MAX_PER_DOC),
        LIVE_MAX_PAYLOAD_BYTES: String(MAX_PAYLOAD),
        LIVE_ALLOWED_ORIGINS: ORIGIN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  return { child, log };
}

/** Poll /health until the disposable server answers. */
async function waitForLive(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health' }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`live server did not become healthy on :${PORT}`);
}

async function run() {
  console.log(`\napps/live limits suite → :${PORT} (api ${API})\n`);
  console.log(
    `  limits under test: ${MAX_CONNECTIONS} conns · ${MAX_PER_DOC}/doc · ${MAX_PAYLOAD}B payload\n`,
  );

  const { child, log } = startLive();
  const open = [];
  let noteId = null;
  let token = null;

  try {
    await waitForLive().catch((err) => {
      throw new Error(`${err.message}\n${log.join('')}`);
    });

    // ── fixture: a real note + a real collab token ─────────────────────────
    const login = await api('POST', '/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
    });
    assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.data)}`);
    token = login.data.accessToken;

    const note = await api('POST', '/notes', {
      token,
      body: { title: `live-limits ${Date.now()}`, blocks: [] },
    });
    assert.equal(note.status, 201, `note create failed: ${JSON.stringify(note.data)}`);
    noteId = note.data.id ?? note.data._id;

    const minted = await api('POST', `/notes/${noteId}/collab-token`, { token });
    assert.equal(minted.status, 200, `collab-token failed: ${JSON.stringify(minted.data)}`);
    const collabToken = minted.data.token;
    const docName = `notes:${noteId}`;

    // ── 1. maxPayload ─────────────────────────────────────────────────────
    await check(`oversized frame (>${MAX_PAYLOAD}B) closes the socket with 1009`, async () => {
      const first = await rawConnect(docName);
      assert.equal(first.ok, true, 'could not open a socket');
      const code = await new Promise((resolve) => {
        first.ws.on('close', (c) => resolve(c));
        first.ws.send(Buffer.alloc(MAX_PAYLOAD + 1024, 1));
        setTimeout(() => resolve(0), 5000);
      });
      assert.equal(code, 1009, `expected close 1009 (message too big), got ${code}`);
    });

    // Regression: `ws` emits 'error' on the oversized frame, and Hocuspocus
    // attaches no 'error' listener — an unhandled 'error' event in Node is a
    // throw, so before index.ts handled it, one oversized frame from any
    // client killed the server for everyone. The limit must refuse the frame,
    // not the process.
    await check('the server SURVIVES an oversized frame', async () => {
      await sleep(500);
      const res = await new Promise((resolve) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/health' }, (x) => {
          x.resume();
          resolve(x.statusCode);
        });
        r.on('error', () => resolve(0));
      });
      assert.equal(res, 200, 'live server died on an oversized frame');
    });

    await check(`a frame under the limit is NOT closed`, async () => {
      const c = await rawConnect(docName);
      open.push(c.ws);
      const code = await new Promise((resolve) => {
        c.ws.on('close', (x) => resolve(x));
        c.ws.send(Buffer.alloc(1024, 1));
        setTimeout(() => resolve(0), 1500);
      });
      assert.equal(code, 0, `socket was closed with ${code} for an in-limit frame`);
    });

    // ── 2. global connection cap ───────────────────────────────────────────
    await check(`upgrade #${MAX_CONNECTIONS + 1} is refused with 503`, async () => {
      // One socket is already held open by the previous check.
      while (open.length < MAX_CONNECTIONS) {
        const c = await rawConnect(docName);
        assert.equal(c.ok, true, `socket ${open.length + 1} should have been accepted`);
        open.push(c.ws);
      }
      const over = await rawConnect(docName);
      assert.equal(over.ok, false, 'server accepted a connection past its cap');
      assert.equal(over.status, 503, `expected 503, got ${over.status}`);
    });

    await check('capacity is released when sockets close', async () => {
      const victim = open.pop();
      await new Promise((resolve) => {
        victim.on('close', resolve);
        victim.close();
      });
      await sleep(500);
      const again = await rawConnect(docName);
      assert.equal(again.ok, true, 'server stayed at capacity after a socket closed');
      open.push(again.ws);
    });

    // Free everything before the per-doc test needs slots.
    for (const ws of open.splice(0)) ws.close();
    await sleep(500);

    // ── 3. per-document cap (authenticated) ───────────────────────────────
    const providers = [];
    const connectProvider = () =>
      new Promise((resolve) => {
        const provider = new HocuspocusProvider({
          url: `ws://127.0.0.1:${PORT}`,
          name: docName,
          token: collabToken,
          document: new Y.Doc(),
          WebSocketPolyfill: WebSocket,
          preserveConnection: false,
          // Never let the client paper over a refusal by silently retrying.
          onClose: () => resolve({ established: false }),
          onSynced: () => resolve({ established: true }),
          onAuthenticationFailed: () => resolve({ established: false }),
        });
        providers.push(provider);
        setTimeout(() => resolve({ established: false, timedOut: true }), 15_000);
      });

    await check(`${MAX_PER_DOC} authenticated connections on one doc are accepted`, async () => {
      for (let i = 0; i < MAX_PER_DOC; i += 1) {
        const r = await connectProvider();
        assert.equal(r.established, true, `connection ${i + 1} was refused`);
      }
    });

    await check(`authenticated connection #${MAX_PER_DOC + 1} on the same doc is refused`, async () => {
      const r = await connectProvider();
      assert.equal(r.established, false, 'server accepted a connection past the per-doc cap');
      // Prove it was the cap, not an auth failure or a coincidence.
      const refusal = log.join('').includes('at per-document limit');
      assert.equal(refusal, true, 'no per-document limit refusal in the server log');
    });

    for (const p of providers) {
      try {
        p.destroy();
      } catch {
        /* already gone */
      }
    }
  } finally {
    for (const ws of open) {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    }
    if (noteId && token) {
      await api('DELETE', `/notes/${noteId}`, { token }).catch(() => {});
    }
    child.kill();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) console.log(`\n--- live server log ---\n${log.join('')}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
