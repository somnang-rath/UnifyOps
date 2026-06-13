'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateErrorLogPayload,
  ErrorLog,
  ErrorLogListResult,
  ErrorLogQuery,
  ErrorLogStats,
} from '@/schemas/error-log';

const svc = {
  list: (q: ErrorLogQuery) =>
    api.get<ErrorLogListResult>('/error-logs', { params: q }).then((r) => r.data),
  stats: () => api.get<ErrorLogStats>('/error-logs/stats').then((r) => r.data),
  byId: (id: string) => api.get<ErrorLog>(`/error-logs/${id}`).then((r) => r.data),
  resolve: (id: string) =>
    api.patch<ErrorLog>(`/error-logs/${id}/resolve`).then((r) => r.data),
  remove: (id: string) => api.delete(`/error-logs/${id}`).then((r) => r.data),
  bulkResolve: (ids: string[]) =>
    api.post('/error-logs/bulk/resolve', { ids }).then((r) => r.data),
  bulkDelete: (ids: string[]) =>
    api.post('/error-logs/bulk/delete', { ids }).then((r) => r.data),
  create: (payload: CreateErrorLogPayload) =>
    api.post<ErrorLog>('/error-logs', payload).then((r) => r.data),
  getRetention: () =>
    api.get<{ retentionDays: number }>('/error-logs/settings/retention').then((r) => r.data),
  updateRetention: (retentionDays: number) =>
    api
      .patch<{ retentionDays: number }>('/error-logs/settings/retention', { retentionDays })
      .then((r) => r.data),
};

export const useErrorLogs = (q: ErrorLogQuery) =>
  useQuery({
    queryKey: ['error-logs', q],
    queryFn: () => svc.list(q),
    placeholderData: (prev) => prev,
  });

export const useErrorLogStats = () =>
  useQuery({
    queryKey: ['error-logs-stats'],
    queryFn: svc.stats,
    refetchInterval: 30_000,
  });

export const useErrorLogById = (id: string | null) =>
  useQuery({
    queryKey: ['error-logs', 'byId', id],
    queryFn: () => svc.byId(id!),
    enabled: !!id,
  });

export const useRetentionSettings = () =>
  useQuery({
    queryKey: ['error-logs-retention'],
    queryFn: svc.getRetention,
  });

export function useErrorLogMutations() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['error-logs'] });
    qc.invalidateQueries({ queryKey: ['error-logs-stats'] });
  };

  const resolve = useMutation({
    mutationFn: (id: string) => svc.resolve(id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => svc.remove(id),
    onSuccess: invalidate,
  });

  const bulkResolve = useMutation({
    mutationFn: (ids: string[]) => svc.bulkResolve(ids),
    onSuccess: invalidate,
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => svc.bulkDelete(ids),
    onSuccess: invalidate,
  });

  const updateRetention = useMutation({
    mutationFn: (days: number) => svc.updateRetention(days),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['error-logs-retention'] }),
  });

  return { resolve, remove, bulkResolve, bulkDelete, updateRetention };
}

export async function reportFrontendError(payload: CreateErrorLogPayload) {
  try {
    await svc.create(payload);
  } catch {
    /* never throw from error reporter */
  }
}
