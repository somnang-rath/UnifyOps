import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Query for `GET /internal/notes/:id/access?userId=<sub>` (ADR 0009 §2). */
export const NoteAccessQuerySchema = z.object({
  userId: objectId,
});
export type NoteAccessQuery = z.infer<typeof NoteAccessQuerySchema>;

/**
 * Body for `PUT /internal/notes/:id/content` (ADR 0009 §4) — the debounced
 * snapshot of the collaborative Yjs state rendered back to HTML by the live
 * server. Same bound as the wiki snapshot: under the 12mb JSON limit.
 */
export const NoteSnapshotContentSchema = z.object({
  content: z.string().max(5_000_000),
  editedBy: objectId.optional(),
});
export type NoteSnapshotContentDto = z.infer<typeof NoteSnapshotContentSchema>;
