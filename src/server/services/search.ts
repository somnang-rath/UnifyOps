import 'server-only';

import type { ResolvedActor } from '@/server/auth/context';
import { withActor } from '@/server/db/tenant';
import { can } from '@/server/authz/policy';
import { fetchWorkItemGroups, type WorkItemRow } from '@/server/queries/work-items';
import { findItemByReference, findPeople, type PersonHit } from '@/server/queries/search';
import { listProjectsIn, type ProjectSummary } from '@/server/services/projects';
import { todayIn } from '@/lib/workspace-date';
import {
  PALETTE_SECTION_LIMIT,
  isSearchable,
  normalizeQuery,
  parseItemReference,
} from '@/lib/search';
import { emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';

/**
 * §7.9's search, in one transaction (slice 14).
 *
 * The screen asks four questions — work items, projects, people, and whether the
 * text was an identifier — and the answer to all four arrives from **one**
 * `withActor`. That is the trap slice 8 hit with `getCommentThread`, slice 9 with
 * the unread count, slice 10 with custom-field definitions and slice 13 with
 * §7.4's six lists, and it matters more here than in any of them: this runs on a
 * keystroke, not on a navigation.
 *
 * Projects are answered from the list the caller already loaded rather than by a
 * fifth query, and that is the §16 anchor as well as an optimisation — see
 * `SearchInput.projects`.
 */

/**
 * A search result row.
 *
 * Deliberately **not** a `WorkItemView`. §7.9 asks for "results in sections", and
 * a section is a reference list — identifier, title, where it lives — not the
 * List view rendered four times. Choosing the compact row is what lets the whole
 * screen be one query: assignee avatars and label chips would each need their own
 * hydration pass, on a surface that fires while somebody is typing, to draw
 * decoration nobody is searching for. The row links to the item, which is where
 * all of it already is.
 */
export type SearchItemHit = {
  id: string;
  identifier: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  stateId: string;
  number: number;
  dueDate: string | null;
  blocked: boolean;
  /** True when the item's project is archived — §4 makes it read-only, and the row says so. */
  archived: boolean;
};

/** §7.9's short-circuit, resolved. A destination, not a result. */
export type ReferenceHit = {
  identifier: string;
  title: string;
  projectSlug: string;
  number: number;
  archived: boolean;
};

export type SearchResults = {
  /** The normalized text the sections were actually computed from. */
  text: string;
  /** False when the text is below `MIN_QUERY_LENGTH`; every section is then empty. */
  searched: boolean;
  reference: ReferenceHit | null;
  items: SearchItemHit[];
  /** Every match, not just the page — the section heading shows it (§9's counts query). */
  itemTotal: number;
  projects: ProjectSummary[];
  people: PersonHit[];
  /** Today in the workspace zone, so an overdue badge here agrees with every other screen. */
  today: string;
};

export type SearchInput = {
  text: string;
  /**
   * Every project this actor may see, already resolved — slice 13's
   * `resolveWorkspaceScope`, or `listProjects` directly.
   *
   * **This is the §16 anchor**, and passing it in rather than resolving it here
   * is the reason slice 14 needed no fifth anchor on the §9 query. A text
   * predicate looks like it bounds a scan and does not: below three characters
   * no trigram index can serve a `LIKE '%ab%'`, and a one-letter Latin prefix
   * matches most of a company. An enumerated project set does bound it, the
   * caller has already paid for one, and it is the same anchor My Work and Needs
   * Attention use.
   *
   * It is also what makes the project *section* free of a second visibility
   * rule: `listProjects` expresses §10 as a predicate and re-checks it through
   * the policy module, so filtering that list by name here cannot drift from it.
   *
   * **Optional**, and the two callers differ for a real reason. The results page
   * has already loaded the list — it draws the include-archived toggle from it —
   * so passing it in saves a query. The palette has not, and resolving it here
   * keeps the whole keystroke inside the one transaction below rather than
   * putting a second round trip in front of every character typed.
   */
  projects?: readonly ProjectSummary[];
  /**
   * §7.9: "Items belonging to an archived project are excluded by default, with
   * a one-click *include archived* toggle."
   *
   * The caller supplies projects to match — archived ones included or not — and
   * this flag is passed to the §9 builder, which applies §17-17's default filter.
   * Two places rather than one because they answer different halves: which
   * projects may appear in the Projects section, and which items may appear in
   * the Work items section.
   */
  includeArchived: boolean;
  /** How many rows per section. The palette asks for five; the results page for more. */
  limit?: number;
};

/**
 * The query the Work items section runs.
 *
 * Exported because the results page links "see this in a list" and the filter bar
 * puts the same `q` on a project's List view — one query shape, built once, so a
 * search that finds an item and a list that filters to it cannot disagree.
 *
 * Sorted by `updated` descending rather than by relevance, and that is a real
 * choice rather than a shortcut. `ts_rank` normalises by document length, so a
 * one-word title scores *below* a long description that happens to mention the
 * word twice — which is exactly backwards for a tracker, where the thing you are
 * looking for is usually the thing somebody touched this week. It also cannot
 * rank the trigram route at all, so ranking by it would give the two languages
 * different orderings of the same corpus (§13). Recency is one rule, correct in
 * both scripts, and it is the rule a person searching for work they were just
 * discussing actually wants.
 */
export function searchQuery(input: {
  text: string;
  projectIds: readonly string[];
  includeArchived: boolean;
  limit: number;
}): WorkItemQuery {
  return {
    ...emptyQuery(),
    filters: {
      ...emptyQuery().filters,
      projectIds: [...input.projectIds],
      text: normalizeQuery(input.text),
      includeArchivedProjects: input.includeArchived,
    },
    groupBy: 'none',
    sort: 'updated',
    direction: 'desc',
    limit: input.limit,
  };
}

/** Project names matched the way §7.9's other sections are: substring, folded, both scripts. */
export function matchProjects(
  projects: readonly ProjectSummary[],
  text: string,
  limit: number,
): ProjectSummary[] {
  // The same pattern the database is given, minus its wrapping `%` — so a
  // project section and an item section cannot disagree about what "matches".
  const needle = normalizeQuery(text).toLowerCase();
  if (needle.length === 0) return [];

  return projects
    .filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        // The key too, so `ENG` lists the project as well as short-circuiting to
        // an item when a number follows it.
        project.key.toLowerCase().includes(needle),
    )
    .slice(0, limit);
}

export async function searchWorkspace(
  resolved: ResolvedActor,
  input: SearchInput,
): Promise<SearchResults> {
  const text = normalizeQuery(input.text);
  const today = todayIn(resolved.workspace.timezone);
  const limit = input.limit ?? PALETTE_SECTION_LIMIT;

  const empty: SearchResults = {
    text,
    searched: false,
    reference: null,
    items: [],
    itemTotal: 0,
    projects: [],
    people: [],
    today,
  };

  // The floor is checked here as well as in the browser, because a route handler
  // is a public endpoint and "the palette would not have sent this" is a property
  // of our UI rather than of the network.
  if (!isSearchable(text)) return empty;

  const reference = parseItemReference(text);

  return withActor(resolved.context, async (tx) => {
    const projects =
      input.projects ??
      (await listProjectsIn(tx, resolved, { includeArchived: input.includeArchived }));

    // An actor who can see no project at all searches nothing — and, more to the
    // point, an empty project list would leave the §9 query unanchored and the
    // invariant would refuse it. A Guest invited to one private project and then
    // removed from it is the real case, and it reaches here as an empty section
    // rather than as an error.
    const projectIds = projects
      .filter((project) => input.includeArchived || project.archivedAt === null)
      .map((project) => project.id);

    const byId = new Map(projects.map((project) => [project.id, project]));

    const [referenceHit, groups, people] = await Promise.all([
      // Asked in parallel with the text search rather than instead of it: §7.9
      // short-circuits *to* the item, and the palette still shows the sections
      // underneath, so somebody who typed `ENG-14` on the way to `ENG-142` is not
      // left staring at one wrong row.
      reference === null ? Promise.resolve(null) : findItemByReference(tx, reference.key, reference.number),
      projectIds.length === 0
        ? Promise.resolve([])
        : fetchWorkItemGroups(
            tx,
            searchQuery({ text, projectIds, includeArchived: input.includeArchived, limit }),
            { groupKeys: ['all'], today },
          ),
      findPeople(tx, text, limit),
    ]);

    const group = groups[0];
    const rows: WorkItemRow[] = group?.rows ?? [];

    return {
      text,
      searched: true,
      /**
       * §10 asked about the referenced item's project, exactly as `listWorkItems`
       * asks about every row it returns. RLS has already ruled out another
       * company; this rules out a private project this actor cannot see — which
       * matters more here than anywhere else in the slice, because the
       * identifier lookup deliberately bypasses the archived filter and is
       * reachable by guessing a key and a number.
       */
      reference:
        referenceHit === null ||
        !can(resolved.actor, 'project.view', {
          id: referenceHit.projectId,
          workspaceId: referenceHit.projectWorkspaceId,
          visibility: referenceHit.projectVisibility,
        })
          ? null
          : {
              identifier: `${referenceHit.projectKey}-${referenceHit.number}`,
              title: referenceHit.title,
              projectSlug: referenceHit.projectSlug,
              number: referenceHit.number,
              archived: referenceHit.archived,
            },
      /**
       * No second §10 pass over these rows, and that is the one place this slice
       * leans on its caller rather than re-checking.
       *
       * `listWorkItems` re-checks because its project filter can come from a URL
       * somebody edited. Here the filter is `projectIds`, built from the list
       * `listProjects` returned, which is itself the policy module's answer. A
       * re-check would ask the same module the same question about the same ids
       * in the same request — see `SearchInput.projects` for why that list is the
       * anchor as well.
       */
      items: rows.flatMap((row) => {
        const project = byId.get(row.projectId);
        if (project === undefined) return [];
        return [
          {
            id: row.id,
            identifier: `${project.key}-${row.number}`,
            title: row.title,
            projectId: row.projectId,
            projectSlug: project.slug,
            projectName: project.name,
            stateId: row.stateId,
            number: row.number,
            dueDate: row.dueDate,
            blocked: row.blocked,
            archived: project.archivedAt !== null,
          },
        ];
      }),
      itemTotal: group?.total ?? 0,
      projects: matchProjects(projects, text, limit),
      people,
      today,
    };
  });
}
