import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge } from '@/components/ui/feedback';
import { BoardView, type BoardColumn } from '@/components/views/board-view';
import { CalendarView, type CalendarDay } from '@/components/views/calendar-view';
import { ListView, type ListGroupHeading } from '@/components/views/list-view';
import { SavedViewsBar } from '@/components/views/saved-views-bar';
import { TableView, type TableField } from '@/components/views/table-view';
import { ViewSwitcher } from '@/components/views/view-switcher';
import { FilterBar } from '@/components/work-item/filter-bar';
import type { StateOption } from '@/components/work-item/state-select';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listLabels } from '@/server/services/labels';
import { listMembers } from '@/server/services/members';
import { getProjectBySlug } from '@/server/services/projects';
import { boardChangeToken, listWorkItems } from '@/server/services/work-items';
import type { CustomFieldDefinition } from '@/server/queries/custom-fields';
import { CHECKBOX_KEYS, customFieldIdOf, isGroupable } from '@/lib/custom-fields';
import { displayName } from '@/lib/seeded-name';
import { PRIORITIES } from '@/lib/priorities';
import { toItemRowData } from '@/lib/work-item-row';
import {
  defaultTableLayout,
  resolveColumns,
  sameQuery,
} from '@/lib/saved-views';
import { todayIn } from '@/lib/workspace-date';
import {
  NONE,
  monthDays,
  monthOf,
  parseWorkItemQuery,
  toQueryString,
  type WorkItemQuery,
} from '@/lib/work-item-query';
import { Link } from '@/i18n/navigation';

/**
 * A project's work — the List view (§14, slice 5).
 *
 * §7.1 lands somebody here after creating a project, so this page is the first
 * thing a new workspace sees with anything in it. Slice 6 added the board
 * beside it, and the two share everything but the renderer: one query, one
 * filter DSL, one URL contract — which is the reason §9 asks for one builder
 * rather than one per view.
 *
 * **The board is always grouped by state**, whatever `by=` says. A column you
 * drag a card into has to *mean* something the drop can change, and the drop
 * changes a state; dragging into an assignee column would be a reassignment and
 * is not what `moveWorkItem` does. The grouping control belongs to the list,
 * and the board hides it rather than offering a choice that would not work.
 *
 * **The URL is the state** (§5): the filter, the grouping and the sort are all
 * in the query string, parsed by the same module the filter bar writes with. A
 * link pasted into chat opens the list the sender was looking at.
 *
 * Slice 12 added the other two of §14's "all four view types" beside them, and
 * the shape of this page is the argument for having built §9 the way it was
 * built: **four renderers, one query, one DSL, one builder**. The Table is the
 * same query grouped into one group; the Calendar is the same query grouped by
 * day over one month. Neither added a query, a table, or a second definition of
 * what a filter is.
 *
 * Each view that cannot honour the URL's grouping overrides it here rather than
 * hiding the mismatch: the board is a board of **states**, the table is §12's
 * one scrolling table and so groups by **nothing**, and the calendar groups by
 * **day** because that is what a cell is. The grouping control is hidden on all
 * three — a control offering a choice the view will discard is worse than no
 * control.
 */
/**
 * How many items one calendar cell fetches.
 *
 * Deliberately far below `DEFAULT_LIMIT`: the calendar asks for thirty-one
 * `LATERAL` pages at once, and fifty rows in each would be fifteen hundred rows
 * fetched to draw cells that show ten. The cell's count is the day's **real**
 * total either way — that comes from the counts query, not from the page — so
 * lowering this costs nothing but the link a busy day already needs.
 */
const CALENDAR_ITEMS_PER_DAY = 10;

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

  const rawParams = await searchParams;
  const parsed = parseWorkItemQuery(rawParams);

  /**
   * §7.1's last line — "land on the BOARD … 'add your first task' input already
   * focused" — arrives as `?new=1` from `createProjectAction`.
   *
   * Deliberately **not** a member of the filter DSL. The DSL describes a query
   * worth sharing (§5), and where somebody's cursor went once is not; keeping
   * it out means `toQueryString` drops it on the first filter change, which is
   * exactly the lifetime a one-render gesture should have. A pasted link
   * carrying it costs a stranger one focused input.
   */
  const focusFirstComposer = rawParams.new === '1';

  const board = parsed.view === 'board';
  const table = parsed.view === 'table';
  const calendar = parsed.view === 'calendar';

  /**
   * Today in the **workspace's** zone (§17-13), needed here and not only inside
   * the listing because the calendar has to know which month to open on before
   * it asks for one. `todayIn` takes the zone as an argument and has no default,
   * so there is no path by which this becomes the server's day.
   */
  const today = todayIn(resolved.workspace.timezone);

  /**
   * The calendar's month: the URL's, or the one we are in.
   *
   * Defaulted here rather than in the DSL, because `parseWorkItemQuery` has no
   * timezone to resolve "this month" against and must never be the thing that
   * decides what day it is (§17-13).
   *
   * **A calendar URL with no month means "the current month", and the calendar
   * does not rewrite the URL to pin one.** That is the same bargain the due
   * windows make: `d=overdue` still means overdue tomorrow, where a resolved
   * date would silently become a different question overnight. So a link
   * somebody pastes into chat on the 30th opens on *their* current month, which
   * is what "the calendar" means — and the moment anybody pages to a specific
   * month, that month is in the URL and travels with the link.
   */
  const month = calendar ? (parsed.filters.month ?? monthOf(today)) : parsed.filters.month;

  /**
   * The project anchors the query (§9, §16) and is not negotiable from the URL:
   * this page is one project's list, and a pasted `?p=` naming another one would
   * otherwise render someone else's work under this project's heading. The rest
   * of the filter is whatever the URL says.
   *
   * `parentId: null` unless the URL asks otherwise — a flat list that
   * interleaves parents and their sub-items reads as duplicates.
   */
  const urlQuery: WorkItemQuery = {
    ...parsed,
    /**
     * `day` is the calendar's grouping, and like the month it belongs to that
     * view alone. Every other view falls back to the default rather than
     * honouring it: the List would ask `headingsFor` for a heading per calendar
     * day of an unbounded range and get none, which renders as a list with
     * nothing in it and no way to tell that the grouping is why.
     *
     * This is what keeps the links the calendar draws — and the ones the view
     * switcher draws beside them — from carrying one view's imposition into the
     * next.
     */
    groupBy: !calendar && parsed.groupBy === 'day' ? 'state' : parsed.groupBy,
    filters: {
      ...parsed.filters,
      projectIds: [project.id],
      parentId: parsed.filters.parentId === undefined ? null : parsed.filters.parentId,
      includeArchivedProjects: project.archivedAt !== null,
      /**
       * **The month applies to the calendar and to nothing else.**
       *
       * It is that view's axis rather than a narrowing anybody chose — which is
       * also why `hasActiveFilters` does not count it and why the filter bar has
       * no control for it. Left in force on the List it would silently hide
       * every undated item, with nothing on screen to say why and no control to
       * clear it: a filter a person cannot see or undo, which §11 rules out.
       *
       * It stays in the URL, so switching back to the calendar returns to the
       * month they were reading. It is simply inert everywhere else.
       */
      month: calendar ? month : undefined,
    },
  };

  /**
   * The grouping each view imposes on the query it was handed.
   *
   * The board is a board of states, so a drop means a state change. The table
   * is §12's one scrolling table with one sticky header, so it is one group.
   * The calendar's cells are days, so it groups by day over the month it drew —
   * and it lowers the page size, because thirty-one `LATERAL` pages of fifty is
   * a lot of rows to fetch for cells that show ten and link to the rest.
   */
  const query: WorkItemQuery = board
    ? { ...urlQuery, groupBy: 'state' }
    : table
      ? { ...urlQuery, groupBy: 'none' }
      : calendar
        ? {
            ...urlQuery,
            groupBy: 'day',
            filters: { ...urlQuery.filters, month },
            limit: CALENDAR_ITEMS_PER_DAY,
          }
        : urlQuery;

  const headings: ListGroupHeading[] = calendar
    ? // One heading per calendar day of the month. Supplied rather than
      // discovered, exactly as every other grouping's are: a day with nothing
      // due still has a cell, and the cell is where somebody would put
      // something.
      monthDays(month ?? monthOf(today)).map((date) => ({ key: date, label: date }))
    : headingsFor(query, states, members, labels, project.cycles, project.customFields, t);

  const listing = await listWorkItems(resolved, query, {
    groupKeys: headings.map((heading) => heading.key),
    // Only the table draws custom columns, so only the table pays for the query
    // that fills them — the same trade "only the board polls" makes below.
    withCustomValues: table && project.customFields.length > 0,
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

  // Only the board polls, so only the board pays for the token (§8).
  const token = board ? await boardChangeToken(resolved, query) : '';

  const columns: BoardColumn[] = board
    ? headings.flatMap((heading) => {
        // A heading without a state is not a board column. `headingsFor` is
        // shared with the list, where a grouping may be by priority or person.
        if (!heading.state) return [];
        const group = listing.groups.find((candidate) => candidate.key === heading.key);
        return [
          {
            key: heading.key,
            state: heading.state,
            total: group?.total ?? 0,
            items: (group?.rows ?? []).map(toItemRowData),
          },
        ];
      })
    : [];

  /** The custom fields the table draws as columns (§6-4, and slice 10's last word). */
  const fields: TableField[] = project.customFields.map((field) => ({
    id: field.id,
    name: field.name,
    kind: field.kind,
    options: field.options.map((option) => ({ id: option.id, name: option.name })),
  }));

  /**
   * The path and the query as this render sees them.
   *
   * `toQueryString(urlQuery)` rather than the raw search string, so the
   * comparison against a stored view is between two strings the *same*
   * serialiser produced — a URL somebody hand-edited, or one a chat client
   * reordered, still matches the view it names.
   */
  const pathname = `/${workspaceSlug}/projects/${projectSlug}`;
  const currentQuery = toQueryString(urlQuery);

  /**
   * The saved view this screen is currently showing, if any.
   *
   * Only it can absorb a column resize (§12: "persisted per saved view"), and
   * only it offers the update and delete controls.
   */
  const activeView =
    project.savedViews.find((view) => sameQuery(view.query, currentQuery)) ?? null;

  const layout = activeView?.layout ?? defaultTableLayout();
  const tableColumns = resolveColumns(layout, fields.map((field) => field.id));

  const calendarDays: CalendarDay[] = calendar
    ? headings.map((heading) => {
        const group = listing.groups.find((candidate) => candidate.key === heading.key);
        return {
          date: heading.key,
          total: group?.total ?? 0,
          items: (group?.rows ?? []).map(toItemRowData),
        };
      })
    : [];

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

        <div className="ms-auto flex items-center gap-3">
          <ViewSwitcher
            query={urlQuery}
            pathname={`/${workspaceSlug}/projects/${projectSlug}`}
          />

          {/* §8's `projects/[projectId]/ views · cycles · settings`. Visible to
              anyone who can see the project — reading a sprint's progress is not
              a settings permission, and only the create form on that page is
              gated. */}
          <Link
            href={`/${workspaceSlug}/projects/${projectSlug}/cycles`}
            className="text-sm text-text-muted transition-colors duration-120 hover:text-text"
          >
            {t('cycles.title')}
          </Link>

          {project.canEditSettings && (
            <Link
              href={`/${workspaceSlug}/projects/${projectSlug}/settings`}
              className="text-sm text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('projects.settings')}
            </Link>
          )}
        </div>
      </header>

      {archived && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      {/* §4's saved views, on every view of this project. Above the filter bar
          because a saved view *is* a filter somebody named — picking one
          rewrites the controls below it, which is the right way round. */}
      <SavedViewsBar
        views={project.savedViews.map((view) => ({
          id: view.id,
          name: view.name,
          query: view.query,
        }))}
        currentQuery={currentQuery}
        pathname={pathname}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        projectId={project.id}
        locale={locale}
      />

      {board ? (
        <BoardView
          context={{ workspaceSlug, projectSlug, locale }}
          columns={columns}
          people={listing.people.map((person) => ({
            memberId: person.memberId,
            name: person.name,
          }))}
          labels={listing.labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
          }))}
          today={listing.today}
          projectId={project.id}
          query={toQueryString(query)}
          token={token}
          canCreate={canCreate}
          canEdit={canEdit}
          focusFirstComposer={focusFirstComposer}
        />
      ) : table ? (
        <div className="space-y-4">
          {/* The grouping control is hidden: §12's table is one scrolling table
              with one sticky header, so the view has already made that choice. */}
          <FilterBar
            query={urlQuery}
            states={states}
            people={listing.people.map((person) => ({
              memberId: person.memberId,
              name: person.name,
            }))}
            labels={listing.labels.map((label) => ({ id: label.id, name: label.name }))}
            cycles={project.cycles}
            fields={fields}
            showGroupBy={false}
          />

          <TableView
            context={{ workspaceSlug, projectSlug, locale }}
            initialRows={(listing.groups[0]?.rows ?? []).map(toItemRowData)}
            initialCursor={listing.groups[0]?.nextCursor ?? null}
            initialCustomValues={Object.fromEntries(
              [...(listing.customValues ?? new Map())].map(([itemId, byField]) => [
                itemId,
                Object.fromEntries(byField),
              ]),
            )}
            query={currentQuery}
            columns={tableColumns}
            widths={layout.widths}
            states={states}
            people={listing.people.map((person) => ({
              memberId: person.memberId,
              name: person.name,
            }))}
            labels={listing.labels.map((label) => ({
              id: label.id,
              name: label.name,
              color: label.color,
            }))}
            cycles={project.cycles}
            fields={fields}
            today={listing.today}
            hrefPrefix={pathname}
            canEdit={canEdit}
            savedViewId={activeView?.id ?? null}
          />
        </div>
      ) : calendar ? (
        <div className="space-y-4">
          <FilterBar
            query={urlQuery}
            states={states}
            people={listing.people.map((person) => ({
              memberId: person.memberId,
              name: person.name,
            }))}
            labels={listing.labels.map((label) => ({ id: label.id, name: label.name }))}
            cycles={project.cycles}
            fields={fields}
            showGroupBy={false}
          />

          <CalendarView
            month={month ?? monthOf(listing.today)}
            days={calendarDays}
            // `urlQuery`, not the query that was fetched with: the month links
            // are navigation, and they must not bake this view's imposed
            // grouping and page size into a URL the switcher then inherits.
            query={urlQuery}
            pathname={pathname}
            today={listing.today}
            // §6-1's week start, from the company rather than from a constant
            // (slice 12 hardcoded Monday and said this was slice 15's).
            weekStart={resolved.workspace.weekStart}
            hrefPrefix={pathname}
          />
        </div>
      ) : (
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
          cycles={project.cycles}
          projectId={project.id}
          canCreate={canCreate}
          canEdit={canEdit}
        />
      )}
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
  cycles: readonly { id: string; name: string }[],
  fields: readonly CustomFieldDefinition[],
  t: Awaited<ReturnType<typeof getTranslations>>,
): ListGroupHeading[] {
  /**
   * A custom grouping (§6-4). The headings are the field's own vocabulary — its
   * options, the workspace's members, or yes and no — which is exactly why only
   * those kinds are groupable: §9's page query is handed its groups rather than
   * discovering them, and a text field has no set to hand it.
   *
   * A field that has been deleted, or one whose kind cannot be grouped, yields
   * no headings at all. That renders as an empty list rather than an error,
   * which is the right answer for a link somebody pasted after the field it
   * named was removed.
   */
  const customFieldId = customFieldIdOf(query.groupBy);
  if (customFieldId !== null) {
    const field = fields.find((candidate) => candidate.id === customFieldId);
    if (!field || !isGroupable(field.kind)) return [];

    if (field.kind === 'checkbox') {
      return CHECKBOX_KEYS.map((key) => ({
        key,
        label: key === 'true' ? t('customFields.valueYes') : t('customFields.valueNo'),
      }));
    }

    if (field.kind === 'user') {
      return [
        ...members.map((member) => ({
          key: member.memberId,
          label: member.name.trim() || member.email,
        })),
        { key: NONE, label: t('customFields.groupedNone') },
      ];
    }

    return [
      ...field.options.map((option) => ({ key: option.id, label: option.name })),
      { key: NONE, label: t('customFields.groupedNone') },
    ];
  }

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

    // §7.6. The backlog is last and always present, for the reason unassigned
    // work is: it is a column somebody plans *out of*, and one that disappeared
    // when it emptied would be a column nothing could be dragged back into.
    case 'cycle':
      return [
        ...cycles.map((cycle) => ({ key: cycle.id, label: cycle.name })),
        { key: NONE, label: t('cycles.filter.backlog') },
      ];

    case 'project':
      return query.filters.projectIds.map((id) => ({ key: id, label: t('nav.projects') }));

    case 'none':
      return [{ key: 'all', label: t('workItems.groups.none') }];

    default:
      // `GroupBy` is no longer a closed enum — it carries `custom:{fieldId}`
      // too, handled above. Anything reaching here is a grouping this build
      // does not know, which is one empty list rather than a crash.
      return [];
  }
}
