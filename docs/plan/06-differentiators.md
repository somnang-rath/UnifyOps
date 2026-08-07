# 06 — Differentiators: អ្វីដែលធ្វើឲ្យ Prism ខុសពី app ដទៃ

> **Status: កំពុងអនុវត្ត។** (បន្ទាត់នេះធ្លាប់សរសេរថា "DRAFT — មិនទាន់សរសេរកូដទេ"
> រហូតដល់ 2026-08-06 ខណៈ Tier 0 ទាំង ៤ និង Tier 1 ផ្លូវ A បានបិទរួចហើយ។)
> Tier 0 ✅ · Tier 1 ផ្លូវ A (AI) ✅ · Tier 1 ផ្លូវ B (ខ្មែរ) ✅ — 3a/3b/3c/3d បិទទាំងអស់ 2026-08-06។
> ឯកសារ 03 សួរថា *"ខ្វះអ្វីធៀបនឹង Plane?"* — ឯកសារនេះសួរសំណួរផ្សេង៖
> *"ហេតុអ្វីគេត្រូវជ្រើស Prism ជំនួស Plane/Linear/Jira/ClickUp?"*

---

## 0. ការវិនិច្ឆ័យ (diagnosis)

Scan codebase 2026-07-30 បង្ហាញរឿងមួយច្បាស់៖ **Prism មិនខ្វះ feature ទេ។**
Module ដែលមានស្រាប់ក្នុង `apps/api/src/modules/` — ៣៣ module:

```
activity assistant audit auth automations backups chat cycles dashboard error-logs
estimates files health instance intake issues kanban modules mrs notes notifications
projects public reports roles search templates unsplash users views webhooks wiki
workbooks workspaces
```

ក្នុងនោះមាន **៦ module ដែល Plane គ្មានទាល់តែសោះ**៖

| Module | Plane មាន? | ចំណាំ |
| ------ | ---------- | ----- |
| `assistant` | ❌ | AI chat, SSE streaming, Anthropic + OpenAI, tool-calling loop |
| `chat` + `telegram` | ❌ | Channels + DMs + two-way Telegram bridge (ADR 0007) |
| `workbooks` | ❌ | Spreadsheet ជាមួយ xlsx import/export ពិត |
| `backups` | ❌ | Encrypted export/import + scheduler |
| `automations` | ❌ | Trigger → condition → action + log |
| `mrs` | ❌ | — |

**ដូច្នេះបញ្ហាមិនមែន "ខ្វះ"។ បញ្ហាគឺ surface ធំ តែរាក់** — feature ច្រើនកន្លះផ្លូវ ដែល
competitor ចម្លងបានក្នុងមួយ quarter។ យុទ្ធសាស្ត្រត្រឹមត្រូវគឺ **ជីកជ្រៅ ៣ កន្លែង**
មិនមែនបន្ថែម module ទី ៣៤ ទេ។

### គោលការណ៍ជ្រើសរើស

1. **អ្វីដែលប្រើ module ដែលមានស្រាប់ច្រើនជាងគេ** ឈ្នះ — cost ទាប, moat ខ្ពស់។
2. **អ្វីដែល competitor មិន*ចង់*ធ្វើ** ឈ្នះជាង អ្វីដែលគេ*មិនទាន់*ធ្វើ។
   (Telegram + ភាសាខ្មែរ = គេនឹងមិនធ្វើ ១០ ឆ្នាំទៀត។)
3. **គ្មាន differentiator ណាមួយសាងលើ foundation បែកធ្លាយបានទេ** → §1 មុនគេ។

---

## 1. Tier 0 — ត្រូវជួសជុលមុននឹងសាងអ្វីថ្មី

រកឃើញអំឡុង scan។ ទាំងនេះមិនមែន "feature" ទេ — ជាបំណុលដែលនឹងធ្វើឲ្យ Tier 1 ខូច។

### 1.1 ✅ P0 — Search លេច issue ឆ្លង workspace *(បិទ 2026-07-30)*

`apps/api/src/modules/search/search.service.ts:22-27`

```ts
this.issueModel.find({ $or: [{ title: re }, { desc: re }] })   // គ្មាន authz filter
```

`projects` មាន `{ $or: [{ ownerId }, { members }] }` និង `notes` មាន `{ ownerId }` —
តែ **issues គ្មានអ្វីទាំងអស់**។ `GET /search?q=…` ត្រឡប់ `title` + `_id` + metadata
នៃ issue គ្រប់ workspace ក្នុង instance ទៅឲ្យអ្នកប្រើណាក៏បាន។

រំលោភ **boundary #2** ក្នុង `.claude/rules/architecture.rules.md`
("Workspace is the tenant — គ្រប់ read *និង* write path ត្រូវ workspace-scoped, ADR 0003–0006")។

**ដោះរួច**៖ ច្បាប់ scope ដែល `IssuesService.accessScope` កាន់ ត្រូវបានផ្លាស់ទៅ
`ProjectAccessService.projectItemScope()` — ឥឡូវ **canonical តែមួយ** សម្រាប់គ្រប់ collection
ដែលភ្ជាប់ project តាម `projectId` (issues + search ប្រើរួម, គ្មាន copy ទី ២)។ Search បន្ថែម
`?workspaceId=` (narrowing-only, ADR 0011 §2b), projects ប្ដូរពី owner/member test ក្នុងស្រុក
មកប្រើ `readableProjectIds` (ឥឡូវឃើញ internal/public ត្រូវនឹង `/projects`), និង **escape
regex metacharacters** — `q=.*` ធ្លាប់ជា wildcard + ReDoS surface។

**បញ្ជាក់**: `test:security` **21/21** (មុននេះ 18) — S11 ៣ check ថ្មី។ admin@test.com
(member ទាំង ៣ workspace, គ្មាន project) ទទួល 18 issue ពី internal project ៦ —
មិនមែន 24 ដូចមុនទេ; issue នៃ private project ២ (`API Platform`, `Analytics Dashboard`)
លែងលេចហើយ។

### 1.2 ✅ P1 — `modules/estimates/` ជា dir ទទេ *(បិទ 2026-07-31)*

`apps/api/src/modules/estimates/` មាន `dto/` និង `schemas/` តែ **គ្មាន file ណាមួយសោះ**
ហើយមិនបានចុះក្នុង `app.module.ts` ទេ។ `03-feature-parity.md` សរសេរថា 🟡 "module `estimates`"។

នេះជា **ករណីទី ២ នៃ pattern ដដែល** — `cycles`/`modules` ក៏ជា dir ទទេដែរ ខណៈ doc អះអាង ✅
(មើល ADR 0014 + `.claude/rules/project.md` Phase 10)។

**ដោះរួច — ជ្រើស "លុប"**៖ `Issue` គ្មាន field `estimate` សោះ ហើយគ្មាន code ណាយោង
`estimates` ទេ — មិនមែន module ដែលសរសេរមិនចប់ទេ, គឺជា module ដែល**មិនដែលចាប់ផ្ដើម**។
ការសរសេរវាឥឡូវជា feature ថ្មី (Tier 2) មិនមែនការសងបំណុល Tier 0 ទេ។ `03-feature-parity.md`
ប្ដូរពី 🟡 ទៅ ❌ ឲ្យត្រូវនឹងការពិត។ ឥឡូវ **33 module** ទាំងអស់ពិត។

**ការពារកុំឲ្យកើតឡើងម្ដងទៀត** — `scripts/check-module-inventory.mjs` (ភ្ជាប់ក្នុង
`pnpm --filter api lint` ដូច្នេះ `pnpm -r lint` ចាប់បាន)។ វា fail ពេល៖

1. dir ណាមួយក្រោម `modules/` គ្មាន `.ts` file — scaffold ដែលមិនដែលសរសេរ;
2. `*.module.ts` ណាមួយដែល**គ្មាន file ណាក្នុង `src/` import** — module class ដែលមាន
   តែ controller មិនដែល mount។

លក្ខខណ្ឌទី ២ មើលគ្រប់ file មិនមែនតែ `app.module.ts` ទេ ព្រោះ leaf module រួម
(`projects/access/project-access.module.ts`) ត្រូវ import ដោយ feature module មិនមែន root។

មូលហេតុដែលបញ្ហានេះរស់បានយូរ៖ dir ទទេ **មើលមិនឃើញ**ដោយ `nest build`, ដោយ
`eslint "src/**/*.ts"`, និងដោយ git ផង។ គ្មានអ្វីក្នុង toolchain ប្រកែកនឹង doc បានទេ។

### 1.3 ✅ P1 — `$regex` search នឹងស្លាប់នៅ scale *(បិទ 2026-07-30)*

`$regex: q, $options: 'i'` គ្មាន index ប្រើបានទេ → **collection scan ពេញ រាល់ការវាយអក្សរម្ដងៗ**
លើ ៣ collection ស្របគ្នា។ នៅ ១០ក issues វានឹងធ្វើឲ្យ ⌘K មិនអាចប្រើបាន។

**ដោះរួច** (PR តែមួយជាមួយ §1.1)៖ `$text` ជាផ្លូវចម្បង។ `IssueSchema` មាន text index រួច
(`{title:'text', desc:'text'}`) តែ search មិនធ្លាប់ប្រើ; `ProjectSchema` បន្ថែមថ្មី។

**ចំណុចសំខាន់** — `$text` ផ្គូផ្គងតែពាក្យពេញ (stemmed) ដូច្នេះវាខកខាន prefix ដែល
command palette ផ្ញើរាល់ការវាយអក្សរ (`proj` ≠ `project`)។ ដំណោះស្រាយគឺ **`$text` មុន
រួច regex ជា fallback ពេលគ្មានលទ្ធផល** — ហើយ fallback នោះដំណើរការ *ខាងក្នុង access scope*
ទើបវាមិនមែន collection scan ទៀត។ `$text` ដាក់ក្នុង `$or` មិនបានទេ → ត្រូវផ្សំដោយ `$and`។

Note ជា regex បន្ត ដោយចេតនា — `ownerId` indexed រួច ហើយ body រស់នៅទាំង `blocks[].value`
(legacy) និង `contentHTML` (ក្រោយ ADR 0009), ដែល text index មិនគ្របស្អាតទេ។

### 1.4 ✅ **P0** — `automations` scoped តាម user មិនមែន workspace *(បិទ 2026-07-31)*

ចាត់ជា P2 ពីដំបូង។ **ខុស** — ពេលអានកូដមែនទែន វាធ្ងន់ជាង §1.1 ទៅទៀត ព្រោះ §1.1
ជា **read** leak រីឯនេះជា **write** leak។ បញ្ហា ៣ មិនមែន ១៖

1. **Engine ឆ្លង tenant** — `fire()` ធ្វើ `find({ trigger, enabled: true })` គ្មាន scope សោះ។
   ច្បាប់មួយក្នុង workspace A ដំណើរការលើ event នៃ workspace B — `set_status`,
   `set_assignee`, `add_label` **កែ issue** ដែលម្ចាស់ច្បាប់មើលក៏មិនបាន។
2. **`POST /automations/fire` បើកចំហ** — គ្រាន់តែ login ក៏បាន បញ្ជូន trigger + payload
   តាមចិត្ត។ មានន័យថា៖ កែ status/assignee/label នៃ issue **ណាមួយ**ក្នុង instance
   (គ្រាន់តែដឹង `issueId`), បូកនឹងបាញ់ `webhook` ចេញក្រៅក្នុងនាមយើង។
3. **`actionNotify` ជាមួយ role target** — `users.findByRole()` ជា instance-wide ដូច្នេះ
   ច្បាប់មួយផ្ញើ **title នៃ issue** ទៅគ្រប់ "dev" លើ server។ ការលេច title ដដែលនឹង §1.1
   តែមកតាម notification ជំនួស។

**ដោះរួច**៖

- `Automation.workspaceId` (required, indexed) + compound index
  `{ workspaceId, trigger, enabled }` ត្រូវនឹង lookup របស់ engine ១០០%។
  `ownerId` នៅតែមាន តែជា **audit + write gate** មិនមែន read scope ទៀតទេ។
- `fire()` ដកចេញ workspace **ពី event មិនមែនពីច្បាប់** — `payload.projectId` →
  `project.workspaceId` (DB ជាអ្នកសម្រេច, caller ដាក់ស្លាកបំប៉ោង scope មិនបាន)។
  គ្មាន workspace = **គ្មានច្បាប់ណាដំណើរការ** (fail closed) — issue ផ្ទាល់ខ្លួន
  គ្មាន workspace ដូច្នេះគ្មានច្បាប់ក្រុមណាកាន់វា។
- **លុប `POST /automations/fire`**។ Engine ជា service-to-service តែប៉ុណ្ណោះ។
  គ្មាន frontend ណាហៅវាទេ (បានពិនិត្យ) — surface សុទ្ធសាធ។
- CRUD ប្ដូរជា workspace៖ អាន = សមាជិក workspace · សរសេរ = **អ្នកបង្កើត ឬ ម្ចាស់
  workspace** (មិនពង្រីកសិទ្ធិលើសពីមុន តែច្បាប់មិនក្លាយជា orphan ពេលអ្នកសរសេរចាកចេញ)។
  404 មុន 403 — អ្នកក្រៅមិនត្រូវបែងចែក id ពិតពី id ប្រឌិតបានទេ។
- `actionNotify` ត្រង recipient តាមសមាជិក workspace មុន push
  (`ProjectAccessService.workspaceMemberIds`)។
- `runDueSoonSweep()` បញ្ចូន `projectId` មកវិញ បើមិនដូច្នេះ `issue.due_soon`
  តាម cron នឹង resolve workspace មិនបាន ហើយឈប់ដំណើរការស្ងាត់ៗ។

**បញ្ជាក់**: `test:phase7` **38/38** (មុននេះ 31) — ៧ check ថ្មី, រួមទាំងភស្តុតាងផ្ទាល់៖
ច្បាប់ក្នុង acme ដាក់ label លើ issue acme (**ដំណើរការមែន**) តែមិនប៉ះ issue beta
ដែលបង្កើតដំណាលគ្នា។ ដាក់ក្នុង phase7 មិនមែន security ព្រោះវាប្រើ fixture ២ tenant
(alice↔acme, dave↔beta) ដែលមានស្រាប់ ហើយមិនចំណាយ login បន្ថែម (throttle 5/នាទី)។

**នៅសល់** (មិនមែន security, ទុកសម្រាប់ rule builder §4)៖ `condition` **មិនដែលត្រូវអាន**
ដោយ `fire()` សោះ — គ្រប់ច្បាប់ដំណើរការលើគ្រប់ event នៃ trigger នោះ ទោះសរសេរ condition
យ៉ាងណាក៏ដោយ។ ត្រូវដោះមុនពេលធ្វើ UI ឲ្យអ្នកប្រើសរសេរ condition។

**Migration**: `automations` ទទេក្នុង dev (គ្មាន seed ណាបង្កើតទេ)។ ចំពោះ deployment
ដែលមានទិន្នន័យ ច្បាប់ចាស់គ្មាន `workspaceId` នឹង **បាត់ពី list ហើយឈប់ដំណើរការ**
(fail closed ដោយចេតនា) — ត្រូវ backfill មុន deploy។

---

## 2. Tier 1 — Moat ចម្បង: AI Assistant ដែល*ធ្វើការ*

### 2.1 អ្វីមានស្រាប់

`modules/assistant/` — ពិតជារឹងមាំ ជាង MVP ឆ្ងាយ:

- `assistant.service.ts` — Anthropic + OpenAI, SSE streaming (`event: …\ndata: …`),
  `MAX_TOOL_ITERATIONS = 8` (agentic loop ពិត), rate limiting per-window,
  provider config មកពី `InstanceService` (`AiConfig`)
- Conversations + messages persisted (`assistant-conversation` / `assistant-message` schemas)
- Routes: `GET config|usage|conversations|conversations/:id` · `PATCH|DELETE conversations/:id` · `POST chat`
- `tools.ts` — **៤ tools**: `search_issues`, `search_wiki`, `get_wiki_page`, `create_issue`

### 2.2 គម្លាត

Tools ទាំង ៤ គឺ **៣ read + ១ create**។ នេះជា "AI ដែលឆ្លើយសំណួរ" — ដូច Linear AI, Jira AI,
Notion AI ដែរ។ គ្មាន moat ទេ។

**Moat ចាប់ផ្ដើមពេល AI *ធ្វើការ* ជំនួស** — ហើយ Prism មានអ្វីដែលអ្នកដទៃគ្មាន៖
tool surface ដែលភ្ជាប់ chat, Telegram, intake, bulk ops, cycles, scheduler **ក្នុង instance តែមួយ**។

### 2.3 ការងារ — ✅ **បិទទាំង ៤ 2026-07-31**

| # | អ្វី | ប្រើអ្វីមានស្រាប់ | Effort |
| - | ---- | ----------------- | ------ |
| 2a ✅ | **Write tools** — `update_issue`, `assign_issue`, `bulk_update`, `move_to_cycle`, `move_to_module`, `create_cycle` | `POST /issues/bulk` + `/bulk/delete` មានស្រាប់ (Phase 7, per-issue authz + partial success — ត្រូវនឹង tool loop ល្អឥតខ្ចោះ) | M |
| 2b ✅ | **Assistant ក្នុង chat + Telegram** — `@prism សរុបអ្វីដែល team ធ្វើសប្ដាហ៍នេះ` | `chat.gateway.ts` + `chat/telegram/` bridge (ADR 0007) | M |
| 2c ✅ | **Auto-triage លើ intake** — submission ចូល → AI ស្នើ label/priority/assignee | `POST /intake/submissions/:id/triage` **មានស្រាប់រួចហើយ** — គ្រាន់តែភ្ជាប់ assistant ចូល | S |
| 2d ✅ | **Weekly digest** — cycle progress សរុបដោយ AI ផ្ញើទៅ Telegram/email រាល់ថ្ងៃសុក្រ | `notifications.scheduler.ts` មាន `@Cron` រួច (`EVERY_DAY_AT_8AM`, `EVERY_WEEK`) | S |

### 2.3.1 អ្វីដែលបានសាងពិត (2026-07-31)

Tools ពី ៤ → **១៥**៖ read ៦ (`search_issues` `search_wiki` `get_wiki_page`
`list_project_members` `list_cycles` `list_modules`) · Tier A ៦ · Tier B ១ · Tier C ២។
Read tools ៣ ថ្មីមិនមែនជា feature ទេ — ជា**លក្ខខណ្ឌចាំបាច់** នៃច្បាប់ id provenance៖
បើ model មិនអាច *រក* id បាន វានឹង *ទាយ*។

រឿងដែលអានកូដមិនឃើញ តែសំខាន់៖

- **Emitter abstraction ជំនួសការ copy loop** — Telegram ត្រូវការ agentic loop ដដែល
  តែគ្មាន SSE។ ជំនួសការសរសេរ loop ទី ២ (ដែលនឹងបែកចេញពីគ្នាភ្លាម) `LoopParams.res:
  Response` ប្ដូរជា `emit: LoopEmitter`; web បញ្ជូន SSE emitter, Telegram/digest
  បញ្ជូន `SILENT`។ Loop មិនដឹងថាមានអ្នកមើលឬអត់។
- **Provenance យកតែពី result ជោគជ័យ** — `runTool` ហៅ `session.observe()` តែពេល
  `run.ok`។ បើយកពី error ផង នោះ `update_issue` លើ id ប្រឌិត នឹង**ធ្វើឲ្យ id នោះ
  ស្របច្បាប់** សម្រាប់ការហៅបន្ទាប់ — គឺជាការបើកផ្លូវឲ្យអ្វីដែល §2.3 ចង់បិទ។
  មាន check ដាច់ដោយឡែកក្នុង suite សម្រាប់រឿងនេះ។
- **`ChatChannel.projectId` គឺជា field ថ្មី** — ADR §2.4 សរសេរថា "scope តាម project
  របស់ channel" ប៉ុន្តែ channel **គ្មាន** project link សោះ។ បន្ថែម (nullable, ដាក់បាន
  តែដោយអ្នកដែល write project នោះបាន) ហើយ **គ្មាន project = assistant មិនដំណើរការ**។
- **Digest ធ្លាក់ចុះបានដោយគ្មាន AI** — `complete()` ត្រឡប់ `null` ពេលគ្មាន key ហើយ
  `plainSummary()` សរសេរការពិតដដែលដោយគ្មាន prose។ Digest ជា notification feature
  ដែល AI ធ្វើឲ្យប្រសើរ មិនមែន feature ដែល AI ជា gate។ ដូចគ្នាសម្រាប់ intake
  suggestion (គ្មាន suggestion ≠ triage ខូច)។
- **Suite ជា TypeScript in-process** — ច្បាប់ tier/provenance/pin គ្មាន HTTP surface
  **ដោយចេតនា** (tool-runner តាម HTTP គឺជា surface ដែល ADR នេះកើតឡើងដើម្បីជៀស)។
  ដូច្នេះ `test:assistant-tools` boot `NestFactory.createApplicationContext` ពិត ហើយ
  ហៅ service ពិតជាមួយ fixture ពិត។ ត្រូវការ `ts-node --files` — បើគ្មាន `--files`
  ambient `.d.ts` (`markdown-it-task-lists`) មិនចូល program ហើយ compile បរាជ័យ
  ទោះ `nest build` ជោគជ័យក៏ដោយ។

**បញ្ជាក់**: `test:assistant-tools` **25/25** (18 ដើម + 7 សម្រាប់ Telegram reply mirror,
2026-08-06) · regression `test:security` 21 ·
`test:phase7` 44 · `test:phase8` 16 (រួម intake triage) · `test:cycles-modules` 30 ·
បូកនឹងការ drive endpoint ថ្មីលើ API ពិត។

**នៅសល់ដោយចេតនា**: (១) ~~`apps/web` គ្មានអេក្រង់ intake~~ — **សាងរួច 2026-08-06**:
triage queue `/[workspaceSlug]/intake` + public form `/spaces/intake/[anchor]`,
suite `pnpm --filter web test:intake`; (២) ~~ចម្លើយ Telegram
ចូលតែ group មិនចូល Prism channel~~ — **សាងរួច 2026-08-06**: ចម្លើយចូល channel ជា
`kind: 'system'` ក្រោមឈ្មោះ `Prism assistant`, សរសេរតាម `ingestFromTelegram`
(មិនមែន `send()`) ដូច្នេះវាមិន relay ត្រឡប់ទៅ group វិញ ហើយ dedupe លើ
`{chatId, messageId}` ដដែល; (៣) model round-trip
មិនទាន់ដេញក្នុង CI ព្រោះគ្មាន AI key — អ្វីដែល suite បញ្ជាក់គឺ layer authorization។

### 2.4 ហេតុអ្វីនេះឈ្នះ

- **2c ជាការងារតូចបំផុតដែលមានតម្លៃភ្លាម** — endpoint triage មានរួច, គ្រាន់តែបំពេញវា។
- **2b គឺជាអ្វីដែលចម្លងមិនបាន** — Linear/Jira នឹងមិនសាង Telegram-native assistant ទេ
  ព្រោះទីផ្សារគោលដៅរបស់គេប្រើ Slack។ ចំណែក team កម្ពុជា **រស់នៅក្នុង Telegram**។
- 2a ប្រែ assistant ពី "ជំនួយការឆ្លើយសំណួរ" → "សមាជិក team" — នេះជា narrative លក់បាន។

### 2.5 ត្រូវការ ADR — ✅ **សរសេររួច 2026-07-31**: `docs/adr/0015-assistant-write-tools-and-authorization.md`

សេចក្ដីសម្រេចសំខាន់៖ (១) គ្រប់ tool ដំណើរការ**ជា caller** មិនមែន service account
(`[LOCKED]`) ដូច្នេះ blast radius នៃ prompt injection = អ្វីដែល user នោះចុចបាន។
(២) Tool បែងចែក ៣ tier តាម blast radius — Tier A auto, Tier B (bulk) auto តែមាន cap
និងច្បាប់ "id ត្រូវធ្លាប់លេចក្នុង tool result មុន", Tier C (លុប/publish/ផ្ញើចេញក្រៅ)
**ត្រូវការ confirmation** ហើយ tool ត្រឡប់ `pendingAction` ជំនួសការធ្វើ។
(៣) Telegram: `TelegramIdentity.userId === null` → assistant **មិនដំណើរការសោះ**
(ឆ្លើយតែពាក្យណែនាំឲ្យ link); linked → ដំណើរការជាអ្នកនោះ តែ scope តាម **project របស់
channel** ព្រោះចម្លើយឃើញដោយសមាជិកគ្រុបទាំងអស់; Tier B/C បិទលើ Telegram។
(៤) 2c ស្នើ មិនធ្វើ — `triage` នៅតែត្រូវការមនុស្ស។ (៥) 2d គ្មាន identity ដូច្នេះ
summarise តែ payload ដែល scoped រួច មិន call tool។ (៦) រាល់ write តាម tool ចូល
`AuditLog` ជាមួយ `detail.via = 'assistant'`។

សំណួរដើមដែល ADR ឆ្លើយ:

- Write tool ដំណើរការក្រោម audience/permission របស់អ្នកណា? (**ត្រូវជា caller មិនមែន service account**)
- Tool ណាត្រូវការ confirmation ពីអ្នកប្រើ vs auto-execute? (bulk delete ត្រូវតែ confirm)
- ក្នុង Telegram — bridge identity ដែលមានស្រាប់ map ទៅ Prism user យ៉ាងម៉េច? តើ
  គ្មាន account → តើអនុញ្ញាតឲ្យអានអ្វី? (**ចំណុចលេចធ្លាយសក្តានុពល — ត្រូវ design មុន**)
- Audit: រាល់ write ដែល AI ធ្វើ ត្រូវចូល `activity`/`audit` ដោយសម្គាល់ថាមកពី assistant

---

## 3. Tier 1 — Moat ទី ២: ភាសាខ្មែរ + សម្រាប់ទីផ្សារកម្ពុជា

### 3.1 ស្ថានភាព

**គ្មាន i18n framework សោះ** ក្នុង `apps/web`។ Hit ទាំងអស់ដែលរកឃើញគឺ `toLocaleDateString`
ធម្មតា — string ទាំងអស់ hardcoded។ (កត់សម្គាល់៖ ឯកសារ plan/ADR សរសេរជាខ្មែរ តែ **product UI ជាអង់គ្លេស**។)

### 3.2 ហេតុអ្វីនេះជា differentiator ពិត

| App | ភាសាខ្មែរ | Telegram-native |
| --- | --------- | --------------- |
| Plane | ❌ | ❌ |
| Linear | ❌ | ❌ |
| Jira | ❌ | ❌ |
| ClickUp | ❌ | ❌ |
| Notion | ❌ | ❌ |
| **Prism** | **អាចមាន** | **មានស្រាប់** |

នេះមិនមែន "feature ល្អ" ទេ — វាជា **entry barrier**។ គ្មាន competitor ណាមួយនឹងចំណាយ
ដើម្បីចូលទីផ្សារកម្ពុជាឡើយ ហើយ Telegram bridge (ADR 0007) បានសាងរួចហើយ។

### 3.3 ការងារ

| # | អ្វី | ចំណាំ | Effort |
| - | ---- | ----- | ------ |
| 3a | ✅ **បិទ 2026-08-06** — `packages/i18n` + locale switch + persist | មើល §3.5 | M |
| 3b | ✅ **បិទ 2026-08-06** — បកប្រែ nav + issues/projects/cycles/modules | មើល §3.6 | L |
| 3c | ✅ **បិទ 2026-08-06** — ថ្ងៃឈប់សម្រាកខ្មែរ + cycle capacity | មើល §3.6 | S |
| 3d | ✅ **បិទ 2026-08-06** — seed ទម្រង់ + តម្រៀបឈ្មោះ + ESLint guard | មើល §3.6 | S |

### 3.4 ត្រូវការ ADR — ✅ **សរសេររួច 2026-08-06**: `docs/adr/0016-i18n-and-khmer-localization.md`

ចម្លើយ: locale នៅក្នុង **cookie** (`pr_locale`) ដែល mirror ទៅ `User.locale`;
**មិនដាក់ក្នុង URL** ទេ (ADR 0011 ទើបតែបង្រួម route space រួច — locale segment
នឹងគុណរាល់ route និងរាល់ shim; ហើយ segment ទី ១ ជា `[workspaceSlug]` ដែលជាទិន្នន័យ
អ្នកប្រើ)។ **មិនប្រើ localStorage** ដូច theme ទេ ព្រោះភាសាជា *content* ដែល server
render — store ដែល server មើលមិនឃើញ = SSR ខុសភាសា + hydration mismatch។

### 3.5 អ្វីដែលបានសាងពិត (3a, 2026-08-06)

`packages/i18n` ថ្មី (~150 បន្ទាត់, គ្មាន dependency): `LOCALES` en/km · cookie/header
constants · `resolveLocale()` (cookie → Accept-Language → en, កន្លែងតែមួយដែល ៣ app អាន) ·
`createTranslator` + `LocaleProvider`/`useT`/`useFormat` · `formatDate/Time/Number` +
`compareNames` លើ `Intl`។ `User.locale` ថ្មីក្នុង API។ Middleware ទាំង ៣ ដាក់ `x-locale`,
root layout អាន → `<html lang>` + provider។ Switcher នៅ Settings → Appearance។
Sidebar ទាំងមូលបកប្រែហើយ (slice ដំបូង)។

រឿងដែលរកឃើញពេលធ្វើ — មិនឃើញដោយ typecheck ឬ build:

- **Font ខ្មែរត្រូវបានផ្ទុករួច តែឈានមិនដល់** — root layout ទាំង ៣ load Kantumruy Pro ជា
  `--font-khmer` តាំងពីមុន តែ `tailwind-preset` កំណត់ `sans: [var(--font-sans), Inter, …]`
  គ្មានពុម្ពខ្មែរ។ រាល់ទំព័រ download webfont ខ្មែរដែលគ្មាន UI ណាប្រើ។ ឥឡូវ stack តែមួយ
  មានទាំងពីរ (មិនប្ដូរ stack តាម locale — string លាយអក្សរពីរជារឿងធម្មតានៅទីនេះ)។
- **`hydrateLocale` មិនត្រូវ reload** — វារត់ក្នុង `onAuthSuccess` មួយបន្ទាត់មុន login page
  navigate; reload ត្រង់នោះ **លុបចោល navigation** ហើយអ្នកប្រើត្រឡប់មក `/login` វិញ ដូច
  login បរាជ័យ។ ឥឡូវវាត្រឡប់ boolean, caller ជាអ្នកសម្រេច។
- **§3.3 (space នឹងបាត់ static rendering) មិនកើតឡើង** — space ជា `force-dynamic`
  + `no-store` រួចហើយ ព្រោះ unpublish ត្រូវមានប្រសិទ្ធភាពភ្លាម។ គ្មានអ្វីត្រូវបាត់។

Suite ថ្មី `pnpm --filter web test:i18n` **9/9** (cookie ឆ្លង reload · `lang` ក្នុង HTML
ពី server · computed font-family · device ថ្មីទទួល `User.locale` · space គោរព cookie)។
`km` ខ្វះ key = **compile error** (បញ្ជាក់ដោយលុប key មួយមើល)។

### 3.6 អ្វីដែលបានសាងពិត (3b/3c/3d, 2026-08-06)

**3d — seed ទម្រង់។** `apps/web/src/lib/format.ts` **លុបចោល** `fmtDate` ·
`fmtDateShort` · `monthLabel` · `relTime` មិនទុកជា wrapper ទេ — helper កាលបរិច្ឆេទ
ដែលគ្មាន argument locale អាច render បានតែអង់គ្លេស ហើយបើទុកឈ្មោះទាំងនោះ call site
ទាំង ៩៣ នឹង compile ដដែល តែនៅជាអង់គ្លេសស្ងាត់ៗ។ លុបចោល = compiler ក្លាយជាបញ្ជីការងារ។

**មិនមែន `toLocale*` គ្រប់កន្លែងជា locale call ទេ។** ESLint rule ថ្មីលើកលែង ៣ ក្រុម
(`apps/web/.eslintrc.js`, ប្ដូរពី JSON ដើម្បីឲ្យការលើកលែងពន្យល់ខ្លួនឯងបាន)៖ ទម្រង់លេខ
spreadsheet + formula engine (cell ដែលម្ចាស់កំណត់ `1,234.56` ត្រូវដូចគ្នាសម្រាប់អ្នកមើល
គ្រប់រូប) · report `element-*` (កាន់ format code ចូល document ដែល export/email) ·
kiosk report display (ខ្មែរដោយចេតនា)។ ករណីទី ៤ មិនមែនលើកលែងទេ — ជា **bug**៖
`timeline/page.tsx` ប្រើ `toLocaleDateString('en-CA')` ៧ ដង ជា **grouping key**។
`dateKey()` មានសម្រាប់រឿងនេះ។

**រកឃើញសំខាន់បំផុត៖ Chromium គ្មានទិន្នន័យ locale `km` ទេ។**
`Intl.DateTimeFormat.supportedLocalesOf(['km'])` ទទេ ហើយ `km-KH` ធ្លាក់ទៅ `en-US`
ស្ងាត់ៗ — រាល់កាលបរិច្ឆេទលើអេក្រង់ខ្មែរ render ជា "Aug 6, 2026"។ ថៃ/បារាំង/ជប៉ុន/វៀតណាម
ដំណើរការទាំងអស់; មានតែខ្មែរទេដែលអត់។ **Node (full ICU) វិញមាន** — ហេតុនេះទើបគ្មានអ្វី
ចាប់បានៈ test ខាង server ឬ unit test នឹងបោះពុម្ពខ្មែរល្អឥតខ្ចោះ ហើយបញ្ជាក់អ្វីមិនបាន។
`@prism/i18n` ឥឡូវកាន់ឈ្មោះខែ ១២ + ឈ្មោះថ្ងៃ ៧ ដោយខ្លួនឯង ប្រើតែពេល runtime គ្មាន
ទិន្នន័យខ្មែរ — ថោកជាង polyfill `@formatjs` ដែល ADR ចង់ជៀស។ `Intl.Collator('km')`
ក៏រងផលដែរ តែ **មិនបានជួសទេ**: វាធ្លាក់ទៅ root collation ដែលតម្រៀបខ្មែរមិនល្អឥតខ្ចោះ
ជាជាងខុស ហើយសរសេរ collation ខ្មែរដោយដៃជាការប្ដេជ្ញាធំជាងនាម ១៩ ពាក្យឆ្ងាយ។

**ការសន្មតរបស់ §2.7 អំពីតម្រៀបឈ្មោះខុស។** វាថា member list / assignee picker /
mention menu "តម្រៀបដោយ `localeCompare` ធម្មតា"។ តាមពិត **វាមិនតម្រៀបសោះ** — បញ្ជី
សមាជិកគម្រោង render តាមលំដាប់ដែលគេត្រូវបានបន្ថែម។ `compareNames` ឥឡូវប្រើនៅទីនោះ
និងនៅកន្លែងតម្រៀបឈ្មោះដែលមានស្រាប់ (files · folders · notes · projects)។

**3c — ថ្ងៃឈប់សម្រាក។** `packages/constants/src/khmer-holidays.ts` ជាតារាង keyed
តាមឆ្នាំ មាន `status` ក្នុងមួយឆ្នាំ ព្រោះពាក់កណ្ដាលនៃថ្ងៃឈប់សម្រាកកម្ពុជាតាមចន្ទគតិ
ហើយកំណត់ដោយអនុក្រឹត្យប្រចាំឆ្នាំ — គ្មានរូបមន្តទេ។ `workingDaysBetween` ត្រឡប់
`{ workingDays, calendarDays, holidaysLost, status }` ហើយឆ្នាំដែលគ្មានក្នុងតារាង
រាយការណ៍ `'unknown'` ជំនួសលេខដែលមើលទៅច្បាស់ — ព្រោះចាត់ទុក "គ្មានទិន្នន័យ" ជា
"គ្មានថ្ងៃឈប់" ធ្វើឲ្យក្រុមប្ដេជ្ញាលើសរហូតដល់ ៣ សប្ដាហ៍ក្នុងមួយឆ្នាំ។ ជួរដែលឆ្លងឆ្នាំដឹង
និងឆ្នាំមិនដឹង យក status ខ្សោយជាងគេ មិនមែនមធ្យមភាគ។ ២០២៦ ជា `provisional`៖
កាលបរិច្ឆេទថេរច្បាស់ តែកាលបរិច្ឆេទចន្ទគតិត្រូវផ្ទៀងនឹងអនុក្រឹត្យសិន។ ករណីជម្រុញត្រូវបាន
assert៖ sprint ២ សប្ដាហ៍ឆ្លងចូលឆ្នាំខ្មែរ = **៧ ថ្ងៃធ្វើការ មិនមែន ១០**។

**Suite ថ្មី/ពង្រីក។** `pnpm --filter web test:i18n` 9 → **14** ·
`pnpm --filter @prism/constants test` **11** (pure function, គ្មាន browser/DB)។
មេរៀន test មួយ៖ ជំនាន់ដំបូងនៃ check កាលបរិច្ឆេទ assert ថា "ខ្មែរលេចលើទំព័រប្រតិទិន"
ដែល**ជាប់** ខណៈរាល់កាលបរិច្ឆេទនៅជាអង់គ្លេស — ព្រោះ nav ជាខ្មែររួចហើយ។ Assert លើ
element ជាក់លាក់ទើបរកឃើញ ICU ខ្វះ។

---

## 4. Tier 2 — តម្លៃច្បាស់ តែមិនមែន moat

តម្រៀបតាម (តម្លៃ ÷ effort)។ ធ្វើក្រោយ Tier 0 + យ៉ាងហោចណាស់ moat មួយ។

| # | អ្វី | ហេតុផល | Effort |
| - | ---- | ------- | ------ |
| 4a | **Search ⌘K = រក + *ធ្វើ*** | `CommandPalette` មានស្រាប់ (Phase 6 Tier 3)។ បន្ថែម action ("assign to me", "move to cycle") ធ្វើឲ្យវាដូច Linear — keyboard-first ជា signal "professional tool" | M |
| 4b | **Time tracking / worklog** | គ្មានទាល់តែសោះ។ Timer → worklog → billable → invoice ជាអ្វីដែល agency/outsourcing ត្រូវការ ហើយ Plane ខ្សោយខ្លាំង។ ត្រូវការ §1.2 (estimates) ជាមុន | L |
| 4c | **Automations rule builder UI** | Backend មានស្រាប់ (trigger/condition/action/log) តែគ្មាន UI = គ្មានអ្នកប្រើ។ ~~ត្រូវការ §1.4 មុន~~ — §1.4 (tenancy) និង condition engine (`modules/automations/condition.ts`, បិទ 2026-07-31) **រួចរាល់ទាំងពីរ**។ UI អាច render grammar ដែលមានស្រាប់ដោយផ្ទាល់៖ ops = `CONDITION_OPS`, group = `all`/`any`/`not` | M |
| 4d | **Semantic search លើ wiki** (embeddings) | "រកអ្វីដែលខ្ញុំមិនចាំពាក្យ"។ ធ្វើក្រោយ §1.3 (text index) — កុំលោត | M |
| 4e | **PWA + mobile** | គ្មាន manifest, គ្មាន service worker។ Mobile ជា weak spot របស់ Plane/Linear/Jira ទាំងអស់ | L |
| 4f | **Analytics ស្អាត** (burndown, velocity, "អ្នកណា overloaded") | `analytics` + `reports` + `dashboard` មានស្រាប់; cycle rollup ត្រឡប់ `byStatus` រួច។ ភាគច្រើនជាការងារ chart — ប្រើ `dataviz` skill | M |

---

## 5. លំដាប់ដែលណែនាំ

```
Tier 0 ────────────────────────────────  ✅ សងអស់ហើយ
  §1.1 search authz  ┐  ✅ បិទ 2026-07-30 (test:security 21/21)
  §1.3 text index    ┘
  §1.2 estimates លុប + inventory check  ✅ បិទ 2026-07-31
  §1.4 automations workspaceId          ✅ បិទ 2026-07-31 (test:phase7 38/38)

Tier 1 ────────────────────────────────  ផ្លូវ A ចប់ហើយ
  ផ្លូវ A (AI):     ADR 0015 → 2c → 2d → 2a → 2b  ✅ បិទ 2026-07-31 (18/18)
  ផ្លូវ B (ខ្មែរ):   ADR 0016 ✅ → 3a ✅ → 3d ✅ → 3c ✅ → 3b ✅ (ទាំងអស់ 2026-08-06)

Tier 2 ────────────────────────────────  ក្រោយពេល moat មួយចប់ពិត
  4a → 4f → 4c → 4b → 4d → 4e
```

**ការណែនាំ**: Tier 0 បិទហើយ (2026-07-31) → **ផ្លូវ A** មុន។ ហេតុផល — 2c និង 2d ជា effort **S** ទាំងពីរ
ព្រោះ endpoint (`intake/submissions/:id/triage`) និង cron (`notifications.scheduler.ts`)
មានស្រាប់រួច។ វាបញ្ជាក់តម្លៃមុននឹងចំណាយលើ 2a/2b ធំ។ ផ្លូវ B ជា moat ធំដូចគ្នា តែ 3b
ជាការងារបន្តរយៈពេលវែង — ត្រូវការ commitment ជាង។

---

## 6. Definition of done

ដូច phase ដទៃ (`.claude/rules/workflow.md`) — **build + បានឃើញដំណើរការពិត**, មិនមែនត្រឹម typecheck:

- API: `pnpm --filter api build`
- Frontends: `pnpm --filter <app> build` (ឬ `typecheck` ពេល iterate)
- **Tier 0 ត្រូវការ E2E check ថ្មីក្នុង `test:security`** — មិនមែនត្រឹមអានកូដ
- Suite ថ្មីត្រូវចូល `scripts/e2e-full.mjs` (ដំណើរការរៀងៗខ្លួន — មើល memory: E2E suite serialization)
- ក្រោយពេលការងារចុះ: កែ checkbox ក្នុង `PLANE-CONVERSION-PLAN.md` §8 (SessionStart hook អានពីទីនោះ)

---

## 7. អ្វីដែល*មិន*គួរធ្វើ

- **កុំបន្ថែម module ថ្មី** មុនពេល ៣៣ module ដែលមានស្រាប់មាន UI + test។ Surface ធំរាក់
  ជាការវិនិច្ឆ័យក្នុង §0 — កុំធ្វើឲ្យវាធ្ងន់ជាងមុន។
- **កុំដេញតាម parity ១០០%** ជាមួយ Plane។ ឯកសារ 03 នៅមានប្រអប់ទទេ (relations, sub-issue
  rollup, workspace views) — ខ្លះមិនសំខាន់។ Moat ឈ្នះ parity។
- **កុំសរសេរ i18n បន្តិចម្ដងៗដោយគ្មាន ADR** — locale strategy ខុសពាក់កណ្ដាលផ្លូវ ថ្លៃណាស់។
- **កុំបើក AI write-tools មុន ADR 0015** — path ពី Telegram → assistant → mutation
  គឺជាចំណុចលេចធ្លាយ authz ដ៏ជាក់ស្ដែង។
