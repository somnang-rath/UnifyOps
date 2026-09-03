'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { MAX_ATTACHMENT_BYTES, describeSize } from '@/lib/attachments';
import type { ComposerContext } from './comment-composer';
import { UploadQueue } from './upload-queue';
import { filesFrom, useUploads } from './use-uploads';
import { confirmAttachmentAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * Adding files to the item itself — drop, paste, or pick (§2.4).
 *
 * Three ways in, and none of them is optional. Dropping is what people reach
 * for on a desktop; **pasting is what §2.4 calls "the most-used collaboration
 * action in practice"**; and the picker is the one that works from a keyboard
 * and on a phone, which makes it the one §11's mouse-free loop and §15-6's
 * 390px pass both depend on. A drop zone with no button is a mouse-only
 * feature.
 *
 * The paste listener is on the region rather than on the document: a paste
 * anywhere on the page landing in this panel would steal a screenshot somebody
 * meant for the comment box below it.
 *
 * **Confirming is a server action, where the ticket was a route handler**, and
 * the split is the point. The ticket returns a value the browser needs before
 * anything on screen changes; the confirmation *is* the change, so it wants
 * exactly what a server action does — revalidate the route and re-render the
 * panel with the file in it.
 *
 * §11's five states: `[L]` each queued file shows its own pending row ·
 * `[E]` the empty panel is this control, with the hint that says what to do ·
 * `[S]` the page revalidates and the file joins the list above · `[X]` a failed
 * upload keeps its row, names the reason and offers to remove it · `[!]` a file
 * over the limit is refused before a byte is sent, and a dropped folder or an
 * unsupported type is refused by name.
 */
export function AttachmentUploader({
  context,
  className,
}: {
  context: ComposerContext;
  className?: string;
}) {
  const t = useTranslations();
  const uploads = useUploads(context);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const [state, submit] = useActionState<RowActionState, FormData>(
    confirmAttachmentAction,
    ROW_IDLE,
  );

  /**
   * Confirm each file once, as soon as its bytes have landed.
   *
   * The ref is what makes "once" true: `readyIds` is recomputed on every render
   * of this component, and confirming from an effect without remembering what
   * has already been sent would re-submit the whole list every time another
   * file finished.
   */
  const confirmed = useRef(new Set<string>());
  useEffect(() => {
    const fresh = uploads.readyIds.filter((id) => !confirmed.current.has(id));
    if (fresh.length === 0) return;

    for (const id of fresh) confirmed.current.add(id);

    const payload = new FormData();
    payload.set('workspaceSlug', context.workspaceSlug);
    payload.set('projectSlug', context.projectSlug);
    payload.set('locale', context.locale);
    payload.set('number', String(context.number));
    payload.set('workItemId', context.workItemId);
    for (const id of fresh) payload.append('attachmentId', id);

    startTransition(() => submit(payload));

    // The queue has done its job: the file is now a row the panel renders from
    // the server, and leaving it here would show every upload twice.
    for (const id of fresh) {
      const entry = uploads.files.find((file) => file.attachmentId === id);
      if (entry) uploads.remove(entry.localId);
    }
  }, [uploads, context, submit]);

  const limit = describeSize(MAX_ATTACHMENT_BYTES);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        // A region rather than a button: it contains the picker, and nesting
        // interactive controls inside a button is invalid. The picker below is
        // what carries the keyboard path.
        role="group"
        aria-label={t('attachments.add')}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploads.add(filesFrom(event.dataTransfer));
        }}
        onPaste={(event) => {
          const pasted = filesFrom(event.clipboardData);
          if (pasted.length === 0) return;
          // Only when the paste actually carried a file — otherwise pasting
          // text into anything inside this region would be swallowed.
          event.preventDefault();
          uploads.add(pasted);
        }}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-dashed p-3 transition-colors duration-120',
          dragging ? 'border-accent bg-accent-subtle' : 'border-border bg-surface',
        )}
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={uploads.busy}
        >
          <Paperclip aria-hidden className="h-3.5 w-3.5" />
          {t('attachments.add')}
        </Button>

        <p className="text-2xs text-text-subtle">
          {t('attachments.dropHint', {
            limit: t(`attachments.size.${limit.unit}`, { value: limit.value }),
          })}
        </p>

        <input
          ref={input}
          type="file"
          multiple
          // Off-screen rather than `display: none`: a hidden input is not
          // focusable, and the label-and-button pairing here is what keeps the
          // control reachable while the visible affordance stays a Button.
          className="sr-only"
          // The name is on the Button; this one is never reached by tab.
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            uploads.add([...(event.target.files ?? [])]);
            // Cleared so picking the same file twice in a row still fires.
            event.target.value = '';
          }}
        />
      </div>

      <UploadQueue files={uploads.files} onRemove={uploads.remove} />

      {state.error && (
        <p role="alert" className="text-2xs text-danger">
          {t(state.error)}
        </p>
      )}
    </div>
  );
}
