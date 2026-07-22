#!/usr/bin/env node
/**
 * ADR 0009 — notes collab, apps/api side. Drives a running api over HTTP:
 *
 *   - access matrix via GET /internal/notes/:id/access (folder-grant rules)
 *   - internal endpoints reject a missing/wrong x-internal-token (401)
 *   - PUT /internal/notes/:id/content writes contentHTML only
 *   - POST /notes/:id/collab-token → { token, expiresIn, canWrite },
 *     doc claim `notes:<id>`, aud=collab; 403 without read access
 *   - lazy blocks[] → contentHTML migration on first byId; update() ignores
 *     dto.blocks once migrated
 *
 * Run:  node apps/api/test/notes-collab-api.e2e.mjs
 * Env:  API_URL (default http://localhost:4012/api/v1) — boot a test api on
 *       :4012, never the dev instance. Needs the seeded dev DB (@test.com
 *       users, password test1234). Cleans up everything it creates.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dependency-free .env loader (same as security.e2e.mjs) — we need
// LIVE_INTERNAL_TOKEN to exercise the internal endpoints.
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

const API = process.env.API_URL ?? 'http://localhost:4012/api/v1';
const INTERNAL = process.env.LIVE_INTERNAL_TOKEN;
const PASSWORD = process.env.TEST_PASSWORD ?? 'test1234';

const decodeJwt = (token) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));

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

async function req(method, pathname, { body, token, headers = {} } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

async function login(email) {
  const res = await req('POST', '/auth/login', {
    body: { email, password: PASSWORD, audience: 'web' },
  });
  assert.equal(res.status, 200, `login ${email} failed (${res.status})`);
  return { token: res.data.accessToken, id: decodeJwt(res.data.accessToken).sub };
}

const internalHeaders = { 'x-internal-token': INTERNAL };

async function main() {
  console.log(`\nADR 0009 notes-collab api suite → ${API}\n`);
  assert.ok(INTERNAL, 'LIVE_INTERNAL_TOKEN not found (apps/api/.env)');

  // Cast: owner + read/edit/upload grantees + a stranger (all seed users).
  const owner = await login('alice@test.com');
  const reader = await login('bob@test.com');
  const editor = await login('carol@test.com');
  const uploader = await login('dave@test.com');
  const stranger = await login('eve@test.com');

  const created = { folderId: null, noteIds: [] };
  const cleanup = async () => {
    for (const id of created.noteIds)
      await req('DELETE', `/notes/${id}`, { token: owner.token });
    if (created.folderId)
      await req('DELETE', `/notes/folders/${created.folderId}`, {
        token: owner.token,
      });
  };

  try {
    // ── Fixtures ────────────────────────────────────────────────────
    const folder = await req('POST', '/notes/folders', {
      token: owner.token,
      body: { name: `collab-e2e-${Date.now()}` },
    });
    assert.equal(folder.status, 201, `folder create: ${folder.status}`);
    created.folderId = folder.data._id;

    for (const [who, level] of [
      [reader, 'read'],
      [editor, 'edit'],
      [uploader, 'upload'],
    ]) {
      const g = await req('PUT', `/notes/folders/${created.folderId}/grants`, {
        token: owner.token,
        body: { userId: who.id, level },
      });
      assert.equal(g.status, 200, `grant ${level}: ${g.status}`);
    }

    const blocks = [
      { type: 'text', value: 'Hello world\nsecond line' },
      { type: 'heading', value: 'Section A' },
      { type: 'check', value: 'todo one', checked: false },
      { type: 'check', value: 'todo two', checked: true },
      { type: 'code', value: 'const x = 1;', lang: 'js' },
      { type: 'divider', value: '' },
      { type: 'image', value: 'https://example.com/pic.png' },
      { type: 'video', value: 'https://example.com/v.mp4' },
      {
        type: 'table',
        value: '',
        table: { cols: 2, rows: [['H1', 'H2'], ['a', 'b']], headerRow: true },
      },
      { type: 'file', value: 'spec.pdf', fileId: 'abc123' },
      { type: 'text', value: 'colored text', color: '#ff0000' },
    ];
    const note = await req('POST', '/notes', {
      token: owner.token,
      body: { title: 'collab e2e note', blocks, folderId: created.folderId },
    });
    assert.equal(note.status, 201, `note create: ${note.status}`);
    const noteId = note.data._id;
    created.noteIds.push(noteId);
    assert.equal(note.data.migratedToDoc, false, 'new note starts unmigrated');

    const rootNote = await req('POST', '/notes', {
      token: owner.token,
      body: { title: 'collab e2e root note', blocks: [] },
    });
    assert.equal(rootNote.status, 201, `root note create: ${rootNote.status}`);
    const rootId = rootNote.data._id;
    created.noteIds.push(rootId);

    // ── Access matrix (internal endpoint, ADR §2) ──────────────────
    const access = async (userId, id) =>
      req('GET', `/internal/notes/${id}/access?userId=${userId}`, {
        headers: internalHeaders,
      });

    await check('owner → canRead + canWrite', async () => {
      const r = await access(owner.id, noteId);
      assert.equal(r.status, 200);
      assert.deepEqual(r.data, { canRead: true, canWrite: true });
    });

    await check('read grant → canRead only', async () => {
      const r = await access(reader.id, noteId);
      assert.deepEqual(r.data, { canRead: true, canWrite: false });
    });

    await check('edit grant → canRead + canWrite', async () => {
      const r = await access(editor.id, noteId);
      assert.deepEqual(r.data, { canRead: true, canWrite: true });
    });

    await check('upload grant on someone else’s note → canRead only', async () => {
      const r = await access(uploader.id, noteId);
      assert.deepEqual(r.data, { canRead: true, canWrite: false });
    });

    await check('stranger → no access', async () => {
      const r = await access(stranger.id, noteId);
      assert.deepEqual(r.data, { canRead: false, canWrite: false });
    });

    await check('root note, non-owner → no access', async () => {
      const r = await access(reader.id, rootId);
      assert.deepEqual(r.data, { canRead: false, canWrite: false });
    });

    await check('root note, owner → full access', async () => {
      const r = await access(owner.id, rootId);
      assert.deepEqual(r.data, { canRead: true, canWrite: true });
    });

    await check('missing note → 404', async () => {
      const r = await access(owner.id, 'ffffffffffffffffffffffff');
      assert.equal(r.status, 404);
    });

    // ── Internal endpoints are gated (ADR §2/§4) ───────────────────
    await check('internal access without token → 401', async () => {
      const r = await req('GET', `/internal/notes/${noteId}/access?userId=${owner.id}`);
      assert.equal(r.status, 401);
    });

    await check('internal access with wrong token → 401', async () => {
      const r = await req('GET', `/internal/notes/${noteId}/access?userId=${owner.id}`, {
        headers: { 'x-internal-token': 'not-the-secret' },
      });
      assert.equal(r.status, 401);
    });

    await check('internal snapshot without token → 401', async () => {
      const r = await req('PUT', `/internal/notes/${noteId}/content`, {
        body: { content: '<p>nope</p>' },
      });
      assert.equal(r.status, 401);
    });

    // ── Lazy migration on first byId (ADR §3) ──────────────────────
    let migrated;
    await check('first GET migrates blocks[] → contentHTML', async () => {
      const r = await req('GET', `/notes/${noteId}`, { token: owner.token });
      assert.equal(r.status, 200);
      migrated = r.data;
      assert.equal(migrated.migratedToDoc, true, 'migratedToDoc not set');
      const html = migrated.contentHTML;
      assert.ok(html.includes('<p>Hello world<br>second line</p>'), `text/hardBreak: ${html}`);
      assert.ok(html.includes('<h2>Section A</h2>'), 'heading');
      assert.ok(
        html.includes(
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo one</p></li><li data-type="taskItem" data-checked="true"><p>todo two</p></li></ul>',
        ),
        'consecutive checks merged into one task list',
      );
      assert.ok(html.includes('<pre><code class="language-js">const x = 1;</code></pre>'), 'code');
      assert.ok(html.includes('<hr>'), 'divider');
      assert.ok(html.includes('<img src="https://example.com/pic.png">'), 'image');
      assert.ok(
        html.includes('<p><a href="https://example.com/v.mp4">https://example.com/v.mp4</a></p>'),
        'video link fallback',
      );
      assert.ok(
        html.includes('<table><tbody><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>'),
        'table with header row',
      );
      assert.ok(/📎 <a href="[^"]*\/files\/abc123\/download">spec\.pdf<\/a>/.test(html), 'file link');
      assert.ok(!html.includes('#ff0000') && !html.includes('style='), 'color dropped');
      assert.equal(migrated.blocks.length, blocks.length, 'blocks[] retained');
    });

    await check('second GET does not re-migrate (blocks kept, content stable)', async () => {
      const r = await req('GET', `/notes/${noteId}`, { token: owner.token });
      assert.equal(r.data.contentHTML, migrated.contentHTML);
      assert.equal(r.data.migratedToDoc, true);
    });

    await check('update() ignores dto.blocks once migrated', async () => {
      const r = await req('PATCH', `/notes/${noteId}`, {
        token: owner.token,
        body: { blocks: [{ type: 'text', value: 'SHOULD BE IGNORED' }], title: 'renamed' },
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.title, 'renamed', 'other fields still update');
      assert.equal(r.data.blocks.length, blocks.length, 'blocks[] was overwritten');
      assert.equal(r.data.blocks[0].value, 'Hello world\nsecond line');
    });

    // ── Snapshot-back (ADR §4) ─────────────────────────────────────
    await check('PUT internal content updates contentHTML only', async () => {
      const r = await req('PUT', `/internal/notes/${noteId}/content`, {
        headers: internalHeaders,
        body: { content: '<p>from live</p>', editedBy: owner.id },
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.ok, true);
      assert.ok(!Number.isNaN(Date.parse(r.data.updatedAt)), 'updatedAt is a date');
      const after = await req('GET', `/notes/${noteId}`, { token: owner.token });
      assert.equal(after.data.contentHTML, '<p>from live</p>');
      assert.equal(after.data.blocks.length, blocks.length, 'blocks[] untouched');
    });

    await check('PUT internal content on missing note → 404', async () => {
      const r = await req('PUT', `/internal/notes/ffffffffffffffffffffffff/content`, {
        headers: internalHeaders,
        body: { content: '<p>x</p>' },
      });
      assert.equal(r.status, 404);
    });

    // ── Collab token (ADR §5) ──────────────────────────────────────
    await check('owner mints a collab token with doc claim notes:<id>', async () => {
      const r = await req('POST', `/notes/${noteId}/collab-token`, {
        token: owner.token,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.canWrite, true);
      assert.equal(typeof r.data.expiresIn, 'number');
      const claims = decodeJwt(r.data.token);
      assert.equal(claims.aud, 'collab');
      assert.equal(claims.doc, `notes:${noteId}`);
      assert.equal(claims.sub, owner.id);
    });

    await check('read grantee mints a token with canWrite=false', async () => {
      const r = await req('POST', `/notes/${noteId}/collab-token`, {
        token: reader.token,
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.canWrite, false);
      assert.equal(decodeJwt(r.data.token).doc, `notes:${noteId}`);
    });

    await check('stranger cannot mint a collab token (403)', async () => {
      const r = await req('POST', `/notes/${noteId}/collab-token`, {
        token: stranger.token,
      });
      assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    });

    await check('non-owner cannot mint for a root note (403)', async () => {
      const r = await req('POST', `/notes/${rootId}/collab-token`, {
        token: reader.token,
      });
      assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    });

    await check('collab token is rejected by the REST API (401)', async () => {
      const minted = await req('POST', `/notes/${noteId}/collab-token`, {
        token: owner.token,
      });
      const r = await req('GET', `/notes/${noteId}`, { token: minted.data.token });
      assert.equal(r.status, 401);
    });

    // ── Sharee read path still works end-to-end ────────────────────
    await check('read grantee can GET the note over REST', async () => {
      const r = await req('GET', `/notes/${noteId}`, { token: reader.token });
      assert.equal(r.status, 200);
      assert.equal(r.data.contentHTML, '<p>from live</p>');
    });
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nSuite crashed:', err.message);
  process.exit(1);
});
