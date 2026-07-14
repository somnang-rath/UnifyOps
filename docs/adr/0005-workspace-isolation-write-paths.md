# ADR 0005 — Workspace isolation for project sub-resource writes

- Status: Accepted — **built + verified 2026-07-13**
- Extends: ADR 0003 (project read scoping), ADR 0004 (sub-resource read gates)
- Scope: mutation paths on issues / merge requests / wiki pages. Read gates are
  ADR 0004; this ADR covers create / edit / comment / decide.

## Context

ADR 0004 gated *reads*. The corresponding *writes* still trusted the id: any
authenticated user could edit any issue, comment on any MR, decide an MR with no
reviewer, or create/edit a wiki page in any project. Deletions were already
guarded (issues `remove` = author|admin, MR `remove`/wiki `remove` = author|admin,
wiki `publish`/`unpublish` = `accessFor.canWrite`).

## Decision

### Write rule — members + stakeholders (chosen policy)

A caller may write a **project-linked** item when they are a **member** of its
project (owner/member) **or** a **stakeholder** of the item itself. Workspace
peers who can only *read* an internal/public project (ADR 0003) cannot write.

- **Issue** stakeholders: `authorId`, `assigneeId`.
- **Merge request** stakeholders: `authorId`, `reviewerId`, `decidedById`.
- **Wiki page** stakeholder: `authorId` (pages always have a project).

A **personal** item (`projectId` null) is writable only by its stakeholders.

**Create** (no item yet) requires **membership** of the target project; a personal
create (null project) is always allowed. This prevents "create-as-author" from
bypassing membership.

### Error convention

Same as ADR 0004: no read access → **404** (no existence leak); readable but not
writable → **403**. Encoded once in `ProjectAccessService`:

- `assertProjectWritable(userId, projectId)` — membership gate for a project;
  no-op for null. Used by create + re-parent.
- `assertCanWrite(userId, projectId, isStakeholder)` — stakeholder shortcut, else
  delegates to `assertProjectWritable`. Used by edit/comment/decide.

### Adopted by

| Service | Method | Gate |
|---|---|---|
| Issues | `create` | `assertProjectWritable(dto.projectId)` |
| Issues | `update` | `assertCanWrite` + `assertProjectWritable` on re-parent target |
| Issues | `addComment` | `assertCanWrite` |
| MRs | `create` | `assertProjectWritable(dto.projectId)` |
| MRs | `decide` (approve/reject) | `assertCanWrite` (then existing reviewer-only rule) |
| MRs | `addComment` | `assertCanWrite` |
| Wiki | `create` | `assertProjectWritable(dto.projectId)` |
| Wiki | `update` | `assertCanWrite` (author as stakeholder) |

Unchanged (already guarded): issue/MR/wiki `remove` (author|admin), wiki
`publish`/`unpublish` (`accessFor.canWrite`), wiki `snapshotContent` (internal
token; live server authenticated at connect via `accessFor`).

## Consequences

- Editing/commenting/creating is now restricted to members + stakeholders; the
  previous "any authenticated user" behaviour is gone (intended isolation).
- MR decide with **no reviewer** is no longer open to everyone — a project member
  or MR stakeholder is required (the reviewer-only rule still applies when a
  reviewer is set).
- Verified end-to-end against seed data: all 9 branches of the gate
  (member→allow, readable-non-member→403, unreadable→404, personal→404 unless
  stakeholder, stakeholder→allow) pass; API typechecks; DI boots cycle-free.

## Out of scope / follow-ups

- **List scoping.** `IssuesService.list` / `MrsService.list` still return items
  across projects; scope them by readable projects (+ personal) with
  `ProjectAccessService` in a later pass (query-shape change).
- **Kanban / activity / other projectId-keyed reads** not yet gated.
- **Wiki write vs live-collab.** REST `update` allows the page author (stakeholder)
  per this policy; `accessFor.canWrite` (used by the live editor) stays
  membership-only. A non-member author can thus edit via REST but not the live
  editor — acceptable; revisit if it surprises.
