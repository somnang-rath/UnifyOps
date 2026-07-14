# ADR 0002 — Phase 3: Public Space (published read-only wiki pages)

- Status: Accepted (GATE — build against this)
- Date: 2026-07-10
- Scope: **wiki pages only**. Publishing projects/views/roadmaps and public
  comments/reactions are explicitly out of scope for Phase 3.
- Owners of build: `prism-backend` (schema + publish endpoints + `public` module),
  `prism-frontend` (apps/web Publish UI + new `apps/space`).

## Context

Phase 2 (ADR 0001) added collaborative wiki editing and a debounced snapshot-back
that keeps `WikiPage.content` (HTML) current *"so search, PDF export, and Space
stay accurate"*. Phase 3 delivers that Space: a third frontend (`apps/space`, :3002)
that renders **published** content read-only, with **no login**, at a public URL.

The publish unit is the **wiki page**. Publishing mints a stable public **anchor**
(slug); the space app resolves `anchor → page` through an anonymous, rate-limited
API endpoint that returns only public-safe fields.

Per `PLANE-CONVERSION-PLAN.md` §11: public endpoints must **strip private fields**
and **stay rate-limited**; instance-admin is a separate concern; CORS must allow
the space origin.

Decisions marked **LOCKED** are frozen; the build implements them verbatim.

## Decision

### 0. Topology

```
  public browser ──HTTP(SSR)──► apps/space (:3002)  ──►  GET /api/v1/public/anchor/:anchor
       (no login)                    │                        (anonymous, @Public, throttled)
                                     └─ renders sanitized WikiPage.content (read-only)

  author (logged in) ── apps/web (:3000) ──► POST/DELETE /api/v1/wiki/:id/publish
                                              (JwtAuthGuard, canWrite via accessFor)
```

`apps/space` is SSR-only and read-only. It never receives a user JWT and never
mutates data. All writes (publish/unpublish) happen from `apps/web` on the normal
authenticated path.

### 1. Publish fields on `WikiPage` (**LOCKED**)

Added to `apps/api/src/modules/wiki/schemas/wiki-page.schema.ts`:

```ts
isPublic:    boolean        // default false, indexed
anchor:      string | null  // default null; unique + sparse index
publishedAt: Date | null    // default null
publishedBy: ObjectId(User) | null  // default null
```

`unique + sparse` allows unlimited `anchor: null` rows while guaranteeing that any
non-null anchor is globally unique. **Unpublish keeps the anchor** (sets only
`isPublic=false`) so a later re-publish yields the same URL.

### 2. Anchor grammar (**LOCKED**)

`anchor = slug(title).slice(0,50) + '-' + randomHex8`

- `slug()` lowercases, replaces non-alphanumerics with `-`, collapses/trims `-`.
- `randomHex8 = crypto.randomBytes(4).toString('hex')` — the repo's established id
  pattern (`users.service.ts`). Guarantees uniqueness without a title-collision check.
- Grammar: `^[a-z0-9-]+-[0-9a-f]{8}$` (a leading empty slug degrades to just the hex
  suffix, still valid). The anchor is minted **once** (on first publish) and reused.

### 3. Publish / unpublish endpoints (**LOCKED — authenticated, in the wiki module**)

They mutate `WikiPage`, so they live on the authenticated wiki controller, not the
anonymous `public` module. Authorization reuses the existing
`WikiService.accessFor(userId, id)` (owner/member ⇒ `canWrite`).

```
POST   /api/v1/wiki/:id/publish     (JwtAuthGuard, @CurrentUser)
  → requires canWrite (else 403); mints anchor if null; sets isPublic=true,
    publishedAt=now, publishedBy=userId
  → 200 { anchor, isPublic: true, publishedAt }

DELETE /api/v1/wiki/:id/publish     (JwtAuthGuard, @CurrentUser)
  → requires canWrite (else 403); sets isPublic=false (anchor preserved)
  → 200 { isPublic: false }
```

`GET /api/v1/wiki/:id` now also surfaces `{ isPublic, anchor, publishedAt }`.

### 4. Public read endpoint (**LOCKED — anonymous, field-stripped, throttled**)

New `public` module (`apps/api/src/modules/public/`):

```
GET /api/v1/public/anchor/:anchor
  @Public()            → skips the global JwtAuthGuard (no user token)
  (default throttler)  → NOT @SkipThrottle(): anonymous internet traffic stays
                          rate-limited (app.module short/medium limits apply)
  → 200 { type: 'wiki', anchor, title, contentHTML, updatedAt }
  → 404 if no WikiPage matches { anchor, isPublic: true }
```

**Field-stripping is enforced at the query projection**, not by deletion after the
fact. `getWikiByAnchor` selects **only** `{ title, content, updatedAt }`. The
response **must never** expose `authorId`, `projectId`, `publishedBy`, `parentId`,
`_id`, or any project/member data. Unpublished or non-existent anchors are
indistinguishable (both 404) — no existence leak.

### 5. `apps/space` boundary (**LOCKED — SSR, read-only, no auth**)

- Next.js 14 App Router, mirrors `apps/admin`'s shell (standalone output,
  `transpilePackages`, Tailwind) but **omits all auth** (no login/setup, no
  `@prism/services` client, no cookies).
- `basePath: '/spaces'`, port 3002.
- Route `app/spaces/[anchor]/page.tsx` is a **Server Component**:
  - `fetch(`${API_URL}/public/anchor/${anchor}`, { cache: 'no-store' })`
    server-side (`API_URL=http://localhost:4000/api/v1`).
  - Renders `title` + `contentHTML`. **The HTML MUST be sanitized** before
    `dangerouslySetInnerHTML` (it is our editor's output but is now internet-facing).
  - `generateMetadata` sets `<title>` from the wiki title (SEO — public pages
    should be indexable, §4.3).
  - 404 from the API → Next `notFound()` → `not-found.tsx`.

### 6. Env vars

- **API** (`.env.example`): add `http://localhost:3002` to the comma-separated
  `WEB_ORIGIN` allowlist. No new API env vars (main.ts already parses the list).
- **web** (`.env.local.example`): `NEXT_PUBLIC_SPACE_URL=http://localhost:3002`
  (used to build the shareable public link).
- **space** (`.env.local.example`): `API_URL=http://localhost:4000/api/v1`,
  `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`, `PORT=3002`.

### 7. CORS

Space is SSR → its API calls are server-to-server with no browser `Origin`, so no
CORS change is strictly required. `http://localhost:3002` is added to `WEB_ORIGIN`
defensively so any future client-side fetch from the space origin is allowed.

## Consequences

- `WikiPage` gains a unique sparse index on `anchor`; existing rows (anchor unset)
  are unaffected.
- `wiki.content` staleness within the Phase 2 snapshot debounce window also applies
  to Space reads — acceptable (same guarantee search/PDF already rely on).
- HTML sanitization is the single security boundary between editor output and the
  public; it lives in `apps/space` at render time.
- A second published-content type (projects) can be added later by extending the
  `public` resolver to switch on `type` without changing this contract's wiki path.

## Interfaces frozen by this ADR (build against these)

- Schema: `WikiPage.{ isPublic (indexed), anchor (unique sparse), publishedAt, publishedBy }`
- Publish: `POST /api/v1/wiki/:id/publish` (auth, canWrite) → `{ anchor, isPublic, publishedAt }`
- Unpublish: `DELETE /api/v1/wiki/:id/publish` (auth, canWrite) → `{ isPublic: false }`
- Public read: `GET /api/v1/public/anchor/:anchor` (@Public, throttled) →
  `{ type:'wiki', anchor, title, contentHTML, updatedAt }` | 404
- Space route: SSR `GET /spaces/:anchor` → sanitized read-only render
