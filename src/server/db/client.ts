import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appDatabaseUrl } from '@/env';
import * as schema from './schema';

export type Schema = typeof schema;

declare const tenantScoped: unique symbol;

/**
 * The only database handle repositories accept.
 *
 * A brand rather than a plain `NodePgDatabase`, because the type is what makes
 * "this query ran inside `withActor`" checkable. `withActor` is the sole
 * producer — nothing else in the codebase may construct one — so a repository
 * cannot be called on a connection whose tenancy variables were never set.
 * The RLS policies would return zero rows in that case, which is the safe
 * failure; the brand turns it into a compile error instead of a puzzling
 * empty list.
 */
export type TenantDb = NodePgDatabase<Schema> & { readonly [tenantScoped]: true };

/** Internal: the unbranded handle, before `withActor` opens a scoped transaction. */
export type RawDb = NodePgDatabase<Schema>;

let pool: Pool | undefined;

/**
 * The application pool. Non-owner role, RLS forced.
 *
 * Lazy so that importing this module — which the schema types do, transitively
 * — never opens a socket in a process that only needed the types.
 */
export function appPool(): Pool {
  pool ??= new Pool({
    connectionString: appDatabaseUrl(),
    // Tenancy variables are transaction-local, so a pooled connection cannot
    // carry one request's scope into the next. That property is what makes
    // pooling safe here at all; see withActor.
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

let db: RawDb | undefined;

/**
 * Unbranded. Deliberately not exported outside src/server/db: everything that
 * reads tenant data goes through `withActor`, which brands the transaction.
 */
export function rawDb(): RawDb {
  db ??= drizzle(appPool(), { schema });
  return db;
}

/** Closes the pool. Tests and one-shot scripts; the server holds it for its lifetime. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
