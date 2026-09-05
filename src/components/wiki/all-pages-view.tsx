import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/feedback';
import { LabelChip } from '@/components/work-item/label-chip';
import { Link } from '@/i18n/navigation';
import type { LabelColor } from '@/lib/label-colors';
import { hasKhmer } from '@/lib/search';
import type { PageFilter, SpacePageView } from '@/server/services/wiki';
import { VerificationBadge } from './verification-badge';

/**
 * §21.3's All-pages view — "where the feature becomes usable rather than merely
 * present" (slice 19).
 *
 * "Title, owner, verification state, expiry, last edited, last editor —
 * sortable, and filterable to *unverified*, *expiring within 30 days*, *owned by
 * me*, *owned by nobody*."
 *
 * A **server** component, like `PageReader` and for the same reason: nothing
 * here is interactive. The filters are links, which is the call slice 7 made for
 * the activity feed's "show all" — a filtered list is shareable,
 * back-buttonable and needs no client at all, and "every unowned page in the
 * company space" is exactly the URL somebody wants to send a colleague.
 *
 * **Not a `Table` primitive**, and not §12's TableView either. This is a plain
 * `<table>` because the §12 component carries column resizing, per-saved-view
 * layout persistence and the §9 query's grouping — all of which belong to work
 * items, and none of which §21.3 asks for. §20.8's rule that "a page is not a
 * work item and must not pretend to be one" applies to the component as much as
 * to the query.
 *
 * The five states: `[L]` is the route's `loading.tsx`, which skeletons rows;
 * `[E]` is below and says something true rather than shrugging; `[S]` is the
 * table; `[X]` and `[!]` belong to the mutations, which live on the page itself.
 */

const FILTERS: { value: PageFilter; key: string }[] = [
  { value: 'all', key: 'filterAll' },
  { value: 'unverified', key: 'filterUnverified' },
  { value: 'expiring', key: 'filterExpiring' },
  { value: 'mine', key: 'filterMine' },
  { value: 'unowned', key: 'filterUnowned' },
];

export async function AllPagesView({
  pages,
  counts,
  filter,
  workspaceSlug,
  spaceSlug,
  labels,
}: {
  pages: SpacePageView[];
  counts: { expired: number; expiring: number; unverified: number; unowned: number };
  filter: PageFilter;
  workspaceSlug: string;
  spaceSlug: string;
  labels: { id: string; name: string; color: string }[];
}) {
  const [t, format] = await Promise.all([getTranslations('wiki.pages'), getFormatter()]);

  const byId = new Map(labels.map((row) => [row.id, row]));
  const needingReview = counts.expired + counts.expiring;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight text-text">
          {t('title')}
        </h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>

        {/*
          §21.3's standing count: "a list somebody chooses to look at rather than
          a message that arrives." Stated as a sentence rather than a badge,
          because zero is the good answer and a badge showing 0 reads as a
          control somebody has failed to use.
        */}
        <p className="text-2xs text-text-muted">
          {needingReview > 0 ? t('needsReview', { count: needingReview }) : t('allReviewed')}
        </p>
      </header>

      <nav aria-label={t('title')} className="flex flex-wrap gap-1">
        {FILTERS.map((entry) => {
          const active = entry.value === filter;
          return (
            <Link
              key={entry.value}
              // `all` drops the parameter rather than spelling out the default,
              // so the unfiltered URL is the clean one somebody bookmarks.
              href={
                entry.value === 'all'
                  ? `/${workspaceSlug}/wiki/${spaceSlug}/pages`
                  : `/${workspaceSlug}/wiki/${spaceSlug}/pages?filter=${entry.value}`
              }
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-sm border border-accent bg-accent-subtle px-2 py-1 text-2xs font-medium text-text'
                  : 'rounded-sm border border-border bg-surface px-2 py-1 text-2xs text-text-muted hover:bg-surface-hover'
              }
            >
              {t(entry.key)}
            </Link>
          );
        })}
      </nav>

      {pages.length === 0 ? (
        <EmptyState
          title={
            filter === 'all'
              ? t('empty')
              : filter === 'unverified'
                ? // §21.3's `[E]`: "a space where nothing is verified reads as
                  // *nothing here has been reviewed yet*, which is a true and
                  // actionable sentence rather than a fault."
                  t('emptyUnverified')
                : t('emptyFiltered')
          }
        />
      ) : (
        // §15-6: wide content scrolls inside its own container so the *document*
        // never scrolls sideways at 390px — the property `responsive.spec.ts`
        // asserts on every screen.
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-2xl border-collapse text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-left">
                <Th>{t('columnTitle')}</Th>
                <Th>{t('columnOwner')}</Th>
                <Th>{t('columnStatus')}</Th>
                <Th>{t('columnExpires')}</Th>
                <Th>{t('columnUpdated')}</Th>
                <Th>{t('columnEditor')}</Th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/${workspaceSlug}/wiki/${spaceSlug}/${page.slug}`}
                      className="font-medium text-text hover:underline"
                      // §20.10 / §13: a content-derived lang, because a Khmer
                      // title inheriting `lang="en"` clips its diacritics. The
                      // same detector `searchRoute` uses, so text that searches
                      // as Khmer also renders as Khmer.
                      lang={hasKhmer(page.title) ? 'km' : undefined}
                    >
                      {page.title}
                    </Link>

                    {page.labelIds.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {page.labelIds.flatMap((id) => {
                          const row = byId.get(id);
                          return row
                            ? [
                                <LabelChip
                                  key={id}
                                  name={row.name}
                                  color={row.color as LabelColor}
                                />,
                              ]
                            : [];
                        })}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top text-text-muted">
                    {page.ownerName ?? (
                      // Unowned is a state with a name, not a blank cell — it is
                      // one of the four filters, and a blank would read as
                      // missing data rather than as an answer.
                      <span className="text-text-subtle">{t('columnOwner')}: —</span>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top">
                    <VerificationBadge
                      status={page.status}
                      verifiedAt={page.verifiedAt}
                      verifiedByName={page.verifiedByName}
                      expiresAt={page.verificationExpiresAt}
                    />
                  </td>

                  <td className="px-3 py-2 align-top whitespace-nowrap text-text-muted">
                    {page.verificationExpiresAt === null
                      ? '—'
                      : format.dateTime(
                          new Date(`${page.verificationExpiresAt}T00:00:00Z`),
                          'short',
                        )}
                  </td>

                  <td className="px-3 py-2 align-top whitespace-nowrap text-text-muted">
                    {format.dateTime(page.updatedAt, 'short')}
                  </td>

                  <td className="px-3 py-2 align-top text-text-muted">
                    {page.lastEditorName ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 text-2xs font-medium text-text-muted">
      {children}
    </th>
  );
}
