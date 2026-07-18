# 02 — Design system: compact · professional

គោលដៅ៖ រូបរាង **តូចជាងមុន** ជាប់ៗគ្នា ស្អាត អាន់បាន ដូច plane.so / Linear —
ហើយ **web · admin · space ប្រើ design system តែមួយ**។

## 1. បញ្ហាឥឡូវ

- Primitives រស់នៅ `apps/web/src/components/ui/` (15 files) — admin/space **មិនអាចប្រើ**។
  `packages/ui` មានតែ `Button.tsx`, `cn.ts`, `states.tsx` → ជិត duplicate រួចហើយ។
- ទំហំធំពេក៖ button `md` = `px-4 py-2 text-[13px]` (≈34px ខ្ពស់), radius default **10px**,
  border **1.5px**, `lg: 14px` / `xl: 20px` radius → មើលទៅ "consumer app" មិនមែន tool ក្រាស់ទិន្នន័យ។
- Motion `--dur: 200ms` + `hover:-translate-y-px` លើ button → យឺត និង gimmicky សម្រាប់ dense UI។
- 113 component files ក្នុង web — គ្មាន inventory, គ្មាន story/spec។

## 2. Tokens គោលដៅ `[PROPOSED]`

### 2.1 Type scale (base 13px)
| Token | Size / line | ប្រើសម្រាប់ |
| ----- | ----------- | ----------- |
| `text-micro` | 10 / 14 | badge, keyboard hint |
| `text-2xs` | 11 / 15 | meta, timestamp, table sub |
| `text-xs` | 12 / 16 | secondary, label, sidebar |
| `text-sm` | **13 / 18** | **base** — body, input, button, table cell |
| `text-md` | 14 / 20 | card title |
| `text-lg` | 16 / 22 | page heading |
| `text-xl` | 20 / 28 | rare — empty-state heading |

Font: Inter (មានរួច) · `font-feature-settings: 'cv11','ss01'` · tabular numbers លើ table/metrics។

### 2.2 Control heights (តូចជាងមុន)
| Size | ខ្ពស់ | Padding-x | Font | ប្រើ |
| ---- | ---- | --------- | ---- | ---- |
| `xs` | 22px | 6 | 11 | inline tag, table action |
| `sm` | 26px | 8 | 12 | toolbar, filter chip |
| `md` | **30px** | 10 | 13 | **default** — form, dialog |
| `lg` | 36px | 14 | 13 | primary CTA, auth page |

> ធៀបនឹងឥឡូវ៖ md 34px → **30px**, lg 40px → 36px។

### 2.3 រូបរាង
- **Radius**: `xs 3 · sm 4 · md 6 (default) · lg 8 · xl 12 · full` — (ធ្លាក់ពី 10/14/20)
- **Border**: 1px គ្រប់ទីកន្លែង (ឈប់ប្រើ 1.5px)
- **Spacing**: 4pt grid — `1=2 · 2=4 · 3=6 · 4=8 · 5=12 · 6=16 · 8=24 · 10=32`
- **Icon**: 14px (sm/md control) · 16px (lg) · stroke 1.5 (lucide)
- **Shadow**: 2 កម្រិតតែប៉ុណ្ណោះ — `sm` (dropdown/popover) · `lg` (modal)។ លុប shadow លើ button/card។
- **Motion**: `--dur: 120ms` (micro) / `160ms` (overlay) · លុប `hover:-translate-y-px` ·
  គោរព `prefers-reduced-motion`
- **Focus**: `outline: 2px solid var(--a); outline-offset: 1px` — មើលឃើញច្បាស់គ្រប់ primitive

### 2.4 Density mode
`data-density="comfortable" | "compact"` លើ `<html>` → ប្តូរ control height (30→26) និង
row height (32→28)។ Default = `compact`។ (Plane មិនមាន; ជាចំណុចខ្លាំងរបស់យើង)

### 2.5 Color
រក្សា `--a*` accent tokens + surfaces ដែលមានស្រាប់ (ដំណើរការល្អ light/dark)។ បន្ថែម៖
semantic `--success/--warning/--danger/--info` + `state-*` សម្រាប់ issue state
(backlog · unstarted · started · completed · cancelled) ដូច plane។

## 3. Component inventory (`packages/ui`) `[PROPOSED]`

**Tier 1 — primitives (ត្រូវមានមុនគេ)**
`Button` · `IconButton` · `Input` · `Textarea` · `Select` · `Combobox` · `Checkbox` ·
`Radio` · `Switch` · `Label` · `FormField` (label+error+hint) · `Badge` · `Avatar` ·
`AvatarGroup` · `Tooltip` · `Spinner` · `Skeleton` · `Kbd` · `Separator`

**Tier 2 — composites**
`Dropdown` · `Popover` · `Modal` · `Drawer/Sheet` · `Tabs` · `Toast` · `ContextMenu` ·
`Table` (sticky header, 32px row, resize, empty) · `Pagination` · `Breadcrumb` ·
`EmptyState` · `ErrorState` · `ConfirmDialog`

**Tier 3 — product**
`CommandPalette` (⌘K) · `IssueCard` · `IssuePeek` (side panel) · `StateBadge` ·
`PriorityIcon` · `MemberPicker` · `LabelPicker` · `DatePicker` · `FilterBar` ·
`GroupByBar` · `SidebarNav` · `AppShell`

រាល់ component៖ **states គ្រប់** (default·hover·active·focus·disabled·loading·error·empty),
keyboard គ្រប់, `forwardRef`, `cva` variants, RSC-safe (`'use client'` តែពេលចាំបាច់)។

## 4. App shell (ដូច plane, តូចជាង)

```
┌─────────────────────────────────────────────────────────────┐
│ Sidebar 220px          │  Topbar 40px: breadcrumb · actions  │
│ (collapse → 48px)      ├─────────────────────────────────────┤
│  workspace switcher    │  Filter/Group bar 34px              │
│  ⌘K · Home · My Work   ├─────────────────────────────────────┤
│  Projects (tree)       │                                     │
│   └ Work items         │   Content (list/kanban/table/…)     │
│     Cycles · Modules   │   row 32px · compact                │
│     Views · Pages      │                                     │
│  ─────────────         │                          ┌──────────┤
│  Settings · Profile    │                          │ Peek     │
└────────────────────────┴──────────────────────────┴──────────┘
```
- Sidebar 220px (ឥឡូវ?) · collapsed 48px · resize + ចងចាំ
- Peek overview = side panel 480px (ដូច plane) មិនមែន full page
- ⌘K command palette គ្រប់ app · `?` = shortcut help

## 5. ការងារត្រូវធ្វើ

- [ ] សរសេរ token layer ក្នុង `packages/ui/src/tokens.css` + `tailwind-preset.ts` (web/admin/space import preset ដដែល)
- [ ] ផ្លាស់ primitives ពី `apps/web/src/components/ui/` → `packages/ui` (Tier 1 មុន)
      ទុក re-export shim ក្នុង web (`@/components/ui` → `@prism/ui`) ដើម្បីកុំបាក់ call sites 100+
- [ ] Tier 2 + Tier 3
- [ ] `AppShell` រួម → web + admin ប្រើ (space មាន shell public ដាច់ដោយឡែក)
- [ ] កែ `apps/admin` និង `apps/space` ឲ្យប្រើ preset + primitives ដដែល
- [ ] A11y pass: focus ring, contrast ≥ 4.5:1, keyboard nav, `prefers-reduced-motion`, ARIA លើ overlay
- [ ] ទំព័រ `/debug/ui` (dev only) បង្ហាញគ្រប់ component គ្រប់ state — ជំនួស Storybook

## 6. Definition of done
Primitive ណាមួយកែម្តង → ប្តូរគ្រប់ app · web/admin/space build ✅ · គ្មាន `components/ui` ស្ទួន ·
control height ត្រូវតាមតារាង · keyboard-only អាចធ្វើ flow សំខាន់បាន · light + dark ត្រឹមត្រូវ។
