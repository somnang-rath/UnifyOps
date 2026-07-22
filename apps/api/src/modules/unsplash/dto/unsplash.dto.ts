import { z } from 'zod';

/** Query for `GET /unsplash/search` (ADR 0010 §2). */
export const SearchUnsplashQuerySchema = z.object({
  query: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(30).default(20), // 30 = Unsplash max
});
export type SearchUnsplashQuery = z.infer<typeof SearchUnsplashQuerySchema>;

/**
 * Body for `POST /unsplash/download` (ADR 0010 §2). The prefix check is the
 * no-open-proxy guarantee: the server only ever fires GETs at api.unsplash.com.
 */
export const TriggerDownloadSchema = z.object({
  downloadLocation: z
    .string()
    .url()
    .startsWith('https://api.unsplash.com/')
    .max(2000),
});
export type TriggerDownloadDto = z.infer<typeof TriggerDownloadSchema>;

/** One search result, mapped server-side — the raw Unsplash payload never leaves. */
export interface UnsplashResult {
  id: string;
  alt: string;
  color: string | null;
  urls: { regular: string; small: string; thumb: string };
  downloadLocation: string;
  user: { name: string; username: string; link: string };
}

export interface UnsplashSearchResponse {
  configured: boolean;
  /** Absent on the not-configured response (ADR 0010 §2). */
  page?: number;
  totalPages: number;
  total: number;
  results: UnsplashResult[];
}
