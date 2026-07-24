'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Unsplash cover search (ADR 0010). The API proxies Unsplash server-side —
 * the access key never reaches the browser; `user.link` already carries the
 * UTM attribution params (appended server-side, ADR 0010 §4).
 */
export interface UnsplashPhoto {
  id: string;
  alt: string | null;
  /** Unsplash dominant color — used as the tile placeholder background. */
  color: string | null;
  urls: { regular: string; small: string; thumb: string };
  downloadLocation: string;
  user: { name: string; username: string; link: string };
}

export interface UnsplashSearchPage {
  configured: boolean;
  /** Absent on the not-configured response (ADR 0010 §2). */
  page?: number;
  totalPages: number;
  total: number;
  results: UnsplashPhoto[];
}

/** 18 = 3 columns × 6 rows; a stable perPage keeps the server cache key hot. */
export const UNSPLASH_PER_PAGE = 18;

/**
 * Infinite Unsplash search. The caller passes an already-debounced query.
 * `_skipErrorToast` on every request: a 502 renders inline in the picker
 * (ADR 0010 §6), never as a global toast.
 */
export function useUnsplashSearch(query: string, opts: { enabled: boolean }) {
  return useInfiniteQuery({
    queryKey: ['unsplash', query],
    queryFn: ({ pageParam }) =>
      api
        .get<UnsplashSearchPage>('/unsplash/search', {
          params: { query, page: pageParam, perPage: UNSPLASH_PER_PAGE },
          _skipErrorToast: true,
        })
        .then((r) => r.data),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const page = last.page ?? 1;
      return last.configured && page < last.totalPages ? page + 1 : undefined;
    },
    enabled: opts.enabled && query.length > 0,
    // Matches the server-side cache TTL (ADR 0010 §5).
    staleTime: 10 * 60_000,
  });
}

/**
 * Unsplash compliance ping on photo selection (ADR 0010 §4). Fire-and-forget:
 * never awaited, never toasts — the API always answers 200 { ok }, and the
 * catch swallows network-level failures.
 */
export function triggerUnsplashDownload(downloadLocation: string): void {
  void api
    .post('/unsplash/download', { downloadLocation }, { _skipErrorToast: true })
    .catch(() => {});
}
