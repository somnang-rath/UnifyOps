'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CollabTokenResponse {
  /** JWT with aud=collab, scoped to one document. */
  token: string;
  /** Lifetime in seconds, as reported by the API. */
  expiresIn: number;
  canWrite?: boolean;
}

export interface UseCollabTokenOptions {
  /**
   * Fetch a fresh scoped token, e.g.
   * `() => api.post(`/wiki/${id}/collab-token`).then(r => r.data)`.
   * Kept as a callback so this package never imports an app's API client.
   */
  fetchToken: () => Promise<CollabTokenResponse>;
  /** Pause fetching (e.g. the editor is not mounted yet). */
  enabled?: boolean;
}

export interface CollabTokenState {
  token: string | null;
  canWrite: boolean;
  loading: boolean;
  error: Error | null;
  /** Force a renewal now. */
  refresh: () => void;
}

/** Renew this long before expiry so a reconnect never races the clock. */
const RENEW_MARGIN_SEC = 60;
const MIN_RENEW_SEC = 30;

/**
 * Holds the short-lived, single-document token that apps/live accepts
 * (docs/plan/01-security-model.md §2).
 *
 * The browser never hands its REST session token to the collab socket: the API
 * mints a token with aud=collab bound to this one document, valid ~5 minutes.
 * This hook keeps it fresh; useCollaborativeDoc reads it through a ref, so a
 * renewal updates the token without tearing down the WebSocket.
 */
export function useCollabToken({
  fetchToken,
  enabled = true,
}: UseCollabTokenOptions): CollabTokenState {
  const [token, setToken] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Keep the latest callback without making it an effect dependency: an inline
  // arrow from the caller would otherwise re-run the effect on every render.
  const fetchRef = useRef(fetchToken);
  fetchRef.current = fetchToken;

  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const res = await fetchRef.current();
        if (cancelled) return;
        setToken(res.token);
        setCanWrite(!!res.canWrite);
        setError(null);

        const next = Math.max(res.expiresIn - RENEW_MARGIN_SEC, MIN_RENEW_SEC);
        timer = setTimeout(run, next * 1000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error('Failed to get collab token'));
        setToken(null);
        // Losing access is terminal (the live server will close the socket);
        // a transient failure is not, so retry once on the short cycle.
        timer = setTimeout(run, MIN_RENEW_SEC * 1000);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, nonce]);

  return { token, canWrite, loading, error, refresh };
}
