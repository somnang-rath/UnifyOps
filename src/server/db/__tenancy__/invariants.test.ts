import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenancyHarness } from './harness';
import { seedWorkspace, startTenancyHarness } from './harness';

/**
 * Structural gates, not behaviour.
 *
 * Every test above this file proves the policies work on the tables that
 * exist today. These prove that a table added in slice 5 cannot skip them —
 * which is the failure that actually happens, months later, in a hurry.
 */

let h: TenancyHarness;

beforeAll(async () => {
  h = await startTenancyHarness();
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/**
 * Tables that legitimately have no workspace_id. Every entry is deliberate, and
 * nothing else may join them without a reason written down here.
 */
const NON_TENANT_TABLES = new Set([
  'app_user', // global: one person, several workspaces
  'workspace', // the tenant root — it keys on its own id
  '__drizzle_migrations',
  // Authentication is pre-tenancy by nature: a session is resolved from a
  // cookie before anything is known about which workspace the request is for,
  // so there is no tenant key to carry. What protects these is the grant —
  // only the identity role reaches them — which the tests below assert.
  'auth_credential',
  'auth_session',
  'auth_verification_token',
]);

/** The tables the identity role may reach, and the privileges it gets on each. */
const IDENTITY_GRANTS: Record<string, string[]> = {
  app_user: ['INSERT', 'SELECT', 'UPDATE'],
  workspace: ['INSERT', 'SELECT'],
  workspace_member: ['SELECT'],
  invitation: ['SELECT'],
  auth_credential: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  auth_session: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  auth_verification_token: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
};

async function publicTables(): Promise<string[]> {
  const rows = await h.owner.execute<{ table_name: string }>(sql`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  return rows.rows.map((r) => r.table_name);
}

describe('every table in public', () => {
  it('has row level security enabled and FORCED', async () => {
    const rows = await h.owner.execute<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>(sql`
      select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);

    // ENABLE alone exempts the owner from its own policies. FORCE is the half
    // that survives someone running a script as the owner.
    const unprotected = rows.rows.filter((r) => !r.rls_enabled || !r.rls_forced);
    expect(unprotected).toEqual([]);
  });

  it('carries a workspace_id, or is on the list of tables that legitimately do not', async () => {
    const tables = await publicTables();

    const columns = await h.owner.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
    `);
    const tenantScoped = new Set(columns.rows.map((r) => r.table_name));

    const missing = tables.filter((t) => !tenantScoped.has(t) && !NON_TENANT_TABLES.has(t));
    expect(missing).toEqual([]);
  });

  it('has at least one policy for the app role', async () => {
    const rows = await h.owner.execute<{ tablename: string; policies: number }>(sql`
      select c.relname as tablename, count(p.polname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      group by c.relname
      order by c.relname
    `);

    const unpoliced = rows.rows.filter((r) => r.policies === 0).map((r) => r.tablename);
    // A table with RLS enabled and no policy denies everything, which is safe
    // but is a bug wearing a safe costume — it fails at 3am, not in review.
    expect(unpoliced.filter((t) => !NON_TENANT_TABLES.has(t))).toEqual([]);
  });
});

describe('roles', () => {
  it('cannot bypass RLS and are not superusers', async () => {
    const rows = await h.owner.execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(sql`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in ('unifyops_owner', 'unifyops_app', 'unifyops_operator', 'unifyops_identity')
      order by rolname
    `);

    expect(rows.rows).toHaveLength(4);
    for (const r of rows.rows) {
      expect(r.rolsuper, `${r.rolname} is a superuser`).toBe(false);
      expect(r.rolbypassrls, `${r.rolname} can bypass RLS`).toBe(false);
    }
  });

  it('does not let the app role create tables', async () => {
    // A table the app role owns would be exempt from its own policies unless
    // someone remembered FORCE — the exact thing the two-role split removes.
    const rows = await h.owner.execute<{ has: boolean }>(
      sql`select has_schema_privilege('unifyops_app', 'public', 'CREATE') as has`,
    );
    expect(rows.rows[0]?.has).toBe(false);
  });

  it('gives the operator SELECT and nothing else', async () => {
    const rows = await h.owner.execute<{ table_name: string; privilege_type: string }>(sql`
      select distinct table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'unifyops_operator' and table_schema = 'public'
      order by table_name, privilege_type
    `);

    expect(rows.rows.length).toBeGreaterThan(0);
    const nonSelect = rows.rows.filter((r) => r.privilege_type !== 'SELECT');
    expect(nonSelect).toEqual([]);
  });
});

describe('the identity role (slice 3)', () => {
  it('reaches only the handshake tables, and only with the privileges they need', async () => {
    const rows = await h.owner.execute<{ table_name: string; privilege_type: string }>(sql`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'unifyops_identity' and table_schema = 'public'
      order by table_name, privilege_type
    `);

    const granted = new Map<string, string[]>();
    for (const row of rows.rows) {
      granted.set(row.table_name, [...(granted.get(row.table_name) ?? []), row.privilege_type]);
    }

    // Exact, not a subset. The value of this role is the shortness of the list:
    // a tenant table added in a later slice must not appear here, and
    // bootstrap.sql gives it no default privileges precisely so that one cannot
    // arrive silently.
    expect(Object.fromEntries([...granted].map(([t, p]) => [t, p.sort()]))).toEqual(
      IDENTITY_GRANTS,
    );
  });

  it('cannot read what a company is doing', async () => {
    // The sentence the whole design rests on. team, team_member and
    // audit_record are ordinary tenant tables; if the handshake role can read
    // one of them, it is not a handshake role any more.
    for (const table of [
      'team',
      'team_member',
      'audit_record',
      'invitation_team',
      // Slice 4. A project is the first thing that says what a company is
      // actually doing, and 0006 deliberately grants the handshake role nothing
      // on any of these — the omission is checked here rather than trusted.
      'project',
      'project_member',
      'workflow_state',
    ]) {
      const rows = await h.owner.execute<{ has: boolean }>(
        sql`select has_table_privilege('unifyops_identity', ${table}, 'SELECT') as has`,
      );
      expect(rows.rows[0]?.has, `identity can select ${table}`).toBe(false);
    }
  });

  it('cannot create tables', async () => {
    const rows = await h.owner.execute<{ has: boolean }>(
      sql`select has_schema_privilege('unifyops_identity', 'public', 'CREATE') as has`,
    );
    expect(rows.rows[0]?.has).toBe(false);
  });

  it('reads only the memberships of the user it has authenticated', async () => {
    // The policy is `user_id = tenancy.user_id()`, so this is a test of one
    // predicate — but it is the predicate that stops "which workspaces am I in?"
    // from also answering "who else is in them?".
    const a = await seedWorkspace(h, 'identity-a');
    const b = await seedWorkspace(h, 'identity-b');

    const seen = await h.identity.transaction(async (tx) => {
      await tx.execute(sql`select set_config('unifyops.user_id', ${a.ownerUserId}, true)`);
      return tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspace_member`);
    });

    const workspaces = seen.rows.map((r) => r.workspace_id);
    expect(workspaces).toEqual([a.workspaceId]);
    expect(workspaces).not.toContain(b.workspaceId);
  });

  it('sees nothing at all when no user has been authenticated', async () => {
    const seen = await h.identity.transaction(async (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspace_member`),
    );
    expect(seen.rows).toEqual([]);
  });
});

describe('the auth tables belong to the identity role alone', () => {
  it('are unreachable by the app and operator roles', async () => {
    // bootstrap.sql's default privileges would have handed the app role full
    // CRUD and the operator SELECT on these. 0004 revokes both: a support role
    // that could read live session tokens would be a way to become any user in
    // the product, and one that could read password hashes a way to try
    // becoming them somewhere else.
    for (const table of ['auth_credential', 'auth_session', 'auth_verification_token']) {
      for (const role of ['unifyops_app', 'unifyops_operator']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const rows = await h.owner.execute<{ has: boolean }>(
            sql`select has_table_privilege(${role}, ${table}, ${privilege}) as has`,
          );
          expect(rows.rows[0]?.has, `${role} has ${privilege} on ${table}`).toBe(false);
        }
      }
    }
  });
});

describe('audit_record is append-only (§18-11)', () => {
  it('has no UPDATE or DELETE policy', async () => {
    // 'r' read, 'a' append, 'w' update, 'd' delete, '*' all.
    const rows = await h.owner.execute<{ polname: string; polcmd: string }>(sql`
      select p.polname, p.polcmd::text as polcmd
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname = 'audit_record'
    `);

    const mutating = rows.rows.filter((r) => ['w', 'd', '*'].includes(r.polcmd));
    expect(mutating).toEqual([]);
  });

  it('has no UPDATE or DELETE privilege for the app role', async () => {
    const rows = await h.owner.execute<{ privilege_type: string }>(sql`
      select distinct privilege_type from information_schema.role_table_grants
      where grantee = 'unifyops_app' and table_name = 'audit_record'
      order by privilege_type
    `);

    const granted = rows.rows.map((r) => r.privilege_type).sort();
    // Both layers matter: a future migration that adds an UPDATE policy by
    // copy-paste still cannot update, and a future GRANT still meets no policy.
    expect(granted).toEqual(['INSERT', 'SELECT']);
  });
});
