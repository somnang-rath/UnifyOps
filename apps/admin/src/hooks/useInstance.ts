'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicInstance } from '@prism/types';

// Canonical shape lives in @prism/types (shared with web) — see ADR 0008 §1.
export type { PublicInstance } from '@prism/types';

export interface ConfigRow {
  key: string;
  category: string;
  isEncrypted: boolean;
  value: string | null;
  isSet: boolean;
}

export interface AdminRow {
  id: string;
  role: string;
  user: { _id: string; name: string; email: string; avatar?: string } | null;
}

export interface ConfigEntry {
  key: string;
  value: string | null;
  category: 'auth' | 'smtp' | 'ai' | 'images' | 'integrations' | 'general';
  isEncrypted: boolean;
}

export function usePublicInstance() {
  return useQuery({
    queryKey: ['instance', 'public'],
    queryFn: () => api.get<PublicInstance>('/instance').then((r) => r.data),
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['instance', 'config'],
    queryFn: () => api.get<ConfigRow[]>('/instance/config').then((r) => r.data),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: ConfigEntry[]) =>
      api.patch('/instance/config', { entries }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance', 'config'] });
      qc.invalidateQueries({ queryKey: ['instance', 'public'] });
    },
  });
}

export function useUpdateInstanceName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceName: string) =>
      api.patch('/instance', { instanceName }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance'] }),
  });
}

export function useAdmins() {
  return useQuery({
    queryKey: ['instance', 'admins'],
    queryFn: () => api.get<AdminRow[]>('/instance/admins').then((r) => r.data),
  });
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  desc: string;
  color: string;
  owner: { id: string; name?: string; email?: string } | null;
  memberCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDetail extends WorkspaceRow {
  members: { id: string; name?: string; email?: string }[];
  projects: { id: string; name: string; color: string; visibility: string }[];
}

export interface AvailableProject {
  id: string;
  name: string;
  color: string;
  assigned: boolean;
}

/** Instance-wide list of every workspace (God Mode overview). */
export function useWorkspaces() {
  return useQuery({
    queryKey: ['instance', 'workspaces'],
    queryFn: () =>
      api.get<WorkspaceRow[]>('/workspaces/all').then((r) => r.data),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug?: string }) =>
      api
        .post<WorkspaceRow>('/workspaces', input)
        .then((r) => r.data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['instance', 'workspaces'] }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/workspaces/admin/${id}`).then((r) => r.data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['instance', 'workspaces'] }),
  });
}

export function useWorkspaceDetail(id: string | null) {
  return useQuery({
    queryKey: ['instance', 'workspace', id],
    enabled: !!id,
    queryFn: () =>
      api.get<WorkspaceDetail>(`/workspaces/admin/${id}`).then((r) => r.data),
  });
}

export function useAvailableProjects(id: string | null) {
  return useQuery({
    queryKey: ['instance', 'workspace-projects', id],
    enabled: !!id,
    queryFn: () =>
      api
        .get<AvailableProject[]>(`/workspaces/admin/${id}/projects`)
        .then((r) => r.data),
  });
}

/** Shared invalidation for anything that mutates a single workspace. */
function useWorkspaceInvalidator() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: ['instance', 'workspaces'] });
    qc.invalidateQueries({ queryKey: ['instance', 'workspace', id] });
    qc.invalidateQueries({ queryKey: ['instance', 'workspace-projects', id] });
  };
}

export function useUpdateWorkspace() {
  const invalidate = useWorkspaceInvalidator();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<WorkspaceRow, 'name' | 'slug' | 'desc' | 'color'>>;
    }) =>
      api
        .patch<WorkspaceDetail>(`/workspaces/admin/${id}`, patch)
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useAddMember() {
  const invalidate = useWorkspaceInvalidator();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      api
        .post<WorkspaceDetail>(`/workspaces/admin/${id}/members`, { email })
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useRemoveMember() {
  const invalidate = useWorkspaceInvalidator();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api
        .delete<WorkspaceDetail>(`/workspaces/admin/${id}/members/${userId}`)
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useAssignProject() {
  const invalidate = useWorkspaceInvalidator();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api
        .post<WorkspaceDetail>(`/workspaces/admin/${id}/projects/${projectId}`)
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useUnassignProject() {
  const invalidate = useWorkspaceInvalidator();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api
        .delete<WorkspaceDetail>(`/workspaces/admin/${id}/projects/${projectId}`)
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}
