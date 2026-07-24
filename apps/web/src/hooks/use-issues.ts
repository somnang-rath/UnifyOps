'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { ImportResult, ImportRow } from '@prism/types';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Issue, IssueTodo, IssueListResponse } from '@/schemas/issue';

export interface IssueListParams {
  status?: 'open' | 'closed' | 'all';
  projectId?: string;
  type?: string;
  priority?: string;
  q?: string;
  assigneeId?: string;
  /**
   * ADR 0011 §2: present → only issues of readable projects in that workspace
   * (personal `projectId: null` issues are dropped by the API); absent →
   * today's personal cross-project list. Part of the query key via `params`.
   */
  workspaceId?: string;
}

interface SaveBody {
  title: string;
  desc: string;
  type: string;
  status: string;
  priority: string;
  projectId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: string[];
  todos: IssueTodo[];
}

const issuesService = {
  list: (params: IssueListParams = {}) =>
    api
      .get<IssueListResponse>('/issues', { params })
      .then((r) => r.data),
  byId: (id: string) => api.get<Issue>(`/issues/${id}`).then((r) => r.data),
  create: (b: SaveBody) =>
    api.post<Issue>('/issues', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody>) =>
    api.patch<Issue>(`/issues/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/issues/${id}`).then((r) => r.data),
  comment: (id: string, body: string) =>
    api.post<Issue>(`/issues/${id}/comments`, { body }).then((r) => r.data),
  import: (projectId: string, rows: ImportRow[]) =>
    api
      .post<ImportResult>('/issues/import', { projectId, rows })
      .then((r) => r.data),
  calendar: (from: string, to: string, workspaceId?: string) =>
    api
      .get<Issue[]>('/issues/calendar/range', {
        params: { from, to, workspaceId },
      })
      .then((r) => r.data),
};

export const useIssues = (params: IssueListParams) =>
  useQuery({
    queryKey: ['issues', params],
    queryFn: () => issuesService.list(params),
    placeholderData: (prev) => prev,
  });

export const useIssue = (id: string | null) =>
  useQuery({
    queryKey: ['issues', 'byId', id],
    queryFn: () => issuesService.byId(id!),
    enabled: !!id,
  });

export const useCalendarIssues = (
  from: string,
  to: string,
  workspaceId?: string,
) =>
  useQuery({
    queryKey: ['calendar', from, to, workspaceId ?? null],
    queryFn: () => issuesService.calendar(from, to, workspaceId),
    enabled: !!from && !!to,
    placeholderData: (prev) => prev,
  });

// Does a list query's params plausibly include this newly-created issue?
// We use this to decide whether to optimistically inject the temp issue.
function queryMatches(params: IssueListParams, body: SaveBody): boolean {
  // A workspace-scoped list never contains personal issues (ADR 0011 §2).
  // Whether a project-linked issue's project is in that workspace can't be
  // told client-side — inject optimistically; the settled invalidate corrects.
  if (params.workspaceId && !body.projectId) return false;
  if (params.projectId && params.projectId !== (body.projectId ?? undefined))
    return false;
  if (
    params.assigneeId &&
    params.assigneeId !== (body.assigneeId ?? undefined)
  )
    return false;
  if (params.type && params.type !== body.type) return false;
  if (params.priority && params.priority !== body.priority) return false;
  if (params.status === 'open' && body.status === 'done') return false;
  if (params.status === 'closed' && body.status !== 'done') return false;
  if (params.q) {
    const needle = params.q.toLowerCase();
    const hay = (body.title + ' ' + body.desc).toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/**
 * CSV bulk import (templates-csv-import spec §1/§4): one request, all rows
 * attempted, per-row skip — never half-crashed. The dialog owns success/error
 * rendering (result step), so no toast here; the lists refetch on success.
 */
export function useIssueImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      rows,
    }: {
      projectId: string;
      rows: ImportRow[];
    }) => issuesService.import(projectId, rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

export function useIssueMutations() {
  const qc = useQueryClient();
  const onDone = (msg: string) => () => {
    toast(msg, 'success');
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  return {
    create: useMutation({
      mutationFn: issuesService.create,
      onMutate: async (body) => {
        await qc.cancelQueries({ queryKey: ['issues'] });

        const tempId = 'temp_' + Math.random().toString(36).slice(2, 10);
        const now = new Date().toISOString();
        const optimistic: Issue = {
          _id: tempId,
          title: body.title,
          desc: body.desc,
          type: body.type as Issue['type'],
          status: body.status,
          priority: body.priority as Issue['priority'],
          projectId: body.projectId ?? undefined,
          assigneeId: body.assigneeId ?? undefined,
          authorId: '',
          dueDate: body.dueDate ?? undefined,
          labels: body.labels,
          todos: body.todos,
          comments: [],
          createdAt: now,
          updatedAt: now,
        };

        const prev: Array<[QueryKey, IssueListResponse]> = [];
        const queries = qc.getQueriesData<IssueListResponse>({
          queryKey: ['issues'],
        });
        for (const [key, data] of queries) {
          // Only the list queries: ['issues', params] (skip ['issues','byId',id])
          if (key.length !== 2 || typeof key[1] !== 'object' || !key[1]) continue;
          if (!data) continue;
          const params = key[1] as IssueListParams;
          if (!queryMatches(params, body)) continue;
          prev.push([key, data]);
          const isDone = body.status === 'done';
          qc.setQueryData<IssueListResponse>(key, {
            items: [optimistic, ...data.items],
            totals: {
              open: data.totals.open + (isDone ? 0 : 1),
              closed: data.totals.closed + (isDone ? 1 : 0),
              all: data.totals.all + 1,
            },
          });
        }
        return { prev, tempId };
      },
      onError: (_e, _body, ctx) => {
        if (!ctx) return;
        for (const [key, data] of ctx.prev) qc.setQueryData(key, data);
      },
      onSuccess: () => toast('Issue created', 'success'),
      onSettled: () => {
        qc.invalidateQueries({ queryKey: ['issues'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['calendar'] });
      },
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<SaveBody> }) =>
        issuesService.update(id, body),
      // Optimistically patch every cached issue (list rows + detail) so quick
      // edits — e.g. ticking a checklist item on a Kanban card — feel instant.
      onMutate: async ({ id, body }) => {
        await qc.cancelQueries({ queryKey: ['issues'] });
        await qc.cancelQueries({ queryKey: ['calendar'] });
        const prev: Array<[QueryKey, unknown]> = [];
        for (const [key, data] of qc.getQueriesData({ queryKey: ['issues'] })) {
          if (!data) continue;
          // Detail cache: ['issues','byId',id]
          if (key.length === 3 && key[1] === 'byId') {
            if (key[2] === id) {
              prev.push([key, data]);
              qc.setQueryData(key, { ...(data as Issue), ...body });
            }
            continue;
          }
          // List cache: ['issues', params]
          if (key.length === 2 && typeof key[1] === 'object') {
            const list = data as IssueListResponse;
            if (!list.items?.some((i) => i._id === id)) continue;
            prev.push([key, list]);
            qc.setQueryData<IssueListResponse>(key, {
              ...list,
              items: list.items.map((i) =>
                i._id === id ? ({ ...i, ...body } as Issue) : i,
              ),
            });
          }
        }
        // Calendar caches: ['calendar', from, to] hold a flat Issue[] — patch in
        // place so a drag-reschedule (dueDate change) moves the chip instantly.
        for (const [key, data] of qc.getQueriesData<Issue[]>({
          queryKey: ['calendar'],
        })) {
          if (!Array.isArray(data) || !data.some((i) => i._id === id)) continue;
          prev.push([key, data]);
          qc.setQueryData<Issue[]>(
            key,
            data.map((i) => (i._id === id ? ({ ...i, ...body } as Issue) : i)),
          );
        }
        return { prev };
      },
      onError: (_e, _vars, ctx) => {
        for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      },
      onSuccess: (issue) => {
        qc.setQueryData(['issues', 'byId', issue._id], issue);
        qc.invalidateQueries({ queryKey: ['issues'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['calendar'] });
      },
    }),
    remove: useMutation({
      mutationFn: issuesService.remove,
      onSuccess: onDone('Issue deleted'),
    }),
    comment: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) =>
        issuesService.comment(id, body),
      onSuccess: (issue) => {
        qc.setQueryData(['issues', 'byId', issue._id], issue);
      },
    }),
  };
}
