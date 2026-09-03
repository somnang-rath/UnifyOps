import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import * as schema from '../schema';
import {
  project,
  projectMember,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
  workspaceMember,
} from '../schema';
import { provisionDatabase, superuserConnection } from '../provision';
import { createPool } from '../pool';
import { withActor } from '../tenant';

/**
 * A real Postgres for the tenancy suite.
 *
 * §16 calls a tenancy leak "the failure that ends the product", and the four
 * layers that prevent it — forced RLS, the non-owner role, transaction-local
 * scope, the branded handle — are only three-quarters testable without a
 * database. This harness supplies the last quarter.
 *
 * The roles, grants and migrations come from `../provision`, shared with the
 * end-to-end setup so the two cannot drift into proving different things.
 */

const TEST_DB = 'unifyops_tenancy';

export type TenancyHarness = {
  /** Unbranded app-role handle. Pass it to withActor; never query it directly. */
  readonly app: NodePgDatabase<typeof schema>;
  /** Owner-role handle. Setup and assertions only — it is what RLS is forced against. */
  readonly owner: NodePgDatabase<typeof schema>;
  /** Operator role: cross-tenant SELECT, nothing else (§18-12). */
  readonly operator: NodePgDatabase<typeof schema>;
  /** The pre-tenancy handshake role (slice 3). Sign-in and invitation lookup. */
  readonly identity: NodePgDatabase<typeof schema>;
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
  /** Slice 4. One project, its owner's Lead row, and one workflow state. */
  projectId: string;
  projectMemberId: string;
  stateId: string;
};

export async function startTenancyHarness(): Promise<TenancyHarness> {
  const { url, stop: stopContainer } = await superuserConnection();
  const urls = await provisionDatabase({ superuserUrl: url, database: TEST_DB });

  const ownerPool = createPool('harness:owner', { connectionString: urls.owner, max: 2 });
  const appPool = createPool('harness:app', { connectionString: urls.app, max: 4 });
  const operatorPool = createPool('harness:operator', { connectionString: urls.operator, max: 2 });
  const identityPool = createPool('harness:identity', { connectionString: urls.identity, max: 2 });

  return {
    app: drizzle(appPool, { schema }),
    owner: drizzle(ownerPool, { schema }),
    operator: drizzle(operatorPool, { schema }),
    identity: drizzle(identityPool, { schema }),
    stop: async () => {
      await Promise.all([
        appPool.end(),
        operatorPool.end(),
        identityPool.end(),
        ownerPool.end(),
      ]);
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
 * Seeds one workspace, along the same seam signup uses.
 *
 * The two root rows go in outside any tenant scope, because nothing inside one
 * can create them: a workspace cannot be inserted by a connection already scoped
 * to a workspace, and an account exists before any membership does. Signup does
 * that on the identity connection; this fixture does it as the owner, which
 * reaches the same two tables through the `provisioning` policies of 0002 and
 * keeps the fixture independent of the identity role it is not testing.
 *
 * Everything after that goes through `withActor` scoped to the new workspace —
 * the tenant tables have exactly one write path and the fixture does not get to
 * skip it.
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
    projectId: uuidv7(),
    projectMemberId: uuidv7(),
    stateId: uuidv7(),
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

      await tx.insert(project).values({
        id: ids.projectId,
        workspaceId: ids.workspaceId,
        teamId: ids.teamId,
        slug: 'board',
        key: 'BRD',
        name: `${slug} board`,
      });
      await tx.insert(projectMember).values({
        id: ids.projectMemberId,
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        workspaceMemberId: ids.ownerMemberId,
        role: 'lead',
      });
      await tx.insert(workflowState).values({
        id: ids.stateId,
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        name: 'Todo',
        nameKey: 'defaultState.todo',
        group: 'unstarted',
        color: 'ink',
        position: 0,
      });
    },
    h.app,
  );

  return ids;
}
