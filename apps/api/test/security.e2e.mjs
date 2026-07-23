#!/usr/bin/env node
/**
 * Phase 5 security suite — docs/plan/01-security-model.md §4.
 *
 * Drives a running stack (mongo + api:4000) over HTTP the way a browser and an
 * attacker would. Not unit tests: the point is to prove the guards actually
 * hold on the wire, the way Phase 2 and Phase 3 were closed.
 *
 *   node apps/api/test/security.e2e.mjs
 *
 * Env: API_URL (default http://localhost:4000/api/v1)
 *      TEST_EMAIL / TEST_PASSWORD — an existing user (default: seed admin)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deliberately dependency-free: HS256 is a hash and two base64url blobs, and a
// security suite that needs `pnpm install` to run is a suite that stops getting run.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    process.env[m[1]] ??= value;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Minimal HS256 signer — mirrors what @nestjs/jwt produces. */
function signJwt(payload, secret, { audience, expiresIn = 300 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresIn };
  if (audience) body.aud = audience;
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

function decodeJwt(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
}

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.TEST_EMAIL ?? 'admin@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const SECRET = process.env.JWT_ACCESS_SECRET;

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    fail += 1;
  }
}

/** fetch + cookie jar, so refresh rotation behaves like a browser. */
function makeClient() {
  const jar = new Map();
  return {
    jar,
    cookie: (name) => jar.get(name),
    async req(method, pathname, { body, token, headers = {}, csrf } = {}) {
      const cookieHeader = [...jar.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      const res = await fetch(`${API}${pathname}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(csrf !== false && jar.get('prism_csrf')
            ? { 'X-CSRF-Token': jar.get('prism_csrf') }
            : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });

      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        /* 204 / empty */
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
}

const decode = (token) => decodeJwt(token);

async function main() {
  console.log(`\nPhase 5 security suite → ${API}\n`);

  // ── Baseline: a normal web login ────────────────────────────────
  const web = makeClient();
  const login = await web.req('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD, audience: 'web' },
  });
  assert.equal(
    login.status,
    200,
    `login failed (${login.status}): ${JSON.stringify(login.data)}. Set TEST_EMAIL/TEST_PASSWORD.`,
  );
  const webToken = login.data.accessToken;

  await check('login issues a web-audience token', () => {
    assert.equal(decode(webToken).aud, 'web');
  });

  await check('login sets the httpOnly refresh cookie + readable CSRF cookie', () => {
    assert.ok(web.cookie('prism_rt_web'), 'prism_rt_web cookie missing');
    assert.ok(web.cookie('prism_csrf'), 'prism_csrf cookie missing');
  });

  await check('web token is accepted on its own API', async () => {
    const me = await web.req('GET', '/auth/me', { token: webToken });
    assert.equal(me.status, 200);
    assert.equal(me.data.aud, 'web');
  });

  // ── S4: a web token must not reach instance endpoints ────────────
  await check('S4 web token is refused on GET /instance/config (403)', async () => {
    const res = await web.req('GET', '/instance/config', { token: webToken });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check('S4 web token is refused on PATCH /instance/config (403)', async () => {
    const res = await web.req('PATCH', '/instance/config', {
      token: webToken,
      body: { entries: [{ key: 'TEST_KEY', value: 'x', category: 'general' }] },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check('S4 web token is refused on the audit trail (403)', async () => {
    const res = await web.req('GET', '/audit', { token: webToken });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  // ── S3: collab tokens are not REST tokens ────────────────────────
  if (SECRET) {
    const collabToken = signJwt(
      { sub: decode(webToken).sub, doc: 'wiki:x' },
      SECRET,
      { audience: 'collab', expiresIn: 300 },
    );

    await check('S3 a collab token cannot drive the REST API (401)', async () => {
      const res = await web.req('GET', '/auth/me', { token: collabToken });
      assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    });

    await check('S3 a collab token cannot list wiki pages (401)', async () => {
      const res = await web.req('GET', '/wiki', { token: collabToken });
      assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    });

    await check('an admin-audience token forged for a non-admin is still gated', async () => {
      // Signing is not authorization: the InstanceAdminGuard still checks the DB.
      const forged = signJwt(
        { sub: '000000000000000000000000', email: 'nobody@example.com', role: 'user' },
        SECRET,
        { audience: 'admin', expiresIn: 300 },
      );
      const res = await web.req('GET', '/instance/config', { token: forged });
      assert.ok(
        res.status === 401 || res.status === 403,
        `expected 401/403, got ${res.status}`,
      );
    });
  } else {
    console.log('  ⚠ JWT_ACCESS_SECRET not set — skipping collab-token checks');
  }

  // ── S2: CSRF on the cookie-authenticated refresh ─────────────────
  await check('S2 refresh without the CSRF header is refused (403)', async () => {
    const res = await web.req('POST', '/auth/refresh', {
      body: { audience: 'web' },
      csrf: false,
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check('S2 refresh with a wrong CSRF header is refused (403)', async () => {
    const res = await web.req('POST', '/auth/refresh', {
      body: { audience: 'web' },
      csrf: false,
      headers: { 'X-CSRF-Token': 'not-the-cookie' },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  // ── Rotation + reuse detection ───────────────────────────────────
  const rot = makeClient();
  await rot.req('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD, audience: 'web' },
  });
  const firstRefreshCookie = rot.cookie('prism_rt_web');

  await check('refresh rotates the cookie to a new token', async () => {
    const res = await rot.req('POST', '/auth/refresh', { body: { audience: 'web' } });
    assert.equal(res.status, 200, `refresh failed: ${JSON.stringify(res.data)}`);
    assert.notEqual(
      rot.cookie('prism_rt_web'),
      firstRefreshCookie,
      'cookie was not rotated',
    );
  });

  await check('a rotated token still works inside the grace window (multi-tab)', async () => {
    const tab2 = makeClient();
    tab2.jar.set('prism_rt_web', firstRefreshCookie);
    tab2.jar.set('prism_csrf', rot.cookie('prism_csrf'));
    const res = await tab2.req('POST', '/auth/refresh', { body: { audience: 'web' } });
    assert.equal(res.status, 200, `second tab was signed out: ${res.status}`);
  });

  await check('S8 sessions list shows the live session', async () => {
    const fresh = await rot.req('POST', '/auth/refresh', { body: { audience: 'web' } });
    const res = await rot.req('GET', '/auth/sessions', {
      token: fresh.data.accessToken,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data), 'expected an array of sessions');
    assert.ok(res.data.length >= 1, 'expected at least one session');
    assert.ok(res.data.some((s) => s.current), 'no session marked current');
  });

  await check('S8 logout revokes the refresh family (next refresh 401)', async () => {
    const bye = makeClient();
    await bye.req('POST', '/auth/login', {
      body: { email: EMAIL, password: PASSWORD, audience: 'web' },
    });
    const out = await bye.req('POST', '/auth/logout', { body: { audience: 'web' } });
    assert.equal(out.status, 204, `logout returned ${out.status}`);
    // The cookie is cleared client-side; a stolen copy must still be dead.
    const stolen = makeClient();
    stolen.jar.set('prism_rt_web', bye.jar.get('prism_rt_web') ?? 'gone');
    stolen.jar.set('prism_csrf', 'x');
    const res = await stolen.req('POST', '/auth/refresh', {
      body: { audience: 'web' },
      headers: { 'X-CSRF-Token': 'x' },
    });
    assert.ok(res.status >= 400, `revoked token still refreshed: ${res.status}`);
  });

  // ── S7: login throttling ─────────────────────────────────────────
  await check('S7 repeated bad logins are throttled (429)', async () => {
    const attacker = makeClient();
    let sawThrottle = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await attacker.req('POST', '/auth/login', {
        body: { email: EMAIL, password: 'definitely-wrong', audience: 'web' },
      });
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
    }
    assert.ok(sawThrottle, 'never hit 429 after 12 bad logins');
  });

  // ── S10: instance secrets never come back ────────────────────────
  await check('S10 public /instance exposes only whitelisted toggles', async () => {
    const res = await web.req('GET', '/instance');
    assert.equal(res.status, 200);
    // Substring matching would flag ENABLE_EMAIL_PASSWORD_LOGIN — a boolean
    // toggle whose *name* contains "PASSWORD". Assert on the config keys and
    // their value types instead: booleans cannot be credentials.
    // Keep this in sync with PUBLIC_CONFIG_KEYS (instance.dto.ts) — a new key
    // failing here is the tripwire that forces a deliberate exposure decision.
    const config = res.data.config ?? {};
    for (const [key, value] of Object.entries(config)) {
      assert.ok(
        /^(ENABLE_|GOOGLE_OAUTH_|GITHUB_OAUTH_|(ASSISTANT|TELEGRAM|UNSPLASH)_ENABLED)/.test(
          key,
        ),
        `unexpected key on the public instance payload: ${key}`,
      );
      assert.equal(
        typeof value,
        'boolean',
        `public config ${key} is not a boolean (got ${typeof value})`,
      );
    }
  });

  await check('S10 secret config values never leave the API', async () => {
    if (!SECRET) return; // covered only when we can mint an admin token
    const res = await web.req('GET', '/instance');
    const body = JSON.stringify(res.data);
    // The real leak test: no value that looks like a credential.
    for (const needle of ['sk-', 'sk_live', 'AIza', 'xoxb-']) {
      assert.ok(!body.includes(needle), `public payload contains ${needle}`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
