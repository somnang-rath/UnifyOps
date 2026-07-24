import type { Env } from './env';
import type { DocKind } from './auth';

export interface DocAccess {
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Internal API path segment per doc kind. Wiki paths are LOCKED by ADR 0001;
 * notes paths are frozen by ADR 0009 (§2 access, §4 snapshot) — both follow the
 * same `/internal/<kind>/:id/...` shape.
 */
const KIND_PATH: Record<DocKind, string> = {
  wiki: 'wiki',
  notes: 'notes',
};

/**
 * Authorization check against the API (ADR 0001 §1; ADR 0009 §2). This is the
 * single source of truth for who may open a document — the live server never
 * re-implements authz rules locally. Per-connection, not per-keystroke.
 *
 * GET {INTERNAL_API_URL}/internal/wiki/:id/access?userId=<sub>
 * GET {INTERNAL_API_URL}/internal/notes/:id/access?userId=<sub>
 *   header x-internal-token: LIVE_INTERNAL_TOKEN
 *   → 200 { canRead, canWrite }; non-200 → treated as no access (fail closed).
 */
export async function fetchDocAccess(
  env: Env,
  kind: DocKind,
  docId: string,
  userId: string,
): Promise<DocAccess | null> {
  const url = `${env.INTERNAL_API_URL}/internal/${KIND_PATH[kind]}/${docId}/access?userId=${encodeURIComponent(
    userId,
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-internal-token': env.LIVE_INTERNAL_TOKEN },
    });
  } catch (err) {
    // Network/API-down → deny (fail closed).
    console.error('[live] access check request failed:', err);
    return null;
  }

  if (!res.ok) return null;

  try {
    const body = (await res.json()) as Partial<DocAccess>;
    return {
      canRead: body.canRead === true,
      canWrite: body.canWrite === true,
    };
  } catch {
    return null;
  }
}

/**
 * Snapshot-back (ADR 0001 §4; ADR 0009 §4): push rendered HTML to the API so
 * the document's stored content (wiki.content / note.contentHTML) stays current
 * for search / PDF / Space.
 *
 * PUT {INTERNAL_API_URL}/internal/wiki/:id/content
 * PUT {INTERNAL_API_URL}/internal/notes/:id/content
 *   header x-internal-token: LIVE_INTERNAL_TOKEN
 *   body   { content, editedBy? }
 */
export async function putDocContent(
  env: Env,
  kind: DocKind,
  docId: string,
  content: string,
  editedBy?: string,
): Promise<void> {
  const url = `${env.INTERNAL_API_URL}/internal/${KIND_PATH[kind]}/${docId}/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': env.LIVE_INTERNAL_TOKEN,
    },
    body: JSON.stringify({ content, editedBy }),
  });

  if (!res.ok) {
    throw new Error(
      `snapshot PUT failed for ${kind}:${docId} — ${res.status} ${res.statusText}`,
    );
  }
}
