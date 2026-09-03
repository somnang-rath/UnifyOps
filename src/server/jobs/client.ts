import 'server-only';

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { appDatabaseUrl, operatorDatabaseUrl } from '@/env';
import { createPool } from '@/server/db/pool';
import * as schema from '@/server/db/schema';
import { BOSS_SCHEMA } from './install';

/**
 * The job worker's two connections, and why it has two (§8, slice 9).
 *
 * The worker is the second process type §8's deployment names — same image,
 * different entry point. It needs to do two categorically different things, and
 * this file is where the split is drawn rather than left to whichever handler
 * reaches for a pool:
 *
 * **Enumeration is read-only and crosses workspaces.** "Which outbox rows are
 * undelivered" and "which companies exist, in which timezone" are questions no
 * single tenant scope can answer — every app-role policy is keyed to one
 * workspace, correctly. §18-12 already defines the role for exactly this shape
 * of question: `unifyops_operator`, cross-tenant `SELECT` and nothing else, no
 * INSERT, no UPDATE, no DELETE, enforced by the grant and asserted in
 * `invariants.test.ts`. A worker holding it cannot write anything anywhere,
 * which is what makes it a safe credential for a background process to hold.
 *
 * **Everything the worker writes goes through `withActor` on the app role**, in
 * a real member's scope, exactly like a request. A notification is written in
 * the recipient's workspace, and the digest reads a person's due work as that
 * person — so an email physically cannot describe an item its recipient is not
 * allowed to see. That property comes free from RLS and would have to be
 * re-implemented, and eventually got wrong, by a worker that read as an
 * omniscient system user.
 *
 * There is deliberately no third option. The worker never touches the owner
 * connection: its schema was installed by `pnpm db:migrate` (see `install.ts`)
 * precisely so that a long-lived process holds no credential that can run DDL.
 */

let boss: PgBoss | undefined;

/**
 * The queue client, started once per process.
 *
 * `migrate: false` because the schema is the owner's job. If pg-boss is ever
 * upgraded without `pnpm db:migrate` being run, `start()` fails loudly here
 * rather than silently trying — and failing — to create tables as a role with
 * no `CREATE`. That is the error message anybody would want.
 */
export async function startBoss(): Promise<PgBoss> {
  if (boss) return boss;

  const instance = new PgBoss({
    connectionString: appDatabaseUrl(),
    schema: BOSS_SCHEMA,
    migrate: false,
  });

  /**
   * A pg-boss instance is an EventEmitter, and the same rule `createPool`
   * exists for applies: an `'error'` event with no listener is rethrown by Node
   * as an uncaughtException and takes the process down. In a worker that means
   * every queue stops, and the log says nothing about why.
   */
  instance.on('error', (error: unknown) => {
    console.error('[jobs] queue error:', error instanceof Error ? error.message : error);
  });

  await instance.start();
  boss = instance;
  return instance;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  // Graceful: in-flight handlers finish before the connection closes, so a
  // deploy does not abandon a half-delivered outbox message.
  await boss.stop({ graceful: true, close: true });
  boss = undefined;
}

let operator: Pool | undefined;
let operatorDb: NodePgDatabase<typeof schema> | undefined;

/**
 * The platform read connection (§18-12).
 *
 * Read-only by role, not by convention: `unifyops_operator` holds `SELECT` and
 * nothing else on every table, so a handler that tried to write through this
 * handle would be refused by Postgres rather than by a code review.
 *
 * Deliberately *not* branded as a `TenantDb`. Nothing that reads tenant content
 * should reach for this — it exists to answer the two platform questions in the
 * comment at the top of this file, and a query that wants a company's work
 * items belongs in `withActor` where a policy can have an opinion about it.
 */
export function platformDb(): NodePgDatabase<typeof schema> {
  operator ??= createPool('operator', {
    connectionString: operatorDatabaseUrl(),
    max: 2,
    idleTimeoutMillis: 30_000,
  });
  operatorDb ??= drizzle(operator, { schema });
  return operatorDb;
}

export async function closePlatformDb(): Promise<void> {
  if (!operator) return;
  await operator.end();
  operator = undefined;
  operatorDb = undefined;
}
