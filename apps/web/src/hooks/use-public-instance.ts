'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicInstance } from '@prism/types';

// Canonical shape lives in @prism/types (shared with admin) — see ADR 0008 §1.
export type { PublicInstance } from '@prism/types';

/** Public instance config — drives login-method affordances (OAuth buttons). */
export function usePublicInstance() {
  return useQuery({
    queryKey: ['instance', 'public'],
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get<PublicInstance>('/instance', { _skipErrorToast: true })
        .then((r) => r.data),
  });
}
