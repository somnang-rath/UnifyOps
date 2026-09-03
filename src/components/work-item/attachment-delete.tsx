'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import type { ComposerContext } from './comment-composer';
import { deleteAttachmentAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * Remove a file — the uploader retracting their own, or §10's Lead power over
 * somebody else's (slice 8).
 *
 * A near-twin of `comment-delete.tsx`, and deliberately not a shared "delete
 * row" component: the two post to different actions with different payloads,
 * and the accessible name is the part that differs most — "Delete" repeated
 * down a panel says nothing about *which*, and a screen-reader user moving
 * through six files needs the filename in the control.
 *
 * **The refusal reports here, not in a toast** (§11): a toast is for a result
 * the person cannot see, and this one is two inches from their cursor.
 *
 * No confirmation dialog, for the reason the comment control gives: the delete
 * is soft, and §4 spends the product's one insisted-upon confirmation on
 * deleting a workflow state that holds items.
 */
export function DeleteAttachment({
  context,
  attachmentId,
  filename,
}: {
  context: ComposerContext;
  attachmentId: string;
  /** The icon-free control still needs to say *which* file it removes (§11). */
  filename: string;
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<RowActionState, FormData>(
    deleteAttachmentAction,
    ROW_IDLE,
  );

  return (
    <form action={submit} className="inline-flex items-center gap-2">
      <input type="hidden" name="workspaceSlug" value={context.workspaceSlug} />
      <input type="hidden" name="projectSlug" value={context.projectSlug} />
      <input type="hidden" name="locale" value={context.locale} />
      <input type="hidden" name="number" value={context.number} />
      <input type="hidden" name="attachmentId" value={attachmentId} />

      <button
        type="submit"
        disabled={pending}
        aria-label={t('attachments.removeLabel', { filename })}
        className="text-2xs text-text-subtle underline underline-offset-2 transition-colors duration-120 hover:text-danger disabled:cursor-not-allowed disabled:opacity-55"
      >
        {t('attachments.remove')}
      </button>

      {state.error && (
        <span role="alert" className="text-2xs text-danger">
          {t(state.error)}
        </span>
      )}
    </form>
  );
}
