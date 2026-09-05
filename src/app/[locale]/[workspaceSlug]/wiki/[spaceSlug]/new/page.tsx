import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewPageForm } from '@/components/wiki/new-page-form';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { resolveActorContext } from '@/server/auth/context';
import { getSpace } from '@/server/services/wiki';
import { createPageAction } from '../../actions';

/**
 * §20.3.2's create: "Space sidebar → 'New page' → title → body → save."
 *
 * A route rather than a dialog, because a page body is the longest thing anybody
 * types in this product and a modal is the wrong container for twenty minutes of
 * work — §12's Dialog is for a decision, and slice 14 built the first one in the
 * product for a palette. It is also what makes the draft survive a refresh: the
 * browser keeps a form's values on back-navigation, and a dialog has no URL to
 * come back to.
 *
 * A parent may be chosen, which is what makes the tree buildable at all — the
 * sidebar's "New page" link lands here with no parent, and the picker offers
 * every page shallow enough to take a child (§20.4's cap of 3).
 */
export default async function NewWikiPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, view] = await Promise.all([getTranslations(), getSpace(resolved, spaceSlug)]);
  if (!view) notFound();

  /*
   * A space this person may read but not write in 404s rather than rendering a
   * disabled form. §7.11's rule about the disabled select, applied to a whole
   * screen: "the picker says why rather than showing a disabled row nobody can
   * explain", and the sidebar simply does not offer the link.
   */
  if (!view.space.canWrite) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={[]}
        title={t('wiki.new.title')}
      />

      <h1 className="font-display text-xl font-semibold tracking-tight">{t('wiki.new.title')}</h1>

      <NewPageForm
        workspaceSlug={workspaceSlug}
        locale={locale === 'km' ? 'km' : 'en'}
        spaceId={view.space.id}
        parents={view.tree
          // Only pages that can still take a child: a parent at the cap would
          // put its child at depth 4, which 0032's trigger refuses. Offering it
          // and refusing afterwards is the shape §7.11 calls a disabled select.
          .filter((page) => page.depth < 3)
          .map((page) => ({ id: page.id, title: page.title, depth: page.depth }))}
        create={createPageAction}
      />
    </div>
  );
}
