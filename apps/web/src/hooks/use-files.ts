'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import type {
  FileItem,
  FileStats,
  Folder,
  FolderGrant,
  GrantLevel,
  GrantRole,
} from '@/schemas/file';

type GrantTarget = { userId: string } | { role: GrantRole };

const filesService = {
  stats: () => api.get<FileStats>('/files/stats').then((r) => r.data),
  listFiles: (params: { folderId?: string | null; q?: string }) =>
    api.get<FileItem[]>('/files', { params }).then((r) => r.data),
  listFolders: () =>
    api.get<Folder[]>('/files/folders').then((r) => r.data),
  createFolder: (b: { name: string; parentId?: string | null }) =>
    api.post<Folder>('/files/folders', b).then((r) => r.data),
  renameFolder: (id: string, name: string) =>
    api
      .patch<Folder>(`/files/folders/${id}`, { name })
      .then((r) => r.data),
  removeFolder: (id: string) =>
    api.delete(`/files/folders/${id}`).then((r) => r.data),

  upload: (
    file: File,
    folderId: string | null,
    onProgress?: (pct: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (folderId) fd.append('folderId', folderId);
    return api
      .post<FileItem>('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total)
            onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },
  addLink: (b: {
    name: string;
    url: string;
    folderId?: string | null;
  }) => api.post<FileItem>('/files/link', b).then((r) => r.data),
  rename: (id: string, name: string) =>
    api
      .patch<FileItem>(`/files/${id}/rename`, { name })
      .then((r) => r.data),
  move: (id: string, folderId: string | null) =>
    api
      .patch<FileItem>(`/files/${id}/move`, { folderId })
      .then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/files/${id}`).then((r) => r.data),
  downloadUrl: (id: string) => {
    const token = useAuthStore.getState().accessToken;
    const base = `${process.env.NEXT_PUBLIC_API_URL}/files/${id}/download`;
    return token ? `${base}?t=${encodeURIComponent(token)}` : base;
  },

  listGrants: (folderId: string) =>
    api
      .get<FolderGrant[]>(`/files/folders/${folderId}/grants`)
      .then((r) => r.data),
  setGrant: (folderId: string, target: GrantTarget, level: GrantLevel) =>
    api
      .put<FolderGrant[]>(`/files/folders/${folderId}/grants`, {
        ...target,
        level,
      })
      .then((r) => r.data),
  /** `target` is either a user id or a role string — the API dispatches on shape. */
  removeGrant: (folderId: string, target: string) =>
    api
      .delete<FolderGrant[]>(`/files/folders/${folderId}/grants/${target}`)
      .then((r) => r.data),
};

export { filesService };

export const useFolders = () =>
  useQuery({ queryKey: ['files', 'folders'], queryFn: filesService.listFolders });

export const useFiles = (folderId: string | null, q: string) =>
  useQuery({
    queryKey: ['files', 'list', folderId, q],
    queryFn: () =>
      filesService.listFiles({ folderId, q: q || undefined }),
    placeholderData: (prev) => prev,
  });

export const useFileStats = () =>
  useQuery({ queryKey: ['files', 'stats'], queryFn: filesService.stats });

export const useFolderGrants = (folderId: string | null) =>
  useQuery({
    queryKey: ['files', 'grants', folderId],
    queryFn: () => filesService.listGrants(folderId!),
    enabled: !!folderId,
  });

export function useFileMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['files'] });
  };
  return {
    upload: useMutation({
      mutationFn: ({
        file,
        folderId,
        onProgress,
      }: {
        file: File;
        folderId: string | null;
        onProgress?: (pct: number) => void;
      }) => filesService.upload(file, folderId, onProgress),
      onSuccess: invalidate,
    }),
    addLink: useMutation({
      mutationFn: filesService.addLink,
      onSuccess: () => {
        invalidate();
        toast('Link added', 'success');
      },
    }),
    createFolder: useMutation({
      mutationFn: filesService.createFolder,
      onSuccess: () => {
        invalidate();
        toast('Folder created', 'success');
      },
    }),
    renameFolder: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        filesService.renameFolder(id, name),
      onSuccess: invalidate,
    }),
    removeFolder: useMutation({
      mutationFn: filesService.removeFolder,
      onSuccess: () => {
        invalidate();
        toast('Folder deleted', 'success');
      },
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        filesService.rename(id, name),
      onSuccess: invalidate,
    }),
    move: useMutation({
      mutationFn: ({
        id,
        folderId,
      }: {
        id: string;
        folderId: string | null;
      }) => filesService.move(id, folderId),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: filesService.remove,
      onSuccess: () => {
        invalidate();
        toast('File deleted', 'success');
      },
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
      }) => filesService.setGrant(folderId, target, level),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['files', 'grants', vars.folderId], grants);
        qc.invalidateQueries({ queryKey: ['files', 'folders'] });
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
      }) => filesService.removeGrant(folderId, target),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['files', 'grants', vars.folderId], grants);
        qc.invalidateQueries({ queryKey: ['files', 'folders'] });
        toast('Access removed', 'success');
      },
    }),
  };
}
