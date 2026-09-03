'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import type { ComposerContext } from './comment-composer';
import { deleteCommentAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * Remove a comment — the author retracting their own, or §10's Lead power over
 * somebody else's (slice 8).
 *
 * **The refusal reports in the row that caused it**, not in a toast. That is
 * §11's rule and slice 5 already follows it for the list: a toast is for a
 * result the person cannot see, and this one is two inches from their cursor.
 * The board's Toast exists for the opposite case — a card that animates back
 * with nothing on screen saying why.
 *
 * No confirmation dialog. §4 puts the product's one insisted-upon confirmation
 * on deleting a workflow state that holds items, because the alternative there
 * is orphaned work; a comment is soft-deleted, leaves a tombstone, and is
 * recoverable by the same 30-day window everything else uses.
 */
export function DeleteComment({
  context,
  commentId,
  author,
}: {
  context: ComposerContext;
  commentId: string;
  /** Whose comment this is — the icon-only control needs a real name (§11). */
  author: string;
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<RowActionState, FormData>(
    deleteCommentAction,
    ROW_IDLE,
  );

  return (
    <form action={submit} className="inline-flex items-center gap-2">
      <input type="hidden" name="workspaceSlug" value={context.workspaceSlug} />
      <input type="hidden" name="projectSlug" value={context.projectSlug} />
      <input type="hidden" name="locale" value={context.locale} />
      <input type="hidden" name="number" value={context.number} />
      <input type="hidden" name="commentId" value={commentId} />

      <button
        type="submit"
        disabled={pending}
        // Named for what it does and whose it is: "Delete" repeated down a
        // thread tells a screen-reader user nothing about which one they are on.
        aria-label={t('comments.deleteLabel', { author })}
        className="text-2xs text-text-subtle underline underline-offset-2 transition-colors duration-120 hover:text-danger disabled:cursor-not-allowed disabled:opacity-55"
      >
        {t('comments.delete')}
      </button>

      {state.error && (
        <span role="alert" className="text-2xs text-danger">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}
