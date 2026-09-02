'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { archiveProjectAction } from '@/app/[locale]/[workspaceSlug]/projects/actions';

/**
 * §4: "Archive ≠ delete. An archived project is read-only — no new items, no
 * edits, no state changes, no comments — until it is unarchived, which is one
 * click."
 *
 * So this is one button in both directions, and unarchiving is not behind a
 * confirmation: archiving is the reversible action, and asking someone to
 * confirm the *undo* is how a safe operation starts to feel dangerous.
 */
export function ArchiveProject({
  workspaceSlug,
  projectSlug,
  projectId,
  archived,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  archived: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    archiveProjectAction,
    ROW_IDLE,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <Button type="submit" variant={archived ? 'secondary' : 'danger'} loading={pending}>
        {archived ? t('projects.unarchive') : t('projects.archive')}
      </Button>
    </form>
  );
}
