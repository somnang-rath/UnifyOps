import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageBacklinks } from '@/components/wiki/page-backlinks';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { PageDelete } from '@/components/wiki/page-delete';
import { PageIconForm } from '@/components/wiki/page-icon-form';
import { PageLinks } from '@/components/wiki/page-links';
import { PageReader, pageContext } from '@/components/wiki/page-reader';
import { PageTemplateForm } from '@/components/wiki/page-template-form';
import { PageToc } from '@/components/wiki/page-toc';
import { SpaceSidebar } from '@/components/wiki/space-sidebar';
import { VerificationPanel } from '@/components/wiki/verification-panel';
import { CommentThread } from '@/components/work-item/comment-thread';
import { resolveActorContext } from '@/server/auth/context';
import { getPage } from '@/server/services/wiki';
import {
  deletePageAction,
  deletePageCommentAction,
  linkPageAction,
  postPageCommentAction,
  setPageIconAction,
  setPageTemplateAction,
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
  searchParams: Promise<{ unverified?: string; comments?: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug, pageSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  /**
   * `?comments=all` widens the thread from 100 to 500, exactly as it does on an
   * item and as `?activity=all` does beside it (slice 7).
   *
   * A search param rather than an entry in the filter DSL: that DSL describes a
   * query over many items and has no business carrying one page's scroll depth,
   * and a link is shareable and back-buttonable where a button is neither. Read
   * before `getPage`, because it changes what `getPage` fetches.
   */
  const { unverified, comments } = await searchParams;
  const allComments = comments === 'all';

  const view = await getPage(resolved, { spaceSlug, pageSlug, thread: true, allComments });
  if (!view) notFound();

  /**
   * What the thread posts back with (§21.6).
   *
   * The wiki's own pair of actions travels with it, so `CommentThread` — which
   * slice 8 wrote for a work item and slice 21 made subject-agnostic — needs to
   * know nothing about which route it is rendering inside.
   */
  const threadContext = {
    workspaceSlug,
    locale,
    subject: { kind: 'wiki_page' as const, pageId: view.page.id },
    post: postPageCommentAction,
    remove: deletePageCommentAction,
  };

  return (
    <div className="space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={view.ancestors}
        title={view.page.title}
      />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_14rem]">
        {/*
          §21.8's PDF is this screen through the print stylesheet, so everything
          that is navigation rather than document is marked for it. §17-26's rule
          is already in `globals.css`; what a screen owes it is saying which of
          its parts are chrome. The sidebar, the right rail and the thread are —
          a printed policy is the policy.
        */}
        <aside data-print="hide" className="lg:sticky lg:top-4 lg:self-start">
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

          {/*
            §21.6's thread, **below the backlinks and outside the right rail**.

            A page's conversation is part of the document's tail rather than a
            property of it: the panels on the right answer "who is answerable for
            this and is it still true", and a question somebody asked about a
            paragraph belongs under the paragraph. It is also the widest thing on
            the screen after the body, and a thread squeezed into a 14rem rail is
            a thread nobody replies in.

            §21.6 refuses the alternative that would have put it elsewhere:
            "inline comments anchored to a phrase are refused — an anchor is
            block identity. A page comment quotes the sentence it is about, which
            is what a person does anyway."
          */}
          {/* Never null here — this route asks for it. The guard is the type
              system's, not a runtime doubt. */}
          {view.thread && (
          <div data-print="hide">
          <CommentThread
            thread={view.thread}
            context={threadContext}
            timezone={resolved.workspace.timezone}
            showAllHref={
              allComments
                ? null
                : `/${workspaceSlug}/wiki/${spaceSlug}/${pageSlug}?comments=all`
            }
          />
          </div>
          )}
        </div>

        <aside data-print="hide" className="lg:sticky lg:top-4 lg:self-start space-y-4">
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

          {/*
            §21.7's flag, under the icon and above the links: it is a property of
            the page in the same way those are, and the panel is where §21.2 put
            the last one for exactly that reason.
          */}
          {view.canWrite && (
            <PageTemplateForm
              workspaceSlug={workspaceSlug}
              locale={locale === 'km' ? 'km' : 'en'}
              pageId={view.page.id}
              isTemplate={view.page.isTemplate}
              save={setPageTemplateAction}
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
