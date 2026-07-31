# 03 — Feature parity ធៀបនឹង plane.so

សញ្ញា៖ ✅ មានពេញ · 🟡 មានខ្លះ/មិនពេញ · ❌ គ្មាន

## 1. Work management

| Feature (plane) | Prism ឥឡូវ | ការងារ |
| --------------- | ---------- | ------ |
| Work items (issues) CRUD | ✅ `issues` module + web | — |
| States (backlog/unstarted/started/completed/cancelled) កែបាន | 🟡 មាន state តែ per-project customization? | schema `IssueState` per project + UI settings |
| Priority · Labels · Assignees | 🟡 | បញ្ជាក់ label CRUD + label group |
| **Sub-issues** (parent/child) | ❌ | `parentId` + tree UI + progress rollup |
| **Relations** (blocks/blocked-by/duplicate/relates) | ❌ | `IssueRelation` schema + peek UI |
| **Peek overview** (side panel) | ❌ (មាន full page `/issues/[id]`) | `IssuePeek` component + URL state |
| Comments + reactions | 🟡 wiki មាន; issue? | បញ្ជាក់ + reactions |
| Attachments | 🟡 `files` module | ភ្ជាប់ចូល issue |
| Activity feed | 🟡 `activity` module | បង្ហាញក្នុង peek |
| Estimates | ❌ (គ្មានសោះ — `Issue` គ្មាន field `estimate`; dir ទទេត្រូវលុប 2026-07-31, មើល `06-differentiators.md` §1.2) | schema field + UI + burn-down |
| Cycles (sprints) | ✅ `cycles` module + project tab (ADR 0014) — derived status, one-at-a-time overlap guard, progress rollup | burn-down chart (rollup already returns `byStatus`) |
| Modules (epics) | ✅ `modules` module + project tab (ADR 0014) — stored status, lead, parallel by design | member picker (API stores `memberIds`; modal exposes lead only) |
| **Intake / Inbox** (issue triage) | ❌ | module `intake` + public intake form (space) |
| Time tracking / worklog | ❌ | `worklog` schema + UI (បន្ទាប់) |
| Bulk operations | ❌ | multi-select + bulk edit bar |
| Templates (issue/project) | ❌ | `templates` module |

## 2. Views & layouts

| Feature | Prism ឥឡូវ | ការងារ |
| ------- | ---------- | ------ |
| List · Kanban · Calendar · Gantt/Timeline · Spreadsheet | ✅ ទាំង 5 មាន route | ធ្វើឲ្យស៊ីគ្នាក្រោម filter/group bar តែមួយ |
| **Saved views** (project + workspace) | ✅ `views` module ពេញ + `ViewsBar` លើ /issues + project Views tab (ADR 0014) + `?view=<id>` deep link | — |
| Filters · Group by · Sort · Display options | 🟡 | បង្រួបបង្រួម `FilterBar`/`GroupByBar` |
| Workspace-level views | ❌ | ក្រោយ project views |

## 3. Workspace & instance

| Feature | Prism ឥឡូវ | ការងារ |
| ------- | ---------- | ------ |
| Workspace = tenant, slug URL | ✅ ADR 0003–0006 | បញ្ចប់ការផ្លាស់ទី route ចាស់ (§4) |
| Members · roles · invites | ✅ `users`/`roles`/accept-invite | audit + resend/revoke invite |
| Project members ≠ workspace members | 🟡 `project-access.service` | ពិនិត្យ guest role |
| Instance admin (God Mode) | ✅ `instance` + `apps/admin` | Workspaces page នៅខ្វះ endpoint |
| **API tokens** (personal/workspace) | ❌ | `apiTokens` module + `Bearer pat_…` guard |
| **Webhooks** | ❌ | `webhooks` module + delivery log + retry |
| **Importers** (Jira/GitHub/CSV) | ❌ | CSV មុន (ងាយ + មានតម្លៃភ្លាម) |
| Notifications inbox | ✅ `notifications` + Socket.io | ភ្ជាប់ peek + preferences |
| Analytics / dashboard | 🟡 `dashboard`/`reports` | workspace analytics ដូច plane |

## 4. Public space

| Feature | Prism ឥឡូវ | ការងារ |
| ------- | ---------- | ------ |
| Publish wiki page | ✅ Phase 3 | — |
| **Publish project / roadmap** | ❌ (deferred — ត្រូវការ `views`) | ក្រោយ views module រួច |
| **Publish view** (issue list public) | ❌ | anchor → view |
| Public comments / reactions / votes | ❌ | `PublishSettings` toggles |
| **Intake form** (public → issue) | ❌ | ភ្ជាប់នឹង intake module |
| SEO / OG image / sitemap | 🟡 metadata មាន | OG image + sitemap.xml + robots តាម setting |

## 5. Collaboration (live)

| Feature | Prism ឥឡូវ | ការងារ |
| ------- | ---------- | ------ |
| Collaborative wiki (Yjs) | ✅ Phase 2 | — |
| **Notes collab** (`blocks[]` model) | ❌ deferred | បម្លែង notes → doc model ដូច wiki |
| Presence (cursor · avatar) | 🟡 មាន awareness? | បង្ហាញ avatar + cursor color |
| Comments inline ក្នុង doc | ❌ | Tiptap comment mark |
| Issue description collab | ❌ | `issue:<id>` document name (ត្រូវពង្រីក grammar — ADR 0001 §2 LOCKED → ADR ថ្មី) |
| Version history / restore | ❌ | Yjs snapshot timeline |

## 6. Auth

| Feature | Prism ឥឡូវ | ការងារ |
| ------- | ---------- | ------ |
| Password login | ✅ | + throttle (01-security S7) |
| **OAuth Google / GitHub / GitLab** | ❌ Phase 4 នៅបើក | ធ្វើតាម instance config toggle |
| Magic link / email code | ❌ | ក្រោយ OAuth |
| **Token audience separation** | ❌ | 01-security §2 — **ធ្វើមុនគេ** |

## 7. អាទិភាព (មតិខ្ញុំ)

1. **Security core** (audience, collab token, in-memory token) — ការពារកុំឲ្យត្រូវសរសេរឡើងវិញ
2. **Design system** — គ្រប់ screen ថ្មីអាស្រ័យលើវា; ធ្វើមុនពេលសង់ feature ថ្មី
3. **`views` module** — បើក roadmap ធំ (saved views → publish view → workspace views)
4. **Peek + sub-issues + relations** — នេះជាអ្វីដែលធ្វើឲ្យ "មើលទៅដូច plane"
5. **Intake + publish project** — ប្រើ space ឲ្យអស់សក្តានុពល
6. **API tokens + webhooks** — បើកទ្វារ integration
7. Notes collab · version history · importers · time tracking
