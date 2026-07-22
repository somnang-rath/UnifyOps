import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const SaveWikiSchema = z.object({
  projectId: objectId,
  title: z.string().min(1).max(200).trim(),
  content: z.string().max(200_000).default(''),
  parentId: objectId.optional().nullable(),
  // Cover image URL (ADR 0010 §3). Any https URL, not just Unsplash — it is
  // rendered as an <img src>, never HTML. null clears the cover.
  coverImage: z.string().url().startsWith('https://').max(2000).nullable().optional(),
});
export type SaveWikiDto = z.infer<typeof SaveWikiSchema>;

export const UpdateWikiSchema = SaveWikiSchema.omit({
  projectId: true,
}).partial();
export type UpdateWikiDto = z.infer<typeof UpdateWikiSchema>;

export const ListWikiQuerySchema = z.object({
  projectId: objectId,
  q: z.string().trim().optional(),
});
export type ListWikiQuery = z.infer<typeof ListWikiQuerySchema>;
