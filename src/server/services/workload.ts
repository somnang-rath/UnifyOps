import 'server-only';

import { isAway } from '@/lib/availability';
import {
  ATTENTION_ROWS,
  OPEN_STATE_GROUPS,
  STALE_WORKING_DAYS,
  attentionFilters,
  type AttentionRow,
} from '@/lib/needs-attention';
import { NONE, emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import type { ResolvedActor } from '@/server/auth/context';
import {
  listWorkItemSets,
  type PersonRef,
  type WorkItemGroupView,
  type WorkItemView,
} from './work-items';
import type { LabelRow } from './labels';
import type { Member } from './members';

/**
 * §7.4's manager loop: workload by person, and Needs Attention.
 *
 * "**Manager views are derived, never assembled**" (§2.2). Nobody keeps a list
 * of what is going wrong or of who is overloaded — both are arithmetic over the
 * rows every other screen already reads, through the one §9 builder. This module
 * adds **no query**: it composes filters, calls `listWorkItemSets` once, and
 * counts what a SQL `group by` has already grouped.
 *
 * The one thing it does add is §17-25's correction. "Workload assumed everyone
 * is always available" — §7.4 promises the manager an honest picture and had no
 * way to know somebody was on leave, so the picture was confidently wrong about
 * the one person it mattered most about. Availability is read here, inside the
 * arithmetic, and not only drawn as a badge: a member who is away is **excluded
 * from the capacity figures** and shown with their dates instead.
 */

/* ------------------------------------------------------------------------- */
/* Scope                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * What both surfaces are looking at.
 *
 * A **set of project ids**, and that is the §16 anchor rather than an exception
 * to it. §9's invariant refuses a workspace-wide scan, and neither of these
 * screens is one: a manager is looking at a team's projects, or at the projects
 * they can see, and both are an enumerated list the caller resolved before
 * asking. "Unassigned work" is the case that proves the point — the `none`
 * sentinel anchors nothing, exactly as a cycle's `none` does not (slice 11), so
 * that row alone would be a full scan if the project set were not supplied.
 *
 * An empty set is a real answer and means "nothing in scope". Both functions
 * short-circuit on it rather than emitting `project_id = any('{}')`, which
 * returns nothing anyway but says so after a round trip.
 */
export type WorkScope = {
  projectIds: readonly string[];
  /** Working days without an update before an item is stale. §7.4's N. */
  staleDays?: number;
};

/** The open work in scope, before either surface narrows it further. */
function openWork(scope: WorkScope): WorkItemQuery {
  const base = emptyQuery();
  return {
    ...base,
    groupBy: 'none',
    filters: {
      ...base.filters,
      projectIds: [...scope.projectIds],
      // §4: derive "is it done" from the state **group**, never a name. This is
      // also what excludes cancelled work, which is the reason §4 gives that
      // group its own existence — work somebody decided not to do is not work
      // that needs attention.
      stateGroups: [...OPEN_STATE_GROUPS],
      // A flat list, so a parent and its sub-items do not read as duplicates.
      parentId: null,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Needs Attention (§7.4)                                                    */
/* ------------------------------------------------------------------------- */

/**
 * How many items one Needs Attention row shows before it links to the rest.
 *
 * Below `DEFAULT_LIMIT`, for the reason a calendar cell is: five rows on one
 * screen at fifty each is 250 rows fetched to draw a summary. The count beside
 * each heading is the row's **real** total either way — that comes from the
 * counts query, which is exactly the split §9 built two queries for.
 */
const ATTENTION_PAGE = 10;

export type AttentionSection = {
  row: AttentionRow;
  /** Every matching item in scope, not just the page. This is the number the heading shows. */
  total: number;
  items: WorkItemView[];
};

export type NeedsAttention = {
  sections: AttentionSection[];
  people: PersonRef[];
  labels: LabelRow[];
  today: string;
  /** The threshold the stale row actually used, so its heading can name it. */
  staleDays: number;
};

/**
 * The five rows, each a narrowing of the same open-work query.
 *
 * **Rows overlap on purpose.** An item can be overdue *and* blocked *and*
 * unassigned, and it appears under all three. The alternative is a precedence
 * order deciding which single reason a manager is shown, and every ordering is
 * wrong for somebody: the person clearing blockers wants it under blocked, the
 * person chasing dates wants it under overdue. §7.4 lists five rows, not one
 * classified list.
 */
export async function getNeedsAttention(
  resolved: ResolvedActor,
  scope: WorkScope,
): Promise<NeedsAttention> {
  const staleDays = scope.staleDays ?? STALE_WORKING_DAYS;

  if (scope.projectIds.length === 0) {
    return {
      sections: ATTENTION_ROWS.map((row) => ({ row, total: 0, items: [] })),
      people: [],
      labels: [],
      today: '',
      staleDays,
    };
  }

  const base = openWork(scope);

  const listing = await listWorkItemSets(
    resolved,
    ATTENTION_ROWS.map((row) => ({
      key: row,
      groupKeys: ['all'],
      query: {
        ...base,
        // Most recently touched first. `rank` — the default — is a board's
        // ordering within one project and means nothing across several, and a
        // manager scanning for what broke today should not page to find it.
        sort: 'updated' as const,
        direction: 'desc' as const,
        limit: ATTENTION_PAGE,
        filters: { ...base.filters, ...attentionFilters(row, staleDays) },
      },
    })),
  );

  return {
    sections: ATTENTION_ROWS.map((row) => {
      const group = listing.sets.find((set) => set.key === row)?.groups[0];
      return { row, total: group?.total ?? 0, items: group?.rows ?? [] };
    }),
    people: listing.people,
    labels: listing.labels,
    today: listing.today,
    staleDays,
  };
}

/* ------------------------------------------------------------------------- */
/* Workload (§7.4, §17-25)                                                   */
/* ------------------------------------------------------------------------- */

/**
 * How many cards one person's column holds before it links to the rest.
 *
 * §7.4's `[!]` note — "30-person team → columns virtualize and scroll
 * horizontally" — is about the columns. Within one, twenty is more than anybody
 * reads at a glance, and thirty columns of fifty is a page nobody's phone draws
 * (§2.5).
 */
const WORKLOAD_PAGE = 20;

export type WorkloadColumn = {
  /** A member id, or `none` for the unassigned column — which is always drawn. */
  key: string;
  member: (Member & { away: boolean }) | null;
  /** Open items assigned to them, in scope. */
  open: number;
  overdue: number;
  items: WorkItemView[];
  nextCursor: string | null;
};

export type Workload = {
  columns: WorkloadColumn[];
  people: PersonRef[];
  labels: LabelRow[];
  today: string;
  /**
   * §7.4's "who has capacity" arithmetic, with §17-25's correction applied.
   *
   * `available` counts only the members who are here today, and `open` is their
   * work. Somebody on leave contributes to **neither**: they are not idle
   * capacity, and their queue is not work anybody can pick up this week.
   */
  capacity: { available: number; away: number; open: number; averageOpen: number };
};

/**
 * Workload by assignee (§7.4), availability-aware (§17-25).
 *
 * Two questions of the builder in one transaction: the open work grouped by
 * person — which yields both the per-person totals and the cards — and the
 * overdue subset counted the same way. The second is `countsOnly`, because the
 * column header needs that number and draws none of those rows.
 *
 * `members` is passed in rather than fetched, because every caller has listed
 * them already: the page needs them for the team switcher, and it needs them for
 * the columns of people with **nothing** assigned — which are the columns that
 * matter most here. An empty column is either somebody free or somebody on
 * leave, and telling those two apart is the entire point of §17-25.
 */
export async function getWorkload(
  resolved: ResolvedActor,
  scope: WorkScope,
  members: readonly Member[],
): Promise<Workload> {
  const base = openWork(scope);

  /**
   * Every column to draw, supplied rather than discovered — §9's rule, and the
   * place it earns the most. A grouping that discovered its keys from the rows
   * would draw everybody except the people with nothing assigned.
   */
  const groupKeys = [...members.map((member) => member.memberId), NONE];

  const grouped: WorkItemQuery = { ...base, groupBy: 'assignee', limit: WORKLOAD_PAGE };

  const listing =
    scope.projectIds.length === 0
      ? null
      : await listWorkItemSets(resolved, [
          { key: 'open', groupKeys, query: grouped },
          {
            key: 'overdue',
            groupKeys,
            countsOnly: true,
            query: { ...grouped, filters: { ...grouped.filters, due: 'overdue' } },
          },
        ]);

  const today = listing?.today ?? '';
  const open = byKey(listing?.sets.find((set) => set.key === 'open')?.groups);
  const overdue = byKey(listing?.sets.find((set) => set.key === 'overdue')?.groups);

  const columns: WorkloadColumn[] = groupKeys.map((key) => {
    const member = members.find((candidate) => candidate.memberId === key) ?? null;
    const group = open.get(key);

    return {
      key,
      member: member ? { ...member, away: isAway(member, today) } : null,
      open: group?.total ?? 0,
      overdue: overdue.get(key)?.total ?? 0,
      items: group?.rows ?? [],
      nextCursor: group?.nextCursor ?? null,
    };
  });

  /**
   * §17-25, as arithmetic rather than as a badge.
   *
   * The unassigned column is on neither side: it is not a person, so it is
   * neither capacity nor anybody's load. It is a Needs Attention row instead,
   * which is where work nobody owns belongs.
   *
   * `averageOpen` divides by the people who are actually here. Dividing by
   * everybody is the confidently-wrong number §17-25 names — a team of five with
   * two away reads as comfortable at exactly the moment the three left are
   * drowning.
   */
  const staffed = columns.filter((column) => column.member !== null);
  const here = staffed.filter((column) => !column.member?.away);
  const load = here.reduce((total, column) => total + column.open, 0);

  return {
    columns,
    people: listing?.people ?? [],
    labels: listing?.labels ?? [],
    today,
    capacity: {
      available: here.length,
      away: staffed.length - here.length,
      open: load,
      averageOpen: here.length === 0 ? 0 : Math.round((load / here.length) * 10) / 10,
    },
  };
}

function byKey(groups: readonly WorkItemGroupView[] | undefined): Map<string, WorkItemGroupView> {
  return new Map((groups ?? []).map((group) => [group.key, group]));
}
