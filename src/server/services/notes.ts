import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { note, workItem } from '@/server/db/schema';
import { withActor, type UnitOfWork } from '@/server/db/tenant';
import {
  countNotes,
  fetchNote,
  fetchNotes,
  type NotePin,
  type NoteRow,
} from '@/server/queries/notes';
import { createWorkItemIn } from './work-items';
import { createPageIn } from './wiki';
import { isArchived, loadProject, projectResource } from './project-access';
import { normalizeDocument } from '@/lib/documents';
import { noteTitle, normalizeNoteTitle, validateNote, type NoteProblem } from '@/lib/notes';

/**
 * Notes (§20.1, §20.3.1, §20.3.4 — slice 17).
 *
 * Three decisions run through everything here, and all three are §20.1's
 * governing rule — *a page is the company's record; a note is one person's
 * thinking* — carried out rather than restated.
 *
 * **No §10 row, and there can never be one** (§20.5). This is the twelfth time
 * a slice has looked at the matrix and not needed a new row, after labels,
 * attachments, notifications, custom fields, cycles, saved views, availability,
 * search, the holiday calendar, settings and password reset — but it is the
 * first time the reason is that the question is *not a question of role at all*.
 * There is no version of §10 in which an Admin may read a colleague's notes,
 * because the whole promise of the screen is that nobody can. What enforces it
 * is `owner_member_id` in every predicate.
 *
 * **No events at all** (§20.6). Not audit, not activity, not notification. §8's
 * registry is for things that happened to a company's *work*; an Owner-visible,
 * permanent, append-only log of what somebody privately jotted down is
 * surveillance rather than governance, and §20.1 promised we would not keep one.
 * This is `saved_view`'s call from slice 12 taken further: there the argument
 * was that naming a filter is furniture, and here it is that the record itself
 * would be the harm.
 *
 * **Promotion is a copy, never a move** (§20.1, §20.3.4). A note becomes a work
 * item by being copied into one, and the note stays where it was. A move would
 * be the one operation in the product that silently changes who can read
 * something, performed from the one screen whose whole promise is that nobody
 * else can.
 *
 * The one thing this module *does* have to say out loud is what "private" means
 * with §7.13 in the building: an Owner in a view-as session reads the target
 * member's notes, because `withActor` scopes rows as the target. That is what
 * view-as is for and it is already audited — but it is why the notes screen says
 * "private to you and to anyone who can view as you" rather than "private"
 * (§20.5).
 */

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: NoteFailure };

export type NoteFailure =
  | NoteProblem
  | 'not_found'
  // The item a pin or a promotion names, which is a client defect rather than a
  // race: both are chosen from lists this actor was just shown.
  | 'unknown_item'
  | 'unknown_project'
  | 'archived'
  | 'too_many';

/**
 * How many notes one person may keep.
 *
 * A bound rather than none, for the reason `MAX_VIEWS_PER_MEMBER` is one: this
 * is a table anybody can write to without any permission check, so the only
 * thing standing between a stuck client and an unbounded workspace is a number.
 * High enough that it is not a product limit anybody meets — a note a working
 * day for eight years — and low enough that it is a limit.
 */
export const MAX_NOTES_PER_MEMBER = 2_000;

/**
 * A note as a screen draws it.
 *
 * The pin has been through §10 by the time it is this type, which is why the
 * three visibility columns `NotePin` carries are gone: they are the policy
 * module's input, not a screen's.
 */
export type NoteView = {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  pin: NoteLink | null;
  promoted: NoteLink | null;
};

export type NoteLink = {
  identifier: string;
  title: string;
  projectSlug: string;
  number: number;
};

export type NoteListing = {
  notes: NoteView[];
  /** Every note this member has, so the screen can say when the list is capped. */
  total: number;
};

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

export async function listNotes(resolved: ResolvedActor): Promise<NoteListing> {
  return withActor(resolved.context, async (tx) => {
    const rows = await fetchNotes(tx, { ownerMemberId: resolved.memberId });
    // Both questions on one transaction, which is the trap slice 8 hit with
    // `getCommentThread`, slice 9 with the unread count, slice 10 with custom
    // fields, slice 13 with §7.4's six lists and slice 14 with the palette's
    // scope. The count is not `rows.length`: the list is capped and the number
    // the screen shows has to be the real one.
    const total = await countNotes(tx, resolved.memberId);
    return { notes: rows.map((row) => toView(resolved, row)), total };
  });
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * §20.3.1's capture, in one transaction.
 *
 * The target is five seconds from `⌘K` to saved, which is why there is no title
 * field, no folder and no project to choose: the body is the whole of what a
 * note is, and everything else about it is derived or optional.
 */
export async function createNote(
  resolved: ResolvedActor,
  input: { body: string; title?: string | null; workItemId?: string | null },
): Promise<Ok<{ noteId: string }> | Failed> {
  const body = normalizeDocument(input.body);
  const title = normalizeNoteTitle(input.title);

  const problem = validateNote({ title, body });
  if (problem) return { ok: false, problem };

  const noteId = uuidv7();

  return withActor(resolved.context, async (tx) => {
    if ((await countNotes(tx, resolved.memberId)) >= MAX_NOTES_PER_MEMBER) {
      return { ok: false, problem: 'too_many' } as const;
    }

    const pin = await resolvePin(tx, resolved, input.workItemId ?? null);
    if (pin.ok === false) return pin;

    await tx.insert(note).values({
      id: noteId,
      workspaceId: resolved.workspace.id,
      ownerMemberId: resolved.memberId,
      title,
      body,
      workItemId: pin.workItemId,
    });

    return { ok: true, noteId } as const;
  });
}

export async function updateNote(
  resolved: ResolvedActor,
  input: { noteId: string; body: string; title?: string | null },
): Promise<Ok | Failed> {
  const body = normalizeDocument(input.body);
  const title = normalizeNoteTitle(input.title);

  const problem = validateNote({ title, body });
  if (problem) return { ok: false, problem };

  return withActor(resolved.context, async (tx) => {
    const existing = await fetchNote(tx, { id: input.noteId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    await tx
      .update(note)
      .set({ title, body, updatedAt: new Date() })
      .where(ownRow(resolved, input.noteId));

    return { ok: true } as const;
  });
}

/**
 * §20.3.1's `[!]`, both ways: pin a note to an item, or unpin it.
 *
 * `null` is an intent rather than a missing value — "this note is about nothing
 * in particular" — which is the same distinction `moveWorkItem` draws for a
 * neighbour id, and for the same reason: a service that treated the two the same
 * would make "unpin" unexpressible.
 */
export async function pinNote(
  resolved: ResolvedActor,
  input: { noteId: string; workItemId: string | null },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const existing = await fetchNote(tx, { id: input.noteId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    const pin = await resolvePin(tx, resolved, input.workItemId);
    if (pin.ok === false) return pin;

    await tx
      .update(note)
      .set({ workItemId: pin.workItemId, updatedAt: new Date() })
      .where(ownRow(resolved, input.noteId));

    return { ok: true } as const;
  });
}

/**
 * Deleting a note.
 *
 * Soft, and duller than a comment's: nothing renders a tombstone, because nobody
 * else was in the conversation. The row survives because `deleted_at` is on
 * every table through `timestamps`, and because §4's 30-day recovery window is a
 * promise about a company's data that a note is not excluded from.
 */
export async function deleteNote(resolved: ResolvedActor, noteId: string): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const existing = await fetchNote(tx, { id: noteId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    await tx
      .update(note)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(ownRow(resolved, noteId));

    return { ok: true } as const;
  });
}

/**
 * §20.3.4: a note becomes a work item.
 *
 * **One transaction**, which is why `createWorkItemIn` was split out of
 * `createWorkItem` (the same move slice 14 made with `listProjectsIn`). Three
 * things happen — the note is read, the item is created, the note records what
 * it became — and either all of them did or none did. Two `withActor` calls
 * would hold two pooled connections for one click and leave a window in which an
 * item exists and the note it came from does not know about it.
 *
 * **The body is carried across and the note keeps its own copy.** §20.3.4 makes
 * this a copy rather than a move; §20.1 says why in one sentence — a move is the
 * one operation that would silently change who can read something.
 *
 * The title is the note's derived one, which is the first line of the body. A
 * work item needs a title and a note does not have one, so the same rule the
 * notes list uses to name a row names the item — and the person can edit it on
 * the item page, which is where they land.
 */
export async function promoteNoteToWorkItem(
  resolved: ResolvedActor,
  input: { noteId: string; projectId: string; title?: string },
): Promise<Ok<{ workItemId: string; number: number; projectSlug: string }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const existing = await fetchNote(tx, { id: input.noteId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    const target = await loadProject(tx, input.projectId);
    if (!target) return { ok: false, problem: 'unknown_project' } as const;
    if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
    // §20.3.4's `[!]` for the page case is "the space is not offered, and the
    // picker says why"; the same rule holds here, and this is the backstop
    // behind the picker. `createWorkItemIn` asks §10 again about
    // `work_item.create` — this asks about visibility first so that a project
    // the actor cannot see refuses as "unknown" rather than as "forbidden",
    // which is the answer that says less about what exists.
    if (!can(resolved.actor, 'project.view', projectResource(target))) {
      return { ok: false, problem: 'unknown_project' } as const;
    }

    const title = (input.title ?? noteTitle(existing)).trim();

    const created = await createWorkItemIn(tx, uow, resolved, {
      projectId: input.projectId,
      title,
      description: existing.body,
    });
    if (created.ok === false) {
      // The work-item vocabulary is wider than this screen's; the two problems
      // it can raise that mean something here are mapped, and anything else is
      // reported as the project being unusable, which is what it is.
      return {
        ok: false,
        problem: created.problem === 'archived' ? 'archived' : 'unknown_project',
      } as const;
    }

    await tx
      .update(note)
      .set({ promotedWorkItemId: created.workItemId, updatedAt: new Date() })
      .where(ownRow(resolved, input.noteId));

    return {
      ok: true,
      workItemId: created.workItemId,
      number: created.number,
      projectSlug: target.slug,
    } as const;
  });
}

/**
 * §20.3.4's other promotion: a note becomes a wiki page.
 *
 * **A copy, never a move**, exactly as the work-item promotion above is, and
 * §20.1 gives the reason in one sentence: a move "would be the one operation
 * that silently changes who can read something, and it would do it from the one
 * screen whose whole promise is that nobody else can." The note stays where it
 * was and keeps a quiet line recording what came out of it.
 *
 * `[!]` §20.3.4: "promoting into a space they cannot write in → the space is not
 * offered, and the picker says why rather than showing a disabled row nobody can
 * explain". The picker is filtered by `canWrite` on the space list; this is the
 * backstop behind it, and it refuses as `not_found` rather than as `forbidden`
 * so a space somebody cannot see stays a space they cannot learn about.
 *
 * The whole thing is one transaction — read the note, create the page, record
 * what it became — because those three are one act that either happened or did
 * not. That is the same call `promoteNoteToWorkItem` makes by using
 * `createWorkItemIn`, and it is why `createPageIn` exists beside `createPage`.
 */
export async function promoteNoteToPage(
  resolved: ResolvedActor,
  input: { noteId: string; spaceId: string; title?: string },
): Promise<Ok<{ pageId: string; slug: string; spaceSlug: string }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const existing = await fetchNote(tx, { id: input.noteId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    const created = await createPageIn(tx, uow, resolved, {
      spaceId: input.spaceId,
      parentId: null,
      title: (input.title ?? noteTitle(existing)).trim(),
      body: existing.body,
    });

    if (created.ok === false) {
      /*
       * The wiki's vocabulary is wider than this screen's. `forbidden` and
       * `not_found` both mean "not a space you can write a page into" from here,
       * and collapsing them is the same answer the picker already gives by not
       * offering the row.
       */
      return {
        ok: false,
        problem: created.problem === 'archived' ? 'archived' : 'not_found',
      } as const;
    }

    await tx
      .update(note)
      .set({ promotedPageId: created.pageId, updatedAt: new Date() })
      .where(ownRow(resolved, input.noteId));

    return {
      ok: true,
      pageId: created.pageId,
      slug: created.slug,
      spaceSlug: created.spaceSlug,
    } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Offboarding                                                               */
/* ------------------------------------------------------------------------- */

/**
 * §20.5's asymmetry, as one statement: a departing member's notes are destroyed.
 *
 * "Pages are the company's record and survive, attributed, exactly as activity
 * does. Notes are destroyed with the membership." §7.12 promises that what
 * somebody *wrote for the company* is "preserved and attributed", which is why
 * `comment` and `comment_mention` are `ON DELETE restrict`; handing a departing
 * member's private thinking to their manager on the day they leave is the
 * opposite of what the word private promised them.
 *
 * Called from inside `offboardMember`'s transaction, so the removal and this are
 * one thing — there is no window in which somebody has been offboarded and their
 * notes are still readable through a view-as session.
 *
 * A soft delete rather than a `DELETE`, because offboarding soft-deletes the
 * membership too: §7.12's removal is reversible for §4's 30 days, and notes that
 * were hard-deleted could not come back with the person. The cascade on
 * `note_owner_fk` is the backstop for the day a membership row is really
 * removed.
 */
export async function deleteNotesOf(
  tx: TenantDb,
  _uow: UnitOfWork,
  memberId: string,
): Promise<void> {
  await tx
    .update(note)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(note.ownerMemberId, memberId), isNull(note.deletedAt)));
}

/* ------------------------------------------------------------------------- */
/* Internals                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * The predicate every write carries.
 *
 * A helper rather than three copies, because the failure mode of forgetting the
 * owner clause on an `UPDATE` is editing somebody else's note — and unlike the
 * reads, no test that counts rows would notice.
 */
function ownRow(resolved: ResolvedActor, noteId: string) {
  return and(eq(note.id, noteId), eq(note.ownerMemberId, resolved.memberId));
}

/**
 * The item a pin names, checked.
 *
 * Read through `withActor` before the id ever reaches the column, which is what
 * holds the workspace honest where §9's composite key normally would — see the
 * comment on `note.work_item_id`. §10 is asked about the project as well,
 * because a note may only point at work its owner can actually open.
 */
async function resolvePin(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string | null,
): Promise<{ ok: true; workItemId: string | null } | Failed> {
  if (workItemId === null) return { ok: true, workItemId: null };

  const rows = await tx
    .select({ id: workItem.id, projectId: workItem.projectId })
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, problem: 'unknown_item' };

  const target = await loadProject(tx, row.projectId);
  if (!target || !can(resolved.actor, 'project.view', projectResource(target))) {
    return { ok: false, problem: 'unknown_item' };
  }

  return { ok: true, workItemId: row.id };
}

/**
 * A row on its way to a screen, with both links put through §10.
 *
 * The second policy pass `listProjects` established and `listWorkItems`
 * repeats: the query has already scoped rows to the workspace, and this asks the
 * module's own question about the project a link points into. It matters here
 * because a pin outlives a membership change — somebody pinned to a private
 * project's item and then removed from that project would otherwise keep reading
 * its title on their own notes screen.
 *
 * A failed check drops the link rather than the note: the note is theirs either
 * way, and what they lose is a shortcut they can no longer follow.
 */
function toView(resolved: ResolvedActor, row: NoteRow): NoteView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    // ISO strings rather than `Date`s, because these cross into client
    // components and a `Date` does not survive that boundary intact.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    pin: visibleLink(resolved, row.pin),
    promoted: visibleLink(resolved, row.promoted),
  };
}

function visibleLink(resolved: ResolvedActor, pin: NotePin | null): NoteLink | null {
  if (pin === null) return null;
  const allowed = can(resolved.actor, 'project.view', {
    id: pin.projectId,
    workspaceId: pin.projectWorkspaceId,
    visibility: pin.projectVisibility,
  });
  if (!allowed) return null;

  return {
    identifier: pin.identifier,
    title: pin.title,
    projectSlug: pin.projectSlug,
    number: pin.number,
  };
}
