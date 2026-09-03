/**
 * The five priorities (§4, §12), and the only place their values are written
 * down.
 *
 * A **closed** enum, so it maps to messages in code and no translation key ever
 * reaches the database (§13) — unlike a workflow state, which a company names
 * and may rename. `priority.urgent` in the catalogues is what a person reads;
 * `urgent` is what is stored, filtered and sorted.
 *
 * In `src/lib` because both sides run it: the filter bar offers the list in the
 * browser, the query builder validates against it on the server, and the schema
 * builds its `pgEnum` from the same constant so the database cannot drift from
 * the code — the same arrangement `state-groups.ts` has.
 */

/** §12's semantic assignment table lists them in this order: urgent first. */
export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

export type Priority = (typeof PRIORITIES)[number];

/**
 * Sort weight. Urgent sorts first, and "none" sorts last rather than in the
 * middle — an unprioritised item is not a medium one, and a list that mixes
 * them teaches people to stop setting the field.
 */
const ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function comparePriorities(a: Priority, b: Priority): number {
  return ORDER[a] - ORDER[b];
}

/** The SQL `CASE` weight, so an ORDER BY on priority is this same order. */
export function priorityWeight(value: Priority): number {
  return ORDER[value];
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}
