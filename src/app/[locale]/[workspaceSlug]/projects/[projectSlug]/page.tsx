import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge } from '@/components/ui/feedback';
import { StatePill } from '@/components/ui/state-pill';
import { resolveActorContext } from '@/server/auth/context';
import { getProjectBySlug } from '@/server/services/projects';
import { displayName } from '@/lib/seeded-name';
import { Link } from '@/i18n/navigation';

/**
 * The board (§7.1: "Land on the BOARD — six default states already present").
 *
 * Work items arrive in slice 5, so what is here is the board's frame: one
 * column per workflow state, in the order the project has them, each with the
 * empty state §11 requires. That is the slice-4 outcome §14 asks to be able to
 * demonstrate — create a project, six default states, switch to Khmer, all
 * translated — and the columns are what "all translated" is checked against,
 * because a seeded state renders from its message key until somebody renames it.
 *
 * The columns scroll inside their own container rather than the page, so the
 * body never scrolls sideways at 390px (§15's manual check 6).
 */
export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; projectSlug: string }>;
}) {
  const { locale, workspaceSlug, projectSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const project = await getProjectBySlug(resolved, projectSlug);
  // Null is "no such project" and "not visible to you" alike — one 404, as one
  // level up, because telling them apart says what exists.
  if (!project) notFound();

  const t = await getTranslations();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {project.name}
            {project.archivedAt && <Badge>{t('projects.archived')}</Badge>}
          </h1>
          <p className="text-sm text-text-muted">
            <span className="tabular-nums">{project.key}</span> ·{' '}
            {displayName({ name: project.teamName, nameKey: project.teamNameKey }, t)} ·{' '}
            {t('states.count', { count: project.states.length })}
          </p>
        </div>

        {project.canEditSettings && (
          <Link
            href={`/${workspaceSlug}/projects/${projectSlug}/settings`}
            className="ms-auto text-sm text-text-muted transition-colors duration-120 hover:text-text"
          >
            {t('projects.settings')}
          </Link>
        )}
      </header>

      {project.archivedAt && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      <div className="overflow-x-auto pb-2">
        {/* Named, so the columns are one addressable region rather than a bare
            list among the page's others — for a screen reader, and for the
            end-to-end suite that counts them. */}
        <ul aria-label={t('projects.board')} className="flex min-w-max gap-3">
          {project.states.map((state) => (
            <li
              key={state.id}
              className="flex w-64 flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3"
            >
              <StatePill name={displayName(state, t)} color={state.color} count={0} />
              <p className="rounded-sm border border-dashed border-border px-3 py-6 text-center text-xs text-text-subtle">
                {t('projects.boardEmpty')}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
