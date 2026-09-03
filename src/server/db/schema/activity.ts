import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { appRole, operatorRole, primaryId, workspaceIdColumn } from './_shared';
import { project } from './project';
import { user } from './user';
import { workItem } from './work-item';
import { workspace } from './workspace';

/**
 * The per-item activity feed (§4, §8, §9 — slice 7).
 *
 * The second sink on the event registry, beside `audit_record`, and §18-11 is
 * the reason there are two tables rather than one. They differ in every
 * dimension that matters:
 *
 * | | activity | audit |
 * | --- | --- | --- |
 * | scope | one work item | the workspace |
 * | audience | everyone who can see the item | Owner and Admin |
 * | language | translated at render | never translated |
 * | lifetime | follows the item | append-only forever |
 *
 * A single table serving both would have to be wrong for one of them — most
 * obviously in the audience column, where "who can read this" is a project
 * visibility question on one side and a workspace-role question on the other.
 *
 * **`data` holds ids and values, never a translation key** (§13). The `action`
 * column is the event type — a closed set that lives in code — and the renderer
 * maps it to a message. That is what lets the same row read as Khmer to one
 * member of a workspace and English to another, which a stored sentence never
 * could.
 */
export const activity = pgTable(
  'activity',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * Denormalized from the item. Nothing reads it yet — the feed is per item —
     * but slice 13's manager loop asks "what happened in this project this
     * week", and adding the column later means backfilling it from a join
     * across every row the product has ever written.
     */
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    /**
     * Transaction start time, so every row a single mutation produces shares
     * one timestamp. Ordering *within* that group falls to the id, which is a
     * UUIDv7 generated in insert order — see the index below.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Who did it. One column, not audit's two: `uow.emit` refuses to run at all
     * while a view-as session is active (§7.13), so an activity row produced on
     * behalf of somebody else cannot exist. Audit carries the second column
     * precisely because it is the one table a read-only session still writes.
     *
     * Null only if the account itself is deleted. Offboarding does not do that
     * — §7.12 keeps activity "preserved and attributed", and membership is soft
     * deleted — so the feed still names a member who has left the company.
     */
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),

    /** The event type, e.g. `work_item.state_changed`. Never a message key (§13). */
    action: text('action').notNull(),
    /** The ids and values the renderer needs, chosen by the registry entry that emitted it. */
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    /**
     * The feed query, and the only access path this slice has. Descending on
     * both columns because the feed is newest-first and `occurred_at` ties for
     * every row of one transaction — `id` is the tiebreak that makes the order
     * total, and a UUIDv7 breaks it in insert order rather than at random.
     */
    index('activity_item_idx').on(t.workItemId, t.occurredAt.desc(), t.id.desc()),

    foreignKey({
      name: 'activity_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'activity_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /**
     * Append-only, like `audit_record` and for a related reason: this is a
     * projection of events that already happened, and nothing in the product
     * edits history. The absence of UPDATE and DELETE policies denies both to
     * every application role; migration 0010 revokes the table privileges too,
     * so the denial does not rest on RLS alone.
     *
     * Deliberately not `tenantPolicies()`, which would grant all five.
     *
     * The INSERT policy *does* carry the read-only clause, unlike audit's. A
     * view-as session must still be audited; it must not leave a trail in
     * somebody's item history saying they did something they did not do.
     */
    pgPolicy('tenant_select', {
      for: 'select',
      to: appRole,
      using: sql`"workspace_id" = tenancy.workspace_id()`,
    }),
    pgPolicy('tenant_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`"workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
    }),
    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);
