'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { MergeRequest, MRListResponse } from '@/schemas/mr';

interface SaveBody {
  title: string;
  desc: string;
  sourceBranch: string;
  targetBranch: string;
  projectId?: string | null;
  reviewerId?: string | null;
}

const mrsService = {
  list: (params: {
    status?: 'open' | 'merged' | 'closed' | 'all';
    projectId?: string;
    q?: string;
  }) =>
    api.get<MRListResponse>('/mrs', { params }).then((r) => r.data),
  byId: (id: string) =>
    api.get<MergeRequest>(`/mrs/${id}`).then((r) => r.data),
  create: (b: SaveBody) =>
    api.post<MergeRequest>('/mrs', b).then((r) => r.data),
  approve: (id: string) =>
    api.patch<MergeRequest>(`/mrs/${id}/approve`).then((r) => r.data),
  reject: (id: string) =>
    api.patch<MergeRequest>(`/mrs/${id}/reject`).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/mrs/${id}`).then((r) => r.data),
};

export const useMRs = (params: Parameters<typeof mrsService.list>[0]) =>
  useQuery({
    queryKey: ['mrs', params],
    queryFn: () => mrsService.list(params),
    placeholderData: (prev) => prev,
  });

export function useMRMutations() {
  const qc = useQueryClient();
  const inv = (msg: string) => () => {
    toast(msg, 'success');
    qc.invalidateQueries({ queryKey: ['mrs'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['badges'] });
  };
  return {
    create: useMutation({
      mutationFn: mrsService.create,
      onSuccess: inv('Approval submitted'),
    }),
    approve: useMutation({
      mutationFn: mrsService.approve,
      onSuccess: inv('Approved!'),
    }),
    reject: useMutation({
      mutationFn: mrsService.reject,
      onSuccess: inv('Approval declined'),
    }),
    remove: useMutation({
      mutationFn: mrsService.remove,
      onSuccess: inv('Approval deleted'),
    }),
  };
}
