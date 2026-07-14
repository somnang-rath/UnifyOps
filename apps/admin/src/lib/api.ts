'use client';
import axios from 'axios';
import { createApiClient } from '@prism/services';
import { getToken, setToken } from './auth';

/**
 * Admin API client — built on the shared @prism/services factory.
 * baseURL is relative ('/api/v1'); next.config rewrites proxy it to the API
 * so the refresh cookie stays same-origin.
 */
export const api = createApiClient({
  baseURL: '/api/v1',
  getToken,
  onRefresh: async () => {
    try {
      const { data } = await axios.post<{ accessToken: string }>(
        '/api/v1/auth/refresh',
        {},
        { withCredentials: true },
      );
      setToken(data.accessToken);
      return data.accessToken;
    } catch {
      setToken(null);
      return null;
    }
  },
  onError: (err) => {
    // Admin surfaces errors inline in forms; log for debugging.
    if (typeof window !== 'undefined') console.error('[api]', err.message);
  },
});

export async function login(email: string, password: string) {
  const { data } = await api.post<{ accessToken: string; user: unknown }>(
    '/auth/login',
    { email, password },
  );
  setToken(data.accessToken);
  return data;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}) {
  const { data } = await api.post<{ accessToken: string; user: unknown }>(
    '/auth/register',
    input,
  );
  setToken(data.accessToken);
  return data;
}

export async function bootstrapSession(): Promise<boolean> {
  try {
    const { data } = await axios.post<{ accessToken: string }>(
      '/api/v1/auth/refresh',
      {},
      { withCredentials: true },
    );
    setToken(data.accessToken);
    return true;
  } catch {
    setToken(null);
    return false;
  }
}
