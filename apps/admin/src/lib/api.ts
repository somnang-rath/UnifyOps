'use client';
import axios from 'axios';
import { createApiClient, readCsrfToken } from '@prism/services';
import { getToken, setToken } from './auth';

/** God Mode runs on `admin`-audience tokens; a web session cannot reach here. */
const AUDIENCE = 'admin' as const;

/** Cookie-authenticated POSTs must echo the double-submit CSRF cookie. */
function authHeaders() {
  const csrf = readCsrfToken();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

async function refreshSession(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ accessToken: string }>(
      '/api/v1/auth/refresh',
      { audience: AUDIENCE },
      { withCredentials: true, headers: authHeaders() },
    );
    setToken(data.accessToken);
    return data.accessToken;
  } catch {
    setToken(null);
    return null;
  }
}

/**
 * Admin API client — built on the shared @prism/services factory.
 * baseURL is relative ('/api/v1'); next.config rewrites proxy it to the API
 * so the refresh cookie stays same-origin.
 */
export const api = createApiClient({
  baseURL: '/api/v1',
  getToken,
  onRefresh: refreshSession,
  onError: (err) => {
    // Admin surfaces errors inline in forms; log for debugging.
    if (typeof window !== 'undefined') console.error('[api]', err.message);
  },
});

export async function login(email: string, password: string) {
  const { data } = await api.post<{ accessToken: string; user: unknown }>(
    '/auth/login',
    { email, password, audience: AUDIENCE },
  );
  setToken(data.accessToken);
  return data;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}) {
  // Registration always yields a `web` session: the account does not exist yet,
  // so it cannot be an instance admin. The setup flow claims the instance and
  // then re-logs in for an `admin` token.
  const { data } = await api.post<{ accessToken: string; user: unknown }>(
    '/auth/register',
    input,
  );
  setToken(data.accessToken);
  return data;
}

export async function bootstrapSession(): Promise<boolean> {
  return (await refreshSession()) !== null;
}

/** Re-enter the password to unlock instance mutations for 15 minutes. */
export async function stepUp(password: string): Promise<void> {
  const { data } = await api.post<{ accessToken: string }>('/auth/step-up', {
    password,
  });
  setToken(data.accessToken);
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', { audience: AUDIENCE });
  } finally {
    setToken(null);
  }
}
