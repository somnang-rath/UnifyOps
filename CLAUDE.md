# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: approved for build, slice 3 landed

`PLAN.en.md` / `PLAN.km.md` are the specification and still carry more weight than the code. The build was
approved on **2026-08-31**, and §18's last two blocking questions were answered the same day: **#11** audit
records are a second sink on the event registry, and **#12** the platform operator gets its own read-only
database role. Both are implemented — see below. The remaining open questions (#5, #6, #7, #9, #10) do not
block anything before slice 8.

Slices are still built **one at a time, in §14's order, on request**. The approval was to start, not a
standing licence to run ahead — slice 4 (projects, workflow states, i18n scaffold) is next and has not been
started.

What exists: **slices 0, 1, 2, 3, and part of slice 4** — the i18n scaffold, the design-token layer, the
tenancy foundation (`src/server/db`, `drizzle/`), the policy module (`src/server/authz/`), and now
authentication, workspace creation, teams and invitations (`src/server/auth`, `src/server/services`, and the
routes under `src/app/[locale]/`). All the `db:*` scripts work once `pnpm db:setup` has run.

Every gate passed on 2026-09-02 — `typecheck`, `lint`, `test` (95 unit), `build`, `test:e2e` (47 across three
Playwright projects) and `test:tenancy` (51 against real Postgres 18.4). **Re-run them rather than trusting
this line**; it is a snapshot, not a promise.

**`pnpm test:e2e` now needs a database.** From slice 3 the flows §15 asks to be tested in a browser are flows
through one, so the Playwright web server provisions its own before starting Next — see
`e2e/support/serve.ts`. It uses the same `src/server/db/provision.ts` the tenancy harness does, so the browser
drives the same isolation the RLS suite asserts rather than a permissive copy of it.

Neither `test:tenancy` nor `test:e2e` can use Docker on this machine — Docker Desktop's Linux engine would not
start (the `docker-desktop` WSL distro stayed `Stopped`). If Testcontainers hangs, that is why, and the
fallback is real and is what both suites were verified against:

```bash
initdb -D /tmp/pg -A trust -U postgres            # once
pg_ctl -D /tmp/pg -o "-p 55432" -l /tmp/pg.log start
TENANCY_SUPERUSER_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm test:tenancy
TENANCY_SUPERUSER_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm test:e2e
```

One thing worth knowing before debugging an install: two dependency versions in `package.json` had never
existed on the registry (`eslint@^9.40.0`, `@types/react-dom@^19.2.8`) and blocked `pnpm install` outright.
Both are corrected. If `install` ever fails again with `ERR_PNPM_NO_MATCHING_VERSION`, check the range
against the registry before assuming a network problem.

## Commands

Package manager is **pnpm** (per the plan's slice-0 definition of done); Node >= 22. `pnpm-lock.yaml` is
committed — CI installs with `--frozen-lockfile`.

| | |
| --- | --- |
| `pnpm dev` | Next dev server |
| `pnpm build` / `pnpm start` | Production build (`output: 'standalone'`) and serve |
| `pnpm typecheck` | `tsc --noEmit` — the fastest real signal in this repo right now |
| `pnpm lint` | ESLint 9 flat config; bans `next/link` and `DATABASE_URL_OWNER` in `src/` |
| `pnpm test` / `pnpm test:watch` | Vitest — unit only, `src/**`; e2e is excluded |
| `pnpm test -- <pattern>` | Single file or test-name pattern |
| `pnpm test:e2e` | Playwright, three projects: `en`, `km`, `mobile-km`. **Needs Postgres** — it provisions its own |
| `pnpm test:tenancy` | The RLS suite, on real Postgres. Its own config (`vitest.tenancy.config.ts`), not part of `pnpm test` |
| `pnpm db:setup` | One-time: create the database and all three roles. Prompts for the superuser password |
| `pnpm db:generate` | Drizzle migration from `src/server/db/schema/index.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | `tsx` scripts under `src/server/db/` |

Postgres 18.4 is installed locally and listening on 5432 with `scram-sha-256` on every line of `pg_hba.conf`.
The `unifyops` database and its **four** roles **do not exist yet**: run `pnpm db:setup` once. That reads the
generated role passwords out of `.env` and hands them to `scripts/bootstrap.sql` as psql variables, so no
secret lands in the SQL or in shell history; psql prompts for the superuser password. Nothing
database-shaped works before that.

`pnpm test:tenancy` does not need any of it — it provisions its own Postgres through Testcontainers (needs
Docker), or uses an existing server if `TENANCY_SUPERUSER_URL` points at one with superuser rights. It is
deliberately excluded from `pnpm test`: folding it in would make the fast unit suite depend on Docker, and
the usual response to that is to skip it — which is the one suite that must never be quietly green.

## The one architectural rule that everything else hangs off

**Four database roles, and they are not interchangeable.**

- `DATABASE_URL_OWNER` — owner role. **Migrations and `drizzle-kit` only.** Owns every table, which is why
  every tenant table is `FORCE ROW LEVEL SECURITY` rather than merely `ENABLE`. Never held by the running app.
- `DATABASE_URL` — non-owner application role. The only connection that may touch tenant data at runtime.
- `DATABASE_URL_OPERATOR` — platform support (§18-12). Cross-tenant `SELECT` and nothing else, behind its own
  auth boundary. Anything that must *act* inside a workspace goes through an invited account plus view-as.
  There is deliberately no session-variable bypass on the app connection.
- `DATABASE_URL_IDENTITY` — the pre-tenancy handshake (slice 3, §17-30). Sign in, sign up, and exchange an
  invitation token for the workspace it names all happen *before* a workspace is known, and every app-role
  policy is false when `tenancy.workspace_id()` is NULL — correctly so. This role is that one moment.

  Its reach is short enough to state in a sentence, and `invariants.test.ts` asserts the grant list
  **exactly**: `app_user`, `workspace`, the `auth_*` tables, `invitation` by token, and on `workspace_member`
  only the rows of the user it has already authenticated. It cannot read one row of what a company is
  *doing*, and it has no `CREATE` anywhere. `bootstrap.sql` gives it no default privileges on purpose, so a
  tenant table added in a later slice is outside it by construction rather than by anyone remembering.

  0002's comment says signup runs "as the owner". **It no longer does** — that would put a DDL-capable
  credential in the web process. 0004 records the correction; the owner keeps its `provisioning` policies
  only because `pnpm db:seed` still runs as the owner.

Tenant isolation is Postgres RLS, deliberately *not* a remembered `WHERE` clause, because a scoped
data-access layer fails the moment one query is written outside it and that query is invisible in review.
RLS turns the failure mode from "returns another company's data" into "returns nothing". Every tenant table
also carries a denormalized `workspace_id` held honest by composite foreign keys, so a row physically cannot
reference a parent in another workspace.

If you ever find yourself reaching for the owner connection at runtime to make something work, that is the
bug — not the RLS policy. The identity role is not a loophole in that rule: it is a separate credential with
a separate, short, asserted grant list, and it has to be asked for by name (`withIdentity`, whose handle is
branded `IdentityDb` exactly as `withActor`'s is branded `TenantDb`).

Supporting mechanisms, all specified in `PLAN.en.md` §8–§9. The first three are **built** (slice 1); the rest
belong to later slices.

- `withActor(ctx, fn)` (`src/server/db/tenant.ts`) opens the transaction, sets **transaction-local** tenancy
  variables (so a pooled connection cannot leak scope across requests), builds a unit of work, and flushes
  events **before commit**. It is the only producer of a `TenantDb`.
- The Drizzle handle is a **branded type** (`TenantDb` in `src/server/db/client.ts`); repositories accept
  nothing else. Querying outside `withActor` is a compile error — and, if it somehow happens at runtime,
  returns zero rows rather than another company's data, because the tenancy GUC is unset and every policy
  predicate is false.
- Events fan out from an `eventRegistry` that is **exhaustive over the event union** by construction — it is
  a mapped type over `DomainEvent['type']`, so adding an event without an entry does not compile. Today the
  entry carries one field, `audit`; slice 7 adds the activity projector to the same entry and slice 9 the
  outbox.
- **Audit is not activity** (§18-11). `audit_record` is workspace-scoped, Owner/Admin-visible, never
  translated, and **append-only enforced twice**: no `UPDATE`/`DELETE` policy, and those privileges revoked
  from the app role. It carries `actor_user_id` *and* `on_behalf_of_user_id` so a view-as session is visible
  in the log that exists to record it. It is also the one table whose `INSERT` policy has no
  `not read_only` clause — a view-as session refuses mutations but must still be recorded.
- **View-as is enforced at the database, not only in the policy module.** `withActor` sets
  `unifyops.read_only`, and every tenant table's `INSERT`/`UPDATE`/`DELETE` policy carries
  `and not tenancy.is_read_only()`.
- Adding a table is three things, not one: `...tenantPolicies()` in the schema, a `FORCE ROW LEVEL SECURITY`
  line in a hardening migration, and a `workspace_id` column. `invariants.test.ts` fails if any table in
  `public` is missing one — that is the gate, not a review checklist.
- The list query is one Zod filter DSL, one builder, two queries (counts + `LATERAL` per-group page, because
  a board needs a page *per column*). Keyset cursors only; an `invariant` refuses to emit an unanchored
  workspace-wide scan.
- Board ordering: the client sends **neighbour IDs, never a rank**; the server reads neighbours under
  `FOR UPDATE` and computes the fractional index.

Planned layout (`PLAN.en.md` §8) — follow it rather than inventing one:

```
src/app/[locale]/{(auth),(onboarding),[workspaceSlug]/...}   src/app/api/internal/{reorder,list,upload}
src/server/{db/{schema,client.ts,tenant.ts,identity.ts},auth,authz/policy.ts,queries,services,events,jobs}
src/components/{ui,auth,invite,members,work-item,views}   src/i18n   src/lib   drizzle/
```

`src/lib` is for code **both sides run** — `slug.ts`, `recipients.ts`, `form-state.ts`, `cn.ts`. Anything in
`src/server` that a client component needs belongs there instead, and anything that touches a connection
carries `import 'server-only'` at the top so a mistaken client import is a build error rather than a bundle.

The migration order in `drizzle/` is load-bearing: `0000` creates the `tenancy.*` functions **before** `0001`
creates policies that call them, and `0002` adds what drizzle-kit cannot express (`FORCE ROW LEVEL SECURITY`,
grants, revokes). Slice 3 repeats the pair — `0003` is generated, `0004` is the hand-written hardening for the
tables it adds plus the identity role's grant list. Regenerating a generated file with `db:generate` is fine;
`0000`, `0002` and `0004` are hand-written and must stay that way. A hand-written migration is scaffolded with
`db:generate --custom` so the journal and snapshot stay consistent.

Three conventions that surprise people:

- **`src/proxy.ts`, not `src/middleware.ts`.** Next 16 renamed the file convention; the old name still works
  but warns on every build. The next-intl factory is still called `createMiddleware`.
- **Route handlers under `src/app/api/` are excluded from the locale proxy** by its matcher, which is
  correct — they are not locale-prefixed. Only page routes carry `/en` or `/km`.
- **Import `Link`, `useRouter`, `usePathname`, and `redirect` from `@/i18n/navigation`**, never from
  `next/link` or `next/navigation`. The plain ones silently drop the locale prefix. ESLint errors on this.

## Authentication is ours, not Auth.js

§8 named Auth.js v5 with "email/password + Google, **database sessions**". Those two are mutually exclusive in
that library — its Credentials provider only supports JWT sessions — and its Drizzle adapter needs `INSERT` on
`app_user`, which 0002 revoked. §17-29 records the resolution: the requirement wins over the named dependency.

- **Passwords** are scrypt from `node:crypto` (`src/server/auth/password.ts`). No native module, no rebuild
  per Node major. Parameters are `N=2^16, r=8, p=1` — half OWASP's 2024 floor, deliberately, because
  verification is synchronous work on the same event loop as every render (§8's one-container deployment) and
  2^17 would stall the process under a handful of concurrent sign-ins. The parameters travel *with* each hash,
  so `needsRehash` upgrades an account on its next sign-in rather than locking anyone out.
- **Sessions are rows** (`auth_session`). The cookie carries a random token; the table stores its SHA-256, so
  a dump yields no usable session. A row rather than a JWT because three later promises need revocation to be
  immediate: offboarding (§7.12), view-as (§7.13), and a role change taking effect on the next click.
- **The same rule covers all three bearer credentials** — session cookie, verification link, invitation link.
  `src/server/auth/tokens.ts` is the only place one is minted or hashed. There is no unhash: an invitation
  cannot be resent with the same link, and `resendInvitation` mints a new one on purpose.
- **Email verification does not block** (§17-31). §7.1 draws it as a step between signup and creating a
  company; as a gate it puts a mail round trip inside a three-minute target and makes a provider outage cost
  the account. The account works immediately; `VerifyEmailBanner` stands on every workspace screen until done.
- **Every failure crosses the wire as a message key**, never a sentence (`src/lib/form-state.ts`). An English
  string returned from a server action is the one place Khmer silently degrades.
- **`src/lib/form-state.ts` exists because of a build rule**, not taste: a `'use server'` file may export only
  async functions, so an exported `IDLE` constant fails the build with an error pointing at the last line of
  the file.

## Invitations, and why they are three phases

`src/server/services/invitations.ts` is shaped by one sentence in §7.10: "part of a batch fails → **no
rollback**; the result lists sent and not-sent, with retry on the failures only."

1. One transaction writes every invitation row with delivery `pending`.
2. The mail goes out **outside every transaction** — forty network calls inside one would hold the pool.
3. A second transaction records what actually happened per row.

Die between 2 and 3 and the invitations read as "pending", which is honest and already has a resend button.

`parseRecipients` (`src/lib/recipients.ts`) and `slugify` (`src/lib/slug.ts`) are **pure and live in `lib`
because both sides run them** — the form previews chips and derives the slug as the user types, the server
parses and validates the same input on submit. One implementation, so the preview cannot promise something
the send does not do.

The Khmer romanisation in `slug.ts` is an **approximation and is documented as one**: a faithful one needs
syllable segmentation (ភ្នំពេញ is *Phnom* Penh, and the o is written nowhere). §7.1 makes the slug editable,
which is what makes that acceptable. `slug.test.ts` pins the real output so a change to the table is a diff
someone has to look at.

## Authorization is one module, and it is not tenancy

`src/server/authz/policy.ts` is the whole of §10. `can(actor, action, resource)`, plus `why()` for the
denial reason, `assertCan()` for call sites that must not continue, and `ACTIONS` / `isMutation()` for the
surfaces that walk the matrix. Slice 2, built 2026-08-31.

- **RLS answers "whose data is this"; the policy module answers "may this person do this".** They are
  different failure modes and different layers. The module's workspace check is defence in depth against a
  row that should never have been handed to it — not the tenancy boundary.
- `rules` is a **mapped type over `Action`**, the same construction as `eventRegistry`: adding an action
  without deciding its rule does not compile, so a check cannot be forgotten by omission. The comment above
  each entry is its §10 row.
- The module is **pure** — no `next/headers`, no database handle, no clock — which is what makes the full
  matrix testable with no HTTP and no Postgres. Keep it that way; the `Actor` is resolved by the caller.
- **Composition lives in `effectiveProjectRole` only.** Owner/Admin are implicit Leads everywhere; a
  workspace-visible project grants Members implicit Viewer; **Guests get nothing implicitly**. Never
  pre-bake an implicit role into `Actor.projectRoles` — that map is explicit memberships.
- The **Guest column of §10 is a cap, not a shorthand**: a Guest made project Lead still cannot change
  project settings or delete others' comments, though they can write work items. `policy.test.ts` pins this.
- **View-as is refused here as well as in the database.** Every action carries `mutation: boolean`, and
  `readOnly` denies all of them with the distinct reason `read_only` — because "you are in view-as" and
  "you are not a Lead" are different toasts. Denials are identifiers; the sentences are translated.
- `src/server/authz/roles.ts` is the **single source of truth for both role enums**, and
  `schema/workspace.ts` builds its `pgEnum` from it. Slice 4's `project_role` enum must do the same.

## Bilingual invariants

English and Khmer ship together or not at all; Khmer is never the degraded path. Retrofitting this is
called out in the plan as the most expensive available mistake, so these are load-bearing:

- **Locale prefix is always present** (`localePrefix: 'always'` in `src/i18n/routing.ts`). No "default
  locale has no prefix" special case.
- **Latin digits are pinned** for both locales in `src/i18n/request.ts` — Khmer locale otherwise renders
  `០១២៣`, which nobody wants in a task list. Any new `formats` entry needs `numberingSystem: 'latn'`.
- **The Khmer face goes after the Latin face in every font stack** (`--font-sans`, `--font-display`) so it is
  only reached by Khmer codepoints.
- `:lang(km)` sets `line-height: 1.75` — Khmer stacks diacritics vertically and clips at Latin heights.
  Applied by `[lang]` so it follows content, not layout.
- **Truncation must use grapheme segmentation** (`Intl.Segmenter`), never character slicing.
- Search: `tsvector('simple')` for Latin, `pg_trgm` for Khmer (no inter-word spaces, so word-based FTS
  fails), routed by script detection.
- `en.json` and `km.json` must stay key-for-key identical. Adding a string to one without the other is a
  defect, not a TODO.
- Closed enums (priority, state groups) map in code — **no translation key ever reaches the database**.
  Seeded defaults are the awkward middle: they carry a key, render translated until renamed, then the key
  clears and the literal wins.

## Design tokens

`src/app/globals.css` is three deliberate layers. Do not collapse them:

1. `@theme` — raw ramps, fixed, identical in both themes.
2. `:root` / `.dark` — semantic aliases. **These are the only things that flip.**
3. `@theme inline` — re-exposes the semantic aliases as Tailwind utilities (`bg-surface`, `text-muted`, …).

Components use semantic utilities only; never a raw ramp value and never a literal hex. All three shadow
tokens and both ring tokens are exposed through `@theme inline`, so `shadow-sm` resolves to the token rather
than to Tailwind's own default — no component should need `shadow-[var(--shadow-sm)]`.

Values marked `BRAND` are the seven flat Unify colours. §18-1 is decided — UnifyOps inherits the Unify
family palette and typography — so these are the brand's real values, not placeholders: treat them as fixed.
Everything else is derived and tunable. Sky `#54A6DB` on Ivory is ~2.4:1 and **fails WCAG AA for text**:
**Navy is the text blue**, Sky is for fills, accents, and large text.

**next-themes** puts `.dark` on `<html>` (`attribute="class"`, `defaultTheme="system"`), which is why the
layout carries `suppressHydrationWarning`: the class is set by an inline script before paint, so there is no
flash of the wrong theme. The provider is the whole mechanism — every colour decision is already made by the
semantic aliases. `e2e/theme.spec.ts` compares computed styles across both themes, because a component that
hard-codes a light-mode colour still *renders* fine; only the comparison catches it.

## Tooling in `.claude/`

Three design skills load on demand — `design-tokens` (colour, dark mode, adding a token), `khmer-ui`
(strings, fonts, truncation, search), `ui-component` (anything in `src/components/`, carrying the settled
§12 component specs and the five-states requirement). They encode decisions already made in the plan; they
do not invent design rules.

`.claude/hooks/check-design-tokens.sh` runs after every write and greps for literal hex outside
`globals.css`, ramp utilities in components, Tailwind defaults like `bg-white`, `outline: none`, and
`.slice()` on possible user text. It reports rather than blocks, and the slicing check is heuristic — it
will occasionally fire on an array.

`design-reviewer` is a read-only subagent that audits UI against all of the above plus contrast, the five
states, and the accessibility baseline.

## Keeping documents in sync

`PLAN.en.md` and `PLAN.km.md` are the same document in two languages, and `PLAN.md` states the rule
explicitly: a change to one must be made in the other. Section numbering, table rows, and the §17 findings
list are expected to correspond one-for-one. A web rendering of the plan is published as an artifact linked
from `PLAN.md`; it is a third surface for the same content and drifts if only the Markdown is edited.

## Not part of this product

`UnifyCharge_Brand_Assets/` belongs to a different product (EV charging) owned by the same company, and is
gitignored. Per §18-1 UnifyOps *inherits its palette and typography* — that is the only thing it is evidence
of. It says nothing about what UnifyOps does, and the other UnifyCharge paths in this session's working
directories are unrelated to this product.

**The logo is the exception, and it is not in the repo.** Colours and fonts come from that pack; the mark
does not. UnifyOps uses the **parent Unify logo**, never anything under `02_Logos/` — all three logomarks
there are a hexagon around a lightning bolt, and the bolt means EV charging. The Unify file has not been
supplied yet, so anything needing a mark (header, favicon, auth page, empty states) is blocked on it: ask,
do not substitute. When it arrives, recolour it to `currentColor` or the Sky token — the UnifyCharge SVGs
are filled `#28A6DF`, which does not match the palette's own Sky `#54A6DB`.

Two other facts about that pack, since it is the only brand evidence on disk: the palette PDF confirms all
seven hex values exactly as `globals.css` has them, and **Kantumruy Pro is not in it.** Only Koh Santepheap
ships with the brand, and it is display-weight — Kantumruy Pro is our own addition for Khmer body text
under §18-2.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
