'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { ConnectionStatus, SaveState } from './types';

export interface UseCollaborativeDocOptions {
  /** Hocuspocus document name, e.g. `wiki:<24-hex>` (ADR 0001 §2). */
  documentName: string;
  /** WebSocket origin, e.g. process.env.NEXT_PUBLIC_LIVE_URL (`ws://localhost:3100`). */
  wsUrl: string;
  /** JWT the live server verifies in onAuthenticate. May change on refresh. */
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
}

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

  const [state, setState] = useState<CollaborativeDocState>({
    doc: null,
    provider: null,
    status: 'connecting',
    synced: false,
    saveState: 'saving',
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

    const saveStateOf = (): SaveState =>
      status === 'disconnected' ? 'offline' : unsynced > 0 ? 'saving' : 'saved';

    const push = () =>
      setState({ doc, provider, status, synced, saveState: saveStateOf() });

    const onStatus = (event: { status: ConnectionStatus }) => {
      status = event.status;
      push();
    };
    const onSynced = () => {
      synced = true;
      push();
    };
    const onUnsyncedChanges = (count: number) => {
      unsynced = typeof count === 'number' ? count : 0;
      push();
    };

    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('unsyncedChanges', onUnsyncedChanges);

    // Seed initial render state.
    setState({ doc, provider, status, synced, saveState: 'saving' });

    return () => {
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('unsyncedChanges', onUnsyncedChanges);
      provider.destroy();
      doc.destroy();
    };
    // Intentionally excludes `token` — see tokenRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName, wsUrl]);

  return state;
}
