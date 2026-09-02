import { z } from 'zod';

/**
 * Environment access, validated once.
 *
 * The two database URLs are deliberately separate exports rather than one
 * object, because they are not interchangeable and the difference is the
 * whole tenancy story (PLAN.en.md §9):
 *
 *   DATABASE_URL_OWNER  owner role — migrations and drizzle-kit only
 *   DATABASE_URL        application role — RLS forced, the only tenant-data handle
 *   DATABASE_URL_OPERATOR  platform operator — cross-tenant READ only (§18-12)
 *   DATABASE_URL_IDENTITY  the pre-tenancy handshake — sign in, sign up, accept invite
 *
 * Nothing here falls back to a default. A default on a database URL points an
 * unconfigured machine at a guessable local superuser, which is the wrong
 * failure mode for the credentials that decide whether tenants are isolated.
 */

const url = z.string().url();

function required(key: string, value: string | undefined, why: string): string {
  const parsed = url.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${key} is missing or not a URL. ${why}`);
  }
  return parsed.data;
}

/** The application connection. Non-owner, RLS forced. Use this at runtime. */
export function appDatabaseUrl(): string {
  return required(
    'DATABASE_URL',
    process.env.DATABASE_URL,
    'Copy .env.example to .env, then run `pnpm db:setup` once.',
  );
}

/**
 * The owner connection. Migrations and drizzle-kit only — it bypasses RLS.
 * Importing this from application code is the bug; `pnpm lint` blocks the
 * direct `process.env` read everywhere outside src/server/db.
 */
export function ownerDatabaseUrl(): string {
  return required(
    'DATABASE_URL_OWNER',
    process.env.DATABASE_URL_OWNER,
    'Migrations run as the owner role.',
  );
}

/**
 * The platform-operator connection (§18-12). Cross-tenant SELECT only, behind
 * its own auth boundary. Optional: a deployment without an operator surface
 * simply never sets it, and asking for it then is a loud failure rather than a
 * silent fallback to the app role.
 */
export function operatorDatabaseUrl(): string {
  return required(
    'DATABASE_URL_OPERATOR',
    process.env.DATABASE_URL_OPERATOR,
    'The operator surface is cross-tenant read-only and needs its own role.',
  );
}

/**
 * The identity connection (slice 3). The pre-tenancy handshake, and nothing
 * else.
 *
 * Authentication runs before a workspace is known, so it cannot run on the app
 * connection: every app-role policy compares against `tenancy.workspace_id()`,
 * which is NULL outside `withActor`, so a sign-in lookup would correctly return
 * zero rows. This role exists to make that one moment possible without handing
 * the web process a credential that owns tables.
 *
 * Its reach is `app_user`, `workspace`, the `auth_*` tables and `invitation`.
 * It cannot read a single row of what a company is actually doing. Everything
 * past the handshake goes back through `withActor`.
 */
export function identityDatabaseUrl(): string {
  return required(
    'DATABASE_URL_IDENTITY',
    process.env.DATABASE_URL_IDENTITY,
    'Sign in, sign up and invitation acceptance run before any workspace scope exists.',
  );
}

/** Where the app is reachable. Used to build verification and invitation links. */
export function appUrl(): string {
  return required(
    'NEXT_PUBLIC_APP_URL',
    process.env.NEXT_PUBLIC_APP_URL,
    'Invitation and verification emails contain absolute links.',
  );
}

/**
 * Email delivery, when it is configured.
 *
 * Deliberately optional and deliberately not a throw: a development machine
 * with no Resend key still has to be able to run the whole §7.10 invite flow,
 * so the mailer falls back to a transport that logs. Returning null here is
 * what lets that be a stated choice rather than a swallowed error.
 */
export function emailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}
