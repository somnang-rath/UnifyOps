import type { Pool } from 'pg';
import { getConstructionPlans, getMigrationPlans } from 'pg-boss';

/**
 * pg-boss's own schema, installed by the OWNER role (§8, slice 9).
 *
 * pg-boss normally creates and migrates its tables on `boss.start()`, which
 * would mean the job worker holding a credential that can run DDL. That is the
 * one thing the four-role split exists to prevent, and a worker is not exempt
 * from it just because it is not the web process — a role that can `CREATE` in
 * a schema can own a table, and a table's owner is exempt from its own RLS.
 *
 * So the install runs where every other piece of DDL in this repo runs: the
 * owner connection, from `pnpm db:migrate`. The worker then starts with
 * `migrate: false` and needs nothing but DML on tables that already exist.
 *
 * `getConstructionPlans` and `getMigrationPlans` are pg-boss's own answer to
 * this — the library publishes the SQL precisely so it can be applied by
 * somebody else. Using them means the schema is whatever the installed version
 * expects, rather than a copy of it that drifts on the next upgrade.
 *
 * Deliberately **without** `import 'server-only'`, unlike everything else under
 * `src/server` that touches a connection. This is migration tooling: it is
 * imported by `db/migrate.ts` and by `db/provision.ts`, both of which run under
 * plain `tsx` with no React Server Components condition, where that import
 * throws. It is never reachable from a request, which is what the marker is
 * there to guarantee for the modules that are.
 */

/** The schema pg-boss owns. Named, not defaulted, because the worker must agree. */
export const BOSS_SCHEMA = 'pgboss';

/**
 * Create or upgrade the queue schema, then grant the app role what it needs to
 * use it — and nothing else.
 *
 * Idempotent: the first run constructs, later runs migrate from whatever
 * version is already there, and a current installation does neither.
 */
export async function installJobSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    const installed = await currentVersion(client);

    if (installed === null) {
      await client.query(getConstructionPlans(BOSS_SCHEMA));
    } else {
      // `migrationPlans` returns the steps *after* the version it is given, so
      // an installation already at the current version yields nothing to run.
      // pg-boss exports no "latest version" constant, so the empty plan is the
      // signal — which is also the honest one: there is nothing to do exactly
      // when there is no SQL to do it with.
      const plan = getMigrationPlans(BOSS_SCHEMA, installed).trim();
      if (plan) await client.query(plan);
    }

    /**
     * The app role uses the queue; it does not own it.
     *
     * USAGE on the schema and DML on its tables, so the web process can enqueue
     * and the worker can claim, complete and fail jobs. No CREATE — the same
     * line bootstrap.sql draws in `public`, drawn again here because a default
     * privilege in one schema says nothing about another.
     *
     * The sequence grant is not optional: pg-boss allocates job ids from
     * sequences, and a role that can INSERT but not use them fails on the first
     * send with an error that names neither.
     */
    await client.query(`GRANT USAGE ON SCHEMA ${BOSS_SCHEMA} TO unifyops_app`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${BOSS_SCHEMA} TO unifyops_app`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${BOSS_SCHEMA} TO unifyops_app`,
    );
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${BOSS_SCHEMA} TO unifyops_app`,
    );

    /**
     * And the same for whatever a future pg-boss upgrade adds, so an upgrade is
     * `pnpm db:migrate` and not `pnpm db:migrate` plus a grant somebody has to
     * remember. Scoped to this schema and to objects this role creates.
     */
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${BOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO unifyops_app`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${BOSS_SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO unifyops_app`,
    );

    /**
     * The operator is deliberately given nothing here. §18-12 is a support role
     * that reads tenant data behind its own auth boundary; a queue of pending
     * jobs is neither tenant data nor something support acts on.
     */
  } finally {
    client.release();
  }
}

/**
 * The installed schema version, or null when pg-boss has never been installed.
 *
 * Read directly rather than through `boss.schemaVersion()`, which needs a
 * started instance — and starting one is what this function exists to make
 * unnecessary.
 */
async function currentVersion(client: {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number | null> {
  const exists = await client.query(
    'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
    [BOSS_SCHEMA, 'version'],
  );
  if (exists.rows.length === 0) return null;

  const version = await client.query(`select version from ${BOSS_SCHEMA}.version limit 1`);
  const value = version.rows[0]?.version;
  return typeof value === 'number' ? value : Number(value);
}
