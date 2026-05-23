import { z } from 'zod';

const HEX = /^#[0-9a-f]{6}$/i;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  desc: z.string().max(500).default(''),
  visibility: z.enum(['private', 'internal', 'public']).default('private'),
  color: z.string().regex(HEX).default('#6366f1'),
  memberEmails: z.array(z.string().email()).default([]),
});
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial();
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
