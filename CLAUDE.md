# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: approved for build, slice 16 landed — **§14's build sequence is complete**

`PLAN.en.md` / `PLAN.km.md` are the specification and still carry more weight than the code. The build was
approved on **2026-08-31**, and §18's last two blocking questions were answered the same day: **#11** audit
records are a second sink on the event registry, and **#12** the platform operator gets its own read-only
database role. Both are implemented — see below. **§18-10 (holiday calendar maintenance) was answered on
2026-09-04 and is no longer open**: slice 9 created the `workspace_holiday` table the digest reads and named
the question it could not answer — where the first year of rows comes from — and slice 15 is the answer, seed
and refusal both (see the slice 15 section). **Two questions remain open, #7 and #9**, and neither blocks
anything: #7 is a business decision, #9 is deferred to Phase 2 by its own dependency.

Slices are still built **one at a time, in §14's order, on request**. The approval was to start, not a
standing licence to run ahead. **§18-5 and §18-6 were answered on 2026-09-03** — attachment storage is
**Cloudflare R2** and there is **no known data-residency requirement**, revisited with the pilot customer
(§18-7) — and both `PLAN.en.md` and `PLAN.km.md` record them as RESOLVED rather than OPEN.

§14 named slices **1, 2, 5 and 6** the four places a wrong decision is expensive to reverse. All four are
behind us. Slice 7 added a second field to the `eventRegistry` entry that slices 1 through 6 had been
filling in all along, and **slice 9 added the third and last one** — the outbox. The entry is now complete
as §8 draws it: audit, activity, notify.

**Slice 16 is the last slice in §14, and it is the only one that added no table, no service and no
query.** Onboarding, the five states, the accessibility baseline, responsive and install — one route, seven
components, four boundaries and three e2e specs. It is worth noticing what it *found* rather than what it
built: §7.1's seven-step path had been delivering five of them since slice 5, §15-6's 390px had never been
tested because the mobile Playwright project sat at 412, and the 404 was the one screen in the product that
was not in the reader's language. All three had been true for several slices, and none of them was visible
from inside the slice that introduced it. **Two §4 must-haves are still not built and belong to slice 3** —
Google OAuth and password reset — and are named at the end of the slice 16 section rather than hidden.

**Slice 10 is the first slice that only extended what was already there.** No new sink, no new process, no
new §10 row — one branch in the §9 builder, six entries on the registry, three tables. That is what §6 means
by "cheap now and expensive to retrofit", and it is worth noticing that it came true.

**Slice 12 cashed the largest bet in the plan.** §14 called slices 1, 2, 5 and 6 the expensive ones and
front-loaded them; slice 12 is where slice 5's half of that is paid back. "All four view types" added **no
query, no second DSL and one table** — the Table is the §9 query grouped into one group, the Calendar is the
same query grouped by day over one month, and a saved view is a *name for a URL*, which §5 had already made
the whole of a view's state. Four renderers, one builder. That is the shape §9 was designed for, and slice 12
is the first slice that tested it.

**Slice 13 is the first slice whose screens are not one project's.** My Work, Needs Attention and
Workload each read across every project a person can see, and the thing worth noticing is what that cost:
**no new query, no new table, one new column pair, one SQL function.** The list query gained one grouping
(§7.3's five due buckets) and one filter (staleness); everything else is the §9 builder called with different
filters. §14 front-loaded slice 5 because "a wrong decision is expensive to reverse" there, and this is the
third slice in a row — after 11 and 12 — where that bet paid rather than merely held.

**Slice 11 did the same and cashed two earlier bets.** One table, one nullable column, five registry entries,
one more branch in the §9 builder — and the two things it did *not* have to build are the point. `completed_at`
has been on `work_item` since slice 5 for exactly this, and the comment there ("history not recorded is history
gone") turned out to be literally true: the burndown is arithmetic over it and no migration could have
backfilled it. §9's `business_days_between` and its two companions landed in slice 9 with a note naming cycle
progress as the second of three callers; this is that caller, and it called them rather than writing the
calculation again in TypeScript. Slice 11 also earned a **fourth anchor** on the §9 list query rather than
deleting the invariant — see below.

**Slice 9 left one thing it was expected to do, and it is still not done.** The periodic job that sweeps
abandoned uploads (slice 8's `pending` attachment rows) was not built. The worker and its schedule exist, so
it is a handler and a cron line rather than any new machinery — but an abandoned upload still occupies
storage indefinitely.

**Slice 12 closed all but one word of §14 slice 10's outcome line.** "Define a field; it appears in create,
detail, filter, group, **table**" — *table* is built now, as one column per field on the Table view, its
values fetched in a single query for the whole page. What is still missing is *create*, and it is **not a
slice-10 or slice-12 gap**: §7.2's inline composer is deliberately one field (a five-second target, "no
create-task modal in the default path"), and §4's other half — "Inline **+ full create**" — was never built
in slice 5. So the full create form is a **slice-5 gap**, and when it is built the panel on the item page is
the component it reuses. `createWorkItem` does not take custom values today; adding an input is cheap, and one
nothing calls would have been speculative.

What exists: **slices 0 through 15** — the i18n scaffold, the design-token layer, the tenancy foundation
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
`inbox/` and `settings/notifications/` routes), and now custom fields — the three tables, the filter branch,
the group-by, the settings editor and the item panel (`src/lib/custom-fields.ts`,
`src/server/db/schema/custom-field.ts`, `src/server/queries/custom-fields.ts`,
`src/server/services/custom-fields.ts`, `src/components/project/custom-fields-editor.tsx` and
`src/components/work-item/custom-field-values.tsx`), and now cycles — the `cycle` table, the item's
membership column, the progress and burndown queries, and the two routes under `cycles/`
(`src/lib/cycles.ts`, `src/server/db/schema/cycle.ts`, `src/server/queries/cycles.ts`,
`src/server/services/cycles.ts`, and the `src/components/cycle/` components), and now the Table view, the
Calendar view and saved views — the `saved_view` table, the two new renderers, and the bar that puts a name
on a query (`src/lib/saved-views.ts`, `src/server/db/schema/saved-view.ts`,
`src/server/queries/saved-views.ts`, `src/server/services/saved-views.ts`,
`src/components/views/table-view.tsx`, `calendar-view.tsx` and `saved-views-bar.tsx`), and now My Work,
Needs Attention, workload and availability — two columns on `workspace_member`, §9's fourth working-day
function, the five due buckets, the staleness filter and the two screens that read them
(`src/lib/availability.ts`, `src/lib/needs-attention.ts`, `src/lib/status-summary.ts`,
`src/server/services/workload.ts`, `listWorkItemSets` in `src/server/services/work-items.ts`,
`src/components/views/{cross-project-rows,needs-attention-view,workload-view,status-summary}.tsx`,
`src/components/members/availability-form.tsx`, `src/app/api/internal/reassign/`, and the
`[workspaceSlug]/page.tsx`, `team/` and `settings/availability/` routes), and now the command palette,
search and shortcuts — one generated column and two indexes, a `q` filter on the §9 query, the first modal
in the product and a pure keystroke matcher (`src/lib/search.ts`, `src/lib/shortcuts.ts`,
`src/server/queries/search.ts`, `src/server/services/search.ts`, `src/app/api/internal/search/`,
`src/components/ui/{dialog,command-palette}.tsx`, the four files under `src/components/search/`, and the
`[workspaceSlug]/search/` route), and now settings, the holiday calendar and view-as — the settings shell and
its nine sections, the company form, branding, the seeded holiday calendar, workspace notification defaults,
§7.12's offboarding choice, and §7.13's view-as (`src/lib/branding.ts`, `src/lib/holidays.ts`,
`src/server/auth/view-as.ts`, `src/server/services/{workspace-settings,workspace-logo,holidays,view-as}.ts`,
the components under `src/components/settings/`,
`src/components/members/{offboard-dialog,view-as-button}.tsx`, `src/app/api/internal/upload/logo/`, and the
routes under `[workspaceSlug]/settings/`), and now §7.1's completed first-run path, the five states, the
accessibility baseline, the 390px pass and the install manifest — the per-locale web manifest, the theme
colour, the skip link, the four error and not-found boundaries and the view-aware skeletons
(`src/lib/app-icons.ts`, `src/app/[locale]/manifest.webmanifest/route.ts`, `src/app/global-error.tsx`,
`src/app/[locale]/{error,not-found}.tsx`, `src/app/[locale]/[workspaceSlug]/error.tsx`, the four
`loading.tsx` files under `[workspaceSlug]/`, `src/components/ui/{skip-to-content,skeletons}.tsx`,
`src/components/views/view-skeleton.tsx`, `src/components/ui/offline-banner.tsx` and
`src/components/onboarding/onboarding-step.tsx`).
All the `db:*` scripts work once `pnpm db:setup` has run.

Every gate passed on 2026-09-04 after slice 16 — `typecheck`, `lint`, `test` (434 unit), `build`,
`test:e2e` (201 across three Playwright projects, 13 skips) and `test:tenancy` (271 against real
Postgres 18.4). **Re-run them rather than trusting this line**; it is a snapshot, not a promise.

The e2e count jumped by fifty because slice 16 added three specs that are **sweeps rather than flows** —
`onboarding.spec.ts` walks §7.1 end to end, `responsive.spec.ts` asserts no sideways scroll on every screen
at 390px, and `a11y.spec.ts` asserts an accessible name on every control of every screen, per locale. Two of
the skips are slice 13's and 15's; the rest are the two sweeps declining the projects they say nothing about
(`responsive` runs on `mobile-km` only, `a11y` on the two desktop locales).

**`test:e2e` flaked once in four full runs after slice 10**, with eight `toHaveURL` failures across
`board.spec.ts` and `comments.spec.ts` and `The destination stream closed early` in the server log — the
same signature as the race slice 8 fixed in two other specs, and the same trigger: slice 10 added two
queries to `getWorkItem` and one to `getProjectBySlug`, and slice 8's note already records that "adding a
second panel to the item page was enough to expose it". Three of the four runs, and a targeted re-run of
both specs, were green. If it fails again, the fix is slice 8's — wait for the control that owns the
mutation to re-enable itself before navigating — not a retry count.

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
| `pnpm test <pattern>` | Single file or test-name pattern. **No `--`** — see below |
| `pnpm test:e2e` | Playwright, three projects: `en`, `km`, `mobile-km`. **Needs Postgres** — it provisions its own |
| `pnpm test:e2e <spec> --project=en` | One spec, one locale. The fast loop while writing a spec; run all three before calling it done |
| `pnpm test:tenancy` | The RLS suite, on real Postgres. Its own config (`vitest.tenancy.config.ts`), not part of `pnpm test` |
| `pnpm test:tenancy <pattern>` | One tenancy file. Each starts its own harness, so this is worth doing |
| `pnpm db:setup` | One-time: create the database and all **four** roles. Prompts for the superuser password |
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

**Do not write `pnpm test -- <pattern>`.** On pnpm 10 the `--` is swallowed rather than forwarded, so the
filter never reaches Vitest and the *whole* suite runs — silently, reporting a pass. This line said `--` until
slice 13, which is how it was found: `pnpm test -- slug` ran 23 files and `pnpm test slug` ran one. The same
applies to `test:tenancy`, where the cost is a 45-second full run instead of a 3-second one. Playwright takes
its filters the same way: `pnpm test:e2e theme --project=en`.

**Docker does not work on this machine**, so in practice both `test:tenancy` and `test:e2e` run against a
hand-started Postgres with `TENANCY_SUPERUSER_URL` pointing at it. The recipe, and the two Windows traps that
cost an hour in slice 4, are under **Status** above — read them before assuming Testcontainers is hanging for
some other reason.

CI (`.github/workflows/ci.yml`) runs the same commands in three jobs — `typecheck`+`lint`+`test`, `test:e2e`,
and `test:tenancy` — on `ubuntu-latest`, where Docker is present and Testcontainers is the path taken. The
e2e job sets `NEXT_PUBLIC_APP_URL`, because the build inlines it and an unset value fails the build rather
than the test.

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
src/app/[locale]/{(auth),(onboarding),[workspaceSlug]/...}   src/app/api/internal/{reorder,list,upload,reassign,search}
src/server/{db/{schema,client.ts,tenant.ts,identity.ts},auth,authz/policy.ts,queries,services,events,jobs}
src/components/{ui,auth,invite,members,work-item,views,search}   src/i18n   src/lib   drizzle/
```

`src/lib` is for code **both sides run** — `slug.ts`, `recipients.ts`, `form-state.ts`, `cn.ts`. Anything in
`src/server` that a client component needs belongs there instead, and anything that touches a connection
carries `import 'server-only'` at the top so a mistaken client import is a build error rather than a bundle.

The migration order in `drizzle/` is load-bearing: `0000` creates the `tenancy.*` functions **before** `0001`
creates policies that call them, and `0002` adds what drizzle-kit cannot express (`FORCE ROW LEVEL SECURITY`,
grants, revokes). Every slice after that repeats the pair — `0003`/`0004` for slice 3, `0005`/`0006` for slice
4, `0007`/`0008` for slice 5, and so on to `0027`/`0028` for slice 15. Regenerating a generated file with `db:generate` is fine; `0000`, `0002`,
`0004`, `0006`, `0008`, `0010`, `0012`, `0014`, `0016`, `0018`, `0020`, `0022`, `0024`, `0026` and `0028` are hand-written and must stay that way. A hand-written migration is
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

## Custom fields, and why a value is a row per kind

Slice 10. `src/lib/custom-fields.ts`, `src/server/db/schema/custom-field.ts`,
`src/server/queries/custom-fields.ts`, `src/server/services/custom-fields.ts`, the `custom` branch in
`src/lib/work-item-query.ts` and `src/server/queries/work-items.ts`, and the two components
`custom-fields-editor.tsx` (project settings) and `custom-field-values.tsx` (the item page).

**§9 settled the storage question in one line and everything follows from it**: "Real tables, not JSONB.
Typed indexed columns per value kind. A `custom:{fieldId}` filter is one branch in the builder." JSONB would
make every filter a sequential scan with a cast in it, which is precisely the §16 risk that says custom
fields must not slow the list query.

**Three tables, where §6 costed two.** The third is the option list, and it exists because of §7.11's
promise that renaming preserves values: a value that stored the *word* "Acme" would be orphaned the moment
somebody corrected it to "Acme Ltd". A value stores an option **id** and the word is resolved at render —
the same rule `activity.data` and a comment's mentions already follow. Options as a `text[]` on the
definition would have been the second table exactly, and would have made a rename a data migration.

**A row exists only where there is a value**, and that is load-bearing in four places. Adding a field to a
project holding 5,000 items writes nothing. Every index stays the size of the items that actually use the
field. "Nobody has filled this in" is a `NOT EXISTS` probe rather than a scan for nulls. And an unticked
checkbox is the *absence* of a row rather than a stored `false` — which is also the only answer that is
correct for every item that existed before the field did, with no backfill.

**A field's kind is fixed at creation, and the schema is what fixes it.** §7.11 offers a rename and nothing
else; turning a text field into a date is a migration over every stored value with no answer for the ones
that will not convert. A value references `(field_id, workspace_id, kind)`, so changing a kind would orphan
every value rather than silently reinterpret it. The settings screen omits the control rather than disabling
it — a disabled select invites somebody to go looking for the permission that would enable it.

**Two invariants live in migration 0018, not in the service**, for the reason slice 5 put `root_id`, `depth`
and the assignee arrays in 0008: a row written by a seed script, a CSV importer or a Phase 2 MCP tool has to
be as correct as one written by `custom-fields.ts`.

- A **CHECK** that exactly one value column is populated and it is the one the kind names — `num_nonnulls`
  for "exactly one", a `CASE` for "which". It also pins the two rules above: a checkbox row is always
  `true`, and a single-select holds exactly one option while a multi-select holds at least one.
- A **trigger** that strips a deleted option's id out of every value that held it, deleting the rows that
  would be left with an empty array. `value_option_ids` is a `uuid[]` and an array cannot carry a foreign
  key — the same trade `work_item.assignee_ids` makes, and the same answer.

**§10 has no custom-field row and none was invented** — the fourth time this decision has gone the same way,
after labels, attachments and notifications. Defining a field is `project.settings`, which §10's row already
spells out as "Project settings, states, custom fields". *Filling one in* is `work_item.edit`, because a
value is a property of a work item in the same way a priority is. That split is the one labels already make:
an Owner decides what tags exist, anyone who can edit can apply one.

**Only four kinds can be grouped by, and the reason is §9's page query.** It is handed its group keys rather
than discovering them — "a board column that disappears when it empties is a column nothing can be dragged
into" — so a grouping is only possible where the complete key set is known before the query runs. A select's
options, the workspace's members and `true`/`false` are enumerable; a free-text field, a number and a date
are not. **Filtering has no such limit**: every kind is filterable, which is the half of §6-4 that free text
actually needs.

**The filter is five operators, not one per kind.** `in` (select, multi-select, user — `none` allowed, ORed
with the ids exactly as the assignee filter does), `is` (checkbox), `has` (text contains), `range` (number,
date, either end open) and `set` (every kind: has a value, or has none). The kind decides which operator a
field offers and which column the builder reads; the operator decides the shape of the comparison. Each one
compiles to an `EXISTS` over `custom_field_value` keyed on `(field_id, <typed column>)`, which is the shape
every index on that table takes.

**`has` escapes LIKE's metacharacters and rides a partial trigram index.** Unescaped, a client called
"50% Co" searches for anything at all. `ILIKE` rather than `strpos` so 0018's `gin_trgm_ops` index can serve
it — pg_trgm is already installed because §13's Khmer search needs it.

**A filter naming a field the project does not have is dropped by the service, and `false` in the builder.**
The URL parser tolerates junk by design (§9's "discarding rather than failing") but has no idea what kind a
field is, so `withKnownCustomFilters` drops what cannot be evaluated — a link naming a deleted field widens
the list rather than showing a stranger an error page. If one somehow reaches the builder it resolves to
`false`, because a filter that cannot be applied must never *silently widen* a result.

**The fields ride in transactions that were already open.** `getWorkItem` loads the definitions and the
item's values alongside its assignees and labels; `getProjectBySlug` loads the definitions alongside the
states. A service of their own would have been a second `withActor` on every item-page and list-page render
— the trap slice 8 hit with `getCommentThread` and slice 9 hit with the unread count. The settings screen is
the one caller that pays extra, for the value **counts** §7.11's confirmation has to show before anybody
clicks.

**Deleting says how many values go with it, before the click.** §7.11: "deleting a field with values →
choose: delete values, or export first. Explicit, never silent." Exporting first is CSV export, a §4
should-have that does not exist — so the screen offers the honest half and names the number. Removing a
select *option* asks the same question separately, because renaming one keeps every value and deleting one
takes them.

**A length cap counts graphemes, not code points.** `[...text].length` gives a Khmer workspace roughly a
third of the field an English one gets, silently, and refuses text that fits — one Khmer syllable is
routinely three or four code points. §13 makes this rule for truncation; a cap is the same arithmetic
pointed the other way. The unit test that caught it is `counts length by grapheme`.

**Two defects found on the way through, both outside this slice and both fixed.**

- `pnpm db:migrate` failed on its **second** run against any database whose pg-boss schema was current:
  `getMigrationPlans` does not return an empty plan at the newest version, it throws `Version 39 not found`.
  Slice 9's comment asserted the opposite. `migrationPlanFrom` in `src/server/jobs/install.ts` now treats
  that assertion as "nothing to do" and re-throws anything else — a command that runs on every deploy has to
  be idempotent.
- The **due filter threw `MISSING_MESSAGE` in both languages**. Slice 9 added `soon` to `DUE_WINDOWS` for
  §7.8's digest and gave it no message, and the FilterBar renders every window. Missing from *both*
  catalogues, so `messages.test.ts` passed on parity while the dropdown broke at render — visible only in
  the server log, because next-intl swallows it. The bar now omits `soon`, which is the right fix rather
  than a new string: `soon` takes a **horizon** the DSL deliberately keeps out of the URL, so offered here
  it would resolve to `today` and mean exactly "overdue" — a filter that lies about itself.

## Cycles, and why a status is never stored

Slice 11, and §14's "run a two-week cycle end to end". `src/lib/cycles.ts`, `src/server/db/schema/cycle.ts`,
`src/server/queries/cycles.ts`, `src/server/services/cycles.ts`, the `cycle` branch in
`src/lib/work-item-query.ts` and `src/server/queries/work-items.ts`, the components under
`src/components/cycle/`, and the two routes under `projects/[projectSlug]/cycles/`.

**A cycle's status is derived from two dates and today, and there is no `status` column.** §7.6 says a cycle
"becomes active on start date", and the obvious reading is a stored status that something flips. That
something would be a scheduled job per cycle — created at creation, rescheduled on every date edit, repaired
after any of that happened while the worker was down — and a missed repair is a cycle that silently never
starts. That is the failure slice 9 refused when it made the digest one hourly tick rather than a schedule
per workspace. `cycleStatus` in `src/lib/cycles.ts` is the one place the comparison happens, and `today` is
always the **workspace's** (§17-13).

**`completed_at` on the cycle is not the status.** The end date having passed and a human having decided what
happens to the work still open are different facts, which is why the derived set has four members rather than
three: `ended` puts §7.6's prompt in front of somebody, `completed` records that they answered it. **"Leave
them where they are" is a real answer and sets the column exactly as the other two do** — a prompt that
reappears after being dismissed is one nobody ever finishes.

**Membership is one nullable column on `work_item`, not a join table.** §7.6: "cycle membership is per item,
never inherited." An item is in at most one cycle, which is single-valued and belongs on the row that has it;
a join table would permit two, and the first query to assume otherwise would be the burndown counting an item
twice. Null is the backlog — a destination, not a missing value — which is also why adding a cycle to a
project holding 5,000 items writes nothing.

**The foreign key carries three columns, and that is §9's device pushed one level down.** `(cycle_id,
project_id, workspace_id)` against a matching unique on `cycle`, because the tenant check alone would let an
item in Engineering join Marketing's sprint — both are in one workspace. It is `ON DELETE RESTRICT`, like
`work_item_state_fk`: deleting a container must never decide the fate of what is in it, so `deleteCycle`
releases every item first and the constraint is the second layer. `SET NULL` was not an option — on a
composite key it nulls *every* column, `project_id` and `workspace_id` included. Postgres reports the refusal
as `23001`, not `23503`, and the tenancy suite asserts that specifically.

**The burndown calls `is_working_day`; it does not reimplement it.** §9 put one SQL function behind working
days so "staleness, the reminder digest, and cycle progress" cannot disagree, and named this as the second of
the three callers. The ideal line descends across **working** days only, so a Monday-to-Saturday market (the
schema's default mask of 63, §2.5) burns twelve days in a fortnight and not fourteen — and Khmer New Year
flattens the line for a week (§17-18) instead of telling a team they are behind on the morning they return.
`withIdealLine` is the arithmetic and is pure, so both sides can run it; the *flags* come from the database,
which is the only thing that knows a company's calendar.

**`completed_at` is compared in the workspace's timezone.** It is a `timestamptz`, and which *day* it fell on
is a question only a zone answers: work finished at 8pm in Phnom Penh is the next day in UTC, and a burndown
computed in the server's zone shows a team finishing the morning after they did. The tenancy suite pins this
with a completion either side of local midnight.

**The future is `null`, not carried forward.** A line running flat to the end of the range reads as a team
that has stopped working, which is the opposite of what a chart on day three of ten should say. `standing`
compares at the last day that actually happened, never against the final ideal of zero — that would report
every cycle as behind until its last afternoon.

**Cancelled work leaves the denominator rather than joining either side of it.** §4 gives `cancelled` its own
state group precisely so this can be a third answer: counted as done, a team hits 100% by abandoning the
sprint; counted as outstanding, the cycle never finishes for work somebody decided not to do. The bar is
honest arithmetic and the count beside it says what was left out. Everything reads the state **group**, never
a state name — a company that renames "Done" to "Shipped" has changed nothing, and one with two completed
states has both counted.

**The burndown is by item count, and points appear only where a team estimates.** A points burndown means
nothing unless every item carries an estimate, and §17-9 hides estimates by default. The number is computed
and shown when it is non-zero rather than displaying a confident zero to everyone else.

**Slice 11 added a fourth anchor to the §9 list query rather than deleting the invariant.** `anchorOf` returns
`'cycle'` when the filter names a real cycle id, because a cycle belongs to one project and holds a planned,
bounded set — at least as tight as naming the project. **The `none` sentinel alone does not anchor**: "in no
cycle" is the whole backlog of the whole workspace, which is exactly the §16 scan wearing a filter. That
distinction is the one worth remembering if another anchor is ever added.

**Two permissions, and neither is new — the fifth time this decision has gone the same way**, after labels
(slice 5), attachments (slice 8), notifications (slice 9) and custom fields (slice 10). Planning a cycle is
`project.settings`; putting an item into one is `work_item.edit`, because §7.6 makes membership a property of
the item and that is not only a data shape but who may change it. A Member plans their own work into the
sprint their Lead set up.

**`work_item.cycle_changed` is the one `noNotify` in the slice that needs defending.** §7.8's general rule
would make it `item_activity` and tell every assignee — right for one item, catastrophic for the act it
describes. §7.6's "add items (multi-select from backlog)" is one person, one sitting, thirty items; under the
general rule that is thirty emails in ten minutes, which §7.8 is blunt about being how a team learns to filter
the product's mail. It projects to **activity**, where somebody scanning an item's history can see why their
work moved. `work_item.labelled` is silent for the same shape of reason. The four `cycle.*` events project to
no item's feed at all — a container is not an item — and only `cycle.deleted` is audited, joining the five
other actions that destroy rather than change.

**Two invariants live in migration 0020, not only in `validatePeriod`.** A backwards range and one longer than
a year, for the reason slice 5 put `root_id` in 0008 and slice 10 the value CHECK in 0018: a row written by a
seed script, a CSV importer or a Phase 2 MCP tool has to be as correct as one the service wrote. A backwards
range is not a rendering problem — `generate_series` over it returns nothing, so the chart silently draws an
empty cycle. The year bound is what stops a mistyped `2126` from asking for thirty-six thousand rows.

**The burndown is inline SVG and there is no charting library.** The same bargain `sigv4.ts` makes by not
adding `@aws-sdk`: two polylines, a set of bands and an axis, and a dependency would bring its own colour
system — the one thing §12's three-layer token architecture cannot accommodate. **No new token family was
added**, and that is the first time a slice with a visual surface has not needed one: the actual line is
`--accent`, the ideal is `--text-subtle` dashed, a closed day is `--surface-sunken`. Those are emphasis
levels, which layer 2 already has; slices 4 and 5 added families because a company's own *data* carried a
colour, and nothing here does. The chart carries a `sr-only` table of the same numbers, because an
`aria-label` summarising a fortnight is not reachable data.

**`getProjectBySlug` now loads the project's open cycles**, beside its states and custom fields and in the
same transaction — the trap slice 8 hit with `getCommentThread`, slice 9 with the unread count and slice 10
with custom fields. Open ones only, which is what keeps it cheap: a project accumulates a cycle a fortnight
and this is always the two or three a team is working in. The cycles *page* loads the full history, because
that is the page that shows it. `getWorkItem` additionally left-joins the cycle's **name**, because an item's
cycle may have closed and a picker that could not name its own current value would read as though the item
were planned into nothing.

**One thing §7.6 offers that is not built, deliberately.** "Add items (multi-select from backlog, **or
drag**)" — the multi-select is built and the drag is not. The board's drag is `moveWorkItem`, whose whole
contract is neighbour ids and a state change (slice 6), and teaching it a second meaning would make one
gesture do two different things depending on where it was dropped. §7.6 offers either, and the multi-select is
the one that works with a keyboard, which §11's baseline requires of everything.

**A known limitation, stated rather than hidden: the burndown redraws when scope changes.** It is computed
against the cycle's *present* membership, so an item added on day five appears to have been there since day
one, and one removed disappears from the history entirely. Recording scope changes needs a membership-history
table, which §7.6 does not ask for and which would be the only append-only table in the product with no reader
outside one chart. The `work_item.cycle_changed` events are written and are the raw material if it is ever
wanted.

## The other two views, and why a saved view is a URL with a name

Slice 12, and §14's "all four view types". `src/lib/saved-views.ts`, `src/server/db/schema/saved-view.ts`,
`src/server/queries/saved-views.ts`, `src/server/services/saved-views.ts`, the `table`/`calendar` entries in
`VIEWS`, the `day` grouping and `month` filter in `src/lib/work-item-query.ts` and
`src/server/queries/work-items.ts`, and the three components `table-view.tsx`, `calendar-view.tsx` and
`saved-views-bar.tsx`.

**Two views, no new query.** The Table is the §9 list query with `groupBy: 'none'`; the Calendar is the same
query with `groupBy: 'day'` over a one-month range on `due_date`. Both are imposed by the page the way the
board imposes `state`, and the grouping control is **hidden** on all three rather than disabled — a control
offering a choice the view will discard is worse than no control. That the whole slice needed one new SQL
branch (`day`) and one new predicate (the month) is the payoff for §9's "one DSL, one builder": four
renderers now share them.

**A saved view stores a query string, not a parsed filter.** §5 already made a URL the whole of a view's
state, so a saved view is a name for one. Storing a parsed object would be a second schema for what the Zod
DSL defines, kept in step by hand, and the first slice to add a filter would invalidate every row written
before it. A stored query string goes back through `parseWorkItemQuery`, which discards what it does not
understand — so a view saved by an older build still opens, one filter wider at worst.

**Views are personal, and that is §4's reading rather than a shortcut.** "Saved view sharing with teammates"
is in the should-have list, not the must-have one. So a row belongs to `owner_member_id`, every predicate
carries it, and **no §10 row was invented — the sixth time that decision has gone the same way**, after
labels, attachments, notifications, custom fields and cycles. What stops one person reaching another's is not
a role; it is that column, underneath the RLS that already scoped the row to the workspace. RLS cannot help
here — both people are in one company — so `saved-views.test.ts` asserts the owner predicate directly.
Sharing is the slice that adds a visibility column and *then* has a question for §10.

**No events either**, which is `setNotificationPreference`'s call from slice 9. §8's registry is for things
that happened to a company's *work*; naming a filter is furniture. An entry reading `audit: false, activity:
false, notify: false` would be three decisions recorded as "no" for an event nobody would read.

**The month belongs to the calendar and to nothing else.** It is a filter in the DSL — it restricts rows and
it is shareable, which is what makes it a filter rather than a fetch option like the digest's horizon — but
the page clears it on every other view, and `hasActiveFilters` does not count it. Left in force on the List
it would silently hide every undated item, with nothing on screen to say why and no control to clear it: a
filter a person can neither see nor undo. The same is true of the `day` grouping, and for the same reason
`PICKABLE_GROUP_BY` exists: `day` is only a *finite* set of headings because the calendar also fixes a month,
so it round-trips through the URL and stays out of the picker.

**A calendar URL with no month means "the current month", and the calendar does not rewrite the URL to pin
one.** That is the bargain the named due windows already make: `d=overdue` still means overdue tomorrow,
where a resolved date would quietly become a different question overnight. Paging to a month pins it, and
from then on the link names what it showed.

**Undated work has no cell, on purpose.** The month is a range on `due_date`, so an item with no due date is
outside every month rather than inside all of them. An "unscheduled" strip would need the predicate to be `or
due_date is null`, which would make the month mean "September, plus everything ever" — and the List already
answers that honestly with `d=none`.

**The calendar fetches ten rows per day, not fifty.** It asks for thirty-one `LATERAL` pages at once, and
`DEFAULT_LIMIT` in each would be fifteen hundred rows to draw cells that show ten. The cell's count is the
day's **real** total either way, because that comes from the counts query — which is exactly the split §9
made two queries for.

**Column widths are per saved view, and with no view selected a drag is not stored anywhere.** §12 says
"persisted per saved view"; the alternative — a per-member default layout — is a second thing to keep in step
for a preference nobody asked for. An unsaved resize lives in component state for as long as the page does,
which is what an unsaved change should do. `saveTableLayoutAction` deliberately **does not revalidate**:
rebuilding the route would re-render the table under a pointer still on the column edge, to arrive at the
layout already on screen.

**The resize handle is keyboard-operable**, because §11's baseline says "throughout" and a handle is not
exempt for being usually a drag. Arrow keys move a step, Home and End go to the bounds, and the e2e suite
resizes a column without a mouse.

**The layout is `jsonb`, which is the opposite of the call §9 made for custom field values — and the
difference is why that call was right.** A field value is filtered, grouped and sorted by, so it needs a
typed indexed column. A column layout is read once, by the one component that draws the table, and is never a
predicate. It is a blob because it genuinely is one. It is parsed on read *and* sanitised on write: the read
protects the screen from a row an older build wrote, the write protects the row from a client that sent
something the screen could never produce.

**Slice 12 found and fixed a latent bug older than itself.** `tx.execute` bypasses drizzle's column mappers,
so every date and timestamp arrives from the driver as a **string** — `RawRow` had typed `created_at` and
`updated_at` as `Date`, which the compiler could not catch and nothing exercised: `completed_at` is only
compared to null, and the other two are read only by `cursorFor`, which calls `.toISOString()` and is reached
only when somebody sorts by `created` or `updated` **and** pages past the first page. It threw there. `toRow`
now converts once, so `WorkItemRow`'s declared types are true for every caller, and `list-query.test.ts` pins
both the type and that paging.

**One thing §4 asks for that is not built, and it is named rather than hidden.** Saved views are per project;
the workspace-wide surfaces are slice 13's (My Work, Needs Attention), and `saved_view.project_id` is nullable
now rather than added later — the same call slice 5 made for `rank` and `completed_at`, because adding a
column to a table already holding a workspace's rows is a backfill under a lock.

## My Work, Needs Attention, workload, and the flag that keeps them honest

Slice 13, and §14's "the §7.3 and §7.4 loops; a member on leave shows as such instead of as idle capacity".
`src/lib/availability.ts`, `needs-attention.ts`, `status-summary.ts`, `src/server/services/workload.ts`,
`listWorkItemSets` in `work-items.ts`, migrations `0023`/`0024`, the components under `src/components/views/`
named above, and the `[workspaceSlug]/page.tsx`, `team/` and `settings/availability/` routes.

**The workspace root is now My Work.** §7.3: "Open app → lands on MY WORK (never a project list)", and §17-6
records why — "§2.1 says the employee must be paid back first". The old landing page listed projects, members
and teams; it is gone, and `membership.spec.ts` was updated rather than worked around, because §7.10's promise
was always "lands directly in the workspace, in the right teams, **on My Work**".

**Two new pieces of the §9 query, and nothing else.** The grouping `due` — §7.3's five buckets, as one SQL
expression (`dueBucketExpression`) that the counts query, the page query and the group key all read. It
mirrors `dueBucket` in `src/lib/workspace-date.ts`, which slice 5 wrote in anticipation of this screen. **One
expression rather than five branches** is the load-bearing part: a hand-written mirror fails as a group whose
header says three over a body that shows two, and the tenancy suite asserts `rows.length === total` for every
bucket. And the filter `stale: N` — §7.4's fifth row.

**`due` is in the group-by picker and `day` is not, and the contrast is the rule.** Both key on a due date;
only one has a finite key set without a second filter to bound it. `day` needs the calendar's month to be
finite at all; `due` is always exactly five headings.

**Staleness is §9's third caller and its fourth function.** Migration 0024 adds `stale_before(workspace,
today, days) → timestamptz`, built on `is_working_day` exactly as `business_days_between` is, so the four
cannot drift. It is a fourth function rather than a per-row `business_days_between` because that would be a
`generate_series` and a holiday probe **per candidate row**, on the one screen that looks at every open item
in a team. Asked once it is a cutoff instant, and the comparison against `updated_at` is an ordinary
index-usable predicate. It returns a `timestamptz` in the **workspace's** zone, because which day an
`updated_at` fell on is a question only a zone answers (§17-13) — the same trap slice 11's burndown hit.

**The DSL carries `N`; the resolved instant is a fetch option.** Exactly the split `soon` and its horizon
make, for the same reason: "five working days" means the same thing next Tuesday, and the instant it resolves
to does not. `fetchStaleBefore` asks once per screen, so two rows of the same tab cannot straddle midnight
and disagree about one item.

**`listWorkItemSets` exists because this screen asks six questions.** Needs Attention is five lists and
Workload is a grouping plus a second count; through `listWorkItems` that is six or seven `withActor`
transactions, each re-reading the same people, labels and project visibility. This is the trap slice 8 hit
with `getCommentThread`, slice 9 with the unread count and slice 10 with the custom fields, and the answer is
theirs: ask inside the transaction that is already open. Every set still carries its own anchored query, so
batching is not a way around §16.

**Needs Attention's rows overlap on purpose.** An item can be overdue *and* blocked *and* unassigned and
appears under all three. Any precedence order that picks one reason is wrong for somebody — the person
clearing blockers wants it under blocked, the person chasing dates wants it under overdue — and §7.4 lists
five rows, not one classified list.

**The scope is an enumerated project set, and that is the §16 anchor rather than an exception to it.**
`resolveWorkspaceScope` resolves the visible projects (optionally one team's) before any query is built. That
is what makes the *unassigned* row answerable: `none` bounds nothing.

**Slice 13 found a hole in `anchorOf` older than itself and closed it.** `assignees` anchored on any non-empty
list, so `a=none` — "every item in this company nobody owns" — passed `assertAnchored`. That is the §16 scan
wearing a filter, and it is precisely the distinction slice 11 wrote for a cycle's `none` and did not apply
here. A **named** person anchors; the sentinel alone does not. Nothing regressed, because every surface that
uses the sentinel supplies a project set too.

**§17-25 is arithmetic, not a badge.** "Workload assumed everyone is always available… the picture was
confidently wrong about the one person it mattered most about." So `getWorkload` excludes an away member from
`capacity.available` and from the average — dividing by everybody is the confidently-wrong number, because a
team of five with two away reads as comfortable at the moment the three left are drowning. The badge on the
column is the visible half; the denominator is the half that would otherwise still lie.

**Availability is two nullable columns on `workspace_member` and deliberately not an entity.** §4: "one date
— no hours, no balances, no approval flow — because time tracking is a §3 non-goal." Every absent thing is one
table away, and each is how this becomes the feature §3 rules out. The settings screen says so in as many
words, because that is what stops the next request being "can it track my remaining days".

**`until` is the day they are back**, so `isAway` is a strict comparison and the label reads "Back on". A
derived status with nothing to flip it, for the reason slice 11 derives a cycle's: a stored flag needs a job,
and a missed run is somebody who reads as on leave forever.

**Two people may set it and there is no new §10 row — the seventh time that decision has gone the same way**,
after labels, attachments, notifications, custom fields, cycles and saved views. Your own always; anybody
else's with `workspace.manage_members`, which is the row that already says who may change a membership. The
availability *reason* never reaches the audit log: the log is Owner-visible and permanent, and "surgery" is
not a record anybody asked us to keep — the same line `comment.deleted` draws when it audits the deletion and
withholds the body.

**A drag on the workload means something different from a drag on the board**, so it goes to a different
endpoint. §7.5's drag changes a state and computes a rank; §7.4's changes an assignee and computes nothing.
`api/internal/reassign` is a **fourth folder where §8's layout names three** — named rather than hidden — but
it is the *first* of §8's five route-handler exceptions ("drag-and-drop reorder"), not a sixth. Teaching
`moveWorkItem` a second meaning would make one gesture do two things depending on where it landed, which is
the line slice 11 already drew when it declined to teach the board about cycles.

**Reassigning onto somebody unavailable is warned, never blocked** (§7.4: "the manager knows things the flag
does not"). The write succeeds and a toast names who is away and until when. That needed a third Toast tone —
`warning`, taking its colours from the semantic aliases `Alert` has used since slice 1, so it is one row in a
map and not a new token family.

**Export is a print stylesheet** (§17-26), at the foot of `globals.css`. Three things it has to get right, each
a way the naive version fails: the **Khmer face is re-stated** rather than inherited, because a print
stylesheet that only sets colours lets the browser substitute a default with no Khmer coverage and §17-26 names
that failure exactly ("perfect on screen and prints Khmer as boxes"); the light palette is **forced**, or
somebody in dark mode prints white on white; and the workload's horizontal scroller becomes a stack, because
§7.4 says "printing a board with 30 columns → the print layout is the grouped list, never the board".

**These surfaces do not page, and that is stated rather than hidden.** Each caps its list and shows the
group's real total from the counts query. Keyset paging goes through `/api/internal/list`, which returns rows
for one project's context and one project's states; a cross-project page-two needs `GroupList` to carry the
project map, which neither §7.3 nor §7.4 asks for. A person with more than fifty items in one My Work bucket
has a problem a second page does not solve.

**The e2e run caught a missing message key within the hour, and the gap that let it through is now closed.**
Adding the `due` grouping without `workItems.groups.due` reproduced slice 10's `soon` defect exactly: absent
from *both* catalogues, so `messages.test.ts` passed on parity while the picker threw `MISSING_MESSAGE` into a
log next-intl swallows. `messages.test.ts` now asserts a label exists for every member of the enums a screen
renders one option per — the pickable groupings, the views, the due buckets, the attention rows, and the due
windows minus `soon`, which is the one member that correctly has no label.

**The new e2e drag test found a defect in the drag it was written for.** `onDragOver` moves the card into the
column it is hovering, so by the time `onDragEnd` runs, `over.id` is usually a **card in the destination**
rather than the destination — `closestCorners` prefers the nearest sortable. Resolving that id against the
*server* snapshot found the card still in the column it started in, concluded the drag was a no-op, and sent
nothing: a drop that visibly worked, animated into place, and silently did not happen. The two snapshots now
answer different questions — where it ended up is asked of the optimistic state, where it came from and what
to roll back to is asked of the server's. Worth knowing before touching `onDragEnd` in either board.

**The second e2e skip is this slice's.** The reassign drag needs both columns on screen at once and the
`mobile-km` viewport scrolls them, so it is skipped there with the reason on the line. The keyboard path is
not skipped anywhere — dnd-kit's `KeyboardSensor` is wired and the drag handle is focusable, which is §11's
baseline — but it is not yet asserted in a browser.

**One thing §7.4 asks for that is not built.** "Copy status summary" and "Export" are both there; the
`[!]` note's column *virtualization* is not. Thirty columns of twenty cards scroll horizontally without it,
and virtualizing would cost the keyboard path dnd-kit gives for free — §11's baseline requires the whole loop
without a mouse.

## The command palette, search, and the shortcut that must not fire while you type

Slice 14, and §14's "`⌘K` finds anything, in both scripts". `src/lib/search.ts`, `src/lib/shortcuts.ts`,
the `text` filter in `src/lib/work-item-query.ts` and its branch in `src/server/queries/work-items.ts`,
`src/server/queries/search.ts`, `src/server/services/search.ts`, migrations `0025`/`0026`,
`src/components/ui/dialog.tsx` and `command-palette.tsx`, the four files under `src/components/search/`,
`src/app/api/internal/search/` and the `[workspaceSlug]/search/` route.

**Search is a filter on the §9 query, and that is the whole structural decision.** `q` in the DSL, one
branch in `wherePredicate`, and the results inherit the counts query, the `LATERAL` page, the keyset
cursors, §17-17's archived default and §10's per-row re-check without any of them being written a second
time. Written as its own query it would have needed all five again, and it would have been the first place
"what is overdue" got two answers. The payoff shows in two places that cost nothing extra: the FilterBar now
has a search box on every list, and `/search?q=` is a URL you can paste in chat exactly as §5 promises of
every other view.

**It added no new anchor, and that is the part worth remembering.** A text predicate looks like it bounds a
scan and does not — below three characters no trigram index can serve a `LIKE '%ab%'`, and a one-letter
Latin prefix matches most of a company. §16's invariant is untouched because slice 13 had already built the
anchor this needs: `resolveWorkspaceScope`/`listProjects` enumerates the visible projects *before* the query
is built, and an enumerated project set is the `project` anchor. The feature that most looked like it would
have to weaken §9's rule is the one that leaned hardest on it.

**One generated column, two indexes** (`0025`/`0026`). `work_item.search_text` is
`btrim(lower(translate(title || ' ' || description, <zero-width>, '')))`, indexed both by
`gin (to_tsvector('simple', search_text))` for the Latin route and `gin (search_text gin_trgm_ops)` for the
Khmer one. **One source for both routes is the §13 requirement, not an optimisation**: if each route read a
different column the two languages would be searching different text, and the first bug report would be a
Khmer description nobody could find. Generated rather than trigger-maintained — unlike `assignee_ids` — for
the reason `root_id` is in the database at all: no seed script, importer or Phase 2 MCP tool can write a row
that is unsearchable. `lower()` in the column rather than `ILIKE` in the query, because `gin_trgm_ops`
cannot serve a case-insensitive operator and folding 50,000 descriptions per keystroke is the §16 failure
this slice exists to avoid. `btrim` because `concat_ws` — the obvious way to join two possibly-null columns
— is STABLE and a generated column will not take it.

**`simple`, not `english`.** A stemmer would drop "no" and "off" as stopwords, and "No build off master" is
exactly the title a tracker holds. What replaces stemming is the `:*` `toTsQuery` appends to the last term,
which is what makes a palette match before the word is finished — `plainto_tsquery` cannot express a prefix,
which is why the tsquery is built in TypeScript from terms reduced to letters and digits.

**The floor is the same in both scripts, and it costs something.** `MIN_QUERY_LENGTH` is two graphemes for
Latin and Khmer alike, so a two-character Khmer query is a scan of the visible projects' items rather than an
index lookup — bounded by RLS, the project set and a `LIMIT`. Raising it to three for the trigram route only
would make a Khmer speaker type more before anything happened than an English speaker does, which is
precisely §13's "Khmer is never the degraded path". The scan is the price and it is paid deliberately.

**Any Khmer in a query chooses the trigram route.** Mixed script is the common case here, not the exotic
one — a Khmer title with a client's Latin name in it — and a substring is a substring in any script, where
full text would reduce the Khmer half to one lexeme nobody will type again. The more general matcher wins
wherever there is doubt; full text is the *optimisation* taken when a query is purely Latin.

**Ordering is recency, not `ts_rank`.** `ts_rank` normalises by document length, so a one-word title scores
below a long description that mentions the word twice — backwards for a tracker, where what you want is
usually what somebody touched this week. It also cannot rank the trigram route at all, so ranking by it would
give the two languages different orderings of the same corpus. One rule, correct in both scripts.

**`ENG-142` is a different question, not a ranking hint.** §7.9: a direct lookup "always resolves regardless
of either" — archived or filtered — "that is the entire reason identifiers are never reused", so
`findItemByReference` applies neither the archived filter nor the toggle. It does apply `deleted_at is null`
and the caller re-asks §10 about the project, which matters more here than anywhere else in the slice because
the lookup is reachable by guessing a key and a number. Two parsing rules earn their comments: a key may
contain digits after the first, so **without a separator the key half is letters only** (`ENG2142` is
genuinely ambiguous, and the joined form resolves it one way, deterministically); and the parse is anchored
end to end, so a text query that merely contains a number never teleports somebody away from results they
were reading.

**The first modal in the product, built on the native `<dialog>`.** §8's stack table names Radix for
"accessible behaviour we don't rebuild" and no Radix package is installed; `showModal()` *is* the platform's
focus trap, plus the top layer, the inert background, `aria-modal`, Escape, and focus restored to whatever
had it before. This is the same call `sigv4.ts` makes against `@aws-sdk` and the burndown makes against a
charting library, and a stronger one — the alternative here is not our own code but the browser's. Nine
slices got by without a dialog at all, which is the outcome §12 wanted. §12's "Escape closes **unless there
are unsaved changes**" is the one part not implemented: no caller has unsaved changes, and a parameter
nothing passes is a parameter nothing tests.

**The palette is two components on purpose.** `ui/command-palette.tsx` knows nothing about work items,
tenancy or the router — it takes sections and reports a choice, and owns the keyboard contract (arrows across
section boundaries, Home/End to the list's ends rather than the text's, wrapping, scroll-into-view, and the
combobox ARIA pattern on the *input* so focus never leaves the field, exactly as slice 8's mention picker
does it). `search/command-bar.tsx` decides what is in it. Two things there are worth knowing before touching
either: **the active option is held by id, not by index** — an index has to be reset whenever the list
changes, which is an effect and a cascading render, where an id simply stops resolving and falls back to the
first row; and **every fetch aborts the one before it**, without which a slow answer to "lo" lands after a
fast answer to "login" and the results appear to go backwards as you type.

**Actions are matched in the browser, results on the server.** An action's label exists only in the message
catalogues, so only the client knows what "switch language" is called in Khmer — and nine entries filtered
locally are the fastest answer the palette can give. The company's data is matched where the company's data
is.

**§7.9's one contextual action needed a store, not a context.** "Assign to me" only means anything when an
item is on screen, and the palette lives in the workspace *layout* while the item lives on a page inside it —
React context flows down, so the page cannot provide to the shell that renders it. `current-item.tsx` is a
module-level value read through `useSyncExternalStore`: the item page publishes on mount and retracts on
unmount, and the cleanup clears only if *this* item is still current, because two item pages overlap for one
commit during a client navigation. The action **adds** rather than replaces, since §4 makes assignment
multiple and a shortcut that quietly did something different would be worse than no shortcut.

**Shortcut matching is a pure module because the DOM half is untestable.** `src/lib/shortcuts.ts` is a
function over a sequence of strings: `mod` folds Command and Control into one binding row, single characters
are lower-cased so caps lock cannot break a chord, and **Alt is namespaced away from every binding** because
AltGr produces characters on a Khmer layout. Three outcomes rather than a boolean — match, *pending*, none —
because "wait" is a real answer and treating it as "no" makes a chord fire only when typed twice. A dead-end
key is **retried on its own**, so `g` then `⌘K` opens the palette instead of being swallowed. A 1.2s chord
timeout, because a chord with no timeout makes every later keystroke unpredictable, which is what teaches
people to stop using shortcuts. `shortcuts.test.ts` also asserts that no binding is a prefix of another — the
shorter one would sit pending forever.

**`isTypingTarget` is the single most important line in the shortcut path.** `/` inside a comment composer
has to be a slash and `g` inside a title has to be a g; §7.7 is emphatic that typed text is never lost, and
this is the cheapest way for a product to lose some. The e2e run proved it accidentally and then on purpose:
`page.locator('body').press('?')` did nothing, because `body.focus()` is a no-op while a real control holds
focus, so the event still arrived with the input as its target and the guard correctly swallowed it. The test
now blurs first — which is what a person does by clicking away — and the guard is asserted separately.

**The `?` sheet is generated from `BINDINGS`.** A hand-kept table beside them is a second source of truth
that goes stale silently: nothing fails, the help is just wrong. Key caps are not translated — `⌘` and `Ctrl`
are things on a keyboard, not words — and `messages.test.ts` now requires a label for every member of
`SHORTCUTS`, `PALETTE_ACTIONS` and `SEARCH_SECTIONS`, which is the rule slice 13 wrote down after the `due`
grouping shipped with no string.

**`api/internal/search` is the *list fetch* exception, not a sixth.** §8 reserves five, and this is the same
concern `api/internal/list` is — reading a list — asked about four small ones instead of one big one. A
`GET`, so the browser cancels it for free on the next keystroke.

**No §10 row was invented — the ninth time that decision has gone the same way**, after labels, attachments,
notifications, custom fields, cycles, saved views and availability. Every palette action either navigates or
calls a service that already asks §10; search returns rows the list query already filters, from projects
`listProjects` already vetted.

**One new semantic alias, and no new token family**: `--overlay`, the scrim behind a modal, derived from the
neutral ramp through `color-mix` so it stays a token reference. It is the only value in the product that is
translucent by design — `bg-surface` at 100% hides the page, and hiding the page is what a sheet does, not a
dialog.

**`listProjects` was split into `listProjectsIn(tx, …)`** so the palette can resolve its scope inside the
transaction it is already in. The public function is now a one-line wrapper, so there is still exactly one
implementation of §10's visibility — the trap slice 8 hit with `getCommentThread`, slice 9 with the unread
count, slice 10 with the custom fields and slice 13 with §7.4's six lists, hit here on a keystroke rather
than on a navigation.

**Two things §7.9 asks for that are not built, both named rather than hidden.** The results screen **does not
page** — it caps each section and shows the real total, for the reason slice 13 gave for My Work: keyset
paging goes through `/api/internal/list`, which returns rows for one project's context and one project's
states, and a cross-project page two needs a project map neither §7.3 nor §7.9 asks for. And §7.9's `[E]` "no
results + a **create** option" offers the archived half of the corpus instead of a create form, because a
work item needs a project and §4's full create form is still the **slice-5 gap** recorded above.

## Settings, view-as, and the calendar that answers §18-10

Slice 15, and §14's "§6 complete; an owner can see the product as any member sees it". `src/lib/branding.ts`,
`src/lib/holidays.ts`, `src/server/auth/view-as.ts`, the four services
`workspace-settings.ts`, `workspace-logo.ts`, `holidays.ts` and `view-as.ts`, migrations `0027`/`0028`, the
components under `src/components/settings/`, `offboard-dialog.tsx` and `view-as-button.tsx` under
`src/components/members/`, and the routes under `[workspaceSlug]/settings/`.

**The header links are gone and Settings is one destination with nine sections.** Four screens reached from
four links in the workspace header worked while there were four and stops working at nine. The nav's
`visible` flag is a *nav* decision and never the access control — every page re-asks §10 for itself, because
a hidden link is not a permission. **Two of the nine are the member's own** — notification preferences and
availability — and they are deliberately ungated: a preference page an Admin has to unlock is a preference
page nobody finds.

**§6's governing rule shapes the whole slice**: "a company that never opens Settings must be completely
fine." So Settings is a destination and never a step — nothing in onboarding routes through it, and every
page under it edits a value that already has a working default. That is also why **the accent is nullable
rather than defaulted to `navy`**: a company that never opened the screen has not *chosen* Navy, it has
simply not chosen, and storing those as the same fact would make the default unrecoverable.

**The company form is one save, not six.** Six actions would be six audit rows for one visit, and a log
reading as six changes to one company on one afternoon is a log somebody has to reconstruct.
`workspace.settings_changed` therefore carries all four values **and** a `changed` list — the list
distinguishes "they changed the timezone" from "they saved the form", and the values answer the question
actually asked a year later, which is "what was it set to on the day the digests stopped".

**An accent is a token name, never a hex — the third time after `STATE_COLORS` and `LABEL_COLORS`.** A hex
written into a row in 2026 cannot resolve differently in dark mode, and it would be the one colour in the
product that stayed a light-mode colour on a dark screen. What the name resolves to is `[data-accent]` in
`globals.css`, which overrides the five `--accent-*` aliases in both themes; components are untouched
because they already say `bg-accent`. The attribute goes on a **wrapper inside the workspace layout, not on
`<html>`** — the root layout does not know which workspace is rendering — and custom properties inherit, so
the portalled Toast region and the native `<dialog>` in the top layer both pick it up. **Crimson is
deliberately not offered**: `--danger` is Crimson, and a company choosing it would have a primary button the
same colour as every delete button in the product. That is a usability defect a settings screen would be
handing them, not a preference somebody may express.

**No new token family, and one new component rule.** The accent radios hide a real `<input type="radio">`
under `sr-only` so the swatch can show the actual token resolving on the actual ground. That costs the one
thing `globals.css` gives every other control for free: `:focus-visible` draws an outline on an element
clipped to 1px, so the ring is drawn correctly and clipped away with it. **The label draws the ring instead**
(`has-[:focus-visible]:`), matched to the global rule's own width and offset — this is the only place in the
product where a component states its own focus ring, and the reason is that the input is invisible rather
than that the ring is special. The logo's file input is `sr-only` for a different reason — a Button opens the
picker — so it is `tabIndex={-1}`: left tabbable it would be an unlabelled stop with nothing on screen.

**The logo reuses slice 8's storage port and none of its schema.** Same two drivers, same signed PUT, same
rule that no byte passes through the app server. An `attachment` row belongs to a work item and carries
§10's comment permissions; a logo is a property of the company under `workspace.settings`, and there is
exactly one. Making it an attachment with a null `work_item_id` would have loosened a NOT NULL on the
busiest table in the schema to save one column on the quietest. There is **no `pending` row**, because the
row it writes is a column on a workspace that already exists — an abandoned logo upload leaves bytes nothing
references and no row at all, which is a smaller mess than the one slice 9 was asked to sweep. A fresh uuid
per upload, so replacing a logo cannot be served stale by anything that saw the old one. 512 KiB against the
attachment cap's 25 MiB, and three types against nine, because a logo renders at 32px in a header on every
screen in a market where data costs money (§2.5).

**§6-7 names two more things and neither is built, named here rather than hidden.** The **login page** is
pre-tenancy — it renders before any workspace is known, so there is nothing to brand it *with* — and the
**email header** needs the parent Unify mark, which is not in the repo (see "the logo is the exception"
below). Both are recorded on the branding page itself.

**§18-10 is answered, and the answer includes a refusal.** Cambodian public holidays are set by sub-decree
each year and several are lunar-dated, so: the **fixed-date** holidays are seeded for the current and next
year, at signup and on demand from Settings; the **moveable** ones are named but **never dated**; and
Settings warns when a year the product's own arithmetic will reach has no rows at all. A guessed date is
worse than an absent one — absent, a company adds it; guessed, the product is confidently wrong about the
fortnight of Khmer New Year and nobody looks, because the calendar appears to be filled in. Every seeded row
is an ordinary editable row afterwards, which is §6's rule that no default is one a company cannot delete.
A holiday is written as a **literal in the workspace's language**, not a `name_key`: there is no English
default it would be right to fall back to, so the seed picks the name from the workspace's default language
at the moment it writes and the company owns the string from then on. This is the awkward middle §13
describes, resolved the other way from `workflow_state.name_key` — and correctly, because nobody renames
Khmer New Year into existence.

**Everything the product says about time reads these rows**, which is why the whole file is
`workspace.settings` and why every change is audited. `is_working_day`, `next_working_day`,
`business_days_between` and `stale_before` all consult them, so a day added here changes what is stale, what
is due soon, where a burndown's ideal line flattens and which evening the digest goes out — for everybody,
retroactively.

**Migration 0028 is where §6's second half lives**: "no setting can put a workspace in an unrecoverable
state." The bound that matters is `working_days BETWEEN 1 AND 127`. **A company that works no days at all is
the one setting that bricks a workspace**: `next_working_day` walks forward and finds nothing,
`business_days_between` returns zero for every range so a burndown draws nothing, and the evening digest
never fires because there is no working evening — none of which reports an error. The product simply stops
saying anything about time. `week_start` is bounded 0..6 and numbered **0 = Monday**, deliberately not
JavaScript's numbering, because two day-numbering schemes in one schema is how a calendar ends up one column
out of step with the mask that shades it. The locale check is deliberately **not** an enumeration of the
locales the product ships: that set is a fact about `src/i18n/routing.ts`, and a CHECK listing it would have
to be migrated in step with adding a language. All of it is in the database for the reason slice 5 put
`root_id` in 0008 and slice 11 the period bounds in 0020: a seed script, a CSV importer or a Phase 2 MCP
tool has to be as correct as the service.

**View-as is a cookie, not a row, and it is deliberately not signed.** The cookie is a *claim*:
`resolveActorContext` re-decides on every request whether it may mean anything, re-asking that the viewer
still holds `workspace.view_as_member` in *that* workspace and that the target is still a live member of it.
A forged value can therefore only ask for a session the viewer could have started by clicking, which is what
makes signing pointless rather than merely omitted. It carries the **workspace id as well as the member id**,
so viewing as a colleague in Acme and then switching workspaces is a no-op rather than a lookup that fails
in some way nobody predicted. `httpOnly` all the same — a value client script can write is a value something
other than this product will eventually write. A cookie rather than a row because it is not a credential
with a lifetime to revoke: it holds no power the viewer does not already hold.

**Both edges of a view-as session run as the viewer, never from inside it.** `uow.emit` refuses while
`readOnly` is set — correctly, since a view-as session must produce no events of its own — so `stopViewAs`
rebuilds the viewer's own context rather than using the one the request resolved. A log saying the *target*
ended the session would be false. **Nesting is refused outright** rather than switching targets: "view as
Sophea, from inside viewing as Dara" has no meaning §7.13 defines, and the bar has one Exit rather than a
stack. `workspace.view_as_started`'s audit subject is the member being **viewed**, not the viewer — an owner
asking "who has been looking at Sophea's screens" is asking about Sophea's row, and the viewer is already on
every audit row as `actor_user_id` (§18-11, which built the second actor column for exactly this).

**Seven new events, every one of them `audit` only.** Settings changes are not an item's history, so all
seven project to no feed and notify nobody — the registry's third column stays `noNotify` throughout. The
one that would look arbitrary later is `workspace.branding_changed`, which records **whether** there is a
logo rather than the key: an append-only row outlives the object it names.

**§7.12's offboarding choice is not optional, and the type says so.** §4: "Removing a member requires
choosing what happens to their open work." `reassignTo` takes a member id or an explicit `null` — §7.12's
other branch, "leave unassigned", which needs no flag because §7.4's unassigned row already is that surface.
**`undefined` is not a third answer**, because a default here is a screen that silently picked for somebody.
The reassignment runs inside the same transaction as the removal, so there is no window in which somebody
has been offboarded and still owns forty items.

**No §10 row was invented — the tenth time that decision has gone the same way**, after labels, attachments,
notifications, custom fields, cycles, saved views, availability, search and the holiday calendar. There was
nothing to invent: §10's `workspace.settings` row already reads "Workspace settings, branding, teams", and
`workspace.manage_members` already says who may change a membership. The matrix named these screens before
the screens existed.

**The e2e suite found two defects in this slice and one of them was in the test.** The accent test called
`check()` on the `sr-only` radio, which Playwright correctly refuses as obscured by the swatch — a person
clicks the label, so the test does too. Behind it was the real one: the assertion `[data-accent="lilac"]`
matched the **swatch inside the picker**, an element carrying that attribute whether or not anything saved.
It passed instantly, waited for nothing, and the `reload()` after it then raced the still-in-flight server
action — **slice 8's race exactly**, and the fix is slice 8's: wait for the control that owns the mutation to
re-enable itself (`Button` disables while `useActionState` is pending) before navigating. The assertion is
now scoped to the element that *contains the shell*, which is the claim being made, and a reload proves the
value was stored rather than merely rendered. Worth knowing generally: **an assertion that can be satisfied
by the form you just submitted is not a wait**, and it is the shape a settings screen makes easy.

## Onboarding, the five states, and the icon that is deliberately absent

Slice 16, the last in §14, and the only one that added no table, no service and no query.
`src/lib/app-icons.ts`, `src/app/[locale]/manifest.webmanifest/route.ts`,
`src/components/ui/{skip-to-content,skeletons,offline-banner}.tsx`,
`src/components/views/view-skeleton.tsx`,
`src/components/onboarding/onboarding-step.tsx`, the four boundaries (`global-error.tsx`,
`[locale]/{error,not-found}.tsx`, `[workspaceSlug]/error.tsx`), the four `loading.tsx` files, and
`e2e/{onboarding,responsive,a11y}.spec.ts`.

**§7.1's chain did not join up, and that was the whole of the onboarding work.** The plan draws seven
steps — "Landing → Sign up → Verify email → Create company → Invite teammates → Create project → Land on
the BOARD" — and the product delivered five of them. Skip and a successful send both went to
`/{slug}`, which since slice 13 is My Work; a workspace with no project renders that as an empty screen
with nothing on it to do. So the invite step now leads to project creation, whose redirect **states
`view=board`** rather than assuming it: the DSL's default view is `list` (§9), so the bare project URL had
been the List for four slices while `createProjectAction`'s comment said "§7.1 lands the person on the
board". The comment was right and the code was not.

**`?new=1` is not in the filter DSL, and that is the point.** §7.1's last clause is "'add your first task'
input already focused", which the board's first column honours through `focusFirstComposer`. A filter is a
description worth sharing (§5); where somebody's cursor went once is not. Keeping it out of the DSL means
`toQueryString` drops it on the first filter change — exactly the lifetime a one-render gesture should have
— and a pasted link carrying it costs a stranger one focused input.

**The step marker is a query parameter, not a property of the route.** `/{slug}/projects/new` is §7.1's
third step *and* the ordinary new-project form reached from the projects list. Somebody creating their
fourth project in March is not on step 3 of anything. §7.1 says "no configuration step exists anywhere in
this path" and a counter does not add one — it says the path is finite, which is what §15-1's "someone who
has never seen it" actually needs: the failure that check catches is abandonment three screens in, not
confusion about a field.

**The 404 was the one screen in the product that was not in the reader's language.** Every `notFound()`
already returned a real 404 (§15-2), and what it rendered was the framework's untranslated English default
— §13's "Khmer is never the degraded path" failing at the moment somebody is already lost. The replacement
is one sentence covering four causes (moved, deleted, never existed, another company's) on purpose: the
workspace layout 404s a non-member so an outsider cannot learn which company slugs exist, and a message
that distinguished "no such workspace" from "not yours" would hand back exactly what that 404 withholds.
It offers `/workspaces`, the one route that resolves a destination for itself.

**Four boundaries, and each catches something the next one cannot.** `[workspaceSlug]/error.tsx` keeps the
shell — a failure on the cycles page should not take the header, the bell and the way back to My Work with
it. `[locale]/error.tsx` catches the workspace layout itself. `[locale]/not-found.tsx` is the 404.
`global-error.tsx` catches a failure in the root layout, and it is the odd one:

* **It renders both languages.** next-intl's provider is in the layout, and this component only ever runs
  when that layout did not. There is no locale to read and no catalogue to read it from, so the honest way
  to keep §13's promise on the one screen that cannot choose is to say it in both rather than to pick
  English and call it a default.
* **It is the one file in `src/` with literal hex in it**, and `check-design-tokens.sh` says so. The four
  values are the light palette's own anchors, copied rather than referenced, because a reference is the
  failure this file exists to survive. It follows that it is always light: `.dark` is set by a script in a
  layout that did not run.

**No error screen shows `error.digest`.** §11 forbids a raw error code, and a hash of a server stack is the
purest form of one. It goes to the console, where the person who can use it is looking.

**The skeletons match the view, and one of them had to read the URL to do it.** §11 asks for "skeletons
matching the final layout, never layout shift on arrival", and §7.1 for "`[L]` skeleton board with state
columns already drawn". A `loading.tsx` is handed no params, so it cannot know whether the board, the List,
the Table or the Calendar is arriving — and a placeholder shaped like the wrong one *is* the layout shift it
was added to prevent. `ViewSkeleton` therefore reads `view` from `useSearchParams` on the client: a
`loading.tsx` **is** a Suspense fallback, which is the boundary that hook requires, and the URL has already
changed to the destination by the time it renders. One client component, no page refactor, right in all
four views. The item page, the project settings page and the cycles page each carry their own boundary,
because without one the nearest ancestor is the project's and they would draw six columns of cards where a
title and a comment thread are coming.

**Adding a real Suspense boundary broke three tests, and the lesson generalises.** `page.goto` resolves on
`load`, which now fires with a skeleton on screen — so `locator.count()` and `locator.isVisible()`, neither
of which auto-waits, started answering about a page that had not arrived. `settings.spec.ts` counted zero
checkboxes, skipped its loop, and failed claiming the product had not refused an empty working week;
`board.spec.ts`'s `columnHolding` returned -1 and reported it as two browsers disagreeing. **Anchor on
something visible before any counting API**, and prefer waiting for the thing being asked about over
waiting for its container — a column exists in the skeleton too.

**§15-6's 390px was never actually tested, and pinning it found a real defect.** The `mobile-km` Playwright
project used the Pixel 7 preset at 412px — the twenty-two pixels in which a header stops wrapping and a
table stops overflowing. `responsive.spec.ts` now walks every v1 screen at 390 and asserts one thing: **the
document does not scroll sideways.** That is the failure that makes a screen unusable rather than merely
tight, and it is precisely the one the board, the Table and the workload avoid by scrolling inside their
own `overflow-x` container — so they pass while still scrolling, which is the distinction being asserted.

What it found is worth knowing before writing another scroller: **`overflow-x: auto` does not clip an
absolutely-positioned descendant whose containing block is outside it.** Every checkbox in the notification
preferences grid carries an `sr-only` label, which is `position: absolute`; on a `position: static` wrapper
those resolve against the initial containing block at their static position — 430px into a 512px table — so
the *document* grew to 432px while the table itself scrolled correctly. Nothing on screen showed it, because
a 1×1 clipped label is invisible in every sense but that one. The fix is one word, `relative`, and the
failure message in `responsive.spec.ts` names the culprit for the next one: it skips elements with a
scrolling ancestor, and skips `fixed`/`sticky` elements, which stretch to the document's width once it is
already too wide and so report the overflow rather than cause it.

**A11y is a sweep, not a list.** `a11y.spec.ts` walks the same screens and asserts that every control has an
accessible name, with the name computed by Playwright's `ariaSnapshot()` rather than by the test —
re-implementing the accessible-name algorithm would only produce a second, wronger answer. It runs per
locale, because a name is a string from a catalogue: an `aria-label` present in `en.json` and missing from
`km.json` is invisible to `messages.test.ts`, which can only compare keys. The skip link is the other half:
the workspace header is eleven tab stops deep, and it carries `tabIndex={-1}` on every `<main>` because a
bare `href="#main"` moves the *scroll* and leaves focus on the link in some browsers — so the next Tab goes
back into the header it just skipped. It states its own focus ring, which is the second place in the product
to do so after the accent picker, and for the same reason: the element is `sr-only`, so the styles that
un-clip it and the ring have to arrive together.

**`InlineCreate`'s error id is now `useId()`.** One composer renders per group, so a board draws six, and a
fixed `id` put the same one on every error a multi-group failure produced — `aria-describedby` resolves to
the first match in the document, which is the wrong column's message, silently.

**The install pass is complete except for the bytes, and the gap is a refusal.** One manifest **per locale**,
served from `[locale]/manifest.webmanifest` rather than Next's root `app/manifest.ts` convention, because a
manifest's `name` is what a person reads under the icon on their home screen and a single one would put the
app on a Khmer phone under an English name (§15-8: "in both locales"). `start_url` and `scope` carry the
locale too — that matters more here than anywhere in the browser, because `localePrefix: 'always'` makes the
locale *the URL* and a standalone window has no address bar to correct it with. `id` is pinned per locale, so
installing from `/km` after `/en` is a second app rather than an update that silently renames the first.
`start_url` is `/{locale}/workspaces`, the one route that resolves a destination for itself.

**`icons` is empty, and Chrome therefore declines to offer installation.** CLAUDE.md's rule is that UnifyOps
uses the parent Unify mark and that nothing may be substituted; the mark is still not in the repo. A
placeholder is worse than an absence in exactly this place — an icon ships to a home screen, sits there for
months, and is the one asset nobody re-opens a ticket about because it *looks* done. `src/lib/app-icons.ts`
is the whole of it: drop four files into `public/icons/`, flip `MARK_AVAILABLE`, and the manifest, the
`apple-touch-icon` link and the favicon all pick them up. The `apple-touch-icon` is declared **conditionally**
rather than pointed at a file that is not there, because a 404 behind it makes iOS render a screenshot of the
page as the icon — which looks like a bug rather than like an absence.

**`app-icons.test.ts` pins the one thing that drifts.** The theme colour has to be literal hex — a manifest
is JSON served to an installer and a `theme-color` meta is read before any stylesheet, so neither can resolve
a custom property. The test parses `globals.css` and asserts the two values are still the light and dark
`--bg`. Retuning layer 2 without them leaves an installed app opening on the old background for a frame on
every launch, and nothing during development shows it, because a browser tab's colour is not part of any page.

**A `?` in a Playwright URL pattern is written `[?]`, never `\\?`.** Ten specs assert the post-create URL,
which now carries a query string, and the backslash form degrades silently: written with one backslash it is
an invalid escape that becomes a bare `?`, which regex-reads as *"the previous character is optional"* — a
pattern that still matches enough URLs to look correct. Three pre-existing assertions in `views.spec.ts` had
the same latent bug and are fixed with it.

**The offline banner says only what the product can promise.** §11's edge row names offline, and §7.2 asks
for more than a banner — "item held locally, marked pending, retried; never lost on refresh". That queue is
not built. So `OfflineBanner` says "anything you change now may not be saved" rather than "your changes are
waiting", because the second is the product lying about a mechanism it does not have, on the one screen
somebody is already unsure whether their work was saved. It renders nothing until an effect has run — the
server cannot know whether a browser it has never met has a connection, and rendering from `navigator.onLine`
during SSR flashes an offline warning at everybody on the wrong half of the hydration mismatch.
`navigator.onLine` is famously optimistic and only trustworthy in the negative, which is the only direction
this component uses it in.

**Two §4 must-haves are still not built, and neither is slice 16's.** §4's Identity row reads "Email/password
+ **Google OAuth**, verification, password reset, sessions". Google OAuth does not exist — `accounts.ts`
anticipates it (a null password hash is "an OAuth-only account") and §17-29 records that it "slots in behind
the same interface", but there is no provider, no button and no callback route. **Password reset** has its
token machinery — `VerificationPurpose` carries `password_reset` and `tokens.ts` gives it the shortest
lifetime in the set, deliberately — and no route and no screen: there is no "forgot password" link on the
sign-in page and no `reset/[token]` page for the link to lead to. Both belong to slice 3 and are recorded
here rather than hidden, because §14 has no slice left to carry them.

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

Slice 14 added one alias and **no family**: `--overlay`, the scrim behind a modal. It is the only value in
the product that is translucent by design, and it is composed with `color-mix` over the neutral ramp rather
than written as an rgba literal, so it is still a token reference in both themes — deeper in dark, where the
page underneath is already dark and 45% would read as a shrug.

Slice 15 added **no family and no alias**, and instead did the one thing this architecture was built to make
cheap: `[data-accent='<name>']` **overrides layer 2's five `--accent-*` aliases**, per workspace, in both
themes. It is the first override of a semantic alias by anything other than the theme, and no component
changed — they all already said `bg-accent`. That is the payoff for never having let a raw ramp value reach
one. A fourth block per colour under `.dark [data-accent=…]` is required and easy to forget: an accent
defined only on the light selector is a company whose brand colour disappears at dusk.

Slice 16 added **no family, no alias and no override**, and instead produced the architecture's only two
sanctioned copies. `src/app/global-error.tsx` and `src/lib/app-icons.ts` are the sole files in `src/`
outside `globals.css` that hold literal hex, and in both the reason is that **there is nothing to reference
from**: the global error boundary renders when the layout that imports `globals.css` did not, and a
manifest is JSON served to an installer while a `theme-color` meta is read before any stylesheet. Both name
the palette's own anchors and both carry a comment saying so; `app-icons.test.ts` parses `globals.css` and
fails if the theme colours stop matching layer 2's `--bg`, because a copy that drifts shows up only as an
installed app opening on last month's background for one frame. `check-design-tokens.sh` will report both —
that is the hook working, not a violation to fix.

Components use semantic utilities only; never a raw ramp value and never a literal hex. All three shadow
tokens and both ring tokens are exposed through `@theme inline`, so `shadow-sm` resolves to the token rather
than to Tailwind's own default — no component should need `shadow-[var(--shadow-sm)]`. Focus rings are the
global `:focus-visible` rule and a component states its own **only** where the focused element is
`sr-only` — the accent picker is the one such place, and it matches the global width and offset rather than
inventing them.

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
