import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const CreateMRSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  desc: z.string().max(5_000).default(''),
  sourceBranch: z.string().min(1).max(120).trim(),
  targetBranch: z.string().min(1).max(120).default('main'),
  projectId: objectId.optional().nullable(),
  reviewerId: objectId.optional().nullable(),
});
export type CreateMRDto = z.infer<typeof CreateMRSchema>;

export const ListMRQuerySchema = z.object({
  status: z.enum(['open', 'merged', 'closed', 'all']).default('all'),
  projectId: objectId.optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMRQuery = z.infer<typeof ListMRQuerySchema>;

export const AddMRCommentSchema = z.object({
  body: z.string().min(1).max(5_000).trim(),
});
export type AddMRCommentDto = z.infer<typeof AddMRCommentSchema>;
