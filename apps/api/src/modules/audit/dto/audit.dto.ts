import { z } from 'zod';

export const ListAuditQuerySchema = z.object({
  /** Prefix match, e.g. `instance.` or `instance.config`. */
  action: z.string().max(120).trim().optional(),
  success: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;
