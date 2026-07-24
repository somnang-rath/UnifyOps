'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { IssueTemplate, IssueTemplateDefaults } from '@prism/types';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';

export interface SaveTemplateBody {
  name: string;
  /** null ⇒ workspace-scoped (visible in every project of the workspace). */
  projectId?: string | null;
  workspaceId?: string;
  defaults: IssueTemplateDefaults;
}

interface TemplateScope {
  /** Required by the API (workspace-member gate, ADR 0006). */
  workspaceId?: string;
  /** When given: that project's templates + the workspace-level ones. */
  projectId?: string;
}

const templatesService = {
  // Returns the project's templates merged with the workspace-level ones
  // (templates-csv-import spec §1; the API requires workspaceId).
  list: (scope: TemplateScope) =>
    api
      .get<IssueTemplate[]>('/templates', { params: scope })
      .then((r) => r.data),
  create: (b: SaveTemplateBody) =>
    api.post<IssueTemplate>('/templates', b).then((r) => r.data),
  update: (id: string, b: Partial<SaveTemplateBody>) =>
    api.patch<IssueTemplate>(`/templates/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete<{ ok: true }>(`/templates/${id}`).then((r) => r.data),
};

/** Templates usable in a project (project-scoped + its workspace's). */
export const useTemplates = (scope: TemplateScope) =>
  useQuery({
    queryKey: ['templates', scope],
    queryFn: () => templatesService.list(scope),
    enabled: !!scope.workspaceId,
  });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['templates'] });

  const create = useMutation({
    mutationFn: (b: SaveTemplateBody) => templatesService.create(b),
    onSuccess: () => {
      invalidate();
      toast('Template created', 'success');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast(e.response?.data?.message ?? 'Could not create template', 'error'),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<SaveTemplateBody>;
    }) => templatesService.update(id, body),
    onSuccess: () => {
      invalidate();
      toast('Template saved', 'success');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast(e.response?.data?.message ?? 'Could not save template', 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => templatesService.remove(id),
    onSuccess: () => {
      invalidate();
      toast('Template deleted', 'success');
    },
    onError: () => toast('Could not delete template', 'error'),
  });

  return { create, update, remove };
}
