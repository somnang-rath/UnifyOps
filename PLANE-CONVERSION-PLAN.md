# Prism → Plane-style Platform: Structure & Features Plan

> គោលដៅ៖ បំប្លែង **Prism** ឲ្យមានស្ថាបត្យកម្មដូច [plane.so](https://plane.so) —
> បន្ថែម **apps/live**, **apps/admin**, **apps/space** ជាមួយ main web ដែលមានស្រាប់។
>
> **គោលការណ៍សំខាន់:** យក *គំនិត architecture* របស់ Plane មកសម្រប — **មិន copy code**
> Plane ត្រង់ៗទេ ព្រោះ stack ខុសគ្នា (Prism = NestJS + Mongo + Next.js;
> Plane = Django + Postgres + React Router).

---

## 1. ស្ថានភាពបច្ចុប្បន្ន (Current State)

```
prism/
├── apps/
│   ├── api/     NestJS + MongoDB (Mongoose) + Socket.io + BullMQ  → :4000/api/v1
│   └── web/     Next.js (App Router) + Tailwind + TanStack Query + Zustand → :3000
├── docker-compose.yml   (mongo, redis, api, web)
└── pnpm-workspace.yaml  (apps/*, packages/*)   ← packages/ មិនទាន់មាន
```

**API modules ដែលមានស្រាប់:** `auth, users, roles, workspaces, projects, issues,
cycles, modules, views, kanban, wiki, notes, files, reports, automations, mrs,
estimates, dashboard, activity, notifications, search, backups, error-logs, health`

**Web routes ដែលមានស្រាប់:** `home, my-work, projects, issues, cycles, modules,
views, kanban, gantt, calendar, timeline, wiki, notes, files, tables, reports,
automations, approvals, notifications, settings, workspaces, users` + auth
(`login, register, accept-invite`)

> ✅ Prism មាន feature coverage ធំរួចហើយ។ អ្វីដែលខ្វះគឺ **ស្រទាប់ multi-app**
> របស់ Plane៖ instance admin, public space, និង realtime collaboration server។

---

## 2. ស្ថាបត្យកម្មគោលដៅ (Target Architecture)

```
                          ┌──────────────────────────────────────────────┐
   USERS (browser)        │              FRONTENDS (Next.js)             │
   ──────────────────────►│  web:3000   admin:3001   space:3002          │
                          └───────┬───────────┬──────────────┬───────────┘
                                  │ REST +     │ REST         │ REST (public/read-only)
                                  │ WebSocket  │              │
                                  ▼            ▼              ▼
                          ┌───────────────────────────────────────────────┐
                          │              apps/api  (NestJS :4000)         │
                          │  + instance module  + public (space) module   │
                          └───┬────────────┬───────────────┬──────────────┘
                              │            │               │
                              ▼            ▼               ▼
                       ┌───────────┐ ┌──────────┐  ┌────────────────┐
                       │ MongoDB   │ │  Redis   │  │ uploads / S3   │
                       │ :27017    │ │ (BullMQ) │  │ (files)        │
                       └───────────┘ └──────────┘  └────────────────┘

                          ┌───────────────────────────────────────────────┐
                          │        apps/live  (Node + Hocuspocus/Yjs)     │  ← ថ្មី :3100
                          │   realtime collaborative editing (wiki/notes) │
                          └───────────────────────────────────────────────┘
```

### Port map (គោលដៅ)

| App        | Port  | Stack                      | អ្នកប្រើ            |
| ---------- | ----- | -------------------------- | ------------------ |
| web        | 3000  | Next.js (មានស្រាប់)        | Team members       |
| admin      | 3001  | Next.js (ថ្មី)             | Instance admin     |
| space      | 3002  | Next.js (ថ្មី)             | សាធារណៈ / guests   |
| api        | 4000  | NestJS (ពង្រីក)            | (backend)          |
| live       | 3100  | Node + Hocuspocus (ថ្មី)   | (realtime)         |

---

## 3. រចនាសម្ព័ន្ធគោលដៅ (Target Folder Structure)

```
prism/
├── apps/
│   ├── api/        NestJS backend  (ពង្រីក + instance/public modules)
│   ├── web/        Next.js main app (កែបន្តិច — មើលផ្នែក 6)
│   ├── admin/      ★ ថ្មី — Next.js instance admin (God Mode) :3001
│   ├── space/      ★ ថ្មី — Next.js public published content :3002
│   └── live/       ★ ថ្មី — Node/Hocuspocus realtime server :3100
├── packages/       ★ ថ្មី — shared code (បំបែកចេញពី web)
│   ├── types/          shared TypeScript types + Zod schemas
│   ├── ui/             shared React components (buttons, inputs, modals)
│   ├── services/       API client (axios/fetch wrappers)
│   ├── constants/      enums, route paths, feature flags
│   └── editor/         rich-text editor (Tiptap) + Yjs binding
├── docker-compose.yml   (បន្ថែម admin, space, live services)
└── pnpm-workspace.yaml  (មានស្រាប់)
```

> **ហេតុអ្វីត្រូវមាន `packages/`?** បើគ្មានវា អ្នកនឹង copy-paste types, UI components,
> និង API client ចូល ៣ apps ដដែលៗ។ Plane បំបែក code រួមចូល `packages/*` ដើម្បីកុំឲ្យ
> duplicate។ នេះជា **ជំហានទី ១ ដ៏សំខាន់** មុននឹងបន្ថែម apps ថ្មី។

---

## 4. Apps ថ្មី ៣ — ត្រូវធ្វើអ្វីខ្លះ

### 4.1 `apps/live` — Realtime Collaboration Server (:3100)

**គោលបំណង:** ឲ្យមនុស្សច្រើននាក់កែ **wiki / notes** ព្រមគ្នា (ដូច Google Docs)។

| ធាតុ | ការណែនាំ |
| ---- | -------- |
| Stack | Node.js + [Hocuspocus](https://tiptap.dev/hocuspocus) (Yjs server) |
| ភ្ជាប់ | Frontend editor (Tiptap + Yjs) ↔ WebSocket ↔ live server |
| Persistence | live server រក្សា Yjs doc ក្នុង MongoDB (ឬ Redis) រួច sync ត្រឡប់ទៅ API |
| Auth | បញ្ជូន JWT ពី web → live `onAuthenticate` hook ផ្ទៀងផ្ទាត់ជាមួយ API |

**ត្រូវធ្វើ:**
1. `apps/live/` ថ្មី — `@hocuspocus/server` + `@hocuspocus/extension-database`
2. Endpoint `ws://localhost:3100` — authenticate token, load/store doc by `documentId`
3. នៅ API៖ បន្ថែម field Yjs binary (ឬ store ក្នុង `notes`/`wiki` schema) + REST ដើម្បី live server sync
4. Env: `LIVE_BASE_URL=http://localhost:3100`

> ⚠️ Prism មាន Socket.io រួច (notifications)។ ប៉ុន្តែ collaborative text editing
> ត្រូវ **Yjs (CRDT)** ទើបដោះស្រាយ conflict បាន — Socket.io ធម្មតាមិនគ្រប់គ្រាន់ទេ។

### 4.2 `apps/admin` — Instance Admin / God Mode (:3001)

**គោលបំណង:** control panel សម្រាប់ **អ្នកគ្រប់គ្រង instance** (មិនមែន user ធម្មតា)។

Pages (យកតាម Plane admin)៖

| Page           | មុខងារ                                              |
| -------------- | --------------------------------------------------- |
| General        | ព័ត៌មាน instance, instance ID, version               |
| Authentication | បើក/បិទ login modes: Password, Email code, Google, GitHub, GitLab |
| Email (SMTP)   | កំណត់ SMTP + ផ្ញើ test email                         |
| AI             | OpenAI / Claude API key config                      |
| Images         | Third-party image library (Unsplash) config         |
| Workspaces     | មើល/គ្រប់គ្រង workspaces ទាំងអស់លើ instance          |

**ត្រូវធ្វើនៅ API (ថ្មី — module `instance`):**
1. `InstanceConfiguration` schema (Mongo) — key/value config (auth toggles, SMTP, AI keys)
2. `InstanceAdmin` — user ណាជា instance admin (ខុសពី workspace role)
3. Guard `@InstanceAdminGuard` — protect admin endpoints
4. Endpoints: `GET/PATCH /api/v1/instance`, `/instance/admins`, `/instance/config`
5. **First-run setup:** ពេលគ្មាន admin → បង្ហាញ setup screen (ដូច Plane's InstanceAdminSignUp)

**ត្រូវធ្វើនៅ Frontend:**
- `apps/admin/` — Next.js ថ្មី (copy shell ពី web, port 3001, base path `/god-mode`)
- ប្រើ `packages/ui` + `packages/services` ដដែល

### 4.3 `apps/space` — Public Space (:3002)

**គោលបំណង:** បង្ហាញ content **សាធារណៈ** (គ្មាន login) — published views, roadmaps, intake forms។

**ត្រូវធ្វើនៅ API (ថ្មី — module `public` / `space`):**
1. "Publish" concept — បន្ថែម `is_public` / `published_at` + `anchor` (public slug) ទៅ `views`/`projects`
2. `PublishSettings` schema — គ្រប់គ្រងអ្វីដែល publish (views, comments on/off, reactions)
3. Endpoints **គ្មាន auth** (read-only): `GET /api/v1/public/anchor/:anchor/...`
4. Rate-limit + strip private fields (កុំបែកធ្លាយ email, internal notes)

**ត្រូវធ្វើនៅ Frontend:**
- `apps/space/` — Next.js ថ្មី (port 3002, base path `/spaces`)
- Server-side render (SSR) សម្រាប់ SEO — public pages គួរ index បាន
- Read-only UI: បង្ហាញ issues/views, optional public comments

---

## 5. ការផ្លាស់ប្តូរនៅ API (សរុប)

| Module ថ្មី/កែ | ការងារ |
| -------------- | ------ |
| `instance` ★   | Instance config + admin guard + first-run setup |
| `public` ★     | Anonymous read endpoints សម្រាប់ space |
| `auth` (កែ)    | ថែម OAuth providers (Google/GitHub) ដែលបើក/បិទតាម instance config |
| `notes`/`wiki` (កែ) | ថែម Yjs document storage + hook ទៅ live server |
| `views`/`projects` (កែ) | ថែម `is_public`, `anchor`, publish settings |
| CORS (កែ)      | អនុញ្ញាត origins: web(3000), admin(3001), space(3002) |

---

## 6. ការផ្លាស់ប្តូរនៅ Main Web (apps/web) — ត្រូវកែអ្វីខ្លះ?

Main web មានស្រាប់ ត្រូវកែ **តិចតួច**៖

1. **បំបែក shared code ចេញ** ទៅ `packages/*` (types, ui, services, editor)
   — ដើម្បីឲ្យ admin/space ប្រើរួម។ នេះជាការកែធំបំផុត (refactor)។
2. **Collaborative editor** — ប្តូរ wiki/notes editor ឲ្យភ្ជាប់ `apps/live`
   (Tiptap + `@tiptap/extension-collaboration` + Yjs WebSocket provider → :3100)។
3. **"Publish" UI** — បន្ថែមប៊ូតុង *Publish to Space* លើ views/projects
   (បង្កើត anchor, បើក/បិទ public)។
4. **Link ទៅ Admin** — បន្ថែម "God Mode / Instance admin" link (បង្ហាញតែ instance admin)។
5. **Auth ថ្មី** — បើ instance បើក Google/GitHub, បង្ហាញប៊ូតុង OAuth លើ login page។
6. **Env vars ថ្មី** — `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_SPACE_URL`,
   `NEXT_PUBLIC_LIVE_URL`។

> ✅ Logic ស្នូល (issues, cycles, projects) **មិនចាំបាច់ប្តូរ** ទេ។

---

## 7. Environment Variables (គោលដៅ)

```env
# ---- API (apps/api/.env) ----
MONGODB_URI=mongodb://localhost:27017/prism
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
REDIS_URL=redis://localhost:6379
WEB_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:3002
LIVE_URL=http://localhost:3100          # API → live sync
# OAuth (បើប្រើ)
GOOGLE_CLIENT_ID=... / GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=... / GITHUB_CLIENT_SECRET=...

# ---- web / admin / space (.env) ----
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_WEB_URL=http://localhost:3000
NEXT_PUBLIC_ADMIN_URL=http://localhost:3001
NEXT_PUBLIC_SPACE_URL=http://localhost:3002
NEXT_PUBLIC_LIVE_URL=http://localhost:3100

# ---- live (apps/live/.env) ----
PORT=3100
API_URL=http://localhost:4000/api/v1     # live → API auth/persist
MONGODB_URI=mongodb://localhost:27017/prism
```

---

## 8. ផែនការអនុវត្តន៍ (Phased Roadmap)

### Phase 0 — ត្រៀម (Foundation) ✅
- [x] បង្កើត `packages/` (`types`, `constants`, `services`, `ui`, `editor`) — real code extracted:
  - **API client** → `@prism/services` `createApiClient` (web + admin now share it; added `shouldRefresh` predicate so web skips 401-refresh on `/auth/*`). web `lib/api.ts` delegates, keeps `api`/`refreshAuth` exports (zero call-site churn).
  - **`cn`** → canonical in `@prism/ui/cn` (twMerge+clsx). web `lib/utils.ts` re-exports it (80+ `@/lib/utils` call sites unchanged).
  - Domain types/UI primitives stay in web for now — extract into `@prism/types`/`@prism/ui` on demand when `apps/space` needs them (no current cross-app duplication).
- [x] Update `pnpm-workspace.yaml` (`packages/*`) — packages linked + typecheck ✅ (web + admin typecheck pass)
- [x] ធ្វើឲ្យ web នៅតែ build ដដែល — web build ✅ (transpilePackages: `@prism/editor`, `@prism/services`, `@prism/ui`)

### Phase 1 — Instance Admin ✅
- [x] API: module `instance` (config, admins, `@InstanceAdminGuard`, first-run setup) — build ✅
- [x] `apps/admin/` Next.js (:3001) — General, Auth, Email, AI, Images pages — build ✅ (Workspaces page = follow-up: needs instance workspaces endpoint)
- [x] Web: link "God Mode" សម្រាប់ instance admin (via `GET /instance/me`) — build ✅

### Phase 2 — Realtime (Live) ✅
- [x] `apps/live/` Hocuspocus server (:3100) + JWT `onAuthenticate` (local verify + internal authz) + Mongo `yjsdocuments` persistence + debounced snapshot-back — build ✅; boots, connects Mongo, `/health` 200 ✅ (contract: `docs/adr/0001-phase2-realtime-live-wiki-collab.md`)
- [x] Web: Tiptap collaborative editor wired to live — **wiki only** (notes' `blocks[]` model deferred). Shared `packages/editor` (`CollaborativeEditor`, `useCollaborativeDoc`, canonical `editorExtensions`/`generateWikiHTML`). web build ✅
- [x] API: `YjsDocument` schema + `InternalTokenGuard` + `GET /internal/wiki/:id/access` + `PUT /internal/wiki/:id/content` (snapshot-back) — build ✅
- [x] Test: realtime wiki sync verified E2E (2026-07-09) — two Yjs/Hocuspocus clients on `wiki:<id>`: edit in A propagates to B (CRDT relay); auth gate rejects bad-signature JWT; API authz rejects non-member (private project); debounced snapshot-back writes HTML → `wiki.content`; Yjs state persisted to `yjsdocuments`. **7/7 checks pass** against full stack (mongo + api :4000 + live :3100, matching `JWT_ACCESS_SECRET`/`LIVE_INTERNAL_TOKEN`).

### Phase 3 — Public Space ✅ (scope: wiki pages; contract: `docs/adr/0002-phase3-public-space.md`)
- [x] API: module `public` (`GET /public/anchor/:anchor`, `@Public` + throttled, field-stripped) + publish fields on `WikiPage` (`isPublic`, `anchor` unique-sparse, `publishedAt`, `publishedBy`) + `POST`/`DELETE /wiki/:id/publish` (auth, `canWrite`) — build ✅
- [x] Web: "Publish to Space" UI on the wiki page (`use-wiki-publish` hook, publish/unpublish + copy public link) — typecheck ✅
- [x] `apps/space/` Next.js (:3002, basePath `/spaces`) SSR read-only `/[anchor]` page (sanitized HTML, SEO metadata, 404) — build ✅
- [x] Test: publish → `GET /public/anchor/:anchor` (no auth) returns only `{type,anchor,title,contentHTML,updatedAt}` — **no private fields leak**; unpublish → 404; re-publish reuses anchor; non-member publish → 403; space SSR renders the published page (200, correct `<title>`) and 404s unknown anchors. Verified E2E 2026-07-10 against mongo + api :4000 + space :3002.
  - Note: projects/roadmaps publishing is deferred (fast-follow — no `views` module yet). Docker `space` service deferred to Phase 4 (which already covers Docker).

### Phase 4 — Auth Providers + Polish
- [ ] OAuth Google/GitHub (បើក/បិទតាម instance config)
- [x] Docker: បន្ថែម admin, space, live services — all 7 services build + boot; publish→space verified E2E through compose (2026-07-10). Fixed 2 blocking gaps: api service was missing `LIVE_INTERNAL_TOKEN` (required by env schema → api couldn't boot); web Dockerfile predated `packages/` (missing `@prism/*` manifests+source → build failed)
- [ ] E2E test គ្រប់ apps

---

## 9. Docker (គោលដៅ)

បន្ថែម ៣ services ទៅ `docker-compose.yml`៖

```yaml
  admin:
    build: { context: ., dockerfile: apps/admin/Dockerfile }
    ports: ["3001:3001"]
    depends_on: [api]

  space:
    build: { context: ., dockerfile: apps/space/Dockerfile }
    ports: ["3002:3002"]
    depends_on: [api]

  live:
    build: { context: ., dockerfile: apps/live/Dockerfile }
    ports: ["3100:3100"]
    depends_on: [mongo, api]
```

---

## 10. Checklist ថាតើ "ល្អ" ឬអត់ (Definition of Done)

- [ ] `pnpm dev` បើក web+admin+space+live+api ព្រមគ្នាដោយគ្មាន error
- [ ] Shared code នៅ `packages/` — គ្មាន duplicate types/UI រវាង apps
- [ ] Instance admin អាចបិទ sign-up + config SMTP + បើក OAuth
- [x] ២ users កែ wiki ដូចគ្នា → ឃើញ realtime (live works) — verified E2E 2026-07-09 (7/7 checks)
- [x] Publish view → បើកបានពី space ដោយគ្មាន login, private data មិនលេច — verified E2E 2026-07-10 (wiki pages; leak check passed)
- [ ] CORS + JWT auth ត្រឹមត្រូវគ្រប់ apps
- [x] Docker stack ឡើងបានពេញ (mongo, redis, api, web, admin, space, live) — verified 2026-07-10, all 7 up, endpoints 200
- [ ] README update ជាមួយ apps ថ្មី + ports + env

---

## 11. ចំណុចប្រយ័ត្ន (Pitfalls)

1. **កុំ copy Plane code ត្រង់ៗ** — Plane = Django/React-Router; Prism = NestJS/Next.js។
   យកតែ *concept* (instance config, publish/anchor, Yjs live)។
2. **Refactor `packages/` មុនគេ** — បើបន្ថែម apps មុន នឹងកើត duplicate ច្រើន កែពិបាក។
3. **Public endpoints (space)** — ត្រូវ strip private fields + rate limit ការពារ data leak។
4. **Live auth** — កុំបើក WebSocket ចំហ; ត្រូវ verify JWT នៅ `onAuthenticate`។
5. **CORS** — ត្រូវ allow ៣ origins; ភ្លេចនឹង block admin/space។
6. **Instance admin ≠ workspace admin** — ២ concept ខុសគ្នា (instance = server-wide)។

---

*ឯកសារនេះជា plan កម្រិតខ្ពស់។ ចង់ឲ្យខ្ញុំបង្កើត scaffold ពិត (apps/live server,
apps/admin Next.js shell, ឬ API instance module) — ប្រាប់ phase ណាដែលចង់ចាប់ផ្តើម។*
