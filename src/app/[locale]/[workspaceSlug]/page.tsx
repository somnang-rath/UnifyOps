import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CrossProjectRows, MoreItemsNote } from '@/components/views/cross-project-rows';
import { resolveActorContext } from '@/server/auth/context';
import { listWorkItems } from '@/server/services/work-items';
import { OPEN_STATE_GROUPS } from '@/lib/needs-attention';
import { DUE_BUCKETS } from '@/lib/workspace-date';
import { emptyQuery, type WorkItemQuery } from '@/lib/work-item-query';
import { Link } from '@/i18n/navigation';
import { resolveWorkspaceScope } from './project-map';

/**
 * **My Work** — where a workspace opens (§7.3, §14 slice 13).
 *
 * "Open app → lands on MY WORK (never a project list), grouped by: Overdue ·
 * Today · This week · Later · No date."
 *
 * §2.1 is why this is the landing screen rather than a dashboard, and §17-6
 * records the correction: "My Work was buried under dashboards — RESOLVED. §2.1
 * says the employee must be paid back first." A tracker that only serves the
 * person reading the reports is a tracker whose data rots, because the people
 * entering it get nothing back. This screen is the payment.
 *
 * **No new query.** It is the §9 list query anchored on one assignee — the
 * caller themselves — grouped by §7.3's five due buckets. The grouping is one
 * SQL expression added in slice 13 (`dueBucketExpression`), mirroring the
 * `dueBucket` in `src/lib/workspace-date.ts` that slice 5 wrote in anticipation
 * of exactly this screen.
 *
 * §11's five states, all of them:
 *
 *   `[L]` Server-rendered; there is no client fetch to be loading.
 *   `[E]` **An empty My Work is good news and reads that way** (§7.3, §11):
 *         "You're clear. Here's what your team is working on", with a link to
 *         the team view. Never a bare "No results".
 *   `[S]` A state pill advances an item optimistically, in place, with no toast
 *         — the result is on screen (§11).
 *   `[X]` A refused change lands in the row that caused it, as a translated key.
 *   `[!]` A bucket caps at fifty and says so against the real total; an
 *         archived project's rows never appear, because it is read-only work
 *         nobody can act on; a member of no projects gets the empty state
 *         rather than an error.
 */
export default async function MyWorkPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const t = await getTranslations();
  const scope = await resolveWorkspaceScope(resolved, t);

  /**
   * Anchored on **me** (§9, §16), which is what makes this query legal without
   * naming a project: `anchorOf` has returned `'assignee'` for a filter naming a
   * set of people since slice 5, and this is the surface it was written for.
   *
   * Open work only, by state **group** rather than by name (§4) — a company that
   * renamed "Done" to "Shipped" has changed nothing, and one with two completed
   * states has both excluded. Cancelled is excluded for the same reason it is on
   * Needs Attention: work somebody decided not to do is not work to do today.
   *
   * `parentId: null`, so a parent and its sub-items do not read as duplicates.
   */
  const base = emptyQuery();
  const query: WorkItemQuery = {
    ...base,
    groupBy: 'due',
    // Soonest first inside every bucket, and undated work by priority — `due`
    // ascending puts nulls last in Postgres, which is the right order for the
    // one bucket where every value is null and the tiebreak does the work.
    sort: 'due',
    direction: 'asc',
    filters: {
      ...base.filters,
      assignees: [resolved.memberId],
      stateGroups: [...OPEN_STATE_GROUPS],
      parentId: null,
    },
  };

  const listing = await listWorkItems(resolved, query, {
    groupKeys: [...DUE_BUCKETS],
  });

  const byBucket = new Map(listing.groups.map((group) => [group.key, group]));
  const total = listing.groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('myWork.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('myWork.count', { count: total })}</p>

        <Link
          href={`/${workspaceSlug}/team`}
          className="ms-auto text-sm text-text-muted transition-colors duration-120 hover:text-text"
        >
          {t('dashboards.teamLink')}
        </Link>
      </header>

      {total === 0 ? (
        /*
         * §7.3, verbatim: "nothing assigned → 'You're clear. Here's what your
         * team is working on' + team view link. **Never a bare 'No results'** —
         * an empty My Work is good news and should read that way."
         */
        <section className="rounded-md border border-dashed border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm font-medium text-text">{t('myWork.clear')}</p>
          <p className="mt-1 text-sm text-text-muted">{t('myWork.clearHint')}</p>
          <Link
            href={`/${workspaceSlug}/team`}
            className="mt-4 inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
          >
            {t('dashboards.teamLink')}
          </Link>
        </section>
      ) : (
        <div className="space-y-3">
          {DUE_BUCKETS.map((bucket) => {
            const group = byBucket.get(bucket);
            // A bucket with nothing in it is dropped here, unlike a board
            // column — there is nothing to drag into it, and five headings with
            // four empty is a screen that reads as failure on the morning
            // somebody is nearly done.
            if (!group || group.total === 0) return null;

            return (
              <section
                key={bucket}
                aria-label={t(`myWork.bucket.${bucket}`)}
                className="overflow-hidden rounded-md border border-border bg-surface"
              >
                <header className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                  <span
                    className={
                      bucket === 'overdue'
                        ? 'text-sm font-medium text-danger'
                        : 'text-sm font-medium text-text'
                    }
                  >
                    {t(`myWork.bucket.${bucket}`)}
                  </span>
                  <span className="text-2xs font-medium tabular-nums text-text-subtle">
                    {group.total}
                  </span>
                </header>

                <CrossProjectRows
                  workspaceSlug={workspaceSlug}
                  locale={locale}
                  projects={scope.rowProjects}
                  items={group.rows}
                  people={listing.people}
                  labels={listing.labels}
                  today={listing.today}
                />

                <MoreItemsNote shown={group.rows.length} total={group.total} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
