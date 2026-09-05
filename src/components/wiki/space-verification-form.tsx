'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ROW_IDLE } from '@/lib/form-state';
import { VERIFICATION_DAYS, type VerificationDays } from '@/lib/wiki';
import { setSpaceVerificationDefaultAction } from '@/app/[locale]/[workspaceSlug]/wiki/actions';

/**
 * The space's standing review cycle (§21.3 — slice 19).
 *
 * "The space carries a default, and that is the one new `wiki_space` column. A
 * company space of policies wants 180 days; a project space of scratch notes
 * wants Never. One column, applied at page creation and overridable per page, so
 * a policy space does not depend on somebody remembering on every page."
 *
 * **The default default is *Never*, and that is §6's rule rather than a
 * convenience.** "A company that never opens Settings must be completely fine" —
 * so a space nobody configures behaves exactly as the wiki did before slice 19,
 * and nothing in the product starts nagging because a feature shipped.
 *
 * A native `<select>` with four options, which is `SelectField`'s own reasoning:
 * §12 asks for a Radix Select above seven options, and below that the platform
 * control is better than anything we would build — already keyboard-operable,
 * already announced, and on a phone it opens the OS picker.
 */
export function SpaceVerificationForm({
  spaceId,
  workspaceSlug,
  locale,
  defaultDays,
}: {
  spaceId: string;
  workspaceSlug: string;
  locale: 'en' | 'km';
  defaultDays: VerificationDays | null;
}) {
  const t = useTranslations('wiki');
  const [state, save, saving] = useActionState(setSpaceVerificationDefaultAction, ROW_IDLE);

  return (
    <form
      action={save}
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-3"
    >
      <input type="hidden" name="spaceId" value={spaceId} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-2xs font-medium text-text-muted">
        {t('verification.spaceDefault')}
        <select
          name="days"
          defaultValue={defaultDays === null ? 'never' : String(defaultDays)}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text"
        >
          <option value="never">{t('verification.periodNever')}</option>
          {VERIFICATION_DAYS.map((days) => (
            <option key={days} value={days}>
              {t('verification.periodDays', { count: days })}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" size="sm" loading={saving}>
        {t('verification.save')}
      </Button>

      <p className="w-full text-2xs text-text-muted">{t('verification.spaceDefaultHint')}</p>

      {state.error && (
        <span role="alert" className="w-full text-2xs text-danger">
          {t(state.error.replace(/^wiki\./, ''))}
        </span>
      )}
    </form>
  );
}
