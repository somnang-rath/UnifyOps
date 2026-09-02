import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appRole, operatorRole, primaryId, workspaceIdColumn } from './_shared';
import { user } from './user';
import { workspace } from './workspace';

/**
 * Who caused an audited change. `operator` exists because a platform operator
 * is not a workspace member (§18-12) — their identity lives outside the tenant
 * tables, so `actor_user_id` has to be nullable and the kind has to say why.
 */
export const auditActorKind = pgEnum('audit_actor_kind', ['member', 'operator', 'system']);

/**
 * The audit log (§18-11).
 *
 * Deliberately not the activity feed, and deliberately not "every mutation
 * writes a row". Rows arrive from a second sink on the event registry, so
 * adding an event type without deciding whether it is auditable is a compile
 * error — see src/server/events/registry.ts.
 *
 * Audit and activity differ in scope (workspace vs item), audience
 * (Owner/Admin vs everyone), language (never translated vs translated) and
 * lifetime (append-only vs follows the item). One table cannot serve both
 * without being wrong for one of them.
 *
 * Append-only is enforced here by the *absence* of UPDATE and DELETE policies,
 * which under RLS denies both to every application role including Owner. A
 * matching REVOKE in the hardening migration removes the table privileges too,
 * so the denial does not depend on RLS alone. An admin editing the record of
 * their own role change must not be a supported operation.
 *
 * Restricting reads to Owner and Admin is the policy module's job (slice 2);
 * RLS here does tenancy, which is workspace scoping.
 */
export const auditRecord = pgTable(
  'audit_record',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    actorKind: auditActorKind('actor_kind').notNull(),
    /** The authenticated principal. Null only when `actor_kind` is `system`. */
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    /**
     * The member the principal was acting as, during view-as (§7.13). Null
     * otherwise. Without this column a view-as session is indistinguishable
     * from the target member acting for themselves — invisible in the log that
     * exists to record it.
     */
    onBehalfOfUserId: uuid('on_behalf_of_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /** The event type, e.g. `workspace_member.role_changed`. Never a translation key. */
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    /** Event payload, already redacted by the registry entry that emitted it. */
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('audit_record_workspace_occurred_idx').on(t.workspaceId, t.occurredAt.desc()),
    index('audit_record_subject_idx').on(t.workspaceId, t.subjectType, t.subjectId),

    pgPolicy('tenant_select', {
      for: 'select',
      to: appRole,
      using: sql`"workspace_id" = tenancy.workspace_id()`,
    }),
    /**
     * Writable while read-only, unlike every other table: a view-as session is
     * exactly the thing that must still produce an audit row. The mutation it
     * would otherwise perform is refused elsewhere.
     */
    pgPolicy('tenant_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`"workspace_id" = tenancy.workspace_id()`,
    }),
    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);
