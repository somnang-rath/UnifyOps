'use client';
import { useCallback } from 'react';
import { useCollabToken, type CollabTokenState } from '@prism/editor';
import { notesApi } from '@/hooks/use-notes';

/**
 * Short-lived collab token for one note document (spec §5.6, ADR 0009 §5).
 * Wraps @prism/editor's `useCollabToken` with the app's mint call
 * (`POST /notes/:id/collab-token`); the hook keeps it renewed and retries on a
 * 30s cycle after a failed mint.
 *
 * IMPORTANT: mount this inside a component keyed by the note id — the token is
 * scoped to one `notes:<id>` document, so switching notes must remount (the
 * notes view does this via `key={note._id}` on its editor pane).
 */
export function useNoteCollab(noteId: string | null): CollabTokenState {
  const fetchToken = useCallback(
    () => notesApi.collabToken(noteId as string),
    [noteId],
  );
  return useCollabToken({ fetchToken, enabled: !!noteId });
}
