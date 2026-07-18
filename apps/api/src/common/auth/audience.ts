/**
 * Token audiences (docs/plan/01-security-model.md §2).
 *
 * Every JWT this API mints carries an `aud` claim naming the exact client that
 * may present it. The audiences are NOT interchangeable:
 *
 *   web    — apps/web user session. Cannot reach instance endpoints.
 *   admin  — apps/admin (God Mode). Only issued to instance admins, and only
 *            by a fresh password login, so a stolen web token can never be
 *            escalated into instance access.
 *   collab — apps/live only. Scoped to a single document and ~5 minutes; the
 *            JWT strategy refuses it on REST routes entirely.
 */
export const AUD_WEB = 'web';
export const AUD_ADMIN = 'admin';
export const AUD_COLLAB = 'collab';

/** Audiences the REST API accepts on a Bearer token. `collab` is deliberately absent. */
export const REST_AUDIENCES = [AUD_WEB, AUD_ADMIN] as const;

export type RestAudience = (typeof REST_AUDIENCES)[number];
export type Audience = RestAudience | typeof AUD_COLLAB;

/** How long a step-up (password re-entry) stays fresh for instance mutations. */
export const STEP_UP_MAX_AGE_MS = 15 * 60 * 1000;
