'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { displayName } from '@/lib/seeded-name';
import {
  addTeamMemberAction,
  createTeamAction,
  deleteTeamAction,
  removeTeamMemberAction,
  renameTeamAction,
} from '@/app/[locale]/[workspaceSlug]/settings/teams/actions';

/**
 * §6-5's teams: "Teams with members; projects belong to a team; filter and
 * group by team."
 *
 * The service has existed since slice 3 and nothing could reach it but the
 * default team created at signup — this is the screen §6 always meant. Two
 * details are worth knowing before changing it:
 *
 * - **A team's slug is not re-derived on rename.** The service says why: it is
 *   in every link already shared, and a rename is a display change. So the
 *   rename control is a name field and nothing else.
 * - **The seeded "General" team renders through `displayName`.** It carries a
 *   `name_key` until somebody renames it, which is what stops a Khmer workspace
 *   opening on the English word "General" (§13). A screen that read `row.name`
 *   directly would be the exact bug `src/lib/seeded-name.ts` exists to prevent —
 *   and this is the screen where a rename clears the key for good.
 */

export type TeamRow = {
  id: string;
  slug: string;
  name: string;
  nameKey: string | null;
  memberCount: number;
};

export type MemberOption = {
  memberId: string;
  name: string;
};

export function TeamsEditor({
  workspaceSlug,
  teams,
  members,
  membersByTeam,
}: {
  workspaceSlug: string;
  teams: TeamRow[];
  members: MemberOption[];
  membersByTeam: Record<string, MemberOption[]>;
}) {
  const t = useTranslations('settings.teams');
  const locale = useLocale();

  return (
    <div className="space-y-6">
      <CreateTeam workspaceSlug={workspaceSlug} locale={locale} />

      {teams.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard
                workspaceSlug={workspaceSlug}
                locale={locale}
                team={team}
                members={members}
                onTeam={membersByTeam[team.id] ?? []}
                // A workspace with one team cannot delete it: §6's rule that no
                // setting puts a workspace in an unrecoverable state, and a
                // project must belong to a team. `createProject` falls back to
                // re-creating "General", so this is belt and braces — but the
                // braces are on the screen, where somebody can read them.
                deletable={teams.length > 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamCard({
  workspaceSlug,
  locale,
  team,
  members,
  onTeam,
  deletable,
}: {
  workspaceSlug: string;
  locale: string;
  team: TeamRow;
  members: MemberOption[];
  onTeam: MemberOption[];
  deletable: boolean;
}) {
  const t = useTranslations('settings.teams');
  const tRoot = useTranslations();
  const [renaming, setRenaming] = useState(false);

  const label = displayName(team, (key) => tRoot(key));
  const available = members.filter(
    (member) => !onTeam.some((entry) => entry.memberId === member.memberId),
  );

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-sm font-semibold tracking-tight">{label}</h3>
        <Badge>{team.slug}</Badge>

        <div className="ms-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setRenaming((open) => !open)}>
            {t('rename')}
          </Button>
          {deletable && (
            <DeleteTeam
              workspaceSlug={workspaceSlug}
              locale={locale}
              teamId={team.id}
              name={label}
            />
          )}
        </div>
      </div>

      {renaming && (
        <RenameTeam
          workspaceSlug={workspaceSlug}
          locale={locale}
          teamId={team.id}
          current={label}
          onDone={() => setRenaming(false)}
        />
      )}

      {onTeam.length === 0 ? (
        <p className="text-sm text-text-subtle">{t('noMembers')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {onTeam.map((member) => (
            <li key={member.memberId}>
              <RemoveTeamMember
                workspaceSlug={workspaceSlug}
                locale={locale}
                teamId={team.id}
                member={member}
              />
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <AddTeamMember
          workspaceSlug={workspaceSlug}
          locale={locale}
          teamId={team.id}
          options={available}
        />
      )}
    </div>
  );
}

function CreateTeam({ workspaceSlug, locale }: { workspaceSlug: string; locale: string }) {
  const t = useTranslations('settings.teams');
  const tRoot = useTranslations();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    createTeamAction,
    ROW_IDLE,
  );
  const [name, setName] = useState('');

  return (
    <form
      action={(formData) => {
        action(formData);
        setName('');
      }}
      className="space-y-3 rounded-md border border-border bg-surface p-3"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

      {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <InputField
            label={t('newTeam')}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <Button type="submit" loading={pending}>
          {t('create')}
        </Button>
      </div>
    </form>
  );
}

function RenameTeam({
  workspaceSlug,
  locale,
  teamId,
  current,
  onDone,
}: {
  workspaceSlug: string;
  locale: string;
  teamId: string;
  current: string;
  onDone: () => void;
}) {
  const t = useTranslations('settings.teams');
  const tRoot = useTranslations();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    renameTeamAction,
    ROW_IDLE,
  );
  const [name, setName] = useState(current);

  return (
    <form
      action={(formData) => {
        action(formData);
        onDone();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="teamId" value={teamId} />

      {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

      <div className="min-w-48 flex-1">
        <InputField
          label={t('name')}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
      </div>
      <Button type="submit" loading={pending}>
        {tRoot('action.save')}
      </Button>
    </form>
  );
}

function DeleteTeam({
  workspaceSlug,
  locale,
  teamId,
  name,
}: {
  workspaceSlug: string;
  locale: string;
  teamId: string;
  name: string;
}) {
  const t = useTranslations('settings.teams');
  const [, action, pending] = useActionState<RowActionState, FormData>(deleteTeamAction, ROW_IDLE);

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="teamId" value={teamId} />
      {/* Named rather than a bare "Delete": this is a column of near-identical
          cards, and the accessible name is the only thing distinguishing the
          fourth delete button from the third. */}
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {t('delete', { name })}
      </Button>
    </form>
  );
}

function AddTeamMember({
  workspaceSlug,
  locale,
  teamId,
  options,
}: {
  workspaceSlug: string;
  locale: string;
  teamId: string;
  options: MemberOption[];
}) {
  const t = useTranslations('settings.teams');
  const [, action, pending] = useActionState<RowActionState, FormData>(
    addTeamMemberAction,
    ROW_IDLE,
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="teamId" value={teamId} />

      <div className="min-w-48 flex-1">
        <SelectField label={t('addMember')} name="memberId" defaultValue={options[0]?.memberId}>
          {options.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.name}
            </option>
          ))}
        </SelectField>
      </div>
      <Button type="submit" loading={pending}>
        {t('add')}
      </Button>
    </form>
  );
}

function RemoveTeamMember({
  workspaceSlug,
  locale,
  teamId,
  member,
}: {
  workspaceSlug: string;
  locale: string;
  teamId: string;
  member: MemberOption;
}) {
  const t = useTranslations('settings.teams');
  const [, action, pending] = useActionState<RowActionState, FormData>(
    removeTeamMemberAction,
    ROW_IDLE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="memberId" value={member.memberId} />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {t('removeMember', { name: member.name })}
      </Button>
    </form>
  );
}
