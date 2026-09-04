import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
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
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  /**
   * This screen is §7.1's third step *and* the ordinary "new project" form
   * reached from the projects list, which is why the step marker is a query
   * parameter rather than a property of the route. Somebody creating their
   * fourth project in March is not on step 3 of anything, and a counter that
   * said so would be the product being confidently wrong about where they are.
   */
  const onboarding = (await searchParams).onboarding === '1';

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();
  if (!can(resolved.actor, 'project.create')) notFound();

  const [teams, t] = await Promise.all([listTeams(resolved.context), getTranslations()]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        {onboarding && <OnboardingStep current={3} />}
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
