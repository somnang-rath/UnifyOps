import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const VIEW_LAYOUTS = [
  'list',
  'kanban',
  'calendar',
  'timeline',
  'spreadsheet',
] as const;

/**
 * The recognised filter keys. Unknown keys are stripped rather than rejected so
 * a newer client sending a filter this server does not yet understand degrades
 * gracefully instead of erroring (ADR 0009).
 */
export const ViewFiltersSchema = z
  .object({
    status: z.string().max(60).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    type: z.enum(['bug', 'feature', 'task', 'docs']).optional(),
    assigneeId: objectId.optional(),
    labels: z.array(z.string().max(60)).max(50).optional(),
    q: z.string().max(200).optional(),
  })
  .strip();

export const CreateViewSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  /** Omit / null for a workspace-level view. */
  projectId: objectId.nullable().optional(),
  /** Required when projectId is omitted, so the view has a home workspace. */
  workspaceId: objectId.optional(),
  layout: z.enum(VIEW_LAYOUTS).default('list'),
  filters: ViewFiltersSchema.default({}),
  groupBy: z.string().max(40).nullable().default(null),
  sortBy: z.string().max(60).default('updatedAt:desc'),
  displayProperties: z.array(z.string().max(40)).max(30).default([]),
  isShared: z.boolean().default(false),
});
export type CreateViewDto = z.infer<typeof CreateViewSchema>;

export const UpdateViewSchema = CreateViewSchema.partial().omit({
  projectId: true,
  workspaceId: true,
});
export type UpdateViewDto = z.infer<typeof UpdateViewSchema>;

export const ListViewsQuerySchema = z.object({
  /** Scope to one project's views; omit for workspace-level views. */
  projectId: objectId.optional(),
  workspaceId: objectId.optional(),
});
export type ListViewsQuery = z.infer<typeof ListViewsQuerySchema>;

export const ReorderViewsSchema = z.object({
  /** View ids in their new order. */
  ids: z.array(objectId).min(1).max(200),
});
export type ReorderViewsDto = z.infer<typeof ReorderViewsSchema>;
