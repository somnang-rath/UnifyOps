# Prism

A full-stack team workspace platform: issues, projects, Kanban, wiki, notes,
files, a Google-Sheets-style spreadsheet, scheduled reports, automations,
team chat with a Telegram bridge, realtime collaborative editing, a public
publishing space, and an instance admin panel — as a Plane-style multi-app
monorepo.

## Tech stack

| Layer        | Technology                                                        |
| ------------ | ----------------------------------------------------------------- |
| Backend      | NestJS, MongoDB (Mongoose), JWT auth, Socket.io, BullMQ (optional) |
| Frontend     | Next.js (App Router), Tailwind CSS, TanStack Query, Zustand        |
| Realtime     | Hocuspocus / Yjs (collaborative editing), Socket.io (notifications, chat) |
| Validation   | Zod (shared contracts between API and frontends)                   |
| Tooling      | pnpm workspace, TypeScript, Docker                                 |

## Requirements

- Node.js >= 20
- pnpm >= 9
- MongoDB (local install or via Docker)
- Redis (optional — enables durable report queues and the chat outbound queue)

## Project structure

```
prism/
├── apps/
│   ├── api/        NestJS backend                 → http://localhost:4000/api/v1
│   ├── web/        Main product UI (auth'd)       → http://localhost:3000
│   ├── admin/      Instance admin ("God Mode")    → http://localhost:3001/god-mode
│   ├── space/      Public published content (SSR) → http://localhost:3002/spaces
│   └── live/       Yjs collaboration relay        → ws://localhost:3100
├── packages/
│   ├── types/      Shared TypeScript types + Zod schemas
│   ├── constants/  Enums, route paths, feature flags
│   ├── services/   Shared API client (createApiClient)
│   ├── ui/         Shared React components + design tokens
│   └── editor/     Rich-text editor (Tiptap) + Yjs collaboration binding
├── docs/adr/       Architecture decision records
├── docker-compose.yml
└── pnpm-workspace.yaml
```

`apps/api` is the only source of truth — every other app talks to it. `admin`
is **instance** admin (server-wide config: auth modes, SMTP, AI keys, the
Telegram bot), distinct from workspace admin. `space` serves published wiki
pages read-only with no login. `live` relays Yjs updates for collaborative
wiki editing and persists document state.

## Quick start (local development)

```bash
# 1. Install dependencies (workspace-aware)
pnpm install

# 2. Configure the API environment
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — set MONGODB_URI, the JWT secrets, and LIVE_INTERNAL_TOKEN
# (>= 32 chars each).

# 3. Seed demo data (users, projects, issues, wiki, notes, files, reports)
pnpm seed

# 4. Start all five apps together
pnpm dev
```

Or run each app individually:

```bash
pnpm dev:api      # API   → http://localhost:4000/api/v1
pnpm dev:web      # Web   → http://localhost:3000
pnpm dev:admin    # Admin → http://localhost:3001/god-mode
pnpm dev:space    # Space → http://localhost:3002/spaces
pnpm dev:live     # Live  → ws://localhost:3100
```

On first run, open the admin app to create the first instance admin
(first-run setup screen), then configure auth modes, SMTP, AI, and
integrations from God Mode.

## Docker deployment

The compose stack runs MongoDB, Redis, the API, and all four frontends/servers
(web, admin, space, live) together.

```bash
# 1. Create the environment file and set the JWT secrets
cp .env.docker.example .env

# 2. Build and start the full stack
docker compose up --build -d

# 3. Seed demo data against the running database
MONGODB_URI=mongodb://localhost:27017/prism pnpm seed
```

Then open http://localhost:3000.

> `NEXT_PUBLIC_*` URLs are baked into each Next.js bundle at build time. If the
> browser will reach the apps at a host other than `localhost`, set them in
> `.env` before building and rebuild the affected images.

A detailed, step-by-step Docker guide is available in
[`../DEPLOY-DOCKER.md`](../DEPLOY-DOCKER.md).

## Environment variables

Set in `apps/api/.env` for local development, or in `.env` for Docker.
`apps/api/.env.example` is the reference.

| Variable              | Required | Description                                                      |
| --------------------- | -------- | ---------------------------------------------------------------- |
| `MONGODB_URI`         | Yes      | MongoDB connection string                                         |
| `JWT_ACCESS_SECRET`   | Yes      | Access-token secret (>= 32 characters)                            |
| `JWT_REFRESH_SECRET`  | Yes      | Refresh-token secret (>= 32 characters)                           |
| `LIVE_INTERNAL_TOKEN` | Yes      | Shared secret for apps/live → API internal calls (>= 32 chars, must match apps/live) |
| `WEB_ORIGIN`          | No       | Comma-separated CORS allowlist — must include 3000, 3001, 3002    |
| `COOKIE_DOMAIN`       | No       | Parent domain for the shared refresh cookie (blank on localhost)  |
| `REDIS_URL`           | No       | Enables BullMQ queues; falls back to in-process                   |
| `SMTP_*`              | No       | Email delivery; disabled when `SMTP_HOST` is unset                |

Frontends read `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api/v1`),
and the web app additionally `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_SPACE_URL`,
and `NEXT_PUBLIC_LIVE_URL`. Instance-level settings (OAuth toggles, SMTP, AI
provider keys, the Telegram bot token) live in the database and are managed
from God Mode, not env vars.

## Scripts

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | Run api + web + admin + space + live together  |
| `pnpm dev:<app>`     | Run one app (`api`, `web`, `admin`, `space`, `live`) |
| `pnpm build`         | Build all workspace packages                   |
| `pnpm lint`          | Lint all workspace packages                    |
| `pnpm seed`          | Seed demo data (destructive — dev DB only)     |
| `pnpm test:security` | API security E2E suite (needs mongo + api)     |

## Documentation

- Conversion plan and roadmap: [`PLANE-CONVERSION-PLAN.md`](PLANE-CONVERSION-PLAN.md)
- Architecture decisions: [`docs/adr/`](docs/adr/)
- Telegram bridge setup: [`docs/telegram-bridge-setup.md`](docs/telegram-bridge-setup.md)

## Demo logins

| Email                | Password   | Role      |
| -------------------- | ---------- | --------- |
| `admin@demo.com`     | `admin123` | Admin     |
| `cpo@demo.com`       | `cpo123`   | CPO       |
| `marketing@demo.com` | `mkt123`   | Marketing |
| `sales@demo.com`     | `sales123` | Sales     |
| `dev@demo.com`       | `dev123`   | Developer |
