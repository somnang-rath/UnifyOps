# Prism AI Team — Agents & Skills

AI team for the **Prism → Plane** conversion (see `PLANE-CONVERSION-PLAN.md`).
Agents live in `.claude/agents/`, skills in `.claude/skills/`.

## The team

| Agent | Role | Use when |
| ----- | ---- | -------- |
| **prism-orchestrator** 🎯 | Controller / lead. Routes work to specialists, returns a delegation plan. Writes no feature code. | First, for any multi-layer request or when unsure who should do it. |
| **prism-planner** 📋 | Breaks a phase into ordered, checkable tasks; tracks the roadmap & Definition of Done. | "Do Phase 1", "what's left", planning before coding. |
| **prism-architect** 🏛️ | System design, API contracts, cross-app concerns, ADRs. | Decisions crossing app boundaries or new patterns (packages/, CORS/JWT, publish/anchor, Yjs). |
| **prism-uiux** 🎨 | UX/UI, layout, states, shared components in `packages/ui`. | Before building any new screen or reusable component. |
| **prism-frontend** 💻 | Next.js (web/admin/space): routes, TanStack Query, Zustand, forms. | Any frontend/UI wiring work. |
| **prism-backend** ⚙️ | NestJS + Mongo modules, guards, services. | Any `apps/api` work. |
| **prism-realtime** 🔴 | `apps/live` Hocuspocus/Yjs + collab editor wiring. | Anything realtime/collaborative. |

## Skills (reusable playbooks)

| Skill | What it scaffolds |
| ----- | ----------------- |
| **scaffold-api-module** | A full NestJS module (schema + Zod DTOs + controller + service + module + registration) matching repo conventions. |
| **scaffold-web-feature** | A Next.js feature route (page + `_components` + TanStack Query hooks + optional Zustand store). |

## How they work together

```
request → prism-orchestrator (decides who + order)
              │
   ┌──────────┼───────────────┬───────────────┐
   ▼          ▼               ▼               ▼
prism-planner  prism-architect  prism-uiux   (contracts/design first)
                     │
        ┌────────────┴───────────────┐
        ▼ (parallel once contract fixed) ▼
   prism-backend                    prism-frontend / prism-realtime
```

**Golden rules the team enforces** (from plan §11):
1. `packages/` refactor (Phase 0) before new apps — avoids triple duplication.
2. API contract agreed before backend & frontend build in parallel.
3. UX/design before frontend for net-new screens.
4. Instance admin ≠ workspace admin.
5. Public (space) endpoints strip private data + rate-limit.
6. Live editing uses Yjs/Hocuspocus (CRDT), not plain Socket.io.

## Build order (roadmap)

Phase 0 Foundation (`packages/`) → Phase 1 Instance Admin → Phase 2 Realtime →
Phase 3 Public Space → Phase 4 Auth + Polish. Start each phase by asking
**prism-orchestrator** or **prism-planner**.
