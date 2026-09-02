import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { appUrl } from '@/env';
import type { ResolvedActor } from '@/server/auth/context';
import { hashToken, LIFETIME, mint } from '@/server/auth/tokens';
import { assertCan } from '@/server/authz/policy';
import type { WorkspaceRole } from '@/server/authz/roles';
import { withIdentity } from '@/server/db/identity';
import {
  invitation,
  invitationTeam,
  team,
  teamMember,
  user as userTable,
  workspace as workspaceTable,
  workspaceMember,
} from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import type { ActorContext } from '@/server/db/tenant';
import { invitationEmail } from '@/server/email/templates';
import { sendMail } from '@/server/email/mailer';
import { parseRecipients, type Recipient } from '@/lib/recipients';

/**
 * Invitations, single and bulk (§7.10).
 *
 * The shape of this module is dictated by one sentence in the plan: "part of a
 * batch fails → **no rollback**; the result lists sent and not-sent, with retry
 * on the failures only." That rules out doing the work in one transaction that
 * also sends the mail, and it rules out treating a send failure as an error.
 *
 * So it is three phases, in this order and for these reasons:
 *
 *   1. One transaction writes every invitation row, with delivery `pending`.
 *      Atomic, because a half-written batch is a batch nobody can reason about.
 *   2. The mail goes out *outside* any transaction. A network call inside one
 *      holds a connection from a pool of ten for as long as the provider takes,
 *      and forty of them would take the pool with it.
 *   3. A second transaction records what actually happened per row.
 *
 * If the process dies between 1 and 3 the invitations exist and read as
 * "pending" rather than "sent", which is the honest state and the one the
 * members list already knows how to offer a resend for.
 */

export type InviteOutcome =
  | 'sent'
  | 'failed'
  | 'already_member'
  | 'already_invited'
  | 'invalid';

export type InviteResultRow = {
  email: string;
  outcome: InviteOutcome;
  /** Provider text, for the log and the delivery_error column. Never rendered (§13). */
  error?: string;
};

export type InviteManyResult = {
  results: InviteResultRow[];
  counts: Record<InviteOutcome, number>;
};

function emptyCounts(): Record<InviteOutcome, number> {
  return { sent: 0, failed: 0, already_member: 0, already_invited: 0, invalid: 0 };
}

function inviteUrl(token: string, locale: string): string {
  // Locale-prefixed, because `localePrefix: 'always'` (§13) — a link without
  // one is a redirect at best and a 404 at worst.
  return `${appUrl().replace(/\/+$/, '')}/${locale}/invite/${token}`;
}

/**
 * Invites everyone in a pasted list.
 *
 * `raw` is what the user actually typed or pasted; parsing it is
 * `parseRecipients`, which is pure and separately tested. Per-row role and team
 * from a CSV override the batch defaults, which is §7.10's "stay overridable
 * per row before sending".
 */
export async function inviteMany(input: {
  resolved: ResolvedActor;
  raw: string;
  role: WorkspaceRole;
  teamIds: readonly string[];
  /** The locale the invitation email is written in — the inviter's. */
  locale: string;
}): Promise<InviteManyResult> {
  const { resolved } = input;
  assertCan(resolved.actor, 'workspace.manage_members');

  const parsed = parseRecipients(input.raw);

  const results: InviteResultRow[] = parsed.invalid.map((email) => ({
    email,
    outcome: 'invalid' as const,
  }));

  type Pending = {
    invitationId: string;
    email: string;
    token: string;
    role: WorkspaceRole;
  };

  const pending: Pending[] = [];

  await withActor(resolved.context, async (tx, uow) => {
    const workspaceId = resolved.workspace.id;

    // Who is already here, and who has already been asked. Both are "collapsed,
    // not rejected" (§7.10) — inviting the whole company address book again
    // should be a no-op with a clear summary, not forty error messages.
    const members = await tx
      .select({ email: userTable.email })
      .from(workspaceMember)
      .innerJoin(userTable, eq(userTable.id, workspaceMember.userId))
      .where(isNull(workspaceMember.deletedAt));

    const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));

    const outstanding = await tx
      .select({ email: invitation.email })
      .from(invitation)
      .where(and(eq(invitation.status, 'pending'), isNull(invitation.deletedAt)));

    const invitedEmails = new Set(outstanding.map((i) => i.email.toLowerCase()));

    // Team names from a CSV column are resolved once, case-insensitively, to
    // the teams that actually exist. An unrecognised name is dropped rather
    // than failing the row: the invitation is the point, the team is a
    // convenience, and §7.10 asks for the batch to get through.
    const teams = await tx
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(isNull(team.deletedAt));

    const teamsByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const validTeamIds = new Set(teams.map((t) => t.id));
    const batchTeamIds = input.teamIds.filter((id) => validTeamIds.has(id));

    const rows: (typeof invitation.$inferInsert)[] = [];
    const teamRows: (typeof invitationTeam.$inferInsert)[] = [];

    for (const recipient of parsed.recipients) {
      if (memberEmails.has(recipient.email)) {
        results.push({ email: recipient.email, outcome: 'already_member' });
        continue;
      }
      if (invitedEmails.has(recipient.email)) {
        results.push({ email: recipient.email, outcome: 'already_invited' });
        continue;
      }

      const invitationId = uuidv7();
      const { token, tokenHash, expiresAt } = mint(LIFETIME.invitation);
      const role = recipient.role ?? input.role;

      rows.push({
        id: invitationId,
        workspaceId,
        email: recipient.email,
        role,
        tokenHash,
        expiresAt,
        invitedByMemberId: resolved.memberId,
      });

      for (const teamId of teamIdsFor(recipient, batchTeamIds, teamsByName)) {
        teamRows.push({ workspaceId, invitationId, teamId });
      }

      pending.push({ invitationId, email: recipient.email, token, role });
    }

    if (rows.length > 0) {
      await tx.insert(invitation).values(rows);
      if (teamRows.length > 0) await tx.insert(invitationTeam).values(teamRows);

      for (const row of pending) {
        uow.emit({
          type: 'invitation.sent',
          workspaceId,
          invitationId: row.invitationId,
          email: row.email,
          role: row.role,
        });
      }
    }
  });

  // --- Phase 2: the network, outside every transaction ----------------------
  const delivery = await Promise.all(
    pending.map(async (row) => {
      const mail = invitationEmail({
        locale: input.locale,
        inviterName: resolved.user.name,
        workspaceName: resolved.workspace.name,
        url: inviteUrl(row.token, input.locale),
      });

      const sent = await sendMail({ ...mail, to: row.email });
      return { ...row, sent };
    }),
  );

  // --- Phase 3: record what happened ---------------------------------------
  if (delivery.length > 0) {
    await withActor(resolved.context, async (tx) => {
      for (const row of delivery) {
        await tx
          .update(invitation)
          .set(
            row.sent.ok
              ? { deliveryStatus: 'sent', deliveredAt: new Date(), deliveryError: null }
              : { deliveryStatus: 'failed', deliveryError: row.sent.error },
          )
          .where(eq(invitation.id, row.invitationId));
      }
    });
  }

  for (const row of delivery) {
    results.push(
      row.sent.ok
        ? { email: row.email, outcome: 'sent' }
        : { email: row.email, outcome: 'failed', error: row.sent.error },
    );
  }

  const counts = emptyCounts();
  for (const row of results) counts[row.outcome] += 1;

  return { results, counts };
}

function teamIdsFor(
  recipient: Recipient,
  batchTeamIds: readonly string[],
  teamsByName: ReadonlyMap<string, string>,
): string[] {
  const named = recipient.team ? teamsByName.get(recipient.team.trim().toLowerCase()) : undefined;
  // A per-row team replaces the batch selection rather than adding to it: the
  // CSV column is an override, which is what "overridable per row" means.
  const ids = named ? [named] : [...batchTeamIds];
  return [...new Set(ids)];
}

export type PendingInvitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'revoked';
  deliveryStatus: 'pending' | 'sent' | 'failed';
  expiresAt: Date;
  createdAt: Date;
};

/** The pending invitations shown beneath the member list (§7.10). */
export async function listPendingInvitations(
  context: ActorContext,
): Promise<PendingInvitation[]> {
  return withActor(context, async (tx) =>
    tx
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        deliveryStatus: invitation.deliveryStatus,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      })
      .from(invitation)
      .where(and(eq(invitation.status, 'pending'), isNull(invitation.deletedAt)))
      .orderBy(invitation.createdAt),
  );
}

/** Withdraws an invitation. The link stops working immediately. */
export async function revokeInvitation(
  resolved: ResolvedActor,
  invitationId: string,
): Promise<boolean> {
  assertCan(resolved.actor, 'workspace.manage_members');

  return withActor(resolved.context, async (tx, uow) => {
    const updated = await tx
      .update(invitation)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
      .returning({ email: invitation.email });

    const row = updated[0];
    if (!row) return false;

    uow.emit({
      type: 'invitation.revoked',
      workspaceId: resolved.workspace.id,
      invitationId,
      email: row.email,
    });

    return true;
  });
}

/**
 * Sends an invitation again, with a fresh token.
 *
 * Fresh rather than the same one, because the old token is only a hash here —
 * there is no way to reproduce the original link, and that is the property that
 * makes the table safe to hold. Re-issuing also restarts the 14 days, which is
 * what someone clicking "resend" means.
 */
export async function resendInvitation(
  resolved: ResolvedActor,
  invitationId: string,
  locale: string,
): Promise<InviteResultRow | null> {
  assertCan(resolved.actor, 'workspace.manage_members');

  const reissued = await withActor(resolved.context, async (tx, uow) => {
    const { token, tokenHash, expiresAt } = mint(LIFETIME.invitation);

    const updated = await tx
      .update(invitation)
      .set({ tokenHash, expiresAt, deliveryStatus: 'pending', updatedAt: new Date() })
      .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
      .returning({ email: invitation.email });

    const row = updated[0];
    if (!row) return null;

    uow.emit({
      type: 'invitation.resent',
      workspaceId: resolved.workspace.id,
      invitationId,
      email: row.email,
    });

    return { email: row.email, token };
  });

  if (!reissued) return null;

  const mail = invitationEmail({
    locale,
    inviterName: resolved.user.name,
    workspaceName: resolved.workspace.name,
    url: inviteUrl(reissued.token, locale),
  });

  const sent = await sendMail({ ...mail, to: reissued.email });

  await withActor(resolved.context, async (tx) => {
    await tx
      .update(invitation)
      .set(
        sent.ok
          ? { deliveryStatus: 'sent', deliveredAt: new Date(), deliveryError: null }
          : { deliveryStatus: 'failed', deliveryError: sent.error },
      )
      .where(eq(invitation.id, invitationId));
  });

  return sent.ok
    ? { email: reissued.email, outcome: 'sent' }
    : { email: reissued.email, outcome: 'failed', error: sent.error };
}

export type InvitationPreview = {
  invitationId: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
};

export type InvitationLookup =
  | { ok: true; invitation: InvitationPreview }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'accepted' };

/**
 * Exchanges a token for the workspace it names, on the identity connection.
 *
 * This is the one read in the product that legitimately crosses into a
 * workspace the reader does not belong to — which is exactly why it is the only
 * identity-role policy on a tenant table, and why that policy is SELECT. The
 * token is the authorization; everything the acceptance then writes goes
 * through a normal `withActor`.
 */
export async function lookupInvitation(token: string): Promise<InvitationLookup> {
  const tokenHash = hashToken(token);

  const rows = await withIdentity(async (tx) =>
    tx
      .select({
        invitationId: invitation.id,
        workspaceId: invitation.workspaceId,
        workspaceSlug: workspaceTable.slug,
        workspaceName: workspaceTable.name,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .innerJoin(workspaceTable, eq(workspaceTable.id, invitation.workspaceId))
      .where(and(eq(invitation.tokenHash, tokenHash), isNull(invitation.deletedAt)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (row.status === 'accepted') return { ok: false, reason: 'accepted' };
  // Expiry is computed, never stored — see the `invitation_status` enum.
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    invitation: {
      invitationId: row.invitationId,
      workspaceId: row.workspaceId,
      workspaceSlug: row.workspaceSlug,
      workspaceName: row.workspaceName,
      email: row.email,
      role: row.role,
    },
  };
}

export type AcceptResult =
  | { ok: true; workspaceSlug: string; alreadyMember: boolean }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'accepted' };

/**
 * Accepts an invitation for an already-signed-in user (§7.10).
 *
 * The invitee is not a member yet, so the scope this opens is authorized by the
 * token rather than by an existing membership — the one place in the product
 * where that is true. Everything inside it is an ordinary tenant write: RLS is
 * satisfied because the rows carry the workspace the token named.
 *
 * The accepting account's address may differ from the invited one. That is
 * allowed on purpose — a link forwarded to someone's work address is the common
 * case, not an attack — and `invitation.accepted` records both, so the audit log
 * shows who actually walked through the door (§18-11).
 */
export async function acceptInvitation(token: string, userId: string): Promise<AcceptResult> {
  const lookup = await lookupInvitation(token);
  if (!lookup.ok) return lookup;

  const { invitationId, workspaceId, workspaceSlug, email, role } = lookup.invitation;

  const existing = await withIdentity(
    async (tx) =>
      tx
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.userId, userId),
            isNull(workspaceMember.deletedAt),
          ),
        )
        .limit(1),
    { userId },
  );

  // §7.10: "already a member → straight to the workspace, no error." The
  // invitation is left pending rather than consumed, because it was addressed
  // to someone and this person was not necessarily them.
  if (existing.length > 0) return { ok: true, workspaceSlug, alreadyMember: true };

  const memberId = uuidv7();

  await withActor(
    { workspaceId, userId, actorUserId: userId, readOnly: false },
    async (tx, uow) => {
      await tx.insert(workspaceMember).values({ id: memberId, workspaceId, userId, role });

      // "Lands directly in the workspace, in the right teams" (§7.10).
      const teams = await tx
        .select({ teamId: invitationTeam.teamId })
        .from(invitationTeam)
        .where(eq(invitationTeam.invitationId, invitationId));

      if (teams.length > 0) {
        await tx.insert(teamMember).values(
          teams.map((t) => ({
            workspaceId,
            teamId: t.teamId,
            workspaceMemberId: memberId,
          })),
        );
      }

      await tx
        .update(invitation)
        .set({
          status: 'accepted',
          acceptedByUserId: userId,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invitation.id, invitationId));

      uow.emit({
        type: 'workspace_member.added',
        workspaceId,
        memberId,
        userId,
        role,
      });
      uow.emit({
        type: 'invitation.accepted',
        workspaceId,
        invitationId,
        email,
        userId,
        memberId,
      });
      for (const t of teams) {
        uow.emit({ type: 'team.member_added', workspaceId, teamId: t.teamId, memberId });
      }
    },
  );

  return { ok: true, workspaceSlug, alreadyMember: false };
}

/**
 * Invitations addressed to an email, across workspaces.
 *
 * Used right after signup so someone who was invited and then registered
 * independently still finds their invitation waiting, rather than a dead end
 * where the product tells them to create a company they already belong to.
 */
export async function pendingInvitationsFor(email: string): Promise<number> {
  const rows = await withIdentity(async (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(invitation)
      .where(
        and(
          sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
          eq(invitation.status, 'pending'),
          isNull(invitation.deletedAt),
        ),
      ),
  );

  return rows[0]?.count ?? 0;
}

/** Teams that exist in this workspace, for the invite form's picker. */
export async function listTeamsForInvite(
  context: ActorContext,
): Promise<{ id: string; name: string }[]> {
  return withActor(context, async (tx) =>
    tx
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(isNull(team.deletedAt))
      .orderBy(team.name),
  );
}
