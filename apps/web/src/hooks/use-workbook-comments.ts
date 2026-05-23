'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CommentReply {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface WorkbookComment {
  _id: string;
  workbookId: string;
  sheetId: string;
  cellRef: string;
  authorId: string;
  body: string;
  resolved: boolean;
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
}

interface CreateBody {
  sheetId: string;
  cellRef: string;
  body: string;
}

interface UpdateBody {
  body?: string;
  resolved?: boolean;
}

const svc = {
  list: (wbId: string) =>
    api
      .get<WorkbookComment[]>(`/workbooks/${wbId}/comments`)
      .then((r) => r.data),
  create: (wbId: string, body: CreateBody) =>
    api
      .post<WorkbookComment>(`/workbooks/${wbId}/comments`, body)
      .then((r) => r.data),
  update: (wbId: string, cid: string, body: UpdateBody) =>
    api
      .patch<WorkbookComment>(`/workbooks/${wbId}/comments/${cid}`, body)
      .then((r) => r.data),
  remove: (wbId: string, cid: string) =>
    api
      .delete<{ ok: true }>(`/workbooks/${wbId}/comments/${cid}`)
      .then((r) => r.data),
  reply: (wbId: string, cid: string, body: string) =>
    api
      .post<WorkbookComment>(`/workbooks/${wbId}/comments/${cid}/replies`, {
        body,
      })
      .then((r) => r.data),
};

export const useWorkbookComments = (workbookId: string | null) =>
  useQuery({
    queryKey: ['workbooks', 'comments', workbookId],
    queryFn: () => svc.list(workbookId!),
    enabled: !!workbookId,
  });

export function useCommentMutations(workbookId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['workbooks', 'comments', workbookId] });
  return {
    create: useMutation({
      mutationFn: (body: CreateBody) => svc.create(workbookId, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ cid, body }: { cid: string; body: UpdateBody }) =>
        svc.update(workbookId, cid, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (cid: string) => svc.remove(workbookId, cid),
      onSuccess: invalidate,
    }),
    reply: useMutation({
      mutationFn: ({ cid, body }: { cid: string; body: string }) =>
        svc.reply(workbookId, cid, body),
      onSuccess: invalidate,
    }),
  };
}
