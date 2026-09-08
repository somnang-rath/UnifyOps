'use client';

import { useCallback, useRef, useState } from 'react';
import { checkAttachment, sanitizeFilename } from '@/lib/attachments';

/**
 * The browser half of an upload (§2.4, §8 — slice 8).
 *
 * A hook rather than a component because two places need exactly this and
 * nothing else: the composer, where files ride along with a comment, and the
 * item's own file panel. Both ask for a ticket, PUT the bytes at the URL it
 * returns, and end holding an attachment id. What differs is what they do with
 * that id, which is why the hook returns it rather than acting on it.
 *
 * **One `fetch` per file, straight to the store.** The bytes never pass through
 * the app server in production (§8), which is also why there is no progress
 * bar: `fetch` reports no upload progress, and the honest indicator for a step
 * whose duration is unknown is a pending state rather than a bar that pretends
 * to advance. §11's loading rule wants a shape, not a lie.
 *
 * §11's five states live in the components; what this owes them is the *data*
 * for each — a file that is uploading, one that finished, and one that failed
 * with a message key and its text still on screen so it can be retried.
 */

export type UploadState = 'uploading' | 'done' | 'failed';

export type UploadedFile = {
  /** Stable across the upload's life. Not the attachment id, which arrives later. */
  localId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  state: UploadState;
  /** Set once the store has the bytes. What a form posts back. */
  attachmentId: string | null;
  /** A message key, never a sentence (§13). */
  problem: string | null;
};

/** Problem identifiers to catalogue keys — the same map the actions use. */
const KEYS: Record<string, string> = {
  filename_required: 'attachments.errors.filenameRequired',
  file_empty: 'attachments.errors.fileEmpty',
  file_too_large: 'attachments.errors.fileTooLarge',
  file_type: 'attachments.errors.fileType',
  not_found: 'workItems.errors.notFound',
  archived: 'projects.errors.archived',
  forbidden: 'workItems.errors.forbidden',
  read_only: 'workItems.errors.readOnly',
};

const problemKey = (value: unknown) =>
  (typeof value === 'string' && KEYS[value]) || 'attachments.errors.uploadFailed';

/**
 * `workItemId` is nullable since slice 21, and null means *this subject cannot
 * hold files*.
 *
 * A page comment is the only caller that passes null today, and it does so
 * because `createUploadTicket` has no page branch — a slice-18 gap, recorded in
 * `pageCommentThreadIn`. Nullable here rather than a second hook, because a hook
 * cannot be called conditionally and the composer needs one code path either
 * way: `add` refuses, so nothing ever reaches the ticket route.
 */
export function useUploads(context: { workspaceSlug: string; workItemId: string | null }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const counter = useRef(0);

  const patch = useCallback((localId: string, next: Partial<UploadedFile>) => {
    setFiles((current) =>
      current.map((file) => (file.localId === localId ? { ...file, ...next } : file)),
    );
  }, []);

  const upload = useCallback(
    async (file: File, localId: string) => {
      // The same check the server will run. Failing here means no round trip
      // and, more importantly, no 25 MiB sent from a phone before being told it
      // was too big (§2.5-5).
      const name = sanitizeFilename(file.name);
      const problem = checkAttachment({
        filename: name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      if (problem) {
        patch(localId, { state: 'failed', problem: problemKey(problem) });
        return;
      }

      // Refused before the round trip rather than after it. The route would
      // reject a null item anyway; failing here keeps the reason a message key
      // instead of whatever a 400 body happened to contain.
      if (context.workItemId === null) {
        patch(localId, { state: 'failed', problem: 'attachments.errors.uploadFailed' });
        return;
      }

      try {
        const ticketResponse = await fetch('/api/internal/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceSlug: context.workspaceSlug,
            workItemId: context.workItemId,
            filename: name,
            contentType: file.type,
            sizeBytes: file.size,
          }),
        });

        const ticket = await ticketResponse.json().catch(() => null);
        if (!ticketResponse.ok) {
          patch(localId, { state: 'failed', problem: problemKey(ticket?.error) });
          return;
        }

        // The one request that carries the bytes, and the only one that does
        // not go to this app in production.
        const stored = await fetch(ticket.upload.url, {
          method: ticket.upload.method,
          headers: ticket.upload.headers,
          body: file,
        });

        if (!stored.ok) {
          patch(localId, { state: 'failed', problem: 'attachments.errors.uploadFailed' });
          return;
        }

        patch(localId, {
          state: 'done',
          attachmentId: ticket.attachmentId,
          // The name the server actually stored, which may be shorter or
          // cleaner than the one the file picker gave.
          name: ticket.filename ?? name,
        });
      } catch {
        // Offline, or the store unreachable. §11's edge case, and the file stays
        // in the list with a retry rather than vanishing.
        patch(localId, { state: 'failed', problem: 'attachments.errors.uploadFailed' });
      }
    },
    [context.workspaceSlug, context.workItemId, patch],
  );

  /** Start uploading everything dropped, pasted or picked, in parallel. */
  const add = useCallback(
    (incoming: readonly File[]) => {
      const started = incoming.map((file) => {
        counter.current += 1;
        const localId = `u${counter.current}`;

        return {
          file,
          entry: {
            localId,
            name: sanitizeFilename(file.name) || file.name,
            sizeBytes: file.size,
            contentType: file.type,
            state: 'uploading' as const,
            attachmentId: null,
            problem: null,
          } satisfies UploadedFile,
        };
      });

      setFiles((current) => [...current, ...started.map(({ entry }) => entry)]);
      for (const { file, entry } of started) void upload(file, entry.localId);
    },
    [upload],
  );

  /** Drop one from the list — a mistaken paste, or a failure being dismissed. */
  const remove = useCallback((localId: string) => {
    // The row it leaves behind on the server, if the bytes did land, is a
    // `pending` attachment nothing renders. Slice 9's job collects it; there is
    // deliberately nothing to call here, because a "cancel" endpoint would be a
    // second way to delete a file with its own permission question.
    setFiles((current) => current.filter((file) => file.localId !== localId));
  }, []);

  const reset = useCallback(() => setFiles([]), []);

  return {
    files,
    add,
    remove,
    reset,
    /** Ids to post with a comment. Only files whose bytes actually landed. */
    readyIds: files.filter((file) => file.attachmentId).map((file) => file.attachmentId as string),
    busy: files.some((file) => file.state === 'uploading'),
  };
}

/**
 * The files in a paste, a drop or a picker — as an array, and empty when the
 * event carried none.
 *
 * §2.4 calls paste-to-upload "the most-used collaboration action in practice",
 * and a pasted screenshot arrives as a `DataTransferItem` with no name at all.
 * The synthesised one matters: it is what the person sees in the list and what
 * they download later, and `image.png` for every screenshot in a thread is
 * indistinguishable from every other.
 */
export function filesFrom(transfer: DataTransfer | null, stamp = new Date()): File[] {
  if (!transfer) return [];

  return [...transfer.files].map((file) => {
    if (file.name) return file;

    const extension = (file.type.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '');
    // Local time, and only ever a filename — not a value anything computes
    // with, so it does not owe §6-1's workspace timezone.
    const at = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
      stamp.getDate(),
    ).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(
      stamp.getMinutes(),
    ).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;

    return new File([file], `pasted-${at}.${extension}`, { type: file.type });
  });
}
