import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { cycle } from '@/server/db/schema';
import { STATE_GROUPS, type StateGroup } from '@/lib/state-groups';
import { emptyCounts, type GroupCounts } from '@/lib/cycles';
import type { CalendarDate } from '@/lib/workspace-date';

/**
 * Reading cycles, their progress and their burndown (§7.6, slice 11).
 *
 * Three shapes of read, and the second and third are the ones worth reading
 * before changing anything:
 *
 *   * **Progress counts by state *group*, never by state** (§4). "Progress,
 *     burndown, and 'is it done' derive from the group, never the state name" —
 *     so a company that renames "Done" to "Shipped" has changed nothing here,
 *     and a company with two completed states has both counted.
 *
 *   * **The burndown is one query, and it calls `is_working_day`.** §9 puts one
 *     SQL function behind working days precisely so "staleness, the reminder
 *     digest, and cycle progress" cannot disagree about whether Friday counted.
 *     Slice 9 was the first caller; this is the second, and it would have been
 *     the easy place to write the calculation a second time in TypeScript.
 */

export type CycleRow = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: CalendarDate;
  endDate: CalendarDate;
  completedAt: Date | null;
};

/** A cycle plus the two numbers every list row shows. */
export type CycleSummary = CycleRow & {
  itemCount: number;
  completedCount: number;
};

const CYCLE_COLUMNS = {
  id: cycle.id,
  projectId: cycle.projectId,
  name: cycle.name,
  goal: cycle.goal,
  startDate: cycle.startDate,
  endDate: cycle.endDate,
  completedAt: cycle.completedAt,
} as const;

export async function fetchCycle(tx: TenantDb, cycleId: string): Promise<CycleRow | null> {
  const rows = await tx
    .select(CYCLE_COLUMNS)
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), isNull(cycle.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Every cycle in a project, newest range first, each with its item counts.
 *
 * The counts come from one `LEFT JOIN … GROUP BY` rather than a query per
 * cycle, because the list is the screen that shows all of them and N+1 on a
 * page that draws a dozen rows is the shape slice 8 and slice 9 both got caught
 * by. A cycle with no items still appears — that is §7.6's `[E]` state, and a
 * row that vanished when it emptied would be a cycle nobody could add work to.
 *
 * Ordered by start date descending: the cycle a team is in, or about to be in,
 * is what they came to this page for, and last quarter's sprints sort away
 * beneath it.
 */
export async function fetchCycles(tx: TenantDb, projectId: string): Promise<CycleSummary[]> {
  const result = await tx.execute<{
    id: string;
    project_id: string;
    name: string;
    goal: string | null;
    start_date: string;
    end_date: string;
    completed_at: Date | null;
    item_count: number;
    completed_count: number;
  }>(sql`
    select
      c.id, c.project_id, c.name, c.goal, c.start_date, c.end_date, c.completed_at,
      count(wi.id)::int as item_count,
      count(wi.id) filter (where ws."group" = 'completed')::int as completed_count
    from cycle c
    left join work_item wi
      on wi.cycle_id = c.id and wi.deleted_at is null
    left join workflow_state ws on ws.id = wi.state_id
    where c.project_id = ${projectId}::uuid and c.deleted_at is null
    group by c.id
    order by c.start_date desc, c.id desc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    startDate: row.start_date,
    endDate: row.end_date,
    completedAt: row.completed_at,
    itemCount: row.item_count,
    completedCount: row.completed_count,
  }));
}

/**
 * The cycles a planning control may offer.
 *
 * Open ones only — §7.6 lets work be planned into an upcoming or active cycle,
 * and a picker offering a cycle that closed in March is a picker that rewrites
 * a finished burndown. The one exception is the cycle an item is *already* in,
 * which the caller adds back so a control can show its current value even after
 * the cycle has ended.
 *
 * `completed_at is null` and the end date is the pair, in that order: a cycle
 * whose prompt has been answered is closed whatever its dates say, and one
 * whose end has passed is closed even if nobody has answered yet.
 */
export async function fetchOpenCycles(
  tx: TenantDb,
  projectId: string,
  today: CalendarDate,
): Promise<CycleRow[]> {
  return tx
    .select(CYCLE_COLUMNS)
    .from(cycle)
    .where(
      and(
        eq(cycle.projectId, projectId),
        isNull(cycle.deletedAt),
        isNull(cycle.completedAt),
        sql`${cycle.endDate} >= ${today}::date`,
      ),
    )
    .orderBy(cycle.startDate);
}

/* ------------------------------------------------------------------------- */
/* Progress                                                                  */
/* ------------------------------------------------------------------------- */

export type CycleTotals = {
  counts: GroupCounts;
  estimate: { total: number; completed: number };
};

/**
 * How a cycle's items sit across §4's five state groups, plus their points.
 *
 * One grouped scan of the cycle's items joined to their states. The join is to
 * `workflow_state` rather than to a cached group on the item, because a state
 * regrouped in project settings (§6-3 allows it) must change every count that
 * depends on it immediately — a denormalized group would be a second thing to
 * keep in step, for a query that reads at most a sprint's worth of rows.
 *
 * Estimates are summed in the same pass. §17-9 hides them by default and this
 * does not un-hide them; it makes the number available so the progress bar can
 * show points *when a team actually estimates*, and stay silent when nobody
 * does rather than displaying a confident zero.
 */
export async function fetchCycleTotals(tx: TenantDb, cycleId: string): Promise<CycleTotals> {
  const result = await tx.execute<{
    group: StateGroup;
    total: number;
    estimate: number;
  }>(sql`
    select
      ws."group" as group,
      count(*)::int as total,
      coalesce(sum(wi.estimate), 0)::int as estimate
    from work_item wi
    join workflow_state ws on ws.id = wi.state_id
    where wi.cycle_id = ${cycleId}::uuid and wi.deleted_at is null
    group by ws."group"
  `);

  const counts = emptyCounts();
  let estimateTotal = 0;
  let estimateCompleted = 0;

  for (const row of result.rows) {
    // A group the database returned that this build does not know is dropped
    // rather than crashing the page: the enum is built from `STATE_GROUPS`, so
    // it can only happen mid-deploy between two versions.
    if (!(STATE_GROUPS as readonly string[]).includes(row.group)) continue;
    counts[row.group] = row.total;
    // Cancelled points leave the total for the reason cancelled items leave
    // `inScope`: abandoned work should neither count for a team nor against it.
    if (row.group !== 'cancelled') estimateTotal += row.estimate;
    if (row.group === 'completed') estimateCompleted += row.estimate;
  }

  return { counts, estimate: { total: estimateTotal, completed: estimateCompleted } };
}

/* ------------------------------------------------------------------------- */
/* Burndown                                                                  */
/* ------------------------------------------------------------------------- */

export type BurndownDay = {
  date: CalendarDate;
  /** Open items at the end of this day, or null for a day still in the future. */
  remaining: number | null;
  working: boolean;
};

/**
 * One row per calendar day of the cycle: how much was still open at the end of
 * it, and whether the company was working.
 *
 * **`completed_at` is compared in the workspace's timezone** (§17-13). It is a
 * `timestamptz`, and asking which *day* it fell on is a question only a zone
 * can answer — in UTC, work finished at 8pm in Phnom Penh belongs to the next
 * day, and a burndown would show a team finishing everything the morning after
 * they did. `at time zone` resolves it against the company's own clock, which
 * is the same clock "overdue" is judged by.
 *
 * **The future is null, not carried forward.** A line that runs flat to the end
 * of the range reads as a team that stopped working, which is the opposite of
 * what a chart on day three of ten should say.
 *
 * **`is_working_day` is called, not reimplemented** — §9's whole argument for
 * putting it in SQL. A weekend here has to be the same weekend the digest and
 * the staleness rule use, including the multi-day lunar-dated closures §17-18
 * is about: a burndown whose ideal line descends across Khmer New Year tells a
 * team they are a week behind on the morning they come back.
 *
 * The scan is over the cycle's items once per day of the range — at most
 * `MAX_CYCLE_DAYS` passes over a sprint's worth of rows, which is why the range
 * is capped at all.
 */
export async function fetchBurndown(
  tx: TenantDb,
  input: {
    cycleId: string;
    workspaceId: string;
    startDate: CalendarDate;
    endDate: CalendarDate;
    timeZone: string;
    today: CalendarDate;
  },
): Promise<BurndownDay[]> {
  const result = await tx.execute<{
    day: string;
    remaining: number | null;
    working: boolean;
  }>(sql`
    with days as (
      select d::date as day
      from generate_series(${input.startDate}::date, ${input.endDate}::date, interval '1 day') as d
    ),
    items as (
      select wi.completed_at
      from work_item wi
      where wi.cycle_id = ${input.cycleId}::uuid and wi.deleted_at is null
    )
    select
      to_char(days.day, 'YYYY-MM-DD') as day,
      case
        when days.day > ${input.today}::date then null
        else (
          select count(*)::int
          from items
          where items.completed_at is null
             or (items.completed_at at time zone ${input.timeZone})::date > days.day
        )
      end as remaining,
      is_working_day(${input.workspaceId}::uuid, days.day) as working
    from days
    order by days.day
  `);

  return result.rows.map((row) => ({
    date: row.day,
    remaining: row.remaining,
    working: row.working ?? false,
  }));
}

/**
 * Working days from today through the end of the cycle, inclusive.
 *
 * §9's `business_days_between` is half-open, so the end date is passed as
 * `end + 1` to include the last day itself — "three working days left" has to
 * count the day the cycle ends, which is a day people work.
 *
 * Zero once the cycle has ended, rather than a negative number: the screen that
 * shows this says "ends in N working days", and a cycle that ended last week
 * has a different sentence rather than a smaller number.
 */
export async function fetchWorkingDaysLeft(
  tx: TenantDb,
  input: { workspaceId: string; today: CalendarDate; endDate: CalendarDate },
): Promise<number> {
  if (input.today > input.endDate) return 0;

  const result = await tx.execute<{ days: number }>(sql`
    select business_days_between(
      ${input.workspaceId}::uuid,
      ${input.today}::date,
      ${input.endDate}::date + 1
    ) as days
  `);

  return result.rows[0]?.days ?? 0;
}
