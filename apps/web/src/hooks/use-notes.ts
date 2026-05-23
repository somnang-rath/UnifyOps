'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type {
  GrantLevel,
  GrantRole,
  Note,
  NoteFolder,
  NoteFolderGrant,
} from '@/schemas/note';

interface SaveBody {
  title: string;
  emoji: string;
  blocks: Note['blocks'];
  tags: string[];
  pinned: boolean;
  folderId: string | null;
}

type GrantTarget = { userId: string } | { role: GrantRole };

const notesService = {
  list: () => api.get<Note[]>('/notes').then((r) => r.data),
  byId: (id: string) => api.get<Note>(`/notes/${id}`).then((r) => r.data),
  create: (b: SaveBody) =>
    api.post<Note>('/notes', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody>, config?: AxiosRequestConfig) =>
    api.patch<Note>(`/notes/${id}`, b, config).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/notes/${id}`).then((r) => r.data),
  listFolders: () =>
    api.get<NoteFolder[]>('/notes/folders').then((r) => r.data),
  createFolder: (b: { name: string; parentId?: string | null }) =>
    api.post<NoteFolder>('/notes/folders', b).then((r) => r.data),
  renameFolder: (id: string, name: string) =>
    api
      .patch<NoteFolder>(`/notes/folders/${id}`, { name })
      .then((r) => r.data),
  removeFolder: (id: string) =>
    api.delete(`/notes/folders/${id}`).then((r) => r.data),
  exportPdf: (id: string) =>
    api
      .get<Blob>(`/notes/${id}/export.pdf`, { responseType: 'blob' })
      .then((r) => r.data),

  listGrants: (folderId: string) =>
    api
      .get<NoteFolderGrant[]>(`/notes/folders/${folderId}/grants`)
      .then((r) => r.data),
  setGrant: (folderId: string, target: GrantTarget, level: GrantLevel) =>
    api
      .put<NoteFolderGrant[]>(`/notes/folders/${folderId}/grants`, {
        ...target,
        level,
      })
      .then((r) => r.data),
  /** `target` is either a user id or a role string — the API dispatches on shape. */
  removeGrant: (folderId: string, target: string) =>
    api
      .delete<NoteFolderGrant[]>(`/notes/folders/${folderId}/grants/${target}`)
      .then((r) => r.data),
};

export const notesApi = notesService;

export const useNotesList = () =>
  useQuery({ queryKey: ['notes'], queryFn: notesService.list });

export const useNoteFolders = () =>
  useQuery({
    queryKey: ['notes', 'folders'],
    queryFn: notesService.listFolders,
  });

export const useNote = (id: string | null) =>
  useQuery({
    queryKey: ['notes', 'byId', id],
    queryFn: () => notesService.byId(id!),
    enabled: !!id,
  });

export const useNoteFolderGrants = (folderId: string | null) =>
  useQuery({
    queryKey: ['notes', 'grants', folderId],
    queryFn: () => notesService.listGrants(folderId!),
    enabled: !!folderId,
  });

export function useNoteMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ['notes'] });
  };
  return {
    create: useMutation({
      mutationFn: notesService.create,
      onSuccess: inv,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        body,
        config,
      }: {
        id: string;
        body: Partial<SaveBody>;
        config?: AxiosRequestConfig;
      }) => notesService.update(id, body, config),
      onSuccess: (n) => {
        qc.setQueryData(['notes', 'byId', n._id], n);
        qc.invalidateQueries({ queryKey: ['notes'], exact: true });
      },
    }),
    remove: useMutation({
      mutationFn: notesService.remove,
      onSuccess: () => {
        inv();
        toast('Note deleted', 'success');
      },
    }),
    createFolder: useMutation({
      mutationFn: notesService.createFolder,
      onSuccess: inv,
    }),
    renameFolder: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        notesService.renameFolder(id, name),
      onSuccess: inv,
    }),
    removeFolder: useMutation({
      mutationFn: notesService.removeFolder,
      onSuccess: inv,
    }),
    setGrant: useMutation({
      mutationFn: ({
        folderId,
        target,
        level,
      }: {
        folderId: string;
        target: GrantTarget;
        level: GrantLevel;
      }) => notesService.setGrant(folderId, target, level),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['notes', 'grants', vars.folderId], grants);
        qc.invalidateQueries({ queryKey: ['notes', 'folders'] });
        toast('Sharing updated', 'success');
      },
    }),
    removeGrant: useMutation({
      mutationFn: ({
        folderId,
        target,
      }: {
        folderId: string;
        target: string;
      }) => notesService.removeGrant(folderId, target),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['notes', 'grants', vars.folderId], grants);
        qc.invalidateQueries({ queryKey: ['notes', 'folders'] });
        toast('Access removed', 'success');
      },
    }),
  };
}
