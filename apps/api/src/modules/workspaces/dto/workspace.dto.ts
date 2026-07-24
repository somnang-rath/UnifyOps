import { z } from 'zod';

const HEX = /^#[0-9a-f]{6}$/i;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  // Optional — derived from the name when omitted.
  slug: z.string().min(1).max(60).regex(SLUG).optional(),
  desc: z.string().max(500).default(''),
  color: z.string().regex(HEX).default('#6366f1'),
  memberEmails: z.array(z.string().email()).default([]),
});
export type CreateWorkspaceDto = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial();
export type UpdateWorkspaceDto = z.infer<typeof UpdateWorkspaceSchema>;

export const AddMemberSchema = z.object({
  email: z.string().email(),
});
export type AddMemberDto = z.infer<typeof AddMemberSchema>;
