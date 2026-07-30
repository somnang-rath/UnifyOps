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
  /**
   * Scope to one cycle, or to the unscheduled backlog with the literal
   * `none` — the cycle planner needs "what isn't in a sprint yet" and that
   * cannot be expressed as an id.
   */
  cycleId: objectId.or(z.literal('none')).optional(),
  /** As `cycleId`, for feature modules. */
  moduleId: objectId.or(z.literal('none')).optional(),
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

/**
 * Bulk edit from the issues list (Phase 7b). The selection travels in the
 * body, never the URL — selection is ephemeral UI state (ADR 0011 §4).
 *
 * Labels are add/remove rather than a replacement list: a single `labels`
 * array applied across a mixed selection would silently wipe labels the user
 * never looked at.
 */
export const BulkPatchSchema = z
  .object({
    status: z.string().min(1).max(40).optional(),
    priority: z.enum(ISSUE_PRIORITIES).optional(),
    type: z.enum(ISSUE_TYPES).optional(),
    assigneeId: objectId.nullable().optional(),
    dueDate: z
      .string()
      .datetime()
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .nullable()
      .optional(),
    addLabels: z.array(z.string().min(1).max(40)).max(20).optional(),
    removeLabels: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: 'patch must set at least one field',
  });
export type BulkPatchDto = z.infer<typeof BulkPatchSchema>;

/** Same 100-id ceiling on both bulk routes — one screen's worth of selection. */
const bulkIds = z.array(objectId).min(1).max(100);

export const BulkUpdateIssuesSchema = z.object({
  ids: bulkIds,
  patch: BulkPatchSchema,
});
export type BulkUpdateIssuesDto = z.infer<typeof BulkUpdateIssuesSchema>;

export const BulkDeleteIssuesSchema = z.object({ ids: bulkIds });
export type BulkDeleteIssuesDto = z.infer<typeof BulkDeleteIssuesSchema>;

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
