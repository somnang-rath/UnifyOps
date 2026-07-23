'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Permanent flat-route → `/[workspaceSlug]/…` redirect for Tier W list routes
 * (ADR 0011 §3). One implementation shared by every list shim (`/issues`,
 * `/calendar`, `/timeline`, `/wiki`, `/analytics`) — the shims themselves are
 * one-liners so the resolution rule can never drift between routes.
 *
 * Target workspace: the persisted selection (reconciled by
 * `useCurrentWorkspace()` against the workspaces the user can see), else the
 * user's first workspace. The query string is carried through verbatim, so
 * e.g. `/issues?peek=<id>` lands on `/<slug>/issues?peek=<id>` with the peek
 * open. `router.replace` so Back doesn't bounce through the shim.
 */
export function WorkspaceListRedirect({ path }: { path: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { current, workspaces, isLoading } = useCurrentWorkspace();

  useEffect(() => {
    if (isLoading || !current) return;
    const qs = params.toString();
    router.replace(`/${current.slug}${path}${qs ? `?${qs}` : ''}`);
  }, [current, isLoading, params, path, router]);

  // A user in no workspace has nowhere to redirect to — say so rather than
  // spin forever (same messaging as the flat /projects shim).
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
