'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useProject } from '@/hooks/use-projects';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Legacy deep links → the workspace-scoped route (ADR 0006 Phase 2).
 *
 *   /projects/<id>            → /<slug>/projects/<id>
 *   /projects/<id>/settings   → /<slug>/projects/<id>/settings
 *
 * This is the route that keeps every notification row already in the database
 * working: the API mints workspace-agnostic links (`projects.service.ts:53`
 * `link: /projects/${id}`) and cannot know the slug at write time. Resolving the
 * project's own workspace here means the API never has to.
 */
export default function ProjectDeepLinkRedirect() {
  const router = useRouter();
  const rest = useParams<{ rest: string[] }>().rest ?? [];
  const [id, ...tail] = rest;

  const { data: project, isLoading, isError } = useProject(id ?? null);
  const { data: workspaces = [], isLoading: wsLoading } = useWorkspaces();

  const slug = project?.workspaceId
    ? workspaces.find((w) => w.id === project.workspaceId)?.slug
    : undefined;

  useEffect(() => {
    if (!slug) return;
    const suffix = tail.length ? `/${tail.join('/')}` : '';
    router.replace(`/${slug}/projects/${id}${suffix}`);
  }, [slug, id, tail, router]);

  if (isLoading || wsLoading || slug) return <LoadingScreen />;

  // The project is gone, or the caller can't read it — the API 404s both the
  // same way on purpose (ADR 0004), so we don't distinguish either.
  if (isError || !project) {
    return (
      <Message title="Project not found">
        It may have been deleted, or you don&apos;t have access to it.
      </Message>
    );
  }

  // Readable, but not in a workspace: a pre-ADR-0006 orphan, or one left behind
  // by a workspace deletion (which detaches rather than deletes). There is no
  // slug to route to, so say what's actually wrong instead of looping.
  if (!project.workspaceId) {
    return (
      <Message title="Project isn't in a workspace">
        <span className="font-medium">{project.name}</span> isn&apos;t assigned to
        a workspace, so it has no address yet. An instance admin can assign it
        from the admin console.
      </Message>
    );
  }

  // Readable and has a workspace, but it isn't one we can see — shouldn't happen
  // (reading it implies membership), so don't pretend to handle it silently.
  return (
    <Message title="Workspace unavailable">
      This project belongs to a workspace that isn&apos;t available to you.
    </Message>
  );
}

function Message({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertCircle className="w-8 h-8 text-text-muted" />
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="text-[13px] text-text-muted max-w-sm">{children}</p>
    </div>
  );
}
