'use client';
import { WorkspaceListRedirect } from '@/components/layout/workspace-redirect';

/**
 * Flat route → `/[workspaceSlug]/intake` (ADR 0011 §3). Permanent.
 *
 * Not legacy, unlike its siblings — intake never had a flat URL. It exists
 * because the sidebar builds workspace-scoped hrefs from the *resolved* slug,
 * and on `/home` (where every session lands) that slug is not in the URL: until
 * the workspace query settles, every Tier W nav item points at its bare path.
 * Without this file that first click is a 404 rather than a redirect.
 */
export default function IntakeRedirect() {
  return <WorkspaceListRedirect path="/intake" />;
}
