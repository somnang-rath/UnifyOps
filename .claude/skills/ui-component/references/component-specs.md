# Component specifications

Settled in PLAN §12. These are decisions, not defaults — implementing something different is a plan change.

| Component | Specification |
| --- | --- |
| **Button** | Variants `primary` (Navy fill) · `secondary` (surface + border) · `ghost` · `danger`. Sizes 28 / 32 / 40px. Loading replaces the label with a spinner **at preserved width**, so nothing reflows |
| **Input** | 32px height, label above at 12px, help text below, error replaces help and sets `aria-invalid`. Required marked on the label. **Placeholders are never labels** |
| **Select / Combobox** | Type-ahead above 7 options. Multi-select shows chips with an overflow count. Arrows, Enter, Escape, Home/End |
| **Table** | 36px rows, sticky header, 1px separators, **no zebra**, right-aligned numerics, column widths persisted per saved view. Scrolls inside its own container |
| **Dialog** | 400 / 560 / 720px. Focus trapped and restored. Escape closes **unless there are unsaved changes**. Never nested |
| **Toast** | Bottom-right, 5s auto-dismiss, action slot for Undo, max 3 stacked |
| **Avatar** | 20 / 24 / 32px, initials fallback on a deterministic colour from user ID. Groups cap at 3 + `+N` |
| **Icons** | Lucide, 16px inline / 20px standalone, 1.5px stroke, always with a label or accessible name |
| **Item card** | ID · title (2-line clamp **by grapheme, not character**) · assignee avatars · priority icon · due date · label chips · blocked badge · sub-item count |

## Details that are easy to get wrong

**Button loading.** Measure and pin the width before swapping the label for the spinner. A button that
shrinks mid-submit moves everything beside it, and on a toolbar that is every other control.

**Input error.** The error message *replaces* help text rather than appearing below it — otherwise the field
grows and the form reflows on the user's mistake. Set `aria-invalid` and point `aria-describedby` at the
message.

**Table.** No zebra striping: rows already carry state colour (blocked, overdue) and stripes fight it. Right-
align numerics so digits line up — this is why `numberingSystem: 'latn'` matters even in Khmer, since Khmer
numerals have different advance widths.

**Dialog escape.** With unsaved changes, Escape must not discard silently. Confirm, or refuse and say why.
Never nest dialogs — if a dialog needs a dialog, the first one should have been a page or a sheet.

**Avatar colour** is derived deterministically from the user ID, so the same person is the same colour
everywhere and across sessions. Hash the ID, index the palette. Never random, never assigned on first render.

**Item card title** clamps to two lines by **grapheme**. CSS `line-clamp` handles the visual case correctly;
reach for `Intl.Segmenter` only when the string is shortened in data. See the `khmer-ui` skill.

## Type scale

11 / 12 / 14 / 16 / 20 / 24 / 32 / 40. The brand defines none, so this is ours.

| Role | Latin | Khmer | Size / weight |
| --- | --- | --- | --- |
| Page title | Plex Sans Condensed | Koh Santepheap Bold | 32 / 600 |
| Section heading | Plex Sans Condensed | Koh Santepheap Bold | 20 / 600 |
| Body, UI default | IBM Plex Sans | Kantumruy Pro | 14 / 400 |
| Item title in list | IBM Plex Sans | Kantumruy Pro | 14 / 500 |
| Meta, labels | IBM Plex Sans | Kantumruy Pro | 12 / 400 |
| Micro (counts, IDs) | IBM Plex Sans | — | 11 / 500 |

UI default is **14px**, not 16 — set on `body` in `globals.css`. Khmer lines set at `line-height: 1.75`.

## Spacing, radius, elevation, motion

Spacing on a 4px scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
Radii: `4` inputs and chips · `6` buttons and cards · `8` panels · `12` dialogs.
Three elevations only. One motion curve; 120ms hover · 180ms panel · 240ms dialog.
