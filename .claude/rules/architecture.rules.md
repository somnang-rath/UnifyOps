# Architecture rules

## Apps and ports

| App | Stack | Port | Purpose |
| --- | ----- | ---- | ------- |
| `apps/api` | NestJS + MongoDB (Mongoose) + Zod + Socket.io + BullMQ | 4000 (`/api/v1`) | The only source of truth. Every other app talks to it. |
| `apps/web` | Next.js App Router + Tailwind + TanStack Query + Zustand | 3000 | Main product UI (authenticated). |
| `apps/admin` | Next.js, basePath `/god-mode` | 3001 | **Instance** admin ("God Mode") — not workspace admin. |
| `apps/space` | Next.js, basePath `/spaces`, SSR | 3002 | Public read-only published content. No login. |
| `apps/live` | Node + Hocuspocus/Yjs | 3100 | Collaborative editing relay + Yjs persistence. |

## Shared packages

`packages/types`, `packages/constants`, `packages/services`, `packages/ui`, `packages/editor`,
`packages/i18n`.

- Anything used by **more than one frontend** belongs in `packages/`, never copy-pasted.
  Triple duplication across web/admin/space is the single biggest pitfall of this conversion.
- Next.js apps must list consumed `@prism/*` packages in `transpilePackages`.
- `cn` is canonical in `@prism/ui/cn`. The API client is canonical in `@prism/services` (`createApiClient`).
- The locale is canonical in `@prism/i18n` (ADR 0016): `resolveLocale` is the one definition
  of cookie → `Accept-Language` → `en`, and `packages/ui` deliberately does **not** depend on
  it — shared components take their text as props.

## Non-negotiable boundaries

1. **Instance admin ≠ workspace admin.** Instance-level endpoints are protected by
   `@InstanceAdminGuard`; workspace roles never grant instance access.
2. **Workspace is the tenant.** Projects link via `workspaceId`; every read *and* write path
   must be workspace-scoped (ADRs 0003–0006).
3. **Public endpoints leak nothing.** `public` module routes are unauthenticated, throttled,
   and must strip private fields (emails, internal notes, member lists) before responding.
4. **Collaborative text uses Yjs (CRDT)**, never plain Socket.io. Socket.io stays for notifications.
5. **`apps/live` never touches Mongo authorization logic** — it verifies JWT locally and asks
   `apps/api` internal endpoints (`InternalTokenGuard`) for access decisions.
6. **CORS** must allow 3000, 3001, 3002 via `WEB_ORIGIN`.

## apps/api conventions

Study `apps/api/src/modules/issues/` as the reference. Every module:
`schemas/*.schema.ts` (Mongoose) · `dto/*.dto.ts` (Zod) · controller with `ZodValidationPipe`
· injectable service · module class registered in `app.module.ts`.

Use the `scaffold-api-module` skill for new modules, `scaffold-web-feature` for new routes.

## Architecture decisions

ADRs live in `docs/adr/`. Write one for any decision that crosses an app boundary.
Existing: 0001 realtime/live · 0002 public space · 0003–0006 workspace isolation.
