'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/** Legacy flat route → `/[workspaceSlug]/timeline` (ADR 0011 §3, Phase 7b). Permanent. */
export default function TimelineRedirect() {
  return <WorkspaceListRedirect path="/timeline" />;
}
