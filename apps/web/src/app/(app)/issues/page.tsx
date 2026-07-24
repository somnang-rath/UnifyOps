'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/**
 * Legacy flat route → `/[workspaceSlug]/issues` (ADR 0011 §3, Phase 7b).
 * Permanent — the API writes flat `/issues/*` links into stored notification
 * rows (`notifications.service.ts:77`, `assistant/tools.ts:208`). The query
 * string (`?peek=`, `?new=1`, `?project=`) is preserved verbatim.
 */
export default function IssuesRedirect() {
  return <WorkspaceListRedirect path="/issues" />;
}
