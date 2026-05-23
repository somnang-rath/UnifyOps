import { z } from 'zod';

export const ColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  color: z.string().min(1).max(20),
  collapsed: z.boolean().default(false),
  builtin: z.boolean().default(false),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
});

export const ColumnsBodySchema = z.object({
  columns: z.array(ColumnSchema).min(1).max(20),
});
export type ColumnsBody = z.infer<typeof ColumnsBodySchema>;

export const PositionBodySchema = z.object({
  issueId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  columnId: z.string().min(1),
});
export type PositionBody = z.infer<typeof PositionBodySchema>;
