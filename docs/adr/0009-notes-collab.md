# ADR 0009 — Notes Collaborative Editing (extends ADR 0001)

- Status: Accepted (GATE — build against this)
- Date: 2026-07-22
- Scope: **notes only**. This *extends* the LOCKED ADR 0001 wiki-collab contract — ADR 0001 §2
  pre-reserved the `notes:<id>` documentName namespace, so nothing in 0001 is reopened.
- Owners of build: `prism-realtime` (live routing), `prism-backend` (internal endpoints, schema,
  migration), `prism-frontend` (note page → `CollaborativeEditor`, seeding).

## Context

Notes (`apps/api/src/modules/notes`) store content as a legacy `blocks[]` array
(`text | heading | check | code | image | video | divider | table | file`) on `Note`, which has
`ownerId` + optional `folderId` — **no** `projectId`. Sharing exists today at the **folder**
level: `NoteFolder.grants[]` (per `userId` or per `role`, level `read | upload | edit`), enforced
by `NotesService.byId` (read) and `canMutateNote` (write). Editing is last-write-wins via
`PUT /notes/:id`. We want wiki-parity collaboration: Yjs over `apps/live`, snapshot-back, shared
`editorExtensions`. Everything not restated here (topology, `YjsDocument` collection, debounce,
env vars, CORS, fail-closed rules) is inherited from ADR 0001 verbatim.

## Decision

### 1. `documentName` grammar

Add **`notes:<noteId>`** (`^notes:[0-9a-f]{24}$`) to the live server's accept list, alongside
`wiki:`. `apps/live/src/auth.ts` replaces `parseWikiDocumentName` with a prefix-dispatching
parser returning `{ kind: 'wiki' | 'notes', id }`; `ConnectionContext` carries `{ docKind, docId }`
(replacing the wiki-specific `wikiPageId`). Anything else is rejected at `onAuthenticate`.

### 2. Authorization — **folder-grant rules, not owner-only**

Owner-only was considered and **rejected**: notes already have a sharing model (folder grants).
Hardcoding owner-only in live would break shared-folder notes and duplicate authz — the exact
drift ADR 0001 §1 forbids. Instead live delegates, same as wiki:

```
GET /api/v1/internal/notes/:id/access?userId=<sub>
Header: x-internal-token: <LIVE_INTERNAL_TOKEN>
→ 200 { canRead: boolean, canWrite: boolean }   (404 → reject)
```

Semantics (new `NotesService.accessFor(userId, noteId)`, reusing the existing private rules —
the API loads the user's `role` itself, since grants can be role-based):

- `canRead` = the `byId` rule: note owner, **or** `read+` grant on the containing folder.
- `canWrite` = the `canMutateNote` rule: folder owner / `edit` grant; `upload` grant only if
  also the note's owner; root notes (`folderId: null`) → owner only.

`canWrite=false` → read-only Hocuspocus connection; `canRead=false`/404/non-200 → reject
(fail closed). Lives in a new `InternalNotesController` (`@Public()` + `@SkipThrottle()` +
`InternalTokenGuard`, mirroring `internal-wiki.controller.ts`).

### 3. Schema + one-time `blocks[]` → HTML migration

`Note` gains (aligning with wiki's `content: string` HTML representation):

```ts
@Prop({ default: '' })  contentHTML: string;      // seed source + snapshot target
@Prop({ default: false }) migratedToDoc: boolean; // one-time conversion done
```

**Conversion is lazy and server-side**: when `NotesService.byId` loads a note with
`migratedToDoc: false`, it renders `blocks[]` → HTML (util below), persists `contentHTML`, sets
`migratedToDoc: true`. Idempotent, one write per note, ever. `blocks[]` is **retained** as an
archival/rollback copy — never deleted in v1, and `update()` ignores `dto.blocks` once
`migratedToDoc` is true (contentHTML is then authoritative via the snapshot path).

**Client seeds the Yjs fragment** exactly per ADR 0001 §3: on first mount, if the shared XML
fragment is empty, load `contentHTML` (from `GET /notes/:id`) into Tiptap once, guarded by the
"seed only if fragment empty" rule.

Block → HTML mapping (matches `notes-pdf.service.ts` semantics; all values escaped):

| Block | HTML | Extension |
|---|---|---|
| `text` | `<p>…</p>`, `\n` → `<br>` (hardBreak); empty → empty `<p>` | StarterKit |
| `heading` | `<h2>…</h2>` (blocks have no level) | StarterKit |
| `check` (consecutive run merged into one list) | `<ul data-type="taskList"><li data-type="taskItem" data-checked="true\|false"><p>…</p></li></ul>` | **NEW** TaskList + TaskItem |
| `code` | `<pre><code class="language-{lang}">…</code></pre>` | StarterKit |
| `divider` | `<hr>` | StarterKit |
| `image` | `<img src="{value}">` | **NEW** Image |
| `video` | `<p><a href="{value}">{value}</a></p>` (link fallback, same as PDF) | **NEW** Link |
| `table` | `<table><tbody><tr><th\|td><p>…</p>…` (`headerRow` → first row `<th>`) | **NEW** Table + TableRow + TableHeader + TableCell |
| `file` | `<p>📎 <a href="{API}/files/{fileId}/download">{value \|\| 'File attachment'}</a></p>` | **NEW** Link |
| `color` attr | **dropped** (accepted loss in v1; no TextStyle/Color) | — |

**Shared-array additions (the ADR 0001 consequence bites here).** These land in the canonical
`editorExtensions` in `packages/editor/src/extensions.ts` **and** in the byte-for-byte copy
`apps/live/src/editor-extensions.ts` (documented invariant in `apps/live/src/snapshot.ts`) —
miss either and live's snapshots silently drop those nodes:

```
TaskList, TaskItem,
Table, TableRow, TableHeader, TableCell,
Image, Link.configure({ openOnClick: false })
```

Side effect, deliberate: the wiki editor gains task lists / tables / images / links (schema is
shared). Purely additive — existing wiki HTML is unaffected.

### 4. Snapshot-back

Same hook and debounce as ADR 0001 §4; `apps/live/src/snapshot.ts` dispatches by doc kind:

```
PUT /api/v1/internal/notes/:id/content
Header: x-internal-token: <LIVE_INTERNAL_TOKEN>
Body:   { content: string, editedBy?: string }      (Zod-validated)
→ 200 { ok: true, updatedAt: string } · 401 bad token · 404 note gone
```

`NotesService.snapshotContent(id, html, editedBy?)` writes **only** `contentHTML` (+`updatedAt`);
machine write — no notifications, no `blocks[]` touch. PDF export renders from `contentHTML`
when `migratedToDoc`, else from `blocks[]`.

### 5. Collab token

No change to `AuthService.mintCollabToken` or live's `verifyCollabToken` — the `doc` claim
equality check is prefix-agnostic. New mint endpoint mirroring the wiki one:

```
POST /api/v1/notes/:id/collab-token   (JWT-authenticated)
→ 200 { token, expiresIn, canWrite }  · 403 if !canRead (via NotesService.accessFor)
```

Token: `aud=collab`, `doc="notes:<id>"`, 5-min TTL, useless on the REST API. Live's periodic
re-auth (`reauth.ts`) works unchanged.

### 6. Scope — v1

- **In:** collaborative editing + basic presence (Yjs awareness avatar stack + remote carets —
  already built into `CollaborativeEditor`; notes gets it for free).
- **UI:** the legacy block editor on the note page is **replaced** by `CollaborativeEditor`
  (wiki parity: same chrome, save-state, presence). The block editor component is removed from
  the note route; no dual-mode editing.
- **DEFERRED:** version history; per-note (not folder) sharing; color/text-style fidelity;
  `video` as an embedded player node.

### 7. Rollout / compatibility

- First open post-deploy: `GET /notes/:id` lazily migrates (§3) → client mounts
  `CollaborativeEditor`, mints a collab token, seeds the empty fragment from `contentHTML`.
  Thereafter Yjs is authoritative; snapshots keep `contentHTML` fresh (eventually consistent
  within the debounce window — same caveat as wiki).
- Old/non-migrated clients would render stale `blocks[]`; acceptable because web and api deploy
  atomically from this monorepo. `blocks[]` stays as a rollback escape hatch (rollback loses
  edits made after migration — documented, accepted).
- No live env changes: grammar and routing are code-level; `LIVE_INTERNAL_TOKEN`,
  `INTERNAL_API_URL`, origins all reused.

## Consequences

- The shared extension array grows by 8 extensions in **two places** (package + live copy);
  keeping them identical remains a manual invariant until live can import `@prism/editor/server`.
- Adding Table/TaskList/Image/Link changes the wiki editing surface too — coordinate a toolbar
  pass with `prism-uiux` (out of scope for this ADR's contract).
- `blocks[]` becomes write-frozen after migration; any straggler code writing blocks must be
  routed through the editor or dropped.

## Interfaces frozen by this ADR

- WS: `HocuspocusProvider({ url, name: "notes:<24-hex>", token })`; live accept-list = `^(wiki|notes):[0-9a-f]{24}$`
- Authz: `GET /api/v1/internal/notes/:id/access?userId=<sub>` (x-internal-token) → `{ canRead, canWrite }` per §2 folder-grant rules
- Snapshot: `PUT /api/v1/internal/notes/:id/content` (x-internal-token) `{ content, editedBy? }` → `{ ok, updatedAt }`
- Mint: `POST /api/v1/notes/:id/collab-token` → `{ token, expiresIn, canWrite }` (`doc: "notes:<id>"`, aud=collab)
- Schema: `Note.contentHTML: string = ''`, `Note.migratedToDoc: boolean = false`; `blocks[]` retained read-only
- Extensions added to the shared array (both copies): `TaskList, TaskItem, Table, TableRow, TableHeader, TableCell, Image, Link({ openOnClick: false })`
