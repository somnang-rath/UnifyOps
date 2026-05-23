'use client';
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 3 * 60_000,   // 3 min — data served from cache on page re-visit
        gcTime: 15 * 60_000,     // 15 min — cache survives long browsing sessions
        refetchOnWindowFocus: false,
        retry: (failureCount, e: any) =>
          failureCount < 2 &&
          e?.response?.status !== 401 &&
          e?.response?.status !== 404,
      },
    },
  });
}
