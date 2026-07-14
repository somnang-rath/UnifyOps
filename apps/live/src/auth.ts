import jwt from 'jsonwebtoken';
import type { onAuthenticatePayload } from '@hocuspocus/server';
import type { Env } from './env';
import { fetchWikiAccess } from './api-client';

/** documentName grammar (ADR 0001 §2 — LOCKED). */
const DOCUMENT_NAME_RE = /^wiki:([0-9a-f]{24})$/;

/** Context attached to the connection and forwarded to later hooks. */
export interface ConnectionContext {
  userId: string;
  role: string;
  wikiPageId: string;
}

interface AccessTokenPayload {
  sub: string;
  role: string;
  email?: string;
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
 * Hocuspocus onAuthenticate hook (ADR 0001 §1).
 *
 * 1. documentName must match `^wiki:[0-9a-f]{24}$`, else reject.
 * 2. Local JWT verify with the shared JWT_ACCESS_SECRET (ignoreExpiration:false).
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
    let payload: AccessTokenPayload;
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        ignoreExpiration: false,
      });
      if (typeof decoded === 'string') throw new Error('Unexpected token shape');
      payload = decoded as AccessTokenPayload;
    } catch (err) {
      throw new Error(
        `JWT verification failed: ${err instanceof Error ? err.message : 'invalid token'}`,
      );
    }

    if (!payload.sub) {
      throw new Error('Token missing sub');
    }

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
      role: payload.role,
      wikiPageId,
    };
  };
}
