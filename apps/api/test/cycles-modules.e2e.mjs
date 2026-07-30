#!/usr/bin/env node
/**
 * Cycles + Modules suite — the two planning primitives added to the project
 * sub-navigation (Plane parity: Cycles/Modules/Views/Pages).
 *
 * Covers the rules that are easy to get wrong and impossible to see in a
 * typecheck: derived cycle status, the one-scheduled-cycle-at-a-time overlap
 * guard, `cycleId=none` / `moduleId=none` backlog filters, the progress
 * rollup, partial-success assignment, cross-project rejection, delete
 * releasing items instead of destroying them, and the read/write gates.
 *
 *   node apps/api/test/cycles-modules.e2e.mjs
 *
 * Needs a running stack + the E2E fixture (test-seed.ts): alice owns acme and
 * a project there; dave is beta-only and must not see any of it.
 * Env: API_URL, TEST_EMAIL, TEST_PASSWORD.
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

/**
 * A logged-in session with its own token + cookie jar. Pass `out` to receive
 * the authenticated user's id back as `out.me` — the write-gate checks need it.
 */
async function session(email, out) {
  const jar = new Map();
  let token = '';
  let csrf = '';
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
  const login = await req('POST', '/auth/login', {
    email,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(
    login.status,
    200,
    `login ${email} failed: ${JSON.stringify(login.data)} — is the E2E fixture seeded?`,
  );
  token = login.data.accessToken;
  csrf = jar.get('prism_csrf') ?? '';
  if (out) out.me = login.data.user?._id ?? login.data.user?.id ?? null;
  return req;
}

/** `YYYY-MM-DD`, `offset` days from today. */
const day = (offset) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log(`\nCycles + Modules suite → ${API}\n`);

  const jar = { me: null };
  const req = await session(EMAIL, jar);

  /*
   * Create a throwaway PRIVATE project rather than reusing one from the list.
   *
   * Reusing was non-deterministic in two ways that both produced false
   * failures. `/projects` ordering is not stable, so a different project was
   * picked between runs — one of which was `public` in a workspace the
   * "non-member" identity actually belongs to, making the isolation checks
   * fail on correct behaviour. And a project that already had a scheduled
   * cycle tripped the overlap guard before the suite created anything.
   *
   * `private` is the point: it guarantees dave is a non-member no matter which
   * workspace this lands in. Deleted in the cleanup at the end.
   */
  const workspaces = await req('GET', '/workspaces');
  const workspaceId =
    workspaces.data?.[0]?.id ?? workspaces.data?.[0]?._id ?? null;
  assert.ok(workspaceId, `no workspace for ${EMAIL}`);

  const created = await req('POST', '/projects', {
    name: `E2E cycles ${Date.now()}`,
    visibility: 'private',
    workspaceId,
  });
  assert.equal(
    created.status,
    201,
    `could not create the fixture project: ${JSON.stringify(created.data)}`,
  );
  const projectId = created.data._id;
  console.log(`  (fixture project: ${created.data.name})\n`);

  const made = { cycles: [], modules: [], issues: [] };
  const mkIssue = async (title) => {
    const r = await req('POST', '/issues', { projectId, title });
    assert.equal(r.status, 201, `create issue: ${JSON.stringify(r.data)}`);
    made.issues.push(r.data._id);
    return r.data._id;
  };

  // ── Cycles ───────────────────────────────────────────────────────
  console.log('Cycles');

  let currentCycle;
  await check('create a scheduled cycle → status derived as "current"', async () => {
    const r = await req('POST', '/cycles', {
      name: `E2E current ${Date.now()}`,
      projectId,
      startDate: day(-2),
      endDate: day(5),
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'current', JSON.stringify(r.data));
    assert.deepEqual(r.data.progress, { total: 0, completed: 0, byStatus: {} });
    currentCycle = r.data._id;
    made.cycles.push(currentCycle);
  });

  await check('a cycle with no dates is a draft', async () => {
    const r = await req('POST', '/cycles', {
      name: `E2E draft ${Date.now()}`,
      projectId,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'draft');
    made.cycles.push(r.data._id);
  });

  await check('a future cycle is "upcoming"', async () => {
    const r = await req('POST', '/cycles', {
      name: `E2E upcoming ${Date.now()}`,
      projectId,
      startDate: day(30),
      endDate: day(40),
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'upcoming');
    made.cycles.push(r.data._id);
  });

  await check('overlapping dates are rejected (one cycle at a time)', async () => {
    const r = await req('POST', '/cycles', {
      name: 'E2E overlap',
      projectId,
      startDate: day(0),
      endDate: day(9),
    });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.match(String(r.data.message), /overlap/i);
  });

  await check('a half-scheduled cycle is rejected', async () => {
    const r = await req('POST', '/cycles', {
      name: 'E2E half',
      projectId,
      startDate: day(100),
    });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  });

  await check('end before start is rejected', async () => {
    const r = await req('POST', '/cycles', {
      name: 'E2E backwards',
      projectId,
      startDate: day(200),
      endDate: day(190),
    });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  });

  let issueA;
  let issueB;
  await check('assign work items → progress rollup counts them', async () => {
    issueA = await mkIssue('E2E cycle item A');
    issueB = await mkIssue('E2E cycle item B');
    const r = await req('POST', `/cycles/${currentCycle}/issues`, {
      issueIds: [issueA, issueB],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.assigned, 2, JSON.stringify(r.data));
    assert.deepEqual(r.data.skipped, []);

    const got = await req('GET', `/cycles/${currentCycle}`);
    assert.equal(got.data.progress.total, 2, JSON.stringify(got.data.progress));
    assert.equal(got.data.progress.completed, 0);
  });

  await check('closing an item moves it into progress.completed', async () => {
    const r = await req('PATCH', `/issues/${issueA}`, { status: 'done' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const got = await req('GET', `/cycles/${currentCycle}`);
    assert.equal(got.data.progress.completed, 1, JSON.stringify(got.data.progress));
    assert.equal(got.data.progress.byStatus.done, 1);
  });

  await check('cycleId=none lists only the unscheduled backlog', async () => {
    const scoped = await req(
      'GET',
      `/issues?projectId=${projectId}&cycleId=none&limit=200`,
    );
    assert.equal(scoped.status, 200, JSON.stringify(scoped.data));
    const ids = scoped.data.items.map((i) => i._id);
    assert.ok(!ids.includes(issueA), 'scheduled item leaked into the backlog');
    assert.ok(!ids.includes(issueB), 'scheduled item leaked into the backlog');
  });

  await check('cycleId=<id> lists exactly that cycle', async () => {
    const scoped = await req(
      'GET',
      `/issues?projectId=${projectId}&cycleId=${currentCycle}&limit=200`,
    );
    assert.equal(scoped.status, 200);
    const ids = scoped.data.items.map((i) => i._id).sort();
    assert.deepEqual(ids, [issueA, issueB].sort(), JSON.stringify(ids));
  });

  await check('GET /cycles/:id/issues returns its items', async () => {
    const r = await req('GET', `/cycles/${currentCycle}/issues`);
    assert.equal(r.status, 200);
    assert.equal(r.data.length, 2, JSON.stringify(r.data.map((i) => i.title)));
  });

  await check('unassign returns one item to the backlog', async () => {
    const r = await req('DELETE', `/cycles/${currentCycle}/issues/${issueB}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const got = await req('GET', `/cycles/${currentCycle}`);
    assert.equal(got.data.progress.total, 1, JSON.stringify(got.data.progress));
  });

  await check('an item from another project is skipped, not fatal', async () => {
    // A personal (project-less) issue can never belong to this project.
    const personal = await req('POST', '/issues', { title: 'E2E personal' });
    assert.equal(personal.status, 201, JSON.stringify(personal.data));
    made.issues.push(personal.data._id);

    const r = await req('POST', `/cycles/${currentCycle}/issues`, {
      issueIds: [personal.data._id, issueB],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.assigned, 1, JSON.stringify(r.data));
    assert.deepEqual(r.data.skipped, [personal.data._id]);
  });

  await check('list?status= filters on the derived status', async () => {
    const r = await req('GET', `/cycles?projectId=${projectId}&status=draft`);
    assert.equal(r.status, 200);
    assert.ok(r.data.length > 0, 'expected at least the draft cycle');
    assert.ok(
      r.data.every((c) => c.status === 'draft'),
      JSON.stringify(r.data.map((c) => c.status)),
    );
  });

  await check('delete releases its items instead of deleting them', async () => {
    const doomed = await req('POST', '/cycles', {
      name: `E2E doomed ${Date.now()}`,
      projectId,
    });
    assert.equal(doomed.status, 201, JSON.stringify(doomed.data));
    const item = await mkIssue('E2E survives its cycle');
    await req('POST', `/cycles/${doomed.data._id}/issues`, { issueIds: [item] });

    const del = await req('DELETE', `/cycles/${doomed.data._id}`);
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.equal(del.data.releasedIssues, 1, JSON.stringify(del.data));

    const survivor = await req('GET', `/issues/${item}`);
    assert.equal(survivor.status, 200, 'the work item was deleted with its cycle');
    assert.ok(!survivor.data.cycleId, `cycleId not cleared: ${survivor.data.cycleId}`);
  });

  // ── Modules ──────────────────────────────────────────────────────
  console.log('\nModules');

  let moduleId;
  await check('create a module (status is stored, not derived)', async () => {
    const r = await req('POST', '/modules', {
      name: `E2E module ${Date.now()}`,
      projectId,
      status: 'in_progress',
      targetDate: day(30),
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'in_progress');
    assert.deepEqual(r.data.progress, { total: 0, completed: 0, byStatus: {} });
    moduleId = r.data._id;
    made.modules.push(moduleId);
  });

  await check('a target date with no start date is allowed', async () => {
    const r = await req('GET', `/modules/${moduleId}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.startDate, null, JSON.stringify(r.data.startDate));
    assert.ok(r.data.targetDate, 'targetDate was dropped');
  });

  await check('modules may overlap freely (no one-at-a-time rule)', async () => {
    const r = await req('POST', '/modules', {
      name: `E2E parallel ${Date.now()}`,
      projectId,
      startDate: day(0),
      targetDate: day(30),
      status: 'in_progress',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    made.modules.push(r.data._id);
  });

  await check('target before start is rejected', async () => {
    const r = await req('POST', '/modules', {
      name: 'E2E bad dates',
      projectId,
      startDate: day(50),
      targetDate: day(40),
    });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  });

  await check('module assignment is independent of cycle assignment', async () => {
    // issueA is already in a cycle — putting it in a module must not disturb that.
    const r = await req('POST', `/modules/${moduleId}/issues`, {
      issueIds: [issueA],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.assigned, 1);

    const issue = await req('GET', `/issues/${issueA}`);
    assert.ok(issue.data.moduleId, 'moduleId not set');
    assert.ok(issue.data.cycleId, 'cycle assignment was clobbered by the module');
  });

  await check('moduleId=none excludes items already in a module', async () => {
    const r = await req(
      'GET',
      `/issues?projectId=${projectId}&moduleId=none&limit=200`,
    );
    assert.equal(r.status, 200);
    assert.ok(
      !r.data.items.map((i) => i._id).includes(issueA),
      'a module member leaked into the module backlog',
    );
  });

  await check('module progress counts a done item', async () => {
    const r = await req('GET', `/modules/${moduleId}`);
    assert.equal(r.data.progress.total, 1, JSON.stringify(r.data.progress));
    assert.equal(r.data.progress.completed, 1, JSON.stringify(r.data.progress));
  });

  await check('update changes the stored status', async () => {
    const r = await req('PATCH', `/modules/${moduleId}`, { status: 'paused' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'paused');
  });

  await check('list?status= filters modules', async () => {
    const r = await req('GET', `/modules?projectId=${projectId}&status=paused`);
    assert.equal(r.status, 200);
    assert.ok(
      r.data.every((m) => m.status === 'paused'),
      JSON.stringify(r.data.map((m) => m.status)),
    );
  });

  // ── Isolation (ADR 0003–0006) ────────────────────────────────────
  console.log('\nIsolation');

  const dave = await session('dave@test.com');

  await check('a non-member gets 404 on a cycle, not 403', async () => {
    const r = await dave('GET', `/cycles/${currentCycle}`);
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
  });

  await check('a non-member gets 404 on a module', async () => {
    const r = await dave('GET', `/modules/${moduleId}`);
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
  });

  await check("a non-member's cycle list excludes the project", async () => {
    const r = await dave('GET', '/cycles');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ids = r.data.map((c) => c._id);
    assert.ok(!ids.includes(currentCycle), 'cycle leaked to a non-member');
  });

  await check('a non-member cannot create a cycle in the project', async () => {
    const r = await dave('POST', '/cycles', { name: 'E2E intruder', projectId });
    assert.ok(
      r.status === 403 || r.status === 404,
      `expected 403/404, got ${r.status}`,
    );
  });

  await check('a non-member cannot assign into a cycle', async () => {
    const r = await dave('POST', `/cycles/${currentCycle}/issues`, {
      issueIds: [issueB],
    });
    assert.ok(
      r.status === 403 || r.status === 404,
      `expected 403/404, got ${r.status}`,
    );
  });

  await check('a bad id is a clean 404, not a 500', async () => {
    assert.equal((await req('GET', '/cycles/not-an-id')).status, 404);
    assert.equal((await req('GET', '/modules/not-an-id')).status, 404);
  });

  // ── Cleanup ──────────────────────────────────────────────────────
  for (const id of made.modules) await req('DELETE', `/modules/${id}`);
  for (const id of made.cycles) await req('DELETE', `/cycles/${id}`);
  for (const id of made.issues) await req('DELETE', `/issues/${id}`);
  // The fixture project last — it owns everything above.
  await req('DELETE', `/projects/${projectId}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
