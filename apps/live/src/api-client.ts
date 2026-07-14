import type { Env } from './env';

export interface WikiAccess {
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Authorization check against the API (ADR 0001 §1). This is the single source
 * of truth for who may open a wiki page — per-connection, not per-keystroke.
 *
 * GET {INTERNAL_API_URL}/internal/wiki/:id/access?userId=<sub>
 *   header x-internal-token: LIVE_INTERNAL_TOKEN
 *   → 200 { canRead, canWrite }; non-200 → treated as no access.
 */
export async function fetchWikiAccess(
  env: Env,
  wikiPageId: string,
  userId: string,
): Promise<WikiAccess | null> {
  const url = `${env.INTERNAL_API_URL}/internal/wiki/${wikiPageId}/access?userId=${encodeURIComponent(
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
    const body = (await res.json()) as Partial<WikiAccess>;
    return {
      canRead: body.canRead === true,
      canWrite: body.canWrite === true,
    };
  } catch {
    return null;
  }
}

/**
 * Snapshot-back (ADR 0001 §4): push rendered HTML to the API so wiki.content
 * stays current for search / PDF / Space.
 *
 * PUT {INTERNAL_API_URL}/internal/wiki/:id/content
 *   header x-internal-token: LIVE_INTERNAL_TOKEN
 *   body   { content, editedBy? }
 */
export async function putWikiContent(
  env: Env,
  wikiPageId: string,
  content: string,
  editedBy?: string,
): Promise<void> {
  const url = `${env.INTERNAL_API_URL}/internal/wiki/${wikiPageId}/content`;
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
      `snapshot PUT failed for wiki:${wikiPageId} — ${res.status} ${res.statusText}`,
    );
  }
}
