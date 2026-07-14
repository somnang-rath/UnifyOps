# ADR 0004 — Workspace isolation for project sub-resource reads

- Status: Accepted — **built + verified 2026-07-13** (leaf `ProjectAccessModule`
  landed; issues/mrs/wiki reads delegate to it; DI boots cycle-free; gate behaviour
  verified against seed data)
- Date: 2026-07-13
- Extends: ADR 0003 (workspace-scoped project visibility)
- Owner of design: `prism-architect`. Build: `prism-backend`.
- Scope: the three by-id read paths that still leak across workspaces —
  `IssuesService.byId`, `MrsService.byId`, `WikiService.accessFor`. Plus the
  refactor that makes the ADR-0003 rule the **single** shared source of truth.

## Context

ADR 0003 scoped `internal`/`public` project visibility to the caller's
workspaces, but only for the project **list** and `ProjectsService.byId`. The
canonical rule lives in `ProjectsService.canRead(userId, project)`:

> owner OR member OR (visibility ∈ {internal, public} AND project.workspaceId ∈
> the workspaces the user owns or is a member of). Otherwise false. `byId`
> returns 404 (not 403) on no-access, so existence isn't leaked.

Three sub-resource reads never got the memo and still behave instance-wide:

1. `IssuesService.byId(id)` (`issues.service.ts:103`) — **no** access check;
   any authenticated user can fetch any issue. Called from
   `issues.controller.ts:47` (no `userId` threaded).
2. `MrsService.byId(id)` (`mrs.service.ts:86`) — **no** access check. Called
   from `mrs.controller.ts:36` (no `userId` threaded).
3. `WikiService.accessFor(userId, pageId)` (`wiki.service.ts:165`) — uses the
   **pre-0003** rule `isOpen = visibility ∈ {internal, public}`, i.e. any
   internal/public page is readable instance-wide, ignoring workspace
   membership. `accessFor` is the authz used by the live collab server
   (`internal-wiki.controller.ts:46`) and by the assistant
   (`tools.ts:151,157` via `searchForAssistant` and `get_wiki_page`).

### Constraints that shape the design

- **No new cycles.** `ProjectsModule` already imports `IssuesModule` (for issue
  counts, `projects.module.ts:11`). Injecting `ProjectsService` into
  `IssuesModule` would create `Projects → Issues → Projects`. The shared rule
  must live somewhere that depends on **neither** Issues nor MRs nor Wiki.
- **Nullable `projectId`.** `Issue.projectId` and `MergeRequest.projectId` are
  optional (`issue.schema.ts:36`, `mr.schema.ts:27`) — personal/unlinked items.
  They have no `ownerId`; ownership is expressed through `authorId` /
  `assigneeId` (issues) and `authorId` / `reviewerId` / `decidedById` (MRs). The
  project rule cannot apply to them; they need a **personal-stakeholder** rule.
- **One rule, not four.** `ProjectsService.canRead` and `WikiService.accessFor`
  must delegate to the same code path as the new sub-resource checks.
- **Preserve the `accessFor` contract.** It must keep returning
  `{ canRead, canWrite }` (live server + assistant depend on the shape and on
  the 404-throw-on-missing behaviour).

## Decision

### 1. Extract the rule into a cycle-free `ProjectAccessModule`

Create `apps/api/src/modules/projects/access/` containing a leaf module that
depends **only** on the `Project` and `Workspace` Mongoose models — no
Issues/MRs/Wiki/Notifications/Automations. Because nothing it imports imports it
back, every feature module can import it freely.

```
modules/projects/access/
  project-access.module.ts     // forFeature([Project, Workspace]); provides+exports ProjectAccessService
  project-access.service.ts
```

`ProjectAccessModule`:

```ts
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
    ]),
  ],
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class ProjectAccessModule {}
```

### 2. `ProjectAccessService` — the single source of truth

It knows only about projects and workspaces. It knows nothing about issues, MRs,
or wiki pages; sub-resource services compose it with their own stakeholder
logic.

```ts
export type ProjectAccessFields = Pick<
  Project, 'ownerId' | 'members' | 'visibility' | 'workspaceId'
>;

@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(Project.name)   private projectModel:   Model<ProjectDocument>,
    @InjectModel(Workspace.name) private workspaceModel: Model<WorkspaceDocument>,
  ) {}

  /**
   * THE canonical read rule (identical to ADR 0003 canRead): owner OR member OR
   * (internal/public AND project in a workspace the user belongs to).
   */
  canReadProject(userId: string, project: ProjectAccessFields): Promise<boolean>;

  /**
   * Sync membership test: owner OR member only (no visibility path). Used to
   * derive write access (e.g. wiki canWrite). Never hits the DB.
   */
  isProjectMember(userId: string, project: ProjectAccessFields): boolean;

  /** Load the minimal access fields; null when the project is gone. */
  getAccessFields(
    projectId: Types.ObjectId | string | null | undefined,
  ): Promise<ProjectAccessFields | null>;

  /**
   * Convenience: load by id + apply the rule. Returns false for a missing,
   * invalid, or unreadable id (never throws). Callers convert false → 404.
   */
  canReadProjectById(
    userId: string,
    projectId: Types.ObjectId | string | null | undefined,
  ): Promise<boolean>;
}
```

`canReadProject` body is a verbatim move of the current
`ProjectsService.canRead` (lines 116-136). `ProjectsService.canRead` becomes a
one-line delegate so no other caller changes.

### 3. Sub-resource composition (stays in the feature services)

The stakeholder logic is resource-specific, so it lives in each feature
service, calling `ProjectAccessService` only for the project part. This keeps
`ProjectAccessService` free of cross-module schema knowledge.

**Rule for a sub-resource with a nullable `projectId`:**

- `projectId` set → `access.canReadProjectById(userId, projectId)`.
- `projectId` null → **personal-stakeholder** rule: readable iff `userId` is one
  of the item's stakeholders. This preserves personal-item access without
  reintroducing the instance-wide leak.
  - **Issue** stakeholders: `authorId`, `assigneeId`.
  - **Merge request** stakeholders: `authorId`, `reviewerId`, `decidedById`.

`IssuesService.byId` becomes:

```ts
async byId(userId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
  const issue = await this.model.findById(id).lean();
  if (!issue) throw new NotFoundException();
  const ok = issue.projectId
    ? await this.access.canReadProjectById(userId, issue.projectId)
    : isStakeholder(userId, [issue.authorId, issue.assigneeId]);
  if (!ok) throw new NotFoundException();      // 404, never 403 — no existence leak
  return issue;
}
```

`MrsService.byId` is identical with stakeholders
`[mr.authorId, mr.reviewerId, mr.decidedById]`. `isStakeholder` is a trivial
local helper (`ids.filter(Boolean).some(x => String(x) === userId)`).

### 4. Wiki adopts the same rule; contract unchanged

`WikiService.accessFor` keeps returning `{ canRead, canWrite }` and its
404-on-missing behaviour. Only its body changes: the hand-rolled
`isOwner/isMember/isOpen` is replaced by the shared service. Wiki pages always
have a non-null `projectId` (`wiki-page.schema.ts`), so no stakeholder branch is
needed.

```ts
async accessFor(userId, pageId): Promise<{ canRead: boolean; canWrite: boolean }> {
  if (!Types.ObjectId.isValid(pageId)) throw new NotFoundException();
  const page = await this.model.findById(pageId, { projectId: 1 }).lean();
  if (!page) throw new NotFoundException();
  const project = await this.access.getAccessFields(page.projectId);
  if (!project) throw new NotFoundException();
  const canWrite = this.access.isProjectMember(userId, project); // membership only — unchanged
  const canRead  = await this.access.canReadProject(userId, project); // now workspace-scoped
  return { canRead, canWrite };
}
```

`searchForAssistant` and the live-server/`get_wiki_page` callers are untouched —
they inherit the corrected scoping for free.

## Consequences

- **One rule.** `ProjectAccessService.canReadProject` is now the only place the
  ADR-0003 rule lives; `ProjectsService.canRead`, all three sub-resource reads,
  and wiki authz delegate to it.
- **No cycles.** `ProjectAccessModule` is a leaf; `IssuesModule`, `MrsModule`,
  `WikiModule`, and `ProjectsModule` all import it without forming a loop.
- **Behaviour changes (intended isolation):**
  - Issues/MRs by id are no longer readable by arbitrary users — only project
    members, workspace peers (internal/public), or personal stakeholders.
  - Wiki `accessFor` (hence the live editor, `search_wiki`, and `get_wiki_page`)
    stops treating every internal/public page as instance-wide readable; access
    now requires workspace membership. Assistant wiki search results shrink
    accordingly — the same intended narrowing ADR 0003 called out.
  - Invalid ObjectIds now 404 instead of 500 (issues path gains the
    `isValid` guard wiki already had).
- **404 convention preserved** everywhere: no-access is indistinguishable from
  not-found; services throw `NotFoundException`, controllers do nothing special.
- **No admin bypass.** Reads follow `canReadProject` exactly; instance-admin
  does not implicitly read every workspace's items (consistent with 0003).
  Revisit only if an admin-console read surface needs it.

## Explicitly out of scope (follow-ups)

- **Write paths.** `IssuesService.update/addComment/remove`,
  `MrsService.*`, and wiki writes still trust the id. Harden with the same
  service in a later pass (`canWrite`/stakeholder for mutations).
- **List scoping.** `IssuesService.list` ignores `userId`; `MrsService.list`
  has no user param. They should filter by readable projects (+ personal items)
  using `ProjectAccessService`, but that is a query-shape change, not a by-id
  gate, and is deferred.
- **Personal-item sharing.** If personal (null-project) issues ever need to be
  visible to a whole workspace, extend the stakeholder rule then — not now.
```

