# How work gets done here

## Delegation

Ask **`prism-orchestrator`** first for anything touching more than one layer, or when the
right specialist is unclear. It returns a delegation plan and writes no feature code.

`prism-planner` (phase → tasks) · `prism-architect` (cross-app design, ADRs) ·
`prism-uiux` (screens, `packages/ui`) · `prism-backend` (`apps/api`) ·
`prism-frontend` (web/admin/space) · `prism-realtime` (`apps/live`, Yjs).

Ordering rules: contract before code · UX before frontend · design before realtime ·
backend and frontend parallelize once the API contract is fixed.

## Definition of done

A change is done when it **builds and was observed working** — not when it typechecks.
- API: `pnpm --filter api build`
- Frontends: `pnpm --filter <app> build` (or `typecheck` for fast iteration)
- Anything with runtime surface: drive it end-to-end (`/verify` or the `run` skill).

Phases 2 and 3 were each closed with a real E2E run against the full stack. Hold that bar.

## Git

Branch before committing; never commit to `main` directly. Conventional, plain commit
messages. Don't run `pnpm seed` or drop databases as part of a build step.
