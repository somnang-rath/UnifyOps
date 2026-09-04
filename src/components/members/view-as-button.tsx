'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { startViewAsAction } from '@/app/[locale]/[workspaceSlug]/settings/members/view-as-actions';

/**
 * §7.13's entry point: "Settings → Members → row → **View as**".
 *
 * One button and one form, deliberately with no confirmation. §7.13 is explicit
 * that this "is a permission an owner holds openly, not a back door" — a
 * confirmation dialog would frame it as something to be nervous about, and the
 * accountability is the audit row, not a second click. The bar that appears
 * immediately afterwards is what makes the state impossible to miss.
 *
 * The accessible name carries the person's name, because this is a column of
 * identical buttons and "View as" on its own tells a screen-reader user which
 * row they are on only if they happen to have just read it.
 */
export function ViewAsButton({
  workspaceSlug,
  memberId,
  memberName,
}: {
  workspaceSlug: string;
  memberId: string;
  memberName: string;
}) {
  const t = useTranslations('viewAs');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    startViewAsAction,
    ROW_IDLE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="memberId" value={memberId} />

      {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        {t('start', { name: memberName })}
      </Button>
    </form>
  );
}
