import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { TenantDb } from '@/server/db/client';
import { note, project, workItem } from '@/server/db/schema';

/**
 * Reading notes (§20.1, §20.5 — slice 17).
 *
 * **Every predicate here carries the acting member's own id, and that is the
 * whole of the access control on this table.** RLS has already scoped the rows
 * to the workspace; the owner column is what makes one person's notes theirs,
 * and RLS *cannot* help with that because the person a note must be hidden from
 * is a colleague in the same company (§20.1).
 *
 * The construction is `saved_view`'s from slice 12 and the notification inbox's
 * from slice 9, and it is the reason none of the three needed a §10 row. What is
 * different here is the consequence of getting it wrong: a missed predicate on a
 * saved view puts a colleague's filter on somebody's screen, and a missed
 * predicate here puts their private thinking there. So
 * `__tenancy__/notes.test.ts` asserts the predicate *directly*, with a second
 * member's rows present in the same workspace — a test that only counted the
 * rows returned would still pass with the predicate deleted.
 *
 * There is deliberately no function in this file that takes a note id without
 * also taking an owner. A "load this note" that trusted its caller to check
 * afterwards is exactly the shape the one forgotten call site takes.
 */

export type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  /** The item this note is pinned to (§20.3.1's `[!]`). */
  pin: NotePin | null;
  /** What this note became, if it became something (§20.3.4). */
  promoted: NotePin | null;
};

/**
 * An item a note points at, with the three columns §10 needs to be asked about
 * its project.
 *
 * The visibility columns ride along rather than being fetched by whoever checks,
 * because the check is `can(actor, 'project.view', …)` and that is a pure
 * function over exactly these fields (§10). `readNotes` in the service is where
 * they are spent; nothing outside it should see a pin that has not been through
 * that pass.
 */
export type NotePin = {
  workItemId: string;
  identifier: string;
  title: string;
  projectSlug: string;
  number: number;
  projectId: string;
  projectWorkspaceId: string;
  projectVisibility: 'workspace' | 'private';
};

/**
 * How many notes one screen shows.
 *
 * The notes list does not page, and that is stated rather than hidden — the same
 * call slice 13 made for My Work and slice 14 for the search results screen.
 * Keyset paging in this product goes through `/api/internal/list`, which returns
 * work-item rows for one project's context; a second endpoint for notes would be
 * a sixth §8 route-handler exception for a screen whose own answer is search.
 * Somebody with more than two hundred notes finds one by typing, not by
 * scrolling.
 */
export const NOTE_PAGE_LIMIT = 200;

/**
 * The two items a note can point at, joined once each.
 *
 * `alias` rather than two more queries, for the reason every other read in this
 * product folds its lookups in: a list of fifty rows would otherwise be fifty
 * round trips to name the items they refer to. Left joins throughout, because a
 * pin whose item was deleted is null (`SET NULL`) and a note with neither is the
 * ordinary case.
 */
const pinned = alias(workItem, 'pinned');
const pinnedProject = alias(project, 'pinned_project');
const made = alias(workItem, 'made');
const madeProject = alias(project, 'made_project');

/**
 * The columns every read of this table selects.
 *
 * `search_text` is deliberately absent: it is a generated copy of the body for
 * an index to chew on, and sending it to a screen would double the payload of
 * every note list to no purpose.
 */
const NOTE_SELECTION = {
  id: note.id,
  title: note.title,
  body: note.body,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,

  pinItemId: pinned.id,
  pinNumber: pinned.number,
  pinTitle: pinned.title,
  pinProjectId: pinnedProject.id,
  pinProjectKey: pinnedProject.key,
  pinProjectSlug: pinnedProject.slug,
  pinProjectVisibility: pinnedProject.visibility,
  pinProjectWorkspaceId: pinnedProject.workspaceId,

  madeItemId: made.id,
  madeNumber: made.number,
  madeTitle: made.title,
  madeProjectId: madeProject.id,
  madeProjectKey: madeProject.key,
  madeProjectSlug: madeProject.slug,
  madeProjectVisibility: madeProject.visibility,
  madeProjectWorkspaceId: madeProject.workspaceId,
} as const;

type RawNoteRow = {
  [K in keyof typeof NOTE_SELECTION]: (typeof NOTE_SELECTION)[K]['_']['data'] | null;
};

function withPins(tx: TenantDb) {
  return tx
    .select(NOTE_SELECTION)
    .from(note)
    .leftJoin(pinned, and(eq(pinned.id, note.workItemId), isNull(pinned.deletedAt)))
    .leftJoin(pinnedProject, eq(pinnedProject.id, pinned.projectId))
    .leftJoin(made, and(eq(made.id, note.promotedWorkItemId), isNull(made.deletedAt)))
    .leftJoin(madeProject, eq(madeProject.id, made.projectId));
}

/**
 * This member's notes, newest first.
 *
 * Newest first because a note list is read backwards from now — §20.3.1's whole
 * promise is capture in five seconds, and what somebody wants when they come
 * back is the thing they just wrote. That is the opposite of the comment thread,
 * which reads forwards because a conversation does. The id breaks ties in insert
 * order, because a UUIDv7 does.
 */
export async function fetchNotes(
  tx: TenantDb,
  input: { ownerMemberId: string; limit?: number },
): Promise<NoteRow[]> {
  const rows = await withPins(tx)
    .where(and(eq(note.ownerMemberId, input.ownerMemberId), isNull(note.deletedAt)))
    .orderBy(desc(note.createdAt), desc(note.id))
    .limit(input.limit ?? NOTE_PAGE_LIMIT);

  return rows.map(toNoteRow);
}

/**
 * One note of this member's, or null.
 *
 * The owner check is in the predicate rather than after it, which is what makes
 * "no such note" and "not yours" one answer. Telling them apart would say what
 * exists — and what exists here is that a colleague wrote something.
 */
export async function fetchNote(
  tx: TenantDb,
  input: { id: string; ownerMemberId: string },
): Promise<NoteRow | null> {
  const rows = await withPins(tx)
    .where(
      and(
        eq(note.id, input.id),
        eq(note.ownerMemberId, input.ownerMemberId),
        isNull(note.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toNoteRow(row) : null;
}

/** How many notes this member has. The empty state asks; nothing else does. */
export async function countNotes(tx: TenantDb, ownerMemberId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(note)
    .where(and(eq(note.ownerMemberId, ownerMemberId), isNull(note.deletedAt)));

  return rows[0]?.count ?? 0;
}

function toNoteRow(row: RawNoteRow): NoteRow {
  return {
    id: row.id as string,
    title: row.title,
    body: row.body as string,
    createdAt: new Date(row.createdAt as Date),
    updatedAt: new Date(row.updatedAt as Date),
    pin: pinOf({
      workItemId: row.pinItemId,
      number: row.pinNumber,
      title: row.pinTitle,
      projectId: row.pinProjectId,
      projectKey: row.pinProjectKey,
      projectSlug: row.pinProjectSlug,
      projectVisibility: row.pinProjectVisibility,
      projectWorkspaceId: row.pinProjectWorkspaceId,
    }),
    promoted: pinOf({
      workItemId: row.madeItemId,
      number: row.madeNumber,
      title: row.madeTitle,
      projectId: row.madeProjectId,
      projectKey: row.madeProjectKey,
      projectSlug: row.madeProjectSlug,
      projectVisibility: row.madeProjectVisibility,
      projectWorkspaceId: row.madeProjectWorkspaceId,
    }),
  };
}

/**
 * A pin, or null when the join found nothing.
 *
 * Null covers three cases and gives them one answer: the column was null (no
 * pin), the item has since been soft-deleted, and the item's project has been
 * deleted. A row that half-resolved would render a link to a 404, which is worse
 * than the absence somebody can see and re-pin.
 */
function pinOf(row: {
  workItemId: string | null;
  number: number | null;
  title: string | null;
  projectId: string | null;
  projectKey: string | null;
  projectSlug: string | null;
  projectVisibility: 'workspace' | 'private' | null;
  projectWorkspaceId: string | null;
}): NotePin | null {
  if (
    row.workItemId === null ||
    row.number === null ||
    row.projectId === null ||
    row.projectKey === null ||
    row.projectSlug === null ||
    row.projectVisibility === null ||
    row.projectWorkspaceId === null
  ) {
    return null;
  }

  return {
    workItemId: row.workItemId,
    identifier: `${row.projectKey}-${row.number}`,
    title: row.title ?? '',
    projectSlug: row.projectSlug,
    number: row.number,
    projectId: row.projectId,
    projectVisibility: row.projectVisibility,
    projectWorkspaceId: row.projectWorkspaceId,
  };
}
