'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { deleteCycleAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/cycles/actions';

/**
 * Deleting a cycle, with §6's safety rule satisfied before the click.
 *
 * "Deleting a definition with data requires an explicit choice about the data."
 * Deleting a custom field offers two answers because §7.11 names two ("delete
 * values, or export first"). A cycle has only one honest answer — the work goes
 * back to the backlog, and none of it is lost — so the screen **states** it and
 * names the number, rather than offering a choice that is not a choice.
 *
 * The count is what makes that statement worth anything: "delete this cycle"
 * and "delete this cycle, releasing 23 items" are different clicks, and only
 * the second one tells somebody what they are about to do.
 *
 * §11's five states: `[L]` the Button's spinner · `[E]` a cycle with no items
 * says so instead of naming a zero · `[S]` the action redirects to the cycles
 * list, because the page you were on no longer exists · `[X]` the error keeps
 * the panel open and expanded · `[!]` the confirmation is a second click rather
 * than a `confirm()`, which cannot be translated and cannot be styled.
 */
export function CycleDelete({
  workspaceSlug,
  projectSlug,
  projectId,
  cycleId,
  itemCount,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  cycleId: string;
  itemCount: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    deleteCycleAction,
    ROW_IDLE,
  );

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        {t('cycles.delete.start')}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md border border-danger/40 bg-surface p-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="cycleId" value={cycleId} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <p className="text-sm text-text">
        {itemCount === 0
          ? t('cycles.delete.confirmEmpty')
          : t('cycles.delete.confirm', { count: itemCount })}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          {t('cycles.delete.submit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {t('action.cancel')}
        </Button>
      </div>
    </form>
  );
}
