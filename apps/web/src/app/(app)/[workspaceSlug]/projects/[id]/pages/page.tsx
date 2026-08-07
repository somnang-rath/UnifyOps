'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FileText, Plus, Search, Trash2 } from 'lucide-react';
import { EmptyState } from '@prism/ui';
import { Button, IconButton } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { InputWithIcon } from '@/components/ui/input';
import { SkeletonText } from '@/components/ui/skeleton';
import { useProject } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useWorkspaceHref } from '@/hooks/use-workspaces';
import { useWikiList, useWikiMutations } from '@/hooks/use-wiki';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuthStore } from '@/stores/auth-store';
import { useFormat } from '@prism/i18n';
import type { WikiPageMeta } from '@/schemas/wiki';

/**
 * A project's Pages — the same documents as the workspace Wiki, filtered to
 * this project.
 *
 * There is no second editor here on purpose. `WikiPage` is already
 * project-scoped (`projectId` is required on the schema), and the wiki route
 * owns a large amount of hard-won behaviour — Tiptap + Yjs collaboration,
 * covers, publish-to-Space, the page tree. Re-hosting any of that would be the
 * triple-duplication this conversion is most prone to, so this tab is a
 * project-scoped index that opens each page in that editor via
 * `?project=&page=` and leaves editing where it already works.
 */
export default function ProjectPagesPage() {
  const f = useFormat();
  const { id: projectId } = useParams<{ id: string }>();
  const ws = useWorkspaceHref();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const { data: project } = useProject(projectId);
  const { data: users = [] } = useUsers();

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 220);
  const { data: pages = [], isLoading } = useWikiList(projectId, debouncedQ);
  const { create, remove } = useWikiMutations(projectId);

  const [deleting, setDeleting] = useState<WikiPageMeta | null>(null);

  const myId = me?._id ?? me?.id;
  const canWrite = !!(
    myId &&
    project &&
    (project.ownerId === myId || project.members.includes(myId))
  );

  const userMap = useMemo(() => new Map(users.map((u) => [u._id, u])), [users]);

  const hrefFor = (pageId: string) =>
    `${ws('/wiki')}?project=${projectId}&page=${pageId}`;

  // Create an untitled page, then hand straight off to the editor — asking for
  // a title in a modal first is a step nobody wants before they've written
  // anything.
  const createPage = () =>
    create.mutate(
      { projectId, title: 'Untitled page', content: '' },
      { onSuccess: (page) => router.push(hrefFor(page._id)) },
    );

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <InputWithIcon
          icon={<Search className="w-3.5 h-3.5" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pages…"
          aria-label="Search pages"
          className="max-w-[280px]"
        />
        {canWrite && pages.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            onClick={createPage}
            disabled={create.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            New page
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonText lines={5} />
      ) : pages.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          label={debouncedQ ? 'No pages match that search' : 'No pages yet'}
          hint={
            debouncedQ
              ? undefined
              : 'Write specs, meeting notes and knowledge that live with this project. Pages support collaborative editing and can be published to the public Space.'
          }
          action={
            canWrite && !debouncedQ ? (
              <Button
                size="sm"
                variant="primary"
                onClick={createPage}
                disabled={create.isPending}
              >
                <Plus className="w-3.5 h-3.5" />
                New page
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-px">
          {pages.map((page) => {
            const author = userMap.get(page.authorId);
            return (
              <li
                key={page._id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-sm border border-transparent hover:border-border hover:bg-bg-hover transition-colors"
              >
                <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                <Link
                  href={hrefFor(page._id)}
                  className="flex-1 min-w-0 truncate text-[13.5px] font-medium hover:text-accent"
                >
                  {page.title || 'Untitled page'}
                </Link>
                <span className="text-[11.5px] text-text-muted flex-shrink-0 hidden sm:inline">
                  {author?.name ?? 'Unknown'} · {f.relative(page.updatedAt)}
                </span>
                {canWrite && (
                  <IconButton
                    size="xs"
                    onClick={() => setDeleting(page)}
                    aria-label={`Delete page ${page.title}`}
                    // Hover-revealed but always keyboard-reachable.
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Confirm
        open={!!deleting}
        danger
        title="Delete page?"
        body={
          <>
            <strong>{deleting?.title || 'This page'}</strong> and its content
            will be permanently deleted.
          </>
        }
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
      />
    </div>
  );
}
