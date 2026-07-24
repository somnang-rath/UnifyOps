# ADR 0011 — Route tiers and workspace route consolidation

- Status: Accepted (build against this)
- Date: 2026-07-23
- Scope: which `apps/web` routes move under `/[workspaceSlug]/` and which never
  will (the **route tier census**), the API seam that makes the moved routes
  honest (`readableProjectIdsInWorkspace` + optional `workspaceId` list params),
  and the redirect policy for the flat routes left behind. Extends ADR 0006 and
  exercises its §4 escape hatch (`readableProjectIdsInWorkspace`).
- Owners of build: `prism-backend` (api seam) + `prism-frontend` (web route
  moves + shims), against the contract in this ADR.

## Context

Phase 7 deferred route consolidation explicitly
(`PLANE-CONVERSION-PLAN.md:301`: "route consolidation (`[workspaceSlug]`) …
ទុកសម្រាប់ Phase 7b — route migration មិនគួរបំបែក app ដែលដំណើរការ mid-stream").
Phase 7b is that migration. Two route families already live under the slug —
`projects` (ADR 0006 follow-up 1, with the `projects/[...rest]` redirect shim)
and `chat` (Phase 9) — and every remaining route is flat.

ADR 0006 drew the line once: workspace-scoped routes move, personal
cross-project views don't, because "nesting them under a workspace slug would
assert a scoping the data model does not have." That reasoning stands. What has
changed since is that ADR 0006 §4 named the seam that would *give* the issue
views workspace scoping — `readableProjectIdsInWorkspace` — and Phase 7b now
needs it. This ADR is the binding census (so "should X move under the slug?"
never reopens), the seam contract, and the redirect policy.

Verifying the census against the code surfaced three things the plan text got
wrong or missed; they are folded into the decisions below:

1. **Timeline is not an issues view.** `(app)/timeline/page.tsx:11` renders the
   activity feed (`useActivity` → `GET /activity`), not issues. Activity rows
   carry an optional `projectId` (`activity/schemas/activity.schema.ts:10`,
   indexed at `:29`), so the same seam pattern applies — but to the **activity**
   list endpoint, not the issues one.
2. **`GET /issues/calendar/range` is globally unscoped.**
   `IssuesService.calendar` (`issues.service.ts:169-179`) filters by date only —
   any authenticated user receives every issue in the range, across all
   tenants. This predates this ADR and contradicts the ADR 0004 isolation
   story; it must be closed as part of the calendar migration.
3. **`GET /wiki` and `GET /wiki/:id` have no read gate.**
   `WikiController.list/byId` (`wiki.controller.ts:37-45`) call
   `WikiService.list` (`wiki.service.ts:66-75`), which filters by the required
   `projectId` with no `canReadProject` check — any authenticated user can list
   any project's page titles and read any page body by id. Same story: a
   pre-existing hole that the migration must not build on top of.

The governing rule for all three: **a URL that says `acme` must not be backed
by an endpoint that can return `globex` data.** Moving a route under the slug
is a promise of tenancy; the seam work below is what makes the promise true.

## Decision

### 1. The route tier census

Every `(app)` route in `apps/web` is assigned exactly one tier. Re-tiering a
route later (e.g. if a module gains workspace scoping) is a **one-line
amendment to this table**, not a new debate.

**Tier W — workspace-scoped, moves under `/[workspaceSlug]/`:**

| Route | Why it is workspace-scoped (verified) |
| ----- | ------------------------------------- |
| `projects` (+`[id]` subtree) | Done — ADR 0006 follow-up 1. Record only. |
| `chat` (+`[channelId]`) | Done — Phase 9 (ADR 0007). Record only. |
| `issues` (+`[id]`; `?peek=` preserved) | List is `readableProjectIds`-scoped (`issues.service.ts:87-116`); the seam (§2) intersects that with the workspace. |
| `calendar` | An issues view (`useCalendarIssues` → `GET /issues/calendar/range`); becomes honest via §2 — and the endpoint's missing scoping (Context #2) is fixed in the same change. |
| `timeline` | An **activity** view (correction — Context #1); activity rows are `projectId`-tagged, so §2 applies to `GET /activity`. |
| `wiki` | Pages are `projectId`-keyed (`wiki.dto.ts:22` requires it; `wiki.service.ts:66`) → transitively workspace-scoped. Read gate added per Context #3. |
| `analytics` | Already workspace-scoped server-side: `GET /workspaces/:id/analytics`, member-gated (`workspaces.controller.ts:143-150`). Pure route move; no API change. |

**Tier P — personal, flat forever:**

`my-work` · `kanban` (board keyed by user: `kanban-board.schema.ts:18`,
`getOrSeedBoard(u.id)`) · `approvals` (MR list is personal cross-project:
`mrs.service.ts:61-75`, `readableProjectIds` + own personal MRs) · `notes`
(ownerId + folder grants, ADR 0009) · `home` · `assistant` · `debug`.

Borderline routes, ruled now after reading their modules — all four are
user-keyed with **no `workspaceId` anywhere in the module**, so all four are
**Tier P**:

- `tables` — workbooks are `ownerId` + user/role grants
  (`workbooks.service.ts:48-66`).
- `files` — folders are `ownerId` + user/role grants
  (`files.service.ts:129-146`).
- `reports` — templates are `ownerId` + recipient/grant userIds
  (`reports.service.ts:112-123`).
- `automations` — pure `ownerId` (`automations.service.ts:40-45`).

If one of these later gains a `workspaceId` (e.g. workspace-shared tables), it
re-tiers by amending this census and applying the §3 shim policy — nothing
else in this ADR changes.

**Tier G — global/account, flat forever:**

`settings` · `notifications` · `users` · the `(auth)` group (`login`,
`register`, `accept-invite`).

### 2. The API seam

ADR 0006 §4's planned twin, built now. **No new endpoints; no changes to any
existing `readableProjectIds` caller.**

**a) `ProjectAccessService.readableProjectIdsInWorkspace(userId, workspaceId)`**
— sits next to `readableProjectIds` (`project-access.service.ts:134`).
Contract: *the subset of `readableProjectIds(userId)` whose
`project.workspaceId` equals the given id.* A plain intersection — no
membership assert. For a non-member the visibility branch contributes nothing
(the workspace is not in `myWorkspaceIds`), so a non-member's set is empty
unless they own/joined a project parked in that workspace; either way the
result only ever contains projects the caller could already read. Invalid or
unknown `workspaceId` → empty array, never a throw.

**b) Optional `workspaceId` on three existing list endpoints.** Zod shape in
each case: `workspaceId: objectId.optional()` (the module-local
`/^[0-9a-fA-F]{24}$/` pattern), added to the existing query schema and parsed
by the existing `ZodQueryPipe`.

- `GET /issues` (`ListIssueQuerySchema`, `issue.dto.ts:46`): absent →
  today's behavior, unchanged (readable projects **plus** the caller's
  personal `projectId: null` issues). Present → filter becomes
  `projectId ∈ readableProjectIdsInWorkspace(...)` and the personal branch is
  **dropped** — personal issues belong to no workspace and must not appear
  under a workspace URL.
- `GET /issues/calendar/range` (`CalendarRangeSchema`, `issue.dto.ts:63`):
  same param, same semantics. Additionally — Context #2 — the **absent** case
  is fixed to match `GET /issues` (readable projects + own personal issues)
  instead of returning everything. This is a behavior change for the flat
  `/calendar` shim's users: they stop seeing issues they were never entitled
  to. That is the ADR 0004 rule finally applied, not a regression.
- `GET /wiki` (`ListWikiQuerySchema`, `wiki.dto.ts:21`): `projectId` becomes
  optional; the schema requires **at least one of `projectId` / `workspaceId`**
  (Zod `refine`) so the endpoint never serves an unbounded list. `projectId`
  alone → today's per-project list, now gated with `canReadProjectById`
  (Context #3; unreadable project → empty list, consistent with the rule
  below). `workspaceId` alone → pages across
  `readableProjectIdsInWorkspace(...)`. Both → both filters (the project list
  intersected with the workspace set). `GET /wiki/:id` gains the same
  `canReadProjectById` gate, 404 on failure (a resource fetch, so ADR 0004/0005
  semantics apply — see below).
- `GET /activity` (`ListActivitySchema`, `activity.dto.ts:5`): same optional
  param for the migrated timeline; present → `projectId ∈
  readableProjectIdsInWorkspace(...)` (workspace activity never includes
  project-less rows). The absent case's lack of scoping
  (`activity.service.ts:13-32` filters by nothing access-related) is recorded
  as a known gap in follow-ups — fixing it changes what the flat timeline
  shows and is separable, unlike calendar where the leak is issue *content*
  across tenants.

**c) Unknown `workspaceId` / non-member → empty list, not 403/404.** The
ADR 0004/0005 convention — "no read access → 404, never leak existence" — is a
rule about **resource fetches**: a URL that names one thing must not confirm
that thing exists. A list *filter* is not a resource fetch; the request names
a set, and the honest answer to "which readable items match this filter?" is
sometimes "none". Empty-list leaks nothing: a non-member, a member of an empty
workspace, and a caller using a random id all receive the identical `[]`, so
the response cannot be used to probe workspace existence — exactly the
property the 404 convention protects on fetches. It also falls straight out of
the intersection (a non-member's set is empty, so the filter matches nothing)
with no extra membership query, and keeps the response shape stable for
clients. Note the URL path still 404s where it should: the
`/[workspaceSlug]/` layout resolves the slug via `GET /workspaces/slug/:slug`
(ADR 0006 §1), which 404s non-members before any list call is made.

### 3. Redirect policy: permanent shims for every Tier W flat route

Every route that moves keeps a flat **redirect shim, forever** — the same
rationale as ADR 0006's flat `/projects`: the API writes workspace-agnostic
hrefs into stored rows, and those rows already exist and keep being written.
Verified writers: `notifications.service.ts:77` (`/issues/${id}`),
`assistant/tools.ts:208` (`/issues/${id}`), `mrs.service.ts:152,204`
(`/approvals` — Tier P, stays real), `wiki.service.ts:61` (`/wiki`),
`notes.service.ts:292` (`/notes` — Tier P, stays real), `projects.service.ts:53`
(`/projects/${id}` — shimmed already). Deleting a shim 404s stored
notification rows; **shims are never cleaned up.**

Target-workspace resolution:

- **List routes** (`/issues`, `/calendar`, `/timeline`, `/wiki`,
  `/analytics`): redirect to the workspace from the persisted selection
  (`workspace-store.ts:14`, key `pr_ws_current`, reconciled by
  `useCurrentWorkspace()` against the workspaces the user can see), else the
  user's **first workspace**. A user with zero workspaces gets the same
  "no workspace" messaging pattern as the projects shim, not a loop.
- **`/issues/[id]`**: resolve via the entity, mirroring the existing
  `projects/[...rest]` shim (`projects/[...rest]/page.tsx:9-18`) and for the
  same reason — a stored notification may deep-link into a workspace that is
  not the current selection. Fetch the issue; if project-linked, redirect to
  its project's workspace slug; if personal (`projectId: null`), fall back to
  the list-route rule. Query strings (`?peek=` on `/issues`) are carried
  through the redirect verbatim.

Shims redirect with `router.replace` (client-side, like the projects shim) so
Back does not bounce.

### 4. URL contract reservations

Fixed now so later Phase 7b items don't churn migrated URLs:

- **`?peek=<id>`** is preserved on the migrated `/[workspaceSlug]/issues`
  exactly per `docs/plan/specs/issue-peek.md` (click→push, close→replace,
  Back closes, deep-link works). The migration must not regress that spec's
  E2E contract.
- **`?layout=`** is **reserved** on every Tier W list route for the
  layout-as-search-param item. No route may claim that param name for
  anything else.
- **Bulk operations** land after the migration, on the migrated issues page,
  and have **no URL surface** (selection is ephemeral UI state).

### 5. Slug renames

The rename-breaks-links tradeoff is inherited from ADR 0006 ("Accepted
tradeoff: slug renames break URLs") unchanged, now covering every Tier W
route. Referenced, not restated; revisit there if renames become common.

## Semantics after this change

- `/acme/issues` shows exactly the issues of readable projects **in** `acme` —
  no personal issues, no other-workspace spillover. Flat `/issues` (via shim
  target-workspace + the unchanged no-param API call) keeps today's personal
  cross-project semantics.
- Flat `/calendar` users stop seeing other tenants' issues (the Context #2
  fix). Any workflow that depended on the leak was depending on a defect.
- `GET /wiki` and `GET /wiki/:id` stop serving pages from unreadable projects.
- `GET /issues`, `GET /activity`, `GET /wiki` responses are shape-unchanged;
  only an optional query param is added. Existing clients (including stored
  flat hrefs) work untouched.
- The `/[workspaceSlug]/` layout remains the membership gate for the URL
  space (404 on non-member slug, ADR 0006 §1); list endpoints below it return
  `[]` rather than erroring when the filter matches nothing.

## Out of scope / follow-ups

1. **Bulk operations** on the migrated issues page (§4; no URL surface).
2. **`?layout=` implementation** — the param is reserved here, built later.
3. **Per-project slugs** — still not routable; ADR 0006 follow-up 2's
   `Project.namespace` caveat stands (not unique, not indexed, read by
   nothing).
4. **`GET /activity` default-case scoping** — the no-param activity list is
   still not access-scoped (Context #1 note). Closing it changes flat
   `/timeline` content and deserves its own small decision; the workspace
   branch built here is scoped from day one.
5. **`kanban` controller's `:userId` params** (`kanban.controller.ts:21-23,
   40-42` let any caller read another user's board) — noticed during the
   census; personal-tier hygiene, unrelated to route consolidation.
6. **Workspace switcher affordance on Tier P/G pages** — the persisted
   selection drives shim targets; how the selection is surfaced while on flat
   pages is a UX question for `prism-uiux`, not a contract question.
