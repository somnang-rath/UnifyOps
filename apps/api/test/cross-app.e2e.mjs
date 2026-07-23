#!/usr/bin/env node
/**
 * Phase 4 cross-app suite — the seams BETWEEN the five apps.
 *
 * Everything here is a boundary no single-app suite covers: the CORS allowlist
 * the three browsers depend on, the per-audience cookie split that keeps a web
 * session out of God Mode, the instance-admin mutations behind step-up, and a
 * full publish round-trip (api → space SSR) plus liveness of every app.
 * Drives a running stack (mongo + api:4000 + web:3000 + admin:3001 +
 * space:3002 + live:3100) over HTTP, the way Phases 2/3/5 were closed.
 *
 *   node apps/api/test/cross-app.e2e.mjs
 *
 * Deliberately dependency-free (plain fetch): a suite that needs `pnpm install`
 * to run is a suite that stops getting run.
 *
 * Env: API_URL    (default http://localhost:4000/api/v1)
 *      WEB_URL    (default http://localhost:3000)
 *      ADMIN_URL  (default http://localhost:3001/god-mode)
 *      SPACE_URL  (default http://localhost:3002/spaces)
 *      LIVE_URL   (default http://localhost:3100)
 *      TEST_EMAIL / TEST_PASSWORD   — a seeded NON-instance-admin user
 *                                     (default alice@test.com / test1234)
 *      ADMIN_EMAIL / ADMIN_PASSWORD — a seeded INSTANCE admin
 *                                     (default admin@test.com / test1234,
 *                                      the only instance admin in test-seed.ts)
 *
 * Known-red note: the sign-up checks assert ADR 0008 §5 (the instance
 * ENABLE_SIGNUP row is the effective switch). Today /auth/register
 * (auth.controller.ts) gates on env ALLOW_PUBLIC_REGISTER only, so exactly one
 * of the two register checks fails until the controller is wired through
 * InstanceService.isSignupEnabled(). That failure is the suite doing its job.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// apps/api/.env may define API_URL as the bare host (the OAuth redirect base,
// env.config.ts) — normalize so both forms work here.
const rawApi = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const API = rawApi.endsWith('/api/v1')
  ? rawApi
  : `${rawApi.replace(/\/$/, '')}/api/v1`;
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001/god-mode';
const SPACE = process.env.SPACE_URL ?? 'http://localhost:3002/spaces';
const LIVE = process.env.LIVE_URL ?? 'http://localhost:3100';

const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@test.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'test1234';

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

function decodeJwt(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
}

/** fetch + cookie jar; also keeps the raw Set-Cookie list of the last response. */
function makeClient() {
  const jar = new Map();
  return {
    jar,
    lastSetCookies: [],
    cookie(name) {
      return jar.get(name);
    },
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

      this.lastSetCookies = res.headers.getSetCookie?.() ?? [];
      for (const raw of this.lastSetCookies) {
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

/**
 * Login with a retry on 429: /auth/login is throttled to 5/min per IP, and this
 * suite runs last in the test:e2e:full chain — the security suite deliberately
 * exhausts that budget minutes earlier.
 */
async function login(client, email, password, audience) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await client.req('POST', '/auth/login', {
      body: { email, password, audience },
    });
    if (res.status !== 429) return res;
    console.log('    (login throttled, waiting 20s…)');
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return client.req('POST', '/auth/login', {
    body: { email, password, audience },
  });
}

const rand = () => crypto.randomBytes(6).toString('hex');

async function main() {
  console.log(`\nPhase 4 cross-app suite → ${API}\n`);

  // ── A. CORS: the allowlist every browser app depends on ─────────────
  console.log('A. CORS allowlist (WEB_ORIGIN: 3000/3001/3002)');

  const preflight = (origin) =>
    fetch(`${API}/instance`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

  await check('preflight echoes each allowed origin + credentials', async () => {
    for (const origin of [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ]) {
      const res = await preflight(origin);
      assert.equal(
        res.headers.get('access-control-allow-origin'),
        origin,
        `origin ${origin} not echoed (got ${res.headers.get('access-control-allow-origin')}) — check WEB_ORIGIN in apps/api/.env`,
      );
      assert.equal(
        res.headers.get('access-control-allow-credentials'),
        'true',
        `credentials not allowed for ${origin}`,
      );
    }
  });

  await check('a bogus origin gets no Access-Control-Allow-Origin', async () => {
    const res = await preflight('http://localhost:5000');
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      null,
      'http://localhost:5000 was allowed',
    );
  });

  // ── B. Audience separation: one cookie host, two sessions ───────────
  console.log('\nB. JWT/cookie audience separation');

  const web = makeClient();
  const webLogin = await login(web, EMAIL, PASSWORD, 'web');
  assert.equal(
    webLogin.status,
    200,
    `web login failed (${webLogin.status}): ${JSON.stringify(webLogin.data)}. Set TEST_EMAIL/TEST_PASSWORD (seed: alice@test.com/test1234).`,
  );
  const webToken = webLogin.data.accessToken;

  await check('web login sets prism_rt_web (httpOnly, path /api/v1/auth)', () => {
    const raw = web.lastSetCookies.find((c) => c.startsWith('prism_rt_web='));
    assert.ok(raw, `prism_rt_web missing (got: ${web.lastSetCookies.map((c) => c.split('=')[0]).join(', ')})`);
    assert.ok(/httponly/i.test(raw), 'not httpOnly');
    assert.ok(raw.includes('Path=/api/v1/auth'), 'not path-scoped to /api/v1/auth');
    assert.ok(!web.lastSetCookies.some((c) => c.startsWith('prism_rt_admin=')), 'web login also set the admin cookie');
    assert.equal(decodeJwt(webToken).aud, 'web');
  });

  const admin = makeClient();
  const adminLogin = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD, 'admin');

  await check('instance-admin login (audience admin) sets prism_rt_admin', () => {
    assert.equal(
      adminLogin.status,
      200,
      `admin login failed (${adminLogin.status}): ${JSON.stringify(adminLogin.data)}. Set ADMIN_EMAIL/ADMIN_PASSWORD (seed instance admin: admin@test.com/test1234).`,
    );
    const raw = admin.lastSetCookies.find((c) => c.startsWith('prism_rt_admin='));
    assert.ok(raw, 'prism_rt_admin cookie missing');
    assert.ok(raw.includes('Path=/api/v1/auth'), 'not path-scoped');
    assert.equal(decodeJwt(adminLogin.data.accessToken).aud, 'admin');
  });

  await check('a web-audience token drives the REST API (GET /projects)', async () => {
    const res = await web.req('GET', '/projects', { token: webToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data), 'expected an array of projects');
  });

  await check('a non-instance-admin cannot mint an admin-audience session (403)', async () => {
    const c = makeClient();
    const res = await login(c, EMAIL, PASSWORD, 'admin');
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  // ── C. Instance-admin flows (step-up + config round-trips) ──────────
  console.log('\nC. Instance-admin config (step-up mutations)');

  let adminToken = null;
  if (adminLogin.status === 200) {
    // Instance mutations demand a recent password re-entry on top of the admin
    // session (Phase 5). A password login already counts as one, but the admin
    // app's real flow is POST /auth/step-up — exercise that seam explicitly.
    const step = await admin.req('POST', '/auth/step-up', {
      token: adminLogin.data.accessToken,
      body: { password: ADMIN_PASSWORD },
    });
    await check('POST /auth/step-up returns a stepped-up admin token', () => {
      assert.equal(step.status, 200, `step-up failed: ${JSON.stringify(step.data)}`);
      const claims = decodeJwt(step.data.accessToken);
      assert.equal(claims.aud, 'admin');
      assert.ok(claims.stepUpAt, 'no stepUpAt claim on the stepped-up token');
    });
    adminToken = step.data?.accessToken ?? adminLogin.data.accessToken;
  } else {
    console.log('  ⚠ admin login failed — skipping the instance-admin section');
    fail += 1;
  }

  if (adminToken) {
    const getConfig = async () => {
      const res = await admin.req('GET', '/instance/config', { token: adminToken });
      assert.equal(res.status, 200, `GET /instance/config → ${res.status}`);
      return res.data; // [{ key, category, isEncrypted, value, isSet }]
    };
    const patchConfig = (entries) =>
      admin.req('PATCH', '/instance/config', { token: adminToken, body: { entries } });

    // Snapshot what we are about to touch so the finally block can restore it.
    // (Writing value: null puts a non-secret row back to "unset" — the
    // config-over-env resolvers treat null exactly like a missing row.)
    const before = await getConfig();
    const row = (list, key) => list.find((r) => r.key === key);
    const originalSignup = row(before, 'ENABLE_SIGNUP')?.value ?? null;
    const originalGoogle = row(before, 'GOOGLE_OAUTH_ENABLED')?.value ?? null;
    const googleCredsPresent =
      Boolean(row(before, 'GOOGLE_CLIENT_ID')?.isSet) &&
      Boolean(row(before, 'GOOGLE_CLIENT_SECRET')?.isSet);

    try {
      // — Sign-up toggle (ADR 0008 §5: config row is the effective switch) —
      await check('disable sign-up → /auth/register is refused (403)', async () => {
        const off = await patchConfig([
          { key: 'ENABLE_SIGNUP', value: 'false', category: 'auth' },
        ]);
        assert.equal(off.status, 200, `PATCH failed: ${JSON.stringify(off.data)}`);
        const pub = await admin.req('GET', '/instance');
        assert.equal(pub.data.config.ENABLE_SIGNUP, false, 'GET /instance still reports sign-up on');
        const reg = await admin.req('POST', '/auth/register', {
          body: {
            email: `e2e-cross-app-${rand()}@test.local`,
            password: 'e2e-password-1',
            name: 'Cross App E2E',
          },
        });
        assert.equal(
          reg.status,
          403,
          `expected 403, got ${reg.status} — /auth/register must consult the instance ENABLE_SIGNUP row (isSignupEnabled), not just env ALLOW_PUBLIC_REGISTER`,
        );
      });

      await check('re-enable sign-up → /auth/register is accepted', async () => {
        const on = await patchConfig([
          { key: 'ENABLE_SIGNUP', value: 'true', category: 'auth' },
        ]);
        assert.equal(on.status, 200);
        const pub = await admin.req('GET', '/instance');
        assert.equal(pub.data.config.ENABLE_SIGNUP, true, 'GET /instance still reports sign-up off');
        const c = makeClient(); // fresh jar: register sets web cookies
        const reg = await c.req('POST', '/auth/register', {
          body: {
            email: `e2e-cross-app-${rand()}@test.local`,
            password: 'e2e-password-1',
            name: 'Cross App E2E',
          },
        });
        assert.ok(
          reg.status === 200 || reg.status === 201,
          `expected 200/201, got ${reg.status} — /auth/register (auth.controller.ts) gates on env ALLOW_PUBLIC_REGISTER only and ignores the instance ENABLE_SIGNUP row; wire it through InstanceService.isSignupEnabled()`,
        );
        assert.ok(reg.data.accessToken, 'no access token issued to the new user');
      });

      // — SMTP secret masking (isSecretConfigKey decides, server-side) —
      const smtpWasSet = Boolean(row(before, 'SMTP_PASSWORD')?.isSet);
      const smtpSecret = `e2e-smtp-secret-${rand()}`;
      await check('an SMTP password comes back masked, never in plaintext', async () => {
        if (!smtpWasSet) {
          const res = await patchConfig([
            { key: 'SMTP_HOST', value: 'smtp.e2e.invalid', category: 'smtp' },
            { key: 'SMTP_PASSWORD', value: smtpSecret, category: 'smtp' },
          ]);
          assert.equal(res.status, 200, `PATCH failed: ${JSON.stringify(res.data)}`);
        }
        const after = await getConfig();
        const pw = row(after, 'SMTP_PASSWORD');
        assert.ok(pw, 'SMTP_PASSWORD row missing from read-back');
        assert.equal(pw.isEncrypted, true, 'not flagged secret');
        assert.equal(pw.value, null, `secret value returned: ${pw.value}`);
        assert.equal(pw.isSet, true, 'isSet should be true');
        assert.ok(
          !JSON.stringify(after).includes(smtpSecret),
          'the plaintext secret appears in GET /instance/config',
        );
      });

      await check('saving a blank secret leaves the stored value intact', async () => {
        // The admin UI shows masked fields as blank — re-saving the form must
        // not wipe the credential (instance.service.ts updateConfig).
        const res = await patchConfig([
          { key: 'SMTP_PASSWORD', value: '', category: 'smtp' },
        ]);
        assert.equal(res.status, 200);
        const pw = row(res.data, 'SMTP_PASSWORD');
        assert.equal(pw?.isSet, true, 'blank write cleared the stored secret');
      });

      // — OAuth toggle without credentials: persisted but never effective —
      if (googleCredsPresent) {
        console.log('  ⚠ Google OAuth credentials are configured on this instance — skipping the no-credentials toggle checks');
      } else {
        await check('google toggle on (no creds) persists, but GET /instance stays false', async () => {
          const res = await patchConfig([
            { key: 'GOOGLE_OAUTH_ENABLED', value: 'true', category: 'auth' },
          ]);
          assert.equal(res.status, 200);
          assert.equal(
            row(res.data, 'GOOGLE_OAUTH_ENABLED')?.value,
            'true',
            'toggle row not persisted',
          );
          const pub = await admin.req('GET', '/instance');
          assert.equal(
            pub.data.config.GOOGLE_OAUTH_ENABLED,
            false,
            'effective boolean is true without credentials (ADR 0008 §1)',
          );
        });

        await check('GET /auth/oauth/google still 404s with the toggle on', async () => {
          const res = await admin.req('GET', '/auth/oauth/google');
          assert.equal(res.status, 404, `expected 404, got ${res.status}`);
        });
      }

      // — The same mutations from a non-instance-admin —
      await check('a non-instance-admin gets 403 on PATCH /instance/config', async () => {
        const res = await web.req('PATCH', '/instance/config', {
          token: webToken,
          body: { entries: [{ key: 'ENABLE_SIGNUP', value: 'true', category: 'auth' }] },
        });
        assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      });

      await check('a non-instance-admin gets 403 on PATCH /instance', async () => {
        const res = await web.req('PATCH', '/instance', {
          token: webToken,
          body: { instanceName: 'Hacked' },
        });
        assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      });
    } finally {
      // ALWAYS restore the toggles — a half-failed run must not leave the
      // instance with sign-up off or a phantom OAuth toggle.
      const restore = await patchConfig([
        { key: 'ENABLE_SIGNUP', value: originalSignup, category: 'auth' },
        { key: 'GOOGLE_OAUTH_ENABLED', value: originalGoogle, category: 'auth' },
      ]);
      if (restore.status !== 200) {
        console.error(`  ⚠ FAILED to restore instance config (${restore.status}) — check ENABLE_SIGNUP / GOOGLE_OAUTH_ENABLED by hand`);
        fail += 1;
      }
    }
  }

  // ── D. Liveness + the publish seam (api → space SSR) ────────────────
  console.log('\nD. All-apps liveness + wiki publish round-trip');

  await check('api /health is ok with the database up', async () => {
    const res = await web.req('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
    assert.equal(res.data.services?.database, 'up');
  });

  await check(`web responds (${WEB})`, async () => {
    const res = await fetch(WEB, { redirect: 'follow' });
    assert.ok(res.ok, `got ${res.status}`);
  });

  await check(`admin responds (${ADMIN})`, async () => {
    const res = await fetch(ADMIN, { redirect: 'follow' });
    assert.ok(res.ok, `got ${res.status}`);
  });

  await check(`live /health is ok (${LIVE})`, async () => {
    const res = await fetch(`${LIVE}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'live');
  });

  // Publish round-trip: create a wiki page over the api as a normal user,
  // publish it, and read it back anonymously through the space app's SSR.
  // Inside a check (not bare await) so a transient socket error counts as one
  // failure instead of crashing the suite; one retry absorbs a stale
  // keep-alive connection ("fetch failed" with no HTTP status).
  const title = `Cross-App E2E ${rand()}`;
  let pageId = null;
  try {
    await check('setup: create a wiki page to publish', async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const projects = await web.req('GET', '/projects', { token: webToken });
          const list = projects.data?.items ?? projects.data ?? [];
          // Wiki create needs project write access — the list also contains
          // projects the user can merely see (workspace-visible), so pick one
          // the user owns or is a member of, never blindly list[0].
          const uid = String(webLogin.data.user?._id ?? webLogin.data.user?.id);
          const project = list.find(
            (p) =>
              String(p.ownerId) === uid ||
              (p.members || []).some((m) => String(m?._id ?? m) === uid),
          );
          assert.ok(
            project,
            'test user owns/joins no project — run the test seed first',
          );
          const created = await web.req('POST', '/wiki', {
            token: webToken,
            body: {
              projectId: String(project._id ?? project.id),
              title,
              content: '<p>Published by the cross-app E2E suite.</p>',
            },
          });
          assert.ok(
            created.status === 200 || created.status === 201,
            `wiki create failed (${created.status}): ${JSON.stringify(created.data)}`,
          );
          pageId = String(created.data._id ?? created.data.id);
          return;
        } catch (err) {
          if (attempt >= 2 || !/fetch failed/i.test(String(err?.message))) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    });

    let anchor = null;
    await check('POST /wiki/:id/publish mints a stable anchor', async () => {
      assert.ok(pageId, 'no page (setup failed)');
      const res = await web.req('POST', `/wiki/${pageId}/publish`, { token: webToken });
      assert.ok(res.status === 200 || res.status === 201, `publish → ${res.status}`);
      assert.ok(res.data.anchor, 'no anchor returned');
      assert.equal(res.data.isPublic, true);
      anchor = res.data.anchor;
    });

    await check('the published page renders on space, anonymously', async () => {
      assert.ok(anchor, 'no anchor (publish failed)');
      const res = await fetch(`${SPACE}/${anchor}`, { redirect: 'follow' });
      assert.equal(res.status, 200, `space returned ${res.status}`);
      const html = await res.text();
      assert.ok(html.includes(title), 'page title not in the rendered HTML');
    });

    await check('after unpublish the space URL 404s', async () => {
      assert.ok(anchor, 'no anchor (publish failed)');
      const res = await web.req('DELETE', `/wiki/${pageId}/publish`, { token: webToken });
      assert.ok(res.status < 300, `unpublish → ${res.status}`);
      const gone = await fetch(`${SPACE}/${anchor}`, { redirect: 'follow' });
      assert.equal(gone.status, 404, `expected 404, got ${gone.status}`);
    });
  } finally {
    if (pageId) {
      const res = await web.req('DELETE', `/wiki/${pageId}`, { token: webToken });
      if (res.status >= 300) {
        console.error(`  ⚠ FAILED to delete the E2E wiki page ${pageId} (${res.status})`);
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
