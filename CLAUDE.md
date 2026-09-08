# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: **§14, §20 and §21 are complete — every slice the plan specifies is built**

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
from inside the slice that introduced it. **Two §4 must-haves were left unbuilt and belong to slice 3** —
Google OAuth and password reset. **Password reset was built on 2026-09-04** and has its own section below;
**Google OAuth is the one §4 must-have still outstanding**, named at the end of the slice 16 section rather
than hidden. Work after §14 is gap-closing and §20, and each piece is still taken one at a time, on request.

**The first work that is *not* a gap is §20, the wiki and notes** — two nouns rather than one feature (a
page is the company's record, a note is one person's thinking). **Both slices are built**: slice 17 on
2026-09-04 and slice 18 on 2026-09-05, each with its own section below. Between them they added the document
format, five tables, §20.5's **two new §10 rows** — the first genuinely new rows since the matrix was
written — eight events and the subject union that widened `NotifyDraft`, a fourth search corpus, **slice 9's
unbuilt abandoned-upload sweeper**, and §13's per-content `lang` fix applied to page bodies, comment bodies,
item titles and descriptions together (§20.10 asked for all four in one slice "because fixing it in one place
and not the others is how one gap becomes four").

**§20 and §21 are finished, and there is no slice left.** What remains is the gap list, still four items
long, each named where it lives: **Google OAuth** (§4's last unbuilt must-have, a slice-3 gap), **§4's full
create form** (a slice-5 gap, and what note-promotion and §7.9's "no results + create" should both open once
it exists), **a workspace-wide recovery screen** for §4's 30-day window — which §20.3.6 assumed already
existed and which does not — and, found by slice 21, **the upload ticket a page has never had**: §20.9 landed
`attachment.wiki_page_id`, the download route and the sweeper, and `createUploadTicket` still takes a
`workItemId` and has no page branch, so neither a page nor a comment on one can carry a file (a slice-18
gap). **Slice 22 sharpened that last one rather than closing it**: §21.8 asks an export to carry "the
attachments the bodies reference", and it carries none — because there are none to carry.

**§21 is the second pass over §20's two nouns, and it is specified as four independent slices — 19 through
22.** They are "not a queue": each is shippable on its own and any may be skipped without stranding another,
and §21.13 orders them by *what makes a wiki survive* before *what makes it pleasant*. **All four are built**
(all 2026-09-05) and each has its own section below — ownership, verification, expiry, the All-pages view and
one new section on an email that was already going out; then backlinks, the reference graph and the editor
pass; then comments on pages, which widened `comment` into a subject union and found a slice-18 defect that
had been silently discarding every page notification; and now templates, export and import, which added a zip
writer and a zip reader with no dependency and found **the wiki's space list reporting zero pages for every
space since slice 18**. **There is no unbuilt slice left in the plan.** What remains is the gap list.
Work is still taken one at a time, on request.

§21.1 is the sentence the whole section hangs off, and it is worth having before touching any of it: **copy
what a knowledge product knows about documents rotting; refuse what it knows about letting people build their
own software.** §21.9 lists what that refuses — blocks as a platform, databases inside pages, formulas,
embeds, publish-to-web, synced blocks, realtime co-editing — each with the cost it would carry. The operative
rule for anything built under §21 is **a page may point at the company's data; it may never contain a second
copy of it**.

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
`src/components/onboarding/onboarding-step.tsx`), and now §20's first half — the document format and notes:
the Markdown parser and its allowlist, the three token formats, the `note` table, the notes screen and the
`⌘K` capture (`src/lib/{documents,doc-refs,notes}.ts`, `src/server/db/schema/note.ts`,
`src/server/queries/notes.ts`, `src/server/services/notes.ts`, `src/components/ui/document-body.tsx`, the
four files under `src/components/notes/`, and the `[workspaceSlug]/notes/` route), and now §20's second
half — the wiki: the four tables, the two new §10 rows, the space/page/revision/link services, the
abandoned-upload sweeper and the screens that read them (`src/lib/wiki.ts`,
`src/server/db/schema/wiki.ts`, `src/server/queries/wiki.ts`,
`src/server/services/{wiki,space-access}.ts`, `src/server/jobs/sweep.ts`, the eight files under
`src/components/wiki/`, `src/components/work-item/related-pages.tsx`, and the routes under
`[workspaceSlug]/wiki/`), and now §21's first slice — page ownership, verification and the All-pages
view: four columns on `wiki_page`, one on `wiki_space`, the `wiki_page_label` join table, §9's fifth
working-day function, three audit-only events and one more section on the evening digest
(`verificationStatus` and its constants in `src/lib/wiki.ts`, migrations `0033`/`0034`,
`fetchSpacePages`/`fetchVerificationCounts`/`fetchExpiringOwnedPages` in `src/server/queries/wiki.ts`,
`verifyPage`/`unverifyPage`/`setPageOwner`/`listSpacePages`/`releasePagesOf` in
`src/server/services/wiki.ts`, `src/components/wiki/{verification-badge,verification-panel,all-pages-view,space-verification-form}.tsx`,
and the `wiki/[spaceSlug]/pages/` route), and now §21's second slice — backlinks, the reference graph and
the editor pass: the `wiki_page_ref` table and the `icon` column, the callout/toggle/to-do grammar and
heading anchors, the `/` menu, the formatting shortcuts and the live preview beside the field
(`src/lib/editor-commands.ts`, `tableOfContents` and the callout half of `src/lib/documents.ts`, migrations
`0035`/`0036`, `fetchBacklinks` and `PageRef.excerpt` in `src/server/queries/wiki.ts`,
`syncPageRefs`/`setPageIcon` in `src/server/services/wiki.ts`, `normalizePageIcon` in `src/lib/wiki.ts`, and
`src/components/wiki/{insert-menu,page-toc,page-backlinks}.tsx`), and now §21's third slice — comments on pages: `comment`'s subject union and the two
CHECKs that replace its NOT NULLs, the `CommentSubject` event union, the space-level comment permissions, the
page thread, and the worker fix that made a page notification arrive at all (migrations `0037`/`0038`,
`wikiPageId` on `src/server/db/schema/comment.ts`, `CommentSubject` in `src/server/events/types.ts`,
`notifySubjectOf` in `registry.ts`, `canCommentInSpace`/`canModerateSpace`/`checkSpaceComment` in
`src/server/services/space-access.ts`, `CommentSubjectRef` in `src/server/queries/comments.ts`,
`membersPassing`/`spaceReaders`/`pageCommentThreadIn`/`postPageComment` in
`src/server/services/comments.ts`, `subjectOf`/`subjectUrl` and the left joins in
`src/server/jobs/notify.ts`, `src/components/work-item/thread-context.ts`, and
`postPageCommentAction`/`deletePageCommentAction` in the wiki's `actions.ts`), and now §21's fourth and last
slice — templates, export and import: the `is_template` column and 0040's two rules, a zip writer and reader
with no dependency, the front-matter format, the import planner and the round trip (`src/server/transfer/`,
`src/server/services/wiki-transfer.ts`, migrations `0039`/`0040`, `MAX_IMPORT_BYTES` in `src/lib/wiki.ts`,
`setPageTemplate`/`setPageTemplateIn` in `src/server/services/wiki.ts`,
`fetchSpaceTemplates`/`fetchSpaceExport` in `src/server/queries/wiki.ts`, and
`src/components/wiki/{page-template-form,space-templates,space-transfer,page-print}.tsx`).
All the `db:*` scripts work once `pnpm db:setup` has run.

Every gate was re-run on 2026-09-05 after **slice 22** — `typecheck`, `lint`, `test` (644 unit), `build`,
`test:tenancy` (365 against real Postgres 18.4) and `test:e2e` (247 passed, 13 skipped, across three
Playwright projects, plus the one known-flaky `a11y` failure below). **Re-run them rather than trusting this
line**; it is a snapshot, not a promise.

**`a11y.spec.ts`'s "the command palette and the shortcut sheet, which are the two overlays" is flaky, and it
is not slice 21's.** The palette opens, is named and closes; the `?` sheet that follows it sometimes never
appears, so `getByRole('dialog')` times out. It failed in one full run and passed in the next, and **failed
once in three isolated runs** — the failures being the runs against a **freshly built server** (5.7s) and the
passes the warm ones (2.6s), which is the tell worth having.

It was **verified against HEAD with slice 21 stashed, where it fails the same way** — the check worth doing
before blaming a slice for a failure on a screen it did not touch, since nothing in slice 21 renders on My
Work or in the shortcut path. Two threads for whoever picks it up, and the cold/warm split favours the first:
the `keydown` binding is attached by a client effect, so a press before hydration is heard by nobody; and
`body.press('?')` follows an `Escape` that closed a native `<dialog>`, where focus restored inside the closed
dialog would reach `isTypingTarget` and be correctly swallowed. That guard is the one slice 14 called "the
single most important line in the shortcut path", so the fix belongs on the test's waiting or on focus
restoration — **not** on the guard.

**`pnpm test:e2e` needs `--workers=2` on this machine, and that number is a fact about the hardware rather
than about the suite.** `workers` is unset in `playwright.config.ts`, so locally Playwright defaults to half
the CPU cores — and at that width the full run produced **63 failures, none of them reproducible**: the
failing set changed between runs, every spec passed in isolation, and the server log filled with `The
destination stream closed early`, which is slice 8's signature for a client abandoning an in-flight server
action. At `--workers=2` the same tree runs clean. CI is unaffected, because it already sets `workers: 1`.
**Do not read a large local failure count as a regression before re-running narrower** — and do not answer
it with retries, which is what would have hidden the one real race that was inside it (below).

**The full e2e run after slice 17 found three failures that were nothing to do with it**, and they are worth
knowing about because the shape recurs. `onboarding.spec.ts` still asserted `manifest.icons` was **empty** —
true when slice 16 shipped, and false a few hours later when the logomark question was answered and
`MARK_AVAILABLE` was flipped. The assertion's own comment had asked for exactly this ("the day it stops being
empty, somebody has to come and change this line on purpose"), and nobody had. It now asserts the two
properties a regenerated set has to keep — non-empty, and carrying a `maskable` entry — rather than a literal
list that would go stale the same way. **A test that pins an absence has a deadline on it**, and the deadline
is whenever the absence is filled.

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

**Slice 20 found a real race hiding inside that noise, and it is the most instructive thing in the slice.**
`wiki.spec.ts`'s delete test waited on `expect(confirm).toHaveCount(0)` — the confirm button disappearing —
with a comment reasoning that "the route 404s in place, so the button is gone rather than enabled; its
disappearance is the commit." **The premise was wrong.** The dialog closes on *submit*, client side, before
the action has resolved, so the wait returned while the delete was still in flight and the following
`page.goto` aborted it. The test then found the page still listed and reported it as a reparenting bug.

It passed for two slices because the window was narrow, and it started failing when slice 20 added two
queries to `getPage` — which is exactly how a latent race announces itself, and the third time this file has
had to record that shape (slice 8's two specs, slice 10's `getWorkItem`). It was diagnosed by *adding three
`console.log` lines*, which made it pass — the classic tell. The wait is now on a signal the **server**
produces: the page's own heading going away, which only happens once the revalidation has re-rendered a
route that 404s. **A control closing is a client event; only something that requires the server's new answer
is proof of a commit.**

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
initdb -D /tmp/pg -A trust -U postgres -E UTF8 --locale=C   # once — see below
pg_ctl -D /tmp/pg -o "-p 55432" -l /tmp/pg.log start
TENANCY_SUPERUSER_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm test:tenancy
TENANCY_SUPERUSER_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm test:e2e
```

**`-E UTF8` is not optional on Windows, and without it nothing database-shaped runs.** `initdb` with no
encoding takes one from the OS locale, which here is `WIN1252` — and the tenancy harness then dies on its
very first statement with `new encoding (UTF8) is incompatible with the encoding of the template database
(WIN1252)`, because `provision.ts` creates its database as UTF8. It is a confusing failure to meet: it names
an encoding nobody asked for and points at a `create database` line. `--locale=C` goes with it so text
ordering is byte order, which is what `rank`'s `COLLATE "C"` already assumes. This recipe said neither
until slice 20 hit it.

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

**Queries that share one `withActor` transaction go out one at a time — `inSequence`, never `Promise.all`**
(`src/server/db/sequence.ts`). A transaction is one checked-out client, and a client speaks one query at a
time on one socket, so `Promise.all` over a shared `tx` never made anything concurrent: `pg` queued the rest
and sent each as the one before it came back. That queue is deprecated in `pg` 8.23 and **removed in `pg` 9**,
which turns today's warning into tomorrow's failure. It warns only from the *third* query in flight —
`this._queryQueue.length > 0` in `client.js` — so a two-query site is equally wrong and silent about it, which
is why every site was converted rather than the one that spoke up. Genuinely concurrent queries need
genuinely separate connections, and inside `withActor` that is not on offer: the transaction is what carries
the tenancy GUCs the RLS policies read. `sequence.test.ts` pins the absence of overlap rather than the
results, because a test that only checked the returned tuple would still pass with `Promise.all` put back.

It was found as a `DeprecationWarning` under `next dev` whose stack named only `TeamPage` — the workload tab
asks `listWorkItemSets` for six sets, each two queries, on one transaction. The stack a warning like this
carries names the React component that rendered the page and nothing about Postgres, which is the second time
this file has had to record that (see the jest-worker obituary above).

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
src/server/{db/{schema,client.ts,tenant.ts,identity.ts},auth,authz/policy.ts,queries,services,events,jobs,transfer}
src/components/{ui,auth,invite,members,work-item,views,search,notes,wiki}   src/i18n   src/lib   drizzle/
```

`src/lib` is for code **both sides run** — `slug.ts`, `recipients.ts`, `form-state.ts`, `cn.ts`. Anything in
`src/server` that a client component needs belongs there instead, and anything that touches a connection
carries `import 'server-only'` at the top so a mistaken client import is a build error rather than a bundle.

The migration order in `drizzle/` is load-bearing: `0000` creates the `tenancy.*` functions **before** `0001`
creates policies that call them, and `0002` adds what drizzle-kit cannot express (`FORCE ROW LEVEL SECURITY`,
grants, revokes). Every slice after that repeats the pair — `0003`/`0004` for slice 3, `0005`/`0006` for slice
4, `0007`/`0008` for slice 5, and so on to `0027`/`0028` for slice 15 and `0029`/`0030` for
slice 17, `0031`/`0032` for slice 18, `0033`/`0034` for slice 19, `0035`/`0036` for slice 20, `0037`/`0038` for slice 21 and `0039`/`0040` for slice 22. Regenerating a generated file with `db:generate` is fine; `0000`, `0002`,
`0004`, `0006`, `0008`, `0010`, `0012`, `0014`, `0016`, `0018`, `0020`, `0022`, `0024`, `0026`, `0028`, `0030`, `0032`, `0034`, `0036`, `0038` and `0040` are hand-written and must stay that way. A hand-written migration is
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
- **Password reset is built** (2026-09-04) and has its own section below. It added one function to
  `accounts.ts` and nothing to the schema: slice 3 had already given `password_reset` a `VerificationPurpose`,
  the shortest lifetime in `tokens.ts`, and `endAllSessions` with this caller named in its comment.
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
per upload, so replacing a logo cannot be served stale by anything that saw the old one. 2 MiB against the
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

**`icons` shipped empty and is now filled — the slice-16 refusal was answered on 2026-09-04.** It was empty
because CLAUDE.md's rule was that UnifyOps uses the parent Unify mark and that nothing may be substituted; a
placeholder is worse than an absence in exactly this place, since an icon ships to a home screen, sits there
for months, and is the one asset nobody re-opens a ticket about because it *looks* done. The instruction is
now to use the **UnifyCharge primary logomark** until the parent file exists, and the file the slice was
written around took it without changing shape: `src/lib/app-icons.ts` still holds all of it, `MARK_AVAILABLE`
is flipped, and the manifest, the `apple-touch-icon` link and the favicon picked the files up. Chrome now
offers installation. `MARK_AVAILABLE` was kept rather than deleted, because an empty set is still the honest
state if a mark is ever withdrawn.

Three things about the set are worth knowing before regenerating it. The **favicon is the brand SVG
verbatim**, with a 32px PNG behind it for browsers that decline a vector — declared through `metadata.icons`
rather than Next's `app/icon.*` file convention, because an explicit `icons` key **takes precedence over the
convention**, so declaring `apple` there and leaving the tab icon to the convention is how a favicon silently
disappears. The **maskable icons sit at 60% on Ivory**, because Android crops to a circle and a mark at full
bleed loses its corners. And the **`apple-touch-icon` is the one opaque PNG**: iOS composites a transparent
touch icon onto black, which would put a dark square on a light home screen. It is still declared
conditionally, because a 404 behind it makes iOS render a screenshot of the page as the icon — which looks
like a bug rather than like an absence.

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

**Two §4 must-haves were still not built, and neither was slice 16's.** §4's Identity row reads
"Email/password + **Google OAuth**, verification, password reset, sessions". **Password reset was built on
2026-09-04 and has its own section below.** Google OAuth still does not exist — `accounts.ts` anticipates it
(a null password hash is "an OAuth-only account") and §17-29 records that it "slots in behind the same
interface", but there is no provider, no button and no callback route. It belongs to slice 3 and is recorded
here rather than hidden, because §14 has no slice left to carry it.

## Password reset, and the link that must survive being read

Built 2026-09-04, after §14's sequence was complete. It is a **slice-3 gap**, not a slice of its own: §4's
Identity row named it, slice 3 built every piece of machinery it needs and none of the screens.
`inspectVerificationToken` in `src/server/auth/accounts.ts`, `passwordResetEmail` in
`src/server/email/templates.ts`, four exports at the foot of `src/app/[locale]/(auth)/actions.ts`, the
`forgot-password/` and `reset/[token]/` routes, `src/components/auth/{forgot-password,reset-password}-form.tsx`,
and the two test files `e2e/password-reset.spec.ts` and `src/server/db/__tenancy__/password-reset.test.ts`.

**No migration, no table, no service, no §10 row — the eleventh time that last decision has gone the same
way**, after labels, attachments, notifications, custom fields, cycles, saved views, availability, search,
the holiday calendar and settings. There was nothing to invent: a reset happens before a workspace is known,
so there is no actor to ask §10 about. What authorises it is possession of a link sent to the address on the
account, which is the whole of the check.

**Everything that was needed already existed, and that is worth noticing.** `LIFETIME.passwordReset` was
already the shortest in `tokens.ts` with a comment saying why; `VerificationPurpose` already carried
`password_reset`; `issueVerificationToken` already invalidated the previous unused link; `setPassword` and
`markEmailVerified` already existed; and `endAllSessions` was written in slice 3 with a comment naming
"password change" as its caller. The one function that had to be added is the one below.

**The GET must not spend the link, and that is the single decision this feature turns on.**
`consumeVerificationToken` was the only thing available, and using it on the page that renders the form
would have been correct-looking and broken in production: Outlook Safe Links, corporate mail gateways and
most mobile clients fetch every URL in a message to vet or preview it, so the person would open a link their
own employer's proxy had already spent and be told to ask for another one — for ever, since the next link
gets scanned too. `inspectVerificationToken` is the read-only half; the POST still consumes conditionally
and remains the only thing that decides. **Email verification is right to consume on the GET** and the two
cannot share a rule: there the prefetch *performs* the intended action, and the user arriving second finds a
confirmed address. Here there is a second step.

**The request form reveals nothing, and the copy is what makes that true.** It answers "if an account exists
for that address, a reset link is on its way" whether or not one does — a sentence that is true in both
cases, because a reassuring message that is only sent to real accounts is the tell. A malformed address is
still reported as a field error: "not an email address" and "no account for that email address" are
different facts and only the second leaks. **The timing channel is written down rather than papered over**:
a real address costs a token insert and a provider round trip, an unknown one costs one indexed SELECT.
Closing it would mean sending real mail to an address known not to be ours, or moving the send onto slice
9's outbox — a queue this flow does not otherwise need. `signIn`'s dummy hash closes the same hole on the
path where it is cheap to.

**The order of the last four statements in `resetPassword` is the security story.** Consume — conditionally,
so two tabs cannot both succeed; set the password; end **every** session; then start a fresh one. Ending
sessions before starting the new one rather than after, because the other order signs the person out of the
session they just created. A reset is the remedy for an account somebody else is already inside, and leaving
their cookie working makes the remedy cosmetic.

**Validation runs before the token is touched.** A mistyped confirmation costs a retry; consuming first
would spend a one-hour credential on a typo and send somebody back to their inbox for a link that has not
arrived yet.

**Following the link confirms the email address too.** It is the same proof the verification link asks for,
so an unconfirmed account is confirmed here rather than being shown `VerifyEmailBanner` seconds after
proving the point.

**The confirmation replaces the request form rather than sitting above it.** Leaving the form on screen
invites a second submit, and a second submit invalidates the link the first one sent — so somebody clicking
twice would have a live link killed while the dead one is the one in their inbox.

**Both password fields carry `autoComplete="new-password"`, including the confirmation.** A manager that
fills the first and not the second leaves somebody retyping a generated password by hand, which is how a
reset ends in a mismatch error on a password nobody chose.

**The tenancy suite found a property nobody had asserted.** The first draft of
`password-reset.test.ts` reached for `h.owner` to check a row, the way every other file in that directory
does, and read **zero rows rather than an error**. That is `authTablePolicies` working: the auth tables
carry one policy, for the identity role, and `FORCE ROW LEVEL SECURITY` applies it to the owner too — so the
role that runs migrations cannot read a session token or a live reset link, and the app and operator roles
do not reach a policy at all because 0004 revoked the privileges. It is now its own test, because the
failure mode if it regressed is silent: a test reading zero rows and a support query reading all of them
look identical from inside the test.

**`pnpm test:e2e` was broken for anyone with a real `RESEND_API_KEY` in `.env`, and that is fixed here.**
`e2e/support/serve.ts` said "No RESEND_API_KEY" and merely did not set one — but `next start` loads `.env`
itself, so the child process got the real key, `emailConfig()` chose the Resend transport, and every
mail-dependent spec failed with `Mailbox held: (nothing)`. CI never saw it, because CI has no `.env`. The
fix is `RESEND_API_KEY: ''` rather than a `delete`: `@next/env` fills a key only when its `typeof` is
`undefined`, so **present-and-empty is present**. Worth knowing before adding any other "we deliberately do
not set this" to that env block.

**Two smaller scars in the specs.** Playwright labels are matched at their *start* and never end-anchored —
§12's field shell appends a required marker, so the label element reads `New password*` while the control's
accessible name is `New password`, and a `$` matches nothing. And the pre-tenancy sweep in
`responsive.spec.ts` used to continue from wherever its loop left the browser; adding a path to that list
broke a block thirty lines below it with a timeout that named neither. It navigates explicitly now.

## Notes, the document format, and the predicate RLS cannot enforce

Slice 17, the first half of §20 and the first work in this repo that is not a §14 slice or a gap in one.
`src/lib/documents.ts`, `doc-refs.ts` and `notes.ts`, `src/server/db/schema/note.ts`, migrations
`0029`/`0030`, `src/server/queries/notes.ts` and `src/server/services/notes.ts`, the `notes` section in
`search.ts` on both sides, `src/components/ui/document-body.tsx`, the four files under
`src/components/notes/`, and the `[workspaceSlug]/notes/` route.

**The whole slice hangs off one sentence in §20.1: a page is the company's record, a note is one person's
thinking.** They look like one table with a `visibility` column, and that shape is refused — because merged,
every query touching either would have to read *"the §10 project rule **or** `owner_member_id = me`"*, and the
first query written that forgets the second half shows a colleague somebody's private notes. So it is two
tables, and slice 18's wiki shares the editor and nothing else.

**The consequence is the one thing about this slice that is genuinely new: RLS is not what makes a note
private.** Every other tenant table in this product is protected by a policy — ask for another company's rows
and Postgres returns nothing. A note has to be hidden from a *colleague in the same workspace*, so the policy
passes and `owner_member_id` in the predicate is the only thing left. That is why
`__tenancy__/notes.test.ts` seeds a **second member's rows in the same workspace** and asserts they are absent
**by id**: a test that counted what came back would still pass with the predicate deleted, because the count
would simply be larger. It is also why `queries/notes.ts` has no function that takes a note id without an
owner — a "load this note" that trusted its caller to check afterwards is exactly the shape the one forgotten
call site takes.

**No §10 row, and there can never be one — the twelfth time that decision has gone the same way**, after
labels, attachments, notifications, custom fields, cycles, saved views, availability, search, the holiday
calendar, settings and password reset. The eleven before it were "the matrix already says this"; this one is
different and stronger: there is no version of §10 in which an Admin may read a colleague's note, because the
whole promise of the screen is that nobody can. §20.5's two genuinely new rows are the *wiki's*, and they
arrive with slice 18 and the noun that needs them.

**No events at all** — not audit, not activity, not notification (§20.6). This is `saved_view`'s call from
slice 12 taken further and for a stronger reason: there the argument was that naming a filter is furniture,
and here it is that a permanent, Owner-visible, append-only record of what somebody privately wrote is the
harm itself. That extends to offboarding, which destroys a departing member's notes and emits nothing about
it: an audit line reading "12 notes destroyed" would be that record in miniature. The number is said *before*
the click instead, on §7.12's dialog, which is where a fact somebody may want to act on belongs.

**Offboarding is the asymmetry stated out loud.** Work is reassigned and comments and activity stay
attributed, because those are the company's record — which is why `comment` and `comment_mention` are
`ON DELETE restrict`. Notes are destroyed, because they are not. `note_owner_fk` is therefore the one
`cascade` in the schema where an offboarding cascade is the *right* answer, and `deleteNotesOf` runs inside
`removeMember`'s own transaction so there is no window in which somebody has been offboarded and their notes
are still readable through a view-as session.

**"Private" is qualified on screen, and that is deliberate.** An Owner in a §7.13 view-as session reads these
rows, because `withActor` scopes as the target member. That is what view-as is *for* and it is already
audited — so the banner says "private to you and to anyone who can view the workspace as you" rather than
"private". A screen that promised more than the architecture delivers would be the one lie in the product
that matters most.

### The body format, which is the expensive-to-reverse decision here

§20.13 puts 17 before 18 for one reason: "getting the body format wrong is the expensive-to-reverse decision
here, in the way slice 5's list query was", and notes are the cheap place to find that out — no permission
model, no tree, no revision table, no concurrency rule.

**Markdown, in a `text` column, parsed into an allowlisted node tree.** `src/lib/documents.ts` parses and
emits **nodes, never markup**; `src/components/ui/document-body.tsx` turns nodes into elements. That split is
what makes §20.7's "raw HTML is refused, not sanitised" a property of the architecture rather than of a
filter: there is no `dangerouslySetInnerHTML` anywhere downstream and nothing for a sanitiser to stand in
front of. A `<script>` somebody types is a `<script>` somebody reads, because a text node is the only thing
the parser can emit for it.

**No dependency**, which is the same bargain `sigv4.ts` makes against `@aws-sdk`, the burndown against a
charting library and `dialog.tsx` against Radix — with one argument specific to this feature: a Markdown
library's *extensions* are where the HTML passthrough lives, and the setting that disables it is one upgrade
away from being renamed.

Three rules in the parser will look arbitrary later and are not:

- **A newline inside a paragraph is a hard break.** CommonMark folds it into a space and wants two trailing
  spaces for a break; that rule was written for typeset prose, and this is a box people paste addresses and
  checklists into. The escape is invisible in a textarea and stripped by half the editors that would touch
  the text.
- **A delimiter that finds its partner is emphasis, and one that does not is the character it was.** No
  delimiter stack, no left-flanking rules — one sentence instead, so `2 * 3 * 4` stays arithmetic and
  `snake_case_name` stays a name. Everything not in the grammar renders as the text it was, which is the one
  failure mode a person can see and correct.
- **`safeHref` is an allowlist, not a blocklist** — `http`, `https`, `mailto`, and a relative URL starting
  with a single `/`. `//evil.example` is protocol-relative and is refused by the second character; a refused
  link renders as its own text rather than as the raw source, because putting `javascript:` on screen reads
  as the product quoting it back approvingly.

**All three token formats are defined now, including the one with nothing to resolve to.** `@[uuid]` is slice
8's mention token parsed by the same `mentions.ts`; `#[uuid]` is slice 18's page reference; `ENG-142`
autolinks. A page token costs a regex today and a rewrite of every stored body if it were retrofitted, which
is the whole of why §20.13 ordered the two slices this way. It renders as an absence until slice 18 gives it
something to name — the same fallback slice 7 chose for an activity line naming a hard-deleted state.

**`ENG-142` autolinks only in its separated form**, unlike `parseItemReference`, which accepts `ENG142` from
the palette. A person typing an identifier into a search box has said what they mean; running prose is the
opposite case, where `A4` is a paper size and `COVID19` is a word. The dash is what the product prints and
what anybody pastes, so requiring it costs nothing and removes the whole class of false positives.

**An item reference links through `/search?q=ENG-142`, not straight to the item.** A direct link needs the
project's *slug* and a body only carries its key, so resolving one would be a key-to-slug lookup for every
reference on every screen that renders a body. §7.9 already built that lookup and made it unconditional, and
it is the only version that is correct for an identifier that does not resolve: a constructed link would 404,
where the search screen says "No item ENG-142".

### The rest, briefly

**A note's title is derived and never stored** (§20.4) — the first line, read *through the parser* so `#
Standup` is called "Standup". Stored, it would be a copy of a string the body already holds, and the two
would disagree the first time somebody edited their opening line. Only the first line is parsed, not the whole
body: a list of fifty notes would otherwise be fifty full parses per render.

**Search is the third corpus on the same recipe, not a second recipe** (§20.8). Migration 0030 is 0026's two
indexes over a second generated `search_text` column, and `src/lib/search.ts` stays the only place the
Latin/Khmer routing decision is made — if each corpus detected script its own way, a mixed-script query would
find items and miss notes. The owner predicate is carried *into* the query and never applied to the rows that
come back: a `LIMIT` before the predicate is a palette that tells somebody how many notes their colleagues
have, and it would do it by silently returning fewer rows.

**`createWorkItem` was split into `createWorkItemIn(tx, uow, …)`**, the same move slice 14 made with
`listProjectsIn` and for the same reason. Promoting a note reads the note, creates the item and records what
the note became, and all three are one thing that either happened or did not; a second `withActor` would hold
two pooled connections for one click. `CreateWorkItemInput` gained `description` with that caller rather than
ahead of it.

**Promotion is a copy, never a move** (§20.1) — the note stays where it was and keeps a quiet line saying what
came out of it. A move would be the one operation in the product that silently changes who can read
something, performed from the one screen whose whole promise is that nobody else can. §4's **full create form
is still the slice-5 gap**, so promotion picks a project and lands the person on the item; when that form
exists, this is the control that should open it.

**`note.work_item_id` is the one tenant column in the schema not held honest by a composite key.** §20.4 makes
the pin `ON DELETE SET NULL` — a note whose item was deleted is still the person's note — and a composite key
would null `project_id` and `workspace_id` along with it. What replaces §9's device is narrower but real: the
pin is only ever written by `pinNote`, which reads the item through `withActor` first, so RLS has already
refused an item outside the workspace before the id reaches the column.

**The capture dialog mounts its composer only while it is open**, and the e2e run is what found out why. A
native `<dialog>` that is closed is still in the document — merely `display: none` — so a permanently-mounted
composer put a *second* note textarea on every workspace screen, behind the one the notes page renders.
Playwright's strict mode caught it in the first run; somebody using a screen reader's form-controls list would
have caught it the same way.

**The notes list does not page**, which is slice 13's call for My Work and slice 14's for the search results,
stated rather than hidden: keyset paging goes through `/api/internal/list`, which returns work-item rows for
one project's context. It caps at 200 and shows the real total. Somebody with more than that finds a note by
typing, not by scrolling.

**§13's per-content `lang` gap is half closed and deliberately not more.** `DocumentBody` puts `lang="km"` on
a body `hasKhmer` detects, which is what `:lang(km)`'s line-height keys off — but comment bodies, item titles
and project names still inherit the page's. §20.10 asks for all four to be fixed **together**, in slice 18,
"because fixing it in one place and not the others is how one gap becomes four", and doing the other three
here would have been slice 18's work done early and untested against a page.

**Two lint rules shaped a component and are worth knowing before writing the next one.**
`react-hooks/set-state-in-effect` refuses a `setState` sitting under a *second* condition inside an effect, so
`NoteComposer` clears its box and notifies its parent in two effects rather than one — the mode test is the
outer guard of the first, not an `if` around the state update. And `react-hooks/refs` refuses writing a ref
during render, which rules out the usual "hold the callback in a ref" trick; the callback is an ordinary
dependency instead, and a `lastSaved` guard makes the extra runs no-ops.

## The wiki, and the rule the board deliberately does not follow

Slice 18, the second half of §20, and the last slice §20 asks for. `src/lib/wiki.ts`,
`src/server/db/schema/wiki.ts`, migrations `0031`/`0032`, `src/server/queries/wiki.ts`,
`src/server/services/wiki.ts` and `space-access.ts`, `src/server/jobs/sweep.ts`, the eight files under
`src/components/wiki/`, `src/components/work-item/related-pages.tsx`, and the routes under
`[workspaceSlug]/wiki/`.

**A stale save is refused, never merged, and that is the whole feature.** §20.3.3 sets it against §7.5's
drag on purpose: a stale drag "lands correctly relative to present state — this is what stops boards feeling
haunted", because a card's position is small and recoverable and re-deriving it is what the human meant
anyway. A document body is neither. So `saveWikiPage` updates **conditionally on `revision_no` in one
statement** — `where id = $1 and revision_no = $base`, with `returning` as the proof it happened — and a
zero-row result is the refusal. A `SELECT` then an `UPDATE` has a window between them that two saves both
pass. The screen then shows the writer's own text *and* the version that landed, because §20.3.3 says
"their words are never discarded and never merged", and a toast would discard half of that.

**`baseRevision` is derived, not synchronised, and the lint rule is what produced the better version.**
`react-hooks/set-state-in-effect` refused the obvious `useState` + `useEffect` pair — the same rule slice 17
worked around in `NoteComposer`. Revision numbers only increase, so the highest number the component has
heard about *is* the base: `Math.max(page.revisionNo, state.revisionNo ?? 0, state.current?.revisionNo ?? 0)`.
No state, no effect, and nothing to keep in step.

**The space is the unit of access, and `space-access.ts` is the only module that knows it.** §20.5 refuses
per-page ACLs for §6-2's reason — "a per-object ACL is a second permission system that has to be joined into
every list query, shown in every UI, and explained to the non-technical owner of §2.3". So `queries/wiki.ts`
decides no permissions at all; every function takes an already-resolved space or an already-vetted set of
space ids. That is a **different shape from `queries/notes.ts`** and deliberately: a note is bounded by
`owner_member_id` and the predicate has to be *in* every query because nothing else can apply it; a page is
bounded by a row the caller has already asked about.

**§20.5's two new §10 rows are the first genuinely new rows since the matrix was written**, after eleven
slices in a row that looked and found what they needed already there. Reading needed nothing either — a
project space is `project.view`, the company space is the line §10 already draws at *See workspace-visible
projects*. Only writing needed rows.

**§20.5's table and its prose disagree about Guests, and `policy.ts` follows the prose.** The table's Guest
column for *Write in a project space* reads "if Member+", which is `work_item.create`'s own answer and would
make the row identical to it in all four columns — a new §10 row that changes nothing. The paragraph
underneath names a specific harm in the present tense with the Guest seat as its whole example ("a company
that hands a contractor a Guest seat … would be surprised to find them rewriting that project's
documentation"). A capped Guest is also the reading consistent with §10's Guest column being "a cap, not a
shorthand" since slice 2, and it is the conservative half of the disagreement. `policy.test.ts` asserts it
directly, so it cannot be reversed silently. **Worth confirming against §20.5 before a pilot (§18-7)** — it
is one line either way.

**Eight events, and the two that project into an item's feed are the exception proving the rule.** §20.6:
activity is per work item, and a page is not one — "its history is its revision list, which is a better
surface for a document than a feed of lines". `wiki_page.linked` and `.unlinked` are the two whose subject
genuinely *is* the item. `wiki_page.updated` is the one wiki event that is **not audited**, which is
`work_item.moved`'s call from slice 6: "a log with a row per save is a log nobody reads when it matters".

**`NotifyDraft` gained a subject union, and that is the only built code §20 said this slice would touch.**
It carried a bare `workItemId: string` because until now every notification was about an item; a page
mention has no item. `NotifySubject` is a union so the compiler finds every construction site — it turned
all thirty existing entries into the `work_item` branch mechanically, which is the property the registry was
built for. §20.16-4 asks that it "stays a union that can gain members", so §19.3's chat message costs an
entry rather than a refactor. The **inbox query's inner join on `work_item` became a left join** in the same
change: left as it was, every page mention would have been written, delivered and invisible.

**Mentions ride the existing `mention` kind and only the ones a revision newly adds.** The general §7.8 rule
would re-notify everybody named in a handbook page every time somebody fixed a typo in it, which is exactly
what §7.8 says teaches a team to filter the product's mail. `saveWikiPage` diffs against the previous body,
which the conditional update has just proved was current.

**§20.9's sweeper is built, and slice 9's gap is closed.** Enumeration crosses workspaces on
`DATABASE_URL_OPERATOR` — `SELECT`-only at the role level, so it *cannot* delete anything — and every delete
goes through `withActor` in the uploader's own scope, which is slice 9's split exactly. **The bytes go
before the row**: the other order leaves an object nothing references and no record it exists, which is the
leak being swept; this order can leave a `pending` row nothing renders, which the next pass collects. A cron
job rather than the outbox's interval, and the reason is a latency budget rather than consistency: an
abandoned upload occupying storage for another fifty-nine minutes costs a fraction of a cent.

**The `ObjectStore` port gained its one non-signature method.** `deleteObject` moves no bytes and its caller
is the worker rather than a request, so there is no browser to hand a URL to — signing a delete for a
background job to fetch would be an extra round trip and a short-lived destructive credential in a log.

**A `#[page]` token is not a `wiki_page_link` row, and the two are different edges.** A page-to-page
reference resolves at render, the way a mention does. `wiki_page_link` is page-to-work-item, which has an
author and a reader on the item side. What *does* create a link is an `ENG-142` in a body: writing one links
the page to the item it names, so the item's Pages panel fills in for free. Removing the sentence does
**not** unlink — a link somebody made deliberately from the item's own panel should not be undone by an edit
to a paragraph, so detaching stays an explicit act.

**§13's oldest gap is closed, in four places at once.** Open since slice 8 — "a Khmer comment in an English
workspace inherits `lang="en"` and clips its diacritics, and the same is true of item titles, descriptions
and project names". §20.10 asked for all four together "because fixing it in one place and not the others is
how one gap becomes four", so page bodies, comment bodies, item titles/descriptions and project names all
now carry a content-derived `lang`. `hasKhmer` is the detector and it is the *same* one `searchRoute` uses,
so text that searches as Khmer also renders as Khmer.

**Three things §20 assumed about the code turned out not to be true**, and each is recorded where it bites:

- **§20.3.6's "recovery screen that already exists for items" does not exist.** §4 promises a 30-day window
  and no slice built a surface for it. The restore list therefore lives at the foot of its own space
  (`deleted-pages.tsx`), which is where somebody looking for a page they deleted goes. A workspace-wide
  recovery screen should absorb it rather than reimplement it.
- **§20.4's `wiki_space_project_key` means a test wanting two project spaces needs two projects.** Obvious
  in hindsight and not in the fixture that first tried it.
- **A revision's `ON DELETE RESTRICT` reports `23001`, not `23503`.** The harness already recorded that
  distinction for slice 11's cycle key: "23503 is *that row does not exist*, 23001 is *that row exists and
  something still needs it*".

**Adding a section to `SEARCH_SECTIONS` darkened the whole command palette, and the failure named the
wrong thing.** `pages` was added to the section list, to `src/lib/search.ts`, to the service and to both
catalogues — and **not** to `api/internal/search`'s response payload. The client reads
`shown.pages.length`; an absent key is `undefined`; the TypeError took every section down with it, so the
e2e failure read "cannot find the work item *Replace the intake filter*" in a spec that has nothing to do
with the wiki. `/search` kept working the whole time, because it calls the service directly and never
crosses that boundary — which is exactly why nothing pointed at the route handler. Two fixes, and the
second is the general one: the route returns `pages`, **and** the palette now merges its payload over
`EMPTY` rather than trusting it whole, so a section a bundle has never heard of costs it nothing. That is
also the honest shape for a rolling deploy, where yesterday's client talks to today's server.

**Four things the e2e spec learned, all of them scars this repo had already written down once.**
Playwright labels are matched at their **start** and never end-anchored — §12's field shell appends a
required marker, so `/^title$/` matches nothing (the password-reset section says so, and it still cost three
timeouts). A test must **read an identifier off the screen rather than assume it**: `ENG-1` is the plan's
running example and "Field Ops" derives `FO`, so an assertion looking for a link named ENG-1 passed on the
*body text* while the link row was never created. A URL assertion has to be **anchored on the destination**,
because `/wiki/company/new` matches `[^/]+/[^/]+$` as happily as a page does. And slice 8's race is still
live: navigate only after the mutation has landed — here the signal is not the button re-enabling but the
button **disappearing**, because deleting a page makes its own reader 404 in place.

**Both sweeps now walk the wiki, and neither had ever walked `/notes` either.** `responsive.spec.ts` and
`a11y.spec.ts` gained the space list, the space home, the new-page form and the notes screen — slice 17 added
a route without adding it to either sweep, and slice 18 found that out by doing the same thing. The wiki's
own screens are reached by clicking through from `/wiki` rather than constructed, because a space's slug is
derived at signup. Both sweeps also gained `test.setTimeout(120_000)`: they walk twenty-six screens now, and
at the 30s default the run began timing out on whichever navigation happened to cross the line —
`/settings/labels` on one run, which has nothing to do with the wiki. A per-screen assertion still fails fast
and names its own screen; what was raised is the ceiling on the walk.

**`The destination stream closed early` still appears in the server log during `wiki.spec.ts`, and the specs
pass.** It is slice 8's signature — a `page.goto` overlapping a server action's revalidation — and here it
follows a create whose redirect the spec has already awaited. Worth knowing rather than worth chasing: if the
wiki specs ever flake, this is the thread, and the fix is slice 8's rather than a retry count.

## Ownership and verification, and the badge that has to be able to go away

Slice 19, the first of §21's four and the flagship of that section. `src/lib/wiki.ts` (the verification
half), `src/server/db/schema/wiki.ts`, migrations `0033`/`0034`, `src/server/queries/wiki.ts`,
`src/server/services/wiki.ts`, the three registry entries, the digest's third section, the components
`verification-badge.tsx`, `verification-panel.tsx`, `all-pages-view.tsx` and `space-verification-form.tsx`,
and the route under `wiki/[spaceSlug]/pages/`.

**§20.15 named the first year's risk and slice 19 answers the second year's.** "A wiki nobody writes in" was
answered by the note as an on-ramp; the opposite failure is worse — *a wiki everybody writes in and nobody can
trust*, where the onboarding page describes a process that changed in March and the new hire follows it
anyway. Staleness does not announce itself: a wrong page and a right page look identical, which is why the
answer cannot be a convention and has to be data.

**A page's verification state is derived from two columns and today, and there is no `status` column** —
slice 11's call for a cycle and slice 13's for availability, and it is stronger here than in either. A cycle
that reads as active a day late is cosmetic; a page that reads as verified for a year after it lapsed is the
product vouching for a document nobody has read. `verificationStatus` in `src/lib/wiki.ts` is the one place
the comparison happens, and `today` is always the **workspace's** (§17-13).

**Editing a verified page clears the verification, and it is the only automatic transition in the feature.**
Without it the whole thing is decoration: a badge that survives the edit that invalidated it is a false claim
carrying the product's authority. `saveWikiPage` clears all three columns in the statement it was already
running — unconditionally rather than behind an `if`, because a branch would only be a way for the two paths
to differ — and emits `wiki_page.unverified` **only when there was one to lose**, since a row per save of a
never-verified page is `wiki_page.updated`'s own reason for not being audited, reintroduced through the side
door. The writer is told on the editor, where it happened.

**Verifying is conditional on the revision the verifier read, and that is the sharpest instance of §20.3.3
in the product.** A stale *save* refuses because merging prose destroys work; a stale *verification* refuses
because it would attach somebody's name, permanently and in the audit log, to words they never saw. Same
single statement — `where revision_no = $base`, with `returning` as the proof — because there is no second
correct answer. **Un-verifying is deliberately not conditional**: saying "I no longer vouch for this" is safe
whatever the body has become, and refusing it would ask somebody to re-read a page in order to stop standing
behind it.

**Two thresholds, and the contrast between them is the rule.** `VERIFICATION_WARNING_DAYS` is seven
**working** days — the amber badge, aimed at the one person who has to act, counted in the unit the product
measures every other deadline in. `VERIFICATION_HORIZON_DAYS` is thirty **calendar** days — the All-pages
filter, used by somebody planning a month of review work. Working days needed §9's fifth SQL function,
`working_days_ahead` in 0034, built on `is_working_day` exactly as `stale_before` is and **asked once per
screen rather than once per row**: per row it would be a `generate_series` and a holiday probe per page, on
the one surface that draws five hundred of them. **The `N` is the constant and the resolved date is a fetch
option**, which is slice 9's split for the digest's horizon and slice 13's for staleness.

**Nobody is notified page by page, and that is the decision worth defending.** §7.8's general rule would put
an inbox row under every expiring page, which is a stream that teaches people to ignore the bell — §7.8's own
warning, applied to documentation. Instead the evening digest gains **one section**, riding the existing
`digest` kind so it inherits the preference row, the working-evening rule and the read-as-that-member scope.
**No sixth notification kind**; §6-6's five stay five. The section is placed last in the email on purpose: a
page needing review is a fortnight's notice, and putting it above somebody's overdue work would be the product
talking about documentation while their own work is late.

**`digestFor`'s early return had to move, and that is the change most likely to be undone by accident.**
It returned as soon as the work query came back empty — correct until slice 19, and the line that would have
silently swallowed this whole feature, because the person who most needs the reminder is often the policy
owner with no due work at all. §21.14's check 2 is exactly that case and `digest.test.ts` asserts it.
**Already-lapsed pages stay in the window** rather than dropping out of it, for §17-19's reason: a digest that
went quiet the morning after a lapse would go quiet exactly when the page most needs somebody to look at it.

**Three events, all `audit` only, and they are audited for a reason the rest of the log does not have.** A
verification changes **no body**, so it writes no revision — the history a page carries for every other kind of
change is structurally unable to record it, and "who said this was accurate, and when" would be the one thing
that happened to a page that nothing remembers. `wiki_page.unverified` carries a `reason` (`edited` or
`cleared`) because six months later "did they mean to stop vouching for this" is the question, and without it
the automatic transition and the deliberate one look identical.

**No §10 row — the thirteenth time that decision has gone the same way**, after labels, attachments,
notifications, custom fields, cycles, saved views, availability, search, the holiday calendar, settings,
password reset and notes. Owning, verifying and un-verifying are all *writing in that space*, which §20.5's
two rows already govern. **Tags are `label`, not a second vocabulary** (§21.3), so `wiki_page_label` is
`work_item_label` with one column renamed — one join table against a second settings screen, a second colour
set and a second thing to explain to §2.3's owner.

**Offboarding is the asymmetry stated once more.** Notes are destroyed, pages stay attributed, and ownership
is **released** — the column is nulled and the page appears under *owned by nobody* the next morning.
`releasePagesOf` runs inside `removeMember`'s own transaction, and unlike `deleteNotesOf` beside it **this
one is audited, one row per page**: an owner asking six months later why the leave policy has no owner needs
the answer, and a summary row would name the member without naming the pages. §7.12's dialog says the count
before the click, which is where a fact somebody can still act on belongs.

**One thing §21.3 says that the schema cannot mean literally, resolved and recorded rather than papered
over.** "The space carries a default … applied at page creation and overridable per page" — but a new page has
never been verified, and 0034's CHECK refuses an expiry with no verification, because that is a lapse date for
an assertion nobody made. So the space default is resolved **at verification**, not copied at creation: the
period select is pre-set to it, and a copy taken at creation would have gone stale the moment somebody changed
the space default, which is the opposite of "so a policy space does not depend on somebody remembering on
every page". It is one line either way and **worth confirming against §21.3 before a pilot** (§18-7), like
slice 18's Guest reading.

**The e2e run found two defects that nothing else could have, and both are the shape that recurs.**

- **`column reference "id" is ambiguous`, on every page render.** Inside a `sql` template in the
  *select-fields* position drizzle emits a column **unqualified** — `${workspaceMember.id}` becomes a bare
  `"id"` — so a correlated subquery joining `workspace_member` to `app_user`, both of which have an `id`,
  fails at runtime. It typechecks, the tenancy suite never calls that shape, and the first thing that sees it
  is a browser. Every such subquery now uses explicit table aliases, and the ones correlating to the *outer*
  row name `wiki_page.id` literally rather than interpolating it — inside a subquery with three relations of
  its own, the interpolated form resolves against the inner tables. Worth knowing before writing the next
  correlated subquery in a `.select({...})`. (The table is `app_user`; `user` is only the drizzle export's
  name, which is its own small trap.)
- **A submit button named the same as a field in its own form.** "Take this on" carried
  `name="ownerMemberId"` inside a form that already had a `<select name="ownerMemberId">`, and `formData.get`
  returns the **first** value — so the control did the opposite of its label, silently, with the page
  reloading as though it had worked. It is its own form now. A submit button's `name`/`value` is form data
  like any other, and the general rule is that a button must not share a name with a field beside it.

**Both sweeps gained the new route with the slice rather than after it**, which is the lesson slices 17 and 18
each learned by adding a route and finding out later. The All-pages view is also the widest table in the
product, so it is the screen most likely to be the one that scrolls the document sideways at 390px.

**One assertion scar worth keeping.** `getByText(/Policy Owner/)` matched three elements, because the owner
picker lists every member as an `<option>` — and one of the three would have matched whether or not the page
was ever verified. The assertion is on the *sentence* now. **An assertion that a control's own options can
satisfy is not testing the thing it names**, which is the same shape slice 15 recorded for the accent picker.

## Backlinks, the two kinds of edge, and the menu that may only type

Slice 20, the second of §21's four. `src/lib/documents.ts` (the grammar half), `src/lib/editor-commands.ts`,
`src/server/db/schema/wiki.ts`, migrations `0035`/`0036`, `fetchBacklinks` and the excerpt in
`src/server/queries/wiki.ts`, `syncPageRefs` and `setPageIcon` in `src/server/services/wiki.ts`, the
components `insert-menu.tsx`, `page-toc.tsx` and `page-backlinks.tsx`, and the callout/toggle/to-do half of
`src/components/ui/document-body.tsx`.

**`syncPageRefs` sits directly beneath `syncOutboundLinks` and does the opposite thing, and reading the two
together is the whole of §21.4.** `wiki_page_link` is **authored** — somebody connected a page to a work
item, it has an author, it emits an event, and `syncOutboundLinks` therefore computes what a revision
*added* and inserts only those. `wiki_page_ref` is **derived** — it is a projection of the body, so
`syncPageRefs` computes the body's *whole* set and makes the table equal it. Merging them would mean either
an edit silently detaching a link somebody made on purpose, or a reference outliving the paragraph that made
it, and §20.0 argued both once already. The e2e spec puts both edges in **one body** and removes both
sentences in **one edit**: the derived one goes, the authored one stays. That is §21.13's definition of done
for this slice, and it is one test rather than two because the distinction only exists in contrast.

**Delete-then-insert rather than a diff**, which is what keeps §21.15's mitigation true: the table is a
projection, so a function that can only *set* the answer is what makes "if it is ever wrong it can be
regenerated from the bodies" a property rather than a hope. It is also why there is no `created_by_member_id`
and no `created_at` on the table — nobody *made* these rows, a save computed them, and a date on one would
be a fact about a rebuild.

**A target that does not exist writes nothing, and the filter is what makes that true.** `parsePageIds`
returns whatever uuids somebody typed, so a hand-typed token would otherwise be an insert that fails and
takes the writer's save down with it. Filtering against `wiki_page` first — in the same transaction, under
RLS — means a body may reference a hard-deleted page and still save. It renders as §20.7's absence, which is
what slice 17 chose for exactly this case.

**No §10 check on the reference target, and that is the opposite call from `syncOutboundLinks` on purpose.**
A reference is text in a body: refusing to record one would not stop the writer typing it, and the *reader*
is filtered instead — `getPage` resolves `readableSpaceIds` before `fetchBacklinks` is built, because a
backlink is the one place a page in a space somebody cannot read would otherwise announce its own title on a
page they can. Linking a *work item* is different and does ask §10, because that writes a row into the
item's own panel.

**No §10 row — the fourteenth and fifteenth times that decision has gone the same way**, after labels,
attachments, notifications, custom fields, cycles, saved views, availability, search, the holiday calendar,
settings, password reset, notes and slice 19's verification. Writing a reference and setting an icon are both
*writing in that space*, which §20.5's two rows already govern.

**A soft-deleted page keeps its edges and a hard-deleted one does not**, and the pair is asserted directly.
§20.3.6 gives deletion a 30-day window, so a restore has to restore the backlinks with it rather than needing
every referring page re-saved; a hard delete takes them, because an edge to a page that no longer exists is
not a record of anything. That is `wiki_page_link`'s call and the opposite of `note`'s pin, which survives its
item because the note is still the person's.

### The grammar §21.5 adds, and the one rule the `/` menu lives under

**A menu item may only insert text a person could have typed.** §21.15 puts that in the code review rather
than in a test — "the day one of them cannot, block identity has arrived by the back door" — and
`editor-commands.ts` is written against it: every entry is a string of Markdown and a caret offset, with no
node, no id and no placeholder object. The half a test *can* hold is held: `editor-commands.test.ts` parses
every entry back through `documents.ts` and asserts it becomes the block it promises, which is what catches
the menu and the grammar drifting apart.

**Three grammar rules landed with it**, and two of them exist because the menu offers them:

- **A callout is a tagged blockquote, and a toggle is a callout with a `-`.** §21.2 names them as two rules;
  they are built as **one syntax family with a `folded` flag**, because a disclosure and a highlighted aside
  differ only in whether the body starts open, and two syntaxes would be two things to teach. The syntax is
  Obsidian's and GitHub's — the one convention that already exists for both — and it is an *extension of the
  blockquote*, so stripping the rule degrades every callout into the quote it is written as. An unrecognised
  tone is not an error: `> [!tip]` stays a quote whose first line reads `[!tip]`, which is the grammar's
  standing rule that everything not on the list renders as the text it was.
- **A to-do is `- [ ]` / `- [x]`, and `checked` is `boolean | null`.** `false` and `null` are different facts —
  an unticked box and a bullet that is not a to-do at all — and the renderer draws them differently. Without
  this rule the menu's *to-do* entry would have written text that renders as a bullet with a literal `[ ]` in
  it, which is the menu promising something the reader does not get. §21.2's inventory says to-dos were
  already built; they were not, and the `/` menu is what made that visible.
- **Every heading carries an anchor, assigned in a post-pass.** De-duplication is document-wide and
  `parseBlocks` is recursive, so a counter threaded through the recursion would have to be threaded through
  quotes, callouts and list items too — and the first branch that forgot it would produce two headings with
  one id, which reads as a contents list whose second entry jumps to the first. §21.5 names the failure
  rather than designing around it: renaming a heading breaks a link to it, which is the bargain every
  Markdown document makes and is visible and recoverable, where an id embedded in the body is where a text
  format stops being one.

**`<details>` rather than a `useState`, and that is what keeps `DocumentBody` server-renderable.** It carries
no `'use client'` on purpose (§20.7), so a toggle built out of state would have forced the whole renderer
into every page's bundle to make one triangle work. The platform's disclosure gives the open/closed state,
the keyboard behaviour, the ARIA and — the part that matters most in a document — find-in-page reaching
inside a closed one. Same call `dialog.tsx` makes: the alternative is not our own code but the browser's.

**The `/` menu is the mention picker's shape, not the palette's.** §21.5 calls it "`command-palette.tsx`'s
contract, third use", and it is the *contract* that is reused — arrows, Home/End, Enter, wrapping, and the
ARIA combobox pattern announced on the **textarea** — not the modal the palette lives in. Focus never leaves
the field, so `InsertMenu` holds no state and takes none; and its options use `onMouseDown` with
`preventDefault` rather than `onClick`, because a click blurs the textarea first and a blurred textarea has
no selection to insert into.

**A slash only opens the menu at the start of a line**, which is the difference from `@` and the whole of
what stops the feature ruining ordinary writing: `and/or`, a date, a fraction and a URL all carry a slash
mid-line. Every entry inserts a *block*, so the start of a line is also the only place any of them would be
correct. `applyInsertion` adds one character nobody typed — a newline, when the caret is not already at the
start of a line — because the parser is line-oriented and `Some text## Heading` is one paragraph, so without
it the writer watches their heading fail to appear.

**`⌘B` and `⌘I` toggle rather than only wrap**, because a shortcut that can only add is one people press once
by accident and then undo by hand; both the inside and the outside of a selection are recognised, since the
common case is somebody double-clicking the word rather than the asterisks. **Alt is namespaced away from
every binding**, which is `shortcuts.ts`'s rule from slice 14 and matters here for the same reason: AltGr
produces characters on a Khmer layout.

**The live preview is beside the field on a wide screen and a toggle below it**, and both panes are always
mounted with CSS deciding which is visible. That removed the hidden input the form used to need — the
textarea is never unmounted, so its value reaches the server on its own and its caret survives a trip through
the preview. §21.5 asks for "a live preview beside the textarea", and *beside* is what a wide screen gets;
at 390px there is no beside, so §15-6 gets the toggle.

**The hover preview is a `title` attribute, not a floating card.** §21.4 asks for "the title and the first
line of the body, resolved from a row the page has already loaded", and the excerpt rides `fetchPageRefs`,
which the render already ran. A card would need `DocumentBody` to become a client component to decorate an
inline word; the platform's tooltip is keyboard-reachable, screen-reader-read, positioned by the browser and
free at 390px. It is `title` and never `aria-label`, because a label would *replace* the link's name and a
screen reader would announce the excerpt instead of the page. The excerpt is read **through the parser**, so
a body opening `# Shipping` previews as *Shipping* — the property the e2e assertion pins, because it is what
a substring implementation would silently break.

**The page icon is an emoji in a `text` column**, and the two-place enforcement is stated rather than blurred:
`normalizePageIcon` counts **graphemes** with `Intl.Segmenter` and is exact, and 0036's CHECK is a *floor* —
no whitespace, at most 16 code points — because Postgres has no grapheme segmentation and adding an extension
to bound one decorative column would be a deployment dependency taken for a cosmetic field. It **truncates
rather than refuses**, unlike every other cap in the wiki: a title over its cap loses meaning, and somebody
who pastes two emoji meant the first one. `setPageIcon` deliberately does not touch `revision_no` or clear
§21.3's verification — an icon is not the body.

**The icon has its own action, and the reason is that `saveWikiPage` would have given it two behaviours it
must not have.** Folded into the body's save it would ride the conditional update — so changing an icon while
a colleague was typing would be refused as a stale save (§20.3.3), a refusal with real weight spent on a
decoration — and it would clear §21.3's verification, which every body save does unconditionally. A verified
page whose icon changed is still a page somebody read and vouched for. `setPageIcon` therefore touches
neither `revision_no` nor the verification columns, and the form is its own, in the right rail beside the
owner picker rather than in the header: a control next to the title puts an editable field in the middle of
what a reader came to read.

**A text input rather than an emoji picker.** A picker is a grid of two thousand images, a search box needing
a name per emoji per language, and a dependency — for a field every keyboard on earth can already fill
(`⌘⌃Space`, `Win+.`, a long-press on a phone). §12's inventory has no picker, and inventing one here is how a
design system acquires a component nobody else can use.

**Two things the e2e run found, and both are scars this repo had already written down.**

- **`.first()` on a page-wide locator matched the sidebar, not the body.** The space sidebar lists every page
  in the space, so `getByRole('link', { name: 'Deployment' })` resolved to the *navigation* entry — an
  assertion that would have passed whether or not the token in the body rendered at all. It is scoped to the
  `article` now. Same shape slice 15 recorded for the accent picker and slice 19 for the owner picker: **an
  assertion a control beside the thing can satisfy is not testing the thing it names.**
- **A referenced page with no body correctly has no preview**, which is not a defect and did read as one. The
  fixture writes a body now, rather than the assertion being loosened to accept an empty `title`.

**Both sweeps gained the reader and the editor, which neither had ever walked** — they need a page to exist,
and until this slice nothing in either sweep created one. The editor is now the screen most likely to fail
the 390px assertion: it has two panes side by side and an absolutely positioned `/` menu, and slice 16's
sweep found that an absolutely positioned descendant of a `static` parent resolves against the initial
containing block and grows the *document*. Both sweeps assert with the menu **open**, which is the only state
worth asserting.

## Comments on pages, and the notification nobody was receiving

Slice 21, the third of §21's four. `src/server/db/schema/comment.ts`, migrations `0037`/`0038`, the
`CommentSubject` union in `src/server/events/types.ts`, `notifySubjectOf` in `registry.ts`,
`canCommentInSpace`/`canModerateSpace`/`checkSpaceComment` in `src/server/services/space-access.ts`,
`fetchComments`'s subject in `src/server/queries/comments.ts`, `pageCommentThreadIn`/`postPageComment` in
`src/server/services/comments.ts`, `src/components/work-item/thread-context.ts`, the two actions at the foot
of `wiki/actions.ts`, and the thread on the page reader.

**It is `comment` rows with a subject union, and §21.6 answers §20.16's open question by pointing at a shape
the product already had.** `attachment` widened this way in slice 18 and `notification` in §20.6; this is the
third. Two NOT NULLs come off the second-busiest table in the schema and `comment_one_subject` replaces
them — **refusing more than they did, because it also refuses a row belonging to both**. The companion
`comment_project_with_item` keeps the denormalized project present exactly when the item is, which is 0032's
constraint for `attachment.project_id` applied one slice later to the same problem.

**Three service functions were shared and three were not, and the split is the slice.** The comment machinery
— the parse, the mention rows, the tombstone, the hydration, the picker's contract — has one implementation.
The *subject* machinery has two: an item's permission question is asked of its project and a page's of its
space (§20.5), an item has assignees where a page has an owner and a thread, and an item's comments carry
files where a page's do not. `membersPassing` is the generalisation that made the first half possible —
`visibleMembers` and the new `spaceReaders` are now two predicates over one query.

**Who may comment is the one genuinely new decision, and it needed no §10 row — the sixteenth time.** §21.6:
"anyone who can read the space may comment in it, which for a project space includes a Guest who can see the
project — deliberately, because the whole value of a comment on documentation comes from the person who found
it wrong, and that is disproportionately the newest person in the room." So it is `canReadSpace` plus one
clause, and **that clause is a view-as refusal written by hand**: `can()` denies every `mutation: true` action
while `readOnly` is set, and there is no action here for it to deny. A rule that is not a §10 action does not
reach the module that enforces §7.13, so `canCommentInSpace` states it. Deleting somebody else's is
`canModerateSpace` — `comment.delete_others` for a project space, `wiki.write_company_space` for the one
container with no project to ask about. Both rows already existed.

**`CommentSubject` is a union so the compiler finds every construction site**, and it did that job the moment
the schema widened: three sites inside `deleteComment` failed to compile before anything else was touched.
`comment.created` also renamed `assigneeIds` to `subscriberIds`, because a page has no assignees — its
standing interest is **its owner (§21.3) plus everybody who has already written in the thread**. That second
half is what makes it a conversation rather than a suggestion box: §21.13 asks for a question asked *and
answered*, and without it the asker only ever hears back if the answerer remembers to type their name.

**Slice 21 found a live slice-18 defect that had been silently discarding notifications, and it is the most
instructive thing here.** `deliverToOne` opened with `if (message.workItemId === null) return;` under a
comment reading "every notifying event is about a work item — the registry's `notify` drafts all carry one".
§20.6 made that false one slice earlier: a mention in a page body writes an outbox row with a null
`work_item_id`. `loadContext`'s **inner join** on `work_item` then matched nothing, the function returned
null, and `deliverNotification` returned **without marking the message delivered** — so the row stayed at the
head of `drainOutbox`'s partial index and was re-enqueued every five seconds, for ever, while nobody's inbox
ever showed it. Not a lost notification but a stuck row, invisible unless somebody read the outbox by hand.

The inbox query had already been converted to left joins for exactly this reason and says so in its own
comment; the worker was missed. **Widening a union is not done until every reader of the narrow field has
been visited, and the compiler cannot find them, because a nullable column type-checks either way.** It is
the third time this repo has had to chase a subject union through a join — §20.6's `notification` inner join,
slice 18's `SEARCH_SECTIONS` payload, this — and the pattern is the same each time. `loadContext` now left-joins
both branches and reconstructs the subject; a context that will not resolve marks the message delivered with a
reason rather than returning, because it will not resolve on the tenth attempt either.

**Three more places assumed a page had no thread, and all three are now the same sentence.** 0032's
`notification_comment_with_item` CHECK ("a comment deep-link only makes sense on the item branch") is dropped
in 0038 — a page comment's mention is exactly the row it refused. `subjectHref` in the inbox dropped the
`#comment-…` anchor on the page branch. And **the anchor did not exist anywhere**: every `#comment-<id>` deep
link the product has ever sent pointed at nothing, because no comment carried that `id`. `comment-thread.tsx`
now puts it on the `<li>`.

**A missing message key surfaced the moment a page subject was rendered in an inbox for the first time.**
`inbox.subject.page` was absent from *both* catalogues, so `messages.test.ts` passed on parity while
next-intl swallowed a `MISSING_MESSAGE` into the server log — slice 10's `soon` defect and slice 13's `due`
grouping, for the third time. The e2e assertion that caught it was looking for `notification.` and the key
was `inbox.`; it matches `/\b(inbox|notification)\.[a-z]/i` now.

**`ComposerContext` was not widened, and `thread-context.ts` exists because of a boundary rule.** The five
attachment components take an item-shaped context and a page comment has no files, so widening it would have
made five components narrow a subject they can do nothing with. What the thread needs instead is
`ThreadContext` — a subject union plus **the two actions as props**, which is `PageIconForm`'s own precedent
and which removed slice 8's hard import of the work-item route from a component the wiki now renders.

Those types and `filesContextOf` live in their own module with **no `'use client'` directive**, and the reason
is worth knowing before splitting another component: a client module's *types* cross the server boundary
freely and its **functions do not**. `comment-thread.tsx` is a server component, and calling `filesContextOf`
while it lived in the composer failed at render with *"Attempted to call filesContextOf() from the server but
filesContextOf is on the client"* — a runtime error on a page that type-checks and that no unit test could
reach.

**Paste-to-upload is absent rather than disabled on a page, and the gap is named rather than hidden.** §21.6
lists "attachments in a comment" among what a page thread inherits free, and it is the one thing that did not
come free: `createUploadTicket` takes a `workItemId` and has **no page branch at all**, so §20.9's schema
(`attachment.wiki_page_id`, the download route, the sweeper) has never had anything to create a row. That is a
**slice-18 gap** — a page cannot hold an image either — and closing it is the ticket, the route and 0032's
`attachment_comment_with_item` CHECK, which is a slice about page *files* rather than page *comments*.
`useUploads` takes `workItemId: string | null` so a hook stays unconditional, and refuses before the round
trip.

**`getPage` takes `thread: boolean` with no default, and that is not tidiness.** The editor calls `getPage`
too and renders no thread; fetching one there added three queries to the screen somebody is typing into — and
it was not a theoretical cost. It lengthened the editor's render enough to break `wiki.spec.ts`'s stale-save
test on `mobile-km`, where a `fill` landed before the body arrived and the two texts concatenated into
`my paragraphthe original line`. **That is the fourth time in this repo that adding queries to a page's loader
has exposed a latent race** (slice 8's two specs, slice 10's `getWorkItem`, slice 20's `getPage`), and the
first where the right answer was to not run them.

**Two e2e traps this file had already recorded, walked into again.** An assertion a control beside the thing
can satisfy is not testing the thing it names: `expect(main).toContainText('Contractor')` after adding a
project member passes whether or not the add succeeded, because the picker's own `<option>` carries that name
— slice 15's accent picker and slice 19's owner picker, a third time. And anchoring on a *positive* before
asserting an absence: `not.toContainText` is satisfied by a page that has not arrived, and the following
`goto` then failed with `net::ERR_ABORTED` on a render still in flight.

**The editor redirects a reader rather than 404ing**, which `edit/page.tsx` states — "`notFound()` would be
wrong here: the page exists and they can see it" — so §21.14-5's "cannot write one" is asserted as *where they
ended up* plus the absence of a Save control, not as a 404.

**No §10 row, no new table, no new §10 question — and the Guest reading is now pinned by a test.** §20.5's
Guest disagreement is still one line either way and still owed a confirmation before the pilot (§18-7), but
reversing it now costs a deliberate edit to `e2e/wiki-comments.spec.ts`, which states the sentence rather than
implying it.

## Templates, the round trip, and a subquery that was counting nothing

Slice 22, the last of §21's four and the last slice the plan specifies. `src/server/transfer/`
(`zip.ts`, `markdown.ts`, `plan.ts`), `src/server/services/wiki-transfer.ts`, migrations `0039`/`0040`,
`setPageTemplate`/`setPageTemplateIn` and `getSpace`'s new options in `src/server/services/wiki.ts`,
`fetchSpaceTemplates`/`fetchSpaceExport` in `src/server/queries/wiki.ts`, the three components
`page-template-form.tsx`, `space-templates.tsx` and `space-transfer.tsx`, `page-print.tsx`, and
`MAX_IMPORT_BYTES` in `src/lib/wiki.ts`.

**§21.7 is one boolean column, and saying so is the whole design.** "A template is an ordinary page with a
flag — living in the space it belongs to and hidden from the tree." There is no `wiki_template` table, no
second editor, no second permission question and no second export path, because "a template that cannot be
read, edited and searched like a page is a second document format with a second set of screens". What the
flag changes is exactly two things: the page leaves the sidebar, and it is offered when somebody creates a
page.

**The two rules that make that coherent are in the database, and they need two different mechanisms.** *A
template is a root page* is a CHECK — hidden from the tree and inside it are contradictory, and a template
nested under the handbook would be an invisible node that `deletePage`'s reparenting, `subtreeIds` and
`buildPageTree` all have to reason about. *Nothing hangs off a template* cannot be a CHECK, because it is a
fact about a **different row**; it is a clause added to 0032's `wiki_page_hierarchy` trigger, which already
had the parent row in hand. A third case needed a second trigger: flagging a page that **already has
children** changes nobody's `parent_id`, so the hierarchy trigger never fires and the CHECK only looks at the
page's own parent. That is the argument every invariant since 0008 has made — a row written by a seed script
or an importer has to be as correct as one the service wrote — and this is the first slice where it stopped
being hypothetical, because **the importer is in the same slice and it is a loop**.

**`fetchSpaceTree` is where the hiding happens, not the sidebar.** That function is also what `createPageIn`
and `movePage` read to compute a depth and a sibling position, and what the parent picker is built from — so
filtering in the one place is what makes a template un-offerable as a parent by a screen that forgot. The same
shape as `fetchPage`'s `includeDeleted` being off by default rather than applied per caller.

**Templates are listed in the All-pages view though they are hidden from the tree**, and the two are not in
tension: the tree is navigation and that view is governance. A template nobody owns is exactly what the
`unowned` filter exists to find, and it is the page whose staleness propagates — every incident report
written from it inherits its headings. The row is badged, so "why is this not in the sidebar" is answered on
screen rather than in a plan.

**The picker is four links, and the version that was not built is the interesting one.** Fetching the
templates *with their bodies* would let a choice fill the textarea with no round trip — and would put fifty
pages of prose in the payload of every "New page" render to use one of them. `MAX_PAGE_BODY_LENGTH` is
200,000 characters, so the worst case is ten megabytes sent to a phone on mobile data (§2.5) to draw four
links. So `fetchSpaceTemplates` selects no body, the links carry an **id**, and
`/wiki/{space}/new?template={id}` is a URL somebody can send a colleague — which §5 asks of every other state
in the product and which a `<select>` could not have been. The form is **keyed on the template id** so
choosing a second one remounts it; without that key React keeps the old body in a controlled textarea, which
is the create screen quietly ignoring the thing just clicked. Seeding `useState` from props is safe *because*
of the key — the distinction `GroupList` recorded in slice 5.

**`setPageTemplate` is its own action, which is `setPageIconAction`'s call from slice 20 with more force.**
Folded into the save it would ride §20.3.3's conditional update — so flagging a template while a colleague was
typing would be refused as a stale save, a refusal with real weight spent on a filing decision — and it would
clear §21.3's verification, which every body save does unconditionally. A verified runbook somebody has now
also marked as a template is still a page somebody read and vouched for.

### Export, import, and a zip written by hand

**§21.8's argument is a sales argument and it is the strongest one in §21**: §18-7's pilot customer will ask
what happens to their handbook if they leave, and *"a folder of Markdown files you can open in any editor"* is
a better answer than any feature in the section. That sets the standard the file format is held to — the files
have to be readable by somebody who has never heard of this product, in either script.

**The zip is ours, and it is the same bargain `sigv4.ts` makes against `@aws-sdk`** — an easier one, because
the format was frozen in 1993 and `node:zlib` already ships the only hard part. The argument specific to this
feature is that an export is the promise a customer will actually test, so it must not be the part that breaks
when a transitive dependency changes a default, which is exactly what §20.7 refused a Markdown library for.
Zip64, encryption and multi-disk are **refused with a named reason rather than mis-parsed**: a reader that
silently returns half an archive is worse than one that says it cannot read this.

Three things in `zip.ts` are load-bearing and will look arbitrary later. **Sizes and the method come from the
central directory, never from the local header** — a streaming writer (every browser, `zip -`) sets bit 3 and
writes zeroes there, and `zip.test.ts` assembles exactly that archive by hand from `node:zlib` so the reader is
checked against something its own writer never produces. The **UTF-8 filename flag is not optional**, because
without it a reader may decode the name as CP437 and a Khmer page becomes accented Latin at the moment
somebody unzips the export they asked for to prove their data is theirs (§21.14's check 4). And the end record
is **scanned backwards**, because a forward scan finds those four bytes inside a stored file that happens to
contain them.

Beyond the unit tests, the archive was unpacked by **Windows' own `Expand-Archive`** — Khmer filename,
deflated entry and all. That is the check `sigv4.test.ts` could not make from inside itself.

**The export says what the screen says**, and that one sentence settles every token fallback. `resolveTokens`
uses `document-body.tsx`'s own: a bare `@` for a member the workspace cannot name, an em dash for a reference
to a page that never existed, a plain title for one that is real but outside this folder. Inventing kinder
fallbacks for the file would make the export disagree with the product about what a document contains.

**A file is a page and a folder is that page's children** — `handbook.md` beside `handbook/`, not
`handbook/index.md`. Both conventions exist; this one has no ambiguity to resolve on the way back in, where
`index.md` needs a rule about a folder holding both an `index.md` and a page called *index*.

**There is deliberately no "strip the wrapping folder" step, and the absence is the decision.** Zipping an
unpacked export wraps it in the folder's name, and detecting the single shared top-level directory would
remove it — but that shape is indistinguishable from `runbooks/deploy.md`, where the directory is a *page*
with a child. No rule over paths can tell them apart, because the difference is in what somebody meant. So a
wrapper becomes an ordinary page, visible and one click from deletion, where a wrong strip silently moves
every page up a level. **A guessed value is worse than an absent one, because nobody goes looking to check
it** — slice 15's holiday rule, applied to a folder.

**Nothing about a person is restored on import, and that is the sharpest refusal in the module.** The front
matter carries an owner and a verifier as *names*, which is right for the human reading the folder and useless
as an instruction: a name is not an id, and the target workspace may not contain that person. Worse than
useless for the verification — §21.3 makes it an attributable claim by a member about a particular revision,
and writing one from a file would forge exactly the attribution the feature exists to make trustworthy. An
imported page arrives **owned by nobody and never verified**, which is the honest starting point and is what
the All-pages view's `unowned` and `unverified` filters exist to find.

**Import creates ordinary pages through `createPageIn`**, so it inherits validation, a free slug, the first
revision, `wiki_page.created`, and the body's links and refs. The template flags are a **second pass inside
the same transaction**, and it cannot be otherwise: flagging a page before its children exist would make every
child violate 0040's trigger, which would abort the whole import rather than skip one file. §7.10's invitation
rule holds throughout — partial success, no rollback, and the result lists what did not land, by path.

**No route handler, and that constraint is §21's own**: its impact table says "§8's five exceptions stay
five". So the archive comes back **base64 inside the action's result** and the browser turns it into a Blob;
the import is a `File` on FormData, with `serverActions.bodySizeLimit` raised to 6mb so it clears
`MAX_IMPORT_BYTES` (5 MiB) with room for multipart overhead. The refusal a person meets is then *ours* — a
sentence naming the limit — rather than Next's 413, which a form cannot explain. Raising that limit is a real
cost, applied to every action in the product, and is the reason the number is not larger.

**Export is audited, and it is the one audited read in the product.** Everything else in the event union is a
change to the company's data; an export changes nothing and takes every word the company has written down out
of the building. "Who took a copy of the handbook, and when" is what §18-11 built the log to answer, and
`workspace.view_as_started` is the precedent — also not a mutation, also audited. It is emphatically not a
claim to have prevented anything: anyone who can read a space can read its pages one at a time and paste them
somewhere. What the row buys is that the *convenient* path leaves a trace. **Whoever can read a space may
export it** — §21.8 left that open and both plans now record the answer — and it is **refused inside a view-as
session**, a rule written by hand because `can()` denies mutations and there is no §10 action here for it to
deny, exactly as `canCommentInSpace` had to state its own in slice 21.

**The per-page PDF is `window.print()` and the stylesheet slice 13 wrote** (§17-26), which is why the reader's
sidebar, right rail and comment thread gained `data-print="hide"`. §21.8 names this explicitly, and a page
body is the one screen where all three of §17-26's rules matter at once: it is long-form text, often Khmer,
read by people who print policies.

### What the tests found

**`fetchSpaces` had been reporting zero pages for every space in the product since slice 18, and the e2e run
is what noticed.** The wiki's space list has always said "No pages". The cause is slice 19's finding wearing a
quieter face: the page count is a correlated subquery that interpolated drizzle columns —
`${wikiPage.spaceId} = ${wikiSpace.id}` — and **that query has no join**, so drizzle emitted both
unqualified. Inside a subquery over `wiki_page` the inner scope then wins for both: Postgres read the
predicate as `wiki_page.space_id = wiki_page.id`, planned it as an uncorrelated InitPlan, and matched nothing.

Slice 19's version of this **threw** (`column reference "id" is ambiguous`). This one returns a plausible
number, which is why it survived four slices and a review each time. It typechecks, no unit test can see it,
and the tenancy suite never called the shape.

**The rule is about joins, and getting that precise mattered — the first version of this fix was wrong.**
"drizzle emits a column unqualified in a select-fields `sql` template" is what slice 19 wrote and it is only
half true: drizzle qualifies when the statement has **more than one table**. On that misreading the three
correlated counts on §7.12's offboarding dialog (`noteCount`, `pageCount`, `ownedPageCount`) were "fixed" too
— and they had never been broken, because `listMembers` joins `app_user`. What settled it was reverting the
change and watching the new tests still pass, and drizzle's own `.toSQL()` on both shapes side by side:

```
WITH JOIN   : … where note.owner_member_id = "workspace_member"."id" …
WITHOUT JOIN: … where note.owner_member_id = "id" …
```

So: an interpolated outer column inside a correlated subquery is safe wherever the outer query **joins**, and
safe wherever the inner tables have **no column of that name** to shadow it (which is why
`fetchSpacePages`'s subqueries are fine, as slice 19 noted). It is a trap only where neither holds. Naming
the outer table literally and aliasing the inner one is correct in every case and is what `fetchSpaces` now
does — but it is not a licence to rewrite queries that join, and it costs alias-safety, which is why
`ownedPageCountFor` kept its parameter.

**Those three counts had no test at all, and now they do.** That is the part of the false alarm worth
keeping: `listMembers` was split into `listMembersIn(tx)` — slice 14's `listProjectsIn` move — so
`__tenancy__/member-counts.test.ts` can assert the **numbers** against real Postgres. Numbers rather than
SQL, because a broken correlation returns a plausible value rather than an error, and §7.12 makes these a
decision somebody acts on before a click they cannot undo.

**The planner's unit tests found a real defect in code written an hour earlier**, which is the argument for
having moved `planImport` out of the service into `src/server/transfer/plan.ts`: the interesting half of an
import — a zip written on Windows, wrapped in its own folder, four levels deep, with a `.DS_Store` in it — is
a unit test rather than a fixture with a Postgres behind it. The wrapper-stripping heuristic above is what
they caught.

**Two e2e locator scars, both already in this file and both walked into again.** An assertion anchored on an
accessible name has to account for the **whole** name — the space link reads "Archive No pages", so
`/^Archive$/` matches nothing — and that name is **translated**, so an English regex passes on `en` and fails
on the two Khmer projects. The count is asserted by `href` now, and the digit is safe in both because §13 pins
Latin digits. Chasing that is what surfaced the `fetchSpaces` defect, and the assertion is now what would
catch it again.

**`a11y.spec.ts`'s "two overlays" test failed twice in the full run and is still not this slice's.** It is the
flake recorded above, with the same cold/warm tell: it failed against the freshly built server and passed in
three isolated re-runs afterwards at 2.6s each, and `km` passed in the same run in which `en` failed. Nothing
in slice 22 renders on My Work or in the shortcut path.

**One thing §21.8 asks for that is not built, and it is named rather than hidden.** The export carries no
attachments, because a page cannot hold one: `createUploadTicket` takes a `workItemId` and has no page branch,
which is the **slice-18 gap** §21.16 already records. §20.9 landed the schema, the download route and the
sweeper; the day the ticket lands, `fileFor` is where the files go — and the base64-through-an-action decision
above is the line to revisit, because a 25 MiB attachment is not a Markdown file.

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

**The logo was the exception, and on 2026-09-04 the question was answered.** Colours and fonts come from
that pack; the mark used to be excluded from it. The standing rule was to use the **parent Unify logo** and
to ask rather than substitute, because all three logomarks under `02_Logos/` are a hexagon around a
lightning bolt and the bolt means EV charging. The parent file is **still not supplied**, the question was
put, and the instruction is to ship the UnifyCharge mark meanwhile.

So: the app icon set is the **primary logomark**, rasterised into `public/icons/` and wired through
`src/lib/app-icons.ts` — favicon, manifest icons, maskable icons and the iOS touch icon. It is kept in the
brand's own `#28A6DF` rather than recoloured to the palette's Sky `#54A6DB`: a logomark in a *third* blue
is neither mark. **Nothing else in the product carries a mark yet** — there is no logo in the workspace
header, on the sign-in page, in email or in any empty state — and when the parent Unify file arrives,
replacing the seven files in `public/icons/` is the whole of the swap.

Two other facts about that pack, since it is the only brand evidence on disk: the palette PDF confirms all
seven hex values exactly as `globals.css` has them, and **Kantumruy Pro is not in it.** Only Koh Santepheap
ships with the brand, and it is display-weight — Kantumruy Pro is our own addition for Khmer body text
under §18-2.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
