import jwt from 'jsonwebtoken';
import type { onAuthenticatePayload } from '@hocuspocus/server';
import type { Env } from './env';
import { fetchWikiAccess } from './api-client';

/** documentName grammar (ADR 0001 §2 — LOCKED). */
const DOCUMENT_NAME_RE = /^wiki:([0-9a-f]{24})$/;

/**
 * Only tokens minted for the live server are accepted (docs/plan/01 §2, ADR 0007).
 * A user's REST session token carries aud=web and is refused here, so the
 * browser never has to hand its session to the collab socket.
 */
const AUD_COLLAB = 'collab';

/** Context attached to the connection and forwarded to later hooks. */
export interface ConnectionContext {
  userId: string;
  role: string;
  wikiPageId: string;
}

interface CollabTokenPayload {
  sub: string;
  /** The one document this token unlocks — must equal the requested documentName. */
  doc: string;
  role?: string;
  exp?: number;
}

/**
 * Parse `wiki:<24-hex>` → the wikiPageId, or null if it does not match the
 * frozen grammar. No other prefixes are valid in Phase 2.
 */
export function parseWikiDocumentName(documentName: string): string | null {
  const m = DOCUMENT_NAME_RE.exec(documentName);
  return m ? m[1] : null;
}

/**
 * Verify a collab token for one document. Exported so the periodic re-auth
 * timer can re-run the exact same check the handshake did.
 */
export function verifyCollabToken(
  env: Env,
  token: string,
  documentName: string,
): CollabTokenPayload {
  let payload: CollabTokenPayload;
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      ignoreExpiration: false,
      audience: AUD_COLLAB,
    });
    if (typeof decoded === 'string') throw new Error('Unexpected token shape');
    payload = decoded as CollabTokenPayload;
  } catch (err) {
    throw new Error(
      `JWT verification failed: ${err instanceof Error ? err.message : 'invalid token'}`,
    );
  }

  if (!payload.sub) throw new Error('Token missing sub');

  // Scope check: a token for wiki:A must not open wiki:B.
  if (payload.doc !== documentName) {
    throw new Error(
      `Token is scoped to ${payload.doc ?? '(none)'}, not ${documentName}`,
    );
  }

  return payload;
}

/**
 * Hocuspocus onAuthenticate hook (ADR 0001 §1, hardened per docs/plan/01 §3.3).
 *
 * 1. documentName must match `^wiki:[0-9a-f]{24}$`, else reject.
 * 2. Local JWT verify: aud=collab, not expired, `doc` claim === documentName.
 * 3. Authorization via the API internal access endpoint:
 *      canRead=false / non-200 → reject; canWrite=false → read-only connection.
 *
 * Throwing here makes Hocuspocus reject the connection (no anonymous access).
 */
export function makeOnAuthenticate(env: Env) {
  return async (data: onAuthenticatePayload): Promise<ConnectionContext> => {
    const { token, documentName, connection } = data;

    const wikiPageId = parseWikiDocumentName(documentName);
    if (!wikiPageId) {
      throw new Error(`Invalid documentName: ${documentName}`);
    }

    if (!token) {
      throw new Error('Missing token');
    }

    // --- Authentication: local JWT verify (no API round-trip) ---
    const payload = verifyCollabToken(env, token, documentName);

    // --- Authorization: delegated to the API (single source of truth) ---
    const access = await fetchWikiAccess(env, wikiPageId, payload.sub);
    if (!access || !access.canRead) {
      throw new Error(`User ${payload.sub} may not read wiki:${wikiPageId}`);
    }

    if (!access.canWrite) {
      // Hocuspocus supports read-only connections — no updates are applied.
      connection.readOnly = true;
    }

    return {
      userId: payload.sub,
      role: payload.role ?? 'user',
      wikiPageId,
    };
  };
}
