# ADR 0003 — Workspace-scoped project visibility

- Status: Accepted (build against this)
- Date: 2026-07-13
- Scope: **project list visibility only** (`ProjectsService.listForUser`). Deeper
  access enforcement (`byId`, cross-module sub-resource reads) is called out as a
  follow-up, not implemented here.
- Owners of build: `prism-backend` (api), with `prism-architect` owning the wider
  isolation contract.

## Context

The workspace model already exists end to end:

- `Workspace` (`modules/workspaces/schemas/workspace.schema.ts`) — the tenant
  container, with `ownerId` + `members[]`.
- `Project.workspaceId` (nullable) links a project to its workspace.
- `WorkspacesService.onModuleInit` backfills every orphan (`workspaceId: null`)
  project into an auto-created **Default** workspace.
- Instance admins assign/unassign projects to workspaces and manage members.

But nothing consumed that link for **access**. `ProjectsService.listForUser`
returned:

```ts
$or: [
  { ownerId: me },
  { members: me },
  { visibility: { $in: ['internal', 'public'] } },  // ← every internal project, instance-wide
]
```

So any logged-in user saw **every `internal`/`public` project on the entire
instance**, regardless of which workspace/admin it belonged to. Effectively the
instance behaved as a single shared tenant. This ADR closes that gap for the list.

## Decision

`internal`/`public` visibility is scoped to **workspaces the user belongs to**
(owner or member). Owned/member projects remain visible regardless of workspace,
so nothing a user is explicitly attached to disappears.

```ts
async listForUser(userId) {
  const me = new Types.ObjectId(userId);
  const myWorkspaces = await this.workspaceModel
    .find({ $or: [{ ownerId: me }, { members: me }] }, { _id: 1 })
    .lean();
  const workspaceIds = myWorkspaces.map((w) => w._id);
  return this.projectModel.find({
    $or: [
      { ownerId: me },
      { members: me },
      {
        visibility: { $in: ['internal', 'public'] },
        workspaceId: { $in: workspaceIds },
      },
    ],
  });
}
```

### Semantics after this change

- `internal` now means "internal **to this workspace**", not instance-wide.
- A user in no workspace sees only projects they own or are a member of.
- Projects with `workspaceId: null` are not surfaced via the visibility path —
  but the `onModuleInit` backfill means none should remain null in practice.
  A project's owner still always sees it via `{ ownerId: me }`.

### Behaviour change / migration note

Existing users who relied on seeing *all* internal projects will now see fewer.
That is the intended isolation. The backfill only adds each workspace's **owner**
to its members, so non-owner users must be added to the relevant workspace (or the
project's member list) to regain visibility. This is the instance-admin's job via
the workspace drawer.

## Out of scope / follow-ups

1. **`ProjectsService.byId` has no access check** — any authenticated user can
   fetch any project by id. Needs a shared `assertCanAccessProject(userId, project)`
   helper applying the same rule, then adopted by `byId`.
2. **Cross-module sub-resource reads** (issues, wiki, MRs, kanban keyed by
   `projectId`) trust the project id without re-checking project access. The helper
   from (1) should be reused there.
3. **Project creation on web main** leaves `workspaceId: null` (no workspace picker
   in web yet). Owner sees it; workspace peers don't until an admin assigns it.
   A "current workspace" concept in apps/web would let creation default it.

(1) and (2) are the real security hardening and belong to `prism-architect` as one
isolation contract — deliberately not bundled into this list-only change.
