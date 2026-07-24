#!/usr/bin/env node
/**
 * Phase 8 workstream B suite — issue templates + CSV import.
 * Drives a running stack seeded with test-seed.ts.
 *
 * Fixture facts this suite leans on: alice@test.com owns workspace `acme` and
 * the "Website Redesign" project in it; dave@test.com owns workspace `beta`
 * and is NOT a member of acme; bob@test.com IS an acme member.
 *
 *   node apps/api/test/templates-import.e2e.mjs
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

const API =
  process.env.E2E_BASE_URL ??
  process.env.API_URL ??
  'http://localhost:4000/api/v1';
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

/** An authenticated session: its own cookie jar, token, and CSRF header. */
async function session(email) {
  const jar = new Map();
  let token = '';
  const req = async (method, pathname, body) => {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = jar.get('prism_csrf') ?? '';
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
  };
  const login = await req('POST', '/auth/login', {
    email,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(
    login.status,
    200,
    `login ${email} failed: ${JSON.stringify(login.data)}`,
  );
  token = login.data.accessToken;
  return { req, user: login.data.user };
}

const id = (doc) => String(doc?._id ?? doc?.id ?? '');

async function main() {
  console.log(`\nPhase 8B suite (templates + import) → ${API}\n`);

  const alice = await session('alice@test.com');
  const dave = await session('dave@test.com');

  // ── Setup: alice's workspace + project ────────────────────────────
  const ws = await alice.req('GET', '/workspaces');
  const wsList = ws.data?.items ?? ws.data ?? [];
  const acme = wsList.find((w) => (w.slug ?? '') === 'acme') ?? wsList[0];
  const workspaceId = id(acme);
  assert.ok(workspaceId, 'no acme workspace for alice');

  const projects = await alice.req('GET', '/projects');
  const pList = projects.data?.items ?? projects.data ?? [];
  const project = pList.find(
    (p) =>
      String(p.workspaceId) === workspaceId &&
      String(p.ownerId?._id ?? p.ownerId) === alice.user.id,
  );
  const projectId = id(project);
  assert.ok(projectId, 'no alice-owned project in acme');

  const run = Date.now();

  // ── Templates: CRUD + scoping ─────────────────────────────────────
  let projTplId, wsTplId;
  await check('alice creates a project template', async () => {
    const res = await alice.req('POST', '/templates', {
      projectId,
      name: `Bug report ${run}`,
      defaults: {
        desc: 'Steps to reproduce:\n1.',
        type: 'bug',
        priority: 'high',
        labels: ['bug', 'triage'],
        todos: [{ text: 'Reproduce locally' }, { text: 'Add regression test' }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(String(res.data.workspaceId), workspaceId, 'workspaceId not derived');
    assert.equal(String(res.data.projectId), projectId);
    assert.equal(res.data.defaults?.priority, 'high');
    projTplId = id(res.data);
  });

  await check('alice creates a workspace-level template', async () => {
    const res = await alice.req('POST', '/templates', {
      workspaceId,
      name: `Chore ${run}`,
      defaults: { type: 'task', priority: 'low' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.projectId, null, 'workspace template got a projectId');
    wsTplId = id(res.data);
  });

  await check('project listing merges project + workspace-level templates', async () => {
    const res = await alice.req(
      'GET',
      `/templates?workspaceId=${workspaceId}&projectId=${projectId}`,
    );
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const ids = res.data.map(id);
    assert.ok(ids.includes(projTplId), 'project template missing');
    assert.ok(ids.includes(wsTplId), 'workspace-level template missing from merge');
  });

  await check('alice updates her template', async () => {
    const res = await alice.req('PATCH', `/templates/${projTplId}`, {
      name: `Bug report v2 ${run}`,
      defaults: { type: 'bug', priority: 'critical' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.name, `Bug report v2 ${run}`);
    assert.equal(res.data.defaults?.priority, 'critical');
  });

  await check('dave (other workspace) cannot list acme templates', async () => {
    const res = await dave.req('GET', `/templates?workspaceId=${workspaceId}`);
    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}: ${JSON.stringify(res.data)}`,
    );
  });

  await check("dave cannot update alice's template", async () => {
    const res = await dave.req('PATCH', `/templates/${projTplId}`, {
      name: 'hijacked',
    });
    assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
  });

  await check("dave cannot delete alice's template", async () => {
    const res = await dave.req('DELETE', `/templates/${projTplId}`);
    assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
    // and it is still there for alice
    const still = await alice.req(
      'GET',
      `/templates?workspaceId=${workspaceId}&projectId=${projectId}`,
    );
    assert.ok(still.data.map(id).includes(projTplId), 'template vanished');
  });

  await check('alice deletes her templates', async () => {
    for (const tplId of [projTplId, wsTplId]) {
      const res = await alice.req('DELETE', `/templates/${tplId}`);
      assert.equal(res.status, 200, JSON.stringify(res.data));
    }
    const after = await alice.req(
      'GET',
      `/templates?workspaceId=${workspaceId}&projectId=${projectId}`,
    );
    const ids = after.data.map(id);
    assert.ok(!ids.includes(projTplId) && !ids.includes(wsTplId), 'delete did not stick');
  });

  // ── CSV import ────────────────────────────────────────────────────
  await check('import happy path creates 3 issues', async () => {
    const res = await alice.req('POST', '/issues/import', {
      projectId,
      rows: [
        { title: `Imported A ${run}`, priority: 'high', status: 'todo', labels: ['csv'] },
        { title: `Imported B ${run}`, description: 'from csv', dueDate: '2026-08-01' },
        { title: `Imported C ${run}`, assigneeEmail: 'bob@test.com' },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.created, 3, JSON.stringify(res.data));
    assert.equal(res.data.skipped.length, 0, JSON.stringify(res.data.skipped));
  });

  await check('imported issues are visible via GET /issues', async () => {
    const res = await alice.req(
      'GET',
      `/issues?projectId=${projectId}&q=${encodeURIComponent(`Imported`)}&limit=200`,
    );
    assert.equal(res.status, 200);
    const titles = res.data.items.map((i) => i.title);
    for (const t of [`Imported A ${run}`, `Imported B ${run}`, `Imported C ${run}`]) {
      assert.ok(titles.includes(t), `missing ${t}`);
    }
    const a = res.data.items.find((i) => i.title === `Imported A ${run}`);
    assert.equal(a.priority, 'high');
    // bob is an acme member → his email resolved to an assignee
    const c = res.data.items.find((i) => i.title === `Imported C ${run}`);
    assert.ok(c.assigneeId, 'in-workspace assigneeEmail was not resolved');
  });

  await check('a bad row is skipped with a reason, the rest import', async () => {
    const res = await alice.req('POST', '/issues/import', {
      projectId,
      rows: [
        { title: `Imported D ${run}`, priority: 'urgent' }, // not a valid priority
        { title: `Imported E ${run}`, priority: 'low' },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.created, 1, JSON.stringify(res.data));
    assert.equal(res.data.skipped.length, 1);
    assert.equal(res.data.skipped[0].row, 1);
    assert.ok(/priority/i.test(res.data.skipped[0].reason), 'reason missing');
  });

  await check('a non-workspace assigneeEmail is dropped, issue still created', async () => {
    const res = await alice.req('POST', '/issues/import', {
      projectId,
      rows: [{ title: `Imported F ${run}`, assigneeEmail: 'dave@test.com' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.created, 1, JSON.stringify(res.data));
    const list = await alice.req(
      'GET',
      `/issues?projectId=${projectId}&q=${encodeURIComponent(`Imported F ${run}`)}`,
    );
    const f = list.data.items.find((i) => i.title === `Imported F ${run}`);
    assert.ok(f, 'issue not created');
    assert.ok(!f.assigneeId, 'cross-workspace email must not resolve to an assignee');
  });

  await check('more than 500 rows is rejected with 400', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ title: `Bulk ${i}` }));
    const res = await alice.req('POST', '/issues/import', { projectId, rows });
    assert.equal(res.status, 400, `row cap not enforced: ${res.status}`);
  });

  await check("dave cannot import into alice's project", async () => {
    const res = await dave.req('POST', '/issues/import', {
      projectId,
      rows: [{ title: `Smuggled ${run}` }],
    });
    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}: ${JSON.stringify(res.data)}`,
    );
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
