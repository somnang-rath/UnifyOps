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

export type ItemRowData = {
  id: string;
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
};

export type RowPerson = { memberId: string; name: string };
export type RowLabel = { id: string; name: string; color: LabelColor };

/** The service's row, narrowed. Typed structurally so `lib` imports nothing from `server`. */
export function toItemRowData(view: {
  id: string;
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
}): ItemRowData {
  return {
    id: view.id,
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
  };
}
