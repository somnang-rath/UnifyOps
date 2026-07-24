#!/usr/bin/env node
/**
 * ADR 0008 disabled-state suite — OAuth login must be *effectively disabled*
 * until an admin supplies credentials, and must never leak why.
 *
 * Drives a running api over HTTP (like security.e2e.mjs) plus direct config
 * rows in Mongo to simulate what God Mode would write. Every row it touches
 * is snapshotted and restored.
 *
 *   node apps/api/test/oauth-disabled.e2e.mjs
 *
 * Env: API_URL     (default http://localhost:4000/api/v1)
 *      MONGODB_URI (default from apps/api/.env)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

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

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const MONGO = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/prism';

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

async function req(pathname, headers = {}) {
  const res = await fetch(`${API}${pathname}`, {
    redirect: 'manual',
    headers,
  });
  let data = null;
  try {
    data = await res.clone().json();
  } catch {
    /* redirects / empty */
  }
  return { status: res.status, data, headers: res.headers, res };
}

// ── Config rows the way God Mode writes them ─────────────────────────
const KEYS = [
  'GOOGLE_OAUTH_ENABLED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_OAUTH_ENABLED',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
];
let col;
let snapshot;

async function setCfg(key, value) {
  await col.updateOne(
    { key },
    { $set: { key, value, category: 'auth', isEncrypted: /_SECRET$/.test(key) } },
    { upsert: true },
  );
}

async function main() {
  await mongoose.connect(MONGO);
  col = mongoose.connection.db.collection('instanceconfigurations');
  snapshot = await col.find({ key: { $in: KEYS } }).toArray();
  // Start from a clean slate: no oauth rows at all.
  await col.deleteMany({ key: { $in: KEYS } });

  console.log(`\nOAuth disabled-state suite → ${API}\n`);

  console.log('1. Nothing configured (ship state)');
  await check('GET /auth/oauth/google → 404', async () => {
    const r = await req('/auth/oauth/google');
    assert.equal(r.status, 404);
  });
  await check('GET /auth/oauth/github → 404', async () => {
    const r = await req('/auth/oauth/github');
    assert.equal(r.status, 404);
  });
  await check('GET /auth/oauth/gitlab (unknown provider) → 404', async () => {
    const r = await req('/auth/oauth/gitlab');
    assert.equal(r.status, 404);
  });
  await check('GET /auth/oauth/google/callback → 404 (no redirect)', async () => {
    const r = await req('/auth/oauth/google/callback?code=x&state=y');
    assert.equal(r.status, 404);
  });
  await check('GET /instance → both effective booleans false, no secrets', async () => {
    const r = await req('/instance');
    assert.equal(r.status, 200);
    assert.equal(r.data.config.GOOGLE_OAUTH_ENABLED, false);
    assert.equal(r.data.config.GITHUB_OAUTH_ENABLED, false);
    const body = JSON.stringify(r.data);
    for (const leak of ['CLIENT_SECRET', 'clientSecret', 'CLIENT_ID', 'clientId'])
      assert.ok(!body.includes(leak), `response leaks ${leak}`);
  });

  console.log('\n2. Toggle on, no credentials → still effectively disabled');
  await setCfg('GOOGLE_OAUTH_ENABLED', 'true');
  await setCfg('GITHUB_OAUTH_ENABLED', 'true');
  await check('GET /auth/oauth/google → 404 despite toggle', async () => {
    const r = await req('/auth/oauth/google');
    assert.equal(r.status, 404);
  });
  await check('GET /auth/oauth/github → 404 despite toggle', async () => {
    const r = await req('/auth/oauth/github');
    assert.equal(r.status, 404);
  });
  await check('GET /instance → still false (client never learns why)', async () => {
    const r = await req('/instance');
    assert.equal(r.data.config.GOOGLE_OAUTH_ENABLED, false);
    assert.equal(r.data.config.GITHUB_OAUTH_ENABLED, false);
  });

  console.log('\n3. Toggle + client id only (partial credentials)');
  await setCfg('GOOGLE_CLIENT_ID', 'fake-client-id');
  await check('GET /auth/oauth/google → 404 without a secret', async () => {
    const r = await req('/auth/oauth/google');
    assert.equal(r.status, 404);
  });
  await check('GET /instance → still false (partial state invisible)', async () => {
    const r = await req('/instance');
    assert.equal(r.data.config.GOOGLE_OAUTH_ENABLED, false);
  });

  console.log('\n4. Full (fake) credentials → effectively enabled, no provider contact');
  await setCfg('GOOGLE_CLIENT_SECRET', 'fake-client-secret');
  let stateCookie = null;
  await check('GET /auth/oauth/google → 302 to Google authorize URL', async () => {
    const r = await req('/auth/oauth/google');
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('client_id'), 'fake-client-id');
    assert.ok(loc.searchParams.get('state')?.length >= 32, 'state param present');
    assert.ok(
      loc.searchParams.get('redirect_uri')?.endsWith('/api/v1/auth/oauth/google/callback'),
      'redirect_uri matches ADR 0008 §6',
    );
    assert.ok(!r.headers.get('location').includes('fake-client-secret'), 'secret not in URL');
    const setCookie = (r.res.headers.getSetCookie?.() ?? []).find((c) =>
      c.startsWith('prism_oauth_state='),
    );
    assert.ok(setCookie, 'prism_oauth_state cookie set');
    assert.ok(/httponly/i.test(setCookie), 'httpOnly');
    assert.ok(/samesite=lax/i.test(setCookie), 'sameSite=lax');
    assert.ok(setCookie.includes('Path=/api/v1/auth/oauth'), 'path-scoped');
    stateCookie = setCookie.split(';')[0];
  });
  await check('GET /instance → GOOGLE_OAUTH_ENABLED true, GitHub still false', async () => {
    const r = await req('/instance');
    assert.equal(r.data.config.GOOGLE_OAUTH_ENABLED, true);
    assert.equal(r.data.config.GITHUB_OAUTH_ENABLED, false);
  });
  await check('callback with state mismatch → 302 /login?error=oauth_failed', async () => {
    const r = await req('/auth/oauth/google/callback?code=x&state=wrong', {
      Cookie: stateCookie,
    });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location');
    assert.ok(loc.endsWith('/login?error=oauth_failed'), `got ${loc}`);
    assert.ok(!/token|jwt/i.test(loc), 'no token material in URL');
  });
  await check('callback with no state cookie → 302 /login?error=oauth_failed', async () => {
    const r = await req('/auth/oauth/google/callback?code=x&state=abc');
    assert.equal(r.status, 302);
    assert.ok(r.headers.get('location').endsWith('/login?error=oauth_failed'));
  });

  console.log('\n5. Restore');
  await col.deleteMany({ key: { $in: KEYS } });
  if (snapshot.length) await col.insertMany(snapshot);
  await check('GET /instance → back to false after restore', async () => {
    const r = await req('/instance');
    assert.equal(r.data.config.GOOGLE_OAUTH_ENABLED, false);
    assert.equal(r.data.config.GITHUB_OAUTH_ENABLED, false);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  // Best effort restore even on a crash.
  try {
    if (col) {
      await col.deleteMany({ key: { $in: KEYS } });
      if (snapshot?.length) await col.insertMany(snapshot);
    }
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
