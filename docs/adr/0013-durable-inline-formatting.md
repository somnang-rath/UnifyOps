# ADR 0013 — Rich formatting in the collab schema, and why it never uses bare inline `style`

- Status: Accepted (GATE — build against this)
- Date: 2026-07-27
- Scope: the canonical Tiptap extension array shared by `packages/editor` and
  `apps/live` (ADR 0001 §5, ADR 0009 §3), plus the `CollabToolbar` controls that
  drive it. Does not change auth, persistence, or the transport.
- Owners of build: `prism-realtime` (mirrored extension array + snapshot
  rendering), `prism-uiux`/`prism-frontend` (toolbar + CSS).

## Context

The collaborative editor's toolbar only exposed a subset of what a document
editor is expected to offer (no underline, color, highlight, alignment,
sub/superscript, undo/redo, or headings past H3). Widening it means adding marks
and node attributes to the schema — which, per ADR 0001 §5, must be mirrored in
`apps/live/src/editor-extensions.ts` or the formatting is dropped from the HTML
snapshot the live server writes back to `apps/api`.

While adding those extensions we hit a second, previously invisible failure:

- `prosemirror-model`'s `renderSpec` applies a `style` attribute by assigning
  `dom.style.cssText`, not by calling `setAttribute('style', …)`.
- `@tiptap/html` (used by `generateWikiHTML` on the live server) renders through
  **zeed-dom**, whose elements expose a `.style` object that accepts the
  assignment and silently discards it.

Net effect: **every inline `style` attribute vanishes from server-generated
snapshots**, while looking perfect in the browser. Nothing in the pre-existing
extension set emitted inline styles, so the bug had never been reachable. The
first three extensions that do — TextAlign, Color, Highlight — all lost their
formatting on the way to the database.

## Decision

1. **Extensions that express themselves through inline `style` must emit a
   `data-*` twin alongside it.** `TextAlign` and `Color` are wrapped
   (`DurableTextAlign`, `DurableColor`) with a `renderHTML` that returns both
   `style` and `data-text-align` / `data-color`, and a `parseHTML` that reads the
   data attribute first. `Highlight` already ships `data-color` in multicolor
   mode and needs no wrapper.

   The browser honours the inline style; the snapshot keeps the data attribute.
   Neither side has to know which renderer ran.

2. **CSS styles the `data-*` spelling**, in `packages/editor/src/collab.css`.
   Alignment maps exactly (3 rules). Colors cannot — CSS has no way to turn an
   arbitrary attribute value into a color — so the swatch palettes in
   `toolbar/ColorPopover.tsx` are mirrored as explicit rules. **Palette and CSS
   must be changed together**; a swatch with no rule still works while editing
   and loses its color once stored.

3. **The full formatting set is:** Underline, Highlight (multicolor), TextStyle +
   Color, TextAlign (heading/paragraph), Subscript, Superscript — on top of the
   ADR 0009 §3 set. Headings expose all six StarterKit levels. Undo/redo come
   from the Collaboration extension's Yjs `UndoManager` (StarterKit history stays
   disabled), so they are per-user and safe in a shared document.

4. **`apps/live` is not authoritative for any of this** — it keeps its
   byte-for-byte copy of the array for snapshot rendering only. Authorization
   remains unchanged (JWT verified locally, access decided by `apps/api`).

## Consequences

- Adding another style-emitting extension without the `data-*` treatment
  reintroduces the silent-drop bug. The rule is documented at the top of both
  copies of the extension array.
- Surfaces that render **stored** note/wiki HTML outside the editor (previews,
  `apps/space`) need the same `data-*` CSS to show colors and alignment. The
  editor itself is unaffected either way. This is not yet done for `apps/space`
  — notes are not publishable today, so nothing regresses; wire it up if/when
  they become publishable.
- Text color is effectively limited to the 9-swatch palette for stored content.
  Arbitrary colors (e.g. pasted from elsewhere) still render live and still
  round-trip as `data-color`; they simply have no CSS rule to restore them.
- Older documents predate `textAlign`; the attribute defaults to `left` and
  renders nothing, so existing content is untouched.

## Verification

- Snapshot renderer: a doc using every new mark/attribute round-trips through
  `generateWikiHTML` with all ten features intact.
- End-to-end: browser → Yjs → live snapshot → `apps/api`, read back as
  `<p data-text-align="center"><span data-color="#dc2626"><u><mark data-color="#fef08a">…</mark></u></span></p>`.
