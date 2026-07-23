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

Known deferred work: projects/roadmap publishing (no `views` module yet); notes collab
(`blocks[]` model); admin Workspaces page (needs an instance-workspaces endpoint).

## Environment

Dev DB is **`mongodb://localhost:27017/prism` only** — never point tooling at another host.
The seed (`pnpm seed`) is destructive: it wipes and rebuilds fixtures (10 users, 3 workspaces,
password `test1234`). Never run it against data you care about.

Commands: `pnpm dev` (all apps) · `pnpm dev:api|web|admin|space|live` · `pnpm -r build` ·
`pnpm -r lint` · `pnpm --filter api build` (fastest API typecheck).

## Conversion principle

Borrow Plane's *architecture ideas*, never its code — the stacks differ
(Prism = NestJS + Mongo + Next.js; Plane = Django + Postgres + React Router).
