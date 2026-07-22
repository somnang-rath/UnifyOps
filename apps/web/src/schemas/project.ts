import { z } from 'zod';
import type { NoteBlock } from './note';

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

/** A user-defined Kanban column. `id` equals the `status` of the cards in it. */
export interface BoardList {
  id: string;
  name: string;
  color: string;
  wipLimit: number | null;
  collapsed: boolean;
}

export interface Project {
  _id: string;
  name: string;
  desc: string;
  namespace: string;
  visibility: (typeof VISIBILITY)[number];
  color: string;
  ownerId: string;
  /** The workspace this project belongs to. Null for pre-ADR-0006 orphans. */
  workspaceId: string | null;
  members: string[];
  /** Block-based Overview document. Present only on the single-project fetch, not the list. */
  overview?: NoteBlock[];
  /** Custom board columns. Empty/absent → client falls back to the default lists. */
  boardLists?: BoardList[];
  /** Hotlinked cover URL (ADR 0010). Absent on pre-ADR documents. */
  coverImage?: string | null;
  issueCount?: number;
  doneCount?: number;
  createdAt: string;
  updatedAt: string;
}
