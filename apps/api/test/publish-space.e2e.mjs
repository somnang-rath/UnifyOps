#!/usr/bin/env node
/**
 * Phase 8 workstream A suite — publishing views and projects to the public
 * Space (ADR 0012). Drives a running stack over HTTP; needs the E2E fixture
 * (test-seed.ts: alice owns acme + the "Website Redesign" project with bob and
 * carol as members, dave is beta-only, password test1234).
 *
 *   node apps/api/test/publish-space.e2e.mjs
 *
 * Env: API_URL (default http://localhost:4000/api/v1), TEST_PASSWORD.
 * Mind the 5/min login throttle: this suite performs three logins
 * (alice + bob + dave).
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

/** An independent logged-in session (own token/cookie jar). */
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

/** Anonymous request — the public Space path carries no credentials at all. */
async function pub(pathname) {
  const res = await fetch(`${API}${pathname}`);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

/** The exact public issue whitelist (ADR 0012 §5, LOCKED). */
const ISSUE_WHITELIST = new Set([
  'title',
  'status',
  'priority',
  'type',
  'labels',
  'dueDate',
  'updatedAt',
]);
const FORBIDDEN_ISSUE_FIELDS = [
  '_id',
  'id',
  'assigneeId',
  'authorId',
  'desc',
  'comments',
  'todos',
  'parentId',
  'projectId',
];

function assertPublicIssueShape(issues, label) {
  assert.ok(Array.isArray(issues), `${label}: issues is not an array`);
  assert.ok(issues.length <= 200, `${label}: issue cap of 200 exceeded (${issues.length})`);
  for (const [i, issue] of issues.entries()) {
    for (const f of FORBIDDEN_ISSUE_FIELDS) {
      assert.ok(
        !(f in issue),
        `${label}: issue[${i}] leaked private field "${f}": ${JSON.stringify(issue)}`,
      );
    }
    for (const key of Object.keys(issue)) {
      assert.ok(
        ISSUE_WHITELIST.has(key),
        `${label}: issue[${i}] has non-whitelisted field "${key}"`,
      );
    }
    assert.ok(typeof issue.title === 'string', `${label}: issue[${i}] missing title`);
  }
}

async function main() {
  console.log(`\nPublish-to-Space suite (ADR 0012) → ${API}\n`);

  const alice = await session('alice@test.com');
  const bob = await session('bob@test.com');
  const dave = await session('dave@test.com');

  // ── Setup: alice's own project in acme (she owns "Website Redesign") ──
  const me = await alice('GET', '/auth/me');
  assert.equal(me.status, 200, 'alice /auth/me failed');
  const aliceId = me.data.id ?? me.data._id;

  const ws = await alice('GET', '/workspaces');
  const acme = (ws.data ?? []).find?.((w) => w.slug === 'acme');
  assert.ok(acme, `acme not in alice's workspaces: ${JSON.stringify(ws.data)?.slice(0, 200)}`);
  const acmeId = acme._id ?? acme.id;

  const projects = await alice('GET', `/projects?workspace=${acmeId}`);
  assert.equal(projects.status, 200);
  const owned = (projects.data ?? [])
    .filter((p) => String(p.ownerId) === String(aliceId))
    .sort((a, b) => (b.issueCount ?? 0) - (a.issueCount ?? 0));
  assert.ok(owned.length > 0, 'alice owns no acme project — fixture drift?');
  const project = owned[0];
  const projectId = String(project._id ?? project.id);
  assert.ok(
    (project.issueCount ?? 0) > 0,
    `alice's project "${project.name}" has no issues — fixture drift?`,
  );

  // ── View publishing ────────────────────────────────────────────────
  let viewId;
  await check('alice creates a project-scoped kanban view', async () => {
    const res = await alice('POST', '/views', {
      name: 'Public board (ADR 0012 e2e)',
      projectId,
      layout: 'kanban',
      groupBy: 'status',
      sortBy: 'updatedAt:desc',
      filters: {},
    });
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    viewId = res.data._id;
  });

  await check('dave (other workspace) cannot publish alice\'s view → 403/404', async () => {
    const res = await dave('POST', `/views/${viewId}/publish`);
    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}: ${JSON.stringify(res.data)}`,
    );
  });

  let viewAnchor;
  await check('alice publishes the view → { anchor, isPublic, publishedAt }', async () => {
    const res = await alice('POST', `/views/${viewId}/publish`);
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.anchor, 'no anchor minted');
    assert.equal(res.data.isPublic, true);
    assert.ok(res.data.publishedAt, 'no publishedAt');
    viewAnchor = res.data.anchor;
  });

  let viewPayload;
  await check('public anchor resolves the view with ONLY whitelisted issue fields', async () => {
    const res = await pub(`/public/anchor/${viewAnchor}`);
    assert.equal(res.status, 200, `got ${res.status}: ${JSON.stringify(res.data)}`);
    viewPayload = res.data;
    assert.equal(res.data.type, 'view');
    assert.equal(res.data.anchor, viewAnchor);
    assert.equal(res.data.title, 'Public board (ADR 0012 e2e)');
    assert.equal(res.data.layout, 'kanban');
    assert.equal(res.data.groupBy, 'status');
    assert.ok(res.data.issues.length > 0, 'expected the seeded project issues');
    assertPublicIssueShape(res.data.issues, 'view payload');
  });

  await check('view payload leaks no ids/members outside issues either', async () => {
    for (const f of ['projectId', 'workspaceId', 'ownerId', 'publishedBy', '_id', 'members', 'filters']) {
      assert.ok(!(f in viewPayload), `view payload leaked "${f}"`);
    }
  });

  await check('kanban view payload carries board columns without wipLimit', async () => {
    const cols = viewPayload.columns;
    assert.ok(Array.isArray(cols) && cols.length > 0, 'no columns on kanban view');
    for (const c of cols) {
      assert.deepEqual(
        Object.keys(c).sort(),
        ['color', 'id', 'name'],
        `column has extra/missing fields: ${JSON.stringify(c)}`,
      );
    }
  });

  await check('issues respect the view sort (updatedAt desc) and the 200 cap', async () => {
    const issues = viewPayload.issues;
    assert.ok(issues.length <= 200, `cap exceeded: ${issues.length}`);
    const times = issues.map((i) => new Date(i.updatedAt).getTime());
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(
        times[i] <= times[i - 1],
        `issues not sorted updatedAt:desc at index ${i}`,
      );
    }
  });

  await check('re-publishing the view reuses the same anchor', async () => {
    const res = await alice('POST', `/views/${viewId}/publish`);
    assert.equal(res.status, 201, `got ${res.status}`);
    assert.equal(res.data.anchor, viewAnchor, 'anchor changed on re-publish');
  });

  let wsViewId;
  await check('publishing a workspace-level view → 400', async () => {
    const create = await alice('POST', '/views', {
      name: 'WS-level view (ADR 0012 e2e)',
      workspaceId: acmeId,
      layout: 'list',
    });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    wsViewId = create.data._id;
    const res = await alice('POST', `/views/${wsViewId}/publish`);
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.data)}`);
  });

  await check('unpublish → public 404, indistinguishable from never-existed', async () => {
    const un = await alice('POST', `/views/${viewId}/unpublish`);
    assert.equal(un.status, 201, `got ${un.status}: ${JSON.stringify(un.data)}`);
    assert.equal(un.data.isPublic, false);

    const gone = await pub(`/public/anchor/${viewAnchor}`);
    assert.equal(gone.status, 404, `unpublished anchor still resolves: ${gone.status}`);
    const never = await pub('/public/anchor/never-existed-deadbeefcafe');
    assert.equal(never.status, 404);
    // The global exception filter echoes the request path and a timestamp on
    // every error — those legitimately differ per request and carry no
    // existence signal. Everything else must be identical.
    const strip = ({ path: _p, timestamp: _t, ...rest }) => rest;
    assert.deepEqual(
      strip(gone.data),
      strip(never.data),
      `404 bodies differ (existence leak): ${JSON.stringify(gone.data)} vs ${JSON.stringify(never.data)}`,
    );
  });

  // ── Project publishing ─────────────────────────────────────────────
  await check('bob (member, non-owner) cannot publish alice\'s project → 403', async () => {
    const res = await bob('POST', `/projects/${projectId}/publish`);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
  });

  await check('dave (other workspace) cannot publish alice\'s project → 403/404', async () => {
    const res = await dave('POST', `/projects/${projectId}/publish`);
    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}: ${JSON.stringify(res.data)}`,
    );
  });

  let projectAnchor;
  await check('alice (owner) publishes the project → { anchor, isPublic, publishedAt }', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`);
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.anchor, 'no anchor minted');
    assert.equal(res.data.isPublic, true);
    assert.ok(res.data.publishedAt, 'no publishedAt');
    projectAnchor = res.data.anchor;
  });

  await check('public anchor resolves the project as a default kanban board', async () => {
    const res = await pub(`/public/anchor/${projectAnchor}`);
    assert.equal(res.status, 200, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.type, 'project');
    assert.equal(res.data.anchor, projectAnchor);
    assert.equal(res.data.title, project.name);
    assert.equal(res.data.layout, 'kanban');
    assert.equal(res.data.groupBy, 'status');
    assert.ok(Array.isArray(res.data.columns) && res.data.columns.length > 0, 'no columns');
    for (const c of res.data.columns) {
      assert.deepEqual(
        Object.keys(c).sort(),
        ['color', 'id', 'name'],
        `column has extra/missing fields: ${JSON.stringify(c)}`,
      );
    }
    assert.ok(res.data.issues.length > 0, 'expected the seeded project issues');
    assertPublicIssueShape(res.data.issues, 'project payload');
    for (const f of ['ownerId', 'members', 'workspaceId', 'desc', 'overview', '_id', 'publishedBy']) {
      assert.ok(!(f in res.data), `project payload leaked "${f}"`);
    }
  });

  await check('re-publishing the project reuses the same anchor', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`);
    assert.equal(res.status, 201, `got ${res.status}`);
    assert.equal(res.data.anchor, projectAnchor, 'anchor changed on re-publish');
  });

  await check('project unpublish → public 404', async () => {
    const un = await alice('POST', `/projects/${projectId}/unpublish`);
    assert.equal(un.status, 201, `got ${un.status}: ${JSON.stringify(un.data)}`);
    assert.equal(un.data.isPublic, false);
    const gone = await pub(`/public/anchor/${projectAnchor}`);
    assert.equal(gone.status, 404, `unpublished project still resolves: ${gone.status}`);
  });

  // ── Per-page crawler indexing (docs/plan/01 §3.4) ───────────────────
  // "Published" and "indexed" are separate decisions; until this landed the
  // only control was the instance-wide SPACE_INDEXING env var. The public
  // payload carries `indexable`, and apps/space turns it into <meta robots>.
  await check('a freshly published page is indexable by default', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`);
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.indexing, true, 'default should be indexable');
    const got = await pub(`/public/anchor/${projectAnchor}`);
    assert.equal(got.status, 200);
    assert.equal(got.data.indexable, true, 'public payload lost `indexable`');
  });

  await check('publishing with { indexing: false } makes it noindex', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`, {
      indexing: false,
    });
    assert.equal(res.status, 201, `got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.indexing, false);
    const got = await pub(`/public/anchor/${projectAnchor}`);
    assert.equal(got.status, 200, 'noindex must not affect reachability');
    assert.equal(got.data.indexable, false, 'public payload still says indexable');
  });

  await check('re-publishing without the flag preserves noindex', async () => {
    // Publishing is idempotent — an owner re-publishes to refresh, and that
    // must not silently re-open the page to crawlers.
    const res = await alice('POST', `/projects/${projectId}/publish`);
    assert.equal(res.status, 201);
    assert.equal(res.data.indexing, false, 're-publish reset the indexing flag');
  });

  await check('{ indexing: true } turns it back on', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`, {
      indexing: true,
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.indexing, true);
  });

  await check('a non-boolean indexing value is rejected (400)', async () => {
    const res = await alice('POST', `/projects/${projectId}/publish`, {
      indexing: 'yes',
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  });

  // ── Cleanup ────────────────────────────────────────────────────────
  if (viewId) await alice('DELETE', `/views/${viewId}`);
  if (wsViewId) await alice('DELETE', `/views/${wsViewId}`);
  if (projectId) await alice('POST', `/projects/${projectId}/unpublish`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
