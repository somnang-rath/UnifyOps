import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge } from '@/components/ui/feedback';
import { BurndownChart } from '@/components/cycle/burndown-chart';
import { CycleClosePrompt } from '@/components/cycle/cycle-close-prompt';
import { CycleDelete } from '@/components/cycle/cycle-delete';
import { CycleProgress } from '@/components/cycle/cycle-progress';
import { PlanItems } from '@/components/cycle/plan-items';
import { ListView, type ListGroupHeading } from '@/components/views/list-view';
import type { StateOption } from '@/components/work-item/state-select';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { getProjectBySlug } from '@/server/services/projects';
import { getCycle, type CycleDetail } from '@/server/services/cycles';
import { listWorkItems } from '@/server/services/work-items';
import { displayName } from '@/lib/seeded-name';
import { compareStateGroups } from '@/lib/state-groups';
import {
  NONE,
  emptyQuery,
  parseWorkItemQuery,
  type WorkItemQuery,
} from '@/lib/work-item-query';
import { Link } from '@/i18n/navigation';

/**
 * One cycle, end to end (§7.6, §14 slice 11's outcome line).
 *
 * Everything §7.6 asks for after "create" is on this page: the progress bar and
 * the burndown, the work itself grouped by state, the backlog picker that adds
 * to it, and the end-of-cycle prompt.
 *
 * **The item list is the §9 list query, anchored on the cycle.** Not a second
 * query written beside it — §9 is explicit that every listing surface goes
 * through one DSL and one builder, and slice 11 earned its anchor rather than
 * deleting the invariant: `anchorOf` returns `'cycle'` when the filter names a
 * real cycle id, because a cycle belongs to one project and holds a planned,
 * bounded set. The project is filtered too, which costs nothing and keeps the
 * §10 re-check in `listWorkItems` looking at the project it expects.
 *
 * **The prompt appears only once the cycle has ended and nobody has answered.**
 * §7.6 puts it "on end date"; `cycleStatus` calls that `ended`, and the moment
 * somebody answers it becomes `completed` and the panel is gone.
 *
 * §11's five states: `[L]` server-rendered · `[E]` a cycle with no work draws
 * the frame and offers §7.6's "Add work to this cycle" picker beneath it ·
 * `[S]` every mutation revalidates this path · `[X]` per-control, in the row
 * that caused it (§11) · `[!]` an archived project shows everything and edits
 * nothing; a cycle that ended with no open work still gets the prompt, so it
 * can be closed.
 */
export default async function CycleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    locale: string;
    workspaceSlug: string;
    projectSlug: string;
    cycleId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug, projectSlug, cycleId } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [project, detail] = await Promise.all([
    getProjectBySlug(resolved, projectSlug),
    getCycle(resolved, cycleId),
  ]);
  if (!project || !detail) notFound();
  // A cycle reached through the wrong project's URL is a 404 rather than a
  // redirect: the link is wrong, and quietly repairing it teaches nobody.
  if (detail.cycle.projectId !== project.id) notFound();

  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  const states: StateOption[] = project.states.map((state) => ({
    id: state.id,
    name: displayName(state, t),
    color: state.color,
  }));

  const resource = {
    id: project.id,
    workspaceId: resolved.workspace.id,
    visibility: project.visibility,
  };
  const archived = project.archivedAt !== null;
  const canEdit = can(resolved.actor, 'work_item.edit', resource) && !archived;
  const canCreate = can(resolved.actor, 'work_item.create', resource) && !archived;

  /**
   * The cycle's work, through the one §9 builder.
   *
   * The URL is read the way the project page reads it, and for the same
   * reason: §5 asks any view state to be a link somebody can paste, and a
   * filter bar whose changes the page ignored would be a row of controls that
   * silently do nothing. What the *route* owns is not negotiable from the query
   * string — the project and the cycle — because this page is one cycle's work
   * and a pasted `?c=` naming another would render someone else's sprint under
   * this one's heading. Everything else is whatever the URL says.
   *
   * Grouped by state unless asked otherwise: "what is still in progress" is the
   * question a sprint is read to answer.
   */
  const parsed = parseWorkItemQuery(await searchParams);
  const query: WorkItemQuery = {
    ...parsed,
    filters: {
      ...parsed.filters,
      projectIds: [project.id],
      cycleIds: [cycleId],
      // Sub-items included: §7.6 counts only direct members, and an item in the
      // cycle is a direct member whether or not it has a parent. Filtering to
      // top-level would hide carry-over work that happens to sit under a
      // parent left in the last sprint.
      parentId: parsed.filters.parentId,
      includeArchivedProjects: archived,
    },
    groupBy: 'state',
  };

  const headings: ListGroupHeading[] = [...project.states]
    .sort(
      (a, b) => compareStateGroups(a.group, b.group) || a.position - b.position,
    )
    .map((state) => ({
      key: state.id,
      label: displayName(state, t),
      state: { id: state.id, name: displayName(state, t), color: state.color },
    }));

  const listing = await listWorkItems(resolved, query, {
    groupKeys: headings.map((heading) => heading.key),
  });

  // §7.6's picker: this project's unplanned work. Anchored on the project, and
  // filtered to the backlog by the same `none` sentinel the assignee and label
  // filters use.
  const backlog = detail.canManage
    ? await listWorkItems(
        resolved,
        {
          ...emptyQuery(),
          filters: {
            ...emptyQuery().filters,
            projectIds: [project.id],
            cycleIds: [NONE],
            // Open work only. Offering to plan a finished item into a sprint is
            // offering to make a burndown start above its own scope line.
            stateGroups: ['backlog', 'unstarted', 'started'],
            includeArchivedProjects: archived,
          },
          groupBy: 'none',
        },
        { groupKeys: ['all'] },
      )
    : null;

  const openCount = detail.progress.inScope - detail.progress.completed;
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), 'long');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-text-subtle">
          <Link
            href={`/${workspaceSlug}/projects/${projectSlug}/cycles`}
            className="transition-colors duration-120 hover:text-text"
          >
            {t('cycles.title')}
          </Link>
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {detail.cycle.name}
            <Badge
              tone={
                detail.status === 'active'
                  ? 'success'
                  : detail.status === 'ended'
                    ? 'warning'
                    : 'info'
              }
            >
              {t(`cycles.status.${detail.status}`)}
            </Badge>
          </h1>

          {detail.canManage && (
            <div className="ms-auto">
              <CycleDelete
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                projectId={project.id}
                cycleId={cycleId}
                itemCount={detail.progress.total}
              />
            </div>
          )}
        </div>

        <p className="text-sm text-text-muted">
          {day(detail.cycle.startDate)} – {day(detail.cycle.endDate)}
          {/* Working days, from §9's one function — the number a team actually
              plans against, and the reason a Sunday or Pchum Ben does not
              silently count as time to finish. */}
          {detail.status === 'active' && (
            <>
              {' · '}
              <span className="tabular-nums">
                {t('cycles.workingDaysLeft', { count: detail.workingDaysLeft })}
              </span>
            </>
          )}
        </p>

        {detail.cycle.goal && (
          <p className="max-w-prose text-sm text-text">{detail.cycle.goal}</p>
        )}
      </header>

      {archived && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      {/* §7.6's prompt. Only while the cycle has ended and nobody has answered —
          the moment they do, `cycleStatus` reads `completed` and this is gone. */}
      {detail.status === 'ended' && detail.canManage && (
        <CycleClosePrompt
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          cycleId={cycleId}
          openCount={openCount}
          nextCycle={detail.nextCycle}
        />
      )}

      <section className="space-y-5 rounded-md border border-border bg-surface p-4">
        <CycleProgressSection detail={detail} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-text">{t('cycles.work')}</h2>
        <ListView
          context={{ workspaceSlug, projectSlug, locale }}
          query={query}
          listing={listing}
          headings={headings}
          states={states}
          fields={project.customFields.map((field) => ({
            id: field.id,
            name: field.name,
            kind: field.kind,
            options: field.options.map((option) => ({ id: option.id, name: option.name })),
          }))}
          projectId={project.id}
          canCreate={canCreate}
          canEdit={canEdit}
        />
      </section>

      {backlog && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-text">{t('cycles.plan.heading')}</h2>
          <PlanItems
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            projectId={project.id}
            cycleId={cycleId}
            backlog={(backlog.groups[0]?.rows ?? []).map((row) => ({
              id: row.id,
              identifier: row.identifier,
              title: row.title,
            }))}
          />
        </section>
      )}
    </div>
  );
}

/**
 * The progress bar and the burndown, side by side on a wide screen and stacked
 * on a phone (§15-6: every v1 screen usable at 390px).
 *
 * Split out only so the two server components can be composed without the page
 * body growing another level of nesting.
 */
async function CycleProgressSection({ detail }: { detail: CycleDetail }) {
  const t = await getTranslations();

  return (
    <>
      <CycleProgress progress={detail.progress} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-text">{t('cycles.burndown.heading')}</h2>
          {/* Ahead, behind, or on the line — judged at the last day that has
              actually happened, never against the final ideal of zero. */}
          {detail.standing && (
            <Badge tone={detail.standing === 'behind' ? 'warning' : 'success'}>
              {t(`cycles.burndown.${detail.standing}`)}
            </Badge>
          )}
        </div>
        <BurndownChart points={detail.burndown} scope={detail.progress.inScope} />
      </div>
    </>
  );
}
