'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { IDLE, type FormState } from '@/lib/form-state';
import { resendVerification } from '@/app/[locale]/(auth)/actions';

/**
 * The standing ask to confirm an address.
 *
 * §7.1 puts "Verify email" in the signup path, but blocking on it would put a
 * mail round trip inside a flow targeted at three minutes — and a provider
 * outage would then cost the account rather than the confirmation. So the
 * account works immediately and this stays until the address is confirmed:
 * visible on every workspace screen, dismissible only by doing it.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(
    resendVerification,
    IDLE,
  );

  const resent = state === IDLE ? false : !state.error;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning bg-warning-subtle px-4 py-2 text-xs sm:px-6"
    >
      <p className="text-text">{t('auth.verify.pending')}</p>
      <p className="text-text-muted">{t('auth.verify.sentTo', { email })}</p>

      <form action={action} className="ms-auto">
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" size="sm" loading={pending}>
          {resent ? t('auth.verify.resent') : t('auth.verify.resend')}
        </Button>
      </form>
    </div>
  );
}
