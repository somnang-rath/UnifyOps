import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge } from '@/components/ui/feedback';
import { ListView, type ListGroupHeading } from '@/components/views/list-view';
import type { StateOption } from '@/components/work-item/state-select';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listLabels } from '@/server/services/labels';
import { listMembers } from '@/server/services/members';
import { getProjectBySlug } from '@/server/services/projects';
import { listWorkItems } from '@/server/services/work-items';
import { displayName } from '@/lib/seeded-name';
import { PRIORITIES } from '@/lib/priorities';
import { NONE, parseWorkItemQuery, type WorkItemQuery } from '@/lib/work-item-query';
import { Link } from '@/i18n/navigation';

/**
 * A project's work — the List view (§14, slice 5).
 *
 * §7.1 lands somebody here after creating a project, so this page is the first
 * thing a new workspace sees with anything in it. The board arrives in slice 6
 * and will read the same query with a different `groupBy` and a different
 * renderer; the query, the filters and the URL contract are shared, which is
 * the reason §9 asks for one builder rather than one per view.
 *
 * **The URL is the state** (§5): the filter, the grouping and the sort are all
 * in the query string, parsed by the same module the filter bar writes with. A
 * link pasted into chat opens the list the sender was looking at.
 */
export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug, projectSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const project = await getProjectBySlug(resolved, projectSlug);
  // Null is "no such project" and "not visible to you" alike — one 404, because
  // telling them apart says what exists.
  if (!project) notFound();

  const [t, members, labels] = await Promise.all([
    getTranslations(),
    listMembers(resolved.context),
    listLabels(resolved.context),
  ]);

  const states: StateOption[] = project.states.map((state) => ({
    id: state.id,
    name: displayName(state, t),
    color: state.color,
  }));

  const parsed = parseWorkItemQuery(await searchParams);

  /**
   * The project anchors the query (§9, §16) and is not negotiable from the URL:
   * this page is one project's list, and a pasted `?p=` naming another one would
   * otherwise render someone else's work under this project's heading. The rest
   * of the filter is whatever the URL says.
   *
   * `parentId: null` unless the URL asks otherwise — a flat list that
   * interleaves parents and their sub-items reads as duplicates.
   */
  const query: WorkItemQuery = {
    ...parsed,
    filters: {
      ...parsed.filters,
      projectIds: [project.id],
      parentId: parsed.filters.parentId === undefined ? null : parsed.filters.parentId,
      includeArchivedProjects: project.archivedAt !== null,
    },
  };

  const headings = headingsFor(query, states, members, labels, t);

  const listing = await listWorkItems(resolved, query, {
    groupKeys: headings.map((heading) => heading.key),
  });

  const resource = {
    id: project.id,
    workspaceId: resolved.workspace.id,
    visibility: project.visibility,
  };
  // An archived project is read-only for everyone including its owner (§4), so
  // both halves are asked separately: may you, and is anything writable at all.
  const archived = project.archivedAt !== null;
  const canCreate = can(resolved.actor, 'work_item.create', resource) && !archived;
  const canEdit = can(resolved.actor, 'work_item.edit', resource) && !archived;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {project.name}
            {archived && <Badge>{t('projects.archived')}</Badge>}
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

      {archived && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      <ListView
        context={{ workspaceSlug, projectSlug, locale }}
        query={query}
        listing={listing}
        headings={headings}
        states={states}
        projectId={project.id}
        canCreate={canCreate}
        canEdit={canEdit}
      />
    </div>
  );
}

/**
 * Every group to draw, in display order — including the ones with nothing in
 * them.
 *
 * Supplied rather than discovered from the data, for the reason §9's page query
 * takes them as an argument: a column that disappears when it empties is a
 * column nothing can be added to, and the order is the project's rather than
 * whatever the rows happened to produce.
 */
function headingsFor(
  query: WorkItemQuery,
  states: readonly StateOption[],
  members: readonly { memberId: string; name: string; email: string }[],
  labels: readonly { id: string; name: string }[],
  t: Awaited<ReturnType<typeof getTranslations>>,
): ListGroupHeading[] {
  switch (query.groupBy) {
    case 'state':
      return states.map((state) => ({ key: state.id, label: state.name, state }));

    case 'priority':
      return PRIORITIES.map((priority) => ({
        key: priority,
        label: t(`priority.${priority}`),
      }));

    case 'assignee':
      return [
        ...members.map((member) => ({
          key: member.memberId,
          // An account that has not filled in a name still has to be pickable
          // from a list, so the address stands in until they do.
          label: member.name.trim() || member.email,
        })),
        // Last, and always present: §7.4 makes unassigned work one of the rows
        // a manager comes to this screen for.
        { key: NONE, label: t('workItems.filters.unassigned') },
      ];

    case 'label':
      return [
        ...labels.map((label) => ({ key: label.id, label: label.name })),
        { key: NONE, label: t('workItems.filters.unlabelled') },
      ];

    case 'project':
      return query.filters.projectIds.map((id) => ({ key: id, label: t('nav.projects') }));

    case 'none':
      return [{ key: 'all', label: t('workItems.groups.none') }];
  }
}
