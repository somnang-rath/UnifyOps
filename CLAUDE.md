# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: the plan is the product, the code is a scaffold

`PLAN.en.md` / `PLAN.km.md` are the specification and carry far more weight than the ~10 source files that
exist. Both are stamped **"For review · Not approved for build"**, and `PLAN.md` closes with *"Nothing will
be built until you say so."* Treat feature implementation as gated on explicit approval — answer questions
and refine the plan freely, but do not start building slices unasked.

What actually exists is **slice 0 plus part of slice 4**: the i18n scaffold, the design-token layer, and one
placeholder home page. `src/server/` and `drizzle/` are absent, so `db:generate`, `db:migrate`, `db:seed`,
and `db:studio` all fail today — they are wired for a `src/server/db/` that has not been written. Nothing is
broken; it simply hasn't been built yet.

**Verified working as of 2026-08-31:** `pnpm install`, `typecheck`, `lint`, `test`, `build`, and `test:e2e`
all pass. Two dependency versions in `package.json` did not exist (`eslint@^9.40.0`, `@types/react-dom@^19.2.8`)
and blocked `install` entirely; both are corrected. The repo is now under git, and CI runs typecheck/lint/unit,
e2e in both locales, and a tenancy job that stays inert until slice 1 lands a schema.

## Commands

Package manager is **pnpm** (per the plan's slice-0 definition of done); Node >= 22. No lockfile is
committed yet.

| | |
| --- | --- |
| `pnpm dev` | Next dev server |
| `pnpm build` / `pnpm start` | Production build (`output: 'standalone'`) and serve |
| `pnpm typecheck` | `tsc --noEmit` — the fastest real signal in this repo right now |
| `pnpm lint` | ESLint 9 flat config; bans `next/link` and `DATABASE_URL_OWNER` in `src/` |
| `pnpm test` / `pnpm test:watch` | Vitest — unit only, `src/**`; e2e is excluded |
| `pnpm test -- <pattern>` | Single file or test-name pattern |
| `pnpm test:e2e` | Playwright, three projects: `en`, `km`, `mobile-km` |
| `pnpm test:tenancy` | Cross-workspace read suite. Empty until slice 1 |
| `pnpm db:setup` | One-time: create the database and both roles. Prompts for the superuser password |
| `pnpm db:generate` | Drizzle migration from `src/server/db/schema/index.ts` |
| `pnpm db:migrate` / `pnpm db:seed` | `tsx` scripts under `src/server/db/` |

Postgres 18.4 is installed locally and listening on 5432 with `scram-sha-256` on every line of `pg_hba.conf`.
The `unifyops` database and its two roles **do not exist yet**: run `pnpm db:setup` once. That reads the
generated role passwords out of `.env` and hands them to `scripts/bootstrap.sql` as psql variables, so no
secret lands in the SQL or in shell history; psql prompts for the superuser password. Nothing
database-shaped works before that.

## The one architectural rule that everything else hangs off

**Two database roles, and they are not interchangeable.**

- `DATABASE_URL_OWNER` — owner role. **Migrations and `drizzle-kit` only.** Bypasses RLS.
- `DATABASE_URL` — non-owner application role with `FORCE ROW LEVEL SECURITY` on every tenant table. This
  is the only connection the running app may use.

Tenant isolation is Postgres RLS, deliberately *not* a remembered `WHERE` clause, because a scoped
data-access layer fails the moment one query is written outside it and that query is invisible in review.
RLS turns the failure mode from "returns another company's data" into "returns nothing". Every tenant table
also carries a denormalized `workspace_id` held honest by composite foreign keys, so a row physically cannot
reference a parent in another workspace.

If you ever find yourself reaching for the owner connection at runtime to make something work, that is the
bug — not the RLS policy.

Supporting mechanisms, all specified in `PLAN.en.md` §8–§9:

- `withActor(ctx, fn)` opens the transaction, sets **transaction-local** tenancy variables (so a pooled
  connection cannot leak scope across requests), builds a unit of work, and flushes events **before commit**.
- The Drizzle handle is a **branded type**; repositories accept nothing else.
- Events fan out to an activity-projector registry that is **exhaustive over the event union** — adding an
  event type without deciding its activity-feed rendering is a compile error — and to a transactional outbox
  consumed by pg-boss.
- The list query is one Zod filter DSL, one builder, two queries (counts + `LATERAL` per-group page, because
  a board needs a page *per column*). Keyset cursors only; an `invariant` refuses to emit an unanchored
  workspace-wide scan.
- Board ordering: the client sends **neighbour IDs, never a rank**; the server reads neighbours under
  `FOR UPDATE` and computes the fractional index.

Planned layout (`PLAN.en.md` §8) — follow it rather than inventing one:

```
src/app/[locale]/{(auth),(onboarding),[workspaceSlug]/...}   src/app/api/internal/{reorder,list,upload}
src/server/{db/{schema,client.ts,tenant.ts},authz/policy.ts,queries,services,events,jobs}
src/components/{ui,work-item,views}   src/i18n   src/lib   drizzle/
```

## Bilingual invariants

English and Khmer ship together or not at all; Khmer is never the degraded path. Retrofitting this is
called out in the plan as the most expensive available mistake, so these are load-bearing:

- **Locale prefix is always present** (`localePrefix: 'always'` in `src/i18n/routing.ts`). No "default
  locale has no prefix" special case.
- **Latin digits are pinned** for both locales in `src/i18n/request.ts` — Khmer locale otherwise renders
  `០១២៣`, which nobody wants in a task list. Any new `formats` entry needs `numberingSystem: 'latn'`.
- **The Khmer face goes after the Latin face in every font stack** (`--font-sans`, `--font-display`) so it is
  only reached by Khmer codepoints.
- `:lang(km)` sets `line-height: 1.75` — Khmer stacks diacritics vertically and clips at Latin heights.
  Applied by `[lang]` so it follows content, not layout.
- **Truncation must use grapheme segmentation** (`Intl.Segmenter`), never character slicing.
- Search: `tsvector('simple')` for Latin, `pg_trgm` for Khmer (no inter-word spaces, so word-based FTS
  fails), routed by script detection.
- `en.json` and `km.json` must stay key-for-key identical. Adding a string to one without the other is a
  defect, not a TODO.
- Closed enums (priority, state groups) map in code — **no translation key ever reaches the database**.
  Seeded defaults are the awkward middle: they carry a key, render translated until renamed, then the key
  clears and the literal wins.

## Design tokens

`src/app/globals.css` is three deliberate layers. Do not collapse them:

1. `@theme` — raw ramps, fixed, identical in both themes.
2. `:root` / `.dark` — semantic aliases. **These are the only things that flip.**
3. `@theme inline` — re-exposes the semantic aliases as Tailwind utilities (`bg-surface`, `text-muted`, …).

Components use semantic utilities only; never a raw ramp value and never a literal hex. All three shadow
tokens and both ring tokens are exposed through `@theme inline`, so `shadow-sm` resolves to the token rather
than to Tailwind's own default — no component should need `shadow-[var(--shadow-sm)]`.

**next-themes** puts `.dark` on `<html>` (`attribute="class"`, `defaultTheme="system"`), which is why the
layout carries `suppressHydrationWarning`: the class is set by an inline script before paint, so there is no
flash of the wrong theme. The provider is the whole mechanism — every colour decision is already made by the
semantic aliases. `e2e/theme.spec.ts` asserts that background, text, and both chip colours actually differ
between the two themes, because a component that hard-codes a light-mode colour still renders fine. Values marked
`BRAND` are the seven flat Unify colours. §18-1 is now decided — UnifyOps inherits the Unify family palette
and typography — so these are the brand's real values, not placeholders: treat them as fixed. Everything else
is derived and tunable. Sky `#54A6DB` on Ivory is ~2.4:1 and **fails WCAG AA for text**:
**Navy is the text blue**, Sky is for fills, accents, and large text.

## Keeping documents in sync

`PLAN.en.md` and `PLAN.km.md` are the same document in two languages, and `PLAN.md` states the rule
explicitly: a change to one must be made in the other. Section numbering, table rows, and the §17 findings
list are expected to correspond one-for-one. A web rendering of the plan is published as an artifact linked
from `PLAN.md`; it is a third surface for the same content and drifts if only the Markdown is edited.

## Not part of this product

`UnifyCharge_Brand_Assets/` belongs to a different product (EV charging) owned by the same company, and is
gitignored. Per §18-1 UnifyOps *inherits its palette and typography* — that is the only thing it is evidence
of. It says nothing about what UnifyOps does, and the other UnifyCharge paths in this session's working
directories are unrelated to this product.

**The logo is the exception, and it is not in the repo.** Colours and fonts come from that pack; the mark
does not. UnifyOps uses the **parent Unify logo**, never anything under `02_Logos/` — all three logomarks
there are a hexagon around a lightning bolt, and the bolt means EV charging. The Unify file has not been
supplied yet, so anything needing a mark (header, favicon, auth page, empty states) is blocked on it: ask,
do not substitute. When it arrives, recolour it to `currentColor` or the Sky token — the UnifyCharge SVGs
are filled `#28A6DF`, which does not match the palette's own Sky `#54A6DB`.

Two other facts about that pack, since it is the only brand evidence on disk: the palette PDF confirms all
seven hex values exactly as `globals.css` has them, and **Kantumruy Pro is not in it.** Only Koh Santepheap
ships with the brand, and it is display-weight — Kantumruy Pro is our own addition for Khmer body text
under §18-2.
