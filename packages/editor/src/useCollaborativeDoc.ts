'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { ConnectionStatus, SaveState } from './types';

export interface UseCollaborativeDocOptions {
  /** Hocuspocus document name, e.g. `wiki:<24-hex>` (ADR 0001 §2). */
  documentName: string;
  /** WebSocket origin, e.g. process.env.NEXT_PUBLIC_LIVE_URL (`ws://localhost:3100`). */
  wsUrl: string;
  /**
   * The scoped collab token from {@link useCollabToken} — aud=collab, bound to
   * this documentName. Never the user's REST session token: the live server
   * rejects those. May change as the token is renewed.
   */
  token: string;
}

export interface CollaborativeDocState {
  /** The shared Yjs document (null until the effect has created it). */
  doc: Y.Doc | null;
  /** The live provider (null until created / after teardown). */
  provider: HocuspocusProvider | null;
  status: ConnectionStatus;
  /** True once the server's state has been merged into the local doc. */
  synced: boolean;
  saveState: SaveState;
  /**
   * Consecutive failed connection attempts since the last successful connect.
   * Reset to 0 the moment the socket reaches `connected`.
   */
  attempts: number;
  /**
   * The live server looks genuinely unreachable: {@link UNREACHABLE_ATTEMPTS}
   * attempts have failed and the socket never even completed its HTTP upgrade.
   *
   * This is the "apps/live is not running / wrong NEXT_PUBLIC_LIVE_URL / blocked
   * by the Origin allowlist" case. Without it the provider retries forever and
   * the UI shows an indefinite "Connecting…" that never resolves, which reads as
   * a hang rather than a misconfiguration.
   */
  unreachable: boolean;
  /**
   * The live server refused the session: it answered the handshake and then
   * rejected the collab token (expired, wrong scope, or access revoked).
   *
   * This needs its own flag because the socket looks *healthy* in that case —
   * Hocuspocus replies before hanging up, so the provider reports `connected`
   * and only `authenticationFailed` distinguishes it from a working session.
   * Without this the UI blamed the network for what is an access problem.
   */
  rejected: boolean;
  /** Force a fresh connection attempt now (resets the unreachable state). */
  reconnect: () => void;
}

/** Failed attempts before a never-opened socket is declared unreachable. */
const UNREACHABLE_ATTEMPTS = 3;

/**
 * Creates a `Y.Doc` + `HocuspocusProvider` for a document and tracks its
 * connection / sync state (ADR 0001 §5).
 *
 * - The provider connects to `wsUrl` with `name = documentName` and sends the
 *   JWT in the Hocuspocus Auth message (server reads it in onAuthenticate).
 * - `token` is read through a ref and passed as a getter, so a token refresh
 *   does NOT tear down and reconnect the socket. The doc/provider are recreated
 *   only when `documentName` or `wsUrl` change.
 * - Full cleanup (provider.destroy + doc.destroy) on unmount / doc switch.
 */
export function useCollaborativeDoc({
  documentName,
  wsUrl,
  token,
}: UseCollaborativeDocOptions): CollaborativeDocState {
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Bumping this rebuilds the doc/provider — used by `reconnect()`.
  const [nonce, setNonce] = useState(0);
  const reconnect = useCallback(() => setNonce((n) => n + 1), []);

  const [state, setState] = useState<CollaborativeDocState>({
    doc: null,
    provider: null,
    status: 'connecting',
    synced: false,
    saveState: 'saving',
    attempts: 0,
    unreachable: false,
    rejected: false,
    reconnect,
  });

  useEffect(() => {
    if (!wsUrl || !documentName) return;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentName,
      document: doc,
      // Getter form → latest token without reconnecting on refresh.
      token: () => tokenRef.current,
    });

    let status: ConnectionStatus = 'connecting';
    let synced = false;
    let unsynced = 0;
    let attempts = 0;
    let everConnected = false;
    /**
     * The socket completed its HTTP upgrade at least once — the narrowest
     * possible proof that the server is actually there, and the one that keeps
     * "live is down" honest.
     */
    let everOpened = false;
    /**
     * The server answered `authenticationFailed`. Cleared on the next
     * successful sync, which is the only event that proves the token was in
     * fact accepted (`status: connected` is not — Hocuspocus reaches it even
     * for a connection it is about to refuse).
     */
    let authFailed = false;

    const saveStateOf = (): SaveState =>
      status === 'disconnected' ? 'offline' : unsynced > 0 ? 'saving' : 'saved';

    const push = () =>
      setState({
        doc,
        provider,
        status,
        synced,
        saveState: saveStateOf(),
        attempts,
        unreachable: !everOpened && attempts >= UNREACHABLE_ATTEMPTS,
        rejected: authFailed,
        reconnect,
      });

    const onStatus = (event: { status: ConnectionStatus }) => {
      status = event.status;
      if (status === 'connected') {
        everConnected = true;
        attempts = 0;
      }
      push();
    };
    const onOpen = () => {
      everOpened = true;
      push();
    };
    // Every closed socket is one failed attempt. Combined with `everConnected`
    // this separates "server is down" from "we dropped and are reconnecting".
    const onClose = () => {
      attempts += 1;
      push();
    };
    // The server explicitly refused the token — retrying the same one is
    // pointless, so surface it at once rather than after N attempts.
    const onAuthenticationFailed = () => {
      authFailed = true;
      push();
    };
    const onSynced = () => {
      synced = true;
      // Sync is the one event that only happens post-authentication, so it is
      // what clears a previous rejection after the token is re-minted.
      authFailed = false;
      push();
    };
    const onUnsyncedChanges = (count: number) => {
      unsynced = typeof count === 'number' ? count : 0;
      push();
    };

    provider.on('status', onStatus);
    provider.on('open', onOpen);
    provider.on('close', onClose);
    provider.on('authenticationFailed', onAuthenticationFailed);
    provider.on('synced', onSynced);
    provider.on('unsyncedChanges', onUnsyncedChanges);

    // Seed initial render state.
    setState({
      doc,
      provider,
      status,
      synced,
      saveState: 'saving',
      attempts: 0,
      unreachable: false,
      rejected: false,
      reconnect,
    });

    return () => {
      provider.off('status', onStatus);
      provider.off('open', onOpen);
      provider.off('close', onClose);
      provider.off('authenticationFailed', onAuthenticationFailed);
      provider.off('synced', onSynced);
      provider.off('unsyncedChanges', onUnsyncedChanges);
      provider.destroy();
      doc.destroy();
    };
    // Intentionally excludes `token` — see tokenRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName, wsUrl, nonce]);

  return state;
}
