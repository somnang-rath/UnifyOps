'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/**
 * Legacy flat route → `/[workspaceSlug]/analytics` (ADR 0011 §3, Phase 7b).
 * Permanent. The query string (`?project=&range=`) is carried through verbatim.
 */
export default function AnalyticsRedirect() {
  return <WorkspaceListRedirect path="/analytics" />;
}
