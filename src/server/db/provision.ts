import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { installJobSchema } from '@/server/jobs/install';
import { createPool } from './pool';

/**
 * Building a UnifyOps database from nothing: roles, grants, schema.
 *
 * Used by two callers that must not disagree — the tenancy suite
 * (`src/server/db/__tenancy__/harness.ts`) and the end-to-end setup
 * (`e2e/support/database.ts`). They had every reason to drift: one asserts that
 * the app role cannot read across workspaces, the other drives a browser
 * through signup, and a difference in grants between them would make one of the
 * two prove nothing.
 *
 * This mirrors scripts/bootstrap.sql, which cannot be reused directly because
 * it is written in psql meta-commands. The pairing is checked rather than
 * trusted: invariants.test.ts asserts the live role attributes and privileges,
 * so a drift shows up as a failing test rather than as a suite that quietly
 * passes against a weaker database than production has.
 *
 * Not part of the running application. Nothing under src/app imports it.
 */

export const TEST_ROLE_PASSWORDS = {
  owner: 'owner_test_pw',
  app: 'app_test_pw',
  operator: 'operator_test_pw',
  identity: 'identity_test_pw',
} as const;

export type RoleName = keyof typeof TEST_ROLE_PASSWORDS;

const ROLES: { role: RoleName; sqlName: string }[] = [
  { role: 'owner', sqlName: 'unifyops_owner' },
  { role: 'app', sqlName: 'unifyops_app' },
  { role: 'operator', sqlName: 'unifyops_operator' },
  { role: 'identity', sqlName: 'unifyops_identity' },
];

export type ProvisionedUrls = Record<RoleName, string>;

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Creates the roles, the database and the schema, and returns one URL per role.
 *
 * Drops and recreates the database every time. A row left over from a previous
 * run is indistinguishable from a leak, and the whole point of the suites that
 * call this is to be able to tell those apart.
 */
export async function provisionDatabase(options: {
  superuserUrl: string;
  database: string;
}): Promise<ProvisionedUrls> {
  const { superuserUrl, database } = options;

  const admin = createPool('provision:admin', { connectionString: superuserUrl, max: 1 });
  try {
    for (const { role, sqlName } of ROLES) {
      const password = TEST_ROLE_PASSWORDS[role];
      await admin.query(
        `do $do$ begin
           if not exists (select 1 from pg_roles where rolname = '${sqlName}') then
             execute format('create role ${sqlName} login password %L', $pw$${password}$pw$);
           end if;
         end $do$;`,
      );
      // No role may bypass RLS — on the app role it would defeat every policy,
      // on the owner role it would hide leaks from the suite that looks for
      // them, and on the identity role it would turn the pre-tenancy handshake
      // into an unrestricted tenant read.
      await admin.query(`alter role ${sqlName} nosuperuser nobypassrls nocreaterole nocreatedb`);
      await admin.query(`alter role ${sqlName} password $pw$${password}$pw$`);
    }

    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.query(`create database ${database} owner unifyops_owner encoding 'UTF8'`);
  } finally {
    await admin.end();
  }

  const dbUrl = withDatabase(superuserUrl, database);
  const setup = createPool('provision:setup', { connectionString: dbUrl, max: 1 });
  try {
    for (const statement of [
      'create extension if not exists pg_trgm',
      'create extension if not exists btree_gist',
      'alter schema public owner to unifyops_owner',
      'revoke all on schema public from public',
      'grant usage on schema public to unifyops_app, unifyops_operator, unifyops_identity',
      'revoke create on schema public from unifyops_app, unifyops_operator, unifyops_identity',
      `alter default privileges for role unifyops_owner in schema public
         grant select, insert, update, delete on tables to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant usage, select on sequences to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant execute on functions to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant select on tables to unifyops_operator`,
      // Deliberately no default privileges for unifyops_identity. Its table
      // list is granted by name in drizzle/0004, so a tenant table added by a
      // later slice is out of its reach by construction — see bootstrap.sql.
    ]) {
      await setup.query(statement);
    }
  } finally {
    await setup.end();
  }

  const ownerUrl = asRole(dbUrl, 'unifyops_owner', TEST_ROLE_PASSWORDS.owner);
  const ownerPool = createPool('provision:owner', { connectionString: ownerUrl, max: 2 });
  try {
    await migrate(drizzle(ownerPool), { migrationsFolder: 'drizzle' });

    /**
     * pg-boss's schema, installed by the owner exactly as `db:migrate` does it
     * (slice 9). Here as well as there because these two callers "must not
     * disagree": a test database without the queue schema is one where the job
     * worker cannot start, and the e2e suite runs a real worker.
     */
    await installJobSchema(ownerPool);
  } finally {
    await ownerPool.end();
  }

  return {
    owner: ownerUrl,
    app: asRole(dbUrl, 'unifyops_app', TEST_ROLE_PASSWORDS.app),
    operator: asRole(dbUrl, 'unifyops_operator', TEST_ROLE_PASSWORDS.operator),
    identity: asRole(dbUrl, 'unifyops_identity', TEST_ROLE_PASSWORDS.identity),
  };
}

/**
 * A superuser connection: an existing server if `TENANCY_SUPERUSER_URL` names
 * one, otherwise a container.
 *
 * Both paths matter. Testcontainers is what CI uses; the environment variable
 * is what a developer with a local Postgres and no working Docker uses, which
 * on at least one machine here is not hypothetical.
 */
export async function superuserConnection(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const existing = process.env.TENANCY_SUPERUSER_URL;
  if (existing) return { url: existing, stop: async () => {} };

  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:18')
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
