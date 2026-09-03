import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/feedback';
import type { AttachmentView } from '@/server/services/attachments';
import { AttachmentList } from './attachment-list';
import { AttachmentUploader } from './attachment-uploader';
import type { ComposerContext } from './comment-composer';

/**
 * The item's own files (§7.7, §2.4 — slice 8).
 *
 * Above the conversation on the item page, because a file attached to the item
 * is a property of the work rather than a moment in the discussion of it — the
 * spec, the contract, the photo of the whiteboard. Files pasted into a comment
 * render inside that comment instead, which is what keeps the two lists
 * meaning different things.
 *
 * §11's five states: `[L]` server-rendered with the page · `[E]` says what the
 * panel is for and leaves the drop target live beneath it — an empty state with
 * no way to act is a dead end · `[S]` the file appears in the list, so no toast
 * · `[X]` each row and the uploader report their own failures · `[!]` a
 * read-only project shows the files and no uploader, rather than hiding both:
 * somebody on a stale tab has to be able to see *why* they cannot add one.
 */
export async function AttachmentPanel({
  files,
  context,
  canUpload,
}: {
  files: AttachmentView[];
  context: ComposerContext;
  /** False for a Viewer, and for every archived project (§4). */
  canUpload: boolean;
}) {
  const t = await getTranslations();

  // Nothing to show and nothing to do: a Viewer looking at an item with no
  // files is not helped by an empty panel telling them so.
  if (files.length === 0 && !canUpload) return null;

  return (
    <section aria-labelledby="attachments-heading" className="space-y-3">
      <h2 id="attachments-heading" className="text-xs font-medium text-text-muted">
        {t('attachments.heading')}
      </h2>

      {files.length === 0 ? (
        <EmptyState title={t('attachments.empty')} />
      ) : (
        <AttachmentList files={files} context={context} label={t('attachments.heading')} />
      )}

      {canUpload && <AttachmentUploader context={context} />}
    </section>
  );
}
