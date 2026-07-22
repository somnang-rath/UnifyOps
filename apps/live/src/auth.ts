import jwt from 'jsonwebtoken';
import type { onAuthenticatePayload } from '@hocuspocus/server';
import type { Env } from './env';
import { fetchDocAccess } from './api-client';

/**
 * documentName grammar (ADR 0001 §2 — LOCKED; extended by ADR 0009 §1).
 * `wiki:<24-hex>` (Phase 2) and `notes:<24-hex>` (ADR 0009) are the only
 * accepted prefixes.
 */
const DOCUMENT_NAME_RE = /^(wiki|notes):([0-9a-f]{24})$/;

/** The document kinds the live server serves. */
export type DocKind = 'wiki' | 'notes';

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
  docKind: DocKind;
  docId: string;
}

interface CollabTokenPayload {
  sub: string;
  /** The one document this token unlocks — must equal the requested documentName. */
  doc: string;
  role?: string;
  exp?: number;
}

/** A successfully parsed documentName. */
export interface ParsedDocumentName {
  kind: DocKind;
  id: string;
}

/**
 * Parse `wiki:<24-hex>` / `notes:<24-hex>` → `{ kind, id }`, or null if it does
 * not match the frozen grammar (ADR 0009 §1). No other prefixes are valid.
 */
export function parseDocumentName(
  documentName: string,
): ParsedDocumentName | null {
  const m = DOCUMENT_NAME_RE.exec(documentName);
  return m ? { kind: m[1] as DocKind, id: m[2] } : null;
}

/**
 * Verify a collab token for one document. Exported so the periodic re-auth
 * timer can re-run the exact same check the handshake did. The `doc` claim
 * equality check is prefix-agnostic (ADR 0009 §5) — a token minted for
 * `notes:<id>` opens exactly that document and nothing else.
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

  // Scope check: a token for wiki:A must not open wiki:B (or notes:A).
  if (payload.doc !== documentName) {
    throw new Error(
      `Token is scoped to ${payload.doc ?? '(none)'}, not ${documentName}`,
    );
  }

  return payload;
}

/**
 * Hocuspocus onAuthenticate hook (ADR 0001 §1, hardened per docs/plan/01 §3.3;
 * notes grammar + routing per ADR 0009 §§1–2).
 *
 * 1. documentName must match `^(wiki|notes):[0-9a-f]{24}$`, else reject.
 * 2. Local JWT verify: aud=collab, not expired, `doc` claim === documentName.
 * 3. Authorization via the API internal access endpoint for the doc kind:
 *      canRead=false / non-200 → reject; canWrite=false → read-only connection.
 *
 * Throwing here makes Hocuspocus reject the connection (no anonymous access).
 */
export function makeOnAuthenticate(env: Env) {
  return async (data: onAuthenticatePayload): Promise<ConnectionContext> => {
    const { token, documentName, connection } = data;

    const parsed = parseDocumentName(documentName);
    if (!parsed) {
      throw new Error(`Invalid documentName: ${documentName}`);
    }

    if (!token) {
      throw new Error('Missing token');
    }

    // --- Authentication: local JWT verify (no API round-trip) ---
    const payload = verifyCollabToken(env, token, documentName);

    // --- Authorization: delegated to the API (single source of truth) ---
    const access = await fetchDocAccess(env, parsed.kind, parsed.id, payload.sub);
    if (!access || !access.canRead) {
      throw new Error(`User ${payload.sub} may not read ${documentName}`);
    }

    if (!access.canWrite) {
      // Hocuspocus supports read-only connections — no updates are applied.
      connection.readOnly = true;
    }

    return {
      userId: payload.sub,
      role: payload.role ?? 'user',
      docKind: parsed.kind,
      docId: parsed.id,
    };
  };
}
