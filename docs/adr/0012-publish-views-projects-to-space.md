# ADR 0012 — Anchor expansion: publishing views and projects to Space

- Status: Accepted (GATE — build against this)
- Date: 2026-07-23
- Extends: ADR 0002 (public Space). The wiki path defined there is **unchanged**.
- Scope: publish/unpublish for saved Views (project-scoped only) and Projects;
  the public anchor resolver becomes a discriminated union over three types.
  Public comments/reactions, workspace-level view publishing, and roadmap
  publishing remain out of scope.
- Owners of build: `prism-backend` (schema fields, shared anchor helper, publish
  endpoints, PublicService union), `prism-frontend` (Publish UI in apps/web,
  type-switched rendering in apps/space). No admin or live work.

## Context

ADR 0002 shipped wiki publishing: a stable public `anchor` slug, minted once and
kept across unpublish, resolved anonymously by `GET /public/anchor/:anchor` with
query-time field stripping, rendered SSR by `apps/space`. Its Consequences
anticipated this ADR: *"a second published-content type can be added later by
extending the `public` resolver to switch on `type`."*

The views module (ADR 0009 lineage) now exists: a View is a saved
filter/group/sort/layout preset, either project-scoped (`projectId` set) or
workspace-level (`projectId: null`, spans **every** readable project in the
tenant). Projects have an owner-only mutation gate precedent (ADR 0010 covers).

## Decision

### 1. Publish fields on `View` and `Project` (**LOCKED** — mirrors WikiPage)

Added identically to `view.schema.ts` and `project.schema.ts`:

```ts
isPublic:    boolean               // default false, indexed
anchor:      string | null         // default null
publishedAt: Date | null           // default null
publishedBy: ObjectId(User) | null // default null
```

Each schema gets its own **partial unique index** — the same fix already proven
on WikiPage (`unique + sparse` breaks on `default: null`):

```ts
Schema.index({ anchor: 1 },
  { unique: true, partialFilterExpression: { anchor: { $type: 'string' } } });
```

Unpublish keeps the anchor; re-publish reuses it (same URL forever). Defaults
mean no migration: existing rows have `anchor: null` and sit outside the index.

### 2. Shared anchor minting (**LOCKED**)

`anchorFor` is hoisted out of `wiki.service.ts` into a shared helper
(`apps/api/src/common/anchor.util.ts`), same grammar as ADR 0002 §2:
`slug(title|name).slice(0,50) + '-' + randomHex8`.

Cross-collection collisions: at mint time the helper's caller checks **all three
collections** (wiki, views, projects) and re-mints with a fresh hex suffix on a
hit (few retries). The per-collection partial unique index is the hard backstop
(an `E11000` on save → re-mint and retry once). With 8 random hex chars a
collision is already vanishingly rare; the check makes the anchor namespace
effectively global, so resolution order (§5) never has to disambiguate in
practice — it exists only as a deterministic tiebreak for pre-existing data.

### 3. View publish endpoints (**LOCKED** — authenticated, in the views module)

```
POST /api/v1/views/:id/publish     (JwtAuthGuard, @CurrentUser)
  → 400 if view.projectId is null — workspace-level views are NOT publishable
    in v1: they span every project in the tenant, so publishing one would leak
    issues across the whole workspace through a single anchor.
  → requires: caller can read the view (owner, or isShared) AND has write
    access to view.projectId (assertProjectWritable). This deliberately relaxes
    the owner-only-edit rule for views: publishing is a project-level act, same
    as wiki where any project writer publishes (ADR 0002 §3).
  → mints anchor if null (§2); sets isPublic=true, publishedAt=now,
    publishedBy=userId
  → 200 { anchor, isPublic: true, publishedAt }

POST /api/v1/views/:id/unpublish   (same guard + authz)
  → sets isPublic=false (anchor preserved)
  → 200 { isPublic: false }
```

Style note: wiki uses `DELETE :id/publish` for unpublish; views and projects use
`POST :id/unpublish` per this contract. The wiki route is **not** renamed —
divergence accepted, recorded here.

Publishing does not flip `isShared`; public anchor visibility and in-app
sharing are orthogonal. `GET /views/:id` (and the list) now surface
`{ isPublic, anchor, publishedAt }`, mirroring ADR 0002 §3.

### 4. Project publish endpoints (**LOCKED**)

```
POST /api/v1/projects/:id/publish    (JwtAuthGuard, @CurrentUser)
  → project OWNER only (403 otherwise) — matches the ADR 0010 owner-only
    cover-mutation gate. Members cannot expose a project to the internet.
  → same mint/set semantics → 200 { anchor, isPublic: true, publishedAt }

POST /api/v1/projects/:id/unpublish  (owner only)
  → 200 { isPublic: false }
```

Project detail responses surface `{ isPublic, anchor, publishedAt }`.

### 5. Public resolver becomes a discriminated union (**LOCKED**)

`GET /api/v1/public/anchor/:anchor` (`@Public`, throttled — unchanged) resolves
in fixed order: **wiki → view → project**, first `{ anchor, isPublic: true }`
match wins. Miss on all three → 404, indistinguishable from unpublished (no
existence leak).

```
{ type: 'wiki', anchor, title, contentHTML, coverImage, updatedAt }   // UNCHANGED (ADR 0002 §4)

{ type: 'view',    anchor, title, layout, groupBy, columns?, issues, updatedAt }
{ type: 'project', anchor, title, layout, groupBy, columns?, issues, updatedAt }
```

- `title` = view.name / project.name. `layout`/`groupBy`/sort come from the
  view; a published project renders its default board: `layout: 'kanban'`,
  `groupBy: 'status'`, sort `updatedAt:desc`.
- `columns` (optional, kanban only): ordered `{ id, name, color }` derived from
  the project's `boardLists` (or the four canonical defaults when empty).
  Never includes `wipLimit` or collapse state.
- `issues`: **live query at request time** (not a snapshot) against the
  project's issues, applying the view's stored `filters` and `sortBy` (project
  default sort for `type: 'project'`), capped at **200**. No total count is
  exposed beyond the array itself. Matches space's `force-dynamic` SSR — same
  freshness contract as wiki.

**Public issue projection (LOCKED)** — enforced at the Mongo query projection,
exactly like `getWikiByAnchor`, never by post-hoc delete:

```
{ title: 1, status: 1, priority: 1, type: 1, labels: 1, dueDate: 1, updatedAt: 1, _id: 0 }
```

Never: `assigneeId`, `authorId`, `desc`, `comments`, `todos`, `parentId`,
emails, or member data. **`_id` is omitted outright** (`_id: 0`), not replaced
with an opaque key: ObjectIds embed creation timestamps and would be the only
stable identifier leaked to the internet, and the space render is a static
read-only list/board with no client-side interaction that needs stable keys —
array index suffices. If future public features (permalinks, reactions) need
per-issue identity, a keyed scheme gets its own ADR.

### 6. `apps/space` rendering

The existing route `[anchor]/page.tsx` stays the single entry point — no new
routes; it switches on `type`. `wiki` path untouched. `view`/`project` render a
read-only list or kanban from the payload. Layouts `calendar`, `timeline`, and
`spreadsheet` **degrade to the list rendering** in v1 (payload still reports
the stored layout, so space can upgrade later without an API change). Issue
payloads are plain scalars — no HTML, so no sanitization needed on this path.

The union type lives in `@prism/types` and is shared by PublicService and
apps/space.

## Consequences

- Two new partial unique indexes (views, projects); zero data migration.
- Public issue data is now internet-facing: the projection whitelist in §5 is
  the security boundary, and any future issue field is private-by-default until
  explicitly added here.
- The 200-issue cap means huge published views are silently truncated —
  accepted for v1; no pagination on the public surface.
- Workspace-level views stay unpublishable until a scoping story exists;
  the 400 makes that explicit rather than silently publishing nothing.
- Unpublish endpoint style now differs between wiki (`DELETE`) and
  views/projects (`POST :id/unpublish`) — cosmetic, recorded, not worth a
  breaking rename of the wiki route.

## Interfaces frozen by this ADR (build against these)

- Schema (View + Project): `{ isPublic (indexed), anchor (partial unique), publishedAt, publishedBy }`
- `POST /api/v1/views/:id/publish` (project-scoped only, else 400; readable view + project write) → `{ anchor, isPublic, publishedAt }`
- `POST /api/v1/views/:id/unpublish` (same authz) → `{ isPublic: false }`
- `POST /api/v1/projects/:id/publish` (owner only) → `{ anchor, isPublic, publishedAt }`
- `POST /api/v1/projects/:id/unpublish` (owner only) → `{ isPublic: false }`
- `GET /api/v1/public/anchor/:anchor` → discriminated union (§5); resolution
  order wiki → view → project; 404 = unpublished = nonexistent
- Public issue projection: `title, status, priority, type, labels, dueDate, updatedAt` — no `_id`, nothing else
- Shared minting helper `apps/api/src/common/anchor.util.ts`; mint checks all
  three collections; partial unique index is the backstop
