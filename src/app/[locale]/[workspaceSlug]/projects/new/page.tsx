import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProjectForm } from '@/components/project/project-form';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listTeams } from '@/server/services/teams';

/**
 * §7.1's create-project step.
 *
 * A Guest reaching this URL gets a 404 rather than a disabled form: §10 gives
 * "Create project" to Owner, Admin and Member, and a greyed-out submit button
 * is an invitation to ask why.
 */
export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();
  if (!can(resolved.actor, 'project.create')) notFound();

  const [teams, t] = await Promise.all([listTeams(resolved.context), getTranslations()]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('projects.create')}
        </h1>
        <p className="text-sm text-text-muted">{t('projects.emptyHint')}</p>
      </header>

      <ProjectForm
        workspaceSlug={workspaceSlug}
        teams={teams.map((team) => ({ id: team.id, name: team.name, nameKey: team.nameKey }))}
      />
    </div>
  );
}
