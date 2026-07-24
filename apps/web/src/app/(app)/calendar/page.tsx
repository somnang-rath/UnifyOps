'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/** Legacy flat route → `/[workspaceSlug]/calendar` (ADR 0011 §3, Phase 7b). Permanent. */
export default function CalendarRedirect() {
  return <WorkspaceListRedirect path="/calendar" />;
}
