# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: approved for build, slice 9 landed (notifications, pg-boss, email, the due-date digest)

`PLAN.en.md` / `PLAN.km.md` are the specification and still carry more weight than the code. The build was
approved on **2026-08-31**, and §18's last two blocking questions were answered the same day: **#11** audit
records are a second sink on the event registry, and **#12** the platform operator gets its own read-only
database role. Both are implemented — see below. The remaining open questions (#5, #6, #7, #9, #10) do not
block anything now. **§18-10 (holiday calendar maintenance) is still open and is now load-bearing**: slice 9
created the `workspace_holiday` table the digest reads, so the question is no longer hypothetical — it is
where the first year of rows comes from.

Slices are still built **one at a time, in §14's order, on request**. The approval was to start, not a
standing licence to run ahead. **§18-5 and §18-6 were answered on 2026-09-03** — attachment storage is
**Cloudflare R2** and there is **no known data-residency requirement**, revisited with the pilot customer
(§18-7) — and both `PLAN.en.md` and `PLAN.km.md` record them as RESOLVED rather than OPEN.

§14 named slices **1, 2, 5 and 6** the four places a wrong decision is expensive to reverse. All four are
behind us. Slice 7 added a second field to the `eventRegistry` entry that slices 1 through 6 had been
filling in all along, and **slice 9 added the third and last one** — the outbox. The entry is now complete
as §8 draws it: audit, activity, notify.

**Slice 9 left one thing it was expected to do.** The periodic job that sweeps abandoned uploads (slice 8's
`pending` attachment rows) was not built. The worker and its schedule now exist, so it is a handler and a
cron line rather than any new machinery — but it is not done, and an abandoned upload still occupies storage
indefinitely.

What exists: **slices 0 through 9** — the i18n scaffold, the design-token layer, the tenancy foundation
(`src/server/db`, `drizzle/`), the policy module (`src/server/authz/`), authentication, workspace creation,
teams and invitations (`src/server/auth`, `src/server/services`), projects, project membership and workflow
states, work items, labels, the §9 list query and the List view (`src/lib/work-item-query.ts`,
`src/server/queries/work-items.ts`, `src/server/services/work-items.ts`, `labels.ts`, and the routes under
`src/app/[locale]/[workspaceSlug]/projects/`), and now the board, fractional ranking and the Toast
(`src/components/views/board-view.tsx`, `use-board-sync.ts`, `src/components/ui/toast.tsx`,
`moveWorkItem` and `src/app/api/internal/reorder/`), and the activity feed — the projector half of the event
registry, the `activity` table, and the history panel on the item page (`src/server/queries/activity.ts`,
`src/server/services/activity.ts`, `src/components/work-item/activity-feed.tsx`), and now comments and
mentions — the `comment` and `comment_mention` tables, the thread and its composer (`src/lib/mentions.ts`,
`src/server/queries/comments.ts`, `src/server/services/comments.ts`,
`src/components/work-item/comment-thread.tsx`, `comment-composer.tsx`, `comment-delete.tsx`), and
attachments — the `attachment` table, the S3-compatible storage port and its two drivers, the ticket and
download route handlers, and the file panel (`src/lib/attachments.ts`, `src/server/storage/`,
`src/server/queries/attachments.ts`, `src/server/services/attachments.ts`, `src/app/api/internal/upload/`,
and the `attachment-*.tsx` components under `src/components/work-item/`), and now notifications — the
transactional outbox, the inbox and its bell, per-user preferences, and the evening due-date digest
(`src/lib/notification-kinds.ts`, `src/server/db/schema/notification.ts`, `src/server/queries/notifications.ts`,
`src/server/services/notifications.ts`, `src/server/jobs/`, the `notifications/` components, and the
`inbox/` and `settings/notifications/` routes). All the `db:*` scripts work once `pnpm db:setup` has run.

Every gate passed on 2026-09-03 after slice 9 — `typecheck`, `lint`, `test` (229 unit), `build`, `test:e2e`
(98 across three Playwright projects, 1 pre-existing skip) and `test:tenancy` (148 against real Postgres
18.4). **Re-run them rather than trusting this line**; it is a snapshot, not a promise.

Slice 8 fixed a latent race in two earlier e2e tests rather than working around it. `activity.spec.ts` and
`work-item.spec.ts` both changed a state and then immediately called `page.goto`, which can abort the server
action mid-flight — visible in the server log as `The destination stream closed early`, and on screen as a
mutation that silently did not happen. Both now wait for `StateSelect` to re-enable itself first, which is
the signal that the transition committed. It only ever failed on `mobile-km`, and only under parallel load;
adding a second panel to the item page was enough to expose it.

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

The Postgres binaries are at `C:\Program Files\PostgreSQL\18\bin` and are **not on PATH**. Two Windows
details cost an hour in slice 4: `pg_ctl … start` does not detach from Git Bash, so run it through
PowerShell's `Start-Process` — and if the shell it was launched from is killed, the server dies mid-write
and comes back in a "could not reserve shared memory region" loop that only `pg_ctl -m immediate stop`
clears.

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
| `pnpm jobs` | The job worker — §8's **second process type**. Notifications and the digest do not happen without it |
| `pnpm build` / `pnpm start` | Production build (`output: 'standalone'`) and serve |
| `pnpm typecheck` | `tsc --noEmit` — the fastest real signal in this repo right now |
| `pnpm lint` | ESLint 9 flat config; bans `next/link` and `DATABASE_URL_OWNER` in `src/` |
| `pnpm test` / `pnpm test:watch` | Vitest — unit only, `src/**`; e2e is excluded |
| `pnpm test -- <pattern>` | Single file or test-name pattern |
| `pnpm test:e2e` | Playwright, three projects: `en`, `km`, `mobile-km`. **Needs Postgres** — it provisions its own |
| `pnpm test:tenancy` | The RLS suite, on real Postgres. Its own config (`vitest.tenancy.config.ts`), not part of `pnpm test` |
| `pnpm db:setup` | One-time: create the database and all three roles. Prompts for the superuser password |
| `pnpm db:generate` | Drizzle migration from `src/server/db/schema/index.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | `tsx` scripts under `src/server/db/`. `db:migrate` also installs pg-boss's schema, as the owner |

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
  only the rows of the user it has already authenticated. The tables slices 4 and 5 add are deliberately
  **not** on that list — which is why `resolveActorContext` loads a member's project roles through `withActor` on the
  app connection rather than adding them to the handshake. It cannot read one row of what a company is
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

**Every pool is built by `createPool` (`src/server/db/pool.ts`), never by `new Pool` directly.** A `pg.Pool`
is an EventEmitter, and it emits `'error'` when a client sitting *idle* in it loses its backend — Postgres
restarted, an admin terminated the session, a socket was dropped. An `'error'` event with no listener is
rethrown by Node as an uncaughtException, so a dropped idle connection does not fail a query: it kills the
process. Under `next dev` the process it kills is the render worker, and what the browser is shown is
jest-worker's obituary — `Jest worker encountered 2 child process exceptions, exceeding retry limit`, with no
stack, no route and no mention of Postgres, usually followed by `write EPIPE` in the terminal. If you ever
see that message, this is the first thing to check. `pool.test.ts` pins the listener; the log line carries
the message and SQLSTATE only, because a `pg` error carries the whole `Client` and printing it prints the
password.

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
  a mapped type over `DomainEvent['type']`, so adding an event without an entry does not compile. The entry
  carries three fields — `audit`, `activity` and `notify` — which is the whole of §8's diagram. Adding an
  event without deciding all three does not compile.
- **Audit is not activity** (§18-11), and since slice 7 both tables exist to prove it. `audit_record` is
  workspace-scoped, Owner/Admin-visible, never translated, and **append-only enforced twice**: no
  `UPDATE`/`DELETE` policy, and those privileges revoked from the app role. It carries `actor_user_id` *and*
  `on_behalf_of_user_id` so a view-as session is visible in the log that exists to record it. It is also the
  one table whose `INSERT` policy has no `not read_only` clause — a view-as session refuses mutations but
  must still be recorded. `activity` is the opposite on that last point and the same on every other.
- **View-as is enforced at the database, not only in the policy module.** `withActor` sets
  `unifyops.read_only`, and every tenant table's `INSERT`/`UPDATE`/`DELETE` policy carries
  `and not tenancy.is_read_only()`.
- Adding a table is three things, not one: `...tenantPolicies()` in the schema, a `FORCE ROW LEVEL SECURITY`
  line in a hardening migration, and a `workspace_id` column. `invariants.test.ts` fails if any table in
  `public` is missing one — that is the gate, not a review checklist. `audit_record` and `activity` are the
  two tables that write their policies by hand rather than calling `tenantPolicies()`, because both are
  append-only and the helper grants all five.
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
grants, revokes). Every slice after that repeats the pair — `0003`/`0004` for slice 3, `0005`/`0006` for slice
4, `0007`/`0008` for slice 5. Regenerating a generated file with `db:generate` is fine; `0000`, `0002`,
`0004`, `0006`, `0008`, `0010`, `0012`, `0014` and `0016` are hand-written and must stay that way. A hand-written migration is
scaffolded with `db:generate --custom` so the journal and snapshot stay consistent. **Renaming a generated
migration means editing its `tag` in `drizzle/meta/_journal.json` too, and deleting one means deleting its
snapshot** — drizzle-kit diffs against the highest snapshot it finds, so a stale `000N_snapshot.json` makes
the next generation silently emit nothing for a table it thinks already exists.

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

## Projects, and the two names every seeded row carries

`src/server/services/projects.ts` and `workflow-states.ts` are slice 4. Three decisions in them are the ones
worth knowing before touching either.

- **Visibility is written twice, on purpose, and one of the two is the authority.** `listProjects` expresses
  §10's visibility rule as a SQL predicate — fetching every project in a 200-project workspace to filter five
  in TypeScript is how a list view stops being usable — and then re-checks every row it got back through
  `can(actor, 'project.view')`. The SQL is an optimisation of the policy module, never a second opinion. If
  the filter ever removes a row, the two have drifted and the module is the one that is right.
- **A seeded default carries a `name_key` as well as a name** (`workflow_state.name_key`, `team.name_key`).
  It renders translated until somebody renames it, and the rename clears the key so their literal wins for
  good. `src/lib/seeded-name.ts` is the only place that rule is applied — a screen that reads `row.name`
  directly shows a Khmer workspace the English word "Done". This is §13's "awkward middle", and it applies to
  seeded rows only: a **closed** enum (state group, priority, project role) still maps to messages in code and
  never reaches the database.
- **An archived project is read-only** (§4), and that is enforced in the service on every mutation, not only
  by hiding buttons. `unarchive` is the one path that skips the check, because otherwise the one click that
  brings a project back is the one click an archived project refuses.

Project membership has its own section on the project settings screen, and it is not decoration: **explicit
membership is the only way into a private project, and the only way a Guest reaches any project**. §10's
implicit roles are composed in `effectiveProjectRole` and never written as rows, so an Admin who has never
been added still appears in the "add" list — adding them creates a real membership that survives them losing
Admin.

Two smaller things that will look arbitrary later. Workflow states use an **integer `position` rewritten as a
block**, not the fractional index work items get in slice 6 — that machinery exists because several people
drag cards on one board at once, and a settings list of six rows reordered by one Lead does not need it.
And a state is **hard-deleted**, unlike everything else, because `workflow_state_project_name_key` would
otherwise keep a deleted state's name reserved forever.

`src/lib/project-key.ts` derives the `ENG` of `ENG-142`. §7.1's example is "Marketing → MKT"; the rule gives
`MAR`, because no rule short of a dictionary produces that contraction. The field is editable, which is what
makes an approximation acceptable — the same bargain `slug.ts` makes for Khmer romanisation.

## Work items and the list query

Slice 5, and §14 called it one of the two remaining places a wrong decision is expensive to reverse. Most of
what is here is §9 carried out literally; these are the parts that will look arbitrary later.

**The query is split across the `lib`/`server` line on purpose.** `src/lib/work-item-query.ts` is the Zod
filter DSL, its URL codec and its cursors — pure, and in `lib` because the filter bar builds a URL in the
browser and the server parses that same URL back. `src/server/queries/work-items.ts` is the only thing that
emits SQL. One DSL, one builder: the board (slice 6), My Work, Needs Attention, saved views and the Phase 2
MCP server all go through them rather than writing a second query beside them.

- **Two queries, never one** — a counts query and a `LATERAL` per-group page query, because a board needs a
  page *per column*. The header count is the group's real total, not the page's length.
- **Keyset cursors only, and not in the URL.** A filter is a description worth sharing (§5); a cursor is one
  person's scroll position. Cursors ride in the `/api/internal/list` body instead.
- **`assertAnchored` refuses a query with no project, assignee or parent.** §16's "query that takes
  production down at 3am". A workspace-wide "all work" view is a §4 should-have and must arrive with its own
  anchor rather than by deleting the invariant.
- **Interpolating a JS array into a `sql` template spreads it into one placeholder per element.** Every array
  in the builder is bound with `sql.param`, or Postgres sees `any(($3)::uuid[])` holding a bare uuid and
  refuses it as a malformed array literal. This cost an hour.

**Three invariants live in the database, not in the service** (migration `0008`), because a row written by a
seed script, an importer or a Phase 2 MCP tool has to be as correct as one written by `work-items.ts`:
`root_id`/`depth` with the three-level cap and its subtree propagation, and the `assignee_ids`/`label_ids`
arrays that mirror the join tables. `rank` is additionally pinned to `COLLATE "C"` — the fractional index is
a string whose *lexicographic* order is the board's order, and every collation but `C` applies language
rules. `src/lib/rank.ts` narrows the alphabet to lowercase base-36 so the two halves cannot disagree.

**Columns exist ahead of the UI that fills them, deliberately.** `rank` (slice 6 drags it), `completed_at`
(slice 11's burndown cannot backfill history that was never recorded), `parent_id`/`root_id`/`depth` (no
sub-item UI yet). Adding a NOT NULL ordering column to a table already holding a workspace's work is a
backfill under a lock; adding it now costs one column.

**`workspace.timezone` landed here rather than in slice 15**, where §6-1 puts company settings. Slice 5 is
where "overdue" is first computed, and §17-13 is explicit about the alternative: evaluated on the viewer's
device, an item is late for the employee and on time for their manager. `src/lib/workspace-date.ts` takes the
zone as an argument and has no default — a function that falls back to the host's zone works in development
and is wrong in production. The settings screen that edits the column is still slice 15's.

**`GroupList` does not seed `useState` from its props.** Only the pages it fetched live in state; the first
page stays a prop, and a `seed` string resets the appended ones when the server sends something different.
Seeding from props looked simpler and silently froze the list at whatever it held on mount — a created item
appeared in the group's count and nowhere else.

Two smaller decisions. **Labels are workspace vocabulary**, managed under `workspace.settings` rather than
behind a new §10 row: the matrix has no label line, and inventing one puts a rule in the code that the table
a non-technical owner is shown does not contain. Applying an existing label is `work_item.edit`. And
**`deleteWorkflowState` now enforces §4's migration target** — the guard slice 4 left open because there was
no table to count; `work_item`'s foreign key onto the state is `ON DELETE RESTRICT` as the second layer.

The **FilterBar is single-select per filter this slice**. The DSL takes arrays throughout and the builder ORs
them, so multi-select is a UI change and not a data change — it needs §12's Combobox, which is not built.
A refused mutation reports in the row that caused it rather than in a toast — that is §11's rule, not an
omission, and it still holds for the list. **Slice 6 added the Toast** because a refused *drag* is the
opposite case: the card animates back and nothing on screen says why.

## The board, and why the client never sends a rank

Slice 6, and the last of §14's four expensive-to-reverse decisions. `src/server/services/work-items.ts`
(`moveWorkItem`), `src/app/api/internal/reorder/`, `src/components/views/board-view.tsx` and
`use-board-sync.ts`.

**The client sends neighbour IDs and never a rank** (§9). Everything else follows from that one sentence. A
rank computed in the browser is computed against a board that may be seconds old, and two people dropping
onto the same gap compute the *same* key; a rank computed on the server, inside the transaction, under
`FOR UPDATE` on the item and both neighbours, is computed against what is true right now. The e2e suite
drives two browsers onto the same card at once and asserts they converge — that is §15's scenario 3, and it
is the reason this slice was front-loaded rather than left until the views slice.

**A stale neighbour is not an error.** §9 asks a stale drag to "land correctly relative to present state —
this is what stops boards feeling haunted", so `moveWorkItem` has three rules and they are worth knowing
before touching it:

- A neighbour id naming no row in the project is a **bad request** — a client defect, not a race.
- A neighbour that exists but has since **left the column** is stale, and the true neighbour is re-derived
  from the column as it now stands.
- `null` is an **intent**, not a missing value: `previousId: null` is "the top" and `nextId: null` is "the
  bottom", and neither is ever re-derived. Re-deriving them would slide a card dropped at the end of a
  column into the middle of it.

**Exactly one event per drag.** Crossing columns emits `work_item.state_changed`, which slice 7's feed and
slice 9's notifications already understand; staying inside one emits the new `work_item.moved`, whose
registry entry is `audit: false` on purpose — a log that records every drag is a log nobody reads when it
matters.

**`rank-ordering.test.ts` is the test that would otherwise not exist.** `rank.test.ts` proves the fractional
index is correct in JavaScript; that is half the guarantee, and the other half — that Postgres sorts the same
keys the same way — is the half that fails silently, on deploy day, with every unit test still green. Two
mechanisms make them agree (0008's `COLLATE "C"`, and `rank.ts` narrowing to lowercase base-36), so the test
asserts the *result* rather than either mechanism.

**The board polls a change token, and the schedule is a product decision.** `use-board-sync.ts` implements
§8's table exactly: 20s while visible, stop when hidden, immediate revalidate on focus, backoff to a 60s cap,
and **no timer at all under `saveData` or `2g`**. §17-24 is explicit that leaving the interval unspecified
means someone picks 5s and a forgotten background tab bills a mobile data plan all afternoon — §2.5-5 makes
that a product decision, not tuning. The token itself is one aggregate (`max(updated_at)` plus a count) and
rides the same predicate the board does; it is served by a **`GET` on `api/internal/list`** rather than a
sixth §8 route-handler exception, because it is the same concern in its cheapest form.

Three smaller things that will look arbitrary later. **`view` lives in the filter DSL** even though it is
presentation: the filter bar rewrites the whole query string on every change, so a `view` kept outside it
would be dropped the first time anyone touched a filter. **The board is always grouped by state**, whatever
`by=` says, because a column you drag into has to mean something the drop can change and the drop changes a
state. And **the drag handle is not the whole card** — a card is also a link to the item, and dnd-kit's
`KeyboardSensor` needs a focusable element to start from, which is what makes §11's mouse-free loop work.


## Activity, and the second sink on the registry

Slice 7. `src/server/events/registry.ts` (the `activity` field), `UnitOfWork.flush`, the `activity` table,
`src/server/queries/activity.ts`, `src/server/services/activity.ts` and
`src/components/work-item/activity-feed.tsx`.

**Nothing in the service layer writes a feed row.** A service emits an event; the registry decides what that
event becomes. That is the whole slice, and it is why §14's outcome is the word *automatically* — adding an
event type without deciding how it renders in the feed is a compile error, the same mechanism `audit` has
had since slice 1. Slice 9 adds the outbox as a third field on the same entry.

**A projector returns a list, not a row.** One event is often several lines: an edit that moved three fields
reads as three changes, and assigning two people while unassigning a third is three things that happened to
three people. The event stays the unit of intent; the feed is the unit of reading.

**Two work-item events deliberately project to nothing.** `work_item.moved` — a card nudged up its own column
would push the state change somebody is looking for off the screen, and it is already `audit: false` for the
matching reason. And `work_item.deleted`, because the item's feed goes with the item; that one is audited
instead, which is where a record of a destroyed thing has to live.

**`data` holds ids, never names.** A state renamed to "QA" reads as QA in the line that recorded a move into
it three months ago, and a seeded name stays translatable — a string frozen into the row would be English
forever in a Khmer workspace (§13). The cost is real and is paid at the one place it bites: a workflow state
is *hard*-deleted (§4 migrates its items first), so an old line naming it resolves to a translated
"a deleted state" rather than to a uuid. The one exception is a blocked reason, which is free text a person
typed about that moment and is not a reference to anything.

**Ordering is by id, not by timestamp.** `occurred_at` defaults to `now()`, which is transaction start, so
every line one mutation produced shares it. The tiebreak is the UUIDv7 primary key, generated per row in the
order the projectors emitted — without it a three-line edit shuffles between reads.

**`activity` is append-only and refuses a read-only session**, which is the one place it differs from
`audit_record`: a view-as session must still be *audited*, and must never appear in somebody's item history
as though they had done something themselves. `uow.emit` refuses first; the `INSERT` policy refuses again
underneath, and `activity.test.ts` asserts the second layer with the first one bypassed.

**Slice 7 widened one slice-1 policy, and it is worth knowing why.** `app_user`'s `user_select` required a
*live* membership, which made §7.12's "activity history is preserved and attributed" unimplementable — the
moment somebody left, every line they had written became the work of nobody. Migration 0009 drops the
`deleted_at is null` clause: a row is still reachable only from a workspace the person actually joined, so
what widened is time, not tenancy. Callers that mean *current* members already say so themselves
(`listMembers` filters the membership, which is the right place for it).

**The feed is a server component and the "show all" control is a `Link`.** `?activity=all` widens the window
from 40 lines to 500. A search param rather than an entry in the filter DSL, because the DSL describes a
query over many items and has no business carrying one item's scroll depth — and a link rather than a button
because the result is shareable, back-buttonable and needs no client at all.


## Comments, mentions, and the editor decision

Slice 8. `src/lib/mentions.ts`, `src/server/db/schema/comment.ts`,
`src/server/queries/comments.ts`, `src/server/services/comments.ts` and the three components under
`src/components/work-item/comment-*.tsx`. Attachments are built, and are the section below.

**A mention stores a member id and resolves to a name at render.** The body holds `@[<uuid>]` tokens and
never a name — the same rule `activity.data` follows, for the same two reasons: somebody who changes their
display name should read correctly in a comment written last March, and a name frozen into the row is the
one string a Khmer workspace could never fix (§13). `mentions.ts` is in `lib` because both sides run it: the
composer parses as you type to drive the picker, the server parses the same body on submit to write the
mention rows. One implementation, so the chips a person sees cannot promise a notification the server will
not send.

**The editor question `work_item.description` deferred is now answered: plain text.** §12's inventory names
Textarea and no editor; a rich-text editor is a dependency, a storage decision (HTML? a document tree?) and a
sanitiser, none of which §12 specifies. What §7.7 actually needs is mentions, and the token format gives them
without any of it. Both columns stay `text`, so the richer editor §4 gestures at is a renderer change rather
than a migration.

**`comment.created` projects to nothing, and it is the one `false` in the registry that is about the screen
rather than the log.** The thread renders directly above the feed on the same page, so a line reading "Sophea
commented" would sit an inch below Sophea's comment. The event still exists and still carries `mentioned` —
slice 9's notifications read the stream, not the projections. **`comment.deleted` is audited**, joining
`work_item.deleted` and `workflow_state.deleted` as the actions that destroy rather than change; `byAuthor`
separates a person retracting their own from §10's Lead power over somebody else's. The audit row
deliberately does not copy the body: the log is Owner-visible and permanent, and a retracted comment should
not survive in it.

**Deleting is soft and leaves a tombstone.** A thread that silently closed over a removed comment would read
as though the exchange never happened, which is the one thing a moderated conversation must not do. This is
also why `comment` takes all five `tenantPolicies()` rather than copying `activity`'s hand-written append-only
set — a comment is something a person wrote and may retract, not a projection of an event.

**Mentioning somebody who cannot see the project is refused, and the refusal names them.** §7.7 allows either
that or offering to add them; this is the first. The picker is filtered to people who can already see the
project, so the refusal is a backstop against a hand-typed token or a membership that changed while the
composer was open. Both the filter and the refusal ask **the policy module** about the mentioned member —
building a one-project `Actor` and calling `can(…, 'project.view', …)` — rather than re-deriving visibility,
which would be a second implementation of §10's composition rules for the two to drift apart.

**The composer keeps the draft on failure.** §7.7 is emphatic — "never lose typed text" — which is why the
textarea is controlled and why the action returns a `postedAt` timestamp rather than a boolean: two
successful posts in a row must look different, or the second one leaves the first comment's text in the box.
The picker is **not** §12's Combobox and that is deliberate: a Combobox is a form control with a value, this
is an inline autocomplete anchored to a caret that cannot take focus without stopping the typing that drives
it. It borrows the Combobox's keyboard contract and announces itself through the ARIA combobox pattern on the
textarea itself.

**`getCommentThread` carries its own mentionable list.** It was briefly a second service call and a second
`withActor` transaction on every item page view; folding it in is the same question about the same project,
and it is skipped entirely when the actor cannot comment. Three transactions per item page render was enough
extra latency to expose the e2e race described above.

**One §13 gap this slice did not close, because it is not this slice's to close.** A comment body is free
user text that may be in either script, but it renders inside the page's `lang`, so a Khmer comment in an
English workspace inherits `lang="en"` and clips its diacritics. That is equally true of item titles,
descriptions and project names today — nothing in the product does per-content script detection. It should be
fixed once, for all user content, probably alongside §13's search routing, which needs the same detection.

## Attachments, and why an upload is two steps

The last third of slice 8. `src/lib/attachments.ts`, `src/server/storage/` (`sigv4.ts`, `store.ts`,
`local-fs.ts`), `src/server/db/schema/attachment.ts`, `src/server/queries/attachments.ts`,
`src/server/services/attachments.ts`, `src/app/api/internal/upload/` and the four components
`attachment-panel.tsx`, `attachment-list.tsx`, `attachment-uploader.tsx`, `upload-queue.tsx` plus
`use-uploads.ts` and `attachment-delete.tsx`.

**§8's rule is that no byte passes through the app server, and everything else follows from it.** The browser
PUTs straight to the store, so the only moment the server can refuse an upload is *before* one is
authorised — which is why a row exists before its bytes do. `createUploadTicket` asks §10, applies §4's
archived rule, validates name, size and type, writes a `pending` row and signs a URL scoped to that one key
with that exact `content-length` and `content-type`. The store then rejects a PUT that disagrees, so **the
size limit is enforced by the thing receiving the bytes** rather than by an `if` the bytes never reach.

**`pending` is what makes an abandoned upload harmless**, and it is the reason there is no cancel endpoint. A
ticket nobody used, or a comment drafted with a file and never posted, leaves a row nothing renders and bytes
nothing references. Sweeping those is **slice 9's**, which is the slice that introduces pg-boss.

**A file becomes visible in exactly one place, and that place emits the event.** `confirmAttachment` for a
file on the item; `postComment` for one pasted into a comment, which claims the pending rows *before* it
writes the comment — so an empty body whose files turn out to be nobody's is refused with nothing committed
rather than rolled back. A comment with no text and one screenshot is legitimate (§2.4); a comment with
neither is not.

**SigV4 is ours, and it is a known-answer test rather than a leap of faith.** `sigv4.test.ts` asserts the
exact signature AWS publishes for its own worked presigned-GET example. That is what makes the absence of
`@aws-sdk/*` a decision rather than a shortcut — the same bargain `mailer.ts` makes by calling Resend over
`fetch`. Do not "fix" it by adding the SDK.

**Two drivers, chosen by configuration, exactly like the mailer.** R2 when `S3_*` is set; otherwise a local
driver that writes under a gitignored `.attachments/` and serves the bytes back through the same route.
Bytes *do* pass through the app server there, and that is the one deliberate difference — the no-bytes rule
is about production cost, and a laptop with no cloud credentials still has to run the whole of §7.7 while
`pnpm test:e2e` drives a real file through the real ticket, the real PUT and the real confirm. Both drivers
return the same ticket shape, so the browser's upload code is one `fetch` either way.

**The local driver's URLs are relative, and the download redirect sets `Location` verbatim.** Both are scars.
Building an absolute URL from `NEXT_PUBLIC_APP_URL` sent every e2e upload to port 3000 while the test server
was on 3100; resolving the redirect against `request.url` then pointed at `localhost` while the page was on
`127.0.0.1`, which is a cross-origin redirect and reaches the browser as an unexplained CORS failure — in
production that is a broken image preview with nothing in any log. Neither the app's configured base URL nor
`request.url` is a reliable origin. A relative URL does not have to be right about one.

**§10 has no attachment row and none was invented** — the same decision slice 5 made for labels. An
attachment is a contribution to an item's conversation, so it falls under the rows that already govern one:
`comment.create` to add a file, `comment.delete_others` for §10's Lead power over somebody else's. Both
resolve to the rule the matrix already states, so nothing new is claimed on a table a non-technical owner is
shown.

**`attachment.added` projects to activity only when the file is not part of a comment**, and
`attachment.removed` mirrors it. A file pasted into a comment is already rendered inside that comment, an
inch above the feed — the same redundancy `comment.created` refuses. `attachment.removed` is additionally
**audited**, joining `work_item.deleted`, `comment.deleted` and `workflow_state.deleted` as the actions that
destroy rather than change. It **keeps the filename** where `comment.deleted` withholds the body, and that is
not inconsistency: a body is the content, and a filename is the identifier of the thing removed. A log that
cannot say which file went records nothing worth keeping.

**Deletion is soft and the bytes outlive the row.** A delete that called Cloudflare inside the transaction
would fail whenever Cloudflare had a bad minute, and removing a file somebody should not have posted is the
one moment that must not depend on a third party being up.

**SVG is refused though it is an image**, and HTML with it: both are documents that can carry script, the one
place anybody opens an attachment is a browser, and the development driver serves bytes from the app's own
origin. The allowlist is in `src/lib/attachments.ts` with the 25 MiB cap, which is a §2.5 decision — a
phone-heavy market where data costs money — and not a number to raise quietly.

**Sizes cross the wire as a number and a unit key, never a formatted string.** `describeSize` returns
`{ value, unit }` and the component translates the unit, because "1.4 MB" returned from a function would be
the one size label in the product that stayed English in a Khmer workspace (§13). Filenames are truncated by
grapheme with the extension preserved, for the same reason every other truncation in the product is.


## Notifications, the outbox, and the second process

Slice 9. `src/lib/notification-kinds.ts`, `src/server/db/schema/notification.ts`, the `notify` field on
`eventRegistry`, `UnitOfWork.#writeOutbox`, `src/server/jobs/`, `src/server/queries/notifications.ts`,
`src/server/services/notifications.ts`, the `notifications/` components, and the `inbox/` and
`settings/notifications/` routes.

**The registry entry is now complete.** `audit`, `activity`, `notify` — §8's diagram, one field each, all
three exhaustive over the event union. A new event type cannot reach an inbox without somebody deciding
that it should, and cannot fail to reach one by omission either.

**The projector is pure, so the events carry their assignees.** §7.8's rule is "every assignee except the
person who made the change, plus anyone mentioned", and answering it from the event alone means six events
gained an `assigneeIds` field. That is the same call slice 8 made when `attachment.added` started carrying
its `commentId` — "carried rather than looked up because the registry is pure". The alternative was a
registry that queries the database on every mutation, which stops it being a decision table.

**"Never notify yourself" lives in exactly one place.** `UnitOfWork.#writeOutbox` translates member ids to
user ids and drops the actor, because it is the one layer that knows who the actor is. Doing it in the
registry would mean thirty entries each remembering the same rule — and §7.8 is blunt about the cost of
forgetting it: "self-notification is the most common reason people mute a product's email."

**The outbox is written in the mutation's transaction; nothing else is.** An email sent before the commit
is a lie when the transaction rolls back, and one sent after it is lost if the process dies in between. A
row written *with* the data has neither failure, and `notifications.test.ts` asserts the rollback case
directly — the mutation throws, and no notification about it survives.

**The worker is a real second process and the e2e suite runs one.** `pnpm jobs`, same image as the web
process, different entry point (§8). `e2e/support/serve.ts` starts one beside Next, because half of §7.8
lives in it: every unit test in this repo passes with the outbox row written and nothing ever reading it,
and an inbox that stays empty is what that failure looks like on screen.

**The worker holds two credentials, and the split is the point.** Enumeration — "which outbox rows are
undelivered", "which companies exist, in which timezone" — spans workspaces, so no tenant scope can answer
it; that runs on `DATABASE_URL_OPERATOR`, which is `SELECT`-only at the role level (§18-12) and therefore
cannot write anything anywhere. Everything the worker *writes* goes through `withActor` on the app role, in
a real member's scope, exactly like a request. The digest reads a person's due work **as that person**, so
an email cannot describe an item its recipient is not allowed to open. That property is free from RLS and
would have to be re-implemented, and eventually got wrong, by a worker reading as an omniscient system user.

**pg-boss's schema is installed by the owner, not by pg-boss.** `boss.start()` normally runs its own DDL,
which would put a `CREATE`-capable credential in a long-lived process — the one thing the four-role split
exists to prevent, and a worker is not exempt from it. `src/server/jobs/install.ts` applies pg-boss's own
published plans from `pnpm db:migrate`, and the worker starts with `migrate: false`. It is the one module
under `src/server` deliberately **without** `import 'server-only'`, because `provision.ts` imports it and
that runs under plain `tsx`.

**The sweep is an interval; delivery is a job.** Cron's finest granularity is a minute, and a mention that
takes a minute to reach an inbox feels broken — so the worker polls the outbox's partial index every 5s and
enqueues one pg-boss job per message. pg-boss earns its place on the delivery side, where retries with
backoff and a dead-letter queue are worth having. Discovery is deliberately *not* an enqueue from the web
process: that would put the queue on the request path and lose any row whose enqueue failed after the
commit. Polling one nearly-always-empty index is self-healing by construction.

**Delivery is at-least-once, and the schema makes it idempotent.** `unique (outbox_message_id,
recipient_member_id)` turns a retry's re-insert into a no-op, so what a retry retries is the part that
failed. Email is the one thing that is not exactly-once, and that is the right way round: a duplicated
mention email is an annoyance, a missing one is somebody never learning they were asked a question.

**The digest is a tick, not a schedule per workspace.** One hourly cron job asks every workspace whether it
is 18:00 *there*. Per-workspace pg-boss schedules would have to be created at signup, updated on a timezone
change, and repaired after any of that happened while the worker was down — and a missed repair is a
company that silently never gets a digest again. §6-6 defers "digest scheduling" to Phase 2, so the hour is
a constant.

**§7.8's non-working-day rule is implemented as its contrapositive.** The plan says the digest "moves to the
last working evening before"; what the code does is send **only on a working evening, covering work due
through the next working day**. Identical in effect, and it removes the arithmetic — Friday's horizon is
Monday, so Friday evening carries Monday's work across the weekend on its own, and no two evenings can both
decide they are the last one.

**Working days and holidays landed here rather than in slice 15**, for the reason `workspace.timezone`
landed in slice 5: the rule above needs to know which days those are. `workspace.working_days` is a
seven-bit mask defaulting to **63 — Monday to Saturday**, the market §2.5 describes rather than a European
five-day assumption, and `workspace_holiday` is the per-company calendar §17-18 asks for. The three SQL
functions in migration 0016 (`is_working_day`, `next_working_day`, `business_days_between`) are §9's "one
SQL function" that staleness, the digest and cycle progress must all share; the digest is the first caller
and slices 11 and 13 inherit them. **They are in SQL on purpose** — a working-day calculation done in
TypeScript is done again, differently, by whoever writes the next query that needs one. The settings screen
that edits any of it is still slice 15's.

**The `soon` due window was added to the §9 DSL rather than beside it.** §7.8's digest is "what is due
tomorrow, and what is already overdue", which is one predicate — `due_date <= horizon and completed_at is
null` — and one ordering. The horizon is a fetch option beside `today`, not a URL parameter, because a
company's next working day on one evening is not a question anybody would want frozen into a shared link.

**§6-6's "per event type" is read as a closed set of five kinds**, not as the thirty members of
`DomainEvent`. Nobody wants a preference row for `work_item.blocked_changed`; they want to turn off "changes
to items I'm on" and keep mentions. The event-to-kind mapping lives in the registry beside the other two
decisions. An absent preference row means **the default**, never "off" — a product whose notifications are
opt-in is a product with no notifications.

**There is no §10 row for notifications and none was invented** — the third time this decision has been
made, after labels in slice 5 and attachments in slice 8. What stops one person reaching another's inbox is
not a role: every query is keyed on the acting member's own id in the predicate, underneath RLS that has
already scoped the rows to the workspace.

**The unread count rides in `resolveActorContext`.** The bell is on every workspace screen, so a service
opening its own transaction for it put one extra round trip on every navigation in the product — enough,
under a parallel e2e run, to push project creation past its own assertion. `loadShellState` asks both
questions in the one `withActor` that was already open. This is the same trap slice 8 hit with
`getCommentThread`, and it is worth assuming the next per-screen query will hit it too.

**Email templates import `createTranslator` from `use-intl/core`, not from `next-intl`.** An email has no
React in it, and next-intl's entry pulls the React bindings along with the formatter — which is fatal in
the worker: it runs under `--conditions=react-server` so that `import 'server-only'` resolves to nothing,
and React's own react-server build does not export `useEffect`. `use-intl` is next-intl's engine, pinned to
the same version, so it is the same translator without the part only a component needs.

**The worker needs `NEXT_PUBLIC_APP_URL` in its environment.** Unlike the Next process it has no build step
to inline it, and without it the deep link throws *after* the inbox row is written — which reads as "the
notification works but the mail never arrives". `pnpm jobs` passes `--env-file=.env`; `e2e/support/serve.ts`
sets it explicitly.

**§12's Switch is still not built, and the preference grid does not pre-empt it.** The toggles are native
checkboxes: a checkbox already carries the role, the keyboard behaviour and the label association a Switch
would have to be given by hand, and building a one-off Switch for one screen is how a design system ends up
with two of them.

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

Slice 4 added a sixth family to layers 2 and 3: `--state-ink` · `-sky` · `-navy` · `-warning` · `-success`
· `-danger`, exposed as `bg-state-*`. They exist because a company may recolour a workflow state (§6-3) and
the choice is stored — a hex written into a row in 2026 cannot resolve differently in dark mode, so what is
stored is a token name and `StatePill` is the only place it becomes a class.

Slice 5 added three more, on the same principle:

- `--priority-*` (five), because §12 assigns priority colours outright and a lookup at a call site would
  reach past layer 3. `PriorityIcon` also varies the *shape* — a five-step scale distinguished only by hue is
  the most common accessibility failure in a tracker.
- `--label-*` (eight), a deliberately wider set than `--state-*`: this is the one place §12 puts Lilac and
  Chartreuse to work, because a label is a company's own vocabulary rather than a meaning the product
  assigns. `LabelChip` is the only place one becomes a class, and — like `StatePill` — the dot carries the
  colour while the text stays `text-text`, because at 11px several of these fail AA against the surface.
- `--avatar-*` (eight), and **not** a reuse of `--label-*`: an avatar carries text, so it owes 4.5:1 rather
  than 3:1, and the label steps sit at 3.8–4.3:1 against Ivory. The avatar steps are the deep end of each
  ramp with initials drawn in `--bg`, which inverts with the theme; the worst pair is 5.78:1.

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
