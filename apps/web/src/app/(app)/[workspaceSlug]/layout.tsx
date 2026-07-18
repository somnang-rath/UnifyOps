'use client';
import { type ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Workspace-scoped routes (ADR 0006 Phase 2). Resolves `/[workspaceSlug]/…` to a
 * real workspace and makes the URL authoritative: landing here switches the
 * current workspace to match, so a shared link opens in the right context rather
 * than whatever the visitor last had selected.
 *
 * The API returns 404 for a workspace you don't belong to (never 403), so any
 * error here is "no such workspace, for you" — rendered as one message.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const { data: workspace, isLoading, isError } = useWorkspaceBySlug(slug ?? null);
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);

  // URL wins over the persisted selection.
  useEffect(() => {
    if (workspace) setCurrent(workspace.id);
  }, [workspace, setCurrent]);

  if (isLoading) return <LoadingScreen />;

  if (isError || !workspace) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="w-8 h-8 text-text-muted" />
        <h1 className="text-[18px] font-semibold">Workspace not found</h1>
        <p className="text-[13px] text-text-muted max-w-sm">
          <span className="font-mono">{slug}</span> doesn&apos;t exist, or you&apos;re
          not a member of it.
        </p>
        <Link
          href="/home"
          className="text-[13px] text-accent hover:underline mt-1"
        >
          Go home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
