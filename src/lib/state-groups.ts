/**
 * The five state groups (§4), and the only place their values are written down.
 *
 * A workflow state is named and coloured by the company; a state *group* is
 * not. Progress, burndown and "is it done" derive from the group, never from
 * the state name — a company that renames "Done" to "Shipped" has not changed
 * what completion means, and a company with two completed states must not have
 * one of them silently excluded from a burndown.
 *
 * In `src/lib` because both sides run it: the board groups columns and the
 * settings editor offers the list, and the schema builds its `pgEnum` from the
 * same constant so the database cannot drift from the code.
 *
 * These are identifiers, never labels. `stateGroup.*` in the catalogues is what
 * a person reads; no translation key ever reaches the database (§13).
 */

/** §4, in the order they appear on a board, left to right. */
export const STATE_GROUPS = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
] as const;

export type StateGroup = (typeof STATE_GROUPS)[number];

const ORDER: Record<StateGroup, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

/** Board and list column order. Sorting by the group name would give alphabetical nonsense. */
export function compareStateGroups(a: StateGroup, b: StateGroup): number {
  return ORDER[a] - ORDER[b];
}

/**
 * Whether work in this group is off the active surface.
 *
 * Completed and cancelled both are — an item is not "open" because it was
 * abandoned rather than finished. Every count of outstanding work in the
 * product asks this question, so it is answered once.
 */
export function isClosedGroup(group: StateGroup): boolean {
  return group === 'completed' || group === 'cancelled';
}

/**
 * The colours a state may carry (§12).
 *
 * A closed set of semantic token names rather than free hex, for the same
 * reason components never carry a literal colour: the value has to resolve
 * differently in dark mode, and a hex stored in 2026 cannot. Recolouring is a
 * v1 customization (§6-3), so the set has to be wide enough to be worth using
 * and narrow enough that every entry has a token in both themes.
 */
export const STATE_COLORS = [
  'ink',
  'sky',
  'navy',
  'warning',
  'success',
  'danger',
] as const;

export type StateColor = (typeof STATE_COLORS)[number];

/**
 * The colour a group implies, from §12's "Semantic assignments" table.
 *
 * A default, not a constraint: a company may recolour any state to anything in
 * `STATE_COLORS`. It exists so that adding a state never requires a colour
 * decision before the state can be saved.
 */
const GROUP_COLOR: Record<StateGroup, StateColor> = {
  backlog: 'ink',
  unstarted: 'ink',
  started: 'warning',
  completed: 'success',
  cancelled: 'ink',
};

export function defaultColorFor(group: StateGroup): StateColor {
  return GROUP_COLOR[group];
}
