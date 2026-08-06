# Project state — Prism → Plane conversion

Source of truth for scope and progress: `PLANE-CONVERSION-PLAN.md` (§8 roadmap).
Keep its checkboxes in sync when work lands — the SessionStart hook reads them.

## Roadmap status

- **Phase 0 — Foundation (`packages/`)** ✅
- **Phase 1 — Instance Admin (`apps/admin`, `instance` module)** ✅
- **Phase 2 — Realtime (`apps/live`, Yjs wiki collab)** ✅
- **Phase 3 — Public Space (`apps/space`, `public` module, wiki publishing)** ✅
- **Phase 4 — Auth providers + polish** — done except OAuth credentials
  - [ ] OAuth Google/GitHub — code-complete (ADR 0008); blocked on real credentials only
  - [x] Docker: admin, space, live services
  - [x] E2E tests across all apps — green 2026-07-23 at 7 suites / 118 checks; the suite
        has grown since, so read the current numbers under "E2E testing" below, not here
- **Phase 5 — Security core** ✅ (`docs/plan/01-security-model.md`)
- **Phase 6 — Design system** ✅ (`docs/plan/02-design-system.md`) — closed 2026-07-23:
  shared `AppShell` (web+admin) + Tier 3 (`CommandPalette` ⌘K · `FilterBar` · `SidebarNav`)
- **Phase 7 — Feature parity A** ✅ (`docs/plan/03-feature-parity.md`) — 7b route
  consolidation done 2026-07-23 (ADR 0011 route tiers: Tier W under `/[workspaceSlug]/`
  with permanent flat shims; Tier P/G flat forever). Closed 2026-07-28 with the last
  two 7b items: bulk ops (`POST /issues/bulk`, `/bulk/delete` — per-issue authz,
  partial success, no URL surface) and `?layout=` on the Tier W list routes that
  have a layout switcher (`use-layout-param.ts`; URL > localStorage > fallback).
- **Phase 8 — Feature parity B** — done 2026-07-23 except OAuth credentials:
  publish views/projects → space (ADR 0012, `test:publish-space` 21/21) ·
  templates + CSV import (`test:templates-import` 14/14) · browser E2E 10/10
- **Phase 9 — Team chat + Telegram bridge** ✅ (ADR 0007, `docs/telegram-bridge-setup.md`)
- **Phase 10 — Project tabs** ✅ (ADR 0014) — closed 2026-07-29. The four
  `ComingSoon` placeholders on `/[workspaceSlug]/projects/[id]/` are now real:
  `cycles` + `modules` are **brand-new API modules** (the dirs were empty and had
  never been committed, despite `03-feature-parity.md` claiming ✅) ·
  `views` got its UI + a `?view=<id>` deep link · `pages` is a project-scoped
  index over the existing `wiki` module, opening its editor via `?project=&page=`.
  Cycle status is derived from dates, module status is stored; membership is a
  pointer on the issue (`cycleId`/`moduleId`), never an array on the container.

- **Audit gaps S1/S2** ✅ — closed 2026-07-31, the last two "real gap" findings of the
  security audit (`01-security-model.md` §3.3, §3.5). `apps/live` got payload +
  connection limits (`live/src/limits.ts`; three caps at three layers, all env-tunable)
  and `apps/web` + `apps/admin` got a per-request **nonce-based** CSP via middleware,
  policy shared in `@prism/constants/security-headers`. Two things worth carrying
  forward: `maxPayload` alone **crashed the live server** (`ws` emits `'error'`,
  Hocuspocus has no listener, Node throws) until `index.ts` attached a handler — the
  fix was strictly worse than the bug until it was driven end-to-end; and the
  §3.5 claim that `docker-compose.yml` gives `live` no `ports:` mapping is **false**
  (it has one, and needs it — the browser dials live directly).

- **Tier 0 debt** ✅ (`docs/plan/06-differentiators.md` §1) — closed 2026-07-31. Four items
  found by a repo scan, none of them a "feature": `/search` returned issue titles from
  every workspace to any caller (§1.1) · unindexed `$regex` per keystroke (§1.3) ·
  the empty `estimates/` dir (§1.2) · and `automations`, which turned out to be a **write**
  leak, not the P2 schema tidy-up it was filed as — `fire()` ran every enabled rule in the
  instance and `POST /automations/fire` let any logged-in user drive them (§1.4).

- **Post-audit clean-up** ✅ — closed 2026-07-31. `Automation.condition` is now evaluated
  (`modules/automations/condition.ts`, fail-closed, `test:phase7` 44) · per-page crawler
  indexing (`publicIndexing` on wiki/view/project → `indexable` in the public payload →
  `<meta robots>` in space, `test:publish-space` 21) · the cover-picker QA checklist is
  automated (`test:cover`) instead of manual.

  Two real defects surfaced only by driving the apps, neither visible to typecheck or
  build: **apps/space's CSP blocked its own inline RSC scripts**, so the Space had never
  hydrated (it now uses the same nonce middleware as web/admin), and **`useFocusTrap`
  captured the dialog's own autofocused field as its restore target**, dumping keyboard
  users on `<body>` after every Modal/Drawer close. Also two Next middleware traps worth
  remembering: a `config` shape Next cannot statically parse silently drops the middleware
  entirely, and the `(...)` in a matcher is a path-to-regexp parameter needing ≥1 char, so
  it never matches the basePath root — `'/'` must be listed separately.

- **Tier 1 — AI assistant moat (path A)** ✅ — closed 2026-07-31, all of 2a–2d, to the
  contract in `docs/adr/0015-assistant-write-tools-and-authorization.md`. Tools went 4 → 15,
  split into read · Tier A (auto) · Tier B (`bulk_update`, capped, prior-result ids only) ·
  Tier C (`delete_issue`/`bulk_delete`, which **return a `pendingAction` and do nothing**).
  New suite `test:assistant-tools` 18/18. Four things worth carrying forward:

  - **The tool rules have no HTTP surface, on purpose** — tiers, id provenance and the
    Telegram project pin all live inside `runTool`. So `test:assistant-tools` is TypeScript
    and in-process (`NestFactory.createApplicationContext` + real services + the real
    fixture), not another `.mjs` fetch suite; a fetch suite could only re-test the REST
    endpoints that were already covered. It needs `ts-node --files` — without it the
    ambient `markdown-it-task-lists` declaration never enters the program and compilation
    fails even though `nest build` passes.
  - **Provenance is recorded from successful results only.** Harvesting ids out of *failed*
    ones would let `update_issue` on a made-up id legitimise that id for the next call —
    which is exactly the oracle §2.3 exists to close.
  - **`ChatChannel.projectId` did not exist.** ADR §2.4 scopes the Telegram assistant to
    "the channel's project", but channels had no project link at all; it is now a nullable
    field, settable only by someone who can write that project, and **no project means the
    assistant does not answer** rather than falling back to the asker's full read set.
  - **AI is an improvement, never a gate.** `AssistantService.complete()` returns null with
    no key, so the digest falls back to `plainSummary()` and intake simply shows no
    suggestion. Nothing breaks on an unconfigured instance.

  Left undone deliberately: `apps/web` has **no intake screen at all**, so triage
  suggestions are API-only (building that UI is Tier 2 work, not §2.5); the Telegram reply
  posts to the group but not back into the Prism channel; and the model round-trip is not
  exercised in CI (no key) — the suite proves the authorization layer.

- **Workspace project-list leak** ✅ — closed 2026-08-06. `GET /projects?workspace=<id>`
  filtered on `workspaceId` alone once `assertWorkspaceMember` passed, so every workspace
  member saw every **private** project in it (name, colour, issue counts) while
  `GET /projects/:id` on the same project 404'd correctly. `listInWorkspace` now applies
  both rules — strict workspace match (ADR 0006) **and** `canRead` (ADR 0003). It had been
  there since the list existed (`1f2a315`), and no amount of reading found it: it surfaced
  because `test:phase7` **flaked**. The seeded projects share an `updatedAt`, the
  `sort({updatedAt:-1})` tie-break is unstable, and the day it put a private project first
  the suite wrote into it and reported a 404 that looked like a regression in new code.
  Two lessons worth keeping: **a list endpoint and its detail route must agree** — the
  cheap test for any scoped list is "does `GET /:id` accept everything the list returned"
  (now asserted in `views-relations.e2e.mjs`); and **readable ≠ writable** — reading an
  `internal` project needs only workspace membership, writing needs project membership, so
  a test that picks any readable project to write into is a 403 waiting for the right sort
  order.

Per-phase checkbox detail lives in `PLANE-CONVERSION-PLAN.md` §8 — trust it over this list.

Known deferred work (verified against the code 2026-07-31 — the previous three entries
here had all shipped and were removed):

- OAuth Google/GitHub — code-complete (ADR 0008), blocked on real credentials only

**Ticking a box here requires reading the code, not the last commit message.** Three
separate times a doc claimed something that did not exist — `cycles`/`modules` (Phase 10),
`estimates` (2026-07-31), and this deferred list. `pnpm --filter api lint` now runs
`scripts/check-module-inventory.mjs`, which catches an empty module dir or an unwired
`*.module.ts` — but nothing automated can catch a wrong checkbox.

## Environment

Dev DB is **`mongodb://localhost:27017/prism` only** — never point tooling at another host.
Two seeds, both destructive (they wipe the DB — never run against data you care about):

- `pnpm seed` → `src/seed/seed.ts` — **demo** fixture (`admin@demo.com`/`admin123`, …).
- `pnpm --filter api exec ts-node --files -r tsconfig-paths/register src/seed/test-seed.ts` —
  **E2E** fixture: 10 `@test.com` users, 3 workspaces, password `test1234`. All E2E suites
  assume this one. `--files` is **not optional** (added 2026-08-06): the seed pulls in
  `public.service.ts`, whose `markdown-it-task-lists` import only typechecks via the ambient
  declaration, and ts-node drops ambient files without it — same reason `test:assistant-tools`
  carries the flag. Without it the seed dies on TS7016 and pnpm reports the misleading
  `Command "ts-node" not found`. Roles matter: `admin@test.com` is the only instance admin but owns/joins
  **zero** projects; `alice@test.com` owns workspace `acme` + a project.

Commands: `pnpm dev` (all apps) · `pnpm dev:api|web|admin|space|live` · `pnpm -r build` ·
`pnpm -r lint` · `pnpm --filter api build` (fastest API typecheck).
`next build` breaks a running `next dev` of the same app (shared `.next/`) — don't build a
frontend whose dev server needs to stay up; use `typecheck` instead.

## E2E testing

- `pnpm test:e2e:full` — canonical run: 11 API suites + `live: test:limits` (**242**
  checks as of 2026-07-31 — `test:assistant-tools` added 18; it is in-process and costs
  no login, so the runner needs no cool-down around it. Earlier deltas:
  security 18→21 for the `/search` scope, phase7 31→38 for automation tenancy and
  38→44 for the condition engine, publish-space 16→21 for per-page indexing) via
  `scripts/e2e-full.mjs`, against a running dev stack + the E2E fixture. The runner handles
  the 5/min login throttle (65s cool-downs, override `E2E_COOLDOWN_MS`) and boots a
  disposable API on :4012 for the notes-collab suite.
- Single suite: `pnpm --filter api test:security|phase7|phase8|oauth|analytics|notes-collab|cross-app|publish-space|templates-import|cycles-modules`
  — plain-fetch `.mjs` scripts in `apps/api/test/`, no framework. Manual back-to-back runs
  hit the login throttle (429s) — space them ~65s, or just use the runner.
  `test:notes-collab` needs its own API instance (the runner provides :4012).
- `pnpm --filter api test:assistant-tools` — the odd one out: **TypeScript, in-process**
  (`ts-node --files`, a real `NestFactory.createApplicationContext`, real services, real
  fixture). 18 checks over ADR 0015 §5. Needs Mongo + the fixture and **nothing else** —
  no dev API, no AI key, no network. See its file header for why it cannot be a fetch suite.
- `pnpm --filter web test:browser-smoke` — Playwright smoke (12 checks) across web/admin/space;
  needs the full dev stack up.
- `pnpm --filter web test:csp` — Playwright, 24 checks that the web/admin/space CSP is both
  *present* and *survivable*: nonce on every script, nonce differs per request, the app
  hydrates and reaches its sockets under the policy, zero violations during real use,
  and an injected `<script>` is actually blocked. Needs web + admin + space + api up.
  Does two logins, so it respects the 5/min throttle — space it ~65s from another suite.
- `pnpm --filter web test:cover` — Playwright, 15 checks + 1 env skip. The cover-picker
  QA pass from `docs/plan/05` §8, which was written as a *manual* checklist and had never
  been done. Intercepts `/unsplash/search` for the failure states (502, no results, not
  configured) and leaves one check un-intercepted to exercise the real proxy; that one
  skip-warns when no Unsplash key is configured. Needs web + api up.
- `pnpm --filter live test:limits` — 7 checks on the live abuse limits (§3.3). **In the
  runner** (it is headless and self-contained). Boots its *own* live server on :3111 with
  tiny caps (4 conns · 2/doc · 64 KiB) and never touches :3100. Needs a dev api on :4000 +
  the E2E fixture, since the per-doc cap only counts authenticated connections and so
  needs real collab tokens.

The three **browser** suites (`test:browser-smoke`, `test:csp`, `test:project-tabs`) are
deliberately outside `test:e2e:full` — they need web/admin/space serving plus Playwright,
so folding them in would turn "a frontend failed to start" into "the API run failed".
- `pnpm --filter web test:project-tabs` — Playwright, 19 checks over the four project
  tabs (cycles/modules/views/pages). It warms each route before asserting: `next dev`
  compiles routes lazily, and without that the first check to touch a cold route times
  out — which one that is moves between runs. `TAB_TIMEOUT_MS` overrides the 45s budget.

## Conversion principle

Borrow Plane's *architecture ideas*, never its code — the stacks differ
(Prism = NestJS + Mongo + Next.js; Plane = Django + Postgres + React Router).
