#!/usr/bin/env node
/**
 * Phase 8 suite — API tokens, webhooks, and public intake
 * (docs/plan/03-feature-parity.md §3, §1/§4). Drives a running stack.
 *
 * Spins up a throwaway HTTP receiver so a webhook delivery can be observed
 * end-to-end, HMAC signature and all.
 *
 *   node apps/api/test/integrations.e2e.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
// alice owns workspace acme AND a project in it (test-seed.ts) — the intake
// checks need project write access, which the instance admin fixture lacks
// (admin@test.com is in every workspace but owns/joins no project).
const EMAIL = process.env.TEST_EMAIL ?? 'alice@test.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';

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

let token = '';
let csrf = '';
const jar = new Map();

async function req(method, pathname, body, authOverride) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const auth =
    authOverride !== undefined
      ? authOverride
      : token
        ? `Bearer ${token}`
        : undefined;
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: auth } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 204 */
  }
  return { status: res.status, data };
}

/** A one-shot HTTP server that records the next webhook delivery. */
function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({
        signature: req.headers['x-prism-signature'],
        event: req.headers['x-prism-event'],
        body: raw,
      });
      res.writeHead(200);
      res.end('ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/hook`, received, server });
    });
  });
}

async function main() {
  console.log(`\nPhase 8 suite (integrations) → ${API}\n`);

  const login = await req('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.data)}`);
  token = login.data.accessToken;
  csrf = jar.get('prism_csrf') ?? '';

  const me = login.data.user;
  const ws = await req('GET', '/workspaces');
  const wsList = ws.data?.items ?? ws.data ?? [];
  // A workspace the login user owns, so create/write calls are permitted.
  const ownWs = wsList.find((w) => w.owner?.id === me.id) ?? wsList[0];
  const workspaceId = ownWs?.id ?? ownWs?._id;
  assert.ok(workspaceId, `no workspace: ${JSON.stringify(ws.data)?.slice(0, 150)}`);

  // ── API tokens (PAT) ──────────────────────────────────────────────
  let patRaw, patId;
  await check('create a PAT returns the raw secret exactly once', async () => {
    const res = await req('POST', '/users/me/api-tokens', { name: 'ci-token' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.ok(res.data.token?.startsWith('prs_'), 'no pat_ token returned');
    patRaw = res.data.token;
    patId = res.data.id;
  });

  await check('the PAT list never echoes the secret', async () => {
    const res = await req('GET', '/users/me/api-tokens');
    assert.equal(res.status, 200);
    const row = res.data.find((t) => String(t._id ?? t.id) === patId);
    assert.ok(row, 'token not listed');
    assert.equal(row.token, undefined, 'raw token leaked in list');
    assert.equal(row.tokenHash, undefined, 'token hash leaked in list');
    assert.ok(row.prefix?.startsWith('prs_'), 'no prefix for recognition');
  });

  await check('the PAT authenticates as its user', async () => {
    const res = await req('GET', '/auth/me', null, `Bearer ${patRaw}`);
    assert.equal(res.status, 200, `PAT auth failed: ${res.status}`);
    assert.equal(res.data.aud, 'web');
  });

  await check('a PAT cannot reach instance endpoints (aud=web)', async () => {
    const res = await req('GET', '/instance/config', null, `Bearer ${patRaw}`);
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check('a revoked PAT stops working', async () => {
    const del = await req('DELETE', `/users/me/api-tokens/${patId}`);
    assert.equal(del.status, 200);
    const res = await req('GET', '/auth/me', null, `Bearer ${patRaw}`);
    assert.equal(res.status, 401, `revoked PAT still worked: ${res.status}`);
  });

  // ── Webhooks ──────────────────────────────────────────────────────
  const receiver = await startReceiver();
  let hookId, hookSecret;
  await check('create a webhook returns a signing secret once', async () => {
    const res = await req('POST', '/webhooks', {
      workspaceId,
      url: receiver.url,
      events: ['intake.received'],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.ok(res.data.secret?.startsWith('whsec_'), 'no signing secret');
    hookId = res.data.id;
    hookSecret = res.data.secret;
  });

  await check('the webhook list does not echo the secret', async () => {
    const res = await req('GET', `/webhooks?workspaceId=${workspaceId}`);
    const row = res.data.find((w) => w.id === hookId);
    assert.ok(row, 'webhook not listed');
    assert.equal(row.secret, undefined, 'secret leaked in list');
  });

  await check('a non-http webhook URL is rejected', async () => {
    const res = await req('POST', '/webhooks', {
      workspaceId,
      url: 'file:///etc/passwd',
      events: ['*'],
    });
    assert.equal(res.status, 400, `SSRF URL accepted: ${res.status}`);
  });

  // ── Intake → webhook delivery, end to end ────────────────────────
  let projectId;
  await check('setup: find a writable project', async () => {
    const res = await req('GET', '/projects');
    const list = res.data?.items ?? res.data ?? [];
    const mine = list.find(
      (p) => String(p.workspaceId) === String(workspaceId) &&
        (String(p.ownerId) === me.id || (p.members || []).some((m) => String(m) === me.id)),
    );
    projectId = (mine ?? list[0])?.id ?? (mine ?? list[0])?._id;
    assert.ok(projectId, 'no project available');
  });

  let anchor;
  await check('create + publish an intake form', async () => {
    anchor = `ci-intake-${Date.now()}`;
    const res = await req('POST', '/intake/forms', {
      projectId,
      title: 'Bug reports',
      anchor,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.anchor, anchor);
  });

  await check('the public form is readable without auth', async () => {
    const res = await req('GET', `/intake/forms/${anchor}`, null, null);
    assert.equal(res.status, 200);
    assert.equal(res.data.title, 'Bug reports');
    // No internal ids on the public shape.
    assert.equal(res.data.projectId, undefined, 'public form leaked projectId');
  });

  await check('an anonymous submission is accepted', async () => {
    const res = await req(
      'POST',
      `/intake/forms/${anchor}/submit`,
      { title: 'It crashes on save', description: 'Steps: ...' },
      null,
    );
    assert.equal(res.status, 201, JSON.stringify(res.data));
  });

  await check('the submission delivered a signed webhook', async () => {
    // Delivery is fire-and-forget; give it a moment.
    for (let i = 0; i < 20 && receiver.received.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(receiver.received.length >= 1, true, 'no webhook received');
    const hit = receiver.received[0];
    assert.equal(hit.event, 'intake.received');
    // Verify the HMAC signature the way a real receiver would.
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', hookSecret).update(hit.body).digest('hex');
    assert.equal(hit.signature, expected, 'HMAC signature mismatch');
    // The submitter's email must not be in the webhook payload.
    assert.ok(!hit.body.includes('@'), 'webhook payload leaked contact info');
  });

  let submissionId, formId2;
  await check('a member sees the submission in triage', async () => {
    const forms = await req('GET', `/intake/forms?projectId=${projectId}`);
    formId2 = forms.data.find((f) => f.anchor === anchor)?._id;
    const subs = await req('GET', `/intake/forms/${formId2}/submissions`);
    assert.equal(subs.status, 200);
    submissionId = subs.data[0]?._id;
    assert.ok(submissionId, 'submission not visible to member');
  });

  await check('accepting a submission creates a work item', async () => {
    const res = await req('POST', `/intake/submissions/${submissionId}/triage`, {
      action: 'accept',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.status, 'accepted');
    assert.ok(res.data.issueId, 'no issue created from submission');

    const issue = await req('GET', `/issues/${res.data.issueId}`);
    assert.equal(issue.status, 200);
    assert.equal(issue.data.title, 'It crashes on save');
  });

  await check('re-triaging an accepted submission is rejected', async () => {
    const res = await req('POST', `/intake/submissions/${submissionId}/triage`, {
      action: 'decline',
    });
    assert.equal(res.status, 400, `double-triage allowed: ${res.status}`);
  });

  // ── Cleanup ──────────────────────────────────────────────────────
  await req('DELETE', `/webhooks/${hookId}`);
  receiver.server.close();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
