# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Prism — Agent Instructions

Prism is a pnpm monorepo being converted into a **Plane-style multi-app platform**.
Full conversion plan: `PLANE-CONVERSION-PLAN.md`. AI team: `docs/AI-TEAM.md`.

@.claude/rules/architecture.rules.md
@.claude/rules/project.md
@.claude/rules/workflow.md

## Per-app scripts

The rules files above cover the root scripts (`pnpm dev`, `dev:<app>`, `-r build`,
`-r lint`, the E2E suites). Per package:

| Package | Fast check | Build | Lint |
| ------- | ---------- | ----- | ---- |
| `api` | `pnpm --filter api build` (nest build — this *is* the typecheck) | same | `lint` / `lint:fix` |
| `web` `admin` `space` | `pnpm --filter <app> typecheck` | `next build` | `next lint` |
| `live` | `pnpm --filter live typecheck` | `tsc -p tsconfig.json` | none — `pnpm -r lint` silently skips it |
| `packages/*` | `pnpm --filter @prism/<pkg> typecheck` | none — see below | none |

Three traps worth knowing before you run something:

- **`packages/*` are never built.** Every one of them points `main`/`exports` at
  `./src/index.ts`, so consumers compile the TypeScript source themselves — that is what
  `transpilePackages` is for, and why `packages/editor`'s `build` script is `tsc --noEmit`.
  So `pnpm -r build` and `pnpm -r lint` pass over them entirely: a package can be broken
  while both are green, and the app that imports it is where it surfaces. Their real check
  is the consuming app's `typecheck` (plus `pnpm --filter @prism/constants test`).
- **ESLint is deliberately split**: `api` is on ESLint 9 flat config, the Next apps are
  pinned to ESLint 8 by `eslint-config-next@14`. Don't unify them before Next 15.
- **Three seed scripts exist and are not interchangeable** — `seed.ts` (demo, `pnpm seed`),
  `test-seed.ts` (the E2E fixture every suite assumes), and `seed-test-data.ts`
  (`pnpm --filter api seed:test-data`, extra volume for the demo fixture). Exact commands
  and credentials are in the project rules; all of them wipe the DB.

## Cross-cutting API contract

Facts that no single file makes obvious, and that most bugs in this repo come from:

- **Guards are global and ordered** (`app.module.ts` `APP_GUARD`s): Throttler → `JwtAuthGuard`
  → `AudienceGuard` → `RolesGuard`. A new controller is therefore authenticated by default;
  opting out is `@Public()` (see `modules/public/`), not a missing guard.
- **JWTs carry an `aud` claim and the audiences are not interchangeable**
  (`common/auth/audience.ts`): `web` (apps/web, can never reach instance endpoints) ·
  `admin` (God Mode, only issued by a fresh password login to an instance admin) ·
  `collab` (apps/live only, one document, ~5 min, rejected outright on REST routes).
  Instance mutations additionally need a step-up (password re-entry) within 15 minutes.
- **apps/live authenticates against the API**, not Mongo: internal endpoints behind
  `InternalTokenGuard` + the shared `LIVE_INTERNAL_TOKEN`.
- **Validation is per-route, not global**: `@UsePipes(new ZodValidationPipe(Schema))` /
  `ZodQueryPipe`, with the schemas in the module's `dto/`. There is no global
  `ValidationPipe` — an unpiped body arrives unvalidated.
- **There is no response envelope.** `TransformInterceptor` is an intentional pass-through,
  so controllers return raw JSON and clients read `data` directly. If you ever add an
  envelope, that interceptor is the one place to do it.
- **Auth transport is access-token-in-memory + refresh cookie + double-submit CSRF.**
  `createApiClient` (`packages/services`) attaches the Bearer token, echoes the
  `prism_csrf` cookie as `X-CSRF-Token` on mutations, and de-duplicates concurrent 401
  refreshes. `X-CSRF-Token` must stay in the CORS `allowedHeaders` or every cross-origin
  mutation dies at preflight.

## The Next middlewares are load-bearing

All three Next apps run one (`src/middleware.ts`), and each request depends on it for two
things that are invisible in the component tree: the per-request **CSP nonce** (Next reads
it back off the request's own CSP header and stamps every `<script>` with it) and the
resolved **locale** (`x-locale`, which the root layout reads). Neither has a fallback — if
the middleware doesn't run, the app ships with no policy and the wrong language.

The policy body is shared in `@prism/constants/security-headers`, and its directives decide
what the *browser* will let a feature do, which is the part no typecheck can see:

- **A new off-origin fetch or socket needs `connect-src`**, a new `<iframe>` needs
  `frame-src`, an embed host needs adding in both places it is named. A directive that
  falls back to `default-src 'self'` blocks the feature silently — the page renders fine
  and the request simply never happens.
- **`X-Frame-Options` and `frame-ancestors` must agree.** They are independent headers, so
  either one can block a frame alone. Only apps/web relaxes them (`'self'`/`SAMEORIGIN`),
  because its split-pane editor frames its own routes; admin and space stay `'none'`/`DENY`.
- Browsers report a refused frame as *"localhost refused to connect"* — a symptom that
  points at a dead port, not at a header. `pnpm --filter web test:csp` is what proves any
  of this; a CSP is one of the few things that cannot be verified by reading it.

## Frontend data layer

- **Components never call axios.** The path is `src/lib/api.ts` (app-local client, sets the
  app's audience) → `src/hooks/use-<domain>.ts` (TanStack Query) → component. Adding an
  endpoint means adding/extending a hook, not fetching inline.
- **Zustand is for client state only** (`src/stores/`). `workspace-store` holds just the
  workspace *id*; the record itself comes from the `['workspaces']` query, and under
  `/[workspaceSlug]/…` the URL is authoritative (ADR 0006/0011) — the store is the fallback
  for non-workspace-scoped routes.
- Anything rendered by more than one frontend belongs in `packages/ui`; the shared editor
  (Tiptap + Yjs) belongs in `packages/editor`. Copy-pasting across web/admin/space is the
  failure mode this conversion is most prone to.
- **But `packages/*` are frontend-only.** `apps/api` and `apps/live` import zero `@prism/*`
  and don't even list them as dependencies — the two things they do share are hand-copied
  on purpose: the API's locale list is kept in sync with `@prism/i18n` by hand, and live
  owns its own copy of the Tiptap schema because it is a CommonJS server and
  `@prism/editor`'s Tiptap deps are ESM-only (ADR 0001 §5). Both copies carry a comment
  naming the canonical definition. "Just share it properly" is the obvious fix here and it
  breaks the build — look for that comment before moving anything into `packages/`.
