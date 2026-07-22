import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Trend window sizes. Validated + capped — anything else is a 400. */
export const ANALYTICS_RANGES = ['4w', '12w', '24w'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_RANGE_WEEKS: Record<AnalyticsRange, number> = {
  '4w': 4,
  '12w': 12,
  '24w': 24,
};

export const AnalyticsQuerySchema = z.object({
  /** Narrow to one project — must belong to the workspace (404 otherwise). */
  projectId: objectId.optional(),
  /** Applies to `trend` only; totals/breakdowns are current-state. */
  range: z.enum(ANALYTICS_RANGES).default('12w'),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

// ── Response shape (frozen contract — apps/web builds against this) ──

export interface AnalyticsBucket {
  key: string;
  count: number;
}

export interface AnalyticsAssigneeBucket extends AnalyticsBucket {
  /** `key` is a userId, or the literal 'unassigned'. */
  name: string;
}

export interface AnalyticsTrendPoint {
  /** ISO date (YYYY-MM-DD) of the ISO week's Monday, UTC. Oldest → newest. */
  weekStart: string;
  created: number;
  completed: number;
}

export interface WorkspaceAnalytics {
  totals: { open: number; completed: number; overdue: number };
  byState: AnalyticsBucket[];
  byPriority: AnalyticsBucket[];
  byAssignee: AnalyticsAssigneeBucket[];
  trend: AnalyticsTrendPoint[];
}
