'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { BoardColumn, KanbanBoard } from '@/schemas/kanban';

const kanbanService = {
  myBoard: () =>
    api.get<KanbanBoard>('/kanban/board/me').then((r) => r.data),
  board: (userId: string) =>
    api.get<KanbanBoard>(`/kanban/board/${userId}`).then((r) => r.data),
  saveColumns: (columns: BoardColumn[]) =>
    api
      .patch<KanbanBoard>('/kanban/board/me', { columns })
      .then((r) => r.data),
  myPositions: () =>
    api
      .get<Record<string, string>>('/kanban/positions/me')
      .then((r) => r.data),
  positions: (userId: string) =>
    api
      .get<Record<string, string>>(`/kanban/positions/${userId}`)
      .then((r) => r.data),
  setPosition: (issueId: string, columnId: string) =>
    api
      .patch('/kanban/positions/me', { issueId, columnId })
      .then((r) => r.data),
};

export const useBoard = (userId?: string) => {
  const meId = useAuthStore((s) => s.user?.id);
  const target = userId ?? meId;
  const isMine = !userId || userId === meId;
  return useQuery({
    queryKey: ['kanban', 'board', target],
    queryFn: () =>
      isMine ? kanbanService.myBoard() : kanbanService.board(target!),
    enabled: !!target,
  });
};

export const usePositions = (userId?: string) => {
  const meId = useAuthStore((s) => s.user?.id);
  const target = userId ?? meId;
  const isMine = !userId || userId === meId;
  return useQuery({
    queryKey: ['kanban', 'positions', target],
    queryFn: () =>
      isMine
        ? kanbanService.myPositions()
        : kanbanService.positions(target!),
    enabled: !!target,
  });
};

export function useKanbanMutations() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  return {
    saveColumns: useMutation({
      mutationFn: kanbanService.saveColumns,
      // Optimistic — the demo's localStorage write is synchronous, so the
      // React UI needs to feel the same: rename/colour/collapse/duplicate/
      // delete/add/reorder should reflect instantly.
      onMutate: async (next: BoardColumn[]) => {
        const key = ['kanban', 'board', meId];
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<KanbanBoard>(key);
        if (prev) {
          qc.setQueryData<KanbanBoard>(key, { ...prev, columns: next });
        }
        return { prev };
      },
      onError: (_e, _next, ctx) => {
        if (ctx?.prev) qc.setQueryData(['kanban', 'board', meId], ctx.prev);
      },
      onSettled: () =>
        qc.invalidateQueries({ queryKey: ['kanban', 'board', meId] }),
    }),
    setPosition: useMutation({
      mutationFn: ({
        issueId,
        columnId,
      }: {
        issueId: string;
        columnId: string;
      }) => kanbanService.setPosition(issueId, columnId),
      onMutate: async ({ issueId, columnId }) => {
        const key = ['kanban', 'positions', meId];
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<Record<string, string>>(key);
        qc.setQueryData<Record<string, string>>(key, (m) => ({
          ...(m ?? {}),
          [issueId]: columnId,
        }));
        return { prev };
      },
      onError: (_e, _v, ctx) =>
        ctx?.prev && qc.setQueryData(['kanban', 'positions', meId], ctx.prev),
      onSettled: () =>
        qc.invalidateQueries({ queryKey: ['kanban', 'positions', meId] }),
    }),
  };
}
