# Spec — Issue Peek panel (`?peek=<id>`)

Plane-style side overlay opened from the issues list without leaving it. This is the
phase that pays down the Tier-3 `IssuePeek` deferral from `docs/plan/02-design-system.md`
§3, and it lands the Tier-2 `Drawer` primitive at the same time.

**Split of responsibility (rule #1: one design system, three apps):**

| Layer | What | Where |
| ----- | ---- | ----- |
| Shell | `Drawer` — generic side panel: portal, positioning, backdrop, Esc, focus, scroll | `packages/ui/src/Drawer.tsx` (new) |
| Content | `IssuePeek` — issue data, sections, mutations, URL wiring | `apps/web/src/components/feature/issue/issue-peek.tsx` (new) |
| Shared sections | `Card`/`CardHeader`/`SidebarRow`/checklist/comment thread — **extracted from the detail page, not copied** | `apps/web/src/components/feature/issue/detail-sections.tsx` (new) |

The `Drawer` is presentational (no fetching, no routing) so admin can later replace its
hand-rolled `workspace-drawer.tsx` overlay (`apps/admin/src/app/(dashboard)/workspaces/workspace-drawer.tsx`)
with it. `IssuePeek` stays in `apps/web` because it is wired to `useIssue`,
`useIssueMutations`, and Next routing — exactly what `packages/ui` must not contain.

---

## 1. `packages/ui` — `Drawer` primitive

### 1.1 Props

```ts
export interface DrawerProps {
  open: boolean;
  /** Called for every close intent: Esc, backdrop, close button in `header`. */
  onClose: () => void;
  side?: 'right' | 'left';                    // default 'right'
  /** Max width on ≥sm screens. Full-width below sm regardless. */
  size?: 'sm' | 'md' | 'lg';                  // 380 | var(--peek-w, 480px) | 640 — default 'md'
  /**
   * true  → Modal-style: dimmed backdrop, focus trap, body scroll lock.
   *         (admin workspace drawer, form drawers)
   * false → Peek-style: page behind stays visible AND interactive on ≥lg;
   *         below lg a dimmed tap-to-close backdrop is still rendered
   *         because a full-width panel over an unreachable page needs one.
   */
  modal?: boolean;                            // default true
  /** Suppress the Esc handler while a child Modal/Confirm is open on top. */
  disableEscape?: boolean;                    // default false
  /** Sticky header row (caller renders its own close button here). */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Accessible name — required unless `aria-labelledby` is passed. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}
```

### 1.2 Behavior

- **Portal to `document.body`**, same `mounted` guard as `Modal.tsx` (SSR-safe).
- **Overlay, not push.** The panel floats over content; the list layout never reflows.
- **z-index:** container `z-40` — deliberately *below* `Modal`'s `z-50`, so the edit
  `IssueModal` / `Confirm` opened from inside the peek stack correctly on top.
- **Scroll:** the panel body (`children` region) is the scroll container
  (`overflow-y-auto`, `overscroll-contain`). `header` is sticky. Body scroll lock
  (`document.body.style.overflow = 'hidden'`) only when `modal` — in peek mode the
  list behind must keep scrolling.
- **Esc:** document-level `keydown` listener while open, ignored when `disableEscape`.
  Caveat: `Modal`'s own Esc handler calls `e.stopPropagation()`, which does **not**
  stop sibling listeners on `document` — that is why `disableEscape` exists; the caller
  must pass it while a Modal is stacked (see §3.4).
- **Focus:**
  - `modal` → identical machinery to `Modal.tsx`: focus first focusable, trap Tab,
    restore on close. (Implementation note: lift that ~40-line block out of `Modal.tsx`
    into a shared `useFocusTrap(panelRef, { trap: boolean })` in `packages/ui` and use
    it from both — do not paste it a second time.)
  - non-modal → focus the panel container (`tabIndex={-1}`) on open, **no trap**
    (the page behind is interactive by design), restore `document.activeElement` on close.
- **ARIA:** `role="dialog"`; `aria-modal="true"` only when `modal`.
- **Motion:** slide + fade over `--dur-overlay` (160ms), which already collapses to 0
  under `prefers-reduced-motion` via `tokens.css`.

### 1.3 Markup skeleton

```tsx
createPortal(
  <div className={cn('fixed inset-0 z-40 flex', side === 'right' ? 'justify-end' : 'justify-start')}
       // In non-modal mode the container must NOT eat clicks meant for the page:
       style={modal ? undefined : { pointerEvents: 'none' }}>
    {/* Backdrop: always in modal mode; below lg only in peek mode */}
    <div
      aria-hidden="true"
      onMouseDown={onClose}
      className={cn(
        'absolute inset-0 bg-[var(--overlay,rgba(10,10,30,.45))] animate-fade-in',
        modal ? '' : 'lg:hidden pointer-events-auto',
      )}
    />
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={modal || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      tabIndex={-1}
      className={cn(
        'relative pointer-events-auto flex h-full w-full flex-col outline-none',
        'border-l border-border bg-bg-card shadow-xl',        // border-r when side='left'
        'animate-sheet-in',                                   // new keyframe, §1.4
        { sm: 'sm:max-w-[380px]', md: 'sm:max-w-[var(--peek-w)]', lg: 'sm:max-w-[640px]' }[size],
        className,
      )}
    >
      {header && (
        <header className="sticky top-0 z-10 flex h-10 flex-shrink-0 items-center gap-1 border-b border-border bg-bg-card px-3">
          {header}
        </header>
      )}
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  </div>,
  document.body,
)
```

### 1.4 New shared tokens/utils (the only additions)

- `packages/ui/tailwind-preset.ts` — one keyframe + animation next to `modalIn`:
  ```ts
  sheetIn: {
    from: { opacity: '0', transform: 'translateX(12px)' },   // negate for side='left'
    to:   { opacity: '1', transform: 'translateX(0)' },
  },
  // animation:
  'sheet-in': 'sheetIn 160ms cubic-bezier(0.16,1,0.3,1)',
  ```
- `packages/ui/src/index.ts` — `export { Drawer } from './Drawer'; export type { DrawerProps } from './Drawer';`
- `--peek-w: 480px` **already exists** in `tokens.css` — use it, don't redefine.
- Optional but recommended: `useFocusTrap` extraction shared by `Modal` + `Drawer`.

---

## 2. `apps/web` — `IssuePeek` content

### 2.1 Component contract

```tsx
// apps/web/src/components/feature/issue/issue-peek.tsx
export function IssuePeek({
  issueId,          // from ?peek=
  onClose,          // strips ?peek from the URL (list page owns routing, §3)
  onNavigate,       // (id: string) => void — replaces ?peek with a sibling id
  prevId,           // computed by the list from its current sorted order; null at ends
  nextId,
}: IssuePeekProps)
```

The **list page** owns the URL and the ordering; `IssuePeek` owns rendering and
mutations. Data comes from the existing `useIssue(issueId)` — the query key
`['issues','byId',id]` is already kept fresh by `useIssueMutations`, so edits made in
the peek update the list rows optimistically for free.

### 2.2 Reuse map — nothing is forked

| Section | Reused piece | Change needed |
| ------- | ------------ | ------------- |
| Type icon, pills | `IssueTypeIcon`, `StatusPill`, `PriorityPill`, `Label` (`components/feature/issue/…`) | none |
| Description | `MarkdownView` | none |
| Sub-issues & relations | `IssueLinks issueId={id}` — already self-contained | none |
| Comment composer | `CommentComposer` + `CommentComposerActions` | none |
| Edit / delete | `IssueModal`, `Confirm` | none |
| Card chrome | `Card` from `@/components/ui/card` | detail page currently redefines a local `Card` — switch it to the shared one while extracting |
| `CardHeader`, `SidebarRow`, checklist block, comment thread | currently **private functions inside `app/(app)/issues/[id]/page.tsx`** | **extract** to `components/feature/issue/detail-sections.tsx` as `CardHeader`, `SidebarRow`, `IssueChecklist({ todos })`, `CommentThread({ comments, users })`; the detail page imports them back — one source for page and peek |
| Skeleton | pattern of `IssueDetailSkeleton` (`components/ui/skeleton.tsx`) | add `IssuePeekSkeleton` beside it (peek-shaped, §4.1) |

### 2.3 Layout — single 480px column, top to bottom

```
┌─ header (sticky, h-10) ────────────────────────────────┐
│ ˄ ˅  #a1b2c3            ⧉ copy  ⤢ full  ✎ edit  ✕ close│
├─ scroll body ──────────────────────────────────────────┤
│ [type icon 28] Title (text-lg font-semibold, wraps)    │
│ StatusPill · PriorityPill · opened 2d ago by Ana       │
│                                                        │
│ PROPERTIES (grid: label 96px | value)                  │
│   Status · Priority · Type · Assignee · Project        │
│   · Due date · Labels                                  │
│                                                        │
│ DESCRIPTION (MarkdownView | italic empty line)         │
│ CHECKLIST (only if todos.length > 0, with progress)    │
│ SUB-ISSUES & RELATIONS (<IssueLinks/>)                 │
│ COMMENTS (CommentThread + CommentComposer)             │
└────────────────────────────────────────────────────────┘
```

Header (left → right):
- `IconButton` **prev/next** (`ChevronUp`/`ChevronDown`, lucide 14px), disabled when
  `prevId`/`nextId` is null. `aria-label="Previous issue" / "Next issue"`.
- Short id `#{_id.slice(-6)}` — `text-2xs font-mono text-text-muted`.
- `flex-1` spacer, then:
- **Copy link** (`Link2` icon) — copies the **canonical** URL
  `${location.origin}/issues/${id}` (not the `?peek` URL: the canonical one works from
  anywhere). On success flash the icon to `Check` for 1.5s + existing `toast('Link copied')`.
- **Open full page** (`Maximize2` icon) — a real `next/link` to `/issues/${id}`;
  plain navigation, peek param irrelevant after that.
- **Edit** (`Pencil`) → opens the existing `IssueModal`.
- Overflow is unnecessary at this width; **Delete** lives inside the edit affordance
  region as on the detail page only if space allows — v1 keeps delete on the full page.
- **Close** (`X`) → `onClose`. `aria-label="Close peek"`.

All header buttons are `IconButton size="sm" variant="ghost"` (26px hit area, existing
primitive).

Body markup skeleton (Tailwind, matches detail-page vocabulary):

```tsx
<div className="px-5 py-4 flex flex-col gap-5">
  {/* title block */}
  <div className="flex items-start gap-3">
    <IssueTypeIcon type={issue.type} size={28} className="flex-shrink-0 mt-0.5" />
    <div className="min-w-0">
      <h2 id={titleId} className="text-lg font-semibold leading-snug text-text break-words">
        {issue.title}
      </h2>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-2xs text-text-muted">
        <StatusPill status={issue.status} />
        <PriorityPill priority={issue.priority} />
        <span>opened {relTime(issue.createdAt)} by {author?.name ?? '?'}</span>
      </div>
    </div>
  </div>

  {/* properties — flat rows, no Card chrome at this width */}
  <div className="flex flex-col border-y border-border py-1 -mx-2">
    <SidebarRow icon={…} label="Status">…</SidebarRow>
    {/* …same seven rows and empty fallbacks as the detail page sidebar:
        Unassigned / None / Not set in text-text-muted */}
  </div>

  {/* description */}
  <section aria-label="Description">
    <SectionLabel icon={<FileText />}>Description</SectionLabel>
    {issue.desc?.trim()
      ? <MarkdownView body={issue.desc} users={users} />
      : <p className="text-sm text-text-muted italic">No description provided.</p>}
  </section>

  {issue.todos?.length > 0 && <IssueChecklist todos={issue.todos} />}

  <IssueLinks issueId={issue._id} />

  <section aria-label="Comments">
    <SectionLabel icon={<MessageSquare />}>Comments {count > 0 && <CountBadge/>}</SectionLabel>
    <CommentThread comments={issue.comments ?? []} users={users} />
    <CommentComposer … /><CommentComposerActions … />
  </section>
</div>
```

`SectionLabel` is the extracted `CardHeader` typography without the card border:
`text-2xs font-semibold uppercase tracking-wider text-text-muted` + 14px icon, `mb-2`.
Inside the peek, sections are separated by spacing, not nested cards — cards-in-a-drawer
at 480px reads cramped; the drawer itself is the card.

---

## 3. URL & interaction contract (list page wiring)

Owner: `apps/web/src/app/(app)/issues/page.tsx`.

### 3.1 Open

- Row stays a real `<Link href={/issues/${id}}>` — middle-click, ctrl/cmd-click, and
  copy-address keep working and keep SEO-correct hrefs.
- Plain left click is intercepted:
  ```tsx
  onClick={(e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const next = new URLSearchParams(params);
    next.set('peek', i._id);
    router.push(`/issues?${next}`, { scroll: false });   // push → browser Back closes the peek
  }}
  ```
- Existing params (`project`, `new`) are preserved; peek composes with filters.
- Deep link `/issues?peek=<id>` pasted into a new tab opens the list with the peek
  already up. No special handling needed — same render path.

### 3.2 Close (Esc, backdrop tap on mobile, ✕)

```tsx
const closePeek = () => {
  const next = new URLSearchParams(params);
  next.delete('peek');
  router.replace(next.size ? `/issues?${next}` : '/issues', { scroll: false });
};
```
`replace`, not `push` — closing must not create a history entry, and it must work
identically whether the peek was opened by click or by pasted URL (never `router.back()`:
on a pasted URL that would leave the site).

### 3.3 Prev/next while open

The list page computes neighbors from **its own current `sortedItems`/`grouped` order**
(flattened), so peek navigation follows whatever sort/group the user sees:

```tsx
const flat = grouped ? grouped.flatMap(([, items]) => items) : sortedItems;
const idx = flat.findIndex((i) => i._id === peekId);
// prevId = flat[idx-1], nextId = flat[idx+1]  (null at the ends; null when idx === -1)
```
Navigation uses `router.replace` (not push) — stepping through ten issues must not
require ten Backs to leave. Keys: `ArrowUp/ArrowDown` and `j/k` handled inside the panel
only when the event target is not an input/textarea/contenteditable.

Because the peek is **non-modal on ≥lg**, clicking a different row while it is open
simply re-runs §3.1 → the panel swaps content in place. This is the primary triage flow.

### 3.4 Stacked overlays

`IssueModal` (edit) and `Confirm` render at `z-50` above the `z-40` drawer and trap
focus themselves. While either is open, pass `disableEscape` to the Drawer so one Esc
closes only the top layer:

```tsx
<Drawer modal={false} disableEscape={editing || confirming} …>
```

### 3.5 Focus / a11y

- `Drawer` gets `aria-labelledby={titleId}` (the `<h2>` in the title block); while
  loading, fall back to `aria-label="Issue"`.
- On open: focus the panel container. On close: focus restored to the originating row
  (Drawer's restore ref does this automatically since the row was `activeElement`).
- On prev/next: keep focus where it is if inside the panel; if the pressed button
  becomes disabled (hit an end), move focus to the panel container.
- Row `<Link>`s already have visible `:focus-visible` rings from `tokens.css`; Enter on
  a focused row triggers the same intercepted click (onClick fires for keyboard
  activation of links).

---

## 4. States

### 4.1 Loading — `IssuePeekSkeleton`

Rendered inside the Drawer body while `useIssue` has no data. Mirror the real layout so
nothing jumps (same technique as `IssueDetailSkeleton`):

```tsx
<div className="px-5 py-4 flex flex-col gap-5 animate-fade-in" aria-busy="true">
  <div className="flex items-start gap-3">
    <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-5 w-4/5" />
      <div className="flex gap-2">
        <Skeleton className="h-4 w-14 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
    </div>
  </div>
  <div className="space-y-2 border-y border-border py-3">
    {[…5].map(() => <div className="flex gap-3"><Skeleton className="h-3 w-20"/><Skeleton className="h-3 w-32"/></div>)}
  </div>
  <SkeletonText lines={4} />
</div>
```
The header renders immediately (nav/copy/full/edit disabled, close active) so the user
can always bail out of a slow load.

### 4.2 Error — not found / no access

The API returns 404/403 from `GET /issues/:id`; `useIssue` surfaces `isError`.

- Render inside the panel (do **not** silently strip the URL — the user pasted a link
  and deserves an explanation):
  ```tsx
  <ErrorState message="This issue doesn't exist or you don't have access." onRetry={refetch} />
  <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
  ```
  centered in the body (`flex flex-col items-center justify-center h-full gap-3`).
- Header shows only the close button (no id, nav/copy/full/edit hidden).
- `?peek=` stays in the URL until the user closes; closing cleans it per §3.2.
- Same treatment for a malformed id (fails the 24-hex shape) — don't even fire the query.

### 4.3 Empty sections

Identical copy to the detail page (consistency is the feature):
- Description → *“No description provided.”* italic muted.
- Checklist → section hidden entirely when `todos` is empty.
- Sub-issues/relations → `IssueLinks` already renders *“No sub-issues or relations yet.”*
- Comments → existing icon + *“No comments yet. Be the first!”*, composer always shown.
- Unassigned / no project / no due date → muted fallbacks copied from `SidebarRow` usage.

---

## 5. Responsive summary

| Breakpoint | Panel | Backdrop | Page behind |
| ---------- | ----- | -------- | ----------- |
| `< sm` (640) | full-width, full-height | dimmed, tap closes | inert |
| `sm–lg` | `max-w-[var(--peek-w)]` (480px) | dimmed, tap closes | inert |
| `≥ lg` | 480px | none | **interactive** — scroll, click rows to swap peek |

(Implemented entirely by the `modal={false}` backdrop rule in §1.3 — no JS breakpoint
logic.)

---

## 6. Build order & out of scope

Build order for `prism-frontend`:
1. `packages/ui`: `sheetIn` keyframe → `Drawer.tsx` (+ optional `useFocusTrap` extraction) → export.
2. `apps/web`: extract `detail-sections.tsx` from `[id]/page.tsx`; detail page re-imports — verify `pnpm --filter web build` before proceeding.
3. `issue-peek.tsx` + `IssuePeekSkeleton`.
4. List-page wiring (§3) + keyboard nav.
5. Verify E2E: open → edit → Esc twice → deep-link → bad id → mobile width.

Out of scope for v1 (deliberate):
- Inline editing of title/properties inside the peek (edit goes through `IssueModal`,
  same as the detail page — one write path).
- Peek on other surfaces (kanban, calendar, project boards) — the Drawer + `IssuePeek`
  API already supports it; only URL wiring per page is needed later.
- Plane's peek-mode switcher (side / modal / full). `Drawer size` and `modal` props leave
  the door open.
- Activity log (state-change history) — no API for it yet; the Comments section is the
  activity surface for now.
