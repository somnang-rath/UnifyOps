'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { describeSize } from '@/lib/attachments';
import type { UploadedFile } from './use-uploads';

/**
 * The files currently going up — shared by the composer and the item panel.
 *
 * Its own component because both of them own an upload queue and neither owns
 * the *rendering* of one: a file that failed in a comment box and a file that
 * failed on the item panel are the same row with the same message and the same
 * way out, and two copies of it would drift the first time the wording changed.
 *
 * **No progress bar**, deliberately. `fetch` reports no upload progress, and a
 * bar that advances on a timer is a lie told during the one moment the person
 * is watching. A pending row with a spinner says the true thing: this is
 * happening, and it is not done.
 *
 * A failed row keeps its filename and its reason, and offers removal rather
 * than a retry: the file is still on the person's machine, and dropping it
 * again is a shorter path than a button that re-reads a `File` handle the
 * browser may have released.
 */
export function UploadQueue({
  files,
  onRemove,
}: {
  files: readonly UploadedFile[];
  onRemove: (localId: string) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();

  if (files.length === 0) return null;

  return (
    <ul aria-label={t('attachments.queueLabel')} className="space-y-1">
      {files.map((file) => {
        const size = describeSize(file.sizeBytes);

        return (
          <li
            key={file.localId}
            className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs"
          >
            {file.state === 'uploading' && (
              // Announced as well as shown: a spinner is invisible to a screen
              // reader, and this is the only thing on the row that is changing.
              <Loader2
                aria-label={t('attachments.uploading')}
                className="h-3.5 w-3.5 shrink-0 animate-spin text-text-subtle"
              />
            )}

            <span className="min-w-0 flex-1 truncate text-text">{file.name}</span>

            <span className="shrink-0 tabular-nums text-2xs text-text-subtle">
              {t(`attachments.size.${size.unit}`, { value: format.number(size.value) })}
            </span>

            {file.problem && (
              <span role="alert" className="shrink-0 text-2xs text-danger">
                {t(file.problem)}
              </span>
            )}

            <button
              type="button"
              onClick={() => onRemove(file.localId)}
              aria-label={t('attachments.removeLabel', { filename: file.name })}
              className="shrink-0 text-2xs text-text-subtle underline underline-offset-2 transition-colors duration-120 hover:text-danger"
            >
              {t('attachments.remove')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
