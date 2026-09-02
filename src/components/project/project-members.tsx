'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { PROJECT_ROLES, type ProjectRole } from '@/server/authz/roles';
import {
  addProjectMemberAction,
  changeProjectRoleAction,
  removeProjectMemberAction,
} from '@/app/[locale]/[workspaceSlug]/projects/actions';

/**
 * Who is explicitly on this project, and at what role (§10).
 *
 * Explicit membership only — Owner and Admin are implicit Leads everywhere and
 * a workspace-visible project grants Members an implicit Viewer, and neither
 * appears here, because neither is a row. What this screen is *for* is the case
 * where nothing is implicit: a private project, or a Guest, who reaches a
 * project only by being added to it.
 *
 * The import of `PROJECT_ROLES` is the same constant the policy module and the
 * database enum are built from, so this list cannot offer a role the matrix has
 * never heard of.
 */

export type ProjectMemberOption = {
  memberId: string;
  name: string;
  email: string;
};

export function ProjectMembers({
  workspaceSlug,
  projectSlug,
  projectId,
  members,
  candidates,
  disabled,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  members: { memberId: string; name: string; role: ProjectRole }[];
  /** Workspace members not already on the project. */
  candidates: ProjectMemberOption[];
  disabled: boolean;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
          {t('projects.membersEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {members.map((member) => (
            <li key={member.memberId} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <MemberRow
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                projectId={projectId}
                member={member}
                disabled={disabled}
              />
            </li>
          ))}
        </ul>
      )}

      {!disabled && candidates.length > 0 && (
        <AddMemberForm
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={projectId}
          candidates={candidates}
        />
      )}
    </div>
  );
}

function MemberRow({
  workspaceSlug,
  projectSlug,
  projectId,
  member,
  disabled,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  member: { memberId: string; name: string; role: ProjectRole };
  disabled: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [changed, changeAction, changing] = useActionState<RowActionState, FormData>(
    changeProjectRoleAction,
    ROW_IDLE,
  );
  const [removed, removeAction, removing] = useActionState<RowActionState, FormData>(
    removeProjectMemberAction,
    ROW_IDLE,
  );

  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="memberId" value={member.memberId} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  return (
    <>
      <span className="font-medium">{member.name}</span>

      {disabled ? (
        <span className="ms-auto text-xs text-text-subtle">{t(`projectRole.${member.role}`)}</span>
      ) : (
        <>
          <form action={changeAction} className="ms-auto flex items-end gap-2">
            {hidden}
            <SelectField
              label={t('members.role')}
              name="role"
              defaultValue={member.role}
              className="w-36"
            >
              {PROJECT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`projectRole.${role}`)}
                </option>
              ))}
            </SelectField>
            <Button type="submit" size="sm" loading={changing}>
              {t('action.save')}
            </Button>
          </form>

          <form action={removeAction}>
            {hidden}
            <Button type="submit" variant="ghost" size="sm" loading={removing}>
              {t('members.remove')}
            </Button>
          </form>
        </>
      )}

      {(changed.error ?? removed.error) && (
        <Alert tone="danger" className="w-full">
          {t((changed.error ?? removed.error) as string)}
        </Alert>
      )}
    </>
  );
}

function AddMemberForm({
  workspaceSlug,
  projectSlug,
  projectId,
  candidates,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  candidates: ProjectMemberOption[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    addProjectMemberAction,
    ROW_IDLE,
  );

  return (
    <form
      action={action}
      className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />

      <SelectField label={t('members.name')} name="memberId">
        {candidates.map((candidate) => (
          <option key={candidate.memberId} value={candidate.memberId}>
            {candidate.name || candidate.email}
          </option>
        ))}
      </SelectField>

      <SelectField label={t('members.role')} name="role" defaultValue="member">
        {PROJECT_ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`projectRole.${role}`)}
          </option>
        ))}
      </SelectField>

      <Button type="submit" variant="primary" loading={pending}>
        {t('projects.addMember')}
      </Button>

      {state.error && (
        <Alert tone="danger" className="sm:col-span-3">
          {t(state.error)}
        </Alert>
      )}
    </form>
  );
}
