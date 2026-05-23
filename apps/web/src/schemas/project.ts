import { z } from 'zod';

export const VISIBILITY = ['private', 'internal', 'public'] as const;
export const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#14b8a6', '#a855f7',
] as const;

export const ProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(80, 'Max 80 characters'),
  desc: z.string().max(500, 'Max 500 characters').optional().default(''),
  visibility: z.enum(VISIBILITY),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Pick a color'),
  membersRaw: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) =>
        !v
          ? true
          : v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
      { message: 'One or more emails are invalid' },
    ),
});
export type ProjectFormInput = z.infer<typeof ProjectFormSchema>;

export interface Project {
  _id: string;
  name: string;
  desc: string;
  namespace: string;
  visibility: (typeof VISIBILITY)[number];
  color: string;
  ownerId: string;
  members: string[];
  issueCount?: number;
  doneCount?: number;
  createdAt: string;
  updatedAt: string;
}
