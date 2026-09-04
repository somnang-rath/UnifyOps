import { getTranslations } from 'next-intl/server';
import { StatePill } from '@/components/ui/state-pill';
import { FilterBar, type FilterField } from '@/components/work-item/filter-bar';
import { GroupList } from '@/components/work-item/group-list';
import { InlineCreate } from '@/components/work-item/inline-create';
import type { ItemActionContext, StateOption } from '@/components/work-item/state-select';
import { toItemRowData, type RowLabel, type RowPerson } from '@/lib/work-item-row';
import { toQueryString, type WorkItemQuery } from '@/lib/work-item-query';
import type { WorkItemListing } from '@/server/services/work-items';

/**
 * §14 slice 5's List view: "Create, edit, filter, group, paginate."
 *
 * §11 asks every view to specify all five states, so here they are, in one
 * place, because a view that ships with only the happy path is not done:
 *
 *   `[L]` The page is server-rendered, so the list has no client loading state.
 *         The one asynchronous thing on the screen is a group extending itself,
 *         and that button carries its own pending label rather than replacing
 *         rows with skeletons — the rows above it are still correct.
 *   `[E]` A group with nothing in it keeps its header and its input. §7.1 is
 *         explicit: "the focused input **is** the empty state". An empty
 *         *project* gets the same treatment for the same reason — a "no items"
 *         panel with a button that reveals an input is two clicks where §7.2
 *         allows five seconds.
 *   `[S]` Optimistic. The state select moves before the server answers, and
 *         there is no toast, because the result is on screen (§11).
 *   `[X]` Errors land in the row or the group that produced them, in plain
 *         language, as a translated key (§13) — never a raw code, never a
 *         sentence from the server.
 *   `[!]` Long titles clamp to two lines by grapheme; 50 assignees cap at 3 +N;
 *         a Khmer title with no spaces breaks anywhere and still leaves one
 *         row; an archived project renders read-only rather than hiding its
 *         controls; a group with 50k items pages by keyset and never counts
 *         past what it shows.
 *
 * Grouping is the §9 query's, not this component's: the groups arrive already
 * ordered and already counted, and the header count is the group's **total**
 * rather than the number of rows on screen. A column header that says 12
 * because the page held 12 is a small dishonesty people stop trusting.
 */

export type ListGroupHeading = {
  key: string;
  /** Already translated where it needs to be — a seeded state resolves through `displayName`. */
  label: string;
  /** Present when the grouping is by state, so the header can carry the state's colour. */
  state?: StateOption;
};

export async function ListView({
  context,
  query,
  listing,
  headings,
  states,
  fields,
  cycles = [],
  projectId,
  canCreate,
  canEdit,
}: {
  context: ItemActionContext;
  query: WorkItemQuery;
  listing: WorkItemListing;
  /** Every group to draw, in display order — including the empty ones. */
  headings: readonly ListGroupHeading[];
  /** The project's states, for each row's state select. */
  states: readonly StateOption[];
  /** The project's custom fields (§6-4) — one filter control each, and the group-by entries. */
  fields: readonly FilterField[];
  /** The project's cycles (§7.6). Empty on a surface that has not loaded them. */
  cycles?: readonly { id: string; name: string }[];
  projectId: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const t = await getTranslations();

  const people: RowPerson[] = listing.people.map((person) => ({
    memberId: person.memberId,
    name: person.name,
  }));
  const labels: RowLabel[] = listing.labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
  }));

  const byKey = new Map(listing.groups.map((group) => [group.key, group]));
  const queryString = toQueryString(query);

  return (
    <div className="space-y-4">
      <FilterBar
        query={query}
        states={states}
        people={people}
        labels={labels.map((label) => ({ id: label.id, name: label.name }))}
        cycles={cycles}
        fields={fields}
      />

      <div className="space-y-3">
        {headings.map((heading) => {
          const group = byKey.get(heading.key);
          const rows = (group?.rows ?? []).map(toItemRowData);

          return (
            <section
              key={heading.key}
              aria-label={heading.label}
              className="overflow-hidden rounded-md border border-border bg-surface"
            >
              <header className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                {heading.state ? (
                  <StatePill
                    name={heading.state.name}
                    color={heading.state.color}
                    count={group?.total ?? 0}
                  />
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm text-text">
                    <span className="truncate">{heading.label}</span>
                    <span className="text-2xs font-medium tabular-nums text-text-subtle">
                      {group?.total ?? 0}
                    </span>
                  </span>
                )}
              </header>

              <GroupList
                context={context}
                groupKey={heading.key}
                initialRows={rows}
                initialCursor={group?.nextCursor ?? null}
                query={queryString}
                states={states}
                people={people}
                labels={labels}
                today={listing.today}
                canEdit={canEdit}
                hrefPrefix={`/${context.workspaceSlug}/projects/${context.projectSlug}`}
              />

              {/* The input is the empty state, and it is also the create
                  affordance when the group is full — one control, always in the
                  same place (§7.1, §7.2). Only where grouping is by state: any
                  other grouping cannot answer "which column did I type into",
                  and §5's smart default would become a guess. */}
              {canCreate && heading.state && (
                <InlineCreate
                  workspaceSlug={context.workspaceSlug}
                  projectSlug={context.projectSlug}
                  projectId={projectId}
                  stateId={heading.state.id}
                  locale={context.locale}
                />
              )}

              {!canCreate && (group?.total ?? 0) === 0 && (
                <p className="px-3 py-3 text-xs text-text-subtle">{t('workItems.groupEmpty')}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
