import { z } from 'zod';

export const CreateCommentSchema = z.object({
  sheetId: z.string().min(1).max(40),
  cellRef: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z]+\d+$/),
  body: z.string().min(1).max(4000).trim(),
});
export type CreateCommentDto = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(4000).trim().optional(),
  resolved: z.boolean().optional(),
});
export type UpdateCommentDto = z.infer<typeof UpdateCommentSchema>;

export const ReplyCommentSchema = z.object({
  body: z.string().min(1).max(4000).trim(),
});
export type ReplyCommentDto = z.infer<typeof ReplyCommentSchema>;
