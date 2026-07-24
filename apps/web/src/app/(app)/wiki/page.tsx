'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/**
 * Legacy flat route → `/[workspaceSlug]/wiki` (ADR 0011 §3, Phase 7b).
 * Permanent — `wiki.service.ts:61` writes a bare `/wiki` link (no query) into
 * mention notifications, and those rows already exist in the DB.
 */
export default function WikiRedirect() {
  return <WorkspaceListRedirect path="/wiki" />;
}
