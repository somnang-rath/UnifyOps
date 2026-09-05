'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { NoteFormState, RowActionState } from '@/lib/form-state';
import {
  createNote,
  deleteNote,
  pinNote,
  promoteNoteToPage,
  promoteNoteToWorkItem,
  updateNote,
  type NoteFailure,
} from '@/server/services/notes';

/**
 * The notes screen's actions (§20.3.1, §20.3.4 — slice 17).
 *
 * **No permission check anywhere in this file, and that is the design rather
 * than an omission** (§20.5). Every action names a note by id, and every service
 * call carries the acting member's own id into the predicate — so the worst a
 * crafted request can do is fail to find a row. There is no §10 row to ask
 * about, because nothing about a note is a question of role: an Admin has no
 * more claim on a colleague's note than a Guest does.
 *
 * `ForbiddenError` is still caught, and only one path can raise it: promoting a
 * note into a work item asks §10 about `work_item.create` in the project chosen.
 * That is a question about a *work item*, not about the note.
 */

const KEYS: Record<NoteFailure, string> = {
  body_required: 'notes.errors.bodyRequired',
  body_too_long: 'notes.errors.bodyTooLong',
  title_too_long: 'notes.errors.titleTooLong',
  not_found: 'notes.errors.notFound',
  unknown_item: 'notes.errors.unknownItem',
  unknown_project: 'notes.errors.unknownProject',
  archived: 'notes.errors.archived',
  too_many: 'notes.errors.tooMany',
};

type Context = { workspaceSlug: string; locale: 'en' | 'km' };

function contextFrom(formData: FormData): Context {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    locale: formData.get('locale') === 'km' ? 'km' : 'en',
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

function revalidateNotes({ locale, workspaceSlug }: Context) {
  revalidatePath(`/${locale}/${workspaceSlug}/notes`);
}

/**
 * §20.3.1's capture.
 *
 * Reachable from two places — the notes screen's composer and the `⌘K` capture
 * dialog — which is why it takes an optional `workItemId`: the dialog knows
 * which item is on screen and the screen does not. One action rather than two,
 * because a pin is a property of the note being written and not a different way
 * of writing one.
 */
export async function createNoteAction(
  _previous: NoteFormState,
  formData: FormData,
): Promise<NoteFormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const result = await createNote(resolved, {
    body: String(formData.get('body') ?? ''),
    workItemId: String(formData.get('workItemId') ?? '') || null,
  });

  if (!result.ok) return { fields: { body: KEYS[result.problem] } };

  revalidateNotes(context);
  // The timestamp is what tells the composer this is a *new* success — see
  // `NoteFormState`. Two saves in a row are otherwise indistinguishable, and
  // the second would leave the first note's text in the box.
  return { savedAt: Date.now(), noteId: result.noteId };
}

export async function updateNoteAction(
  _previous: NoteFormState,
  formData: FormData,
): Promise<NoteFormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const result = await updateNote(resolved, {
    noteId: String(formData.get('noteId') ?? ''),
    body: String(formData.get('body') ?? ''),
  });

  if (!result.ok) return { fields: { body: KEYS[result.problem] } };

  revalidateNotes(context);
  return { savedAt: Date.now(), noteId: String(formData.get('noteId') ?? '') };
}

export async function deleteNoteAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const result = await deleteNote(resolved, String(formData.get('noteId') ?? ''));
  if (!result.ok) return { error: KEYS[result.problem] };

  revalidateNotes(context);
  return { done: true };
}

/**
 * §20.3.1's `[!]`, both ways.
 *
 * An empty `workItemId` is "unpin" rather than "no value supplied", which is the
 * distinction `moveWorkItem` draws for a neighbour id — a form field that is
 * absent and one that was cleared arrive identically over a `FormData`, so the
 * action has to pick a meaning and this one picks the one the button says.
 */
export async function pinNoteAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const result = await pinNote(resolved, {
    noteId: String(formData.get('noteId') ?? ''),
    workItemId: String(formData.get('workItemId') ?? '') || null,
  });
  if (!result.ok) return { error: KEYS[result.problem] };

  revalidateNotes(context);
  return { done: true };
}

/**
 * §20.3.4: a note becomes a work item.
 *
 * The one action here that can be refused by §10, and the refusal is the
 * project's rather than the note's: somebody may write whatever they like in a
 * note and still not be able to create work in a given project.
 */
export async function promoteNoteAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await promoteNoteToWorkItem(resolved, {
      noteId: String(formData.get('noteId') ?? ''),
      projectId: String(formData.get('projectId') ?? ''),
    });
    if (!result.ok) return { error: KEYS[result.problem] };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'notes.errors.cannotCreate' };
    throw error;
  }

  revalidateNotes(context);
  return { done: true };
}

/**
 * §20.3.4's other promotion, added in slice 18: a note becomes a wiki page.
 *
 * The same shape as the work-item promotion above and the same rule underneath —
 * **a copy, never a move** (§20.1). The note stays private and keeps a line
 * saying what came out of it.
 *
 * It revalidates the wiki as well as the notes screen, because the new page is
 * on the other side and a sidebar that had already rendered would not show it.
 */
export async function promoteNoteToPageAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  try {
    const result = await promoteNoteToPage(resolved, {
      noteId: String(formData.get('noteId') ?? ''),
      spaceId: String(formData.get('spaceId') ?? ''),
    });
    // The wiki's own vocabulary, not the notes screen's: `not_found` here means
    // "not a space you can write a page into", which is what the picker already
    // says by not offering it.
    if (!result.ok) {
      return { error: result.problem === 'archived' ? KEYS.archived : 'wiki.errors.forbidden' };
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: 'wiki.errors.forbidden' };
    throw error;
  }

  revalidateNotes(context);
  revalidatePath(`/${context.locale}/${context.workspaceSlug}/wiki`, 'layout');
  return { done: true };
}
