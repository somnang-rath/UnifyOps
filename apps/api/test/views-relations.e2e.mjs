#!/usr/bin/env node
/**
 * Phase 7 suite — saved views, sub-issues, and issue relations
 * (docs/plan/03-feature-parity.md §1–2), plus the Phase 7b workspace-seam
 * isolation checks (ADR 0011: `workspaceId` list params, calendar scoping,
 * wiki read gate). Drives a running stack over HTTP; needs the E2E fixture
 * (test-seed.ts: alice owns acme, dave is beta-only, password test1234).
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

/**
 * An independent logged-in session (own token/cookie jar) for the Phase 7b
 * isolation checks, which need more than one identity. Mind the 5/min login
 * throttle: this suite performs three logins total (admin + alice + dave).
 */
async function session(email) {
  const sjar = new Map();
  let stoken = '';
  let scsrf = '';
  async function sreq(method, pathname, body) {
    const cookie = [...sjar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(stoken ? { Authorization: `Bearer ${stoken}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(scsrf ? { 'X-CSRF-Token': scsrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      sjar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 204 */
    }
    return { status: res.status, data };
  }
  const login = await sreq('POST', '/auth/login', {
    email,
    password: PASSWORD,
    audience: 'web',
  });
  assert.equal(
    login.status,
    200,
    `login ${email} failed: ${JSON.stringify(login.data)} — is the E2E fixture seeded?`,
  );
  stoken = login.data.accessToken;
  scsrf = sjar.get('prism_csrf') ?? '';
  return sreq;
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

  // ── Phase 7b: workspace seam (ADR 0011) ──────────────────────────
  // Fixture semantics: alice owns workspace `acme` + a project in it; dave is
  // in `beta` only, so acme is foreign tenant territory for him.
  const alice = await session('alice@test.com');
  const dave = await session('dave@test.com');

  let acmeId;
  let acmeProjectIds = new Set();
  await check('alice resolves acme and her readable acme projects', async () => {
    const ws = await alice('GET', '/workspaces');
    const acme = (ws.data ?? []).find?.((w) => w.slug === 'acme');
    assert.ok(acme, `acme not in alice's workspaces: ${JSON.stringify(ws.data)?.slice(0, 200)}`);
    acmeId = acme._id ?? acme.id;
    const projects = await alice('GET', `/projects?workspace=${acmeId}`);
    assert.equal(projects.status, 200);
    acmeProjectIds = new Set(
      (projects.data ?? []).map((p) => String(p._id ?? p.id)),
    );
    assert.ok(acmeProjectIds.size > 0, 'alice has no readable acme projects');
  });

  await check('GET /issues?workspaceId=<acme> (alice) → only acme-project issues', async () => {
    const res = await alice('GET', `/issues?workspaceId=${acmeId}`);
    assert.equal(res.status, 200);
    const items = res.data.items ?? [];
    assert.ok(items.length > 0, 'expected seeded acme issues for alice');
    for (const it of items) {
      assert.ok(it.projectId, `personal issue leaked into workspace view: ${it._id}`);
      assert.ok(
        acmeProjectIds.has(String(it.projectId)),
        `issue ${it._id} from foreign project ${it.projectId}`,
      );
    }
  });

  await check('GET /issues?workspaceId=<acme> (dave, non-member) → []', async () => {
    const res = await dave('GET', `/issues?workspaceId=${acmeId}`);
    assert.equal(res.status, 200);
    assert.equal(
      (res.data.items ?? []).length,
      0,
      'non-member received workspace issues',
    );
  });

  const iso = (d) => d.toISOString().slice(0, 10);
  const now = Date.now();
  const from = iso(new Date(now - 1 * 24 * 3600 * 1000));
  const to = iso(new Date(now + 40 * 24 * 3600 * 1000));

  let acmeDatedIssueId;
  await check('calendar range with workspaceId=<acme> (alice) → acme issues only', async () => {
    const res = await alice(
      'GET',
      `/issues/calendar/range?from=${from}&to=${to}&workspaceId=${acmeId}`,
    );
    assert.equal(res.status, 200);
    assert.ok(
      Array.isArray(res.data) && res.data.length > 0,
      'expected dated acme issues (the fixture seeds dueDates)',
    );
    for (const it of res.data) {
      assert.ok(
        it.projectId && acmeProjectIds.has(String(it.projectId)),
        `foreign issue in workspace calendar: ${it._id}`,
      );
    }
    acmeDatedIssueId = String(res.data[0]._id);
  });

  await check('calendar range without params (dave) no longer leaks foreign tenants', async () => {
    const res = await dave('GET', `/issues/calendar/range?from=${from}&to=${to}`);
    assert.equal(res.status, 200);
    assert.ok(
      !res.data.some((it) => String(it._id) === acmeDatedIssueId),
      'acme issue visible to dave with no workspace filter (calendar leak)',
    );
  });

  await check('GET /activity?workspaceId=<acme> (dave) → []', async () => {
    const res = await dave('GET', `/activity?workspaceId=${acmeId}`);
    assert.equal(res.status, 200);
    assert.equal((res.data ?? []).length, 0, 'non-member received workspace activity');
  });

  await check('GET /wiki with neither projectId nor workspaceId → 400', async () => {
    const res = await alice('GET', '/wiki');
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  let acmeWikiPageId;
  await check('GET /wiki?workspaceId=<acme> (alice) → readable acme pages only', async () => {
    const res = await alice('GET', `/wiki?workspaceId=${acmeId}`);
    assert.equal(res.status, 200);
    assert.ok(
      Array.isArray(res.data) && res.data.length > 0,
      'expected seeded acme wiki pages',
    );
    for (const p of res.data) {
      assert.ok(
        acmeProjectIds.has(String(p.projectId)),
        `page ${p._id} from unreadable/foreign project ${p.projectId}`,
      );
    }
    acmeWikiPageId = String(res.data[0]._id);
  });

  await check('GET /wiki?workspaceId=<acme> (dave) → []', async () => {
    const res = await dave('GET', `/wiki?workspaceId=${acmeId}`);
    assert.equal(res.status, 200);
    assert.equal((res.data ?? []).length, 0, 'non-member received workspace wiki pages');
  });

  await check('GET /wiki/:id → 404 for a stranger, 200 for a reader', async () => {
    const mine = await alice('GET', `/wiki/${acmeWikiPageId}`);
    assert.equal(mine.status, 200, `alice cannot read her own page: ${mine.status}`);
    const res = await dave('GET', `/wiki/${acmeWikiPageId}`);
    assert.equal(res.status, 404, `expected 404 for stranger, got ${res.status}`);
  });

  // ── Automations are workspace rules, not personal ones ───────────
  // Regression (06-differentiators.md §1.4): `Automation` had no workspaceId
  // and the engine matched *every* enabled rule in the instance, so a rule
  // written in acme re-labelled, re-assigned and re-statused issues in beta and
  // notified people who could not read them. Lives here, not in the security
  // suite, because it reuses this suite's two-tenant fixture (alice ↔ acme,
  // dave ↔ beta) and its already-spent logins.
  const probeLabel = `au-probe-${Date.now()}`;
  let ruleId;
  let acmeProjectId;
  let betaProjectId;

  await check('an automation is created into a workspace', async () => {
    acmeProjectId = [...acmeProjectIds][0];
    // Dave owns `Data Pipeline` in beta — a project alice's rule must never reach.
    const daveProjects = await dave('GET', '/projects');
    betaProjectId = String(
      (daveProjects.data ?? []).find((p) => p.name === 'Data Pipeline')?._id ??
        (daveProjects.data ?? [])[0]?._id ??
        '',
    );
    assert.ok(betaProjectId, 'dave has no readable project to write a beta issue into');

    const res = await alice('POST', '/automations', {
      workspaceId: acmeId,
      name: 'E2E probe',
      trigger: 'issue.created',
      action: { type: 'add_label', value: probeLabel },
    });
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(String(res.data.workspaceId), String(acmeId), 'workspaceId not stored');
    ruleId = res.data._id;
  });

  await check('creating a rule in a foreign workspace is a 404', async () => {
    const res = await dave('POST', '/automations', {
      workspaceId: acmeId,
      name: 'dave should not be able to write this',
      trigger: 'issue.created',
      action: { type: 'add_label', value: 'nope' },
    });
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  });

  await check('a rule without a workspaceId is rejected', async () => {
    const res = await alice('POST', '/automations', {
      name: 'homeless',
      trigger: 'issue.created',
      action: { type: 'add_label', value: 'nope' },
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  await check('a non-member can neither list, read, edit nor delete the rule', async () => {
    const list = await dave('GET', '/automations');
    assert.equal(list.status, 200);
    assert.ok(
      !(list.data ?? []).some((a) => String(a._id) === String(ruleId)),
      'a foreign workspace’s rule appeared in the list',
    );
    for (const [method, body] of [
      ['GET', undefined],
      ['PATCH', { enabled: false }],
      ['DELETE', undefined],
    ]) {
      const res = await dave(method, `/automations/${ruleId}`, body);
      assert.equal(res.status, 404, `${method} /automations/:id gave ${res.status}, expected 404`);
    }
  });

  await check('the engine has no HTTP route', async () => {
    // `POST /automations/fire` used to run every matching rule in the instance
    // against a caller-supplied payload — arbitrary issue mutation plus an
    // outbound webhook, from any logged-in account.
    const res = await alice('POST', '/automations/fire', {
      trigger: 'issue.created',
      payload: { issueId: acmeDatedIssueId, projectId: acmeProjectId },
    });
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  });

  await check('the rule fires on its own workspace, never on another', async () => {
    // fire() is deliberately not awaited by the issue create path, so poll.
    const labelled = async (issueId, who) => {
      for (let i = 0; i < 20; i += 1) {
        const got = await who('GET', `/issues/${issueId}`);
        if ((got.data?.labels ?? []).includes(probeLabel)) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    const foreign = await dave('POST', '/issues', {
      title: 'beta issue — acme rules must not touch this',
      projectId: betaProjectId,
    });
    assert.equal(foreign.status, 201, JSON.stringify(foreign.data));

    const own = await alice('POST', '/issues', {
      title: 'acme issue — the rule should label this',
      projectId: acmeProjectId,
    });
    assert.equal(own.status, 201, JSON.stringify(own.data));

    assert.ok(
      await labelled(own.data._id, alice),
      'the rule did not fire inside its own workspace',
    );
    // Checked second and without polling: by now the acme rule has demonstrably
    // run to completion, so a cross-tenant fire would already have landed.
    const foreignGot = await dave('GET', `/issues/${foreign.data._id}`);
    assert.ok(
      !(foreignGot.data?.labels ?? []).includes(probeLabel),
      'an acme rule mutated a beta issue',
    );

    await alice('DELETE', `/issues/${own.data._id}`);
    await dave('DELETE', `/issues/${foreign.data._id}`);
  });

  await check('the creator can delete the rule', async () => {
    const res = await alice('DELETE', `/automations/${ruleId}`);
    assert.equal(res.status, 200, `got ${res.status}`);
    assert.equal((await alice('GET', `/automations/${ruleId}`)).status, 404);
  });

  // ── Bulk operations (Phase 7b; ADR 0011 §4 — body-only selection) ─
  let bulkA, bulkB;
  await check('bulk setup: two personal issues', async () => {
    const a = await req('POST', '/issues', {
      title: 'Bulk A',
      priority: 'low',
      labels: ['keep'],
    });
    const b = await req('POST', '/issues', { title: 'Bulk B', priority: 'low' });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(b.status, 201, JSON.stringify(b.data));
    bulkA = a.data._id;
    bulkB = b.data._id;
  });

  await check('POST /issues/bulk applies one patch to every id', async () => {
    const res = await req('POST', '/issues/bulk', {
      ids: [bulkA, bulkB],
      patch: { status: 'review', priority: 'high' },
    });
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.updated, 2, JSON.stringify(res.data));
    assert.equal(res.data.failed.length, 0, JSON.stringify(res.data.failed));
    for (const id of [bulkA, bulkB]) {
      const got = await req('GET', `/issues/${id}`);
      assert.equal(got.data.status, 'review', `status not applied to ${id}`);
      assert.equal(got.data.priority, 'high', `priority not applied to ${id}`);
    }
  });

  await check('bulk labels add/remove are relative to each issue', async () => {
    const res = await req('POST', '/issues/bulk', {
      ids: [bulkA, bulkB],
      patch: { addLabels: ['triage'], removeLabels: ['gone'] },
    });
    assert.equal(res.data.updated, 2, JSON.stringify(res.data));
    const a = await req('GET', `/issues/${bulkA}`);
    const b = await req('GET', `/issues/${bulkB}`);
    // A had 'keep' before the call — adding must merge, never replace.
    assert.deepEqual([...a.data.labels].sort(), ['keep', 'triage']);
    assert.deepEqual(b.data.labels, ['triage']);
  });

  await check('duplicate ids are collapsed, not applied twice', async () => {
    const res = await req('POST', '/issues/bulk', {
      ids: [bulkA, bulkA, bulkA],
      patch: { type: 'bug' },
    });
    assert.equal(res.data.updated, 1, `de-dupe failed: ${JSON.stringify(res.data)}`);
  });

  await check('an unwritable id fails alone — the batch is partial, not 403', async () => {
    const res = await dave('POST', '/issues/bulk', {
      ids: [bulkA, bulkB],
      patch: { status: 'done' },
    });
    assert.equal(res.status, 201, `expected a 2xx partial result, got ${res.status}`);
    assert.equal(res.data.updated, 0, JSON.stringify(res.data));
    assert.equal(res.data.failed.length, 2, JSON.stringify(res.data.failed));
    // And the write really did not happen.
    const got = await req('GET', `/issues/${bulkA}`);
    assert.equal(got.data.status, 'review', 'a stranger moved someone else’s issue');
  });

  await check('bulk rejects an empty selection and an empty patch', async () => {
    const noIds = await req('POST', '/issues/bulk', {
      ids: [],
      patch: { status: 'todo' },
    });
    assert.equal(noIds.status, 400, `expected 400, got ${noIds.status}`);
    const noPatch = await req('POST', '/issues/bulk', {
      ids: [bulkA],
      patch: {},
    });
    assert.equal(noPatch.status, 400, `expected 400, got ${noPatch.status}`);
  });

  await check('bulk caps the selection at 100 ids', async () => {
    const res = await req('POST', '/issues/bulk', {
      ids: Array.from({ length: 101 }, () => bulkA),
      patch: { status: 'todo' },
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  await check('bulk delete removes only what the caller may remove', async () => {
    const stranger = await dave('POST', '/issues/bulk/delete', { ids: [bulkA] });
    assert.equal(stranger.data.deleted, 0, JSON.stringify(stranger.data));
    assert.equal(stranger.data.failed.length, 1, JSON.stringify(stranger.data));
    assert.equal(
      (await req('GET', `/issues/${bulkA}`)).status,
      200,
      'a stranger deleted someone else’s issue',
    );

    const mine = await req('POST', '/issues/bulk/delete', {
      ids: [bulkA, bulkB],
    });
    assert.equal(mine.data.deleted, 2, JSON.stringify(mine.data));
    assert.equal((await req('GET', `/issues/${bulkA}`)).status, 404);
    assert.equal((await req('GET', `/issues/${bulkB}`)).status, 404);
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
