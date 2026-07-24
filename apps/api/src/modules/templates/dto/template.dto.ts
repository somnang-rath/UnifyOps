import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '../../issues/dto/issue.dto';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const TemplateTodoSchema = z.object({
  text: z.string().min(1).max(500),
  done: z.boolean().default(false),
});

/** Mirrors the Issue schema's field names/enums (desc, type, priority, …). */
export const TemplateDefaultsSchema = z.object({
  desc: z.string().max(10_000).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  labels: z.array(z.string().min(1).max(40)).optional(),
  todos: z.array(TemplateTodoSchema).optional(),
});

export const CreateTemplateSchema = z.object({
  /** Required when projectId is absent (workspace-level template); otherwise derived from the project. */
  workspaceId: objectId.optional().nullable(),
  /** null/absent = workspace-level template. */
  projectId: objectId.optional().nullable(),
  name: z.string().min(1).max(120).trim(),
  defaults: TemplateDefaultsSchema.default({}),
});
export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  defaults: TemplateDefaultsSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;

export const ListTemplatesQuerySchema = z.object({
  workspaceId: objectId,
  /** When given: that project's templates + the workspace-level ones. */
  projectId: objectId.optional(),
});
export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
