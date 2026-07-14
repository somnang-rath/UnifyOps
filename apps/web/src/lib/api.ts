import axios, { AxiosError } from 'axios';
import { createApiClient } from '@prism/services';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** When true, the global response interceptor will not auto-toast 4xx/5xx errors. */
    _skipErrorToast?: boolean;
  }
}

/** Endpoints where a 401 is a genuine failure, not an expired access token. */
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/register'];

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ accessToken: string; user: any }>(
      `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    useAuthStore.getState().setAuth(data.accessToken, data.user);
    return data.accessToken;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

/**
 * Shared refresh entry point — dedupes concurrent callers (interceptor +
 * app bootstrap in providers/layout) onto a single in-flight refresh.
 */
export function refreshAuth(): Promise<string | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export const api = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  getToken: () => useAuthStore.getState().accessToken,
  onRefresh: refreshAuth,
  shouldRefresh: (error: AxiosError) => {
    const url = error.config?.url ?? '';
    return !AUTH_PATHS.some((p) => url.includes(p));
  },
  onError: (error: AxiosError) => {
    const status = error.response?.status;
    // 401 is handled by the refresh flow; only toast other 4xx/5xx.
    if (status && status >= 400 && status !== 401) {
      const data = error.response?.data as { message?: string | string[] };
      const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
      toast(msg ?? 'Something went wrong', 'error');
    }
  },
});
