'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { WikiPage, WikiPageMeta } from '@/schemas/wiki';

const wikiService = {
  list: (projectId: string, q?: string) =>
    api
      .get<WikiPageMeta[]>('/wiki', { params: { projectId, q } })
      .then((r) => r.data),
  byId: (id: string) =>
    api.get<WikiPage>(`/wiki/${id}`).then((r) => r.data),
  create: (b: {
    projectId: string;
    title: string;
    content: string;
    parentId?: string | null;
  }) => api.post<WikiPage>('/wiki', b).then((r) => r.data),
  update: (
    id: string,
    b: {
      title?: string;
      content?: string;
      parentId?: string | null;
      /** ADR 0010 — null clears the cover. */
      coverImage?: string | null;
    },
  ) => api.patch<WikiPage>(`/wiki/${id}`, b).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/wiki/${id}`).then((r) => r.data),
};

export const useWikiList = (projectId: string | null, q: string) =>
  useQuery({
    queryKey: ['wiki', projectId, q],
    queryFn: () => wikiService.list(projectId!, q || undefined),
    enabled: !!projectId,
    placeholderData: (prev) => prev,
  });

export const useWikiPage = (id: string | null) =>
  useQuery({
    queryKey: ['wiki', 'byId', id],
    queryFn: () => wikiService.byId(id!),
    enabled: !!id,
  });

export function useWikiMutations(projectId: string | null) {
  const qc = useQueryClient();
  const inv = (msg: string) => () => {
    toast(msg, 'success');
    qc.invalidateQueries({ queryKey: ['wiki', projectId] });
  };
  return {
    create: useMutation({
      mutationFn: wikiService.create,
      onSuccess: inv('Page created'),
    }),
    update: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string;
        body: Parameters<typeof wikiService.update>[1];
      }) => wikiService.update(id, body),
      onSuccess: (page) => {
        qc.setQueryData(['wiki', 'byId', page._id], page);
        qc.invalidateQueries({ queryKey: ['wiki', projectId] });
      },
    }),
    remove: useMutation({
      mutationFn: wikiService.remove,
      onSuccess: (_, id) => {
        toast('Page deleted', 'success');
        qc.removeQueries({ queryKey: ['wiki', 'byId', id] });
        qc.invalidateQueries({ queryKey: ['wiki', projectId] });
      },
    }),
  };
}
