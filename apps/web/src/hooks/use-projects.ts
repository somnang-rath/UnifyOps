'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { Project } from '@/schemas/project';

interface SaveBody {
  name: string;
  desc: string;
  visibility: 'private' | 'internal' | 'public';
  color: string;
  memberEmails: string[];
}

const projectsService = {
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  byId: (id: string) =>
    api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (b: SaveBody) =>
    api.post<Project>('/projects', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveBody>) =>
    api.patch<Project>(`/projects/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/projects/${id}`).then((r) => r.data),
};

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: projectsService.list,
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
    remove: useMutation({
      mutationFn: projectsService.remove,
      onSuccess: onDone('Project deleted'),
    }),
  };
}
