---
name: khmer-ui
description: Use whenever UI text touches both languages — adding a string, a font stack, a date or number format, truncating a title, rendering user content, or building a search input. Covers en.json/km.json parity, pinned Latin digits, font-stack order, line-height, grapheme truncation, and what must never be translated.
---

# Bilingual UI

English and Khmer ship together or not at all. Khmer is never the degraded path. PLAN §13 calls retrofitting
this the most expensive mistake available on the project, so the rules below are load-bearing, not stylistic.

## Adding a string

1. Add the key to **both** `src/i18n/messages/en.json` and `km.json`, in the same namespace, in the same
   position. A key in one file and not the other is a defect, not a TODO — nothing catches it at runtime
   except a Khmer user seeing a raw key.
2. Never concatenate translated fragments. Use ICU placeholders: `"assigned": "{name} assigned this to {who}"`.
3. Never build a message key from a database value. See "no key reaches the database" below.

Verify parity before finishing:

```bash
node -e "const a=require('./src/i18n/messages/en.json'),b=require('./src/i18n/messages/km.json');const k=o=>Object.entries(o).flatMap(([x,v])=>typeof v==='object'?k(v).map(s=>x+'.'+s):[x]).sort();const A=k(a),B=k(b);const d=[...A.filter(x=>!B.includes(x)).map(x=>'km missing '+x),...B.filter(x=>!A.includes(x)).map(x=>'en missing '+x)];console.log(d.length?d.join('\n'):'parity ok — '+A.length+' keys')"
```

## What gets translated, and what never does

| Content kind | Handling |
| --- | --- |
| **System strings** — labels, buttons, empty states | Message catalogues per locale |
| **User content** — project names, item titles, comments | **Never translated.** Stored and rendered exactly as entered |
| **Seeded defaults** — the six state names, default labels, the "General" team | The awkward middle. Row carries an `i18n_key` column, renders translated until the user renames it — at which point the key clears and the literal wins |
| **Closed enums** — priority, state group | Mapped to messages **in code**, via an exhaustive `Record<Enum, MessageKey>` |

**No translation key ever reaches the database.** A key stored in a row is a schema change disguised as a
string, and it breaks the moment the catalogue is refactored. The `i18n_key` column on seeded rows is the one
sanctioned exception, and it is one-way: once cleared by a rename, it never comes back.

## The four Khmer traps

**Digits.** The `km` locale otherwise renders `០១២៣`, which nobody wants in a task list or a due date.
`numberingSystem: 'latn'` is pinned for both locales in `src/i18n/request.ts`. **Any new `formats` entry needs
it too** — a new date or number format added without it silently reintroduces Khmer numerals.

**Line breaking.** Khmer has no inter-word spaces; the browser needs to be told which ICU rules to apply.
Mark the content subtree `lang="km"` so it follows the *content*, not the layout. This is also what triggers
`:lang(km) { line-height: 1.75 }` in `globals.css` — Khmer stacks diacritics vertically and clips at Latin
line heights. A Khmer title inside a container marked `lang="en"` will clip its diacritics.

**Truncation.** Character slicing splits grapheme clusters and produces broken glyphs. Never `.slice()`,
never `substring`, never a bare `text-ellipsis` on content you also measure in JS.

```ts
export function truncateGraphemes(text: string, max: number, locale: string) {
  const seg = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  const g = [...seg.segment(text)];
  return g.length <= max ? text : g.slice(0, max).map((s) => s.segment).join('') + '…';
}
```

CSS `line-clamp` is safe and preferred where the clamp is purely visual — the item-card 2-line clamp is CSS.
Reach for `Intl.Segmenter` when a string must be shortened *in data*: notification previews, tooltips,
document titles, anything sent to an API.

**Search.** Word-based full-text search fails on Khmer. `tsvector('simple')` for Latin, `pg_trgm` for Khmer,
routed by script detection on the query. U+200B zero-width spaces are preserved in stored text and stripped
before indexing — so an input component must never normalise them away on the way in.

## Font stacks

The Khmer face sits **after** the Latin face in every stack, so it is only reached by Khmer codepoints:

```css
--font-sans: var(--font-plex-sans), var(--font-khmer), system-ui, sans-serif;
--font-display: var(--font-plex-condensed), var(--font-khmer), system-ui, sans-serif;
```

Put the Khmer face first and it renders Latin text in a face with no Latin coverage worth using. §18-2 settled
the split: **Koh Santepheap** is display-weight — headings and display only; **Kantumruy Pro** carries body
text, where at 12–14px it is materially more legible.

Khmer is **left-to-right**. There is no RTL requirement anywhere in this product; do not add `dir` handling.

## Routing

`localePrefix: 'always'` — every URL carries `/en/…` or `/km/…`, including the default locale. There is no
"default locale has no prefix" case, and adding one breaks the middleware matcher and every `Link`.
Locale resolves URL → saved preference → `Accept-Language` → `en`.

Use the wrappers from `src/i18n/navigation.ts` (`Link`, `useRouter`, `redirect`), never `next/link` or
`next/navigation` directly — the plain ones drop the locale prefix.

## Before you call it done

- Both catalogues have the key; the parity check above is clean.
- The view was actually opened at `/km/…` and looked at — not just at `/en/…`.
- Long Khmer strings were pasted into the tightest cell in the view (table cell, board card, sidebar) and
  wrap rather than overflow.
- Nothing in the diff slices a string by character index.
- Any new `formats` entry carries `numberingSystem: 'latn'`.
