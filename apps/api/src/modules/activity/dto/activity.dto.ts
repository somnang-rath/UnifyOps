import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const ListActivitySchema = z.object({
  projectId: objectId.optional(),
  /**
   * ADR 0011 §2b: present → only rows from readable projects in that
   * workspace (project-less rows never appear under a workspace).
   */
  workspaceId: objectId.optional(),
  userId: objectId.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListActivityDto = z.infer<typeof ListActivitySchema>;
