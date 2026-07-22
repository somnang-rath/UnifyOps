# Telegram bridge — setup

The chat module can mirror a channel to a Telegram group, both ways (ADR 0007).
Chat works fully without any of this; Telegram is opt-in per channel.

## 1. Create a bot (once per instance)

1. In Telegram, message **@BotFather** → `/newbot`, follow the prompts, copy the
   **bot token** it gives you.
2. **Disable privacy mode** — this is the step everyone forgets and it fails
   silently: `/setprivacy` → pick your bot → **Disable**. With privacy mode on, the
   bot only ever sees commands, never normal group messages, so inbound relay just
   never happens.

> Telegram allows exactly **one** update consumer per bot token, and webhook and
> long-polling are mutually exclusive. Each developer needs their **own** dev bot —
> two processes on one token steal each other's updates.

## 2. Configure the instance (God Mode → Integrations)

Set these instance-config keys (God Mode UI, or `PATCH /instance/config`):

| Key | Value | Notes |
| --- | ----- | ----- |
| `TELEGRAM_ENABLED` | `true` | Reveals the per-channel "Connect Telegram" UI. |
| `TELEGRAM_BOT_TOKEN` | *your token* | Secret — masked on read (matches `_TOKEN$`). |
| `TELEGRAM_WEBHOOK_URL` | *public base URL* | **Leave blank for local dev** → long polling. |

`TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_POLL_OFFSET` are managed automatically; do
not set them by hand.

### Local development — no tunnel needed

Leave `TELEGRAM_WEBHOOK_URL` blank. The transport falls back to `getUpdates` long
polling and stores its offset in instance config, so a restart doesn't replay
history. No ngrok, no public endpoint.

### Production — webhook

Set `TELEGRAM_WEBHOOK_URL` to your public API base (e.g. `https://api.example.com`).
On boot the transport registers `<base>/api/v1/telegram/webhook/<secret>` with a
generated secret token, and inbound requests are verified against it (path segment
+ `X-Telegram-Bot-Api-Secret-Token`, compared with `timingSafeEqual`).

### `TELEGRAM_API_BASE` (env, optional)

Overrides the Bot API host (default `https://api.telegram.org`). Only needed for a
self-hosted Bot API server or for tests pointing at a mock. Set it in `apps/api`'s
environment, not in instance config.

## 3. Link a channel (workspace owner only)

1. Open the channel in Prism → header → **Connect Telegram** → **Generate link code**.
2. Add your bot to the Telegram group.
3. In the group, send `/link <CODE>`.
4. The bot verifies the sender is a **group administrator** (the real proof of
   control — the code alone isn't enough) and confirms. The Prism UI flips to
   "linked" live.

Only a workspace **owner** can link/unlink, because linking moves workspace content
off the instance to everyone in the Telegram group.

## Personal account linking (attribution)

By default a Telegram sender with no linked Prism account shows in the channel as an
external author with a "via Telegram" badge. Any user can claim their own Telegram
account so their group messages show as their real Prism identity:

1. Prism → **Settings → Profile → Telegram account → Link Telegram**.
2. Open a **private chat** with the bot and send `/verify <code>`.
3. Done — new messages are attributed, and the user's **past** group messages are
   backfilled to their identity too.

This is per-user and independent of channel linking; it needs no special role.

## What relays

- **Prism → Telegram**: text messages, edits, deletes. Rich markdown is converted to
  Telegram HTML; the author is prefixed in bold. Attachments relay as a link back to
  Prism (v1).
- **Telegram → Prism**: text messages. A sender with no linked Prism account shows as
  an external author with a Telegram badge. Non-text (stickers/photos w/o caption) is
  skipped in v1.

Direction is configurable per link (both / Prism→TG only / TG→Prism only), and the
relay can be paused with the **Relay active** toggle.

## Rate limits & reliability

Outbound is queued off the request path, kept under Telegram's ceilings (~25/s
global, ~18/min per group). On HTTP 429 it honours Telegram's `retry_after`; a 403
"bot removed from group" deactivates the link rather than retrying forever. With
`REDIS_URL` set, a BullMQ-backed queue is the horizontal-scale path; without it, an
in-process FIFO preserves per-group ordering (lost on crash).

## Known limits (v1)

Single-replica only (no socket.io Redis adapter — see ADR 0007). No media upload to
Telegram (links instead). No delete notifications from Telegram, so a message deleted
on the Telegram side stays in Prism. Editing a Telegram-origin message from Prism is
disallowed (inbound is read-only).
