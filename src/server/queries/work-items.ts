import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { PRIORITIES, type Priority } from '@/lib/priorities';
import {
  NONE,
  anchorOf,
  cursorFor,
  decodeCursor,
  encodeCursor,
  type GroupBy,
  type SortField,
  type WorkItemQuery,
} from '@/lib/work-item-query';

/**
 * The one list-query builder (§9).
 *
 * "One Zod filter DSL, one builder, two queries — a counts query and a
 * `LATERAL` per-group page query, because a board needs a page *per column*,
 * not one page overall."
 *
 * That sentence is the whole design, and each half of it is load-bearing:
 *
 *   * **Two queries, not one.** A single query with a window function would
 *     have to rank every matching row before discarding all but fifty per
 *     group. Counting is cheap and can use an index-only scan; paging is
 *     expensive and is done once per group with its own `LIMIT`, so the work is
 *     proportional to what is shown rather than to what exists.
 *
 *   * **Keyset cursors only.** Offset degrades exactly when a workspace becomes
 *     valuable, and it silently skips or repeats rows when someone inserts
 *     while you read — which on a board is indistinguishable from a bug (§9).
 *
 *   * **Column identifiers come only from the frozen maps below.** Nothing from
 *     a URL becomes an identifier; values are bound as parameters and the DSL
 *     has already checked every one of them against a uuid or a frozen enum.
 *
 *   * **`assertAnchored` refuses an unscoped workspace-wide scan** — §16 calls
 *     it "the query that otherwise takes production down at 3am". It is an
 *     invariant rather than a lint because the caller that gets it wrong is the
 *     one written in a hurry, months from now.
 */

export class UnanchoredQueryError extends Error {
  constructor() {
    super(
      'A work-item query must be anchored to a project, a set of assignees, or a parent item. ' +
        'An unanchored workspace-wide scan is refused by construction (§9, §16).',
    );
    this.name = 'UnanchoredQueryError';
  }
}

/** The §16 invariant. Called before any SQL is emitted, by every entry point here. */
export function assertAnchored(query: WorkItemQuery): void {
  if (anchorOf(query) === null) throw new UnanchoredQueryError();
}

/**
 * One row, as the database holds it.
 *
 * Deliberately flat and un-joined. State names, project keys, assignee avatars
 * and label chips are hydrated by the service from ids collected across the
 * whole page — a join here would multiply the rows the `LIMIT` is meant to
 * bound, which is the same fan-out the denormalized arrays exist to avoid.
 */
export type WorkItemRow = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  stateId: string;
  priority: Priority;
  parentId: string | null;
  depth: number;
  rank: string;
  startDate: string | null;
  dueDate: string | null;
  estimate: number | null;
  blocked: boolean;
  blockedReason: string | null;
  completedAt: Date | null;
  assigneeIds: string[];
  labelIds: string[];
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkItemGroupPage = {
  /** A uuid, a priority, or the `none` sentinel — whatever `groupBy` keys on. */
  key: string;
  /** Every matching row in this group, not just the page. Column headers show it. */
  total: number;
  rows: WorkItemRow[];
  /** Opaque; pass it back to fetch the next page of this group. Null at the end. */
  nextCursor: string | null;
};

/**
 * The columns the page query selects, once.
 *
 * A frozen list rather than `select *`: a column added in a later slice should
 * appear here on purpose, and the row type above should change with it.
 */
const COLUMNS = sql`
  wi.id, wi.project_id, wi.number, wi.title, wi.state_id, wi.priority,
  wi.parent_id, wi.depth, wi.rank, wi.start_date, wi.due_date, wi.estimate,
  wi.blocked, wi.blocked_reason, wi.completed_at,
  wi.assignee_ids, wi.label_ids, wi.created_by_member_id,
  wi.created_at, wi.updated_at
`;

type RawRow = {
  group_key: string;
  id: string;
  project_id: string;
  number: number;
  title: string;
  state_id: string;
  priority: Priority;
  parent_id: string | null;
  depth: number;
  rank: string;
  start_date: string | null;
  due_date: string | null;
  estimate: number | null;
  blocked: boolean;
  blocked_reason: string | null;
  completed_at: Date | null;
  assignee_ids: string[] | null;
  label_ids: string[] | null;
  created_by_member_id: string;
  created_at: Date;
  updated_at: Date;
};

function toRow(raw: RawRow): WorkItemRow {
  return {
    id: raw.id,
    projectId: raw.project_id,
    number: raw.number,
    title: raw.title,
    stateId: raw.state_id,
    priority: raw.priority,
    parentId: raw.parent_id,
    depth: raw.depth,
    rank: raw.rank,
    startDate: raw.start_date,
    dueDate: raw.due_date,
    estimate: raw.estimate,
    blocked: raw.blocked,
    blockedReason: raw.blocked_reason,
    completedAt: raw.completed_at,
    assigneeIds: raw.assignee_ids ?? [],
    labelIds: raw.label_ids ?? [],
    createdByMemberId: raw.created_by_member_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * §12's priority order, as SQL.
 *
 * Built from the constant rather than written out, so adding a priority cannot
 * leave the database sorting it alphabetically between "high" and "low" while
 * every screen shows it somewhere else.
 */
const PRIORITY_WEIGHT: SQL = (() => {
  const arms = PRIORITIES.map((value, index) => sql`when ${value} then ${index}`);
  return sql`(case wi.priority ${sql.join(arms, sql` `)} end)`;
})();

/** The frozen sort map. Nothing outside it can become an ORDER BY (§9). */
const SORTS: Record<SortField, { expr: SQL; cast: SQL }> = {
  rank: { expr: sql`wi.rank`, cast: sql`text` },
  created: { expr: sql`wi.created_at`, cast: sql`timestamptz` },
  updated: { expr: sql`wi.updated_at`, cast: sql`timestamptz` },
  // Coalesced rather than sorted `NULLS LAST`, because a keyset cursor is a row
  // comparison and any NULL inside one makes the whole comparison unknown —
  // which silently returns an empty second page. `infinity` is a real date, so
  // an item with no due date has a position a cursor can point past.
  due: { expr: sql`coalesce(wi.due_date, 'infinity'::date)`, cast: sql`date` },
  priority: { expr: PRIORITY_WEIGHT, cast: sql`int` },
  number: { expr: sql`wi.number`, cast: sql`int` },
};

/** What a null sort value means in the cursor, per sort. Only `due` has one. */
function cursorValueSql(sort: SortField, value: string | null): SQL {
  if (value !== null) return sql`${value}`;
  return sort === 'due' ? sql`'infinity'` : sql`null`;
}

/** The frozen group map: what a group key compares against. */
function groupPredicate(groupBy: GroupBy, key: SQL): SQL {
  switch (groupBy) {
    case 'state':
      return sql`wi.state_id = ${key}::uuid`;
    case 'priority':
      return sql`wi.priority = ${key}::priority`;
    case 'project':
      return sql`wi.project_id = ${key}::uuid`;
    case 'assignee':
      return sql`${key}::uuid = any(wi.assignee_ids)`;
    case 'label':
      return sql`${key}::uuid = any(wi.label_ids)`;
    case 'none':
      return sql`true`;
  }
}

/** The `none` bucket — items with no assignee or no label. One of §7.4's rows. */
function emptyBucketPredicate(groupBy: GroupBy): SQL | null {
  if (groupBy === 'assignee') return sql`cardinality(wi.assignee_ids) = 0`;
  if (groupBy === 'label') return sql`cardinality(wi.label_ids) = 0`;
  return null;
}

/** The counts query's group expression, mirroring `groupPredicate`. */
function groupExpression(groupBy: GroupBy): SQL {
  switch (groupBy) {
    case 'state':
      return sql`wi.state_id::text`;
    case 'priority':
      return sql`wi.priority::text`;
    case 'project':
      return sql`wi.project_id::text`;
    case 'assignee':
      return sql`coalesce(unnested.key::text, ${NONE})`;
    case 'label':
      return sql`coalesce(unnested.key::text, ${NONE})`;
    case 'none':
      return sql`'all'`;
  }
}

/**
 * An item can carry several assignees, so grouping by assignee has to fan the
 * array out — and a `left join` rather than a plain `unnest`, so an unassigned
 * item still produces one row and lands in the `none` bucket instead of
 * vanishing from a count it belongs in.
 */
function groupFanout(groupBy: GroupBy): SQL {
  if (groupBy === 'assignee')
    return sql` left join lateral unnest(wi.assignee_ids) as unnested(key) on true`;
  if (groupBy === 'label')
    return sql` left join lateral unnest(wi.label_ids) as unnested(key) on true`;
  return sql``;
}

/**
 * Everything the filters say, as one predicate.
 *
 * `today` is a calendar date in the **workspace** timezone, resolved by the
 * caller (§4, §17-13). It is passed in rather than read from `now()` here
 * precisely so this module cannot accidentally answer "is it overdue" in the
 * server's zone — which is nobody's.
 */
function wherePredicate(query: WorkItemQuery, today: string, horizon: string = today): SQL {
  // Every array below is bound through `sql.param`, and that is load-bearing
  // rather than stylistic: interpolating a JS array into a `sql` template
  // spreads it into one placeholder *per element*, so `any(($3)::uuid[])` would
  // receive a bare uuid and Postgres would refuse it as a malformed array
  // literal. `sql.param` binds the whole array as one value.
  const { filters } = query;
  const parts: SQL[] = [sql`wi.deleted_at is null`];

  if (filters.projectIds.length > 0) {
    parts.push(sql`wi.project_id = any(${sql.param(filters.projectIds)}::uuid[])`);
  }
  if (filters.stateIds.length > 0) {
    parts.push(sql`wi.state_id = any(${sql.param(filters.stateIds)}::uuid[])`);
  }
  if (filters.stateGroups.length > 0) {
    parts.push(sql`
      wi.state_id in (
        select ws.id from workflow_state ws where ws."group" = any(${sql.param(filters.stateGroups)}::state_group[])
      )
    `);
  }
  if (filters.priorities.length > 0) {
    parts.push(sql`wi.priority = any(${sql.param(filters.priorities)}::priority[])`);
  }
  if (filters.blocked !== undefined) {
    parts.push(sql`wi.blocked = ${filters.blocked}`);
  }

  // `none` and real ids are an OR, not two filters: "unassigned or assigned to
  // Sophea" is a question a manager actually asks, and splitting it would
  // return nothing.
  const assigneeIds = filters.assignees.filter((value) => value !== NONE);
  const wantsUnassigned = filters.assignees.includes(NONE);
  if (filters.assignees.length > 0) {
    const branches: SQL[] = [];
    if (assigneeIds.length > 0) branches.push(sql`wi.assignee_ids && ${sql.param(assigneeIds)}::uuid[]`);
    if (wantsUnassigned) branches.push(sql`cardinality(wi.assignee_ids) = 0`);
    parts.push(sql`(${sql.join(branches, sql` or `)})`);
  }

  const labelIds = filters.labels.filter((value) => value !== NONE);
  const wantsUnlabelled = filters.labels.includes(NONE);
  if (filters.labels.length > 0) {
    const branches: SQL[] = [];
    if (labelIds.length > 0) branches.push(sql`wi.label_ids && ${sql.param(labelIds)}::uuid[]`);
    if (wantsUnlabelled) branches.push(sql`cardinality(wi.label_ids) = 0`);
    parts.push(sql`(${sql.join(branches, sql` or `)})`);
  }

  if (filters.parentId === null) parts.push(sql`wi.parent_id is null`);
  else if (filters.parentId !== undefined) parts.push(sql`wi.parent_id = ${filters.parentId}::uuid`);

  switch (filters.due) {
    case 'overdue':
      // Open work only. An item finished late is history, not a thing to chase,
      // and leaving it here is how Needs Attention fills with noise (§7.4).
      parts.push(sql`wi.due_date < ${today}::date and wi.completed_at is null`);
      break;
    case 'today':
      parts.push(sql`wi.due_date = ${today}::date`);
      break;
    case 'week':
      parts.push(sql`wi.due_date >= ${today}::date and wi.due_date < ${today}::date + 7`);
      break;
    case 'soon':
      // Overdue *and* upcoming in one predicate, because §7.8's digest is one
      // list — "what is due tomorrow, and what is already overdue" — and two
      // queries stitched together would need the ordering reconciled by hand.
      // Open work only, for the reason `overdue` gives: an item finished late
      // is history, not something to chase.
      parts.push(sql`wi.due_date <= ${horizon}::date and wi.completed_at is null`);
      break;
    case 'none':
      parts.push(sql`wi.due_date is null`);
      break;
    case 'any':
      break;
  }

  // §9: archived is a default filter here rather than a view that hides rows,
  // because four legitimate screens have to see archived projects (§17-17).
  if (!filters.includeArchivedProjects) {
    parts.push(sql`
      exists (select 1 from project p where p.id = wi.project_id and p.archived_at is null)
    `);
  }

  return sql.join(parts, sql` and `);
}

export type FetchOptions = {
  /**
   * Every group to draw, in display order — including ones with no items, which
   * is why they are supplied rather than discovered. A board column that
   * disappears when it empties is a board that cannot be dragged into.
   */
  groupKeys: readonly string[];
  /** Per-group opaque cursors from a previous page. */
  cursors?: Readonly<Record<string, string | null | undefined>>;
  /** Today, as `YYYY-MM-DD`, in the workspace timezone. */
  today: string;
  /**
   * The far edge of the `soon` due window, as `YYYY-MM-DD`. Defaults to `today`,
   * which makes `soon` mean exactly `overdue` — the safe reading for a caller
   * that has not thought about a horizon.
   */
  horizon?: string;
};

/**
 * The counts query: every group's total, keyed by group.
 *
 * Separate from the page for the reason at the top of this file — and because a
 * column header showing "50+" because the page was capped is the kind of small
 * dishonesty that makes people stop trusting the numbers.
 */
export async function countWorkItemsByGroup(
  tx: TenantDb,
  query: WorkItemQuery,
  options: Pick<FetchOptions, 'today' | 'horizon'>,
): Promise<Map<string, number>> {
  assertAnchored(query);

  const result = await tx.execute<{ group_key: string; total: number }>(sql`
    select ${groupExpression(query.groupBy)} as group_key, count(*)::int as total
    from work_item wi${groupFanout(query.groupBy)}
    where ${wherePredicate(query, options.today, options.horizon)}
    group by 1
  `);

  return new Map(result.rows.map((row) => [row.group_key, row.total]));
}

/**
 * The board's change token (§8, §17-2, §17-24).
 *
 * `max(updated_at)` plus a row count, for the filter the board is showing. Two
 * numbers rather than one because neither alone is enough: a deletion moves the
 * count without moving the maximum, and an edit moves the maximum without
 * moving the count.
 *
 * One aggregate over the same predicate the board itself uses, so it rides the
 * same indexes — this runs every 20 seconds per open board and is the reason
 * §17-24 fixed an interval at all. It is deliberately *not* per group: the board
 * refetches as a whole, and a per-column token would be six aggregates to save
 * a refetch nobody notices.
 */
export async function fetchChangeToken(
  tx: TenantDb,
  query: WorkItemQuery,
  options: Pick<FetchOptions, 'today' | 'horizon'>,
): Promise<string> {
  assertAnchored(query);

  const result = await tx.execute<{ token: string }>(sql`
    select
      coalesce(extract(epoch from max(wi.updated_at))::text, '0')
        || ':' || count(*)::text as token
    from work_item wi
    where ${wherePredicate(query, options.today, options.horizon)}
  `);

  return result.rows[0]?.token ?? '0:0';
}

/**
 * The page query: one page per group, in one round trip.
 *
 * `LATERAL` over a VALUES list of the groups, so each group gets its own
 * `ORDER BY … LIMIT` against the `(project_id, state_id, rank)` index rather
 * than one ordering shared across all of them. The cursor travels *in* the
 * VALUES list, because each group is at a different position.
 */
export async function fetchWorkItemPages(
  tx: TenantDb,
  query: WorkItemQuery,
  options: FetchOptions,
): Promise<WorkItemGroupPage[]> {
  assertAnchored(query);

  const { groupKeys, cursors = {}, today, horizon } = options;
  if (groupKeys.length === 0) return [];

  const sort = SORTS[query.sort];
  const direction = query.direction === 'desc' ? sql`desc` : sql`asc`;
  // The id tiebreak follows the primary direction so the pair is a total order
  // in the same direction the row comparison below assumes.
  const comparison = query.direction === 'desc' ? sql`<` : sql`>`;

  const decoded = new Map(
    groupKeys.map((key) => [key, decodeCursor(cursors[key] ?? null, query.sort)] as const),
  );
  const anyCursor = [...decoded.values()].some((cursor) => cursor !== null);

  // Skipped entirely on a first page, which is the common one — an OR over a
  // null cursor would otherwise sit in front of the index scan for nothing.
  const keyset = anyCursor
    ? sql` and (g.cursor_id is null or (${sort.expr}, wi.id) ${comparison} (g.cursor_value::${sort.cast}, g.cursor_id::uuid))`
    : sql``;

  // One more than asked for: the extra row is how the page knows there is a
  // next one without a second count.
  const pageSize = query.limit + 1;

  const buckets: SQL[] = [];

  // The `none` bucket cannot ride the VALUES list — its predicate is "the array
  // is empty" rather than "the key is in the array" — so it is split out and
  // gets its own branch below.
  const empty = emptyBucketPredicate(query.groupBy);
  const lateralKeys = empty ? groupKeys.filter((key) => key !== NONE) : [...groupKeys];

  if (lateralKeys.length > 0) {
    const values = lateralKeys.map((key) => {
      const cursor = decoded.get(key) ?? null;
      return sql`(${key}, ${cursor ? cursorValueSql(query.sort, cursor.value) : sql`null`}, ${
        cursor ? sql`${cursor.id}` : sql`null`
      })`;
    });

    buckets.push(sql`(
      select g.key as group_key, page.*
      from (values ${sql.join(values, sql`, `)}) as g(key, cursor_value, cursor_id)
      cross join lateral (
        select ${COLUMNS}
        from work_item wi
        where ${wherePredicate(query, today, horizon)}
          and ${groupPredicate(query.groupBy, sql`g.key`)}${keyset}
        order by ${sort.expr} ${direction}, wi.id ${direction}
        limit ${pageSize}
      ) page
    )`);
  }

  if (empty && groupKeys.includes(NONE)) {
    const cursor = decoded.get(NONE) ?? null;
    const noneKeyset = cursor
      ? sql` and (${sort.expr}, wi.id) ${comparison} (${cursorValueSql(
          query.sort,
          cursor.value,
        )}::${sort.cast}, ${cursor.id}::uuid)`
      : sql``;

    buckets.push(sql`(
      select ${NONE} as group_key, ${COLUMNS}
      from work_item wi
      where ${wherePredicate(query, today, horizon)} and ${empty}${noneKeyset}
      order by ${sort.expr} ${direction}, wi.id ${direction}
      limit ${pageSize}
    )`);
  }

  if (buckets.length === 0) return [];

  const result = await tx.execute<RawRow>(sql.join(buckets, sql` union all `));

  const byGroup = new Map<string, RawRow[]>();
  for (const key of groupKeys) byGroup.set(key, []);
  for (const raw of result.rows) {
    byGroup.get(raw.group_key)?.push(raw);
  }

  return groupKeys.map((key) => {
    const collected = byGroup.get(key) ?? [];
    const hasMore = collected.length > query.limit;
    const rows = (hasMore ? collected.slice(0, query.limit) : collected).map(toRow);
    const last = rows.at(-1);

    return {
      key,
      total: 0,
      rows,
      nextCursor: hasMore && last ? encodeCursor(cursorFor(last, query.sort)) : null,
    };
  });
}

/**
 * Both queries, joined up: the shape every listing surface actually wants.
 *
 * Two round trips rather than one, deliberately — see the note at the top. They
 * are independent, so they go out together.
 */
export async function fetchWorkItemGroups(
  tx: TenantDb,
  query: WorkItemQuery,
  options: FetchOptions,
): Promise<WorkItemGroupPage[]> {
  const [pages, totals] = await Promise.all([
    fetchWorkItemPages(tx, query, options),
    countWorkItemsByGroup(tx, query, { today: options.today, horizon: options.horizon }),
  ]);

  return pages.map((page) => ({ ...page, total: totals.get(page.key) ?? 0 }));
}
