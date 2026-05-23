import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** When true, the global response interceptor will not auto-toast 4xx/5xx errors. */
    _skipErrorToast?: boolean;
  }
}

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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

export function refreshAuth(): Promise<string | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    const url = original?.url ?? '';
    const status = error.response?.status;

    if (
      status === 401 &&
      !original?._retry &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh') &&
      !url.includes('/auth/register')
    ) {
      original._retry = true;
      const token = await refreshAuth();
      if (!token) return Promise.reject(error);
      original.headers = {
        ...(original.headers ?? {}),
        Authorization: `Bearer ${token}`,
      };
      return api(original);
    }

    if (status && status >= 400 && status !== 401 && !original?._skipErrorToast) {
      const data = error.response?.data as { message?: string | string[] };
      const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
      toast(msg ?? 'Something went wrong', 'error');
    }

    return Promise.reject(error);
  },
);
