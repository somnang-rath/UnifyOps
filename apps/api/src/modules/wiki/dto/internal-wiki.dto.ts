import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Query for `GET /internal/wiki/:id/access?userId=<sub>` (ADR §1). */
export const WikiAccessQuerySchema = z.object({
  userId: objectId,
});
export type WikiAccessQuery = z.infer<typeof WikiAccessQuerySchema>;

/**
 * Body for `PUT /internal/wiki/:id/content` (ADR §4) — the debounced snapshot
 * of the collaborative Yjs state rendered back to HTML by the live server.
 * `content` may be large (full page HTML); the bound stays under the 12mb JSON
 * limit configured in main.ts.
 */
export const SnapshotContentSchema = z.object({
  content: z.string().max(5_000_000),
  editedBy: objectId.optional(),
});
export type SnapshotContentDto = z.infer<typeof SnapshotContentSchema>;
