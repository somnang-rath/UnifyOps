'use client';

/**
 * Minimal access-token store for the admin app. The refresh token lives in an
 * httpOnly cookie (set by the API on login) — we only keep the short-lived
 * access token in memory + localStorage so a reload can rehydrate before the
 * first /auth/refresh completes.
 */
const KEY = 'prism_admin_token';

let accessToken: string | null =
  typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null): void {
  accessToken = token;
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(KEY, token);
  else window.localStorage.removeItem(KEY);
}
