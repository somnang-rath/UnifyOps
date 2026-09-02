import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listProjects } from '@/server/services/projects';
import { displayName } from '@/lib/seeded-name';
import { Link } from '@/i18n/navigation';

/**
 * Every project this person can see — which is not every project in the
 * company. §10's visibility rules are applied in the service; this page renders
 * whatever survives them and never says how much did not.
 *
 * §11's five states: `[L]` the page is server-rendered, so there is no loading
 * state to draw · `[E]` an empty state that offers the one action that fills it
 * · `[S]` the list · `[X]` a project that cannot be created reports on the form,
 * not here · `[!]` archived projects are behind a toggle rather than mixed in,
 * because "why is this greyed out" is a worse question than "where did it go".
 */
export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const { archived } = await searchParams;
  const includeArchived = archived === '1';

  const [projects, t] = await Promise.all([
    listProjects(resolved, { includeArchived }),
    getTranslations(),
  ]);

  const canCreate = can(resolved.actor, 'project.create');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {t('projects.title')}
          </h1>
          <p className="text-sm text-text-muted">
            {t('projects.count', { count: projects.length })}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-3">
          <Link
            href={`/${workspaceSlug}/projects${includeArchived ? '' : '?archived=1'}`}
            className="text-sm text-text-muted transition-colors duration-120 hover:text-text"
          >
            {includeArchived ? t('projects.hideArchived') : t('projects.showArchived')}
          </Link>

          {canCreate && (
            <Link
              href={`/${workspaceSlug}/projects/new`}
              className="inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
            >
              {t('projects.create')}
            </Link>
          )}
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          title={`${t('projects.empty')} ${t('projects.emptyHint')}`}
          action={
            canCreate && (
              <Link
                href={`/${workspaceSlug}/projects/new`}
                className="inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
              >
                {t('projects.create')}
              </Link>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/${workspaceSlug}/projects/${project.slug}`}
                aria-label={t('projects.open', { name: project.name })}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors duration-120 hover:bg-surface-hover"
              >
                {/* The prefix is the name people use out loud for this project's
                    work, so it is shown beside the name rather than hidden in
                    settings. Tabular so a column of them lines up. */}
                <span className="text-2xs font-medium tabular-nums text-text-subtle">
                  {project.key}
                </span>
                <span className="font-medium">{project.name}</span>
                <span className="text-xs text-text-subtle">
                  {displayName({ name: project.teamName, nameKey: project.teamNameKey }, t)}
                </span>

                <span className="ms-auto flex items-center gap-2">
                  {project.archivedAt && <Badge>{t('projects.archived')}</Badge>}
                  {project.visibility === 'private' && (
                    <span className="text-xs text-text-subtle">
                      {t('projects.visibilityPrivate')}
                    </span>
                  )}
                  {project.role && (
                    <span className="text-xs text-text-subtle">
                      {t(`projectRole.${project.role}`)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
