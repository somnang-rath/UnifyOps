# Prism AI Team — Agents & Skills

AI team for the **Prism → Plane** conversion (see `PLANE-CONVERSION-PLAN.md`).

## The five layers

| Layer | Lives in | What it does |
| ----- | -------- | ------------ |
| 1. Memory | `CLAUDE.md` → `.claude/rules/{architecture.rules,project,workflow}.md` | Loaded every session: boundaries, roadmap state, definition of done. |
| 2. Knowledge | `.claude/skills/*/SKILL.md` | Playbooks pulled in on demand (`scaffold-api-module`, `scaffold-web-feature`). |
| 3. Guardrails | `.claude/hooks/*.js` + `.claude/settings.json` | Deterministic, not AI: block destructive commands, nudge conventions, brief on start. |
| 4. Delegation | `.claude/agents/*.md` | Seven specialists with their own context windows. |
| 5. Distribution | `.claude-plugin/{plugin,marketplace}.json` | Packages layers 2–4 so a teammate installs the whole kit at once. |

**Hooks** (layer 3, all in `.claude/hooks/`):
- `guard.js` — PreToolUse. Denies `rm -rf /`, `dropDatabase`, force pushes, `docker compose down -v`,
  non-localhost Mongo URIs, `pnpm seed`, and writes to `.env`/lockfile/build output.
- `post-write.js` — PostToolUse. Reminds of the rule the edited path implicates (module registration,
  `packages/` over copy-paste, public-endpoint field stripping, `@InstanceAdminGuard`).
- `session-start.js` — SessionStart. Parses roadmap checkboxes and reports the current phase + ports.

Guardrails still run in `bypassPermissions` mode — that is the point of layer 3.

## Install (teammates)

```
/plugin marketplace add <repo-url>
/plugin install prism-team@prism
```

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
