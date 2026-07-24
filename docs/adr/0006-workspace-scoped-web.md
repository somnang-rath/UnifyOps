# ADR 0006 — A current-workspace concept in apps/web

- Status: Accepted (build against this)
- Date: 2026-07-15
- Scope: the **workspace concept in `apps/web`** — slug lookup, workspace-scoped
  project list, and `workspaceId` on project creation. Slug-based *URLs*
  (`/tes1/projects`) are specified here but deliberately built as a follow-up.
- Owners of build: `prism-backend` (api) + `prism-frontend` (web), against the
  contract in this ADR.

## Context

ADR 0003 scoped project *visibility* to workspaces and left three follow-ups.
(1) and (2) were closed by ADR 0004/0005. **(3) is still open**, and it is the
reason for this ADR:

> **Project creation on web main** leaves `workspaceId: null` (no workspace picker
> in web yet). Owner sees it; workspace peers don't until an admin assigns it.
> A "current workspace" concept in apps/web would let creation default it.

This is a live bug, not a cosmetic gap. `CreateProjectSchema` has no `workspaceId`
field and `ProjectsService.create` never sets one, so every project created from
web gets `workspaceId: null`. The only thing that repairs it is
`WorkspacesService.onModuleInit`, which runs **once at boot**. Meanwhile
`canReadProject` returns false when `workspaceId` is null:

```ts
if (project.visibility === 'internal' || project.visibility === 'public') {
  if (!project.workspaceId) return false;   // ← orphan is invisible to peers
```

So a freshly-created `internal` project is visible **only to its owner** (via the
`{ ownerId: me }` branch) until someone restarts the API. Every project created
through the UI since ADR 0003 landed has this defect.

The root cause is that **`apps/web` has no workspace concept at all**:
`apps/web/src/app/(app)/workspaces/` is an empty directory — no hook, no store, no
switcher. (`PLANE-CONVERSION-PLAN.md:29` lists `workspaces` as an existing web
route; that is stale.) Only `apps/admin` (:3001) has workspace UI. Web cannot
default a project's workspace because web does not know what workspace you are in.

The eventual goal is Plane-style URLs — `/tes1/projects`. That URL is the last
mile: it needs a current-workspace concept to exist first. This ADR builds the
concept; the URL change follows.

## Decision

### 1. Workspace lookup by slug — `GET /workspaces/slug/:slug`

The data layer is already slug-ready: `slug` is `unique + indexed + lowercase`
(`workspace.schema.ts:16`), and `dto/workspace.dto.ts:4` has the canonical regex
`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. No endpoint resolves it today; every workspace
route takes a Mongo `_id`.

- Declared **above `@Get(':id')`** — the controller already documents this trap at
  `:28-30`; a literal segment declared after `:id` is captured as an id.
- Slug validated against the existing `SLUG` regex **in the service, not via a
  pipe**: `ZodValidationPipe` is body-only by design (`zod-validation.pipe.ts:15`
  returns non-body args untouched), so binding it to a `@Param` looks like
  validation but does nothing. A malformed slug **404s rather than 400s** — it
  cannot name a workspace, and the module's convention is to never distinguish
  "absent" from "not yours". Adding param-validation infrastructure for one
  endpoint was not warranted.
- **Gated on owner-or-member; 404 on non-member**, per the ADR 0004/0005
  convention (no read access → 404, never leak existence).

The gate is not optional. `GET /workspaces/:id` (`workspaces.service.ts:170`) has
**no access check at all** — any authenticated user can read any workspace. That
is tolerable behind unguessable ObjectIds; it is **not** tolerable on an
enumerable slug, which turns the hole into workspace enumeration by name. This ADR
also closes that hole on `byId` with the same gate.

### 2. Strict workspace isolation for the scoped list — `GET /projects?workspace=<id>`

A workspace-scoped list is a plain equality filter, gated on membership:

```ts
// listInWorkspace(userId, workspaceId)
await this.access.assertWorkspaceMember(userId, workspaceId);
return this.projectModel.find({ workspaceId });
```

**A project appears under a workspace if and only if `project.workspaceId` matches
— even one you own that lives elsewhere.** This is a deliberate departure from
`listForUser` (`projects.service.ts:69`), whose three-branch `$or` is
workspace-*independent* by design (ADR 0003: "Owned/member projects remain visible
regardless of workspace") and unions across all of the user's workspaces.

The rationale is that a workspace list — and later the URL `/tes1/projects` — must
mean exactly what it says. A list that says `tes1` but contains a project from
`tes2` is not a tenant view. `listForUser` keeps its current semantics and remains
the unscoped "everything I can see" list; the two coexist.

**Endpoint shape:** `GET /projects?workspace=<id>`, *not* `GET /workspaces/:id/projects`.
The latter collides with the existing instance-admin route
`GET /workspaces/admin/:id/projects`, which means something different (projects
assignable to a workspace — this workspace's plus unassigned ones). Project lists
stay in the projects module.

### 3. `workspaceId` on project creation

`CreateProjectSchema` gains `workspaceId: z.string().optional()`; `create` calls
`assertWorkspaceMember` before setting it, so a caller cannot create a project into
a workspace they do not belong to. Web sends the current workspace. **This is what
actually closes ADR 0003 §3.**

Optional (not required) so the field stays backward-compatible with existing API
clients; omitting it preserves today's null behavior and the boot backfill.

### 4. `assertWorkspaceMember` belongs to `ProjectAccessService`

The membership query `exists({ _id, $or: [{ownerId: me}, {members: me}] })` is
currently inlined in **three** places: `project-access.service.ts:56-59`,
`projects.service.ts:74-77`, and `readableProjectIds:102-104`. Every new check
above needs a fourth. It is extracted once into `ProjectAccessService` — the
cycle-free leaf (ADR 0004 §1: depends only on the Project + Workspace models, so
any feature module can import it) — and reused.

## Semantics after this change

- Projects created from web land in the current workspace and are immediately
  visible to workspace peers — no API restart.
- `GET /projects` is unchanged (unscoped, ADR 0003 rule). `GET /projects?workspace=<id>`
  is strict. Callers choose.
- Workspaces are readable only by owners/members, by slug **or** by id.

## Behaviour change / migration note

Users of the *scoped* list see fewer projects than the unscoped one — that is the
point. Existing orphans (`workspaceId: null`) created since ADR 0003 are still
repaired only by the boot backfill; this ADR stops new ones being created but does
**not** add a runtime repair. Projects orphaned in the interim need an API restart
or a manual admin assignment.

## Accepted tradeoff: slug renames break URLs

`slug` is mutable — `applyUpdate` (`workspaces.service.ts:245-250`) lets an owner
or instance admin rename it, with no history and no redirect. We accept dead
bookmarks after a rename rather than carry a `slugHistory` field and redirect
layer for a rename that is expected to be rare.

To make the cost visible at the point of change, the admin drawer's slug input
(`workspace-drawer.tsx:139-148` — today `toLowerCase()` only, no validation, so
`hello world!` fails with a server 400) gains the `SLUG` regex, blocks save while
invalid, and carries help text saying renaming breaks existing links. It does
**not** preview a `/slug/...` URL: those routes don't exist until Phase 2, and
previewing a URL that 404s would be worse than no preview. Add the preview with
the routes. Revisit the whole tradeoff if renames turn out to be common.

## Out of scope / follow-ups

1. **Slug-based URLs** — `apps/web/src/app/(app)/[workspaceSlug]/`, whose layout
   resolves slug → workspace via §1 and 404s for non-members. **Only `projects`
   (list + `[id]` subtree) moves under it.**

   An earlier draft of this ADR also listed `issues`, `kanban`, `calendar` and
   `approvals`. That was wrong: those are **personal, cross-project views**, not
   workspace-scoped ones — `KanbanService.getOrSeedBoard(userId)` keys the board
   by *user*, and `IssuesService.list(userId, q)` / calendar / approvals are
   user-scoped across every readable project. Nesting them under a workspace slug
   would assert a scoping the data model does not have. They stay flat, alongside
   `my-work`, `notes`, `tables` and `settings`.

   Flat `/projects*` routes are **kept as redirects**, not deleted: the API writes
   workspace-agnostic deep links into the database (`projects.service.ts:53`
   `link: /projects/${id}`, `notifications.service.ts:77`, `assistant/tools.ts:208`)
   and those rows already exist. A redirect keeps every stored notification link
   working and leaves the API unchanged. Deleting the flat routes would 404 them
   and force a workspace lookup into every notification write.
2. **Per-project slugs** (`/tes1/projects/my-project`). `Project.namespace`
   (`project.schema.ts:92`) looks like the field for this but is **not unique, not
   indexed, and read by nothing**. It would need a per-workspace uniqueness
   constraint first. Do not mistake it for a routable slug.
3. **Runtime orphan repair** — creation is fixed here, but nothing re-homes a
   project orphaned by other paths (e.g. workspace deletion, which deliberately
   detaches rather than deletes). Still boot-only.
4. **Sub-resource lists are not workspace-scoped.** `readableProjectIds` (the seam
   issues/MRs already use) stays unscoped. A `readableProjectIdsInWorkspace` twin
   would propagate strict isolation to those lists for free when a workspace-scoped
   issues view is needed.
