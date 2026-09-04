import type { LabelColor } from './label-colors';
import type { Priority } from './priorities';

/**
 * What a list row draws, and the one place a service row is narrowed to it.
 *
 * Rows reach the browser two ways — embedded in the server render, and as JSON
 * from `/api/internal/list` when a group loads its next keyset page. JSON has
 * no `Date`, so a shape carrying one would be subtly different depending on
 * which path produced it: the kind of difference that surfaces as a crash on
 * the second page and in no test of the first. Narrowing here, once, makes both
 * paths produce the same object by construction.
 *
 * In `src/lib` because both sides hold it: the server builds it, the row
 * component renders it, and the route handler serialises it.
 */

/**
 * A custom-field value as a row carries it (§6-4), JSON-safe throughout.
 *
 * The same columns `custom_field_value` stores, which is what makes it safe to
 * pass one straight from the query to the cell that draws it: `value_date` is
 * already a calendar-date string and every other column is a scalar or an array
 * of ids. Nothing here becomes a `Date`, for the reason at the top of this file
 * — a shape carrying one would differ between the server render and the paged
 * JSON, and only the second page would break.
 */
export type RowCustomValue = {
  kind: string;
  text: string | null;
  /**
   * A **string**, mirroring `ValueColumns` — slice 10 keeps `numeric` out of a
   * JavaScript float on purpose, because an invoice total is the sort of thing
   * people put in a custom field and binary floating point is the wrong shape
   * for money. The cell renders the digits the person typed.
   */
  number: string | null;
  date: string | null;
  checkbox: boolean | null;
  optionIds: string[] | null;
  memberId: string | null;
};

/** One item's values, by field id. Absent fields are unfilled — never a stored blank. */
export type RowCustomValues = Record<string, RowCustomValue>;

export type ItemRowData = {
  id: string;
  /**
   * Which project it belongs to.
   *
   * Added in slice 13, because that is the first slice whose lists are not one
   * project's: My Work, Workload and Needs Attention each draw rows from
   * several, and a row has to be able to name the project whose slug its link
   * needs and whose states its pill offers. Before them every caller knew the
   * answer already and carrying it would have been dead weight.
   */
  projectId: string;
  /** `ENG-142`. Composed on the server, where the project's prefix lives. */
  identifier: string;
  /** The `142`. Carried separately because it, not the identifier, is the URL segment. */
  number: number;
  title: string;
  stateId: string;
  priority: Priority;
  dueDate: string | null;
  blocked: boolean;
  blockedReason: string | null;
  /** Derived from the state *group*, never a state name (§4). */
  completed: boolean;
  assigneeIds: string[];
  labelIds: string[];
  /**
   * The three columns only §12's Table draws (slice 12).
   *
   * Carried on the shared row rather than in a parallel table-only shape,
   * because the paging route returns *this* type and a second one would mean a
   * second narrowing, a second serialiser and two rows that agree until one of
   * them does not. They cost three scalars on a payload the list already sends;
   * the card components simply do not read them.
   */
  estimate: number | null;
  cycleId: string | null;
  /** ISO 8601. A string and not a `Date`, for the reason this module exists. */
  updatedAt: string;
};

export type RowPerson = { memberId: string; name: string };
export type RowLabel = { id: string; name: string; color: LabelColor };

/** The service's row, narrowed. Typed structurally so `lib` imports nothing from `server`. */
export function toItemRowData(view: {
  id: string;
  projectId: string;
  identifier: string;
  number: number;
  title: string;
  stateId: string;
  priority: Priority;
  dueDate: string | null;
  blocked: boolean;
  blockedReason: string | null;
  completedAt: Date | null;
  assigneeIds: string[];
  labelIds: string[];
  estimate: number | null;
  cycleId: string | null;
  updatedAt: Date;
}): ItemRowData {
  return {
    id: view.id,
    projectId: view.projectId,
    identifier: view.identifier,
    number: view.number,
    title: view.title,
    stateId: view.stateId,
    priority: view.priority,
    dueDate: view.dueDate,
    blocked: view.blocked,
    blockedReason: view.blockedReason,
    completed: view.completedAt !== null,
    assigneeIds: view.assigneeIds,
    labelIds: view.labelIds,
    estimate: view.estimate,
    cycleId: view.cycleId,
    updatedAt: view.updatedAt.toISOString(),
  };
}
