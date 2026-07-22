import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { InstanceService } from '../instance/instance.service';
import {
  SearchUnsplashQuery,
  UnsplashResult,
  UnsplashSearchResponse,
} from './dto/unsplash.dto';

const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const UPSTREAM_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const UTM = 'utm_source=prism&utm_medium=referral';

/** Minimal slice of the Unsplash search payload we actually read. */
interface UpstreamPhoto {
  id: string;
  alt_description?: string | null;
  description?: string | null;
  color?: string | null;
  urls?: { regular?: string; small?: string; thumb?: string };
  links?: { download_location?: string };
  user?: { name?: string; username?: string; links?: { html?: string } };
}
interface UpstreamSearch {
  total?: number;
  total_pages?: number;
  results?: UpstreamPhoto[];
}

/**
 * Server-side Unsplash proxy (ADR 0010). The access key travels only in the
 * server→Unsplash `Authorization: Client-ID` header — it appears in no
 * response, log, or client-visible URL. Search only ever calls the fixed
 * search URL; the download trigger validates its `https://api.unsplash.com/`
 * prefix at the DTO. No open proxy.
 */
@Injectable()
export class UnsplashService {
  private readonly log = new Logger(UnsplashService.name);

  /**
   * Tiny in-memory search cache (ADR 0010 §5): the demo tier is 50 req/hr and
   * cover-picker queries are highly repetitive. Single-replica assumption
   * (same precedent as the Telegram bridge, ADR 0007). Errors and
   * `configured:false` responses are never cached.
   */
  private readonly cache = new Map<
    string,
    { payload: UnsplashSearchResponse; expiresAt: number }
  >();

  constructor(private readonly instance: InstanceService) {}

  async search(q: SearchUnsplashQuery): Promise<UnsplashSearchResponse> {
    // Config is resolved BEFORE the cache lookup (ADR 0010 §5), so disabling
    // Unsplash takes effect immediately even for cached queries.
    const { enabled, accessKey } = await this.instance.getUnsplashConfig();
    if (!enabled) {
      // Deliberately 200, not an error (ADR 0010 §6): an unconfigured instance
      // must not toast on every picker open.
      return { configured: false, results: [], total: 0, totalPages: 0 };
    }

    const key = `${q.query.toLowerCase().trim()} ${q.page} ${q.perPage}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.payload;
    this.cache.delete(key); // drop the expired entry, if any

    const url = new URL(UNSPLASH_SEARCH_URL);
    url.searchParams.set('query', q.query);
    url.searchParams.set('page', String(q.page));
    url.searchParams.set('per_page', String(q.perPage));

    let data: UpstreamSearch;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.log.warn(`Unsplash search failed upstream: HTTP ${res.status}`);
        throw new BadGatewayException('Unsplash search failed');
      }
      data = (await res.json()) as UpstreamSearch;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      this.log.warn(`Unsplash search unreachable: ${(err as Error).message}`);
      throw new BadGatewayException('Unsplash search failed');
    }

    const payload: UnsplashSearchResponse = {
      configured: true,
      page: q.page,
      totalPages: data.total_pages ?? 0,
      total: data.total ?? 0,
      results: (data.results ?? []).map((p) => this.mapPhoto(p)),
    };

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return payload;
  }

  /**
   * Fire the Unsplash download-trigger endpoint (compliance ping, ADR 0010 §4).
   * Always resolves to `{ ok }` — never throws — because the frontend must be
   * able to fire-and-forget without any chance of an error toast.
   */
  async triggerDownload(downloadLocation: string): Promise<{ ok: boolean }> {
    const { enabled, accessKey } = await this.instance.getUnsplashConfig();
    if (!enabled) return { ok: false };

    try {
      const res = await fetch(downloadLocation, {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      return { ok: res.ok };
    } catch (err) {
      this.log.warn(`Unsplash download trigger failed: ${(err as Error).message}`);
      return { ok: false };
    }
  }

  /**
   * Map one upstream photo to the frozen result shape. The photographer link
   * gets the UTM tags appended server-side (ADR 0010 §4) so every consumer of
   * the API is attribution-compliant by construction.
   */
  private mapPhoto(p: UpstreamPhoto): UnsplashResult {
    const rawLink =
      p.user?.links?.html ?? `https://unsplash.com/@${p.user?.username ?? ''}`;
    const link = `${rawLink}${rawLink.includes('?') ? '&' : '?'}${UTM}`;
    return {
      id: p.id,
      alt: p.alt_description ?? p.description ?? '',
      color: p.color ?? null,
      urls: {
        regular: p.urls?.regular ?? '',
        small: p.urls?.small ?? '',
        thumb: p.urls?.thumb ?? '',
      },
      downloadLocation: p.links?.download_location ?? '',
      user: {
        name: p.user?.name ?? '',
        username: p.user?.username ?? '',
        link,
      },
    };
  }
}
