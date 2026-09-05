import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DeletedPages } from '@/components/wiki/deleted-pages';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { SpaceSidebar } from '@/components/wiki/space-sidebar';
import { Link } from '@/i18n/navigation';
import { displayName } from '@/lib/seeded-name';
import { hasKhmer } from '@/lib/search';
import { resolveActorContext } from '@/server/auth/context';
import { getSpace, listDeletedPages } from '@/server/services/wiki';
import { restorePageAction } from '../actions';

/**
 * §20.11's space home: the tree, with no page selected.
 *
 * `[E]` §20.3.2: "a space with no pages → 'Nothing written here yet' and the
 * create action, never a tour."
 */
export default async function SpacePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, view, deleted] = await Promise.all([
    getTranslations(),
    getSpace(resolved, spaceSlug),
    listDeletedPages(resolved),
  ]);
  // A space this actor may not read is indistinguishable from one that does not
  // exist, which is slice 16's rule for the 404 and the reason its copy names
  // four causes rather than one.
  if (!view) notFound();

  const name = displayName(view.space, (key) => t(key));

  return (
    <div className="space-y-4">
      <PageBreadcrumb workspaceSlug={workspaceSlug} space={view.space} ancestors={[]} />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <SpaceSidebar
            pages={view.tree}
            workspaceSlug={workspaceSlug}
            spaceSlug={spaceSlug}
            canWrite={view.space.canWrite}
          />
        </aside>

        <div className="min-w-0 space-y-3">
          <h1
            lang={hasKhmer(name) ? 'km' : undefined}
            className="font-display text-xl font-semibold tracking-tight"
          >
            {name}
          </h1>

          {view.tree.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">{t('wiki.space.empty')}</p>
              {/*
                A link styled as a button, which is the pattern the projects
                screen already uses: the destination is a route, so the control
                is an anchor — middle-click, copy-link and the back button all
                work, and none of them do on a `<button>` that navigates.
              */}
              {view.space.canWrite && (
                <Link
                  href={`/${workspaceSlug}/wiki/${spaceSlug}/new`}
                  className="inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
                >
                  {t('wiki.space.create')}
                </Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t('wiki.space.pick')}</p>
          )}

          {/*
            §20.3.6's restore, at the foot of the space it belongs to. §20.3.6
            asks for "the recovery screen that already exists for items" and that
            screen does not exist — see `deleted-pages.tsx` for the finding.
          */}
          {view.space.canWrite && (
            <DeletedPages
              workspaceSlug={workspaceSlug}
              locale={locale === 'km' ? 'km' : 'en'}
              pages={deleted
                .filter((row) => row.spaceId === view.space.id)
                .map((row) => ({
                  id: row.id,
                  title: row.title,
                  deletedAt: row.deletedAt.toISOString(),
                }))}
              restore={restorePageAction}
            />
          )}
        </div>
      </div>
    </div>
  );
}
