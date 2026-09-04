import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TeamsEditor, type MemberOption } from '@/components/settings/teams-editor';
import { Alert } from '@/components/ui/feedback';
import { displayName } from '@/lib/seeded-name';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listMembers } from '@/server/services/members';
import { listTeamMembers, listTeams } from '@/server/services/teams';

/**
 * §6-5's screen: teams and who is on them.
 *
 * §6 explains why this is v1 rather than Phase 2 in one sentence — "Retrofitting
 * a grouping layer *above* projects means touching every query's scoping, which
 * is the most dangerous refactor in the codebase" — and slice 3 built the tables
 * and the service on that reasoning. Until now nothing could reach them but the
 * "General" team a workspace is seeded with.
 *
 * A Member sees the teams and who is on them, which is ordinary company
 * information, and is told they cannot change it. Read by everyone, written by
 * `workspace.settings`, exactly like the labels screen.
 */
export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, teams, members, memberships] = await Promise.all([
    getTranslations(),
    listTeams(resolved.context),
    listMembers(resolved.context),
    listTeamMembers(resolved.context),
  ]);

  const canManage = can(resolved.actor, 'workspace.settings');

  const membersByTeam: Record<string, MemberOption[]> = {};
  for (const row of memberships) {
    membersByTeam[row.teamId] = [
      ...(membersByTeam[row.teamId] ?? []),
      { memberId: row.memberId, name: row.name },
    ];
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('settings.sections.teams')}
        </h2>
        <p className="text-sm text-text-muted">{t('settings.teams.subtitle')}</p>
      </header>

      {canManage ? (
        <TeamsEditor
          workspaceSlug={workspaceSlug}
          teams={teams}
          members={members.map((member) => ({ memberId: member.memberId, name: member.name }))}
          membersByTeam={membersByTeam}
        />
      ) : (
        <>
          <Alert>{t('settings.readOnly')}</Alert>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {teams.map((team) => (
              <li key={team.id} className="flex flex-wrap gap-x-3 px-3 py-2 text-sm">
                <span className="font-medium">{displayName(team, (key) => t(key))}</span>
                <span className="text-text-subtle">
                  {(membersByTeam[team.id] ?? []).map((member) => member.name).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
