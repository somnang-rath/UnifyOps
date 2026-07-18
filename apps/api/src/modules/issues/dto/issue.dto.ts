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
  assigneeId: objectId.optional(),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListIssueQuery = z.infer<typeof ListIssueQuerySchema>;

export const CommentSchema = z.object({
  body: z.string().min(1).max(50_000),
});
export type CommentDto = z.infer<typeof CommentSchema>;

export const CalendarRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
});
export type CalendarRangeQuery = z.infer<typeof CalendarRangeSchema>;
