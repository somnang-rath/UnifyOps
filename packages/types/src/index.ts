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

// Issue templates + CSV import (Phase 8, templates-csv-import spec §1)
export * from './templates';

/**
 * Shape of the unauthenticated `GET /instance` payload. `config` values are
 * *effective* booleans — e.g. `GOOGLE_OAUTH_ENABLED` is true only when the
 * toggle is on AND credentials exist (ADR 0008 §1). The client never learns
 * why a provider is off, just the boolean.
 */
export interface PublicInstance {
  instanceId: string;
  instanceName: string;
  currentVersion: string;
  isSetupDone: boolean;
  adminExists: boolean;
  config: Record<string, boolean>;
}

// ── Public anchor payloads (ADR 0012 §5) ────────────────────────────
// Shared by apps/api PublicService and apps/space rendering. These shapes are
// internet-facing: every field here is public by definition. Never add ids,
// emails, assignees, or member data (the Mongo projection in PublicService is
// the enforcement point; these types are its contract).

/**
 * A single work item as exposed on the public surface. Deliberately absent:
 * `_id`, `assigneeId`, `authorId`, `desc`, `comments`, `todos`, `parentId`
 * (ADR 0012 §5 — the projection whitelist is the security boundary).
 */
export interface PublicIssue {
  title: string;
  /** Raw status/column id, e.g. "inprogress" or a custom board column id. */
  status: string;
  /** Optional display label for the status; clients fall back to column defs. */
  statusLabel?: string;
  /** 'low' | 'medium' | 'high' | 'critical' today — render unknowns neutrally. */
  priority: string;
  /** 'task' | 'bug' | 'feature' | 'docs' | … */
  type: string;
  labels: string[];
  dueDate: string | null;
  updatedAt: string;
}

/** Ordered board column def — derived from boardLists, never includes wipLimit. */
export interface PublicBoardColumn {
  id: string;
  name: string;
  color?: string;
}

/** Published wiki page (ADR 0002 §4 — unchanged by ADR 0012). */
export interface PublicWikiPage {
  type: 'wiki';
  anchor: string;
  title: string;
  contentHTML: string;
  /** Hotlinked cover URL — the only non-content public field (ADR 0010 §3). */
  coverImage: string | null;
  updatedAt: string;
}

/** Published saved view (project-scoped only in v1 — ADR 0012 §3). */
export interface PublicView {
  type: 'view';
  anchor: string;
  title: string;
  /** Stored layout: 'kanban' renders as a board; all others degrade to list. */
  layout: string;
  /** null ⇒ clients default to grouping by status. */
  groupBy: string | null;
  /** Ordered column defs, present for kanban layouts. */
  columns?: PublicBoardColumn[];
  /** Display context only — never a project id. */
  projectName?: string;
  /** Live query at request time, capped at 200 (ADR 0012 §5). */
  issues: PublicIssue[];
  updatedAt: string;
}

/** Published project — always its default board (ADR 0012 §5). */
export interface PublicProject {
  type: 'project';
  anchor: string;
  title: string;
  layout: string;
  groupBy: string | null;
  columns?: PublicBoardColumn[];
  description?: string | null;
  /** Hotlinked cover URL, same rules as wiki (ADR 0010 §3). */
  coverImage?: string | null;
  issues: PublicIssue[];
  updatedAt: string;
}

/**
 * Discriminated union returned by `GET /public/anchor/:anchor`. Consumers must
 * switch on `type` and treat unknown types as 404 so an older client degrades
 * to "not found", never to a crash (ADR 0012 §6).
 */
export type PublicAnchorPayload = PublicWikiPage | PublicView | PublicProject;
