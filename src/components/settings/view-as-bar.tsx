'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { exitViewAsAction } from '@/app/[locale]/[workspaceSlug]/settings/members/view-as-actions';

/**
 * §7.13's persistent bar: "A persistent bar names who is being viewed and
 * offers **Exit**."
 *
 * It sits above everything, on every screen, and it is not dismissible — the
 * whole failure it prevents is an owner forgetting they are inside somebody
 * else's session and reporting a bug about a screen that is behaving exactly as
 * it should for the person they are pretending to be.
 *
 * **It does not say "read-only" as a warning, it says it as a fact**, because
 * every mutation is already refused three times over: the policy module denies
 * every action with the distinct reason `read_only`, `uow.emit` throws, and
 * every tenant table's write policy carries `and not tenancy.is_read_only()`.
 * The bar's job is to explain the refusals somebody is about to meet.
 *
 * `role="status"` rather than `role="alert"`: it is present from the first
 * paint rather than interrupting, and an alert that fires on every navigation
 * would make a screen reader announce the same sentence on every click.
 */

export function ViewAsBar({
  workspaceSlug,
  name,
  ended,
}: {
  workspaceSlug: string;
  /** Who is being viewed. Null when the session has just ended by itself. */
  name: string | null;
  /**
   * §7.13's `[!]`: "the member is removed mid-session → view-as ends with an
   * explanation, not a 404." The session has already reverted server-side; this
   * is the explanation, and its button is what clears the cookie.
   */
  ended: boolean;
}) {
  const t = useTranslations('viewAs');
  const locale = useLocale();
  const [, action, pending] = useActionState<RowActionState, FormData>(exitViewAsAction, ROW_IDLE);

  return (
    <div
      role="status"
      className={
        ended
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning bg-warning-subtle px-4 py-2 text-sm text-text sm:px-6'
          : 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent bg-accent-subtle px-4 py-2 text-sm text-text sm:px-6'
      }
    >
      <span className="font-medium">{ended ? t('ended') : t('viewing', { name: name ?? '' })}</span>

      {!ended && <span className="text-text-muted">{t('readOnly')}</span>}

      <form action={action} className="ms-auto">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <Button type="submit" size="sm" loading={pending}>
          {ended ? t('dismiss') : t('exit')}
        </Button>
      </form>
    </div>
  );
}
