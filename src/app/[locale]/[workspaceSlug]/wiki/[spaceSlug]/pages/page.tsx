import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { AllPagesView } from '@/components/wiki/all-pages-view';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { SpaceVerificationForm } from '@/components/wiki/space-verification-form';
import { resolveActorContext } from '@/server/auth/context';
import { listSpacePages, type PageFilter } from '@/server/services/wiki';

/**
 * §21.3's All-pages view (slice 19).
 *
 * "The All-pages view is one query over one space, and it is where the feature
 * becomes usable rather than merely present."
 *
 * A route rather than a tab on the space home, because the filters are links and
 * §5's promise is that a view is a URL somebody can paste — "every unowned page
 * in the company space" is a thing one person sends another, and a tab whose
 * state lives in the client is not.
 */

const FILTERS = new Set<PageFilter>(['all', 'unverified', 'expiring', 'mine', 'unowned']);

export default async function AllPagesRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const { filter: raw } = await searchParams;

  /**
   * An unrecognised filter widens the list rather than failing.
   *
   * §9's "discarding rather than failing", applied to the one search parameter
   * this screen takes: a link naming a filter a later build renamed should show
   * every page, not an error page. The same call `withKnownCustomFilters` makes
   * for a filter naming a deleted field.
   */
  const filter: PageFilter = FILTERS.has(raw as PageFilter) ? (raw as PageFilter) : 'all';

  const view = await listSpacePages(resolved, { spaceSlug, filter });
  // Indistinguishable from a space that does not exist, which is slice 16's
  // rule for the 404 and the reason its copy names four causes rather than one.
  if (!view) notFound();

  return (
    <div className="space-y-4">
      <PageBreadcrumb workspaceSlug={workspaceSlug} space={view.space} ancestors={[]} />

      <AllPagesView
        pages={view.pages}
        counts={view.counts}
        filter={filter}
        workspaceSlug={workspaceSlug}
        spaceSlug={spaceSlug}
        labels={view.labels}
      />

      {/*
        The space's standing review cycle sits under the list it governs, and
        only for somebody who may write here — §6's rule that "a company that
        never opens Settings must be completely fine" applies to this too: the
        default default is *Never*, so a space nobody configures behaves exactly
        as it did before slice 19.
      */}
      {view.space.canWrite && (
        <SpaceVerificationForm
          spaceId={view.space.id}
          workspaceSlug={workspaceSlug}
          locale={locale === 'km' ? 'km' : 'en'}
          defaultDays={view.defaultDays}
        />
      )}
    </div>
  );
}
