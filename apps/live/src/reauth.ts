import type { Hocuspocus } from '@hocuspocus/server';
import type { Env } from './env';
import type { ConnectionContext } from './auth';
import { parseWikiDocumentName } from './auth';
import { fetchWikiAccess } from './api-client';

/**
 * Access is only checked at handshake, but a collab socket can stay open for
 * hours. Losing project membership mid-session must actually cut the
 * connection, so we re-run the authorization check on a timer.
 * docs/plan/01-security-model.md §3.3.
 */
export const REAUTH_INTERVAL_MS = 5 * 60 * 1000;

/** WebSocket close code for "policy violation" — the client sees a clean close. */
const CLOSE_POLICY_VIOLATION = 1008;

export async function sweepConnections(
  server: Hocuspocus,
  env: Env,
): Promise<{ checked: number; closed: number }> {
  let checked = 0;
  let closed = 0;

  for (const [documentName, document] of server.documents) {
    const wikiPageId = parseWikiDocumentName(documentName);
    if (!wikiPageId) continue;

    // One access call per distinct user on the document, not per connection —
    // the same person in three tabs is one authorization question.
    const byUser = new Map<string, ReturnType<typeof document.getConnections>>();
    for (const connection of document.getConnections()) {
      const ctx = connection.context as ConnectionContext | undefined;
      if (!ctx?.userId) continue;
      const list = byUser.get(ctx.userId) ?? [];
      list.push(connection);
      byUser.set(ctx.userId, list);
    }

    for (const [userId, connections] of byUser) {
      checked += connections.length;
      let canRead = false;
      let canWrite = false;
      try {
        const access = await fetchWikiAccess(env, wikiPageId, userId);
        canRead = !!access?.canRead;
        canWrite = !!access?.canWrite;
      } catch (err) {
        // A transient API failure must not sign everyone out — leave the
        // connection alone and re-check on the next sweep.
        console.warn(
          `[live] re-auth check failed for ${documentName} / ${userId}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      for (const connection of connections) {
        if (!canRead) {
          console.warn(
            `[live] closing ${documentName} for ${userId}: read access revoked`,
          );
          connection.close({ code: CLOSE_POLICY_VIOLATION, reason: 'Access revoked' });
          closed += 1;
          continue;
        }
        // Demotion to read-only takes effect without dropping the socket.
        if (!canWrite && !connection.readOnly) {
          console.warn(`[live] ${documentName}: ${userId} demoted to read-only`);
          connection.readOnly = true;
        }
      }
    }
  }

  return { checked, closed };
}

/** Start the sweeper; returns a stop function for shutdown. */
export function startReauthSweeper(server: Hocuspocus, env: Env): () => void {
  const timer = setInterval(() => {
    void sweepConnections(server, env).catch((err) =>
      console.error('[live] re-auth sweep error:', err),
    );
  }, REAUTH_INTERVAL_MS);

  // Never hold the process open for a periodic check.
  timer.unref?.();
  return () => clearInterval(timer);
}
