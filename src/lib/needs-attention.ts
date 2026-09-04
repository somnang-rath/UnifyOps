/**
 * §7.4's Needs Attention — the five rows, as data (§4, §14 slice 13).
 *
 * "NEEDS ATTENTION tab: overdue · blocked · unassigned · no due date · stale
 * (>N days)". §2.2 is why it is a surface at all: "manager views are **derived,
 * never assembled**" — nobody maintains a list of what is going wrong, the
 * product works it out from the same rows everything else reads.
 *
 * Each row is a **partial filter over the §9 DSL**, and that is the whole
 * design. There is no Needs Attention query, no `needs_attention` view and no
 * second definition of "overdue" — five overrides on the one builder, which is
 * what stops this surface and the List disagreeing about a number a manager is
 * about to put in a meeting.
 *
 * In `src/lib` because both sides run it: the tab renders the row headings and
 * their links in the browser, the server resolves each row into a query. One
 * definition, so a row's heading and its contents describe the same set.
 */

import type { WorkItemFilters } from './work-item-query';
import { NONE } from './work-item-query';
import { STATE_GROUPS } from './state-groups';

/**
 * How many working days without an update makes an item stale.
 *
 * §7.4 writes it as "stale (>N days)" and never fixes N; §6's customization
 * table has no row for it, and inventing one would put a control in a settings
 * screen the plan's own list of seven areas does not contain — the same
 * decision labels, attachments, notifications, custom fields, cycles and saved
 * views each made about §10. So it is a constant with a URL override rather
 * than a company setting: a manager who wants a tighter or looser reading
 * changes `st=` and can share the result, which is §5's bargain.
 *
 * Five **working** days, which in this market's default Monday–Saturday week
 * (§2.5, the schema's mask of 63) is most of a week and never spans a holiday
 * cluster — §4 is explicit that counting calendar days here means "every Monday
 * morning flags Friday's work and the surface trains people to ignore it".
 */
export const STALE_WORKING_DAYS = 5;

/**
 * The five rows, in the order §7.4 lists them.
 *
 * Ordered by how much a manager can do about it: overdue and blocked are work
 * somebody is stuck on right now, unassigned and undated are work nobody has
 * decided about, and stale is the quiet one that never announces itself.
 */
export const ATTENTION_ROWS = ['overdue', 'blocked', 'unassigned', 'no_due_date', 'stale'] as const;
export type AttentionRow = (typeof ATTENTION_ROWS)[number];

/**
 * Work that is still somebody's problem.
 *
 * Every row narrows this, and it reads the state **group** rather than any state
 * name (§4): a company that renamed "Done" to "Shipped" has changed nothing, and
 * one with two completed states has both excluded. **Cancelled is excluded
 * too**, which is the whole reason §4 gives it a group of its own — work
 * somebody decided not to do is not work that needs attention, and a surface
 * that keeps listing it is one people learn to scroll past.
 *
 * `parentId: null` for the reason the List view defaults to it: a flat list that
 * interleaves parents and their sub-items reads as duplicates, and a manager
 * scanning for problems should see the parent once.
 */
export const OPEN_STATE_GROUPS = STATE_GROUPS.filter(
  (group) => group !== 'completed' && group !== 'cancelled',
);

/**
 * One row's filter, as an override on the caller's scope.
 *
 * The caller supplies the anchor — a set of projects (§9, §16) — and this
 * supplies the narrowing. Deliberately not a whole `WorkItemQuery`: the row does
 * not get to decide which projects a manager is looking at, and a function that
 * returned one could.
 *
 * `stale` carries the *threshold*, never a resolved date. The service turns it
 * into an instant through `stale_before` (§9), which is the only thing that
 * knows the company's holidays — see `work-item-query.ts`.
 */
export function attentionFilters(row: AttentionRow, staleDays: number): Partial<WorkItemFilters> {
  switch (row) {
    case 'overdue':
      return { due: 'overdue' };
    case 'blocked':
      return { blocked: true };
    case 'unassigned':
      // The `none` sentinel, exactly as the assignee filter already spells it.
      // Note that this **does not anchor the query** — "unassigned across the
      // whole workspace" is precisely the §16 scan wearing a filter — which is
      // why every caller here supplies a project set of its own.
      return { assignees: [NONE] };
    case 'no_due_date':
      return { due: 'none' };
    case 'stale':
      return { stale: staleDays };
  }
}
