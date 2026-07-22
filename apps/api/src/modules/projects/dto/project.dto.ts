import { z } from 'zod';

const HEX = /^#[0-9a-f]{6}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  desc: z.string().max(500).default(''),
  visibility: z.enum(['private', 'internal', 'public']).default('private'),
  color: z.string().regex(HEX).default('#6366f1'),
  // Cover image URL (ADR 0010 §3). Any https URL, not just Unsplash — it is
  // rendered as an <img src>, never HTML. null clears the cover.
  coverImage: z.string().url().startsWith('https://').max(2000).nullable().optional(),
  memberEmails: z.array(z.string().email()).default([]),
  // The workspace to create into (ADR 0006). Optional for backward compatibility:
  // omitting it keeps the legacy `workspaceId: null` behavior, where the project
  // is invisible to workspace peers until the next boot backfill.
  workspaceId: z.string().regex(OBJECT_ID).optional(),
});
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

// `workspaceId` is create-only: moving a project between workspaces is the
// instance-admin's assign/unassign path, not a project edit. Omitted rather than
// silently ignored so the contract doesn't advertise a no-op field.
export const UpdateProjectSchema = CreateProjectSchema.omit({
  workspaceId: true,
}).partial();
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

const OverviewBlockSchema = z.object({
  type: z.enum([
    'text',
    'heading',
    'check',
    'code',
    'image',
    'video',
    'divider',
    'table',
    'file',
  ]),
  value: z.string().default(''),
  checked: z.boolean().optional(),
  lang: z.string().optional(),
  color: z.string().optional(),
  table: z.record(z.string(), z.unknown()).optional(),
  fileId: z.string().optional(),
  fileViewSize: z.string().optional(),
});

export const UpdateOverviewSchema = z.object({
  overview: z.array(OverviewBlockSchema),
});
export type UpdateOverviewDto = z.infer<typeof UpdateOverviewSchema>;

const BoardListSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60).trim(),
  color: z.string().max(20).default('#94a3b8'),
  wipLimit: z.number().int().min(0).nullable().default(null),
  collapsed: z.boolean().default(false),
});

export const UpdateBoardSchema = z.object({
  boardLists: z.array(BoardListSchema).max(30),
});
export type UpdateBoardDto = z.infer<typeof UpdateBoardSchema>;

export const DuplicateListSchema = z.object({
  name: z.string().min(1).max(60).trim(),
});
export type DuplicateListDto = z.infer<typeof DuplicateListSchema>;
