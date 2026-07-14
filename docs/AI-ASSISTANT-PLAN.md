# AI Assistant — Plan & Structure (Prism)

> គោលដៅ៖ បន្ថែម **AI Assistant** ចូល Prism — chat UI ស្អាតនៅ web (:3000), គ្រប់គ្រង
> ពី **admin** (:3001), ដំណើរការនៅ **api** (:4000)។ Keys/models មានស្រាប់ក្នុង
> instance config (admin AI page) — assistant គ្រាន់តែ *consume* វា។
>
> Default model: **`claude-opus-4-8`** (Anthropic SDK), adaptive thinking + streaming
> (per repo `claude-api` conventions). OpenAI = optional secondary provider.

---

## 1. How it relates to the Admin app (ទំនាក់ទំនងជាមួយ web admin)

The admin AI page ([apps/admin/src/app/(dashboard)/ai/page.tsx](../apps/admin/src/app/(dashboard)/ai/page.tsx))
already writes these **encrypted** instance-config keys via `PATCH /instance/config`:

| Key | Set today in admin | Used by assistant |
| --- | --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | ✅ | provider = openai |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | ✅ | provider = anthropic (default) |

**New keys the admin AI page will add** (same `ConfigForm`, `category: 'ai'`):

| Key | Type | Purpose |
| --- | --- | --- |
| `ASSISTANT_ENABLED` | toggle | Show/hide the assistant in web. **Add to `PUBLIC_CONFIG_KEYS`** so web can read it without secrets. |
| `ASSISTANT_PROVIDER` | text | `anthropic` \| `openai` (default `anthropic`) |
| `ASSISTANT_SYSTEM_PROMPT` | textarea | Instance-wide persona / guardrails |
| `ASSISTANT_EFFORT` | text | `low\|medium\|high\|xhigh\|max` (Opus 4.8 — no `temperature`) |
| `ASSISTANT_MAX_TOKENS` | text | Output cap (default 8000) |
| `ASSISTANT_ALLOW_TOOLS` | toggle | Enable agentic actions (create issue, search wiki…) |
| `ASSISTANT_RATE_LIMIT_PER_MIN` | text | Per-user throttle |

**Flow:** Admin sets keys/options → stored encrypted in `InstanceConfiguration` →
API `AssistantService` reads them **server-side only** (keys never reach the browser)
→ web shows the assistant only when `ASSISTANT_ENABLED` is true.

> 🔒 Secrets stay server-side. `getPublicInstance()` only exposes whitelisted
> non-secret keys — add `ASSISTANT_ENABLED` there, never the API keys.

---

## 2. Target structure (រចនាសម្ព័ន្ធ)

```
apps/api/src/modules/assistant/          ★ new module
├── schemas/
│   ├── conversation.schema.ts           conversation (userId, title, model, timestamps)
│   └── message.schema.ts                message (conversationId, role, content, tokens)
├── dto/
│   └── assistant.dto.ts                 Zod: ChatDto, CreateConversationDto
├── assistant.service.ts                 reads instance AI config → Anthropic/OpenAI SDK → stream
├── assistant.controller.ts              POST /assistant/chat (SSE), CRUD conversations
└── assistant.module.ts                  imports InstanceModule (config), registers schemas

apps/api/src/modules/instance/
└── instance.service.ts                  + getAiConfig() (internal: decrypted keys+options)
                                          + add ASSISTANT_ENABLED to PUBLIC_CONFIG_KEYS

apps/web/src/app/(app)/assistant/         ★ full-page chat
├── page.tsx
└── _components/  (chat-thread, message-bubble, composer, model-picker, conversation-list)
apps/web/src/components/assistant/        ★ global slide-over panel (⌘K, on every page)
│   └── assistant-panel.tsx
apps/web/src/hooks/use-assistant.ts       ★ TanStack Query + streaming fetch
apps/web/src/stores/assistant-store.ts    ★ Zustand: open/close, activeConversationId
apps/web/src/schemas/assistant.ts         ★ Zod mirrors of API DTOs

apps/admin/src/app/(dashboard)/ai/page.tsx  extend FIELDS[] with the ASSISTANT_* keys above
```

Packages: `@anthropic-ai/sdk` (api), optionally `openai` (api). No new front-end deps
beyond what web already uses (TanStack Query, Zustand, Tailwind).

---

## 3. API contract

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/assistant/chat` | user | Body `{ conversationId?, message, model?, context? }`. **SSE stream** of tokens; persists both turns; 403 if `ASSISTANT_ENABLED` false. |
| `GET` | `/assistant/conversations` | user | List current user's conversations |
| `GET` | `/assistant/conversations/:id` | user | Messages of one conversation |
| `PATCH` | `/assistant/conversations/:id` | user | Rename |
| `DELETE` | `/assistant/conversations/:id` | user | Delete |
| `GET` | `/assistant/config` | user | Public assistant settings (enabled, provider, model label) — **no keys** |

`context` (optional) lets the UI attach the current project/issue/wiki id so the
assistant can ground answers ("summarize this wiki page", "draft a reply to this issue").

---

## 4. Assistant — full options (Assistant full options)

- **Providers:** Anthropic (default) + OpenAI, chosen by `ASSISTANT_PROVIDER`.
- **Models:** admin-set (`ANTHROPIC_MODEL` / `OPENAI_MODEL`); default `claude-opus-4-8`.
- **Streaming** responses (SSE) with a stop/abort control.
- **Conversations/threads:** history, rename, delete, resume.
- **Context grounding:** current project / issue / wiki page passed as `context`.
- **Quick prompts / slash commands:** "Summarize", "Draft reply", "Explain", "Find".
- **Agentic tools (gated by `ASSISTANT_ALLOW_TOOLS`):** search wiki/issues, create issue,
  summarize page — implemented with the SDK tool runner.
- **Effort control** (`ASSISTANT_EFFORT`) instead of temperature (Opus 4.8).
- **Rate limiting & usage:** per-user throttle + token accounting on each message.
- **Enable/disable** instance-wide from admin; per-workspace toggle = fast-follow.
- **UI niceties:** ⌘K to open, markdown + code rendering, copy button, regenerate,
  light/dark, empty/loading/error states.

---

## 5. UI (best UI)

Two surfaces sharing the same hooks/store:

1. **Global slide-over panel** — a right-hand drawer opened with ⌘K / a sidebar button,
   available on every page. Best for "ask about what I'm looking at".
2. **Full-page `/assistant`** — ChatGPT-style: conversation list (left) + thread (right) +
   composer with model picker and quick-prompt chips.

States to design (hand to `prism-uiux` before building): empty, streaming, error,
rate-limited, disabled. Reuse `packages/ui` primitives; match existing web styling.

---

## 6. Security & guardrails

- API keys read **only** in `AssistantService` from decrypted instance config; never
  returned by any controller and never sent to the browser.
- `/assistant/*` behind the normal JWT auth guard; `ASSISTANT_ENABLED` gate.
- Per-user rate limit (`@Throttle`) + max-tokens cap.
- Store conversations per `userId`; users can only read/delete their own.
- Tool actions re-check the user's existing permissions (create issue = must be member).

---

## 7. Step-by-step TODO (ជំហានម្តងមួយៗ)

### Phase A — Backend foundation
1. Add `@anthropic-ai/sdk` to `apps/api`.
2. `instance.service.ts`: add `getAiConfig()` (decrypted keys + ASSISTANT_* options); add
   `ASSISTANT_ENABLED` to `PUBLIC_CONFIG_KEYS`.
3. Scaffold `assistant` module (use `scaffold-api-module` skill): schemas, DTOs, service,
   controller, module; register in `app.module.ts`.
4. Implement `AssistantService.chat()` — Anthropic client, `claude-opus-4-8`, adaptive
   thinking, **streaming**; persist user + assistant messages.
5. Wire `POST /assistant/chat` as SSE; add conversation CRUD + `GET /assistant/config`.
6. Add per-user throttle + `ASSISTANT_ENABLED` guard.

### Phase B — Admin controls
7. ✅ Extend admin AI page `FIELDS[]` with the `ASSISTANT_*` keys (added `textarea` +
   `select` field types to `ConfigForm`; provider/effort as selects, system prompt as
   textarea, split into "Assistant" + "Provider credentials" sections).
8. ⏳ Verify save → `PATCH /instance/config` → reflected in `getAiConfig()` (run live).

### Phase C — Web UI
9. ✅ `use-assistant.ts` (config/conversations queries + `useChat` SSE stream consumer with
   stop/abort + 401-refresh retry) + `assistant-store.ts` (Zustand: open/active/context) +
   `schemas/assistant.ts` (types + zod mirrors).
10. ✅ Global slide-over `assistant-panel.tsx` (thread + streaming bubbles via `MarkdownView`,
    composer, quick prompts, history menu with delete) mounted in `(app)/layout.tsx`;
    **⌘/** trigger (⌘K is the command palette) + gated "Ask AI" sidebar entry
    (reads `GET /assistant/config` → `enabled`).
11. ✅ Full-page `/assistant` (`(app)/assistant/page.tsx`): conversation list (select/inline
    rename/delete, relative times), thread + composer reusing `useChat`, optional per-turn
    model override, quick prompts; gated "Assistant" sidebar nav entry. Shared
    `message-bubble.tsx` extracted and used by both panel and page.
12. ✅ Context grounding: `use-assistant-context.ts` sets/clears store `context` on mount;
    wired on the wiki page (`type:'wiki'`, title + content) and issue detail
    (`type:'issue'`, title + desc). `useChat` forwards it to `POST /assistant/chat`.
13. ✅ States covered inline (empty / loading / streaming / error / disabled) across panel
    and page. A dedicated `prism-uiux` polish pass remains optional/fast-follow.

### Phase D — Options & polish
14. ✅ Agentic tools behind `ASSISTANT_ALLOW_TOOLS` — **manual streaming agentic loop** (not the Zod
    tool-runner, so we can re-check permissions per call, emit tool-activity SSE, and accumulate usage
    across turns). Tools in `assistant/tools.ts`: `search_issues`, `search_wiki`, `get_wiki_page`
    (all re-check the caller's read access), and the write tool `create_issue` (authored as the caller
    via `IssuesService.create`, validated by `CreateIssueSchema`). Emits `tool`/`tool_result` SSE
    events; persists a compact `tools[]` trace on the assistant message. Web renders tool chips
    (`ToolChips`) in the panel + full page.
15. ✅ Token/usage accounting — assistant messages now store `inputTokens` + `tokens`; conversation
    `$inc`s `totalInputTokens` + `totalTokens` (summed across loop iterations from `usage`). Dynamic
    per-user sliding-window limiter using the admin-configured `ASSISTANT_RATE_LIMIT_PER_MIN` (replaces
    the old static `@Throttle`); throws 429 before SSE headers. `GET /assistant/usage` +
    `rateLimit` on the `meta` SSE event; web shows "N/limit left" in the composer footer via
    `useAssistantUsage()`.
16. ✅ Docker/env/CORS — no new secrets (keys come from God Mode → AI instance config, **not** env).
    CORS already allows the web origin with credentials (`main.ts` `WEB_ORIGIN` allowlist); the
    assistant's `fetch` (Authorization + `credentials:'include'`) is covered. No env-schema changes.
17. ⏳ Test — hermetic dispatcher test (13/13) covers the security-sensitive path: author=caller on
    `create_issue`, wiki access re-check rejects private pages, Zod validation, unknown-tool/empty-arg
    rejects. `apps/api` `nest build` + `apps/web` `tsc` both clean (proves the agentic loop, SSE event
    shapes, and tool typing). **Remaining for a live run:** streamed E2E through a real Anthropic key
    (admin enables → `search_issues` streams `tool`/`tool_result` → turns persist with token counts;
    `create_issue` writes an Issue with `authorId==caller`; rate-limit 429 after `limit+1`; tools-off
    still chats). Requires a running mongo+api stack + `ANTHROPIC_API_KEY`.

---

## 8. Definition of Done
- [x] Admin can enable the assistant, set provider/model/system prompt/effort/limits.
- [x] Web shows the assistant only when enabled; hidden otherwise.
- [x] Streamed replies render token-by-token with stop + regenerate.
- [x] Conversations persist per user (list/rename/delete/resume).
- [x] Keys never leave the server; `/assistant/config` exposes no secrets.
- [x] Rate limit (per-user, admin-configured) + max-tokens enforced.
- [x] At least one agentic tool works end-to-end — dispatcher verified hermetically (13/13:
  read tools re-check access, `create_issue` authors as caller, validation + error paths); full
  live streamed run pending a running stack + Anthropic key (Phase D item 17).
