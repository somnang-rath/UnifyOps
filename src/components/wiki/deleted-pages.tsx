'use client';

import { useActionState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';

export type DeletedPage = {
  id: string;
  title: string;
  deletedAt: string;
};

/**
 * §20.3.6's other half: getting a deleted page back.
 *
 * **§20.3.6 says this belongs "on the recovery screen that already exists for
 * items", and that screen does not exist.** §4 promises a 30-day recovery window
 * and nothing in slices 0–17 built a surface for it — the plan's sentence was
 * written from the promise rather than from the code, which is the same shape of
 * gap slice 16 found in §7.1's seven-step path ("the product delivered five of
 * them"). Recorded rather than quietly widened.
 *
 * So the restore list lives at the foot of the space it belongs to, which is
 * where somebody looking for a page they deleted actually goes. When a
 * workspace-wide recovery screen is built, this is a section it should absorb
 * rather than a second implementation to keep in step.
 *
 * **It renders nothing when nothing has been deleted.** A permanent "Deleted
 * pages (0)" heading on every space is furniture that teaches people to ignore
 * the region — and, worse, invites somebody to read the empty list as proof that
 * nothing was ever deleted, which it is not: the window is 30 days.
 */
export function DeletedPages({
  workspaceSlug,
  locale,
  pages,
  restore,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pages: DeletedPage[];
  restore: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');

  if (pages.length === 0) return null;

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-text-muted">
        {t('deleted.title')}
      </h2>
      <p className="text-2xs text-text-subtle">{t('deleted.window')}</p>

      <ul className="space-y-1">
        {pages.map((page) => (
          <li key={page.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span
              lang={hasKhmer(page.title) ? 'km' : undefined}
              className="line-clamp-1 min-w-0 flex-1 text-text-muted"
            >
              {page.title}
            </span>
            <RestorePage
              workspaceSlug={workspaceSlug}
              locale={locale}
              page={page}
              restore={restore}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestorePage({
  workspaceSlug,
  locale,
  page,
  restore,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  page: DeletedPage;
  restore: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const format = useFormatter();
  const [state, action, pending] = useActionState(restore, ROW_IDLE);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={page.id} />

      <span className="text-2xs text-text-subtle">
        {format.dateTime(new Date(page.deletedAt), 'short')}
      </span>

      {state.error && (
        <span className="text-2xs text-danger">{t(state.error.replace(/^wiki\./, ''))}</span>
      )}

      {/*
        No confirmation: a restore adds a page back and takes nothing away, which
        is the same reasoning `RestoreButton` gives for a revision — "a modal in
        front of an operation that adds rather than removes would be the product
        being frightened of its own safety net".
      */}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t('deleted.restoring') : t('deleted.restore')}
      </Button>
    </form>
  );
}
