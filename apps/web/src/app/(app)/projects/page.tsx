'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Legacy flat route → `/[workspaceSlug]/projects` (ADR 0006 Phase 2).
 *
 * Kept rather than deleted because the API writes workspace-agnostic deep links
 * into the database (`projects.service.ts:53` → `/projects/${id}`), and those
 * rows already exist. See also `projects/[...rest]/page.tsx` for the deep ones.
 */
export default function ProjectsRedirect() {
  const router = useRouter();
  const { current, workspaces, isLoading } = useCurrentWorkspace();

  useEffect(() => {
    if (isLoading) return;
    if (current) router.replace(`/${current.slug}/projects`);
  }, [current, isLoading, router]);

  // A user in no workspace has nowhere to redirect to — say so rather than
  // spin forever.
  if (!isLoading && workspaces.length === 0) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-[18px] font-semibold">No workspace yet</h1>
        <p className="text-[13px] text-text-muted mt-1">
          You&apos;re not a member of any workspace. Ask an admin to add you.
        </p>
      </div>
    );
  }

  return <LoadingScreen />;
}
