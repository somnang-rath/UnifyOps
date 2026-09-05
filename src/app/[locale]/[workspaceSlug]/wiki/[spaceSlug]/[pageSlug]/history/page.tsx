import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { RevisionCompare } from '@/components/wiki/revision-compare';
import { RevisionList } from '@/components/wiki/revision-list';
import { resolveActorContext } from '@/server/auth/context';
import { getCompare, getHistory } from '@/server/services/wiki';
import { restoreRevisionAction } from '../../../actions';

/**
 * §20.11's history screen, and §20.2's side-by-side compare.
 *
 * **The comparison is in the URL** (`?from=&to=`), which is §5's rule that a
 * view worth looking at is a view worth sharing — the same call slice 7 made for
 * "show all activity" and slice 12 for a saved view. "Look at what changed
 * between 4 and 7" is exactly the thing somebody pastes into a chat.
 *
 * Two service calls rather than one, and only when a comparison is asked for:
 * the list is what the screen is, and the compare is a second question about two
 * specific rows. Folding them together would fetch two full bodies on every
 * visit to a screen that usually shows neither.
 */
export default async function WikiHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string; pageSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug, spaceSlug, pageSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, view, query] = await Promise.all([
    getTranslations(),
    getHistory(resolved, { spaceSlug, pageSlug }),
    searchParams,
  ]);
  if (!view) notFound();

  const from = numberFrom(query.from);
  const to = numberFrom(query.to);

  /*
   * A malformed or unknown revision number is dropped rather than refused —
   * §9's "discarding rather than failing", which the filter DSL already applies
   * to a URL somebody edited by hand. A link naming a revision that has been
   * pruned shows the history instead of an error page.
   */
  const comparison =
    from !== null && to !== null && from !== to
      ? await getCompare(resolved, { spaceSlug, pageSlug, from, to })
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={[]}
        title={view.page.title}
      />

      <h1 className="font-display text-xl font-semibold tracking-tight">
        {t('wiki.history.title')}
      </h1>

      {comparison?.from && comparison.to && (
        <RevisionCompare from={comparison.from} to={comparison.to} />
      )}

      <RevisionList
        revisions={view.revisions.map((revision) => ({
          id: revision.id,
          revisionNo: revision.revisionNo,
          title: revision.title,
          authorName: revision.authorName,
          createdAt: revision.createdAt.toISOString(),
        }))}
        workspaceSlug={workspaceSlug}
        locale={locale === 'km' ? 'km' : 'en'}
        spaceSlug={spaceSlug}
        pageSlug={pageSlug}
        pageId={view.page.id}
        currentRevision={view.page.revisionNo}
        canWrite={view.canWrite}
        restore={restoreRevisionAction}
      />
    </div>
  );
}

function numberFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
