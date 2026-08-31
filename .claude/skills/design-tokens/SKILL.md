---
name: design-tokens
description: Use when writing or reviewing any UnifyOps styling — picking a colour, adding a Tailwind class to a component, building a dark-mode variant, adding a new token, or checking contrast. Enforces the three-layer token architecture in src/app/globals.css and the rule that Navy, never Sky, is the text blue.
---

# Design tokens

`src/app/globals.css` is three deliberate layers. Components touch **only the third**.

| Layer | What lives there | Who may reference it |
| --- | --- | --- |
| 1. `@theme` | Raw ramps — `--color-sky-400`, `--color-ink-900`. Fixed hex, identical in both themes | Layer 2 only |
| 2. `:root` / `.dark` | Semantic aliases — `--accent`, `--text-muted`, `--surface`. **The only things that flip** | Layer 3 only |
| 3. `@theme inline` | Re-exposes layer 2 as utilities — `bg-surface`, `text-muted`, `border-border` | Components |

A component that reaches past layer 3 has hard-coded a light-mode assumption. Dark mode is a second token
set, not a rewrite — so if `.dark` has nothing to override, the component is already broken in dark mode.

## Picking a colour

Ask what the thing *is*, never what colour it should be.

| I need… | Utility | Never |
| --- | --- | --- |
| Page background | `bg-bg` | `bg-ink-50`, `bg-[#f2f0ed]`, `bg-white` |
| Card / panel | `bg-surface` | `bg-white` |
| Inset well, table stripe base | `bg-surface-sunken` | |
| Hover on a row or card | `bg-surface-hover` | an opacity hack over `bg-surface` |
| Body text | `text-text` | `text-black`, `text-ink-900` |
| Secondary text, metadata | `text-text-muted` | `text-gray-500`, `opacity-60` |
| Timestamps, counts, hints | `text-text-subtle` | |
| Text on a filled accent button | `text-accent-fg` | `text-white` |
| Primary action fill | `bg-accent` / `hover:bg-accent-hover` | `bg-sky-400` |
| Accent-tinted background | `bg-accent-subtle` | `bg-accent/10` |
| Any border | `border-border` | `border-gray-200` |
| Destructive | `bg-danger` `text-danger` `bg-danger-subtle` | `text-red-500` |
| Caution | `text-warning` `bg-warning-subtle` | Chartreuse — it reads as "go" |
| Done, healthy | `text-success` `bg-success-subtle` | any brand colour; the brand has no green |
| Focus ring | handled globally by `:focus-visible` | a per-component ring |

Semantic assignments already decided in PLAN §12 — do not re-derive them:

- **Priority** urgent · high · medium · low · none → `danger` · `warning` · `sky` · `ink-400` · `ink-300`
- **State group** backlog · unstarted · started · completed · cancelled → `ink-400` · `ink-500` · `warning` · `success` · `ink-400`
- **Blocked** → `bg-danger-subtle` with a `border-danger` border
- **Overdue** → `text-danger` on `bg-danger-subtle`

These are the one place a ramp value appears in a component's vicinity. Map them once, in a lookup beside
the enum, and have components read the map — never inline the ramp at a call site.

## The contrast rule

**Sky `#54A6DB` on Ivory is ~2.4:1 and fails WCAG AA for text.** Navy `#214775` is the text blue.
Sky is for fills, accents, focus rings, and large display text only.

In light mode `--accent` is Navy; in dark mode it flips to Sky, where the ground is Charcoal and Sky passes.
This is precisely why components must use `bg-accent` and not name either colour: the token already knows
which one is safe on the current ground.

## Adding a token

Only when nothing in layer 3 fits. Adding one means touching four places, in order:

1. `@theme` — add the ramp step, if the value is genuinely new.
2. `:root` — the light semantic alias.
3. `.dark` — the dark counterpart. Not optional. A token defined in one block only is the bug this layering exists to prevent.
4. `@theme inline` — expose it as `--color-<name>` so `bg-<name>` / `text-<name>` exist.

Then check the pair against its real ground for AA (4.5:1 body, 3:1 for ≥20px or UI boundaries).

## The seven brand colours are fixed

Sky `#54A6DB` · Navy `#214775` · Crimson `#FF5952` · Lilac `#BDA3CC` · Chartreuse `#C4D145` ·
Ivory `#F2F0ED` · Charcoal `#212E3B`. Marked `BRAND` in `globals.css`. §18-1 settled that UnifyOps inherits
the Unify family palette, so these are the brand's real values, not placeholders — changing one is a brand
decision, not a styling decision. Everything else in the file is derived and tunable.

`--success` and `--warning` are **additions**, not brand colours: the brand supplies no green, and Chartreuse
reads as "go" rather than "caution". They are harmonised to the palette but carry no brand authority.

## The logo is not inherited

Colours and typography come from `UnifyCharge_Brand_Assets/`. **The logo does not.** UnifyOps uses the
**parent Unify mark**; every asset under `02_Logos/` is UnifyCharge — a hexagon around a lightning bolt,
and the bolt means EV charging.

**That file is not in the repo.** Anything needing a mark — app header, favicon, auth pages, onboarding,
empty states, email templates — is blocked on it. Ask for it. Do not substitute a UnifyCharge logomark, do
not draw a placeholder that looks like a real mark, and do not set type in Plex and call it a wordmark.
A neutral gap or the product name in plain text is the correct stand-in until the asset arrives.

When it does arrive:

- **Recolour it.** The UnifyCharge SVGs are filled `#28A6DF`, which is not the palette's own Sky `#54A6DB`
  — the art drifted from the colour PDF. Whatever hex is baked into the Unify file, strip it: use
  `fill="currentColor"` and let the token decide, so the mark follows light and dark mode like everything
  else.
- **Give it an accessible name**, or mark it `aria-hidden` when the product name sits beside it. A logo
  that is both an image and a redundant label reads twice to a screen reader.
- **Inline the SVG** for anything above the fold rather than an `<img>`, so it cannot flash or reflow.

The favicon is a separate asset from the header mark and usually needs its own simplified artwork — a
full logomark scaled to 16px turns to mud. Ask for both.

## Also fixed

Spacing on a 4px scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
Radii: `4` inputs and chips · `6` buttons and cards · `8` panels · `12` dialogs.
Three elevations only — `shadow-sm` `shadow-md` `shadow-lg`. Not a fourth.
One motion curve `--ease-out-soft`; 120ms hover · 180ms panel · 240ms dialog. `prefers-reduced-motion` is
already handled in `@layer base` — do not re-implement it per component.

## Before you call it done

- `grep -n '#[0-9a-fA-F]\{3,8\}' <file>` returns nothing outside `globals.css`.
- No `bg-sky-*` / `text-ink-*` / `border-navy-*` ramp utility in a component.
- No `text-white` / `bg-white` / `text-black` / `text-gray-*`.
- Toggle `.dark` on `<html>` and look at it. Every surface, border, and text colour moved.
