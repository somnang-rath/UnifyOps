import { getTranslations } from 'next-intl/server';
import { ItemRow } from '@/components/work-item/item-row';
import type { StateOption } from '@/components/work-item/state-select';
import { toItemRowData, type RowLabel, type RowPerson } from '@/lib/work-item-row';

/**
 * A list of work items **from more than one project** (§7.3, §7.4, slice 13).
 *
 * Every listing surface before this one belonged to a single project, so one
 * `context` and one set of workflow states served every row. My Work, Needs
 * Attention and Workload are the first that do not: each row comes from
 * whichever project it lives in, and §7.3's whole promise — "click a state pill
 * to advance an item, one click, optimistic" — needs *that project's* states in
 * *that project's* URL.
 *
 * So the context is resolved per row from a project map, and `ItemRow` is used
 * unchanged. That is the point: a second row component for cross-project lists
 * would be the third drawing of §12's item card, and the three would drift.
 *
 * **The map is also the permission check.** A project the caller did not put in
 * it renders nothing — not a row with a broken link. `listWorkItemSets` has
 * already run §10's second pass over these rows, so an absent project means the
 * caller narrowed the map further (an archived project, say), and dropping the
 * row is the honest response to that.
 */

export type RowProject = {
  id: string;
  slug: string;
  /** The project's workflow states, for this row's state select. */
  states: readonly StateOption[];
  /** §4: an archived project is read-only, so its rows render without controls. */
  canEdit: boolean;
};

export async function CrossProjectRows({
  workspaceSlug,
  locale,
  projects,
  items,
  people,
  labels,
  today,
  emptyMessage,
}: {
  workspaceSlug: string;
  locale: string;
  /** Every project the rows may come from, by id. */
  projects: ReadonlyMap<string, RowProject>;
  items: readonly (Parameters<typeof toItemRowData>[0] & { projectId: string })[];
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  /** What to say when there is nothing. Never a bare "no results" (§11). */
  emptyMessage?: string;
}) {
  const t = await getTranslations();

  const rows = items.flatMap((item) => {
    const project = projects.get(item.projectId);
    return project ? [{ data: toItemRowData(item), project }] : [];
  });

  if (rows.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-text-subtle">
        {emptyMessage ?? t('workItems.groupEmpty')}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map(({ data, project }) => (
        <ItemRow
          key={data.id}
          context={{ workspaceSlug, projectSlug: project.slug, locale }}
          item={data}
          states={project.states}
          people={people}
          labels={labels}
          today={today}
          href={`/${workspaceSlug}/projects/${project.slug}/${data.number}`}
          canEdit={project.canEdit}
        />
      ))}
    </ul>
  );
}

/**
 * "Showing 10 of 34", or nothing when there is nothing more.
 *
 * Every surface in this slice caps its list and shows the group's **real**
 * total beside the heading — that number comes from §9's counts query, not from
 * the page, which is exactly the split that makes it honest. This is the line
 * that admits the two are different.
 *
 * There is deliberately **no "load more"**. Keyset paging goes through
 * `/api/internal/list`, which returns rows for one project's `context` and one
 * project's states; a cross-project page-two would need `GroupList` to carry the
 * project map above, which is a change to its contract that none of §7.3 or
 * §7.4 asks for. A person with more than fifty items in one My Work bucket has a
 * problem that a second page does not solve, and a manager with more than ten
 * overdue items in a team is being told the truth by the count.
 */
export async function MoreItemsNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  const t = await getTranslations();

  return (
    <p className="border-t border-border px-3 py-2 text-2xs text-text-subtle">
      {t('dashboards.showingOf', { shown, total })}
    </p>
  );
}
