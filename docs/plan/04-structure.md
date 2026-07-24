# 04 — រចនាសម្ព័ន្ធគោលដៅ

## 1. បញ្ហារចនាសម្ព័ន្ធឥឡូវ

1. **Route ស្ទួនក្នុង web** — មានទាំង flat ចាស់ (`(app)/projects`, `(app)/issues`, `(app)/wiki`,
   `(app)/kanban`, …) និង workspace-scoped ថ្មី (`(app)/[workspaceSlug]/projects/[id]/…`)។
   ការផ្លាស់ទី ADR 0006 មិនទាន់ចប់ → user អាចទៅដល់ screen ដែលមិន workspace-scoped។
2. **UI primitives ជាប់ក្នុង web** — `apps/web/src/components/ui/` (15) ធៀប `packages/ui` (3 files)។
3. **`views` module មិនពេញ** — មាន `dto/` + `schemas/` តែគ្មាន controller/service/module។
4. **`packages/types` · `constants` · `services` នីមួយៗមានតែ `index.ts`** — domain types នៅក្នុង web។

## 2. រចនាសម្ព័ន្ធគោលដៅ

```
prism/
├── apps/
│   ├── api/          NestJS :4000  — អ្នកសម្រេចតែម្នាក់
│   │   └── src/modules/
│   │       ├── auth/          + audience, refresh session, step-up, CSRF
│   │       ├── instance/      + audit, secret masking
│   │       ├── views/    ★    បំពេញ controller+service+module
│   │       ├── intake/   ★    ថ្មី — triage + public form
│   │       ├── templates/★    ថ្មី
│   │       ├── api-tokens/★   ថ្មី — PAT
│   │       ├── webhooks/ ★    ថ្មី
│   │       └── … (មានស្រាប់ 28)
│   ├── web/    :3000  user app        → ប្រើ @prism/ui តែប៉ុណ្ណោះ
│   ├── admin/  :3001  instance admin  → aud=admin, login ដាច់
│   ├── space/  :3002  public SSR      → គ្មាន token
│   └── live/   :3100  Yjs relay       → aud=collab, 1 doc/token
├── packages/
│   ├── ui/       ★ tokens.css · tailwind-preset · Tier 1–3 components
│   ├── types/    ★ domain types រួម (Issue, Project, Workspace, View, …) ← ដកពី web
│   ├── constants/  states · priorities · roles · route builders
│   ├── services/ ★ createApiClient({ audience }) · endpoint clients
│   └── editor/     Tiptap + Yjs (មានរួច)
├── docs/
│   ├── plan/       ← ផែនការនេះ (01–04)
│   └── adr/        0001–0006 + ថ្មី 0007+
└── PLANE-CONVERSION-PLAN.md   ← roadmap checkbox (source of truth)
```

## 3. Route model គោលដៅ (web) `[PROPOSED]`

```
/                                   → redirect ទៅ workspace ចុងក្រោយ
/(auth)/login · register · accept-invite
/[workspaceSlug]/                   home
  ├── my-work · notifications · drafts
  ├── projects                      list
  │   └── [projectId]/
  │       ├── work-items?peek=<id>  list|kanban|calendar|timeline|table + peek
  │       ├── cycles · modules · views · pages · intake
  │       └── settings/{general,members,states,labels,estimates,automations,publish}
  ├── views                         workspace-level saved views
  ├── analytics · wiki · files · automations · approvals
  └── settings/{general,members,billing,api-tokens,webhooks,imports}
```
- Route ចាស់ (`/projects`, `/issues`, `/kanban`, …) → `redirect()` ទៅ workspace-scoped (កុំលុបភ្លាម)
- Layout mode (list/kanban/…) = **search param មិនមែន route** → view/filter state ចែករំលែកបាន
- Peek = `?peek=<issueId>` → deep-link បាន

## 4. ADR ដែលត្រូវសរសេរ

| ADR | ប្រធានបទ |
| --- | -------- |
| 0007 | Token audience model + collab token (ជំនួស/ពង្រីក 0001 §2 grammar) |
| 0008 | Design system ក្នុង `packages/ui` — tokens, density, ownership |
| 0009 | View model (saved views, filter schema, workspace vs project) |
| 0010 | Publish model ពង្រីក — project/view/intake anchor |

## 5. Roadmap (លម្អិតនៅ `PLANE-CONVERSION-PLAN.md` §8)

| Phase | ខ្លឹមសារ | អាស្រ័យលើ |
| ----- | -------- | --------- |
| **5 — Security core** | audience · collab token · in-memory token · refresh rotation · CSRF · throttle · audit · step-up · secret masking | — |
| **6 — Design system** | tokens + preset · Tier 1–3 → `packages/ui` · AppShell · web/admin/space adopt · a11y | — (ស្រប 5 បាន) |
| **7 — Feature parity A** | `views` module · peek · sub-issues · relations · filter/group bar · bulk · route consolidation | 5, 6 |
| **8 — Feature parity B** | intake · publish project/view · notes collab · API tokens · webhooks · OAuth · analytics | 7 |

លំដាប់៖ 5 និង 6 ធ្វើស្របគ្នាបាន (backend ≠ frontend)។ 7 ត្រូវរង់ចាំទាំងពីរ។

## 6. វិធីធ្វើ (execution)

- Slice នីមួយៗ = ADR (បើឆ្លង app) → backend contract → frontend → E2E → បិទ checkbox
- រាល់ phase បិទដោយ **E2E ពិត** ដូច Phase 2/3 (មិនមែនត្រឹម typecheck)
- Route/primitive ចាស់ → ទុក shim មុន លុបនៅ slice ចុងក្រោយ (កុំបាក់ call sites 100+)
- ធ្វើតាម agent៖ `prism-architect` (ADR) → `prism-backend` ∥ `prism-uiux`+`prism-frontend` → `prism-realtime`
