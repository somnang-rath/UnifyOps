import type { onConnectPayload } from '@hocuspocus/server';
import type { Env } from './env';

/**
 * Abuse limits for the collab socket (docs/plan/01-security-model.md §3.3).
 *
 * Authentication answers *who* may open a document; it says nothing about *how
 * much* they may then push through it. Everything here runs on already-valid
 * sessions, and none of it makes an authorization decision — that stays with
 * apps/api (ADR 0001 §5).
 *
 * Three limits, deliberately at three different layers:
 *
 *  1. `maxPayload` on the WebSocketServer — cheapest, enforced by `ws` itself
 *     before a frame is ever buffered into memory (see index.ts).
 *  2. A global connection cap at HTTP upgrade — refuses the socket before
 *     Hocuspocus allocates anything for it.
 *  3. A per-document cap in `onConnect` — the one that needs Hocuspocus, since
 *     documentName is only parsed out of the URL there.
 */

/**
 * WebSocket close code for "try again later". Used for capacity refusals so a
 * client can tell them apart from 1008 (policy violation), which reauth.ts
 * sends when access is actually revoked.
 */
export const CLOSE_TRY_AGAIN_LATER = 1013;

/**
 * Hocuspocus `onConnect` — enforces the per-document connection cap.
 *
 * Runs after the socket is accepted but before the connection is registered on
 * the document, so the count read here excludes the pending connection and a
 * `>=` test admits exactly `LIVE_MAX_CONNECTIONS_PER_DOC` of them. Throwing
 * makes Hocuspocus close the connection, the same way a failed auth does.
 */
export function makeOnConnect(env: Env) {
  return async ({ documentName, instance }: onConnectPayload): Promise<void> => {
    const open = instance.documents.get(documentName)?.getConnectionsCount() ?? 0;

    if (open >= env.LIVE_MAX_CONNECTIONS_PER_DOC) {
      console.warn(
        `[live] refused connection to ${documentName}: at per-document limit (${open}/${env.LIVE_MAX_CONNECTIONS_PER_DOC})`,
      );
      throw new Error('Too many connections for this document');
    }
  };
}

/**
 * Whether a new socket fits under the server-wide cap.
 *
 * `ws` tracks accepted sockets in `wss.clients` even in `noServer` mode, so
 * this is an O(1) read of live state and needs no counter of our own.
 */
export function hasCapacity(openConnections: number, env: Env): boolean {
  return openConnections < env.LIVE_MAX_CONNECTIONS;
}
