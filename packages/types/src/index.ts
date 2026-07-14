/**
 * @prism/types — shared TypeScript types + Zod schemas used across
 * web, admin, space (frontends) and mirrored against the apps/api contract.
 *
 * Phase 0: this package is the single source of truth for cross-app types.
 * Extract types out of apps/web incrementally and re-export them here.
 */

import { z } from 'zod';

/** A MongoDB ObjectId as a 24-char hex string (matches the API's Zod contract). */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export type ObjectId = z.infer<typeof objectId>;

/** Standard paginated list response shape returned by list endpoints. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ── Domain types (extract from apps/web incrementally) ──────────────
// export * from './issue';
// export * from './project';
// export * from './workspace';
