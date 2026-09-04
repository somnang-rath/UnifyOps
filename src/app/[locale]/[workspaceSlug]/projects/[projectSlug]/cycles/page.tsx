import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { CycleForm } from '@/components/cycle/cycle-form';
import { resolveActorContext } from '@/server/auth/context';
import { getProjectBySlug } from '@/server/services/projects';
import { listCycles } from '@/server/services/cycles';
import { addDays, type CycleStatus } from '@/lib/cycles';
import { todayIn } from '@/lib/workspace-date';
import { Link } from '@/i18n/navigation';

/**
 * A project's cycles (§7.6, §8's `projects/[projectId]/ views · cycles ·
 * settings`).
 *
 * The list and the create form on one page rather than a list plus a `/new`
 * route: §7.6's first step is "create with date range", the form is four
 * fields, and a company that has never run a sprint arrives here with nothing
 * to look at — so the thing that fills the page should be on it.
 *
 * §11's five states: `[L]` server-rendered · `[E]` no cycles yet shows what a
 * cycle is for above a live form, not a shrug · `[S]` creating redirects into
 * the new cycle, where the next step is · `[X]` handled by the form · `[!]`
 * overlapping ranges are badged here as well as warned in the form, because
 * the list is where somebody notices they have two sprints running.
 */
export default async function CyclesPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; projectSlug: string }>;
}) {
  const { locale, workspaceSlug, projectSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const project = await getProjectBySlug(resolved, projectSlug);
  // Null is "no such project" and "not visible to you" alike — one 404, because
  // telling them apart says what exists.
  if (!project) notFound();

  const [t, format, cycles] = await Promise.all([
    getTranslations(),
    getFormatter(),
    listCycles(resolved, project.id),
  ]);
  if (!cycles) notFound();

  const today = todayIn(resolved.workspace.timezone);
  const archived = project.archivedAt !== null;
  // §4: an archived project is read-only for everybody, including its owner.
  const canManage = project.canEditSettings && !archived;

  const range = (start: string, end: string) =>
    `${format.dateTime(new Date(`${start}T00:00:00Z`), 'short')} – ${format.dateTime(
      new Date(`${end}T00:00:00Z`),
      'short',
    )}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('cycles.title')}
        </h1>
        <p className="text-sm text-text-muted">
          {project.name} · {t('cycles.subtitle')}
        </p>
      </header>

      {cycles.length === 0 ? (
        <EmptyState title={t('cycles.empty')} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {cycles.map((cycle) => (
            <li key={cycle.id}>
              <Link
                href={`/${workspaceSlug}/projects/${projectSlug}/cycles/${cycle.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 transition-colors duration-120 hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-text">{cycle.name}</span>
                    <StatusBadge status={cycle.status} t={t} />
                    {/* §7.6: overlapping cycles are allowed and warned. Here is
                        where somebody notices they have two sprints running. */}
                    {cycle.overlapping && <Badge tone="warning">{t('cycles.overlapping')}</Badge>}
                  </span>
                  <span className="block text-xs text-text-subtle">
                    {range(cycle.startDate, cycle.endDate)}
                  </span>
                </span>

                <span className="text-xs tabular-nums text-text-muted">
                  {t('cycles.itemCount', {
                    completed: cycle.completedCount,
                    total: cycle.itemCount,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <section className="space-y-3 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-text">{t('cycles.form.heading')}</h2>
          <CycleForm
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            projectId={project.id}
            existing={cycles.map((cycle) => ({
              id: cycle.id,
              name: cycle.name,
              startDate: cycle.startDate,
              endDate: cycle.endDate,
            }))}
            /**
             * Today through a fortnight, which is §14's own phrasing for what a
             * cycle is ("run a two-week cycle end to end") and the length every
             * team that has not thought about it wants. `addDays(today, 13)`
             * rather than 14: a fortnight *inclusive* of both ends is fourteen
             * days, and an off-by-one here is a sprint that ends on a Tuesday.
             */
            defaults={{
              startDate: today,
              endDate: addDays(today, 13),
              name: '',
            }}
          />
        </section>
      )}

      {/* Not a permission failure worth a 404: somebody who can read the
          project can read its cycles, and only the form is gated. */}
      {archived && <p className="text-xs text-text-subtle">{t('projects.archivedNotice')}</p>}
    </div>
  );
}

/** The status a cycle is in today, derived rather than stored — see lib/cycles. */
function StatusBadge({
  status,
  t,
}: {
  status: CycleStatus;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const TONES = {
    upcoming: 'info',
    active: 'success',
    // The one that asks for something: §7.6's prompt is waiting on this cycle.
    ended: 'warning',
    completed: 'info',
  } as const;

  return <Badge tone={TONES[status]}>{t(`cycles.status.${status}`)}</Badge>;
}
