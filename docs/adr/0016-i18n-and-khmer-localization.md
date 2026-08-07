# ADR 0016 — i18n strategy and Khmer localization

- **Status**: Accepted (build against this) — §2.4 settled 2026-08-06 in favour
  of `@prism/i18n`.
- **Date**: 2026-08-06
- **Scope**: `apps/web` · `apps/admin` · `apps/space` · `packages/ui` ·
  `packages/i18n` (new) · `packages/constants` · `User.locale` in `apps/api`
- **Context**: `docs/plan/06-differentiators.md` §3 (Tier 1, path B) — items
  3a–3d depend on this decision, per §3.4. Extends ADR 0006/0011 (route tiers)
  and ADR 0002 (public space).

## 1. Context

There is **no i18n framework anywhere**. Every user-visible string in the three
frontends is a hardcoded English literal, and every date is a bare
`toLocaleDateString`/`toLocaleTimeString` — 79 such calls across 39 files, with
no date library in any `package.json`. The plan and ADR documents are written in
Khmer; the product they describe is entirely English.

Four facts about the current code decide most of what follows, and none of them
is obvious from the outside:

1. **The product UI is client-rendered.** 199 of `apps/web`'s 232 `.tsx` files
   carry `'use client'`. `apps/space` is the inverse: 3 of 14. So the two apps
   have genuinely different needs, and a single "SSR-first" or "client-first"
   answer will be wrong for one of them.
2. **`packages/ui` barely has strings.** 12 components, and they already take
   their text as props (`placeholder`, `ariaLabel`, `removeLabel`). What remains
   is a handful of literals: `EmptyState`'s default `'Nothing here yet'`, and the
   `aria-label`s `'Command palette'`, `'Commands'`, `'Filters'`, `'Loading'`.
3. **The Khmer font is already loaded and already unused.** All three root
   layouts instantiate Kantumruy Pro as `--font-khmer` (web and admin add Koh
   Santepheap), but `packages/ui/tailwind-preset.ts` defines
   `sans: ['var(--font-sans)', 'Inter', …]` with no Khmer family in the stack.
   The only consumer of `--font-khmer` is the reports font picker. Every page
   therefore downloads a Khmer webfont that no Khmer UI text would render in.
4. **`User` already carries UI preferences** — `accent`, `theme`, `density`,
   `notifPrefs` — and `theme` is applied pre-paint by an inline script reading
   `localStorage` (`components/layout/theme-boot-script.tsx`). Locale looks like
   a fifth preference, and that resemblance is a trap: see §2.

Getting the locale *strategy* wrong is expensive to reverse — every string
written between now and the correction is written against it. That is why
`06-differentiators.md` §7 says not to start 3a without this ADR.

## 2. Decisions

### 2.1 The locale lives in a cookie, mirrored to the user record. Never in the URL. `[LOCKED]`

**Not in the URL.** Neither `/[locale]/…` nor `?lang=`:

- Phase 7b (ADR 0011) spent a whole migration collapsing the route space into
  two tiers with a **permanent** flat shim for every Tier W route. A locale
  segment multiplies both — every route and every shim, forever.
- The first path segment is already `[workspaceSlug]`, which is *user data*. A
  locale prefix makes every request start by disambiguating "is this segment a
  locale or a workspace someone happened to name `km`".
- ADR 0011 §4 treats query params as a reserved namespace (`?peek=`, `?layout=`).
  `?lang=` would be a third global param that every route must preserve across
  every navigation, and any route that forgets it silently switches language.

**Not `localStorage` alone**, despite the theme precedent. Theme survives being
client-only because it is an attribute swap that the pre-paint script applies
before first paint. Language is not an attribute, it is the content: the server
renders the text. `localStorage` is invisible to the server, so a localStorage
locale means the SSR'd HTML is in the wrong language, every translated string is
a hydration mismatch, and `<html lang>` lies to screen readers and crawlers.

**A cookie is the only client-writable store the server can read on the same
request.** So:

- `pr_locale`, `SameSite=Lax`, `Path=/`, one year, **not** `HttpOnly` — the
  client switcher writes it. It is a display preference, not a credential; same
  reasoning as the `pr_theme`/`pr_accent`/`pr_density` keys.
- `User.locale` is added next to `theme`/`accent`/`density`. It is the
  cross-device default, not the per-request answer: the cookie wins for the
  request, and login writes the record's value into the cookie when the cookie
  is absent.

### 2.2 Resolution order `[LOCKED]`

```
cookie pr_locale  →  User.locale (when the render is authenticated)  →  Accept-Language  →  'en'
```

`apps/space` is anonymous, so its chain is cookie → `Accept-Language` → `en`.

Resolution happens **in middleware**, which all three apps already have (they run
a per-request CSP nonce, ADR-adjacent to `docs/plan/01-security-model.md` §3.5).
The resolved tag is put on a request header (`x-locale`, alongside the existing
`x-nonce`) so the root layout can read it with `headers()` without a second
round of parsing. Web and admin already opt out of static rendering by reading
`headers()` in the root layout, so this costs nothing new there; **for
`apps/space` it does** — see §3.3.

### 2.3 Two locales: `en` and `km`. No negotiation framework. `[LOCKED]`

The moat is Khmer (`06-differentiators.md` §3.2), not "Prism is localizable".
Adding a third locale later must be *adding a message file*, and this ADR is
written so that it is.

Store the bare tag (`km`, not `km-KH`); expand to `km-KH` only where `Intl`
needs a region. No fallback chains beyond `km → en`, and a missing key renders
the **English string, not the key** — a half-translated screen is usable, a
screen of `issues.list.empty` is not.

### 2.4 The runtime is a small `packages/i18n`, not `next-intl`

Decided 2026-08-06: build `@prism/i18n` (~150 lines) rather than adopt
`next-intl`.

Why, honestly stated: next-intl's distinctive value is its
App Router *routing* integration — locale segments, `Link` rewriting,
`generateStaticParams` per locale. §2.1 rejects locale routing outright, which
removes most of what the dependency is for. What remains is a context provider,
a `useTranslations` hook, and ICU message parsing, against a UI that is 86%
client components. Meanwhile `packages/ui` must stay dependency-light (§2.5),
and the platform already ships `Intl.PluralRules`, `Intl.DateTimeFormat`,
`Intl.NumberFormat` and `Intl.Collator`.

`@prism/i18n` is then:

- `messages/en.ts`, `messages/km.ts` — flat key → string maps, typed so that
  `km` must satisfy `keyof typeof en` (a missing Khmer key is a **compile
  error**, which is the one guarantee a hand-rolled runtime buys us over a
  filesystem of JSON).
- `createTranslator(locale)` → `t(key, params?)` with `{name}` interpolation and
  `Intl.PluralRules` for `{count}`. Khmer has one plural form and English two;
  the platform knows this, so we do not encode it.
- `<LocaleProvider locale>` + `useT()` for client components,
  `getTranslator(locale)` for the server ones.
- `formatDate`, `formatTime`, `formatNumber`, `compareNames` — §2.7.

**What would flip this**: if 3b's translation pass wants ICU select/ordinal or
per-namespace lazy loading of message bundles, the library earns its place. Both
are reversible — the `t(key, params)` call sites are identical either way, which
is why this is the one decision here that does not need to be right the first
time.

### 2.5 `packages/ui` takes no i18n dependency. `[LOCKED]`

Its remaining literals (§1.2) become props with English defaults. Translation is
the *app's* job, because three apps consume these components and a provider
requirement in a shared primitive means every consumer — including one that
does not exist yet — must mount it or crash.

This is the cheapest correct answer available and it is only cheap because the
components were already written prop-first. Do not "improve" it by moving
`useT()` into `packages/ui`.

### 2.6 The API keeps composing English in v1. `User.locale` ships anyway.

Server-composed user-facing text exists — `notifications.service.ts` writes
titles like `'Due tomorrow'`, the email service composes bodies, the digest
writes prose. Translating it needs the *recipient's* locale at send time (not
the requester's) plus a key+params refactor of every call site.

v1 covers **rendered UI only**. Server-composed strings stay English and are a
named follow-up (§5). `User.locale` is added in v1 precisely so that follow-up is
possible without another migration — it is the enabling half, shipped early.

Not deferred: **API error messages are not UI copy**. They are already
English-only and stay that way; a frontend that shows a raw API error to a user
is a bug regardless of locale.

### 2.7 Dates, numbers, and what Khmer localization does *not* mean

One formatting seam in `@prism/i18n`, wrapping `Intl` with the resolved locale.
The 79 raw `toLocale*` calls migrate to it, and app code stops calling
`toLocale*` directly (enforceable with an ESLint `no-restricted-syntax` rule —
cheap, and the only mechanical guard available here).

Three sub-decisions that are easy to drift into wrongly:

- **Latin digits, not Khmer numerals.** `Intl.NumberFormat('km')` gives Latin
  digits by default; `km-u-nu-khmr` gives ០១២៣. We keep Latin. Issue counts,
  metrics, and identifiers are *scanned*, not read, and mixed-script numerals in
  a dense table cost more than they signal. This is a deliberate choice, not an
  oversight — revisit only on user feedback, never silently.
- **Gregorian calendar, Gregorian year.** ICU's `km` locale is already Gregorian;
  Buddhist-era years are not introduced.
- **Week starts on Sunday** in Cambodia. Any calendar/cycle view that hardcodes
  Monday is a 3c bug, not a formatting preference.

Khmer public holidays (3c) go in `packages/constants` as a **year-keyed static
table**, not an API: they are set annually by sub-decree and cannot be computed.
An unknown year must fall back to *no holidays* and say so at the call site —
silently treating an unmapped year as "no days off" inflates cycle capacity, so
the capacity math has to surface the gap rather than absorb it.

Khmer name sorting (3d) is `Intl.Collator('km')`, exposed as `compareNames`.
Trivial to write, easy to forget to *use*: member lists, assignee pickers and
mention menus all sort with default `localeCompare` today.

### 2.8 `<html lang>` and the font stack

`lang={locale}` on `<html>` in all three apps — currently hardcoded `"en"`.

The font work is real despite the fonts already being loaded (§1.3): the
preset's `font-sans` must gain a Khmer family so Khmer glyphs render in
Kantumruy Pro rather than an arbitrary OS fallback. Prefer a **single stack
containing both** (`var(--font-sans), var(--font-khmer), …`) over swapping
stacks per locale — mixed-script strings ("Sprint ១២ — Acme") are normal here,
and per-locale stacks render them in two fonts.

## 3. Rejected alternatives

### 3.1 Locale as a URL segment (`/km/acme/issues`)

Rejected in §2.1. Worth recording *why it is tempting*: it makes locale
shareable and crawlable, which genuinely matters — for public content. Prism's
public surface is `apps/space`, and space's public content is **user-authored in
one language** (a published wiki page is Khmer *or* English because a person
wrote it that way). Only the chrome around it is translated, and nobody deep
links to translated chrome. The one real benefit does not apply to the one app
that could use it.

### 3.2 Translating at the API

Rejected. It would put copy in the backend, make every string change a deploy of
`apps/api`, and force the three frontends to agree on a message contract they do
not need. §2.6's follow-up is narrower on purpose: only text the *API composes
and delivers itself* (notifications, email) is ever the API's problem.

### 3.3 Detecting locale in `apps/space` per request without thinking about caching

Flagged rather than rejected, and **resolved during 3a: it costs nothing.**
Reading `headers()` in a root layout opts its routes out of static rendering,
and space is the one app whose point is fast anonymous SSR of public content
(ADR 0002). But space was never static: `[anchor]/page.tsx` already declares
`dynamic = 'force-dynamic'` and every public fetch is `cache: 'no-store'`,
because a published page must reflect an unpublish immediately. There was
nothing static to lose. The fallback plan (default locale for anonymous
visitors, client-side switcher) is not needed.

### 3.4 `Accept-Language` as the primary signal

Rejected as primary (kept as a fallback, §2.2). Cambodian users overwhelmingly
run English-configured devices and browsers; `Accept-Language` would hand them
English and hide the feature from exactly the audience it exists for.

## 4. Out of scope / follow-ups

- **Server-composed strings** — notifications, email, weekly digest (§2.6).
  Needs the recipient's locale at send time; `User.locale` makes it possible.
- **The assistant's replies.** It answers in whatever language the model
  produces; nothing here changes that. Worth a system-prompt note in 3b, not a
  message file.
- **RTL.** Neither locale is RTL. No `dir` plumbing.
- **Khmer numerals** (§2.7) and **Buddhist era** — decided against, not deferred.
- **Translating `docs/`.** The plan/ADR corpus is Khmer, the code comments are
  English, and both stay as they are.

## 5. Verification

3a is not done when it typechecks (`.claude/rules/workflow.md`). It is done when,
against the running stack:

1. switching to Khmer re-renders the shell in Khmer **and survives a full page
   reload** (proves the cookie, not just the React state);
2. the server-rendered HTML of a translated screen already contains Khmer — no
   flash of English, no hydration warning in the console;
3. `<html lang="km">`, and Khmer text is rendered in Kantumruy Pro, not a
   fallback (computed `font-family`, asserted — §1.3 is exactly the bug that
   passes every other check);
4. a second device logging in as the same user gets Khmer with no cookie
   present (proves `User.locale`);
5. `apps/space` honours the cookie while still serving anonymous visitors the
   default locale, and published content is untouched;
6. a `km` message file missing a key **fails the build** (§2.3), and a key
   missing at runtime renders English.

Checks 2 and 3 are the ones that only a browser can prove; the CSP suite
(`pnpm --filter web test:csp`) is the precedent for how to drive them.

### 5.1 Result — 3a closed 2026-08-06

`pnpm --filter web test:i18n` (9 checks, green) covers 1–5;
`pnpm --filter @prism/i18n typecheck` covers 6, and was confirmed by deleting a
Khmer key and watching the build fail. Three notes for whoever picks up 3b:

- **Check 2 reads differently per app than this ADR assumed.** `apps/web`
  renders *nothing* server-side beyond `<html>`: `Providers` returns `null`
  until the boot refresh resolves, so there is no flash of English to have,
  and what the suite asserts on web is `lang="km"` in the server HTML plus a
  silent console. `apps/space` is where server-rendered locale actually shows,
  and it is asserted there.
- **`hydrateLocale` must not reload the page.** It runs inside `onAuthSuccess`,
  one line before the login page navigates; reloading there cancels the
  navigation and lands the user back on `/login`, looking exactly like a failed
  sign-in. It returns "the document disagrees" instead, and the caller picks:
  the login page does a hard `location.assign(next)`, the session-restore path
  in `Providers` reloads.
- **The font check earns its place.** Everything else can pass while Khmer
  renders in an arbitrary OS fallback, which is precisely the state the app was
  in before this change (§1.3).

### 5.2 Result — 3b/3c/3d closed 2026-08-06

Path B is complete. What landed, and the four things worth carrying forward:

**3d — the formatting seam.** `apps/web/src/lib/format.ts` lost `fmtDate`,
`fmtDateShort`, `monthLabel` and `relTime` outright rather than keeping them as
wrappers: a date helper with no locale argument can only ever render English,
and leaving the names in place would have let all 93 of their call sites keep
compiling while quietly staying English. Deleting them turned the compiler into
the migration checklist. `@prism/i18n` gained the shapes the real call sites
needed (`formatMonthYear`, `formatMonthShort`, `formatDateLong`,
`formatWeekdayDay`, `formatDateWithWeekday`, `formatTimeWithSeconds`,
`weekdayNames`, `formatRelativeTime`) plus `dateKey`.

**Not every `toLocale*` is a locale call, and the ESLint rule had to learn the
difference.** Three families are exempt in `apps/web/.eslintrc.js` (converted
from JSON so the exemptions can explain themselves): spreadsheet number formats
and the formula engine, because a cell its author formatted as `1,234.56` must
look identical to every viewer or two people reading one workbook see two
different numbers; report `element-*` renderers, because they carry an
author-chosen format code into a document that gets exported and emailed; and
the kiosk report display, which is deliberately single-locale with hardcoded
Khmer labels. A fourth case was not an exemption but a bug: `timeline/page.tsx`
used `toLocaleDateString('en-CA')` seven times as a **grouping key**, an idiom
that reads like formatting and would have been "migrated" into a translated
string by the next person. That is what `dateKey()` is for.

**The finding that matters: Chromium ships no `km` locale data.**
`Intl.DateTimeFormat.supportedLocalesOf(['km'])` is empty and `km-KH` silently
resolves to `en-US`, so every date on a Khmer screen rendered "Aug 6, 2026".
Thai, French, Japanese and Vietnamese all resolve correctly — Khmer
specifically is absent. **Node's full-ICU build does have it**, which is exactly
why nothing caught this: §2.4's "the platform already ships
`Intl.DateTimeFormat`" is true, and false for the one runtime that matters. Any
server-side or unit test would have printed perfect Khmer and proved nothing.
`@prism/i18n` now carries twelve month names and seven weekday names of its own
and uses them only when the runtime has no Khmer data — the whole dataset a
Gregorian calendar needs, and cheaper than the `@formatjs` polyfill this ADR
went out of its way to avoid. `Intl.RelativeTimeFormat` has the same gap and the
same treatment. **`Intl.Collator('km')` is also affected** and is *not* patched:
it degrades to root collation, which orders Khmer imperfectly rather than
wrongly, and a hand-rolled Khmer collation is a much larger commitment than
nineteen nouns.

**§2.7's premise about name sorting was wrong.** It says "member lists, assignee
pickers and mention menus all sort with default `localeCompare` today". They do
not sort *at all* — the project member list renders in the order people were
added. `compareNames` is now applied there and to the display-name sorts that
did exist (files, folders, notes, projects). Nothing was sorting Khmer badly;
nothing was sorting it.

**3c — holidays.** `packages/constants/src/khmer-holidays.ts` is a year-keyed
table with a `status` per year, because half of Cambodia's holidays follow the
lunar calendar and are set annually by sub-decree — there is no formula. Every
consumer receives the confidence alongside the number: `workingDaysBetween`
returns `{ workingDays, calendarDays, holidaysLost, status }`, and an unmapped
year reports `'unknown'` rather than a confident count, because silently
treating "no data" as "no days off" over-commits a team by up to three weeks a
year. A range spanning a known and an unknown year takes the weakest status, not
an average. 2026 ships as `provisional`: its fixed dates are certain, its lunar
dates need reconciling against the sub-decree before anyone plans a delivery
around them. The motivating case is asserted: a two-week sprint over Khmer New
Year is **7 working days, not 10**.

**Verification.** `pnpm --filter web test:i18n` 9 → **14** (3b screens, a
formatted date, ICU-or-fallback weekday headers, a marked holiday) and a new
`pnpm --filter @prism/constants test` (11 checks, pure functions, no browser or
database). One test lesson: the first version of the date check asserted "Khmer
appears on the calendar page", which passed while every date on it was English —
the nav was already Khmer. Asserting on the specific element is what found the
missing ICU data.
