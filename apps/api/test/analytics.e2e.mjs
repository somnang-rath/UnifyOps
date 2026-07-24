#!/usr/bin/env node
/**
 * Workspace analytics suite — GET /workspaces/:id/analytics (Phase 8 follow-up).
 * Drives a running stack over HTTP against the seeded dev DB. Read-mostly: the
 * only writes are issues the suite itself creates and deletes.
 *
 *   node apps/api/test/analytics.e2e.mjs
 *
 * Env: API_URL (default http://localhost:4000/api/v1),
 *      TEST_EMAIL_A / TEST_EMAIL_B — members of two DIFFERENT workspaces
 *      (defaults: alice@test.com / dave@test.com from the test seed),
 *      TEST_PASSWORD (default test1234).
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
const EMAIL_A = process.env.TEST_EMAIL_A ?? 'alice@test.com';
const EMAIL_B = process.env.TEST_EMAIL_B ?? 'dave@test.com';
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

/** Independent authed session (cookie jar + bearer + csrf) per user. */
function session() {
  return { token: '', csrf: '', jar: new Map() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(s, method, pathname, body) {
  // The API rate-limits per IP (20 req/s); back off and retry on 429 so the
  // suite's pace never masquerades as a functional failure.
  for (let attempt = 0; ; attempt++) {
    const cookie = [...s.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(s.csrf ? { 'X-CSRF-Token': s.csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 6) {
      await sleep(1200);
      continue;
    }
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      s.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 204 */
    }
    return { status: res.status, data };
  }
}

async function login(s, email) {
  const res = await req(s, 'POST', '/auth/login', {
    email,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(res.status, 200, `login ${email} failed: ${JSON.stringify(res.data)}`);
  s.token = res.data.accessToken;
  s.csrf = s.jar.get('prism_csrf') ?? '';
  return res.data;
}

const wsId = (w) => w?.id ?? w?._id;

function assertShape(a, weeks) {
  for (const k of ['open', 'completed', 'overdue']) {
    assert.equal(typeof a.totals?.[k], 'number', `totals.${k} not a number`);
    assert.ok(a.totals[k] >= 0, `totals.${k} negative`);
  }
  for (const section of ['byState', 'byPriority']) {
    assert.ok(Array.isArray(a[section]), `${section} not an array`);
    for (const b of a[section]) {
      assert.equal(typeof b.key, 'string', `${section}.key not a string`);
      assert.equal(typeof b.count, 'number', `${section}.count not a number`);
    }
  }
  assert.ok(Array.isArray(a.byAssignee), 'byAssignee not an array');
  for (const b of a.byAssignee) {
    assert.equal(typeof b.key, 'string', 'byAssignee.key not a string');
    assert.equal(typeof b.name, 'string', 'byAssignee.name not a string');
    assert.equal(typeof b.count, 'number', 'byAssignee.count not a number');
  }
  assert.ok(Array.isArray(a.trend), 'trend not an array');
  assert.equal(a.trend.length, weeks, `trend has ${a.trend.length} weeks, expected ${weeks}`);
  const DAY = 24 * 60 * 60 * 1000;
  for (const [i, p] of a.trend.entries()) {
    assert.match(p.weekStart, /^\d{4}-\d{2}-\d{2}$/, `weekStart "${p.weekStart}" not ISO date`);
    const d = new Date(`${p.weekStart}T00:00:00Z`);
    assert.equal(d.getUTCDay(), 1, `weekStart ${p.weekStart} is not a Monday`);
    assert.equal(typeof p.created, 'number', 'trend.created not a number');
    assert.equal(typeof p.completed, 'number', 'trend.completed not a number');
    if (i > 0) {
      const prev = new Date(`${a.trend[i - 1].weekStart}T00:00:00Z`);
      assert.equal(d - prev, 7 * DAY, `weeks not consecutive at index ${i}`);
    }
  }
  const last = new Date(`${a.trend.at(-1).weekStart}T00:00:00Z`);
  const now = new Date();
  assert.ok(now - last < 7 * DAY && now >= last, 'last trend week is not the current week');
}

async function main() {
  console.log(`\nWorkspace analytics suite → ${API}\n`);

  const A = session();
  const B = session();
  await login(A, EMAIL_A);
  await login(B, EMAIL_B);

  // Two disjoint tenants from the seed.
  const wsListA = (await req(A, 'GET', '/workspaces')).data ?? [];
  const wsListB = (await req(B, 'GET', '/workspaces')).data ?? [];
  const idsB = new Set(wsListB.map(wsId));
  const wsA = wsListA.find((w) => !idsB.has(wsId(w)) && w.projectCount > 0) ?? wsListA[0];
  const idsA = new Set(wsListA.map(wsId));
  const wsB = wsListB.find((w) => !idsA.has(wsId(w))) ?? wsListB[0];
  assert.ok(wsA && wsB, 'need one workspace per user');
  assert.notEqual(wsId(wsA), wsId(wsB), `${EMAIL_A} and ${EMAIL_B} must be in different workspaces`);
  assert.ok(!idsB.has(wsId(wsA)), `${EMAIL_B} unexpectedly belongs to ${wsA.name}`);
  console.log(`  tenants: A=${wsA.name} (${EMAIL_A})  B=${wsB.name} (${EMAIL_B})\n`);

  const analytics = (s, ws, qs = '') =>
    req(s, 'GET', `/workspaces/${ws}/analytics${qs}`);

  // ── Shape ─────────────────────────────────────────────────────────
  await check('default range returns the full contract shape (12 weeks)', async () => {
    const res = await analytics(A, wsId(wsA));
    assert.equal(res.status, 200, JSON.stringify(res.data)?.slice(0, 300));
    assertShape(res.data, 12);
  });

  await check('range=4w and range=24w resize the trend only', async () => {
    const [r4, r24, r12] = await Promise.all([
      analytics(A, wsId(wsA), '?range=4w'),
      analytics(A, wsId(wsA), '?range=24w'),
      analytics(A, wsId(wsA), '?range=12w'),
    ]);
    assert.equal(r4.status, 200);
    assert.equal(r24.status, 200);
    assertShape(r4.data, 4);
    assertShape(r24.data, 24);
    // Totals are current-state — identical across ranges.
    assert.deepEqual(r4.data.totals, r12.data.totals, 'range changed totals');
    assert.deepEqual(r24.data.totals, r12.data.totals, 'range changed totals');
  });

  await check('byState/byPriority counts sum to open+completed', async () => {
    const { data } = await analytics(A, wsId(wsA));
    const total = data.totals.open + data.totals.completed;
    const stateSum = data.byState.reduce((n, b) => n + b.count, 0);
    const prioSum = data.byPriority.reduce((n, b) => n + b.count, 0);
    const assigneeSum = data.byAssignee.reduce((n, b) => n + b.count, 0);
    assert.equal(stateSum, total, `byState sums to ${stateSum}, totals say ${total}`);
    assert.equal(prioSum, total, `byPriority sums to ${prioSum}, totals say ${total}`);
    assert.equal(assigneeSum, total, `byAssignee sums to ${assigneeSum}, totals say ${total}`);
  });

  // ── Validation ────────────────────────────────────────────────────
  await check('garbage range values are rejected with 400', async () => {
    for (const bad of ['1w', '52w', '999w', 'all', '12', '4w;drop']) {
      const res = await analytics(A, wsId(wsA), `?range=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 400, `range=${bad} → ${res.status}, expected 400`);
    }
  });

  await check('malformed projectId is rejected with 400', async () => {
    const res = await analytics(A, wsId(wsA), '?projectId=not-an-id');
    assert.equal(res.status, 400, `got ${res.status}`);
  });

  // ── Tenant isolation (ADR 0003–0006) ──────────────────────────────
  await check('a non-member gets 404, not data', async () => {
    const res = await analytics(B, wsId(wsA));
    assert.equal(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
    const rev = await analytics(A, wsId(wsB));
    assert.equal(rev.status, 404, `reverse direction leaked: ${rev.status}`);
  });

  // A project of workspace A, used both for the cross-tenant probe and writes.
  const projectsA = (await req(A, 'GET', `/projects?workspace=${wsId(wsA)}`)).data ?? [];
  assert.ok(projectsA.length, 'workspace A has no projects to test with');

  await check("projectId from another workspace returns 404 — no cross-tenant data", async () => {
    const foreign = projectsA[0]._id ?? projectsA[0].id;
    const res = await analytics(B, wsId(wsB), `?projectId=${foreign}`);
    assert.equal(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
  });

  await check('projectId inside the workspace narrows the numbers', async () => {
    const pid = projectsA[0]._id ?? projectsA[0].id;
    const [all, one] = await Promise.all([
      analytics(A, wsId(wsA)),
      analytics(A, wsId(wsA), `?projectId=${pid}`),
    ]);
    assert.equal(one.status, 200, JSON.stringify(one.data)?.slice(0, 200));
    assertShape(one.data, 12);
    const sum = (t) => t.open + t.completed;
    assert.ok(sum(one.data.totals) <= sum(all.data.totals), 'filtered totals exceed workspace totals');
  });

  // ── Counting semantics (create → observe → clean up) ──────────────
  let issueId;
  let writableProject;
  await check('a new overdue, unassigned issue moves the right counters', async () => {
    const before = (await analytics(A, wsId(wsA))).data;
    const beforeB = (await analytics(B, wsId(wsB))).data;

    // Find a project alice can write to (member-gated).
    let created;
    for (const p of projectsA) {
      const res = await req(A, 'POST', '/issues', {
        title: '[e2e-analytics] overdue probe',
        projectId: p._id ?? p.id,
        status: 'todo',
        dueDate: '2020-01-01',
      });
      if (res.status === 201) {
        created = res;
        writableProject = p._id ?? p.id;
        break;
      }
    }
    assert.ok(created, 'could not create an issue in any workspace-A project');
    issueId = created.data._id;

    const after = (await analytics(A, wsId(wsA))).data;
    assert.equal(after.totals.open, before.totals.open + 1, 'open did not increment');
    assert.equal(after.totals.overdue, before.totals.overdue + 1, 'overdue did not increment');
    assert.equal(after.totals.completed, before.totals.completed, 'completed moved on create');

    const todoBefore = before.byState.find((b) => b.key === 'todo')?.count ?? 0;
    const todoAfter = after.byState.find((b) => b.key === 'todo')?.count ?? 0;
    assert.equal(todoAfter, todoBefore + 1, 'byState.todo did not increment');

    const unBefore = before.byAssignee.find((b) => b.key === 'unassigned')?.count ?? 0;
    const unAfter = after.byAssignee.find((b) => b.key === 'unassigned')?.count ?? 0;
    assert.equal(unAfter, unBefore + 1, 'unassigned bucket did not increment');

    const wkBefore = before.trend.at(-1);
    const wkAfter = after.trend.at(-1);
    assert.equal(wkAfter.created, wkBefore.created + 1, 'current trend week did not count the creation');

    // Workspace B is untouched by activity in A.
    const afterB = (await analytics(B, wsId(wsB))).data;
    assert.deepEqual(afterB.totals, beforeB.totals, "workspace B's totals changed — tenant leak");
  });

  await check('completing the issue flips it to completed (trend included)', async () => {
    const before = (await analytics(A, wsId(wsA))).data;
    const res = await req(A, 'PATCH', `/issues/${issueId}`, { status: 'done' });
    assert.equal(res.status, 200, JSON.stringify(res.data)?.slice(0, 200));
    const after = (await analytics(A, wsId(wsA))).data;
    assert.equal(after.totals.completed, before.totals.completed + 1, 'completed did not increment');
    assert.equal(after.totals.open, before.totals.open - 1, 'open did not decrement');
    assert.equal(after.totals.overdue, before.totals.overdue - 1, 'a done issue still counts as overdue');
    assert.equal(
      after.trend.at(-1).completed,
      before.trend.at(-1).completed + 1,
      'current trend week did not count the completion',
    );
  });

  await check('the probe issue only ever counted inside its own project filter', async () => {
    const other = projectsA.map((p) => p._id ?? p.id).find((id) => id !== writableProject);
    if (!other) return; // single-project workspace — nothing to compare against
    const res = await analytics(A, wsId(wsA), `?projectId=${other}`);
    assert.equal(res.status, 200);
    const found = JSON.stringify(res.data).includes('[e2e-analytics]');
    assert.ok(!found, 'probe leaked into another project');
  });

  // ── Cleanup ───────────────────────────────────────────────────────
  if (issueId) {
    const del = await req(A, 'DELETE', `/issues/${issueId}`);
    if (del.status >= 300) console.error(`  ! cleanup: DELETE /issues/${issueId} → ${del.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
