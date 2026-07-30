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
  - [x] E2E tests across all apps — `pnpm test:e2e:full` (7 suites, 118 checks) +
        `pnpm --filter web test:browser-smoke` (7 checks), both green 2026-07-23
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
  publish views/projects → space (ADR 0012, `test:publish-space` 16/16) ·
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

Per-phase checkbox detail lives in `PLANE-CONVERSION-PLAN.md` §8 — trust it over this list.

Known deferred work: projects/roadmap publishing (no `views` module yet); notes collab
(`blocks[]` model); admin Workspaces page (needs an instance-workspaces endpoint).

## Environment

Dev DB is **`mongodb://localhost:27017/prism` only** — never point tooling at another host.
Two seeds, both destructive (they wipe the DB — never run against data you care about):

- `pnpm seed` → `src/seed/seed.ts` — **demo** fixture (`admin@demo.com`/`admin123`, …).
- `pnpm --filter api exec ts-node -r tsconfig-paths/register src/seed/test-seed.ts` —
  **E2E** fixture: 10 `@test.com` users, 3 workspaces, password `test1234`. All E2E suites
  assume this one. Roles matter: `admin@test.com` is the only instance admin but owns/joins
  **zero** projects; `alice@test.com` owns workspace `acme` + a project.

Commands: `pnpm dev` (all apps) · `pnpm dev:api|web|admin|space|live` · `pnpm -r build` ·
`pnpm -r lint` · `pnpm --filter api build` (fastest API typecheck).
`next build` breaks a running `next dev` of the same app (shared `.next/`) — don't build a
frontend whose dev server needs to stay up; use `typecheck` instead.

## E2E testing

- `pnpm test:e2e:full` — canonical run: all 10 API suites (196 checks) via
  `scripts/e2e-full.mjs`, against a running dev stack + the E2E fixture. The runner handles
  the 5/min login throttle (65s cool-downs, override `E2E_COOLDOWN_MS`) and boots a
  disposable API on :4012 for the notes-collab suite.
- Single suite: `pnpm --filter api test:security|phase7|phase8|oauth|analytics|notes-collab|cross-app|publish-space|templates-import|cycles-modules`
  — plain-fetch `.mjs` scripts in `apps/api/test/`, no framework. Manual back-to-back runs
  hit the login throttle (429s) — space them ~65s, or just use the runner.
  `test:notes-collab` needs its own API instance (the runner provides :4012).
- `pnpm --filter web test:browser-smoke` — Playwright smoke (12 checks) across web/admin/space;
  needs the full dev stack up.
- `pnpm --filter web test:project-tabs` — Playwright, 19 checks over the four project
  tabs (cycles/modules/views/pages). It warms each route before asserting: `next dev`
  compiles routes lazily, and without that the first check to touch a cold route times
  out — which one that is moves between runs. `TAB_TIMEOUT_MS` overrides the 45s budget.

## Conversion principle

Borrow Plane's *architecture ideas*, never its code — the stacks differ
(Prism = NestJS + Mongo + Next.js; Plane = Django + Postgres + React Router).
