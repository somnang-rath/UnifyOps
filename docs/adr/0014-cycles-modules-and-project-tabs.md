# ADR 0014 — Cycles, Modules, and the project sub-navigation tabs

- **Status:** Accepted
- **Date:** 2026-07-29
- **Supersedes/relates:** ADR 0003–0006 (workspace isolation), ADR 0011 (route
  tiers, URL-authoritative params), ADR 0012 (publish views/projects to Space)

## Context

The project detail route (`/[workspaceSlug]/projects/[id]`) shipped with a
Plane-style sub-navigation of seven tabs, four of which rendered a `ComingSoon`
placeholder: **Cycles**, **Modules**, **Views**, **Pages**.

The state behind those placeholders was not what the docs claimed.
`docs/plan/03-feature-parity.md` listed Cycles and Modules as ✅ against
`apps/api/src/modules/{cycles,modules}` — but both directories were **empty and
had never been committed**. `views` was fully implemented server-side with no
management UI, and `wiki` — which is already project-scoped — was the natural
home for Pages but had no project-scoped entry point.

So the work split three ways: build two modules from nothing, build a UI for an
existing API, and give an existing feature a project-scoped surface.

## Decision

### 1. Membership lives on the work item, not on the container

Both `Issue.cycleId` and `Issue.moduleId` are nullable indexed pointers on the
issue. Neither `Cycle` nor `ProjectModule` holds an array of issue ids.

An array would need a transaction to stay consistent with the issue's own
pointer, and a cycle can accumulate thousands of items — the 16MB document
ceiling is a real risk on a long-running project. One pointer makes assignment a
single atomic write, and the progress rollup a single grouped aggregation over
an index (`{cycleId: 1, status: 1}`).

The two pointers are **independent**: cycle answers *when* work happens, module
answers *what feature it builds*, so an item is normally in one of each. An item
belongs to at most one of each — it can only be worked in one sprint.

### 2. Cycle status is derived; module status is stored

`cycleStatus(cycle, now)` computes `draft | upcoming | current | completed` from
the dates at read time. Storing it would need a scheduler to flip the value at
midnight and would be wrong between ticks.

A module's status is the opposite kind of fact: `paused` and `cancelled` are
*decisions*, and no date arithmetic can infer them. So `ProjectModule.status` is
an explicit enum the user sets.

This asymmetry propagates: cycles filter `?status=` in application code after
the rollup (the field does not exist in Mongo), modules filter it in the query.

### 3. A project runs one scheduled cycle at a time; modules run in parallel

Overlapping cycles make "what are we working on now" unanswerable and would let
`cycleStatus` report two `current` cycles. `assertNoOverlap` rejects an
intersecting date range with a 400 naming the clashing cycle. Drafts (no dates)
are exempt and may pile up freely.

Cycle dates are **both-or-neither** (`start <= end`); module dates are
independently optional, because "ship by March, start whenever" is a normal way
to plan a feature. Both are validated as a pair even on a partial `PATCH`, so
patching one side at a time cannot reach an invalid state.

### 4. Cycles and Modules are project-scoped only

Unlike a View, neither has a workspace-level form. A sprint spanning every
project in the tenant is not a thing teams plan, and allowing it would make the
one-cycle-at-a-time rule meaningless. `workspaceId` is denormalised off the
project so tenant-scoped list queries need no join (the same trick `View` uses).

Access is entirely inherited from the project via `ProjectAccessService` — read
gate 404s (no existence leak), write gate is `assertProjectWritable`. There is
no new authorization concept here, which is the point.

### 5. Assignment reports partial success; delete releases, never destroys

`POST /cycles/:id/issues` pins its lookup to the cycle's `projectId`, so ids
from another project land in `skipped[]` rather than 400-ing the batch — one
stale id in a multi-select must not lose the whole action, and the pin means
this can never pull an item across a tenant boundary even with guessed ids.

`DELETE /cycles/:id` clears the pointer on every member **before** deleting the
row. The reverse order would leave issues pointing at a row that no longer
exists if the second step failed; this order only risks re-running a no-op.

### 6. Backlog filtering needs a non-id sentinel

The planner's core question is "what *isn't* scheduled yet", which no id can
express. `GET /issues?cycleId=none` (and `moduleId=none`) matches null — and
therefore also items written before the field existed, so no migration is
needed.

### 7. Pages reuses the wiki editor rather than re-hosting it

`WikiPage.projectId` is already required, so a project's Pages *are* its wiki
pages. The Pages tab is a project-scoped **index** — list, search, create,
delete — that opens each page in the existing wiki route via
`?project=&page=`.

Re-hosting the editor would have meant duplicating Tiptap + Yjs collaboration,
covers, and publish-to-Space: exactly the triple duplication `CLAUDE.md` names
as this conversion's most likely failure. The wiki route now reads those two
params with **URL > localStorage > fallback** precedence, matching what
`use-layout-param` established for `?layout=` in ADR 0011 §4.

### 8. Saved views became deep-linkable

The issues list held its active view in React state only, so a view could not be
linked. `?view=<id>` now applies a view on mount, fetched **by id** rather than
looked up in a loaded list — a link can name a shared view that no list on that
page happens to have loaded. Applied once per id, guarded by a ref, so a manual
filter change afterwards is not yanked back to the saved definition.

Editing and deleting a view stay owner-only (matching `ViewsService`), while
publishing follows the *project* write gate — publishing is a project-level act
(ADR 0012 §3).

## Consequences

- Two new API modules registered in `app.module.ts`; both use the leaf pattern
  (direct `MongooseModule.forFeature` on `Issue`) rather than importing
  `IssuesModule`, which would drag in notifications/activity/automations/
  webhooks and risk a cycle. Same rationale as `ViewsModule`.
- The API entity is `ProjectModule`, not `Module`, because `@nestjs/common`
  exports a `Module` decorator; `@Schema({ collection: 'modules' })` keeps the
  Mongo collection name conventional. The web type is `FeatureModule` for the
  same reason.
- `AddItemsModal` and `ProgressBar` are shared by both tabs
  (`components/feature/planning/`), with the backlog filter passed in as a prop
  — that is what lets one dialog serve cycles and modules.
- Verified: `pnpm --filter api test:cycles-modules` (30 checks, in the
  `test:e2e:full` runner) and `pnpm --filter web test:project-tabs` (19 browser
  checks against a real dev stack).

## Not done

- No burn-down chart — progress is a completion bar plus counts. The rollup
  already returns `byStatus`, so a chart needs no API change.
- No cycle "transfer incomplete items to the next cycle" action.
- Module `memberIds` is stored and settable via the API but the modal only
  exposes `leadId`; a member picker is UI-only work.
- Cycles/modules are not publishable to the Space (only wiki, views, projects).
