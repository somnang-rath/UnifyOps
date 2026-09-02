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
