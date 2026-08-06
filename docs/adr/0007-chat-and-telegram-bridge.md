# ADR 0007 — Chat module and the two-way Telegram bridge

- Status: Accepted (build against this)
- Date: 2026-07-20
- Scope: a new `chat` module in `apps/api`, a second Socket.io gateway, a chat UI in
  `apps/web`, and an optional per-channel Telegram relay.
- Owners of build: `prism-backend` (api + gateway), `prism-frontend` (web),
  `prism-architect` owning this contract.

## Context

Prism has no conversation surface. What exists is comments embedded per entity —
`Issue.comments[]`, `MR.comments[]`, and the richer `WorkbookComment` collection. All
three are anchored to a record; none of them answer "where does this team talk?".

Meanwhile most teams using this instance already talk in Telegram. If Prism ships a
chat that ignores that, it becomes a second inbox nobody reads. So chat must work
standalone *and* be able to mirror a Telegram group when a workspace wants it.

Two existing patterns are directly reusable and this ADR leans on both rather than
inventing:

- `notifications.gateway.ts` — the JWT-handshake Socket.io pattern (token from
  `handshake.auth.token`, verify with `JWT_ACCESS_SECRET`, disconnect on failure).
- `webhooks.service.ts` + `reports.module.ts` — outbound delivery with failure
  counters, and a BullMQ queue that degrades to in-process when `REDIS_URL` is absent.

## Decisions

### 1. DMs are channels

`ChatChannel.kind: 'channel' | 'dm'`. One collection, therefore one message model, one
room type, one read-state model. A DM is identified by `dmKey` =
`` `${workspaceId}:${sortedUserIds.join('|')}` `` with a unique index — the index, not
application logic, is what makes find-or-create race-safe when both users click at once.
Group DMs later cost nothing.

### 2. Workspace is still the tenant (ADRs 0003–0006 hold)

`ChatMessage.workspaceId` is denormalized onto every message so no read path needs a
join to be workspace-scoped. Access is enforced in the **service layer** via
`ProjectAccessService.isWorkspaceMember` plus a new `ChatAccessService`, matching how
`webhooks.service.ts` does it. This repo has no `WorkspaceMemberGuard` and this ADR does
not introduce one.

### 3. A second gateway, not an extension of notifications

Namespace `/ws/chat`, rooms `user:<id>` and `channel:<id>`.

The notifications gateway has exactly one room shape and zero `@SubscribeMessage`
handlers. Chat needs dynamic per-room authorization and high-frequency typing traffic.
Sharing one connection means a chat reconnect storm takes notifications down with it.
Separate namespace = separate failure domain.

Room membership is re-authorized on **every** `chat:join`. The client's claim about
which channel it may read is never trusted.

⚠️ **Consequence: chat is single-replica-only.** Without the socket.io Redis adapter,
running two `apps/api` instances means users in different processes silently stop seeing
each other's messages. If horizontal scaling enters the roadmap, Redis stops being
optional for chat — which contradicts the degrade-gracefully pattern the reports module
established. Revisit before any multi-replica deploy.

### 4. Message body is markdown-subset plain text

`body: string`, not a rich-text document. Bold/italic/code/link/mention only.

Telegram accepts a small HTML subset; a rich document (tables, callouts, images) cannot
round-trip. Storing one lossy format beats storing two formats that drift. This closes
the door on reusing `@prism/editor`'s `RichTextEditor` for the composer — deliberate.

### 5. Telegram link is per-channel; the bot token is per-instance

`TelegramLink` is 1:1 with a channel, with a unique index on `{chatId, threadId}` over
active links — **one Telegram group cannot fan into two Prism channels**. That is leak
prevention across workspaces, not a convenience constraint.

The bot token lives in `InstanceConfiguration` as `TELEGRAM_BOT_TOKEN`. One bot means one
update consumer; per-workspace bots would need N webhook routes and N polling loops.
Scoping is already carried by chat_id → channel → workspace. `isSecretConfigKey`'s
`_TOKEN$` regex masks it on read for free.

**Only the workspace owner may link or unlink a channel.** There is no workspace role
model beyond owner+members today, and linking is the action that moves data off the
instance.

### 6. Echo-loop prevention is structural, not conditional

`ChatMessage.source: 'prism' | 'telegram'`. The outbound relay's query filter *is*
`source: 'prism'` — a Telegram-origin message cannot match it. It is not "chosen" not to
be relayed. Two further layers back this up: dropping updates whose `from.id` is our own
bot, and the `relayedTo[]` receipt array.

A chat echo loop is self-amplifying and would hit Telegram's rate limits within seconds,
so defense in depth is warranted here where it would be overkill elsewhere.

This is what let the assistant's own reply be stored in the channel (ADR 0015 §2.4,
2026-08-06) without a new mechanism: it is written with `source: 'telegram'` and
`kind: 'system'`, so the relay's filter excludes it twice over, and it is stored under
the message id Telegram gave it, so the `{chatId, messageId}` unique index dedupes it
even if the bot's own post were ever delivered back to us.

### 7. Inbound transport is chosen at runtime

`TELEGRAM_WEBHOOK_URL` set → webhook (with a `secret_token` compared via
`crypto.timingSafeEqual`, plus a random path segment). Unset → `getUpdates` long polling
with the offset persisted in `InstanceConfiguration`.

This is what makes local dev workable without a tunnel. Note that Telegram allows exactly
one consumer per bot token and webhook/`getUpdates` are mutually exclusive: **each
developer needs their own dev bot**, and BotFather privacy mode must be **disabled** or
the bot never sees group messages.

The webhook handler returns 200 immediately and processes asynchronously — Telegram
retries non-2xx, so a slow synchronous handler manufactures duplicates. Dedupe itself is
the unique sparse index on `{'telegram.chatId', 'telegram.messageId'}`; an `E11000` is
caught and dropped.

### 8. Outbound is queued, never inline

Telegram latency and rate limits must not sit on the user's send path. Queue follows the
`reports.module.ts` shape: BullMQ when `REDIS_URL` is set (concurrency 1 per `chatId` to
preserve order), in-process FIFO otherwise. Rate budget stays under Telegram's ceilings
(~25/s global, ~18/min per chat); on 429 the requeue delay is exactly the
`parameters.retry_after` Telegram returns. A 403 "bot was kicked" is terminal — deactivate
the link rather than burning retries.

Formatting targets Telegram **HTML**, not MarkdownV2: MarkdownV2 requires escaping 18
characters and one miss is a 400 that drops the message silently.

## Accepted trade-off: this punches a hole in workspace isolation

Relaying to Telegram means workspace content leaves the instance, readable by anyone in
the Telegram group with no Prism account and no membership check. That is a deliberate,
per-channel, owner-authorized exception to ADRs 0003–0006 — but it is an exception, and
it must stay visible: the channel header shows a persistent "mirrored to Telegram" badge.

Related: Telegram sends bots no notification when a user deletes a message, so Prism will
retain messages that were deleted on the Telegram side. Flag before any GDPR commitment.

## Out of scope

Threads (`replyToId` is stored and rendered as a quote; no thread pane) · message search ·
presence · multi-replica correctness · uploading media to Telegram (v1 relays a link back
to Prism) · stickers/voice/polls/inline keyboards · bot commands beyond `/link` ·
per-workspace bot tokens · editing a Telegram-origin message from Prism (ambiguous
ownership — inbound is read-only) · any `apps/space` exposure. **Chat is authenticated-only
and is never published.**
