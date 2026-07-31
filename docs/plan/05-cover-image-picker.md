# 05 — Cover images: `CoverImagePicker` + `CoverBanner` (apps/web · apps/space)

UX build spec សម្រាប់ **ADR 0010** (`docs/adr/0010-unsplash-covers.md` — API contract **LOCKED**,
កុំប្តូរ shape ណាមួយនៅទីនេះ)។ អ្នកសង់៖ `prism-frontend`។ គ្មានការងារ admin/live ទេ។

> Picker រស់នៅ **apps/web តែប៉ុណ្ណោះ** (មិនចូល `packages/ui` — មានតែ web ត្រូវការ)។
> ប៉ុន្តែ primitives ទាំងអស់យកពី `@prism/ui`៖ `Modal` · `InputWithIcon` · `Button` ·
> `Skeleton` · `EmptyState` · `ErrorState` · `Spinner`។ apps/space render cover បែប
> display-only ប៉ុណ្ណោះ (§7)។

## 0. Files

| File | ថ្មី/កែ | ខ្លឹមសារ |
| ---- | ------- | -------- |
| `apps/web/src/components/feature/cover/cover-image-picker.tsx` | ថ្មី | `CoverImagePicker` (§3) |
| `apps/web/src/components/feature/cover/cover-banner.tsx` | ថ្មី | `CoverBanner` + `AddCoverButton` (§4) |
| `apps/web/src/hooks/use-unsplash.ts` | ថ្មី | search infinite-query + download trigger (§2) |
| `apps/web/src/app/(app)/[workspaceSlug]/projects/[id]/overview/page.tsx` | កែ | banner + trigger (§5) |
| `apps/web/src/app/(app)/[workspaceSlug]/projects/[id]/settings/page.tsx` | កែ | "Cover image" section (§5.3) |
| `apps/web/src/app/(app)/wiki/page.tsx` | កែ | banner + trigger ក្នុង card (§6) |
| `apps/space/src/components/space-cover.tsx` | ថ្មី | client `<img>` + onError hide (§7) |
| `apps/space/src/app/[anchor]/page.tsx` | កែ | render `SpaceCover` (§7) |
| web `Project` / `WikiPage` types (`@/hooks/use-projects` · `@/schemas/wiki`) | កែ | `coverImage: string \| null` |

Tokens/utils ថ្មី៖ **គ្មាន** — ប្រើ tokens (`--dur`, `bg-bg-*`, `border-border`, radius) ដែលមានស្រាប់។

## 1. Gating (ADR 0010 §1, §6)

| Signal | ប្រភព | ប្រើសម្រាប់ |
| ------ | ----- | ----------- |
| `UNSPLASH_ENABLED` (effective boolean) | `usePublicInstance().data?.config.UNSPLASH_ENABLED` (`apps/web/src/hooks/use-public-instance.ts`) | បង្ហាញ/លាក់ affordance "Add cover" / "Change cover"។ `false` ឬ query មិនទាន់ load → **លាក់** (client មិនដឹងមូលហេតុ) |
| `configured: false` ក្នុង search response | `GET /unsplash/search` (HTTP 200) | belt-and-braces gate ក្នុង picker (toggle ប្តូរកណ្តាល session) → state `not-configured` (§3.4) |
| 502 upstream | search request | inline `ErrorState` — request ត្រូវផ្ញើជាមួយ `_skipErrorToast: true` (global toast បិទ) |

**"Remove cover" មិន gate លើ Unsplash ទេ** — ការលុបគ្រាន់តែ `PATCH { coverImage: null }`,
ត្រូវតែធ្វើបានទោះ Unsplash បិទក៏ដោយ។

## 2. Data hook — `apps/web/src/hooks/use-unsplash.ts`

Presentation spec ប៉ុណ្ណោះ — wiring ជារបស់ `prism-frontend`, ប៉ុន្តែ contract ត្រូវតាមនេះ៖

```ts
export interface UnsplashPhoto {
  id: string;
  alt: string | null;
  color: string | null;            // Unsplash dominant color — ប្រើជា tile placeholder bg
  urls: { regular: string; small: string; thumb: string };
  downloadLocation: string;
  user: { name: string; username: string; link: string };  // link មាន UTM រួចហើយ (server-side)
}

export interface UnsplashSearchPage {
  configured: boolean;
  page: number; totalPages: number; total: number;
  results: UnsplashPhoto[];
}

/** useInfiniteQuery(['unsplash', query]) → GET /unsplash/search?query&page&perPage=18
 *  · enabled: open && query.length > 0   · staleTime 10 min (server cache TTL ដូចគ្នា)
 *  · { _skipErrorToast: true } លើគ្រប់ request
 *  · getNextPageParam: page < totalPages ? page + 1 : undefined */
export function useUnsplashSearch(query: string, opts: { enabled: boolean }): …

/** POST /unsplash/download { downloadLocation } — fire-and-forget (void, មិន await,
 *  មិន toast — API ធានា 200 ជានិច្ច, ADR §2)។ */
export function triggerUnsplashDownload(downloadLocation: string): void
```

`perPage = 18` (ចែក 3 columns ស្មើ 6 ជួរ; cache key server-side stable)។

## 3. `CoverImagePicker` — component spec

### 3.1 Props

| Prop | Type | Required | ន័យ |
| ---- | ---- | -------- | --- |
| `open` | `boolean` | ✓ | controlled |
| `onClose` | `() => void` | ✓ | |
| `value` | `string \| null` | – | cover URL បច្ចុប្បន្ន → tile selected state (ប្រៀប `value === photo.urls.regular`) |
| `onSelect` | `(url: string) => void` | ✓ | ទទួល `urls.regular`។ Picker ខ្លួនឯង fire `triggerUnsplashDownload` រួច `onClose()` — parent ជាអ្នក PATCH |

Presentational — **គ្មាន** projectId/wikiId ចូល component; parent handle mutation ខ្លួនឯង។

### 3.2 Surface — **Modal** `[DECIDED]`

`@prism/ui` `Modal` `size="md"` (520px), title `"Choose cover"`, no footer prop
(footer attribution ជា content ផ្ទាល់)។ ហេតុផលជ្រើស modal មិនមែន popover៖ focus-trap /
Escape / scroll-lock / aria-labelledby បានពី primitive ដោយឥតគិតថ្លៃ; trigger ពីរកន្លែង
(project overview + wiki header) ប្រើ surface តែមួយ; `packages/ui` មិនទាន់មាន `Popover`
primitive ហើយយើងមិនសង់ថ្មីសម្រាប់ feature apps/web-only (rule: reuse before inventing)។

### 3.3 Layout

```
┌─ Modal md (520) ─────────────────────────────┐
│ Choose cover                                 │  ← Modal title
├──────────────────────────────────────────────┤
│ [🔍 Search Unsplash…              ]          │  ← InputWithIcon, autoFocus
│ ┌────────┐ ┌────────┐ ┌────────┐             │
│ │  tile  │ │  tile  │ │  tile  │  grid       │  grid-cols-3 gap-2
│ └────────┘ └────────┘ └────────┘  max-h      │  tile: aspect-[3/2] rounded-md
│ │  …6 ជួរ (18/page)…            [340px]      │  overflow-y-auto
│ ┌──────────── Load more ────────────┐        │  ← Button outline sm full
├──────────────────────────────────────────────┤
│ Photos from Unsplash            (footer row) │  ← text-2xs text-text-muted
└──────────────────────────────────────────────┘
```

- Search: `InputWithIcon icon={<Search />}` placeholder `"Search Unsplash…"`,
  `aria-label="Search Unsplash photos"`, debounce **350ms** តាម `useDebounce`
  (`@/hooks/use-debounce`) — conserve quota 50 req/hr (ADR context)។
- **Default query = `"wallpapers"`** `[DECIDED]` — បើក modal ភ្លាមឃើញរូបភាព (ដូច Plane)។
  Input ទទេ ⇒ ធ្លាក់ទៅ default query វិញ (មិនមែន empty grid)។ server cache 10-min ធ្វើឲ្យ
  default query នេះថោក (~1 upstream call / 10 min / instance)។
- Load more (**មិនមែន pagination** `[DECIDED]` — grid scan ល្អជាងចុចទំព័រ): `Button
  variant="outline" size="sm" full` label `"Load more"`; pending ⇒ `Spinner` + disabled;
  លាក់ពេល `page >= totalPages`។

### 3.4 Tile anatomy + states

```html
<div class="relative group rounded-md overflow-hidden"
     style="background: {photo.color ?? 'var(--bg-subtle)'}">   <!-- paint-before-load -->
  <button type="button" aria-label="Photo by {user.name}"
          class="block w-full aspect-[3/2] focus-visible:(token ring)">
    <img src={urls.small} alt={alt ?? ''} loading="lazy"
         class="w-full h-full object-cover" draggable="false" />
  </button>
  <!-- attribution scrim — sibling របស់ button, មិន nest link ក្នុង button (invalid HTML) -->
  <div class="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] text-white truncate
              bg-gradient-to-t from-black/60 to-transparent
              opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
              transition-opacity duration-[var(--dur)]">
    Photo by <a href={user.link}>…name…</a> on <a href="https://unsplash.com/?utm_source=prism&utm_medium=referral">Unsplash</a>
  </div>
</div>
```

| State | រូបរាង |
| ----- | ------ |
| default | រូប `urls.small`, bg = `photo.color` ខណៈ load |
| hover / focus-within | attribution scrim លេចឡើង + `ring-1 ring-inset ring-white/20`; **គ្មាន** scale/lift (design system §2.3 — no gimmick motion) |
| selected (`value === urls.regular`) | `ring-2 ring-accent ring-offset-1 ring-offset-bg-card` + badge `<Check>` w-3.5 មុមស្តាំលើ ក្នុងរង្វង់ `bg-accent text-white` |
| keyboard | tiles ជា `<button>` តាម DOM order; Enter/Space = select; focus ring ពី tokens.css; Tab trap ដោយ Modal |

Attribution links: `target="_blank" rel="noopener noreferrer"`, `onClick={e => e.stopPropagation()}`,
`underline-offset-2 hover:underline`។ ADR §4 requirement — កុំកាត់ចោល។

**On select:** `triggerUnsplashDownload(photo.downloadLocation)` (void — មិន await, ADR §4)
→ `onSelect(photo.urls.regular)` → `onClose()`។ PATCH + error toast ជារបស់ parent mutation។

### 3.5 Surface states (ត្រូវមានគ្រប់)

| State | Trigger | Render |
| ----- | ------- | ------ |
| initial/loading | query ដំបូង pending | grid skeleton — 9× `<Skeleton className="aspect-[3/2] rounded-md" />` ក្នុង grid ដដែល |
| loaded | results > 0 | §3.3 |
| appending | `isFetchingNextPage` | grid ចាស់នៅដដែល + Load more button ⇒ `Spinner` |
| no results | `results.length === 0 && configured` | `EmptyState label={'No photos for "'+q+'"'} hint="Try a different search." icon={<ImageOff />}` |
| upstream error (502) | search query error | `ErrorState message="Unsplash didn’t respond — try again." onRetry={refetch}` — **inline, គ្មាន toast** (`_skipErrorToast`) |
| append error | fetchNextPage error | ជួរតូចក្រោម grid: text-2xs text-red + link "Retry" (grid ចាស់មិនបាត់) |
| not configured | response `configured: false` **ឬ** instance boolean false | search input លាក់; `EmptyState icon={<ImageOff />} label="Unsplash is not configured" hint="Ask your instance admin to enable it in God Mode → Images."` |

## 4. `CoverBanner` + `AddCoverButton` — `cover-banner.tsx`

### 4.1 `CoverBanner` props

| Prop | Type | ន័យ |
| ---- | ---- | --- |
| `src` | `string \| null` | `null` ⇒ render `null` (banner អត់មាន) |
| `fallbackColor` | `string?` | project ⇒ `project.color`; អត់មាន ⇒ `var(--grad)` |
| `canEdit` | `boolean` | បើ false ⇒ display-only, គ្មាន overlay buttons |
| `unsplashEnabled` | `boolean` | គ្រប់គ្រង "Change cover" (Remove **មិន** gate — §1) |
| `onChange` | `() => void` | បើក picker |
| `onRemove` | `() => void` | parent PATCH `coverImage: null` (គ្មាន confirm — reversible, low-stakes) |
| `className` | `string?` | |

### 4.2 Render spec

```html
<div class="relative group/cover w-full aspect-[4/1] max-h-[200px] min-h-[96px]
            rounded-lg overflow-hidden border border-border">
  <img src={src} alt="" class="w-full h-full object-cover" draggable="false"
       onError={→ fallback} />
  <!-- fallback (img error / hotlink ខូច, ADR consequences): ជំនួស img ដោយ div
       style={background: fallbackColor
              ? `linear-gradient(135deg, ${fallbackColor}, color-mix(in srgb, ${fallbackColor} 40%, var(--bg-subtle)))`
              : 'var(--grad)'} — banner មិន collapse ទេ -->
  <!-- overlay: hover-reveal [DECIDED], focus-within សម្រាប់ keyboard -->
  <div class="absolute bottom-2 right-2 flex gap-1.5
              opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100
              transition-opacity duration-[var(--dur)]">
    <Button size="sm" variant="secondary"><ImagePlus /> Change cover</Button>  <!-- unsplashEnabled ប៉ុណ្ណោះ -->
    <Button size="sm" variant="secondary"><Trash2 /> Remove</Button>
  </div>
</div>
```

- Aspect **4:1** (`aspect-[4/1]`), cap `max-h-[200px]` — column 820px ⇒ ~200px, wiki card
  ធំជាង ⇒ cap ដដែល។
- Overlay buttons ប្រើ `variant="secondary"` លើ scrim តូច — បន្ថែម `shadow-sm
  bg-bg-card/90 backdrop-blur-sm` ឲ្យអានច្បាស់លើរូបភ្លឺ/ងងឹត (contrast ≥ 4.5:1)។

### 4.3 `AddCoverButton`

Ghost trigger ពេល **គ្មាន** cover: `Button variant="ghost" size="sm"` → `<ImagePlus
className="w-3.5 h-3.5" /> Add cover`, `text-text-muted hover:text-text`។
Visibility ជារបស់ parent (§5/§6) — component ខ្លួនឯង stateless (`onClick` prop តែមួយ)។

## 5. Placement — Project

### 5.1 Banner (overview page) `[DECIDED: overview-only, មិនដាក់ក្នុង layout]`

`overview/page.tsx` — `CoverBanner` នៅកំពូល column `max-w-[820px]`, **មុន** ជួរ
"Overview / Saved" (`mb-4`)។ ដាក់ក្នុង overview page មិនមែន `layout.tsx` ព្រោះ banner
140–200px លើគ្រប់ tab (work-items board, timeline…) ស៊ីកម្ពស់របស់ dense tool —
ផ្ទុយ design system ("compact · professional")។ Overview ជាទំព័រ identity/document
— កន្លែងត្រឹមត្រូវ (ដូច Plane page cover / Notion)។

### 5.2 Add-cover trigger — **hover-reveal** `[DECIDED]`

គ្មាន cover ⇒ `AddCoverButton` ក្នុងជួរ header របស់ overview (`flex … justify-between`,
ចន្លោះ `<h2>Overview</h2>` និង save indicator)។ Wrapper column ថែម `group/ovh`;
button `opacity-0 group-hover/ovh:opacity-100 focus-visible:opacity-100`។
Hover-reveal ព្រោះ chrome ស្ងាត់ជាង ហើយ discoverable path ជា settings row (§5.3) —
touch devices ក៏នៅមានផ្លូវប្រើ។ មាន cover ⇒ trigger ក្លាយជា overlay របស់ banner (§4.2)។

Visibility: `unsplashEnabled && canEdit`។ `canEdit` = predicate ដូច wiki `canPublish`
(owner ∥ member ∥ `me.role === 'admin'`) — **ផ្ទៀងជាមួយ guard របស់ `PATCH /projects/:id`**
ពេល wire ដើម្បីកុំបង្ហាញ action ដែល 403។

Mutation: `useProjectMutations().update` → `{ id, body: { coverImage: url } }`
(ADR §3 — គ្មាន endpoint ថ្មី)។ Optimistic ⇒ ចាំបាច់ទេ — banner load ពី network ស្រាប់។

### 5.3 Settings page — always-visible row

Section "Cover image" ក្នុង `settings/page.tsx` (style ដូច section ដទៃក្នុងទំព័រ)៖
- មាន cover: thumbnail preview (`h-16 aspect-[4/1] rounded-md object-cover border border-border`) +
  `Button size="sm" variant="outline"` "Change" (unsplashEnabled) + "Remove"។
- គ្មាន: text-xs text-text-muted "No cover image." + Button "Add cover" (unsplashEnabled)។
- Unsplash off + គ្មាន cover ⇒ លាក់ section ទាំងមូល; Unsplash off + មាន cover ⇒ បង្ហាញតែ Remove។
- Owner-gate ដូច fields ដទៃក្នុង settings (`isOwner`)។

## 6. Placement — Wiki

- Banner: ក្នុង card (`bg-bg-card border rounded-lg`) **មុន** `WikiHeader`,
  edge-to-edge (គ្មាន padding — card មាន `overflow-hidden` ស្រាប់; banner ប្រើ
  `rounded-none border-0 border-b border-border` variant តាម `className`)។
  Render តែពេល `activeId && activePage && activePage.coverImage`។
- Trigger: **always-visible** `[DECIDED]` — `AddCoverButton` ក្នុង `right` cluster របស់
  `WikiHeader` (មុន `SyntaxHelpButton`)។ Cluster នោះជា action chrome ស្រាប់ (Save ·
  Publish · Delete) — hover-reveal ក្នុងជួរ buttons ធ្វើឲ្យ layout លោត, always-visible
  ស៊ីនឹង idiom។ Visibility: `unsplashEnabled && activeId && canPublish` (write guard
  ដូច publish — `wiki.service` canWrite)។
- Mutation: **PATCH ភ្លាម** `m.update.mutate({ id: activeId, body: { coverImage } })`
  — cover **មិន** ចូល draft/dirty state (title/content ប៉ុណ្ណោះជា draft)។
- Preview + edit mode ទាំងពីរឃើញ banner ដូចគ្នា។

## 7. apps/space — display-only parity

`SpaceCover` (client component — `onError` ត្រូវការ client) ក្នុង
`apps/space/src/components/space-cover.tsx`:

```tsx
'use client';
export function SpaceCover({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;                       // space: ខូច ⇒ បាត់ស្ងាត់ៗ, គ្មាន placeholder
  return (
    <img src={src} alt="" loading="eager" draggable={false}
      onError={() => setBroken(true)}
      className="w-full aspect-[4/1] max-h-[200px] object-cover rounded-lg mb-8" />
  );
}
```

- `[anchor]/page.tsx`: `{page.coverImage && <SpaceCover src={page.coverImage} />}`
  នៅកំពូល `<article>`, មុន `<header>`។
- **Plain `<img>`, មិនមែន `next/image`** `[DECIDED]` — apps/space គ្មាន `images.remotePatterns`
  config ហើយ hotlink URL ជា arbitrary https (ADR §3); optimizer proxy ក៏ផ្ទុយនឹង
  hotlink guideline។ (ADR consequences ស្គាល់ចំណុចនេះស្រាប់។)
- **គ្មាន** edit affordance, គ្មាន attribution UI (ADR requirement ជា picker-side),
  គ្មាន private field ថ្មី — `coverImage` ជា public field តែមួយដែលថែម (ADR §3)។
- `alt=""` — decorative; SEO title/description នៅដដែល។

## 8. States checklist + Definition of done

> **ស្ថានភាព (2026-07-31)** — feature **ship រួច** (ADR 0010: `unsplash` module,
> owner-only gate, dev key configured)។ បញ្ជីខាងក្រោមមិនមែនការងារនៅសល់ទេ — វាជា
> **manual QA pass** ដែលមិនដែលកត់ត្រាថាបានធ្វើ។ គូសមិនបានដោយអាន code —
> "ឃើញពិត", "Network tab", "keyboard-only", "render 4:1" ត្រូវការមនុស្សបើក browser។
>
> ទុក `[ ]` ដោយចេតនា។ គូសវាដោយមិនបានធ្វើ គឺជាកំហុសដដែលដែល audit 2026-07-31
> កំពុងជួសជុល។ បើនរណាដើរតាមបញ្ជីនេះ សូមកត់កាលបរិច្ឆេទទុក។

- [ ] Picker: initial(default query) · loading skeleton · loaded · appending ·
      no-results · 502 inline (no toast) · not-configured gate — ទាំង 7 ឃើញពិត
- [ ] Trigger visibility: instance boolean off ⇒ Add/Change បាត់ទាំងអស់ ប៉ុន្តែ Remove នៅ
- [ ] Select ⇒ cover ឡើងភ្លាម + `POST /unsplash/download` fired (Network tab) ដោយមិន block
- [ ] Attribution links per-tile + footer, UTM intact, `target="_blank"`
- [ ] Keyboard-only: បើក modal → search → Tab ដល់ tile → Enter select → focus ត្រឡប់ trigger
- [ ] Banner: project overview + settings + wiki + space render 4:1 ដូចគ្នា; img error ⇒
      gradient fallback (web) / silent hide (space)
- [ ] `pnpm --filter web build` + `pnpm --filter space build` ✅ ហើយ E2E ពិត (workflow rule)
