'use client';

/**
 * Access-token store for the admin app.
 *
 * Memory only. The token used to be mirrored into localStorage so a reload
 * could rehydrate instantly, but that traded real XSS-exfiltration risk for a
 * few hundred milliseconds — and this is the God Mode token. A reload now
 * rehydrates from the httpOnly refresh cookie via bootstrapSession().
 * docs/plan/01-security-model.md §1 S1.
 */
const LEGACY_KEY = 'prism_admin_token';

let accessToken: string | null = null;

// One-time cleanup: drop tokens persisted by the previous build.
if (typeof window !== 'undefined') {
  window.localStorage.removeItem(LEGACY_KEY);
}

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null): void {
  accessToken = token;
}
