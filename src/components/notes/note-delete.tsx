'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { deleteNoteAction } from '@/app/[locale]/[workspaceSlug]/notes/actions';

/**
 * Delete a note (slice 17).
 *
 * **The refusal reports in the row that caused it**, not in a toast — §11's
 * rule, and the same call `comment-delete.tsx` makes for the same reason: a
 * toast is for a result the person cannot see, and this one is two inches from
 * their cursor.
 *
 * **No confirmation dialog**, which is the same answer the comment control
 * gives: the delete is soft, the row is recoverable by §4's 30-day window, and
 * the product's one insisted-upon confirmation is reserved for deleting a
 * workflow state that holds work. A note is one person's, and asking them twice
 * about their own note is asking them to confirm that they meant their own mind.
 */
export function NoteDelete({
  workspaceSlug,
  locale,
  noteId,
}: {
  workspaceSlug: string;
  locale: string;
  noteId: string;
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<RowActionState, FormData>(
    deleteNoteAction,
    ROW_IDLE,
  );

  return (
    <form action={submit} className="inline-flex items-center gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="noteId" value={noteId} />

      <button
        type="submit"
        disabled={pending}
        className="text-xs text-text-subtle underline underline-offset-2 transition-colors duration-120 hover:text-danger disabled:cursor-not-allowed disabled:opacity-55"
      >
        {t('notes.delete')}
      </button>

      {state.error && (
        <span role="alert" className="text-2xs text-danger">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}
