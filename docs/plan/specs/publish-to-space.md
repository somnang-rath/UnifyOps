# Spec — Publish views & projects to Space (Phase 8)

Hand-off target: `prism-frontend` (web + space) and `prism-backend` (views/public
modules). Follows the **existing wiki publish pattern** — `PublishControl` in
`apps/web/src/app/(app)/[workspaceSlug]/wiki/page.tsx` (lines 671–790) is the
reference UI; do not invent a new affordance. Public rendering follows
`apps/space/src/app/[anchor]/page.tsx` (article + "Published with Prism" footer).

Constraints inherited from the architecture rules: public endpoints leak nothing
(no ids, no emails, no assignees, no member lists — ADR 0002 §3); space is SSR,
unauthenticated, CSP-locked (`script-src 'self'`), and already transpiles
`@prism/ui`.

---

## 1. Data contract (frozen before code)

### 1.1 Model additions

`SavedView` and `Project` gain the same pair the wiki page already has:

```ts
isPublic: boolean;        // default false
anchor: string | null;    // random URL-safe slug, generated on first publish
```

v1 restriction: **only project-scoped views are publishable** (`projectId !== null`).
Workspace-level views aggregate across projects with mixed membership — the
publish endpoint rejects them (400) and the UI shows a disabled state (§2.2).

### 1.2 Public payloads

`GET /public/anchor/:anchor` becomes a discriminated union on `type`:

```ts
type PublicPayload = PublicWikiPage | PublicView | PublicProject;

interface PublicIssue {
  title: string;
  status: string;          // raw status/column id, e.g. "in-progress" or a custom column
  statusLabel: string;     // display label, e.g. "In progress"
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  type: string;            // 'task' | 'bug' | 'feature' | …
  labels: string[];
  dueDate: string | null;  // ISO
  updatedAt: string;       // ISO
}
// Deliberately absent: _id, assigneeId, authorId, desc, comments, todos.

interface PublicView {
  type: 'view';
  anchor: string;
  title: string;               // view name
  projectName: string;         // display context only — no project id
  layout: 'board' | 'list';    // API maps saved layout: kanban→board, else list
  groupBy: string | null;      // null ⇒ space defaults to 'status'
  groups?: { id: string; label: string }[]; // ordered column defs when groupBy='status'
  issues: PublicIssue[];
  updatedAt: string;
}

interface PublicProject {
  type: 'project';
  anchor: string;
  title: string;               // project name
  description: string | null;
  coverImage: string | null;   // hotlinked, same as wiki (ADR 0010 §3)
  layout: 'board';             // v1: projects always publish as a board
  groupBy: 'status';
  groups?: { id: string; label: string }[];
  issues: PublicIssue[];
  updatedAt: string;
}
```

The existing wiki payload keeps `type: 'wiki'` (already present in
`apps/space/src/lib/public-api.ts`). Space branches on `type`; unknown types →
`notFound()` so an older space build degrades to 404, never to a crash.

### 1.3 Endpoints (backend summary, for completeness)

- `POST /views/:id/publish` · `POST /views/:id/unpublish` — project owner/member
  (same gate as wiki: `canWrite`). 400 for workspace-level views.
- `POST /projects/:id/publish` · `unpublish` — **owner-only**, mirroring the
  `PATCH /projects/:id` guard (see the `canEditCover` comment in
  `apps/web/src/app/(app)/[workspaceSlug]/projects/[id]/settings/page.tsx`).
- `GET /public/anchor/:anchor` — unauthenticated, throttled, strips fields per §1.2.

---

## 2. Web — publish affordances

### 2.1 Shared `PublishControl` (refactor, stays in apps/web)

Extract the wiki page's inline `PublishControl` into
`apps/web/src/components/feature/publish/publish-control.tsx` and re-use it in
all three places (wiki, ViewsBar, project settings). It stays in **apps/web**,
not `packages/ui`: only one app publishes, and it depends on the web toast
store + clipboard flow. Presentational otherwise — mutations stay with callers.

```ts
interface PublishControlProps {
  /** Current state. anchor must be set when published is true. */
  published: boolean;
  anchor: string | null;
  /** NEXT_PUBLIC_SPACE_URL; '' shows the "set the env var" hint (wiki behavior). */
  spaceUrl: string;
  pending: boolean;                 // publish/unpublish mutation in flight
  onPublish: () => void;
  onUnpublish: () => void;
  /** Renders the trigger disabled with a Tooltip (v1 workspace-view case). */
  disabled?: boolean;
  disabledReason?: string;
  size?: 'sm';                      // default 'sm', matches wiki
  className?: string;
}
```

Behavior (identical to today's wiki control — keep the exact markup):

- Not published → outline Button `[Globe] Publish` (spinner while pending).
- Published → outline Button `[Globe] Public` in `text-green`; click opens the
  right-aligned popover (`w-[320px]`, `animate-popover-in`, click-outside to
  close) containing:
  - label `PUBLIC LINK` (11px bold uppercase `text-text-muted`),
  - read-only input with `${spaceUrl}/spaces/${anchor}`, select-on-focus,
  - Copy button (icon) → `toast('Link copied', 'success')`,
  - ExternalLink anchor (`target="_blank" rel="noreferrer"`),
  - full-width `[CloudOff] Unpublish` in `text-red`.
- `disabled` → button gets `disabled` + wrap in `@prism/ui` `Tooltip` with
  `disabledReason`. Tooltip is CSS-only and shows on focus too, so keyboard
  users get the explanation.

Link building: always `spaceUrl + '/spaces/' + anchor` — the relative path is
`/spaces/<anchor>` (space `basePath`), origin comes from `NEXT_PUBLIC_SPACE_URL`
(`http://localhost:3002` in dev). Never hardcode the origin.

### 2.2 ViewsBar (`.../issues/_components/views-bar.tsx`)

Do not put publish inside each `FilterChip` — chips stay apply/delete only.
Instead, when a saved view is **active** (`activeViewId` set), append a publish
control to the bar, after the "Save view" button:

```
[bookmark] (chip)(chip)(chip*active) [+ Save view]  ·  [Globe Publish ▾]
```

- Rendered only when `activeViewId` resolves to a view in the merged list.
- Separator: `mx-1 h-3.5 w-px bg-border` between "Save view" and the control
  (visual grouping; `aria-hidden`).
- Project-scoped active view (`view.projectId !== null`) and caller is
  owner/member of that project → live `PublishControl` wired to
  `useViewPublish(view._id)` (new hook mirroring `useWikiPublish`:
  `publish`/`unpublish` mutations, invalidates `['views']`).
- **Workspace-level active view** → `PublishControl` with
  `disabled` + `disabledReason="Workspace views can't be published yet — publish a project view instead."`
- Non-member of the view's project → render nothing (never offer a 403, same
  principle as wiki's `canPublish`).
- A published view keeps its `Users` shared icon on the chip; add a `Globe`
  icon (w-3 h-3) via `FilterChip`'s `icon` slot when `isPublic` (with
  `aria-label="Published view"`). If both shared and published, Globe wins —
  one icon max in a 26px chip.

States:
- No active view → no control (bar unchanged).
- Pending → spinner in the button (built into `PublishControl`).
- Deleting a published view → the API unpublishes implicitly; no extra UI, but
  the delete `Confirm` copy gains a line when `isPublic`:
  "This view is public — its link will stop working."

### 2.3 Project settings (`projects/[id]/settings/page.tsx`)

New section between **Cover image** and **Members**, following the existing
section pattern (`<h2 class="text-[15px] font-semibold mb-3">` + card
`bg-bg-card border border-border rounded-lg px-4 py-3.5`). Owner-only
(`me.id === project.ownerId` — same strict gate as cover, because publish is a
project PATCH-level write).

```
Publish to Space
┌──────────────────────────────────────────────────────────────┐
│ Public board                                    [Switch ●—]  │
│ Anyone with the link can view this project's work            │
│ items — titles, status, priority, labels and due             │
│ dates only. No assignees, comments or descriptions.          │
│ ─────────────────────────────────────────────── (published)  │
│ [ http://…:3002/spaces/k3j9x2  ] [Copy] [Open ↗]             │
└──────────────────────────────────────────────────────────────┘
```

- Toggle = `@prism/ui` `Switch` with `aria-label="Publish project to Space"`;
  disabled while the mutation is pending.
- Turning **on** publishes immediately (no confirm — same as wiki). Turning
  **off** opens `Confirm` ("Unpublish project — the public link will stop
  working.") because it breaks a shared URL.
- When published, the link row appears below a `border-t border-border`
  divider inside the card: the same read-only-input + Copy + ExternalLink
  cluster as `PublishControl`'s popover (extract that row as
  `PublicLinkRow({ url })` inside the publish feature folder so both share it).
- The privacy sentence above is mandatory copy — it is the user-facing promise
  matching §1.2.
- `NEXT_PUBLIC_SPACE_URL` unset → same fallback line as wiki ("Set
  `NEXT_PUBLIC_SPACE_URL` to show the shareable link.").

Loading: section renders only when `project` is loaded (page already returns
null before that). Error: mutation errors surface via the axios toast
interceptor; the Switch snaps back (no optimistic update — flip on success).

---

## 3. Space — public view/project rendering

### 3.1 Routing & branching

`apps/space/src/app/[anchor]/page.tsx` fetches once and branches:

```tsx
const payload = await getPublicPayload(params.anchor);  // renamed from getPublicPage
if (!payload) notFound();
switch (payload.type) {
  case 'wiki':    return <WikiArticle page={payload} />;      // existing markup, moved
  case 'view':    return <SpaceIssuesPage payload={payload} />;
  case 'project': return <SpaceIssuesPage payload={payload} />;
  default:        notFound();
}
```

Keep `export const dynamic = 'force-dynamic'` and extend `generateMetadata`:

- view → title `` `${title} · ${projectName} · Prism Space` ``, description
  `` `Public board for ${projectName}` ``, `openGraph.type: 'website'`.
- project → `` `${title} · Prism Space` ``, description from
  `description ?? 'Published project board'` (truncate 160 chars).

### 3.2 Layout — `SpaceIssuesPage` (server component, local to space)

Issue payloads are wider than prose — use `max-w-[1080px]` (board) /
`max-w-[840px]` (list) instead of the wiki's 720px, but keep the same page
rhythm (`px-6 py-14`, header block, footer).

```
main.min-h-screen
└─ div.mx-auto.max-w-[1080px].px-6.py-14
   ├─ SpaceCover (project only, when coverImage)        ← existing component
   ├─ header.mb-8.border-b.border-border.pb-6
   │  ├─ p  projectName (view only) — text-2xs uppercase tracking-wider text-text-muted
   │  ├─ h1 title — text-3xl font-bold tracking-tight
   │  ├─ p  description (project only) — text-[14px] text-text-sub mt-2
   │  └─ p  "Last updated {date}" — text-[13px] text-text-muted mt-2
   ├─ SpaceBoard | SpaceIssueList  (layout === 'board' ? … : …)
   └─ footer.mt-14.pt-6.border-t.border-border.text-[12px].text-text-muted
      └─ "Published with Prism"                          ← identical to wiki footer
```

Token note: new space markup uses **design tokens** (`border-border`,
`text-text-muted`, `bg-bg-card`…) — the preset is already wired
(`apps/space/tailwind.config.ts`). Do not extend the legacy `gray-*` usage from
the wiki article; migrating that file's grays is optional and out of scope.

### 3.3 `SpaceBoard` (local: `apps/space/src/components/space-board.tsx`)

Server component, zero interactivity (CSP forbids inline script anyway).

```ts
interface SpaceBoardProps {
  issues: PublicIssue[];
  groupBy: string | null;                    // null → 'status'
  groups?: { id: string; label: string }[];  // authoritative order when present
}
```

- Grouping: bucket `issues` by the `groupBy` key (v1 supported keys: `status`,
  `priority`, `type`; anything else falls back to `status`). Column order: the
  `groups` array when provided; otherwise first-seen order; empty provided
  groups still render (an empty column is information).
- Markup: `<section aria-label="Board">` → horizontal scroll container
  (`flex gap-4 overflow-x-auto pb-4`) → per column:

```
section.w-[280px].shrink-0  (role=group, aria-labelledby=colId)
├─ h2#colId — text-xs font-semibold text-text-sub flex items-center gap-1.5
│   ├─ StateIcon (status grouping only, when the id maps to a core state)
│   └─ label + count badge (text-text-muted, tabular-nums)
└─ ul.mt-2.flex.flex-col.gap-2
   └─ li → SpaceIssueCard
```

- `SpaceIssueCard` (same file): `bg-bg-card border border-border rounded-md
  px-3 py-2.5`, containing:
  - title — `text-[13px] font-medium leading-snug` (no link — there is no
    public detail page; render as plain text, **not** an `<a>`),
  - meta row (`mt-1.5 flex flex-wrap items-center gap-1.5`):
    `PriorityBadge` · type `Badge variant="outline" size="xs"` · label
    `Badge variant="neutral" size="xs"` each · due date
    `<time dateTime={iso}>` `text-2xs text-text-muted`, prefixed "Due ".
- `PriorityBadge` (local helper): `@prism/ui` `Badge` with variant mapping
  `urgent→danger`, `high→warning`, `medium→accent`, `low/none→neutral`, plus
  the text label — never color alone. Skip rendering for `none`.

### 3.4 `SpaceIssueList` (local: `apps/space/src/components/space-issue-list.tsx`)

```ts
interface SpaceIssueListProps { issues: PublicIssue[] }
```

Flat list, one row per issue (no grouping headers in v1):

```
ul.divide-y.divide-border.border.border-border.rounded-lg.bg-bg-card
└─ li.flex.items-center.gap-3.px-4.py-2.5
   ├─ StateIcon (core states only, aria-hidden) + statusLabel (text-2xs text-text-muted w-[90px] shrink-0)
   ├─ span.title — text-[13px] flex-1 min-w-0 truncate
   ├─ labels (≤2 shown + "+N" Badge, hidden below sm)
   ├─ PriorityBadge
   └─ time due date — text-2xs text-text-muted tabular-nums (hidden below sm)
```

Responsive: below `sm` the row keeps status-icon + title + priority only.

### 3.5 Reusable vs local

| Piece | Where | Why |
| --- | --- | --- |
| `Badge`, `StateIcon`, `EmptyState` | reuse from `@prism/ui` | Presentational, no hooks in the render path used here; space already transpiles `@prism/ui`; client-marked components render fine from RSC. |
| `SpaceBoard`, `SpaceIssueList`, `SpaceIssueCard`, `PriorityBadge` | local to `apps/space/src/components/` | Single-app, SSR-only, shaped around the stripped `PublicIssue` payload. Web's board/list components carry auth, drag-and-drop, and full `Issue` types — sharing would smuggle edit affordances into public UI. |
| `SpaceCover` | existing local component | already there. |
| `getPublicPayload`, `PublicIssue` types | `apps/space/src/lib/public-api.ts` | extend the existing module; server-side only. |

Rule of thumb honored: nothing in these components accepts an id, an email, or
an edit callback — if a prop like that appears in review, it is a leak.

### 3.6 States (space)

| State | Rendering |
| --- | --- |
| Default | §3.2 layout. |
| Empty (`issues.length === 0`) | Header + `EmptyState` (`label="Nothing here yet"`, `hint="No work items are published in this view."`) inside a `border border-dashed border-border rounded-lg py-16`; footer still renders. |
| 404 / unpublished | `notFound()` → existing `apps/space/src/app/not-found.tsx` ("Page not available… not published, or the link is no longer valid") — already covers unpublish-after-share. |
| API error (non-404) | `getPublicPayload` throws; add `apps/space/src/app/[anchor]/error.tsx` (client, no fetching): centered "Something went wrong loading this page." + a plain `<a href="">Reload</a>`. Same visual register as not-found. |
| Loading | None — SSR with `force-dynamic`; no skeleton needed. Optional later: `loading.tsx` with `Skeleton rows={6}`. |
| Unauthenticated | The only mode. No login prompts, no edit affordances anywhere. |

### 3.7 Accessibility (space)

- One `<h1>` (payload title); columns are `<h2>`; groups use
  `role="group"` + `aria-labelledby`.
- Priority/status never color-only: `StateIcon` shape + text label, Badge text.
- Due dates as `<time dateTime>`.
- Board horizontal scroller: `tabIndex={0}` + `role="region"` +
  `aria-label="Board columns"` so keyboard users can scroll it.
- Card titles are static text, not empty-href links — nothing focusable that
  goes nowhere.
- Color contrast: token pairs (`text-text-sub` on `bg-bg-card` etc.) are the
  Phase 6 audited set; no raw hex.

---

## 4. New shared tokens/utilities

None. Everything uses existing tokens (`--state-*` via `StateIcon`, badge
variants, `border-border`, `bg-bg-card`, `text-text-*`, `text-2xs`/`micro`
scale) and existing primitives. The only cross-app addition is the
`PublicIssue`/`PublicView`/`PublicProject` types — put them in
`packages/types` (they are consumed by `apps/api` and `apps/space`).

## 5. Interaction flow summary

1. Member applies a project view on `/[ws]/issues` → publish button appears →
   Publish → chip gains Globe, popover shows `/spaces/<anchor>` link → Copy.
2. Visitor opens link → SSR board/list, read-only, stripped payload.
3. Owner unpublishes (popover or settings Switch + Confirm) → visitor gets 404
   "Page not available" on next load.
4. Workspace-level view active → disabled Publish + tooltip explaining the v1
   restriction; no dead-end 400s.
