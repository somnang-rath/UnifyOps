import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { identityDatabaseUrl } from '@/env';
import { createPool } from './pool';
import * as schema from './schema';
import type { Schema } from './client';

declare const identityScoped: unique symbol;

/**
 * The handle for the pre-tenancy handshake, and the sibling of `TenantDb`.
 *
 * Branded for the same reason: the type is what makes "this query ran on the
 * identity connection" checkable. `withIdentity` is the sole producer, so a
 * repository written against `TenantDb` cannot be handed this one by accident,
 * and the four functions that legitimately need it say so in their signature.
 *
 * WHY THIS EXISTS AT ALL. Authentication happens before a workspace is known.
 * Finding an account by email, creating one, and exchanging an invitation token
 * for the workspace it names are all queries with no tenant scope — and every
 * app-role policy compares against `tenancy.workspace_id()`, which is NULL
 * outside `withActor`, so on the app connection they correctly return nothing.
 *
 * The alternative would be an escape hatch on the app connection, which
 * `schema/_shared.ts` refuses for good reason: an escape hatch on the
 * connection the app already holds is one `SET` away from any bug that can
 * influence session state. A separate role with a separate credential and a
 * separate, short grant list cannot be reached by a query that merely forgot
 * its scope — it has to be asked for by name.
 *
 * What it can reach is in drizzle/0004_slice3_hardening.sql, and the shape of
 * the boundary is: the tables that identify people and companies, plus the
 * membership rows of the one user it has already authenticated. Nothing that
 * says what a company is doing.
 */
export type IdentityDb = NodePgDatabase<Schema> & { readonly [identityScoped]: true };

let pool: Pool | undefined;

/**
 * Small on purpose. The identity connection is used a handful of times per
 * session — sign in, sign up, resolve the cookie, accept an invitation — while
 * the app pool carries every request. Sizing them the same would reserve
 * connections for a path that is nearly idle.
 */
function identityPool(): Pool {
  pool ??= createPool('identity', {
    connectionString: identityDatabaseUrl(),
    max: 4,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

let db: NodePgDatabase<Schema> | undefined;

function rawIdentityDb(): NodePgDatabase<Schema> {
  db ??= drizzle(identityPool(), { schema });
  return db;
}

/**
 * Runs `fn` on the identity connection, inside a transaction.
 *
 * `userId` sets `unifyops.user_id` transaction-locally — the same mechanism and
 * the same reason as `withActor`: a pooled connection with session-scoped state
 * hands the next request whatever the last one set, and the leak only shows up
 * under concurrency. It is what the `identity_select_own` policy on
 * `workspace_member` reads, so passing it is how "this user's memberships"
 * becomes enforceable rather than a `WHERE` clause someone has to remember.
 *
 * Omit it for the genuinely anonymous steps — finding an account by email,
 * looking up an invitation token — where there is no authenticated user yet.
 * The setting is then NULL and the membership policy is false, which is the
 * correct answer to a question nobody has earned the right to ask.
 */
export async function withIdentity<T>(
  fn: (tx: IdentityDb) => Promise<T>,
  options: { userId?: string } = {},
): Promise<T> {
  return rawIdentityDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('unifyops.user_id', ${options.userId ?? ''}, true)`);
    return fn(tx as unknown as IdentityDb);
  });
}

/** Closes the identity pool. Tests and one-shot scripts. */
export async function closeIdentityPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
