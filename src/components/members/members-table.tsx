'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@/server/authz/roles';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import {
  changeRoleAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from '@/app/[locale]/[workspaceSlug]/actions';

/**
 * §7.10's member list, and the pending invitations under it.
 *
 * §12: 36px rows, sticky header, 1px separators, **no zebra** — rows already
 * carry state colour and stripes fight it.
 *
 * Each row's controls are their own `<form>` with its own action state, so a
 * failed role change on one row reports on that row instead of at the top of a
 * table whose other twenty rows were fine.
 */

export type MemberRow = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  deliveryStatus: 'pending' | 'sent' | 'failed';
};

const HEAD = 'px-3 py-2 text-start text-xs font-medium text-text-muted';
const CELL = 'px-3 py-2 align-middle';

export function MembersTable({
  workspaceSlug,
  members,
  invitations,
  currentUserId,
  canManage,
}: {
  workspaceSlug: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  currentUserId: string;
  canManage: boolean;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('members.title')}
        </h2>

        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={HEAD}>
                  {t('members.name')}
                </th>
                <th scope="col" className={HEAD}>
                  {t('members.email')}
                </th>
                <th scope="col" className={HEAD}>
                  {t('members.role')}
                </th>
                {canManage && <th scope="col" className={HEAD} />}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <MemberTableRow
                  key={member.memberId}
                  workspaceSlug={workspaceSlug}
                  member={member}
                  isSelf={member.userId === currentUserId}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('members.pendingTitle')}
        </h2>

        {invitations.length === 0 ? (
          <EmptyState title={t('members.empty')} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={HEAD}>
                    {t('members.email')}
                  </th>
                  <th scope="col" className={HEAD}>
                    {t('members.role')}
                  </th>
                  <th scope="col" className={HEAD}>
                    {t('members.status')}
                  </th>
                  {canManage && <th scope="col" className={HEAD} />}
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <InvitationTableRow
                    key={invitation.id}
                    workspaceSlug={workspaceSlug}
                    invitation={invitation}
                    canManage={canManage}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MemberTableRow({
  workspaceSlug,
  member,
  isSelf,
  canManage,
}: {
  workspaceSlug: string;
  member: MemberRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [roleState, roleAction] = useActionState<RowActionState, FormData>(
    changeRoleAction,
    ROW_IDLE,
  );
  const [removeState, removeAction, removing] = useActionState<RowActionState, FormData>(
    removeMemberAction,
    ROW_IDLE,
  );

  const error = roleState.error ?? removeState.error;

  return (
    <>
      <tr className="h-9 border-b border-border last:border-0">
        <td className={CELL}>
          <span className="font-medium">{member.name}</span>
          {isSelf && <span className="ms-1.5 text-xs text-text-subtle">{t('members.you')}</span>}
        </td>
        <td className={`${CELL} text-text-muted`}>{member.email}</td>
        <td className={CELL}>
          {canManage ? (
            <form action={roleAction} className="contents">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="memberId" value={member.memberId} />
              <select
                name="role"
                defaultValue={member.role}
                aria-label={t('members.role')}
                // Submits on change rather than behind a Save button: the row
                // has one field, and a Save nobody presses is how a settings
                // table silently does nothing.
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-7 rounded-xs border border-border bg-surface px-1.5 text-xs"
              >
                {WORKSPACE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`role.${role}`)}
                  </option>
                ))}
              </select>
            </form>
          ) : (
            <span className="text-text-muted">{t(`role.${member.role}`)}</span>
          )}
        </td>
        {canManage && (
          <td className={`${CELL} text-end`}>
            <form action={removeAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="memberId" value={member.memberId} />
              <Button type="submit" size="sm" variant="ghost" loading={removing}>
                {t('members.remove')}
              </Button>
            </form>
          </td>
        )}
      </tr>

      {error && (
        <tr>
          <td colSpan={canManage ? 4 : 3} className="px-3 pb-2">
            <Alert tone="danger">{t(error)}</Alert>
          </td>
        </tr>
      )}
    </>
  );
}

const DELIVERY_TONE = {
  sent: 'info',
  pending: 'warning',
  failed: 'danger',
} as const;

function InvitationTableRow({
  workspaceSlug,
  invitation,
  canManage,
}: {
  workspaceSlug: string;
  invitation: InvitationRow;
  canManage: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [resendState, resendAction, resending] = useActionState<RowActionState, FormData>(
    resendInvitationAction,
    ROW_IDLE,
  );
  const [, revokeAction, revoking] = useActionState<RowActionState, FormData>(
    revokeInvitationAction,
    ROW_IDLE,
  );

  return (
    <>
      <tr className="h-9 border-b border-border last:border-0">
        <td className={CELL}>{invitation.email}</td>
        <td className={`${CELL} text-text-muted`}>{t(`role.${invitation.role}`)}</td>
        <td className={CELL}>
          {/* §7.1: an invitation that did not go out is shown as such, with a
              resend — never a silent failure. */}
          <Badge tone={DELIVERY_TONE[invitation.deliveryStatus]}>
            {invitation.deliveryStatus === 'failed'
              ? t('members.notDelivered')
              : t('members.pending')}
          </Badge>
        </td>
        {canManage && (
          <td className={`${CELL} text-end`}>
            <div className="flex items-center justify-end gap-1">
              <form action={resendAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="invitationId" value={invitation.id} />
                <Button type="submit" size="sm" variant="ghost" loading={resending}>
                  {t('members.resend')}
                </Button>
              </form>
              <form action={revokeAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="invitationId" value={invitation.id} />
                <Button type="submit" size="sm" variant="ghost" loading={revoking}>
                  {t('members.revoke')}
                </Button>
              </form>
            </div>
          </td>
        )}
      </tr>

      {resendState.error && (
        <tr>
          <td colSpan={canManage ? 4 : 3} className="px-3 pb-2">
            <Alert tone="danger">{t(resendState.error)}</Alert>
          </td>
        </tr>
      )}
    </>
  );
}
