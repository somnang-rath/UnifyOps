/**
 * @prism/services — shared API client used by web, admin, and space.
 *
 * Framework-agnostic on purpose: it takes callbacks (getToken, onRefresh,
 * onError) instead of importing any app's Zustand store, so all three
 * frontends can configure the same axios instance their own way.
 *
 * apps/web can wrap `createApiClient` with its existing auth-store/toast
 * during the Phase 0 extraction without changing call sites.
 */

import axios, {
  type AxiosInstance,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';

export interface ApiClientOptions {
  /** e.g. process.env.NEXT_PUBLIC_API_URL */
  baseURL: string | undefined;
  /** Return the current access token (or null) to attach as Bearer. */
  getToken?: () => string | null | undefined;
  /**
   * Called on 401 to obtain a fresh token. Return the new token, or null
   * if refresh failed (the original error then propagates).
   */
  onRefresh?: () => Promise<string | null>;
  /** Called for surfaced errors (e.g. toast). */
  onError?: (error: AxiosError) => void;
  /**
   * Gate the 401 auto-refresh per request. Return false to skip refreshing
   * (e.g. for /auth/login|refresh|register where a 401 is a real failure, not
   * an expired token). Defaults to always refreshing on 401.
   */
  shouldRefresh?: (error: AxiosError) => boolean;
  /** Send cookies (refresh token) with requests. Default true. */
  withCredentials?: boolean;
  /**
   * Echo the double-submit CSRF cookie as a header on state-changing requests.
   * Default true. Harmless when the API does not demand it.
   */
  csrf?: boolean;
}

export const CSRF_COOKIE = 'prism_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

/**
 * Read the CSRF cookie the API set at login/refresh. It is deliberately not
 * httpOnly: only same-origin script can read it, which is what makes echoing
 * it back proof the request did not come from a cross-site page.
 */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

const SAFE_METHODS = new Set(['get', 'head', 'options']);

/** Opt-out flag: skip the global error handler for a single request. */
export interface RequestMeta {
  _skipErrorToast?: boolean;
}

export function createApiClient(opts: ApiClientOptions): AxiosInstance {
  const client = axios.create({
    baseURL: opts.baseURL,
    withCredentials: opts.withCredentials ?? true,
  });

  const csrfEnabled = opts.csrf ?? true;

  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = opts.getToken?.();
    if (token) config.headers.Authorization = `Bearer ${token}`;

    if (csrfEnabled && !SAFE_METHODS.has((config.method ?? 'get').toLowerCase())) {
      const csrf = readCsrfToken();
      if (csrf) config.headers[CSRF_HEADER] = csrf;
    }
    return config;
  });

  let refreshing: Promise<string | null> | null = null;

  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const original = error.config as
        | (InternalAxiosRequestConfig & { _retry?: boolean } & RequestMeta)
        | undefined;

      if (
        error.response?.status === 401 &&
        original &&
        !original._retry &&
        opts.onRefresh &&
        (opts.shouldRefresh?.(error) ?? true)
      ) {
        original._retry = true;
        refreshing ??= opts.onRefresh().finally(() => {
          refreshing = null;
        });
        const token = await refreshing;
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return client(original);
        }
      }

      if (!original?._skipErrorToast) opts.onError?.(error);
      return Promise.reject(error);
    },
  );

  return client;
}

export type { AxiosInstance, AxiosError } from 'axios';

export {
  createSession,
  type Session,
  type SessionAudience,
  type SessionOptions,
  type SessionUser,
  type AuthResponse,
} from './session';
