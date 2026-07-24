# Spec — Workspace Analytics page (`/analytics`)

Phase 8 follow-up. A read-only, workspace-scoped analytics surface for apps/web:
summary totals, breakdowns by state/priority/assignee, and a created-vs-completed
weekly trend.

**API contract (being finalized in parallel — design tolerates field renames):**

```
GET /api/v1/workspaces/:id/analytics?projectId=&range=
→ {
    totals:     { open: number; completed: number; overdue: number };
    byState:    { state: string; count: number }[];          // issue statuses: todo|inprogress|review|done|…
    byPriority: { priority: string; count: number }[];       // low|medium|high|critical
    byAssignee: { assigneeId: string | null; name: string; avatar?: string | null; count: number }[];
    trend:      { weekStart: string; created: number; completed: number }[];  // ISO date, oldest → newest
  }
```

Design assumptions the API team should confirm: `byAssignee` includes an
`assigneeId: null` row for unassigned items; `trend` covers exactly the requested
range (zero-filled weeks included); all counts are already workspace- and
project-filtered server-side.

**Chart approach — decided, not open:** the repo's one chart library is
**recharts 3.8.1** (already used by `apps/web/src/components/feature/reports/element-chart.tsx`).
The trend chart uses recharts; the three breakdowns use **CSS distribution bars**
(the same technique as reports' `bar-h` mode and home's project progress bars) —
they are text-first, accessible by construction, and keep the recharts surface small.
Do not add a second chart library.

Two recharts v3 gotchas are already documented in `element-chart.tsx` and apply here:

1. **Never render recharts' `<Legend>`** — its `componentDidUpdate` store dispatch
   loops on sub-pixel measurements ("Maximum update depth exceeded"). Render an HTML
   legend outside `<ResponsiveContainer>`.
2. `isAnimationActive={false}` on every series (also the right call for
   `prefers-reduced-motion`).

---

## 1. Route, navigation, data scope

- **Route:** `apps/web/src/app/(app)/analytics/page.tsx` — flat, matching the current
  convention (`/issues`, `/kanban`, `/reports`). Route consolidation under
  `[workspaceSlug]` is deferred; do **not** nest this page.
- **Sidebar:** `apps/web/src/components/layout/sidebar.tsx`, section **"Plan & Track"**,
  last item (after Approvals):
  ```ts
  { href: "/analytics", label: "Analytics", Icon: BarChart3 }   // lucide BarChart3
  ```
  No badge, no `adminOnly` — every workspace member can read their workspace's numbers.
  (`FileBarChart2` is taken by Reports; `Activity` by Timeline.)
- **Data scope:** the page resolves the tenant via `useCurrentWorkspace()` (same as
  `ViewsBar`) and passes `workspace.id` into the query. Flat route, workspace-scoped
  data — the established pattern. If no workspace is resolved yet, render the page
  skeleton (§5.1), not an error.

---

## 2. Page layout

```
┌─ header row ────────────────────────────────────────────────────────────┐
│ Analytics                                    [All projects ▾] [4w 12w 24w] │
│ Work-item activity across <workspace name>                              │
├─ KPI strip (grid-cols-1 sm:grid-cols-3, gap-3) ─────────────────────────┤
│ [Open ●violet]        [Completed ●green]        [Overdue ●red, danger]  │
├─ Trend panel (full width) ──────────────────────────────────────────────┤
│ Created vs completed · legend  ▂▅▃▇▅▂ (grouped weekly bars, h-[280px])  │
├─ Breakdown grid (grid-cols-1 md:grid-cols-2 xl:grid-cols-3, gap-4) ─────┤
│ [By state]            [By priority]            [By assignee]            │
└──────────────────────────────────────────────────────────────────────────┘
```

Page shell (matches the home page's vocabulary — `Panel` and `KpiCard` are
**extracted from `home-user.tsx`, not copied**, see §6):

```tsx
<div className="flex flex-col gap-5">
  {/* header */}
  <div className="flex items-end justify-between gap-3 flex-wrap">
    <div className="leading-tight">
      <h1 className="text-[20px] font-bold tracking-[-.02em]">Analytics</h1>
      <p className="text-[12.5px] text-text-muted mt-0.5">
        Work-item activity across {workspace.name}
      </p>
    </div>
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={projectId} onChange={setProject} options={projectOpts} className="w-44" />
      <RangeToggle value={range} onChange={setRange} />
    </div>
  </div>

  {/* KPI strip */}
  <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
    <KpiCard label="Open"      value={totals.open}      Icon={CircleDot}   tone="violet" />
    <KpiCard label="Completed" value={totals.completed} Icon={CheckCircle2} tone="green" />
    <KpiCard label="Overdue"   value={totals.overdue}   Icon={Flag}        tone="red"
             danger={totals.overdue > 0} />
  </div>

  {/* Trend */}
  <Panel title="Created vs completed" subtitle={RANGE_LABEL[range]}>
    <TrendChart data={trend} />
  </Panel>

  {/* Breakdowns */}
  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
    <Panel title="By state"><DistributionList rows={stateRows} /></Panel>
    <Panel title="By priority"><DistributionList rows={priorityRows} /></Panel>
    <Panel title="By assignee"><DistributionList rows={assigneeRows} maxRows={8} /></Panel>
  </div>
</div>
```

KPI cards are **static in v1** (no `href`) — the issues list URL doesn't yet encode
tab/overdue filters, and a card that navigates to a differently-filtered list would
lie. Add deep links only when the list supports them. `danger` on Overdue reuses the
red-ring treatment `KpiCard` already has.

### 2.1 Colors — must match how state/priority read elsewhere

Charts must use the same hues as `StatusPill` / `PriorityPill` / `PRIO_DOT`
(`apps/web/src/components/feature/issue/pills.tsx`, `home-user.tsx`). Pills carry
Tailwind classes; charts need raw values — so **add exported raw color maps to
`pills.tsx`** (single source of truth for issue presentation) and consume them here:

```ts
// pills.tsx additions — CSS vars where a token exists, hex where it doesn't
export const STATUS_COLOR: Record<string, string> = {
  todo:       'var(--text-muted)',   // matches the neutral pill
  inprogress: 'var(--warning)',      // amber
  review:     'var(--info)',         // blue
  done:       'var(--success)',      // green
  design:     '#a855f7',             // violet — role-board columns, same as pill tints
  ready:      '#ec4899',
  discovery:  'var(--a)',
};
export const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--danger)',
  high:     '#f97316',               // orange — matches PRIO_DOT
  medium:   'var(--warning)',
  low:      '#94a3b8',               // slate — matches PRIO_DOT
};
```

Unknown status keys fall back to `var(--a)` (same rule as `StatusPill`'s fallback).
Trend series: **created = `var(--a)`** (accent — follows the user's accent theme),
**completed = `var(--success)`**. CSS vars in SVG `fill` work and keep dark mode and
`[data-accent]` correct for free.

Labels come from the same file's `STATUS[...] .label` map (e.g. `inprogress` →
"In progress"), so chart rows and pills never drift apart. Priority rows render in
fixed order critical → high → medium → low (the existing `PRIORITY_ORDER`), state rows
in the pill map's order; both regardless of API ordering.

### 2.2 `DistributionList` — the one breakdown component

Page-local: `apps/web/src/app/(app)/analytics/_components/distribution-list.tsx`.
All three breakdowns are the same row: swatch/avatar · label · track bar · count · %.

```ts
interface DistributionRow {
  key: string;
  label: string;
  count: number;
  color?: string;                 // swatch + bar fill; default 'var(--a)'
  avatar?: { name: string; src?: string | null };  // assignee rows render Avatar instead of swatch
  muted?: boolean;                // "Unassigned" row: dashed swatch, text-text-muted label
}
interface DistributionListProps {
  rows: DistributionRow[];
  maxRows?: number;               // collapse beyond this with a "Show all (N)" toggle
}
```

Row markup (percent of the section's own total, computed client-side):

```tsx
<div className="flex flex-col">
  {rows.map((r) => (
    <div key={r.key} className="flex items-center gap-2.5 px-4 py-2 border-t border-border first:border-t-0">
      {r.avatar
        ? <Avatar name={r.avatar.name} src={r.avatar.src} size="xs" />
        : <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: r.color ?? 'var(--a)',
                         ...(r.muted && { background: 'transparent', border: '1.5px dashed var(--text-muted)' }) }} />}
      <span className={cn('text-[12.5px] truncate w-24 shrink-0', r.muted && 'text-text-muted')}>{r.label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color ?? 'var(--a)' }} />
      </div>
      <span className="tabular text-[12px] font-semibold w-8 text-right">{r.count}</span>
      <span className="tabular text-[10.5px] text-text-muted w-9 text-right">{pct}%</span>
    </div>
  ))}
</div>
```

- `.tabular` (already in `tokens.css`) keeps the number columns aligned.
- Zero-count rows still render (a state with 0 items is information); bar width 0.
- **By assignee:** sorted by count desc; `assigneeId: null` renders last as a `muted`
  "Unassigned" row. `maxRows={8}` — beyond that a `Show all (N)` text button
  (`text-[12px] text-accent hover:underline`, plain page-local `useState`) expands
  in place. This list is plain text + divs, so it is screen-reader-readable as-is —
  no ARIA gymnastics needed.

### 2.3 `TrendChart` — the only recharts on the page

Page-local: `_components/trend-chart.tsx`, `'use client'`, memoized
(same `memo` reasoning as `ElementChartMemo`).

```tsx
interface TrendChartProps { data: { weekStart: string; created: number; completed: number }[] }
```

- **Grouped weekly bars, not lines** — bars stay legible with 1–2 data points
  (a brand-new workspace on `4w` has exactly one meaningful week; a line needs two).
- HTML legend above the chart (recharts `<Legend>` is banned, §gotchas):
  ```tsx
  <div className="flex items-center gap-4 px-4 pt-3 text-[11px] text-text-sub">
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--a)' }} /> Created
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} /> Completed
    </span>
  </div>
  ```
- Chart body:
  ```tsx
  <div className="h-[280px] px-2 pb-2" role="img"
       aria-label={`Created vs completed work items per week, ${data.length} weeks`}>
    <ResponsiveContainer width="100%" height="100%" debounce={50}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="weekStart" tickFormatter={fmtWeek} tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
               axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
               axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT_STYLE} labelFormatter={fmtWeekLong} cursor={{ fill: 'var(--bg-hover)' }} />
        <Bar dataKey="created"   name="Created"   fill="var(--a)"       radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
        <Bar dataKey="completed" name="Completed" fill="var(--success)" radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>
  ```
- `TT_STYLE` = the tooltip style constant from `element-chart.tsx` (`var(--bg-card)`
  background, `var(--border)` border, 6px radius) — lift it into a tiny local const;
  do not import across features.
- `fmtWeek` → "Jun 2" (`fmtDateShort` from `@/lib/format` if it fits, else local);
  `fmtWeekLong` → "Week of Jun 2".
- On `24w`, `interval="preserveStartEnd"` + `minTickGap` thins X labels automatically —
  no manual breakpoint logic.

---

## 3. Filters & URL search params

Both filters live in the header row (right-aligned, wrap under the title below `sm`).
They are **URL-first**: the URL is the state, shareable and refresh-safe.

| Param | Values | Default (omitted from URL) |
| ----- | ------ | -------------------------- |
| `project` | project `_id` | absent → All projects |
| `range` | `4w` \| `12w` \| `24w` | `12w` |

- Read with `useSearchParams()`; invalid `range` values coerce to `12w`; a `project`
  id not present in the current workspace's project list coerces to All projects
  (this also self-heals after a workspace switch leaves a stale id in the URL).
- Write with `router.replace` (+ `{ scroll: false }`), **never** `push` — toggling a
  filter must not pollute history (same rule as issue-peek close, spec §3.2). Defaults
  are deleted from the params, not written:
  ```tsx
  const setParam = (key: 'project' | 'range', value: string, def: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === def) next.delete(key); else next.set(key, value);
    router.replace(next.size ? `/analytics?${next}` : '/analytics', { scroll: false });
  };
  ```
  No component state mirrors — derive `projectId`/`range` from `params` every render.
- **Project filter:** the existing `Select` (`@/components/ui/select`) with
  `[{ value: '', label: 'All projects' }, ...projects.map(p => ({ value: p._id, label: p.name }))]`
  from `useProjects()` (already workspace-scoped). `aria-label="Filter by project"`.
- **Range selector — `RangeToggle`,** page-local segmented control (`Tabs` is for
  panel switching; this is a value picker):
  ```tsx
  <div role="radiogroup" aria-label="Time range"
       className="inline-flex items-center rounded-lg border border-border bg-bg-card p-0.5">
    {(['4w','12w','24w'] as const).map((r) => (
      <button key={r} type="button" role="radio" aria-checked={range === r}
        onClick={() => setParam('range', r, '12w')}
        className={cn(
          'h-[calc(var(--ctl-sm)-6px)] px-2.5 rounded-md text-[11.5px] font-medium transition-colors duration-[var(--dur)]',
          range === r ? 'bg-accent-50 text-accent-700' : 'text-text-muted hover:text-text hover:bg-bg-hover',
        )}>
        {r}
      </button>
    ))}
  </div>
  ```
  Arrow-key movement between radios is nice-to-have; the buttons are individually
  tabbable and Enter/Space works by default, which passes the bar for v1.
- Changing either filter refetches (`useQuery` key includes both). While refetching
  with previous data on screen, keep the old content and show a subtle busy hint
  (`opacity-60 transition-opacity` on the panels via `isFetching` + TanStack's
  `placeholderData: keepPreviousData`) — do **not** flash skeletons on every filter
  change; skeletons are for first load only.

---

## 4. Data hook (contract for `prism-frontend`)

```ts
// apps/web/src/hooks/use-analytics.ts
useWorkspaceAnalytics({ workspaceId, projectId?, range })  // range: '4w' | '12w' | '24w'
// → useQuery({ queryKey: ['analytics', workspaceId, projectId ?? '', range], enabled: !!workspaceId,
//              placeholderData: keepPreviousData })
```

One endpoint, one query — the whole page shares a single loading/error lifecycle.

---

## 5. States

### 5.1 Loading (first load only) — page skeleton

Mirror the real layout so nothing jumps (same technique as home's `PageSkeleton`):

```tsx
<div className="flex flex-col gap-5" aria-busy="true">
  <div className="flex items-end justify-between">
    <div className="space-y-2"><Skeleton className="h-6 w-32" /><Skeleton className="h-3.5 w-56" /></div>
    <div className="flex gap-2"><Skeleton className="h-[var(--ctl-sm)] w-44 rounded-lg" /><Skeleton className="h-[var(--ctl-sm)] w-32 rounded-lg" /></div>
  </div>
  <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
    {[0,1,2].map((i) => <div key={i} className="h-[90px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" style={{ animationDelay: `${i*55}ms` }} />)}
  </div>
  <div className="h-[340px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" />
  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
    {[0,1,2].map((i) => <div key={i} className="h-[240px] bg-bg-card border border-border rounded-xl animate-pulse opacity-50" style={{ animationDelay: `${i*80}ms` }} />)}
  </div>
</div>
```

The header row's real title can render immediately; only the filter controls are
skeletoned until the workspace/projects resolve.

### 5.2 Empty — no issues in scope

Trigger: `totals.open + totals.completed + totals.overdue === 0` **and** every trend
week is zero. Replace everything below the header (keep the filters — the emptiness
might be the project filter's fault) with `EmptyState` from `@prism/ui`:

```tsx
<EmptyState
  icon={<BarChart3 />}
  label={projectId ? 'No work items in this project yet' : 'No work items yet'}
  hint="Analytics will appear once work items are created in this workspace."
  action={<Button size="sm" onClick={() => router.push('/issues?new=1')}><Plus className="w-3.5 h-3.5" /> New task</Button>}
  className="py-20 bg-bg-card border border-border rounded-xl"
/>
```

### 5.3 Error

`isError` on the single query → replace everything below the header (filters stay
usable) with `@prism/ui`'s `ErrorState`:

```tsx
<ErrorState message="Couldn't load analytics." onRetry={() => refetch()}
            className="py-20 bg-bg-card border border-border rounded-xl" />
```

No partial-failure handling needed — one endpoint, all-or-nothing.

### 5.4 Sparse data (per-section, page not empty)

| Section | Sparse case | Rendering |
| ------- | ----------- | --------- |
| Trend | all weeks zero but totals non-zero (old backlog, no recent activity) | render the chart with the zero baseline visible (`YAxis domain={[0, 4]}` floor so it doesn't collapse) + centered overlay caption `No activity in this range` (`text-[12px] text-text-muted`) |
| Trend | 1–2 weeks | fine by design — grouped bars, no interpolation |
| By state / priority | some keys at 0 | zero-count rows still listed (§2.2) |
| By state / priority | API returns empty array | `No data for this range` — `px-4 py-6 text-[12.5px] text-text-muted text-center` |
| By assignee | everything unassigned | single muted "Unassigned" row — valid, informative |
| By assignee | empty array | same `No data for this range` line |

---

## 6. Reuse map — what is shared vs page-local

| Piece | Where | Action |
| ----- | ----- | ------ |
| `EmptyState`, `ErrorState`, `Skeleton`, `Avatar`, `Button`, `Select` | `@prism/ui` / `@/components/ui` | reuse as-is — **no new `packages/ui` primitives needed** |
| `KpiCard` (tone-mapped stat card) | today a private component in `apps/web/src/app/(app)/home/home-user.tsx` | **extract** to `apps/web/src/components/feature/dashboard/kpi-card.tsx`; home imports it back. Stays in apps/web (it renders `next/link` — routing is banned from `packages/ui`) |
| `Panel` (card + header chrome) | same file, same situation | **extract** to `apps/web/src/components/feature/dashboard/panel.tsx`; home imports it back |
| `STATUS_COLOR`, `PRIORITY_COLOR` raw color maps | new exports in `apps/web/src/components/feature/issue/pills.tsx` (§2.1) | add — keeps chart hues and pill hues in one file forever |
| `DistributionList`, `TrendChart`, `RangeToggle` | `apps/web/src/app/(app)/analytics/_components/` | page-local. Promote to shared only if a second consumer appears (e.g. project overview) — rule: extract on second use, don't speculate |
| `useWorkspaceAnalytics` | `apps/web/src/hooks/use-analytics.ts` | new, `prism-frontend` wires it |

**New shared tokens/utils needed: none.** Everything renders from existing
`tokens.css` vars (`--a`, `--success`, `--warning`, `--danger`, `--info`,
`--text-muted`, `--border`, `--bg-*`) and the existing `.tabular` utility, so dark
mode and accent themes work without any additions.

Not in `packages/ui` on purpose: the whole page is web-only (admin has its own
instance-level concerns; space is public read-only and must never see per-assignee
counts — rule #3, private-data leakage).

---

## 7. Responsive summary

| Breakpoint | KPI strip | Breakdown grid | Header |
| ---------- | --------- | -------------- | ------ |
| `< sm` (640) | 1 col | 1 col | filters wrap below the title, full-width `Select` |
| `sm–md` | 3 cols | 1 col | inline |
| `md–xl` | 3 cols | 2 cols (assignee panel wraps to row 2, full remaining width) | inline |
| `≥ xl` | 3 cols | 3 cols | inline |

Trend panel is full-width at every breakpoint; `ResponsiveContainer` handles the
chart resize (with `debounce={50}`, matching reports).

---

## 8. Build order & out of scope

Build order for `prism-frontend` (after the API contract lands):

1. Extract `KpiCard` + `Panel` from `home-user.tsx` → `components/feature/dashboard/`;
   home re-imports. Verify `pnpm --filter web build` before proceeding.
2. Add `STATUS_COLOR` / `PRIORITY_COLOR` exports to `pills.tsx`.
3. `use-analytics.ts` hook + `_components/` (DistributionList → RangeToggle → TrendChart).
4. `analytics/page.tsx` assembly + URL param wiring (§3) + sidebar entry.
5. Verify E2E against the seed workspace: default load → each range → project filter →
   deep-link with params → empty workspace → dark mode + non-default accent.

Out of scope for v1 (deliberate):

- KPI card click-through to filtered issue lists (blocked on the issues list encoding
  tab/overdue in its URL).
- Custom date ranges, CSV export, per-cycle/per-module cuts.
- Burndown / velocity (needs cycles — no cycles data model yet).
- Admin or space analytics surfaces — different tenancy and privacy rules; separate spec.
- A shared `SegmentedControl` primitive in `packages/ui` — promote `RangeToggle` when a
  second app needs one.
