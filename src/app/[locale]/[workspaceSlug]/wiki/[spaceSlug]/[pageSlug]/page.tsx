import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageBacklinks } from '@/components/wiki/page-backlinks';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { PageDelete } from '@/components/wiki/page-delete';
import { PageIconForm } from '@/components/wiki/page-icon-form';
import { PageLinks } from '@/components/wiki/page-links';
import { PageReader, pageContext } from '@/components/wiki/page-reader';
import { PageToc } from '@/components/wiki/page-toc';
import { SpaceSidebar } from '@/components/wiki/space-sidebar';
import { VerificationPanel } from '@/components/wiki/verification-panel';
import { resolveActorContext } from '@/server/auth/context';
import { getPage } from '@/server/services/wiki';
import {
  deletePageAction,
  linkPageAction,
  setPageIconAction,
  unlinkPageAction,
} from '../../actions';

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
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string; pageSlug: string }>;
  searchParams: Promise<{ unverified?: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug, pageSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [view, { unverified }] = await Promise.all([
    getPage(resolved, { spaceSlug, pageSlug }),
    searchParams,
  ]);
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

        <div className="min-w-0 space-y-6">
          <PageReader
            page={view.page}
            workspaceSlug={workspaceSlug}
            spaceSlug={spaceSlug}
            mentioned={view.mentioned}
            pages={view.pages}
            canWrite={view.canWrite}
          />

          {/*
            §21.4's "what links here", **at the foot of the reader** and not in
            the sidebar. It is part of the document's own tail — a reader who has
            finished the page is exactly the person for whom "and here is where
            else this is discussed" is the next useful thing.
          */}
          <PageBacklinks backlinks={view.backlinks} workspaceSlug={workspaceSlug} />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
          {/*
            §21.5's table of contents, at the top of the right rail: it is
            navigation *within* this page, so it sits above the panels that talk
            about the page. It renders nothing at all when the body has fewer
            than two headings.
          */}
          <PageToc body={view.page.body} />

          {/*
            §21.3's panel, above the links: "who is answerable for this, and is
            it still true" is the question a reader asks before they act on a
            page, and the linked items are context for it rather than the other
            way round.
          */}
          <VerificationPanel
            pageId={view.page.id}
            revisionNo={view.page.revisionNo}
            workspaceSlug={workspaceSlug}
            locale={locale === 'km' ? 'km' : 'en'}
            verification={view.verification}
            members={view.members}
            currentMemberId={resolved.memberId}
            canWrite={view.canWrite}
            // §21.3: "the writer sees it happen and can re-verify in the same
            // visit if the edit was a typo fix." The editor redirects with this
            // set when the save it just made cleared a verification.
            justUnverified={unverified === '1'}
          />

          {/*
            §21.2's page icon, in the panel rather than in the header: it is a
            property of the page like its owner, and a control beside the title
            would put an editable field in the middle of what a reader is here to
            read. Only somebody who can write in the space sees it.
          */}
          {view.canWrite && (
            <PageIconForm
              workspaceSlug={workspaceSlug}
              locale={locale === 'km' ? 'km' : 'en'}
              pageId={view.page.id}
              icon={view.page.icon}
              save={setPageIconAction}
            />
          )}

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
