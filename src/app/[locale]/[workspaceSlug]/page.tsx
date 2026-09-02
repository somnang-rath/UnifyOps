import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listMembers } from '@/server/services/members';
import { listTeams } from '@/server/services/teams';
import { Link } from '@/i18n/navigation';

/**
 * Where a workspace opens.
 *
 * §7.10 lands an invitee on My Work, which is slice 13. Until then this is the
 * arrival point: it says which company you are in, who is here, and offers the
 * one action this slice supports. Deliberately a real page rather than a
 * redirect to settings — landing an invited member on an admin screen they
 * cannot use would be worse than landing them somewhere plain.
 */
export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [members, teams, t] = await Promise.all([
    listMembers(resolved.context),
    listTeams(resolved.context),
    getTranslations(),
  ]);

  const canManage = can(resolved.actor, 'workspace.manage_members');

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          {resolved.workspace.name}
        </h1>
        <p className="text-sm text-text-muted">
          {t('role.' + resolved.workspace.role)} · {t('teams.members', { count: members.length })}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('members.title')}
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {members.map((member) => (
            <li key={member.memberId} className="flex items-center gap-3 px-3 py-2">
              <span className="font-medium">{member.name}</span>
              <span className="text-xs text-text-subtle">{t(`role.${member.role}`)}</span>
              {member.userId === resolved.user.id && (
                <span className="ms-auto text-xs text-text-subtle">{t('members.you')}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('teams.title')}
        </h2>
        {teams.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
            {t('teams.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center gap-3 px-3 py-2">
                <span className="font-medium">{team.name}</span>
                <span className="ms-auto text-xs text-text-subtle">
                  {t('teams.members', { count: team.memberCount })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <Link
          href={`/${workspaceSlug}/settings/members`}
          className="inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
        >
          {t('members.invite')}
        </Link>
      )}
    </div>
  );
}
