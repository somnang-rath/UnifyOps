import { sql } from 'drizzle-orm';
import {
  bigserial,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '@/lib/notification-kinds';
import {
  appRole,
  operatorRole,
  primaryId,
  tenantPolicies,
  timestamps,
  workspaceIdColumn,
} from './_shared';
import { comment } from './comment';
import { user } from './user';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * Closed enums, mapped to messages in code (§13). Built from the `src/lib`
 * constants for the same reason `workspace_role` is built from
 * `authz/roles.ts`: two lists that must agree should be one list.
 */
export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KINDS);
export const notificationChannel = pgEnum('notification_channel', NOTIFICATION_CHANNELS);

/**
 * The transactional outbox (§8, slice 9).
 *
 * The third sink on the event registry, written by `UnitOfWork.flush` inside
 * the mutation's own transaction — which is the entire point. An email sent
 * from a request handler after a commit is lost when the process dies between
 * the two, and one sent before the commit is a lie when the transaction rolls
 * back. A row written *with* the data, and a worker that reads it afterwards,
 * has neither failure.
 *
 * ```
 * service -> uow.emit(event)
 *              +-> audit_record      (§18-11)
 *              +-> activity          (slice 7)
 *              +-> outbox_message    (here) -> pg-boss -> notification + email
 * ```
 *
 * **`recipient_user_ids` is resolved at write time, not at delivery time.** The
 * registry decides *which members* an event concerns; `flush` translates those
 * to user ids and drops the actor, because §7.8's "an actor never hears about
 * their own action" needs the actor, and `flush` is the one place that knows
 * who it was. A consumer that resolved recipients itself would be resolving
 * them against a workspace that has since changed.
 */
export const outboxMessage = pgTable(
  'outbox_message',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * The monotonic cursor §8 asks for: "the outbox carries a monotonic `seq`
     * so a reconnecting client replays what it missed". Nothing in v1 replays
     * anything — this is one of the realtime-ready seams, and it costs a
     * sequence.
     *
     * Deliberately not the primary key. UUIDv7 ids are what the rest of the
     * schema uses and what `flush` can generate before the row exists; `seq` is
     * an ordering, and a gap in it (a rolled-back transaction burns a value) is
     * meaningless to an ordering and fatal to an identifier.
     */
    seq: bigserial('seq', { mode: 'bigint' }).notNull(),

    /** The `DomainEvent` type. Never a message key (§13). */
    eventType: text('event_type').notNull(),
    /** The event itself, as emitted. Ids and values, never names. */
    payload: jsonb('payload').notNull(),

    /** What kind of thing this is to the person receiving it — the preference key. */
    kind: notificationKind('kind').notNull(),

    /**
     * Who caused it. Null only if the account is deleted; kept so a consumer
     * can address the message without re-reading the event payload.
     */
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),

    /** Everyone this concerns, actor already removed. Empty means nothing to deliver. */
    recipientUserIds: uuid('recipient_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    /** The item the notification points at, so a consumer need not parse the payload. */
    workItemId: uuid('work_item_id'),
    /** Set when the notification deep-links to a specific comment (§7.8). */
    commentId: uuid('comment_id'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /** Stamped by the consumer once every recipient has been handled. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /** The last failure, for the same reason `invitation.delivery_error` exists. */
    deliveryError: text('delivery_error'),
  },
  (t) => [
    /** The claim query: what has not been delivered, oldest first. */
    index('outbox_undelivered_idx')
      .on(t.seq)
      .where(sql`"delivered_at" is null`),

    uniqueIndex('outbox_seq_key').on(t.seq),

    foreignKey({
      name: 'outbox_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    /**
     * SELECT, INSERT and UPDATE, but no DELETE.
     *
     * Not `tenantPolicies()`: the outbox is written by a transaction and
     * updated by a worker, and nothing in the product deletes one from a
     * request. Retention is a maintenance job that will run as the owner, the
     * same way pruning any log does.
     *
     * The INSERT policy carries the read-only clause — a view-as session emits
     * no events at all (`uow.emit` refuses first), so an outbox row from one
     * would be a notification about something that never happened.
     *
     * UPDATE deliberately does **not** carry it: the worker marks rows
     * delivered, and it is not a view-as session. `tenancy.is_read_only()` is
     * false there, so the clause would be inert — leaving it out says so.
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
    pgPolicy('tenant_update', {
      for: 'update',
      to: appRole,
      using: sql`"workspace_id" = tenancy.workspace_id()`,
      withCheck: sql`"workspace_id" = tenancy.workspace_id()`,
    }),
    pgPolicy('operator_select', {
      for: 'select',
      to: operatorRole,
      using: sql`true`,
    }),
  ],
);

/**
 * One person's inbox entry (§7.8).
 *
 * Written by the notify consumer, not by the mutation — the plan's diagram is
 * explicit that inbox and email are both downstream of the outbox, and for the
 * same reason: a workspace with forty people watching an item should not make
 * the person who edited its title wait for forty inserts before their save
 * returns.
 *
 * Keyed on the **member**, not the user: everything else that says "who" in a
 * workspace is a `workspace_member_id`, including the assignee and mention rows
 * this is derived from, and a notification is meaningless outside the workspace
 * it belongs to.
 */
export const notification = pgTable(
  'notification',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /** Whose inbox this is. */
    recipientMemberId: uuid('recipient_member_id').notNull(),

    kind: notificationKind('kind').notNull(),
    /** The `DomainEvent` type, so the renderer can be as specific as the event was. */
    eventType: text('event_type').notNull(),
    /** Ids and values for the renderer. Never a name, never a sentence (§13). */
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),

    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),

    /**
     * What it points at. §7.8: "click navigates to the item **and the specific
     * comment**", which is why the comment id is a column and not a key inside
     * `data` — the inbox groups by item and links by comment, and both are
     * query predicates.
     */
    workItemId: uuid('work_item_id').notNull(),
    commentId: uuid('comment_id'),

    /** The outbox row this came from. One per recipient, so it is not unique alone. */
    outboxMessageId: uuid('outbox_message_id'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null while unread. A timestamp rather than a boolean, because "when" is free. */
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * The inbox query: one member's notifications, newest first. `id` breaks
     * the `occurred_at` tie for the same reason it does in `activity` — one
     * event can produce several rows sharing a transaction timestamp.
     */
    index('notification_inbox_idx').on(t.recipientMemberId, t.occurredAt.desc(), t.id.desc()),

    /**
     * The bell's unread count, which every workspace screen renders. A partial
     * index because the count is only ever over unread rows, and an inbox that
     * has been read is the common case.
     */
    index('notification_unread_idx')
      .on(t.recipientMemberId)
      .where(sql`"read_at" is null`),

    /**
     * Exactly one notification per recipient per outbox message. The unique
     * constraint is what makes the consumer idempotent: pg-boss guarantees
     * at-least-once delivery, so a retry after a partial failure re-inserts,
     * and this turns the second write into a no-op instead of a duplicate line
     * in somebody's inbox.
     */
    unique('notification_delivery_key').on(t.outboxMessageId, t.recipientMemberId),

    foreignKey({
      name: 'notification_recipient_fk',
      columns: [t.recipientMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'notification_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    /**
     * The comment is `set null`, not `cascade`: a retracted comment leaves a
     * tombstone in the thread (slice 8), and the inbox entry that pointed at it
     * should survive as an entry about the item rather than vanish from under
     * somebody who had not read it yet.
     */
    foreignKey({
      name: 'notification_comment_fk',
      columns: [t.commentId, t.workspaceId],
      foreignColumns: [comment.id, comment.workspaceId],
    }).onDelete('set null'),

    foreignKey({
      name: 'notification_outbox_fk',
      columns: [t.outboxMessageId],
      foreignColumns: [outboxMessage.id],
    }).onDelete('set null'),

    /**
     * All five. A notification is not a projection of history the way activity
     * is: its owner marks it read, and "mark all read" is an UPDATE over
     * hundreds of rows (§7.8). DELETE is granted because §7.12's offboarding
     * removes a member and their inbox goes with them — the cascade above needs
     * the privilege to exist.
     */
    ...tenantPolicies(),
  ],
);

/**
 * Per-user notification preferences (§6-6).
 *
 * One row per member per kind, holding the channels that kind may use. A row
 * per kind rather than a JSON blob per member because the notify consumer asks
 * "may I email this person about a mention?" and that should be an index
 * lookup, not a document to parse — and because a kind added in a later slice
 * then needs no migration of everybody's saved settings.
 *
 * **Absent means default**, never "off": `DEFAULT_PREFERENCES` in
 * `src/lib/notification-kinds.ts` is the answer for a member who has never
 * opened the screen, which is almost all of them. A row exists only where
 * somebody made a choice, so the defaults can be changed for everyone who has
 * not.
 *
 * §6-6 also names workspace defaults. Those are `workspaceNotificationDefault`
 * below, added in slice 15 with the screen that writes them.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    workspaceMemberId: uuid('workspace_member_id').notNull(),
    kind: notificationKind('kind').notNull(),
    /** The channels this kind may use. Empty means the person turned it off entirely. */
    channels: notificationChannel('channels')
      .array()
      .notNull()
      .default(sql`'{}'::notification_channel[]`),
    ...timestamps,
  },
  (t) => [
    unique('notification_preference_key').on(t.workspaceMemberId, t.kind),

    foreignKey({
      name: 'notification_preference_member_fk',
      columns: [t.workspaceMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),

    ...tenantPolicies(),
  ],
);

/**
 * Workspace-level notification defaults — the other half of §6-6.
 *
 * The same shape as `notification_preference` with the member taken off, and
 * deliberately so: `wants()` in `src/lib/notification-kinds.ts` now resolves a
 * channel through three layers, **the member's row, then the workspace's, then
 * the product's**, and two tables of one shape make that one lookup written
 * once rather than a table and a blob that have to be read differently.
 *
 * Absent still means "the layer below", never "off". A company that has never
 * opened this screen has no rows here, and every member falls through to
 * `DEFAULT_PREFERENCES` exactly as they did before slice 15 — which is what
 * makes adding this table a change no existing workspace can notice.
 *
 * It is **defaults, not policy**: a member's own preference still wins, because
 * §6-6 puts per-user preferences in v1 and the rules engine that could overrule
 * them in Phase 2. A company that could force email on somebody has built the
 * thing §7.8 says teaches a team to filter the product's mail.
 */
export const workspaceNotificationDefault = pgTable(
  'workspace_notification_default',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    channels: notificationChannel('channels')
      .array()
      .notNull()
      .default(sql`'{}'::notification_channel[]`),
    ...timestamps,
  },
  (t) => [
    unique('workspace_notification_default_key').on(t.workspaceId, t.kind),
    ...tenantPolicies(),
  ],
);
