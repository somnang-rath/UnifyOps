# Spec — Notes collaborative editor swap (ADR 0009)

Replaces the custom `blocks[]` editor on `apps/web` `/notes` with the shared
`CollaborativeEditor` (Tiptap + Yjs via `apps/live`), per the frozen contract in
`docs/adr/0009-notes-collab.md`. Gains presence (avatar stack + remote carets) and the
new shared-schema nodes: **TaskList/TaskItem, Table, Image, Link**.

**Repo reality check (affects the plan):** `CollaborativeEditor` exists in
`packages/editor` (Phase 2) but is currently mounted **nowhere** — the wiki route
(`apps/web/src/app/(app)/wiki/page.tsx`) uses `RichTextEditor` (markdown, manual save).
Notes is therefore the *first* production mount of `CollaborativeEditor`, and the
collab toolbar must be built in `packages/editor` — not in the notes route — so wiki
inherits it unchanged when it moves to collab. Do **not** copy toolbar code into
`apps/web` (architecture rule: shared → `packages/`).

**Split of responsibility:**

| Layer | What | Where |
| ----- | ---- | ----- |
| Schema | +8 extensions to the canonical array (and its live copy — backend/realtime task) | `packages/editor/src/extensions.ts` + `apps/live/src/editor-extensions.ts` |
| Toolbar | `CollabToolbar` (new, presentational, takes an `Editor`) + shared toolbar primitives extracted from `RichTextEditor` | `packages/editor/src/` |
| RTE additions | "Image by URL" button on the `full` variant only; `compact` byte-identical | `packages/editor/src/RichTextEditor.tsx` |
| Screen | Notes page rewrite: mount `CollaborativeEditor`, keep metadata chrome (title/emoji/tags/folders) on REST | `apps/web/src/app/(app)/notes/_components/notes-view.tsx` |
| Deleted | `block-editor.tsx`, slash-menu machinery in `constants.ts` | `apps/web/src/app/(app)/notes/_components/` |

Nothing new in `packages/ui` — the presence stack reuses the existing
`AvatarGroup`/`Avatar` (`packages/ui/src/primitives.tsx`, size `xs`).

---

## 1. The notes screen post-swap

Overall shell is **unchanged** (full-height card, top action bar, centered 760px
column, footer status line). What changes is the middle: `BlockEditor` →
`CollaborativeEditor`, plus presence + sync indicators in the chrome.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [tree] ································· [◉◉◉ +2] [● Synced] │ [tpl][★][📁]│  ← action bar
│                                                    [🗑][⬇] │ [S] │ [+📁][+📄][⛶][💾]
├────────────────────────────────────────────────────────────────────────────┤
│         (760px column)                                                     │
│   [emoji]  Title …                                              ← REST     │
│   #tag #tag  add tag…                                           ← REST     │
│   ┌──────────────────────────────────────────────────────────┐             │
│   │ Aa ▾ │ B I S ⌨ │ ⋮list ⋮1. ☑ ❝ ⌨⌨ │ 🔗 ⊞ 🖼 ― │ 📎 🙂     │ ← CollabToolbar (sticky)
│   ├──────────────────────────────────────────────────────────┤             │
│   │ [Table ▸ +col +col ✕col | +row +row ✕row | header | del] │ ← only when caret in table
│   ├──────────────────────────────────────────────────────────┤             │
│   │  editable surface (remote carets render here)   ← Yjs    │             │
│   └──────────────────────────────────────────────────────────┘             │
│   1,240 words · 6 min read                        ● Synced 14:32  ← footer │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Data split — what saves where

| Field | Transport | UI |
| ----- | --------- | -- |
| Content | Yjs → live → snapshot (`contentHTML`) | No save button. Sync pill + footer dot reflect `SaveState`. |
| title, emoji, tags, pinned, folderId | REST `PUT /notes/:id` (existing debounced autosave) | Save button (💾) stays but is **metadata-only**: enabled when meta-dirty, `Ctrl+S` flushes it. Tooltip: "Save details". |

The `dirty` flag and `AUTOSAVE_MS` debounce keep working, but the draft loses
`blocks` — it becomes `{ title, emoji, tags, pinned, folderId }` only.

### 1.2 Mount sequence (per ADR 0009 §3/§5/§7)

1. `useNote(activeId)` — `GET /notes/:id` (server lazily migrates `blocks[]` →
   `contentHTML` on this request; the client never knows).
2. In parallel, `useCollabToken({ fetchToken: () => api.post(`/notes/${id}/collab-token`) })`
   → `{ token, canWrite }`.
3. When **both** resolve, mount:

```tsx
<CollaborativeEditor
  key={activeId}                       // clean remount on note switch
  documentName={`notes:${activeId}`}
  wsUrl={process.env.NEXT_PUBLIC_LIVE_URL!}
  token={token}
  currentUser={{ id: me.id, name: me.name, color: userColor(me.id), avatar: me.avatar }}
  initialHTML={note.contentHTML}       // seed-if-fragment-empty, ADR 0001 §3
  editable={canWrite}
  placeholder="Start writing — use the toolbar for tasks, tables, images…"
  autofocus={canWrite}
  onPresenceChange={setPresence}
  onStatusChange={setStatus}
  onSaveStateChange={setSaveState}
  onReady={(e) => { editorRef.current = e /* word count, focus */ }}
  renderChrome={({ editor }) => (
    <>
      {!canWrite && <ReadOnlyBanner … />}       // §3.3
      {canWrite && <CollabToolbar editor={editor} onUpload={handleUpload} />}
    </>
  )}
/>
```

Presence/status/save land in the *host's* action bar and footer via the
`on*Change` callbacks — `renderChrome` only carries the banner + toolbar, because the
action bar lives outside the editor column.

### 1.3 Presence avatar stack

- **Placement:** action bar, right cluster, immediately **left of the sync pill**,
  both preceding the existing template/pin/move/delete buttons (so they're
  visible even at narrow widths — the buttons truncate first, presence doesn't).
- **Component:** `AvatarGroup` from `@prism/ui`, `size="xs"`, `max={4}`, `+N`
  overflow. Each avatar gets a 2px ring in the peer's `userColor` (matches their
  caret): wrapper `span` with `ring-2 rounded-full`, `style={{ '--tw-ring-color': u.color }}`.
- Tooltip per avatar = user name; group `aria-label={`${n} other ${n===1?'person':'people'} editing`}`.
- Self is excluded (already the `CollaborativeEditor` contract). Empty presence →
  render nothing (no "just you" chip — calm by default).

### 1.4 Connection / saving indicator

One pill in the action bar + the existing footer dot, both derived from
`(status, saveState)`:

| Condition | Pill | Footer dot/text |
| --------- | ---- | --------------- |
| token loading or `status='connecting'` | gray, spinner, "Connecting…" | gray · "Connecting…" |
| `connected` + `saveState='saved'` | none (pill hidden — quiet when healthy) | green · "Synced" |
| `connected` + `saving` | none | amber · "Syncing…" |
| `disconnected` (`saveState='offline'`) | amber, `CloudOff`, "Offline — reconnecting" | amber · "Offline — edits stored locally" |
| token fetch `error` | red, "Can't connect" + **Retry** (calls `refresh()`) | red · "Disconnected" |

Pill is `aria-live="polite"`. Never toast on transient disconnects; the provider
auto-reconnects. Metadata dirty state ("Saving details…") shows only in the footer
text, appended after the sync word.

---

## 2. Toolbar — `packages/editor`

### 2.1 Extract shared primitives (refactor, zero visual change)

Move out of `RichTextEditor.tsx` into `packages/editor/src/toolbar/`:

- `Btn`, `Sep`, `TCtl` (button/separator/table-control) — as-is.
- `LinkPopover` (text + URL inputs, Apply/Cancel, Enter-to-apply) — parameterized
  with `editor`; the RTE keeps its markdown `insertContent('[x](y)')` path for
  empty selections, the collab editor uses `setLink` + `insertContent` with a text
  node (no markdown ext in the collab schema — **do not** insert `[label](url)` there).
- `TableBar` (the contextual row/col/header/delete strip, shown when
  `editor.isActive('table')`) — as-is, both editors render it.
- **New** `ImageUrlPopover`: single URL input + optional alt text, Apply →
  `editor.chain().focus().setImage({ src, alt }).run()`. Validates `https?://`;
  disabled Apply otherwise. Same `data-rte-pop` outside-click/Escape wiring.

All keep the existing `prism-rich-*` classes from `rich-editor.css` so RTE renders
byte-identically after the refactor.

### 2.2 `RichTextEditor` variant changes (wiki inherits these)

`compact` — **unchanged.** It already exposes task list, link and table-insert
(these were never `full`-gated); leave them exactly as they are. No new buttons.

`full` — one addition: **Image by URL** (`ImagePlus` icon), placed in the insert
group right after Table, before Divider. Everything else (code block, divider,
callout, attach, emoji, contextual TableBar) is already there. That is the entire
"wiki toolbar pass" the ADR asked for — image upload already existed via 📎/paste;
this adds the no-upload path for hotlinked images.

### 2.3 New `CollabToolbar` (used by notes now, wiki-collab later)

`packages/editor/src/toolbar/CollabToolbar.tsx`, exported from the package index.
Presentational: operates only on the passed `Editor`; no fetching.

| Prop | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `editor` | `Editor \| null` | — | From `renderChrome` ctx; `null` → render disabled skeleton bar (fixed height, `aria-hidden`) so the layout never jumps. |
| `onUpload` | `(file: File) => Promise<UploadedAttachment \| null>` | — | Optional. Shows 📎; result inserts `setImage` (isImage) or a `Link`-marked text node. Same contract as RTE so `handleUpload` is shared. |
| `sticky` | `boolean` | `true` | `position: sticky; top: 0` inside the editor scroll container, `bg-bg-card` + bottom border. |
| `className` | `string` | — | — |

Button set (groups left→right, `Sep` between groups):

1. **Heading dropdown** — Normal / H1–H3 (collab schema uses StarterKit default
   levels; cap the menu at H3 to match note headings' `<h2>` migration scale).
2. **Marks** — Bold, Italic, Strikethrough, Inline code.
3. **Blocks** — Bullet list, Ordered list, **Task list** (`ListChecks`,
   `toggleTaskList`), Quote, Code block.
4. **Insert** — **Link** (LinkPopover), **Table** (`insertTable({rows:3, cols:2, withHeaderRow:true})`),
   **Image by URL** (ImageUrlPopover), Divider.
5. **Attach** (📎, only when `onUpload`) + Emoji (existing emoji popover — plain
   text insert, schema-safe).

Below the toolbar, `TableBar` renders when the caret is inside a table — identical
to the RTE behavior, giving the required row/col insert/delete + header toggle +
delete-table controls without bloating the main bar.

**Deliberately excluded from `CollabToolbar`:** Callout/box. Callouts are a
markdown-rendering convention (`> [!NOTE]` + `MarkdownView`); the collab schema
renders raw HTML with no admonition pass, so the button would produce literal
`[!NOTE]` text. Plain Quote covers the need; a real Callout *node* is deferred
(would also require the live-copy extension update — ADR consequence).

**Accessibility:** container `role="toolbar"` `aria-label="Formatting"`; toggle
buttons get `aria-pressed={active}`; popovers keep the existing Escape/outside-click
close; roving focus is out of scope for v1 (RTE doesn't have it either — keep parity,
note as debt).

**Overflow at narrow widths:** same policy as the RTE — `flex-wrap` onto a second
row (never horizontal scroll, never hidden buttons). Two refinements at container
width `< 560px` (CSS container query on `.prism-rich-toolbar`, or a `sm:` swap):
the heading dropdown label collapses to "Aa ▾" (fixed width), and group separators
hide (`Sep` gets `max-[559px]:hidden` equivalent) to buy back ~40px before wrapping.
Popovers must clamp within the viewport (`max-width: min(300px, calc(100vw - 24px))`).

---

## 3. States

### 3.1 Connecting (token or provider not ready)

- Toolbar: disabled skeleton bar (`editor=null` branch — fixed height).
- Body: `SkeletonText lines={6}` in the 760px column (same pattern as wiki's
  loading branch), `aria-busy="true"`.
- Pill "Connecting…". Title/tags inputs are **live immediately** (they come from
  the REST note) — only the content area skeletons.

### 3.2 Offline / reconnecting

- Editor **stays editable** — Yjs buffers locally and replays on reconnect
  (`SaveState 'offline'` semantics in `packages/editor/src/types.ts`).
- Amber pill "Offline — reconnecting" + footer "Offline — edits stored locally".
- Remote carets naturally freeze/disappear (awareness times out); presence stack
  empties. No modal, no toast, no disabling.
- Token-refresh failure while the socket is up: keep editing; `useCollabToken`
  already retries on a 30s cycle. Only a *rejected* connection (token invalid,
  access revoked → live closes the socket) shows the red "Can't connect" pill with
  Retry; body switches to a centered empty-state (`CloudOff` icon, "Connection to
  the collaboration server was lost.", Retry button).

### 3.3 Read-only (grant-based)

`canWrite=false` from the mint response. The screen must *explain why*, not just lock:

- `editable={false}`; **toolbar not rendered at all** (hidden, not disabled — a
  disabled toolbar implies a temporary condition). Remote carets remain visible;
  the user watches edits live.
- Banner (replaces the current generic one) at the top of the column —
  `Lock` icon, `bg-bg-subtle` row, same styling as today. Copy is derived
  client-side from data already on hand (`folder._access` is annotated on the
  folder list response; `note.ownerId` on the note):

| Condition | Banner copy |
| --------- | ----------- |
| `folder._access === 'read'` | "View only — you have read access to the folder **{folder.name}**." |
| `folder._access === 'upload'` and `note.ownerId !== me.id` | "View only — upload access lets you add your own notes to **{folder.name}**, but only its author can edit this one." |
| fallback (no folder info) | "View only — you don't have permission to edit this note." |

- Action bar: pin/move/delete stay disabled (existing `readOnly` wiring); Save
  (metadata) disabled; Export PDF **enabled**; presence + sync pill still shown
  (read-only connections still sync).
- The old REST-403-discovery path (`setReadOnly(true)` on failed autosave) is kept
  only as a fallback for the *metadata* autosave; content read-only is known up
  front from `canWrite` — no more "edit then get rejected".

### 3.4 First open of a legacy note (lazy migration)

**Invisible by design.** The migration happens inside the normal `GET /notes/:id`
(server-side, idempotent), so the client renders the standard Connecting state
(§3.1) and then seeds the empty fragment from `contentHTML`. **No** "migrating…"
copy, no special spinner, no toast — specifying this so nobody adds one. The only
acceptable difference vs. a modern note is a marginally slower first `GET`.
Guard: never mount `CollaborativeEditor` before the note query resolves —
`initialHTML` must be present at mount or a legacy note seeds empty.

### 3.5 Empty note

- Placeholder via the existing Placeholder extension:
  "Start writing — use the toolbar for tasks, tables, images…"
- No-note-selected state (nothing active) is unchanged from today
  (NotebookPen icon + "Select a note…" + New note button).

---

## 4. Legacy block-editor affordances — explicit disposition

Dropped **on purpose** in v1 (decision, not accident):

| Affordance | Fate |
| ---------- | ---- |
| Block color palette (12 swatches, `Palette` menu) | **Dropped** — ADR 0009 §3 accepted loss; existing colors do not survive migration. No TextStyle/Color extension. |
| Drag handles / block reordering (`GripVertical` DnD) | **Dropped** v1. No drag-handle extension in the shared schema. Revisit only as a shared-schema decision (affects wiki + live copy). |
| "+" insert-between-blocks menu | **Dropped** — replaced by the toolbar + StarterKit input rules (`#` heading, `-` list, `1.` ordered, `>` quote, ``` ``` ``` code). |
| Slash menu (`/`) | **Dropped** v1. Input rules + toolbar cover the set. A Tiptap suggestion-plugin slash menu is a good later add (client-only, schema-safe) — out of scope. |
| Video block (YouTube/Vimeo embed player) | **Degrades to a link** (ADR migration table); embedded-player node deferred. Pasting a video URL yields an autolink. |
| File block (per-block upload/download UI) | Migrates to a 📎 link paragraph. New uploads go through the toolbar 📎 (`onUpload`, same `/files/comment-upload` handler as wiki). |
| Per-block checkboxes (`check` blocks) | **Upgraded** — consecutive checks merge into a real TaskList on migration; task items are collaborative. |

Kept, re-wired:

- **Templates** — unchanged UX. Template creation still POSTs `blocks[]`; the
  lazy migration converts them on first open. (Cheapest path; if the create DTO
  later drops `blocks`, convert templates to HTML strings then.)
- **PDF export** — button stays; **remove** the pre-export draft flush (content no
  longer lives in a draft). Caveat inherited from the ADR: edits inside the
  snapshot debounce window may miss the PDF by a few seconds — accepted, matches wiki.
- **Word count / read time** — recompute from
  `editor.state.doc.textContent` on the editor's `update` event (throttled ~500ms),
  wired via `onReady`. `wordCount(blocks)` in `constants.ts` is deleted with the blocks.
- Fullscreen, compact header, tree popup, pin/move/delete, tags, emoji picker — untouched.

---

## 5. Change inventory (who builds what, where)

`packages/editor` (this design + `prism-frontend`):

1. `src/extensions.ts` — add `TaskList, TaskItem.configure({ nested: true }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, Image.configure({ inline: false, allowBase64: false }), Link.configure({ openOnClick: false })`
   (mirror `apps/live/src/editor-extensions.ts` — realtime task; both or neither).
2. `src/toolbar/` — extracted `Btn/Sep/TCtl`, `LinkPopover`, `TableBar`, new
   `ImageUrlPopover`, new `CollabToolbar` (props table §2.3). Export `CollabToolbar`
   from `src/index.ts`.
3. `src/RichTextEditor.tsx` — consume extracted primitives (no visual change);
   add Image-by-URL to `full` only.
4. `src/collab.css` — add prose styles for the new nodes (task list checkboxes,
   table borders/header, `img { max-width: 100%; border-radius: 6px }`), matching
   `rich-editor.css`'s look; plus sticky-toolbar background rule.

`apps/web` (`prism-frontend`):

5. `notes/_components/notes-view.tsx` — draft loses `blocks`; mount per §1.2;
   presence stack + pill in action bar; read-only banner per §3.3; footer per §1.4.
6. New tiny hook `useNoteCollab(noteId)` wrapping `useCollabToken` with the mint
   call (`POST /notes/:id/collab-token`) — app-side because it touches `api`.
7. Delete `block-editor.tsx`; strip `SLASH_OPTIONS`, `videoEmbedURL`, `wordCount(blocks)`
   from `constants.ts` (keep `TEMPLATES`, `EMOJIS`, `AUTOSAVE_MS`, `readTime`).
8. Reuse wiki's `handleUpload` (extract to `apps/web/src/lib/editor-upload.ts` so
   wiki + notes share it — it's app-specific, so it lives in web, not the package).

Out of scope here (other agents, per ADR): live accept-list/parser, internal
notes endpoints, migration util, mint endpoint, live extension copy.

## Verification (definition of done)

- `pnpm --filter @prism/editor build` + `pnpm --filter web build`.
- E2E with two browsers on one note: carets + avatar stack both ways; kill `apps/live`
  → offline pill, edits buffered, reconnect syncs; open a pre-migration seeded note →
  content appears with tasks/tables intact; read-grant user sees banner + no toolbar;
  RTE `compact` (issue comments) pixel-unchanged.
