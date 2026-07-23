'use client';
import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useIssue } from '@/hooks/use-issues';
import { useProject } from '@/hooks/use-projects';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { LoadingScreen } from '@/components/ui/loading-screen';

/**
 * Legacy issue deep links → the workspace-scoped route (ADR 0011 §3, Phase 7b).
 *
 *   /issues/<id> → /<slug>/issues/<id>
 *
 * Permanent — the API mints workspace-agnostic links into stored rows
 * (`notifications.service.ts:77`, `assistant/tools.ts:208`,
 * `automations.service.ts:161`) and cannot know the slug at write time.
 *
 * Resolution mirrors the `projects/[...rest]` shim: resolve via the entity, not
 * the current selection — a notification may deep-link into a workspace that
 * isn't the one currently selected. Project-linked issues redirect to their
 * project's workspace; personal issues (`projectId: null`) have no workspace, so
 * they fall back to the list-route rule (persisted selection, else first
 * workspace). The query string is carried through verbatim.
 */
export default function IssueDeepLinkRedirect() {
  const router = useRouter();
  const id = useParams<{ id: string }>().id;
  const search = useSearchParams();

  const { data: issue, isLoading, isError } = useIssue(id ?? null);
  // Only fires for project-linked issues; the project's workspaceId names the slug.
  const { data: project, isLoading: projLoading } = useProject(
    issue?.projectId ?? null,
  );
  const { current, workspaces, isLoading: wsLoading } = useCurrentWorkspace();

  const slug = !issue
    ? undefined
    : issue.projectId
      ? project?.workspaceId
        ? workspaces.find((w) => w.id === project.workspaceId)?.slug
        : // Readable project without a workspace (pre-ADR-0006 orphan): the
          // detail page is id-keyed, so the selection rule still shows the issue.
          current?.slug
      : current?.slug;

  useEffect(() => {
    if (!slug) return;
    const qs = search.toString();
    router.replace(`/${slug}/issues/${id}${qs ? `?${qs}` : ''}`);
  }, [slug, id, search, router]);

  if (isLoading || projLoading || wsLoading || slug) return <LoadingScreen />;

  // Gone, or not readable — the API 404s both identically (ADR 0004).
  if (isError || !issue) {
    return (
      <Message title="Task not found">
        It may have been deleted, or you don&apos;t have access to it.
      </Message>
    );
  }

  // Readable, but the user is in no workspace — nowhere to route to.
  if (workspaces.length === 0) {
    return (
      <Message title="No workspace yet">
        You&apos;re not a member of any workspace. Ask an admin to add you.
      </Message>
    );
  }

  // Project-linked, but its workspace isn't one we can see — shouldn't happen
  // (reading the issue implies reading the project implies membership), so
  // don't pretend to handle it silently (same stance as the projects shim).
  if (issue.projectId && project?.workspaceId) {
    return (
      <Message title="Workspace unavailable">
        This task belongs to a workspace that isn&apos;t available to you.
      </Message>
    );
  }

  // Workspaces exist but the selection hasn't been reconciled yet (one render
  // tick) — the effect in useCurrentWorkspace resolves it immediately after.
  return <LoadingScreen />;
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
