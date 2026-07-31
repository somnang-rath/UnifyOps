# Prism v2 Plan — index

គោលដៅ៖ ធ្វើឲ្យ Prism **ពេញលេញ** ដូច plane.so — security រឹងមាំរវាង web/admin/live/space,
UI/UX ថ្មី (តូច ជាប់ ស្អាត professional), និង feature ពេញ។

> **Status: DRAFT — រង់ចាំការយល់ព្រម។** មិនទាន់ចាប់ផ្តើមសរសេរកូដទេ។

## ឯកសារ

| # | ឯកសារ | ខ្លឹមសារ |
| - | ----- | -------- |
| 01 | [Security model](01-security-model.md) | Trust boundary រវាង apps ទាំង 5, token model, អ្វីដែលខូចឥឡូវ |
| 02 | [Design system](02-design-system.md) | Density tokens, component inventory, app shell, a11y |
| 03 | [Feature parity](03-feature-parity.md) | គម្លាតធៀបនឹង plane.so + អ្វីត្រូវសង់ |
| 04 | [Structure](04-structure.md) | រចនាសម្ព័ន្ធ repo គោលដៅ + packages split |
| 05 | [Cover image picker](05-cover-image-picker.md) | UX spec សម្រាប់ ADR 0010 — Unsplash picker + cover render (web/space) |
| 06 | [Differentiators](06-differentiators.md) | ហេតុអ្វីគេជ្រើស Prism ជំនួស Plane/Linear/Jira — moat (AI write-tools · ភាសាខ្មែរ + Telegram) + បំណុល Tier 0 ត្រូវដោះមុន |

Roadmap (Phase 5–8) នៅក្នុង `PLANE-CONVERSION-PLAN.md` §8 — **ជា source of truth តែមួយ**
សម្រាប់ progress (SessionStart hook អាន checkbox ពីទីនោះ)។

## របៀបកែផែនការនេះ

- **ប្តូរ scope / បន្ថែម feature** → កែឯកសារ 01–04 ត្រង់ផ្នែកពាក់ព័ន្ធ រួចកែ checkbox នៅ §8។
- **សម្រេចចិត្តឆ្លងកាត់ app ច្រើន** → សរសេរ ADR ថ្មីក្នុង `docs/adr/` (លេខបន្ត 0007+) ហើយ link មកទីនេះ។
- **រាល់ decision ដែល LOCK ហើយ** សម្គាល់ `[LOCKED]` — កុំប្តូរដោយគ្មាន ADR ថ្មី។
- ចង់ឲ្យ AI បន្ថែម → ប្រាប់ `prism-planner` (task breakdown) ឬ `prism-architect` (design/ADR)។

## គោលការណ៍ 3 យ៉ាងសម្រាប់ v2

1. **Security by construction** — app នីមួយៗមាន token audience ដាច់ដោយឡែក។ គ្មាន app ណា
   ទុកចិត្ត app ផ្សេងទេ; API ជាអ្នកសម្រេចតែម្នាក់។
2. **One design system** — primitives រស់នៅក្នុង `packages/ui` តែមួយកន្លែង។ web/admin/space
   ប្រើរួម។ គ្មាន copy-paste។
3. **Ship in slices** — phase នីមួយៗត្រូវ build + ដំណើរការពិត (E2E) មុនបិទ ដូច Phase 2/3។
