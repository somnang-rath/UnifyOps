import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { PageEditor } from '@/components/wiki/page-editor';
import { pageContext } from '@/components/wiki/page-reader';
import { resolveActorContext } from '@/server/auth/context';
import { getPage } from '@/server/services/wiki';
import { savePageAction } from '../../../actions';

/**
 * §20.3.2's editor, and the screen §20.3.3's refusal lands on.
 *
 * A person who may read but not write is sent to the reader rather than shown a
 * disabled form — §7.11's rule again, and the reader is the thing they actually
 * wanted. `notFound()` would be wrong here: the page exists and they can see it.
 */
export default async function EditWikiPage({
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
  if (!view.canWrite) {
    const { redirect } = await import('@/i18n/navigation');
    redirect({ href: `/${workspaceSlug}/wiki/${spaceSlug}/${pageSlug}`, locale });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={view.ancestors}
        title={view.page.title}
      />

      <PageEditor
        workspaceSlug={workspaceSlug}
        locale={locale === 'km' ? 'km' : 'en'}
        spaceSlug={spaceSlug}
        page={{
          id: view.page.id,
          title: view.page.title,
          body: view.page.body,
          slug: view.page.slug,
          revisionNo: view.page.revisionNo,
        }}
        mentioned={view.mentioned}
        pages={pageContext(view.pages, workspaceSlug)}
        save={savePageAction}
      />
    </div>
  );
}
