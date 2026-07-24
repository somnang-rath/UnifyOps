import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const CreateIntakeFormSchema = z.object({
  projectId: objectId,
  title: z.string().min(1).max(120).trim(),
  description: z.string().max(2000).default(''),
  /** Publish immediately under this public slug. */
  anchor: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Anchor may contain a-z, 0-9 and hyphens only')
    .optional(),
});
export type CreateIntakeFormDto = z.infer<typeof CreateIntakeFormSchema>;

export const UpdateIntakeFormSchema = z.object({
  title: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(2000).optional(),
  anchor: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .nullable()
    .optional(),
  isOpen: z.boolean().optional(),
});
export type UpdateIntakeFormDto = z.infer<typeof UpdateIntakeFormSchema>;

/** Anonymous, public submission — the only body an unauthenticated user sends. */
export const SubmitIntakeSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(10_000).default(''),
  submitterEmail: z.string().email().max(200).optional(),
});
export type SubmitIntakeDto = z.infer<typeof SubmitIntakeSchema>;

export const TriageSchema = z.object({
  action: z.enum(['accept', 'decline']),
});
export type TriageDto = z.infer<typeof TriageSchema>;

export const ListFormsQuerySchema = z.object({
  projectId: objectId,
});
export type ListFormsQuery = z.infer<typeof ListFormsQuerySchema>;
