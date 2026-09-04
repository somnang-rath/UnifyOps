import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { customFieldIdOf, type CustomFieldKind } from '@/lib/custom-fields';
import { PRIORITIES, type Priority } from '@/lib/priorities';
import { searchRoute, toLikePattern, toTsQuery } from '@/lib/search';
import {
  NONE,
  anchorOf,
  cursorFor,
  decodeCursor,
  encodeCursor,
  monthRange,
  type CustomFilter,
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
      'A work-item query must be anchored to a project, a set of assignees, a parent item, or a cycle. ' +
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
  /** §7.6: the cycle this item is planned into, or null for the backlog. */
  cycleId: string | null;
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
  wi.cycle_id, wi.blocked, wi.blocked_reason, wi.completed_at,
  wi.assignee_ids, wi.label_ids, wi.created_by_member_id,
  wi.created_at, wi.updated_at
`;

/**
 * A row exactly as the driver hands it over — which is **not** the same shape
 * the schema declares.
 *
 * These queries go through `tx.execute`, so drizzle's column mappers never run:
 * what arrives is what drizzle's node-postgres driver configured `pg` to
 * produce, and that is a **string** for every date and timestamp. The schema's
 * `timestamp(... )` columns become `Date` only because the query builder maps
 * them, and raw SQL skips that step.
 *
 * Typing the two timestamps as `Date` here — which this did until slice 12 —
 * was a lie the compiler could not catch and nothing exercised: `completed_at`
 * is only ever compared to null, and `created_at`/`updated_at` are only read by
 * `cursorFor`, which calls `.toISOString()` on them and is therefore reached
 * only when somebody sorts by `created` or `updated` **and** pages past the
 * first page. It threw there. `toRow` now converts, once, so `WorkItemRow`'s
 * declared types are true for every caller.
 */
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
  cycle_id: string | null;
  blocked: boolean;
  blocked_reason: string | null;
  /** Union rather than `string`, so a driver that ever does parse one still type-checks. */
  completed_at: string | Date | null;
  assignee_ids: string[] | null;
  label_ids: string[] | null;
  created_by_member_id: string;
  created_at: string | Date;
  updated_at: string | Date;
};

/** A driver timestamp as a `Date`, whichever of the two the driver produced. */
function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

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
    cycleId: raw.cycle_id,
    blocked: raw.blocked,
    blockedReason: raw.blocked_reason,
    completedAt: raw.completed_at === null ? null : toDate(raw.completed_at),
    assigneeIds: raw.assignee_ids ?? [],
    labelIds: raw.label_ids ?? [],
    createdByMemberId: raw.created_by_member_id,
    createdAt: toDate(raw.created_at),
    updatedAt: toDate(raw.updated_at),
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

/**
 * The kinds of the custom fields this query may mention, by field id.
 *
 * Passed in rather than looked up, because the builder emits SQL and does not
 * read: the service already loads a project's field definitions to draw the
 * filter bar, and asking again here would be a second round trip on every list
 * render for information the caller is holding.
 *
 * It is also the sanitisation boundary. The URL parser tolerates junk by
 * design (§9's "discarding rather than failing"), but it has no way to know a
 * field's kind, so the caller drops filters naming a field this project does
 * not have. Anything still standing here that cannot be evaluated resolves to
 * `false` rather than being dropped — a filter that cannot be applied must
 * never silently widen a list.
 */
export type CustomFieldKinds = ReadonlyMap<string, CustomFieldKind>;

const NO_FIELDS: CustomFieldKinds = new Map();

/** `exists (a value row for this field on this item, matching …)`. */
function valueExists(fieldId: string, match: SQL | null): SQL {
  const extra = match ? sql` and ${match}` : sql``;
  return sql`exists (
    select 1 from custom_field_value v
    where v.work_item_id = wi.id and v.field_id = ${fieldId}::uuid${extra}
  )`;
}

/**
 * §9's "a `custom:{fieldId}` filter is one branch in the builder" — this is the
 * branch.
 *
 * Every kind resolves to an `EXISTS` (or its negation) over `custom_field_value`
 * keyed on `(field_id, <typed column>)`, which is the shape every index on that
 * table takes. §16 names "custom fields slow the list query" as a risk and
 * answers it with typed indexed columns rather than JSONB; this function is
 * where that answer is either honoured or thrown away.
 *
 * **"Has no value" is `NOT EXISTS`, not a null test**, because a value row only
 * exists where somebody entered one — so the items that predate the field
 * answer correctly without a backfill.
 */
function customPredicate(filter: CustomFilter, kind: CustomFieldKind): SQL {
  const { fieldId } = filter;

  switch (filter.op) {
    case 'set':
      return filter.value ? valueExists(fieldId, null) : sql`not ${valueExists(fieldId, null)}`;

    case 'is': {
      // A checkbox is stored only when ticked, so "not ticked" is the absence
      // of the row — which is also the right answer for every item that existed
      // before the field did.
      if (kind !== 'checkbox') return sql`false`;
      const ticked = valueExists(fieldId, sql`v.value_checkbox`);
      return filter.value ? ticked : sql`not ${ticked}`;
    }

    case 'has': {
      if (kind !== 'text') return sql`false`;
      // The pattern is built here and bound as one parameter, with LIKE's own
      // metacharacters escaped — otherwise a client called "50% Co" searches
      // for anything at all. `ilike` rather than `strpos` so the trigram index
      // from migration 0018 can serve it.
      const pattern = `%${filter.text.replace(/([\\%_])/g, '\\$1')}%`;
      return valueExists(fieldId, sql`v.value_text ilike ${pattern}`);
    }

    case 'range': {
      const column =
        kind === 'number' ? sql`v.value_number` : kind === 'date' ? sql`v.value_date` : null;
      if (column === null) return sql`false`;
      const cast = kind === 'number' ? sql`numeric` : sql`date`;

      const bounds: SQL[] = [];
      if (filter.from !== null) bounds.push(sql`${column} >= ${filter.from}::${cast}`);
      if (filter.to !== null) bounds.push(sql`${column} <= ${filter.to}::${cast}`);
      if (bounds.length === 0) return sql`true`;

      return valueExists(fieldId, sql.join(bounds, sql` and `));
    }

    case 'in': {
      const ids = filter.ids.filter((value) => value !== NONE);
      const wantsNone = filter.ids.includes(NONE);
      const branches: SQL[] = [];

      if (ids.length > 0) {
        // Array overlap for the two select kinds — the same `&&` against a GIN
        // index that `label_ids` uses, and the reason a multi-select filter does
        // not fan the row out before the page limit applies.
        if (kind === 'select' || kind === 'multi_select') {
          branches.push(valueExists(fieldId, sql`v.value_option_ids && ${sql.param(ids)}::uuid[]`));
        } else if (kind === 'user') {
          branches.push(
            valueExists(fieldId, sql`v.value_member_id = any(${sql.param(ids)}::uuid[])`),
          );
        } else {
          branches.push(sql`false`);
        }
      }

      // `none` OR-ed with the ids rather than filtered separately, for the
      // reason the assignee filter gives: "unassigned or assigned to Sophea" is
      // a question a manager actually asks, and splitting it returns nothing.
      if (wantsNone) branches.push(sql`not ${valueExists(fieldId, null)}`);
      if (branches.length === 0) return sql`true`;

      return sql`(${sql.join(branches, sql` or `)})`;
    }
  }
}

/** The frozen group map: what a group key compares against. */
/**
 * §7.3's five buckets, in SQL — the mirror of `dueBucket` in
 * `src/lib/workspace-date.ts`.
 *
 * "Open app → lands on MY WORK, grouped by: Overdue · Today · This week · Later
 * · No date." That grouping is the employee loop's whole shape, and it is the
 * one grouping in the product whose keys are neither ids nor a closed database
 * enum — they are an arithmetic over one date column and today.
 *
 * **One expression, used by all three of the counts query, the page query and
 * the group key.** `groupPredicate` compares this expression to the key rather
 * than restating the arithmetic as five branches, so the bucket a row is
 * *counted* in and the bucket it is *paged* into cannot disagree — which is the
 * failure mode a hand-written mirror has, and it shows up as a group whose
 * header says three and whose body shows two.
 *
 * `completed_at is not null` demotes finished work out of `overdue` and into
 * `later`, exactly as the TypeScript does. An item finished late is history: §4
 * and §7.4 both refuse to keep reporting it, because a surface that lists work
 * somebody already did is one people stop reading. `later` rather than a sixth
 * bucket, because My Work filters completed work out anyway and the bucket only
 * has to be *somewhere* honest for the callers that do not.
 *
 * `today` is a bound parameter in the workspace's zone (§17-13), never
 * `current_date` — the server's day is nobody's.
 */
function dueBucketExpression(today: string): SQL {
  return sql`(case
    when wi.due_date is null then 'none'
    when wi.due_date < ${today}::date then (case when wi.completed_at is null then 'overdue' else 'later' end)
    when wi.due_date = ${today}::date then 'today'
    when wi.due_date < ${today}::date + 7 then 'week'
    else 'later'
  end)`;
}

function groupPredicate(groupBy: GroupBy, key: SQL, fields: CustomFieldKinds, today: string): SQL {
  const fieldId = customFieldIdOf(groupBy);
  if (fieldId !== null) {
    const kind = fields.get(fieldId);
    switch (kind) {
      case 'select':
      case 'multi_select':
        return valueExists(fieldId, sql`${key}::uuid = any(v.value_option_ids)`);
      case 'user':
        return valueExists(fieldId, sql`v.value_member_id = ${key}::uuid`);
      case 'checkbox':
        // Both keys are real here — `false` is not the `none` bucket, it is
        // "not ticked", which is the absence of a row. Comparing the key to the
        // EXISTS makes one expression cover both without a second branch.
        return sql`(${key} = 'true') = ${valueExists(fieldId, sql`v.value_checkbox`)}`;
      default:
        // An ungroupable kind, or a field this project does not have. The
        // caller builds no headings for either, so this is unreachable in
        // practice and empty rather than wrong if it ever is not.
        return sql`false`;
    }
  }

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
    // §7.6's cycles. Unlike an assignee or a label this is single-valued, so
    // the comparison is an equality and no fan-out is needed — and the `none`
    // key is the backlog, which `emptyBucketPredicate` handles below.
    case 'cycle':
      return sql`wi.cycle_id = ${key}::uuid`;
    // The calendar's grouping (§14 slice 12). One key per calendar day, and the
    // key *is* the date — `due_date` is a `date` column, so no zone conversion
    // happens here and none should: which day an item is due is a calendar fact
    // the workspace already decided (§17-13), not an instant to re-interpret.
    case 'day':
      return sql`wi.due_date = ${key}::date`;
    // §7.3's My Work grouping. The one branch that compares an *expression* to
    // the key rather than a column, for the reason above: the arithmetic exists
    // once and both queries read it.
    case 'due':
      return sql`${dueBucketExpression(today)} = ${key}`;
    case 'none':
      return sql`true`;
    default:
      return sql`false`;
  }
}

/** The `none` bucket — items with no assignee, no label, or no value. One of §7.4's rows. */
function emptyBucketPredicate(groupBy: GroupBy, fields: CustomFieldKinds): SQL | null {
  const fieldId = customFieldIdOf(groupBy);
  if (fieldId !== null) {
    const kind = fields.get(fieldId);
    // A checkbox has no empty bucket: "not ticked" is one of its two real keys.
    if (kind === 'select' || kind === 'multi_select' || kind === 'user') {
      return sql`not ${valueExists(fieldId, null)}`;
    }
    return null;
  }

  if (groupBy === 'assignee') return sql`cardinality(wi.assignee_ids) = 0`;
  if (groupBy === 'label') return sql`cardinality(wi.label_ids) = 0`;
  // The backlog: work that has been planned into nothing. A real column on a
  // planning screen rather than a leftover bucket — §7.6's picker adds items
  // *from* it, so it has to be somewhere you can see and drag out of.
  if (groupBy === 'cycle') return sql`wi.cycle_id is null`;
  return null;
}

/** The counts query's group expression, mirroring `groupPredicate`. */
function groupExpression(groupBy: GroupBy, fields: CustomFieldKinds, today: string): SQL {
  const fieldId = customFieldIdOf(groupBy);
  if (fieldId !== null) {
    // An item with no value falls to the same `none` key the fan-out below
    // produces for an unassigned item — except a checkbox, whose absence means
    // `false` and is one of the two keys the caller drew a heading for.
    return fields.get(fieldId) === 'checkbox'
      ? sql`coalesce(unnested.key::text, 'false')`
      : sql`coalesce(unnested.key::text, ${NONE})`;
  }

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
    // No fan-out to coalesce against — the column itself is null for the
    // backlog, so the coalesce is over the column rather than over a join.
    case 'cycle':
      return sql`coalesce(wi.cycle_id::text, ${NONE})`;
    // Coalesced although the calendar always pairs this grouping with a month
    // filter, which excludes undated work: the coalesce costs nothing and stops
    // a caller who forgets the month from getting a `null` group key that no
    // heading can match and nothing renders.
    case 'day':
      return sql`coalesce(wi.due_date::text, ${NONE})`;
    // No coalesce: the expression is total by construction and returns the
    // string `none` itself for undated work, which is the key §7.3's last
    // bucket is drawn under.
    case 'due':
      return dueBucketExpression(today);
    case 'none':
      return sql`'all'`;
    default:
      return sql`'all'`;
  }
}

/**
 * An item can carry several assignees, so grouping by assignee has to fan the
 * array out — and a `left join` rather than a plain `unnest`, so an unassigned
 * item still produces one row and lands in the `none` bucket instead of
 * vanishing from a count it belongs in.
 *
 * A custom grouping fans out the same way and for the same reason, one level
 * deeper: the value row is joined first, then a multi-select's array is
 * unnested inside it, so an item with two options is counted under both and an
 * item with no value still produces its one `none` row.
 */
function groupFanout(groupBy: GroupBy, fields: CustomFieldKinds): SQL {
  const fieldId = customFieldIdOf(groupBy);
  if (fieldId !== null) {
    const kind = fields.get(fieldId);
    const inner =
      kind === 'select' || kind === 'multi_select'
        ? sql`select o.key from custom_field_value v
             left join lateral unnest(v.value_option_ids) as o(key) on true
             where v.work_item_id = wi.id and v.field_id = ${fieldId}::uuid`
        : kind === 'user'
          ? sql`select v.value_member_id as key from custom_field_value v
               where v.work_item_id = wi.id and v.field_id = ${fieldId}::uuid`
          : kind === 'checkbox'
            ? sql`select v.value_checkbox as key from custom_field_value v
                 where v.work_item_id = wi.id and v.field_id = ${fieldId}::uuid`
            : null;

    return inner === null ? sql`` : sql` left join lateral (${inner}) as unnested on true`;
  }

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
function wherePredicate(
  query: WorkItemQuery,
  today: string,
  horizon: string = today,
  fields: CustomFieldKinds = NO_FIELDS,
  staleBefore: Date | null = null,
): SQL {
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

  // §7.6's cycle filter, the same `none`-OR-ids shape the assignee and label
  // filters take — "in this sprint or not planned at all" is what a planning
  // screen shows, and splitting it into two filters would return nothing.
  const cycleIds = filters.cycleIds.filter((value) => value !== NONE);
  const wantsBacklog = filters.cycleIds.includes(NONE);
  if (filters.cycleIds.length > 0) {
    const branches: SQL[] = [];
    if (cycleIds.length > 0) branches.push(sql`wi.cycle_id = any(${sql.param(cycleIds)}::uuid[])`);
    if (wantsBacklog) branches.push(sql`wi.cycle_id is null`);
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

  // The calendar's month (§14 slice 12). Two bounds rather than
  // `date_trunc('month', wi.due_date) = ...`, so `work_item_workspace_due_idx`
  // can serve it — a function over the column would not be sargable, and the
  // one screen that reads a whole month is the one that must not scan for it.
  if (filters.month !== undefined) {
    const { first, last } = monthRange(filters.month);
    parts.push(sql`wi.due_date between ${first}::date and ${last}::date`);
  }

  /**
   * §7.4's stale row, as one comparison against an instant (§9's `stale_before`).
   *
   * The DSL carries `stale: N` — a count of **working** days, which means the
   * same thing next week — and the caller resolves it to a cutoff through the
   * database, because only the database knows the company's holidays. That is
   * the same split `soon` makes with its horizon, and it is why nothing here
   * does any arithmetic: the hard part happened once, in SQL, before this ran.
   *
   * Open work only, for the reason `overdue` gives above. An item finished
   * three weeks ago has not been touched since and is not stale — it is done,
   * and listing it is how §7.4's surface fills with noise nobody can clear.
   *
   * `staleBefore === null` while the filter is set means the cutoff could not be
   * resolved — a workspace with no working day in the past year, which is a
   * calendar mistake rather than a state. `false`, on the same principle the
   * custom-field branch uses: a filter that cannot be evaluated must never
   * silently widen the result.
   */
  if (filters.stale !== undefined) {
    parts.push(
      staleBefore === null
        ? sql`false`
        : sql`wi.updated_at < ${staleBefore} and wi.completed_at is null`,
    );
  }

  /**
   * §7.9's search text — one branch, two shapes, chosen by script (§9, §13).
   *
   * The whole of "`tsvector('simple')` for Latin, `pg_trgm` for Khmer, routed by
   * script detection" is these eight lines, and they are here rather than in a
   * search query of their own on purpose. A second builder beside this one would
   * be a second answer to "what is overdue" the first time somebody searched
   * inside a filtered list; as a filter it inherits the counts query, the
   * `LATERAL` page, the keyset cursors, the archived default and §10's per-row
   * re-check without any of them being written twice.
   *
   * Both shapes read `wi.search_text`, the generated column from migration 0025,
   * so the two languages are two questions about **one** string. The full-text
   * expression must match `work_item_search_fts_idx` exactly or the planner
   * ignores it; the `LIKE` is `LIKE` and not `ILIKE` because the column is
   * generated `lower(...)` and `gin_trgm_ops` cannot serve a case-insensitive
   * operator.
   *
   * A Latin query that reduces to no terms at all — pure punctuation — is
   * `false`, not a dropped filter. That is the rule the custom-field branch below
   * already follows and the staleness branch above: a filter that cannot be
   * evaluated must never silently *widen* the result, because more rows than
   * were asked for is the wrong direction to fail in.
   */
  if (filters.text !== undefined) {
    if (searchRoute(filters.text) === 'trigram') {
      parts.push(sql`wi.search_text like ${toLikePattern(filters.text)}`);
    } else {
      const tsquery = toTsQuery(filters.text);
      parts.push(
        tsquery === null
          ? sql`false`
          : sql`to_tsvector('simple', wi.search_text) @@ to_tsquery('simple', ${tsquery})`,
      );
    }
  }

  // §6-4's custom fields. One EXISTS per filtered field, and never more than
  // one per field — the DSL keeps a single filter per field precisely so this
  // cannot become a chain of subqueries nobody counted.
  for (const filter of filters.custom) {
    const kind = fields.get(filter.fieldId);
    // A field the caller did not supply cannot be evaluated. `false` rather
    // than a silent drop: a list that ignores a filter shows more than was
    // asked for, which is the wrong direction to fail in.
    parts.push(kind === undefined ? sql`false` : customPredicate(filter, kind));
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
  /**
   * The custom fields in scope, by id (§6-4). Omitted by a caller with no
   * custom filter and no custom grouping, which is every caller that predates
   * slice 10.
   */
  fields?: CustomFieldKinds;
  /**
   * The instant before which an update counts as stale, from `fetchStaleBefore`
   * (§7.4, slice 13). Required only by a query whose filter sets `stale`, and
   * `null` there means the company's calendar could not produce one.
   *
   * A resolved instant rather than the working-day count itself, for the reason
   * `horizon` is a resolved date rather than the word `soon`: the arithmetic is
   * a fact about the company's calendar *today*, so it is done once per query
   * instead of once per row, and it is done in the one place — SQL — where the
   * digest and the burndown already do it.
   */
  staleBefore?: Date | null;
};

/**
 * The instant before which an update counts as stale (§7.4, §9).
 *
 * One call to `stale_before`, §9's fourth working-day function, and the third
 * of the three callers slice 9's migration named: the digest, cycle progress,
 * and this. Everything about which days count — the workspace's working-day
 * mask, its holiday calendar, its timezone — is inside that function and inside
 * `is_working_day` underneath it, so a fourth surface asking the same question
 * gets the same answer by construction rather than by care.
 *
 * `workspaceId` is passed rather than read from `tenancy.workspace_id()` inside
 * the function, so the signature matches its three siblings — and RLS still
 * scopes the holiday rows it reads, so naming another workspace's id would
 * return nothing rather than somebody else's calendar.
 */
export async function fetchStaleBefore(
  tx: TenantDb,
  workspaceId: string,
  today: string,
  days: number,
): Promise<Date | null> {
  const result = await tx.execute<{ cutoff: Date | null }>(
    sql`select stale_before(${workspaceId}::uuid, ${today}::date, ${days}) as cutoff`,
  );

  const cutoff = result.rows[0]?.cutoff ?? null;
  // `tx.execute` bypasses drizzle's column mappers, so a timestamptz can arrive
  // as a string depending on the driver's parser — the same trap slice 12 found
  // in `RawRow`. Converted once here, so the type this returns is true.
  return cutoff === null ? null : new Date(cutoff);
}

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
  options: Pick<FetchOptions, 'today' | 'horizon' | 'fields' | 'staleBefore'>,
): Promise<Map<string, number>> {
  assertAnchored(query);

  const fields = options.fields ?? NO_FIELDS;

  const result = await tx.execute<{ group_key: string; total: number }>(sql`
    select ${groupExpression(query.groupBy, fields, options.today)} as group_key, count(*)::int as total
    from work_item wi${groupFanout(query.groupBy, fields)}
    where ${wherePredicate(query, options.today, options.horizon, fields, options.staleBefore ?? null)}
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
  options: Pick<FetchOptions, 'today' | 'horizon' | 'fields' | 'staleBefore'>,
): Promise<string> {
  assertAnchored(query);

  const result = await tx.execute<{ token: string }>(sql`
    select
      coalesce(extract(epoch from max(wi.updated_at))::text, '0')
        || ':' || count(*)::text as token
    from work_item wi
    where ${wherePredicate(
      query,
      options.today,
      options.horizon,
      options.fields ?? NO_FIELDS,
      options.staleBefore ?? null,
    )}
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

  const { groupKeys, cursors = {}, today, horizon, fields = NO_FIELDS, staleBefore = null } = options;
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
  const empty = emptyBucketPredicate(query.groupBy, fields);
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
        where ${wherePredicate(query, today, horizon, fields, staleBefore)}
          and ${groupPredicate(query.groupBy, sql`g.key`, fields, today)}${keyset}
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
      where ${wherePredicate(query, today, horizon, fields, staleBefore)} and ${empty}${noneKeyset}
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
    countWorkItemsByGroup(tx, query, {
      today: options.today,
      horizon: options.horizon,
      fields: options.fields,
      staleBefore: options.staleBefore,
    }),
  ]);

  return pages.map((page) => ({ ...page, total: totals.get(page.key) ?? 0 }));
}
