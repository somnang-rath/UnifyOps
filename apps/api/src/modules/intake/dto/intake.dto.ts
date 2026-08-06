import { z } from 'zod';
import { ISSUE_PRIORITIES } from '../../issues/dto/issue.dto';

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

/**
 * Accepting pre-fills from the AI suggestion stored on the submission (ADR
 * 0015 §2.5); these optional fields are the "accept with edits" path, and each
 * one given overrides the suggestion for that field only. Omitting them all is
 * "accept as proposed", which stays a single click.
 */
export const TriageSchema = z.object({
  action: z.enum(['accept', 'decline']),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  labels: z.array(z.string().min(1).max(40)).max(10).optional(),
  assigneeId: objectId.nullable().optional(),
});
export type TriageDto = z.infer<typeof TriageSchema>;

export const ListFormsQuerySchema = z.object({
  projectId: objectId,
});
export type ListFormsQuery = z.infer<typeof ListFormsQuerySchema>;
