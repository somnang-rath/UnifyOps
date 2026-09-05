'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';

/**
 * Deleting a page (§20.3.6).
 *
 * **Soft, with §4's 30-day window, and its children survive it.** The service
 * reparents them to the deleted page's own parent before it marks the row, and
 * `wiki_page_parent_fk` is `restrict` underneath — "deleting a container must
 * never decide the fate of what is inside it", the rule `deleteCycle` follows
 * and `work_item_state_fk` enforces.
 *
 * **Two clicks, and the second one says how many children move.** §7.11's rule
 * for deleting a custom field is that the confirmation names the number before
 * anybody clicks; the same applies here, because "delete this page" and "delete
 * this page and move its four sub-pages up a level" are different decisions and
 * only one of them is the one being offered.
 *
 * Not a `Dialog`: §12's Dialog is for a decision that needs the rest of the
 * screen out of the way, and this one is better made *with* the page visible.
 * The inline confirm is `attachment-delete.tsx`'s pattern and
 * `RestoreButton`'s in the revision list.
 */
export function PageDelete({
  workspaceSlug,
  locale,
  pageId,
  childCount,
  remove,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  /** How many sub-pages will be lifted a level (§20.3.6). */
  childCount: number;
  remove: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(remove, ROW_IDLE);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <span className="flex items-center gap-2">
        {/*
          §11: a refused mutation reports in the row that caused it rather than
          in a toast — the rule slice 5 set for the list and slice 6 kept.
        */}
        {state.error && (
          <span className="text-2xs text-danger">{t(state.error.replace(/^wiki\./, ''))}</span>
        )}
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
          {t('delete.action')}
        </Button>
      </span>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />

      <span className="text-2xs text-text-muted">
        {childCount > 0 ? t('delete.withChildren', { count: childCount }) : t('delete.confirmHint')}
      </span>

      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? t('delete.deleting') : t('delete.confirm')}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        {t('delete.cancel')}
      </Button>
    </form>
  );
}
