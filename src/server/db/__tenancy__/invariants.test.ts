import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenancyHarness } from './harness';
import { startTenancyHarness } from './harness';

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

/** Tables that legitimately have no workspace_id. Both are deliberate; nothing else may join them. */
const NON_TENANT_TABLES = new Set([
  'app_user', // global: one person, several workspaces
  'workspace', // the tenant root — it keys on its own id
  '__drizzle_migrations',
]);

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
      where rolname in ('unifyops_owner', 'unifyops_app', 'unifyops_operator')
      order by rolname
    `);

    expect(rows.rows).toHaveLength(3);
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
