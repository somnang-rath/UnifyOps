import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * Accepts a full ISO instant or a bare `YYYY-MM-DD`, mirroring
 * `CreateIssueSchema.dueDate` — the web date input emits the bare form. The
 * service normalises: start → 00:00, end → 23:59:59.999, so a same-day cycle
 * is a real interval rather than a zero-length one.
 */
const dateish = z
  .string()
  .datetime()
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const CYCLE_STATUSES = [
  'draft',
  'upcoming',
  'current',
  'completed',
] as const;

export const CreateCycleSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(2000).default(''),
  /** Cycles are project-scoped, always — there is no workspace-level cycle. */
  projectId: objectId,
  startDate: dateish.nullable().optional(),
  endDate: dateish.nullable().optional(),
});
export type CreateCycleDto = z.infer<typeof CreateCycleSchema>;

/** `projectId` is omitted: moving a cycle between projects would strand its issues. */
export const UpdateCycleSchema = CreateCycleSchema.partial().omit({
  projectId: true,
});
export type UpdateCycleDto = z.infer<typeof UpdateCycleSchema>;

export const ListCyclesQuerySchema = z.object({
  projectId: objectId.optional(),
  /** Omit both and the caller gets cycles across every project they can read. */
  workspaceId: objectId.optional(),
  status: z.enum(CYCLE_STATUSES).optional(),
});
export type ListCyclesQuery = z.infer<typeof ListCyclesQuerySchema>;

/**
 * Bulk assign work items to a cycle. Capped at the same 200 the issues list
 * pages at — a bigger selection is a scripted import, not a UI action.
 */
export const AssignIssuesSchema = z.object({
  issueIds: z.array(objectId).min(1).max(200),
});
export type AssignIssuesDto = z.infer<typeof AssignIssuesSchema>;

export const ReorderCyclesSchema = z.object({
  ids: z.array(objectId).min(1).max(200),
});
export type ReorderCyclesDto = z.infer<typeof ReorderCyclesSchema>;
