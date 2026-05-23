import { z } from 'zod';

const COLORS = [
  'indigo',
  'violet',
  'sky',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'slate',
] as const;

export const CreateRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-z][a-z0-9_-]*$/, 'lowercase letters/numbers/_- only')
    .trim()
    .toLowerCase(),
  name: z.string().min(1).max(40).trim(),
  color: z.enum(COLORS).optional(),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().min(1).max(40).trim().optional(),
  color: z.enum(COLORS).optional(),
});
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;
