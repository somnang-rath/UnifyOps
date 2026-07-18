#!/usr/bin/env node
/**
 * Phase 7 suite — saved views, sub-issues, and issue relations
 * (docs/plan/03-feature-parity.md §1–2). Drives a running stack over HTTP.
 *
 *   node apps/api/test/views-relations.e2e.mjs
 *
 * Env: API_URL, TEST_EMAIL, TEST_PASSWORD (default seed admin).
 */
import assert from 'node:assert/strict';
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
const EMAIL = process.env.TEST_EMAIL ?? 'admin@test.com';
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

async function req(method, pathname, body) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function main() {
  console.log(`\nPhase 7 suite (views + relations) → ${API}\n`);

  const login = await req('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.data)}`);
  token = login.data.accessToken;
  csrf = jar.get('prism_csrf') ?? '';

  // A workspace to hang a view on.
  const ws = await req('GET', '/workspaces');
  const workspaceId =
    ws.data?.[0]?._id ?? ws.data?.items?.[0]?._id ?? ws.data?.[0]?.id;
  assert.ok(workspaceId, `no workspace found: ${JSON.stringify(ws.data)?.slice(0, 200)}`);

  // ── Saved views ──────────────────────────────────────────────────
  let viewId;
  await check('create a workspace-level view', async () => {
    const res = await req('POST', '/views', {
      name: 'My high-priority work',
      workspaceId,
      layout: 'list',
      filters: { priority: 'high', junk: 'stripped' },
      sortBy: 'priority:desc',
    });
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    viewId = res.data._id;
    assert.equal(res.data.filters.priority, 'high');
    // Unknown filter keys are stripped, not stored.
    assert.equal(res.data.filters.junk, undefined, 'unknown filter leaked through');
  });

  await check('list shows the created view', async () => {
    const res = await req('GET', `/views?workspaceId=${workspaceId}`);
    assert.equal(res.status, 200);
    assert.ok(
      res.data.some((v) => v._id === viewId),
      'created view not in list',
    );
  });

  await check('update the view', async () => {
    const res = await req('PATCH', `/views/${viewId}`, {
      name: 'Renamed view',
      isShared: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.name, 'Renamed view');
    assert.equal(res.data.isShared, true);
  });

  await check('creating a workspace view without a workspaceId is rejected', async () => {
    const res = await req('POST', '/views', { name: 'orphan', layout: 'list' });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  // ── Sub-issues ───────────────────────────────────────────────────
  let parentId, childA, childB;
  await check('create a parent and two sub-issues', async () => {
    const parent = await req('POST', '/issues', { title: 'Parent epic' });
    assert.equal(parent.status, 201, JSON.stringify(parent.data));
    parentId = parent.data._id;

    const a = await req('POST', '/issues', {
      title: 'Child A',
      parentId,
      status: 'done',
    });
    const b = await req('POST', '/issues', {
      title: 'Child B',
      parentId,
      status: 'todo',
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    childA = a.data._id;
    childB = b.data._id;
    assert.equal(a.data.parentId, parentId, 'child A did not persist parentId');
  });

  await check('children endpoint returns a done/total rollup', async () => {
    const res = await req('GET', `/issues/${parentId}/children`);
    assert.equal(res.status, 200);
    assert.equal(res.data.items.length, 2);
    assert.equal(res.data.rollup.total, 2);
    assert.equal(res.data.rollup.done, 1, 'rollup miscounted done children');
  });

  await check('an issue cannot be its own parent', async () => {
    const res = await req('PATCH', `/issues/${parentId}`, { parentId });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  // ── Relations ────────────────────────────────────────────────────
  let relationId;
  await check('create a blocks relation', async () => {
    const res = await req('POST', `/issues/${childA}/relations`, {
      targetId: childB,
      type: 'blocks',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    relationId = res.data._id;
  });

  await check('source sees it as `blocks`', async () => {
    const res = await req('GET', `/issues/${childA}/relations`);
    assert.equal(res.status, 200);
    assert.ok(res.data.blocks?.some((r) => r.issue._id === childB), 'blocks missing');
  });

  await check('target sees the inverse `blocked_by`', async () => {
    const res = await req('GET', `/issues/${childB}/relations`);
    assert.equal(res.status, 200);
    assert.ok(
      res.data.blocked_by?.some((r) => r.issue._id === childA),
      'inverse blocked_by missing',
    );
  });

  await check('a duplicate relation is rejected', async () => {
    const res = await req('POST', `/issues/${childA}/relations`, {
      targetId: childB,
      type: 'blocks',
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  await check('an issue cannot relate to itself', async () => {
    const res = await req('POST', `/issues/${childA}/relations`, {
      targetId: childA,
      type: 'relates_to',
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  await check('removing the relation clears both ends', async () => {
    const del = await req('DELETE', `/issues/relations/${relationId}`);
    assert.equal(del.status, 200);
    const src = await req('GET', `/issues/${childA}/relations`);
    const tgt = await req('GET', `/issues/${childB}/relations`);
    assert.ok(!src.data.blocks?.length, 'source still shows the relation');
    assert.ok(!tgt.data.blocked_by?.length, 'target still shows the inverse');
  });

  // ── Cleanup ──────────────────────────────────────────────────────
  await req('DELETE', `/views/${viewId}`);
  await req('DELETE', `/issues/${childA}`);
  await req('DELETE', `/issues/${childB}`);
  await req('DELETE', `/issues/${parentId}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
