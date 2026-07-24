'use client';
import { useCallback, useMemo } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';

/**
 * Picks the current workspace (ADR 0006). Everything workspace-scoped — today
 * the project list and project creation — reads the selection from
 * `useCurrentWorkspace()`. In Phase 2 this also drives the `/[workspaceSlug]`
 * URL segment.
 */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { current, workspaces, isLoading, setCurrent } = useCurrentWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const routeSlug = useParams<{ workspaceSlug?: string }>()?.workspaceSlug;

  const options = useMemo(
    () => workspaces.map((w) => ({ value: w.id, label: w.name })),
    [workspaces],
  );

  /**
   * On a /[workspaceSlug]/… page the URL is authoritative, so switching has to
   * navigate — updating the store alone would leave the two disagreeing, and the
   * layout would just switch it back. Swap the slug segment and keep the rest of
   * the path, EXCEPT a project id, which belongs to the workspace being left.
   */
  const onChange = useCallback(
    (id: string) => {
      const next = workspaces.find((w) => w.id === id);
      if (!next) return;
      setCurrent(id);
      if (!routeSlug) return; // not on a workspace-scoped route; store is enough
      const rest = pathname.split('/').slice(2);
      // /acme/projects/<id>/settings → /gamma/projects  (that project isn't there)
      const target = rest[0] === 'projects' && rest.length > 1 ? ['projects'] : rest;
      router.push(`/${next.slug}${target.length ? '/' + target.join('/') : ''}`);
    },
    [workspaces, setCurrent, routeSlug, pathname, router],
  );

  // Nothing to switch between, and no state worth explaining — the sidebar
  // shouldn't grow a control that does nothing.
  if (isLoading || workspaces.length === 0) return null;

  if (collapsed) {
    return (
      <div
        className="mx-2.5 mb-2.5 flex justify-center"
        title={current ? `Workspace: ${current.name}` : 'Workspace'}
      >
        <span
          className="w-6 h-6 rounded-sm flex-shrink-0"
          style={{ backgroundColor: current?.color ?? '#6366f1' }}
          aria-label={current ? `Workspace: ${current.name}` : 'Workspace'}
        />
      </div>
    );
  }

  // No label: the sidebar brand block and the first nav section both already
  // read "Workspace", and a third would be noise. The colour dot + the name in
  // the control carry the meaning.
  return (
    <div className="mx-2.5 mb-2.5 flex items-center gap-2">
      <span
        className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0')}
        style={{ backgroundColor: current?.color ?? '#6366f1' }}
        aria-hidden
      />
      <Select
        value={current?.id ?? ''}
        onValueChange={onChange}
        options={options}
        placeholder="Select workspace…"
        aria-label="Current workspace"
        className="flex-1 min-w-0"
      />
    </div>
  );
}
