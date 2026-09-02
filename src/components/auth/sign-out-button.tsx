'use client';

import { useLocale, useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/[locale]/(auth)/actions';

/**
 * A form, not a link.
 *
 * Signing out changes state, and a GET that changes state is prefetchable — the
 * browser or a link scanner following it would sign the user out without them
 * clicking anything.
 */
export function SignOutButton() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        // Icon-only: an icon button with no accessible name is a defect (§11).
        aria-label={t('auth.signOut')}
        title={t('auth.signOut')}
        className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-surface text-text-muted transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-surface-hover hover:text-text"
      >
        <LogOut aria-hidden className="size-4" />
      </button>
    </form>
  );
}
