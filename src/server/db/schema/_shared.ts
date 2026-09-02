import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * The roles created by scripts/bootstrap.sql. Declared as existing so
 * drizzle-kit references them in policies without trying to create or drop
 * them — role management is a superuser operation and stays in bootstrap.
 */
export const appRole = pgRole('unifyops_app').existing();
export const operatorRole = pgRole('unifyops_operator').existing();

/**
 * The pre-tenancy handshake role (slice 3).
 *
 * Sign in, sign up and invitation acceptance all happen before a workspace is
 * known, and every app-role policy is false when `tenancy.workspace_id()` is
 * NULL — correctly so. This role is that one moment, and its reach is short
 * enough to state: the tables that identify people and companies, the auth
 * tables, and on `workspace_member` only the rows belonging to the user it has
 * already authenticated. Nothing that says what a company is doing.
 */
export const identityRole = pgRole('unifyops_identity').existing();

/**
 * UUIDv7 primary key, generated in the application.
 *
 * v7 is time-ordered, so inserts stay at the right-hand edge of the index
 * instead of scattering across it the way v4 does. Generated client-side
 * rather than by a database default because the unit of work needs the id
 * before the row exists — an event referring to a row it just created cannot
 * wait for a RETURNING round trip per row.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * The denormalized tenant key. Every tenant table carries it, and composite
 * foreign keys hold it honest so a row physically cannot reference a parent in
 * another workspace (§9).
 */
export const workspaceIdColumn = () => uuid('workspace_id').notNull();

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Soft delete. Distinct from `archived_at`, which is a user-facing,
   * reversible state on projects and is filtered in the query builder rather
   * than hidden by a view (§9).
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/** `workspace_id = tenancy.workspace_id()` — the tenant predicate itself. */
const inCurrentWorkspace = sql`"workspace_id" = tenancy.workspace_id()`;

/**
 * Mutations are additionally refused while a view-as session is active
 * (§7.13). The policy module refuses them too; this is the layer that still
 * holds when a mutation is written outside it.
 */
const mutable = sql`"workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()`;

/**
 * The five policies every tenant table gets.
 *
 * Split by command rather than expressed as one `FOR ALL` policy because
 * DELETE has no `WITH CHECK` — folding it in with the others would quietly
 * apply the read predicate where the write predicate was intended.
 *
 * The operator policy is SELECT-only and scoped to its own role (§18-12).
 * There is deliberately no session-variable bypass: an escape hatch on the
 * connection the app already holds is one `SET` away from any bug that can
 * influence session state.
 */
export const tenantPolicies = () => [
  pgPolicy('tenant_select', {
    for: 'select',
    to: appRole,
    using: inCurrentWorkspace,
  }),
  pgPolicy('tenant_insert', {
    for: 'insert',
    to: appRole,
    withCheck: mutable,
  }),
  pgPolicy('tenant_update', {
    for: 'update',
    to: appRole,
    using: mutable,
    withCheck: mutable,
  }),
  pgPolicy('tenant_delete', {
    for: 'delete',
    to: appRole,
    using: mutable,
  }),
  pgPolicy('operator_select', {
    for: 'select',
    to: operatorRole,
    using: sql`true`,
  }),
];

/**
 * The policies for a table the identity role owns outright.
 *
 * The `auth_*` tables are not tenant data and have no `workspace_id` to key on
 * — a session is looked up by its token hash before anything is known about
 * who or where the request is. RLS cannot help here, so the protection is the
 * grant: only the identity role reaches these tables at all, and migration 0004
 * revokes them from the app and operator roles, which the default privileges in
 * bootstrap.sql would otherwise have handed out.
 *
 * FORCE ROW LEVEL SECURITY still applies, so this policy is what keeps the
 * table reachable rather than what restricts it. It is named for what it is.
 */
export const authTablePolicies = () => [
  pgPolicy('identity_all', {
    for: 'all',
    to: identityRole,
    using: sql`true`,
    withCheck: sql`true`,
  }),
];
