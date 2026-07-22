'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type AnalyticsRange = '4w' | '12w' | '24w';

export const ANALYTICS_RANGES = ['4w', '12w', '24w'] as const;
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = '12w';

/** `GET /api/v1/workspaces/:id/analytics?projectId=&range=` — frozen contract. */
export interface WorkspaceAnalytics {
  totals: { open: number; completed: number; overdue: number };
  byState: { key: string; count: number }[];
  byPriority: { key: string; count: number }[];
  /** `key` is a userId, or the literal `'unassigned'`. */
  byAssignee: { key: string; name: string; avatar?: string | null; count: number }[];
  /** `weekStart` is an ISO Monday; oldest → newest, zero-filled weeks included. */
  trend: { weekStart: string; created: number; completed: number }[];
}

const analyticsService = {
  get: (workspaceId: string, projectId: string | undefined, range: AnalyticsRange) =>
    api
      .get<WorkspaceAnalytics>(`/workspaces/${workspaceId}/analytics`, {
        params: { ...(projectId ? { projectId } : {}), range },
      })
      .then((r) => r.data),
};

/**
 * One endpoint, one query — the whole analytics page shares a single
 * loading/error lifecycle. `keepPreviousData` keeps the old numbers on screen
 * while a filter change refetches (the page dims via `isFetching` instead of
 * flashing skeletons).
 */
export function useWorkspaceAnalytics({
  workspaceId,
  projectId,
  range,
}: {
  workspaceId: string | null;
  projectId?: string;
  range: AnalyticsRange;
}) {
  return useQuery({
    queryKey: ['analytics', workspaceId, projectId ?? '', range],
    queryFn: () => analyticsService.get(workspaceId!, projectId, range),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  });
}
