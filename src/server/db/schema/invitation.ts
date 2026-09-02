import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  identityRole,
  primaryId,
  tenantPolicies,
  timestamps,
  workspaceIdColumn,
} from './_shared';
import { user } from './user';
import { team } from './team';
import { workspace, workspaceMember, workspaceRole } from './workspace';

/**
 * Where an invitation is in its life. Closed enum, mapped to copy in the
 * message catalogues (§13).
 *
 * There is deliberately no `expired` member. Expiry is `expires_at < now()` and
 * nothing else — a stored status would need a job to keep it true, and the day
 * that job is late the product tells someone their valid link has expired.
 */
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked']);

/**
 * Whether the invitation email actually went out.
 *
 * Separate from `status` because they answer different questions and §7.1 needs
 * both: an invitation can be perfectly valid and still never have reached
 * anyone. "Shown in the member list as not delivered, with a resend, never a
 * silent failure" is this column.
 */
export const invitationDelivery = pgEnum('invitation_delivery', ['pending', 'sent', 'failed']);

/** An invitation to join a workspace (§7.10). */
export const invitation = pgTable(
  'invitation',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    /** Stored lower-cased. The unique index below is what makes that matter. */
    email: text('email').notNull(),
    role: workspaceRole('role').notNull().default('member'),

    /**
     * SHA-256 of the token in the link, never the token itself — the same rule
     * as sessions. An invitation link is a bearer credential for joining a
     * company; a database dump must not be a pile of them.
     */
    tokenHash: text('token_hash').notNull(),
    /** 14 days (§7.10). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    invitedByMemberId: uuid('invited_by_member_id').notNull(),

    status: invitationStatus('status').notNull().default('pending'),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),

    deliveryStatus: invitationDelivery('delivery_status').notNull().default('pending'),
    /**
     * The provider's reason, kept verbatim and never shown to a user — it is
     * English, and an English sentence from the server is exactly where Khmer
     * would quietly become the degraded path (§13). The UI renders a
     * translated "not delivered" and offers a resend; this is for the log.
     */
    deliveryError: text('delivery_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('invitation_token_key').on(t.tokenHash),

    /**
     * One live invitation per address per workspace. Partial, so that revoking
     * or accepting one frees the address to be invited again — without this the
     * second invitation after an offboarding fails on a constraint nobody can
     * see, and §7.10's "duplicates are collapsed, not rejected" becomes a lie.
     */
    uniqueIndex('invitation_workspace_email_pending_key')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending' and ${t.deletedAt} is null`),

    index('invitation_workspace_status_idx').on(t.workspaceId, t.status),

    foreignKey({
      name: 'invitation_invited_by_fk',
      columns: [t.invitedByMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),

    unique('invitation_id_workspace_key').on(t.id, t.workspaceId),

    ...tenantPolicies(),

    /**
     * The one identity-role policy on a tenant table, and the reason it has to
     * exist: accepting an invitation is the moment *before* the invitee belongs
     * to the workspace, so there is no scope to open. The token is the
     * authorization — it is looked up here, and everything the acceptance then
     * writes goes through a normal `withActor` on the workspace the token
     * named.
     *
     * SELECT only. The identity role cannot create, revoke or alter an
     * invitation; those are workspace actions behind §10's manage_members.
     */
    pgPolicy('identity_select', {
      for: 'select',
      to: identityRole,
      using: sql`true`,
    }),
  ],
);

/**
 * The teams an invitation drops the invitee into on acceptance (§7.10:
 * "lands directly in the workspace, in the right teams").
 *
 * A join table rather than a `team_ids` array because it is a real
 * relationship: a team deleted between the invitation and the acceptance must
 * take its row with it, which a foreign key does and an array does not.
 *
 * Projects are the other half of §7.10's "email + role + teams + projects".
 * They do not exist until slice 4, and the invite form says so rather than
 * offering an empty picker.
 */
export const invitationTeam = pgTable(
  'invitation_team',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    invitationId: uuid('invitation_id').notNull(),
    teamId: uuid('team_id').notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'invitation_team_invitation_fk',
      columns: [t.invitationId, t.workspaceId],
      foreignColumns: [invitation.id, invitation.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invitation_team_team_fk',
      columns: [t.teamId, t.workspaceId],
      foreignColumns: [team.id, team.workspaceId],
    }).onDelete('cascade'),
    unique('invitation_team_key').on(t.invitationId, t.teamId),
    ...tenantPolicies(),
  ],
);
