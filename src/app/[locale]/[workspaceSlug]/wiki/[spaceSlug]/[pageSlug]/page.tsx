import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { PageDelete } from '@/components/wiki/page-delete';
import { PageLinks } from '@/components/wiki/page-links';
import { PageReader, pageContext } from '@/components/wiki/page-reader';
import { SpaceSidebar } from '@/components/wiki/space-sidebar';
import { resolveActorContext } from '@/server/auth/context';
import { getPage } from '@/server/services/wiki';
import { deletePageAction, linkPageAction, unlinkPageAction } from '../../actions';

/**
 * §20.11's reader.
 *
 * `[!]` a deleted page → slice 16's 404, "which names four causes" — moved,
 * deleted, never existed, or another company's. The same `notFound()` covers a
 * space this actor may not read, and deliberately: a message that distinguished
 * them would hand back exactly what the 404 withholds.
 *
 * One `getPage` for the whole screen — the space, the tree, the page, the
 * breadcrumb, the links and the names behind all three token formats — because
 * §20.12 asks for it and five earlier slices paid for the lesson.
 */
export default async function WikiPageReader({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string; pageSlug: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug, pageSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const view = await getPage(resolved, { spaceSlug, pageSlug });
  if (!view) notFound();

  return (
    <div className="space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={view.ancestors}
        title={view.page.title}
      />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_14rem]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <SpaceSidebar
            pages={view.tree}
            workspaceSlug={workspaceSlug}
            spaceSlug={spaceSlug}
            currentSlug={pageSlug}
            canWrite={view.canWrite}
          />
        </aside>

        <div className="min-w-0">
          <PageReader
            page={view.page}
            workspaceSlug={workspaceSlug}
            spaceSlug={spaceSlug}
            mentioned={view.mentioned}
            pages={view.pages}
            canWrite={view.canWrite}
          />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <PageLinks
            workspaceSlug={workspaceSlug}
            locale={locale === 'km' ? 'km' : 'en'}
            pageId={view.page.id}
            links={view.links.map((link) => ({
              workItemId: link.workItemId,
              identifier: `${link.projectKey}-${link.number}`,
              title: link.title,
              projectSlug: link.projectSlug,
              number: link.number,
            }))}
            canWrite={view.canWrite}
            link={linkPageAction}
            unlink={unlinkPageAction}
          />

          {/*
            §20.3.6, in the panel rather than in the header: deleting is not
            something anybody arrives at this page to do, and a destructive
            control beside the title is one mis-click from a page somebody has to
            go and restore. The count of children it would reparent is computed
            from the tree the sidebar already has — no extra query.
          */}
          {view.canWrite && (
            <div className="pt-4">
              <PageDelete
                workspaceSlug={workspaceSlug}
                locale={locale === 'km' ? 'km' : 'en'}
                pageId={view.page.id}
                childCount={view.tree.filter((row) => row.parentId === view.page.id).length}
                remove={deletePageAction}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Unused here, but the reader's page-token map is built by the same helper. */
void pageContext;
