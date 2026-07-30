import { z } from 'zod';
import { MODULE_STATUSES } from '../schemas/module.schema';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Full ISO instant or a bare `YYYY-MM-DD`, as `CreateIssueSchema.dueDate`. */
const dateish = z
  .string()
  .datetime()
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const CreateModuleSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(2000).default(''),
  /** Modules are project-scoped, always. */
  projectId: objectId,
  leadId: objectId.nullable().optional(),
  memberIds: z.array(objectId).max(100).default([]),
  /**
   * Unlike a cycle these are independently optional: "ship by March, start
   * whenever" is a normal way to plan a feature.
   */
  startDate: dateish.nullable().optional(),
  targetDate: dateish.nullable().optional(),
  status: z.enum(MODULE_STATUSES).default('backlog'),
});
export type CreateModuleDto = z.infer<typeof CreateModuleSchema>;

/** `projectId` is omitted: moving a module would strand its work items. */
export const UpdateModuleSchema = CreateModuleSchema.partial().omit({
  projectId: true,
});
export type UpdateModuleDto = z.infer<typeof UpdateModuleSchema>;

export const ListModulesQuerySchema = z.object({
  projectId: objectId.optional(),
  /** Omit both and the caller gets modules across every project they can read. */
  workspaceId: objectId.optional(),
  status: z.enum(MODULE_STATUSES).optional(),
});
export type ListModulesQuery = z.infer<typeof ListModulesQuerySchema>;

export const AssignModuleIssuesSchema = z.object({
  issueIds: z.array(objectId).min(1).max(200),
});
export type AssignModuleIssuesDto = z.infer<typeof AssignModuleIssuesSchema>;

export const ReorderModulesSchema = z.object({
  ids: z.array(objectId).min(1).max(200),
});
export type ReorderModulesDto = z.infer<typeof ReorderModulesSchema>;
