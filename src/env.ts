import { z } from 'zod';

/**
 * Environment access, validated once.
 *
 * The two database URLs are deliberately separate exports rather than one
 * object, because they are not interchangeable and the difference is the
 * whole tenancy story (PLAN.en.md §9):
 *
 *   DATABASE_URL_OWNER  owner role — migrations and drizzle-kit only
 *   DATABASE_URL        application role — RLS forced, the only runtime handle
 *   DATABASE_URL_OPERATOR  platform operator — cross-tenant READ only (§18-12)
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
