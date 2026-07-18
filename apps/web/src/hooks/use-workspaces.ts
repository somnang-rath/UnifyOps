'use client';
import { useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  readPersistedWorkspaceId,
  useWorkspaceStore,
} from '@/stores/workspace-store';
import type { Workspace } from '@/schemas/workspace';

const workspacesService = {
  list: () => api.get<Workspace[]>('/workspaces').then((r) => r.data),
  bySlug: (slug: string) =>
    api.get<Workspace>(`/workspaces/slug/${slug}`).then((r) => r.data),
};

/** Workspaces the current user owns or belongs to. */
export const useWorkspaces = () =>
  useQuery({
    queryKey: ['workspaces'],
    queryFn: workspacesService.list,
    placeholderData: (prev) => prev,
  });

/**
 * Resolve a workspace by slug (ADR 0006) — the seam Phase 2's `/[workspaceSlug]`
 * routes will hang off. 404s for a non-member, so a failed query means "not
 * yours or not there", never "forbidden".
 */
export const useWorkspaceBySlug = (slug: string | null) =>
  useQuery({
    queryKey: ['workspaces', 'bySlug', slug],
    queryFn: () => workspacesService.bySlug(slug!),
    enabled: !!slug,
    retry: false,
  });

/**
 * The current workspace, reconciled against the ones the user can actually see.
 *
 * The persisted id is a hint, not a truth: a user removed from a workspace still
 * has its id in localStorage, and honouring it would send `workspaceId` the API
 * rejects. So the stored id is only accepted if it appears in the live list;
 * otherwise we fall back to the first workspace.
 */
export function useCurrentWorkspace() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const currentId = useWorkspaceStore((s) => s.currentId);
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);

  useEffect(() => {
    if (!workspaces) return;
    if (workspaces.length === 0) {
      if (currentId) setCurrent(null);
      return;
    }
    const valid = (id: string | null) =>
      !!id && workspaces.some((w) => w.id === id);
    if (valid(currentId)) return;
    // Hydrate from localStorage on first load; drop it if it's stale.
    const persisted = readPersistedWorkspaceId();
    setCurrent(valid(persisted) ? persisted : workspaces[0].id);
  }, [workspaces, currentId, setCurrent]);

  const current = workspaces?.find((w) => w.id === currentId) ?? null;
  return { current, workspaces: workspaces ?? [], isLoading, setCurrent };
}

/**
 * Builds workspace-scoped hrefs: `ws('/projects')` → `/acme/projects`.
 *
 * Inside `/[workspaceSlug]/…` the slug comes straight from the URL. Elsewhere
 * (the sidebar, which is mounted above this route group) it falls back to the
 * current workspace. Returns the bare path while no workspace is known, so a
 * link is never built as `/undefined/projects`.
 */
export function useWorkspaceHref() {
  const routeSlug = useParams<{ workspaceSlug?: string }>()?.workspaceSlug;
  const { current } = useCurrentWorkspace();
  const slug = routeSlug ?? current?.slug ?? null;
  return useCallback(
    (path: string) => (slug ? `/${slug}${path}` : path),
    [slug],
  );
}
