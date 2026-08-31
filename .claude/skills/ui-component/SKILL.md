---
name: ui-component
description: Use when building or changing anything in src/components — a primitive like Button or Input, a view like Board or Table, an item card, an empty state, or a dialog. Carries the settled component specifications, the five-states requirement, and the accessibility baseline.
---

# Building a UI component

Three documents already decide most of what you are about to decide. Read the relevant row before inventing
anything: `references/component-specs.md` for the primitive you are building, `references/five-states.md`
for what the view owes the user, and the `design-tokens` skill for every colour and dimension.

## Order of work

1. **Find the spec.** If the component is in the §12 inventory, its sizes, variants, and behaviours are
   already settled — see `references/component-specs.md`. Implementing something different is a plan change,
   not a styling choice.
2. **Enumerate the five states first**, before the happy path. Loading, empty, success, error, edge. A view
   that ships with only the success state is not done — see `references/five-states.md`.
3. **Radix primitive underneath** anything with focus management, a popover surface, or a role: Dialog,
   Popover, Dropdown, Select, Tabs, Tooltip, Switch, Checkbox, Radio, ContextMenu. Do not hand-roll focus
   traps or `aria-expanded` wiring. Style it with semantic utilities; never fight its positioning.
4. **Tokens only** — `bg-surface`, `text-muted`, `border-border`. No hex, no ramp utilities, no `text-white`.
5. **Both locales**, from the first commit. See the `khmer-ui` skill.

## Inventory

Button · Input · Textarea · Select · Combobox · DatePicker · Checkbox · Radio · Switch · Avatar/Group ·
Badge · StatePill · PriorityIcon · LabelChip · Dropdown · ContextMenu · Dialog · Sheet · Popover · Toast ·
Tooltip · Tabs · Table · Skeleton · EmptyState · CommandPalette · Pagination · FilterBar · GroupBySelect.

Building something not on this list is fine, but check first that it isn't one of these under another name.
A second dropdown component is how a design system dies.

## Accessibility baseline — every component, not a later pass

- **Keyboard-operable throughout, including drag-and-drop.** The board is not shippable as mouse-only; a
  keyboard path to move an item between columns is part of the feature, not an enhancement.
- **Visible focus rings.** Handled globally by `:focus-visible` in `globals.css`. Never `outline: none`.
- **WCAG AA contrast** — 4.5:1 body text, 3:1 for ≥20px text and UI boundaries. Navy is the text blue; Sky
  fails on Ivory.
- **Labels and roles** come from Radix where a Radix primitive exists.
- **Every icon-only control has an accessible name** — an icon button with no `aria-label` is a defect.
- **`prefers-reduced-motion`** is respected globally in `@layer base`. Do not re-implement it per component,
  and do not add motion that ignores it.
- **Placeholders are never labels.** The label sits above the input at 12px.

## Composition rules

- Primitives in `src/components/ui/` know nothing about work items, tenancy, or the router. They take props
  and render.
- Anything that fetches, mutates, or reads `next/headers` is not a primitive. Put it in
  `src/components/work-item/` or `src/components/views/`.
- Server Components by default. `'use client'` only for interaction, and as deep in the tree as the
  interaction actually reaches — not on the page.
- Optimistic on mutate; a toast **only** when the result is not visible on screen.

## Before you call it done

- All five states exist and were each looked at.
- Tabbed through it start to finish without a mouse. Focus is visible at every stop and never lost.
- Toggled `.dark`. Everything moved.
- Opened it at `/km/…` with a long Khmer string in the tightest slot.
- No literal hex, no ramp utility, no `text-white`, no `outline: none`.
