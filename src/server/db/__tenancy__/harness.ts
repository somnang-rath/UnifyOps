import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import * as schema from '../schema';
import { team, teamMember, user, workspace, workspaceMember } from '../schema';
import { withActor } from '../tenant';

/**
 * A real Postgres for the tenancy suite.
 *
 * §16 calls a tenancy leak "the failure that ends the product", and the four
 * layers that prevent it — forced RLS, the non-owner role, transaction-local
 * scope, the branded handle — are only three-quarters testable without a
 * database. This harness supplies the last quarter.
 *
 * Two ways to get one, because both matter:
 *   - Testcontainers, the default. What CI uses; needs Docker.
 *   - An existing server, when TENANCY_SUPERUSER_URL is set. What a developer
 *     with a local Postgres and no Docker uses.
 *
 * The role and grant setup below mirrors scripts/bootstrap.sql, which cannot
 * be reused directly because it is written in psql meta-commands. The pairing
 * is checked rather than trusted: invariants.test.ts asserts the live role
 * attributes and schema privileges, so a drift between the two shows up as a
 * failing test rather than as a test that quietly passes against a weaker
 * database than production has.
 */

const TEST_DB = 'unifyops_tenancy';
const OWNER_PW = 'owner_test_pw';
const APP_PW = 'app_test_pw';
const OPERATOR_PW = 'operator_test_pw';

export type TenancyHarness = {
  /** Unbranded app-role handle. Pass it to withActor; never query it directly. */
  readonly app: NodePgDatabase<typeof schema>;
  /** Owner-role handle. Setup and assertions only — it is what RLS is forced against. */
  readonly owner: NodePgDatabase<typeof schema>;
  /** Operator role: cross-tenant SELECT, nothing else (§18-12). */
  readonly operator: NodePgDatabase<typeof schema>;
  readonly stop: () => Promise<void>;
};

export type SeededWorkspace = {
  workspaceId: string;
  teamId: string;
  ownerUserId: string;
  ownerMemberId: string;
  memberUserId: string;
  memberMemberId: string;
  teamMemberId: string;
};

async function superuserUrl(): Promise<{ url: string; stop: () => Promise<void> }> {
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

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

const ROLES = [
  ['unifyops_owner', OWNER_PW],
  ['unifyops_app', APP_PW],
  ['unifyops_operator', OPERATOR_PW],
] as const;

export async function startTenancyHarness(): Promise<TenancyHarness> {
  const { url, stop: stopContainer } = await superuserUrl();

  const admin = new Pool({ connectionString: url, max: 1 });
  try {
    for (const [role, password] of ROLES) {
      await admin.query(
        `do $do$ begin
           if not exists (select 1 from pg_roles where rolname = '${role}') then
             execute format('create role ${role} login password %L', $pw$${password}$pw$);
           end if;
         end $do$;`,
      );
      // No role may bypass RLS — on the app role it would defeat every policy,
      // on the owner role it would hide leaks from this very suite.
      await admin.query(`alter role ${role} nosuperuser nobypassrls nocreaterole nocreatedb`);
      await admin.query(`alter role ${role} password $pw$${password}$pw$`);
    }

    // A fresh database each run: a row left over from a previous run is
    // indistinguishable from a leak.
    await admin.query(`drop database if exists ${TEST_DB} with (force)`);
    await admin.query(`create database ${TEST_DB} owner unifyops_owner encoding 'UTF8'`);
  } finally {
    await admin.end();
  }

  const dbUrl = withDatabase(url, TEST_DB);
  const setup = new Pool({ connectionString: dbUrl, max: 1 });
  try {
    for (const statement of [
      'create extension if not exists pg_trgm',
      'create extension if not exists btree_gist',
      'alter schema public owner to unifyops_owner',
      'revoke all on schema public from public',
      'grant usage on schema public to unifyops_app, unifyops_operator',
      'revoke create on schema public from unifyops_app, unifyops_operator',
      `alter default privileges for role unifyops_owner in schema public
         grant select, insert, update, delete on tables to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant usage, select on sequences to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant execute on functions to unifyops_app`,
      `alter default privileges for role unifyops_owner in schema public
         grant select on tables to unifyops_operator`,
    ]) {
      await setup.query(statement);
    }
  } finally {
    await setup.end();
  }

  const ownerPool = new Pool({ connectionString: asRole(dbUrl, 'unifyops_owner', OWNER_PW), max: 2 });
  await migrate(drizzle(ownerPool), { migrationsFolder: 'drizzle' });

  const appPool = new Pool({ connectionString: asRole(dbUrl, 'unifyops_app', APP_PW), max: 4 });
  const operatorPool = new Pool({
    connectionString: asRole(dbUrl, 'unifyops_operator', OPERATOR_PW),
    max: 2,
  });

  return {
    app: drizzle(appPool, { schema }),
    owner: drizzle(ownerPool, { schema }),
    operator: drizzle(operatorPool, { schema }),
    stop: async () => {
      await Promise.all([appPool.end(), operatorPool.end(), ownerPool.end()]);
      await stopContainer();
    },
  };
}

/** Postgres SQLSTATEs this suite asserts on. */
export const SQLSTATE = {
  /** Both "permission denied for table" and "violates row-level security policy". */
  insufficientPrivilege: '42501',
  foreignKeyViolation: '23503',
} as const;

export type PgFailure = { code: string; message: string };

/**
 * Unwraps the Postgres error behind a rejected query.
 *
 * Drizzle wraps driver errors, so `rejects.toThrow(/row-level security/)` only
 * ever sees "Failed query: ..." and passes for the wrong reason — or, worse,
 * fails while the database is doing exactly what it should. Asserting on the
 * SQLSTATE is both stronger and stable across driver versions.
 */
export async function failureOf(promise: Promise<unknown>): Promise<PgFailure> {
  try {
    await promise;
  } catch (error: unknown) {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === 'string') return { code, message: e.message };
    }
    throw new Error(
      `Rejected, but with no Postgres error in the cause chain: ${String(error)}`,
      { cause: error },
    );
  }
  throw new Error('Expected the query to be refused, but it succeeded.');
}

/**
 * Seeds one workspace, the same way signup will (slice 3).
 *
 * The two root rows go in as the owner, because nothing else can create them:
 * a workspace cannot be inserted by a connection already scoped to a workspace,
 * and an account exists before any membership does. Everything after that goes
 * through `withActor` scoped to the new workspace — the tenant tables have
 * exactly one write path and the fixture does not get to skip it.
 *
 * That still lets a test build data in a workspace the app role is not
 * currently scoped to: open a second `withActor` for it. What it does not allow
 * is writing a tenant row with no scope at all, which is the thing under test.
 */
export async function seedWorkspace(h: TenancyHarness, slug: string): Promise<SeededWorkspace> {
  const ids = {
    workspaceId: uuidv7(),
    teamId: uuidv7(),
    ownerUserId: uuidv7(),
    memberUserId: uuidv7(),
    ownerMemberId: uuidv7(),
    memberMemberId: uuidv7(),
    teamMemberId: uuidv7(),
  };

  await h.owner.insert(workspace).values({ id: ids.workspaceId, slug, name: `${slug} Ltd` });
  await h.owner.insert(user).values([
    { id: ids.ownerUserId, email: `owner@${slug}.test`, name: `${slug} owner` },
    { id: ids.memberUserId, email: `member@${slug}.test`, name: `${slug} member` },
  ]);

  await withActor(
    {
      workspaceId: ids.workspaceId,
      userId: ids.ownerUserId,
      actorUserId: ids.ownerUserId,
      readOnly: false,
    },
    async (tx) => {
      await tx.insert(workspaceMember).values([
        {
          id: ids.ownerMemberId,
          workspaceId: ids.workspaceId,
          userId: ids.ownerUserId,
          role: 'owner',
        },
        {
          id: ids.memberMemberId,
          workspaceId: ids.workspaceId,
          userId: ids.memberUserId,
          role: 'member',
        },
      ]);
      await tx
        .insert(team)
        .values({ id: ids.teamId, workspaceId: ids.workspaceId, slug: 'core', name: 'Core' });
      await tx.insert(teamMember).values({
        id: ids.teamMemberId,
        workspaceId: ids.workspaceId,
        teamId: ids.teamId,
        workspaceMemberId: ids.ownerMemberId,
      });
    },
    h.app,
  );

  return ids;
}
