'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { WikiPage, WikiPublishState } from '@/schemas/wiki';

const publishService = {
  publish: (id: string) =>
    api.post<WikiPublishState>(`/wiki/${id}/publish`).then((r) => r.data),
  unpublish: (id: string) =>
    api
      .delete<{ isPublic: boolean }>(`/wiki/${id}/publish`)
      .then((r) => r.data),
};

/**
 * Publish / unpublish a wiki page to the public Space (ADR 0002 §3).
 * Patches the cached `['wiki','byId',id]` page so the Publish control and the
 * shareable link reflect the new state without a refetch.
 */
export function useWikiPublish(projectId: string | null) {
  const qc = useQueryClient();

  const patchPage = (id: string, next: Partial<WikiPage>) => {
    qc.setQueryData<WikiPage>(['wiki', 'byId', id], (prev) =>
      prev ? { ...prev, ...next } : prev,
    );
    qc.invalidateQueries({ queryKey: ['wiki', projectId] });
  };

  return {
    publish: useMutation({
      mutationFn: publishService.publish,
      onSuccess: (state, id) => {
        patchPage(id, {
          isPublic: state.isPublic,
          anchor: state.anchor,
          publishedAt: state.publishedAt,
        });
        toast('Published to Space', 'success');
      },
      onError: () => toast('Could not publish page', 'error'),
    }),
    unpublish: useMutation({
      mutationFn: publishService.unpublish,
      onSuccess: (state, id) => {
        patchPage(id, { isPublic: state.isPublic });
        toast('Unpublished', 'success');
      },
      onError: () => toast('Could not unpublish page', 'error'),
    }),
  };
}
