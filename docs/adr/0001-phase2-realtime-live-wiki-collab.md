# ADR 0001 — Phase 2: Realtime Live Server for Collaborative Wiki (Yjs / Hocuspocus)

- Status: Accepted (GATE — build against this)
- Date: 2026-07-09
- Scope: **wiki only**. Notes collaboration is explicitly out of scope for Phase 2.
- Owners of build: `prism-realtime` (live server), `prism-backend` (api endpoints + schema), `prism-frontend` (`packages/editor` + apps/web wiring)

## Context

The wiki (`apps/api/src/modules/wiki`) stores HTML in `WikiPage.content` (`schemas/wiki-page.schema.ts`).
Editing today is last-write-wins via `PATCH /api/v1/wiki/:id`. We want real collaborative
editing. Per the principles in `PLANE-CONVERSION-PLAN.md`, collaborative text uses **CRDT (Yjs)**
over a dedicated Hocuspocus server (`apps/live`, :3100), not Socket.io.

This ADR freezes the contract the three build agents implement in parallel. Decisions marked
**LOCKED** were made by the human and are not reopened here — only formalized.

## Decision

### 0. Topology

```
apps/web (:3000) ──WS──► apps/live (:3100)  ◄── local JWT verify (JWT_ACCESS_SECRET)
      │  editor (packages/editor)                    │
      │                                              ├─ Mongo: YjsDocument (state Buffer)
      └─REST─► apps/api (:4000) ◄── internal token ──┘  snapshot-back → wiki.content
```

`apps/live` is a standalone Node process running `@hocuspocus/server` with
`@hocuspocus/extension-database`. It shares Mongo with the API but is **not** a Nest module.

### 1. Auth flow — `onAuthenticate({ token, documentName })`

**LOCKED: authentication = local JWT verify** with the shared `JWT_ACCESS_SECRET`. No API
round-trip for *authentication*. This mirrors `apps/api/.../auth/strategies/jwt.strategy.ts`,
which signs `{ sub, email, role }` and accepts the token via the `t` URL query param.

Steps inside `onAuthenticate`:

1. Read `token` (Hocuspocus passes the client-supplied token; client sends it — see §2/§5).
2. `jwt.verify(token, JWT_ACCESS_SECRET)` with `ignoreExpiration: false`.
   On failure throw → Hocuspocus rejects the connection (client sees auth error).
3. Extract `{ sub, role }` from the payload (`email` is not needed for authz).
4. Parse `documentName` (§2). Reject if it is not `wiki:<24-hex ObjectId>`.
5. **Authorization** for whether `sub` may open this `wiki:<pageId>`:

   **DECISION: authorization is a REST check to the API, not a local rule.**

   `onAuthenticate` calls the API:
   ```
   GET /api/v1/internal/wiki/:id/access?userId=<sub>
   Header: x-internal-token: <LIVE_INTERNAL_TOKEN>
   → 200 { canRead: boolean, canWrite: boolean }   (404 → reject)
   ```
   - `canWrite === false` → return `{ user, readOnly: true }` (Hocuspocus supports read-only
     connections); `canRead === false` or non-200 → throw (reject).
   - Return context `{ userId: sub, role }` so later hooks can attribute the snapshot author.

   **Justification (local rule was considered and rejected):** wiki authorization depends on
   *project membership* (`WikiPage.projectId` → project members), which lives in the API/Mongo
   business layer. Replicating that query and its future rules (roles, archived projects,
   instance blocks) inside the live server would drift and duplicate logic — violating
   "one API, many frontends". The REST check is **per-connection, not per-keystroke**, so cost
   is negligible. Authentication stays local (cheap, no round-trip); only the richer
   authorization decision is delegated to the single source of truth.

> `prism-backend` must add the internal access endpoint (§4 lists the sibling snapshot endpoint;
> both live under the same `internal` controller guarded by `LIVE_INTERNAL_TOKEN`).

### 2. `documentName` grammar

**LOCKED primary: `wiki:<wikiPageId>`** where `<wikiPageId>` is the Mongo ObjectId hex (24 chars).

- Grammar: `^wiki:[0-9a-f]{24}$`
- The client constructs it as `` `wiki:${wikiPageId}` `` and passes it as the Hocuspocus
  `name`. No other prefixes are valid in Phase 2; the live server rejects anything else.
- This grammar is deliberately namespaced so Phase 3 can add `notes:<id>` without collision.
- Note: `packages/editor` currently exposes `documentId` + a `collaborationEndpoint()` that
  path-encodes it. In Phase 2 the id **is** the `documentName` string; the raw `HocuspocusProvider`
  takes `name` directly, so `collaborationEndpoint()` is retired in favor of the provider's
  `url` + `name` options (see §5).

### 3. `YjsDocument` schema (Mongo — **LOCKED: separate collection**)

New collection, owned by `apps/live` (and read by the API only for the snapshot path if ever
needed). Do **not** add Yjs binary to `WikiPage`.

```ts
// collection: yjsdocuments
{
  documentName: string;   // unique index, e.g. "wiki:665f..."
  state: Buffer;          // Y.encodeStateAsUpdate() binary blob
  updatedAt: Date;        // touched on every store
}
// index: { documentName: 1 } unique
```

`@hocuspocus/extension-database` contract (implemented in the live server):

```ts
new Database({
  // Return the persisted Yjs update, or null for a brand-new doc.
  fetch: async ({ documentName }) => {
    const row = await YjsDocument.findOne({ documentName }).lean();
    return row?.state ?? null;          // Buffer | null
  },
  // Upsert the full encoded state.
  store: async ({ documentName, state }) => {
    await YjsDocument.updateOne(
      { documentName },
      { $set: { state, updatedAt: new Date() } },
      { upsert: true },
    );
  },
})
```

**First-open seeding:** when `fetch` returns `null`, the doc is empty. The initial content comes
from `wiki.content` (HTML). Seeding rule for Phase 2: the **client** seeds — on first mount, if
the shared Yjs XML fragment is empty, the editor loads `wiki.content` (fetched via existing
`GET /api/v1/wiki/:id`) into Tiptap once. This avoids running an HTML→Yjs converter server-side.
`prism-frontend` owns the "seed only if fragment empty" guard to prevent duplication across peers.

### 4. Snapshot-back contract (**LOCKED: yes in Phase 2**)

Purpose: keep `wiki.content` HTML current so search, PDF export, and Space stay accurate.

- **Hook:** `onStoreDocument`, **debounced** (Hocuspocus `debounce` option, e.g. 2000ms, with a
  `maxDebounce` ~10000ms so a long editing session still flushes). This fires after quiescence,
  not per keystroke.
- **Yjs → HTML:** in the hook, render the document's shared XML fragment (Tiptap default fragment
  name `"default"`) to HTML server-side using the **same Tiptap schema/extensions** as the client,
  via `@tiptap/html`'s `generateHTML(json, extensions)`. The extension set must be the single
  shared list exported from `packages/editor` (§5) so client render and server snapshot never
  diverge. Convert `Y.XmlFragment` → ProseMirror JSON with
  `@tiptap/extension-collaboration` / `y-prosemirror`'s `yXmlFragmentToProsemirrorJSON`.
- **Internal endpoint (new, `prism-backend`):**
  ```
  PUT /api/v1/internal/wiki/:id/content
  Header: x-internal-token: <LIVE_INTERNAL_TOKEN>     (required; not a user JWT)
  Body:   { content: string, editedBy?: string }      (Zod-validated)
  → 200 { ok: true, updatedAt: string }
  → 401 if token missing/mismatch, 404 if page gone
  ```
  - Guarded by a new `InternalTokenGuard` (constant-time compare of header vs `LIVE_INTERNAL_TOKEN`),
    **not** `JwtAuthGuard`. Because the global `APP_GUARD` is `JwtAuthGuard`, this route must be
    marked `@Public()` (existing skip decorator) and then gated by `InternalTokenGuard`.
  - Writes only `content` (bypasses the mention-notification side effects of the normal
    `update()` — snapshots are machine writes, not user edits; `editedBy` is stored for
    attribution/activity only if cheap). `prism-backend` adds a `WikiService.snapshotContent(id, html)`
    that sets content + `updatedAt` without emitting `wiki_mention`.
- Also add the sibling **access** endpoint from §1 under the same controller/guard:
  `GET /api/v1/internal/wiki/:id/access?userId=<sub>` → `{ canRead, canWrite }`.

### 5. `packages/editor` boundary

`packages/editor` (@prism/editor) owns everything editor+CRDT; **apps/web owns data + routing**.

Exports from `packages/editor` (Phase 2):

| Export | Kind | Responsibility |
|--------|------|----------------|
| `CollaborativeEditor` | React component | Tiptap `EditorContent` wired to a Yjs doc + provider; renders toolbar; read-only aware. Props: `{ documentName, token, liveUrl, initialHTML?, editable? }`. |
| `useCollaborativeDoc` | React hook | Creates `Y.Doc` + `HocuspocusProvider` ({ url: liveUrl, name: documentName, token }); returns `{ doc, provider, status, synced }`; handles cleanup. |
| `editorExtensions` | value | The single canonical Tiptap extension array (StarterKit minus history + Collaboration + Mention + …). Imported by both the client editor and the live server's snapshot renderer. |
| `generateWikiHTML(json)` | fn | Wraps `@tiptap/html` `generateHTML` with `editorExtensions`; used by the live server snapshot hook. Pure, no React. |
| `CollaborationConfig` type | type | Retain for typing; `collaborationEndpoint()` is removed (provider takes url+name). |

Stays in **apps/web**: fetching `GET /wiki/:id` (TanStack Query), the `/wiki/[id]` route, minting/
passing the access token, seeding decision (§3), and any wiki-tree/sidebar UI. apps/web imports
`CollaborativeEditor` and passes `liveUrl={process.env.NEXT_PUBLIC_LIVE_URL}` + the user's token.

New deps land in `packages/editor`: `@tiptap/react`, `@tiptap/starter-kit`,
`@tiptap/extension-collaboration`, `@hocuspocus/provider`, `yjs`, `y-prosemirror`, `@tiptap/html`.

### 6. Env vars

API (`apps/api`, add to `config/env.config.ts` `envSchema`):
- `LIVE_INTERNAL_TOKEN` — `z.string().min(32)`. Shared secret for the internal wiki endpoints.
- (already present, reused) `JWT_ACCESS_SECRET`, `MONGODB_URI`, `WEB_ORIGIN`.

Live server (`apps/live`, its own env validation):
- `PORT=3100` (or `LIVE_PORT`)
- `JWT_ACCESS_SECRET` — **must match the API's** (shared).
- `MONGODB_URI` — **must match the API's** (shared; separate connection, `YjsDocument` collection).
- `INTERNAL_API_URL` — e.g. `http://localhost:4000/api/v1` (base for the internal PUT + access GET).
- `LIVE_INTERNAL_TOKEN` — **must match the API's**.
- `LIVE_ALLOWED_ORIGINS` — e.g. `http://localhost:3000,http://localhost:3002` (web + space).

Web (`apps/web`):
- `NEXT_PUBLIC_LIVE_URL` — e.g. `ws://localhost:3100` (browser → live WS).

Deployment note: `LIVE_BASE_URL` (e.g. `http://localhost:3100` / public wss URL) is the
externally-reachable address of the live server, referenced by infra/compose; the browser-facing
value is surfaced as `NEXT_PUBLIC_LIVE_URL`.

### 7. CORS / origins

- **API (`apps/api/src/main.ts`):** the internal endpoints are server-to-server (no browser Origin),
  so no CORS change is required for the live→api path. If web ever calls a wiki endpoint from a new
  origin, add it to `WEB_ORIGIN` (already a comma-separated allowlist). No change needed for Phase 2
  strictly, but confirm `WEB_ORIGIN` includes every browser origin that opens the editor.
- **Live (`apps/live`):** Hocuspocus/WebSocket must enforce an origin allowlist from
  `LIVE_ALLOWED_ORIGINS` (reject unknown `Origin` on the WS upgrade). Must include the web origin
  (`http://localhost:3000`) and, when Space renders collaborative wiki read-only, the space origin
  (`http://localhost:3002`).

## Consequences

- Three secrets must be kept in sync across api + live: `JWT_ACCESS_SECRET`, `MONGODB_URI`,
  `LIVE_INTERNAL_TOKEN`. Document in `.env.example` for both apps.
- The live server holds a Mongo connection independent of Nest; schema drift risk is low because
  `YjsDocument` is opaque binary owned solely by live.
- `wiki.content` becomes eventually-consistent (debounced) with the live Yjs state. Reads within a
  debounce window may be slightly stale — acceptable for search/PDF/Space. On explicit
  "close/leave", the client should trigger a provider flush so the snapshot is prompt.
- The normal `PATCH /wiki/:id` (title/parent) coexists with the snapshot path; only `content`
  is authoritative from Yjs once a page is opened collaboratively. Title edits stay on the REST path.
- HTML↔Yjs fidelity depends on `editorExtensions` being the *single* shared source; any extension
  added client-side without updating the shared array will silently drop nodes from snapshots.

## Interfaces frozen by this ADR (build against these)

- WS: `HocuspocusProvider({ url: NEXT_PUBLIC_LIVE_URL, name: "wiki:<id>", token })`
- Live authn: local `jwt.verify(token, JWT_ACCESS_SECRET)` → `{ sub, role }`
- Live authz: `GET /api/v1/internal/wiki/:id/access?userId=<sub>` (x-internal-token) → `{ canRead, canWrite }`
- Persistence: `YjsDocument { documentName unique, state Buffer, updatedAt }`; `fetch→Buffer|null`, `store→upsert`
- Snapshot: `onStoreDocument` (debounced) → `PUT /api/v1/internal/wiki/:id/content` (x-internal-token) `{ content }` → `{ ok, updatedAt }`
- Package: `@prism/editor` exports `CollaborativeEditor`, `useCollaborativeDoc`, `editorExtensions`, `generateWikiHTML`
