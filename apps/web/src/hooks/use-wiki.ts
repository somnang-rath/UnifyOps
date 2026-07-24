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
  list: (params: { projectId?: string; workspaceId?: string; q?: string }) =>
    api.get<WikiPageMeta[]>('/wiki', { params }).then((r) => r.data),
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

/**
 * Per-project page list. `workspaceId` (ADR 0011 §2) is an additional honest
 * filter — the API intersects both, so a stale project restored from another
 * workspace yields `[]` instead of leaking cross-workspace titles. It sits in
 * the key *after* `q` so the mutations' `['wiki', projectId]` prefix
 * invalidation keeps matching.
 */
export const useWikiList = (
  projectId: string | null,
  q: string,
  workspaceId?: string | null,
) =>
  useQuery({
    queryKey: ['wiki', projectId, q, workspaceId ?? null],
    queryFn: () =>
      wikiService.list({
        projectId: projectId!,
        workspaceId: workspaceId ?? undefined,
        q: q || undefined,
      }),
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
