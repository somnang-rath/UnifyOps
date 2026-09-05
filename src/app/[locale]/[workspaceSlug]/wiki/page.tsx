import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { displayName } from '@/lib/seeded-name';
import { hasKhmer } from '@/lib/search';
import { resolveActorContext } from '@/server/auth/context';
import { listSpaces } from '@/server/services/wiki';

/**
 * §20.11's space list.
 *
 * `[E]` is the interesting state here, and §20.11 says why: "No spaces yet —
 * impossible after signup, so it reads as a fault, not as an invitation." A
 * company space is seeded with the workspace and a project space with every
 * project, so an empty list means something went wrong rather than that
 * somebody has not started. The copy says so instead of offering a cheerful
 * "create your first space", which would be an invitation to do a thing this
 * screen deliberately offers no control for — §20.2 allows exactly two kinds of
 * space and neither is created by hand.
 *
 * No permission check on the page beyond membership: `listSpaces` returns only
 * the spaces this actor may read, which is §20.5's rule asked in the one place
 * it is implemented.
 */
export default async function WikiPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, spaces] = await Promise.all([getTranslations(), listSpaces(resolved)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">{t('wiki.title')}</h1>
        <p className="text-sm text-text-muted">{t('wiki.subtitle')}</p>
      </header>

      {spaces.length === 0 ? (
        <EmptyState title={t('wiki.spaces.emptyTitle')} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {spaces.map((space) => {
            const name = displayName(space, (key) => t(key));

            return (
              <li key={space.id}>
                <Link
                  href={`/${workspaceSlug}/wiki/${space.slug}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-3 hover:bg-surface-sunken sm:px-4"
                >
                  <span
                    lang={hasKhmer(name) ? 'km' : undefined}
                    className="line-clamp-1 text-sm font-medium text-text"
                  >
                    {name}
                  </span>
                  <span className="shrink-0 text-2xs text-text-muted tabular-nums">
                    {t('wiki.spaces.pageCount', { count: space.pageCount })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
