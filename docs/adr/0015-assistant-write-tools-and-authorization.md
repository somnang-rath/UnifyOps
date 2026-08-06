# ADR 0015 — AI assistant write tools & authorization

- **Status**: Accepted
- **Date**: 2026-07-31
- **Scope**: `apps/api/src/modules/assistant/` · `chat/telegram/` · `intake/` ·
  `notifications.scheduler.ts` · `audit/`
- **Context**: `docs/plan/06-differentiators.md` §2 (Tier 1, path A) — the item
  list 2a–2d depends on this decision, per §2.5.

## 1. Context

`modules/assistant/` already runs a real agentic loop: two providers
(Anthropic + OpenAI), SSE streaming, `MAX_TOOL_ITERATIONS = 8`, persisted
conversations, and four tools — `search_issues`, `search_wiki`, `get_wiki_page`,
`create_issue`.

Three of those read and one creates. That is an assistant which *answers
questions*, which is what Linear AI, Jira AI and Notion AI already are. The moat
§2.2 argues for begins when the assistant *does the work*, and what Prism has
that the others do not is a single instance where chat, a Telegram bridge,
intake forms, bulk operations, cycles and a scheduler all sit behind one API.

Turning an assistant loose on write operations is where an "AI feature" becomes
a security surface. This ADR fixes the rules before any of 2a–2d is written.

## 2. Decisions

### 2.1 Every tool runs as the calling user. No service account. `[LOCKED]`

A tool call executes through the same service method the HTTP route uses, with
the caller's `userId`. It is not merely *checked against* the user's
permissions — it *is* the user's call.

This is already how the four existing tools behave (`runTool(name, input, user,
deps)`), and it is the single most important property to preserve: it makes the
blast radius of a prompt injection exactly "what this user could have done by
clicking", and no larger. A service account with union permissions would make
any successful injection an instance-wide privilege escalation.

Consequences that follow, and must not be "optimised" away later:

- No tool takes a `userId`/`actAs` parameter. The model never names the actor.
- No tool bypasses `ProjectAccessService`. A tool that needs a new query adds a
  method to the owning service with the normal authz, rather than reaching into
  a model directly.
- Failures stay failures. A 403 is returned to the model as
  `{ ok: false, content: "…" }` (never thrown), so the loop can tell the user
  it was not allowed — it must never be retried with wider credentials.

### 2.2 Write tools are split into three tiers by blast radius `[LOCKED]`

| Tier | Meaning | Tools | Execution |
| ---- | ------- | ----- | --------- |
| **A — reversible, single object** | One record, trivially undone | `update_issue`, `assign_issue`, `move_to_cycle`, `move_to_module`, `create_issue`, `create_cycle` | Auto-execute |
| **B — multi-object** | One call, many records | `bulk_update` | Auto-execute **capped**, see §2.3 |
| **C — destructive or outward-facing** | Not undoable, or visible outside the workspace | `bulk_delete`, `delete_issue`, publishing, anything that sends mail/Telegram to others | **Confirmation required** — never auto-executed |

Tier C is not a UX preference, it is the containment boundary. An injected
instruction that can only edit issues is a nuisance; one that can delete a
hundred of them, or publish a private board to the public Space, is an incident.

**Confirmation shape**: a Tier C tool call does not perform the action. It
returns a `{ ok: true, content: { pendingAction: … } }` describing what *would*
happen (ids, counts, the exact mutation), and the client renders an explicit
confirm affordance that calls the ordinary REST endpoint. The model is never
handed a token that completes the action, because a model that can describe a
confirmation can be talked into claiming it received one.

### 2.3 `bulk_update` reuses `POST /issues/bulk` and inherits its semantics

Phase 7 already built the right primitive: per-issue authorization, partial
success, a 100-id cap, no URL surface. The tool calls the same service path, so:

- an id the user cannot write fails *alone* — the batch is partial, not 403;
- the cap is the existing 100, not a new number;
- the tool's result to the model is the same `{ updated, failed }` shape, which
  is exactly what an agentic loop needs to decide what to do next.

The tool adds one restriction on top: it may only act on ids that appeared in a
**previous tool result in the same conversation**. The model may not synthesise
ids. This is cheap to enforce (the loop already has the transcript) and closes
the "guess ObjectIds until one works" path, which per-issue authz would refuse
anyway but which would otherwise be a free existence oracle.

### 2.4 Telegram: an unlinked sender gets nothing `[LOCKED]`

This is the leak §2.5 flagged, and the existing bridge already has the right
model — it just has to be enforced rather than assumed.

`TelegramIdentity` maps `telegramUserId → userId`, and `userId` stays **null**
until the person claims it through `startLink` + a verification code. Its own
doc comment states that an unclaimed sender is a first-class case, never a
reason to auto-provision an account. Messages from them are stored with
`authorId: null` and an `externalAuthor` blob.

Therefore, for `@prism …` in a bridged channel:

- **`userId` is null → the assistant does not run.** It replies once, publicly,
  with a link instruction. It does not answer, does not summarise, does not read
  anything. A Telegram group can contain anyone the group admin invited; treating
  an unverified chat member as a workspace reader would hand a stranger the
  contents of every project a linked colleague can see.
- **`userId` is set → run exactly as §2.1**, as that user. Their Prism
  permissions apply unchanged; being in the Telegram group grants nothing.
- **Tier B and C tools are disabled entirely over Telegram.** The confirmation
  UI of §2.2 does not exist there, and a bridged channel has no reliable way to
  prove *which* group member pressed what. Telegram gets read tools plus Tier A.
- The reply goes to the channel, which means **the answer is visible to everyone
  in the group, including unlinked members**. So the assistant's Telegram
  responses are scoped to the *channel's* project, not to everything the asking
  user can read — otherwise a linked user asking a broad question leaks private
  projects into a group chat. This is a narrower scope than the web assistant on
  purpose.

### 2.5 Auto-triage (2c) proposes; a human accepts

`POST /intake/submissions/:id/triage` already exists and already creates the
issue under the triaging user (`intake.service.ts` → `issues.create(userId, …)`).
The assistant's job is to fill in the *suggestion*, not to press the button:

- On submission arrival, the assistant produces `{ suggestedPriority,
  suggestedLabels, suggestedAssigneeId, reasoning }`, stored on the submission.
- `triage` continues to require a real user, and the accept path pre-fills from
  the suggestion. Declining, and accepting with edits, both stay one click.
- Nothing about the intake path becomes automatic. An intake form is a public
  write surface (that is the point), so an assistant that auto-created and
  auto-assigned issues from it would be an unauthenticated stranger driving
  workspace state through a model.

### 2.6 Weekly digest (2d) runs as nobody, and therefore reads nothing private

`notifications.scheduler.ts` has the `@Cron` hooks. A scheduled job has no
calling user, which under §2.1 means it has no read permissions at all. Rather
than inventing a service identity, the digest is built from data the scheduler
*already* aggregates per recipient, and each recipient's digest is assembled
from **their own** readable set. The model summarises a payload that was already
scoped; it never issues tool calls, and it never sees a cross-user corpus.

### 2.7 Every assistant-driven write is audited as such

The `AuditLog` schema records `actorId`, `action`, `audience`, `detail`. Writes
made through a tool record the real user as `actorId` (they are accountable —
they asked) and add `detail.via = 'assistant'` plus the conversation id.

"Who changed this, and did a human actually intend it" must be answerable later.
Without the marker, an assistant-driven bulk edit is indistinguishable from a
person doing it by hand, which is precisely the question anyone will ask the
first time one goes wrong.

## 3. Alternatives considered

- **A service account with instance-wide read** — rejected. It makes every
  prompt injection an instance-wide breach, and it destroys the property that
  makes tool-calling defensible at all (§2.1).
- **Auto-execute everything, rely on undo** — rejected. There is no undo for a
  publish or an outbound Telegram message, and `bulk_delete` has none either.
- **Auto-provision a Prism user for unlinked Telegram senders** — rejected. It
  contradicts `TelegramIdentity`'s existing design and converts "was added to a
  group" into "has a workspace account".
- **Give the digest job a read-everything identity** — rejected for the same
  reason as the service account; §2.6 gets the same outcome without one.

## 4. Consequences

- 2a ships Tier A first; `bulk_update` (Tier B) needs the prior-result id rule,
  and Tier C needs the confirmation affordance in `apps/web` before any
  destructive tool is defined at all.
- 2b is deliberately less capable than the web assistant. That is the cost of a
  channel where identity is per-message and the audience is a group.
- 2c and 2d stay effort **S** as §2.3 estimated, because neither introduces a
  new authorization path — 2c fills an endpoint that already exists, 2d
  summarises data the scheduler already gathers.
- The tool loop needs the conversation transcript available to `runTool` for the
  §2.3 id rule; today `runTool` receives only `(name, input, user, deps)`.

## 5. Verification

A new suite, `apps/api/test/assistant-tools.e2e.mjs`, must prove, at minimum:

1. a tool call cannot touch a project the caller cannot read (404/403 relayed as
   a tool error, not an exception, and the stream survives);
2. `bulk_update` on a mixed set updates only the writable ids and reports the
   rest as failed;
3. `bulk_update` refuses ids that never appeared in a prior tool result;
4. an unlinked Telegram sender gets the link instruction and **no** data;
5. a linked Telegram sender is answered within the channel's project scope only;
6. a Tier C tool returns a `pendingAction` and performs nothing;
7. every write through a tool leaves an `AuditLog` row with `detail.via ===
   'assistant'`.

Per `.claude/rules/workflow.md`, none of 2a–2d is done until it has been driven
end-to-end, not merely typechecked.
