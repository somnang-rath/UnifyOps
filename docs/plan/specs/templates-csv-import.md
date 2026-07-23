# Spec — Issue templates & CSV import (Phase 8)

Hand-off target: `prism-frontend` (apps/web) and `prism-backend` (`templates`
module + bulk import endpoint). Reference patterns: the issue create modal
(`apps/web/src/components/feature/issue/issue-modal.tsx`), the project settings
section pattern (`apps/web/src/app/(app)/[workspaceSlug]/projects/[id]/settings/page.tsx`),
and `@prism/ui` `Modal` / `Table` / `Badge` / states.

Both features are **web-only**. No new `packages/ui` components are required —
everything composes existing primitives; see §4 for the audit.

---

## 1. Data contract

```ts
interface IssueTemplate {
  _id: string;
  name: string;                 // "Bug report", "Design task"
  workspaceId: string;
  projectId: string | null;     // null ⇒ workspace-scoped (visible in every project)
  ownerId: string;
  defaults: {
    desc: string;
    type: string;               // ISSUE_TYPES member
    priority: string;           // ISSUE_PRIORITIES member
    labels: string[];
    todos: { id: string; text: string; done: false }[];
  };
  updatedAt: string;
}
```

Endpoints: `GET /templates?projectId=…` (returns project templates **plus**
workspace templates for that project's workspace, project ones first),
`POST /templates`, `PATCH /templates/:id`, `DELETE /templates/:id`.
Write gate: project templates → project owner/member; workspace templates →
workspace member (create) / owner-or-author (edit/delete). Hooks:
`use-templates.ts` mirroring `use-views.ts` (query key `['templates', scope]`,
toast on mutate, invalidate on success).

CSV import: `POST /issues/import`
`{ projectId: string, rows: ImportRow[] }` → `{ created: number, skipped: { row: number, reason: string }[] }`
where `row` is the 1-based CSV **data** row number (header excluded).

```ts
interface ImportRow {
  title: string;                 // required — rows without it are client-rejected
  desc?: string;
  status?: string;
  priority?: string;
  labels?: string[];             // split on ';' or ',' client-side
  dueDate?: string;              // ISO yyyy-mm-dd after client normalization
  assigneeEmail?: string;        // server resolves to a user; unknown → skip reason
}
```

Server-side cap: 500 rows (413/400 beyond it) — the client also enforces it (§3.5).

---

## 2. Templates manager (project settings)

### 2.1 Placement & layout

New section **"Issue templates"** in project settings, between **Members** and
**Danger zone**, using the established section grammar (`h2
text-[15px] font-semibold mb-3` + `bg-bg-card border border-border rounded-lg`
card). Visible to all project members; mutation affordances follow the write
gate (§1).

```
Issue templates
┌────────────────────────────────────────────────────────────────┐
│ Bug report            [Workspace]   task · high · 2 labels  ✎ 🗑 │
│ Design handoff                      task · medium · 3 todos ✎ 🗑 │
│ ────────────────────────────────────────────────────────────── │
│ [+ New template]                                               │
└────────────────────────────────────────────────────────────────┘
Templates pre-fill new work items. Workspace templates are available
in every project.                                    ← text-[11px] text-text-muted mt-2
```

Row anatomy (`flex items-center gap-3 px-4 py-3 border-b border-border
last:border-b-0`):

- name — `text-[13px] font-semibold truncate`
- scope — `Badge size="xs" variant="outline"` "Workspace" only when
  `projectId === null` (project scope is the default; don't badge it)
- defaults summary — `text-[11px] text-text-muted truncate`, composed from
  non-empty parts: `type · priority · N labels · N checklist items · has description`
  (skip empty parts; all-empty ⇒ "no defaults")
- actions (right, visible on row hover + always on focus): icon buttons
  `Pencil` (aria-label "Edit template {name}") and `Trash2` (aria-label
  "Delete template {name}"), `w-6 h-6` hover pattern copied from the member
  remove button. Hidden entirely when the user lacks the write gate.

Footer row: `[+ New template]` full-width ghost row, exact same pattern as
"Add member" (`w-full flex items-center gap-2 px-4 py-3 text-[13px]
text-text-muted hover:text-text hover:bg-bg-hover`).

### 2.2 Create/edit modal — `TemplateModal`

`apps/web/src/components/feature/template/template-modal.tsx`. `@prism/ui`
`Modal size="lg"`, title "New template" / "Edit template", footer
Cancel (ghost) + Save (primary, disabled while pending or name empty).

```ts
interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  template?: IssueTemplate | null;   // present ⇒ edit mode
  projectId: string;                 // the settings page's project
  workspaceId: string;
  /** Whether the current user may create workspace-scoped templates. */
  canScopeWorkspace: boolean;
}
```

Body (`flex flex-col gap-3.5`, reusing `Field`/`Input`/`Textarea`/`Select` from
`@/components/ui/*` exactly as `issue-modal.tsx` does):

1. `Field "Template name" required` — `Input autoFocus` ("e.g. Bug report").
2. `Field "Scope"` — `Select`: `This project` (default) / `Whole workspace`
   (option hidden when `!canScopeWorkspace`; locked to current scope in edit
   mode with a `hint="Scope can't change after creation"` and disabled Select —
   moving a template between scopes changes who sees it, out of v1).
3. Two-column grid: `Field "Type"` + `Field "Priority"` — Selects over
   `ISSUE_TYPES` / `ISSUE_PRIORITIES` (labelized, as in issue-modal).
4. `Field "Description"` — `Textarea rows={4}` ("Pre-filled description…").
5. `Field "Labels" hint="(comma-separated)"` — `Input`.
6. **Checklist** — lift the checklist block from `issue-modal.tsx`
   (add/toggle/remove + Enter-to-add) into a shared feature component
   `apps/web/src/components/feature/issue/todo-checklist.tsx`
   (`{ todos, onChange }`) and use it in both modals — do not fork the markup.
   Progress bar hidden here (`showProgress={false}` prop): templates define
   items, not completion.

Delete: `Confirm` dialog ("Delete template — work items created from it are
not affected.", `danger`).

### 2.3 States

| State | Rendering |
| --- | --- |
| Loading | 3 skeleton rows in the card (`Skeleton className="h-4 w-40"` + `h-3 w-56` per row). |
| Empty | In-card `EmptyState` (`label="No templates yet"`, `hint="Templates pre-fill new work items with a description, priority, labels and a checklist."`, action = the New template button) — the footer row is then omitted. |
| Error | In-card `ErrorState` with retry (refetch). |
| Mutation pending | Save button disabled + `Spinner`; row actions disabled. |

---

## 3. "Use template" picker (issue create modal)

### 3.1 Placement

Inside `IssueModal`, **create mode only** (`!issue?._id`), rendered as the first
element above the Title field. Edit mode never shows it.

```
┌ New task ──────────────────────────────── ┐
│ [▤ Start from a template… ▾]   (right-aligned, only if templates exist) │
│ Title*  [                              ]  │
│ …existing fields unchanged…               │
```

- Control: the existing `Select` (`inline` variant, as the wiki header uses)
  with `aria-label="Start from a template"`. Options:
  `{ value: '', label: 'Start from a template…' }` + one per template, project
  templates first, workspace ones suffixed ` · workspace`.
- Templates load via `useTemplates({ projectId: watch('projectId') })` —
  re-query when the Project select changes; picker hidden while no project is
  chosen or the list is empty (zero-clutter default; no skeleton — it appears
  when ready).

### 3.2 Apply semantics

Selecting a template fills **defaults-owned fields only**:
`desc`, `type`, `priority`, `labelsRaw` (joined `', '`), and `todos`
(cloned with fresh ids, `done: false`). It **never** touches `title`,
`status`, `projectId`, `assigneeId`, `dueDate`.

- Implementation: `setValue` per field with `{ shouldDirty: true }` +
  `setTodos` — not `reset()`, so untouched fields survive.
- If any defaults-owned field is already non-empty/dirty, applying overwrites
  it — guard with the existing `Confirm` ("Replace the description, priority,
  labels and checklist with this template's defaults?") only in that dirty
  case; clean form applies instantly.
- Re-selecting `''` does nothing (it is a placeholder, not an "undo").
- The user edits freely afterwards; submit is unchanged — templates are a
  client-side pre-fill, the create payload carries no `templateId`.

### 3.3 Accessibility

Select is labelled; after apply, focus moves to the Title input (the next
thing the user must type) and a polite `aria-live` region announces
"Template applied". The dirty-overwrite Confirm is the existing accessible
dialog.

---

## 4. CSV import dialog

### 4.1 Entry point

`/[workspaceSlug]/issues` toolbar: an outline Button `[Upload] Import`
next to New task (icon-only below `md`, `aria-label="Import work items from CSV"`).
Opens `CsvImportDialog` (`apps/web/src/components/feature/import/csv-import-dialog.tsx`).

```ts
interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Preselected when the page has a project filter applied. */
  defaultProjectId?: string;
}
```

Parsing: client-side with **papaparse** (new dependency, apps/web only —
~7 kB, battle-tested quoting/encoding handling; do not hand-roll CSV).

### 4.2 Structure — a 4-step wizard in one `Modal size="lg"`

Title: "Import work items". Below the Modal header, a step indicator —
local component, plain text, not a new primitive:

```
1 File  ›  2 Map columns  ›  3 Preview  ›  4 Done
```

(`nav aria-label="Import steps"`, `<ol>` of steps; current step
`text-text font-medium aria-current="step"`, others `text-text-muted`;
separators `aria-hidden`. Steps are **not** clickable — Back buttons navigate.)

Footer is step-owned (Modal `footer` prop swaps per step).

#### Step 1 — File

- `Field "Project" required` — Select of workspace projects
  (default `defaultProjectId`). Import always targets one project.
- Drop zone: `border border-dashed border-border rounded-lg py-10 text-center
  hover:bg-bg-hover` wrapping a visually-hidden `<input type="file"
  accept=".csv,text/csv">` + label "Drop a CSV here or **browse**"; also
  accepts drag-and-drop. `text-[11px] text-text-muted` line:
  "First row must be column headers · up to 500 rows".
- On file select: parse immediately (header row on). Success advances to
  Step 2 automatically. Failures stay on Step 1 with an inline `ErrorState`-style
  message under the zone (`role="alert"`, `text-red text-xs`):
  - **Parse error** → "Couldn't read this file as CSV: {papaparse message} (row N)".
  - **Empty file** (no data rows) → "This file has headers but no rows." /
    "This file is empty."
  - **>500 rows** → "This file has {n} rows — the limit is 500 per import.
    Split the file and import in batches." (hard block, no partial import).
- Footer: `Cancel`.

#### Step 2 — Map columns

Two-column mapping list (`@prism/ui` `Table`, dense):

| Field | CSV column |
| --- | --- |
| Title * | `[Select: headers…]` |
| Description | `[Select: — skip — / headers…]` |
| Status | … |
| Priority | … |
| Labels | … |
| Due date | … |
| Assignee email | … |

- Target fields are the fixed rows (stable order above); each row's Select
  lists `— skip —` + every CSV header (headers shown verbatim, truncated at
  ~32 chars with `title` attr). Each Select labelled by its row
  (`aria-label="CSV column for Title"`).
- **Auto-mapping** on entry: case-insensitive fuzzy match of headers
  (`title|name|summary` → title, `desc|description|body` → description,
  `status|state|column` → status, `priority` → priority, `label|labels|tags`
  → labels, `due|due date|deadline` → dueDate, `assignee|email|owner` →
  assigneeEmail). One header maps to at most one field (first match wins);
  the user can override anything.
- Helper copy under the table (`text-[11px] text-text-muted`):
  "Labels may be separated by commas or semicolons. Dates are read as
  YYYY-MM-DD (other formats are attempted). Unknown statuses become *todo*,
  unknown priorities *medium* — the preview shows the result."
- Footer: `Back` (ghost) · `Continue` (primary, disabled until Title is mapped).

#### Step 3 — Preview

- Summary line: "**{n} rows** will be imported into **{project name}**." +
  when some rows were client-rejected: "{k} rows have no title and will be
  skipped." (`text-amber`).
- `@prism/ui` `Table` of the **first 10 mapped rows** (post-normalization:
  labels split, dates ISO-ified, statuses/priorities coerced with fallback),
  columns = mapped fields only. Wrapper `max-h-[320px] overflow-auto
  border border-border rounded-md`. Cell truncation with `title` attr.
  Coerced values render with a subtle `text-amber` (e.g. an unrecognized
  priority shown as "medium"), so surprises appear before import, not after.
- ">10" note: "Showing the first 10 of {n} rows."
- Footer: `Back` · `Import {n} rows` (primary).

#### Step 3→4 — Importing (transient)

Footer buttons disabled; primary shows `Spinner` + "Importing…". Body dims
(`opacity-60 pointer-events-none`). Closing is blocked while in flight
(ignore backdrop/Esc — a half-acknowledged bulk write is worse than a 5-second
wait). One request, no per-row progress in v1.

#### Step 4 — Result

- **Full success**: centered success block — `CheckCircle2` icon (`text-green
  w-6 h-6`), "**{created} work items created.**", footer `Done` (primary,
  closes + the issues list refetches via query invalidation).
- **Partial success** (`skipped.length > 0`): same created line, then
  "{skipped.length} rows were skipped:" and a scrollable `Table`
  (`max-h-[280px]`): columns **Row** (CSV data-row number, `tabular-nums`) ·
  **Reason** (verbatim server reason, e.g. "no user with email
  bob@nowhere.test", "title exceeds 300 characters"). Footer: `Done`.
- **Request failed** (network/500): `ErrorState` ("Import failed — nothing was
  created.") with `Retry` (re-fires the same payload) · footer `Back` · `Close`.
  The backend must make this truthful: the import endpoint is
  all-rows-attempted, per-row skip, never half-crashed.

### 4.3 State machine (for the implementer)

```
idle(file) ─parse ok→ map ─continue→ preview ─import→ importing
   │  ↑                                  │                 │
   │  └── parse error / empty / >500 ────┘ (Back)     ok → result(created, skipped)
   └ Cancel/Esc closes (any step except importing)    err → error(retryable)
```

Re-opening the dialog resets to Step 1 (no draft persistence — a CSV re-pick
is cheap; state lives in the component, not a store).

### 4.4 Accessibility

- Wizard lives in the existing `Modal` (focus trap, Esc, labelled by title).
- Step changes: move focus to the step's first interactive control (Project
  select / first mapping Select / Import button / Done button) and announce
  via a polite `aria-live` region ("Step 2 of 4, Map columns").
- Drop zone: real `<label>` + file input, keyboard-operable (Enter/Space opens
  the picker); drag-and-drop is an enhancement, never the only path.
- Errors: `role="alert"`; skipped-rows table has a caption
  ("Skipped rows and reasons") for screen readers.
- All disabled buttons carry visible textual causes nearby (e.g. Continue
  disabled ⇒ the Title row shows "required").

---

## 5. packages/ui audit — nothing new

| Candidate | Verdict |
| --- | --- |
| Step indicator | Local to the dialog. One consumer, ~20 lines, presentational `<ol>`. Promote to `packages/ui` only if admin grows a wizard. |
| File drop zone | Local. Single consumer; a shared one would need upload-strategy props nobody else uses yet. |
| `TodoChecklist` | `apps/web/src/components/feature/issue/` (shared **within** web by issue-modal + template-modal; no second app uses it → stays out of `packages/ui`). |
| Everything else | Existing: `Modal`, `Table`/`THead`/`TBody`/`TRow`, `Badge`, `Field`/`Input`/`Textarea`/`Select`, `Confirm`, `EmptyState`/`ErrorState`/`Skeleton`, `Spinner`, `Tooltip`. |

New shared types: `IssueTemplate`, `ImportRow`, and the import result shape go
in `packages/types` (consumed by `apps/api` + `apps/web`).

New dependency: `papaparse` (+ `@types/papaparse`) in **apps/web only**.
