import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { WORKSPACE_ROLES } from '@/server/authz/roles';
import {
  appRole,
  identityRole,
  operatorRole,
  primaryId,
  tenantPolicies,
  timestamps,
  workspaceIdColumn,
} from './_shared';
import { user } from './user';

/**
 * §10. Closed enum, mapped to labels in code — no translation key in the database.
 *
 * The values come from the policy module so the database and the permission
 * matrix cannot drift apart; src/server/authz/roles.ts is the source of truth.
 */
export const workspaceRole = pgEnum('workspace_role', WORKSPACE_ROLES);

/**
 * A company. The tenant root: `workspace.id` is what every other tenant row
 * denormalizes as `workspace_id`.
 */
export const workspace = pgTable(
  'workspace',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workspace_slug_key').on(t.slug),

    /**
     * The tenant root keys on its own `id`, so it cannot use the shared
     * predicate. Pasting workspace B's URL while signed in as A must yield
     * zero rows here — which is what turns into the 404 that §15 requires
     * instead of an empty page.
     */
    pgPolicy('tenant_select', {
      for: 'select',
      to: appRole,
      using: sql`"workspace"."id" = tenancy.workspace_id()`,
    }),
    pgPolicy('tenant_update', {
      for: 'update',
      to: appRole,
      using: sql`"workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
      withCheck: sql`"workspace"."id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
    }),
    /**
     * No INSERT or DELETE policy. A workspace cannot be created by a
     * connection that is already scoped to one — signup runs its own path
     * (slice 3) — and deleting a workspace is an owner operation that will
     * arrive with billing, not a row delete from a request.
     */
    /**
     * Creating a company is the other half of signup: it cannot happen on a
     * connection already scoped to a workspace, because there is not one yet.
     * INSERT and SELECT only — renaming or deleting a workspace is a §10 action
     * inside it, and goes through `withActor` like everything else.
     */
    pgPolicy('identity_insert', {
      for: 'insert',
      to: identityRole,
      withCheck: sql`true`,
    }),
    pgPolicy('identity_select', {
      for: 'select',
      to: identityRole,
      using: sql`true`,
    }),

    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);

/** Membership of a company, and the role that membership carries (§10). */
export const workspaceMember = pgTable(
  'workspace_member',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('member'),
    ...timestamps,
  },
  (t) => [
    unique('workspace_member_workspace_user_key').on(t.workspaceId, t.userId),
    /**
     * Redundant against the primary key on its own, but it is the target a
     * composite foreign key needs: a child row naming `(member_id,
     * workspace_id)` can then only match a member in the same workspace.
     */
    unique('workspace_member_id_workspace_key').on(t.id, t.workspaceId),
    index('workspace_member_user_idx').on(t.userId),
    ...tenantPolicies(),

    /**
     * The narrowest policy in the schema, and the one that keeps the identity
     * role honest.
     *
     * After sign-in the app has to answer "which workspaces is this person in?"
     * — a question that spans workspaces, so no single scope answers it. The
     * identity connection sets only `unifyops.user_id` and reads exactly the
     * rows for that user. It cannot see who else is in those workspaces, which
     * is the difference between a membership lookup and a tenant read.
     */
    pgPolicy('identity_select_own', {
      for: 'select',
      to: identityRole,
      using: sql`"workspace_member"."user_id" = tenancy.user_id()`,
    }),
  ],
);
