'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { BoardList, Project } from '@/schemas/project';
import type { NoteBlock } from '@/schemas/note';

interface SaveBody {
  name: string;
  desc: string;
  visibility: 'private' | 'internal' | 'public';
  color: string;
  memberEmails: string[];
}

/**
 * `workspaceId` is create-only (ADR 0006): moving a project between workspaces is
 * the instance-admin's assign/unassign path, and the API's UpdateProjectSchema
 * omits the field. Omitting it here creates a workspace-less orphan that peers
 * can't see, so the create form always sends the current workspace.
 */
interface CreateBody extends SaveBody {
  workspaceId?: string;
}

const projectsService = {
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  listInWorkspace: (workspaceId: string) =>
    api
      .get<Project[]>('/projects', { params: { workspace: workspaceId } })
      .then((r) => r.data),
  byId: (id: string) =>
    api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (b: CreateBody) =>
    api.post<Project>('/projects', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody>) =>
    api.patch<Project>(`/projects/${id}`, b).then((r) => r.data),
  updateOverview: (id: string, overview: NoteBlock[]) =>
    api
      .patch<Project>(`/projects/${id}/overview`, { overview })
      .then((r) => r.data),
  updateBoard: (id: string, boardLists: BoardList[]) =>
    api
      .patch<Project>(`/projects/${id}/board`, { boardLists })
      .then((r) => r.data),
  clearList: (id: string, listId: string) =>
    api
      .post<Project>(`/projects/${id}/board/lists/${listId}/clear`)
      .then((r) => r.data),
  duplicateList: (id: string, listId: string, name: string) =>
    api
      .post<Project>(`/projects/${id}/board/lists/${listId}/duplicate`, { name })
      .then((r) => r.data),
  deleteList: (id: string, listId: string) =>
    api
      .delete<Project>(`/projects/${id}/board/lists/${listId}`)
      .then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/projects/${id}`).then((r) => r.data),
};

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: projectsService.list,
    placeholderData: (prev) => prev,
  });

/**
 * Strict workspace-scoped list (ADR 0006): only projects whose workspaceId
 * matches — unlike {@link useProjects}, a project you own in another workspace
 * does NOT appear here. Pass null to skip.
 */
export const useProjectsInWorkspace = (workspaceId: string | null) =>
  useQuery({
    queryKey: ['projects', 'inWorkspace', workspaceId],
    queryFn: () => projectsService.listInWorkspace(workspaceId!),
    enabled: !!workspaceId,
    placeholderData: (prev) => prev,
  });

export const useProject = (id: string | null) =>
  useQuery({
    queryKey: ['projects', 'byId', id],
    queryFn: () => projectsService.byId(id!),
    enabled: !!id,
  });

export function useProjectMutations() {
  const qc = useQueryClient();
  const onDone = (msg: string) => () => {
    toast(msg, 'success');
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    create: useMutation({
      mutationFn: projectsService.create,
      onSuccess: onDone('Project created'),
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<SaveBody> }) =>
        projectsService.update(id, body),
      onSuccess: onDone('Project updated'),
    }),
    updateOverview: useMutation({
      mutationFn: ({ id, overview }: { id: string; overview: NoteBlock[] }) =>
        projectsService.updateOverview(id, overview),
      onSuccess: (proj) => {
        qc.setQueryData(['projects', 'byId', proj._id], proj);
        toast('Overview saved', 'success');
      },
    }),
    remove: useMutation({
      mutationFn: projectsService.remove,
      onSuccess: onDone('Project deleted'),
    }),
  };
}

/**
 * Board-column mutations for the Work-items Board view. Kept separate from
 * {@link useProjectMutations} so the board can optimistically write the project
 * cache and refresh issues after card-affecting ops (clear / duplicate / delete).
 */
export function useBoardMutations(projectId: string) {
  const qc = useQueryClient();
  const writeProject = (proj: Project) =>
    qc.setQueryData(['projects', 'byId', projectId], proj);
  const refreshCards = () => qc.invalidateQueries({ queryKey: ['issues'] });
  return {
    updateBoard: useMutation({
      mutationFn: (boardLists: BoardList[]) =>
        projectsService.updateBoard(projectId, boardLists),
      // Optimistically patch the cached project so list edits (rename, color,
      // WIP, collapse, add) render instantly instead of after the round-trip.
      onMutate: async (boardLists) => {
        const key = ['projects', 'byId', projectId];
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<Project>(key);
        if (prev) qc.setQueryData<Project>(key, { ...prev, boardLists });
        return { prev };
      },
      onError: (_e, _vars, ctx) => {
        if (ctx?.prev)
          qc.setQueryData(['projects', 'byId', projectId], ctx.prev);
      },
      onSuccess: writeProject,
    }),
    clearList: useMutation({
      mutationFn: (listId: string) =>
        projectsService.clearList(projectId, listId),
      onSuccess: (proj) => {
        writeProject(proj);
        refreshCards();
        toast('Cards cleared', 'success');
      },
    }),
    duplicateList: useMutation({
      mutationFn: ({ listId, name }: { listId: string; name: string }) =>
        projectsService.duplicateList(projectId, listId, name),
      onSuccess: (proj) => {
        writeProject(proj);
        refreshCards();
        toast('List duplicated', 'success');
      },
    }),
    deleteList: useMutation({
      mutationFn: (listId: string) =>
        projectsService.deleteList(projectId, listId),
      onSuccess: (proj) => {
        writeProject(proj);
        refreshCards();
        toast('List deleted', 'success');
      },
    }),
  };
}
