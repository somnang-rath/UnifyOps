import { z } from 'zod';

export const ISSUE_TYPES = ['bug', 'feature', 'task', 'docs'] as const;
export const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const TodoItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  done: z.boolean().default(false),
});

export const CreateIssueSchema = z.object({
  projectId: objectId.optional().nullable(),
  title: z.string().min(1).max(200).trim(),
  desc: z.string().max(10_000).default(''),
  type: z.enum(ISSUE_TYPES).default('task'),
  status: z.string().min(1).default('todo'),
  priority: z.enum(ISSUE_PRIORITIES).default('medium'),
  assigneeId: objectId.optional().nullable(),
  dueDate: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional()
    .nullable(),
  labels: z.array(z.string().min(1).max(40)).default([]),
  todos: z.array(TodoItemSchema).default([]),
  /** Parent work item, making this a sub-issue. */
  parentId: objectId.optional().nullable(),
});
export type CreateIssueDto = z.infer<typeof CreateIssueSchema>;

export const UpdateIssueSchema = CreateIssueSchema.partial();
export type UpdateIssueDto = z.infer<typeof UpdateIssueSchema>;

export const RELATION_TYPES = ['blocks', 'relates_to', 'duplicate'] as const;

export const CreateRelationSchema = z.object({
  targetId: objectId,
  type: z.enum(RELATION_TYPES),
});
export type CreateRelationDto = z.infer<typeof CreateRelationSchema>;

export const ListIssueQuerySchema = z.object({
  projectId: objectId.optional(),
  /**
   * ADR 0011 §2b: absent → personal cross-project scope (readable projects +
   * own personal issues); present → readable projects in that workspace only.
   */
  workspaceId: objectId.optional(),
  assigneeId: objectId.optional(),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListIssueQuery = z.infer<typeof ListIssueQuerySchema>;

/**
 * One CSV import row (Phase 8 workstream B). `status`/`priority`/`dueDate`
 * are deliberately loose strings here: an invalid value must skip THAT row
 * with a reason, not 400 the whole import — the service validates per row.
 */
export const ImportIssueRowSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(10_000).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string().min(1).max(40)).optional(),
  dueDate: z.string().optional(),
  assigneeEmail: z.string().optional(),
});
export type ImportIssueRow = z.infer<typeof ImportIssueRowSchema>;

export const ImportIssuesSchema = z.object({
  projectId: objectId,
  rows: z.array(ImportIssueRowSchema).min(1).max(500),
});
export type ImportIssuesDto = z.infer<typeof ImportIssuesSchema>;

export const CommentSchema = z.object({
  body: z.string().min(1).max(50_000),
});
export type CommentDto = z.infer<typeof CommentSchema>;

export const CalendarRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  /** ADR 0011 §2b: same scoping semantics as `GET /issues`. */
  workspaceId: objectId.optional(),
});
export type CalendarRangeQuery = z.infer<typeof CalendarRangeSchema>;
